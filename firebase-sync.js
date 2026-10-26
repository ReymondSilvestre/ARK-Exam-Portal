/* Firebase (Firestore) sync for Offline Exam Scanner
 * - IndexedDB stays the working store, so scanning still works offline.
 * - Every save/delete is mirrored to Firestore. Firestore's offline cache queues writes
 *   and uploads them automatically when the internet returns.
 * - Setup: Database & Settings > Firebase (paste config, sign-in email + password).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
         doc, setDoc, deleteDoc, getDocs, collection, writeBatch }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Optional: hard-code your config here instead of using the Settings panel.
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBQ30lIv02TetlCDHBuO54ZpkQii4boO_U",
  authDomain: "examscanner-ebeb0.firebaseapp.com",
  projectId: "examscanner-ebeb0",
  storageBucket: "examscanner-ebeb0.firebasestorage.app",
  messagingSenderId: "379125942471",
  appId: "1:379125942471:web:8c2161b5ca056519a456e2",
  measurementId: "G-CE5YR8102T"
};

function start() {
  const cfg = config();
  if (!cfg || ready) return ready;
  app = initializeApp(cfg);
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  auth = getAuth(app);
  onAuthStateChanged(auth, u => { user = u; if (u) say('Firebase: signed in as ' + u.email); });
  ready = true;
  return true;
}

async function login() {
  start();
  const em = LSG('fbEmail'), pw = sessionStorage.getItem('fbPw') || LSG('fbPw');
  if (!em || !pw) throw new Error('Enter the Firebase sync email and password');
  await signInWithEmailAndPassword(auth, em, pw);
}

async function ensure() {
  if (!enabled()) return false;
  start();
  if (!auth.currentUser) await login();
  return true;
}

/* ---------- hooks called by script.js ---------- */
const FB = {
  async put(col, v) {
    try {
      if (!(await ensure())) return;
      // do not await: offline, the write waits in Firestore's queue and goes up later
      setDoc(doc(fs, col, String(v.id)), clean(noHash(col, v)))
        .then(() => say('Firebase saved ' + new Date().toLocaleTimeString()))
        .catch(e => say('Firebase: ' + e.message, 1));
    } catch (e) { say('Firebase: ' + e.message, 1); }
  },
  async del(col, id) {
    try { if (await ensure()) deleteDoc(doc(fs, col, String(id))).catch(e => say('Firebase: ' + e.message, 1)); }
    catch (e) { say('Firebase: ' + e.message, 1); }
  },
  async clr(col) {
    try {
      if (!(await ensure())) return;
      const snap = await getDocs(collection(fs, col));
      let b = writeBatch(fs), n = 0;
      for (const d of snap.docs) { b.delete(d.ref); if (++n % 450 === 0) { await b.commit(); b = writeBatch(fs); } }
      await b.commit();
    } catch (e) { say('Firebase: ' + e.message, 1); }
  },
  async uploadAll() {
    await ensure(); await load();
    let b = writeBatch(fs), n = 0, total = 0;
    for (const col of COLS) for (const v of D[col]) {
      b.set(doc(fs, col, String(v.id)), clean(noHash(col, v)));
      total++; if (++n === 450) { await b.commit(); b = writeBatch(fs); n = 0; }
    }
    await b.commit();
    return total;
  },
  // Merge: adds missing records; for results, the newer 'date' wins. Users are never imported.
  async downloadMerge() {
    await ensure(); await load();
    let added = 0, updated = 0;
    for (const col of ['students', 'exams', 'results']) {
      const snap = await getDocs(collection(fs, col));
      for (const d of snap.docs) {
        const v = d.data(), mine = D[col].find(x => x.id == v.id);
        if (!mine) { await put(col, v); added++; }
        else if (col === 'results' && String(v.date) > String(mine.date)) { await put(col, v); updated++; }
      }
    }
    await load();
    return { added, updated };
  }
};
window.FB = FB;

