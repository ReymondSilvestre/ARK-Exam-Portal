# ARK Exam Scanner - version 5 (online exams, filter icon)

Folder layout (same as before, plus `superadmin.html` and `js/superadmin.js`):
```
index.html login.html change-password.html superadmin.html admin.html teacher.html student.html
css/style.css
js/  auth.js superadmin.js admin.js teacher.js student.js omr.js files.js firebase-config.js
functions/  index.js package.json
firestore.rules firebase.json firestore.indexes.json
```

## New in this update
- **Delete all data of a school, or delete the school with its data (Super Admin).** Each school row on the Super Admin page has two buttons:
  - **Delete all data** (red button): wipes every teacher and student account, section, exam, result, module, classroom code and activity log of that school, but **keeps the school registered and its IT Admin**, who can sign in to an empty school. Confirm by typing the *school code*. Cloud Function: `superClearSchoolData`.
  - **Trash icon**: deletes everything above **and** the IT Admin and the school itself. Confirm by typing the *school name*. Cloud Function: `superDeleteSchool`.
  - With the Cloud Functions deployed (`firebase deploy --only functions`) the sign-in logins in Firebase Authentication are removed too. Without them the page falls back to deleting the Firestore records from the browser (this needs the updated `firestore.rules`, which let the Super Admin read school data for that purpose); the logins are then left in Authentication until removed by hand.
  - Both functions are safe to run again if a very large school times out: they pick up whatever is left.
- **School branding (IT Admin).** IT Admin > Branding: set the school name shown on screen and upload a logo (stored on the school's own document). Replaces the "ARK" mark across that school's Teacher, Student and IT Admin pages (not the sign-in page). Works with no Cloud Function.
- **Delete a school (Super Admin).** Super Admin page: a trash icon on each row permanently deletes a school - its IT Admin, every teacher and student account in it, and everything they own (sections, exams, results, modules). Needs typing the school's name to confirm.
  - With the `superDeleteSchool` Cloud Function deployed: also deletes the accounts' sign-in logins from Firebase Authentication.
  - Without it: everything above still happens straight from the browser, except the sign-in logins themselves - those are left behind (harmless, since the Firestore profile they need to sign in to anything is gone) until removed by hand in Firebase console > Authentication > Users.
- **Self-service "Forgot your password?" is removed**, from the sign-in page and from the IT Admin's reset-requests inbox. In its place, each account row has a **"Set password"** button: the IT Admin (or, for an IT Admin's own account, the Super Admin) types a password and it becomes that account's sign-in password immediately, overriding whatever the person had changed it to. They are not told what it is or that it was changed, beyond needing to pick a new one at their next sign-in. Reuses the same `adminSetTempPassword` Cloud Function as "Reset password" - **needs that function deployed** (README step G); there is no way to change another person's password without it, since Firebase blocks that from the browser by design.

## New in version 5
- **Filter icon** (Students list and Results page): pick a section or *All sections* (grouped per section) and sort names A-Z, Z-A or by Exam ID No.
- **Online exams.** Examinations > tick *Students answer this exam online*. Type each question (and the choices for multiple choice) or paste a link to your exam paper. Set a time limit if you want, then *Open* it. Students see it under **Online exams**, answer, submit once, and get the score at once. Results land in the normal Results page (ranking, Excel, item analysis work as before). Identification answers that match your accepted answers (separate several with `|`) are marked correct automatically when you open Results; other identification answers and essays wait for your check (*Check* button shows what the student wrote). *Retake* on a result lets a student start over. *Close* stops new submissions.
- **Answer sheet**: the footer line (title / Exam ID / "ARK sheet v3") is removed.

### Examination page (teacher)
- Top buttons: **My exams**, **+ Create exam**, **Answer key**, **Answer sheets**.
- **My exams**: one card per exam with a green switch to open or close it for students, plus Edit, Answer key, Answer sheet and Delete.
- **+ Create exam** has 3 steps: (1) details, (2) how students take it: *Type the questions*, *Use an exam paper link*, or *Printed only*, (3) questions and key. For typed multiple choice, write each choice and click its letter to mark the correct one. *+ Add question* and *Remove this question* change the number of items.
- **Answer key**: pick an exam, see its key, print it.
- **Student room**: the exam paper (typed questions, or your link embedded) sits on the left and the answer sheet on the right. On a phone the two are switched with tabs.

