// The sheet preview widget: a self-contained page that speaks the MCP Apps postMessage protocol
// directly (ui/initialize, then ui/notifications/tool-result), so it needs no bundler or CDN.
// When the host lets apps call server tools, it polls preview_updates and animates each step
// live as Claude works (reads scan, edits fill in), then folds down to a summary once Claude goes quiet.
export const PREVIEW_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sheet preview</title>
<style>
:root {
  --surface: #ffffff; --surface-2: #f4f4f1; --fg: #171716; --muted: #6b6b67; --faint: #a3a39e;
  --grid: rgba(0,0,0,.08); --accent: #188038; --claude: #d97757; --claude-soft: rgba(217,119,87,.13);
  --shadow: 0 0 0 1px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04), 0 8px 24px -12px rgba(0,0,0,.12);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --ease: cubic-bezier(.23,1,.32,1);
  color-scheme: light;
}
:root[data-theme="dark"] {
  --surface: #1f1e1d; --surface-2: #262624; --fg: #ededeb; --muted: #9d9d98; --faint: #6b6b66;
  --grid: rgba(255,255,255,.08); --accent: #5bb974;
  --shadow: 0 0 0 1px rgba(255,255,255,.09), 0 8px 24px -12px rgba(0,0,0,.6);
  color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; background: transparent; }
