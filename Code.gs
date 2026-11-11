/**
 * SKA Lesson Planner — Google Sheets backend
 *
 * The Sheet is the database:
 *   Plans       — one row per class plan (date, focus, class type, length, sections)
 *   Plan items  — the exercises slotted into each plan, with their own minutes and notes
 *   Exercises   — the shared exercise library every instructor adds to
 *   Lists       — sections (with colours), class types, class lengths, regular timeslots, the attendance link.
 *                 Edit these and the app picks them up on its next sync.
 *
 *   Instructors — one row per instructor account (sign-in details and how their name shows).
 *                 Password hashes are kept in hidden columns; never share this tab.
 *                 Role: Admin or Instructor. Admins can also edit plans and exercises shared with them.
 *
 * Sharing: every plan and exercise has an Owner (email) and Shared with ("Only me", "Everyone",
 * or a comma list of instructor emails). Each instructor is only sent what they may see, and
 * changes they aren't allowed to make are ignored.
 *
 * - doPost is the JSON API the app calls (it's hosted on Cloudflare Pages)
 * - Instructors sign in with email + password or with Google. New accounts need the dojo code
 *   (menu: SKA Lesson Planner → Show app link and dojo code).
 */

const APP_NAME = 'SKA Lesson Planner';
// Where the app lives. Used to build the one-tap phone link in the menu.
const APP_SITE = 'https://ska-lesson-planner.pages.dev/';

const CLASS_TYPES = ['Regular', 'Junior program', 'Advanced'];
const LIST_NAMES = ['Section', 'Class type', 'Class length', 'Timeslot', 'Attendance link'];
const ROLES = ['Admin', 'Instructor'];
const SHARE_ME = 'Only me', SHARE_ALL = 'Everyone';
const TOKEN_DAYS = 400; // how long a sign-in lasts on a phone before asking again
// The SKA Kata Tracker's web app. Student names for class notes come from its Members tab
// (active members only, name and belt), using the key from menu: Connect to the Kata Tracker…
const KATA_API = 'https://script.google.com/macros/s/AKfycbwnmXKngbUjC-NAThAD_s7R2JdaKGX5e9R3cjJYdQlkEoWbe84nbdILOKVVsGiRbIlpqw/exec';
const NOTE_KINDS = ['Class', 'Assignment', 'Person', 'Feedback'];

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
    ['role', 'Role (Admin/Instructor)', 'role', 150],
    ['google', 'Google sign-in', 'text', 110],
    ['hash', 'Password (hashed, clear to reset)', 'secret', 120],
    ['salt', 'Salt', 'secret', 90],
    ['joined', 'Joined', 'datetime', 160],
    ['lastSeen', 'Last signed in', 'datetime', 160],
    ['notify', 'Notification settings', 'text', 220],
  ],
};

// Phones signed up for notifications (one row per phone). Never sent to the app.
const PUSH = {
  sheet: 'Push', key: 'endpoint',
  cols: [
    ['id', 'ID', 'id', 90],
    ['email', 'Instructor email', 'text', 200],
    ['endpoint', 'Push address', 'secret', 300],
    ['p256dh', 'Key', 'secret', 120],
    ['auth', 'Auth', 'secret', 90],
    ['device', 'Device', 'text', 160],
    ['added', 'Added', 'datetime', 160],
  ],
};

// Feedback from testers (Profile → Send feedback, or the Feedback chip in the red bar). Never sent to the app
// except each instructor's own rows. Gary sets Status (New / Seen / Done) and can type a Reply; the sender sees both.
const FEEDBACK = {
  sheet: 'Feedback', key: 'message',
  cols: [
    ['id', 'ID', 'id', 90],
    ['created', 'Sent', 'datetime', 150],
    ['from', 'From', 'text', 120],
    ['email', 'Email', 'text', 200],
    ['kind', 'Kind', 'fbkind', 130],
    ['screen', 'Screen', 'text', 190],
    ['message', 'Message', 'text', 360],
    ['device', 'Device', 'text', 120],
    ['version', 'App version', 'text', 90],
    ['status', 'Status', 'fbstatus', 90],
    ['reply', 'Reply (they see it)', 'text', 260],
  ],
};
const FB_KINDS = ['Something broke', 'Idea', 'Confusing', 'Other'];
const FB_STATUS = ['New', 'Seen', 'Done'];

