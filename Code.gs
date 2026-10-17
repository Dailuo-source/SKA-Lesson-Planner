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
 *   Instructors — one row per instructor account (sign-in details and how their name shows).
 *                 Password hashes are kept in hidden columns; never share this tab.
 *
 * - doPost is the JSON API the app calls (it's hosted on Cloudflare Pages)
 * - Instructors sign in with email + password or with Google. New accounts need the dojo code
 *   (menu: SKA Lesson Planner → Show app link and dojo code).
 */

const APP_NAME = 'SKA Lesson Planner';
// Where the app lives. Used to build the one-tap phone link in the menu.
const APP_SITE = 'https://ska-lesson-planner.pages.dev/';

const CLASS_TYPES = ['Regular', 'Kids', 'Advanced'];
const LIST_NAMES = ['Section', 'Class type', 'Class length', 'Attendance link'];
const TOKEN_DAYS = 400; // how long a sign-in lasts on a phone before asking again

// Instructor accounts live in their own tab and are never sent to the app as data.
const INSTR = {
  sheet: 'Instructors', key: 'email',
  cols: [
    ['id', 'ID', 'id', 90],
    ['email', 'Email', 'text', 230],
    ['title', 'Title', 'text', 60],
    ['first', 'First name', 'text', 120],
    ['last', 'Last name', 'text', 130],
    ['showFirst', 'Show first name', 'text', 120],
    ['google', 'Google sign-in', 'text', 110],
    ['hash', 'Password (hashed, clear to reset)', 'secret', 120],
    ['salt', 'Salt', 'secret', 90],
    ['joined', 'Joined', 'datetime', 160],
    ['lastSeen', 'Last signed in', 'datetime', 160],
  ],
};

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
      ['review', 'After-class notes', 'text', 280],
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
      ['live', 'Quick notes (during class)', 'text', 280],
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
      // Older sheets called this column Description; that header still works
      ['description', 'Instructions', 'text', 320, ['Description']],
      ['notes', 'Notes (one point per line)', 'text', 300],
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
 * Request:  { token, ops: [{op: 'add'|'update'|'del', coll, id, data}], profile?, password? }
 *       or  { auth: 'config' | 'signup' | 'login' | 'reset' | 'google', ... } to sign in
 * Response: { ok: true, token, me, state: {plans, items, exercises, lists}, sheetUrl } or { ok: false, error, message }
 */
function api(body) {
  let req;
  try {
    req = typeof body === 'string' ? JSON.parse(body || '{}') : body;
  } catch (err) {
    return { ok: false, error: 'bad_request', message: 'The request could not be read.' };
  }
  req = req || {};
  const props = PropertiesService.getScriptProperties();
  if (req.auth === 'config') return { ok: true, config: { googleClientId: props.getProperty('GOOGLE_CLIENT_ID') || '' } };
  if (!props.getProperty('DOJO_CODE')) return { ok: false, error: 'not_setup', message: 'Run "Set up / repair sheets" from the ' + APP_NAME + ' menu first.' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'The sheet is busy. Try again in a moment.' };
  try {
    let me, token;
    if (req.auth) {
      const r = auth_(req);
      if (!r.ok) return r;
      me = r.me; token = r.token;
    } else {
      me = checkToken_(req.token);
      if (!me) return { ok: false, error: 'bad_token', message: 'Please sign in again.' };
      token = req.token;
      if (req.profile) me = updateProfile_(me, req.profile);
      if (req.password) {
        const r = changePassword_(me, req.password);
        if (!r.ok) return r;
        me = r.me;
      }
    }
    (req.ops || []).forEach(applyOp_);
    SpreadsheetApp.flush();
    return { ok: true, token: token, me: me_(me), state: readAll_(), sheetUrl: ss_().getUrl() };
  } catch (err) {
    return { ok: false, error: 'server', message: String((err && err.message) || err) };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Instructor accounts                                                 */
/* ------------------------------------------------------------------ */

const fail_ = function (error, message) { return { ok: false, error: error, message: message }; };
const normEmail_ = function (e) { return String(e || '').trim().toLowerCase(); };

function auth_(req) {
  const email = normEmail_(req.email);
  const pw = String(req.password || '');
  switch (req.auth) {
    case 'signup': {
      if (!codeOk_(req.code)) return fail_('bad_code', 'That dojo code isn\'t right. Ask the head instructor for the current code.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail_('bad_email', 'That email doesn\'t look right.');
      if (pw.length < 6) return fail_('weak_password', 'Use at least 6 characters for your password.');
      if (findInstr_('email', email)) return fail_('email_taken', 'There\'s already an account with that email. Sign in instead.');
      const p = cleanProfile_(req.profile);
      if (!p.first || !p.last) return fail_('need_name', 'Please enter your first and last name.');
      const salt = newKey_();
      const me = addInstr_(Object.assign(p, { email: email, hash: hash_(pw, salt), salt: salt, google: '' }));
      return { ok: true, me: me, token: makeToken_(me.id) };
    }
    case 'login': {
      const me = findInstr_('email', email);
      if (!me) return fail_('bad_login', 'That email and password don\'t match.');
      if (!me.hash) {
        if (me.google) return fail_('use_google', 'This account signs in with Google. Use the Google button.');
        return fail_('reset_needed', 'Your password was reset. Choose a new one with the dojo code.');
      }
      if (hash_(pw, me.salt) !== me.hash) return fail_('bad_login', 'That email and password don\'t match.');
      seen_(me);
      return { ok: true, me: me, token: makeToken_(me.id) };
    }
    case 'reset': {
      // Only works after the head instructor clears the password cell in the Instructors tab.
      const me = findInstr_('email', email);
      if (!me || me.hash) return fail_('cant_reset', 'Ask the head instructor to clear your password in the sheet first.');
      if (!codeOk_(req.code)) return fail_('bad_code', 'That dojo code isn\'t right. Ask the head instructor for the current code.');
      if (pw.length < 6) return fail_('weak_password', 'Use at least 6 characters for your password.');
      const salt = newKey_();
      const out = updInstr_(me, { hash: hash_(pw, salt), salt: salt, lastSeen: Date.now() });
      return { ok: true, me: out, token: makeToken_(out.id) };
    }
    case 'google': {
      const cid = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
      if (!cid) return fail_('google_off', 'Google sign-in isn\'t turned on yet.');
      const info = verifyGoogle_(req.credential, cid);
      if (!info) return fail_('google_bad', 'Google sign-in didn\'t work. Try again.');
      const gEmail = normEmail_(info.email);
      let me = findInstr_('email', gEmail);
      if (me) {
        me = updInstr_(me, { google: 'Yes', lastSeen: Date.now() });
        return { ok: true, me: me, token: makeToken_(me.id) };
      }
      if (!req.code) return { ok: false, error: 'need_signup', email: gEmail, first: info.given_name || '', last: info.family_name || '', message: 'New here? Finish creating your account.' };
      if (!codeOk_(req.code)) return fail_('bad_code', 'That dojo code isn\'t right. Ask the head instructor for the current code.');
      const p = cleanProfile_(req.profile);
      if (!p.first || !p.last) return fail_('need_name', 'Please enter your first and last name.');
      me = addInstr_(Object.assign(p, { email: gEmail, hash: '', salt: '', google: 'Yes' }));
      return { ok: true, me: me, token: makeToken_(me.id) };
    }
  }
  return fail_('bad_request', 'Unknown sign-in request.');
}

function cleanProfile_(p) {
  p = p || {};
  const s = function (v) { return String(v || '').trim().slice(0, 60); };
  return { title: /^ms/i.test(p.title) ? 'Ms.' : 'Mr.', first: s(p.first), last: s(p.last), showFirst: p.showFirst ? 'Yes' : '' };
}

function me_(o) {
  return { id: o.id, email: o.email, title: o.title || 'Mr.', first: o.first || '', last: o.last || '',
    showFirst: /^y/i.test(String(o.showFirst || '')), google: !!o.google, password: !!o.hash };
}

function updateProfile_(me, p) {
  const c = cleanProfile_(p);
  if (!c.first || !c.last) return me;
  return updInstr_(me, c);
}

function changePassword_(me, p) {
  const nw = String(p.next || '');
  if (me.hash && hash_(String(p.current || ''), me.salt) !== me.hash) return fail_('bad_password', 'Your current password isn\'t right.');
  if (nw.length < 6) return fail_('weak_password', 'Use at least 6 characters for your password.');
  const salt = newKey_();
  return { ok: true, me: updInstr_(me, { hash: hash_(nw, salt), salt: salt }) };
}

function codeOk_(code) {
  const want = PropertiesService.getScriptProperties().getProperty('DOJO_CODE') || '';
  return !!want && String(code || '').trim().toUpperCase() === want.toUpperCase();
}

function hash_(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())).replace(/=+$/, '');
}

function makeToken_(id) {
  const p = id + '.' + (Date.now() + TOKEN_DAYS * 864e5);
  return p + '.' + sign_(p);
}

function checkToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const p = parts[0] + '.' + parts[1];
  if (sign_(p) !== parts[2] || Number(parts[1]) < Date.now()) return null;
  return findInstr_('id', parts[0]); // a deleted instructor row signs that person out
}

