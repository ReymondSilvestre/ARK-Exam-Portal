import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, updatePassword, createUserWithEmailAndPassword, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const homeFor = (role) => (role === "admin" ? "admin.html" : role === "student" ? "student.html" : "teacher.html");

/* ---------- students sign in with their Exam ID No. (Firebase needs an email, so we derive one) ---------- */
export const STUDENT_DOMAIN = "student.ark-exam.app"; // must match firestore.rules
export const studentEmail = (examId) => `${String(examId).trim().toLowerCase()}@${STUDENT_DOMAIN}`;
/** Firebase needs 6+ characters; "2012D" is only 5, so short passwords get a fixed internal suffix. */
export const fbPass = (p) => (p.length < 6 ? p + "#ark" : p);
/** Birth year + first letter of the last name, e.g. 2012 + Dela Cruz = "2012D". */
export function defaultStudentPassword(s) {
  const y = /^(\d{4})-/.exec(s.birthday || "")?.[1], l = String(s.lastName || "").trim()[0];
  return y && l ? y + l.toUpperCase() : "";
}
export function ageOf(birthday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday || ""); if (!m) return "";
  const t = new Date(); let a = t.getFullYear() - +m[1];
  if (t.getMonth() + 1 < +m[2] || (t.getMonth() + 1 === +m[2] && t.getDate() < +m[3])) a--;
  return a >= 0 && a < 120 ? a : "";
}
export const fullName = (last, first, mi) => `${last}, ${first}${mi ? " " + mi + "." : ""}`;

export function friendlyError(e) {
  const map = {
    "auth/invalid-credential": "Email / Exam ID No. or password is incorrect.",
    "auth/wrong-password": "Email / Exam ID No. or password is incorrect.",
    "auth/user-not-found": "Email / Exam ID No. or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/requires-recent-login": "Please sign in again, then change your password.",
    "auth/weak-password": "Choose a stronger password (at least 6 characters).",
    "auth/email-already-in-use": "An account with that email / Exam ID No. already exists. Sign in instead.",
    "auth/invalid-email": "That email address is not valid.",
    "permission-denied": "You do not have permission for that action.",
  };
  return map[e?.code] || e?.message || "Something went wrong.";
}

/** `who` is an email (staff) or an Exam ID No. (student). */
export function login(who, password) {
  who = who.trim();
  if (who.includes("@")) return signInWithEmailAndPassword(auth, who, password);
  const pw = /^\d{4}[a-z]$/i.test(password) ? password.slice(0, 4) + password.slice(4).toUpperCase() : password;
  return signInWithEmailAndPassword(auth, studentEmail(who), fbPass(pw));
}
export const logout = async () => { await signOut(auth); location.href = "login.html"; };
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

/** Teacher sign-up: automatic, no approval. The password typed here is temporary and must be replaced at first sign-in. */
export async function signUpTeacher({ displayName, email, employeeId, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try {
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid, role: "teacher", displayName, email, employeeId,
      status: "active", mustChangePassword: true, createdAt: serverTimestamp(),
    });
  } catch (e) { await deleteUser(cred.user).catch(() => {}); throw e; }
  return cred.user;
}
/** Student sign-up: the Exam ID No. and birthday must match the record the teacher entered. */
export async function signUpStudent({ examId, birthday, password }) {
  const id = examId.trim(), email = studentEmail(id);
  const cred = await createUserWithEmailAndPassword(auth, email, fbPass(password));
  try {
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid, role: "student", displayName: id, email, studentId: id, birthday,
      status: "active", mustChangePassword: true, createdAt: serverTimestamp(),
    });
  } catch (e) {
    await deleteUser(cred.user).catch(() => {});
    throw new Error("We could not match that Exam ID No. and birthday. Check them, or ask your teacher.");
  }
  try { await updateDoc(doc(db, "students", id), { accountUid: cred.user.uid }); } catch { /* not essential */ }
  return cred.user;
}

/** A signed-out teacher asks the IT Administrator for a password reset. */
export async function requestPasswordReset(email, employeeId) {
  await addDoc(collection(db, "resetRequests"), {
    email: email.trim().toLowerCase(), employeeId: (employeeId || "").trim(),
    status: "pending", createdAt: serverTimestamp(),
  });
}

export async function getProfile(uid) {
  const s = await getDoc(doc(db, "users", uid));
  return s.exists() ? s.data() : null;
}

export async function destinationFor(user) {
  const p = await getProfile(user.uid);
  if (!p) throw new Error("This account is not registered. Contact your IT administrator.");
  if (p.status !== "active") throw new Error("This account is suspended. Contact your IT administrator.");
  return p.mustChangePassword ? "change-password.html" : homeFor(p.role);
}

export async function changeOwnPassword(newPassword) {
  await updatePassword(auth.currentUser, newPassword);
  await updateDoc(doc(db, "users", auth.currentUser.uid), {
    mustChangePassword: false, passwordChangedAt: serverTimestamp(),
  });
}

export function requireRole(roles, { allowMustChange = false } = {}) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.href = "login.html"; return; }
      let profile = null;
      try { profile = await getProfile(user.uid); } catch (e) { /* treated as no access */ }
      if (!profile || profile.status !== "active" || !roles.includes(profile.role)) {
        await signOut(auth); location.href = "login.html?denied=1"; return;
      }
      if (profile.mustChangePassword && !allowMustChange) { location.href = "change-password.html"; return; }
      resolve({ user, profile });
    });
  });
}
