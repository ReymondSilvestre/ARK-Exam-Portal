// Pure helpers shared by the answer-sheet printer, the scanner and the results page.
// No DOM and no Firebase in here, so it can be tested in Node.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- item types ---------- */
export const TYPES = {
  mc: "Multiple choice (A-E)",
  tf: "True or False",
  ident: "Identification (teacher checks)",
  essay: "Essay (teacher checks)",
};
export const TYPE_SHORT = { mc: "Multiple choice", tf: "True/False", ident: "Identification", essay: "Essay" };
/** Multiple choice and True/False are read by the scanner. Identification and essay are checked by the teacher. */
export const isAuto = (t) => t === "mc" || t === "tf";

/** Exams made before this version only had a `key` array: treat them as all multiple choice. */
export function itemsOf(ex) {
  if (Array.isArray(ex.items) && ex.items.length)
    return ex.items.map((x) => ({ type: x.type || "mc", key: x.key || "", pts: +x.pts > 0 ? +x.pts : 1 }));
  return (ex.key || []).map((k) => ({ type: "mc", key: k, pts: 1 }));
}
/** The bubbles an item has, in print order. */
export const lettersOf = (item, ex) =>
  item.type === "tf" ? ["T", "F"] : "ABCDE".slice(0, +ex.choices || 5).split("");

/* ---------- sheet geometry ----------
   One sheet is HALF of an 8.5 x 13 in landscape page: 6.5 x 8.5 in portrait (165.1 x 215.9 mm).
   Units below are millimetres. Printing and scanning both use these numbers. */
export const PAGE = { w: 165.1, h: 215.9 };
export const G = {
  mk: [[9, 9], [156.1, 9], [9, 206.9], [156.1, 206.9]], // corner squares: TL, TR, BL, BR (centres)
  mkSize: 8, r: 2.4, pitch: 7.2, rows: 20, cols: 3, colW: 46, x0: 14, y0: 72, rowH: 6,
};
export const MAX_ITEMS = G.rows * G.cols; // 60
export const qPos = (i, j) => [G.x0 + Math.floor(i / G.rows) * G.colW + 10 + j * G.pitch, G.y0 + (i % G.rows) * G.rowH];

/** One answer sheet as SVG. `o.student` = {name, number, className} prints a named sheet. */
export function sheetSVG(ex, o = {}) {
  const items = itemsOf(ex), st = o.student, cx = PAGE.w / 2;
  const total = items.reduce((a, b) => a + b.pts, 0);
  const T = (x, y, s, t, a = "start", w = 400, fill = "#000") =>
    `<text x="${x}" y="${y}" font-size="${s}" text-anchor="${a}" font-weight="${w}" fill="${fill}">${esc(t)}</text>`;
  const Ln = (x1, y1, x2, y2, w = 0.3) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${w}"/>`;
  let s = `<svg viewBox="0 0 ${PAGE.w} ${PAGE.h}" xmlns="http://www.w3.org/2000/svg" font-family="Arial,Helvetica,sans-serif"><rect width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>`;
  G.mk.forEach(([x, y]) => (s += `<rect x="${x - G.mkSize / 2}" y="${y - G.mkSize / 2}" width="${G.mkSize}" height="${G.mkSize}"/>`));

  s += T(cx, 17, 5, o.school || "School name", "middle", 700) + T(cx, 23, 3.8, ex.title, "middle", 700);
  s += T(14, 31, 3, "Subject: " + (ex.subject || "")) + T(88, 31, 3, "Date: " + (ex.date || "____________"));
  // Name (pre-printed for named sheets)
  s += T(14, 39, 3, "Name:") + Ln(26, 39.6, 84, 39.6);
  if (st) s += T(27, 38.6, st.name.length > 30 ? 2.8 : 3.6, st.name, "start", 700);
  // Exam ID No. box
  s += T(88, 39, 3, "Exam ID No.:") + `<rect x="112" y="34.4" width="39" height="7" fill="none" stroke="#000" stroke-width=".35"/>`;
  if (st) s += T(131.5, 39.4, 3.8, st.number, "middle", 700);
  // Section and teacher
  const sec = st ? st.className : ex.className && ex.className !== "All sections" ? ex.className : "";
  s += T(14, 47, 3, "Section:") + (sec ? T(30, 47, 3.2, sec, "start", 700) : Ln(30, 47.6, 84, 47.6));
  s += T(88, 47, 3, "Teacher:") + (o.teacher ? T(103, 47, 3.2, o.teacher, "start", 700) : Ln(103, 47.6, 151, 47.6));
  s += T(14, 54, 3, `Items: ${items.length}    Total points: ${total}`) + T(88, 54, 3, `Score: ________ / ${total}`);
  s += T(14, 59.5, 2.3, "Shade ONE bubble completely for each number. Do not fold, stain or write on the black squares.", "start", 400, "#333");
  s += T(14, 63, 2.3, "Identification: write the answer on the line.  Essay: write on separate paper. Your teacher checks these.", "start", 400, "#333");
  s += Ln(14, 66, 151, 66, 0.2);

  items.forEach((it, i) => {
    const [x1, y] = qPos(i, 0);
    s += T(x1 - 4, y + 1, 3, i + 1, "end");
    if (it.type === "mc" || it.type === "tf") {
      lettersOf(it, ex).forEach((l, j) => {
        const [x] = qPos(i, j);
        s += `<circle cx="${x}" cy="${y}" r="${G.r}" fill="none" stroke="#000" stroke-width=".3"/>` + T(x, y + 0.85, 2.4, l, "middle", 400, "#777");
      });
    } else if (it.type === "ident") s += Ln(x1 - 2.4, y + 1.6, x1 + 31, y + 1.6);
    else s += T(x1 - 2.4, y + 0.9, 2.3, "Essay - separate paper", "start", 400, "#555");
  });
  return s + T(cx, 211.5, 2.2, `${ex.title}  |  Exam ID ${ex.id || ""}  |  ARK sheet v2`, "middle", 400, "#555") + "</svg>";
}

