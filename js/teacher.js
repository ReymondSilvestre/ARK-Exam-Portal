import { requireRole, logout, db, esc, friendlyError } from "./auth.js";
import { collection, query, where, getDocs, getDoc, doc, setDoc, addDoc, updateDoc, deleteDoc, deleteField, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { TYPES, TYPE_SHORT, isAuto, itemsOf, lettersOf, MAX_ITEMS, sheetSVG, scanSheet, score, missedText } from "./omr.js";

const $ = (id) => document.getElementById(id);
const { user, profile } = await requireRole(["teacher"]);
$("who").textContent = profile.displayName; $("out").onclick = logout;

const flash = (t, ok) => { const m = $("msg"); m.textContent = t; m.className = "notice noprint " + (ok ? "ok" : "err"); m.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => (m.hidden = true), 8000); };
const net = () => { $("sync").className = "sync" + (navigator.onLine ? "" : " off"); $("sync").lastElementChild.textContent = navigator.onLine ? "Online" : "Offline - changes will not save"; };
addEventListener("online", net); addEventListener("offline", net); net();
const run = async (fn) => { try { await fn(); } catch (e) { console.error(e); flash(friendlyError(e)); } };
const store = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

/* ---------- data ---------- */
const S = { classes: [], students: [], exams: [], results: [] };
const load = async (c, ...w) => (await getDocs(query(collection(db, c), where("ownerUid", "==", user.uid), ...w))).docs.map((d) => ({ id: d.id, ...d.data() }));
const keep = (id, html) => { const el = $(id), v = el.value; el.innerHTML = html; if ([...el.options].some((o) => o.value === v)) el.value = v; };
const opts = (a, f, empty) => a.map((x) => `<option value="${esc(x.id)}">${esc(f(x))}</option>`).join("") || `<option value="">${empty}</option>`;
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const clsOf = (id) => S.classes.find((c) => c.id === id);
const examOf = (id) => S.exams.find((x) => x.id === id);
const countIn = (c) => S.students.filter((s) => s.classId === c.id).length;

