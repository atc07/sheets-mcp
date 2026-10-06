import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { z } from "zod";
import { colToIndex, hexToColor, indexToCol, parseA1, quoteSheet, spreadsheetIdFrom, toA1 } from "./a1.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { findSpreadsheets, forgetAccount, looksLikeSpreadsheetRef, rememberSpreadsheet, spreadsheetUrl } from "./recent.js";
import {
  PREVIEW_HTML,
  PREVIEW_MIME,
  PREVIEW_URI,
  UI_EXTENSION,
  buildPreview,
  fitWindow,
  previewSummary,
  previewWindow,
  toRect,
  union,
  type PreviewEdit,
  type PreviewTab,
  type Rect,
} from "./preview.js";
import { getAuthClient, getDefaultAccount, listAccounts, removeAccount, resolveAccount, setDefaultAccount, startSignIn, type SignIn } from "./auth.js";

type Request = sheets_v4.Schema$Request;
type Cell = string | number | boolean | null;

const MAX_WRITE_CELLS = 10_000;
const UNDO_DEPTH = 20;
const ERROR_VALUE = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!|SPILL!|CALC!)/;

// ---------- accounts ----------

/** The Google account the current tool call runs as. */
const currentAccount = new AsyncLocalStorage<string>();
const clients = new Map<string, { sheets: sheets_v4.Sheets }>();
/** Which account last succeeded for a spreadsheet, so later calls go straight there. */
const accountForSpreadsheet = new Map<string, string>();

function api() {
  const email = currentAccount.getStore();
  if (!email) throw new Error("No Google account selected.");
  let c = clients.get(email);
  if (!c) {
    const auth = getAuthClient(email);
    // Every Sheets request goes through auth.request: count reads (for the preview's budget) and, when Google
    // says the per-minute quota is used up, wait and send the same request again instead of failing the step.
    const send = auth.request.bind(auth);
    auth.request = (async (opts: any) => {
      if ((opts?.method ?? "GET") === "GET") noteRead(email);
      for (let attempt = 0; ; attempt++) {
        try {
          return await send(opts);
        } catch (e: any) {
          const status = e?.status ?? e?.response?.status ?? e?.code;
          if (status !== 429 || attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt + Math.random() * 500));
        }
      }
    }) as typeof auth.request;
    c = { sheets: sheets({ version: "v4", auth }) };
    clients.set(email, c);
  }
  return c;
}

// ---------- read budget ----------

/** Google allows about 60 Sheets reads per minute per user; the live preview only spends what Claude's work leaves. */
const reads = new Map<string, number[]>();
function noteRead(email: string) {
  const now = Date.now();
  const list = (reads.get(email) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  reads.set(email, list);
}
function readsLastMinute(email = currentAccount.getStore() ?? "") {
  const now = Date.now();
  return (reads.get(email) ?? []).filter((t) => now - t < 60_000).length;
}
const PREVIEW_READ_BUDGET = 40;
/** Past the budget the preview still refreshes now and then, until reads get close to Google's limit. */
const PREVIEW_SLOW_MS = 6_000, PREVIEW_READ_CEILING = 52;
const lastRebuild = new Map<string, number>();
/** Spreadsheets whose preview skipped a rebuild to save reads, and should get one as soon as there's room. */
const staleFor = new Set<string>();

const SIGN_IN_WAIT_MS = Number(process.env.SHEETS_MCP_SIGNIN_WAIT_MS ?? 45_000);
let pendingSignIn: Promise<SignIn> | undefined;

/**
 * Open (or reuse) a browser sign-in and wait briefly for the user to finish.
 * Returns the email, or undefined if they haven't finished yet (the sign-in stays open).
 */
async function signIn(): Promise<{ email?: string; url: string }> {
  const p = (pendingSignIn ??= startSignIn());
  const { url, done } = await p;
  done.finally(() => pendingSignIn === p && (pendingSignIn = undefined)).catch(() => {});
  const email = await Promise.race([done, new Promise<undefined>((r) => setTimeout(r, SIGN_IN_WAIT_MS))]);
  return { email, url };
}

function signInPending(url: string) {
  return new Error(
    `Google sign-in needed. A Google sign-in page has opened in the user's web browser (if it didn't, they can open this link: ${url}). ` +
      `Ask them to choose their Google account, click "Advanced" then "Go to Sheets MCP" if Google shows an "unverified app" warning, allow access, and then tell you when they're done so you can try again.`,
  );
}

async function accounts() {
  if (!listAccounts().length) {
    const { email, url } = await signIn();
    if (!email) throw signInPending(url);
  }
  return { all: listAccounts(), fallback: getDefaultAccount()! };
}

/** Errors where another account might succeed: no access, not found, or this account's sign-in is broken. */
function isAccountError(e: any) {
  const status = e?.status ?? e?.response?.status ?? e?.code;
  return status === 401 || status === 403 || status === 404 || e?.response?.data?.error === "invalid_grant";
}

function errorMessage(e: any): string {
  if (e?.response?.data?.error === "invalid_grant") {
    return "this Google account's sign-in has expired or was revoked. Use the google_accounts tool with action \"add\" to sign in again.";
  }
  const m = e?.response?.data?.error;
  return (typeof m === "object" ? m?.message : m) ?? e?.message ?? String(e);
}

// ---------- shared helpers ----------

/**
 * Tab properties, kept a little while: the live preview needs them on every rebuild, and each fetch counts
 * against Google's per-minute read quota. Changes that touch tabs or their size drop the entry (see batch()),
 * and asking for a tab the cache doesn't have fetches again, in case it was just added in Sheets.
 */
const propsCache = new Map<string, { at: number; props: sheets_v4.Schema$SheetProperties[] }>();
const PROPS_TTL_MS = 20_000;

async function getSheetProps(id: string, want?: string) {
  const cached = propsCache.get(id);
  if (cached && Date.now() - cached.at < PROPS_TTL_MS && (want === undefined || cached.props.some((p) => p.title === want))) return cached.props;
  const res = await api().sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties",
  });
  const props = (res.data.sheets ?? []).map((s) => s.properties!);
  propsCache.set(id, { at: Date.now(), props });
  return props;
}

/** The tabs as the preview lists them (and uses to name chart sources). */
async function previewTabs(id: string): Promise<PreviewTab[]> {
  return (await getSheetProps(id)).map((p) => ({ title: p.title!, sheetId: p.sheetId!, hidden: p.hidden }));
}

/** Resolve an A1 range to a GridRange (sheet name -> sheetId). Omitted sheet means the first tab. */
async function resolveRange(id: string, a1: string) {
  const parsed = parseA1(a1);
  const props = await getSheetProps(id, parsed.sheet);
  const sheet = parsed.sheet === undefined ? props[0] : props.find((p) => p.title === parsed.sheet);
  if (!sheet) {
    throw new Error(`No tab named "${parsed.sheet}". Tabs: ${props.map((p) => p.title).join(", ")}`);
  }
  const grid: sheets_v4.Schema$GridRange = {
    sheetId: sheet.sheetId,
    startRowIndex: parsed.startRow,
    endRowIndex: parsed.endRow,
    startColumnIndex: parsed.startCol,
    endColumnIndex: parsed.endCol,
  };
  const bounded = {
    startRow: parsed.startRow ?? 0,
    endRow: parsed.endRow ?? sheet.gridProperties?.rowCount ?? 1000,
    startCol: parsed.startCol ?? 0,
    endCol: parsed.endCol ?? sheet.gridProperties?.columnCount ?? 26,
  };
  return { grid, bounded, sheet, parsed };
}

/**
 * Add rows or columns so these ranges fit in their tabs, like Sheets does when you paste past the edge.
 * A new tab has 26 columns and 1000 rows, so writing a "Total" in column AE would otherwise fail.
 */
async function growToFit(id: string, ranges: string[]) {
  const props = await getSheetProps(id, ranges.map((a1) => parseA1(a1).sheet).find((t) => t !== undefined));
  const need = new Map<number, { rows: number; cols: number; sheet: sheets_v4.Schema$SheetProperties }>();
  for (const a1 of ranges) {
    const p = parseA1(a1);
    const sheet = p.sheet === undefined ? props[0] : props.find((x) => x.title === p.sheet);
    if (!sheet) throw new Error(`No tab named "${p.sheet}". Tabs: ${props.map((x) => x.title).join(", ")}`);
    const n = need.get(sheet.sheetId!) ?? { rows: 0, cols: 0, sheet };
    n.rows = Math.max(n.rows, p.endRow ?? p.startRow ?? 0);
    n.cols = Math.max(n.cols, p.endCol ?? p.startCol ?? 0);
    need.set(sheet.sheetId!, n);
  }
  const requests: Request[] = [];
  for (const { rows, cols, sheet } of need.values()) {
    const g = sheet.gridProperties ?? {};
    if (rows > (g.rowCount ?? 1000)) requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: "ROWS", length: rows - (g.rowCount ?? 1000) } });
    if (cols > (g.columnCount ?? 26)) requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: "COLUMNS", length: cols - (g.columnCount ?? 26) } });
  }
  if (requests.length) await batch(id, requests);
}

/** The tab of the latest step that ran on a tab that exists. */
async function lastExistingTab(id: string, steps: { tab?: string; failed?: true }[]) {
  const titles = new Set((await getSheetProps(id)).map((p) => p.title));
  return [...steps].reverse().find((e) => e.tab && !e.failed && titles.has(e.tab))?.tab;
}

async function resolveSheet(id: string, name?: string) {
  const props = await getSheetProps(id, name);
  const sheet = name === undefined ? props[0] : props.find((p) => p.title === name);
  if (!sheet) throw new Error(`No tab named "${name}". Tabs: ${props.map((p) => p.title).join(", ")}`);
  return sheet;
}

/** Requests that change a tab's properties (title, size, frozen panes, hidden) or the list of tabs. */
const TAB_CHANGES = new Set(["addSheet", "deleteSheet", "duplicateSheet", "updateSheetProperties", "appendDimension", "insertDimension", "deleteDimension", "insertRange", "deleteRange", "appendCells", "pasteData", "copyPaste", "cutPaste", "moveDimension"]);

async function batch(id: string, requests: Request[]) {
  if (requests.some((r) => Object.keys(r).some((k) => TAB_CHANGES.has(k)))) propsCache.delete(id);
  const res = await api().sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
  return res.data;
}

/** A bounded A1 range covering all of `ranges`, when they're on one tab and bounded; otherwise undefined. */
function unionA1(ranges: string[]) {
  const parsed = ranges.map((r) => parseA1(r));
  const sheet = parsed[0]?.sheet;
  if (!parsed.length || parsed.some((p) => p.sheet !== sheet || p.startRow === undefined || p.endRow === undefined || p.startCol === undefined || p.endCol === undefined)) return undefined;
  return toA1(sheet, Math.min(...parsed.map((p) => p.startRow!)), Math.min(...parsed.map((p) => p.startCol!)), Math.max(...parsed.map((p) => p.endRow!)), Math.max(...parsed.map((p) => p.endCol!)));
}

function cellCount(values: unknown[][]) {
  return values.reduce((n, row) => n + row.length, 0);
}

// ---------- reading formats ----------

function colorHex(style?: sheets_v4.Schema$ColorStyle | null, plain?: sheets_v4.Schema$Color | null): string | undefined {
  if (style?.themeColor) return `theme:${style.themeColor}`;
  const c = style?.rgbColor ?? plain;
  if (!c) return undefined;
  const h = (x?: number | null) => Math.round((x ?? 0) * 255).toString(16).padStart(2, "0");
  return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
}