/* ---------- scanner ---------- */
/** g = grayscale pixels, w x h. ctx (optional) gets red debug circles. Returns {answers, flags} or {err}. */
export function scanSheet(g, w, h, ex, ctx) {
  const items = itemsOf(ex);
  // Otsu threshold
  const hist = new Array(256).fill(0); g.forEach((v) => hist[v]++);
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, T = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; const wF = g.length - wB; if (!wB) continue; if (!wF) break; sB += i * hist[i];
    const b = wB * wF * (sB / wB - (sum - sB) / wF) ** 2; if (b > best) { best = b; T = i; }
  }
  // Find the four corner squares (one dark square in each image corner region).
  const pts = [];
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x0 = cx ? Math.floor(w * 0.6) : 0, x1 = cx ? w : Math.ceil(w * 0.4), y0 = cy ? Math.floor(h * 0.6) : 0, y1 = cy ? h : Math.ceil(h * 0.4);
    const rw = x1 - x0, seen = new Uint8Array(rw * (y1 - y0)); let pick = null, pd = 1e12;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const id = (y - y0) * rw + (x - x0); if (seen[id] || g[y * w + x] >= T) continue;
      const st = [x, y]; seen[id] = 1; let a = 0, sx = 0, sy = 0, mnx = x, mxx = x, mny = y, mxy = y;
      while (st.length) {
        const py = st.pop(), px = st.pop(); a++; sx += px; sy += py; mnx = Math.min(mnx, px); mxx = Math.max(mxx, px); mny = Math.min(mny, py); mxy = Math.max(mxy, py);
        for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const j = (ny - y0) * rw + (nx - x0); if (!seen[j] && g[ny * w + nx] < T) { seen[j] = 1; st.push(nx, ny); }
        }
      }
      const bw = mxx - mnx + 1, bh = mxy - mny + 1;
      if (a > 80 && bw < w * 0.15 && bw / bh > 0.6 && bw / bh < 1.6 && a / (bw * bh) > 0.75) {
        const dd = (sx / a - (cx ? w : 0)) ** 2 + (sy / a - (cy ? h : 0)) ** 2; if (dd < pd) { pd = dd; pick = [sx / a, sy / a]; }
      }
    }
    if (!pick) return { err: "Could not find all 4 corner squares. Keep the whole sheet in view (one sheet only), flat, upright and well lit." };
    pts.push(pick);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const exp = (G.mk[2][1] - G.mk[0][1]) / (G.mk[1][0] - G.mk[0][0]), ratio = dist(pts[0], pts[2]) / dist(pts[0], pts[1]);
  if (ratio < exp * 0.8 || ratio > exp * 1.25) return { err: "The sheet looks rotated or badly angled. Hold it upright (portrait) and try again." };

  // Homography: sheet millimetres -> image pixels
  const A = [];
  G.mk.forEach(([sx, sy], i) => { const [ix, iy] = pts[i];
    A.push([sx, sy, 1, 0, 0, 0, -ix * sx, -ix * sy, ix], [0, 0, 0, sx, sy, 1, -iy * sx, -iy * sy, iy]); });
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  const H = A.map((r, i) => r[8] / r[i]);
  const map = (x, y) => { const q = H[6] * x + H[7] * y + 1; return [(H[0] * x + H[1] * y + H[2]) / q, (H[3] * x + H[4] * y + H[5]) / q]; };
  const sc = dist(pts[0], pts[1]) / (G.mk[1][0] - G.mk[0][0]); // pixels per mm
  const mean = (x, y, r) => {
    let s = 0, n = 0;
    for (let yy = Math.floor(y - r); yy <= y + r; yy++) for (let xx = Math.floor(x - r); xx <= x + r; xx++)
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && (xx - x) ** 2 + (yy - y) ** 2 <= r * r) { s += g[yy * w + xx]; n++; }
    return n ? s / n : 255;
  };
  const black = pts.reduce((s, p) => s + mean(p[0], p[1], 2), 0) / 4;
  if (ctx) { ctx.strokeStyle = "#e11"; ctx.lineWidth = 1; }
  const answers = [], flags = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type !== "mc" && it.type !== "tf") { answers.push(""); flags.push(false); continue; } // teacher checks these
    const letters = lettersOf(it, ex), xy = letters.map((_, j) => qPos(i, j));
    const gaps = xy.slice(0, -1).map(([x, y]) => mean(...map(x + G.pitch / 2, y), 1.0 * sc));
    const paper = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (paper - black < 40) return { err: "Not enough contrast. Use better, even lighting and a darker pencil or pen." };
    const raw = xy.map(([x, y]) => {
      const [px, py] = map(x, y);
      if (ctx) { ctx.beginPath(); ctx.arc(px, py, 1.5 * sc, 0, 7); ctx.stroke(); }
      return Math.min(1, Math.max(0, (paper - mean(px, py, 1.5 * sc)) / (paper - black)));
    });
    // The small printed letter inside each bubble adds a little ink to every bubble: remove that common baseline.
    const base = Math.min(Math.min(...raw), 0.3), fill = raw.map((v) => Math.max(0, (v - base) / (1 - base)));
    const on = fill.map((v, j) => (v > 0.5 ? j : -1)).filter((j) => j >= 0);
    answers.push(on.length === 0 ? "" : on.length > 1 ? "*" : letters[on[0]]);
    flags.push(on.length > 1 || fill.some((v) => v > 0.25 && v <= 0.5));
  }
  return { answers, flags };
}

