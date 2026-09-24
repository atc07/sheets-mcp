// Concept: faint spreadsheet gridlines, rotated 45°, behind the whole page, rippling in slow waves.
// A glow starts on the logo's sparkle and runs along the gridlines as you scroll, routed through open
// space where it can. It ends behind the "More from us" app cards, where it bursts into a new background.
// Drawn on one fixed canvas behind the content; only the visible part of the grid is drawn each frame.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Older Safari has no canvas roundRect; a simple stand-in keeps the sheets drawing.
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const [tl, tr, br, bl] = Array.isArray(r) ? [r[0], r[1] ?? r[0], r[2] ?? r[0], r[3] ?? r[1] ?? r[0]] : [r, r, r, r];
      this.moveTo(x + tl, y); this.lineTo(x + w - tr, y); this.quadraticCurveTo(x + w, y, x + w, y + tr);
      this.lineTo(x + w, y + h - br); this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
      this.lineTo(x + bl, y + h); this.quadraticCurveTo(x, y + h, x, y + h - bl);
      this.lineTo(x, y + tl); this.quadraticCurveTo(x, y, x + tl, y);
    };
  }
  const params = new URLSearchParams(location.search);
  const showRoute = params.has("route"); // ?route draws the whole route bold, for reviewing it

  const canvas = document.createElement("canvas");
  canvas.className = "web";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  // A second canvas in front of the page, used only at the end: the glow travels over the covered app
  // cards and explodes on top of them.
  const front = document.createElement("canvas");
  front.className = "web web-front";
  front.setAttribute("aria-hidden", "true");
  document.body.append(front);
  const fx = front.getContext("2d");

  // The waves: a slow, smooth displacement of the grid that drifts over time (t in seconds).
  // Kept gentle enough (slope well under 1) that lines never fold over each other.
  const warp = (x, y, t) => ({
    x: x + 70 * Math.sin(y / 320 + x / 700 + t * 0.22) + 22 * Math.sin(y / 150 + x / 380 + 1.3 + t * 0.35),
    y: y + 40 * Math.sin(x / 280 + y / 560 + t * 0.28) + 14 * Math.sin(x / 140 + y / 460 + 0.4 - t * 0.32),
  });

  // Colours follow the site's light/dark theme.
  let ink = "23, 23, 22";
  const readInk = () => {
    const probe = document.createElement("span");
    probe.style.color = "var(--fg)";
    document.body.append(probe);
    const raw = getComputedStyle(probe).color, n = (raw.match(/-?[\d.]+/g) || [23, 23, 22]).map(Number);
    const unit = /^color\(/.test(raw) ? 255 : 1;
    ink = n.slice(0, 3).map((v) => Math.round(v * unit)).join(", ");
    probe.remove();
  };
  const dark = matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", readInk);

  // Where the content is: text, buttons, images and anything with a background (cards, chips, panes).
  const TEXT = new Set(["H1", "H2", "H3", "H4", "P", "LI", "SUMMARY", "BUTTON", "IMG", "PRE", "TABLE", "FIGURE"]);
  function contentMap() {
    const bands = new Map(), PAD = 14, sy = scrollY;
    for (const el of document.body.querySelectorAll("*")) {
      if (el === canvas || el.closest(".concept-flag, script, style")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.height > 1400) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const bg = cs.backgroundColor, solid = bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg);
      if (!solid && !TEXT.has(el.tagName) && cs.boxShadow === "none") continue;
      const box = { l: r.left - PAD, r: r.right + PAD, t: r.top + sy - PAD, b: r.bottom + sy + PAD };
      for (let k = Math.floor(box.t / 200); k <= Math.floor(box.b / 200); k++) (bands.get(k) ?? bands.set(k, []).get(k)).push(box);
    }
    return (x, y) => (bands.get(Math.floor(y / 200)) ?? []).some((b) => x >= b.l && x <= b.r && y >= b.t && y <= b.b);
  }

  // Grid geometry (in unwarped page coordinates) and the glow's route through it.
  let G = null, route = [], cum = [], startY = 0, endY = 0, burst = null, frontFrom = Infinity;
  function build() {
    const W = document.documentElement.clientWidth, H = document.documentElement.scrollHeight;
    const covered = contentMap();
    // The grid is rotated 45°: lines run down-right (e1) and down-left (e2), so every step along a line
    // goes down the page. Cells keep spreadsheet proportions (long and short sides).
    const su = W < 700 ? 72 : 88, sv = W < 700 ? 26 : 32, R = Math.SQRT1_2;
    const O = { x: W / 2, y: 0 };
    const toPage = (i, j) => ({ x: O.x + (i * su - j * sv) * R, y: O.y + (i * su + j * sv) * R });
    const toGrid = (x, y) => ({ i: ((x - O.x) + (y - O.y)) * R / su, j: (-(x - O.x) + (y - O.y)) * R / sv });
    const corners = [toGrid(-80, -80), toGrid(W + 80, -80), toGrid(-80, H + 400), toGrid(W + 80, H + 400)];
    const i0 = Math.floor(Math.min(...corners.map((c) => c.i))), i1 = Math.ceil(Math.max(...corners.map((c) => c.i)));
    const j0 = Math.floor(Math.min(...corners.map((c) => c.j))), j1 = Math.ceil(Math.max(...corners.map((c) => c.j)));
    G = { W, H, su, sv, toPage, toGrid };
    const seg = (a, b) => {
      const n = Math.max(2, Math.round(Math.hypot(b.bx - a.bx, b.by - a.by) / 8));
      return Array.from({ length: n + 1 }, (_, k) => ({ x: a.bx + ((b.bx - a.bx) * k) / n, y: a.by + ((b.by - a.by) * k) / n }));
    };

    // Every intersection that lands on (or just around) the page, linked to its downhill neighbours.
    const nodes = [], at = new Map();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const b = toPage(i, j);
      if (b.x < -120 || b.x > W + 120 || b.y < -120 || b.y > H + 400) continue;
      const n = { bx: b.x, by: b.y, ...warp(b.x, b.y, 0), i, j, id: nodes.length, links: [] };
      nodes.push(n); at.set(`${i},${j}`, n);
    }
    const link = (a, b) => {
      const pts = seg(a, b);
      const hit = pts.filter((p) => { const w = warp(p.x, p.y, 0); return covered(w.x, w.y); }).length / pts.length;
      a.links.push({ to: b, pts, hit });
    };
    for (const n of nodes) {
      const dr = at.get(`${n.i + 1},${n.j}`), dl = at.get(`${n.i},${n.j + 1}`);
      if (dr) link(n, dr);
      if (dl) link(n, dl);
    }

    // The glow starts on the logo's sparkle and joins the grid at the nearest intersection.
    const sparkBox = document.getElementById("brand-spark")?.getBoundingClientRect();
    const logo = sparkBox ? { x: sparkBox.left + sparkBox.width / 2, y: sparkBox.top + sparkBox.height / 2 + scrollY, fixed: true } : { x: W / 2, y: 0, fixed: true };
    const first = nodes.reduce((best, n) => (Math.hypot(n.x - logo.x, n.y - logo.y) < Math.hypot(best.x - logo.x, best.y - logo.y) ? n : best));

    // Zones: the page is split at the empty gaps between sections. Each zone has a side the route
    // prefers (two zones on the logo's side, then two on the other, and so on), so it hugs one margin at a time and
    // cuts across through a gap when the zone changes.
    const gaps = [];
    let runStart = null;
    for (let y = logo.y + 60; y < H - 100; y += 12) {
      let free = 0, count = 0;
      for (let x = W * 0.08; x <= W * 0.92; x += 32) { count++; if (!covered(x, y)) free++; }
      const open = free / count > 0.9;
      if (open && runStart === null) runStart = y;
      if (!open && runStart !== null) { if (y - runStart >= 60) gaps.push((runStart + y) / 2); runStart = null; }
    }
    const startSide = logo.x < W / 2 ? 0 : 1;
    const sideX = (y) => {
      const zone = gaps.filter((g) => g < y).length;
      return (startSide + Math.floor(zone / 2)) % 2 ? W * 0.93 : W * 0.07; // two zones per side, starting on the logo's side
    };

    const cost = (from, l) => {
      if (l.to.x < 10 || l.to.x > W - 10) return Infinity;     // stay on screen
      const len = Math.hypot(l.to.bx - from.bx, l.to.by - from.by);
      const away = Math.abs(l.to.x - sideX(l.to.y)) / W;        // 0 on the preferred side, ~0.86 on the other
      return len * (1 + 10 * l.hit + 24 * away * away * 4);
    };
    const search = (from, isGoal) => {
      const dist = new Float64Array(nodes.length).fill(Infinity), via = new Array(nodes.length);
      dist[from.id] = 0;
      const open = [from];
      while (open.length) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (dist[open[k].id] < dist[open[bi].id]) bi = k;
        const n = open.splice(bi, 1)[0];
        if (isGoal(n)) {
          const legs = [];
          for (let m = n; via[m.id]; m = via[m.id][0]) legs.unshift(via[m.id][1]);
          return { end: n, legs };
        }
        for (const l of n.links) {
          const nd = dist[n.id] + cost(n, l);
          if (nd < dist[l.to.id]) { if (dist[l.to.id] === Infinity) open.push(l.to); dist[l.to.id] = nd; via[l.to.id] = [n, l]; }
        }
      }
      return null;
    };

    window.__zones = { gaps: gaps.map(Math.round), sides: [0, ...gaps].map((g) => Math.round(sideX(g + 1))) };
    // The route ends behind the "More from us" app cards, in the middle, where the glow bursts.
    const apps = document.querySelector("#more .apps")?.getBoundingClientRect();
    burst = apps ? { x: apps.left + apps.width / 2, y: apps.top + scrollY + apps.height * 0.38, top: apps.top + scrollY } : { x: W / 2, y: H - 240, top: H - 400 };
    const dock = nodes.filter((n) => n.i >= first.i && n.j >= first.j && n.x > 12 && n.x < W - 12)
      .reduce((best, n) => (Math.hypot(n.bx - burst.x, n.by - burst.y) < Math.hypot(best.bx - burst.x, best.by - burst.y) ? n : best));
    const legs = [];
    let cur = first;
    const whole = search(first, (n) => n === dock);
    if (whole) { legs.push(...whole.legs); cur = whole.end; }

    // Assemble in unwarped coordinates: logo → grid → … → past the bottom of the page.
    // The first stretch eases off the logo: points start pinned to it (fix = 1) and blend into the
    // waving grid (fix = 0) by the time they reach the first junction, so there's no jump.
    route = [];
    const lead = Math.max(2, Math.round(Math.hypot(first.bx - logo.x, first.by - logo.y) / 4));
    for (let k = 0; k <= lead; k++) {
      const f = k / lead;
      route.push({ x: logo.x + (first.bx - logo.x) * f, y: logo.y + (first.by - logo.y) * f, fix: 1 - f * f * (3 - 2 * f) });
    }
    for (const l of legs) route.push(...l.pts.slice(1));
    // Final few pixels: ease off the waving grid onto the exact burst point.
    const tailN = Math.max(2, Math.round(Math.hypot(burst.x - cur.bx, burst.y - cur.by) / 4));
    for (let k = 1; k <= tailN; k++) {
      const f = k / tailN;
      route.push({ x: cur.bx + (burst.x - cur.bx) * f, y: cur.by + (burst.y - cur.by) * f, fix: f * f * (3 - 2 * f) });
    }
    cum = [0];
    for (let k = 1; k < route.length; k++) cum.push(cum[k - 1] + Math.hypot(route[k].x - route[k - 1].x, route[k].y - route[k - 1].y));
    let ym = -Infinity;
    for (const p of route) p.ym = ym = Math.max(ym, p.y);
    startY = logo.y;
    endY = burst.y;
    // From the top of the "More from us" section onward, the glow is drawn in front of the page.
    const more = document.getElementById("more");
    frontFrom = more ? indexForY(more.getBoundingClientRect().top + scrollY) : Infinity;
  }

  const indexForY = (y) => {
    let lo = 0, hi = route.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (route[mid].ym < y) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const place = (p, t) => {
    const w = warp(p.x, p.y, t), f = p.fix ?? 0;
    return f ? { x: p.x * f + w.x * (1 - f), y: p.y * f + w.y * (1 - f) } : w;
  };
  // A point part-way between two route points, so the glow glides instead of stepping.
  const placeAt = (pos, t) => {
    const a = Math.max(0, Math.min(route.length - 1, Math.floor(pos))), b = Math.min(route.length - 1, a + 1), f = pos - a;
    const pa = place(route[a], t), pb = place(route[b], t);
    return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f };
  };

  function size() {
    // The background grid is faint 1px lines, so it's drawn at standard resolution (a quarter of the
    // pixels of retina, which is what keeps Safari's frame rate up); the glow and shards stay sharp.
    canvas.width = innerWidth; canvas.height = innerHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = Math.min(2, devicePixelRatio || 1);
    front.width = Math.round(innerWidth * dpr); front.height = Math.round(innerHeight * dpr);
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // The scroll position at which the glow reaches the app cards: as soon as they're in view.
  const arriveAt = (vh) => {
    const maxS = Math.max(1, document.documentElement.scrollHeight - vh);
    return Math.max(1, Math.min(burst.top - vh * 0.58, maxS - 8));
  };

  // Covers over the app cards: live mini spreadsheets, each playing a loop of work being done.
  // When the glow explodes they shatter into shards and fly off. They sit in the cards' grid (not inside
  // the cards, which clip), so the shards can fly anywhere.
  // Theme colours as plain rgba() strings every canvas accepts. Safari can report computed colours as
  // color(srgb …), which its canvas doesn't reliably take (every fill then comes out black), so the
  // numbers are pulled out and rebuilt; known values are the fallback.
  const FALLBACK = { "--surface": "#ffffff", "--surface-2": "#f4f4f1", "--grid": "rgba(0,0,0,0.07)", "--fg": "#171716", "--muted": "#6b6b67", "--faint": "#a3a39e", "--accent": "#188038", "--accent-soft": "#e6f4ea" };
  const cssVar = (name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const raw = getComputedStyle(probe).color;
    probe.remove();
    const n = (raw.match(/-?[\d.]+/g) || []).map(Number);
    if (n.length < 3) return FALLBACK[name];
    const unit = /^color\(/.test(raw) ? 255 : 1; // color(srgb 0–1 …) vs rgb(0–255 …)
    const [r, g, b] = n.slice(0, 3).map((v) => Math.round(v * unit));
    const a = n.length > 3 ? n[3] : 1;
    return [r, g, b].every((v) => v >= 0 && v <= 255) ? `rgba(${r}, ${g}, ${b}, ${a})` : FALLBACK[name];
  };
  let pal = {};
  const readPalette = () => { pal = { surface: cssVar("--surface"), s2: cssVar("--surface-2"), grid: cssVar("--grid"), fg: cssVar("--fg"), muted: cssVar("--muted"), faint: cssVar("--faint"), accent: cssVar("--accent"), soft: cssVar("--accent-soft") }; };
  readPalette();
  addEventListener("load", readPalette);
  dark.addEventListener("change", readPalette);

  // The two scenes. Each returns what to draw at time tt (seconds into a 9s loop).
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const money = (n) => "$" + n.toLocaleString("en-US");
  const SCENES = [
    // Budget: type the data, add Profit formulas, total it, style the header.
    (tt) => {
      const data = [["Month", "Revenue", "Cost", "Profit"], ["Jan", 12400, 8100], ["Feb", 15200, 9000], ["Mar", 18900, 9700], ["Total"]];
      const cells = [], order = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) order.push([r, c]);
      order.push([0, 3]);
      order.forEach(([r, c], k) => {
        const start = 0.2 + k * 0.2, v = data[r][c], txt = typeof v === "number" ? String(v) : v;
        const n = Math.floor(clamp01((tt - start) / 0.18) * txt.length);
        if (n > 0) cells.push({ r, c, text: typeof v === "number" && tt > 6 ? money(v) : txt.slice(0, n), bold: r === 0 });
      });
      let cur = order[Math.min(order.length - 1, Math.max(0, Math.floor((tt - 0.2) / 0.2)))];
      [1, 2, 3].forEach((r, k) => {
        const at = 3.2 + k * 0.35, p = data[r][1] - data[r][2];
        if (tt > at) cells.push({ r, c: 3, text: tt > 4.6 ? (tt > 6 ? money(p) : String(p)) : `=B${r + 1}-C${r + 1}`, formula: tt <= 4.6 });
        if (tt > at && tt < 4.6) cur = [r, 3];
      });
      if (tt > 4.8) {
        cells.push({ r: 4, c: 0, text: "Total", bold: true });
        [1, 2, 3].forEach((c) => {
          const sum = [1, 2, 3].reduce((a, r) => a + (c === 3 ? data[r][1] - data[r][2] : data[r][c]), 0);
          cells.push({ r: 4, c, text: tt > 5.5 ? (tt > 6 ? money(sum) : String(sum)) : `=SUM(${"ABCD"[c]}2:${"ABCD"[c]}4)`, formula: tt <= 5.5, bold: true });
        });
        if (tt < 5.6) cur = [4, 1, 4, 3];
      }
      if (tt > 5.6 && tt < 6.3) cur = [1, 1, 4, 3];
      if (tt > 6.3) cur = [0, 0, 0, 3];
      return { cells, cur, headerTint: ease((tt - 6.4) / 0.4), chart: null };
    },
    // Sales: type regions, select them, grow a chart, then sort biggest first.
    (tt) => {
      const rows = [["North", 42], ["South", 58], ["East", 35], ["West", 71]];
      const cells = [{ r: 0, c: 0, text: "Region", bold: true }, { r: 0, c: 1, text: "Sales", bold: true }];
      let cur = [0, 0];
      const sorted = [...rows].sort((a, b) => b[1] - a[1]);
      const sortP = ease((tt - 5.2) / 0.9);
      rows.forEach(([name, v], k) => {
        const start = 0.3 + k * 0.55;
        const nName = Math.floor(clamp01((tt - start) / 0.25) * name.length), nV = Math.floor(clamp01((tt - start - 0.28) / 0.15) * String(v).length);
        const to = sorted.findIndex((x) => x[0] === name);
        const rr = 1 + k + (to - k) * sortP; // rows slide into sorted order
        if (nName) cells.push({ r: rr, c: 0, text: name.slice(0, nName) });
        if (nV) cells.push({ r: rr, c: 1, text: String(v).slice(0, nV) });
        if (tt > start && tt < start + 0.55) cur = [1 + k, nV ? 1 : 0];
      });
      if (tt > 2.6) cur = [0, 0, 1 + Math.min(4, Math.floor(clamp01((tt - 2.6) / 0.5) * 4)), 1];
      if (tt > 3.4) cur = [0, 0, 4, 1];
      if (tt > 5.2) cur = [1, 1, 4, 1];
      const grow = ease((tt - 3.5) / 1.1);
      const bars = rows.map(([name, v], k) => ({ name, v, x: k + (sorted.findIndex((x) => x[0] === name) - k) * sortP }));
      return { cells, cur, headerTint: 0, chart: tt > 3.4 ? { bars, grow, max: 71 } : null };
    },
  ];

  function paintSheet(c, w, h, tt, scene) {
    const RN = 34, HD = 26, CW = Math.max(74, Math.min(96, (w - RN) / 4.4)), RH = 28;
    c.fillStyle = pal.surface; c.fillRect(0, 0, w, h);
    const { cells, cur, headerTint, chart } = scene(tt);
    const fade = tt > 8.2 ? 1 - ease((tt - 8.2) / 0.6) : 1;
    c.globalAlpha = 1;
    // Header tint on row 1 (after styling).
    if (headerTint > 0) { c.fillStyle = pal.soft; c.globalAlpha = headerTint * fade; c.fillRect(RN, HD, CW * 4, RH); c.globalAlpha = 1; }
    // Frame: column letters, row numbers, gridlines.
    c.fillStyle = pal.s2; c.fillRect(0, 0, w, HD); c.fillRect(0, 0, RN, h);
    c.strokeStyle = pal.grid; c.lineWidth = 1; c.beginPath();
    for (let x = RN; x < w; x += CW) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
    for (let y = HD; y < h; y += RH) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
    c.stroke();
    c.font = "500 10.5px Inter, -apple-system, sans-serif"; c.fillStyle = pal.faint; c.textAlign = "center"; c.textBaseline = "middle";
    for (let k = 0, x = RN; x < w; x += CW, k++) c.fillText("ABCDEFG"[k] ?? "", x + CW / 2, HD / 2);
    for (let k = 1, y = HD; y < h; y += RH, k++) c.fillText(String(k), RN / 2, y + RH / 2);
    // Cell contents.
    c.globalAlpha = fade;
    for (const cell of cells) {
      const x = RN + cell.c * CW, y = HD + cell.r * RH + RH / 2;
      c.font = `${cell.bold ? 600 : 400} ${cell.formula ? "11px JetBrains Mono, ui-monospace, monospace" : "12.5px Inter, -apple-system, sans-serif"}`;
      c.fillStyle = cell.formula ? pal.accent : pal.fg;
      const numeric = cell.c > 0 && !cell.bold ? true : cell.c > 0 && cell.r > 0;
      c.textAlign = numeric ? "right" : "left";
      c.fillText(cell.text, numeric ? x + CW - 8 : x + 8, y);
    }
    // Chart card, anchored over columns D–F.
    if (chart) {
      const cx = RN + CW * 2.6, cy = HD + RH * 0.6, cw2 = Math.min(w - cx - 14, CW * 2.2), ch2 = RH * 6.2;
      const pop = ease(chart.grow * 1.6);
      c.save(); c.globalAlpha = fade * pop; c.translate(cx, cy + (1 - pop) * 8);
      c.fillStyle = pal.surface; c.shadowColor = "rgba(0,0,0,.12)"; c.shadowBlur = 16; c.shadowOffsetY = 4;
      c.beginPath(); c.roundRect(0, 0, cw2, ch2, 8); c.fill(); c.shadowColor = "transparent";
      c.strokeStyle = pal.grid; c.stroke();
      c.fillStyle = pal.fg; c.font = "600 11px Inter, -apple-system, sans-serif"; c.textAlign = "left"; c.fillText("Sales by region", 10, 16);
      const base = ch2 - 20, top = 30, bw = (cw2 - 20) / 4;
      c.strokeStyle = pal.grid; c.beginPath(); c.moveTo(10, base + 0.5); c.lineTo(cw2 - 10, base + 0.5); c.stroke();
      c.textAlign = "center"; c.font = "400 9.5px Inter, -apple-system, sans-serif";
      for (const b of chart.bars) {
        const bh = (base - top) * (b.v / chart.max) * chart.grow, x = 10 + b.x * bw + bw * 0.18;
        c.fillStyle = pal.accent; c.beginPath(); c.roundRect(x, base - bh, bw * 0.64, bh, [3, 3, 0, 0]); c.fill();
        c.fillStyle = pal.muted; c.fillText(b.name, x + bw * 0.32, base + 10);
      }
      c.restore();
    }
    // Claude's cursor: a green selection that glides between cells.
    if (cur) {
      const [r1, c1, r2 = r1, c2 = c1] = cur;
      const tx = RN + c1 * CW, ty = HD + r1 * RH, tw = (c2 - c1 + 1) * CW, th = (r2 - r1 + 1) * RH;
      const s = scene.sel ?? (scene.sel = { x: tx, y: ty, w: tw, h: th });
      const k = 0.2; s.x += (tx - s.x) * k; s.y += (ty - s.y) * k; s.w += (tw - s.w) * k; s.h += (th - s.h) * k;
      c.globalAlpha = fade;
      c.fillStyle = pal.soft; c.globalAlpha = fade * 0.5; c.fillRect(s.x, s.y, s.w, s.h); c.globalAlpha = fade;
      c.strokeStyle = pal.accent; c.lineWidth = 2; c.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
      c.fillStyle = pal.accent; c.fillRect(s.x + s.w - 4, s.y + s.h - 4, 6, 6);
    }
    c.globalAlpha = 1;
    // "Keep scrolling" pill.
    const label = "Keep scrolling", pw = 118, ph = 26, px = w / 2 - pw / 2, py = h - ph - 16;
    c.fillStyle = pal.surface; c.shadowColor = "rgba(0,0,0,.14)"; c.shadowBlur = 12; c.shadowOffsetY = 2;
    c.beginPath(); c.roundRect(px, py, pw, ph, 13); c.fill(); c.shadowColor = "transparent";
    c.fillStyle = pal.muted; c.font = "500 12px Inter, -apple-system, sans-serif"; c.textAlign = "center"; c.fillText(label, w / 2, py + ph / 2 + 0.5);
  }

  const covers = reduce ? [] : [...document.querySelectorAll("#more .app-card")].map((card, idx) => {
    card.parentElement.style.position = "relative";
    const cover = document.createElement("div");
    cover.className = "shatter";
    cover.setAttribute("aria-hidden", "true");
    const sheet = document.createElement("canvas");
    cover.append(sheet);
    // Break lines: a jittered grid of points (edges stay straight), each cell split into two triangles,
    // so the shards come out small and irregular. Kept as fractions of the cover (0–1).
    const COLS = 12, ROWS = 9, tris = [];
    const jit = (k, n, salt) => (k === 0 || k === n ? 0 : Math.sin(k * 12.9898 + salt * 78.233 + idx * 3.7) * 0.32);
    const V = Array.from({ length: ROWS + 1 }, (_, r) => Array.from({ length: COLS + 1 }, (_, c) => [(c + jit(c, COLS, r + 0.5)) / COLS, (r + jit(r, ROWS, c + 1.5)) / ROWS]));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const a = V[r][c], b = V[r][c + 1], d = V[r + 1][c], e = V[r + 1][c + 1];
      tris.push(...((r + c) % 2 ? [[a, b, d], [b, e, d]] : [[a, b, e], [a, e, d]]));
    }
    card.parentElement.append(cover);
    return { card, cover, tris, sheet, sc: sheet.getContext("2d"), scene: SCENES[idx % SCENES.length], offset: idx * 1.7, visible: false, broken: false };
  });
  const fitCovers = () => covers.forEach((cv) => {
    const { card, cover, sheet, sc } = cv;
    Object.assign(cover.style, { left: `${card.offsetLeft}px`, top: `${card.offsetTop}px`, width: `${card.offsetWidth}px`, height: `${card.offsetHeight}px`, borderRadius: getComputedStyle(card).borderRadius });
    const dpr = Math.min(2, devicePixelRatio || 1);
    sheet.width = Math.round(card.offsetWidth * dpr); sheet.height = Math.round(card.offsetHeight * dpr);
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv.w = card.offsetWidth; cv.h = card.offsetHeight;
  });
  fitCovers();
  addEventListener("load", fitCovers);
  addEventListener("resize", fitCovers);
  const paintCovers = (ms) => covers.forEach((cv) => {
    if (cv.broken || !cv.w) return;
    const r = cv.cover.getBoundingClientRect();
    cv.visible = r.bottom > 0 && r.top < innerHeight;
    if (!cv.visible && cv.painted) return; // only animate while on screen
    const fixed = params.get("tt"); // ?tt=4 freezes both sheets at that second of their loop (for screenshots)
    paintSheet(cv.sc, cv.w, cv.h, fixed !== null ? +fixed : ((ms / 1000 + cv.offset) % 9), cv.scene);
    cv.painted = true;
  });

  // The shards are drawn on the front canvas (one layer, one draw call each) rather than as hundreds of
  // DOM elements, which is what keeps the explosion smooth. Each keeps a clip of the sheet's last frame.
  let debris = null;
  function shatter(originX, originY) {
    debris = { at: performance.now(), items: [] };
    for (const cv of covers) {
      cv.broken = true;
      const b = cv.card.getBoundingClientRect();
      const box = { l: b.left, t: b.top + scrollY, w: b.width, h: b.height };
      cv.tris.forEach((tri, n) => {
        const pts = tri.map(([x, y]) => [box.l + x * box.w, box.t + y * box.h]);
        const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
        const dx = cx - originX, dy = cy - originY, dist = Math.hypot(dx, dy) || 1;
        debris.items.push({
          sheet: cv.sheet, box, pts, cx, cy, ux: dx / dist, uy: dy / dist,
          push: 140 + 360 * Math.abs(Math.sin(n * 7.3)), spin: (Math.sin(n * 3.1) > 0 ? 1 : -1) * (1.6 + 4.7 * Math.abs(Math.sin(n * 1.7))),
          dur: 800 + 600 * Math.abs(Math.sin(n * 5.9)), delay: Math.min(220, dist * 0.22),
        });
      });
      cv.cover.remove();
    }
  }
  function drawDebris(now, sy) {
    if (!debris) return;
    let live = 0;
    for (const d of debris.items) {
      const u = Math.min(1, Math.max(0, (now - debris.at - d.delay) / d.dur));
      if (u < 1) live++;
      if (u >= 1) continue;
      const e = 1 - (1 - u) ** 3; // ease out
      const ox = d.ux * d.push * e, oy = d.uy * d.push * e + 90 * u * u, cy = d.cy - sy;
      fx.save();
      fx.globalAlpha = 1 - u * u;
      fx.translate(d.cx + ox, cy + oy); fx.rotate(d.spin * e); fx.scale(1 - 0.3 * e, 1 - 0.3 * e); fx.translate(-d.cx, -cy);
      fx.beginPath();
      d.pts.forEach(([x, y], k) => (k ? fx.lineTo(x, y - sy) : fx.moveTo(x, y - sy)));
      fx.closePath(); fx.clip();
      fx.drawImage(d.sheet, 0, 0, d.sheet.width, d.sheet.height, d.box.l, d.box.t - sy, d.box.w, d.box.h);
      fx.restore();
    }
    if (!live) debris = null;
  }

  // travel → boom (the explosion plays on its own clock) → done (the glow is gone for good).
  let state = "travel", boomAt = 0, arrivedAt = null, lastMs = null;
  if (params.has("final")) { state = "done"; covers.forEach(({ cover }) => cover.remove()); } // ?final shows the end state (for screenshots)
  const BOOM_MS = 1500;
  let pos = null, speed = 0;

  function draw(ms) {
    if (!G || !route.length) return;
    const t = reduce ? 0 : ms / 1000, sy = scrollY, vh = innerHeight, { W, su, sv, toPage, toGrid } = G;
    ctx.clearRect(0, 0, innerWidth, vh);
    fx.clearRect(0, 0, innerWidth, vh);

    // Gridlines: only the ones crossing the screen (plus a margin for the waves), in both diagonal directions.
    const cs = [toGrid(-60, sy - 60), toGrid(W + 60, sy - 60), toGrid(-60, sy + vh + 60), toGrid(W + 60, sy + vh + 60)];
    const ia = Math.floor(Math.min(...cs.map((c) => c.i))), ib = Math.ceil(Math.max(...cs.map((c) => c.i)));
    const ja = Math.floor(Math.min(...cs.map((c) => c.j))), jb = Math.ceil(Math.max(...cs.map((c) => c.j)));
    ctx.beginPath();
    const trace = (fromI, fromJ, toI, toJ) => {
      const a = toPage(fromI, fromJ), b = toPage(toI, toJ), n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 26));
      for (let k = 0; k <= n; k++) { const p = warp(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, t); k ? ctx.lineTo(p.x, p.y - sy) : ctx.moveTo(p.x, p.y - sy); }
    };
    for (let i = ia; i <= ib; i++) trace(i, ja, i, jb);
    for (let j = ja; j <= jb; j++) trace(ia, j, ib, j);
    ctx.strokeStyle = `rgba(${ink}, ${dark.matches ? 0.09 : 0.06})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Where the glow is: at the top it sits on the logo, and it reaches the middle of the app cards as you
    // scroll to them. Once it gets there it explodes; after that it's gone and scrolling no longer moves it.
    const arrive = arriveAt(vh);
    const target = indexForY(startY + (Math.min(sy, arrive) / arrive) * (endY - startY));
    // The moment the glow touches the end point, it explodes. Timing is in real time, so a slow frame
    // rate can't stretch it: once you've scrolled to the cards it goes off within 350ms at most.
    const there = sy >= arrive - 4;
    if (state === "travel" && there && arrivedAt === null) arrivedAt = ms;
    if (state === "travel" && !there) arrivedAt = null;
    if (state === "travel" && !reduce && pos !== null && there && (pos >= route.length - 3 || ms - arrivedAt > 350)) {
      state = "boom"; boomAt = ms; pos = route.length - 1;
      const b = placeAt(route.length - 1, t);
      setTimeout(() => shatter(b.x, b.y), 60);
    }
    let e = state === "boom" ? Math.min(1, (ms - boomAt) / BOOM_MS) : state === "done" ? 1 : 0;
    if (state === "boom" && e >= 1) state = "done";
    if (params.has("e")) e = +params.get("e"); // ?e=0.5 freezes the explosion at a stage (for screenshots)
    if (state !== "travel") pos = route.length - 1;
    if (pos === null || reduce) pos = target;
    const prev = pos;
    // Glide toward the target at a rate set in real time (not per frame), closing in faster on the end point.
    const dt = Math.min(0.1, lastMs === null ? 1 / 60 : (ms - lastMs) / 1000);
    lastMs = ms;
    pos += (target - pos) * (1 - Math.exp(-dt * (target >= route.length - 1 ? 24 : 8)));
    speed += (Math.abs(pos - prev) - speed) * 0.2;
    pos = Math.max(0, Math.min(route.length - 1, pos));
    const i = Math.floor(pos), glow = placeAt(pos, t);

    // The trail it has travelled (only the stretch on screen), then a short bright tail.
    const from = Math.max(0, indexForY(sy - 80) - 1);
    // Draws a stretch of the route; the part inside the last section goes on the front canvas.
    const stroke = (c, a, b, style, width) => {
      if (b <= a) return;
      c.beginPath();
      for (let j = a; j <= b; j++) { const p = place(route[j], t); j === a ? c.moveTo(p.x, p.y - sy) : c.lineTo(p.x, p.y - sy); }
      if (b === i) c.lineTo(glow.x, glow.y - sy); // finish exactly at the glow
      c.strokeStyle = style; c.lineWidth = width; c.lineCap = "round"; c.lineJoin = "round"; c.stroke();
    };
    const line = (a, b, style, width) => {
      stroke(ctx, a, Math.min(b, frontFrom), style, width);
      stroke(fx, Math.max(a, frontFrom), b, style, width);
    };
    // The trail fades out with the explosion and is gone afterwards.
    if (e < 1) {
      const fade = 1 - e;
      if (showRoute) line(from, Math.min(route.length - 1, indexForY(sy + vh + 80)), "rgba(61, 220, 120, 1)", 4);
      else line(from, i, `rgba(61, 220, 120, ${(dark.matches ? 0.4 : 0.28) * fade})`, 1.4);
      let back = 0, k = i;
      while (k > 0 && back < 40 + Math.min(160, speed * 10)) { back += cum[k] - cum[k - 1]; k--; }
      const chunks = 8, span = i - k;
      for (let c = 0; c < chunks && span > 0; c++) {
        line(k + Math.floor((span * c) / chunks), k + Math.floor((span * (c + 1)) / chunks), `rgba(61, 220, 120, ${((c + 1) / chunks) ** 1.5 * fade})`, 2.4);
      }
    }

    // The burst: the grid and trail dissolve around it, a bloom swells with a shockwave and sparks,
    // and it settles into a soft green-and-violet background behind the app cards.
    const bx = burst.x, by = burst.y - sy, R = Math.max(W * 0.7, 760);
    if (e > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const er = Math.max(1, R * (0.25 + 0.9 * e));
      const erase = ctx.createRadialGradient(bx, by, 0, bx, by, er);
      erase.addColorStop(0, `rgba(0,0,0,${0.95 * e})`); erase.addColorStop(0.6, `rgba(0,0,0,${0.6 * e})`); erase.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = erase; ctx.beginPath(); ctx.arc(bx, by, er, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // The settled background: green at the heart, a violet wash offset to the side.
      const a = e, dk = dark.matches ? 1.5 : 1;
      const br = R * (0.4 + 0.75 * e);
      const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bloom.addColorStop(0, `rgba(61, 220, 120, ${(0.55 * (1 - e) + 0.2 * e) * dk})`);
      bloom.addColorStop(0.35, `rgba(61, 220, 120, ${0.12 * a * dk})`);
      bloom.addColorStop(1, "rgba(61, 220, 120, 0)");
      ctx.fillStyle = bloom; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      const vx = bx + W * 0.22, vy = by + 60;
      const vr = R * 0.8 * e + 1;
      const violet = ctx.createRadialGradient(vx, vy, 0, vx, vy, vr);
      violet.addColorStop(0, `rgba(124, 92, 255, ${0.14 * a * dk})`); violet.addColorStop(1, "rgba(124, 92, 255, 0)");
      ctx.fillStyle = violet; ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.fill();

      // In front of the cards while it goes off: a bright flash, the shockwave ring and sparks.
      if (e < 1) {
        const out = 1 - (1 - e) ** 3;
        const fr = 60 + 420 * out;
        const flash = fx.createRadialGradient(bx, by, 0, bx, by, fr);
        flash.addColorStop(0, `rgba(235, 255, 240, ${0.95 * (1 - e) ** 2})`);
        flash.addColorStop(0.3, `rgba(61, 220, 120, ${0.55 * (1 - e) ** 2})`);
        flash.addColorStop(1, "rgba(61, 220, 120, 0)");
        fx.fillStyle = flash; fx.beginPath(); fx.arc(bx, by, fr, 0, Math.PI * 2); fx.fill();
        fx.beginPath(); fx.arc(bx, by, R * 1.05 * out, 0, Math.PI * 2);
        fx.strokeStyle = `rgba(61, 220, 120, ${0.6 * (1 - e)})`; fx.lineWidth = 2 + 6 * (1 - e); fx.stroke();
        for (let k = 0; k < 40; k++) {
          const ang = (k / 40) * Math.PI * 2 + Math.sin(k * 12.9) * 0.2, sp = 0.45 + 0.55 * ((Math.sin(k * 78.2) + 1) / 2);
          const d = R * 0.85 * out * sp;
          fx.beginPath(); fx.arc(bx + Math.cos(ang) * d, by + Math.sin(ang) * d, 2.6 * (1 - e) + 0.6, 0, Math.PI * 2);
          fx.fillStyle = `rgba(120, 240, 160, ${0.95 * (1 - e)})`; fx.fill();
        }
      }
    }

    // The glow itself (it fades out as it bursts).
    const gx = glow.x, gy = glow.y - sy, gc = i >= frontFrom ? fx : ctx;
    if (gy > -80 && gy < vh + 80 && e < 1) {
      gc.globalAlpha = 1 - e;
      const flicker = reduce ? 1 : 0.92 + 0.08 * Math.sin(ms / 80) + 0.05 * Math.sin(ms / 31);
      const r = (34 + Math.min(20, speed * 2)) * flicker * (1 + 3 * e);
      const g = gc.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, "rgba(201, 255, 217, .95)"); g.addColorStop(0.22, "rgba(61, 220, 120, .6)"); g.addColorStop(1, "rgba(61, 220, 120, 0)");
      gc.fillStyle = g; gc.beginPath(); gc.arc(gx, gy, r, 0, Math.PI * 2); gc.fill();
      gc.fillStyle = "#fff"; gc.beginPath(); gc.arc(gx, gy, 3, 0, Math.PI * 2); gc.fill();
      gc.globalAlpha = 1;
    }
    drawDebris(ms, sy);
  }

  const loop = (ms) => {
    try { draw(ms); paintCovers(ms); } catch (err) { if (!loop.failed) report(`${err.message} (${navigator.userAgent.match(/(Safari|Chrome|Firefox)\/[\d.]+/g)?.join(" ")})`); loop.failed = true; }
    requestAnimationFrame(loop);
  };

  let raf = 0, lastH = 0, lastW = 0;
  const rebuild = () => {
    size();
    const W = document.documentElement.clientWidth, H = document.documentElement.scrollHeight;
    if (W === lastW && Math.abs(H - lastH) < 4) return;
    // Rebuilding changes the route; keep the glow where it is on the page instead of letting it jump.
    const keepY = pos !== null && route.length ? route[Math.floor(pos)].y : null;
    lastW = W; lastH = H; build();
    if (keepY !== null) pos = indexForY(keepY);
  };
  readInk();
  addEventListener("load", rebuild);
  addEventListener("resize", size);
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(rebuild); }).observe(document.body);
  rebuild();
  if (reduce) { addEventListener("scroll", () => draw(0), { passive: true }); addEventListener("load", () => draw(0)); draw(0); }
  else requestAnimationFrame(loop);

  // ?y=1200 starts the preview scrolled down; ?selftest records where the glow is headed at five scroll stops.
  const startAt = +params.get("y");
  if (startAt) addEventListener("load", () => setTimeout(() => scrollTo(0, startAt), 50));
  const errors = [];
  const flag = document.querySelector(".concept-flag");
  const report = (msg) => { errors.push(msg); if (flag) { flag.textContent = `Concept error: ${msg}`; flag.style.background = "#fde2e1"; flag.style.color = "#8a1c14"; } };
  addEventListener("error", (ev) => report(String(ev.message)));
  window.__covers = () => covers.map((cv) => ({ painted: !!cv.painted, visible: cv.visible, w: cv.w, h: cv.h, broken: cv.broken }));
  if (params.has("selftest")) addEventListener("load", async () => {
    const out = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const maxS = document.documentElement.scrollHeight - innerHeight;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      scrollTo(0, f * maxS); await wait(300);
      const arrive = arriveAt(innerHeight);
      const i = indexForY(startY + (Math.min(scrollY, arrive) / arrive) * (endY - startY));
      out.push({ f, glowYOnScreen: Math.round(place(route[i], 0).y - scrollY), state });
    }
    // Largest single jump between neighbouring route points (anything big would show as a jump).
    let maxGap = 0;
    for (let k = 1; k < route.length; k++) maxGap = Math.max(maxGap, Math.hypot(route[k].x - route[k - 1].x, route[k].y - route[k - 1].y));
    const endP = place(route[route.length - 1], 2);
    out.push({ burstPoint: [Math.round(burst.x), Math.round(burst.y)], routeEnds: [Math.round(endP.x), Math.round(endP.y)], arriveAtScroll: Math.round(arriveAt(innerHeight)), covers: covers.length, maxScroll: document.documentElement.scrollHeight - innerHeight });
    out.push({ maxGapPx: Math.round(maxGap), startOnLogo: [Math.round(place(route[0], 3).x), Math.round(place(route[0], 3).y)], logo: [Math.round(route[0].x), Math.round(route[0].y)] });
    out.push({ errors, covers: window.__covers() });
    const pre = document.createElement("pre"); pre.id = "selftest"; pre.textContent = JSON.stringify(out); document.body.append(pre);
  });
})();
