import { requireRole, logout, db, esc, friendlyError, ageOf } from "./auth.js";
import { collection, query, where, getDocs, getDoc, doc, writeBatch, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { TERMS, termRank } from "./omr.js";
import { sizeText, openModule } from "./files.js";

const $ = (id) => document.getElementById(id);
const { user, profile } = await requireRole(["student"]);
$("out").onclick = logout;
const flash = (t, ok) => { const m = $("msg"); m.textContent = t; m.className = "notice " + (ok ? "ok" : "err"); m.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => (m.hidden = true), 8000); };
const net = () => { $("sync").className = "sync" + (navigator.onLine ? "" : " off"); $("sync").lastElementChild.textContent = navigator.onLine ? "Online" : "Offline"; };
addEventListener("online", net); addEventListener("offline", net); net();

const termHtml = `<option value="">All terms / quarters</option>` + TERMS.map((t) => `<option>${t}</option>`).join("");
$("rTerm").innerHTML = $("mTerm").innerHTML = termHtml;
const grouped = (list, cols, row) => { let last, out = ""; for (const x of list) { const t = x.term || "No term"; if (t !== last) { last = t; out += `<tr class="grp"><td colspan="${cols}">${esc(t)}</td></tr>`; } out += row(x); } return out; };
const byTerm = (a, b) => termRank(a.term) - termRank(b.term);
const mine = (c) => getDocs(query(collection(db, c), where("studentId", "==", profile.studentId)));

