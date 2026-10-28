import { requireRole, logout, db, esc, friendlyError, ageOf, applyBranding } from "./auth.js";
import { collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { TERMS, termRank } from "./omr.js";

const $ = (id) => document.getElementById(id);
const { user, profile, school } = await requireRole(["registrar"]);
const SID = profile.schoolId;
$("who").textContent = profile.displayName + " (Registrar)"; $("out").onclick = logout;
applyBranding(school);

const flash = (t, ok) => { const m = $("msg"); m.textContent = t; m.className = "notice noprint " + (ok ? "ok" : "err"); m.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => (m.hidden = true), 9000); scrollTo({ top: 0, behavior: "smooth" }); };
const net = () => { $("sync").className = "sync" + (navigator.onLine ? "" : " off"); $("sync").lastElementChild.textContent = navigator.onLine ? "Online" : "Offline - changes will not save"; };
addEventListener("online", net); addEventListener("offline", net); net();
const run = async (fn) => { try { await fn(); } catch (e) { console.error(e); flash(friendlyError(e)); } };

/* ---------- constants and helpers ---------- */
const GRADES = ["Kindergarten", ...Array.from({ length: 12 }, (_, i) => "Grade " + (i + 1))];
const DEFAULT_VOUCHERS = ["PUB", "ALS", "ESC"];
const DEFAULT_STRANDS = ["STEM", "ABM", "HUMSS", "GAS", "TVL"];
const schoolYearNow = () => { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 5 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };
const rid = (no) => `${SID}_${String(no).trim()}`;
const nameOf = (p) => `${p.lastName}, ${p.firstName}${p.middleName ? " " + p.middleName : ""}${p.suffix ? " " + p.suffix : ""}`;
const bd = (b) => (b ? new Date(b + "T00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-");
const options = (list, first) => (first !== undefined ? `<option value="">${esc(first)}</option>` : "") + list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
const keep = (id, html) => { const el = $(id), v = el.value; el.innerHTML = html; if ([...el.options].some((o) => o.value === v)) el.value = v; };
const isLrn = (s) => /^\d{12}$/.test(s);
const isStuNo = (s) => /^[A-Za-z0-9._-]{1,30}$/.test(s);
const normGender = (g) => (/^\s*m/i.test(g) ? "Male" : /^\s*f/i.test(g) ? "Female" : "");
const tsec = (x) => x?.createdAt?.seconds || 0;

/* ---------- data ---------- */
const S = { registry: [], sections: [], teachers: [], enrollments: [], vouchers: [...DEFAULT_VOUCHERS], strands: [...DEFAULT_STRANDS] };
const bySchool = async (c, ...w) => (await getDocs(query(collection(db, c), where("schoolId", "==", SID), ...w))).docs.map((d) => ({ id: d.id, ...d.data() }));
async function refresh() {
  await run(async () => {
    const [reg, cls, ens, tch, set] = await Promise.all([
      bySchool("registry"), bySchool("classes"), bySchool("enrollmentRecords"),
      getDocs(query(collection(db, "users"), where("schoolId", "==", SID), where("role", "==", "teacher"))),
      getDoc(doc(db, "registrarSettings", SID)).catch(() => null),
    ]);
    S.registry = reg.sort((a, b) => a.name.localeCompare(b.name));
    S.sections = cls.filter((c) => c.gradeLevel).sort((a, b) => a.name.localeCompare(b.name));
    S.enrollments = ens;
    S.teachers = tch.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((t) => t.status === "active").sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
    if (set && set.exists()) { S.vouchers = set.data().voucherTypes || S.vouchers; S.strands = set.data().strands || S.strands; }
    render();
  });
}
const saveSettings = () => setDoc(doc(db, "registrarSettings", SID), { schoolId: SID, voucherTypes: S.vouchers, strands: S.strands, updatedAt: serverTimestamp() }, { merge: true });

/* ---------- navigation ---------- */
function show(t) {
  document.querySelectorAll("[data-s]").forEach((s) => (s.hidden = s.dataset.s !== t));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
}
$("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.t); };
show("reg");

/* ---------- rendering ---------- */
function render() {
  const noneV = "- none -", noneS = "- none / not applicable -";
  keep("rgGrade", options(GRADES)); keep("rgVoucher", options(S.vouchers, noneV));
  keep("enGrade", options(GRADES)); keep("enTerm", options(TERMS)); keep("enStrand", options(S.strands, noneS));
  keep("scGrade", options(GRADES)); keep("scStrand", options(S.strands, noneS)); keep("scFilter", options(GRADES, "All grade levels"));
  keep("mlGrade", options(GRADES, "All grade levels")); keep("mlVoucher", options(S.vouchers, "All voucher types"));
  keep("scAdv", S.teachers.map((t) => `<option value="${esc(t.uid)}">${esc(t.displayName)} (${esc(t.employeeId || "")})</option>`).join("") || `<option value="">No teacher accounts yet - ask the IT Admin</option>`);
  if (!$("enYear").value) $("enYear").value = schoolYearNow();
  renderVoucherStrand(); renderMaster(); renderEnrollPicker(); renderSections(); renderEnrolled();
}

/* ======================= STUDENT REGISTRATION ======================= */
const F = { no: "rgNo", lrn: "rgLrn", last: "rgLast", first: "rgFirst", middle: "rgMiddle", suffix: "rgSuffix", bday: "rgBday", contact: "rgContact", address: "rgAddress",
  father: "rgFather", mother: "rgMother", guardian: "rgGuardian", gcontact: "rgGContact", gaddress: "rgGAddress" };
let editing = null;
$("rgBday").oninput = () => ($("rgAge").value = ageOf($("rgBday").value));
function clearForm() {
  editing = null; Object.values(F).forEach((i) => ($(i).value = "")); $("rgAge").value = ""; $("rgGender").value = ""; $("rgVoucher").value = "";
  $("rgNo").readOnly = false; $("rgHead").textContent = "Student registration"; $("rgSave").textContent = "Save registration"; $("rgCancel").hidden = true;
}
$("rgCancel").onclick = clearForm;
function fillForm(r) {
  editing = r.id; $("rgGrade").value = r.gradeLevel || GRADES[0]; $("rgVoucher").value = r.voucherType || "";
  $(F.no).value = r.studentNo; $(F.lrn).value = r.lrn || ""; $(F.last).value = r.lastName; $(F.first).value = r.firstName; $(F.middle).value = r.middleName || ""; $(F.suffix).value = r.suffix || "";
  $(F.bday).value = r.birthday || ""; $("rgAge").value = ageOf(r.birthday); $("rgGender").value = r.gender || ""; $(F.contact).value = r.contact || ""; $(F.address).value = r.address || "";
  $(F.father).value = r.father || ""; $(F.mother).value = r.mother || ""; $(F.guardian).value = r.guardianName || ""; $(F.gcontact).value = r.guardianContact || ""; $(F.gaddress).value = r.guardianAddress || "";
  $("rgNo").readOnly = true; $("rgHead").textContent = `Edit registration - ${r.name}`; $("rgSave").textContent = "Save changes"; $("rgCancel").hidden = false;
  show("reg"); scrollTo({ top: 0 });
}
/** Keeps the teacher-visible student record (name, birthday, gender) in step with the master list. */
async function syncStudent(r) {
  if (!r.examNo) return;
  await updateDoc(doc(db, "students", r.examNo), { lastName: r.lastName, firstName: r.firstName, middleInitial: (r.middleName || "").slice(0, 1).toUpperCase(), name: r.name,
    birthday: r.birthday || "", gender: r.gender || "", lrn: r.lrn || "", studentNo: r.studentNo, updatedAt: serverTimestamp() }).catch(() => {});
}
$("rgSave").onclick = () => run(async () => {
  const v = (k) => $(F[k]).value.trim();
  const p = { gradeLevel: $("rgGrade").value, studentNo: v("no"), lrn: v("lrn").replace(/\s+/g, ""), voucherType: $("rgVoucher").value,
    lastName: v("last"), firstName: v("first"), middleName: v("middle"), suffix: v("suffix"), birthday: $(F.bday).value, gender: $("rgGender").value,
    contact: v("contact"), address: v("address"), father: v("father"), mother: v("mother"), guardianName: v("guardian"), guardianContact: v("gcontact"), guardianAddress: v("gaddress") };
  if (!p.studentNo || !isStuNo(p.studentNo)) return flash("Enter the Student ID No. (letters, numbers, dot, dash or underscore only).");
  if (p.lrn && !isLrn(p.lrn)) return flash("The LRN must be exactly 12 digits. Leave it blank if the student has no LRN yet.");
  if (!p.lastName || !p.firstName) return flash("Enter the last name and first name.");
  if (!p.birthday) return flash("Enter the birthdate (it gives the age and is used for the student's first password).");
  if (!p.gender) return flash("Choose the gender.");
  if (!p.father && !p.mother && !p.guardianName) return flash("Enter the father's name, the mother's name, or the guardian's name if there is neither.");
  const id = rid(p.studentNo), old = S.registry.find((r) => r.id === id);
  if (!editing && old) return flash(`Student ID No. ${p.studentNo} is already registered (${old.name}).`);
  if (p.lrn && S.registry.some((r) => r.lrn === p.lrn && r.id !== id)) return flash("Another student already has that LRN.");
  p.name = nameOf(p);
  const rec = { ...p, ...(old ? {} : { schoolId: SID, createdBy: user.uid, createdAt: serverTimestamp() }), updatedAt: serverTimestamp() };
  await setDoc(doc(db, "registry", id), rec, { merge: true });
  const merged = { ...(old || {}), ...p, id }; await syncStudent(merged);
  const was = editing; clearForm(); await refresh();
  flash(was ? `Saved changes for ${p.name}.` : `Registered ${p.name}. Next: enroll the student in a section.` , true);
  if (old?.examNo && p.lrn && old.examNo !== p.lrn) flash(`Saved. The Exam ID No. stays ${old.examNo} because the student is already enrolled; it is not changed afterwards.`, true);
});

/* ======================= MASTER LIST ======================= */
function latestEnrol(r) {
  return S.enrollments.filter((e) => e.registryId === r.id).sort((a, b) => (b.schoolYear || "").localeCompare(a.schoolYear || "") || termRank(b.term) - termRank(a.term) || tsec(b) - tsec(a))[0];
}
function renderMaster() {
  const q = $("mlQ").value.trim().toLowerCase(), g = $("mlGrade").value, vt = $("mlVoucher").value;
  const rows = S.registry.filter((r) => (!g || r.gradeLevel === g) && (!vt || r.voucherType === vt) && (!q || [r.studentNo, r.lrn, r.name].join(" ").toLowerCase().includes(q)));
  $("mlCount").textContent = `${rows.length} of ${S.registry.length} registered students`;
  $("mlTbl").innerHTML = "<tr><th>Student ID No.</th><th>LRN</th><th>Name</th><th>Grade</th><th>Voucher</th><th>Birthdate</th><th>Age</th><th>Gender</th><th>Contact</th><th>Enrolled in</th><th></th></tr>" +
    (rows.slice(0, 300).map((r) => { const e = latestEnrol(r);
      return `<tr><td>${esc(r.studentNo)}</td><td>${esc(r.lrn || "-")}</td><td>${esc(r.name)}</td><td>${esc(r.gradeLevel || "")}</td><td>${esc(r.voucherType || "-")}</td><td>${esc(bd(r.birthday))}</td><td>${ageOf(r.birthday)}</td><td>${esc(r.gender || "")}</td><td>${esc(r.contact || "")}</td>
      <td>${e ? esc(e.sectionName) + `<small>${esc(e.term)} ${esc(e.schoolYear || "")}</small>` : '<span class="badge warn">Not enrolled</span>'}</td>
      <td class="actions"><button class="btn small" data-ed="${esc(r.id)}">Edit</button><button class="btn small" data-en="${esc(r.id)}">Enroll</button><button class="btn small danger" data-rm="${esc(r.id)}">Delete</button></td></tr>`; }).join("") ||
      `<tr><td colspan="11">No students found.</td></tr>`) + (rows.length > 300 ? `<tr><td colspan="11">Showing the first 300. Narrow the search to see the rest.</td></tr>` : "");
}
["mlQ", "mlGrade", "mlVoucher"].forEach((i) => ($(i).oninput = renderMaster));
$("mlTbl").onclick = (e) => run(async () => {
  const b = e.target.closest("[data-ed],[data-en],[data-rm]"); if (!b) return;
  const r = S.registry.find((x) => x.id === (b.dataset.ed || b.dataset.en || b.dataset.rm)); if (!r) return;
  if (b.dataset.ed) return fillForm(r);
  if (b.dataset.en) { show("enroll"); $("enQ").value = r.studentNo; renderEnrollPicker(r.id); return; }
  if (r.examNo) { // an activated student account must be removed by the IT Admin
    let acc = false; try { const s = await getDoc(doc(db, "students", r.examNo)); acc = s.exists() && !!s.data().accountUid; } catch { /* no record */ }
    if (acc) return flash(`${r.name} already has an active account. Ask the IT Admin to remove the account first, then delete the registration.`);
  }
  if (!confirm(`Delete ${r.name} (${r.studentNo}) from the master list, with all of their enrollment records?`)) return;
  for (const en of S.enrollments.filter((x) => x.registryId === r.id)) await deleteDoc(doc(db, "enrollmentRecords", en.id));
  if (r.examNo) await deleteDoc(doc(db, "students", r.examNo)).catch(() => {});
  await deleteDoc(doc(db, "registry", r.id)); await refresh(); flash(`${r.name} was deleted.`, true);
});
$("mlXlsx").onclick = () => {
  if (!window.XLSX) return flash("The Excel writer did not load. Check your internet connection.");
  const rows = S.registry.map((r) => ({ "Student ID No.": r.studentNo, LRN: r.lrn || "", "Voucher Type": r.voucherType || "", "Last Name": r.lastName, "First Name": r.firstName, "Middle Name": r.middleName || "", Suffix: r.suffix || "",
    Birthdate: r.birthday || "", Age: ageOf(r.birthday), Gender: r.gender || "", "Contact No.": r.contact || "", Address: r.address || "", "Father's Name": r.father || "", "Mother's Name": r.mother || "",
    "Guardian Name": r.guardianName || "", "Guardian Contact No.": r.guardianContact || "", "Guardian Address": r.guardianAddress || "", "Grade Level": r.gradeLevel || "" }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Master list"); XLSX.writeFile(wb, `master-list-${SID}.xlsx`);
};
$("mlTpl").onclick = () => {
  const head = ["Student ID No.", "LRN", "Voucher Type", "Last Name", "First Name", "Middle Name", "Suffix", "Birthdate", "Gender", "Contact No.", "Address", "Father's Name", "Mother's Name", "Guardian Name", "Guardian Contact No.", "Guardian Address", "Grade Level"];
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["\ufeff" + head.join(",") + "\n"], { type: "text/csv" })), download: "master-list-template.csv" });
  a.click(); URL.revokeObjectURL(a.href);
};

