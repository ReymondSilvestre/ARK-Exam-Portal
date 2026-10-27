// Admin-level actions that Firebase only allows from server code.
//  adminSetTempPassword : Super Admin (IT admins), school IT admin (teachers + students of that school), teacher (own students).
//  adminDeleteUser      : Super Admin removes an IT admin; a school IT admin removes a teacher or student of that school.
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
  const { uid, password, requestId, useDefault } = req.data || {};
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
  if (me.role === "admin" && typeof requestId === "string" && requestId)
    await db.doc(`resetRequests/${requestId}`).update({ status: "resolved", resolvedAt: now(), resolvedBy: req.auth.uid });
  await audit(req.auth.uid, t.schoolId || me.schoolId, `${t.role}.temp_password_set`, uid, { username: t.employeeId || t.studentId || t.email });
  return { ok: true };
});

async function deleteAll(q) {
  for (;;) {
    const s = await q.limit(400).get(); if (s.empty) return;
    const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
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
    for (const c of ["scanResults", "moduleChunks", "modules", "examinations", "answerKeys", "answerSheets", "enrollments", "teacherLinks", "classCodes", "students", "classes"])
      await deleteAll(db.collection(c).where("ownerUid", "==", uid));
  } else if (t.role === "student" && t.studentId) {
    await db.doc(`students/${t.studentId}`).update({ accountUid: admin.firestore.FieldValue.delete() }).catch(() => {});
    await deleteAll(db.collection("enrollments").where("studentId", "==", t.studentId));
    await deleteAll(db.collection("teacherLinks").where("studentId", "==", t.studentId));
  }
  await dropAuth(uid);
  await db.doc(`users/${uid}`).delete();
  await audit(req.auth.uid, t.schoolId || "", `${t.role}.deleted`, uid, { username: t.employeeId || t.studentId || t.email });
  return { ok: true };
});