body { font: 13px/1.4 var(--font); color: var(--fg); padding: 2px; }
.card { background: var(--surface); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
.bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px 0 12px; box-shadow: inset 0 -1px 0 var(--grid); }
.bar > svg { width: 16px; height: 16px; color: var(--accent); flex: none; }
.bar .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .tab { flex: none; font-size: 12px; color: var(--muted); background: var(--surface-2); border-radius: 6px; padding: 2px 7px; }
.bar .sp { flex: 1; }
.live { flex: none; display: none; align-items: center; gap: 6px; font: 500 11.5px/1 var(--font); color: var(--muted); background: none; border: 0; padding: 4px 6px; border-radius: 6px; }
.live.on { display: inline-flex; }
.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.live.polling i { animation: pulse 1.6s ease-in-out infinite; }
.live.busy i { background: var(--claude); animation: pulse .8s ease-in-out infinite; }
.live.paused { cursor: pointer; } .live.paused i { background: var(--faint); }
.live.done i { background: var(--accent); animation: none; }
@keyframes pulse { 50% { opacity: .35; transform: scale(.8); } }
.btn { flex: none; font: 500 12px/1 var(--font); color: var(--fg); background: var(--surface-2); border: 0; border-radius: 8px; padding: 7px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.btn:hover { box-shadow: inset 0 0 0 1px var(--grid); }
.btn:focus-visible, .live:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn svg { width: 12px; height: 12px; }
.fbar { display: grid; grid-template-columns: 64px 24px minmax(0,1fr); align-items: center; height: 30px; font-size: 12.5px; box-shadow: inset 0 -1px 0 var(--grid); }
.fbar .ref { text-align: center; color: var(--muted); font-weight: 500; height: 100%; display: grid; place-items: center; box-shadow: inset -1px 0 0 var(--grid); }
.fbar .fx { color: var(--faint); font-style: italic; text-align: center; font-family: Georgia, serif; }
.fbar .val { font-family: var(--mono); font-size: 12px; padding: 0 8px 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 420ms var(--ease); }
.body > div { min-height: 0; overflow: hidden; }
.card.done .body { grid-template-rows: 0fr; }
.card.done .foot { box-shadow: none; }
/* The sheet itself looks like Google Sheets (always light, real sizes and fonts); the chrome follows the theme. */
.scroll { overflow: auto; max-height: 560px; scroll-behavior: smooth; background: #fff; color: #000; color-scheme: light;
  --grid: #e2e3e3; --surface-2: #f8f9fa; --faint: #80868b; }
.gridwrap { position: relative; width: max-content; min-width: 100%; }
table { border-collapse: collapse; table-layout: fixed; font-family: Arial, Helvetica, sans-serif; font-size: 13.3px; font-variant-numeric: tabular-nums; }
th, td { height: 21px; padding: 0 4px 2px; box-shadow: inset -1px -1px 0 var(--grid); white-space: nowrap; overflow: hidden; line-height: 1.2; }
table.nogrid td { box-shadow: none; }
thead th { position: sticky; top: 0; z-index: 4; height: 24px; padding: 0; font: 500 11px var(--font); color: var(--faint); background: var(--surface-2); text-align: center; vertical-align: middle; }
th.rn { position: sticky; left: 0; z-index: 4; width: 42px; padding: 0; font: 500 11px var(--font); color: var(--faint); background: var(--surface-2); text-align: center; vertical-align: middle; }
thead th.rn { z-index: 5; }
td { text-align: left; vertical-align: bottom; cursor: default; position: relative; }
td.al-l { text-align: left; } td.al-c { text-align: center; } td.al-r { text-align: right; }
td.va-t { vertical-align: top; } td.va-m { vertical-align: middle; }
td.w { white-space: normal; overflow-wrap: anywhere; }
td.ovf { overflow: visible; }
.charts { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.chart { position: absolute; background: #fff; outline: 1px solid #d9d9d9; outline-offset: -1px; overflow: hidden; }
.chart svg { display: block; }
.chart.anim .cb-up { transform-box: fill-box; transform-origin: 50% 100%; animation: grow 700ms var(--ease) both; }
.chart.anim .cb-down { transform-box: fill-box; transform-origin: 50% 0; animation: grow 700ms var(--ease) both; }
.chart.anim .cb-side { transform-box: fill-box; transform-origin: 0 50%; animation: growx 700ms var(--ease) both; }
.chart.anim .c-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1s var(--ease) forwards; }
.chart.anim .c-fade { animation: fadein 700ms ease both; }
@keyframes grow { from { transform: scaleY(0); } }
@keyframes growx { from { transform: scaleX(0); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes fadein { from { opacity: 0; } }
table td.sel { box-shadow: inset 0 0 0 2px #1a73e8; }
td.flash::after { content: ""; position: absolute; inset: 0; background: var(--claude-soft); animation: flash 1.1s ease forwards; pointer-events: none; }
td.typed { animation: typed 320ms var(--ease) both; }
@keyframes flash { from { opacity: 1; } to { opacity: 0; } }
@keyframes typed { from { opacity: 0; transform: translateY(3px); } }
.cur { position: absolute; z-index: 3; left: 0; top: 0; width: 0; height: 0; border: 2px solid var(--claude); border-radius: 2px; background: var(--claude-soft); pointer-events: none; opacity: 0;
  transition: transform 450ms var(--ease), width 450ms var(--ease), height 450ms var(--ease), opacity 200ms ease; }
.cur.on { opacity: 1; }
.cur span { position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px; background: var(--claude); color: #fff; font-size: 10.5px; font-weight: 600; padding: 2px 6px; border-radius: 4px 4px 4px 0; white-space: nowrap; }
.cur.top span { bottom: auto; top: 100%; margin: 2px 0 0; border-radius: 0 4px 4px 4px; }
/* Reading: a dashed outline with a band sweeping down the range. */
.cur.scan { border-style: dashed; background: rgba(217,119,87,.05); overflow: visible; }
.cur .band { position: absolute; left: 0; right: 0; top: 0; height: 100%; overflow: hidden; pointer-events: none; }
.cur.scan.sweep .band::before { content: ""; position: absolute; left: 0; right: 0; height: 36px; top: -36px; background: linear-gradient(to bottom, transparent, rgba(217,119,87,.28), transparent); animation: sweep var(--sweep, 700ms) linear forwards; }
@keyframes sweep { to { top: 100%; } }
.gridwrap.enter { animation: enter 380ms var(--ease) both; }
@keyframes enter { from { opacity: 0; transform: translateY(6px); } }
.step .verb { color: var(--muted); }
.foot { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 6px 8px 6px 12px; font-size: 12px; color: var(--muted); box-shadow: inset 0 1px 0 var(--grid); }
.step { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; white-space: nowrap; overflow: hidden; }
.step b { font: 600 11.5px/1 var(--mono); color: var(--fg); }
.step code { font: 11.5px/1 var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.step .who { color: var(--claude); font-weight: 600; }
.st { flex: none; width: 14px; height: 14px; display: grid; place-items: center; }
.st.run::before { content: ""; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--claude); border-right-color: transparent; animation: spin .7s linear infinite; }
.st.ok { border-radius: 50%; background: var(--accent); color: var(--surface); }
.st.ok::before { content: ""; width: 6px; height: 3px; border: solid currentColor; border-width: 0 0 1.6px 1.6px; transform: translateY(-1px) rotate(-45deg); }
@keyframes spin { to { transform: rotate(360deg); } }
.count { flex: none; }
/* The steps list: one row per read or edit, like Claude's own tool rows. */
.steps { display: grid; gap: 6px; padding: 10px 12px 12px; box-shadow: inset 0 1px 0 var(--grid); }
.steps:empty { display: none; }
.srow { display: grid; grid-template-columns: 16px auto minmax(0, 1fr) 16px; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 10px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--grid); font-size: 12.5px; transition: background-color 200ms ease, box-shadow 200ms ease; animation: rowin 260ms var(--ease) both; }
.srow > svg { width: 15px; height: 15px; color: var(--muted); }
.srow b { font: 600 12px/1.2 var(--mono); color: var(--fg); }
.srow code { font: 11.5px/1.2 var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srow.read b { font-weight: 500; color: var(--muted); }
.srow.run { background: var(--claude-soft); box-shadow: inset 0 0 0 1px var(--claude); }
.srow .st { justify-self: end; width: 16px; height: 16px; }
.srow .st.ok::before { width: 7px; height: 3.5px; border-width: 0 0 1.8px 1.8px; }
.smore { font-size: 11.5px; color: var(--muted); padding: 0 2px; }
@keyframes rowin { from { opacity: 0; transform: translateY(4px); } }
/* Loading: a skeleton sheet; unavailable: one quiet line. */
.skel .bar .t { color: var(--muted); font-weight: 500; }
.skel .grid { padding: 0 0 10px; }
.skel .row { display: grid; grid-template-columns: 42px repeat(4, 1fr); height: 30px; box-shadow: inset 0 -1px 0 var(--grid); }
.skel .row > i { margin: 10px 8px; border-radius: 4px; background: var(--surface-2); animation: shimmer 1.4s ease-in-out infinite; }
.skel .row > i:first-child { background: none; }
.skel .row:nth-child(2) > i { animation-delay: .1s; } .skel .row:nth-child(3) > i { animation-delay: .2s; } .skel .row:nth-child(4) > i { animation-delay: .3s; }
@keyframes shimmer { 50% { opacity: .45; } }
.note { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px 4px 12px; font-size: 12.5px; color: var(--muted); }
.note > svg { width: 15px; height: 15px; color: var(--faint); flex: none; }
.note .sp { flex: 1; }
@media (prefers-reduced-motion: reduce) {
  .cur, .scroll, .body { transition: none; scroll-behavior: auto; }
  .skel .row > i { animation: none; }
  td.typed, td.flash::after, .live i, .cur .band::before, .gridwrap.enter, .chart *, .srow { animation: none !important; }
}
</style>
</head>
<body>
<div class="card skel" id="card">
  <div class="bar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5V20"/></svg><span class="t">Opening your sheet…</span></div>
  <div class="grid" aria-hidden="true"><div class="row"><i></i><i></i><i></i><i></i><i></i></div><div class="row"><i></i><i></i><i></i><i></i><i></i></div><div class="row"><i></i><i></i><i></i><i></i><i></i></div><div class="row"><i></i><i></i><i></i><i></i><i></i></div></div>
</div>
<script>
(() => {
  const SHEET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5V20"/></svg>';
  const OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const card = document.getElementById("card");
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  const col = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------- host messaging (JSON-RPC over postMessage) ----------
  let nextId = 1;
  const pending = new Map();
  const send = (msg) => window.parent.postMessage({ jsonrpc: "2.0", ...msg }, "*");
  const notify = (method, params) => send({ method, params });
  const request = (method, params) => {
    const id = nextId++;
    send({ id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  // ---------- state ----------
  let P;                 // current preview from the server
  let account;
  let canPoll = false;   // host lets the app call server tools
  let seq = 0;           // last edit seen
  const history = [];    // every step so far (reads and edits), for the summary
  let liveSteps = 0;     // steps animated live (not ones that happened before the preview opened)
  const stepLog = [];    // rows for the steps list: { e, state: "run" | "ok" }
  const MAX_ROWS_SHOWN = 4;
  let done = false, keepOpen = false, doneTimer;
  let queue = Promise.resolve();
  let busy = 0;
  let ui;                // DOM handles for the current preview
  let toolArgs = {};     // show_range's arguments, from ui/notifications/tool-input
  let backlog = 0;       // batches waiting to animate, so a pile-up plays faster

  function applyContext(ctx) {
    if (!ctx) return;
    if (ctx.theme) document.documentElement.dataset.theme = ctx.theme;
    const font = ctx.styles && ctx.styles.variables && ctx.styles.variables["--font-sans"];
    if (font) document.documentElement.style.setProperty("--font", font);
  }

  // ---------- drawing ----------
  const SIDES = ["Top", "Right", "Bottom", "Left"];
  function paint(td, cell, r, c) {
    if (ui && ui.covered.has(r + "," + c)) return; // hidden under a merged cell
    td.textContent = cell.v;
    const al = cell.al || (cell.n ? "r" : "l");
    let cls = "al-" + al + (cell.w ? " w" : "") + (cell.va ? " va-" + cell.va : "");
    // Like Sheets, unwrapped left-aligned text spills into empty cells to its right.
    if (!cell.w && al === "l" && cell.v && P && P.rows[r]) {
      const next = P.rows[r][c + 1];
      if (!next || (!next.v && !(ui && ui.covered.has(r + "," + (c + 1))))) cls += " ovf";
    }
    td.className = cls;
    const st = td.style;
    st.cssText = "";
    if (cell.b) st.fontWeight = "700";
    if (cell.i) st.fontStyle = "italic";
    if (cell.s || cell.u) st.textDecoration = [cell.s && "line-through", cell.u && "underline"].filter(Boolean).join(" ");
    if (cell.bg) st.background = cell.bg;
    if (cell.fg) st.color = cell.fg;
    if (cell.fs) st.fontSize = (cell.fs * 4 / 3).toFixed(1) + "px";
    if (cell.ff) st.fontFamily = '"' + cell.ff + '", Arial, Helvetica, sans-serif';
    if (cell.bd) cell.bd.forEach((b, i) => {
      if (!b) return;
      const [w, color] = b.split(" ");
      st["border" + SIDES[i]] = parseInt(w, 10) + "px " + (w.endsWith("d") ? "dashed" : "solid") + " " + color;
    });
    td.title = cell.v.length > 14 ? cell.v : "";
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sameShape = (a, b) => a && b && a.tab === b.tab && a.start_row === b.start_row && a.start_col === b.start_col && a.rows.length === b.rows.length &&
    same(a.col_widths, b.col_widths) && same(a.row_heights, b.row_heights) && same(a.merges, b.merges) && a.hide_gridlines === b.hide_gridlines;

  function render(p, entering) {
    card.textContent = "";
    const bar = el("div", "bar");
    bar.insertAdjacentHTML("beforeend", SHEET);
    const live = el("button", "live");
    live.type = "button";
    live.append(el("i"), el("span", "", "Live"));
    live.addEventListener("click", () => { if (live.classList.contains("paused")) startPolling(); });
    const open = el("button", "btn");
    open.type = "button";
    open.innerHTML = OPEN;
    open.append("Open in Sheets");
    open.addEventListener("click", () => request("ui/open-link", { url: P.url }).catch(() => window.open(P.url, "_blank", "noopener")));
    bar.append(el("span", "t", p.title), el("span", "tab", p.tab), el("span", "sp"), live, open);

    const fbar = el("div", "fbar");
    const ref = el("div", "ref"), val = el("div", "val");
    fbar.append(ref, el("div", "fx", "fx"), val);

    const scroll = el("div", "scroll"), wrap = el("div", "gridwrap"), table = el("table");
    if (p.hide_gridlines) table.classList.add("nogrid");
    if (p.base_font) table.style.fontSize = (p.base_font * 4 / 3).toFixed(1) + "px";
    const cg = el("colgroup");
    const rc = el("col"); rc.style.width = "42px"; cg.append(rc);
    p.col_widths.forEach((w) => { const c = el("col"); c.style.width = Math.max(4, w) + "px"; cg.append(c); });
    table.style.width = 42 + p.col_widths.reduce((a, b) => a + Math.max(4, b), 0) + "px";
    const head = el("thead"), hr = el("tr");
    hr.append(el("th", "rn"));
    p.col_widths.forEach((_, c) => hr.append(el("th", "", col(p.start_col + c))));
    head.append(hr);
    // Merged blocks: the top-left cell spans the block; the rest aren't drawn but point at it.
    const anchorOf = new Map(), covered = new Set();
    for (const m of p.merges || []) {
      const mr0 = m.r0 - p.start_row, mc0 = m.c0 - p.start_col;
      for (let r = mr0; r < m.r1 - p.start_row; r++) for (let c = mc0; c < m.c1 - p.start_col; c++) {
        if (r === mr0 && c === mc0) continue;
        covered.add(r + "," + c);
        anchorOf.set(r + "," + c, [mr0, mc0]);
      }
    }
    ui = { covered };
    const body = el("tbody");
    const cells = p.rows.map((row, r) => {
      const tr = el("tr");
      tr.style.height = (p.row_heights ? p.row_heights[r] : 21) + "px";
      tr.append(el("th", "rn", String(p.start_row + r + 1)));
      const tds = row.map((cell, c) => {
        if (covered.has(r + "," + c)) return null;
        const td = el("td");
        const m = (p.merges || []).find((x) => x.r0 - p.start_row === r && x.c0 - p.start_col === c);
        if (m) { td.rowSpan = m.r1 - m.r0; td.colSpan = m.c1 - m.c0; }
        paint(td, cell, r, c);
        td.addEventListener("click", () => select(r, c, true));
        tr.append(td);
        return td;
      });
      body.append(tr);
      return tds;
    });
    for (const [key, [ar, ac]] of anchorOf) { const [r, c] = key.split(",").map(Number); cells[r][c] = cells[ar][ac]; }
    table.append(cg, head, body);
    const cur = el("div", "cur");
    cur.append(el("span", "", "Claude"), el("div", "band"));
    const charts = el("div", "charts");
    wrap.append(table, charts, cur);
    scroll.append(wrap);

    const foot = el("div", "foot");
    const step = el("div", "step"), count = el("span", "count");
    const toggle = el("button", "btn", "Show sheet");
    toggle.type = "button";
    toggle.hidden = true;
    toggle.addEventListener("click", () => { keepOpen = true; setDone(false); });
    foot.append(step, count, toggle);

    if (entering) wrap.classList.add("enter");
    const fold = el("div", "body"), inner = el("div");
    const steps = el("div", "steps");
    inner.append(fbar, scroll, steps);
    fold.append(inner);
    card.classList.toggle("done", done);
    card.append(bar, fold, foot);
    ui = { live, ref, val, scroll, wrap, cells, cur, step, count, toggle, head, charts, covered, steps, selected: null };
    renderSteps();
    renderCharts();
  }

  // ---------- charts ----------
  // Charts float over the grid like in Sheets. Google doesn't provide chart images, so they are
  // redrawn as SVG from each chart's data and settings (theme colors, legend, axis number format).
  const PALETTE = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6"];
  const DRAWN = ["COLUMN", "BAR", "LINE", "AREA", "COMBO", "SCATTER", "STEPPED_AREA", "PIE"];
  const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]);
  const CH = 6.3; // rough width of one 12px character
  function niceStep(span) {
    const raw = span / 5 || 1, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  // Axis numbers the way the chart's source cells are formatted: $6,000,000, ($1,000,000), 75%, "-" for zero.
  function axisFormat(f, step) {
    f = f || {};
    const s = f.pct ? step * 100 : step, dec = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
    return (v) => {
      if (Math.abs(v) < step / 1e6) { if (f.zero_dash) return "-"; v = 0; }
      const body = (f.prefix || "") + Math.abs(f.pct ? v * 100 : v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (f.pct ? "%" : "");
      return v < 0 ? (f.paren ? "(" + body + ")" : "-" + body) : body;
    };
  }
  const svgText = (x, y, s, attrs) => '<text x="' + (+x).toFixed(1) + '" y="' + (+y).toFixed(1) + '" ' + (attrs || "") + ">" + esc(s) + "</text>";

  function chartSvg(ch) {
    const W = ch.width, H = ch.height;
    const font = (ch.font ? '"' + ch.font + '", ' : "") + "Arial, Helvetica, sans-serif";
    const pal = ch.palette && ch.palette.length ? ch.palette : PALETTE;
    let out = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" font-family="' + esc(font) + '" font-size="12" fill="#222">' +
      '<rect width="' + W + '" height="' + H + '" fill="' + (ch.bg || "#fff") + '"/>';
    let top = 16, bottom = H - 12, right = W - 20;
    if (ch.title) {
      const size = ch.title_size || 17;
      out += svgText(20, 14 + size, ch.title, 'font-size="' + size + '" fill="' + (ch.title_color || "#757575") + '"' + (ch.title_bold ? ' font-weight="700"' : ""));
      top = 14 + size + 18;
    }
    const series = ch.series.map((s, i) => ({ ...s, color: s.color || pal[i % pal.length] })).filter((s) => s.values.some((v) => v != null));
    if (!series.length || !DRAWN.includes(ch.type)) {
      return out + svgText(W / 2, H / 2, series.length ? "Chart" : "No data", 'text-anchor="middle" fill="#80868b"') + "</svg>";
    }
    const n = Math.max(ch.labels.length, ...series.map((s) => s.values.length));
    const kind = (s) => (ch.type === "COMBO" ? s.type || "COLUMN" : ch.type === "STEPPED_AREA" ? "AREA" : ch.type);
    const pie = ch.type === "PIE";

    // Legend: one entry per series (per slice for a pie), where the chart puts it.
    let items = pie
      ? ch.labels.slice(0, 12).map((l, i) => ({ name: l, color: pal[i % pal.length], line: false }))
      : series.map((s, i) => ({ name: s.name || "Series " + (i + 1), color: s.color, line: kind(s) === "LINE" }));
    if (ch.stacked) items = items.slice().reverse();
    let where = ch.legend || (items.length > 1 ? "BOTTOM_LEGEND" : "NO_LEGEND");
    if (where === "LEFT_LEGEND" || where === "INSIDE_LEGEND" || where === "LABELED_LEGEND") where = "RIGHT_LEGEND";
    if (!pie && items.length < 2 && !ch.legend) where = "NO_LEGEND";
    const mark = (x, y, it) => (it.line
      ? '<line x1="' + x + '" x2="' + (x + 14) + '" y1="' + (y - 4) + '" y2="' + (y - 4) + '" stroke="' + it.color + '" stroke-width="3"/>'
      : '<rect x="' + x + '" y="' + (y - 10) + '" width="12" height="12" fill="' + it.color + '"/>') + svgText(x + 20, y, it.name);
    const itemW = (it) => 20 + it.name.length * CH + 18;
    if (where === "RIGHT_LEGEND") {
      const w = Math.min(W * 0.34, Math.max(...items.map(itemW)));
      items.forEach((it, i) => { out += mark(W - w - 4, top + 12 + i * 20, it); });
      right = W - w - 16;
    } else if (where === "TOP_LEGEND" || where === "BOTTOM_LEGEND") {
      // Wrap into centered rows.
      const rowsOf = [[]];
      let used = 0;
      for (const it of items) {
        if (used + itemW(it) > W - 40 && rowsOf[rowsOf.length - 1].length) { rowsOf.push([]); used = 0; }
        rowsOf[rowsOf.length - 1].push(it);
        used += itemW(it);
      }
      const h = rowsOf.length * 20;
      const y0 = where === "TOP_LEGEND" ? top + 8 : H - 10 - h + 14;
      rowsOf.forEach((row, r) => {
        let x = (W - row.reduce((a, it) => a + itemW(it), 0) + 18) / 2;
        for (const it of row) { out += mark(Math.round(x), y0 + r * 20, it); x += itemW(it); }
      });
      if (where === "TOP_LEGEND") top += h + 8; else bottom = H - 14 - h;
    }

    if (pie) {
      const vals = series[0].values.map((v) => Math.max(0, v || 0)), total = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = (20 + right) / 2, cy = (top + bottom) / 2, R = Math.max(10, Math.min(right - 20, bottom - top) / 2 - 6), hole = (ch.pie_hole || 0) * R;
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        if (!v) return;
        const a1 = Math.min(a0 + (v / total) * Math.PI * 2, a0 + Math.PI * 2 - 0.0001), big = a1 - a0 > Math.PI ? 1 : 0;
        const p = (r, a) => (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1);
        out += '<path class="c-fade" style="animation-delay:' + i * 60 + 'ms" fill="' + pal[i % pal.length] + '" stroke="#fff" d="M' + p(R, a0) + " A" + R + " " + R + " 0 " + big + " 1 " + p(R, a1) +
          (hole ? " L" + p(hole, a1) + " A" + hole + " " + hole + " 0 " + big + " 0 " + p(hole, a0) : " L" + cx.toFixed(1) + " " + cy.toFixed(1)) + 'Z"/>';
        a0 = a1;
      });
      return out + "</svg>";
    }

    // Value range, with stacks summed.
    const stacks = (k) => ch.stacked && (k === "COLUMN" || k === "BAR" || k === "AREA");
    const pos = new Array(n).fill(0), neg = new Array(n).fill(0), all = [0];
    series.forEach((s) => s.values.forEach((v, i) => {
      if (v == null) return;
      if (stacks(kind(s))) all.push(v >= 0 ? (pos[i] += v) : (neg[i] += v));
      else all.push(v);
    }));
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;
    const fmt = axisFormat(ch.value_format, step);
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);

    const horiz = ch.type === "BAR";
    const labelW = Math.max(0, ...ch.labels.map((l) => l.length)) * CH;
    const tickW = Math.max(...ticks.map((v) => fmt(v).length)) * CH;
    const x0 = 20 + (horiz ? Math.min(labelW, W * 0.3) : tickW) + 10, x1 = right, y0 = top + 8;
    // Category labels: flat if they fit, slanted like Sheets if not, thinned as a last resort.
    const bandX = (x1 - x0) / Math.max(1, n);
    const slant = !horiz && bandX < labelW + 8 && bandX >= 13;
    const every = horiz || slant || bandX >= labelW + 8 ? 1 : Math.ceil((labelW + 8) / bandX);
    const y1 = bottom - (horiz ? 18 : slant ? Math.min(64, labelW * 0.72 + 12) : 20);
    const vScale = (v) => (horiz ? x0 + ((v - lo) / (hi - lo)) * (x1 - x0) : y1 - ((v - lo) / (hi - lo)) * (y1 - y0));
    const band = (horiz ? y1 - y0 : x1 - x0) / Math.max(1, n);
    const mid = (i) => (horiz ? y0 : x0) + band * (i + 0.5);

    for (const v of ticks) {
      const p = vScale(v).toFixed(1), stroke = v === 0 ? "#333" : "#d9d9d9";
      out += horiz
        ? '<line x1="' + p + '" x2="' + p + '" y1="' + y0 + '" y2="' + y1 + '" stroke="' + stroke + '"/>' + svgText(p, y1 + 16, fmt(v), 'text-anchor="middle"')
        : '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + p + '" y2="' + p + '" stroke="' + stroke + '"/>' + svgText(x0 - 8, +p + 4, fmt(v), 'text-anchor="end"');
    }
    for (let i = 0; i < n; i += every) {
      const l = ch.labels[i] || "";
      if (horiz) out += svgText(x0 - 8, mid(i) + 4, l, 'text-anchor="end"');
      else if (slant) out += '<text transform="translate(' + (mid(i) + 4).toFixed(1) + "," + (y1 + 12) + ') rotate(-45)" text-anchor="end">' + esc(l) + "</text>";
      else out += svgText(mid(i), y1 + 16, l, 'text-anchor="middle"');
    }

    const bars = series.filter((s) => kind(s) === "COLUMN" || kind(s) === "BAR").length;
    const groupW = band * 0.64, bw = groupW / Math.max(1, ch.stacked ? 1 : bars);
    const basePos = new Array(n).fill(0), baseNeg = new Array(n).fill(0), areaBase = new Array(n).fill(0);
    const zero = vScale(Math.max(lo, Math.min(hi, 0)));
    let barIndex = 0, lines = "";
    series.forEach((s) => {
      const k = kind(s), color = s.color;
      if (k === "COLUMN" || k === "BAR") {
        const g = ch.stacked ? 0 : barIndex++;
        s.values.forEach((v, i) => {
          if (v == null) return;
          let a = 0, b = v;
          if (ch.stacked) { if (v >= 0) { a = basePos[i]; b = basePos[i] += v; } else { a = baseNeg[i]; b = baseNeg[i] += v; } }
          const p0 = vScale(a), p1 = vScale(b), off = mid(i) - groupW / 2 + g * bw;
          const cls = horiz ? "cb-side" : v < 0 ? "cb-down" : "cb-up", delay = ' style="animation-delay:' + Math.min(500, i * 16) + 'ms"';
          out += horiz
            ? '<rect class="' + cls + '"' + delay + ' x="' + Math.min(p0, p1).toFixed(1) + '" y="' + off.toFixed(1) + '" width="' + Math.abs(p1 - p0).toFixed(1) + '" height="' + bw.toFixed(1) + '" fill="' + color + '"/>'
            : '<rect class="' + cls + '"' + delay + ' x="' + off.toFixed(1) + '" y="' + Math.min(p0, p1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.abs(p1 - p0).toFixed(1) + '" fill="' + color + '"/>';
        });
      } else if (k === "SCATTER") {
        s.values.forEach((v, i) => { if (v != null) out += '<circle class="c-fade" cx="' + mid(i).toFixed(1) + '" cy="' + vScale(v).toFixed(1) + '" r="3.5" fill="' + color + '"/>'; });
      } else {
        // Lines and areas; a gap in the data breaks the line. Stacked areas fill between this series and the one below.
        const stacked = k === "AREA" && ch.stacked;
        const pts = s.values.map((v, i) => {
          if (v == null) return null;
          const base = stacked ? areaBase[i] : 0;
          if (stacked) areaBase[i] += v;
          return [mid(i), vScale(base + v), stacked ? vScale(base) : zero];
        });
        const segs = [];
        let cur = [];
        pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
        if (cur.length) segs.push(cur);
        for (const seg of segs) {
          const d = seg.map((p, j) => (j ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
          if (k === "AREA") out += '<path class="c-fade" d="' + d + " " + seg.slice().reverse().map((p) => "L" + p[0].toFixed(1) + " " + p[2].toFixed(1)).join(" ") + 'Z" fill="' + color + '" fill-opacity="' + (stacked ? 0.75 : 0.3) + '"/>';
          lines += '<path class="c-line" pathLength="1" d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>';
        }
      }
    });
    return out + lines + "</svg>";
  }

  const seenCharts = new Set();
  function renderCharts() {
    ui.charts.textContent = "";
    if (!P.charts) return;
    const headH = ui.head.offsetHeight;
    for (const ch of P.charts) {
      const box = el("div", "chart");
      box.style.cssText = "left:" + (42 + ch.left) + "px;top:" + (headH + ch.top) + "px;width:" + ch.width + "px;height:" + ch.height + "px";
      const key = ch.id + ":" + ch.type;
      if (!seenCharts.has(key)) box.classList.add("anim");
      seenCharts.add(key);
      box.innerHTML = chartSvg(ch);
      ui.charts.append(box);
    }
  }

  function select(r, c, mark) {
    if (ui.selected) ui.selected.classList.remove("sel");
    ui.selected = null;
    const td = ui.cells[r] && ui.cells[r][c];
    if (!td) return;
    if (mark) { td.classList.add("sel"); ui.selected = td; }
    const cell = P.rows[r][c];
    ui.ref.textContent = col(P.start_col + c) + (P.start_row + r + 1);
    ui.val.textContent = cell.f || cell.v;
  }

  // A sheet Rect clipped to what's on screen, as table indices.
  function visible(rect) {
    if (!rect) return null;
    const r0 = Math.max(rect.r0, P.start_row) - P.start_row, c0 = Math.max(rect.c0, P.start_col) - P.start_col;
    const r1 = Math.min(rect.r1 - P.start_row, ui.cells.length) - 1, c1 = Math.min(rect.c1 - P.start_col, P.col_widths.length) - 1;
    return r1 >= r0 && c1 >= c0 ? { r0, c0, r1, c1 } : null;
  }

  function moveCursor(v, scrollTo) {
    const a = ui.cells[v.r0][v.c0], b = ui.cells[v.r1][v.c1];
    const w = ui.wrap.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x = ra.left - w.left - 1, y = ra.top - w.top - 1;
    Object.assign(ui.cur.style, { transform: "translate(" + x + "px," + y + "px)", width: rb.right - ra.left + 1 + "px", height: rb.bottom - ra.top + 1 + "px" });
    ui.cur.classList.toggle("top", v.r0 === 0);
    ui.cur.classList.add("on");
    if (scrollTo) {
      // Keep the cursor in view both ways (the row numbers and header stay pinned).
      const s = ui.scroll;
      const top = y - 40, bottom = y + (rb.bottom - ra.top) + 40;
      if (top < s.scrollTop || bottom > s.scrollTop + s.clientHeight) s.scrollTop = Math.max(0, top);
      const left = x - 42 - 24, right = x + (rb.right - ra.left) + 24;
      if (left < s.scrollLeft || right > s.scrollLeft + s.clientWidth) s.scrollLeft = Math.max(0, right - s.clientWidth > left ? left : right - s.clientWidth);
    }
  }

  const WRITES = new Set(["write_range", "append_rows"]);
  const VERBS = { read_range: "Reading", get_spreadsheet_info: "Looking over", write_range: "Writing", append_rows: "Adding rows", clear_range: "Clearing", find_replace: "Replacing", format_range: "Formatting",
    add_conditional_format: "Adding color rules", sort_range: "Sorting", set_filter: "Filtering", set_data_validation: "Adding dropdowns", add_chart: "Adding a chart", freeze: "Freezing", resize_columns: "Resizing",
    merge_cells: "Merging", manage_tab: "Updating tabs", insert_rows_or_columns: "Inserting", delete_rows_or_columns: "Deleting", undo_last: "Undoing", batch_update: "Updating" };
  const where = (e) => (e.a1 ? (e.tab ? e.tab + "!" : "") + e.a1 : e.tab || "");
  // The current step shows as a highlighted row in the steps list; the footer just says Claude is at work.
  function showStep(state, e) {
    if (state === "run") stepLog.push({ e, state });
    else { const row = stepLog.findLast((x) => x.e === e); if (row) row.state = "ok"; }
    renderSteps();
    ui.step.textContent = "";
    ui.step.append(el("span", "st " + state), el("span", "", state === "run" ? (VERBS[e.tool] || "Working") + "…" : "Done"));
  }
  function renderSteps() {
    if (!ui || !ui.steps) return;
    ui.steps.textContent = "";
    const hidden = Math.max(0, stepLog.length - MAX_ROWS_SHOWN);
    if (hidden) ui.steps.append(el("div", "smore", hidden + " earlier step" + (hidden === 1 ? "" : "s")));
    for (const { e, state } of stepLog.slice(hidden)) {
      const row = el("div", "srow " + state + (e.kind === "read" ? " read" : ""));
      row.insertAdjacentHTML("beforeend", SHEET);
      row.append(el("b", "", e.tool), el("code", "", where(e)), el("span", "st " + state));
      ui.steps.append(row);
    }
  }

  function showSummary() {
    ui.step.textContent = "";
    const edits = history.filter((e) => e.kind !== "read"), reads = history.length - edits.length;
    const mine = edits.filter((e) => e.tab === P.tab && e.rect);
    if (mine.length) ui.step.append(el("span", "who", "Claude"), " changed " + label(union(mine.map((e) => e.rect))));
    else if (P.highlight) ui.step.append(el("span", "who", "Claude"), " changed " + P.highlight.a1);
    else if (reads) ui.step.append(el("span", "who", "Claude"), " is looking through the sheet");
    else ui.step.textContent = canPoll ? "Watching Claude work…" : P.tab;
    const n = (k, w) => k + " " + w + (k === 1 ? "" : "s");
    ui.count.textContent = history.length ? [edits.length && n(edits.length, "edit"), reads && n(reads, "read")].filter(Boolean).join(" · ") : (P.truncated ? "Showing part of the range" : "");
    ui.toggle.hidden = !done;
  }
  const label = (r) => col(r.c0) + (r.r0 + 1) + (r.r1 - r.r0 > 1 || r.c1 - r.c0 > 1 ? ":" + col(r.c1 - 1) + r.r1 : "");
  const union = (rs) => rs.length ? { r0: Math.min(...rs.map((r) => r.r0)), c0: Math.min(...rs.map((r) => r.c0)), r1: Math.max(...rs.map((r) => r.r1)), c1: Math.max(...rs.map((r) => r.c1)) } : null;

  // Settle on an outline of everything Claude changed on this tab (or the server's highlight).
  function settle() {
    const mine = history.filter((e) => e.kind !== "read" && e.tab === P.tab && e.rect).map((e) => e.rect);
    const v = visible(union(mine) || P.highlight);
    ui.cur.classList.remove("scan", "sweep");
    if (v) { moveCursor(v, true); select(v.r0, v.c0, false); }
    else ui.cur.classList.remove("on");
    showSummary();
    armDone();
  }

  // Claude has no "finished" signal, so fold the preview down once it goes quiet:
  // shortly after the last step, or after a while if it never touched the sheet.
  const QUIET_MS = 12_000, NEVER_STARTED_MS = 90_000;
  function armDone() {
    clearTimeout(doneTimer);
    if (done || keepOpen || busy || backlog) return;
    doneTimer = setTimeout(() => { if (!busy && !backlog) setDone(true); }, liveSteps ? QUIET_MS : NEVER_STARTED_MS);
  }
  function setDone(on) {
    clearTimeout(doneTimer);
    done = on;
    card.classList.toggle("done", on);
    if (ui) { showSummary(); setLive(); }
  }

  // ---------- animation ----------
  // Animate edits one after another. With a new preview, cells inside each edit's range change
  // as the cursor reaches them; everything else updates straight away.
  function enqueue(edits, next) {
    backlog++;
    clearTimeout(doneTimer);
    if (done) setDone(false);
    queue = queue.then(() => play(edits, next)).catch((err) => { console.error("Sheet preview:", err); busy = 0; }).then(() => { backlog--; armDone(); });
    return queue;
  }

  let pendingCharts;
  async function play(edits, next) {
    busy++;
    setLive();
    let deferred = null;
    if (next && sameShape(P, next)) {
      deferred = [];
      next.rows.forEach((row, r) => row.forEach((cell, c) => {
        if (same(cell, P.rows[r][c])) return;
        const inEdit = edits.some((e) => e.tab === next.tab && e.rect && r + next.start_row >= e.rect.r0 && r + next.start_row < e.rect.r1 && c + next.start_col >= e.rect.c0 && c + next.start_col < e.rect.c1);
        if (inEdit) deferred.push({ r, c, cell });
        else paint(ui.cells[r][c], cell, r, c);
      }));
      const old = P;
      P = { ...next, charts: old.charts, rows: old.rows.map((row) => row.slice()) };
      pendingCharts = next.charts;
      next.rows.forEach((row, r) => row.forEach((cell, c) => { if (!deferred.some((d) => d.r === r && d.c === c)) P.rows[r][c] = cell; }));
    } else if (next) {
      const switching = !P || next.tab !== P.tab;
      P = next;
      render(P, switching);
      setLive();
      // New layout, so there's nothing to diff against: start cells Claude wrote in this batch blank and type them in.
      deferred = [];
      for (const e of edits) {
        if (e.kind === "read" || !WRITES.has(e.tool) || e.tab !== P.tab) continue;
        const v = visible(e.rect);
        if (!v) continue;
        for (let r = v.r0; r <= v.r1; r++) for (let c = v.c0; c <= v.c1; c++) {
          if (deferred.some((d) => d.r === r && d.c === c)) continue;
          deferred.push({ r, c, cell: P.rows[r][c] });
          P.rows[r][c] = { v: "" };
          paint(ui.cells[r][c], P.rows[r][c], r, c);
        }
      }
    }
    // Catch up quickly when steps pile up (bursts of reads).
    const fast = backlog > 1 || edits.length > 3;
    for (const e of edits) {
      showStep("run", e);
      const v = e.tab === P.tab ? visible(e.rect) : null;
      if (v && e.kind === "read") {
        ui.cur.classList.add("scan");
        ui.cur.classList.remove("sweep");
        moveCursor(v, true);
        select(v.r0, v.c0, false);
        await sleep(fast ? 220 : 380);
        ui.cur.style.setProperty("--sweep", (fast ? 380 : 750) + "ms");
        void ui.cur.offsetWidth;
        ui.cur.classList.add("sweep");
        await sleep(fast ? 400 : 780);
        history.push(e);
        liveSteps++;
        showStep("ok", e);
        await sleep(fast ? 60 : 160);
        continue;
      }
      ui.cur.classList.remove("scan", "sweep");
      if (v) {
        moveCursor(v, true);
        select(v.r0, v.c0, false);
        await sleep(fast ? 260 : 420);
        const todo = deferred ? deferred.filter((d) => d.r >= v.r0 && d.r <= v.r1 && d.c >= v.c0 && d.c <= v.c1) : [];
        const tds = [];
        for (let r = v.r0; r <= v.r1; r++) for (let c = v.c0; c <= v.c1; c++) tds.push({ r, c });
        const gap = Math.min(fast ? 20 : 45, (fast ? 350 : 700) / Math.max(1, tds.length));
        for (const t of tds) {
          const td = ui.cells[t.r][t.c];
          const d = todo.find((x) => x.r === t.r && x.c === t.c);
          if (d) { P.rows[d.r][d.c] = d.cell; paint(td, d.cell, d.r, d.c); td.classList.add("typed"); deferred.splice(deferred.indexOf(d), 1); }
          td.classList.remove("flash"); void td.offsetWidth; td.classList.add("flash");
          if (gap >= 4) await sleep(gap);
        }
        select(v.r0, v.c0, false);
        await sleep(fast ? 200 : 380);
      } else {
        await sleep(fast ? 250 : 500);
      }
      history.push(e);
      liveSteps++;
      showStep("ok", e);
      await sleep(fast ? 60 : 150);
    }
    // Anything a recalculation changed outside the animated ranges.
    if (deferred) for (const d of deferred) { P.rows[d.r][d.c] = d.cell; paint(ui.cells[d.r][d.c], d.cell, d.r, d.c); }
    if (pendingCharts !== undefined) { P.charts = pendingCharts; pendingCharts = undefined; renderCharts(); }
    busy--;
    settle();
    setLive();
  }

  // ---------- live updates ----------
  let timer, lastEditAt = Date.now(), failures = 0, polling = false;
  const FAST = 1000, SLOW = 3000, IDLE_SLOW = 60_000, IDLE_STOP = 10 * 60_000;

  function setLive() {
    if (!ui) return;
    ui.live.classList.toggle("on", canPoll);
    ui.live.classList.toggle("busy", busy > 0);
    ui.live.classList.toggle("polling", polling && !busy);
    ui.live.classList.toggle("paused", canPoll && !polling && !busy && !done);
    ui.live.classList.toggle("done", done && !busy);
    ui.live.lastChild.textContent = busy ? "Editing" : done ? "Done" : polling ? "Live" : "Paused";
    ui.live.title = polling ? "Updating as Claude edits this sheet" : "Click to keep watching for edits";
  }

  function startPolling() {
    if (!canPoll) return;
    polling = true;
    lastEditAt = Date.now();
    failures = 0;
    setLive();
    schedule(FAST);
  }
  function stopPolling() { polling = false; clearTimeout(timer); setLive(); }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(tick, ms); }

  async function tick() {
    if (!polling) return;
    const idle = Date.now() - lastEditAt;
    if (idle > IDLE_STOP) return stopPolling();
    if (document.hidden) return schedule(SLOW);
    try {
      const res = await request("tools/call", { name: "preview_updates", arguments: { spreadsheet: P.spreadsheet_id, range: P.window, since: seq, ...(account && { account }) } });
      const u = res && res.structuredContent;
      if (!u || res.isError) throw new Error("bad update");
      failures = 0;
      if (u.seq > seq) seq = u.seq;
      if (u.edits && u.edits.length) {
        lastEditAt = Date.now();
        enqueue(u.edits, u.preview || null);
      }
    } catch {
      if (++failures >= 3) return stopPolling();
    }
    schedule(Date.now() - lastEditAt > IDLE_SLOW ? SLOW : FAST);
  }

  // ---------- startup ----------
  async function onResult(result) {
    let s = result && result.structuredContent;
    // Some hosts don't pass the structured result through; fetch it ourselves with show_range's
    // arguments (a few tries, keeping the skeleton up meanwhile).
    for (let i = 0; (!s || !s.preview) && canPoll && toolArgs.spreadsheet && i < 3; i++) {
      if (i) await sleep(1000);
      try {
        const r = await request("tools/call", { name: "preview_updates", arguments: { spreadsheet: toolArgs.spreadsheet, range: toolArgs.range, highlight: toolArgs.highlight, initial: true, ...(toolArgs.account && { account: toolArgs.account }) } });
        if (r && !r.isError && r.structuredContent && r.structuredContent.preview) s = r.structuredContent;
      } catch {}
    }
    if (!s || !s.preview) {
      const why = result && result.isError ? "error" : result ? Object.keys(result).join(",") + (s ? ":" + Object.keys(s).join(",") : "") : "none";
      return unavailable(why);
    }
    card.classList.remove("skel");
    P = s.preview;
    account = s.account;
    seq = s.seq || 0;
    render(P);
    setLive();
    // Steps from before the preview opened are counted and outlined, not replayed.
    if (s.edits) {
      history.push(...s.edits);
      for (const e of s.edits) stepLog.push({ e, state: "ok" });
      renderSteps();
    }
    settle();
    startPolling();
  }

  // Can't show the sheet here: fold to one quiet line (with a link when we know the sheet).
  // The detail in the tooltip says what the host passed, for debugging.
  function unavailable(why) {
    card.classList.remove("skel");
    card.textContent = "";
    const note = el("div", "note");
    note.insertAdjacentHTML("beforeend", SHEET);
    note.append(el("span", "", "Live preview isn't available in this chat."), el("span", "sp"));
    note.title = "Host passed: " + why + (canPoll ? "" : "; no server tool access");
    const raw = String(toolArgs.spreadsheet || "");
    const id = raw.includes("/d/") ? raw.split("/d/")[1].split(/[/?#]/)[0] : raw;
    if (id) {
      const url = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
      const open = el("button", "btn");
      open.type = "button";
      open.innerHTML = OPEN;
      open.append("Open in Sheets");
      open.addEventListener("click", () => request("ui/open-link", { url }).catch(() => window.open(url, "_blank", "noopener")));
      note.append(open);
    }
    card.append(note);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && !m.method && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      return m.error ? reject(m.error) : resolve(m.result);
    }
    if (m.method === "ui/notifications/tool-input") toolArgs = (m.params && m.params.arguments) || {};
    else if (m.method === "ui/notifications/tool-result") onResult(m.params);
    else if (m.method === "ui/notifications/host-context-changed") applyContext(m.params);
    else if (m.method === "ui/resource-teardown" && m.id != null) { stopPolling(); send({ id: m.id, result: {} }); }
    else if (m.id != null && m.method) send({ id: m.id, error: { code: -32601, message: "Method not found" } });
  });

  // Tell the host how tall the widget is, so the chat sizes the frame to fit.
  let lastH = 0;
  new ResizeObserver(() => {
    const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (h !== lastH) { lastH = h; notify("ui/notifications/size-changed", { height: h }); }
  }).observe(document.documentElement);

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "Sheets MCP preview", version: "1.2.0" },
    appCapabilities: {},
  }).then((r) => {
    applyContext(r && r.hostContext);
    canPoll = !!(r && r.hostCapabilities && r.hostCapabilities.serverTools);
    notify("ui/notifications/initialized", {});
  }, () => {});
})();
</script>
</body>
</html>
`;