// [field, header label, type, column width]. `key` is the field a row must have to count.
const SCHEMA = {
  plans: {
    sheet: 'Plans', key: 'date',
    cols: [
      ['id', 'ID', 'id', 90],
      ['date', 'Date', 'date', 120],
      ['time', 'Time (24h, e.g. 18:00-19:30)', 'text', 150],
      ['focus', 'Focus', 'text', 180],
      ['type', 'Class type', 'classtype', 100],
      ['length', 'Length (min)', 'num', 95],
      ['sections', 'Sections (in order)', 'list', 380],
      ['skipped', 'Skipped sections', 'list', 200],
      ['review', 'After-class notes', 'text', 280],
      ['owner', 'Owner (email)', 'text', 200],
      ['share', 'Shared with', 'share', 220],
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
      ['owner', 'Owner (email)', 'text', 200],
      ['share', 'Shared with', 'share', 220],
      ['addedBy', 'Added by', 'text', 120],
      ['editedBy', 'Last edited by', 'text', 120],
      ['updated', 'Updated', 'datetime', 160],
    ],
  },
  // Typed class notes: what was told to the class, assignments, notes about one student, feedback on an exercise.
  // Private to the instructor who wrote them ("Only me") unless they share them ("Everyone" = everyone who can see the plan).
  notes: {
    sheet: 'Class notes', key: 'text',
    cols: [
      ['id', 'ID', 'id', 90],
      ['plan', 'Plan ID', 'text', 100],
      ['item', 'Plan item ID', 'text', 100],
      ['kind', 'Kind (Class/Assignment/Person/Feedback)', 'text', 150],
      ['who', 'Student (or Whole class)', 'text', 170],
      ['text', 'Note', 'text', 360],
      ['done', 'Followed up (Yes/blank)', 'text', 120],
      ['owner', 'Owner (email)', 'text', 200],
      ['share', 'Shared with', 'share', 140],
      ['next', 'Next week (Yes/blank)', 'text', 120],
      ['addedBy', 'Added by', 'text', 120],
      ['created', 'Created', 'datetime', 160],
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
  if (req.auth === 'config') return { ok: true, config: { googleClientId: props.getProperty('GOOGLE_CLIENT_ID') || '',
    vapidPublic: props.getProperty('VAPID_PUBLIC') || '', pushUrl: props.getProperty('PUSH_URL') || '' } };
  if (!props.getProperty('DOJO_CODE')) return { ok: false, error: 'not_setup', message: 'Run "Set up / repair sheets" from the ' + APP_NAME + ' menu first.' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'The sheet is busy. Try again in a moment.' };
  try {
    if (req.cron) return cron_(req);
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
    const people = instrRows_();
    // Back from adding a student in the Kata Tracker: fetch the member list again now
    if (req.refreshStudents) CacheService.getScriptCache().remove('students');
    // Notifications: settings, this phone's push address, a test
    if (req.notify) { ensureCols_(INSTR); me = updInstr_(me, { notify: JSON.stringify(cleanNotify_(req.notify)) }); }
    if (req.subscribe) addSub_(me, req.subscribe, req.device);
    if (req.unsubscribe) dropEndpoints_([req.unsubscribe], me.email);
    if (req.notifyTest) props.setProperty('TEST_' + me.id, String(Date.now()));
    if (req.feedback) addFeedback_(me, req.feedback);
    if (req.ops && req.ops.length) {
      // "Next week" on class notes (Nov 5): older sheets get the column on first use
      if (req.ops.some(function (o) { return o && o.coll === 'notes' && o.data && 'next' in o.data; })) ensureCols_(SCHEMA.notes);
      const acc = access_(me, people, readRaw_());
      req.ops.forEach(function (op) { const o = allowOp_(acc, op); if (o) applyOp_(o); });
      SpreadsheetApp.flush();
    }
    const out = { ok: true, token: token, me: me_(me, people), state: stateFor_(me, people), sheetUrl: ss_().getUrl() };
    if (req.feedback || req.myFeedback) out.feedback = myFeedback_(me);
    return out;
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

function me_(o, people) {
  return { id: o.id, email: o.email, title: o.title || 'Mr.', first: o.first || '', last: o.last || '',
    showFirst: /^y/i.test(String(o.showFirst || '')), google: !!o.google, password: !!o.hash, notify: notifyOf_(o),
    admin: isAdmin_(o, people || instrRows_()) };
}

/** Admins are marked in the Role column. Until someone is, the first instructor to join is the admin. */
function isAdmin_(o, people) {
  if (!o) return false;
  const anyAdmin = people.some(function (p) { return /^admin/i.test(String(p.role || '')); });
  if (anyAdmin) return /^admin/i.test(String(o.role || ''));
  const first = people.slice().sort(function (a, b) { return (a.joined || 0) - (b.joined || 0); })[0];
  return !!first && normEmail_(first.email) === normEmail_(o.email);
}

const nameOf_ = function (p) { return (p.title || 'Mr.') + ' ' + (/^y/i.test(String(p.showFirst || '')) && p.first ? p.first + ' ' : '') + (p.last || ''); };

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

function readRaw_() {
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

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

/** Read a "Shared with" cell: 'all', 'me' or a list of emails. A blank cell means Everyone. */
function shareOf_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || /^every/i.test(s)) return 'all';
  if (/^only me$/i.test(s) || /^private$/i.test(s)) return 'me';
  return s.split(/[,;\s]+/).map(normEmail_).filter(function (e) { return /@/.test(e); });
}

/** What one instructor may see and change, worked out from the whole sheet. */
function access_(me, people, raw) {
  const acc = { me: me, email: normEmail_(me.email), admin: isAdmin_(me, people), people: people, plans: {}, exercises: {}, items: {} };
  raw.plans.forEach(function (p) { acc.plans[p.id] = { owner: normEmail_(p.owner), share: shareOf_(p.share) }; });
  raw.exercises.forEach(function (e) { acc.exercises[e.id] = { owner: normEmail_(e.owner), share: shareOf_(e.share) }; });
  raw.items.forEach(function (i) { acc.items[i.id] = i.plan; });
  acc.notes = {};
  (raw.notes || []).forEach(function (n) { acc.notes[n.id] = { owner: normEmail_(n.owner), share: /^every/i.test(String(n.share || '')) ? 'all' : 'me', plan: n.plan }; });
  return acc;
}
function sees_(acc, r) {
  if (!r) return false;
  if (r.owner && r.owner === acc.email) return true;
  if (r.share === 'all') return true;
  if (r.share === 'me') return false;
  return r.share.indexOf(acc.email) >= 0;
}
function canEdit_(acc, r) { return !!r && ((r.owner && r.owner === acc.email) || (acc.admin && sees_(acc, r))); }
function canShare_(acc, r) { return !!r && ((r.owner && r.owner === acc.email) || (!r.owner && acc.admin)); }

/** The app sends 'me', 'all' or instructor IDs; the sheet keeps Only me / Everyone / emails. */
function shareCell_(acc, v) {
  if (v === 'all') return SHARE_ALL;
  if (!Array.isArray(v)) return SHARE_ME;
  const byId = {};
  acc.people.forEach(function (p) { byId[p.id] = normEmail_(p.email); });
  const emails = v.map(function (id) { return byId[id]; }).filter(function (e) { return e && e !== acc.email; });
  return emails.length ? emails.filter(function (e, i) { return emails.indexOf(e) === i; }).join(', ') : SHARE_ME;
}

/** Returns the op to apply (possibly trimmed), or null when this instructor isn't allowed to make it. */
function allowOp_(acc, op) {
  if (!op || !SCHEMA[op.coll]) return null;
  const data = Object.assign({}, op.data || {});
  delete data.owner;
  const out = { op: op.op, coll: op.coll, id: op.id, data: data };
  if (op.coll === 'lists') {
    if (op.op === 'del' || /^timeslot$/i.test(String(data.list || ''))) return acc.admin ? out : null;
    return out;
  }
  if (op.coll === 'plans' || op.coll === 'exercises') {
    const map = acc[op.coll], r = map[op.id];
    if (op.op === 'add' && !r) {
      data.owner = acc.email;
      data.share = shareCell_(acc, 'share' in data ? data.share : 'me');
      map[op.id] = { owner: acc.email, share: shareOf_(data.share) };
      return out;
    }
    if (!canEdit_(acc, r)) return null;
    if (op.op === 'del') return out;
    out.op = 'update';
    if ('share' in data) {
      if (canShare_(acc, r)) { data.share = shareCell_(acc, data.share); r.share = shareOf_(data.share); }
      else delete data.share;
    }
    return out;
  }
  if (op.coll === 'notes') {
    // Only the instructor who wrote a note can change or delete it, and only on a plan they can see.
    const n = acc.notes[op.id];
    if ('share' in data) data.share = data.share === 'all' ? SHARE_ALL : SHARE_ME;
    if ('kind' in data && NOTE_KINDS.indexOf(data.kind) < 0) data.kind = 'Class';
    if (op.op === 'add' && !n) {
      if (!sees_(acc, acc.plans[data.plan])) return null;
      data.owner = acc.email;
      if (!('share' in data)) data.share = SHARE_ME;
      acc.notes[op.id] = { owner: acc.email, share: data.share === SHARE_ALL ? 'all' : 'me', plan: data.plan };
      return out;
    }
    if (!n || n.owner !== acc.email) return null;
    if (op.op === 'del') return out;
    out.op = 'update';
    delete data.plan;
    return out;
  }
  if (op.coll === 'items') {
    const pid = acc.items[op.id] || data.plan;
    if (!canEdit_(acc, acc.plans[pid])) return null;
    if (op.op === 'add') acc.items[op.id] = pid;
    if (op.op !== 'add') delete data.plan; // items stay in their plan
    return out;
  }
  return null;
}

/** Everything this instructor may see, with sharing turned into app terms (IDs, never emails). */
function stateFor_(me, people) {
  const raw = readRaw_();
  const acc = access_(me, people, raw);
  const idOf = {};
  people.forEach(function (p) { idOf[normEmail_(p.email)] = p.id; });
  const dress = function (rows, map) {
    return rows.filter(function (r) { return sees_(acc, map[r.id]); }).map(function (r) {
      const a = map[r.id];
      const o = Object.assign({}, r);
      delete o.owner;
      o.ownerId = a.owner ? (idOf[a.owner] || '') : '';
      o.share = a.share === 'all' || a.share === 'me' ? a.share : a.share.map(function (e) { return idOf[e]; }).filter(String);
      o.mine = !!a.owner && a.owner === acc.email;
      o.canEdit = canEdit_(acc, a);
      o.canShare = canShare_(acc, a);
      return o;
    });
  };
  const plans = dress(raw.plans, acc.plans);
  const seen = {};
  plans.forEach(function (p) { seen[p.id] = true; });
  // Notes: your own, plus ones shared on plans you can see. Owners go out as IDs, never emails.
  const notes = (raw.notes || []).filter(function (n) {
    const a = acc.notes[n.id];
    return seen[n.plan] && (a.owner === acc.email || a.share === 'all');
  }).map(function (n) {
    const a = acc.notes[n.id];
    const o = Object.assign({}, n);
    delete o.owner;
    o.ownerId = a.owner ? (idOf[a.owner] || '') : '';
    o.share = a.share;
    o.mine = a.owner === acc.email;
    return o;
  });
  return {
    plans: plans,
    notes: notes,
    students: students_(),
    items: raw.items.filter(function (i) { return seen[i.plan]; }),
    exercises: dress(raw.exercises, acc.exercises),
    lists: raw.lists,
    people: people.map(function (p) { return { id: p.id, name: nameOf_(p), admin: isAdmin_(p, people) }; }),
  };
}

/* ------------------------------------------------------------------ */
/* Notifications (Gary, Oct 30)                                        */
/* ------------------------------------------------------------------ */
/*
 * Each instructor picks the class times they teach and three reminders: Before class, No plan yet,
 * Assignments to follow up. A reminder is {rel: minutes before class} or {day: -1|0, at: 'HH:MM'};
 * assignments can also be {same: true} (with the Before class reminder).
 * The push sender (Cloudflare Worker in push/) calls {cron: CRON_KEY} every 5 minutes; cron_ answers with
 * every message due since the last run, one per phone, and the Worker encrypts and sends them.
 */
const NOTIFY_DEFAULT = { slots: [], before: { on: true, rel: 60 }, noplan: { on: true, day: -1, at: '19:00' }, asg: { on: true, same: true } };

/** Adds any missing header to an existing tab (new columns go at the end), without the full setup. */
function ensureCols_(sch) {
  const sh = ss_().getSheetByName(sch.sheet);
  if (!sh) return;
  const have = headerMap_(sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0], sch);
  sch.cols.forEach(function (c) { if (have[c[0]] == null) sh.getRange(1, sh.getLastColumn() + 1).setValue(c[1]); });
}

function cleanWhen_(w, kind) {
  w = w || {};
  const out = { on: w.on !== false };
  if (w.custom) out.custom = true; // picked Custom in the app, so the time boxes stay open even if they match a preset
  if (kind === 'asg' && w.same) { out.same = true; return out; }
  if (w.rel != null && w.rel !== '') { out.rel = Math.max(0, Math.min(24 * 60, Math.round(Number(w.rel) || 0))); return out; }
  const at = /^(\d{1,2}):(\d{2})$/.exec(String(w.at || ''));
  out.day = Number(w.day) === -1 ? -1 : 0;
  out.at = at ? ('0' + Math.min(23, +at[1])).slice(-2) + ':' + ('0' + Math.min(59, +at[2])).slice(-2) : '08:00';
  return out;
}
function cleanNotify_(n) {
  n = n || {};
  return {
    slots: (Array.isArray(n.slots) ? n.slots : []).map(function (x) { return String(x).trim().slice(0, 60); }).filter(String).slice(0, 30),
    before: cleanWhen_(n.before, 'before'), noplan: cleanWhen_(n.noplan, 'noplan'), asg: cleanWhen_(n.asg, 'asg'),
  };
}
function notifyOf_(o) {
  try { return o && o.notify ? cleanNotify_(JSON.parse(o.notify)) : JSON.parse(JSON.stringify(NOTIFY_DEFAULT)); }
  catch (e) { return JSON.parse(JSON.stringify(NOTIFY_DEFAULT)); }
}

function subRows_() {
  const sh = ss_().getSheetByName(PUSH.sheet);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const cols = headerMap_(vals[0], PUSH);
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const o = {};
    PUSH.cols.forEach(function (c) { const i = cols[c[0]]; if (i != null) o[c[0]] = fromCell_(vals[r][i], c[2]); });
    if (o.endpoint) { o.email = normEmail_(o.email); out.push(o); }
  }
  return out;
}
function addSub_(me, sub, device) {
  if (!sub || !/^https:\/\//.test(String(sub.endpoint || '')) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return;
  const old = subRows_().filter(function (r) { return r.endpoint === sub.endpoint; });
  old.forEach(function (r) { applyTo_(PUSH, { op: 'del', id: r.id }); });
  applyTo_(PUSH, { op: 'add', id: newId_(), data: { email: normEmail_(me.email), endpoint: String(sub.endpoint), p256dh: String(sub.keys.p256dh),
    auth: String(sub.keys.auth), device: String(device || '').slice(0, 60), added: Date.now() } });
}
/** Removes push addresses (gone ones from the sender, or one phone turning notifications off). */
function dropEndpoints_(list, onlyEmail) {
  const want = {};
  (list || []).forEach(function (e) { want[String(e)] = true; });
  // delete from the bottom up so row numbers stay right
  subRows_().filter(function (r) { return want[r.endpoint] && (!onlyEmail || r.email === normEmail_(onlyEmail)); })
    .reverse().forEach(function (r) { applyTo_(PUSH, { op: 'del', id: r.id }); });
}

/* ---------- Feedback (testers) ---------- */
function addFeedback_(me, f) {
  f = f || {};
  const msg = String(f.message || '').trim().slice(0, 2000);
  if (!msg) return;
  const ss = ss_();
  if (!ss.getSheetByName(FEEDBACK.sheet)) buildTab_(ss, FEEDBACK);
  const s = function (v, n) { return String(v || '').trim().slice(0, n); };
  applyTo_(FEEDBACK, { op: 'add', id: newId_(), data: { created: Date.now(), from: s(f.from, 60), email: normEmail_(me.email),
    kind: FB_KINDS.indexOf(f.kind) >= 0 ? f.kind : 'Other', screen: s(f.screen, 100), message: msg, device: s(f.device, 60),
    version: s(f.version, 20), status: 'New', reply: '' } });
}
/** The instructor's own feedback, newest first, with Gary's status and reply. */
function myFeedback_(me) {
  const sh = ss_().getSheetByName(FEEDBACK.sheet);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const cols = headerMap_(vals[0], FEEDBACK);
  const want = normEmail_(me.email);
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const o = {};
    FEEDBACK.cols.forEach(function (c) { const i = cols[c[0]]; if (i != null) o[c[0]] = fromCell_(vals[r][i], c[2]); });
    if (!o.message || normEmail_(o.email) !== want) continue;
    const st = FB_STATUS.filter(function (x) { return x.toLowerCase() === String(o.status || '').trim().toLowerCase(); })[0] || 'New';
    out.push({ id: o.id, created: o.created, kind: o.kind || 'Other', message: String(o.message), status: st, reply: String(o.reply || '') });
  }
  return out.reverse().slice(0, 20);
}

function cron_(req) {
  const props = PropertiesService.getScriptProperties();
  const want = props.getProperty('CRON_KEY');
  if (!want || String(req.cron) !== want) return fail_('bad_key', 'Not allowed.');
  if (req.gone) { dropEndpoints_(req.gone); return { ok: true }; }
  const now = req.now || Date.now();
  const last = Number(props.getProperty('CRON_LAST')) || now - 5 * 60000;
  const from = Math.max(last, now - 2 * 3600000); // never send more than 2 hours of missed reminders
  props.setProperty('CRON_LAST', String(now));
  return { ok: true, pushes: due_(from, now) };
}

const DOW_ = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const tz_ = function () { return Session.getScriptTimeZone() || 'America/Toronto'; };
const keyOf_ = function (ms) { return Utilities.formatDate(new Date(ms), tz_(), 'yyyy-MM-dd'); };
const atOf_ = function (key, hhmm) { return Utilities.parseDate(key + ' ' + hhmm, tz_(), 'yyyy-MM-dd HH:mm').getTime(); };
const dowOf_ = function (key) { const p = key.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
const hm_ = function (t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; };
const startOf_ = function (time) { const m = /^\s*(\d{1,2}:\d{2})/.exec(String(time || '')); return m ? hm_(m[1]) : ''; };
const clock12_ = function (hhmm) { const p = hhmm.split(':'); const h = +p[0]; return ((h + 11) % 12 + 1) + ':' + p[1] + (h < 12 ? ' a.m.' : ' p.m.'); };
const shortDay_ = function (key) { return DOW_[dowOf_(key)].replace(/^./, function (c) { return c.toUpperCase(); }); };

function parseSlot_(v) {
  const m = /^\s*([a-z]{3})[a-z]*\.?\s+(\d{1,2}:\d{2})\s*[-\u2013]\s*(\d{1,2}:\d{2})\s*(.*)$/i.exec(String(v || ''));
  if (!m) return null;
  const d = DOW_.indexOf(m[1].toLowerCase());
  return d < 0 ? null : { value: String(v).trim(), day: d, start: hm_(m[2]), label: m[4].trim() };
}

/** Every message due in (from, now], one per phone: [{sub: {endpoint, keys}, msg: {title, body, url, tag}}]. */
function due_(from, now) {
  const subs = subRows_();
  if (!subs.length) return [];
  const props = PropertiesService.getScriptProperties();
  const people = instrRows_();
  const raw = readRaw_();
  raw.notes = raw.notes || [];
  const slotsAll = raw.lists.filter(function (r) { return /^timeslot$/i.test(r.list); }).map(function (r) { return parseSlot_(r.value); }).filter(Boolean);
  const plansAt = function (key, start) {
    return raw.plans.filter(function (p) { return p.date && keyOf_(p.date) === key && startOf_(p.time) === start; });
  };
  const today = keyOf_(now);
  const noon = atOf_(today, '12:00');
  const out = [];
  people.forEach(function (person) {
    const mine = subs.filter(function (s) { return s.email === normEmail_(person.email); });
    if (!mine.length) return;
    const msgs = [];
    const test = props.getProperty('TEST_' + person.id);
    if (test) {
      props.deleteProperty('TEST_' + person.id);
      msgs.push({ title: 'Notifications are on', body: 'This is how SKA Lesson Planner reminders will look on this phone.', url: './', tag: 'test' });
    }
    const n = notifyOf_(person);
    const acc = access_(person, people, raw);
    const picked = n.slots.map(function (v) { return slotsAll.filter(function (s) { return s.value.toLowerCase() === String(v).toLowerCase(); })[0]; }).filter(Boolean);
    for (let d = -1; d <= 2; d++) {
      const key = keyOf_(noon + d * 86400000);
      picked.forEach(function (sl) {
        if (dowOf_(key) !== sl.day) return;
        const start = atOf_(key, sl.start);
        const plans = plansAt(key, sl.start);
        const seen = plans.filter(function (p) { return sees_(acc, acc.plans[p.id]); })[0];
        const name = (sl.label || 'Class') + ' at ' + clock12_(sl.start);
        const fireAt = function (w) {
          if (w.same) w = n.before.rel != null ? n.before : { rel: 60 };
          return w.rel != null ? start - w.rel * 60000 : atOf_(keyOf_(atOf_(key, '12:00') + (w.day || 0) * 86400000), w.at);
        };
        const inWindow = function (w) { const t = fireAt(w); return w.on && t > from && t <= now; };
        const url = seen ? './#plan=' + seen.id : './';
        if (inWindow(n.before)) {
          msgs.push(seen
            ? { title: name + ': ' + (seen.focus || 'class plan'), body: 'Plan ready. Tap to open the teaching view.', url: url, tag: 'before-' + key + sl.start }
            : { title: name + ': no plan yet', body: plans.length ? 'Another instructor has a plan for it.' : 'Tap to plan it, or copy an earlier plan.', url: url, tag: 'before-' + key + sl.start });
        }
        if (!plans.length && inWindow(n.noplan)) {
          msgs.push({ title: 'No plan yet: ' + shortDay_(key) + ' ' + clock12_(sl.start) + (sl.label ? ' ' + sl.label : ''), body: 'Tap to plan it, or copy an earlier plan.', url: './', tag: 'noplan-' + key + sl.start });
        }
        if (inWindow(n.asg)) {
          const open = raw.notes.filter(function (x) {
            if (!/^assignment$/i.test(x.kind) || /^y/i.test(String(x.done || ''))) return false;
            const p = raw.plans.filter(function (q) { return q.id === x.plan; })[0];
            if (!p || !p.date || keyOf_(p.date) >= key || dowOf_(keyOf_(p.date)) !== sl.day || startOf_(p.time) !== sl.start) return false;
            const own = normEmail_(x.owner) === normEmail_(person.email);
            return own || (/^every/i.test(String(x.share || '')) && sees_(acc, acc.plans[p.id]));
          });
          if (open.length) {
            msgs.push({ title: open.length + ' assignment' + (open.length === 1 ? '' : 's') + ' to follow up',
              body: open.slice(0, 3).map(function (x) { return (x.who && !/^whole class$/i.test(x.who) ? x.who : 'Whole class') + ': ' + x.text; }).join(' \u00b7 ') + (open.length > 3 ? ' \u00b7 +' + (open.length - 3) + ' more' : ''),
              url: url, tag: 'asg-' + key + sl.start });
          }
        }
      });
    }
    msgs.forEach(function (m) {
      mine.forEach(function (s) { out.push({ sub: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg: m }); });
    });
  });
  return out;
}

function setUpNotifications() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Set up notifications',
    'On your PC, in the SKA-Lesson-Planner folder\'s "push" folder, run:  node setup.mjs\nThen paste the setup code it prints here.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  let c;
  try { c = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(String(r.getResponseText() || '').trim())).getDataAsString()); }
  catch (e) { ui.alert('That setup code couldn\'t be read. Copy the whole line setup.mjs printed.'); return; }
  if (!c || !c.pub || !c.key || !/^https:\/\/[\w.-]+\.workers\.dev$/.test(String(c.url || ''))) { ui.alert('That setup code is missing a part. Run node setup.mjs again.'); return; }
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VAPID_PUBLIC') && props.getProperty('VAPID_PUBLIC') !== c.pub) {
    // New keys: old phone sign-ups can't receive any more
    const sh = ss_().getSheetByName(PUSH.sheet);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  }
  props.setProperty('VAPID_PUBLIC', c.pub);
  props.setProperty('CRON_KEY', c.key);
  props.setProperty('PUSH_URL', c.url);
  props.setProperty('CRON_LAST', String(Date.now()));
  ui.alert('Notifications are set up. Each instructor turns them on in the app: tap your initials, then Notifications.');
}

