import { requireRole, logout, db, esc, friendlyError, resetPassword } from "./auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer,
  doc, setDoc, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const { user } = await requireRole(["admin"]);
$("who").textContent = user.displayName || user.email;
$("out").onclick = logout;

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

/* ---------- connection indicator ---------- */
function setSync() {
  const on = navigator.onLine;
  $("sync").className = "sync" + (on ? "" : " off");
  $("sync").lastElementChild.textContent = on ? "Online" : "Offline - changes need a connection";
}
addEventListener("online", setSync); addEventListener("offline", setSync); setSync();

/* ---------- navigation ---------- */
const titles = { dashboard: "Dashboard", teachers: "Teachers", requests: "Reset requests", activity: "Activity log" };
function nav() {
  const v = titles[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
  document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== v));
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.v === v));
  $("title").textContent = titles[v];
}
addEventListener("hashchange", nav); nav();

/* ---------- data ---------- */
let teachers = [];
async function loadTeachers() {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", "teacher")));
  teachers = snap.docs.map((d) => d.data()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  renderTeachers();
  $("s-teachers").textContent = teachers.length;
  $("s-active").textContent = teachers.filter((t) => t.status === "active").length;
}
function renderTeachers() {
  const q = $("q").value.trim().toLowerCase();
  const rows = teachers.filter((t) => !q || [t.displayName, t.email, t.employeeId].join(" ").toLowerCase().includes(q));
  $("teachers").innerHTML = `<tr><th>Name</th><th>Email</th><th>Employee ID</th><th>Status</th><th>Created</th><th></th></tr>` +
    (rows.length ? rows.map((t) => `<tr>
      <td>${esc(t.displayName)}</td><td>${esc(t.email)}</td><td>${esc(t.employeeId)}</td>
      <td><span class="badge ${esc(t.status)}">${esc(t.status)}</span></td><td>${fmt(t.createdAt)}</td>
      <td class="actions">
        <button class="btn small" data-act="toggle" data-uid="${esc(t.uid)}">${t.status === "active" ? "Suspend" : "Reactivate"}</button>
        <button class="btn small" data-act="reset" data-uid="${esc(t.uid)}">Email reset link</button>
      </td></tr>`).join("") : `<tr><td colspan="6">No teachers yet. Add one above.</td></tr>`);
}
$("q").addEventListener("input", renderTeachers);

/* ---------- password reset requests ---------- */
let requests = [];
async function loadRequests() {
  const snap = await getDocs(query(collection(db, "resetRequests"), orderBy("createdAt", "desc"), limit(100)));
  requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)); // pending first, newest first within
  renderRequests();
}
function matchOf(r) {
  const t = teachers.find((x) => String(x.email).toLowerCase() === String(r.email).toLowerCase());
  if (!t) return { state: "none" };
  if (r.employeeId && r.employeeId.toLowerCase() !== String(t.employeeId).toLowerCase()) return { state: "mismatch", t };
  return { state: "ok", t };
}
function renderRequests() {
  const pending = requests.filter((r) => r.status === "pending").length;
  $("reqCount").textContent = pending; $("reqCount").hidden = !pending; $("s-req").textContent = pending;
  const badge = (m) => m.state === "ok" ? `<span class="badge active">Matches ${esc(m.t.displayName)}</span>`
    : m.state === "mismatch" ? `<span class="badge warn">Employee ID does not match ${esc(m.t.displayName)}</span>`
    : `<span class="badge suspended">No account with this email</span>`;
  $("reqTbl").innerHTML = `<tr><th>Requested</th><th>Email</th><th>Employee ID given</th><th>Check</th><th>Status</th><th></th></tr>` +
    (requests.length ? requests.map((r) => { const m = matchOf(r), open = r.status === "pending"; return `<tr>
      <td>${fmt(r.createdAt)}</td><td>${esc(r.email)}</td><td>${esc(r.employeeId || "-")}</td><td>${badge(m)}</td>
      <td><span class="badge ${open ? "warn" : "active"}">${esc(r.status)}</span></td>
      <td class="actions">${open ? `<button class="btn small primary" data-act="send" data-id="${esc(r.id)}" ${m.t ? "" : "disabled"}>Send reset link</button>
        <button class="btn small" data-act="dismiss" data-id="${esc(r.id)}">Dismiss</button>` : ""}</td></tr>`; }).join("")
      : `<tr><td colspan="6">No requests yet.</td></tr>`);
}
$("reqTbl").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const r = requests.find((x) => x.id === b.dataset.id); if (!r) return;
  const m = matchOf(r);
  try {
    if (b.dataset.act === "send") {
      if (!m.t) return;
      const warn = m.state === "mismatch" ? "The employee ID in the request does NOT match this account. Verify the person first.\n\n" : "";
      if (!ask(`${warn}Email a password reset link to ${m.t.email} (${m.t.displayName})?`)) return;
      await resetPassword(m.t.email);
      await updateDoc(doc(db, "resetRequests", r.id), { status: "sent", resolvedAt: serverTimestamp(), resolvedBy: user.uid });
      await logAudit("teacher.reset_link_sent", m.t.uid, { email: m.t.email, via: "request" });
      flash(`Reset link sent to ${m.t.email}.`, true);
    } else {
      if (!ask(`Dismiss the request from ${r.email}?`)) return;
      await updateDoc(doc(db, "resetRequests", r.id), { status: "dismissed", resolvedAt: serverTimestamp(), resolvedBy: user.uid });
      await logAudit("reset.request_dismissed", m.t?.uid || "", { email: r.email });
    }
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
});