async function refresh() {
  await run(async () => {
    [S.classes, S.students, S.exams] = await Promise.all([load("classes"), load("students"), load("examinations")]);
    S.classes.sort((a, b) => a.name.localeCompare(b.name));
    S.exams.sort((a, b) => (b.createdAt?.seconds || 9e9) - (a.createdAt?.seconds || 9e9));
    render();
  });
}
function render() {
  const sec = S.classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  keep("stClass", opts(S.classes, (c) => c.name, "Add a section first"));
  keep("exClass", `<option value="">All sections</option>` + sec);
  const eo = opts(S.exams, (e) => `${e.title} (${e.className})`, "Create an exam first");
  ["shExam", "scExam", "reExam"].forEach((i) => keep(i, eo));
  keep("scSec", `<option value="">All sections</option>` + sec); keep("reSec", `<option value="">All sections</option>` + sec);
  keep("shFor", `<option value="blank">Blank sheets (write name by hand)</option>` + S.classes.map((c) => `<option value="${esc(c.id)}">Named sheets: ${esc(c.name)} (${countIn(c)} students)</option>`).join(""));

  $("clTbl").innerHTML = "<tr><th>Section</th><th>Students</th></tr>" + (S.classes.map((c) => `<tr><td>${esc(c.name)}</td><td>${countIn(c)}</td></tr>`).join("") || "<tr><td colspan=2>No sections yet.</td></tr>");

  const st = S.students.filter((s) => s.classId === $("stClass").value).sort(byName);
  $("stTbl").innerHTML = "<tr><th>Exam ID No.</th><th>Name</th><th></th></tr>" + (st.map((s) => `<tr><td>${esc(s.number)}</td><td>${esc(s.name)}</td><td class="actions"><button class="btn small" data-rm="${esc(s.id)}">Remove</button></td></tr>`).join("") || "<tr><td colspan=3>No students in this section.</td></tr>");
  $("stNext").value = nextId()();

  const mix = (e) => { const c = {}; itemsOf(e).forEach((i) => (c[i.type] = (c[i.type] || 0) + 1)); return Object.entries(c).map(([t, n]) => `${TYPE_SHORT[t]} ${n}`).join(", "); };
  $("exTbl").innerHTML = "<tr><th>Title</th><th>Section</th><th>Date</th><th>Items</th><th>Points</th><th>Pass %</th><th></th></tr>" +
    (S.exams.map((e) => `<tr><td>${esc(e.title)}</td><td>${esc(e.className)}</td><td>${esc(e.date)}</td><td class="wrapcell">${itemsOf(e).length} (${esc(mix(e))})</td><td>${itemsOf(e).reduce((a, b) => a + b.pts, 0)}</td><td>${e.passing}</td><td class="actions"><button class="btn small" data-edit="${esc(e.id)}">Edit key</button></td></tr>`).join("") || "<tr><td colspan=7>No examinations yet.</td></tr>");
  drawSheet();
}
function show(t) {
  document.querySelectorAll("[data-s]").forEach((s) => (s.hidden = s.dataset.s !== t));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  if (t === "results") loadResults(); if (t === "sheet") drawSheet(); if (t === "scan") fillStudents();
}
$("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.t); };
$("stClass").onchange = render;

/* ---------- sections and students ---------- */
$("clAdd").onclick = () => run(async () => {
  const name = $("clName").value.trim(); if (!name) return flash("Enter a section name.");
  await addDoc(collection(db, "classes"), { ownerUid: user.uid, name, createdAt: serverTimestamp() });
  $("clName").value = ""; await refresh(); flash("Section added.", 1);
});

/** Exam ID No. are created automatically as YEAR-0001, YEAR-0002 ... never typed by hand. */
function nextId(taken = new Set(S.students.map((s) => String(s.number)))) {
  const year = new Date().getFullYear(); let max = 0;
  for (const n of taken) { const m = /^(\d{4})-(\d+)$/.exec(n); if (m && +m[1] === year) max = Math.max(max, +m[2]); }
  return () => { let id; do { id = `${year}-${String(++max).padStart(4, "0")}`; } while (taken.has(id)); return id; };
}
$("stAdd").onclick = () => run(async () => {
  const c = clsOf($("stClass").value), name = $("stName").value.trim();
  if (!c || !name) return flash("Choose a section and enter the student's full name.");
  await addDoc(collection(db, "students"), { ownerUid: user.uid, classId: c.id, className: c.name, number: nextId()(), name, createdAt: serverTimestamp() });
  $("stName").value = ""; await refresh(); $("stName").focus();
});
$("stTbl").onclick = (e) => run(async () => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  const s = S.students.find((x) => x.id === b.dataset.rm); if (!s || !confirm(`Remove ${s.name} (${s.number})? Saved results for this student stay in the results list.`)) return;
  await deleteDoc(doc(db, "students", s.id)); await refresh();
});

/** Rows from a CSV/TXT/Excel file as arrays of trimmed strings. */
async function readTable(f) {
  if (/\.xlsx?$/i.test(f.name)) {
    if (!window.XLSX) throw new Error("The Excel reader did not load. Check your internet connection, or save the list as CSV.");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }).map((r) => r.map((x) => String(x).trim()));
  }
  return (await f.text()).replace(/^\ufeff/, "").split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((x) => x.replace(/^"|"$/g, "").trim()));
}
$("stCsv").onchange = (e) => run(async () => {
  const c = clsOf($("stClass").value), f = e.target.files[0]; e.target.value = "";
  if (!c || !f) return flash("Choose a section first.");
  let rows = (await readTable(f)).filter((r) => r.some(Boolean));
  if (rows.length && rows[0].some((x) => /name/i.test(x))) rows = rows.slice(1); // header row
  // One column = names only. Two or more = [Exam ID No., name]; a blank ID gets an automatic one.
  const people = rows.map((r) => r.length === 1 ? { id: "", name: r[0] } : { id: r[0], name: r.slice(1).filter(Boolean).join(" ") }).filter((p) => p.name);
  const taken = new Set(S.students.map((s) => String(s.number))); let skipped = 0, auto = 0;
  const ready = people.filter((p) => { if (!p.id) return true; if (taken.has(p.id)) { skipped++; return false; } taken.add(p.id); return true; });
  const gen = nextId(taken);
  ready.forEach((p) => { if (!p.id) { p.id = gen(); auto++; } });
  for (let i = 0; i < ready.length; i += 400) {
    const b = writeBatch(db);
    ready.slice(i, i + 400).forEach((p) => b.set(doc(collection(db, "students")), { ownerUid: user.uid, classId: c.id, className: c.name, number: p.id, name: p.name, createdAt: serverTimestamp() }));
    await b.commit();
  }
  await refresh();
  flash(`Imported ${ready.length} students into ${c.name} (${ready.length - auto} with their own Exam ID No., ${auto} created automatically).` + (skipped ? ` Skipped ${skipped} whose Exam ID No. already exists.` : ""), 1);
});

