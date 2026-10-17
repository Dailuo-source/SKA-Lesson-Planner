/**
 * S.A. Karate Kata Tracker
 * Bound to the "S.A. Karate Kata Tracker" Google Sheet (Extensions > Apps Script).
 * Serves Index.html as a web app that can be embedded in the dojo's Wix site.
 *
 * Anyone can view progress. Changing a status requires the Instructor password
 * stored on the Settings tab (cell B3).
 *
 * Source of truth for this file: kata-tracker/Code.gs in Dailuo-source/SKA-Lesson-Planner.
 */

var TAB = {
  KATA: 'Kata',
  MEMBERS: 'Members',
  PROGRESS: 'Progress',
  LOG: 'Log',
  SETTINGS: 'Settings'
};

var FIRST_KATA_COL = 3;      // Progress: A = Member, B = Belt (formula), C onward = kata
var MAX_PIN_FAILS = 8;       // wrong password attempts before a lockout
var LOCKOUT_SECONDS = 900;   // 15 minutes

/* ---------- Web app ---------- */

/**
 * The page itself, or (with ?api=summary) a small JSON list of kata with how many
 * members still need each one. The SKA Lesson Planner reads the summary when an
 * instructor adds a dojo kata to a class. It has counts only, never names.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api === 'summary') {
    var out;
    try { out = { ok: true, kata: kataSummary_() }; }
    catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  var dojo = getSettings_().dojoName || 'Dojo';
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(dojo + ' | Kata Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allows the Wix embed
}

/** Everything the page needs, in one call. No password is ever returned. */
function getData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  syncProgress_(ss);
  var settings = getSettings_();
  return {
    dojoName: settings.dojoName,
    belts: settings.belts,
    statuses: settings.statuses,
    kata: readKata_(ss, settings),
    members: readMembers_(ss),
    progress: readProgress_(ss),
    loadedAt: new Date().toISOString()
  };
}

