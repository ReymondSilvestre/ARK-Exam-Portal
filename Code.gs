/**
 * Offline Exam Scanner -> Google Sheets receiver (Apps Script Web App)
 *
 * What it creates automatically, inside the spreadsheet this script belongs to:
 *   - one tab per TEACHER + EXAM + GRADE/SECTION   e.g. "Cruz EX-1A2B3C G7-Rizal"
 *       (student list, scores, every answer coloured green/red, answer key on top)
 *   - one ANSWER KEY tab per exam                  e.g. "KEY Cruz EX-1A2B3C"
 *   - an index tab "Index - Teachers" with clickable links to every tab
 *
 * NEW: it is also the CLOUD DATABASE of the app. Users, students, exams, keys and results are stored in
 * the tabs "_db_users", "_db_exams", "_db_students", "_db_results" (do not edit them by hand),
 * so every browser / device sees the same accounts and data. Every request is checked against the
 * account's password hash; teachers can only read/write their own exams and results.
 *
 * Setup: see README.md ("Google Sheets setup"). After pasting or changing this code you must
 * Deploy > Manage deployments > (pencil) > Version: New version > Deploy  (the ID stays the same).
 */

// Leave '' when this script was created from the spreadsheet via Extensions > Apps Script.
// If the script is a standalone project, paste the spreadsheet ID here (the long id in its URL).
const SPREADSHEET_ID = '';

// PERMANENT IT ADMIN (always exists; cannot be deleted or demoted). The password is NOT stored here,
// only its salted PBKDF2 hash. Change the password inside the app (Change password button).
const ADMIN = {
  id: 'US-ADMIN',
  email: 'reymonde.silvestre@gmail.com',
  name: 'IT Admin',
  salt: '9cS1jrxNBE3d4v1IawzCFA==',
  hash: 'lD7EVY5eFR94Hpa+6SQayFvYCiTD3ZmIi27A0ERKccw='
};
const DB = { users: '_db_users', exams: '_db_exams', students: '_db_students', results: '_db_results' };