/* ---------- examinations: collapsible key per number ---------- */
const D = { items: [], editId: null };
const mkItem = () => ({ type: "mc", key: "", pts: 1 });
const box = $("exItems");
$("exBulkType").innerHTML = Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
const keyName = (k) => (k === "T" ? "True" : k === "F" ? "False" : k);

function rowHTML(i, open) {
  const it = D.items[i], auto = isAuto(it.type);
  const chips = it.type === "tf" ? ["T", "F"] : it.type === "mc" ? "ABCDE".slice(0, +$("exCh").value).split("") : [];
  const label = auto ? (it.key ? "Key: " + keyName(it.key) : "No key yet") : "Teacher checks";
  const body = auto
    ? `<div><span class="lbl">Correct answer</span><div class="chips" role="group" aria-label="Correct answer for number ${i + 1}">${chips.map((c) => `<button type="button" class="chip ${it.key === c ? "on" : ""}" data-k="${c}" aria-pressed="${it.key === c}">${keyName(c)}</button>`).join("")}</div></div>`
    : `<label>${it.type === "ident" ? "Reference answer (optional, for your own checking)" : "Rubric or notes (optional)"}<input data-f="key" value="${esc(it.key)}" maxlength="200"></label>`;
  return `<details class="it" data-i="${i}" ${open ? "open" : ""}><summary class="${auto && !it.key ? "miss" : ""}"><b>${i + 1}</b><span class="tp">${TYPE_SHORT[it.type]}</span><span class="ky">${esc(label)}</span><span class="pt">${it.pts} pt${it.pts === 1 ? "" : "s"}</span></summary>
  <div class="ibody"><label>Type<select data-f="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === it.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>${body}
  <label>Points<input data-f="pts" type="number" min="0.5" max="100" step="0.5" value="${it.pts}"></label></div></details>`;
}
function drawItems() {
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => +d.dataset.i));
  box.innerHTML = D.items.map((_, i) => rowHTML(i, open.has(i))).join("");
}
function redraw(i) { const d = box.children[i]; d.outerHTML = rowHTML(i, d.open); }
function setType(i, t) { const it = D.items[i]; if (it.type !== t && (isAuto(it.type) || isAuto(t))) it.key = ""; it.type = t; }
function resize(n) {
  n = Math.max(1, Math.min(MAX_ITEMS, Math.floor(+n) || 1)); $("exN").value = n;
  while (D.items.length < n) D.items.push(mkItem()); D.items.length = n; drawItems();
}
$("exN").onchange = () => resize($("exN").value);
$("exCh").onchange = () => { D.items.forEach((it) => { if (it.type === "mc" && it.key && !"ABCDE".slice(0, +$("exCh").value).includes(it.key)) it.key = ""; }); drawItems(); };
$("exOpenAll").onclick = () => box.querySelectorAll("details").forEach((d) => (d.open = true));
$("exCloseAll").onclick = () => box.querySelectorAll("details").forEach((d) => (d.open = false));
$("exBulk").onclick = () => {
  const a = +$("exFrom").value, b = +$("exTo").value, t = $("exBulkType").value;
  if (!(a >= 1 && b >= a && b <= D.items.length)) return flash(`Enter a range between 1 and ${D.items.length}.`);
  for (let i = a - 1; i < b; i++) setType(i, t);
  drawItems(); flash(`Items ${a} to ${b} are now ${TYPE_SHORT[t]}.`, 1);
};
box.addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (!c) return;
  const i = +c.closest("details").dataset.i, it = D.items[i];
  it.key = it.key === c.dataset.k ? "" : c.dataset.k; redraw(i);
  if (it.key && $("exAuto").checked) {
    box.children[i].open = false; const nx = box.children[i + 1];
    if (nx) { nx.open = true; nx.scrollIntoView({ block: "nearest", behavior: "smooth" }); nx.querySelector(".chip")?.focus(); }
  } else box.children[i].querySelector(".chip.on, .chip")?.focus();
});
box.addEventListener("change", (e) => {
  const f = e.target.dataset.f, d = e.target.closest("details"); if (!f || !d) return; const i = +d.dataset.i;
  if (f === "type") { setType(i, e.target.value); redraw(i); box.children[i].querySelector("select")?.focus(); }
});
box.addEventListener("input", (e) => {
  const f = e.target.dataset.f, d = e.target.closest("details"); if (!f || !d) return; const i = +d.dataset.i, it = D.items[i];
  if (f === "pts") { it.pts = Math.max(0.5, Math.min(100, +e.target.value || 1)); d.querySelector(".pt").textContent = `${it.pts} pt${it.pts === 1 ? "" : "s"}`; }
  if (f === "key") it.key = e.target.value;
});

