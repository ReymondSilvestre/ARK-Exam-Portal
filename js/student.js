import { requireRole, logout, db, esc, friendlyError, ageOf } from "./auth.js";
import { collection, query, where, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { TERMS, termRank } from "./omr.js";
import { sizeText, openModule } from "./files.js";

const $ = (id) => document.getElementById(id);
const { user, profile } = await requireRole(["student"]);
$("out").onclick = logout;
const flash = (t) => { const m = $("msg"); m.textContent = t; m.className = "notice err"; m.hidden = false; };
const net = () => { $("sync").className = "sync" + (navigator.onLine ? "" : " off"); $("sync").lastElementChild.textContent = navigator.onLine ? "Online" : "Offline"; };
addEventListener("online", net); addEventListener("offline", net); net();

const termHtml = `<option value="">All terms / quarters</option>` + TERMS.map((t) => `<option>${t}</option>`).join("");
$("rTerm").innerHTML = $("mTerm").innerHTML = termHtml;
const grouped = (list, cols, row) => { let last, out = ""; for (const x of list) { const t = x.term || "No term"; if (t !== last) { last = t; out += `<tr class="grp"><td colspan="${cols}">${esc(t)}</td></tr>`; } out += row(x); } return out; };
const byTerm = (a, b) => termRank(a.term) - termRank(b.term);

let results = [], modules = [];
try {
  const me = await getDoc(doc(db, "students", profile.studentId));
  if (!me.exists()) throw new Error("Your student record was not found. Ask your teacher.");
  const s = me.data();
  $("who").textContent = s.name; $("name").textContent = s.name;
  $("info").textContent = `Exam ID No. ${s.number} | Section ${s.className}` + (s.birthday ? ` | Age ${ageOf(s.birthday)}` : "");
  results = (await getDocs(query(collection(db, "scanResults"), where("studentId", "==", profile.studentId)))).docs.map((d) => d.data())
    .sort((a, b) => byTerm(a, b) || (b.scannedAt?.seconds || 0) - (a.scannedAt?.seconds || 0));
  // modules from my teacher: my section, plus the ones meant for all of that teacher's sections
  const q = (cls) => getDocs(query(collection(db, "modules"), where("ownerUid", "==", s.ownerUid), where("classId", "==", cls)));
  const [mine, all] = await Promise.all([q(s.classId), q("")]);
  modules = [...mine.docs, ...all.docs].map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => byTerm(a, b) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
} catch (e) { console.error(e); flash(friendlyError(e)); }

function render() {
  const rt = $("rTerm").value, rs = results.filter((r) => !rt || (r.term || "") === rt);
  $("rTbl").innerHTML = "<tr><th>Exam</th><th>Subject</th><th>Score</th><th>%</th><th>Result</th><th>Items to review</th></tr>" +
    (grouped(rs, 6, (r) => `<tr><td>${esc(r.examTitle || "Examination")}</td><td>${esc(r.subject || "-")}</td><td>${r.points}/${r.maxPoints}</td><td>${r.pct}</td>
      <td>${r.final ? `<span class="badge ${r.pass ? "active" : "suspended"}">${r.pass ? "Passed" : "Failed"}</span>` : '<span class="badge warn">Being checked</span>'}</td>
      <td class="wrapcell">${(r.missedList || []).length ? r.missedList.map((m) => `<span class="wr">${esc(m)}</span>`).join("") : "None"}</td></tr>`) || "<tr><td colspan=6>No exam results yet.</td></tr>");
  const mt = $("mTerm").value, ms = modules.filter((m) => !mt || (m.term || "") === mt);
  $("mTbl").innerHTML = "<tr><th>Module</th><th>File</th><th>Uploaded</th><th></th></tr>" +
    (grouped(ms, 4, (m) => `<tr><td class="wrapcell"><b>${esc(m.title)}</b>${m.description ? `<br><span class="muted fine">${esc(m.description)}</span>` : ""}</td>
      <td>${m.kind === "link" ? "Link" : esc(m.fileName) + " (" + sizeText(m.size) + ")"}</td><td>${m.createdAt?.toDate ? m.createdAt.toDate().toLocaleDateString() : "-"}</td>
      <td class="actions"><button class="btn small primary" data-open="${esc(m.id)}">${m.kind === "link" ? "Open" : "Download"}</button></td></tr>`) || "<tr><td colspan=4>No modules yet.</td></tr>");
}
$("rTerm").onchange = $("mTerm").onchange = render;
$("tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("[data-s]").forEach((s) => (s.hidden = s.dataset.s !== b.dataset.t));
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b)); };
$("mTbl").onclick = async (e) => { const b = e.target.closest("[data-open]"); if (!b) return;
  try { b.disabled = true; await openModule(db, modules.find((m) => m.id === b.dataset.open)); } catch (err) { flash(friendlyError(err)); } finally { b.disabled = false; } };
render();