### Deploy for v5 (no Cloud Function needed)
1. Replace the files, keep your `js/firebase-config.js`.
2. Firestore > Rules: paste `firestore.rules` > Publish. That is all.

How grading stays fair without a server: students read questions from `examPapers` (no key). When they press Submit, their answers are saved once in `examSubmissions` and locked. Only then do the rules let them read `examKeys`, so the browser can score the locked answers. The Results page re-scores every online result from the locked answers, so a changed score on a student's device never counts.
Limits: after submitting, a student could look up the key and tell others, so use *Close* when the class period ends. Identification matches and identification/essay points are applied when you open the Results page (the student's first score shows them as "to check").
Time limit: the timer runs from when the student opens the exam; work sent more than 2 minutes after the limit is kept and marked **Late**.

## Who does what
| Role | Created by | Signs in with | Can do |
|---|---|---|---|
| **Super Admin** (you) | Firebase console, once | email + password | Register schools (name + school code) and each school's IT Admin. Suspend a school. |
| **IT Admin** (one per school) | Super Admin | email + password | Create faculty / teacher accounts, suspend, reset password, remove. Sees only their own school. Also has every teacher tool. |
| **Faculty / Teacher** | School IT Admin | **school code + Employee No.** | Sections (each with a unique classroom code), advisory students, exams, scanner, modules, results. |
| **Student** | Their adviser (teacher) | **Exam ID No.** | Own results and modules. Can join other teachers' classrooms with the classroom code. |

Temporary password for teachers AND students = **birth year + first letter of last name** (example `1985D`). Everyone must choose a new password at first sign-in. Teacher self sign-up and student self sign-up are removed.

## Classroom codes
Every section has a code (6 characters, e.g. `K7M2QX`). A student of any teacher in the **same school** types it under *My classrooms > Join*. Each join is its own record, so classes never mix:
- the student appears in that teacher's section (labelled "Joined by code") and can be scanned, graded and sorted there;
- the student sees that teacher's exam results and modules next to their own;
- the teacher cannot see the student's other classes, birthday or login;
- *New code* stops further joins; students already joined stay. A teacher can remove a student, and a student can leave.

## Set up (do these in order)
1. Replace all files. Keep your own `js/firebase-config.js`.
2. **Make yourself Super Admin.** Firebase console > Firestore > `users` > your old admin document: change `role` to `superadmin`, delete `schoolId` if present. Sign in with that email: you land on `superadmin.html`.
3. **Firestore > Rules**: paste `firestore.rules` > Publish.
4. **Indexes**: `firebase deploy --only firestore:indexes` (needed for the reset-request list and activity log). Or open the page, click the link in the console error Firebase shows, and create it.
5. **Cloud Function** (Blaze plan; school use stays in the free quota). Needed for resetting passwords and removing accounts:
```
firebase use exam-scanner-ac29e
cd functions && npm install && cd ..
firebase deploy --only functions
```
Adds `adminSetTempPassword`, `adminDeleteUser` and `superDeleteSchool`. This needs the Blaze (pay-as-you-go) plan, but a
school this size stays inside Firebase's free monthly quota - Blaze only means billing is turned on, not that you'll be
charged. Everything else in this app (branding, suspending/reactivating, signing in, scanning, exams) works with no
Cloud Function at all; without it, "Set password", "Reset password" and the login-deletion part of "Remove account" and
"Delete school" simply aren't available (their buttons show a clear message instead of failing silently).
6. Super Admin page: **Register a school** (name, code, IT Admin name + email). Give the IT Admin the temporary password shown once.
7. IT Admin signs in with email, changes the password, then **Accounts > Add a faculty / teacher account**.
8. Teacher signs in with the school code + Employee No. + temporary password, adds sections, adds students, **Create logins**.

## Existing data
Teachers, students, exams and results made with version 3 have no `schoolId`, so version 4 will not show them. Easiest: start fresh with the test data. To keep it, add a `schoolId` field (the school code) to each document in `users`, `students`, `classes`, `examinations` and `scanResults`, and register the school first.

## Limits
- Classroom codes work inside one school only.
- Teachers have no email, so password help goes through their IT Admin (sign-in page > Forgot your password > school code + Employee No.).
- A school IT Admin's own forgotten password is reset by the Super Admin (*Reset IT Admin password*).
- Exam ID No. stay unique across all schools (shared counter).