function verifyGoogle_(credential, clientId) {
  if (!credential) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const j = JSON.parse(res.getContentText());
  if (j.aud !== clientId) return null;
  if (!/(^|\.)accounts\.google\.com$/.test(String(j.iss || '').replace(/^https:\/\//, ''))) return null;
  if (String(j.email_verified) !== 'true' || Number(j.exp) * 1000 < Date.now()) return null;
  return j;
}

function instrRows_() {
  const ss = ss_();
  const sh = ss.getSheetByName(INSTR.sheet) || buildTab_(ss, INSTR);
  if (sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const cols = headerMap_(vals[0], INSTR);
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const o = {};
    INSTR.cols.forEach(function (c) { const i = cols[c[0]]; if (i != null) o[c[0]] = fromCell_(vals[r][i], c[2]); });
    if (!o.email) continue;
    o.email = normEmail_(o.email);
    out.push(o);
  }
  return out;
}

function findInstr_(field, val) {
  if (!val) return null;
  return instrRows_().filter(function (o) { return o.id && o[field] === val; })[0] || null;
}

function addInstr_(data) {
  const id = newId_();
  applyTo_(INSTR, { op: 'add', id: id, data: Object.assign({ joined: Date.now(), lastSeen: Date.now() }, data) });
  return findInstr_('id', id);
}

function updInstr_(me, data) {
  applyTo_(INSTR, { op: 'update', id: me.id, data: data });
  return findInstr_('id', me.id) || me;
}

function seen_(me) { updInstr_(me, { lastSeen: Date.now() }); }

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
  sch.cols.forEach(function (c) {
    byLabel[label_(c[1])] = c[0];
    (c[4] || []).forEach(function (a) { byLabel[label_(a)] = c[0]; });
  });
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
    case 'secret': return v == null ? '' : String(v);
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
  applyTo_(sch, op);
}

function applyTo_(sch, op) {
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
    if (sch === SCHEMA.lists && data.colour) paintSwatch_(sh, t.lastRow + 1, t.cols, data.colour);
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
    .addItem('Show app link and dojo code', 'showKey')
    .addItem('Change the dojo code…', 'setDojoCode')
    .addItem('Set web app link…', 'setWebAppUrl')
    .addItem('Set Google sign-in client ID…', 'setGoogleClientId')
    .addItem('Set up / repair sheets', 'setup')
    .addSeparator()
    .addItem('Sign everyone out', 'signEveryoneOut')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());

  Object.keys(SCHEMA).forEach(function (coll) { buildTab_(ss, SCHEMA[coll]); });
  buildTab_(ss, INSTR);

  ['Sheet1', 'Sheet 1'].forEach(function (n) {
    const blank = ss.getSheetByName(n);
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  });

  seedLists_(ss);
  seedExercises_(ss);
  paintAllSwatches_(ss);

  let code = props.getProperty('DOJO_CODE');
  if (!code) {
    code = 'SKA-' + newKey_().slice(0, 4).toUpperCase();
    props.setProperty('DOJO_CODE', code);
  }
  secret_();
  ss.setActiveSheet(ss.getSheetByName(SCHEMA.plans.sheet));

  const msg = APP_NAME + ' is set up.\n\nDojo code for new instructor accounts: ' + code +
    '\n\nNext: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone). ' +
    'Then choose ' + APP_NAME + ' → Set web app link… and paste the link it gives you.';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor: see the log */ }
}

