import { requireRole, logout, db, esc, friendlyError, app, staffEmail, fbPass, defaultStudentPassword, fullName, applyBranding } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer,
  doc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { b64 } from "./files.js";

const $ = (id) => document.getElementById(id);
// The school's IT admin. Everything below is limited to this one school.
const { user, profile, school } = await requireRole(["admin"]);
const SID = profile.schoolId;
$("who").textContent = profile.displayName; $("school").textContent = `${school.name} (${school.code})`;
$("out").onclick = logout;
applyBranding(school);

/* ---------- helpers ---------- */
const msg = $("msg");
function flash(text, ok = false) {
  msg.textContent = text; msg.className = "notice " + (ok ? "ok" : "err"); msg.hidden = false;
  clearTimeout(flash.t); flash.t = setTimeout(() => (msg.hidden = true), 8000);
}
const fmt = (ts) => (ts?.toDate ? ts.toDate().toLocaleString() : "-");
function popup(title, body, secret) {
  $("dlgTitle").textContent = title; $("dlgBody").textContent = body;
  $("dlgPw").hidden = $("dlgCopy").hidden = !secret; $("dlgPw").textContent = secret || "";
  $("dlg").showModal();
}
$("dlgOk").onclick = () => { $("dlg").close(); $("dlgPw").textContent = ""; };
$("dlgCopy").onclick = () => navigator.clipboard?.writeText($("dlgPw").textContent);
const ask = (text) => confirm(text);
const fnMissing = (e) => ["functions/not-found", "functions/internal", "functions/unavailable"].includes(e.code);
const lastOf = (t) => t.lastName || String(t.displayName || "").split(",")[0];
const pwOf = (t) => defaultStudentPassword({ birthday: t.birthday, lastName: lastOf(t) });
const userOf = (t) => (t.role === "student" ? t.studentId : t.employeeId);

/* ---------- connection indicator ---------- */
function setSync() {
  const on = navigator.onLine;
  $("sync").className = "sync" + (on ? "" : " off");
  $("sync").lastElementChild.textContent = on ? "Online" : "Offline - changes need a connection";
}
addEventListener("online", setSync); addEventListener("offline", setSync); setSync();

/* ---------- navigation ---------- */
const titles = { dashboard: "Dashboard", teachers: "Accounts", branding: "Branding", activity: "Activity log" };
function nav() {
  const v = titles[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
  document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== v));
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.v === v));
  $("title").textContent = titles[v];
}
addEventListener("hashchange", nav); nav();

const logAudit = (action, targetUid, details = {}) =>
  addDoc(collection(db, "auditLogs"), { actorUid: user.uid, schoolId: SID, action, targetUid, details, createdAt: serverTimestamp() });

/* ---------- accounts of this school ---------- */
let users = [], teachers = [];
async function loadTeachers() {
  const snap = await getDocs(query(collection(db, "users"), where("schoolId", "==", SID), where("role", "in", ["teacher", "student"])));
  users = snap.docs.map((d) => d.data()).sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  teachers = users.filter((u) => u.role === "teacher");
  renderTeachers();
  $("s-teachers").textContent = teachers.length;
  $("s-active").textContent = teachers.filter((t) => t.status === "active").length;
  $("s-students").textContent = users.length - teachers.length;
}
function renderTeachers() {
  const q = $("q").value.trim().toLowerCase(), rf = $("roleF").value;
  const rows = users.filter((t) => (!rf || t.role === rf) && (!q || [t.displayName, t.employeeId, t.studentId].join(" ").toLowerCase().includes(q)));
  $("teachers").innerHTML = `<tr><th>Name</th><th>Role</th><th>Username</th><th>Status</th><th>Created</th><th></th></tr>` +
    (rows.length ? rows.map((t) => { const stu = t.role === "student"; return `<tr>
      <td>${esc(t.displayName)}</td><td>${stu ? "student" : "faculty / teacher"}</td>
      <td>${stu ? "Exam ID No. " + esc(t.studentId) : esc(school.code) + " / " + esc(t.employeeId)}</td>
      <td><span class="badge ${esc(t.status)}">${esc(t.status)}</span></td><td>${fmt(t.createdAt)}</td>
      <td class="actions">
        <button class="btn small" data-act="toggle" data-uid="${esc(t.uid)}">${t.status === "active" ? "Suspend" : "Reactivate"}</button>
        <button class="btn small" data-act="reset" data-uid="${esc(t.uid)}">Reset password</button>
        <button class="btn small" data-act="setpw" data-uid="${esc(t.uid)}">Set password</button>
        <button class="btn small danger" data-act="remove" data-uid="${esc(t.uid)}">Remove account</button>
      </td></tr>`; }).join("") : `<tr><td colspan="6">No accounts found.</td></tr>`);
}
$("q").addEventListener("input", renderTeachers); $("roleF").addEventListener("change", renderTeachers);