async function loadAudit() {
  const snap = await getDocs(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(50)));
  const rows = snap.docs.map((d) => d.data());
  const html = `<tr><th>When</th><th>Action</th><th>Details</th></tr>` +
    (rows.length ? rows.map((r) => `<tr><td>${fmt(r.createdAt)}</td><td>${esc(r.action)}</td>
      <td>${esc(r.details?.email || r.targetUid || "")}</td></tr>`).join("") : `<tr><td colspan="3">No activity yet.</td></tr>`);
  $("audit").innerHTML = html;
  $("recent").innerHTML = html.split("</tr>").slice(0, 7).join("</tr>") + (rows.length ? "</tr>" : "");
}
async function loadCounts() {
  try {
    const [e, s] = await Promise.all([
      getCountFromServer(collection(db, "examinations")), getCountFromServer(collection(db, "scanResults"))]);
    $("s-exams").textContent = e.data().count; $("s-scans").textContent = s.data().count;
  } catch (err) { flash("Could not load counts: " + friendlyError(err)); }
}
async function refresh() {
  try { await loadTeachers(); await Promise.all([loadRequests(), loadAudit(), loadCounts()]); }
  catch (err) { flash("Could not load data: " + friendlyError(err)); }
}

/* ---------- actions ---------- */
const logAudit = (action, targetUid, details = {}) =>
  addDoc(collection(db, "auditLogs"), { actorUid: user.uid, action, targetUid, details, createdAt: serverTimestamp() });

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(r, (n) => chars[n % chars.length]).join("") + "a9";
}

$("newT").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const displayName = f.displayName.trim(), email = f.email.trim().toLowerCase(), employeeId = f.employeeId.trim();
  if (displayName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !employeeId)
    return flash("Enter a name, a valid email and an employee ID.");
  $("addBtn").disabled = true;
  // A second Firebase app instance creates the account so the admin stays signed in.
  const second = initializeApp(firebaseConfig, "creator-" + Date.now());
  try {
    const dup = await getDocs(query(collection(db, "users"), where("employeeId", "==", employeeId), limit(1)));
    if (!dup.empty) throw new Error("That employee ID is already registered.");
    const pw = genPassword();
    const cred = await createUserWithEmailAndPassword(getAuth(second), email, pw);
    const uid = cred.user.uid;
    await setDoc(doc(db, "users", uid), {
      uid, role: "teacher", displayName, email, employeeId, status: "active",
      mustChangePassword: true, createdAt: serverTimestamp(), createdBy: user.uid,
    });
    await logAudit("teacher.create", uid, { email, employeeId });
    await signOut(getAuth(second));
    e.target.reset();
    popup("Teacher account created", "Give this temporary password to the teacher. It is shown only once.", pw);
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
  finally { $("addBtn").disabled = false; deleteApp(second).catch(() => {}); }
});

$("teachers").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const t = teachers.find((x) => x.uid === b.dataset.uid); if (!t) return;
  try {
    if (b.dataset.act === "toggle") {
      const next = t.status === "active" ? "suspended" : "active";
      if (!ask(`${next === "suspended" ? "Suspend" : "Reactivate"} ${t.displayName}?`)) return;
      await updateDoc(doc(db, "users", t.uid), { status: next, updatedAt: serverTimestamp() });
      await logAudit("teacher." + next, t.uid, { email: t.email });
      flash(`${t.displayName} is now ${next}.`, true);
    } else {
      if (!ask(`Email a password reset link to ${t.email}?`)) return;
      await resetPassword(t.email);
      await logAudit("teacher.reset_link_sent", t.uid, { email: t.email });
      flash(`Reset link sent to ${t.email}.`, true);
    }
    await refresh();
  } catch (err) { flash(friendlyError(err)); }
});

refresh();