const INDEX_TAB = 'Index - Teachers';
const TYPES = { mc: 'Multiple choice', tf: 'True / False', id: 'Identification', es: 'Essay' };
const COLORS = { c: '#d9f2e0', w: '#fbd5d2', b: '#eceff3', a: '#fff3cd', e: '#dbe8ff', p: '#ffffff' };
const HEAD_ROWS = 6;

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Connection test from the app ("Test connection"). Reveals nothing private. */
function doGet() {
  try {
    return out_({ ok: true, spreadsheet: ss_().getName() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

/** Receives requests from the app. */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const b = JSON.parse(e.postData.contents), ss = ss_();
    ensureAdmin_(ss);
    switch (b.action) {
      case 'salt': return out_(salt_(ss, b));
      case 'signup': return out_(signup_(ss, b));
      case 'login': return out_(login_(ss, b));
      case 'pull': return out_(pull_(ss, b));
      case 'push': return out_(push_(ss, b));
      case 'chpw': return out_(chpw_(ss, b));
      case 'syncExam': return out_(syncExamAuth_(ss, b));
    }
    return out_({ ok: false, error: 'Unknown action: ' + b.action });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

/* ---------- cloud database ---------- */

function readT_(ss, t) {
  const sh = ss.getSheetByName(DB[t]);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues()
    .map(function (r) { try { return JSON.parse(r[0]); } catch (x) { return null; } })
    .filter(Boolean);
}
function writeT_(ss, t, recs) {
  const sh = sheet_(ss, DB[t]);
  sh.clearContents();
  const rows = [['id', 'json (managed by the app - do not edit)']].concat(recs.map(function (r) {
    const j = JSON.stringify(r);
    if (j.length > 49000) throw new Error('Record too large: ' + r.id);
    return [String(r.id), j];
  }));
  write_(sh, rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold');
  sh.setFrozenRows(1);
}
function ensureAdmin_(ss) {
  const us = readT_(ss, 'users');
  const i = us.findIndex(function (u) { return u.email === ADMIN.email; });
  const rec = { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name, role: 'admin', status: 'approved',
                salt: ADMIN.salt, hash: ADMIN.hash, created: new Date().toISOString() };
  if (i < 0) { us.push(rec); writeT_(ss, 'users', us); return; }
  const u = us[i];
  if (u.role !== 'admin' || u.status !== 'approved') {
    u.role = 'admin'; u.status = 'approved'; writeT_(ss, 'users', us);
  }
}
function findUser_(ss, a) {
  if (!a || !a.email || !a.hash) return null;
  const em = String(a.email).toLowerCase().trim();
  const u = readT_(ss, 'users').find(function (x) { return x.email === em; });
  return u && u.hash === a.hash ? u : null;
}
function needUser_(ss, a) {
  const u = findUser_(ss, a);
  if (!u) throw new Error('Wrong email or password.');
  if (u.status !== 'approved') throw new Error('Your account is not approved.');
  return u;
}
function salt_(ss, b) {
  const em = String(b.email || '').toLowerCase().trim();
  const u = readT_(ss, 'users').find(function (x) { return x.email === em; });
  return { ok: true, salt: u ? u.salt : null };
}
function signup_(ss, b) {
  const n = b.user || {}, em = String(n.email || '').toLowerCase().trim();
  if (!/^[a-z0-9._%+\-]+@gmail\.com$/.test(em)) return { ok: false, error: 'Use a valid @gmail.com address.' };
  if (!n.salt || !n.hash || !String(n.name || '').trim()) return { ok: false, error: 'Missing data.' };
  const us = readT_(ss, 'users');
  if (us.some(function (u) { return u.email === em; })) return { ok: false, error: 'That email is already registered.' };
  us.push({ id: String(n.id || 'US-' + Date.now()), email: em, name: String(n.name).trim().slice(0, 80),
            role: 'teacher', status: 'pending', salt: String(n.salt), hash: String(n.hash),
            created: new Date().toISOString() });
  writeT_(ss, 'users', us);
  return { ok: true };
}
function login_(ss, b) {
  const u = findUser_(ss, b.auth);
  if (!u) return { ok: false, error: 'Wrong email or password.' };
  if (u.status === 'pending') return { ok: false, error: 'Your account is waiting for IT approval.' };
  if (u.status !== 'approved') return { ok: false, error: 'This account is ' + u.status + '. Contact the IT department.' };
  return { ok: true, user: { id: u.id, role: u.role } };
}
function pull_(ss, b) {
  const u = needUser_(ss, b.auth);
  const users = readT_(ss, 'users'), exams = readT_(ss, 'exams'), students = readT_(ss, 'students'), results = readT_(ss, 'results');
  if (u.role === 'admin') return { ok: true, data: { users: users, exams: exams, students: students, results: results } };
  const mine = exams.filter(function (e) { return e.owner === u.id; });
  const ids = {}; mine.forEach(function (e) { ids[e.id] = 1; });
  return { ok: true, data: {
    users: [u], students: students, exams: mine,
    results: results.filter(function (r) { return ids[r.examId]; })
  } };
}
function push_(ss, b) {
  const u = needUser_(ss, b.auth), admin = u.role === 'admin';
  const ops = b.ops || [], T = {}, dirty = {};
  ['users', 'exams', 'students', 'results'].forEach(function (t) {
    const m = new Map(); readT_(ss, t).forEach(function (r) { m.set(String(r.id), r); }); T[t] = m;
  });
  let denied = 0;
  ops.forEach(function (o) {
    const t = o.t, m = T[t];
    if (!m) { denied++; return; }
    const id = o.op === 'put' ? String(o.rec && o.rec.id) : String(o.id);
    let ok = false;
    if (admin) {
      ok = true;
      if (t === 'users') {
        const cur = m.get(id);
        if (o.op === 'del' && cur && cur.email === ADMIN.email) ok = false;
        if (o.op === 'put') {
          const em = String(o.rec.email || '').toLowerCase().trim(); o.rec.email = em;
          m.forEach(function (x) { if (x.email === em && String(x.id) !== id) ok = false; });
          if (em === ADMIN.email) { o.rec.role = 'admin'; o.rec.status = 'approved'; }
        }
      }
    } else if (t === 'exams') {
      const cur = m.get(id);
      if (o.op === 'put') { ok = !cur || cur.owner === u.id; if (ok) o.rec.owner = u.id; }
      else if (o.op === 'del') ok = !!cur && cur.owner === u.id;
    } else if (t === 'results') {
      const exId = o.op === 'put' ? o.rec.examId : (m.get(id) || {}).examId;
      const e = T.exams.get(String(exId));
      ok = !!e && e.owner === u.id;
    }
    if (!ok) { denied++; return; }
    if (o.op === 'clr') m.clear();
    else if (o.op === 'del') m.delete(id);
    else if (o.op === 'put') m.set(id, o.rec);
    dirty[t] = 1;
  });
  Object.keys(dirty).forEach(function (t) { writeT_(ss, t, Array.from(T[t].values())); });
  if (dirty.users) ensureAdmin_(ss);
  return { ok: true, denied: denied };
}
function chpw_(ss, b) {
  const u = needUser_(ss, b.auth);
  if (!b.salt || !b.hash) return { ok: false, error: 'Missing data.' };
  const us = readT_(ss, 'users'), r = us.find(function (x) { return x.id === u.id; });
  r.salt = String(b.salt); r.hash = String(b.hash);
  writeT_(ss, 'users', us);
  return { ok: true };
}
function syncExamAuth_(ss, b) {
  const u = needUser_(ss, b.auth);
  if (u.role !== 'admin' && (!b.teacher || b.teacher.id !== u.id)) return { ok: false, error: 'Not your exam.' };
  return syncExam_(b);
}

/* ---------- helpers ---------- */

// Stop cell values starting with = + - @ from being run as formulas; keep ID-like numbers as text.
function safe_(v) {
  if (typeof v !== 'string') return v;
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}
function txt_(v) {
  v = v == null ? '' : String(v);
  return /^\d+$/.test(v) ? "'" + v : safe_(v);
}
function clean_(s) { return String(s == null ? '' : s).replace(/[\[\]*\/\\?:']/g, '').trim(); }
function surname_(name) {
  const w = clean_(name).split(/\s+/).filter(Boolean);
  return (w.length ? w[w.length - 1] : 'Teacher').slice(0, 7);
}
function gradeShort_(g) { return clean_(g).replace(/grade\s*/i, 'G').replace(/\s+/g, '').slice(0, 5); }
function sectionTab_(t, exId, grade, sec) {
  return (surname_(t.name) + ' ' + clean_(exId) + ' ' + gradeShort_(grade) + '-' + clean_(sec).replace(/\s+/g, '').slice(0, 5)).slice(0, 31);
}
function keyTab_(t, exId) { return ('KEY ' + surname_(t.name) + ' ' + clean_(exId)).slice(0, 31); }
function sheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

// Write a 2D array at A1, growing the grid if needed. Returns the width.
function write_(sh, rows) {
  const w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  rows = rows.map(function (r) { r = r.slice(); while (r.length < w) r.push(''); return r; });
  if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  sh.getRange(1, 1, rows.length, w).setValues(rows);
  return w;
}
function head_(rg) { rg.setBackground('#12294d').setFontColor('#ffffff').setFontWeight('bold'); }

/* ---------- main ---------- */

function syncExam_(b) {
  const ss = ss_(), ex = b.exam, t = b.teacher, n = ex.q.length;
  const tabs = [];
  const totalPts = ex.q.reduce(function (a, q) { return a + (+q.p || 0); }, 0);

  // 1) Answer key tab (one per exam)
  const kName = keyTab_(t, ex.id), ks = sheet_(ss, kName);
  ks.clear();
  const kr = [
    ['ANSWER KEY', ex.id],
    ['Title', ex.title],
    ['Subject', ex.subject],
    ['Teacher', t.name + ' <' + t.email + '>'],
    ['School year / type', ex.sy + ' / ' + ex.type],
    ['Passing %', ex.pass],
    ['Total points', totalPts],
    [],
    ['No.', 'Type', 'Correct answer', 'Points']
  ];
  ex.q.forEach(function (q, i) {
    kr.push([i + 1, TYPES[q.t] || q.t, q.t === 'es' ? '(scored by teacher)' : q.a, q.p]);
  });
  write_(ks, kr.map(function (r) { return r.map(safe_); }));
  ks.getRange(1, 1, 7, 1).setFontWeight('bold');
  head_(ks.getRange(9, 1, 1, 4));
  ks.setFrozenRows(9);
  ks.setColumnWidth(3, 200);
  tabs.push(kName);

  // 2) One tab per section of this exam
  const idx = [];
  b.sections.forEach(function (s) {
    const name = sectionTab_(t, ex.id, s.grade, s.sec), sh = sheet_(ss, name);
    sh.clear();
    const fixedHead = ['Student ID', 'School ID', 'Name', 'Grade', 'Section', 'Score', 'Total', 'Percent', 'Status', 'Review', 'Scanned', 'Attempts'];
    const F = fixedHead.length;
    const qh = ex.q.map(function (q, i) { return 'Q' + (i + 1); });
    const keyRow = ['ANSWER KEY', '', '', '', '', '', totalPts, '', '', '', '', ''].concat(ex.q.map(function (q) { return q.t === 'es' ? 'essay' : q.a; }));
    const ptsRow = ['POINTS', '', '', '', '', '', '', '', '', '', '', ''].concat(ex.q.map(function (q) { return q.p; }));
    const rows = [
      ['Teacher', t.name, t.email, '', 'Exam', ex.id, ex.title, '', 'Subject', ex.subject],
      ['Section', s.grade + ' ' + s.sec, '', '', 'School year', ex.sy, 'Type', ex.type, 'Passing %', ex.pass],
      [],
      fixedHead.concat(qh),
      keyRow,
      ptsRow
    ].map(function (r) { return r.map(safe_); });

    const bg = [];
    let scanned = 0, sumPct = 0, passed = 0;
    s.students.forEach(function (st) {
      const r = st.res, base = [txt_(st.id), txt_(st.sid), safe_(st.name), safe_(s.grade), safe_(s.sec)];
      const line = new Array(F + n).fill('#ffffff');
      if (r) {
        scanned++; sumPct += +r.pct || 0; if (r.pass) passed++;
        rows.push(base.concat([r.score, r.total, r.pct, r.pass ? 'PASSED' : 'FAILED', safe_(r.review), r.date, r.attempts], r.final.map(safe_)));
        line[8] = r.pass ? COLORS.c : COLORS.w;
        for (let i = 0; i < n; i++) line[F + i] = COLORS[r.mark[i]] || '#ffffff';
      } else {
        rows.push(base.concat(['', '', '', 'NOT SCANNED', '', '', ''], new Array(n).fill('')));
        line[8] = COLORS.b;
      }
      bg.push(line);
    });

    const w = write_(sh, rows);
    sh.getRange(1, 1, 2, w).setFontWeight('bold');
    head_(sh.getRange(4, 1, 1, w));
    sh.getRange(5, 1, 2, w).setBackground('#fff3cd').setFontWeight('bold');
    if (bg.length) sh.getRange(HEAD_ROWS + 1, 1, bg.length, F + n).setBackgrounds(bg);
    sh.setFrozenRows(HEAD_ROWS);
    sh.setFrozenColumns(3);
    sh.setColumnWidth(3, 190);
    tabs.push(name);

    idx.push({
      name: name, gid: sh.getSheetId(), grade: s.grade, sec: s.sec,
      count: s.students.length, scanned: scanned,
      avg: scanned ? Math.round(sumPct / scanned * 100) / 100 : '',
      rate: scanned ? Math.round(passed / scanned * 100) : ''
    });
  });

  // 3) Index tab with links
  updateIndex_(ss, t, ex, idx, ks.getSheetId());
  return { ok: true, tabs: tabs };
}

function updateIndex_(ss, t, ex, items, keyGid) {
  const sh = sheet_(ss, INDEX_TAB);
  const H = ['Teacher', 'Email', 'Exam ID', 'Exam title', 'Subject', 'Grade', 'Section', 'Students', 'Scanned', 'Average %', 'Pass rate %', 'Last sync', 'Open sheet', 'Open key'];
  let old = [];
  const lr = sh.getLastRow();
  if (lr > 1 && sh.getLastColumn() >= H.length) {
    const rg = sh.getRange(2, 1, lr - 1, H.length), v = rg.getValues(), f = rg.getFormulas();
    old = v.map(function (r, i) { return r.map(function (c, j) { return f[i][j] || c; }); });
  }
  old = old.filter(function (r) { return r[2] !== ex.id; });
  const now = new Date();
  const mine = items.map(function (it) {
    return [t.name, t.email, ex.id, ex.title, ex.subject, it.grade, it.sec, it.count, it.scanned, it.avg, it.rate, now,
      '=HYPERLINK("#gid=' + it.gid + '","' + it.name.replace(/"/g, '') + '")',
      '=HYPERLINK("#gid=' + keyGid + '","Answer key")'];
  });
  const rows = old.concat(mine).sort(function (a, b) {
    for (let i = 0; i < 7; i++) {
      const x = String(a[i]), y = String(b[i]);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }).map(function (r) { return r.map(function (c, j) { return j >= 12 ? c : safe_(c); }); });

  sh.clear();
  write_(sh, [H].concat(rows));
  head_(sh.getRange(1, 1, 1, H.length));
  sh.getRange(2, 12, Math.max(1, rows.length), 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.setFrozenRows(1);
  sh.setColumnWidth(4, 200);
}
