# ARK Exam Scanner - version 3

Static site (GitHub Pages) + Firebase Auth + Firestore. Folder layout:

```
index.html login.html change-password.html admin.html teacher.html student.html
css/style.css
js/  auth.js admin.js teacher.js student.js omr.js files.js firebase-config.js
functions/  index.js package.json          (optional, README step G)
firestore.rules firebase.json firestore.indexes.json
```

## Update an existing project (do these in order)
1. Replace all files with this version (keep your own `js/firebase-config.js`).
2. **Firestore Database > Rules** > paste the whole new `firestore.rules` > **Publish**. This fixes the scanner error *"You do not have permission for that action"* and adds the rules for students, modules and term data.
3. Authentication > Settings > Authorized domains: make sure `USERNAME.github.io` is listed.
4. Optional but recommended: step G (Cloud Function) for permanently removing accounts and resetting student passwords.
5. **Reprint answer sheets** made with the old version. The bubble grid now resizes to fit the paper, so old sheets will not scan.
6. Students created with the old version have no birthday and an old Exam ID No. format. Add them again (or import the class list again) so they can have logins.

## What changed
**Scanner permission error.** The scanner checks whether a result already exists before saving. The old rule read `resource.data.ownerUid`, which does not exist for a new result, so Firebase refused. The rule now allows that lookup for the owner.

**IT Admin**
- *Accounts* tab lists teachers and students. **Remove account** deletes the login from Firebase Authentication and the data in Firestore (needs step G; teacher removal also deletes their sections, students, exams, results and modules). Without step G the button removes access and tells you to finish in the Firebase console.
- **Teacher tools** link: the admin has every teacher feature (sections, students, exams, scanner, modules, results) using the same teacher page.

**Sign-up (no approval needed)** on the sign-in page
- Teacher: name, email, employee ID, temporary password. Must choose a new password at first sign-in.
- Student: Exam ID No. + birthday (must match the teacher's record) + temporary password. Must choose a new password at first sign-in.

**Teacher**
- *Students*: Exam ID No., Last name, First name, M.I., Birthday, Age (calculated). Exam ID No. is unique across all teachers. Excel/CSV import with columns *Exam ID No., Last Name, First Name, M.I., Birthday*.
- *Student logins*: Create login per student or for a whole section. Username = Exam ID No., password = birth year + first letter of last name (e.g. `2012D`). Reset password button (step G).
- *Examinations*: choose a **Term / quarter**, list is grouped by term with a filter, **Delete** removes the exam and its results.
- *Modules*: upload a file (up to 8 MB) or paste a link, per term and per section or all sections. Files are stored inside Firestore because Cloud Storage needs a paid plan.
- *Answer sheets*: bubbles **fit the paper automatically**: few items = big bubbles, up to 100 items = smaller bubbles in more columns.

**Student page**: exam results (by term, with the items they missed) and the teacher's modules (by term).

## Step G: Cloud Function (Blaze plan, school use stays in the free quota)
Needed only for: permanently removing accounts from Firebase Authentication, setting temporary passwords, resetting student passwords.
```
firebase use exam-scanner-ac29e
cd functions && npm install && cd ..
firebase deploy --only functions
```
(Install Node 20 and `npm install -g firebase-tools`, `firebase login` first.)

## Notes and limits
- Teacher sign-up is open: anyone who knows the site address can create a teacher account. The admin can suspend or remove accounts. If you want it closed, tell me and I will add a school registration code.
- Students sign in with an internal email `EXAMID@student.ark-exam.app` (Firebase needs an email). Password-reset emails do not work for students: the teacher resets it (step G).
- `2012D` is only 5 characters and Firebase needs 6, so the system adds a hidden suffix for short temporary passwords. Students never see it.
- Students only see their own results, and modules from their own teacher and section. They cannot read the answer key.
- Firestore free quota: 1 GiB, 50,000 reads and 20,000 writes per day.
