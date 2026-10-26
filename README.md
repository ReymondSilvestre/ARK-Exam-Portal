# ARK Exam Scanner - Phase 1 (free Spark plan, no credit card)

Static site on GitHub Pages + Firebase Auth + Firestore. No Cloud Functions, no tools to install.

## A. Firebase project
1. console.firebase.google.com > Add project (Analytics off). Stay on the free **Spark** plan.
2. Build > Authentication > Get started > Email/Password > Enable.
3. Build > Firestore Database > Create database > production mode.
4. Project settings > General > Your apps > Web (</>) > register app (no Hosting). Copy config into `js/firebase-config.js`.

## B. Publish the security rules (important)
Firestore Database > **Rules** tab > delete everything > paste the contents of `firestore.rules` > **Publish**.

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

## Free-plan limits and trade-offs
- Firestore free quota: 1 GiB, 50,000 reads and 20,000 writes per day. Ample for one school.
- Admin cannot set another user's password; resets go by email link, so teacher emails must be real.
- Suspension blocks all data access immediately via rules; the Auth login itself still exists.
- Stray accounts: anyone could create an Auth login with your public API key, but without an admin-created profile they can read and write nothing.
- Cloud Storage needs the paid plan for new projects, so scan images will not be stored in Phase 4+ (only the results).