function resetBuilder() {
  D.editId = null; D.items = []; ["exTitle", "exSub", "exDate"].forEach((i) => ($(i).value = "")); $("exPass").value = 75; $("exCh").value = 5;
  $("exHead").textContent = "New examination"; $("exAdd").textContent = "Save exam"; $("exCancel").hidden = true; resize(20);
}
$("exCancel").onclick = resetBuilder;
$("exTbl").onclick = (e) => {
  const b = e.target.closest("[data-edit]"); if (!b) return; const ex = examOf(b.dataset.edit); if (!ex) return;
  D.editId = ex.id; D.items = itemsOf(ex).map((x) => ({ ...x }));
  $("exTitle").value = ex.title; $("exSub").value = ex.subject || ""; $("exClass").value = ex.classId || ""; $("exDate").value = ex.date || "";
  $("exCh").value = ex.choices || 5; $("exPass").value = ex.passing || 75; $("exN").value = D.items.length; drawItems();
  $("exHead").textContent = "Edit examination"; $("exAdd").textContent = "Update exam"; $("exCancel").hidden = false; scrollTo({ top: 0, behavior: "smooth" });
  flash("Editing. Saved results are re-scored automatically with the new key.", 1);
};
$("exAdd").onclick = () => run(async () => {
  const c = clsOf($("exClass").value), title = $("exTitle").value.trim();
  if (!title) return flash("Enter a title for the examination.");
  const missing = D.items.map((it, i) => (isAuto(it.type) && !it.key ? i : -1)).filter((i) => i >= 0);
  if (missing.length) {
    missing.forEach((i) => (box.children[i].open = true)); box.children[missing[0]].scrollIntoView({ block: "center", behavior: "smooth" });
    return flash(`Choose the correct answer for number ${missing.length > 8 ? missing.slice(0, 8).map((i) => i + 1).join(", ") + "..." : missing.map((i) => i + 1).join(", ")}.`);
  }
  const items = D.items.map((x) => ({ type: x.type, key: isAuto(x.type) ? x.key : String(x.key || "").trim(), pts: +x.pts > 0 ? +x.pts : 1 }));
  const data = { title, subject: $("exSub").value.trim(), classId: c ? c.id : "", className: c ? c.name : "All sections", date: $("exDate").value,
    n: items.length, choices: +$("exCh").value, passing: +$("exPass").value || 75, items, totalPts: items.reduce((a, b) => a + b.pts, 0) };
  if (D.editId) await updateDoc(doc(db, "examinations", D.editId), { ...data, key: deleteField(), updatedAt: serverTimestamp() });
  else await addDoc(collection(db, "examinations"), { ownerUid: user.uid, ...data, createdAt: serverTimestamp() });
  const was = D.editId; resetBuilder(); await refresh(); flash(was ? "Examination updated." : "Examination saved.", 1);
});
resetBuilder();