/* ======================= SETTINGS ======================= */
function renderVoucherStrand() {
  const tag = (kind, v) => `<span class="tag">${esc(v)}<button type="button" data-kind="${kind}" data-v="${esc(v)}" aria-label="Remove ${esc(v)}">&times;</button></span>`;
  $("vtList").innerHTML = S.vouchers.map((v) => tag("v", v)).join("") || '<span class="muted">None yet.</span>';
  $("stList").innerHTML = S.strands.map((v) => tag("s", v)).join("") || '<span class="muted">None yet.</span>';
}
const addTo = (arr, val) => { val = val.trim(); if (!val) return false; if (arr.some((x) => x.toLowerCase() === val.toLowerCase())) return false; arr.push(val); return true; };
$("vtAdd").onclick = () => run(async () => { if (!addTo(S.vouchers, $("vtNew").value.toUpperCase())) return flash("Enter a new voucher type."); $("vtNew").value = ""; await saveSettings(); render(); flash("Voucher type added.", 1); });
$("stAdd").onclick = () => run(async () => { if (!addTo(S.strands, $("stNew").value)) return flash("Enter a new cluster / strand."); $("stNew").value = ""; await saveSettings(); render(); flash("Cluster / strand added.", 1); });
document.querySelector('[data-s="settings"]').onclick = (e) => run(async () => {
  const b = e.target.closest("button[data-kind]"); if (!b) return;
  const arr = b.dataset.kind === "v" ? S.vouchers : S.strands, i = arr.indexOf(b.dataset.v); if (i < 0) return;
  if (!confirm(`Remove "${b.dataset.v}" from the list? Students already saved with it keep it.`)) return;
  arr.splice(i, 1); await saveSettings(); render();
});

