import { requireRole, logout, db, esc, friendlyError, app } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, getDocs, getDoc, getCountFromServer, doc, writeBatch, deleteDoc, updateDoc, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const { user, profile } = await requireRole(["superadmin"]);
$("who").textContent = profile.displayName || "Super Admin"; $("out").onclick = logout;

const msg = $("msg");
const flash = (t, ok = false) => { msg.textContent = t; msg.className = "notice " + (ok ? "ok" : "err"); msg.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => (msg.hidden = true), 8000); };
const fmt = (ts) => (ts?.toDate ? ts.toDate().toLocaleDateString() : "-");
function popup(title, body, secret) {
  $("dlgTitle").textContent = title; $("dlgBody").textContent = body;
  $("dlgPw").hidden = $("dlgCopy").hidden = !secret; $("dlgPw").textContent = secret || ""; $("dlg").showModal();
}
$("dlgOk").onclick = () => { $("dlg").close(); $("dlgPw").textContent = ""; };
$("dlgCopy").onclick = () => navigator.clipboard?.writeText($("dlgPw").textContent);
const setSync = () => { $("sync").className = "sync" + (navigator.onLine ? "" : " off"); $("sync").lastElementChild.textContent = navigator.onLine ? "Online" : "Offline"; };
addEventListener("online", setSync); addEventListener("offline", setSync); setSync();

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(r, (n) => chars[n % chars.length]).join("") + "a9";
}
const audit = (schoolId, action, targetUid, details = {}) =>
  addDoc(collection(db, "auditLogs"), { actorUid: user.uid, schoolId, action, targetUid, details, createdAt: serverTimestamp() });

let schools = [], admins = [];
async function refresh() {
  try {
    const [s, a] = await Promise.all([getDocs(collection(db, "schools")), getDocs(query(collection(db, "users"), where("role", "==", "admin")))]);
    schools = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((x, y) => x.name.localeCompare(y.name));
    admins = a.docs.map((d) => d.data());
    const n = await Promise.all(schools.map(async (sc) => {
      const c = (role) => getCountFromServer(query(collection(db, "users"), where("schoolId", "==", sc.id), where("role", "==", role))).then((r) => r.data().count);
      return [await c("teacher"), await c("student")];
    }));
    $("tbl").innerHTML = "<tr><th>School</th><th>Code</th><th>IT Admin</th><th>Teachers</th><th>Students</th><th>Status</th><th>Registered</th><th></th></tr>" +
      (schools.map((sc, i) => { const ad = admins.filter((x) => x.schoolId === sc.id);
        return `<tr><td>${esc(sc.name)}</td><td><code>${esc(sc.code)}</code></td><td>${ad.map((x) => esc(x.displayName) + " (" + esc(x.email) + ")").join("<br>") || "-"}</td>
        <td>${n[i][0]}</td><td>${n[i][1]}</td><td><span class="badge ${esc(sc.status)}">${esc(sc.status)}</span></td><td>${fmt(sc.createdAt)}</td>
        <td class="actions"><button class="btn small" data-act="toggle" data-id="${esc(sc.id)}">${sc.status === "active" ? "Suspend school" : "Reactivate"}</button>
        ${ad[0] ? `<button class="btn small" data-act="pw" data-uid="${esc(ad[0].uid)}">Reset IT Admin password</button>` : ""}
        <button class="icon-btn" data-act="delete" data-id="${esc(sc.id)}" data-name="${esc(sc.name)}" title="Delete ${esc(sc.name)}" aria-label="Delete ${esc(sc.name)}">&#128465;</button></td></tr>`; }).join("") || "<tr><td colspan=8>No schools registered yet.</td></tr>");
  } catch (e) { flash("Could not load schools: " + friendlyError(e)); }
}

$("newS").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const name = f.name.trim(), code = f.code.trim().toUpperCase(), adminName = f.adminName.trim(), adminEmail = f.adminEmail.trim().toLowerCase();
  if (name.length < 3 || !/^[A-Z0-9-]{3,20}$/.test(code) || adminName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))
    return flash("Enter the school name, a code (3-20 letters, numbers or hyphens), and the IT Admin's name and email.");
  $("addBtn").disabled = true;
  const second = initializeApp(firebaseConfig, "creator-" + Date.now());
  let cred;
  try {
    if ((await getDoc(doc(db, "schools", code))).exists()) throw new Error("That school code is already used. Choose another.");
    const pw = genPassword();
    cred = await createUserWithEmailAndPassword(getAuth(second), adminEmail, pw);
    const uid = cred.user.uid, b = writeBatch(db);
    b.set(doc(db, "schools", code), { name, code, status: "active", createdAt: serverTimestamp(), createdBy: user.uid });
    b.set(doc(db, "users", uid), { uid, role: "admin", displayName: adminName, email: adminEmail, schoolId: code, schoolName: name, status: "active", mustChangePassword: true, createdAt: serverTimestamp(), createdBy: user.uid });
    try { await b.commit(); } catch (err) { await deleteUser(cred.user).catch(() => {}); throw err; }
    await audit(code, "school.register", uid, { email: adminEmail, name });
    await signOut(getAuth(second)); e.target.reset();
    popup(`${name} registered`, `School code ${code}. IT Admin sign-in: ${adminEmail} (no school code). Temporary password below, shown once. They must choose a new one at first sign-in.`, pw);
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
  finally { $("addBtn").disabled = false; deleteApp(second).catch(() => {}); }
});

