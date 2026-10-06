// End-to-end test rig for the live sheet preview: the real server, a real spreadsheet, the real widget.
// It serves a stand-in Claude chat at http://localhost:4178/?s=<scenario>: the page asks the server for
// show_range, hands the result to the widget, and forwards the widget's own preview_updates calls to the
// same server process, while a scripted "Claude" makes reads and edits in the background with pauses.
// Usage: npm run build && node scripts/preview-live.mjs <spreadsheet id or link> [account]
//        then open http://localhost:4178/?s=build (scenarios: build, wide, long, tabs, fail, read, demo, tidy, charts, errors, big, text, fill; &dark=1, &w=720)
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PREVIEW_HTML } from "../dist/preview-html.js";

const [sheetArg, account] = process.argv.slice(2);
if (!sheetArg) {
  console.error("Usage: node scripts/preview-live.mjs <spreadsheet id or link> [account]");
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 4178);
const root = new URL("..", import.meta.url).pathname;

const client = new Client({ name: "preview-live", version: "1" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } });
await client.connect(new StdioClientTransport({ command: "node", args: [`${root}dist/index.js`], stderr: "inherit" }));
// Resetting the sheet goes through a separate server process, so it isn't part of the session the preview shows.
const setup = new Client({ name: "preview-live-setup", version: "1" });
await setup.connect(new StdioClientTransport({ command: "node", args: [`${root}dist/index.js`], stderr: "ignore" }));
let viaSetup = false;
const call = async (name, args) => {
  const c = viaSetup ? setup : client;
  const r = await c.callTool({ name, arguments: { spreadsheet: sheetArg, ...(account && { account }), ...args } });
  if (r.isError && !viaSetup) console.log(`  ${name} failed: ${r.content?.[0]?.text?.slice(0, 160)}`);
  return r;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = (ms = 1200) => sleep(ms + Math.random() * 400);

// ----- scenarios: what a Claude turn typically does -----
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
async function reset(tabs = ["Sales"]) {
  const info = JSON.parse((await call("get_spreadsheet_info", { preview_rows: 0 })).content[0].text.replace(/^\[account[^\n]*\n/, ""));
  for (const t of info.tabs) for (const ch of t.charts ?? []) await call("delete_chart", { chart_id: ch.chart_id });
  for (const name of tabs) if (!info.tabs.some((t) => t.title === name)) await call("manage_tab", { action: "add", tab: name });
  for (const t of info.tabs) if (!tabs.includes(t.title)) await call("manage_tab", { action: "delete", tab: t.title });
  for (const name of tabs) {
    await call("batch_update", { requests: [{ unmergeCells: { range: { sheetId: (await sheetId(name)) } } }] });
    await call("clear_range", { range: `'${name}'` });
    await call("format_range", { range: `'${name}'`, clear_formatting: true });
    await call("freeze", { tab: name, rows: 0, columns: 0 });
    await call("set_filter", { range: `'${name}'`, clear: true });
    await call("set_data_validation", { range: `'${name}'`, type: "clear" });
    // Conditional formats survive a clear; remove them too (one at a time until there are none left).
    const sid = await sheetId(name);
    for (let k = 0; k < 20; k++) if ((await call("batch_update", { requests: [{ deleteConditionalFormatRule: { sheetId: sid, index: 0 } }] })).isError) break;
    await call("resize_columns", { range: `'${name}'`, width: 100 });
  }
}
async function sheetId(name) {
  const info = JSON.parse((await call("get_spreadsheet_info", { preview_rows: 0 })).content[0].text.replace(/^\[account[^\n]*\n/, ""));
  return info.tabs.find((t) => t.title === name).sheet_id;
}
const SCENARIOS = {
  // From an empty tab to a finished table with a chart: the common case.
  async build() {
    await think(800);
    await call("get_spreadsheet_info", { preview_rows: 3 });
    await think();
    await call("write_range", { range: "Sales!A1", values: [["Month", "Revenue", "Cost"], ...months.map((m, i) => [m, 12000 + i * 1300 + (i % 3) * 900, 8000 + i * 400])] });
    await think();
    await call("write_range", { range: "Sales!D1", values: [["Profit"], ...months.map((_, i) => [`=B${i + 2}-C${i + 2}`])] });
    await think();
    await call("write_range", { range: "Sales!A14", values: [["Total", "=SUM(B2:B13)", "=SUM(C2:C13)", "=SUM(D2:D13)"]] });
    await think();
    await call("format_range", { range: "Sales!B2:D14", number_format: { type: "CURRENCY", pattern: "$#,##0" } });
    await think(600);
    await call("format_range", { range: "Sales!A1:D1", bold: true, background_color: "#1f3864", text_color: "#ffffff", horizontal_alignment: "CENTER" });
    await think(600);
    await call("format_range", { range: "Sales!A14:D14", bold: true, borders: { sides: "top", style: "SOLID_MEDIUM" } });
    await think(600);
    await call("freeze", { tab: "Sales", rows: 1 });
    await think();
    await call("add_conditional_format", { range: "Sales!D2:D13", color_scale: { min_color: "#fce8e6", max_color: "#e6f4ea" } });
    await think();
    await call("add_chart", { data_range: "Sales!A1:B13", chart_type: "COLUMN", title: "Revenue by month", anchor_cell: "Sales!F2" });
  },
  // A wide table: the view has to follow Claude sideways.
  async wide() {
    await think(800);
    const cols = 30;
    await call("write_range", { range: "Sales!A1", values: [["Site", ...Array.from({ length: cols - 1 }, (_, i) => `Wk ${i + 1}`)], ...["North", "South", "East", "West"].map((s, r) => [s, ...Array.from({ length: cols - 1 }, (_, i) => 100 + r * 10 + i)])] });
    await think();
    await call("write_range", { range: "Sales!AE1", values: [["Total"], ...[2, 3, 4, 5].map((r) => [`=SUM(B${r}:AD${r})`])] });
    await think();
    await call("format_range", { range: "Sales!AE1:AE5", bold: true, background_color: "#e6f4ea" });
    await think();
    await call("format_range", { range: "Sales!A1:AE1", bold: true });
  },
  // A long sheet: appends far below the first screen.
  async long() {
    await think(800);
    const rows = Array.from({ length: 150 }, (_, i) => [`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, ["Rent", "Payroll", "Software", "Travel"][i % 4], 100 + ((i * 37) % 900)]);
    await call("write_range", { range: "Sales!A1", values: [["Date", "Category", "Amount"], ...rows] });
    await think();
    await call("read_range", { range: "Sales!A1:C152" });
    await think();
    await call("append_rows", { range: "Sales", values: [["2026-12-31", "Total", "=SUM(C2:C151)"]] });
    await think();
    await call("format_range", { range: "Sales!A152:C152", bold: true });
  },
  // Work that moves between tabs, with a pivot table on a new tab.
  async tabs() {
    await think(800);
    const orders = [["Region", "Product", "Units", "Revenue"]];
    for (let i = 0; i < 24; i++) orders.push([["East", "West", "North"][i % 3], ["Widget", "Gadget"][i % 2], 1 + (i % 5), 100 * (1 + (i % 5))]);
    await call("write_range", { range: "Orders!A1", values: orders });
    await think();
    await call("read_ranges", { ranges: ["Orders!A1:D25", "Sales!A1:B3"] });
    await think();
    await call("add_pivot_table", { source_range: "Orders!A1:D25", rows: ["Region"], columns: ["Product"], values: [{ column: "Revenue" }] });
    await think();
    await call("write_range", { range: "Sales!A1", values: [["See the Pivot tab for revenue by region."]] });
    await think();
    await call("format_range", { range: "Sales!A1", italic: true });
  },
  // One step fails; the rest carry on.
  async fail() {
    await think(800);
    await call("write_range", { range: "Sales!A1", values: [["Item", "Qty"], ["Pens", 12], ["Paper", 5]] });
    await think();
    await call("write_range", { range: "NoSuchTab!A1", values: [["x"]] });
    await think();
    await call("format_range", { range: "Sales!A1:B1", bold: true });
  },
  // A question: Claude only reads.
  async read() {
    await think(800);
    await call("write_range", { range: "Sales!A1", values: [["Month", "Revenue"], ...months.map((m, i) => [m, 10000 + i * 900])] });
    await think(400);
    await call("get_spreadsheet_info", { preview_rows: 3 });
    await think();
    await call("read_range", { range: "Sales!A1:B13" });
    await think();
    await call("read_range", { range: "Sales!B2:B13", mode: "formulas" });
  },
  // The README animation: a budget that's already there gets a profit column, totals, formatting and a chart.
  // (Seeded by /reset?s=demo, outside the recording.)
  async demo() {
    await think(900);
    await call("read_range", { range: "Sales!A1:C13" });
    await think(1500);
    await call("write_range", { range: "Sales!D1", values: [["Profit"], ...months.map((_, i) => [`=B${i + 2}-C${i + 2}`])] });
    await think(1400);
    await call("write_range", { range: "Sales!A14", values: [["Total", "=SUM(B2:B13)", "=SUM(C2:C13)", "=SUM(D2:D13)"]] });
    await think(1300);
    await call("format_ranges", { items: [
      { range: "Sales!B2:D14", number_format: { type: "CURRENCY", pattern: "$#,##0" } },
      { range: "Sales!A1:D1", bold: true, background_color: "#1f3864", text_color: "#ffffff" },
      { range: "Sales!A14:D14", bold: true, borders: { sides: "top", style: "SOLID_MEDIUM" } },
    ] });
    await think(1200);
    await call("freeze", { tab: "Sales", rows: 1 });
    await think(1300);
    await call("add_chart", { data_range: "Sales!A1:B13", chart_type: "COLUMN", title: "Revenue by month", anchor_cell: "Sales!E2" });
  },
  // Tidying an existing table: sort, filter, dropdowns, find/replace, rows in and out, a merged title, undo.
  async tidy() {
    await think(800);
    const people = [["Name", "Team", "Status", "Hours"], ["Dana", "Ops", "open", 12], ["Ari", "Sales", "done", 30], ["Kim", "Ops", "open", 7], ["Lee", "Eng", "blocked", 22], ["Sam", "Eng", "done", 15], ["Jo", "Sales", "open", 9]];
    await call("write_range", { range: "Sales!A1", values: people });
    await think();
    await call("sort_range", { range: "Sales!A1:D7", sort_by: [{ column: "D", ascending: false }] });
    await think();
    await call("find_replace", { find: "open", replacement: "Open", sheet: "Sales", match_entire_cell: true });
    await think();
    await call("set_data_validation", { range: "Sales!C2:C7", type: "dropdown", options: ["Open", "done", "blocked"] });
    await think();
    await call("insert_rows_or_columns", { tab: "Sales", dimension: "ROWS", before: "1", count: 1 });
    await think();
    await call("write_range", { range: "Sales!A1", values: [["Team hours, week 40"]] });
    await think(600);
    await call("merge_cells", { range: "Sales!A1:D1" });
    await think(600);
    await call("format_range", { range: "Sales!A1", bold: true, font_size: 14, horizontal_alignment: "CENTER" });
    await think();
    await call("set_filter", { range: "Sales!A2:D8" });
    await think();
    await call("delete_rows_or_columns", { range: "Sales!8:8" });
    await think();
    await call("write_range", { range: "Sales!D3", values: [[999]] });
    await think();
    await call("undo_last", {});
  },
  // Charts Claude adds, changes and removes.
  async charts() {
    await think(800);
    await call("write_range", { range: "Sales!A1", values: [["Quarter", "North", "South"], ["Q1", 120, 90], ["Q2", 150, 110], ["Q3", 170, 160], ["Q4", 210, 180]] });
    await think();
    const a = await call("add_chart", { data_range: "Sales!A1:C5", chart_type: "COLUMN", title: "Sales by quarter", anchor_cell: "Sales!E1" });
    const id = Number(/chart[_ ]?id\D{0,4}(\d+)/i.exec(a.content?.[0]?.text ?? "")?.[1]);
    await think();
    await call("add_chart", { data_range: "Sales!A1:B5", chart_type: "PIE", title: "North share", anchor_cell: "Sales!E22" });
    await think();
    if (id) await call("update_chart", { chart_id: id, chart_type: "LINE", title: "Sales trend" });
    await think();
    if (id) await call("update_chart", { chart_id: id, stacked: true, chart_type: "AREA" });
    await think();
    if (id) await call("delete_chart", { chart_id: id });
  },
  // Formulas that go wrong, then get fixed.
  async errors() {
    await think(800);
    await call("write_range", { range: "Sales!A1", values: [["Item", "Units", "Price", "Per unit"], ["A", 10, 50, "=C2/B2"], ["B", 0, 40, "=C3/B3"], ["C", 5, 20, "=C4/B4"], ["Ref", "", "", "=VLOOKUP(\"Z\",A2:B4,2,FALSE)"]] });
    await think();
    await call("write_range", { range: "Sales!D2:D5", values: [["=IFERROR(C2/B2,\"\")"], ["=IFERROR(C3/B3,\"\")"], ["=IFERROR(C4/B4,\"\")"], ["=IFERROR(VLOOKUP(\"Z\",A2:B4,2,FALSE),\"none\")"]] });
  },
  // A big sheet: 1,000 rows by 12 columns, read back in one go.
  async big() {
    await think(800);
    const rows = Array.from({ length: 1000 }, (_, i) => [`R${i + 1}`, ...Array.from({ length: 11 }, (_, j) => (i * 13 + j * 7) % 500)]);
    await call("write_range", { range: "Sales!A1", values: [["Row", ...months.slice(0, 11)], ...rows], allow_large: true });
    await think();
    await call("read_range", { range: "Sales" });
    await think();
    await call("format_range", { range: "Sales!A1:L1", bold: true, background_color: "#fff2cc" });
  },
  // Odd text: long, accented, emoji, wrapped, percentages and dates.
  async text() {
    await think(800);
    await call("write_range", { range: "Sales!A1", values: [["Note", "Owner", "Done", "Due"], ["A very long note that keeps going well past the edge of its column so it has to spill or wrap somewhere", "Zoë Ñúñez", 0.42, "2026-11-03"], ["Café ☕ order 🚀", "李雷", 1, "2026-12-24"], ["", "", "", ""], ["Short", "O'Brien \"OB\"", 0.075, "2027-01-01"]] });
    await think();
    await call("format_ranges", { items: [{ range: "Sales!C2:C5", number_format: { type: "PERCENT", pattern: "0.0%" } }, { range: "Sales!D2:D5", number_format: { type: "DATE", pattern: "mmm d, yyyy" } }, { range: "Sales!A1:D1", bold: true, borders: { sides: "bottom", style: "SOLID" } }] });
    await think();
    await call("format_range", { range: "Sales!A2:A5", wrap: "WRAP" });
    await think();
    await call("resize_columns", { range: "Sales!A:A", width: 220 });
  },
  // Fill a formula down and a series across, the way the fill handle does.
  async fill() {
    await think(800);
    await call("write_range", { range: "Sales!A1", values: [["Week", "Units", "Price", "Revenue"], [1, 12, 9.5, "=B2*C2"], [2, 15, 9.5, ""], ["", 9, 9.5, ""], ["", 20, 10, ""], ["", 18, 10, ""]] });
    await think();
    await call("fill_range", { source: "Sales!A2:A3", destination: "Sales!A2:A6", continue_series: true });
    await think();
    await call("fill_range", { source: "Sales!D2", destination: "Sales!D2:D6", paste: "formulas" });
    await think();
    await call("clear_range", { range: "Sales!C2:C6" });
    await think();
    await call("undo_last", {});
  },
};
const SETUP = { tabs: ["Sales", "Orders"] };
// Data a scenario starts from, written during /reset (so it isn't part of what the preview shows).
const SEEDS = {
  async demo() {
    await call("write_range", { range: "Sales!A1", values: [["Month", "Revenue", "Cost"], ...months.map((m, i) => [m, 12000 + i * 1300 + (i % 3) * 900, 8000 + i * 400 + (i % 2) * 600])] });
  },
};

let running = false;
async function startScenario(name) {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    console.log(`scenario ${name}: start`);
    await SCENARIOS[name]();
    console.log(`scenario ${name}: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    running = false;
  }
}

const page = (q) => /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Live preview test</title>
<style>
  body { margin: 0; padding: 22px 26px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: ${q.dark ? "#262624" : "#faf9f5"}; color: ${q.dark ? "#eee" : "#1f1e1d"}; }
  .col { width: ${Number(q.w) || 720}px; max-width: 100%; margin: 0 auto; }
  .you { margin: 0 0 16px auto; width: fit-content; max-width: 80%; background: ${q.dark ? "#3a3936" : "#f0eee6"}; border-radius: 14px; padding: 10px 16px; }
  .who { font-size: 13px; color: #73726c; margin: 0 0 8px 2px; } .who code { font: 12.5px ui-monospace, Menlo, monospace; }
  iframe { width: 100%; border: 0; display: block; height: 80px; }
</style></head><body><div class="col">
<div class="you">${q.ask || "Can you set this up for me?"}</div>
${q.clean ? "" : '<div class="who">Widget from Sheets MCP <code>show_range</code></div>'}
<iframe id="w" sandbox="allow-scripts${q.debug ? " allow-same-origin" : ""}"></iframe>
</div><script>
const f = document.getElementById("w");
f.srcdoc = ${JSON.stringify(PREVIEW_HTML).replace(/<\//g, "<\\/")};
const post = (m) => f.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
const api = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
window.addEventListener("message", async (e) => {
  if (e.source !== f.contentWindow) return;
  const m = e.data;
  if (m.method === "ui/initialize") post({ id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "live-rig", version: "1" }, hostCapabilities: { openLinks: {}, serverTools: {} }, hostContext: { theme: ${q.dark ? '"dark"' : '"light"'} } } });
  if (m.method === "ui/notifications/initialized") {
    const args = { spreadsheet: "rig" };
    post({ method: "ui/notifications/tool-input", params: { arguments: args } });
    const result = await api("/show", { scenario: ${JSON.stringify(q.s || null)} });
    post({ method: "ui/notifications/tool-result", params: result });
  }
  if (m.method === "ui/notifications/size-changed") f.style.height = m.params.height + "px";
  if (m.method === "ui/open-link") post({ id: m.id, result: {} });
  if (m.method === "tools/call") post({ id: m.id, result: await api("/call", m.params) });
});
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const body = req.method === "POST" ? JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); })) : {};
  const json = (x) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(x)); };
  try {
    if (url.pathname === "/" ) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page(Object.fromEntries(url.searchParams)));
    }
    if (url.pathname === "/reset") { // prepare the sheet before a run, outside the recording
      viaSetup = true;
      try {
        await reset(SETUP.tabs);
        const seed = SEEDS[url.searchParams.get("s")];
        if (seed) await seed();
        // ?title= renames the spreadsheet (the preview's header shows it), e.g. for a recording.
        const title = url.searchParams.get("title");
        if (title) await call("batch_update", { requests: [{ updateSpreadsheetProperties: { properties: { title }, fields: "title" } }] });
      } finally { viaSetup = false; }
      return json({ ok: true });
    }
    if (url.pathname === "/show") {
      const r = await call("show_range", {});
      if (SCENARIOS[body.scenario]) setTimeout(() => startScenario(body.scenario), 300);
      return json(r);
    }
    if (url.pathname === "/call") {
      const { name, arguments: args } = body;
      return json(await client.callTool({ name, arguments: { ...args, spreadsheet: sheetArg, ...(account && { account }) } }));
    }
    if (url.pathname === "/status") return json({ running });
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500).end(String(e?.stack ?? e));
  }
}).listen(PORT, () => console.log(`Live preview rig on http://localhost:${PORT}/?s=build  (GET /reset to clear the sheet first)`));