/* ======================= SECTIONS & ADVISERS ======================= */
const teacherOf = (uid) => S.teachers.find((t) => t.uid === uid);
const secName = (g, st, n) => [g, st, n].filter(Boolean).join(" - ");
const studentsIn = (sec) => new Set(S.enrollments.filter((e) => e.sectionId === sec.id).map((e) => e.registryId)).size;
$("scAdd").onclick = () => run(async () => {
  const grade = $("scGrade").value, strand = $("scStrand").value, sn = $("scName").value.trim(), adv = teacherOf($("scAdv").value);
  if (!sn) return flash("Enter the section name."); if (!adv) return flash("Choose the adviser from the teacher accounts.");
  const name = secName(grade, strand, sn);
  if (S.sections.some((s) => s.name.toLowerCase() === name.toLowerCase())) return flash("That section already exists.");
  await setDoc(doc(collection(db, "classes")), { ownerUid: adv.uid, schoolId: SID, name, gradeLevel: grade, strand, sectionName: sn, adviserName: adv.displayName, code: "", createdBy: user.uid, createdAt: serverTimestamp() });
  $("scName").value = ""; await refresh(); flash(`Section added. Adviser: ${adv.displayName}.`, 1);
});
function renderSections() {
  const f = $("scFilter").value, list = S.sections.filter((s) => !f || s.gradeLevel === f);
  $("scTbl").innerHTML = "<tr><th>Section</th><th>Grade</th><th>Cluster / strand</th><th>Adviser</th><th>Students</th><th></th></tr>" +
    (list.map((s) => `<tr><td>${esc(s.sectionName || s.name)}</td><td>${esc(s.gradeLevel)}</td><td>${esc(s.strand || "-")}</td>
      <td><select data-adv="${esc(s.id)}" aria-label="Adviser of ${esc(s.name)}">${S.teachers.some((t) => t.uid === s.ownerUid) ? "" : `<option value="${esc(s.ownerUid)}" selected>${esc(s.adviserName || "(unknown)")}</option>`}${S.teachers.map((t) => `<option value="${esc(t.uid)}" ${t.uid === s.ownerUid ? "selected" : ""}>${esc(t.displayName)}</option>`).join("")}</select></td>
      <td>${studentsIn(s)}</td><td class="actions"><button class="btn small" data-view="${esc(s.id)}">View students</button><button class="btn small danger" data-del="${esc(s.id)}">Delete</button></td></tr>`).join("") || `<tr><td colspan="6">No sections yet.</td></tr>`);
  if (viewSec) renderSectionView();
}
$("scFilter").onchange = renderSections;
let viewSec = "";
function renderSectionView() {
  const s = S.sections.find((x) => x.id === viewSec); $("scViewBox").hidden = !s; if (!s) return;
  const list = S.enrollments.filter((e) => e.sectionId === s.id).sort((a, b) => a.name.localeCompare(b.name));
  $("scViewHead").textContent = `${s.name} - adviser ${s.adviserName || ""}`;
  $("scView").innerHTML = "<tr><th>Student ID No.</th><th>LRN</th><th>Name</th><th>Term / quarter</th><th>School year</th><th></th></tr>" +
    (list.map((e) => `<tr><td>${esc(e.studentNo)}</td><td>${esc(e.lrn || "-")}</td><td>${esc(e.name)}</td><td>${esc(e.term)}</td><td>${esc(e.schoolYear || "")}</td><td class="actions"><button class="btn small danger" data-unen="${esc(e.id)}">Remove</button></td></tr>`).join("") || `<tr><td colspan="6">No students enrolled yet.</td></tr>`);
}
$("scTbl").onchange = (e) => run(async () => {
  const sel = e.target.closest("[data-adv]"); if (!sel) return;
  const s = S.sections.find((x) => x.id === sel.dataset.adv), t = teacherOf(sel.value); if (!s || !t || t.uid === s.ownerUid) return;
  if (!confirm(`Make ${t.displayName} the adviser of ${s.name}? The students of this section move to ${t.displayName}'s Teacher page, and the section's classroom code is cleared (the new adviser creates a new one).`)) { sel.value = s.ownerUid; return; }
  if (s.code) await deleteDoc(doc(db, "classCodes", s.code)).catch(() => {});
  const studs = (await getDocs(query(collection(db, "students"), where("schoolId", "==", SID), where("classId", "==", s.id)))).docs;
  const first = writeBatch(db); first.update(doc(db, "classes", s.id), { ownerUid: t.uid, adviserName: t.displayName, code: "", updatedAt: serverTimestamp() });
  await first.commit();
  for (let i = 0; i < studs.length; i += 400) { const b = writeBatch(db); studs.slice(i, i + 400).forEach((d) => b.update(d.ref, { ownerUid: t.uid, updatedAt: serverTimestamp() })); await b.commit(); }
  await refresh(); flash(`${t.displayName} is now the adviser of ${s.name} (${studs.length} student${studs.length === 1 ? "" : "s"} moved).`, 1);
});
$("scTbl").onclick = (e) => run(async () => {
  const v = e.target.closest("[data-view]"); if (v) { viewSec = v.dataset.view; renderSectionView(); $("scViewBox").scrollIntoView({ behavior: "smooth" }); return; }
  const d = e.target.closest("[data-del]"); if (!d) return;
  const s = S.sections.find((x) => x.id === d.dataset.del); if (!s) return;
  if (studentsIn(s)) return flash("This section still has enrolled students. Remove or move them first.");
  if (!confirm(`Delete the section ${s.name}?`)) return;
  if (s.code) await deleteDoc(doc(db, "classCodes", s.code)).catch(() => {});
  await deleteDoc(doc(db, "classes", s.id)); if (viewSec === s.id) viewSec = ""; await refresh(); flash("Section deleted.", 1);
});
$("scView").onclick = (e) => run(async () => { const b = e.target.closest("[data-unen]"); if (b) await unenroll(b.dataset.unen); });

