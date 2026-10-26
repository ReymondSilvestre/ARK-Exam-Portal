import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, addDoc, collection, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const homeFor = (role) => (role === "admin" ? "admin.html" : "teacher.html");

export function friendlyError(e) {
  const map = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/requires-recent-login": "Please sign in again, then change your password.",
    "auth/weak-password": "Choose a stronger password.",
    "auth/email-already-in-use": "That email is already registered.",
    "permission-denied": "You do not have permission for that action.",
  };
  return map[e?.code] || e?.message || "Something went wrong.";
}

export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = async () => { await signOut(auth); location.href = "login.html"; };
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

/** A user who is signed out asks the IT Administrator for a password reset. Nothing is emailed until the admin approves it.
 *  The reply never says whether the email exists, so this cannot be used to discover accounts. */
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

/** Where should this signed-in user go? Throws a readable error if they have no access. */
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

/** Guard a page. Resolves {user, profile}; redirects otherwise. */
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
