// Admin-level actions that Firebase only allows from server code.
//  adminSetTempPassword : Super Admin (IT admins), school IT admin (teachers + students of that school), teacher (own students).
//                         Also used for the IT Admin's "Set password" action (an admin-chosen password instead of the default).
//  adminDeleteUser      : Super Admin removes an IT admin; a school IT admin removes a teacher or student of that school.
//  superClearSchoolData : Super Admin wipes ALL data of a school (teachers, students, exams, results, modules, logins)
//                         but keeps the school registration and its IT Admin account.
//  superDeleteSchool    : Super Admin permanently deletes a whole school, its IT Admin and all of its data.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

async function who(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const me = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (!me || me.status !== "active" || !["superadmin", "admin", "teacher"].includes(me.role))
    throw new HttpsError("permission-denied", "You do not have permission for that action.");
  if (me.role !== "superadmin") {
    const sc = (await db.doc(`schools/${me.schoolId}`).get()).data();
    if (!sc || sc.status !== "active") throw new HttpsError("permission-denied", "Your school is not active.");
  }
  return me;
}
const audit = (uid, schoolId, action, targetUid, details) =>
  db.collection("auditLogs").add({ actorUid: uid, schoolId: schoolId || "", action, targetUid, details: details || {}, createdAt: now() });

/** Same rule the website uses: birth year + first letter of the last name (padded to Firebase's 6-character minimum). */
function defaultPassword(s) {
  const y = /^(\d{4})-/.exec(s.birthday || "")?.[1], l = String(s.lastName || "").trim()[0];
  if (!y || !l) return null;
  const p = y + l.toUpperCase();
  return p.length < 6 ? p + "#ark" : p;
}
/** May `me` manage account `t`? `st` = the student record when t is a student. */
function canManage(me, myUid, t, st) {
  if (me.role === "superadmin") return t.role === "admin";
  if (me.role === "admin") return ["teacher", "student"].includes(t.role) && t.schoolId === me.schoolId;
  return t.role === "student" && !!st && st.ownerUid === myUid;
}

exports.adminSetTempPassword = onCall(async (req) => {
  const me = await who(req);
  const { uid, password, useDefault } = req.data || {};
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "Missing account.");
  const t = (await db.doc(`users/${uid}`).get()).data();
  if (!t || !["admin", "teacher", "student"].includes(t.role)) throw new HttpsError("not-found", "That account was not found.");
  const st = t.role === "student" ? (await db.doc(`students/${t.studentId}`).get()).data() : null;
  if (!canManage(me, req.auth.uid, t, st)) throw new HttpsError("permission-denied", "You cannot reset that account.");

  let pw = password;
  if (useDefault) {
    pw = defaultPassword(t.role === "student" ? st || {} : t);
    if (!pw) throw new HttpsError("failed-precondition", "This account needs a birthday and last name first.");
  } else {
    const min = t.role === "student" ? 6 : 10;
    if (typeof pw !== "string" || pw.length < min || (t.role !== "student" && (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))))
      throw new HttpsError("invalid-argument", "The password is too weak.");
  }
  await admin.auth().updateUser(uid, { password: pw });
  await admin.auth().revokeRefreshTokens(uid);
  await db.doc(`users/${uid}`).update({ mustChangePassword: true, passwordResetAt: now(), updatedAt: now() });
  await audit(req.auth.uid, t.schoolId || me.schoolId, `${t.role}.temp_password_set`, uid, { username: t.employeeId || t.studentId || t.email });
  return { ok: true };
});