/* ======================= ENROLLMENT ======================= */
let picked = "";
function renderEnrollPicker(select) {
  const q = $("enQ").value.trim().toLowerCase();
  const rows = S.registry.filter((r) => !q || [r.studentNo, r.lrn, r.name].join(" ").toLowerCase().includes(q)).slice(0, 60);
  keep("enStu", rows.map((r) => `<option value="${esc(r.id)}">${esc(r.studentNo)} - ${esc(r.name)}${r.lrn ? " (LRN " + esc(r.lrn) + ")" : ""}</option>`).join("") || `<option value="">No registered student found</option>`);
  if (select && rows.some((r) => r.id === select)) $("enStu").value = select;
  const r = S.registry.find((x) => x.id === $("enStu").value);
  if (r && r.id !== picked) { picked = r.id; if (r.gradeLevel) $("enGrade").value = r.gradeLevel; }
  const examNo = r ? (r.examNo || r.lrn || r.studentNo) : "";
  $("enInfo").hidden = !r;
  if (r) $("enInfo").innerHTML = [["Name", r.name], ["Student ID No.", r.studentNo], ["LRN", r.lrn || "- (none yet)"], ["Birthdate", bd(r.birthday)], ["Age", ageOf(r.birthday)], ["Gender", r.gender || "-"], ["Voucher", r.voucherType || "-"],
    ["Exam ID No. (login)", examNo + (r.lrn || r.examNo ? "" : " (Student ID, until an LRN is available)")]].map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("");
  const g = $("enGrade").value, st = $("enStrand").value, secs = S.sections.filter((s) => s.gradeLevel === g && (s.strand || "") === st);
  keep("enSection", secs.map((s) => `<option value="${esc(s.id)}">${esc(s.sectionName || s.name)} - ${esc(s.adviserName || "")}</option>`).join("") || `<option value="">No section for this grade / strand</option>`);
  $("enSecHint").textContent = secs.length ? "" : "Add the section first under Sections & advisers.";
  renderEnrolled();
}
$("enQ").oninput = () => renderEnrollPicker();
["enStu", "enGrade", "enStrand", "enTerm", "enYear", "enSection"].forEach((i) => ($(i).onchange = () => renderEnrollPicker()));
function ctx() {
  const section = S.sections.find((s) => s.id === $("enSection").value), year = $("enYear").value.trim();
  if (!section) throw new Error("Choose a section. If the list is empty, add the section first under Sections & advisers.");
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("Enter the school year like 2026-2027.");
  return { section, gradeLevel: $("enGrade").value, term: $("enTerm").value, schoolYear: year, strand: $("enStrand").value };
}
/** One enrollment: the student's teacher-visible record (under the section's adviser), the enrollment record and the master list, in ONE all-or-nothing write.
 *  Exam ID No. = LRN, or the Student ID No. if there is no LRN yet; once set it never changes. */