/* ---------- scoring ----------
   answers[i]: "" blank, "*" more than one bubble, or the letter.
   manual[i]: points awarded by the teacher for identification/essay items, or null = not checked yet. */
export function score(ex, answers = [], manual = []) {
  const items = itemsOf(ex);
  let points = 0, max = 0, correct = 0, wrong = 0, blank = 0, multi = 0, pending = 0; const missed = [];
  items.forEach((it, i) => {
    const p = it.pts; max += p; const a = answers[i] ?? "";
    if (it.type === "mc" || it.type === "tf") {
      if (a === it.key) { points += p; correct++; return; }
      if (a === "") blank++; else if (a === "*") multi++; else wrong++;
      missed.push({ i, type: it.type, given: a, key: it.key, pts: p, awarded: 0 });
    } else {
      const m = manual[i];
      if (m === null || m === undefined || m === "") { pending++; return; }
      const v = Math.min(p, Math.max(0, +m)); points += v;
      if (v >= p) correct++; else { wrong++; missed.push({ i, type: it.type, given: "", key: "", pts: p, awarded: v }); }
    }
  });
  const pct = max ? Math.round((points / max) * 1000) / 10 : 0;
  return { correct, wrong, blank, multi, pending, total: items.length, points, maxPoints: max, pct, final: pending === 0, pass: pending === 0 && pct >= (ex.passing || 75), missed };
}
/** Short text for one missed item, e.g. "#3 B>C", "#7 blank>A", "#21 0/2". */
export function missedText(m) {
  if (m.type === "mc" || m.type === "tf") return `#${m.i + 1} ${m.given === "" ? "blank" : m.given === "*" ? "multi" : m.given} → ${m.key}`;
  return `#${m.i + 1} ${m.awarded}/${m.pts}`;
}
