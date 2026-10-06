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
thead th { position: sticky; top: 0; z-index: 9; height: 24px; padding: 0; font: 500 11px var(--font); color: var(--faint); background: var(--surface-2); text-align: center; vertical-align: middle; }
th.rn { position: sticky; left: 0; z-index: 7; width: 42px; padding: 0; font: 500 11px var(--font); color: var(--faint); background: var(--surface-2); text-align: center; vertical-align: middle; }
thead th.fz { left: 0; z-index: 10; }
thead th.rn { z-index: 11; }
th.rn.fz { z-index: 8; }
td { text-align: left; vertical-align: bottom; cursor: default; position: relative; }
td.al-l { text-align: left; } td.al-c { text-align: center; } td.al-r { text-align: right; }
td.va-t { vertical-align: top; } td.va-m { vertical-align: middle; }
td.w { white-space: normal; overflow-wrap: anywhere; }
td .wc { overflow: hidden; }
td.ovf { overflow: visible; }
td.dv-check { text-align: center; }
td.err::after { content: ""; position: absolute; top: 0; right: 0; border-style: solid; border-width: 0 6px 6px 0; border-color: transparent #d93025 transparent transparent; }
.cbx { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #5f6368; border-radius: 2px; vertical-align: -2px; box-sizing: border-box; }
.cbx.on { background: #1a73e8; border-color: #1a73e8; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-4.9' fill='none' stroke='white' stroke-width='1.8'/%3E%3C/svg%3E"); }
.chip { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; box-sizing: border-box; padding: 0 4px 0 8px; height: 17px; margin-top: 1px; border-radius: 9px; background: #e8eaed; color: #202124; font-size: 0.92em; overflow: hidden; }
.chip.empty { background: none; float: right; padding: 0; }
.chip svg { width: 10px; height: 10px; flex: none; fill: #5f6368; }
.fbtn { position: absolute; right: 3px; bottom: 3px; width: 13px; height: 13px; border-radius: 2px; background: #fff; display: grid; place-items: center; }
.fbtn svg { width: 11px; height: 11px; fill: none; stroke: #188038; stroke-width: 1.5; stroke-linecap: round; }
/* Frozen rows and columns stay put while the rest scrolls, with Sheets' heavier line along their edge. */
td.fz { position: sticky; z-index: 4; }
td.fz.fzb { z-index: 5; }
td.fzr-end, th.fzr-end { box-shadow: inset -1px -1px 0 var(--grid), inset 0 -2px 0 #c2c2c2; }
td.fzc-end, th.fzc-end { box-shadow: inset -1px -1px 0 var(--grid), inset -2px 0 0 #c2c2c2; }
td.fzr-end.fzc-end, th.fzr-end.fzc-end { box-shadow: inset -1px -1px 0 var(--grid), inset 0 -2px 0 #c2c2c2, inset -2px 0 0 #c2c2c2; }
table.nogrid td.fzr-end { box-shadow: inset 0 -2px 0 #c2c2c2; }
table.nogrid td.fzc-end { box-shadow: inset -2px 0 0 #c2c2c2; }
table.nogrid td.fzr-end.fzc-end { box-shadow: inset 0 -2px 0 #c2c2c2, inset -2px 0 0 #c2c2c2; }
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
.cur { position: absolute; z-index: 6; left: 0; top: 0; width: 0; height: 0; border: 2px solid var(--claude); border-radius: 2px; background: var(--claude-soft); pointer-events: none; opacity: 0;
  transition: transform 450ms var(--ease), width 450ms var(--ease), height 450ms var(--ease), opacity 200ms ease; }
.cur.on { opacity: 1; }
.cur.snap { transition: none; }
/* At rest the outline barely tints, so the sheet's own colors read through. */
.cur.settled { background: rgba(217,119,87,.04); }
.cur span { position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px; background: var(--claude); color: #fff; font-size: calc(10.5px / var(--zoom, 1)); font-weight: 600; padding: 2px 6px; border-radius: 4px 4px 4px 0; white-space: nowrap; }
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
.st.fail::before { content: "×"; color: var(--faint); font: 700 15px/1 var(--font); }
@keyframes spin { to { transform: rotate(360deg); } }
.count { flex: none; }
/* The tab strip, like the one along the bottom of Sheets: click a tab to look at it. */
.tabs { display: flex; gap: 2px; padding: 4px 8px 0; overflow-x: auto; scrollbar-width: none; background: var(--surface-2); box-shadow: inset 0 1px 0 var(--grid); }
.tabs::-webkit-scrollbar { display: none; }
.tb { flex: none; max-width: 170px; font: 500 12px/1 var(--font); color: var(--muted); background: none; border: 0; border-radius: 7px 7px 0 0; padding: 8px 12px 9px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb:hover { color: var(--fg); background: rgba(128,128,128,.12); }
.tb.on { color: var(--accent); background: var(--surface); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
.tb.busy { opacity: .55; }
.tb .aid { display: none; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--claude); vertical-align: 1px; animation: aipulse 1.4s ease-in-out infinite; }
.tb.ai .aid { display: inline-block; }
@keyframes aipulse { 50% { opacity: .35; } }
.tb:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* The steps list: one row per read or edit, like Claude's own tool rows. */
.steps { display: grid; gap: 6px; padding: 10px 12px 12px; box-shadow: inset 0 1px 0 var(--grid); }
.steps:empty { display: none; }
.srow { display: grid; grid-template-columns: 16px auto minmax(0, 1fr) 16px; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 10px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--grid); font-size: 12.5px; transition: background-color 200ms ease, box-shadow 200ms ease; animation: rowin 260ms var(--ease) both; }
.srow > svg { width: 15px; height: 15px; color: var(--muted); }
.srow b { font: 600 12px/1.2 var(--mono); color: var(--fg); }
.srow code { font: 11.5px/1.2 var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srow.read b { font-weight: 500; color: var(--muted); }
.srow.run { background: var(--claude-soft); box-shadow: inset 0 0 0 1px var(--claude); }
.srow.fail { opacity: .7; }
.srow.fail b { text-decoration: line-through; text-decoration-color: var(--faint); }
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
  const history = [];    // every finished step so far (reads and edits), for the summary
  let liveSteps = 0;     // steps animated live (not ones that happened before the preview opened)
  const stepLog = [];    // rows for the steps list: { e, state: "run" | "ok" | "fail", at }
  const MAX_ROWS_SHOWN = 4;
  let done = false, keepOpen = false, doneTimer;
  let queue = Promise.resolve();
  let busy = 0;
  let ui;                // DOM handles for the current preview
  let toolArgs = {};     // show_range's arguments, from ui/notifications/tool-input
  let backlog = 0;       // batches waiting to animate, so a pile-up plays faster
  let switching = null;  // tab the user asked for, while it loads

  // Plain text cells travel as bare strings; give every cell the same shape here.
  const inflate = (p) => { if (p && p.rows) p.rows = p.rows.map((row) => row.map((c) => (typeof c === "string" ? { v: c } : c))); return p; };
  const stepId = (e) => (e.id != null ? e.id : e.seq);
  const running = () => stepLog.some((r) => r.state === "run");

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
    td.textContent = "";
    if (cell.w && cell.v) {
      // Table rows grow to fit their content, but Sheets keeps the row height and clips wrapped text.
      let h = 0;
      for (let k = 0; k < (td.rowSpan || 1); k++) h += P && P.row_heights ? P.row_heights[r + k] ?? 21 : 21;
      const box = el("div", "wc", cell.v);
      box.style.maxHeight = Math.max(0, h - 2) + "px";
      td.append(box);
    } else if (cell.dv === "check") {
      td.append(el("span", "cbx" + (/^true$/i.test(cell.v) ? " on" : "")));
    } else if (cell.dv === "list") {
      // Sheets' dropdown chip: the value in a grey pill with an arrow (just the arrow when empty).
      const chip = el("span", cell.v ? "chip" : "chip empty", cell.v);
      chip.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 10 10"><path d="M2 3.5h6L5 7z"/></svg>');
      td.append(chip);
    } else td.textContent = cell.v;
    const f = P && P.filter;
    if (f && r + P.start_row === f.r && c + P.start_col >= f.c0 && c + P.start_col < f.c1)
      td.insertAdjacentHTML("beforeend", '<span class="fbtn"><svg viewBox="0 0 12 12"><path d="M1.5 2.5h9M3.5 6h5M5 9.5h2"/></svg></span>');
    const al = cell.al || (cell.n ? "r" : "l");
    let cls = "al-" + al + (cell.w ? " w" : "") + (cell.va ? " va-" + cell.va : "") + (cell.dv ? " dv-" + cell.dv : "") + (ERR.test(cell.v) ? " err" : "");
    // Like Sheets, unwrapped left-aligned text spills into empty cells to its right.
    if (!cell.w && !cell.dv && al === "l" && cell.v && P && P.rows[r]) {
      const next = P.rows[r][c + 1];
      if (!next || (!next.v && !(ui && ui.covered.has(r + "," + (c + 1))))) cls += " ovf";
    }
    const st = td.style;
    st.cssText = "";
    // Frozen panes: pinned with sticky offsets (the row numbers' column and the header are 42px and 24px).
    const fz = ui && ui.frozen;
    if (fz) {
      const fr = r < fz.rows, fc = c < fz.cols;
      if (fr || fc) {
        cls += " fz" + (fr && fc ? " fzb" : "");
        if (fr) st.top = fz.tops[r] + "px";
        if (fc) st.left = fz.lefts[c] + "px";
        if (!cell.bg) st.background = "#fff";
      }
      if (fr && r === fz.rows - 1) cls += " fzr-end";
      if (fc && c === fz.cols - 1) cls += " fzc-end";
    }
    td.className = cls;
    // Text in the cell to the left stops spilling here once this cell has something in it.
    const left = cell.v && ui && ui.cells && ui.cells[r] && ui.cells[r][c - 1];
    if (left) left.classList.remove("ovf");
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
  // The grid is drawn a little smaller than Sheets at 100%, so more of the sheet fits in the chat.
  const ZOOM = 0.8;
  const ERR = /^#(DIV[/]0!|N[/]A|REF!|VALUE!|NAME[?]|NUM!|NULL!|ERROR!|SPILL!|CALC!)$/;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sameShape = (a, b) => a && b && a.tab === b.tab && a.start_row === b.start_row && a.start_col === b.start_col && a.rows.length === b.rows.length &&
    same(a.col_widths, b.col_widths) && same(a.row_heights, b.row_heights) && same(a.merges, b.merges) && a.hide_gridlines === b.hide_gridlines &&
    a.frozen_rows === b.frozen_rows && a.frozen_cols === b.frozen_cols && same(a.tabs, b.tabs) && same(a.filter, b.filter);

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
    const hasStrip = p.tabs && p.tabs.some((t) => !t.hidden);
    bar.append(el("span", "t", p.title), ...(hasStrip ? [] : [el("span", "tab", p.tab)]), el("span", "sp"), live, open);

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
    // Frozen panes only apply when the view starts at the sheet's edge, like in Sheets itself.
    const fzRows = p.start_row === 0 ? Math.min(p.frozen_rows || 0, p.rows.length) : 0;
    const fzCols = p.start_col === 0 ? Math.min(p.frozen_cols || 0, p.col_widths.length) : 0;
    let frozen = null;
    if (fzRows || fzCols) {
      const tops = [24], lefts = [42];
      for (let r = 1; r < fzRows; r++) tops.push(tops[r - 1] + (p.row_heights ? p.row_heights[r - 1] : 21));
      for (let c = 1; c < fzCols; c++) lefts.push(lefts[c - 1] + Math.max(4, p.col_widths[c - 1]));
      const rh = (r) => (p.row_heights ? p.row_heights[r] : 21), cw = (c) => Math.max(4, p.col_widths[c]);
      // h and w: where the panes end, so scrolling keeps the cursor out from under them.
      frozen = { rows: fzRows, cols: fzCols, tops, lefts, h: fzRows ? tops[fzRows - 1] + rh(fzRows - 1) : 24, w: fzCols ? lefts[fzCols - 1] + cw(fzCols - 1) : 42 };
      // The letters above frozen columns stay with them.
      for (let c = 0; c < fzCols; c++) { const th = hr.children[c + 1]; th.classList.add("fz"); th.style.left = lefts[c] + "px"; if (c === fzCols - 1) th.classList.add("fzc-end"); }
    }
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
    ui = { covered, frozen };
    const body = el("tbody");
    const cells = p.rows.map((row, r) => {
      const tr = el("tr");
      tr.style.height = (p.row_heights ? p.row_heights[r] : 21) + "px";
      const rn = el("th", "rn", String(p.start_row + r + 1));
      if (frozen && r < frozen.rows) { rn.classList.add("fz"); rn.style.top = frozen.tops[r] + "px"; if (r === frozen.rows - 1) rn.classList.add("fzr-end"); }
      tr.append(rn);
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
    wrap.style.zoom = ZOOM;
    wrap.style.setProperty("--zoom", ZOOM);
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
    const tabs = el("div", "tabs");
    for (const t of hasStrip ? p.tabs : []) {
      if (t.hidden) continue;
      const b = el("button", "tb" + (t.title === p.tab ? " on" : "") + (t.title === switching ? " busy" : ""));
      b.type = "button";
      b.dataset.tab = t.title;
      b.append(el("i", "aid"), el("span", "", t.title));
      b.addEventListener("click", () => (aiAt && t.title === aiAt.tab ? focusClaude() : switchTab(t.title)));
      tabs.append(b);
    }
    inner.append(fbar, scroll, ...(hasStrip ? [tabs] : []), steps);
    fold.append(inner);
    card.classList.toggle("done", done);
    card.append(bar, fold, foot);
    ui = { live, ref, val, scroll, wrap, cells, cur, step, count, toggle, head, charts, covered, frozen, steps, tabs, selected: null };
    renderSteps();
    markClaudeTab();
    renderCharts();
  }

  // The user picked a tab in the strip: fetch that tab as it is now and show it. Claude's next edit
  // brings the view back to wherever Claude is working.
  // A tab the user picks stays shown (Claude's dot marks where it's working) until they click Claude's tab.
  let pinned = null, rushing = false; // rushing: a tab switch is waiting, so finish the animation quickly
  function switchTab(title, byUser = true, around = null) {
    if (!canPoll || !P || switching || title === P.tab) return Promise.resolve();
    switching = title;
    pinned = byUser ? title : null;
    for (const b of ui.tabs.children) b.classList.toggle("busy", b.dataset.tab === title);
    rushing = true;
    // In the queue, so an animation still typing into the old tab finishes before the grid is replaced.
    queue = queue.then(() => showTab(title, around)).catch((err) => console.error("Sheet preview:", err));
    return queue;
  }
  async function showTab(title, around) {
    rushing = false;
    const quoted = /^[A-Za-z_][A-Za-z0-9_]*$/.test(title) ? title : "'" + title.replace(/'/g, "''") + "'";
    try {
      const r = await request("tools/call", { name: "preview_updates", arguments: { spreadsheet: P.spreadsheet_id, range: quoted + "!" + windowAround(around), peek: true, since: seq, ...(account && { account }) } });
      const s = r && !r.isError && r.structuredContent;
      switching = null;
      if (s && s.preview) {
        keepOpen = true;
        if (done) setDone(false);
        P = inflate(s.preview);
        render(P, true);
        settle();
      }
    } catch {}
    switching = null;
    if (ui && ui.tabs) for (const b of ui.tabs.children) b.classList.remove("busy");
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
    const seeded = chartsSeeded;
    chartsSeeded = true;
    if (!P.charts) return;
    const headH = ui.head.offsetHeight;
    for (const ch of P.charts) {
      const box = el("div", "chart");
      box.style.cssText = "left:" + (42 + ch.left) + "px;top:" + (headH + ch.top) + "px;width:" + ch.width + "px;height:" + ch.height + "px";
      // A chart Claude changed (type, title, stacking, place or size) counts as new: it redraws and comes into view.
      const key = [ch.id, ch.type, ch.title, ch.stacked, ch.row, ch.col, ch.width, ch.height].join(":");
      const fresh = seeded && !seenCharts.has(key);
      if (!seenCharts.has(key)) box.classList.add("anim");
      seenCharts.add(key);
      box.innerHTML = chartSvg(ch);
      ui.charts.append(box);
      // A chart Claude just added: bring it into view, as Sheets does.
      if (fresh) chartToShow = { left: 42 + ch.left, top: headH + ch.top, width: ch.width, height: ch.height };
    }
  }
  let chartsSeeded = false; // charts present when the preview opens are not "new"
  let chartToShow = null;   // a chart Claude just added, scrolled into view once the step's animation is done
  function showNewChart() {
    if (!chartToShow) return;
    const s = ui.scroll, c = Object.fromEntries(Object.entries(chartToShow).map(([k, v]) => [k, v * ZOOM]));
    chartToShow = null;
    let toLeft = s.scrollLeft, toTop = s.scrollTop;
    if (c.left + Math.min(c.width, s.clientWidth - 60) > s.scrollLeft + s.clientWidth || c.left < s.scrollLeft + 42 * ZOOM) toLeft = Math.max(0, c.left - 60);
    if (c.top + Math.min(c.height, s.clientHeight - 40) > s.scrollTop + s.clientHeight || c.top < s.scrollTop) toTop = Math.max(0, c.top - 40);
    if (toLeft !== s.scrollLeft || toTop !== s.scrollTop) s.scrollTo({ top: toTop, left: toLeft });
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

  function moveCursor(v, scrollTo, instant) {
    const a = ui.cells[v.r0][v.c0], b = ui.cells[v.r1][v.c1];
    const w = ui.wrap.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    // Rects are measured on screen (zoomed); the outline is placed inside the zoomed grid, so it's unzoomed.
    const x = ra.left - w.left - 1, y = ra.top - w.top - 1;
    Object.assign(ui.cur.style, { transform: "translate(" + x / ZOOM + "px," + y / ZOOM + "px)", width: (rb.right - ra.left + 1) / ZOOM + "px", height: (rb.bottom - ra.top + 1) / ZOOM + "px" });
    ui.cur.classList.toggle("top", v.r0 === 0);
    ui.cur.classList.add("on");
    if (scrollTo) {
      // Keep the cursor in view both ways, clear of the header, row numbers and any frozen panes (which stay pinned).
      const s = ui.scroll, fz = ui.frozen;
      const padT = (fz ? fz.h : 24) * ZOOM, padL = (fz ? fz.w : 42) * ZOOM;
      const top = y - padT - 16, bottom = y + (rb.bottom - ra.top) + 24;
      const left = x - padL - 24, right = x + (rb.right - ra.left) + 24;
      let toTop = s.scrollTop, toLeft = s.scrollLeft;
      if (!(fz && v.r1 < fz.rows) && (top < s.scrollTop || bottom > s.scrollTop + s.clientHeight)) toTop = Math.max(0, top);
      if (!(fz && v.c1 < fz.cols) && (left < s.scrollLeft || right > s.scrollLeft + s.clientWidth)) toLeft = Math.max(0, right - s.clientWidth > left ? left : right - s.clientWidth);
      // One scroll for both directions: with smooth scrolling, a second assignment cancels the first one mid-flight.
      if (toTop !== s.scrollTop || toLeft !== s.scrollLeft) s.scrollTo({ top: toTop, left: toLeft, ...(instant && { behavior: "instant" }) });
    }
  }

  const WRITES = new Set(["write_range", "append_rows", "fill_range"]);
  const VERBS = { read_range: "Reading", read_ranges: "Reading", get_spreadsheet_info: "Looking over", write_range: "Writing", fill_range: "Filling", append_rows: "Adding rows", clear_range: "Clearing", find_replace: "Replacing",
    format_range: "Formatting", format_ranges: "Formatting", add_conditional_format: "Adding color rules", sort_range: "Sorting", set_filter: "Filtering", set_data_validation: "Adding dropdowns", add_chart: "Adding a chart",
    update_chart: "Updating a chart", delete_chart: "Removing a chart", add_pivot_table: "Adding a pivot table", freeze: "Freezing", resize_columns: "Resizing", merge_cells: "Merging", manage_tab: "Updating tabs",
    insert_rows_or_columns: "Inserting", delete_rows_or_columns: "Deleting", undo_last: "Undoing", batch_update: "Updating" };
  const where = (e) => (e.a1 ? (e.tab ? e.tab + "!" : "") + e.a1 : e.tab || "");
  // Each step has one row in the steps list, keyed by id: it appears when the tool starts and
  // settles when it finishes. The footer just says what Claude is doing.
  function showStep(state, e) {
    if (e.tab && state !== "fail") aiAt = { tab: e.tab, rect: e.rect || (aiAt && aiAt.tab === e.tab ? aiAt.rect : null) };
    const row = stepLog.find((x) => stepId(x.e) === stepId(e));
    if (row) { row.state = state; row.e = e; row.at = Date.now(); }
    else stepLog.push({ e, state, at: Date.now() });
    renderSteps();
    markClaudeTab();
    if (state !== "ok") {
      ui.step.textContent = "";
      const label = state === "run" ? (VERBS[e.tool] || "Working") + "…" : "Didn't finish";
      ui.step.append(el("span", "st " + state), el("span", "", label));
    }
    setLive();
  }
  // Rows are kept between updates (keyed by step), so only a new row slides in; the rest just change state.
  function renderSteps() {
    if (!ui || !ui.steps) return;
    const hidden = Math.max(0, stepLog.length - MAX_ROWS_SHOWN);
    const shown = stepLog.slice(hidden);
    const old = new Map([...ui.steps.querySelectorAll(".srow")].map((r) => [r.dataset.id, r]));
    const kids = [];
    if (hidden) kids.push(el("div", "smore", hidden + " earlier step" + (hidden === 1 ? "" : "s")));
    for (const { e, state } of shown) {
      const id = String(stepId(e));
      let row = old.get(id);
      if (!row) {
        row = el("div");
        row.dataset.id = id;
        row.insertAdjacentHTML("beforeend", SHEET);
        row.append(el("b"), el("code"), el("span"));
      } else row.style.animation = "none"; // already on screen: don't slide in again
      row.className = "srow " + state + (e.kind === "read" ? " read" : "");
      row.children[1].textContent = e.tool;
      row.children[2].textContent = where(e);
      row.children[3].className = "st " + state;
      kids.push(row);
    }
    ui.steps.replaceChildren(...kids);
  }

  function showSummary() {
    ui.step.textContent = "";
    const edits = history.filter((e) => e.kind !== "read"), reads = history.length - edits.length;
    const ch = changed();
    if (ch) ui.step.append(el("span", "who", "Claude"), " changed " + label(ch));
    else if (edits.some((e) => e.tab === P.tab)) ui.step.append(el("span", "who", "Claude"), " updated " + P.tab);
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
  // Where the sheet has content: the outline and summary don't count empty cells a clear or format touched.
  function usedRect() {
    let r1 = 0, c1 = 0;
    P.rows.forEach((row, r) => row.forEach((cell, c) => {
      const v = typeof cell === "string" ? cell : cell && (cell.v || cell.bg);
      if (v) { r1 = Math.max(r1, r + 1); c1 = Math.max(c1, c + 1); }
    }));
    // Only the far edges are known (cells above or left of the view may well have data), so clip those alone,
    // and not one the data reaches: it may carry on past the view (a write out to column AE).
    const reach = (n, size, start) => n >= size ? Infinity : start + n;
    return r1 ? { r0: 0, c0: 0, r1: reach(r1, P.rows.length, P.start_row), c1: reach(c1, (P.rows[0] || []).length, P.start_col) } : null;
  }
  const clip = (r, by) => r && by ? { r0: Math.max(r.r0, by.r0), c0: Math.max(r.c0, by.c0), r1: Math.min(r.r1, by.r1), c1: Math.min(r.c1, by.c1) } : r;
  const changed = () => {
    const mine = history.filter((e) => e.kind !== "read" && e.tab === P.tab && e.rect).map((e) => e.rect);
    const r = clip(union(mine), usedRect());
    return r && r.r1 > r.r0 && r.c1 > r.c0 ? r : null;
  };
  function settle() {
    // On a tab the user picked there's no outline and no scrolling: Claude isn't working there right now.
    const v = pinned ? null : visible(changed() || P.highlight);
    ui.cur.classList.remove("scan", "sweep");
    // The outline doesn't move the view: the last step already scrolled to what it changed (a new row at the
    // bottom, a chart off to the side), and jumping back to the top of a big outline would hide it.
    if (v) {
      moveCursor(v, false);
      // ...unless none of it is in view (say a chart off to the side was just deleted): then go back to it.
      const b = ui.scroll.getBoundingClientRect(), tl = ui.cells[v.r0][v.c0].getBoundingClientRect(), br = ui.cells[v.r1][v.c1].getBoundingClientRect();
      if (br.right <= b.left + 42 * ZOOM || tl.left >= b.right || br.bottom <= b.top + 24 * ZOOM || tl.top >= b.bottom) moveCursor(v, true);
      select(v.r0, v.c0, false);
      ui.cur.classList.add("settled");
    }
    else ui.cur.classList.remove("on");
    showSummary();
    armDone();
  }

  // Claude has no "finished" signal, so fold the preview down once it goes quiet:
  // shortly after the last step, or after a while if it never touched the sheet.
  const QUIET_MS = 12_000, NEVER_STARTED_MS = 90_000, STUCK_MS = 60_000;
  function armDone() {
    clearTimeout(doneTimer);
    if (done || keepOpen || busy || backlog) return;
    // A step that's still running keeps the sheet open (unless it's been stuck for a minute).
    if (stepLog.some((r) => r.state === "run" && Date.now() - r.at < STUCK_MS)) { doneTimer = setTimeout(armDone, 2000); return; }
    doneTimer = setTimeout(() => { if (!busy && !backlog) setDone(true); }, liveSteps ? QUIET_MS : NEVER_STARTED_MS);
  }
  function setDone(on) {
    clearTimeout(doneTimer);
    done = on;
    card.classList.toggle("done", on);
    if (ui) { showSummary(); setLive(); markClaudeTab(); }
  }

  // Where Claude is working: its tab gets an orange dot while it works, and clicking that tab
  // (even the one already shown) brings its latest step into view.
  let aiAt = null;
  function markClaudeTab() {
    if (!ui || !ui.tabs) return;
    for (const b of ui.tabs.children) {
      const here = !done && !!aiAt && b.dataset.tab === aiAt.tab;
      b.classList.toggle("ai", here);
      b.title = here ? "Claude is working here: click to see where" : b.classList.contains("on") ? "Shown now" : "Show " + b.dataset.tab;
    }
  }
  // The rows to load for a tab: the top, or around where Claude is working when that's further down.
  function windowAround(r) {
    if (!r || r.r1 <= 100) return "A1:" + col(Math.max(25, r ? r.c1 + 1 : 25)) + "100";
    return "A" + Math.max(1, r.r0 - 40) + ":" + col(Math.max(25, r.c1 + 1)) + (r.r1 + 20);
  }
  async function focusClaude() {
    const at = aiAt;
    if (!at || !P) return;
    pinned = null;
    const back = P.tab !== at.tab;
    if (back) await switchTab(at.tab, false, at.rect);
    if (!P || P.tab !== at.tab) return;
    if (done) { keepOpen = true; setDone(false); }
    const v = visible(at.rect);
    if (!v) return;
    // Coming back to Claude's tab, the outline is simply where Claude is, as if the view never left:
    // no slide in from the corner, no flash. On the same tab it glides over to it.
    if (!done) ui.cur.classList.remove("settled");
    if (back) ui.cur.classList.add("snap");
    moveCursor(v, true, back);
    select(v.r0, v.c0, false);
    if (back) { void ui.cur.offsetWidth; ui.cur.classList.remove("snap"); }
  }

  // ---------- animation ----------
  // Animate edits one after another. With a new preview, cells inside each edit's range change
  // as the cursor reaches them; everything else updates straight away.
  function enqueue(edits, next) {
    if (pinned && next && next.tab !== pinned) next = null; // the user is looking at another tab
    backlog++;
    clearTimeout(doneTimer);
    if (done) setDone(false);
    queue = queue.then(() => play(edits, next)).catch((err) => { console.error("Sheet preview:", err); busy = 0; }).then(() => { backlog--; armDone(); });
    return queue;
  }

  let pendingCharts;
  async function play(edits, next) {
    if (ui) ui.cur.classList.remove("settled");
    busy++;
    setLive();
    let deferred = null;
    // Only finished edits have changed cells; steps that just started (or failed) have nothing to type in.
    const finished = edits.filter((e) => !e.pending && !e.failed);
    if (next && sameShape(P, next)) {
      deferred = [];
      next.rows.forEach((row, r) => row.forEach((cell, c) => {
        if (same(cell, P.rows[r][c])) return;
        const inEdit = finished.some((e) => e.tab === next.tab && e.rect && r + next.start_row >= e.rect.r0 && r + next.start_row < e.rect.r1 && c + next.start_col >= e.rect.c0 && c + next.start_col < e.rect.c1);
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
      for (const e of finished) {
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
    // Pace each step by how much is waiting: a lone edit plays in full, a pile-up catches up quickly.
    let i = 0;
    const pace = () => (rushing ? 0.05 : backlog > 2 ? 0.25 : backlog > 1 || edits.length - i > 3 ? 0.45 : 1);
    const d = (ms) => sleep(Math.round(ms * pace()));
    for (const e of edits) {
      i++;
      if (e.pending) {
        // Just started: its row appears and the cursor goes to where it's about to work.
        showStep("run", e);
        const v = e.tab === P.tab ? visible(e.rect) : null;
        if (v) {
          ui.cur.classList.toggle("scan", e.kind === "read");
          ui.cur.classList.remove("sweep");
          moveCursor(v, true);
          select(v.r0, v.c0, false);
        }
        await d(120);
        continue;
      }
      if (e.failed) {
        showStep("fail", e);
        await d(120);
        continue;
      }
      showStep("run", e);
      const v = e.tab === P.tab ? visible(e.rect) : null;
      if (v && e.kind === "read") {
        ui.cur.classList.add("scan");
        ui.cur.classList.remove("sweep");
        moveCursor(v, true);
        select(v.r0, v.c0, false);
        await d(380);
        ui.cur.style.setProperty("--sweep", Math.round(750 * pace()) + "ms");
        void ui.cur.offsetWidth;
        ui.cur.classList.add("sweep");
        await d(780);
        history.push(e);
        liveSteps++;
        showStep("ok", e);
        await d(160);
        continue;
      }
      ui.cur.classList.remove("scan", "sweep");
      if (v) {
        moveCursor(v, true);
        select(v.r0, v.c0, false);
        await d(420);
        const todo = deferred ? deferred.filter((x) => x.r >= v.r0 && x.r <= v.r1 && x.c >= v.c0 && x.c <= v.c1) : [];
        const tds = [];
        for (let r = v.r0; r <= v.r1; r++) for (let c = v.c0; c <= v.c1; c++) tds.push({ r, c });
        const gap = Math.min(45, 700 / Math.max(1, tds.length));
        for (const t of tds) {
          const td = ui.cells[t.r][t.c];
          const x = todo.find((y) => y.r === t.r && y.c === t.c);
          if (x) { P.rows[x.r][x.c] = x.cell; paint(td, x.cell, x.r, x.c); td.classList.add("typed"); deferred.splice(deferred.indexOf(x), 1); }
          td.classList.remove("flash"); void td.offsetWidth; td.classList.add("flash");
          if (gap * pace() >= 4) await sleep(gap * pace());
        }
        select(v.r0, v.c0, false);
        await d(380);
      } else {
        await d(500);
      }
      history.push(e);
      liveSteps++;
      showStep("ok", e);
      await d(150);
    }
    // Anything a recalculation changed outside the animated ranges.
    if (deferred) for (const d of deferred) { P.rows[d.r][d.c] = d.cell; paint(ui.cells[d.r][d.c], d.cell, d.r, d.c); }
    if (pendingCharts !== undefined) { P.charts = pendingCharts; pendingCharts = undefined; renderCharts(); }
    showNewChart();
    busy--;
    settle();
    setLive();
  }

  // ---------- live updates ----------
  // Polls are cheap when nothing happened (the server answers from memory), so they come fast while
  // Claude is at work and ease off as the sheet goes quiet.
  let timer, lastEditAt = Date.now(), failures = 0, polling = false;
  const FAST = 600, MID = 1500, SLOW = 3000, ACTIVE_MS = 10_000, IDLE_SLOW = 60_000, IDLE_STOP = 10 * 60_000;

  function setLive() {
    if (!ui) return;
    const working = busy > 0 || running();
    ui.live.classList.toggle("on", canPoll);
    ui.live.classList.toggle("busy", working);
    ui.live.classList.toggle("polling", polling && !working);
    ui.live.classList.toggle("paused", canPoll && !polling && !working && !done);
    ui.live.classList.toggle("done", done && !working);
    ui.live.lastChild.textContent = busy ? "Editing" : running() ? "Working" : done ? "Done" : polling ? "Live" : "Paused";
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
      const res = await request("tools/call", { name: "preview_updates", arguments: { spreadsheet: P.spreadsheet_id, range: P.window, since: seq, ...(pinned && { stay: true }), ...(account && { account }) } });
      const u = res && res.structuredContent;
      if (!u || res.isError) throw new Error("bad update");
      failures = 0;
      if (u.seq > seq) seq = u.seq;
      if (u.edits && u.edits.length) {
        lastEditAt = Date.now();
        enqueue(u.edits, u.preview ? inflate(u.preview) : null);
      } else if (u.preview) {
        // A refresh the server held back earlier (to save Google read quota) arriving now: just update the cells.
        enqueue([], inflate(u.preview));
      }
    } catch {
      // A hiccup (or Google's per-minute quota) shouldn't end the live view: back off, and only give up after a while.
      if (++failures >= 6) return stopPolling();
      return schedule(SLOW * failures);
    }
    const quiet = Date.now() - lastEditAt;
    schedule(running() || quiet < ACTIVE_MS ? FAST : quiet > IDLE_SLOW ? SLOW : MID);
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
    P = inflate(s.preview);
    account = s.account;
    seq = s.seq || 0;
    render(P);
    setLive();
    // Steps from before the preview opened are counted and outlined, not replayed; one still running shows as such.
    if (s.edits) {
      for (const e of s.edits) {
        if (!e.pending && !e.failed) history.push(e);
        stepLog.push({ e, state: e.pending ? "run" : e.failed ? "fail" : "ok", at: Date.now() });
        if (e.tab && !e.failed) aiAt = { tab: e.tab, rect: e.rect || null };
      }
      renderSteps();
      markClaudeTab();
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
    // A preview that fails to draw falls back to the quiet note rather than an empty box.
    else if (m.method === "ui/notifications/tool-result") onResult(m.params).catch((err) => { console.error("Sheet preview:", err); unavailable("render error"); });
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
    appInfo: { name: "Sheets MCP preview", version: "1.4.0" },
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