async function enrollOne(r, c) {
  const examNo = r.examNo || r.lrn || r.studentNo, sec = c.section;
  if (S.registry.some((x) => x.id !== r.id && (x.examNo || x.lrn || x.studentNo) === examNo)) throw new Error(`${r.name}: the Exam ID No. ${examNo} belongs to another student.`);
  const b = writeBatch(db), eid = `${r.id}_${c.schoolYear}_${c.term}`.replace(/[\s/]+/g, "-");
  b.set(doc(db, "students", examNo), { ownerUid: sec.ownerUid, schoolId: SID, classId: sec.id, className: sec.name, number: examNo, lastName: r.lastName, firstName: r.firstName,
    middleInitial: (r.middleName || "").slice(0, 1).toUpperCase(), name: r.name, birthday: r.birthday || "", gender: r.gender || "", lrn: r.lrn || "", studentNo: r.studentNo, registryId: r.id,
    gradeLevel: c.gradeLevel, strand: c.strand || "", updatedAt: serverTimestamp(), ...(r.examNo ? {} : { createdAt: serverTimestamp() }) }, { merge: true });
  b.set(doc(db, "enrollmentRecords", eid), { schoolId: SID, registryId: r.id, studentNo: r.studentNo, lrn: r.lrn || "", examNo, name: r.name, birthday: r.birthday || "", gender: r.gender || "",
    gradeLevel: c.gradeLevel, term: c.term, schoolYear: c.schoolYear, strand: c.strand || "", sectionId: sec.id, sectionName: sec.name, adviserUid: sec.ownerUid, adviserName: sec.adviserName || "",
    createdBy: user.uid, createdAt: serverTimestamp() });
  b.update(doc(db, "registry", r.id), { examNo, gradeLevel: c.gradeLevel, updatedAt: serverTimestamp() });
  try { await b.commit(); }
  catch (e) { if (e.code === "permission-denied") throw new Error(`${r.name}: the Exam ID No. ${examNo} is already used by a student of another school, or you do not have permission.`); throw e; }
  r.examNo = examNo; r.gradeLevel = c.gradeLevel;
}
$("enSave").onclick = () => run(async () => {
  const r = S.registry.find((x) => x.id === $("enStu").value); if (!r) return flash("Find and choose a registered student first.");
  const c = ctx(); await enrollOne(r, c); await refresh();
  flash(`${r.name} is enrolled in ${c.section.name} (${c.term}, ${c.schoolYear}). Adviser ${c.section.adviserName || ""} can now activate the account. Exam ID No.: ${r.examNo}.`, 1);
});
function renderEnrolled() {
  const sec = $("enSection").value, term = $("enTerm").value, year = $("enYear").value.trim();
  const list = S.enrollments.filter((e) => e.sectionId === sec && e.term === term && e.schoolYear === year).sort((a, b) => a.name.localeCompare(b.name));
  $("enTbl").innerHTML = "<tr><th>Student ID No.</th><th>LRN</th><th>Name</th><th>Birthdate</th><th>Age</th><th>Gender</th></tr>" +
    (list.map((e) => `<tr><td>${esc(e.studentNo)}</td><td>${esc(e.lrn || "-")}</td><td>${esc(e.name)}</td><td>${esc(bd(e.birthday))}</td><td>${ageOf(e.birthday)}</td><td>${esc(e.gender || "")}</td></tr>`).join("") || `<tr><td colspan="6">Nobody enrolled yet for the chosen section, term and school year.</td></tr>`);
}
async function unenroll(id) {
  const e = S.enrollments.find((x) => x.id === id); if (!e) return;
  if (!confirm(`Remove ${e.name} from ${e.sectionName} (${e.term}, ${e.schoolYear})?`)) return;
  await deleteDoc(doc(db, "enrollmentRecords", id));
  const rest = S.enrollments.filter((x) => x.registryId === e.registryId && x.id !== id).sort((a, b) => (b.schoolYear || "").localeCompare(a.schoolYear || "") || termRank(b.term) - termRank(a.term))[0];
  const ref = doc(db, "students", e.examNo);
  try {
    if (rest) { const s = S.sections.find((x) => x.id === rest.sectionId); if (s) await updateDoc(ref, { ownerUid: s.ownerUid, classId: s.id, className: s.name, updatedAt: serverTimestamp() }); }
    else { try { await deleteDoc(ref); } catch { await updateDoc(ref, { classId: "", className: "", updatedAt: serverTimestamp() }); } } // an activated account keeps its record, without a section
  } catch { /* record already gone */ }
  await refresh(); flash(`${e.name} was removed from ${e.sectionName}.`, 1);
}

