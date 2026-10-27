# ARK Exam Scanner - version 5 (online exams, filter icon)

Folder layout (same as before, plus `superadmin.html` and `js/superadmin.js`):
```
index.html login.html change-password.html superadmin.html admin.html teacher.html student.html
css/style.css
js/  auth.js superadmin.js admin.js teacher.js student.js omr.js files.js firebase-config.js
functions/  index.js package.json
firestore.rules firebase.json firestore.indexes.json
```

## New in version 5
- **Filter icon** (Students list and Results page): pick a section or *All sections* (grouped per section) and sort names A-Z, Z-A or by Exam ID No.
- **Online exams.** Examinations > tick *Students answer this exam online*. Type each question (and the choices for multiple choice) or paste a link to your exam paper. Set a time limit if you want, then *Open* it. Students see it under **Online exams**, answer, submit once, and get the score at once. Results land in the normal Results page (ranking, Excel, item analysis work as before). Identification answers that match your accepted answers (separate several with `|`) are marked correct automatically when you open Results; other identification answers and essays wait for your check (*Check* button shows what the student wrote). *Retake* on a result lets a student start over. *Close* stops new submissions.
- **Answer sheet**: the footer line (title / Exam ID / "ARK sheet v3") is removed.

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