/** One-line summary of a cell format, e.g. "bg #1f3864 · fg #ffffff · bold · Calibri 10 · center · border bottom #d9d9d9". */
function describeFormat(f?: sheets_v4.Schema$CellFormat | null): string {
  if (!f) return "";
  const parts: string[] = [];
  const bg = colorHex(f.backgroundColorStyle, f.backgroundColor);
  if (bg) parts.push(`bg ${bg}`);
  const t = f.textFormat ?? {};
  const fg = colorHex(t.foregroundColorStyle, t.foregroundColor);
  if (fg) parts.push(`fg ${fg}`);
  for (const k of ["bold", "italic", "underline", "strikethrough"] as const) if (t[k]) parts.push(k);
  if (t.fontFamily || t.fontSize) parts.push([t.fontFamily, t.fontSize].filter(Boolean).join(" "));
  if (f.horizontalAlignment) parts.push(f.horizontalAlignment.toLowerCase());
  // Bottom alignment and overflow are Sheets' defaults, so they are left out.
  if (f.verticalAlignment && f.verticalAlignment !== "BOTTOM") parts.push(`v-${f.verticalAlignment.toLowerCase()}`);
  if (f.wrapStrategy && f.wrapStrategy !== "OVERFLOW_CELL") parts.push(f.wrapStrategy.toLowerCase());
  if (f.numberFormat) parts.push(`num "${f.numberFormat.pattern ?? f.numberFormat.type}"`);
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const b = f.borders?.[side];
    if (b?.style && b.style !== "NONE") {
      parts.push(`border ${side} ${colorHex(b.colorStyle, b.color) ?? "#000000"}${b.style === "SOLID" ? "" : " " + b.style.toLowerCase()}`);
    }
  }
  return parts.join(" · ");
}

function overlaps(g: sheets_v4.Schema$GridRange, r0: number, r1: number, c0: number, c1: number) {
  return (g.startRowIndex ?? 0) < r1 && (g.endRowIndex ?? Infinity) > r0 && (g.startColumnIndex ?? 0) < c1 && (g.endColumnIndex ?? Infinity) > c0;
}

async function readFormats(id: string, range: string, maxCells: number) {
  const { bounded, sheet } = await resolveRange(id, range);
  const title = sheet.title!;
  const width = Math.max(1, bounded.endCol - bounded.startCol);
  const maxRows = Math.max(1, Math.floor(maxCells / width));
  const endRow = Math.min(bounded.endRow, bounded.startRow + maxRows);
  const a1 = toA1(title, bounded.startRow, bounded.startCol, endRow, bounded.endCol);
  const res = await api().sheets.spreadsheets.get({
    spreadsheetId: id,
    ranges: [a1],
    includeGridData: true,
    fields:
      "properties.defaultFormat(textFormat(fontFamily,fontSize))," +
      "sheets(properties(gridProperties(frozenRowCount,frozenColumnCount,hideGridlines))," +
      "data(startRow,startColumn,rowMetadata(pixelSize),columnMetadata(pixelSize),rowData(values(formattedValue,userEnteredFormat)))," +
      "merges,bandedRanges(range,rowProperties,columnProperties),conditionalFormats)",
  });
  const s = res.data.sheets?.[0];
  const data = s?.data?.[0];
  const r0 = data?.startRow ?? bounded.startRow;
  const c0 = data?.startColumn ?? bounded.startCol;
  const toRange = (g: sheets_v4.Schema$GridRange) =>
    toA1(undefined, g.startRowIndex ?? 0, g.startColumnIndex ?? 0, g.endRowIndex ?? bounded.endRow, g.endColumnIndex ?? bounded.endCol);

  const styleIds = new Map<string, string>();
  const rows: string[] = [];
  (data?.rowData ?? []).forEach((row, i) => {
    const ids = (row.values ?? []).map((v) => {
      const d = describeFormat(v.userEnteredFormat);
      if (!d) return "-";
      if (!styleIds.has(d)) styleIds.set(d, `s${styleIds.size + 1}`);
      return styleIds.get(d)!;
    });
    while (ids.length && ids[ids.length - 1] === "-") ids.pop();
    const label = (row.values ?? []).map((v) => v.formattedValue).find((t) => t && t.trim());
    if (!ids.length && !label) return;
    const runs: string[] = [];
    let col = c0;
    for (let j = 0; j < ids.length; ) {
      let k = j;
      while (k + 1 < ids.length && ids[k + 1] === ids[j]) k++;
      const n = k - j + 1;
      runs.push(`${indexToCol(col)}${n > 1 ? ":" + indexToCol(col + n - 1) : ""} ${ids[j]}`);
      col += n;
      j = k + 1;
    }
    const text = label ? `  "${label.length > 40 ? label.slice(0, 40) + "…" : label}"` : "";
    rows.push(`${r0 + i + 1}: ${runs.join(", ") || "(no format)"}${text}`);
  });

  const r1 = r0 + (data?.rowData?.length ?? 0);
  const c1 = bounded.endCol;
  // Column widths as runs ("A 186, B:G 116"); row heights as the usual height plus exceptions.
  const widths = (data?.columnMetadata ?? []).map((m) => m.pixelSize ?? 0);
  const colWidths: string[] = [];
  for (let j = 0; j < widths.length; ) {
    let k = j;
    while (k + 1 < widths.length && widths[k + 1] === widths[j]) k++;
    colWidths.push(`${indexToCol(c0 + j)}${k > j ? ":" + indexToCol(c0 + k) : ""} ${widths[j]}`);
    j = k + 1;
  }
  const heights = (data?.rowMetadata ?? []).map((m) => m.pixelSize ?? 0);
  const counts = new Map<number, number>();
  for (const h of heights) counts.set(h, (counts.get(h) ?? 0) + 1);
  const usualHeight = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const rowHeights: Record<string, number> = {};
  heights.forEach((h, i) => h !== usualHeight && (rowHeights[r0 + i + 1] = h));
  const grid = s?.properties?.gridProperties ?? {};
  const df = res.data.properties?.defaultFormat?.textFormat;
  const banding = (s?.bandedRanges ?? [])
    .filter((b) => overlaps(b.range!, r0, r1, c0, c1))
    .map((b) => {
      const p = b.rowProperties ?? b.columnProperties ?? {};
      const kind = b.rowProperties ? "rows" : "columns";
      const colors = [
        p.headerColorStyle || p.headerColor ? `header ${colorHex(p.headerColorStyle, p.headerColor)}` : "",
        `${colorHex(p.firstBandColorStyle, p.firstBandColor)} / ${colorHex(p.secondBandColorStyle, p.secondBandColor)}`,
        p.footerColorStyle || p.footerColor ? `footer ${colorHex(p.footerColorStyle, p.footerColor)}` : "",
      ].filter(Boolean);
      return `${toRange(b.range!)}: ${kind} ${colors.join(", ")}`;
    });
  const conditional = (s?.conditionalFormats ?? [])
    .filter((cf) => (cf.ranges ?? []).some((g) => overlaps(g, r0, r1, c0, c1)))
    .map((cf) => {
      const where = (cf.ranges ?? []).map(toRange).join(", ");
      if (cf.gradientRule) return `${where}: color scale`;
      const cond = cf.booleanRule?.condition;
      const vals = (cond?.values ?? []).map((v) => v.userEnteredValue ?? v.relativeDate).join(", ");
      return `${where}: ${cond?.type}${vals ? ` ${vals}` : ""} → ${describeFormat(cf.booleanRule?.format) || "(no format)"}`;
    });

  return {
    range: toA1(title, r0, c0, r1, c1),
    default_font: df ? [df.fontFamily, df.fontSize].filter(Boolean).join(" ") : undefined,
    frozen: { rows: grid.frozenRowCount ?? 0, columns: grid.frozenColumnCount ?? 0 },
    gridlines_hidden: grid.hideGridlines ?? false,
    styles: Object.fromEntries([...styleIds].map(([d, sid]) => [sid, d])),
    rows,
    column_widths_px: colWidths.join(", "),
    row_height_px: usualHeight,
    ...(Object.keys(rowHeights).length ? { other_row_heights_px: rowHeights } : {}),
    merges: (s?.merges ?? []).filter((m) => overlaps(m, r0, r1, c0, c1)).map(toRange),
    banding,
    conditional_formats: conditional,
    ...(endRow < bounded.endRow && (data?.rowData?.length ?? 0) >= endRow - bounded.startRow
      ? { truncated: true, next_range: toA1(title, endRow, bounded.startCol, bounded.endRow, bounded.endCol) }
      : {}),
  };
}

// ---------- undo (values + formulas only, in memory) ----------

interface Snapshot {
  label: string;
  range: string;
  values: Cell[][];
}
const undoStacks = new Map<string, Snapshot[]>();

/** Capture current formulas/values so they can be restored. `rows`/`cols` force a minimum size (for writes). */
async function snapshot(id: string, range: string, label: string, rows?: number, cols?: number) {
  const res = await api().sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range,
    valueRenderOption: "FORMULA",
  });
  const current = (res.data.values ?? []) as Cell[][];
  const height = Math.max(rows ?? 0, current.length);
  const width = Math.max(cols ?? 0, ...current.map((r) => r.length), 0);
  if (height === 0 || width === 0) return;
  const values = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => current[r]?.[c] ?? ""),
  );
  const start = parseA1(res.data.range ?? range);
  const target = toA1(start.sheet, start.startRow ?? 0, start.startCol ?? 0, (start.startRow ?? 0) + height, (start.startCol ?? 0) + width);
  const stack = undoStacks.get(id) ?? [];
  stack.push({ label, range: target, values });
  if (stack.length > UNDO_DEPTH) stack.shift();
  undoStacks.set(id, stack);
}

/** Read back a written range and report formula errors (and computed values for small writes). */
async function verify(id: string, range: string) {
  const res = await api().sheets.spreadsheets.values.get({ spreadsheetId: id, range });
  const values = (res.data.values ?? []) as Cell[][];
  const start = parseA1(res.data.range ?? range);
  const errors: string[] = [];
  values.forEach((row, r) =>
    row.forEach((v, c) => {
      if (typeof v === "string" && ERROR_VALUE.test(v)) {
        errors.push(`${indexToCol((start.startCol ?? 0) + c)}${(start.startRow ?? 0) + r + 1}: ${v}`);
      }
    }),
  );
  return {
    formula_errors: errors.slice(0, 25),
    ...(errors.length > 25 && { more_errors: errors.length - 25 }),
    ...(cellCount(values) <= 200 && { computed_values: values }),
  };
}

// ---------- activity log (feeds the live sheet preview) ----------

/** One step, logged when its tool starts (`pending`) and updated with a new seq when it finishes. */
interface Activity {
  seq: number;
  id: number;
  tool: string;
  kind: "read" | "edit";
  range?: string;
  tab?: string;
  at: number;
  pending?: true;
  failed?: true;
}
const activityLog = new Map<string, Activity[]>();
let activitySeq = 0;
/** When show_range last ran for each spreadsheet, so tool results can tell Claude whether the user is watching. */
const previewShownAt = new Map<string, number>();
const PREVIEW_FRESH_MS = 20 * 60_000;
/** How far back a newly opened preview catches up: this task's steps, not earlier work in the same sheet. */
const CATCH_UP_MS = 3 * 60_000;
const UNLOGGED = new Set(["google_accounts", "find_spreadsheet", "create_spreadsheet", "show_range", "preview_updates"]);
const READS = new Set(["get_spreadsheet_info", "read_range", "read_ranges"]);
/** Tools that only look (hosts can run these without asking), and tools that can overwrite or remove what's in a sheet. */
const READ_ONLY = new Set([...READS, "find_spreadsheet", "show_range", "preview_updates"]);
const DESTRUCTIVE = new Set(["write_range", "fill_range", "clear_range", "find_replace", "delete_rows_or_columns", "manage_tab", "merge_cells", "delete_chart", "batch_update"]);

function pushActivity(id: string, e: Activity) {
  const list = activityLog.get(id) ?? [];
  list.push(e);
  while (list.length > 300) list.shift();
  activityLog.set(id, list);
}

/** Where a step is about to work, from its arguments alone (so the preview can point there before it finishes). */
function startRange(tool: string, args: any): string | undefined {
  try {
    if (tool === "write_range" && Array.isArray(args.values) && typeof args.range === "string") {
      const p = parseA1(args.range);
      const rows = args.values.length, cols = Math.max(1, ...args.values.map((r: unknown[]) => r.length));
      return toA1(p.sheet, p.startRow ?? 0, p.startCol ?? 0, (p.startRow ?? 0) + rows, (p.startCol ?? 0) + cols);
    }
    if (tool === "fill_range") return args.destination;
    if (tool === "format_ranges") return unionA1((args.items ?? []).map((i: any) => i.range));
    if (tool === "read_ranges") return args.ranges?.[0];
    return args.range ?? args.data_range ?? args.source_range;
  } catch {
    return undefined;
  }
}