/* ======================= IMPORT (master list and per-section) ======================= */
async function readTable(f) {
  if (/\.xlsx?$/i.test(f.name)) {
    if (!window.XLSX) throw new Error("The Excel reader did not load. Check your internet connection, or save the list as CSV.");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }).map((r) => r.map((x) => String(x).trim()));
  }
  const text = (await f.text()).replace(/^\ufeff/, "");
  return text.split(/\r?\n/).map((l) => { // simple CSV with quoted fields
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if ((ch === "," || ch === ";" || ch === "\t") && !q) { out.push(cur.trim()); cur = ""; } else cur += ch; }
    out.push(cur.trim()); return out;
  });
}
function headerKey(h) {
  const t = String(h).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (/guardian|parent/.test(t)) return /contact|phone|mobile|number|\bno\b/.test(t) ? "guardianContact" : /address/.test(t) ? "guardianAddress" : "guardianName";
  if (/father/.test(t)) return "father"; if (/mother/.test(t)) return "mother";
  if (/\blrn\b/.test(t)) return "lrn"; if (/voucher/.test(t)) return "voucher";
  if (/suffix/.test(t)) return "suffix"; if (/middle/.test(t)) return "middle";
  if (/last|surname|family/.test(t)) return "last"; if (/first|given/.test(t)) return "first";
  if (/birth|bday|dob/.test(t)) return "birthday"; if (/gender|\bsex\b/.test(t)) return "gender";
  if (/grade|year level/.test(t)) return "grade"; if (/address/.test(t)) return "address";
  if (/contact|phone|mobile|cell/.test(t)) return "contact";
  if (/student/.test(t) && /id|no|num/.test(t) || t === "id" || t === "student no") return "studentNo";
  if (/^(full )?name$/.test(t)) return "name";
  return null;
}
function parseName(s) {
  s = s.trim(); let last, rest;
  if (s.includes(",")) { last = s.split(",")[0].trim(); rest = s.split(",").slice(1).join(" ").trim(); } else { const t = s.split(/\s+/); last = t.pop(); rest = t.join(" "); }
  const parts = rest.split(/\s+/); const first = parts.shift() || ""; return { last, first, middle: parts.join(" ") };
}
function parseDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  const pad = (n) => String(n).padStart(2, "0"); let m;
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(s))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s))) {
    let [, a, b, y] = m; a = +a; b = +b; if (y.length === 2) y = (+y <= new Date().getFullYear() % 100 ? "20" : "19") + y;
    const [mo, d] = a > 12 ? [b, a] : [a, b]; return `${y}-${pad(mo)}-${pad(d)}`;
  }
  const t = new Date(s + " 12:00"); return Number.isNaN(+t) ? "" : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