/* ---------- client-only cascade delete (fallback when no Cloud Function is deployed) ----------
   Deletes every Firestore record of a school directly from the browser, in batches of 400.
   Cannot remove the accounts' Firebase Authentication logins - only server code (the
   superDeleteSchool Cloud Function) can do that; this is the best a client app can do alone. */
async function delMany(ref, docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => b.delete(ref(d)));
    await b.commit();
  }
}
const idsOf = (snap) => snap.docs.map((d) => d.id);
async function cascadeDeleteSchool(schoolId) {
  const byOwner = async (coll, ownerUids) => {
    for (const uid of ownerUids) {
      const snap = await getDocs(query(collection(db, coll), where("ownerUid", "==", uid)));
      await delMany((id) => doc(db, coll, id), idsOf(snap));
    }
  };
  const peopleSnap = await getDocs(query(collection(db, "users"), where("schoolId", "==", schoolId)));
  const people = peopleSnap.docs.map((d) => d.data());
  // The IT Admin also has every teacher tool, so they may own sections/exams/students directly too.
  const teacherUids = people.filter((p) => p.role === "teacher" || p.role === "admin").map((p) => p.uid);

  // Module files are stored in numbered chunk documents, not tied to a schoolId - find them via their module.
  for (const uid of teacherUids) {
    const mods = await getDocs(query(collection(db, "modules"), where("ownerUid", "==", uid)));
    for (const m of mods.docs) {
      const ids = Array.from({ length: m.data().chunks || 0 }, (_, i) => `${m.id}_${i}`);
      await delMany((id) => doc(db, "moduleChunks", id), ids);
    }
  }
  for (const coll of ["scanResults", "examAttempts", "examSubmissions", "examKeys", "examPapers", "modules",
      "examinations", "answerKeys", "answerSheets", "enrollments", "teacherLinks", "classCodes", "students", "classes"])
    await byOwner(coll, teacherUids);

  const auditSnap = await getDocs(query(collection(db, "auditLogs"), where("schoolId", "==", schoolId)));
  await delMany((id) => doc(db, "auditLogs", id), idsOf(auditSnap));
  await delMany((id) => doc(db, "users", id), idsOf(peopleSnap));
  await deleteDoc(doc(db, "schools", schoolId));
}

$("tbl").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  try {
    if (b.dataset.act === "toggle") {
      const sc = schools.find((x) => x.id === b.dataset.id), next = sc.status === "active" ? "suspended" : "active";
      if (!confirm(`${next === "suspended" ? "Suspend" : "Reactivate"} ${sc.name}? ${next === "suspended" ? "Nobody in this school can sign in or use the system until you reactivate it." : ""}`)) return;
      await updateDoc(doc(db, "schools", sc.id), { status: next, updatedAt: serverTimestamp() });
      await audit(sc.id, "school." + next, "", { name: sc.name }); flash(`${sc.name} is now ${next}.`, true);
    } else if (b.dataset.act === "delete") {
      const name = b.dataset.name;
      if (!confirm(`Permanently delete ${name}? This removes its IT Admin, every teacher and student account, and all of their sections, exams, results and modules. This cannot be undone.`)) return;
      if (prompt(`Type the school name to confirm: ${name}`) !== name) { flash("Deletion cancelled: the name did not match."); return; }
      try {
        await httpsCallable(getFunctions(app), "superDeleteSchool")({ schoolId: b.dataset.id });
        flash(`${name} and all of its accounts were deleted.`, true);
      } catch (err) {
        if (!["functions/not-found", "functions/internal", "functions/unavailable"].includes(err.code)) throw err;
        // No Cloud Function deployed: delete everything straight from the browser instead. This removes
        // all of the school's data, but a client app cannot delete someone else's sign-in login, so the
        // accounts' logins are left behind (they can no longer sign in anywhere useful - their profile
        // is gone - but the login entries themselves stay in Firebase Authentication until removed there by hand).
        await cascadeDeleteSchool(b.dataset.id);
        flash(`${name} and its records were deleted. Sign-in logins were NOT removed (no Cloud Function deployed) - clear them in Firebase console > Authentication > Users if you want to free up those emails.`, true);
      }
    } else {
      const a = admins.find((x) => x.uid === b.dataset.uid); if (!a || !confirm(`Set a new temporary password for ${a.displayName}?`)) return;
      const pw = genPassword();
      try { await httpsCallable(getFunctions(app), "adminSetTempPassword")({ uid: a.uid, password: pw }); }
      catch (err) { throw ["functions/not-found", "functions/internal", "functions/unavailable"].includes(err.code) ? new Error("The password service is not set up yet (README step G).") : err; }
      popup(`New password for ${a.displayName}`, "Give this to the IT Admin in person. It is shown once. They must choose a new one at the next sign-in.", pw);
    }
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
});
refresh();