async function deleteAll(q) {
  let n = 0;
  for (;;) {
    const s = await q.limit(400).get(); if (s.empty) return n;
    const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); n += s.size;
  }
}
async function dropAuth(uid) {
  try { await admin.auth().deleteUser(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
}

exports.adminDeleteUser = onCall(async (req) => {
  const me = await who(req);
  if (!["superadmin", "admin"].includes(me.role)) throw new HttpsError("permission-denied", "Only an administrator can remove accounts.");
  const { uid } = req.data || {};
  if (typeof uid !== "string" || !uid || uid === req.auth.uid) throw new HttpsError("invalid-argument", "Invalid account.");
  const t = (await db.doc(`users/${uid}`).get()).data();
  if (!t) { await dropAuth(uid); return { ok: true, note: "No profile; login removed." }; }
  if (t.role === "superadmin") throw new HttpsError("permission-denied", "That account cannot be removed here.");
  if (me.role === "superadmin" ? t.role !== "admin" : (t.schoolId !== me.schoolId || !["teacher", "student"].includes(t.role)))
    throw new HttpsError("permission-denied", "You cannot remove that account.");

  if (t.role === "teacher") {
    // remove the logins of this teacher's students first, then everything the teacher owns
    const studs = await db.collection("students").where("ownerUid", "==", uid).get();
    for (const s of studs.docs) {
      const a = s.data().accountUid;
      if (a) { await dropAuth(a); await db.doc(`users/${a}`).delete().catch(() => {}); }
    }
    for (const c of ["scanResults", "examAttempts", "examSubmissions", "examKeys", "examPapers", "moduleChunks", "modules", "examinations", "answerKeys", "answerSheets", "enrollments", "teacherLinks", "classCodes", "students", "classes"])
      await deleteAll(db.collection(c).where("ownerUid", "==", uid));
  } else if (t.role === "student" && t.studentId) {
    await db.doc(`students/${t.studentId}`).update({ accountUid: admin.firestore.FieldValue.delete() }).catch(() => {});
    await deleteAll(db.collection("enrollments").where("studentId", "==", t.studentId));
    await deleteAll(db.collection("teacherLinks").where("studentId", "==", t.studentId));
    await deleteAll(db.collection("examAttempts").where("studentId", "==", t.studentId));
    await deleteAll(db.collection("examSubmissions").where("studentId", "==", t.studentId));
  }
  await dropAuth(uid);
  await db.doc(`users/${uid}`).delete();
  await deleteAll(db.collection("loginIndex").where("uid", "==", uid)); // the real-email sign-in lookup, if any
  await audit(req.auth.uid, t.schoolId || "", `${t.role}.deleted`, uid, { username: t.employeeId || t.studentId || t.email });
  return { ok: true };
});

/* ---------------- Super Admin: wipe / delete a whole school ---------------- */

// Every collection that holds a school's data. Each document carries `ownerUid` (the teacher / IT Admin who
// owns it) and most also carry `schoolId`, so both are swept to catch anything left over.
const SCHOOL_COLLECTIONS = [
  "scanResults", "examAttempts", "examSubmissions", "examKeys", "examPapers", "moduleChunks", "modules",
  "examinations", "answerKeys", "answerSheets", "enrollments", "teacherLinks", "classCodes", "students", "classes",
  "resetRequests", "loginIndex",
];
// Deleting a lot of data can take a while: give these two functions the maximum time.
const HEAVY = { timeoutSeconds: 540, memory: "512MiB" };

async function dropAuthMany(uids) {
  let failed = 0;
  for (let i = 0; i < uids.length; i += 1000) {
    const r = await admin.auth().deleteUsers(uids.slice(i, i + 1000)); // accounts that no longer exist are not an error
    failed += r.failureCount;
  }
  return failed;
}

/** Removes everything that belongs to a school.
 *  removeAdmins=false : keeps the IT Admin's profile + login (school stays registered, ready to start fresh).
 *  removeAdmins=true  : removes the IT Admin too (the caller then deletes the school document).
 *  Order matters: sign-in logins first, then data, and the `users` profiles LAST, so if the function is
 *  interrupted (timeout) it can simply be run again and will find everything that is left. */
async function purgeSchool(schoolId, removeAdmins) {
  const people = (await db.collection("users").where("schoolId", "==", schoolId).get()).docs
    .map((d) => ({ uid: d.id, ...d.data() })).filter((p) => p.role !== "superadmin");
  const doomed = people.filter((p) => removeAdmins || p.role !== "admin");
  // the IT Admin has every teacher tool, so they may own sections / exams / students directly too
  const owners = people.filter((p) => p.role === "teacher" || p.role === "admin").map((p) => p.uid);

  const profileIds = new Set(doomed.map((p) => p.uid));
  for (const o of owners) {
    const studs = await db.collection("students").where("ownerUid", "==", o).get();
    studs.docs.forEach((s) => { const a = s.data().accountUid; if (a) profileIds.add(a); });
  }

  const authFailed = await dropAuthMany([...profileIds]);

  let deleted = 0;
  for (const c of SCHOOL_COLLECTIONS) {
    for (const o of owners) deleted += await deleteAll(db.collection(c).where("ownerUid", "==", o));
    deleted += await deleteAll(db.collection(c).where("schoolId", "==", schoolId));
  }
  deleted += await deleteAll(db.collection("auditLogs").where("schoolId", "==", schoolId));

  const ids = [...profileIds];
  for (let i = 0; i < ids.length; i += 400) {
    const b = db.batch(); ids.slice(i, i + 400).forEach((id) => b.delete(db.doc(`users/${id}`))); await b.commit();
  }
  return { deleted: deleted + ids.length, accounts: ids.length, authFailed };
}

async function loadSchoolForSuper(req) {
  const me = await who(req);
  if (me.role !== "superadmin") throw new HttpsError("permission-denied", "Only the Super Admin can do that.");
  const { schoolId } = req.data || {};
  if (typeof schoolId !== "string" || !schoolId) throw new HttpsError("invalid-argument", "Missing school.");
  const snap = await db.doc(`schools/${schoolId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That school was not found.");
  return { schoolId, school: snap.data() };
}

/** Super Admin wipes ALL data of a school but keeps the school and its IT Admin. */
exports.superClearSchoolData = onCall(HEAVY, async (req) => {
  const { schoolId, school } = await loadSchoolForSuper(req);
  const r = await purgeSchool(schoolId, false);
  await audit(req.auth.uid, schoolId, "school.data_cleared", schoolId, { name: school.name, code: school.code, ...r });
  return { ok: true, ...r };
});

/** Super Admin permanently removes a registered school: its IT Admin, every teacher and student of
 *  that school (and everything they own), and the school document itself. */
exports.superDeleteSchool = onCall(HEAVY, async (req) => {
  const { schoolId, school } = await loadSchoolForSuper(req);
  const r = await purgeSchool(schoolId, true);
  await db.doc(`schools/${schoolId}`).delete();
  await audit(req.auth.uid, "", "school.deleted", schoolId, { name: school.name, code: school.code, ...r });
  return { ok: true, ...r };
});