/** Turns a file into row objects keyed by field. */
async function readPeople(file) {
  let rows = (await readTable(file)).filter((r) => r.some(Boolean));
  if (!rows.length) throw new Error("The file is empty.");
  const col = {}; rows[0].forEach((h, i) => { const k = headerKey(h); if (k && !(k in col)) col[k] = i; });
  if (!("studentNo" in col) && !("lrn" in col)) throw new Error("The first row must have column titles including Student ID No. (or LRN). Download the blank template from the Master list tab.");
  rows = rows.slice(1);
  return rows.map((r) => { const g = (k) => (k in col ? String(r[col[k]] ?? "").trim() : ""); const o = {};
    ["studentNo", "lrn", "voucher", "last", "first", "middle", "suffix", "gender", "contact", "address", "father", "mother", "guardianName", "guardianContact", "guardianAddress", "grade", "name"].forEach((k) => (o[k] = g(k)));
    o.birthday = parseDate(g("birthday")); o.lrn = o.lrn.replace(/\s+/g, "");
    if (o.name && !o.last && !o.first) Object.assign(o, parseName(o.name));
    return o; }).filter((o) => o.studentNo || o.lrn);
}
const matchGrade = (g) => { const n = /\d+/.exec(g || ""); return n ? GRADES.find((x) => x === "Grade " + +n[0]) || "" : /^k/i.test(g || "") ? "Kindergarten" : ""; };
/** Creates or updates the master-list record for one imported row. Returns {reg} or {skip}. */
async function upsertRow(o, i) {
  const studentNo = o.studentNo || o.lrn;
  if (!isStuNo(studentNo)) return { skip: `row ${i + 2}: invalid Student ID No.` };
  if (o.lrn && !isLrn(o.lrn)) return { skip: `row ${i + 2} (${studentNo}): LRN is not 12 digits` };
  const id = rid(studentNo), old = S.registry.find((r) => r.id === id) || (o.lrn && S.registry.find((r) => r.lrn === o.lrn));
  if (o.lrn && S.registry.some((r) => r.lrn === o.lrn && r.id !== (old ? old.id : id))) return { skip: `row ${i + 2} (${studentNo}): that LRN belongs to another student` };
  const f = { lastName: o.last, firstName: o.first, middleName: o.middle, suffix: o.suffix, lrn: o.lrn, voucherType: o.voucher.toUpperCase(), birthday: o.birthday, gender: normGender(o.gender),
    contact: o.contact, address: o.address, father: o.father, mother: o.mother, guardianName: o.guardianName, guardianContact: o.guardianContact, guardianAddress: o.guardianAddress, gradeLevel: matchGrade(o.grade) };
  const patch = Object.fromEntries(Object.entries(f).filter(([, v]) => v)); // blank cells never erase saved data
  const base = old || {};
  if (!old && (!patch.lastName || !patch.firstName)) return { skip: `row ${i + 2} (${studentNo}): new student needs a last name and first name` };
  const merged = { ...base, ...patch }; merged.name = nameOf(merged); patch.name = merged.name;
  const rid2 = old ? old.id : id;
  await setDoc(doc(db, "registry", rid2), { ...patch, ...(old ? {} : { studentNo, schoolId: SID, createdBy: user.uid, createdAt: serverTimestamp() }), updatedAt: serverTimestamp() }, { merge: true });
  const reg = { ...base, ...merged, id: rid2, studentNo: base.studentNo || studentNo };
  const k = S.registry.findIndex((r) => r.id === rid2); if (k >= 0) S.registry[k] = reg; else S.registry.push(reg);
  if (patch.voucherType && !S.vouchers.some((v) => v.toLowerCase() === patch.voucherType.toLowerCase())) { S.vouchers.push(patch.voucherType); S.vouchersDirty = true; }
  return { reg, created: !old };
}
async function importFile(file, withEnrol) {
  const c = withEnrol ? ctx() : null, people = await readPeople(file);
  if (!people.length) throw new Error("No student rows found.");
  const skipped = [], noBday = []; let created = 0, updated = 0, enrolled = 0;
  for (let i = 0; i < people.length; i += 10) {
    await Promise.all(people.slice(i, i + 10).map(async (o, j) => {
      try {
        const r = await upsertRow(o, i + j); if (r.skip) return skipped.push(r.skip);
        r.created ? created++ : updated++; if (!r.reg.birthday) noBday.push(r.reg.studentNo);
        if (withEnrol) { await enrollOne(r.reg, c); enrolled++; }
      } catch (e) { skipped.push(`row ${i + j + 2}: ${friendlyError(e)}`); }
    }));
  }
  if (S.vouchersDirty) { S.vouchersDirty = false; await saveSettings().catch(() => {}); }
  await refresh();
  flash(`Imported ${people.length - skipped.length} of ${people.length} rows: ${created} new, ${updated} updated` + (withEnrol ? `, ${enrolled} enrolled in ${c.section.name}` : "") + "." +
    (noBday.length ? ` ${noBday.length} have no birthdate yet (needed before the account can be activated).` : "") + (skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 4).join("; ")}${skipped.length > 4 ? "..." : ""}` : ""), !skipped.length);
}
$("mlFile").onchange = (e) => run(async () => { const f = e.target.files[0]; e.target.value = ""; if (f) await importFile(f, false); });
$("enFile").onchange = (e) => run(async () => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; if (!confirm("Register and enroll every student on this list in the chosen section, term and school year?")) return; await importFile(f, true); });

refresh();
