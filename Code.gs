/**
 * Offline Exam Scanner -> Google Sheets receiver (Apps Script Web App)
 *
 * What it creates automatically, inside the spreadsheet this script belongs to:
 *   - one tab per TEACHER + EXAM + GRADE/SECTION   e.g. "Cruz EX-1A2B3C G7-Rizal"
 *       (student list, scores, every answer coloured green/red, answer key on top)
 *   - one ANSWER KEY tab per exam                  e.g. "KEY Cruz EX-1A2B3C"
 *   - an index tab "Index - Teachers" with clickable links to every tab
 *
 * Setup: see README.md ("Google Sheets setup"). After pasting or changing this code you must
 * Deploy > Manage deployments > (pencil) > Version: New version > Deploy  (the ID stays the same).
 */

// Leave '' when this script was created from the spreadsheet via Extensions > Apps Script.
// If the script is a standalone project, paste the spreadsheet ID here (the long id in its URL).
const SPREADSHEET_ID = '';

// Optional shared secret. If you set one here, type the same value in the app
// (Database & Settings > Google Sheets > Secret token). Leave '' for none.
const TOKEN = '';

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

/** Connection test from the app ("Test connection"). */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (TOKEN && p.token !== TOKEN) return out_({ ok: false, error: 'Wrong secret token' });
    const s = ss_();
    return out_({ ok: true, spreadsheet: s.getName(), url: s.getUrl() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

/** Receives data from the app. */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const b = JSON.parse(e.postData.contents);
    if (TOKEN && b.token !== TOKEN) return out_({ ok: false, error: 'Wrong secret token' });
    if (b.action === 'syncExam') return out_(syncExam_(b));
    return out_({ ok: false, error: 'Unknown action: ' + b.action });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
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
