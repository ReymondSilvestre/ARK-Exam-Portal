import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const homeFor = (role) =>
  role === "superadmin" ? "superadmin.html" : role === "admin" ? "admin.html" : role === "student" ? "student.html" : "teacher.html";

/* ---------- logins ----------
   Students: Exam ID No.                      -> EXAMID@student.ark-exam.app
   Teachers: School code + Employee No.       -> SCHOOL.EMPNO@staff.ark-exam.app
   IT admins / Super Admin: a real email address. */
export const STUDENT_DOMAIN = "student.ark-exam.app"; // must match firestore.rules
export const STAFF_DOMAIN = "staff.ark-exam.app";
export const studentEmail = (examId) => `${String(examId).trim().toLowerCase()}@${STUDENT_DOMAIN}`;
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
export const staffEmail = (schoolCode, employeeNo) => `${slug(schoolCode)}.${slug(employeeNo)}@${STAFF_DOMAIN}`;
/* ---------- optional REAL email for teachers and students ----------
   If an email is given when the account is created, that email IS the Firebase login (so "Forgot password" goes to
   the person's own inbox). Because they can still sign in with school code + Employee No. / Exam ID No., a tiny
   lookup document `loginIndex/{key}` maps that username to the email. Without an email nothing changes. */
export const isRealEmail = (e) => {
  const v = String(e || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && !v.endsWith("@" + STUDENT_DOMAIN) && !v.endsWith("@" + STAFF_DOMAIN);
};
export const cleanEmail = (e) => (isRealEmail(e) ? String(e).trim().toLowerCase() : "");
/** ONE inbox for every reset link: IT Admin email + a tag, e.g. school@gmail.com + 2026-0001 -> school+2026-0001@gmail.com.
 *  Gmail (and Outlook) deliver every "+tag" address to the base inbox, but Firebase treats each as a separate login.
 *  Returns "" when the base is not a usable email (the account then falls back to the internal login). */
export const sharedEmail = (baseEmail, tag) => {
  const m = /^([^\s@+]+)(?:\+[^\s@]*)?@([^\s@]+\.[^\s@]{2,})$/.exec(String(baseEmail || "").trim().toLowerCase());
  const t = String(tag || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return m && t ? `${m[1]}+${t}@${m[2]}` : "";
};
export const staffKey = (schoolCode, employeeNo) => `${slug(schoolCode)}.${slug(employeeNo)}`;
export const studentKey = (examId) => slug(examId);
/** The real email behind a username, or "" when the account has none (or the lookup is not allowed). */
export async function lookupEmail(school, who) {
  try {
    const key = (school || "").trim() ? staffKey(school, who) : studentKey(who);
    const s = await getDoc(doc(db, "loginIndex", key));
    return s.exists() ? String(s.data().email || "") : "";
  } catch { return ""; }
}

/** Firebase needs 6+ characters; "2012D" is only 5, so short passwords get a fixed internal suffix. */
export const fbPass = (p) => (p.length < 6 ? p + "#ark" : p);
/** Birth year + first letter of the last name, e.g. 1985 + Dela Cruz = "1985D". Used for teachers AND students. */
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
    "auth/invalid-credential": "The username, school code or password is incorrect.",
    "auth/wrong-password": "The username, school code or password is incorrect.",
    "auth/user-not-found": "The username, school code or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/requires-recent-login": "Please sign in again, then change your password.",
    "auth/weak-password": "Choose a stronger password (at least 6 characters).",
    "auth/email-already-in-use": "That account already exists (same school code and Employee No., or same email).",
    "auth/invalid-email": "That email address is not valid.",
    "auth/missing-email": "Enter your email, Employee No. or Exam ID No. first.",
    "permission-denied": "You do not have permission for that action.",
  };
  return map[e?.code] || e?.message || "Something went wrong.";
}

/** `who` = email (IT admin / Super Admin), Employee No. (teacher, needs `school`) or Exam ID No. (student, no school). */
export function login(who, password, school) {
  who = who.trim();
  const pw = /^\d{4}[a-z]$/i.test(password) ? password.slice(0, 4) + password.slice(4).toUpperCase() : password;
  if (who.includes("@")) return signInWithEmailAndPassword(auth, who, fbPass(pw)); // fbPass only changes the short temporary password (example 2012D)
  return lookupEmail(school, who).then((real) => {
    const email = real || ((school || "").trim() ? staffEmail(school, who) : studentEmail(who));
    return signInWithEmailAndPassword(auth, email, fbPass(pw));
  });
}

/** "Forgot password": sends Firebase's reset email to the account's REAL email.
 *  `who` = the email itself, or an Employee No. (with `school`) / Exam ID No.
 *  Returns "sent" or "noemail" (the account exists without a real email, so only the IT Admin / teacher can reset it). */
export async function sendReset(who, school) {
  who = who.trim();
  let email = who.includes("@") ? who : await lookupEmail(school, who);
  if (!email) return "noemail";
  await sendPasswordResetEmail(auth, email);
  return "sent";
}
export const logout = async () => { await signOut(auth); location.href = "login.html"; };

export async function getProfile(uid) {
  const s = await getDoc(doc(db, "users", uid));
  return s.exists() ? s.data() : null;
}
/** The school document (name, code, status). The Super Admin has no school. */
export async function getSchool(profile) {
  if (!profile || profile.role === "superadmin") return null;
  const s = await getDoc(doc(db, "schools", profile.schoolId || "-"));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function destinationFor(user) {
  const p = await getProfile(user.uid);
  if (!p) throw new Error("This account is not registered. Contact your IT administrator.");
  if (p.status !== "active") throw new Error("This account is suspended. Contact your IT administrator.");
  if (p.role !== "superadmin") {
    const sc = await getSchool(p);
    if (!sc || sc.status !== "active") throw new Error("This school is not active. Contact the system administrator.");
  }
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
      let profile = null, school = null;
      try { profile = await getProfile(user.uid); school = await getSchool(profile); } catch (e) { /* treated as no access */ }
      const schoolOk = profile && (profile.role === "superadmin" || (school && school.status === "active"));
      if (!profile || profile.status !== "active" || !schoolOk || !roles.includes(profile.role)) {
        await signOut(auth); location.href = "login.html?denied=1"; return;
      }
      if (profile.mustChangePassword && !allowMustChange) { location.href = "change-password.html"; return; }
      resolve({ user, profile, school });
    });
  });
}

/* ---------- school identity (name + logo set by the IT Admin) ---------- */
export const schoolTitle = (sc) => (sc && (sc.displayName || sc.name)) || "";
/** Shows the school logo and name in the page's top bar / side bar (.brand). Falls back to the ARK mark. */
export function applyBranding(sc) {
  if (!sc) return;
  const b = document.querySelector(".brand"); if (!b) return;
  if (sc.logo) {
    const m = b.querySelector(".mark");
    const img = Object.assign(document.createElement("img"), { src: sc.logo, alt: "", className: "school-logo" });
    if (m) m.replaceWith(img); else b.prepend(img);
  }
  const t = schoolTitle(sc);
  if (t && !document.getElementById("brandSchool")) {
    const n = document.createElement("small"); n.id = "brandSchool"; n.className = "brand-school"; n.textContent = t;
    b.after(n);
  }
}
