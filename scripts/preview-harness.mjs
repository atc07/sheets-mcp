// A stand-in MCP Apps host for the live sheet preview, for working on the widget without Claude.
// It serves the built widget in an iframe, answers its ui/initialize, hands it a sample sheet, then plays
// a scripted session through preview_updates: steps start (pending) and finish, cells change, a read
// scans, formatting lands, a fill runs, Claude moves to another tab, and one step fails.
// Usage: npm run build && node scripts/preview-harness.mjs   (then open http://localhost:4177)
import { createServer } from "node:http";
import { PREVIEW_HTML } from "../dist/preview-html.js";

const PORT = Number(process.env.PORT ?? 4177);

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sheet preview harness</title>
<style>
  body { margin: 0; padding: 20px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f5f2; color: #222; }
  body.dark { background: #2b2a28; color: #eee; }
  .row { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c9c6bd; background: #fff; cursor: pointer; }
  iframe { display: block; width: 860px; max-width: 100%; height: 200px; border: 0; background: transparent; }
  #log { margin-top: 14px; font: 11.5px/1.5 ui-monospace, Menlo, monospace; color: #666; white-space: pre-wrap; max-height: 220px; overflow: auto; }
</style>
</head>
<body>
<div class="row">
  <button id="replay">Replay session</button>
  <button id="theme">Toggle dark</button>
  <label><input type="checkbox" id="burst"> Burst (many steps at once)</label>
  <span id="status"></span>
</div>
<iframe id="w" src="/widget"></iframe>
<div id="log"></div>
<script>
(() => {
  const frame = document.getElementById("w"), log = document.getElementById("log"), status = document.getElementById("status");
  const say = (s) => { log.textContent = new Date().toISOString().slice(11, 23) + "  " + s + "\\n" + log.textContent; };
  let dark = false, burst = false;

  // ----- a sample sheet, in the compact wire format (plain cells are bare strings) -----
  const money = (n) => ({ v: (n < 0 ? "(" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US") + (n < 0 ? ")" : ""), n: true, ...(n < 0 && { fg: "#c00000" }) });
  const head = (t) => ({ v: t, b: true, bg: "#1f3864", fg: "#ffffff", al: "c" });
  const TABS = [{ title: "Dashboard" }, { title: "P&L" }, { title: "Inputs" }, { title: "Sites" }, { title: "Profit Options" }];
  function sheet() {
    const rows = [];
    rows.push(["", { v: "Profit Options - with and without Santos", b: true, fs: 14 }, "", "", "", "", "", "", "", ""]);
    rows.push(["", { v: "Live: every number links to the model.", i: true, fg: "#666666", fs: 9 }, "", "", "", "", "", "", "", ""]);
    // A wrapped label in a 16px column: the row must stay 21px with the text clipped, as in Sheets.
    rows.push([{ v: "OPTIONS", b: true, w: true, va: "t" }, head("#"), head("Option"), head("Lever"), head("Start"), head("Without Santos"), head("With Santos"), head("FY27 impact"), head("Cash impact"), head("Difficulty")]);
    const opts = [["A1", "Cut sales discounts on hosting", "10.0%", "Jan-27", 2050950, 2050950, "Medium"], ["A2", "Raise customer hosting price", "$0.004", "Jan-27", 1192098, 1192098, "Medium"],
      ["A3", "Renegotiate host power rates", "$0.003", "Jan-27", 1071681, 1071681, "Hard"], ["A4", "Don't renew sites that lose money", "$0", "Nov-26", 504749, 559917, "Medium"],
      ["A5", "Reduce headcount", "15.0%", "Nov-26", 1512073, 1506745, "Medium"], ["A6", "Exit or sublease office space", "50.0%", "Jan-27", 358556, 358556, "Medium"],
      ["A7", "Cut bank, admin and merchant fees", "30.0%", "Nov-26", 241020, 280020, "Easy"], ["A8", "Cut travel", "50.0%", "Nov-26", 294168, 341768, "Easy"]];
    for (const [id, name, lever, start, fy, cash, diff] of opts) rows.push(["", { v: id, fg: "#666666", al: "c" }, name, { v: lever, fg: "#0000ff", bg: "#fff2cc", al: "r" }, { v: start, al: "c" }, { v: "1", fg: "#0000ff", bg: "#fff2cc", al: "c" }, { v: "1", fg: "#0000ff", bg: "#fff2cc", al: "c" }, money(fy), money(cash), { v: diff, al: "c" }]);
    rows.push(["", "", { v: "Selected options", b: true }, "", "", "", "", { ...money(7225295), b: true }, { ...money(7369655), b: true }, ""]);
    for (let r = 0; r < 6; r++) rows.push(["", "", "", "", "", "", "", "", "", ""]);
    return {
      spreadsheet_id: "demo", title: "Compass Model V1", tab: "Profit Options", url: "https://docs.google.com/", window: "'Profit Options'!A1:J100",
      start_row: 0, start_col: 0, col_widths: [16, 40, 240, 90, 70, 110, 100, 110, 110, 80], row_heights: rows.map(() => 21),
      rows, hide_gridlines: true, frozen_rows: 3, frozen_cols: 3, tabs: TABS,
    };
  }
  function inputs() {
    const rows = [[{ v: "Inputs", b: true, fs: 14 }, "", "", ""], ["", head("Assumption"), head("Value"), head("Note")]];
    const items = [["Customer MW churn (%/mo)", "0.5%", "Seller cites >95% renewal"], ["Sales discounts", "17.5%", "YTD $3.95M / $22.6M"], ["Host rate change ($/kWh)", "$0.0000", "Scenario"], ["Minimum cash balance", "$500,000", ""], ["Funding plug on (1/0)", "1", ""]];
    for (const [a, b, c] of items) rows.push(["", a, { v: b, fg: "#0000ff", al: "r" }, { v: c, fg: "#666666", fs: 9 }]);
    for (let r = 0; r < 4; r++) rows.push(["", "", "", ""]);
    return { spreadsheet_id: "demo", title: "Compass Model V1", tab: "Inputs", url: "https://docs.google.com/", window: "Inputs!A1:D100", start_row: 0, start_col: 0, col_widths: [16, 260, 100, 300], row_heights: rows.map(() => 21), rows, frozen_rows: 2, tabs: TABS };
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ----- the scripted session -----
  let state, events, nextSeq, ids, timers = [];
  const rect = (r0, c0, r1, c1) => ({ r0, c0, r1, c1 });
  const a1 = (rc) => { const col = (i) => String.fromCharCode(65 + i); return col(rc.c0) + (rc.r0 + 1) + ":" + col(rc.c1 - 1) + rc.r1; };
  function step(tool, kind, tab, rc, change) {
    let id; // the start's seq, like the server's activity log
    const base = () => ({ id, tool, kind, tab, ...(rc && { rect: rc, a1: a1(rc) }) });
    return {
      start: () => { id = ++nextSeq; events.push({ ...base(), seq: id, pending: true }); },
      finish: () => { if (change) change(); events.push({ ...base(), seq: ++nextSeq, changed: !!change }); },
      fail: () => events.push({ ...base(), seq: ++nextSeq, failed: true }),
    };
  }
  function reset() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    state = { current: sheet(), seq: 0 };
    events = [];
    nextSeq = 0;
    const at = (ms, fn) => timers.push(setTimeout(fn, burst ? ms / 4 : ms));
    const s1 = step("write_range", "edit", "Profit Options", rect(3, 7, 7, 9), () => { for (let r = 3; r < 7; r++) { state.current.rows[r][7] = money(900000 + r * 137000); state.current.rows[r][8] = money(950000 + r * 141000); } });
    const s2 = step("read_range", "read", "Profit Options", rect(2, 1, 11, 10));
    const s3 = step("format_range", "edit", "Profit Options", rect(11, 2, 12, 9), () => { for (let c = 2; c < 9; c++) { const cell = state.current.rows[11][c]; state.current.rows[11][c] = typeof cell === "string" ? { v: cell, bg: "#e8f0fe", b: true } : { ...cell, bg: "#e8f0fe", b: true }; } });
    const s4 = step("fill_range", "edit", "Profit Options", rect(12, 1, 17, 10), () => { for (let r = 12; r < 17; r++) state.current.rows[r] = ["", { v: "B" + (r - 11), fg: "#666666", al: "c" }, "Santos lever " + (r - 11), { v: "0.5", fg: "#0000ff", bg: "#fff2cc", al: "r" }, { v: "Jan-27", al: "c" }, "", { v: "1", fg: "#0000ff", bg: "#fff2cc", al: "c" }, money(300000 * (r - 11)), money(310000 * (r - 11)), { v: "Medium", al: "c" }]; });
    const s5 = step("write_range", "edit", "Inputs", rect(2, 2, 4, 3), () => { state.current = inputs(); state.current.rows[2][2] = { v: "0.8%", fg: "#0000ff", al: "r" }; state.current.rows[3][2] = { v: "10.0%", fg: "#0000ff", al: "r" }; });
    const s6 = step("clear_range", "edit", "Inputs", rect(6, 1, 7, 4));
    at(900, s1.start); at(2600, s1.finish);
    at(3400, s2.start); at(4300, s2.finish);
    at(5200, s3.start); at(6200, s3.finish);
    at(7000, s4.start); at(8600, s4.finish);
    at(9600, s5.start); at(11200, s5.finish);
    at(12400, s6.start); at(13400, s6.fail);
    at(13600, () => { status.textContent = "Session played; the card folds after it goes quiet."; });
    status.textContent = "Playing…";
  }

  // ----- the host side of the MCP Apps protocol -----
  const send = (msg) => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...msg }, "*");
  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === "ui/initialize") {
      say("ui/initialize");
      send({ id: m.id, result: { protocolVersion: "2026-01-26", hostContext: { theme: dark ? "dark" : "light" }, hostCapabilities: { serverTools: {} } } });
    } else if (m.method === "ui/notifications/initialized") {
      reset();
      send({ method: "ui/notifications/tool-input", params: { arguments: { spreadsheet: "demo", range: "'Profit Options'!A1:J30" } } });
      send({ method: "ui/notifications/tool-result", params: { structuredContent: { preview: clone(state.current), edits: [], seq: 0, account: "demo@example.com" } } });
      say("tool-result sent (preview " + JSON.stringify(state.current).length + " chars)");
    } else if (m.method === "ui/notifications/size-changed") {
      frame.style.height = Math.ceil(m.params.height) + "px";
    } else if (m.method === "ui/open-link") {
      say("open-link " + m.params.url);
      send({ id: m.id, result: {} });
    } else if (m.method === "tools/call") {
      const a = m.params.arguments || {};
      if (m.params.name !== "preview_updates") return send({ id: m.id, error: { code: -32601, message: "Unknown tool" } });
      if (a.peek) {
        const tab = /^'?([^'!]+)'?!/.exec(a.range || "")?.[1];
        const p = tab === "Inputs" ? inputs() : tab === "Profit Options" ? clone(state.current.tab === "Profit Options" ? state.current : sheet()) : { ...inputs(), tab, rows: [[{ v: tab + " (sample)", b: true }, "", "", ""]], frozen_rows: 0 };
        say("peek " + tab);
        return send({ id: m.id, result: { structuredContent: { preview: p, seq: nextSeq } } });
      }
      const edits = events.filter((x) => x.seq > (a.since || 0)).map(({ changed, ...x }) => x);
      const changed = events.some((x) => x.seq > (a.since || 0) && x.changed);
      if (edits.length) say("preview_updates since " + a.since + " → " + edits.map((x) => x.tool + (x.pending ? " (started)" : x.failed ? " (failed)" : " (done)")).join(", "));
      send({ id: m.id, result: { structuredContent: { edits, seq: nextSeq, ...(changed && { preview: clone(state.current) }) } } });
    } else if (m.id != null && m.method) {
      send({ id: m.id, error: { code: -32601, message: "Method not found" } });
    }
  });

  document.getElementById("replay").addEventListener("click", () => { frame.src = "/widget?" + Date.now(); });
  document.getElementById("theme").addEventListener("click", () => { dark = !dark; document.body.classList.toggle("dark", dark); send({ method: "ui/notifications/host-context-changed", params: { theme: dark ? "dark" : "light" } }); });
  document.getElementById("burst").addEventListener("change", (e) => { burst = e.target.checked; });
})();
</script>
</body>
</html>`;

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/widget") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(PREVIEW_HTML);
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(PAGE);
}).listen(PORT, () => console.log(`Sheet preview harness: http://localhost:${PORT}`));