/* ---------- answer sheets: 8.5 x 13 in landscape, two per page ---------- */
$("school").value = store.get("ark.school"); $("teacher").value = store.get("ark.teacher") || profile.displayName;
function drawSheet() {
  const ex = examOf($("shExam").value), f = $("shFor").value; $("shCopiesL").hidden = f !== "blank";
  if (!ex) { $("sheetWrap").innerHTML = "<p class='muted'>Create an examination first.</p>"; $("shInfo").textContent = ""; return; }
  if (itemsOf(ex).length > MAX_ITEMS) { $("sheetWrap").innerHTML = `<p class='muted'>This sheet holds up to ${MAX_ITEMS} items.</p>`; return; }
  const list = f === "blank" ? Array.from({ length: Math.max(1, Math.min(500, +$("shCopies").value || 2)) }, () => null) : S.students.filter((s) => s.classId === f).sort(byName);
  const o = { school: $("school").value.trim(), teacher: $("teacher").value.trim() };
  let html = "";
  for (let i = 0; i < list.length; i += 2)
    html += `<div class="page"><div class="half">${sheetSVG(ex, { ...o, student: list[i] })}</div><div class="half">${i + 1 < list.length ? sheetSVG(ex, { ...o, student: list[i + 1] }) : ""}</div></div>`;
  $("sheetWrap").innerHTML = html || "<p class='muted'>This section has no students yet. Add students first.</p>";
  $("shInfo").textContent = list.length ? `${list.length} answer sheet${list.length === 1 ? "" : "s"} on ${Math.ceil(list.length / 2)} page${list.length > 2 ? "s" : ""}.` : "";
}
["shExam", "shFor", "shCopies", "school", "teacher"].forEach((i) => $(i).addEventListener("input", () => { if (i === "school") store.set("ark.school", $(i).value); if (i === "teacher") store.set("ark.teacher", $(i).value); drawSheet(); }));
const setPage = (css) => ($("pg").textContent = css);
$("shPrint").onclick = () => { drawSheet(); if (!$("sheetWrap").querySelector(".page")) return flash("Nothing to print yet."); setPage("@page{size:13in 8.5in;margin:0}"); print(); };
addEventListener("afterprint", () => setPage("@page{margin:10mm}"));

/* ---------- scanner ---------- */
let stream, R = null; // R = the sheet being reviewed {ex, items, answers, manual, flags}
$("camBtn").onclick = async () => {
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
    $("vid").srcObject = stream; $("vid").hidden = false; $("capBtn").disabled = false;
  } catch { flash("Camera unavailable. Allow camera access (HTTPS is required) or upload a photo."); }
};
$("capBtn").onclick = () => grab($("vid"), $("vid").videoWidth, $("vid").videoHeight);
$("file").onchange = (e) => { const f = e.target.files[0]; if (!f) return; const im = new Image(); im.onload = () => grab(im, im.naturalWidth, im.naturalHeight); im.src = URL.createObjectURL(f); e.target.value = ""; };
$("scExam").onchange = () => { const ex = examOf($("scExam").value); if (ex?.classId) $("scSec").value = ex.classId; fillStudents(); };
$("scSec").onchange = () => fillStudents($("scStu").value);

