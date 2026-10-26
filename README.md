# Offline Exam Scanner
Files: index.html, style.css, script.js, **Code.gs** (Google Apps Script), lib/ (qrcode, jsQR, SheetJS – bundled, no CDN), samples/.

## Run
Open a terminal in this folder: `python3 -m http.server 8000`, then browse to http://localhost:8000 (Chrome or Edge recommended). Camera and spreadsheet-file linking need localhost. Scanning works offline; Google Sheets sync needs internet (it queues and retries automatically when offline).

## First use
1. The permanent IT Admin (`reymonde.silvestre@gmail.com`) already exists in Code.gs - there is no setup screen. Sign in, then press **Change password** in the left menu.
2. Teachers choose "Request an account" (from any browser/device); the IT admin approves them under Users. Accounts, students, exams, keys and results live in the Google Sheet (tabs `_db_*`), so they follow the user to every browser and device. Use **Refresh data** to pull the latest.
3. Admin: Students -> register or import (samples/sample-students.csv). Students are grouped per grade and section.
4. Teacher: Exams -> create, tick the grade/sections -> Questions & Key -> Answer Sheets -> print on 8.5x13 (scale 100%, margins none), cut on dashed lines -> Scan Paper.
5. Admin: Database & Settings -> Google Sheets (below), and optionally Link spreadsheet file (local exam-database.xlsx backup).

## Scanning
- Start camera -> hold the cut sheet flat and upright, all 4 black corner squares visible -> **Scan & process** (it takes a fresh picture itself; *Capture* is only needed to freeze a frame). Or use *Upload image*.
- The picture is marked: **red squares** = corner markers found, **green circles** = answers read, **orange** = doubtful.
- A pop-up shows the animated result (score ring, passed/failed, correct/wrong/blank/ambiguous). Close it with the **×** button, **Esc**, a click outside, or its button. Then review/edit the answers below and press **Confirm & save result** (a second pop-up confirms the save and the Google Sheets upload).
- Failures now show a clear pop-up message (before, errors could leave "Processing…" forever).

## Google Sheets setup (3 steps)
1. Open your Google Sheet -> **Extensions > Apps Script**. Replace the code with the contents of **Code.gs** and save.
   (If your script is a standalone project, put the spreadsheet ID in `SPREADSHEET_ID` at the top of Code.gs.)
2. **Deploy > Manage deployments** -> pencil on your existing deployment -> Version: **New version** -> *Execute as*: **Me**, *Who has access*: **Anyone** -> Deploy. The deployment ID stays the same.
   The first time, run `doGet` once from the editor and accept the permissions.
3. In the app: **Database & Settings > Google Sheets**. Your deployment ID is already filled in. Press **Test connection**, then **Sync everything now**.

What appears in the spreadsheet (created automatically, updated after every scan/key/exam/student change):
- One tab per **teacher + exam + grade/section**, e.g. `Cruz EX-1A2B3C G7-Rizal`: student list, score, %, status, every answer (green = correct, red = wrong, yellow = ambiguous, blue = essay score), with the **ANSWER KEY** and POINTS rows frozen on top. Students not yet scanned show *NOT SCANNED*.
- One **answer-key tab per exam**: `KEY Cruz EX-1A2B3C` (type, correct answer, points).
- **Index - Teachers**: every teacher/exam/section with counts, average, pass rate and clickable links.

Notes: password hashes are never sent to Google. Anyone who knows the deployment URL could post data, so set a **Secret token** (same value in Code.gs `TOKEN` and in the app settings) if the URL may be shared. Deleting an exam in the app does not delete its tabs in Google Sheets. Tab names are limited to 31 characters.

## Notes
- Bubble items (multiple choice, true/false) are read by the camera. Identification answers and essay scores are typed by the teacher in the review screen.
- Up to 60 items: 4 sheets per page. 61-100 items: 2 larger sheets per page.
- Gmail sign-up is a local account with IT approval; the address is not verified with Google.
- The local .xlsx holds password hashes: protect the file. Single-writer file, last save wins.
