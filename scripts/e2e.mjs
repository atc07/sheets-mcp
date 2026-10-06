import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c = new Client({ name: "e2e", version: "1" });
await c.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
let fails = 0;
async function t(name, args, check, expectError = false) {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text.replace(/^\[account: [^\]]+\]\n/, ""); // multi-account prefix
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const ok = expectError ? !!r.isError : !r.isError && (!check || check(data));
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n   " + text.slice(0, 400)}`);
  return data;
}
const { spreadsheet_id: id, url } = await t("create_spreadsheet", { title: "Sheets MCP test (safe to delete)", sheet_names: ["Sales"], account: "collectivetheory" }, d => d.spreadsheet_id);
await t("write_range", { spreadsheet: id, range: "Sales!A1", values: [["Month","Revenue","Cost","Profit"],["Jan",1200,800,"=B2-C2"],["Feb",1500,900,"=B3-C3"],["Mar",1800,950,"=B4-C4"],["Total","=SUM(B2:B4)","=SUM(C2:C4)","=SUM(D2:D4)"]] },
  d => d.formula_errors.length === 0 && d.computed_values[4][3] === "1850");
await t("write_range", { spreadsheet: id, range: "Sales!E1", values: [["Margin"], ["=D2/B2"]] }, d => d.formula_errors.length === 0);
await t("fill_range", { spreadsheet: id, source: "Sales!E2", destination: "Sales!E2:E4" }, d => d.filled_range === "Sales!E3:E4" && d.formula_errors.length === 0 && d.computed_values[0][0] === "0.4");
await t("read_range", { spreadsheet: id, range: "Sales!E4", mode: "formulas" }, d => d.values[0][0] === "=D4/B4");
await t("write_range", { spreadsheet: id, range: "Sales!G1", values: [[1], [2]] });
await t("fill_range", { spreadsheet: id, source: "Sales!G1:G2", destination: "Sales!G3:G5", continue_series: true }, d => d.filled_range === "Sales!G3:G5" && d.computed_values.map(r => r[0]).join() === "3,4,5");
await t("fill_range", { spreadsheet: id, source: "Sales!G1:G2", destination: "Sales!A1:B2", continue_series: true }, null, true); // should error: not adjacent
await t("format_ranges", { spreadsheet: id, items: [{ range: "Sales!A1:D1", italic: true }, { range: "Sales!A2:A4", text_color: "#1a73e8" }] }, d => d.formatted === 2 && d.formatted_range === "Sales!A1:D4");
await t("read_range", { spreadsheet: id, range: "Sales!A1:A2", mode: "formats" }, d => Object.values(d.styles).some(s => s.includes("italic")) && Object.values(d.styles).some(s => s.includes("fg #1a73e8")));
await t("write_range", { spreadsheet: id, range: "Sales!F1", values: [["=A1+#REF!"], ["=1/0"]] }, d => d.formula_errors.length === 2);
await t("undo_last", { spreadsheet: id }, d => d.restored_range);
await t("read_range", { spreadsheet: id, range: "Sales!F1:F2" }, d => d.values.length === 0);
await t("read_range", { spreadsheet: id, range: "Sales", mode: "formulas" }, d => d.values[1][3] === "=B2-C2");
await t("format_range", { spreadsheet: id, range: "Sales!A1:D1", bold: true, background_color: "#e8f0fe", borders: { sides: "bottom", style: "SOLID_MEDIUM" } });
await t("format_range", { spreadsheet: id, range: "Sales!B2:D5", number_format: { type: "CURRENCY", pattern: "$#,##0" } });
await t("read_range", { spreadsheet: id, range: "Sales!B2" }, d => d.values[0][0] === "$1,200");
await t("read_range", { spreadsheet: id, range: "Sales!A1:D5", mode: "formats" }, d => Object.values(d.styles).some(s => s.includes("bg #e8f0fe") && s.includes("bold") && s.includes("border bottom #000000 solid_medium")) && d.rows[0].startsWith("1: A:D s"));
await t("freeze", { spreadsheet: id, tab: "Sales", rows: 1 });
await t("add_conditional_format", { spreadsheet: id, range: "Sales!D2:D4", color_scale: { min_color: "#fce8e6", max_color: "#e6f4ea" } });
const chart = await t("add_chart", { spreadsheet: id, data_range: "Sales!A1:B4", chart_type: "COLUMN", title: "Revenue by month" }, d => d.chart_id);
await t("update_chart", { spreadsheet: id, chart_id: chart.chart_id, title: "Revenue", chart_type: "LINE", width: 480 }, d => d.changed.join() === "title,type,size");
const extra = await t("add_chart", { spreadsheet: id, data_range: "Sales!A1:B4", chart_type: "PIE" }, d => d.chart_id);
await t("delete_chart", { spreadsheet: id, chart_id: extra.chart_id }, d => d.deleted_chart === extra.chart_id);
await t("read_ranges", { spreadsheet: id, ranges: ["Sales!A1:B2", "Sales!D5"] }, d => d.ranges.length === 2 && d.ranges[0].values[0][1] === "Revenue");
await t("add_pivot_table", { spreadsheet: id, source_range: "Sales!A1:D4", rows: ["Month"], values: [{ column: "Profit" }] }, d => d.tab === "Pivot" && d.preview[0].includes("SUM of Profit"));
await t("sort_range", { spreadsheet: id, range: "Sales!A1:D4", sort_by: [{ column: "B", ascending: false }] });
await t("read_range", { spreadsheet: id, range: "Sales!A2:A4" }, d => d.values.map(r => r[0]).join() === "Mar,Feb,Jan");
await t("set_data_validation", { spreadsheet: id, range: "Sales!E2:E4", type: "dropdown", options: ["On track", "At risk"] });
await t("append_rows", { spreadsheet: id, range: "Missing", values: [["x"]] }, null, true); // should error: no such tab
await t("manage_tab", { spreadsheet: id, action: "add", tab: "Notes" }, d => d.title === "Notes");
await t("append_rows", { spreadsheet: id, range: "Notes", values: [["Created by the Sheets MCP end-to-end test."]] }, d => d.appended_range);
await t("resize_columns", { spreadsheet: id, range: "Sales!A:G" });
const info = await t("get_spreadsheet_info", { spreadsheet: url }, d => d.tabs.length === 3 && d.tabs[0].frozen_rows === 1 && d.tabs[0].charts.length === 1 && d.tabs[0].charts[0].type === "LINE");
console.log(`\n${fails === 0 ? "ALL PASSED" : fails + " FAILED"}\n${url}`);
await c.close();
process.exit(fails ? 1 : 0);