/**
 * Apps Script can't reliably report its own deployment URL, so the /exec URL
 * is pasted in once and saved. The app has it built in too; the link below
 * only matters if the deployment ever changes.
 */
function showKey() {
  const props = PropertiesService.getScriptProperties();
  const ui = SpreadsheetApp.getUi();
  const code = props.getProperty('DOJO_CODE');
  if (!code) { ui.alert('Run "Set up / repair sheets" first.'); return; }
  const url = props.getProperty('WEB_APP_URL');
  const link = url ? APP_SITE + '#api=' + encodeURIComponent(url) : APP_SITE;
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif">' +
    '<p style="margin:0 0 6px"><b>Dojo code:</b> <code style="font-size:16px">' + code + '</code></p>' +
    '<p style="margin:4px 0 12px;color:#555">New instructors need this once, to create their account.</p>' +
    '<p style="margin:0 0 6px"><b>App link</b> (send this to instructors):</p>' +
    '<input readonly style="width:100%;padding:6px;font:12px monospace" value="' + link + '" onclick="this.select()">' +
    '<p style="margin:12px 0"><a href="' + link + '" target="_blank">Open ' + APP_NAME + ' ↗</a></p>' +
    '<p style="margin:12px 0 0;color:#555">Forgotten password? Clear that person\'s <i>Password</i> cell in the Instructors tab. ' +
    'They then choose a new one in the app with the dojo code.</p>' +
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

function setDojoCode() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Change the dojo code',
    'New instructors need this code to create an account. Existing accounts keep working. Type a new code:',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const code = String(r.getResponseText() || '').trim();
  if (code.length < 4) { ui.alert('Use at least 4 characters.'); return; }
  PropertiesService.getScriptProperties().setProperty('DOJO_CODE', code);
  showKey();
}