/* ---------- add a teacher: username = Employee No., password = birth year + first letter of last name ---------- */
$("newT").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const lastName = f.lastName.trim(), firstName = f.firstName.trim(), mi = (f.mi || "").trim().slice(0, 1).toUpperCase(), employeeId = f.employeeId.trim(), birthday = f.birthday;
  if (!lastName || !firstName || !employeeId || !birthday) return flash("Enter the last name, first name, Employee No. and birthday.");
  const pw = defaultStudentPassword({ birthday, lastName });
  if (!pw) return flash("The birthday is not valid.");
  $("addBtn").disabled = true;
  // A second Firebase app instance creates the login so the admin stays signed in.
  const second = initializeApp(firebaseConfig, "creator-" + Date.now());
  let cred;
  try {
    const dup = await getDocs(query(collection(db, "users"), where("schoolId", "==", SID), where("employeeId", "==", employeeId), limit(1)));
    if (!dup.empty) throw new Error("That Employee No. is already registered in this school.");
    const email = staffEmail(school.code, employeeId);
    cred = await createUserWithEmailAndPassword(getAuth(second), email, fbPass(pw));
    const uid = cred.user.uid;
    try {
      await setDoc(doc(db, "users", uid), {
        uid, role: "teacher", displayName: fullName(lastName, firstName, mi), lastName, firstName, middleInitial: mi,
        email, employeeId, birthday, schoolId: SID, schoolName: school.name, status: "active",
        mustChangePassword: true, createdAt: serverTimestamp(), createdBy: user.uid,
      });
    } catch (err) { await deleteUser(cred.user).catch(() => {}); throw err; }
    await logAudit("teacher.create", uid, { username: employeeId });
    await signOut(getAuth(second));
    e.target.reset();
    popup("Teacher account created", `Sign-in: school code ${school.code}, Employee No. ${employeeId}. Temporary password (birth year + first letter of last name). They must choose a new one at first sign-in.`, pw);
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
  finally { $("addBtn").disabled = false; deleteApp(second).catch(() => {}); }
});

/* ---------- reset a password to the temporary one (needs the Cloud Function, README step G) ---------- */
async function resetToDefault(t) {
  const pw = pwOf(t);
  if (!pw) throw new Error("This account has no birthday or last name on file, so the temporary password cannot be made.");
  try { await httpsCallable(getFunctions(app), "adminSetTempPassword")({ uid: t.uid, useDefault: true }); }
  catch (err) { throw fnMissing(err) ? new Error("The password-reset service is not set up yet (README step G).") : err; }
  popup(`Password reset for ${t.displayName}`, `Username: ${t.role === "student" ? "Exam ID No. " + t.studentId : "school code " + school.code + " + Employee No. " + t.employeeId}. Temporary password below. They must choose a new password at the next sign-in.`, pw);
}

/* ---------- set a specific password for an account (instead of only the birth-year default) ----------
   This replaces the account's real sign-in password outright - once set, their old password
   (whatever they changed it to) stops working, same as "Reset password" above. Uses the same
   Cloud Function as "Reset password", just with the password you choose instead of the default. */
async function setCustomPassword(t) {
  const min = t.role === "student" ? 6 : 10;
  const pw = prompt(`Set a new password for ${t.displayName}.\n\nThis becomes their sign-in password right away; whatever they changed it to stops working. At least ${min} characters${t.role === "student" ? "" : ", with a letter and a number"}. They are not told what it is.`);
  if (pw === null) return;
  if (pw.length < min || (t.role !== "student" && (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)))) return flash(`Use at least ${min} characters${t.role === "student" ? "" : " with a letter and a number"}.`);
  try {
    await httpsCallable(getFunctions(app), "adminSetTempPassword")({ uid: t.uid, password: pw });
    flash(`Password set for ${t.displayName}. They must choose a new one at their next sign-in.`, true);
  } catch (err) { throw fnMissing(err) ? new Error("The password service is not set up yet (README step G).") : err; }
}

/* ---------- remove an account (Firestore AND Firebase Authentication) ---------- */
async function removeAccount(u) {
  const stu = u.role === "student", label = stu ? `student ${u.displayName} (Exam ID No. ${u.studentId})` : `teacher ${u.displayName} (Employee No. ${u.employeeId})`;
  const extra = stu ? "" : "\n\nEverything this teacher owns is deleted too: sections, classroom codes, students (and their logins), examinations, results and modules.";
  if (!ask(`Permanently remove ${label}? Their login is deleted from Firebase and cannot be undone.${extra}`)) return;
  try {
    await httpsCallable(getFunctions(app), "adminDeleteUser")({ uid: u.uid });
    flash(`${u.displayName} was removed from Firebase.`, true);
  } catch (err) {
    if (!fnMissing(err)) throw err;
    if (!ask("The removal service is not set up yet (README step G), so the login itself cannot be deleted from here.\n\nRemove their access now anyway? You can then delete the login in Firebase console > Authentication > Users.")) return;
    await deleteDoc(doc(db, "users", u.uid));
    await logAudit(u.role + ".profile_removed", u.uid, { username: userOf(u) });
    popup("Access removed", `${u.displayName} can no longer use the system. To also delete the login: Firebase console > Authentication > Users > find ${u.email} > Delete account.`);
  }
}

