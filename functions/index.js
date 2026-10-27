// Lets the IT Administrator set a temporary password for a teacher (no email needed).
// Only a signed-in, active admin (checked in Firestore) can call it.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

exports.adminSetTempPassword = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const db = admin.firestore(), now = admin.firestore.FieldValue.serverTimestamp();
  const me = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (!me || me.role !== "admin" || me.status !== "active") throw new HttpsError("permission-denied", "Only the IT Administrator can do this.");

  const { uid, password, requestId } = req.data || {};
  if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "Missing teacher.");
  if (typeof password !== "string" || password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw new HttpsError("invalid-argument", "The password needs 10+ characters with a letter and a number.");
  const t = (await db.doc(`users/${uid}`).get()).data();
  if (!t || t.role !== "teacher") throw new HttpsError("not-found", "That teacher account was not found.");

  await admin.auth().updateUser(uid, { password });
  await admin.auth().revokeRefreshTokens(uid); // signs the teacher out everywhere
  await db.doc(`users/${uid}`).update({ mustChangePassword: true, passwordResetAt: now, updatedAt: now });
  if (typeof requestId === "string" && requestId)
    await db.doc(`resetRequests/${requestId}`).update({ status: "resolved", resolvedAt: now, resolvedBy: req.auth.uid });
  await db.collection("auditLogs").add({ actorUid: req.auth.uid, action: "teacher.temp_password_set", targetUid: uid, details: { email: t.email }, createdAt: now });
  return { ok: true };
});