/** Checks the instructor password without changing anything. */
function verifyPin(pin) {
  checkPin_(pin);
  // Sent only after a correct password, so the Sheet's address never appears in the public page.
  return { ok: true, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
}

/** Sets one member's status for one kata. status '' clears it. */
function saveStatus(pin, memberName, kataName, status, instructorName) {
  checkPin_(pin);

  var settings = getSettings_();
  memberName = str_(memberName);
  kataName = str_(kataName);
  status = str_(status);
  if (status && settings.statuses.indexOf(status) === -1) {
    throw new Error('Unknown status: ' + status);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(TAB.PROGRESS);
    var pos = findCell_(sheet, memberName, kataName);
    if (!pos) {
      syncProgress_(ss, true);
      pos = findCell_(sheet, memberName, kataName);
    }
    if (!pos) throw new Error('Could not find ' + memberName + ' / ' + kataName + ' on the Progress tab.');

    sheet.getRange(pos.row, pos.col).setValue(status);
    ss.getSheetByName(TAB.LOG).appendRow([
      new Date(), memberName, kataName, status || '(cleared)', str_(instructorName) || 'Instructor'
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, member: memberName, kata: kataName, status: status };
}

/* ---------- Sheet menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Kata Tracker')
    .addItem('Sync progress', 'menuSync_')
    .addToUi();
}

function menuSync_() {
  var added = syncProgress_(SpreadsheetApp.getActiveSpreadsheet(), true);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Added ' + added.members + ' member row(s) and ' + added.kata + ' kata column(s).',
    'Kata Tracker'
  );
}

/* ---------- Reading the tabs ---------- */

function readKata_(ss, settings) {
  return readTable_(ss.getSheetByName(TAB.KATA))
    .filter(function (r) { return str_(r['Kata']); })
    .map(function (r) {
      return {
        order: Number(r['Order']) || 9999,
        name: str_(r['Kata']),
        meaning: str_(r['Meaning']) || str_(r['English Translation']),
        category: str_(r['Category']) || 'Solo',
        belt: str_(r['Belt']) || (settings.belts[0] ? settings.belts[0].name : ''),
        learnedAt: str_(r['Learned at']),
        notes: str_(r['Notes'])
      };
    })
    .sort(function (a, b) { return a.order - b.order; });
}

function readMembers_(ss) {
  return readTable_(ss.getSheetByName(TAB.MEMBERS))
    .filter(function (r) {
      return str_(r['Name']) && str_(r['Active']).toLowerCase() !== 'no';
    })
    .map(function (r) {
      return { name: str_(r['Name']), belt: str_(r['Belt']) };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Progress matrix -> { memberName: { kataName: status } } */
function readProgress_(ss) {
  var progress = {};
  var values = ss.getSheetByName(TAB.PROGRESS).getDataRange().getDisplayValues();
  var header = values[0] || [];
  for (var r = 1; r < values.length; r++) {
    var who = str_(values[r][0]);
    if (!who) continue;
    var row = {};
    for (var c = FIRST_KATA_COL - 1; c < header.length; c++) {
      var k = str_(header[c]);
      var s = str_(values[r][c]);
      if (k && s) row[k] = s;
    }
    progress[who] = row;
  }
  return progress;
}

/**
 * Each kata with how many active members still need it: members at or above the belt
 * it's learned at (or its rank, when Learned at is blank) who don't Know it yet.
 */
function kataSummary_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = getSettings_();
  var beltNames = settings.belts.map(function (b) { return b.name.toLowerCase(); });
  var idx = function (text) {
    // "Blue/Purple" counts as the lowest belt it names.
    var parts = str_(text).toLowerCase().split(/[\/,&]| or | and /);
    var best = -1;
    parts.forEach(function (p) {
      var i = beltNames.indexOf(str_(p));
      if (i >= 0 && (best === -1 || i < best)) best = i;
    });
    return best;
  };
  var statuses = settings.statuses;
  var known = function (s) {
    var i = s ? statuses.indexOf(s) : -1;
    return statuses.length > 1 ? i >= 1 : i >= 0;
  };
  var kata = readKata_(ss, settings);
  var members = readMembers_(ss);
  var progress = readProgress_(ss);
  return kata.map(function (k) {
    var from = k.learnedAt ? idx(k.learnedAt) : idx(k.belt);
    var need = 0, learning = 0;
    members.forEach(function (m) {
      var mi = idx(m.belt);
      if (from < 0 || mi < from) return;
      var s = (progress[m.name] || {})[k.name] || '';
      if (known(s)) return;
      need++;
      if (s) learning++;
    });
    return {
      name: k.name, meaning: k.meaning, category: k.category,
      belt: k.belt, learnedAt: k.learnedAt, need: need, learning: learning
    };
  });
}

/* ---------- Helpers ---------- */

/** Makes sure every active member has a Progress row and every kata a Progress column. */
function syncProgress_(ss, alreadyLockedOrForce) {
  var sheet = ss.getSheetByName(TAB.PROGRESS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var existingKata = {};
  header.slice(FIRST_KATA_COL - 1).forEach(function (h) { if (str_(h)) existingKata[str_(h)] = true; });

  var lastRow = sheet.getLastRow();
  var existingMembers = {};
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().forEach(function (r) {
      if (str_(r[0])) existingMembers[str_(r[0])] = true;
    });
  }

  var kataNames = readTable_(ss.getSheetByName(TAB.KATA))
    .sort(function (a, b) { return (Number(a['Order']) || 9999) - (Number(b['Order']) || 9999); })
    .map(function (r) { return str_(r['Kata']); })
    .filter(function (n) { return n && !existingKata[n]; });

  var memberNames = readTable_(ss.getSheetByName(TAB.MEMBERS))
    .map(function (r) { return str_(r['Name']); })
    .filter(function (n) { return n && !existingMembers[n]; });

  if (!kataNames.length && !memberNames.length) return { kata: 0, members: 0 };

  var lock = null;
  if (!alreadyLockedOrForce) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { kata: 0, members: 0 };
  }
  try {
    if (kataNames.length) {
      var lastHeaderCol = Math.max(lastNonEmptyIndex_(header) + 1, FIRST_KATA_COL - 1);
      var needed = lastHeaderCol + kataNames.length;
      if (needed > sheet.getMaxColumns()) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns() + 10);
      }
      sheet.getRange(1, lastHeaderCol + 1, 1, kataNames.length).setValues([kataNames]);
    }
    if (memberNames.length) {
      var start = Math.max(sheet.getLastRow(), 1) + 1;
      if (start + memberNames.length > sheet.getMaxRows()) {
        sheet.insertRowsAfter(sheet.getMaxRows(), memberNames.length + 50);
      }
      // Column A only: column B is an ARRAYFORMULA that fills in each member's belt.
      sheet.getRange(start, 1, memberNames.length, 1)
        .setValues(memberNames.map(function (n) { return [n]; }));
    }
    applyStatusDropdowns_(ss, sheet);
  } finally {
    if (lock) lock.releaseLock();
  }
  return { kata: kataNames.length, members: memberNames.length };
}

function applyStatusDropdowns_(ss, sheet) {
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var cols = Math.max(sheet.getMaxColumns() - FIRST_KATA_COL + 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(TAB.SETTINGS).getRange('D2:D10'), true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, FIRST_KATA_COL, rows, cols).setDataValidation(rule);
}

function findCell_(sheet, memberName, kataName) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var col = -1;
  for (var c = FIRST_KATA_COL - 1; c < header.length; c++) {
    if (str_(header[c]) === kataName) { col = c + 1; break; }
  }
  if (col === -1) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var names = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (var r = 0; r < names.length; r++) {
    if (str_(names[r][0]) === memberName) return { row: r + 2, col: col };
  }
  return null;
}

function getSettings_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.SETTINGS);
  var v = sheet.getRange('A1:D30').getDisplayValues();
  var out = { dojoName: '', pin: '', belts: [], statuses: [] };
  for (var i = 0; i < v.length; i++) {
    var label = str_(v[i][0]).toLowerCase();
    if (label === 'dojo name') out.dojoName = str_(v[i][1]);
    if (label === 'instructor pin' || label === 'instructor password') out.pin = str_(v[i][1]);
    if (i >= 6 && str_(v[i][0])) out.belts.push({ name: str_(v[i][0]), color: str_(v[i][1]) || '#999999' });
    if (i >= 1 && i <= 9 && str_(v[i][3])) out.statuses.push(str_(v[i][3]));
  }
  return out;
}

function checkPin_(pin) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pinFails') || 0);
  if (fails >= MAX_PIN_FAILS) {
    throw new Error('Too many wrong passwords. Editing is locked for 15 minutes.');
  }
  var real = getSettings_().pin;
  if (!real || str_(pin) !== real) {
    cache.put('pinFails', String(fails + 1), LOCKOUT_SECONDS);
    throw new Error('Wrong password.');
  }
  cache.remove('pinFails');
}

/** Reads a tab with a header row into an array of objects keyed by header. */
function readTable_(sheet) {
  var v = sheet.getDataRange().getDisplayValues();
  if (v.length < 2) return [];
  var h = v[0].map(str_);
  return v.slice(1).map(function (row) {
    var o = {};
    h.forEach(function (key, i) { if (key) o[key] = row[i]; });
    return o;
  });
}

function lastNonEmptyIndex_(arr) {
  for (var i = arr.length - 1; i >= 0; i--) if (str_(arr[i])) return i;
  return -1;
}

function str_(x) {
  return x === null || x === undefined ? '' : String(x).trim();
}