let S = null, results = [], modules = [], rooms = [], links = [];
async function loadAll() {
  const me = await getDoc(doc(db, "students", profile.studentId));
  if (!me.exists()) throw new Error("Your student record was not found. Ask your teacher.");
  S = me.data();
  $("who").textContent = S.name; $("name").textContent = S.name;
  $("info").textContent = `Exam ID No. ${S.number} | Section ${S.className}` + (S.birthday ? ` | Age ${ageOf(S.birthday)}` : "");
  [rooms, links] = (await Promise.all([mine("enrollments"), mine("teacherLinks")])).map((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
  // exam results from ALL teachers (own adviser and any classroom joined by code)
  results = (await mine("scanResults")).docs.map((d) => d.data())
    .sort((a, b) => byTerm(a, b) || (b.scannedAt?.seconds || 0) - (a.scannedAt?.seconds || 0));
  // modules: my section + "all sections" of my adviser, and the same for every classroom I joined
  const pairs = new Map([[`${S.ownerUid}|${S.classId}`, [S.ownerUid, S.classId]], [`${S.ownerUid}|`, [S.ownerUid, ""]]]);
  rooms.forEach((r) => { pairs.set(`${r.ownerUid}|${r.classId}`, [r.ownerUid, r.classId]); pairs.set(`${r.ownerUid}|`, [r.ownerUid, ""]); });
  const got = await Promise.allSettled([...pairs.values()].map(([o, c]) => getDocs(query(collection(db, "modules"), where("ownerUid", "==", o), where("classId", "==", c)))));
  const seen = new Set(); modules = [];
  got.forEach((g) => g.status === "fulfilled" && g.value.docs.forEach((d) => { if (!seen.has(d.id)) { seen.add(d.id); modules.push({ id: d.id, ...d.data() }); } }));
  modules.sort((a, b) => byTerm(a, b) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

function render() {
  const rt = $("rTerm").value, rs = results.filter((r) => !rt || (r.term || "") === rt);
  $("rTbl").innerHTML = "<tr><th>Exam</th><th>Teacher</th><th>Subject</th><th>Score</th><th>%</th><th>Result</th><th>Items to review</th></tr>" +
    (grouped(rs, 7, (r) => `<tr><td>${esc(r.examTitle || "Examination")}</td><td>${esc(r.teacherName || "-")}</td><td>${esc(r.subject || "-")}</td><td>${r.points}/${r.maxPoints}</td><td>${r.pct}</td>
      <td>${r.final ? `<span class="badge ${r.pass ? "active" : "suspended"}">${r.pass ? "Passed" : "Failed"}</span>` : '<span class="badge warn">Being checked</span>'}</td>
      <td class="wrapcell">${(r.missedList || []).length ? r.missedList.map((m) => `<span class="wr">${esc(m)}</span>`).join("") : "None"}</td></tr>`) || "<tr><td colspan=7>No exam results yet.</td></tr>");
  const mt = $("mTerm").value, ms = modules.filter((m) => !mt || (m.term || "") === mt);
  $("mTbl").innerHTML = "<tr><th>Module</th><th>Teacher</th><th>File</th><th>Uploaded</th><th></th></tr>" +
    (grouped(ms, 5, (m) => `<tr><td class="wrapcell"><b>${esc(m.title)}</b>${m.description ? `<br><span class="muted fine">${esc(m.description)}</span>` : ""}</td><td>${esc(m.teacherName || "-")}</td>
      <td>${m.kind === "link" ? "Link" : esc(m.fileName) + " (" + sizeText(m.size) + ")"}</td><td>${m.createdAt?.toDate ? m.createdAt.toDate().toLocaleDateString() : "-"}</td>
      <td class="actions"><button class="btn small primary" data-open="${esc(m.id)}">${m.kind === "link" ? "Open" : "Download"}</button></td></tr>`) || "<tr><td colspan=5>No modules yet.</td></tr>");
  $("cTbl").innerHTML = "<tr><th>Section</th><th>Teacher</th><th>Joined</th><th></th></tr>" +
    `<tr><td>${esc(S.className)}</td><td>My own section (adviser)</td><td>-</td><td></td></tr>` +
    rooms.map((r) => `<tr><td>${esc(r.className)}</td><td>${esc(r.teacherName)}</td><td>${r.joinedAt?.toDate ? r.joinedAt.toDate().toLocaleDateString() : "-"}</td>
      <td class="actions"><button class="btn small danger" data-leave="${esc(r.id)}">Leave</button></td></tr>`).join("");
}
$("rTerm").onchange = $("mTerm").onchange = render;
$("tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("[data-s]").forEach((s) => (s.hidden = s.dataset.s !== b.dataset.t));
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b)); };
$("mTbl").onclick = async (e) => { const b = e.target.closest("[data-open]"); if (!b) return;
  try { b.disabled = true; await openModule(db, modules.find((m) => m.id === b.dataset.open)); } catch (err) { flash(friendlyError(err)); } finally { b.disabled = false; } };

/* ---------- join / leave a classroom with the teacher's code ---------- */
$("jGo").onclick = async () => {
  const code = $("jCode").value.trim().toUpperCase().replace(/\s+/g, ""); if (!code) return flash("Type the classroom code from your teacher.");
  $("jGo").disabled = true;
  try {
    const snap = await getDoc(doc(db, "classCodes", code));
    if (!snap.exists()) return flash("No classroom has that code. Check it with your teacher.");
    const c = snap.data();
    if (c.schoolId !== profile.schoolId) return flash("That classroom belongs to another school.");
    if (c.classId === S.classId || rooms.some((r) => r.classId === c.classId)) return flash("You are already in that classroom.", true);
    if (!confirm(`Join ${c.className} of ${c.teacherName}?`)) return;
    const b = writeBatch(db);
    b.set(doc(db, "enrollments", `${S.number}_${c.classId}`), { studentId: S.number, studentUid: user.uid, studentName: S.name, studentNumber: S.number, classId: c.classId, className: c.className, code,
      ownerUid: c.ownerUid, teacherName: c.teacherName, schoolId: profile.schoolId, joinedAt: serverTimestamp() });
    if (!links.some((l) => l.ownerUid === c.ownerUid))
      b.set(doc(db, "teacherLinks", `${S.number}_${c.ownerUid}`), { studentId: S.number, ownerUid: c.ownerUid, classId: c.classId, schoolId: profile.schoolId, createdAt: serverTimestamp() });
    await b.commit(); $("jCode").value = "";
    await loadAll(); render(); flash(`You joined ${c.className} (${c.teacherName}).`, true);
  } catch (err) { console.error(err); flash(friendlyError(err)); } finally { $("jGo").disabled = false; }
};
$("cTbl").onclick = async (e) => { const b = e.target.closest("[data-leave]"); if (!b) return;
  const r = rooms.find((x) => x.id === b.dataset.leave); if (!r || !confirm(`Leave ${r.className} (${r.teacherName})? You will no longer see that teacher's modules. Past exam results stay in your list.`)) return;
  try {
    await deleteDoc(doc(db, "enrollments", r.id));
    if (!rooms.some((x) => x.id !== r.id && x.ownerUid === r.ownerUid)) await deleteDoc(doc(db, "teacherLinks", `${S.number}_${r.ownerUid}`)).catch(() => {});
    await loadAll(); render(); flash("You left the classroom.", true);
  } catch (err) { flash(friendlyError(err)); } };

try { await loadAll(); } catch (e) { console.error(e); flash(friendlyError(e)); }
if (S) render();
