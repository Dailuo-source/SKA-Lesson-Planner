/**
 * SKA Lesson Planner — Google Sheets backend
 *
 * The Sheet is the database:
 *   Plans       — one row per class plan (date, focus, class type, length, sections)
 *   Plan items  — the exercises slotted into each plan, with their own minutes and notes
 *   Exercises   — the shared exercise library every instructor adds to
 *   Lists       — sections (with colours), class types, class lengths, the attendance link.
 *                 Edit these and the app picks them up on its next sync.
 *
 * - doPost is the JSON API the app calls (it's hosted on Cloudflare Pages)
 * - Every request must carry the app key (menu: SKA Lesson Planner → Show app key and phone link).
 */

const APP_NAME = 'SKA Lesson Planner';
// Where the app lives. Used to build the one-tap phone link in the menu.
const APP_SITE = 'https://ska-lesson-planner.pages.dev/';

const CLASS_TYPES = ['Regular', 'Kids', 'Advanced'];
const LIST_NAMES = ['Section', 'Class type', 'Class length', 'Attendance link'];

// [field, header label, type, column width]. `key` is the field a row must have to count.
const SCHEMA = {
  plans: {
    sheet: 'Plans', key: 'date',
    cols: [
      ['id', 'ID', 'id', 90],
      ['date', 'Date', 'date', 120],
      ['focus', 'Focus', 'text', 180],
      ['type', 'Class type', 'classtype', 100],
      ['length', 'Length (min)', 'num', 95],
      ['sections', 'Sections (in order)', 'list', 380],
      ['skipped', 'Skipped sections', 'list', 200],
      ['addedBy', 'Added by', 'text', 120],
      ['editedBy', 'Last edited by', 'text', 120],
      ['updated', 'Updated', 'datetime', 160],
    ],
  },
  items: {
    sheet: 'Plan items', key: 'name',
    cols: [
      ['id', 'ID', 'id', 90],
      ['plan', 'Plan ID', 'text', 100],
      ['section', 'Section', 'text', 190],
      ['order', 'Order', 'num', 60],
      ['name', 'Exercise', 'text', 200],
      ['minutes', 'Minutes', 'num', 75],
      ['note', 'Note', 'text', 260],
      ['exercise', 'Library ID', 'text', 100],
      ['addedBy', 'Added by', 'text', 120],
      ['editedBy', 'Time changed by', 'text', 130],
      ['updated', 'Updated', 'datetime', 160],
    ],
  },
  exercises: {
    sheet: 'Exercises', key: 'name',
    cols: [
      ['id', 'ID', 'id', 90],
      ['section', 'Section', 'text', 190],
      ['name', 'Exercise', 'text', 200],
      ['minutes', 'Minutes', 'num', 75],
      ['description', 'Description', 'text', 320],
      ['addedBy', 'Added by', 'text', 120],
      ['editedBy', 'Last edited by', 'text', 120],
      ['updated', 'Updated', 'datetime', 160],
    ],
  },
  lists: {
    sheet: 'Lists', key: 'value',
    cols: [
      ['id', 'ID', 'id', 90],
      ['list', 'List', 'listname', 130],
      ['value', 'Value', 'text', 260],
      ['colour', 'Colour (hex)', 'text', 100],
      ['inNew', 'In every new plan (Yes/blank)', 'text', 200],
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet() {
  // Public page: never show the key here.
  return HtmlService.createHtmlOutput(
    '<div style="font:16px/1.5 system-ui,sans-serif;padding:24px;max-width:420px">' +
    '<h2 style="margin:0 0 8px">' + APP_NAME + '</h2>' +
    '<p>This link is where the app saves to your sheet. To open the app, use the phone link from your sheet: ' +
    APP_NAME + ' menu → Show app key and phone link.</p></div>')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  const res = api(e && e.postData ? e.postData.contents : '{}');
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Request:  { key, ops: [{op: 'add'|'update'|'del', coll: 'plans'|'items'|'exercises'|'lists', id, data}] }
 * Response: { ok: true, state: {plans, items, exercises, lists}, sheetUrl } or { ok: false, error, message }
 */
function api(body) {
  let req;
  try {
    req = typeof body === 'string' ? JSON.parse(body || '{}') : body;
  } catch (err) {
    return { ok: false, error: 'bad_request', message: 'The request could not be read.' };
  }
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('APP_KEY');
  if (!key) return { ok: false, error: 'not_setup', message: 'Run "Set up / repair sheets" from the ' + APP_NAME + ' menu first.' };
  if (!req || String(req.key || '').trim() !== key) return { ok: false, error: 'bad_key', message: 'That app key is not right.' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'The sheet is busy. Try again in a moment.' };
  try {
    (req.ops || []).forEach(applyOp_);
    SpreadsheetApp.flush();
    return { ok: true, state: readAll_(), sheetUrl: ss_().getUrl() };
  } catch (err) {
    return { ok: false, error: 'server', message: String((err && err.message) || err) };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Reading and writing                                                 */
/* ------------------------------------------------------------------ */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function label_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\(.*?\)/g, '').trim();
}

/** Map field → 0-based column index, matched by header text so columns can be moved. */
function headerMap_(head, sch) {
  const byLabel = {};
  sch.cols.forEach(function (c) { byLabel[label_(c[1])] = c[0]; });
  const cols = {};
  head.forEach(function (h, i) {
    const k = byLabel[label_(h)];
    if (k && cols[k] == null) cols[k] = i;
  });
  return cols;
}

function table_(sh, sch) {
  const width = Math.max(sh.getLastColumn(), 1);
  const lastRow = sh.getLastRow();
  const cols = headerMap_(sh.getRange(1, 1, 1, width).getValues()[0], sch);
  const rowOf = {};
  let last = 1;
  if (lastRow >= 2) {
    const vals = sh.getRange(2, 1, lastRow - 1, width).getValues();
    vals.forEach(function (r, i) {
      const id = cols.id != null ? String(r[cols.id]).trim() : '';
      const k = cols[sch.key] != null ? String(r[cols[sch.key]]).trim() : '';
      if (id || k) last = i + 2;
      if (id && !rowOf[id]) rowOf[id] = i + 2;
    });
  }
  return { cols: cols, rowOf: rowOf, lastRow: last, width: width };
}

function fromCell_(v, type) {
  switch (type) {
    case 'num': {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    }
    case 'date':
    case 'datetime':
      if (v instanceof Date) return v.getTime();
      if (v === '' || v == null) return null;
      return new Date(v).getTime() || null;
    case 'list':
      return String(v == null ? '' : v).split(',').map(function (s) { return s.trim(); }).filter(String);
    default:
      return String(v == null ? '' : v).trim();
  }
}

function toCell_(v, type) {
  switch (type) {
    case 'num': return v == null || v === '' ? '' : Number(v);
    case 'date':
    case 'datetime': return v ? new Date(v) : '';
    case 'list': return Array.isArray(v) ? v.join(', ') : (v || '');
    default: {
      const s = v == null ? '' : String(v);
      // Keep things like class lengths ("105") as text, not numbers
      return /^[\d.+-]+$/.test(s) && s !== '' ? "'" + s : s;
    }
  }
}

function newId_() {
  return 'r' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function readAll_() {
  const ss = ss_();
  const out = {};
  Object.keys(SCHEMA).forEach(function (coll) {
    const sch = SCHEMA[coll];
    out[coll] = [];
    const sh = ss.getSheetByName(sch.sheet);
    if (!sh || sh.getLastRow() < 2) return;
    const width = sh.getLastColumn();
    const vals = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
    const cols = headerMap_(vals[0], sch);
    const seen = {};
    const fixes = [];
    for (let r = 1; r < vals.length; r++) {
      const obj = {};
      sch.cols.forEach(function (c) {
        const i = cols[c[0]];
        if (i != null) obj[c[0]] = fromCell_(vals[r][i], c[2]);
      });
      if (!obj[sch.key]) continue;
      // Rows typed straight into the sheet (or copied) get their own ID
      if (!obj.id || seen[obj.id]) {
        obj.id = newId_();
        if (cols.id != null) fixes.push([r + 1, cols.id + 1, obj.id]);
      }
      seen[obj.id] = true;
      out[coll].push(obj);
    }
    fixes.forEach(function (f) { sh.getRange(f[0], f[1]).setValue(f[2]); });
  });
  return out;
}

function applyOp_(op) {
  const sch = SCHEMA[op.coll];
  if (!sch) throw new Error('Unknown list "' + op.coll + '".');
  const ss = ss_();
  const sh = ss.getSheetByName(sch.sheet) || buildTab_(ss, sch);
  const t = table_(sh, sch);
  const row = op.id ? t.rowOf[op.id] : null;

  if (op.op === 'del') {
    if (row) sh.deleteRow(row);
    return;
  }

  const data = Object.assign({}, op.data || {});
  if (t.cols.updated != null) data.updated = Date.now();

  if (op.op === 'add' && !row) {
    data.id = op.id || newId_();
    const vals = [];
    for (let i = 0; i < t.width; i++) vals.push('');
    sch.cols.forEach(function (c) {
      const i = t.cols[c[0]];
      if (i != null && c[0] in data) vals[i] = toCell_(data[c[0]], c[2]);
    });
    sh.getRange(t.lastRow + 1, 1, 1, t.width).setValues([vals]);
    if (op.coll === 'lists' && data.colour) paintSwatch_(sh, t.lastRow + 1, t.cols, data.colour);
    return;
  }

  if (!row) return; // the row was removed in the sheet; nothing to update
  sch.cols.forEach(function (c) {
    if (c[0] === 'id' || !(c[0] in data)) return;
    const i = t.cols[c[0]];
    if (i != null) sh.getRange(row, i + 1).setValue(toCell_(data[c[0]], c[2]));
  });
}

/* ------------------------------------------------------------------ */
/* Setup, menu and key                                                 */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(APP_NAME)
    .addItem('Show app key and phone link', 'showKey')
    .addItem('Set web app link…', 'setWebAppUrl')
    .addItem('Set up / repair sheets', 'setup')
    .addSeparator()
    .addItem('Make a new app key', 'resetKey')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());

  Object.keys(SCHEMA).forEach(function (coll) { buildTab_(ss, SCHEMA[coll]); });

  ['Sheet1', 'Sheet 1'].forEach(function (n) {
    const blank = ss.getSheetByName(n);
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  });

  seedLists_(ss);
  seedExercises_(ss);
  paintAllSwatches_(ss);

  let key = props.getProperty('APP_KEY');
  if (!key) {
    key = newKey_();
    props.setProperty('APP_KEY', key);
  }
  ss.setActiveSheet(ss.getSheetByName(SCHEMA.plans.sheet));

  const msg = APP_NAME + ' is set up.\n\nYour app key: ' + key +
    '\n\nNext: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone). ' +
    'Then choose ' + APP_NAME + ' → Set web app link… and paste the link it gives you.';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor: see the log */ }
}

/**
 * Apps Script can't reliably report its own deployment URL, so the /exec URL
 * is pasted in once and saved. The phone link carries both the URL and the key
 * after a # so they never reach any server.
 */
function showKey() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('APP_KEY');
  const ui = SpreadsheetApp.getUi();
  if (!key) { ui.alert('Run "Set up / repair sheets" first.'); return; }
  const url = props.getProperty('WEB_APP_URL');
  if (!url) {
    ui.alert(APP_NAME,
      'App key: ' + key +
      '\n\nYour web app link isn\'t saved yet. Choose ' + APP_NAME + ' → Set web app link… and paste the ' +
      'Web app URL from Deploy → Manage deployments (it ends in /exec).',
      ui.ButtonSet.OK);
    return;
  }
  const phone = APP_SITE + '#api=' + encodeURIComponent(url) + '&key=' + key;
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif">' +
    '<p style="margin:0 0 6px"><b>App key:</b> <code>' + key + '</code></p>' +
    '<p style="margin:12px 0 6px">Open this link once on each instructor\'s phone. It connects the app to this sheet and remembers it.</p>' +
    '<input readonly style="width:100%;padding:6px;font:12px monospace" value="' + phone + '" onclick="this.select()">' +
    '<p style="margin:12px 0"><a href="' + phone + '" target="_blank">Open ' + APP_NAME + ' ↗</a></p>' +
    '<p style="margin:12px 0 4px;color:#555">Web app link (for typing in by hand):</p>' +
    '<input readonly style="width:100%;padding:6px;font:12px monospace" value="' + url + '" onclick="this.select()">' +
    '</div>').setWidth(480).setHeight(300);
  ui.showModalDialog(html, APP_NAME);
}