function grab(src, w0, h0) {
  const ex = examOf($("scExam").value); if (!ex) return flash("Choose an examination first.");
  if (!w0) return flash("The camera is not ready yet.");
  const k = Math.min(1, 1400 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k), cv = $("cv");
  cv.width = w; cv.height = h; const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8ClampedArray(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  cv.hidden = false; const r = scanSheet(g, w, h, ex, ctx);
  if (r.err) { $("review").hidden = true; return flash(r.err); }
  const items = itemsOf(ex);
  R = { ex, items, answers: r.answers, manual: items.map(() => null), flags: r.flags };
  $("reviewNote").hidden = true; $("review").hidden = false; $("scId").value = ""; $("scHint").textContent = ""; fillStudents(); drawReview();
  if (r.flags.some(Boolean)) flash("Some answers are uncertain (highlighted). Check them against the paper before saving.");
  else if (items.some((i) => !isAuto(i.type))) flash("Scanned. Now mark the identification and essay items below.", 1);
}
function fillStudents(keepId) {
  const sec = $("scSec").value, list = S.students.filter((s) => !sec || s.classId === sec).sort(byName);
  $("scStu").innerHTML = '<option value="">Choose student</option>' + list.map((s) => `<option value="${esc(s.id)}">${esc(s.number)} - ${esc(s.name)}${sec ? "" : " (" + esc(s.className) + ")"}</option>`).join("");
  if (keepId) $("scStu").value = keepId;
}
$("scId").addEventListener("input", () => {
  const v = $("scId").value.trim().toLowerCase(), s = v && S.students.find((x) => String(x.number).toLowerCase() === v);
  if (s) { if ($("scSec").value && $("scSec").value !== s.classId) $("scSec").value = s.classId; fillStudents(s.id); $("scHint").textContent = `${s.name}, ${s.className}`; }
  else $("scHint").textContent = v ? "No student has this Exam ID No." : "";
});

function drawReview() {
  const { ex, items, answers, manual, flags } = R;
  $("grid").innerHTML = items.map((it, i) => {
    const n = `<span class="qn">${i + 1}.</span>`, m = manual[i];
    if (isAuto(it.type)) return `<div class="${flags[i] ? "bad" : ""}">${n}<select data-i="${i}" data-k="a" aria-label="Answer ${i + 1}"><option value="">blank</option>${lettersOf(it, ex).map((c) => `<option ${answers[i] === c ? "selected" : ""}>${c}</option>`).join("")}<option value="*" ${answers[i] === "*" ? "selected" : ""}>multiple</option></select></div>`;
    if (it.type === "ident") return `<div class="man ${m == null ? "pend" : ""}">${n}<select data-i="${i}" data-k="m" aria-label="Identification ${i + 1}"><option value="">Ident: check</option><option value="1" ${m != null && m >= it.pts ? "selected" : ""}>Correct</option><option value="0" ${m === 0 ? "selected" : ""}>Wrong</option></select></div>`;
    return `<div class="man ${m == null ? "pend" : ""}">${n}<input type="number" data-i="${i}" data-k="m" min="0" max="${it.pts}" step="0.5" value="${m ?? ""}" placeholder="Essay /${it.pts}" aria-label="Essay ${i + 1} points"></div>`;
  }).join("");
  sumUp();
}
function sumUp() {
  const s = score(R.ex, R.answers, R.manual);
  $("sum").innerHTML = `<b>Score ${s.points}/${s.maxPoints} (${s.pct}%) - ${s.final ? (s.pass ? "Passed" : "Failed") : "Not final yet"}</b> &nbsp; Wrong ${s.wrong + s.multi}, blank ${s.blank}` + (s.pending ? `, <b>${s.pending} item${s.pending === 1 ? "" : "s"} still to check by you</b>` : "");
}
$("grid").addEventListener("change", (e) => {
  const t = e.target, i = +t.dataset.i; if (!t.dataset.k || Number.isNaN(i)) return;
  if (t.dataset.k === "a") { R.answers[i] = t.value; R.flags[i] = false; t.parentElement.classList.remove("bad"); }
  else { const it = R.items[i]; const v = t.value === "" ? null : t.tagName === "SELECT" ? (t.value === "1" ? it.pts : 0) : Math.min(it.pts, Math.max(0, +t.value)); R.manual[i] = v; t.parentElement.classList.toggle("pend", v === null); }
  sumUp();
});
$("scSave").onclick = () => run(async () => {
  const stu = S.students.find((s) => s.id === $("scStu").value); if (!stu) return flash("Choose the student this sheet belongs to (or type the Exam ID No.).");
  const id = `${R.ex.id}_${stu.id}`, ref = doc(db, "scanResults", id), old = await getDoc(ref);
  if (old.exists() && !confirm(`${stu.name} already has a result for this exam. Replace it?`)) return;
  const { missed, ...sc } = score(R.ex, R.answers, R.manual);
  $("scSave").disabled = true;
  try {
    await setDoc(ref, { ownerUid: user.uid, examId: R.ex.id, studentId: stu.id, studentName: stu.name, studentNumber: stu.number, classId: stu.classId, className: stu.className,
      answers: R.answers, manual: R.manual, ...sc, reviewedFlags: R.flags.filter(Boolean).length, scannedAt: serverTimestamp() });
    flash(`Saved result for ${stu.name}.`, 1); $("review").hidden = true; $("cv").hidden = true;
  } finally { $("scSave").disabled = false; }
});

/* ---------- results ---------- */
const secName = (r) => r.className || "-";
const CMP = {
  sec_name: (a, b) => secName(a).localeCompare(secName(b)) || a.studentName.localeCompare(b.studentName),
  sec_score: (a, b) => secName(a).localeCompare(secName(b)) || b.sc.pct - a.sc.pct || a.studentName.localeCompare(b.studentName),
  score: (a, b) => b.sc.pct - a.sc.pct || a.studentName.localeCompare(b.studentName),
  wrong: (a, b) => b.sc.missed.length - a.sc.missed.length || a.studentName.localeCompare(b.studentName),
  name: (a, b) => a.studentName.localeCompare(b.studentName),
  id: (a, b) => String(a.studentNumber).localeCompare(String(b.studentNumber), undefined, { numeric: true }),
};
const status = (s) => (s.final ? (s.pass ? "Pass" : "Fail") : "To check");
let VIEW = { ex: null, list: [] };

async function loadResults() {
  await run(async () => {
    const ex = examOf($("reExam").value); if (!ex) { S.results = []; return renderResults(); }
    S.results = (await load("scanResults", where("examId", "==", ex.id))).map((r) => {
      const stu = S.students.find((s) => s.id === r.studentId); // older results have no section saved
      return { ...r, classId: r.classId ?? stu?.classId ?? "", className: r.className ?? stu?.className ?? "-", sc: score(ex, r.answers || [], r.manual || []) };
    });
    renderResults();
  });
}
function renderResults() {
  const ex = examOf($("reExam").value), items = ex ? itemsOf(ex) : [];
  if (!ex) { $("reTbl").innerHTML = ""; $("stats").textContent = "Create an examination first."; $("items").innerHTML = ""; VIEW = { ex: null, list: [] }; return; }
  const ranked = [...S.results].sort((a, b) => b.sc.pct - a.sc.pct); ranked.forEach((r, i) => (r.rank = i && ranked[i - 1].sc.pct === r.sc.pct ? ranked[i - 1].rank : i + 1));
  const sec = $("reSec").value, sort = $("reSort").value;
  const list = S.results.filter((r) => !sec || r.classId === sec).sort(CMP[sort]); VIEW = { ex, list };
  const pcts = list.map((r) => r.sc.pct), avg = pcts.length ? (pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(1) : "-";
  $("stats").textContent = list.length ? `Scanned ${list.length} | Average ${avg}% | Highest ${Math.max(...pcts)}% | Lowest ${Math.min(...pcts)}% | Passed ${list.filter((r) => r.sc.pass).length}` : "No results yet for this selection.";
  const grouped = sort.startsWith("sec_"); let last = null, rows = "";
  for (const r of list) {
    if (grouped && secName(r) !== last) { last = secName(r); const g = list.filter((x) => secName(x) === last); rows += `<tr class="grp"><td colspan="9">${esc(last)} - ${g.length} student${g.length === 1 ? "" : "s"}, average ${(g.reduce((a, b) => a + b.sc.pct, 0) / g.length).toFixed(1)}%</td></tr>`; }
    const s = r.sc;
    rows += `<tr class="${s.final ? "" : "pend"}"><td>${r.rank}</td><td>${esc(r.studentNumber)}</td><td>${esc(r.studentName)}</td><td>${esc(secName(r))}</td><td>${s.points}/${s.maxPoints}</td><td>${s.pct}</td><td>${status(s)}</td>
      <td class="wrapcell">${s.missed.length ? `<b>${s.missed.length}</b> ` + s.missed.map((m) => `<span class="wr">${esc(missedText(m))}</span>`).join("") : "None"}${s.pending ? ` <span class="badge warn">${s.pending} to check</span>` : ""}</td>
      <td class="actions"><button class="btn small" data-edit="${esc(r.id)}">${s.pending ? "Check" : "Edit"}</button></td></tr>`;
  }
  $("reTbl").innerHTML = "<tr><th>Rank</th><th>Exam ID No.</th><th>Name</th><th>Section</th><th>Score</th><th>%</th><th>Status</th><th>Wrong answers (student answer → correct)</th><th></th></tr>" + (rows || "<tr><td colspan=9>No results yet.</td></tr>");
  $("items").innerHTML = items.map((it, i) => {
    const done = list.filter((r) => isAuto(it.type) || (r.manual || [])[i] != null);
    const ok = done.filter((r) => !r.sc.missed.some((m) => m.i === i)).length;
    return `<div>Q${i + 1} (${isAuto(it.type) ? esc(keyName(it.key)) : TYPE_SHORT[it.type]}): ${done.length ? Math.round((ok / done.length) * 100) + "%" : "-"}</div>`;
  }).join("");
}
["reExam"].forEach((i) => ($(i).onchange = loadResults)); ["reSec", "reSort"].forEach((i) => ($(i).onchange = renderResults));
$("reTbl").onclick = (e) => {
  const b = e.target.closest("[data-edit]"); if (!b) return; const r = S.results.find((x) => x.id === b.dataset.edit); if (!r) return;
  const ex = examOf(r.examId), items = itemsOf(ex);
  R = { ex, items, answers: items.map((_, i) => (r.answers || [])[i] ?? ""), manual: items.map((_, i) => (r.manual || [])[i] ?? null), flags: items.map(() => false) };
  show("scan"); $("scExam").value = ex.id; $("scSec").value = ""; fillStudents(r.studentId); $("scId").value = r.studentNumber; $("scHint").textContent = "";
  $("cv").hidden = true; $("review").hidden = false; $("reviewNote").hidden = false;
  $("reviewNote").textContent = `Editing the saved result of ${r.studentName}. Mark the items you check by hand, then press Save result.`; drawReview(); scrollTo({ top: 0 });
};

/* ---------- Excel download ---------- */
const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, "-").trim() || "exam";
function sheetOf(rows, widths) { const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = widths.map((w) => ({ wch: w })); return ws; }
$("xlsx").onclick = () => run(async () => {
  const { ex, list } = VIEW; if (!ex || !list.length) return flash("No results to export.");
  if (!window.XLSX) return flash("The Excel library did not load. Check your internet connection and reload the page.");
  const items = itemsOf(ex), kind = (it) => TYPE_SHORT[it.type], ans = (m) => (isAuto(m.type) ? (m.given === "" ? "(blank)" : m.given === "*" ? "(multiple)" : m.given) : m.awarded);
  const wb = XLSX.utils.book_new(), head = ["Rank", "Exam ID No.", "Name", "Section", "Points", "Max points", "Percent", "Status", "Number wrong", "Blank", "Multiple answers", "To check by teacher", "Wrong items (student answer → correct)"];
  const line = (r, rank) => [rank, r.studentNumber, r.studentName, secName(r), r.sc.points, r.sc.maxPoints, r.sc.pct, status(r.sc), r.sc.missed.length, r.sc.blank, r.sc.multi, r.sc.pending, r.sc.missed.map(missedText).join(", ")];
  const meta = [[ex.title], [`Subject: ${ex.subject || "-"}`, `Date: ${ex.date || "-"}`, `Teacher: ${profile.displayName}`, `Passing: ${ex.passing}%`], []];
  const w = [6, 14, 28, 20, 8, 10, 9, 9, 12, 7, 10, 12, 70];
  XLSX.utils.book_append_sheet(wb, sheetOf([...meta, head, ...list.map((r) => line(r, r.rank))], w), "All results");
  // Wrong answers: one row per missed item (this is the specification of where each student went wrong)
  const wrong = [["Section", "Exam ID No.", "Name", "Item no.", "Type", "Student answer", "Correct answer", "Points earned", "Points possible"]];
  list.forEach((r) => r.sc.missed.forEach((m) => wrong.push([secName(r), r.studentNumber, r.studentName, m.i + 1, kind(items[m.i]), ans(m), isAuto(m.type) ? m.key : "(teacher checked)", m.awarded, m.pts])));
  XLSX.utils.book_append_sheet(wb, sheetOf(wrong, [20, 14, 28, 9, 15, 15, 15, 12, 14]), "Wrong answers");
  // Item analysis
  const ia = [["Item no.", "Type", "Correct answer", "Points", "Students counted", "Got it right", "% correct"]];
  items.forEach((it, i) => { const done = list.filter((r) => isAuto(it.type) || (r.manual || [])[i] != null), ok = done.filter((r) => !r.sc.missed.some((m) => m.i === i)).length;
    ia.push([i + 1, kind(it), isAuto(it.type) ? it.key : "(teacher checked)", it.pts, done.length, ok, done.length ? Math.round((ok / done.length) * 1000) / 10 : ""]); });
  XLSX.utils.book_append_sheet(wb, sheetOf(ia, [9, 15, 16, 8, 16, 13, 10]), "Item analysis");
  // One sheet per section, ranked inside the section
  const used = new Set(["All results", "Wrong answers", "Item analysis"]);
  [...new Set(list.map(secName))].sort().forEach((sn) => {
    const g = list.filter((r) => secName(r) === sn).sort(CMP.score), rk = []; g.forEach((r, i) => rk.push(i && g[i - 1].sc.pct === r.sc.pct ? rk[i - 1] : i + 1)); let name = safe(sn).slice(0, 28), n = 2; while (used.has(name)) name = safe(sn).slice(0, 26) + " " + n++; used.add(name);
    XLSX.utils.book_append_sheet(wb, sheetOf([[ex.title + " - " + sn], [], head, ...g.map((r, i) => line(r, rk[i]))], w), name);
  });
  XLSX.writeFile(wb, `${safe(ex.title)}-results.xlsx`);
});

show("classes");
refresh();