/* ---------- Settings panel (injected into Database & Settings) ---------- */
function panel() {
  const m = document.getElementById('m');
  if (!m || document.getElementById('fbf')) return;
  const h = [...m.querySelectorAll('h2')].find(x => /Database/i.test(x.textContent));
  if (!h) return;
  const cfgTxt = LSG('fbCfg', '');
  const box = document.createElement('div');
  box.innerHTML = `<h3>Firebase (cloud database)</h3>
  <p>Every change is also saved to Google Firebase (Firestore). Password hashes are never uploaded.</p>
  <form id="fbf" class="grid">
    <label style="grid-column:1/-1">Firebase web config (paste the <code>{ ... }</code> object)
      <textarea name="cfg" rows="6" style="font:12px monospace;padding:7px;border:1px solid #b9c3d2;border-radius:6px">${cfgTxt.replace(/</g, '&lt;')}</textarea></label>
    <label>Sync account email<input name="em" type="email" value="${LSG('fbEmail')}" autocomplete="off"></label>
    <label>Sync account password<input name="pw" type="password" autocomplete="new-password" placeholder="${LSG('fbPw') ? '(saved on this device)' : ''}"></label>
    <label class="chk"><input type="checkbox" name="on" ${LSG('fbOn', '1') === '1' ? 'checked' : ''}>Auto-sync enabled</label>
    <label class="chk"><input type="checkbox" name="rem" ${LSG('fbPw') ? 'checked' : ''}>Remember password on this device</label>
    <button>Save &amp; connect</button>
    <button type="button" id="fbup">Upload everything now</button>
    <button type="button" id="fbdn">Download &amp; merge from cloud</button>
    <button type="button" id="fbout">Sign out</button>
  </form><p id="fbmsg"></p>`;
  const anchor = document.getElementById('gmsg');
  (anchor ? anchor.parentNode : m).insertBefore(box, anchor ? anchor.nextSibling : null);

  const f = box.querySelector('#fbf');
  const store = () => {
    const raw = f.cfg.value.trim();
    if (raw) {                                     // accepts JS-style object text too
      let o; try { o = JSON.parse(raw); } catch { o = (new Function('return (' + raw.replace(/^\s*(const|var|let)\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + ')'))(); }
      if (!o.apiKey || !o.projectId) throw new Error('Config needs apiKey and projectId');
      localStorage.setItem('fbCfg', JSON.stringify(o));
    }
    localStorage.setItem('fbEmail', f.em.value.trim());
    if (f.pw.value) { sessionStorage.setItem('fbPw', f.pw.value); if (f.rem.checked) localStorage.setItem('fbPw', f.pw.value); }
    if (!f.rem.checked) localStorage.removeItem('fbPw');
    localStorage.setItem('fbOn', f.on.checked ? '1' : '0');
  };
  f.onsubmit = async e => { e.preventDefault(); try { store(); say('Connecting…'); await ensure(); say('Connected to Firebase as ' + auth.currentUser.email); } catch (x) { say(x.message, 1); } };
  box.querySelector('#fbup').onclick = async () => { try { store(); say('Uploading…'); say('Uploaded ' + (await FB.uploadAll()) + ' records.'); } catch (x) { say(x.message, 1); } };
  box.querySelector('#fbdn').onclick = async () => { try { store(); say('Downloading…'); const r = await FB.downloadMerge(); say(`Done: ${r.added} added, ${r.updated} results updated.`); } catch (x) { say(x.message, 1); } };
  box.querySelector('#fbout').onclick = async () => { try { if (auth) await signOut(auth); sessionStorage.removeItem('fbPw'); localStorage.removeItem('fbPw'); say('Signed out.'); } catch (x) { say(x.message, 1); } };
}
new MutationObserver(panel).observe(document.getElementById('m'), { childList: true, subtree: true });
panel();
if (enabled()) { try { start(); if (LSG('fbEmail') && (sessionStorage.getItem('fbPw') || LSG('fbPw'))) login().catch(e => say('Firebase: ' + e.message, 1)); } catch (e) { /* shown in settings */ } }