function setWebAppUrl() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const r = ui.prompt('Set web app link',
    'In Apps Script open Deploy → Manage deployments, copy the Web app URL (ends in /exec) and paste it here.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = String(r.getResponseText() || '').trim().split(/[?#]/)[0];
  if (/\/dev$/.test(url)) {
    ui.alert('That is the test link (ends in /dev), which only works inside the editor. ' +
      'Use the Web app URL from Deploy → Manage deployments instead (ends in /exec).');
    return;
  }
  if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(url)) {
    ui.alert('That doesn\'t look like a web app link. It should look like:\nhttps://script.google.com/macros/s/AKfy…/exec');
    return;
  }
  props.setProperty('WEB_APP_URL', url);
  showKey();
}

function resetKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Make a new app key?', 'Phones using the old key will ask to reconnect.', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('APP_KEY', newKey_());
  showKey();
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function buildTab_(ss, sch) {
  const sh = ss.getSheetByName(sch.sheet) || ss.insertSheet(sch.sheet);
  const existing = sh.getLastColumn() > 0 ? headerMap_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], sch) : {};
  if (Object.keys(existing).length === 0) {
    sh.getRange(1, 1, 1, sch.cols.length).setValues([sch.cols.map(function (c) { return c[1]; })]);
  } else {
    sch.cols.forEach(function (c) {
      if (existing[c[0]] == null) sh.getRange(1, sh.getLastColumn() + 1).setValue(c[1]);
    });
  }
  if (sh.getMaxRows() < 500) sh.insertRowsAfter(sh.getMaxRows(), 500 - sh.getMaxRows());

  const width = sh.getLastColumn();
  const cols = headerMap_(sh.getRange(1, 1, 1, width).getValues()[0], sch);
  const body = sh.getMaxRows() - 1;

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#C8102E').setFontColor('#FFFFFF');
  sh.getRange(2, 1, body, width).setVerticalAlignment('top');

  const pick = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(true).build(); };
  sch.cols.forEach(function (c) {
    const field = c[0], type = c[2], w = c[3];
    const col = cols[field] + 1;
    const rng = sh.getRange(2, col, body, 1);
    if (type === 'classtype') rng.setDataValidation(pick(CLASS_TYPES));
    if (type === 'listname') rng.setDataValidation(pick(LIST_NAMES));
    if (type === 'date') rng.setNumberFormat('ddd mmm d, yyyy');
    if (type === 'datetime') rng.setNumberFormat('mmm d, yyyy h:mm am/pm');
    if (field === 'value') rng.setNumberFormat('@');
    if (field === 'note' || field === 'description' || field === 'sections') rng.setWrap(true);
    if (w) sh.setColumnWidth(col, w);
    if (field === 'id') sh.hideColumns(col);
  });
  return sh;
}

