// Two admin-level actions that Firebase only allows from server code.
//  adminSetTempPassword : IT admin (teachers + students) or a teacher (own students only) sets a temporary password.
//  adminDeleteUser      : IT admin removes a teacher or student from Firebase Authentication AND Firestore.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

async function who(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const me = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (!me || me.status !== "active" || !["admin", "teacher"].includes(me.role))
    throw new HttpsError("permission-denied", "You do not have permission for that action.");
  return me;
}
const audit = (uid, action, targetUid, details) =>
  db.collection("auditLogs").add({ actorUid: uid, action, targetUid, details: details || {}, createdAt: now() });

/** Same rule the website uses: birth year + first letter of the last name (padded to Firebase's 6-character minimum). */
function defaultStudentPassword(s) {
  const y = /^(\d{4})-/.exec(s.birthday || "")?.[1], l = String(s.lastName || "").trim()[0];
  if (!y || !l) return null;
  const p = y + l.toUpperCase();
  return p.length < 6 ? p + "#ark" : p;
}

exports.adminSetTempPassword = onCall(async (req) => {
  const me = await who(req);
  const { uid, password, requestId, useDefault } = req.data || {};
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "Missing account.");
  const t = (await db.doc(`users/${uid}`).get()).data();
  if (!t || !["teacher", "student"].includes(t.role)) throw new HttpsError("not-found", "That account was not found.");

  let pw = password;
  if (t.role === "teacher") {
    if (me.role !== "admin") throw new HttpsError("permission-denied", "Only the IT Administrator can reset a teacher.");
  } else {
    const st = (await db.doc(`students/${t.studentId}`).get()).data();
    if (me.role !== "admin" && (!st || st.ownerUid !== req.auth.uid))
      throw new HttpsError("permission-denied", "You can only reset your own students.");
    if (useDefault) { pw = defaultStudentPassword(st || {}); if (!pw) throw new HttpsError("failed-precondition", "This student needs a birthday and last name first."); }
  }
  const min = t.role === "student" ? 6 : 10;
  if (typeof pw !== "string" || pw.length < min || (t.role === "teacher" && (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))))
    throw new HttpsError("invalid-argument", "The password is too weak.");

  await admin.auth().updateUser(uid, { password: pw });
  await admin.auth().revokeRefreshTokens(uid);
  await db.doc(`users/${uid}`).update({ mustChangePassword: true, passwordResetAt: now(), updatedAt: now() });
  if (me.role === "admin" && typeof requestId === "string" && requestId)
    await db.doc(`resetRequests/${requestId}`).update({ status: "resolved", resolvedAt: now(), resolvedBy: req.auth.uid });
  await audit(req.auth.uid, `${t.role}.temp_password_set`, uid, { email: t.email });
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
  if (me.role !== "admin") throw new HttpsError("permission-denied", "Only the IT Administrator can remove accounts.");
  const { uid } = req.data || {};
  if (typeof uid !== "string" || !uid || uid === req.auth.uid) throw new HttpsError("invalid-argument", "Invalid account.");
  const t = (await db.doc(`users/${uid}`).get()).data();
  if (!t) { await dropAuth(uid); return { ok: true, note: "No profile; login removed." }; }
  if (t.role === "admin") throw new HttpsError("permission-denied", "An administrator cannot be removed here.");

  if (t.role === "teacher") {
    // remove the logins of this teacher's students first, then everything the teacher owns
    const studs = await db.collection("students").where("ownerUid", "==", uid).get();
    for (const s of studs.docs) {
      const a = s.data().accountUid;
      if (a) { await dropAuth(a); await db.doc(`users/${a}`).delete().catch(() => {}); }
    }
    for (const c of ["scanResults", "moduleChunks", "modules", "examinations", "answerKeys", "answerSheets", "students", "classes"])
      await deleteAll(db.collection(c).where("ownerUid", "==", uid));
  } else if (t.studentId) {
    await db.doc(`students/${t.studentId}`).update({ accountUid: admin.firestore.FieldValue.delete() }).catch(() => {});
  }
  await dropAuth(uid);
  await db.doc(`users/${uid}`).delete();
  await audit(req.auth.uid, `${t.role}.deleted`, uid, { email: t.email });
  return { ok: true };
});