/** Log that a tool has started, so the preview can show it in progress. Returns the entry to finish later. */
function startActivity(id: string, tool: string, args: any): Activity | undefined {
  if (UNLOGGED.has(tool) || args?.dry_run) return;
  const seq = ++activitySeq;
  const e: Activity = { seq, id: seq, tool, kind: READS.has(tool) ? "read" : "edit", range: startRange(tool, args), tab: args?.tab ?? args?.sheet, at: Date.now(), pending: true };
  pushActivity(id, e);
  return e;
}

/** Finish a started step: where it actually read or wrote (extra ranges become steps of their own), or that it failed. */
function endActivity(id: string, e: Activity | undefined, args: any, result: any, failed = false) {
  if (!e) return;
  delete e.pending;
  e.seq = ++activitySeq;
  e.at = Date.now();
  if (failed) {
    e.failed = true;
    return;
  }
  const range =
    e.kind === "read"
      ? (result?.range ?? args?.range)
      : (result?.updated_range ?? result?.appended_range ?? result?.cleared_range ?? result?.restored_range ?? result?.filled_range ?? result?.formatted_range ?? args?.range ?? args?.data_range);
  const ranges: (string | undefined)[] = Array.isArray(result?.ranges) ? result.ranges.map((r: any) => r?.range) : [range ?? result?.pivot_range];
  e.range = ranges[0] ?? e.range;
  e.tab = args?.tab ?? args?.sheet ?? result?.tab;
  for (const r of ranges.slice(1)) {
    const seq = ++activitySeq;
    pushActivity(id, { seq, id: seq, tool: e.tool, kind: e.kind, range: r, tab: e.tab, at: e.at });
  }
}

/** Activity after `since` (and newer than `after`, a timestamp), with sheet-less ranges placed on the first tab. */
async function activitySince(id: string, since: number, after = 0): Promise<PreviewEdit[]> {
  const list = (activityLog.get(id) ?? []).filter((e) => e.seq > since && e.at > after).sort((a, b) => a.seq - b.seq);
  if (!list.length) return [];
  const first = (await getSheetProps(id))[0]?.title ?? undefined;
  return list.map((e) => {
    const base: PreviewEdit = { seq: e.seq, id: e.id, tool: e.tool, kind: e.kind, ...(e.pending && { pending: true as const }), ...(e.failed && { failed: true as const }) };
    if (!e.range) return { ...base, tab: e.tab ?? first };
    const p = parseA1(e.range);
    const tab = p.sheet ?? first;
    if (p.startRow === undefined && p.startCol === undefined) return { ...base, tab };
    const { rect } = toRect(e.range);
    // Label open ranges as written ("A:A", "5:7"), not as the bounded block the preview draws.
    const open = p.startRow === undefined || p.startCol === undefined || p.endRow === undefined || p.endCol === undefined;
    return { ...base, tab, rect, a1: open ? e.range.slice(e.range.lastIndexOf("!") + 1) : toA1(undefined, rect.r0, rect.c0, rect.r1, rect.c1) };
  });
}

// ---------- account confirmation ----------

async function canOpen(email: string, sheetId: string) {
  try {
    const res = await currentAccount.run(email, () =>
      api().sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "properties.title" }),
    );
    return res.data.properties?.title ?? "";
  } catch {
    return undefined;
  }
}

/**
 * With several accounts connected and no `account` given, returns a message asking Claude to
 * confirm the account with the user: always for new spreadsheets, and for an existing sheet the
 * first time it's used if more than one account can open it. Returns undefined to proceed.
 */
async function needsAccountChoice(tool: string, sheetId: string | undefined, all: string[], fallback: string) {
  const confirm = (choices: string[], what: string) =>
    `Account confirmation needed before ${what}. Ask the user which Google account to use: ${choices.join(", ")}` +
    `${choices.includes(fallback) ? ` (default: ${fallback})` : ""}. Then call ${tool} again with \`account\` set to their choice.`;
  if (tool === "create_spreadsheet") return confirm(all, "creating a spreadsheet");
  if (!sheetId || accountForSpreadsheet.has(sheetId)) return undefined;
  const results = await Promise.all(all.map(async (email) => ({ email, title: await canOpen(email, sheetId) })));
  const able = results.filter((r) => r.title !== undefined);
  if (able.length === 1) accountForSpreadsheet.set(sheetId, able[0].email);
  if (able.length <= 1) return undefined; // nothing to choose (or no access: the normal error explains)
  return confirm(able.map((r) => r.email), `working on "${able[0].title}", which more than one connected account can open`);
}

// ---------- server ----------