/**
 * Active members from the Kata Tracker (name and belt), for tagging notes. Cached for 6 hours so the
 * planner doesn't call the tracker on every sync. Empty until the key is set (menu: Connect to the Kata Tracker…).
 */
function students_() {
  const key = PropertiesService.getScriptProperties().getProperty('KATA_KEY');
  if (!key) return [];
  const cache = CacheService.getScriptCache();
  const hit = cache.get('students');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* fetch again */ } }
  const r = fetchStudents_(key);
  if (r.ok) {
    const list = r.members.map(function (m) { return { name: String(m.name || '').trim(), belt: String(m.belt || '').trim() }; })
      .filter(function (m) { return m.name; });
    const text = JSON.stringify(list);
    if (text.length < 90000) cache.put('students', text, 6 * 3600);
    return list;
  }
  cache.put('students', '[]', 600); // try again in 10 minutes
  return [];
}
function fetchStudents_(key) {
  try {
    const res = UrlFetchApp.fetch(KATA_API, {
      method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
      payload: JSON.stringify({ action: 'plannerMembers', key: key }),
    });
    const j = JSON.parse(res.getContentText() || '{}');
    return j && j.ok && Array.isArray(j.members) ? { ok: true, members: j.members } : { ok: false, error: (j && j.error) || 'HTTP ' + res.getResponseCode() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function connectKataTracker() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const r = ui.prompt('Connect to the Kata Tracker',
    'In the Kata Tracker sheet choose Kata Tracker → Show the Lesson Planner key, copy the key and paste it here. ' +
    'Student names (active members only) then show up when instructors tag a note. Leave blank to disconnect.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = String(r.getResponseText() || '').trim();
  CacheService.getScriptCache().remove('students');
  if (!key) { props.deleteProperty('KATA_KEY'); ui.alert('Disconnected. Notes can still name students, typed by hand.'); return; }
  const t = fetchStudents_(key);
  if (!t.ok) { ui.alert('The Kata Tracker didn\'t accept that key (' + t.error + '). Nothing was changed.'); return; }
  props.setProperty('KATA_KEY', key);
  ui.alert('Connected. ' + t.members.length + ' active members will show up as students when tagging notes.');
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
    .addItem('Connect to the Kata Tracker…', 'connectKataTracker')
    .addItem('Set up notifications…', 'setUpNotifications')
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
  claimOwners_();

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
    if (type === 'role') rng.setDataValidation(pick(ROLES));
    if (type === 'share') rng.setDataValidation(pick([SHARE_ME, SHARE_ALL]));
    if (type === 'fbkind') rng.setDataValidation(pick(FB_KINDS));
    if (type === 'fbstatus') rng.setDataValidation(pick(FB_STATUS));
    if (field === 'time') rng.setNumberFormat('@');
    if (type === 'date') rng.setNumberFormat('ddd mmm d, yyyy');
    if (type === 'datetime') rng.setNumberFormat('mmm d, yyyy h:mm am/pm');
    if (field === 'value') rng.setNumberFormat('@');
    if (field === 'note' || field === 'notes' || field === 'live' || field === 'review' || field === 'description' || field === 'sections' || field === 'message' || field === 'reply') rng.setWrap(true);
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

/**
 * Sharing arrived after the first plans and exercises were made. Those get the first admin as their
 * owner and stay shared with everyone, and the first instructor becomes Admin if nobody is yet.
 */
function claimOwners_() {
  const people = instrRows_();
  if (!people.length) return;
  let admin = people.filter(function (p) { return /^admin/i.test(String(p.role || '')); })[0];
  if (!admin) {
    admin = people.slice().sort(function (a, b) { return (a.joined || 0) - (b.joined || 0); })[0];
    applyTo_(INSTR, { op: 'update', id: admin.id, data: { role: 'Admin' } });
  }
  const ss = ss_();
  ['plans', 'exercises'].forEach(function (coll) {
    const sch = SCHEMA[coll];
    const sh = ss.getSheetByName(sch.sheet);
    if (!sh || sh.getLastRow() < 2) return;
    const t = table_(sh, sch);
    if (t.cols.owner == null || t.cols.share == null) return;
    const n = sh.getLastRow() - 1;
    const key = sh.getRange(2, t.cols[sch.key] + 1, n, 1).getValues();
    const own = sh.getRange(2, t.cols.owner + 1, n, 1).getValues();
    const shr = sh.getRange(2, t.cols.share + 1, n, 1).getValues();
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (String(key[i][0]).trim() === '') continue;
      if (!String(own[i][0]).trim()) { own[i][0] = admin.email; changed = true; }
      if (!String(shr[i][0]).trim()) { shr[i][0] = SHARE_ALL; changed = true; }
    }
    if (changed) {
      sh.getRange(2, t.cols.owner + 1, n, 1).setValues(own);
      sh.getRange(2, t.cols.share + 1, n, 1).setValues(shr);
    }
  });
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
    ['Class type', 'Regular'], ['Class type', 'Junior program'], ['Class type', 'Advanced'],
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