function paintSwatch_(sh, row, cols, colour) {
  if (cols.colour == null) return;
  const hex = String(colour || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const light = (0.299 * r + 0.587 * g + 0.114 * b) > 150;
  sh.getRange(row, cols.colour + 1).setBackground(hex).setFontColor(light ? '#111111' : '#FFFFFF');
}

function paintAllSwatches_(ss) {
  const sh = ss.getSheetByName(SCHEMA.lists.sheet);
  if (!sh || sh.getLastRow() < 2) return;
  const t = table_(sh, SCHEMA.lists);
  if (t.cols.colour == null) return;
  const vals = sh.getRange(2, t.cols.colour + 1, sh.getLastRow() - 1, 1).getValues();
  vals.forEach(function (v, i) { paintSwatch_(sh, i + 2, t.cols, v[0]); });
}

function seedLists_(ss) {
  const sh = ss.getSheetByName(SCHEMA.lists.sheet);
  if (sh.getLastRow() >= 2) return; // never seed over your own lists
  const rows = [
    // The five sections every new plan starts with, in order, with their colours
    ['Section', 'Warm-up / Physical training', '#B85A14', 'Yes'],
    ['Section', 'Technique / Kihon', '#2F5DC0', 'Yes'],
    ['Section', 'Kata / Kigu', '#6A3FB8', 'Yes'],
    ['Section', 'Kumite', '#B8372F', 'Yes'],
    ['Section', 'Final activity', '#157A6E', 'Yes'],
    ['Class type', 'Regular'], ['Class type', 'Kids'], ['Class type', 'Advanced'],
    // Class lengths in minutes
    ['Class length', '90'], ['Class length', '105'], ['Class length', '120'],
    ['Attendance link', 'https://my.musterhall.app/today'],
  ];
  rows.forEach(function (r) {
    applyOp_({ op: 'add', coll: 'lists', id: newId_(), data: { list: r[0], value: r[1], colour: r[2] || '', inNew: r[3] || '' } });
  });
}

function seedExercises_(ss) {
  const sh = ss.getSheetByName(SCHEMA.exercises.sheet);
  if (sh.getLastRow() >= 2) return;
  [['Kata / Kigu', 'Kata Teiiru', 10], ['Kata / Kigu', 'Demonstrations', 10]].forEach(function (r) {
    applyOp_({ op: 'add', coll: 'exercises', id: newId_(), data: { section: r[0], name: r[1], minutes: r[2], description: '', addedBy: 'Mr. Luo', editedBy: '' } });
  });
}
