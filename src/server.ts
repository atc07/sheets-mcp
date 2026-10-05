import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { z } from "zod";
import { colToIndex, hexToColor, indexToCol, parseA1, quoteSheet, spreadsheetIdFrom, toA1 } from "./a1.js";
import { AsyncLocalStorage } from "node:async_hooks";
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
    c = { sheets: sheets({ version: "v4", auth }) };
    clients.set(email, c);
  }
  return c;
}

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

async function getSheetProps(id: string) {
  const res = await api().sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties",
  });
  return (res.data.sheets ?? []).map((s) => s.properties!);
}

/** Resolve an A1 range to a GridRange (sheet name -> sheetId). Omitted sheet means the first tab. */
async function resolveRange(id: string, a1: string) {
  const parsed = parseA1(a1);
  const props = await getSheetProps(id);
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

async function resolveSheet(id: string, name?: string) {
  const props = await getSheetProps(id);
  const sheet = name === undefined ? props[0] : props.find((p) => p.title === name);
  if (!sheet) throw new Error(`No tab named "${name}". Tabs: ${props.map((p) => p.title).join(", ")}`);
  return sheet;
}

async function batch(id: string, requests: Request[]) {
  const res = await api().sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
  return res.data;
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
  const server = new McpServer(
    { name: "google-sheets", version: "1.0.0" },
    {
      instructions:
        "Sheets MCP lets you read and edit the user's Google Sheets. " +
        "The first time the user brings up spreadsheets in a conversation, briefly offer what you can do (summarize a sheet, add columns and formulas, clean up formatting, sort and filter, add dropdowns, build charts, create new spreadsheets) and ask them to paste a link to the sheet. " +
        "When several Google accounts are connected, some tools reply that the account must be confirmed: ask the user which account to use, then call the tool again with `account` set to their choice. Never pick an account for them.",
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
              "Finish by asking which sheet I'd like to work on, and say I can paste its link.",
          },
        },
      ],
    }),
  );

  const accountArg = z
    .string()
    .optional()
    .describe("Google account to use: an email or unique part of one (e.g. \"acme.com\"). Default: the account that can open the spreadsheet, else the default account.");

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
    opts: { manageAccounts?: boolean } = {},
  ) {
    const fullShape = opts.manageAccounts ? shape : { ...shape, account: accountArg };
    server.registerTool(name, { description, inputSchema: fullShape }, (async (args: z.infer<z.ZodObject<S>> & { account?: string }) => {
      try {
        if (opts.manageAccounts) {
          const result = await handler(args);
          return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
        }
        const { all, fallback } = await accounts();
        let result: unknown;
        let usedAccount: string | undefined;
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
        let text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        if (usedAccount && all.length > 1) text = `[account: ${usedAccount}]\n${text}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        const msg = errorMessage(e);
        return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    }) as any);
  }

  const spreadsheet = z.string().describe("Spreadsheet ID or full Google Sheets URL");
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
    "Get a spreadsheet's title, tabs (sizes, frozen rows/cols), named ranges, and the first few rows of each tab. Call this first to understand a sheet's layout.",
    { spreadsheet, preview_rows: z.number().int().min(0).max(20).default(3) },
    async ({ spreadsheet, preview_rows }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const res = await api().sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: "properties(title,locale,timeZone),spreadsheetUrl,sheets(properties,charts(chartId),basicFilter.range),namedRanges",
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
            ...(t.charts?.length && { charts: t.charts.length }),
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
    "append_rows",
    "Append rows after the last row of data in a table (detected from the given range or tab).",
    { spreadsheet, range: z.string().describe("Tab name or table range, e.g. \"Sales\" or \"Sales!A:F\""), values: grid },
    async ({ spreadsheet, range, values }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      if (cellCount(values) > MAX_WRITE_CELLS) throw new Error(`Append exceeds ${MAX_WRITE_CELLS} cells; split it up.`);
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

  tool(
    "format_range",
    "Apply formatting to a range: font styles, colors, number formats, alignment, wrapping, borders. Only provided options are changed.",
    {
      spreadsheet,
      range,
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
    },
    async (a) => {
      const id = spreadsheetIdFrom(a.spreadsheet);
      const { grid: g } = await resolveRange(id, a.range);
      const requests: Request[] = [];
      if (a.clear_formatting) requests.push({ repeatCell: { range: g, cell: { userEnteredFormat: {} }, fields: "userEnteredFormat" } });

      const fmt: sheets_v4.Schema$CellFormat = {};
      const fields: string[] = [];
      const text: sheets_v4.Schema$TextFormat = {};
      const textKeys: [keyof typeof a, keyof sheets_v4.Schema$TextFormat][] = [
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
      if (!requests.length) throw new Error("No formatting options provided.");
      await batch(id, requests);
      return `Formatted ${a.range}.`;
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

  tool(
    "add_chart",
    "Create a chart from a data range. The first column is the X axis/labels; each following column is a series. Use a header row for series names.",
    {
      spreadsheet,
      data_range: z.string().describe("e.g. \"Sales!A1:C13\""),
      chart_type: z.enum(["COLUMN", "BAR", "LINE", "AREA", "SCATTER", "PIE", "COMBO"]).default("COLUMN"),
      title: z.string().optional(),
      anchor_cell: z.string().optional().describe("Where to place the chart's top-left, e.g. \"Sales!F2\" (default: right of the data)"),
      has_header: z.boolean().default(true),
      stacked: z.boolean().default(false),
    },
    async ({ spreadsheet, data_range, chart_type, title, anchor_cell, has_header, stacked }) => {
      const id = spreadsheetIdFrom(spreadsheet);
      const { bounded: b, sheet } = await resolveRange(id, data_range);
      const col = (c: number): sheets_v4.Schema$ChartData => ({
        sourceRange: { sources: [{ sheetId: sheet.sheetId, startRowIndex: b.startRow, endRowIndex: b.endRow, startColumnIndex: c, endColumnIndex: c + 1 }] },
      });
      let anchor = { sheetId: sheet.sheetId, rowIndex: b.startRow, columnIndex: b.endCol + 1 };
      if (anchor_cell) {
        const { bounded: ab, sheet: as } = await resolveRange(id, anchor_cell);
        anchor = { sheetId: as.sheetId, rowIndex: ab.startRow, columnIndex: ab.startCol };
      }
      const headerCount = has_header ? 1 : 0;
      const spec: sheets_v4.Schema$ChartSpec =
        chart_type === "PIE"
          ? { title, pieChart: { legendPosition: "RIGHT_LEGEND", domain: col(b.startCol), series: col(b.startCol + 1) } }
          : {
              title,
              basicChart: {
                chartType: chart_type,
                legendPosition: "BOTTOM_LEGEND",
                headerCount,
                ...(stacked && { stackedType: "STACKED" }),
                domains: [{ domain: col(b.startCol) }],
                series: Array.from({ length: b.endCol - b.startCol - 1 }, (_, i) => ({
                  series: col(b.startCol + i + 1),
                  targetAxis: chart_type === "BAR" ? "BOTTOM_AXIS" : "LEFT_AXIS",
                  ...(chart_type === "COMBO" && { type: i === 0 ? "COLUMN" : "LINE" }),
                })),
              },
            };
      if (chart_type === "PIE" && has_header) {
        // Pie charts have no headerCount; skip the header row instead.
        for (const d of [spec.pieChart!.domain!, spec.pieChart!.series!]) d.sourceRange!.sources![0].startRowIndex = b.startRow + 1;
      }
      const res = await batch(id, [{ addChart: { chart: { spec, position: { overlayPosition: { anchorCell: anchor } } } } }]);
      return { chart_id: res.replies?.[0]?.addChart?.chart?.chartId, placed_at: `${indexToCol(anchor.columnIndex)}${anchor.rowIndex + 1}` };
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

  return server;
}