function setGoogleClientId() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const r = ui.prompt('Google sign-in',
    'Paste the OAuth client ID from Google Cloud (ends in .apps.googleusercontent.com). Leave blank to turn Google sign-in off.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const id = String(r.getResponseText() || '').trim();
  if (id && !/\.apps\.googleusercontent\.com$/.test(id)) { ui.alert('That doesn\'t look like a client ID.'); return; }
  if (id) props.setProperty('GOOGLE_CLIENT_ID', id); else props.deleteProperty('GOOGLE_CLIENT_ID');
  ui.alert(id ? 'Google sign-in is on.' : 'Google sign-in is off.');
}

function signEveryoneOut() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Sign everyone out?', 'Every phone and computer will ask to sign in again.', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  ui.alert('Done. Everyone will be asked to sign in again.');
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
    if (field === 'note' || field === 'notes' || field === 'live' || field === 'review' || field === 'description' || field === 'sections') rng.setWrap(true);
    if (w) sh.setColumnWidth(col, w);
    // The password column stays visible so it can be cleared to reset someone; the salt is hidden.
    if (field === 'id' || field === 'salt') sh.hideColumns(col);
    if (type === 'secret') rng.setNumberFormat('@');
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
    applyOp_({ op: 'add', coll: 'exercises', id: newId_(), data: { section: r[0], name: r[1], minutes: r[2], description: '', notes: '', addedBy: 'Mr. Luo', editedBy: '' } });
  });
}
