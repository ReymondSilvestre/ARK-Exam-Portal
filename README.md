# ARK Exam Scanner - Phase 1 (free Spark plan, no credit card)

Static site on GitHub Pages + Firebase Auth + Firestore. No Cloud Functions, no tools to install.

## A. Firebase project
1. console.firebase.google.com > Add project (Analytics off). Stay on the free **Spark** plan.
2. Build > Authentication > Get started > Email/Password > Enable.
3. Build > Firestore Database > Create database > production mode.
4. Project settings > General > Your apps > Web (</>) > register app (no Hosting). Copy config into `js/firebase-config.js`.

## B. Publish the security rules (important)
Firestore Database > **Rules** tab > delete everything > paste the contents of `firestore.rules` > **Publish**.
**Re-publish them after every update of this project.** This version adds the `resetRequests` rule; without it the "request a reset" button on the sign-in page will fail.

## C. Create the first administrator (in the console)
1. Authentication > Users > **Add user**: `reymonde.sivlestre@gmail.com` + a temporary password you choose (10+ chars, letter and number). Copy the **User UID**.
2. Firestore Database > **Start collection** `users` > Document ID = that **UID** > add fields:
   - `uid` (string) = the UID
   - `role` (string) = `admin`
   - `displayName` (string) = `IT Administrator`
   - `email` (string) = `reymonde.sivlestre@gmail.com`
   - `employeeId` (string) = `ADMIN`
   - `status` (string) = `active`
   - `mustChangePassword` (boolean) = `true`
3. The password lives only in Firebase; it is not in any file. You must change it at first sign-in.

## D. GitHub Pages
Upload the folder contents (index.html at repo root) > Settings > Pages > main / root.

## E. Authorize the domain
Authentication > Settings > Authorized domains > Add `USERNAME.github.io`.

## F. Test
Admin signs in > forced password change > dashboard > create teacher (copy temp password) > teacher signs in in a private window > forced change > teacher page > admin suspends teacher > teacher is refused > reactivate.

## G. Optional: temporary password set by the IT Admin (no email)
Firebase only lets *server code* change another person's password, so this needs one small Cloud Function and the **Blaze** plan (a card is required; school-size use stays inside the free monthly quota, and you can set a budget alert at $1). Until you do this, the admin buttons **Set temporary password** show a message and **Email reset link** keeps working.
1. Firebase console > upgrade the project to **Blaze**.
2. On a computer install Node.js (version 20), then in a terminal: `npm install -g firebase-tools` and `firebase login`.
3. Open a terminal in this project folder and run:
   `firebase use exam-scanner-ac29e`
   `cd functions && npm install && cd ..`
   `firebase deploy --only functions`
4. Done. In the admin page, **Reset requests > Set temporary password** shows a one-time password. Give it to the teacher in person. Their old password stops working and they must choose a new one at the next sign-in.

## Free-plan limits and trade-offs
- Firestore free quota: 1 GiB, 50,000 reads and 20,000 writes per day. Ample for one school.
- Without step G the admin cannot set another user's password; resets go by email link, so teacher emails must be real.
- If the **admin** forgets their own password, use Firebase console > Authentication > Users > (the admin) > Reset password. The admin cannot use the request button because nobody could approve it.
- Suspension blocks all data access immediately via rules; the Auth login itself still exists.
- Stray accounts: anyone could create an Auth login with your public API key, but without an admin-created profile they can read and write nothing.
- Cloud Storage needs the paid plan for new projects, so scan images will not be stored in Phase 4+ (only the results).

## What is new in this version

**Password reset through the IT Admin.** On the sign-in page a teacher taps "Forgot your password? Ask the IT Admin" and enters their email (and optionally their employee ID). The request appears in the admin's **Reset requests** tab with a count badge. The admin checks the match (email found / employee ID matches) and taps **Send reset link**, which emails the link to the address *registered on the account*. Requests can also be dismissed. Everything is written to the activity log. Nothing is emailed until the admin approves.

**Examinations.** Every number has a collapsible row (tap to open). Choose the type per number: Multiple choice (A-E, or A-D), True/False, Identification or Essay. Multiple choice and True/False need a key and are scanned; Identification and Essay are marked by the teacher. Each number can carry its own points. "Set items from..to..as..", "Expand all" and "Collapse all" speed up long exams, and "Edit key" reopens a saved exam (saved results are re-scored automatically).

**Students.** "Student no." is now **Exam ID No.** and is created automatically (`2026-0001`, `2026-0002`, ...). It is only taken from a file when you import one (Excel `.xlsx` or CSV with columns *Exam ID No., Name*; blank cells and names-only files are filled automatically; duplicates are skipped).

**Answer sheets.** Paper is **8.5 x 13 in landscape, two sheets per page**. Print for a whole section to get **named sheets** (student name, Exam ID No., section and **teacher name** pre-printed), or print blank sheets. Print dialog: paper 8.5 x 13 (Folio/Long), Margins None, Scale 100%. Cut along the dotted line and scan **one sheet at a time**. One sheet holds up to 60 items.

**Scanner.** Type the Exam ID No. printed on the sheet to pick the student instantly (or choose by section). Identification and essay items appear as "to check" boxes; mark them after scanning, or later from Results (**Check** button).

**Results.** Filter by section; sort by section then name, section then score, score, most wrong answers, name or Exam ID No. Each student shows exactly which numbers were wrong (`#4 B > C`, `#7 blank > A`, `#21 0/2`). **Download Excel** gives: All results, Wrong answers (one row per missed item), Item analysis, and one sheet per section.

Sheets printed with the old version (A4, 4 corner squares at different positions) cannot be scanned by this version: reprint them.