export function createServer() {
  let previewsOn = false;
  const server = new McpServer(
    { name: "google-sheets", version: "1.0.0" },
    {
      instructions:
        "Sheets MCP lets you read and edit the user's Google Sheets. " +
        "The first time the user brings up spreadsheets in a conversation, briefly offer what you can do (summarize a sheet, add columns and formulas, clean up formatting, sort and filter, add dropdowns, build charts, create new spreadsheets) and ask them to paste a link to the sheet. " +
        "If they name a spreadsheet instead of pasting a link, call find_spreadsheet: it knows the spreadsheets they've used with Sheets MCP before (it can't search their Google Drive, so ask for the link if nothing matches). " +
        "When several Google accounts are connected, some tools reply that the account must be confirmed: ask the user which account to use, then call the tool again with `account` set to their choice. Never pick an account for them. " +
        "If the show_range tool is available, call it FIRST whenever the user asks you to look at or change a spreadsheet, before reading or editing: the user then watches each read and edit happen live. Call it once per task. If you've already started without it, call it right away; it catches up on what you've done.",
    },
  );

  server.registerPrompt(
    "get_started",
    { title: "Get started with Google Sheets", description: "What Sheets MCP can do, and which Google accounts are connected" },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "I just set up Sheets MCP. Welcome me in one short sentence, then check which Google accounts are connected (google_accounts, action \"list\"; if none, help me sign in). " +
              "Show a short bulleted list of things you can do in Google Sheets, with a one-line example request for each: summarize a sheet, add columns and formulas, clean up formatting, sort and filter, add dropdowns, build a chart, create a new spreadsheet. " +
              "Finish by asking which sheet I'd like to work on, and say I can paste its link. " +
              "Below that, add one short line in small print: Sheets MCP is free and open source, and a star at https://github.com/atc07/sheets-mcp helps others find it.",
          },
        },
      ],
    }),
  );

  const accountArg = z
    .string()
    .optional()
    .describe("Google account to use: an email or unique part of one (e.g. \"acme.com\"). Default: the account that can open the spreadsheet, else the default account.");

  /** Note the spreadsheet a successful call worked on, so it can be found by name later (at most every few minutes each). */
  const rememberedAt = new Map<string, number>();
  function remember(name: string, args: any, result: any, sheetId: string | undefined, account: string) {
    if (name === "create_spreadsheet" && result?.spreadsheet_id) return rememberSpreadsheet(result.spreadsheet_id, args.title, account);
    if (!sheetId || Date.now() - (rememberedAt.get(sheetId) ?? 0) < 5 * 60_000) return;
    rememberedAt.set(sheetId, Date.now());
    const known = result?.title ?? result?.preview?.title;
    if (typeof known === "string" && known) return rememberSpreadsheet(sheetId, known, account);
    // Look the title up in the background; the tool's answer doesn't wait for it.
    void canOpen(account, sheetId).then((title) => title && rememberSpreadsheet(sheetId, title, account));
  }

  /**
   * Register a tool. It runs as one account: the explicit `account` arg, or for spreadsheet
   * tools each signed-in account in turn (last-known, default, others) until one has access.
   * `manageAccounts` tools handle accounts themselves (no automatic sign-in or account arg).
   */
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    handler: (args: z.infer<z.ZodObject<S>> & { account?: string }) => Promise<unknown>,
    opts: { manageAccounts?: boolean; title?: string; preview?: "show" | "app" } = {},
  ) {
    const fullShape = opts.manageAccounts ? shape : { ...shape, account: accountArg };
    const config = {
      description,
      inputSchema: fullShape,
      ...(opts.title && { title: opts.title }),
      annotations: READ_ONLY.has(name) ? { readOnlyHint: true, openWorldHint: true } : { readOnlyHint: false, destructiveHint: DESTRUCTIVE.has(name), openWorldHint: true },
      // MCP Apps: show_range renders with the preview widget; preview_updates is called only by that widget.
      ...(opts.preview === "show" && { _meta: { ui: { resourceUri: PREVIEW_URI }, "ui/resourceUri": PREVIEW_URI } }),
      ...(opts.preview === "app" && { _meta: { ui: { resourceUri: PREVIEW_URI, visibility: ["app"] } } }),
    };
    return server.registerTool(name, config, (async (args: z.infer<z.ZodObject<S>> & { account?: string }) => {
      let started: { id: string; activity: Activity | undefined } | undefined;
      try {
        if (opts.manageAccounts) {
          const result = await handler(args);
          return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
        }
        const { all, fallback } = await accounts();
        let result: unknown;
        let usedAccount: string | undefined;
        // A name instead of a link: look it up among the spreadsheets used here before.
        const given = (args as any).spreadsheet;
        if (typeof given === "string" && !looksLikeSpreadsheetRef(given)) {
          const matches = findSpreadsheets(given);
          if (matches.length !== 1) {
            throw new Error(
              matches.length
                ? `${matches.length} spreadsheets used before match "${given}": ${matches.slice(0, 8).map((m) => `"${m.title}" (${m.account}, ${spreadsheetUrl(m.id)})`).join("; ")}. Ask the user which one, then use its link.`
                : `No spreadsheet named "${given}" among the ones used with Sheets MCP before. Sheets MCP can't search the user's Google Drive: ask them to paste the sheet's link.`,
            );
          }
          (args as any).spreadsheet = matches[0].id;
          if (!args.account && all.includes(matches[0].account)) accountForSpreadsheet.set(matches[0].id, accountForSpreadsheet.get(matches[0].id) ?? matches[0].account);
        }
        const sheetId = typeof (args as any).spreadsheet === "string" ? spreadsheetIdFrom((args as any).spreadsheet) : undefined;
        if (!args.account && all.length > 1) {
          const ask = await needsAccountChoice(name, sheetId, all, fallback);
          if (ask) return { content: [{ type: "text" as const, text: ask }] };
        }
        const known = sheetId && accountForSpreadsheet.get(sheetId);
        const candidates = args.account
          ? [resolveAccount(args.account)]
          : [...new Set([known, fallback, ...(sheetId ? all : [])].filter((a): a is string => !!a && all.includes(a)))];
        const failures: string[] = [];
        // The preview shows the step as soon as it starts; it's finished (or marked failed) below.
        if (sheetId) started = { id: sheetId, activity: startActivity(sheetId, name, args) };
        for (const email of candidates) {
          try {
            result = await currentAccount.run(email, () => handler(args));
            usedAccount = email;
            if (sheetId) accountForSpreadsheet.set(sheetId, email);
            break;
          } catch (e) {
            if (!isAccountError(e)) throw e;
            if (candidates.length === 1) throw new Error(`${email}: ${errorMessage(e)}`);
            failures.push(`${email}: ${errorMessage(e)}`);
          }
        }
        if (!usedAccount) throw new Error(`No signed-in account could do this.\n${failures.join("\n")}`);
        if (started) endActivity(started.id, started.activity, args, result);
        started = undefined;
        remember(name, args, result, sheetId, usedAccount);
        if (opts.preview && (opts.preview === "show" || (args as any).initial)) {
          console.error(`Sheet preview: ${name}${(args as any).initial ? " (widget's own fetch)" : ""} from ${server.server.getClientVersion()?.name}`);
        }
        if (opts.preview) {
          const out: Record<string, any> = { ...(result as Record<string, unknown>), account: usedAccount };
          const text = opts.preview === "show" ? previewSummary(out.preview, out.edits.length) : "ok";
          return { content: [{ type: "text" as const, text }], structuredContent: out };
        }
        let text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        if (usedAccount && all.length > 1) text = `[account: ${usedAccount}]\n${text}`;
        const content = [{ type: "text" as const, text }];
        if (sheetId && !UNLOGGED.has(name)) {
          // Nudge Claude to open the live preview, so the user can watch the rest of the work.
          const shown = previewShownAt.get(sheetId);
          if (previewsOn && (!shown || Date.now() - shown > PREVIEW_FRESH_MS)) {
            content.push({
              type: "text" as const,
              text: "The user can't see what you're doing in this sheet. Call show_range now (the spreadsheet alone is enough; add `range` for the area you're working in): it catches up on what you've done so far, then shows each read and edit live. Call it once per task.",
            });
          }
        }
        return { content };
      } catch (e: any) {
        if (started) endActivity(started.id, started.activity, args, undefined, true);
        const msg = errorMessage(e);
        return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    }) as any);
  }

  const spreadsheet = z.string().describe("Google Sheets link or spreadsheet ID. The name of a spreadsheet used with Sheets MCP before also works");
  const range = z.string().describe("A1 range, e.g. \"Sheet1!A1:D20\", \"'My Tab'!B:B\", or a tab name");
  const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
  const grid = z.array(z.array(cell)).describe("2D array of rows. Strings starting with = are formulas.");

  // ----- discovery -----

  tool(
    "google_accounts",
    "Manage the Google accounts Sheets MCP can use. list: show signed-in accounts and the default. add: sign in to a Google account (opens a browser sign-in; also use this when a sign-in has expired). remove: sign an account out and revoke access. set_default: choose the account used for new spreadsheets.",
    {
      action: z.enum(["list", "add", "remove", "set_default"]),
      email: z.string().optional().describe("For remove/set_default: the account's email or a unique part of it"),
    },
    async ({ action, email }) => {
      if (action === "add") {
        const result = await signIn();
        if (!result.email) throw signInPending(result.url);
        return { signed_in: result.email, accounts: listAccounts(), default: getDefaultAccount() };
      }
      if (action === "remove" || action === "set_default") {
        if (!email) throw new Error("email is required");
        if (action === "remove") {
          const removed = await removeAccount(email);
          clients.delete(removed);
          for (const [id, acct] of accountForSpreadsheet) if (acct === removed) accountForSpreadsheet.delete(id);
          forgetAccount(removed);
        } else setDefaultAccount(email);
      }
      const all = listAccounts();
      return all.length
        ? { accounts: all, default: getDefaultAccount() }
        : { accounts: [], note: "No Google accounts are signed in. Use action \"add\" to sign in." };
    },
    { manageAccounts: true },
  );

  tool(
    "find_spreadsheet",
    "Find a spreadsheet by name among the ones the user has opened or created with Sheets MCP before (the list is kept on their computer). Use it when the user names a sheet instead of pasting a link, e.g. \"my budget sheet\". It can't search the rest of their Google Drive: if nothing matches, ask for the link. Leave query empty to list the most recent.",
    { query: z.string().optional().describe("All or part of the spreadsheet's name") },
    async ({ query }) => {
      const matches = findSpreadsheets(query);
      const spreadsheets = matches.slice(0, 15).map((m) => ({ title: m.title, url: spreadsheetUrl(m.id), account: m.account, last_used: m.last_used.slice(0, 10) }));
      if (spreadsheets.length) return { spreadsheets, ...(matches.length > 15 && { more: matches.length - 15 }) };
      return {
        spreadsheets,
        note: query
          ? `Nothing used before matches "${query}". Ask the user to paste the sheet's link.`
          : "No spreadsheets have been used with Sheets MCP on this computer yet. Ask the user to paste a sheet's link.",
      };
    },
    { manageAccounts: true },
  );

  tool(
    "create_spreadsheet",
    "Create a new Google Sheets spreadsheet.",
    { title: z.string(), sheet_names: z.array(z.string()).optional().describe("Tab names (default: one tab)") },
    async ({ title, sheet_names }) => {
      const res = await api().sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
          sheets: sheet_names?.map((t) => ({ properties: { title: t } })),
        },
      });
      return { spreadsheet_id: res.data.spreadsheetId, url: res.data.spreadsheetUrl };
    },
  );

  tool(
    "get_spreadsheet_info",
    "Get a spreadsheet's title, tabs (sizes, frozen rows/cols), charts (ids, types, data ranges), named ranges, and the first few rows of each tab. Call this first to understand a sheet's layout.",
    { spreadsheet, preview_rows: z.number().int().min(0).max(20).default(3) },
    async ({ spreadsheet, preview_rows }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const res = await api().sheets.spreadsheets.get({
        spreadsheetId: id,
        fields:
          "properties(title,locale,timeZone),spreadsheetUrl,sheets(properties,basicFilter.range," +
          "charts(chartId,position/overlayPosition/anchorCell,spec(title,basicChart(chartType,domains/domain/sourceRange/sources,series/series/sourceRange/sources),pieChart(domain/sourceRange/sources,series/sourceRange/sources)))),namedRanges",
      });
      const tabs = res.data.sheets ?? [];
      let previews: sheets_v4.Schema$ValueRange[] = [];
      if (preview_rows > 0 && tabs.length) {
        const pr = await api().sheets.spreadsheets.values.batchGet({
          spreadsheetId: id,
          ranges: tabs.map((t) => `${quoteSheet(t.properties!.title!)}!A1:Z${preview_rows}`),
        });
        previews = pr.data.valueRanges ?? [];
      }
      return {
        title: res.data.properties?.title,
        url: res.data.spreadsheetUrl,
        locale: res.data.properties?.locale,
        time_zone: res.data.properties?.timeZone,
        tabs: tabs.map((t, i) => {
          const p = t.properties!;
          return {
            title: p.title,
            sheet_id: p.sheetId,
            rows: p.gridProperties?.rowCount,
            columns: p.gridProperties?.columnCount,
            frozen_rows: p.gridProperties?.frozenRowCount ?? 0,
            frozen_columns: p.gridProperties?.frozenColumnCount ?? 0,
            ...(p.hidden && { hidden: true }),
            ...(t.charts?.length && {
              charts: t.charts.map((c) => {
                const basic = c.spec?.basicChart, pie = c.spec?.pieChart;
                const src = [basic?.domains?.[0]?.domain, ...(basic?.series ?? []).map((x) => x.series), pie?.domain, pie?.series].flatMap((d) => d?.sourceRange?.sources ?? []);
                const title = (g: sheets_v4.Schema$GridRange) => tabs.find((x) => x.properties?.sheetId === (g.sheetId ?? 0))?.properties?.title ?? undefined;
                const a = c.position?.overlayPosition?.anchorCell;
                return {
                  chart_id: c.chartId,
                  ...(c.spec?.title && { title: c.spec.title }),
                  type: pie ? "PIE" : basic?.chartType ?? "OTHER",
                  ...(a && { at: `${indexToCol(a.columnIndex ?? 0)}${(a.rowIndex ?? 0) + 1}` }),
                  data: src.slice(0, 8).map((g) => toA1(title(g), g.startRowIndex ?? 0, g.startColumnIndex ?? 0, g.endRowIndex ?? (g.startRowIndex ?? 0) + 1, g.endColumnIndex ?? (g.startColumnIndex ?? 0) + 1)),
                };
              }),
            }),
            ...(t.basicFilter && { has_filter: true }),
            ...(preview_rows > 0 && { preview: previews[i]?.values ?? [] }),
          };
        }),
        named_ranges: (res.data.namedRanges ?? []).map((n) => ({ name: n.name, range: n.range })),
      };
    },
  );

  // ----- reading -----

  tool(
    "read_range",
    "Read cell contents from a range, or its formatting with mode \"formats\". Large ranges are truncated; use next_range to continue.",
    {
      spreadsheet,
      range,
      mode: z
        .enum(["values", "formulas", "raw", "formats"])
        .default("values")
        .describe(
          "values = as displayed; formulas = show formulas instead of results; raw = unformatted numbers; " +
            "formats = cell formatting (fill, font, alignment, number format, borders) as a style table plus a per-row map of style ids, " +
            "with merges, banding, conditional formats, column widths, frozen panes and gridlines",
        ),
      max_cells: z.number().int().min(1).max(20_000).default(2000),
    },
    async ({ spreadsheet, range, mode, max_cells }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      if (mode === "formats") return readFormats(id, range, max_cells);
      const res = await api().sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range,
        valueRenderOption: { values: "FORMATTED_VALUE", formulas: "FORMULA", raw: "UNFORMATTED_VALUE" }[mode],
      });
      const values = (res.data.values ?? []) as Cell[][];
      const width = Math.max(1, ...values.map((r) => r.length));
      const maxRows = Math.max(1, Math.floor(max_cells / width));
      const actual = res.data.range ?? range;
      if (values.length <= maxRows) return { range: actual, rows: values.length, values };
      const start = parseA1(actual);
      const sr = start.startRow ?? 0;
      const sc = start.startCol ?? 0;
      const origEnd = parseA1(range).endCol;
      const nextEndCol = origEnd === undefined ? "" : indexToCol(origEnd - 1);
      const nextStart = `${indexToCol(sc)}${sr + maxRows + 1}`;
      const next = `${start.sheet ? quoteSheet(start.sheet) + "!" : ""}${nextStart}:${nextEndCol || indexToCol(sc + width - 1)}`;
      return {
        range: toA1(start.sheet, sr, sc, sr + maxRows, sc + width),
        rows: maxRows,
        values: values.slice(0, maxRows),
        truncated: true,
        total_rows_with_data: values.length,
        next_range: next,
      };
    },
  );

  tool(
    "read_ranges",
    "Read several ranges in one call, across any tabs. Faster than calling read_range repeatedly. Each range is truncated to its share of max_cells; use its next_range with read_range to continue.",
    {
      spreadsheet,
      ranges: z.array(range).min(1).max(20),
      mode: z
        .enum(["values", "formulas", "raw"])
        .default("values")
        .describe("values = as displayed; formulas = show formulas instead of results; raw = unformatted numbers"),
      max_cells: z.number().int().min(1).max(20_000).default(4000).describe("Total across all ranges"),
    },
    async ({ spreadsheet, ranges, mode, max_cells }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const res = await api().sheets.spreadsheets.values.batchGet({
        spreadsheetId: id,
        ranges,
        valueRenderOption: { values: "FORMATTED_VALUE", formulas: "FORMULA", raw: "UNFORMATTED_VALUE" }[mode],
      });
      const share = Math.max(1, Math.floor(max_cells / ranges.length));
      return {
        ranges: (res.data.valueRanges ?? []).map((vr, i) => {
          const values = (vr.values ?? []) as Cell[][];
          const width = Math.max(1, ...values.map((r) => r.length));
          const maxRows = Math.max(1, Math.floor(share / width));
          const actual = vr.range ?? ranges[i];
          if (values.length <= maxRows) return { range: actual, rows: values.length, values };
          const start = parseA1(actual);
          const sr = start.startRow ?? 0, sc = start.startCol ?? 0;
          const tab = start.sheet ? quoteSheet(start.sheet) + "!" : "";
          return {
            range: toA1(start.sheet, sr, sc, sr + maxRows, sc + width),
            rows: maxRows,
            values: values.slice(0, maxRows),
            truncated: true,
            total_rows_with_data: values.length,
            next_range: `${tab}${indexToCol(sc)}${sr + maxRows + 1}:${indexToCol(sc + width - 1)}`,
          };
        }),
      };
    },
  );

  server.registerResource(
    // Named after the page's hash too, in case a host caches widgets by resource name.
    `sheet_preview_${PREVIEW_URI.slice(-15, -5)}`,
    PREVIEW_URI,
    { title: "Sheet preview", description: "Inline preview of a range, with Claude's changes highlighted", mimeType: PREVIEW_MIME },
    async () => {
      console.error(`Sheet preview: widget page ${PREVIEW_URI} sent to ${server.server.getClientVersion()?.name}`);
      return { contents: [{ uri: PREVIEW_URI, mimeType: PREVIEW_MIME, text: PREVIEW_HTML, _meta: { ui: { prefersBorder: false } } }] };
    },
  );

  /**
   * Build the preview for show_range (or the widget's own first fetch): the requested area, or
   * where Claude has been working, plus the recent activity the user hasn't seen, to replay.
   */
  const lastReplay = new Map<string, { at: number; edits: PreviewEdit[] }>();
  async function openPreview(id: string, range?: string, highlight?: string) {
    // Steps logged while this builds are left for the widget's first poll, so none is skipped or sent twice.
    const upTo = activitySeq;
    // Failed steps from before the preview opened aren't worth catching up on.
    let recent = (await activitySince(id, 0, Math.max(previewShownAt.get(id) ?? 0, Date.now() - CATCH_UP_MS))).filter((e) => e.seq <= upTo && !e.failed);
    // The widget's own first fetch comes right after show_range; give it the same steps to replay.
    const prior = lastReplay.get(id);
    if (!recent.length && prior && Date.now() - prior.at < 60_000) recent = prior.edits;
    lastReplay.set(id, { at: Date.now(), edits: recent });
    let sheetName: string | undefined;
    let rect: Rect, outline: Rect | undefined, truncated = false;
    if (range || highlight) {
      const win = previewWindow(range, highlight);
      sheetName = win.sheet;
      ({ rect, truncated } = win);
      outline = win.highlight;
    } else {
      sheetName = await lastExistingTab(id, recent);
      rect = { r0: 0, c0: 0, r1: 100, c1: 26 };
    }
    const sheet = await resolveSheet(id, sheetName);
    const onTab = recent.filter((e) => e.tab === sheet.title && e.rect).map((e) => e.rect!);
    if (!range) rect = fitWindow(rect, onTab);
    const edited = recent.filter((e) => e.kind === "edit" && !e.pending && e.tab === sheet.title && e.rect).map((e) => e.rect!);
    const preview = await buildPreview(api().sheets, id, { title: sheet.title!, sheetId: sheet.sheetId! }, rect, {
      highlight: outline,
      keep: union(edited),
      truncated,
      tabs: await previewTabs(id),
    });
    previewShownAt.set(id, Date.now());
    return { preview, edits: recent, seq: upTo };
  }

  const showRange = tool(
    "show_range",
    "Show the user a live view of the sheet right in the conversation, so they can watch you work. Call it FIRST whenever the user asks you to look at or change a spreadsheet, before reading or editing anything. The view stays live: each range you read gets a scanning outline, each edit animates in (Claude's cursor moves there and the cells fill in), and it follows you across tabs. Call it once per task, not after every step. If you already started, call it now: it catches up on what you've done.",
    {
      spreadsheet,
      range: z.string().optional().describe("A1 range to show first, e.g. \"Sales!A1:F20\". Default: the first tab, or wherever you've been working"),
      highlight: z.string().optional().describe("A1 range to outline, e.g. cells changed outside this session"),
    },
    async ({ spreadsheet, range, highlight }) => openPreview(spreadsheetIdFrom(spreadsheet), range, highlight),
    { title: "Show sheet preview", preview: "show" },
  );

  const previewUpdates = tool(
    "preview_updates",
    "Used by the sheet preview to fetch what Claude has read or edited since it last checked. Not for the model.",
    {
      spreadsheet,
      range: z.string().optional().describe("The preview's current window"),
      highlight: z.string().optional(),
      since: z.number().int().min(0).default(0).describe("Last activity sequence number the preview has seen"),
      initial: z.boolean().default(false).describe("Build the whole preview, as show_range does (when the host didn't pass its result through)"),
      peek: z.boolean().default(false).describe("Only build a preview of `range` (the user picked a tab in the preview); no activity is replayed"),
      stay: z.boolean().default(false).describe("The user picked the tab in `range`: keep building that tab rather than following Claude"),
    },
    async ({ spreadsheet, range, highlight, since, initial, peek, stay }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      if (peek && range) {
        const win = previewWindow(range, undefined);
        const sheet = await resolveSheet(id, win.sheet);
        const preview = await buildPreview(api().sheets, id, { title: sheet.title!, sheetId: sheet.sheetId! }, win.rect, { truncated: win.truncated, tabs: await previewTabs(id) });
        previewShownAt.set(id, Date.now());
        return { preview, seq: Math.max(since, activitySeq) };
      }
      if (initial || !range) return openPreview(id, range, highlight);
      previewShownAt.set(id, Date.now());
      const upTo = activitySeq;
      const edits = (await activitySince(id, since)).filter((e) => e.seq <= upTo);
      const seq = Math.max(since, upTo);
      // Steps that only just started haven't changed the sheet yet: send them without a rebuild. When the
      // minute's reads are mostly used, rebuild only every few seconds (the steps still show) and catch up after.
      const { sheet: winTab, rect: win } = toRect(range);
      // A tab the user is looking at only needs a rebuild when Claude changed something on it.
      const changed = edits.some((e) => !e.pending && (!stay || e.tab === winTab)) || staleFor.has(id);
      if (!changed) return { edits, seq };
      const used = readsLastMinute();
      if (used > PREVIEW_READ_BUDGET && (used > PREVIEW_READ_CEILING || Date.now() - (lastRebuild.get(id) ?? 0) < PREVIEW_SLOW_MS)) {
        if (!staleFor.has(id)) console.error(`Sheet preview: holding the rebuild, ${used} reads in the last minute`);
        staleFor.add(id);
        return { edits, seq };
      }
      staleFor.delete(id);
      lastRebuild.set(id, Date.now());
      // Follow Claude to whichever tab it touched last (one that exists: a failed step may name a tab that doesn't).
      const lastTab = stay ? winTab : (await lastExistingTab(id, edits)) ?? winTab;
      const sheet = await resolveSheet(id, lastTab);
      const onTab = edits.filter((e) => e.tab === sheet.title && e.rect).map((e) => e.rect!);
      const base = sheet.title === winTab ? win : { r0: 0, c0: 0, r1: 100, c1: 26 };
      const rect = fitWindow(base, onTab);
      const edited = edits.filter((e) => e.kind === "edit" && !e.pending && e.tab === sheet.title && e.rect).map((e) => e.rect!);
      const preview = await buildPreview(api().sheets, id, { title: sheet.title!, sheetId: sheet.sheetId! }, rect, { keep: union(edited), tabs: await previewTabs(id) });
      return { edits, seq, preview };
    },
    { preview: "app" },
  );

  // ----- writing -----

  tool(
    "write_range",
    "Write values and/or formulas starting at the top-left cell of the range. Input is parsed like typing into the UI (formulas, dates, percentages work). Previous contents are saved for undo_last. Returns any formula errors found after writing.",
    {
      spreadsheet,
      range: z.string().describe("Top-left cell or full range, e.g. \"Sheet1!B2\""),
      values: grid,
      dry_run: z.boolean().default(false).describe("Only show what would be overwritten"),
      allow_large: z.boolean().default(false).describe(`Required for writes over ${MAX_WRITE_CELLS} cells`),
    },
    async ({ spreadsheet, range, values, dry_run, allow_large }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const n = cellCount(values);
      if (n > MAX_WRITE_CELLS && !allow_large) {
        throw new Error(`Write of ${n} cells exceeds ${MAX_WRITE_CELLS}. Confirm with the user, then pass allow_large: true.`);
      }
      const p = parseA1(range);
      const rows = values.length;
      const cols = Math.max(1, ...values.map((r) => r.length));
      const target = toA1(p.sheet, p.startRow ?? 0, p.startCol ?? 0, (p.startRow ?? 0) + rows, (p.startCol ?? 0) + cols);
      if (dry_run) {
        const cur = await api().sheets.spreadsheets.values.get({ spreadsheetId: id, range: target, valueRenderOption: "FORMULA" });
        return { would_write: target, current_contents: cur.data.values ?? [], new_contents: values };
      }
      await growToFit(id, [target]);
      await snapshot(id, target, `write ${target}`, rows, cols);
      const res = await api().sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: target,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: values.map((r) => r.map((v) => v ?? "")) },
      });
      return { updated_range: res.data.updatedRange, updated_cells: res.data.updatedCells, ...(await verify(id, target)) };
    },
  );

  tool(
    "fill_range",
    "Fill cells from a source block, like dragging the fill handle or pasting onto a bigger selection: the source's formulas (relative references shift), values and formatting repeat across the destination. Use it after writing one row or column of formulas to extend them across a table, instead of sending every column. With continue_series, patterns continue instead (1, 2, 3 → 4, 5, 6; Jan → Feb; dates). The destination's previous contents are saved for undo_last. Returns any formula errors found after filling.",
    {
      spreadsheet,
      source: z.string().describe("The cells to fill from, e.g. \"Model!O25:O97\""),
      destination: z.string().describe("The cells to fill, e.g. \"Model!P25:AE97\" (it may include the source). For continue_series it must sit right after, or right before, the source in the same rows or columns"),
      paste: z.enum(["all", "formulas", "values", "formats"]).default("all").describe("all = formulas, values and formatting; formulas = formulas and values without formatting; values = results as plain values; formats = formatting only"),
      continue_series: z.boolean().default(false).describe("Extend the pattern in the source (like the fill handle) instead of repeating it"),
      allow_large: z.boolean().default(false).describe(`Required for fills over ${MAX_WRITE_CELLS} cells`),
    },
    async ({ spreadsheet, source, destination, paste, continue_series, allow_large }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      await growToFit(id, [destination]);
      const src = await resolveRange(id, source);
      const dst = await resolveRange(id, destination);
      const sp = src.parsed;
      if (sp.startRow === undefined || sp.endRow === undefined || sp.startCol === undefined || sp.endCol === undefined) throw new Error(`source must be a bounded range like "A2:D2", not ${source}.`);
      const S = src.bounded;
      const d = { ...dst.bounded };
      const sameTab = src.sheet.sheetId === dst.sheet.sheetId;
      // A destination that starts with the source ("O25:AE97" for source O25:O97) means the part after it.
      if (sameTab && d.startRow === S.startRow && d.endRow === S.endRow && d.startCol === S.startCol && d.endCol > S.endCol) d.startCol = S.endCol;
      else if (sameTab && d.startCol === S.startCol && d.endCol === S.endCol && d.startRow === S.startRow && d.endRow > S.endRow) d.startRow = S.endRow;
      const sh = S.endRow - S.startRow, sw = S.endCol - S.startCol, dh = d.endRow - d.startRow, dw = d.endCol - d.startCol;
      if (dh <= 0 || dw <= 0) throw new Error("destination has no cells outside the source.");
      const gridOf = (sheetId: number | null | undefined, b: typeof d): sheets_v4.Schema$GridRange => ({ sheetId, startRowIndex: b.startRow, endRowIndex: b.endRow, startColumnIndex: b.startCol, endColumnIndex: b.endCol });
      let request: Request;
      let filled: typeof d;
      if (continue_series) {
        if (!sameTab) throw new Error("continue_series needs source and destination on the same tab.");
        const sameRows = d.startRow === S.startRow && d.endRow === S.endRow, sameCols = d.startCol === S.startCol && d.endCol === S.endCol;
        const fill =
          sameRows && d.startCol === S.endCol ? { dimension: "COLUMNS", fillLength: dw }
          : sameRows && d.endCol === S.startCol ? { dimension: "COLUMNS", fillLength: -dw }
          : sameCols && d.startRow === S.endRow ? { dimension: "ROWS", fillLength: dh }
          : sameCols && d.endRow === S.startRow ? { dimension: "ROWS", fillLength: -dh }
          : undefined;
        if (!fill) throw new Error("For continue_series, destination must be right after (or before) the source in the same rows or columns, e.g. source A2:A4 and destination A5:A20.");
        request = { autoFill: { useAlternateSeries: false, sourceAndDestination: { source: gridOf(src.sheet.sheetId, S), ...fill } } };
        filled = d;
      } else {
        // Sheets repeats the source when the destination is a multiple of it; otherwise it pastes once.
        filled = { startRow: d.startRow, startCol: d.startCol, endRow: d.startRow + (dh % sh === 0 ? dh : sh), endCol: d.startCol + (dw % sw === 0 ? dw : sw) };
        const pasteType = { all: "PASTE_NORMAL", formulas: "PASTE_FORMULA", values: "PASTE_VALUES", formats: "PASTE_FORMAT" }[paste];
        request = { copyPaste: { source: gridOf(src.sheet.sheetId, S), destination: gridOf(dst.sheet.sheetId, filled), pasteType, pasteOrientation: "NORMAL" } };
      }
      const target = toA1(dst.sheet.title!, filled.startRow, filled.startCol, filled.endRow, filled.endCol);
      const cells = (filled.endRow - filled.startRow) * (filled.endCol - filled.startCol);
      if (cells > MAX_WRITE_CELLS && !allow_large) throw new Error(`Fill of ${cells} cells exceeds ${MAX_WRITE_CELLS}. Confirm with the user, then pass allow_large: true.`);
      const writes = paste !== "formats";
      if (writes) await snapshot(id, target, `fill ${target}`, filled.endRow - filled.startRow, filled.endCol - filled.startCol);
      await batch(id, [request]);
      return { filled_range: target, from: toA1(src.sheet.title!, S.startRow, S.startCol, S.endRow, S.endCol), ...(writes ? await verify(id, target) : {}) };
    },
  );

  tool(
    "append_rows",
    "Append rows after the last row of data in a table (detected from the given range or tab).",
    { spreadsheet, range: z.string().describe("Tab name or table range, e.g. \"Sales\" or \"Sales!A:F\""), values: grid },
    async ({ spreadsheet, range, values }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      if (cellCount(values) > MAX_WRITE_CELLS) throw new Error(`Append exceeds ${MAX_WRITE_CELLS} cells; split it up.`);
      propsCache.delete(id); // appending can add rows to the tab
      const res = await api().sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: values.map((r) => r.map((v) => v ?? "")) },
      });
      const updated = res.data.updates?.updatedRange;
      if (updated) {
        // Appended cells were empty before, so undo = clear them.
        const stack = undoStacks.get(id) ?? [];
        const w = Math.max(1, ...values.map((r) => r.length));
        stack.push({ label: `append ${updated}`, range: updated, values: values.map(() => Array(w).fill("")) });
        undoStacks.set(id, stack);
      }
      return { appended_range: updated, ...(updated ? await verify(id, updated) : {}) };
    },
  );

  tool(
    "clear_range",
    "Clear values and formulas in a range (formatting is kept). Previous contents are saved for undo_last.",
    { spreadsheet, range, dry_run: z.boolean().default(false) },
    async ({ spreadsheet, range, dry_run }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      if (dry_run) {
        const cur = await api().sheets.spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: "FORMULA" });
        const v = cur.data.values ?? [];
        return { would_clear: cur.data.range, non_empty_rows: v.length, preview: v.slice(0, 20) };
      }
      await snapshot(id, range, `clear ${range}`);
      const res = await api().sheets.spreadsheets.values.clear({ spreadsheetId: id, range });
      return { cleared_range: res.data.clearedRange };
    },
  );

  tool(
    "find_replace",
    "Find and replace text across a tab or the whole spreadsheet. Not undoable - consider read_range first.",
    {
      spreadsheet,
      find: z.string(),
      replacement: z.string(),
      sheet: z.string().optional().describe("Limit to this tab (default: all tabs)"),
      match_case: z.boolean().default(false),
      match_entire_cell: z.boolean().default(false),
      use_regex: z.boolean().default(false),
      include_formulas: z.boolean().default(false),
    },
    async ({ spreadsheet, find, replacement, sheet, match_case, match_entire_cell, use_regex, include_formulas }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const scope = sheet ? { sheetId: (await resolveSheet(id, sheet)).sheetId } : { allSheets: true };
      const res = await batch(id, [
        {
          findReplace: {
            find,
            replacement,
            matchCase: match_case,
            matchEntireCell: match_entire_cell,
            searchByRegex: use_regex,
            includeFormulas: include_formulas,
            ...scope,
          },
        },
      ]);
      return res.replies?.[0]?.findReplace ?? {};
    },
  );

  tool(
    "undo_last",
    "Undo the most recent write_range, append_rows, or clear_range made through this server (restores values/formulas only, not formatting or structure). History is kept in memory until the server restarts.",
    { spreadsheet },
    async ({ spreadsheet }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const snap = undoStacks.get(id)?.pop();
      if (!snap) return "Nothing to undo for this spreadsheet.";
      await api().sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: snap.range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: snap.values },
      });
      return { undone: snap.label, restored_range: snap.range, remaining_undo_steps: undoStacks.get(id)!.length };
    },
  );

  // ----- structure -----

  tool(
    "manage_tab",
    "Add, delete, rename, or duplicate a tab (sheet).",
    {
      spreadsheet,
      action: z.enum(["add", "delete", "rename", "duplicate"]),
      tab: z.string().optional().describe("Existing tab (for delete/rename/duplicate), or new tab name for add"),
      new_name: z.string().optional().describe("New name (rename/duplicate)"),
      rows: z.number().int().optional().describe("Row count for add"),
      columns: z.number().int().optional().describe("Column count for add"),
    },
    async ({ spreadsheet, action, tab, new_name, rows, columns }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      if (action === "add") {
        const res = await batch(id, [
          {
            addSheet: {
              properties: {
                title: tab,
                ...((rows || columns) && { gridProperties: { rowCount: rows ?? 1000, columnCount: columns ?? 26 } }),
              },
            },
          },
        ]);
        return res.replies?.[0]?.addSheet?.properties;
      }
      if (!tab) throw new Error("tab is required");
      const sheet = await resolveSheet(id, tab);
      if (action === "delete") {
        await batch(id, [{ deleteSheet: { sheetId: sheet.sheetId } }]);
        return `Deleted tab "${tab}".`;
      }
      if (action === "rename") {
        if (!new_name) throw new Error("new_name is required");
        await batch(id, [{ updateSheetProperties: { properties: { sheetId: sheet.sheetId, title: new_name }, fields: "title" } }]);
        return `Renamed "${tab}" to "${new_name}".`;
      }
      const res = await batch(id, [
        { duplicateSheet: { sourceSheetId: sheet.sheetId, newSheetName: new_name, insertSheetIndex: (sheet.index ?? 0) + 1 } },
      ]);
      return res.replies?.[0]?.duplicateSheet?.properties;
    },
  );

  tool(
    "insert_rows_or_columns",
    "Insert blank rows or columns before a given row number or column letter.",
    {
      spreadsheet,
      tab: z.string().optional().describe("Tab name (default: first tab)"),
      dimension: z.enum(["ROWS", "COLUMNS"]),
      before: z.string().describe("Row number (e.g. \"5\") or column letter (e.g. \"C\") to insert before"),
      count: z.number().int().min(1).default(1),
    },
    async ({ spreadsheet, tab, dimension, before, count }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const sheet = await resolveSheet(id, tab);
      const start = dimension === "ROWS" ? Number(before) - 1 : colToIndex(before);
      if (!Number.isInteger(start) || start < 0) throw new Error(`Invalid position: ${before}`);
      await batch(id, [
        {
          insertDimension: {
            range: { sheetId: sheet.sheetId, dimension, startIndex: start, endIndex: start + count },
            inheritFromBefore: start > 0,
          },
        },
      ]);
      return `Inserted ${count} ${dimension.toLowerCase()} before ${before} in "${sheet.title}".`;
    },
  );

  tool(
    "delete_rows_or_columns",
    "Delete entire rows (e.g. \"Sheet1!5:7\") or columns (e.g. \"Sheet1!C:D\"). Not undoable.",
    { spreadsheet, range: z.string().describe("Whole-row range like \"Tab!5:7\" or whole-column range like \"Tab!C:D\"") },
    async ({ spreadsheet, range }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { grid: g, sheet } = await resolveRange(id, range);
      const rowsOnly = g.startRowIndex !== undefined && g.startColumnIndex === undefined;
      const colsOnly = g.startColumnIndex !== undefined && g.startRowIndex === undefined;
      if (!rowsOnly && !colsOnly) throw new Error('Use a whole-row range like "5:7" or a whole-column range like "C:D".');
      const dimension = rowsOnly ? "ROWS" : "COLUMNS";
      const startIndex = rowsOnly ? g.startRowIndex! : g.startColumnIndex!;
      const endIndex = rowsOnly ? g.endRowIndex! : g.endColumnIndex!;
      await batch(id, [{ deleteDimension: { range: { sheetId: sheet.sheetId, dimension, startIndex, endIndex } } }]);
      return `Deleted ${endIndex - startIndex} ${dimension.toLowerCase()} from "${sheet.title}".`;
    },
  );

  tool(
    "freeze",
    "Freeze header rows and/or columns on a tab. Use 0 to unfreeze.",
    { spreadsheet, tab: z.string().optional(), rows: z.number().int().min(0).optional(), columns: z.number().int().min(0).optional() },
    async ({ spreadsheet, tab, rows, columns }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const sheet = await resolveSheet(id, tab);
      const gridProperties: sheets_v4.Schema$GridProperties = {};
      const fields: string[] = [];
      if (rows !== undefined) (gridProperties.frozenRowCount = rows), fields.push("gridProperties.frozenRowCount");
      if (columns !== undefined) (gridProperties.frozenColumnCount = columns), fields.push("gridProperties.frozenColumnCount");
      if (!fields.length) throw new Error("Provide rows and/or columns");
      await batch(id, [{ updateSheetProperties: { properties: { sheetId: sheet.sheetId, gridProperties }, fields: fields.join(",") } }]);
      return `Frozen rows=${rows ?? "unchanged"}, columns=${columns ?? "unchanged"} on "${sheet.title}".`;
    },
  );

  tool(
    "resize_columns",
    "Set column widths in pixels, or auto-fit them to content when width is omitted.",
    { spreadsheet, range: z.string().describe("Column range like \"Sheet1!A:D\""), width: z.number().int().min(1).optional() },
    async ({ spreadsheet, range, width }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { bounded, sheet } = await resolveRange(id, range);
      const dims = { sheetId: sheet.sheetId, dimension: "COLUMNS", startIndex: bounded.startCol, endIndex: bounded.endCol };
      await batch(id, [
        width
          ? { updateDimensionProperties: { range: dims, properties: { pixelSize: width }, fields: "pixelSize" } }
          : { autoResizeDimensions: { dimensions: dims } },
      ]);
      return width ? `Set width ${width}px.` : "Auto-fit column widths.";
    },
  );

  tool(
    "merge_cells",
    "Merge or unmerge cells in a range.",
    { spreadsheet, range, action: z.enum(["merge", "unmerge"]).default("merge"), merge_type: z.enum(["MERGE_ALL", "MERGE_ROWS", "MERGE_COLUMNS"]).default("MERGE_ALL") },
    async ({ spreadsheet, range, action, merge_type }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { grid: g } = await resolveRange(id, range);
      await batch(id, [action === "merge" ? { mergeCells: { range: g, mergeType: merge_type } } : { unmergeCells: { range: g } }]);
      return `${action === "merge" ? "Merged" : "Unmerged"} ${range}.`;
    },
  );

  // ----- formatting -----

  const formatOptions = {
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    font_size: z.number().optional(),
    font_family: z.string().optional(),
    text_color: z.string().optional().describe("Hex, e.g. #1a73e8"),
    background_color: z.string().optional().describe("Hex, e.g. #f1f3f4"),
    number_format: z
      .object({
        type: z.enum(["TEXT", "NUMBER", "PERCENT", "CURRENCY", "DATE", "TIME", "DATE_TIME", "SCIENTIFIC"]),
        pattern: z.string().optional().describe("e.g. \"#,##0.00\", \"$#,##0\", \"0.0%\", \"yyyy-mm-dd\""),
      })
      .optional(),
    horizontal_alignment: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
    vertical_alignment: z.enum(["TOP", "MIDDLE", "BOTTOM"]).optional(),
    wrap: z.enum(["OVERFLOW_CELL", "CLIP", "WRAP"]).optional(),
    borders: z
      .object({
        sides: z.enum(["all", "outer", "inner", "top", "bottom", "left", "right", "none"]),
        style: z.enum(["SOLID", "SOLID_MEDIUM", "SOLID_THICK", "DASHED", "DOTTED", "DOUBLE"]).default("SOLID"),
        color: z.string().default("#000000"),
      })
      .optional(),
    clear_formatting: z.boolean().default(false).describe("Reset all formatting first"),
  };
  type FormatOptions = z.infer<z.ZodObject<typeof formatOptions>>;

  /** The batchUpdate requests that apply one set of formatting options to a grid range. */
  function formatRequests(g: sheets_v4.Schema$GridRange, a: FormatOptions): Request[] {
    const requests: Request[] = [];
    if (a.clear_formatting) requests.push({ repeatCell: { range: g, cell: { userEnteredFormat: {} }, fields: "userEnteredFormat" } });

    const fmt: sheets_v4.Schema$CellFormat = {};
    const fields: string[] = [];
    const text: sheets_v4.Schema$TextFormat = {};
    const textKeys: [keyof FormatOptions, keyof sheets_v4.Schema$TextFormat][] = [
      ["bold", "bold"],
      ["italic", "italic"],
      ["underline", "underline"],
      ["strikethrough", "strikethrough"],
      ["font_size", "fontSize"],
      ["font_family", "fontFamily"],
    ];
    for (const [k, tk] of textKeys) {
      if (a[k] !== undefined) {
        (text as any)[tk] = a[k];
        fields.push(`userEnteredFormat.textFormat.${tk}`);
      }
    }
    if (a.text_color) {
      text.foregroundColorStyle = { rgbColor: hexToColor(a.text_color) };
      fields.push("userEnteredFormat.textFormat.foregroundColorStyle");
    }
    if (Object.keys(text).length) fmt.textFormat = text;
    if (a.background_color) {
      fmt.backgroundColorStyle = { rgbColor: hexToColor(a.background_color) };
      fields.push("userEnteredFormat.backgroundColorStyle");
    }
    if (a.number_format) {
      fmt.numberFormat = a.number_format;
      fields.push("userEnteredFormat.numberFormat");
    }
    if (a.horizontal_alignment) (fmt.horizontalAlignment = a.horizontal_alignment), fields.push("userEnteredFormat.horizontalAlignment");
    if (a.vertical_alignment) (fmt.verticalAlignment = a.vertical_alignment), fields.push("userEnteredFormat.verticalAlignment");
    if (a.wrap) (fmt.wrapStrategy = a.wrap), fields.push("userEnteredFormat.wrapStrategy");
    if (fields.length) requests.push({ repeatCell: { range: g, cell: { userEnteredFormat: fmt }, fields: fields.join(",") } });

    if (a.borders) {
      const b = a.borders.sides === "none" ? { style: "NONE" } : { style: a.borders.style, colorStyle: { rgbColor: hexToColor(a.borders.color) } };
      const s = a.borders.sides;
      const on = (side: string) =>
        s === "all" || s === "none" || s === side || (s === "outer" && ["top", "bottom", "left", "right"].includes(side)) || (s === "inner" && side.startsWith("inner"));
      const upd: sheets_v4.Schema$UpdateBordersRequest = { range: g };
      for (const side of ["top", "bottom", "left", "right", "innerHorizontal", "innerVertical"] as const) if (on(side)) upd[side] = b;
      requests.push({ updateBorders: upd });
    }
    return requests;
  }

  tool(
    "format_range",
    "Apply formatting to a range: font styles, colors, number formats, alignment, wrapping, borders. Only provided options are changed. To style several ranges differently in one go, use format_ranges.",
    { spreadsheet, range, ...formatOptions },
    async (a) => {
      const id = spreadsheetIdFrom(a.spreadsheet);
      await growToFit(id, [a.range]);
      const { grid: g } = await resolveRange(id, a.range);
      const requests = formatRequests(g, a);
      if (!requests.length) throw new Error("No formatting options provided.");
      await batch(id, requests);
      return `Formatted ${a.range}.`;
    },
  );

  tool(
    "format_ranges",
    "Apply different formatting to several ranges in one call (same options as format_range, one entry per range): headers, input cells, number formats, borders and so on for a whole tab at once. Ranges may repeat; later entries win where they overlap.",
    {
      spreadsheet,
      items: z.array(z.object({ range, ...formatOptions })).min(1).max(200).describe("One entry per range, each with the formatting to apply there"),
    },
    async ({ spreadsheet, items }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      await growToFit(id, items.map((i) => i.range));
      const requests: Request[] = [];
      const tabs = new Set<string>();
      for (const item of items) {
        const { grid: g, sheet } = await resolveRange(id, item.range);
        tabs.add(sheet.title!);
        const reqs = formatRequests(g, item);
        if (!reqs.length) throw new Error(`No formatting options provided for ${item.range}.`);
        requests.push(...reqs);
      }
      await batch(id, requests);
      return { formatted: items.length, tabs: [...tabs], ...(tabs.size === 1 && { formatted_range: unionA1(items.map((i) => i.range)) }) };
    },
  );

  tool(
    "add_conditional_format",
    "Add a conditional formatting rule: either a condition (e.g. NUMBER_GREATER, TEXT_CONTAINS, CUSTOM_FORMULA) with a style, or a color scale.",
    {
      spreadsheet,
      range,
      condition: z
        .object({
          type: z.string().describe("Google ConditionType: NUMBER_GREATER, NUMBER_LESS, NUMBER_BETWEEN, NUMBER_EQ, TEXT_CONTAINS, TEXT_EQ, BLANK, NOT_BLANK, DATE_BEFORE, CUSTOM_FORMULA, ..."),
          values: z.array(z.string()).default([]).describe("Condition values, e.g. [\"100\"] or [\"=$C2>$D2\"]"),
          background_color: z.string().optional(),
          text_color: z.string().optional(),
          bold: z.boolean().optional(),
        })
        .optional(),
      color_scale: z
        .object({ min_color: z.string(), mid_color: z.string().optional(), max_color: z.string() })
        .optional(),
    },
    async ({ spreadsheet, range, condition, color_scale }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { grid: g } = await resolveRange(id, range);
      let rule: sheets_v4.Schema$ConditionalFormatRule;
      if (condition) {
        rule = {
          ranges: [g],
          booleanRule: {
            condition: { type: condition.type, values: condition.values.map((v) => ({ userEnteredValue: v })) },
            format: {
              ...(condition.background_color && { backgroundColorStyle: { rgbColor: hexToColor(condition.background_color) } }),
              textFormat: {
                ...(condition.text_color && { foregroundColorStyle: { rgbColor: hexToColor(condition.text_color) } }),
                ...(condition.bold !== undefined && { bold: condition.bold }),
              },
            },
          },
        };
      } else if (color_scale) {
        rule = {
          ranges: [g],
          gradientRule: {
            minpoint: { type: "MIN", colorStyle: { rgbColor: hexToColor(color_scale.min_color) } },
            ...(color_scale.mid_color && {
              midpoint: { type: "PERCENTILE", value: "50", colorStyle: { rgbColor: hexToColor(color_scale.mid_color) } },
            }),
            maxpoint: { type: "MAX", colorStyle: { rgbColor: hexToColor(color_scale.max_color) } },
          },
        };
      } else throw new Error("Provide condition or color_scale.");
      await batch(id, [{ addConditionalFormatRule: { rule, index: 0 } }]);
      return `Added conditional format to ${range}.`;
    },
  );

  // ----- data tools -----

  tool(
    "sort_range",
    "Sort rows within a range by one or more columns.",
    {
      spreadsheet,
      range,
      sort_by: z.array(z.object({ column: z.string().describe("Column letter, e.g. \"C\""), ascending: z.boolean().default(true) })).min(1),
      has_header: z.boolean().default(true).describe("Keep the first row of the range in place"),
    },
    async ({ spreadsheet, range, sort_by, has_header }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { grid: g, bounded } = await resolveRange(id, range);
      const sortRange = { ...g, startRowIndex: bounded.startRow + (has_header ? 1 : 0) };
      await batch(id, [
        {
          sortRange: {
            range: sortRange,
            sortSpecs: sort_by.map((s) => ({ dimensionIndex: colToIndex(s.column), sortOrder: s.ascending ? "ASCENDING" : "DESCENDING" })),
          },
        },
      ]);
      return `Sorted ${range}.`;
    },
  );

  tool(
    "set_filter",
    "Turn on a basic filter (filter buttons in the header row) for a range, or clear the tab's filter.",
    { spreadsheet, range: z.string().describe("Data range including header, or tab name when clearing"), clear: z.boolean().default(false) },
    async ({ spreadsheet, range, clear }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { grid: g, sheet } = await resolveRange(id, range);
      await batch(id, [clear ? { clearBasicFilter: { sheetId: sheet.sheetId } } : { setBasicFilter: { filter: { range: g } } }]);
      return clear ? `Cleared filter on "${sheet.title}".` : `Filter set on ${range}.`;
    },
  );

  tool(
    "set_data_validation",
    "Add data validation to a range: dropdown list, dropdown from a range, checkbox, number range, custom formula - or clear it.",
    {
      spreadsheet,
      range,
      type: z.enum(["dropdown", "dropdown_from_range", "checkbox", "number_between", "custom_formula", "clear"]),
      options: z.array(z.string()).optional().describe("dropdown: list items; dropdown_from_range: [\"=Lists!A2:A20\"]; custom_formula: [\"=ISNUMBER(A2)\"]"),
      min: z.number().optional(),
      max: z.number().optional(),
      strict: z.boolean().default(true).describe("Reject invalid input (vs. show a warning)"),
    },
    async ({ spreadsheet, range, type, options, min, max, strict }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { grid: g } = await resolveRange(id, range);
      const vals = (xs: (string | number)[]) => xs.map((v) => ({ userEnteredValue: String(v) }));
      const conditions: Record<string, sheets_v4.Schema$BooleanCondition> = {
        dropdown: { type: "ONE_OF_LIST", values: vals(options ?? []) },
        dropdown_from_range: { type: "ONE_OF_RANGE", values: vals(options ?? []) },
        checkbox: { type: "BOOLEAN" },
        number_between: { type: "NUMBER_BETWEEN", values: vals([min ?? -1e15, max ?? 1e15]) },
        custom_formula: { type: "CUSTOM_FORMULA", values: vals(options ?? []) },
      };
      const rule = type === "clear" ? undefined : { condition: conditions[type], strict, showCustomUi: true };
      await batch(id, [{ setDataValidation: { range: g, rule } }]);
      return type === "clear" ? `Cleared validation on ${range}.` : `Set ${type} validation on ${range}.`;
    },
  );

  const chartType = z.enum(["COLUMN", "BAR", "LINE", "AREA", "SCATTER", "PIE", "COMBO"]);

  /** Chart spec for a data range: the first column is the X axis/labels, each following column a series. */
  async function chartSpecFor(id: string, o: { data_range: string; chart_type: z.infer<typeof chartType>; title?: string; has_header: boolean; stacked: boolean }) {
    const { bounded: b, sheet } = await resolveRange(id, o.data_range);
    const col = (c: number): sheets_v4.Schema$ChartData => ({
      sourceRange: { sources: [{ sheetId: sheet.sheetId, startRowIndex: b.startRow, endRowIndex: b.endRow, startColumnIndex: c, endColumnIndex: c + 1 }] },
    });
    const spec: sheets_v4.Schema$ChartSpec =
      o.chart_type === "PIE"
        ? { title: o.title, pieChart: { legendPosition: "RIGHT_LEGEND", domain: col(b.startCol), series: col(b.startCol + 1) } }
        : {
            title: o.title,
            basicChart: {
              chartType: o.chart_type,
              legendPosition: "BOTTOM_LEGEND",
              headerCount: o.has_header ? 1 : 0,
              ...(o.stacked && { stackedType: "STACKED" }),
              domains: [{ domain: col(b.startCol) }],
              series: Array.from({ length: b.endCol - b.startCol - 1 }, (_, i) => ({
                series: col(b.startCol + i + 1),
                targetAxis: o.chart_type === "BAR" ? "BOTTOM_AXIS" : "LEFT_AXIS",
                ...(o.chart_type === "COMBO" && { type: i === 0 ? "COLUMN" : "LINE" }),
              })),
            },
          };
    if (o.chart_type === "PIE" && o.has_header) {
      // Pie charts have no headerCount; skip the header row instead.
      for (const d of [spec.pieChart!.domain!, spec.pieChart!.series!]) d.sourceRange!.sources![0].startRowIndex = b.startRow + 1;
    }
    return { spec, bounded: b, sheet };
  }

  async function findChart(id: string, chartId: number) {
    const res = await api().sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(sheetId,title),charts)" });
    for (const s of res.data.sheets ?? []) {
      const chart = (s.charts ?? []).find((c) => c.chartId === chartId);
      if (chart) return { chart, tab: s.properties!.title! };
    }
    const all = (res.data.sheets ?? []).flatMap((s) => (s.charts ?? []).map((c) => `${c.chartId} (${c.spec?.title ?? "untitled"}, on ${s.properties?.title})`));
    throw new Error(`No chart with id ${chartId}. Charts in this spreadsheet: ${all.join("; ") || "none"}. get_spreadsheet_info lists them.`);
  }

  tool(
    "add_chart",
    "Create a chart from a data range. The first column is the X axis/labels; each following column is a series. Use a header row for series names.",
    {
      spreadsheet,
      data_range: z.string().describe("e.g. \"Sales!A1:C13\""),
      chart_type: chartType.default("COLUMN"),
      title: z.string().optional(),
      anchor_cell: z.string().optional().describe("Where to place the chart's top-left, e.g. \"Sales!F2\" (default: right of the data)"),
      has_header: z.boolean().default(true),
      stacked: z.boolean().default(false),
    },
    async ({ spreadsheet, data_range, chart_type, title, anchor_cell, has_header, stacked }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { spec, bounded: b, sheet } = await chartSpecFor(id, { data_range, chart_type, title, has_header, stacked });
      let anchor = { sheetId: sheet.sheetId, rowIndex: b.startRow, columnIndex: b.endCol + 1 };
      if (anchor_cell) {
        const { bounded: ab, sheet: as } = await resolveRange(id, anchor_cell);
        anchor = { sheetId: as.sheetId, rowIndex: ab.startRow, columnIndex: ab.startCol };
      }
      const res = await batch(id, [{ addChart: { chart: { spec, position: { overlayPosition: { anchorCell: anchor } } } } }]);
      return { chart_id: res.replies?.[0]?.addChart?.chart?.chartId, placed_at: `${indexToCol(anchor.columnIndex)}${anchor.rowIndex + 1}` };
    },
  );

  tool(
    "update_chart",
    "Change an existing chart: its title, type, data range, stacking, position or size. Only the options you give are changed. Chart ids come from get_spreadsheet_info or add_chart.",
    {
      spreadsheet,
      chart_id: z.number().int(),
      title: z.string().optional(),
      chart_type: chartType.optional(),
      data_range: z.string().optional().describe("New data, laid out as for add_chart: first column labels, then one column per series"),
      has_header: z.boolean().default(true).describe("Used with data_range"),
      stacked: z.boolean().optional(),
      anchor_cell: z.string().optional().describe("Move the chart's top-left corner here, e.g. \"Sales!F2\""),
      width: z.number().int().min(50).max(4000).optional().describe("Pixels"),
      height: z.number().int().min(50).max(4000).optional().describe("Pixels"),
    },
    async ({ spreadsheet, chart_id, title, chart_type, data_range, has_header, stacked, anchor_cell, width, height }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { chart, tab } = await findChart(id, chart_id);
      const old = chart.spec ?? {};
      const oldType = (old.pieChart ? "PIE" : old.basicChart?.chartType) as z.infer<typeof chartType> | undefined;
      const requests: Request[] = [];
      const changed: string[] = [];
      if (title !== undefined || chart_type || data_range || stacked !== undefined) {
        let spec: sheets_v4.Schema$ChartSpec;
        if (data_range) {
          ({ spec } = await chartSpecFor(id, {
            data_range,
            chart_type: chart_type ?? oldType ?? "COLUMN",
            title: title ?? old.title ?? undefined,
            has_header,
            stacked: stacked ?? old.basicChart?.stackedType === "STACKED",
          }));
        } else {
          spec = structuredClone(old);
          if (title !== undefined) spec.title = title;
          if (chart_type && chart_type !== oldType) {
            if (chart_type === "PIE" || !spec.basicChart) throw new Error("Switching to or from a pie chart also needs data_range.");
            spec.basicChart.chartType = chart_type;
            (spec.basicChart.series ?? []).forEach((s, i) => {
              s.targetAxis = chart_type === "BAR" ? "BOTTOM_AXIS" : "LEFT_AXIS";
              if (chart_type === "COMBO") s.type = i === 0 ? "COLUMN" : "LINE";
              else delete s.type;
            });
          }
          if (stacked !== undefined) {
            if (!spec.basicChart) throw new Error("Pie charts can't be stacked.");
            spec.basicChart.stackedType = stacked ? "STACKED" : "NOT_STACKED";
          }
        }
        requests.push({ updateChartSpec: { chartId: chart_id, spec } });
        changed.push(...[title !== undefined && "title", chart_type && "type", data_range && "data", stacked !== undefined && "stacking"].filter((x): x is string => !!x));
      }
      if (anchor_cell || width || height) {
        const pos: sheets_v4.Schema$OverlayPosition = {};
        if (anchor_cell) {
          const { bounded: ab, sheet: as } = await resolveRange(id, anchor_cell);
          Object.assign(pos, { anchorCell: { sheetId: as.sheetId, rowIndex: ab.startRow, columnIndex: ab.startCol }, offsetXPixels: 0, offsetYPixels: 0 });
          changed.push("position");
        }
        if (width) pos.widthPixels = width;
        if (height) pos.heightPixels = height;
        if (width || height) changed.push("size");
        requests.push({ updateEmbeddedObjectPosition: { objectId: chart_id, newPosition: { overlayPosition: pos }, fields: Object.keys(pos).join(",") } });
      }
      if (!requests.length) throw new Error("Nothing to change: give a title, chart_type, data_range, stacked, anchor_cell, width or height.");
      await batch(id, requests);
      return { chart_id, changed, tab };
    },
  );

  tool(
    "delete_chart",
    "Delete a chart. Chart ids come from get_spreadsheet_info or add_chart. Not undoable through undo_last.",
    { spreadsheet, chart_id: z.number().int() },
    async ({ spreadsheet, chart_id }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { chart, tab } = await findChart(id, chart_id);
      await batch(id, [{ deleteEmbeddedObject: { objectId: chart_id } }]);
      return { deleted_chart: chart_id, ...(chart.spec?.title && { title: chart.spec.title }), tab };
    },
  );

  // ----- pivot tables -----

  tool(
    "add_pivot_table",
    "Summarize a table with a pivot table: group by one or more columns, and total, count or average others. It goes on a new tab unless anchor_cell is given. The source range needs a header row; refer to columns by header name or letter.",
    {
      spreadsheet,
      source_range: z.string().describe("The table to summarize, header row included, e.g. \"Orders!A1:F500\" or a tab name"),
      rows: z.array(z.string()).default([]).describe("Columns to group by down the side, e.g. [\"Region\"]"),
      columns: z.array(z.string()).default([]).describe("Columns to group by across the top"),
      values: z
        .array(
          z.object({
            column: z.string(),
            summarize: z.enum(["SUM", "COUNTA", "COUNT", "COUNTUNIQUE", "AVERAGE", "MAX", "MIN", "MEDIAN"]).default("SUM").describe("COUNTA counts non-empty cells; COUNT counts numbers"),
            name: z.string().optional().describe("Heading for this value"),
          }),
        )
        .min(1),
      anchor_cell: z.string().optional().describe("Top-left cell for the pivot table, e.g. \"Summary!A1\". The area below and right of it must be empty. Default: a new tab"),
      new_tab_name: z.string().default("Pivot").describe("Name for the new tab when anchor_cell isn't given"),
      show_totals: z.boolean().default(true),
    },
    async ({ spreadsheet, source_range, rows, columns, values, anchor_cell, new_tab_name, show_totals }) => {
      if (!rows.length && !columns.length) throw new Error("Give at least one column to group by, in rows or columns.");
      const id = spreadsheetIdFrom(spreadsheet);
      const { sheet: src, parsed } = await resolveRange(id, source_range);
      // Bound the source to the cells that have data, so open-ended ranges don't add a blank group.
      const got = await api().sheets.spreadsheets.values.get({ spreadsheetId: id, range: source_range });
      const data = (got.data.values ?? []) as Cell[][];
      if (data.length < 2) throw new Error("The source range needs a header row and at least one row of data.");
      const r0 = parsed.startRow ?? 0, c0 = parsed.startCol ?? 0;
      const width = Math.max(...data.map((r) => r.length));
      const headers = Array.from({ length: width }, (_, i) => String(data[0][i] ?? "").trim());
      const offset = (name: string) => {
        const byHeader = headers.findIndex((h) => h.toLowerCase() === name.trim().toLowerCase());
        if (byHeader >= 0) return byHeader;
        const byLetter = /^[A-Za-z]{1,3}$/.test(name.trim()) ? colToIndex(name.trim()) - c0 : -1;
        if (byLetter >= 0 && byLetter < width) return byLetter;
        throw new Error(`No column "${name}" in the source range. Columns: ${headers.filter(Boolean).join(", ")}`);
      };
      const group = (name: string): sheets_v4.Schema$PivotGroup => ({ sourceColumnOffset: offset(name), showTotals: show_totals, sortOrder: "ASCENDING" });
      const pivotTable: sheets_v4.Schema$PivotTable = {
        source: { sheetId: src.sheetId, startRowIndex: r0, endRowIndex: r0 + data.length, startColumnIndex: c0, endColumnIndex: c0 + width },
        rows: rows.map(group),
        columns: columns.map(group),
        values: values.map((v) => ({ sourceColumnOffset: offset(v.column), summarizeFunction: v.summarize, ...(v.name && { name: v.name }) })),
        valueLayout: "HORIZONTAL",
      };
      let dest: { sheetId: number; rowIndex: number; columnIndex: number };
      let tab: string;
      if (anchor_cell) {
        const { bounded: ab, sheet: as } = await resolveRange(id, anchor_cell);
        dest = { sheetId: as.sheetId!, rowIndex: ab.startRow, columnIndex: ab.startCol };
        tab = as.title!;
      } else {
        const taken = new Set((await getSheetProps(id)).map((p) => p.title));
        tab = new_tab_name;
        for (let n = 2; taken.has(tab); n++) tab = `${new_tab_name} ${n}`;
        const added = await batch(id, [{ addSheet: { properties: { title: tab } } }]);
        dest = { sheetId: added.replies![0].addSheet!.properties!.sheetId!, rowIndex: 0, columnIndex: 0 };
      }
      await batch(id, [{ updateCells: { start: dest, rows: [{ values: [{ pivotTable }] }], fields: "pivotTable" } }]);
      const out = await api().sheets.spreadsheets.values.get({ spreadsheetId: id, range: toA1(tab, dest.rowIndex, dest.columnIndex, dest.rowIndex + 200, dest.columnIndex + 26) });
      const result = (out.data.values ?? []) as Cell[][];
      const blocked = result.some((r) => r.some((v) => typeof v === "string" && v.startsWith("#REF!")));
      return {
        pivot_at: `${quoteSheet(tab)}!${indexToCol(dest.columnIndex)}${dest.rowIndex + 1}`,
        tab,
        pivot_range: toA1(tab, dest.rowIndex, dest.columnIndex, dest.rowIndex + Math.max(1, result.length), dest.columnIndex + Math.max(1, ...result.map((r) => r.length))),
        rows: result.length,
        preview: result.slice(0, 20),
        ...(blocked && { warning: "The pivot table shows #REF!: other cells are in its way. Clear the area below and right of the anchor, or use a new tab." }),
      };
    },
  );

  // ----- escape hatch -----

  tool(
    "batch_update",
    "Send raw Google Sheets API batchUpdate requests for anything the other tools don't cover (e.g. named ranges, protected ranges, pivot tables, row heights, hiding rows, updating charts). Requests use sheetId numbers from get_spreadsheet_info.",
    { spreadsheet, requests: z.array(z.record(z.string(), z.any())).min(1).describe("Array of Request objects, see developers.google.com/sheets/api/reference/rest/v4/spreadsheets/request") },
    async ({ spreadsheet, requests }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const res = await batch(id, requests as Request[]);
      return { replies: res.replies };
    },
  );

  // Only offer show_range to hosts that can display MCP Apps; elsewhere Claude would call it and the user would see nothing.
  server.server.oninitialized = () => {
    const caps = server.server.getClientCapabilities() as { extensions?: Record<string, unknown> } | undefined;
    const client = server.server.getClientVersion();
    previewsOn = !!caps?.extensions?.[UI_EXTENSION];
    console.error(`Client: ${client?.name} ${client?.version}; sheet previews ${previewsOn ? "on" : "off"}`);
    if (!previewsOn) {
      showRange.remove();
      previewUpdates.remove();
    }
  };

  return server;
}