$("teachers").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const t = users.find((x) => x.uid === b.dataset.uid); if (!t) return;
  try {
    if (b.dataset.act === "remove") { await removeAccount(t); await refresh(); return; }
    if (b.dataset.act === "setpw") { await setCustomPassword(t); return; }
    if (b.dataset.act === "reset") {
      if (!ask(`Reset the password of ${t.displayName} to birth year + first letter of last name? Their current password will stop working.`)) return;
      await resetToDefault(t);
    } else {
      const next = t.status === "active" ? "suspended" : "active";
      if (!ask(`${next === "suspended" ? "Suspend" : "Reactivate"} ${t.displayName}?`)) return;
      await updateDoc(doc(db, "users", t.uid), { status: next, updatedAt: serverTimestamp() });
      await logAudit(t.role + "." + next, t.uid, { username: userOf(t) });
      flash(`${t.displayName} is now ${next}.`, true);
    }
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
});

async function loadAudit() {
  const snap = await getDocs(query(collection(db, "auditLogs"), where("schoolId", "==", SID), orderBy("createdAt", "desc"), limit(50)));
  const rows = snap.docs.map((d) => d.data());
  const html = `<tr><th>When</th><th>Action</th><th>Details</th></tr>` +
    (rows.length ? rows.map((r) => `<tr><td>${fmt(r.createdAt)}</td><td>${esc(r.action)}</td>
      <td>${esc(r.details?.username || r.details?.email || r.targetUid || "")}</td></tr>`).join("") : `<tr><td colspan="3">No activity yet.</td></tr>`);
  $("audit").innerHTML = html;
  $("recent").innerHTML = html.split("</tr>").slice(0, 7).join("</tr>") + (rows.length ? "</tr>" : "");
}
async function loadCounts() {
  try {
    const c = (name) => getCountFromServer(query(collection(db, name), where("schoolId", "==", SID)));
    const [e, s] = await Promise.all([c("examinations"), c("scanResults")]);
    $("s-exams").textContent = e.data().count; $("s-scans").textContent = s.data().count;
  } catch (err) { flash("Could not load counts: " + friendlyError(err)); }
}
async function refresh() {
  try { await loadTeachers(); await Promise.all([loadAudit(), loadCounts()]); }
  catch (err) { flash("Could not load data: " + friendlyError(err)); }
}
refresh();

/* ---------- branding: school name + logo, set by the IT Admin, shown across the school's pages ---------- */
const LOGO_MAX = 500 * 1024;
function loadBranding() {
  $("brandName").value = school.displayName || "";
  $("brandPrev").innerHTML = school.logo ? `<img src="${school.logo}" alt="" style="max-width:100%;max-height:100%">` : "No logo";
}
loadBranding();
$("brandLogo").addEventListener("change", async () => {
  const f = $("brandLogo").files[0]; if (!f) return;
  if (f.size > LOGO_MAX) { flash("That image is larger than 500 KB. Choose a smaller file."); $("brandLogo").value = ""; return; }
  const url = `data:${f.type};base64,${await b64(f)}`;
  $("brandPrev").innerHTML = `<img src="${url}" alt="" style="max-width:100%;max-height:100%">`;
  $("brandPrev").dataset.pending = url;
});
$("brandF").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("brandSave").disabled = true;
  try {
    const patch = { displayName: $("brandName").value.trim(), updatedAt: serverTimestamp() };
    if ($("brandPrev").dataset.pending) patch.logo = $("brandPrev").dataset.pending;
    await updateDoc(doc(db, "schools", SID), patch);
    school.displayName = patch.displayName; if (patch.logo) school.logo = patch.logo;
    delete $("brandPrev").dataset.pending;
    applyBranding(school);
    flash("Branding saved.", true);
  } catch (err) { flash(friendlyError(err)); }
  finally { $("brandSave").disabled = false; }
});
$("brandClear").addEventListener("click", async () => {
  if (!ask("Remove the logo and go back to the default ARK mark?")) return;
  try {
    await updateDoc(doc(db, "schools", SID), { logo: "", updatedAt: serverTimestamp() });
    location.reload();
  } catch (err) { flash(friendlyError(err)); }
});
