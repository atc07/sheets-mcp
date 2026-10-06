import type { sheets_v4 } from "@googleapis/sheets";
import { createHash } from "node:crypto";
import { parseA1, toA1 } from "./a1.js";
import { PREVIEW_HTML } from "./preview-html.js";

export { PREVIEW_HTML };

/**
 * The MCP Apps resource that renders show_range results inline in Claude. Hosts cache UI resources
 * by URI, so the URI carries a hash of the page: a new widget always gets a new address.
 */
export const PREVIEW_URI = `ui://sheets-mcp/preview-${createHash("sha256").update(PREVIEW_HTML).digest("hex").slice(0, 10)}.html`;
export const PREVIEW_MIME = "text/html;profile=mcp-app";
/** Client capability key for MCP Apps support. */
export const UI_EXTENSION = "io.modelcontextprotocol/ui";

const MAX_ROWS = 120;
const MAX_COLS = 26;
/** Cells per preview, so the result stays a size hosts pass through to the widget. */
const MAX_CELLS = 1500;
/**
 * Characters of cell JSON per preview. Some hosts hand the structured result to the model as well as
 * to the widget, so past this the formulas go first (the widget only shows them in its formula bar),
 * then trailing rows.
 */
const MAX_CELL_CHARS = 36_000;
/** How far above the view to look for charts that hang down into it. */
const LEAD_ROWS = 40;

/** A block of cells, 0-based and end-exclusive. */
export interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/**
 * Something Claude is reading or changing, as the widget animates it. A step is sent twice: once when
 * the tool starts (`pending`, so the widget can show it in progress and move its cursor there) and once
 * when it finishes, with the same `id` and a new `seq`. `rect` is missing for whole-tab steps (freeze, new tab…).
 */
export interface PreviewEdit {
  seq: number;
  /** The seq of the step's start; the same on its finish. */
  id: number;
  tool: string;
  kind: "read" | "edit";
  tab?: string;
  a1?: string;
  rect?: Rect;
  pending?: true;
  failed?: true;
}

/**
 * One cell as the widget draws it: v = displayed text, f = formula, n = number, b/i/s/u = bold/italic/
 * strike/underline, bg/fg = colors, al/va = alignment, fs = font size (pt), ff = font, w = wraps,
 * bd = borders [top, right, bottom, left] as "width color" (width 1-3, "d" suffix for dashed/dotted),
 * dv = a dropdown ("list") or checkbox ("check"), drawn as Sheets draws them.
 * A cell with nothing but text travels as the bare string.
 */
export type CompactCell = PreviewCell | string;
interface PreviewCell {
  v: string;
  f?: string;
  n?: true;
  b?: true;
  i?: true;
  s?: true;
  u?: true;
  bg?: string;
  fg?: string;
  al?: "l" | "c" | "r";
  va?: "t" | "m";
  fs?: number;
  ff?: string;
  w?: true;
  bd?: (string | null)[];
  dv?: "list" | "check";
}

/** A chart floating over the grid, with its data, so the widget can draw it. */
export interface PreviewChart {
  id: number;
  title?: string;
  /** COLUMN, BAR, LINE, AREA, COMBO, SCATTER, STEPPED_AREA or PIE; anything else draws as a labeled box. */
  type: string;
  stacked?: boolean;
  /** Anchor cell (sheet coordinates), and where the chart sits in pixels from the view's top-left cell (top can be negative). */
  row: number;
  col: number;
  left: number;
  top: number;
  width: number;
  height: number;
  legend?: string;
  font?: string;
  title_size?: number;
  title_bold?: true;
  title_color?: string;
  bg?: string;
  /** The spreadsheet theme's accent colors, which series without their own color use in order. */
  palette?: string[];
  value_format?: { prefix?: string; pct?: true; paren?: true; zero_dash?: true };
  labels: string[];
  series: { name?: string; values: (number | null)[]; type?: string; color?: string }[];
  pie_hole?: number;
}

export interface Preview {
  spreadsheet_id: string;
  title: string;
  tab: string;
  url: string;
  /** The block to ask for on the next live update, e.g. "'Sales'!A1:F20". */
  window: string;
  start_row: number;
  start_col: number;
  col_widths: number[];
  row_heights: number[];
  rows: CompactCell[][];
  /** Merged blocks inside the view, in sheet coordinates. */
  merges?: Rect[];
  /** The header row of a basic filter (0-based row, end-exclusive columns), clipped to the view. */
  filter?: { r: number; c0: number; c1: number };
  charts?: PreviewChart[];
  hide_gridlines?: true;
  /** Frozen panes on this tab (absolute counts, as in Sheets). */
  frozen_rows?: number;
  frozen_cols?: number;
  /** Every tab in the spreadsheet, in order, for the tab strip. */
  tabs?: { title: string; hidden?: true }[];
  /** Formulas were left out to keep the result small; the formula bar shows values instead. */
  formulas_omitted?: true;
  /** The spreadsheet's default font size (pt). */
  base_font?: number;
  /** Cells Claude changed, outlined when there are no edits to replay. */
  highlight?: Rect & { a1: string };
  truncated?: true;
}

function hex(c?: sheets_v4.Schema$Color | null) {
  if (!c) return undefined;
  const h = (x?: number | null) => Math.round((x ?? 0) * 255).toString(16).padStart(2, "0");
  return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
}

/** An A1 range as a Rect; open-ended rows or columns stop at the preview limits. */
export function toRect(a1: string): { sheet?: string; rect: Rect } {
  const p = parseA1(a1);
  const r0 = p.startRow ?? 0, c0 = p.startCol ?? 0;
  return { sheet: p.sheet, rect: { r0, c0, r1: p.endRow ?? r0 + MAX_ROWS, c1: p.endCol ?? c0 + MAX_COLS } };
}

export function union(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  return {
    r0: Math.min(...rects.map((r) => r.r0)),
    c0: Math.min(...rects.map((r) => r.c0)),
    r1: Math.max(...rects.map((r) => r.r1)),
    c1: Math.max(...rects.map((r) => r.c1)),
  };
}

/** Keep a window within the preview limits, favoring its bottom-right (where the latest edits usually are). */
function clamp(w: Rect, keepEnd: boolean) {
  const truncated = w.r1 - w.r0 > MAX_ROWS || w.c1 - w.c0 > MAX_COLS;
  if (keepEnd) {
    return { rect: { r0: Math.max(w.r0, w.r1 - MAX_ROWS), c0: Math.max(w.c0, w.c1 - MAX_COLS), r1: w.r1, c1: w.c1 }, truncated };
  }
  return { rect: { ...w, r1: Math.min(w.r1, w.r0 + MAX_ROWS), c1: Math.min(w.c1, w.c0 + MAX_COLS) }, truncated };
}

/**
 * Pick the block of cells to show. With only `highlight`, show it with a little context:
 * from A1 (or a few rows above, for changes far down) to a row and column past it.
 */
export function previewWindow(range: string | undefined, highlight: string | undefined) {
  const r = range ? toRect(range) : undefined;
  const h = highlight ? toRect(highlight) : undefined;
  if (r?.sheet !== undefined && h?.sheet !== undefined && h.sheet !== r.sheet) {
    throw new Error(`highlight (${h.sheet}) must be on the same tab as range (${r.sheet}).`);
  }
  let w: Rect;
  if (r) w = r.rect;
  else {
    const hr = h!.rect;
    const r0 = hr.r0 < 12 ? 0 : hr.r0 - 3;
    const c0 = hr.c0 < 6 ? 0 : hr.c0 - 1;
    w = { r0, c0, r1: Math.max(hr.r1 + 2, r0 + 6), c1: Math.max(hr.c1 + 1, c0 + 4) };
  }
  const { rect, truncated } = clamp(w, false);
  return { sheet: r?.sheet ?? h?.sheet, rect, highlight: h?.rect, truncated };
}

/** Grow a window to take in new activity (big ranges count from their top-left), leaving a row and column of context. */
export function fitWindow(w: Rect, edits: Rect[]) {
  const clipped = edits.map((e) => ({ ...e, r1: Math.min(e.r1, e.r0 + MAX_ROWS - 1) + 1, c1: Math.min(e.c1, e.c0 + MAX_COLS - 1) + 1 }));
  const u = union([w, ...clipped])!;
  return clamp(u, u.r1 > w.r1 || u.c1 > w.c1).rect;
}

const BORDER_WIDTH: Record<string, string> = { SOLID: "1", SOLID_MEDIUM: "2", SOLID_THICK: "3", DOUBLE: "3", DASHED: "1d", DOTTED: "1d" };
const MAX_POINTS = 200;
const MAX_SERIES = 8;

function border(b?: sheets_v4.Schema$Border | null) {
  if (!b?.style || b.style === "NONE") return null;
  return `${BORDER_WIDTH[b.style] ?? "1"} ${hex(b.colorStyle?.rgbColor ?? b.color) ?? "#000000"}`;
}

function toCell(v?: sheets_v4.Schema$CellData): PreviewCell {
  const fmt = v?.effectiveFormat;
  const t = fmt?.textFormat;
  const cell: PreviewCell = { v: v?.formattedValue ?? "" };
  if (v?.userEnteredValue?.formulaValue) cell.f = v.userEnteredValue.formulaValue;
  if (typeof v?.effectiveValue?.numberValue === "number") cell.n = true;
  if (t?.bold) cell.b = true;
  if (t?.italic) cell.i = true;
  if (t?.strikethrough) cell.s = true;
  if (t?.underline) cell.u = true;
  const bg = hex(fmt?.backgroundColorStyle?.rgbColor ?? fmt?.backgroundColor);
  if (bg && bg !== "#ffffff") cell.bg = bg;
  const fg = hex(t?.foregroundColorStyle?.rgbColor ?? t?.foregroundColor);
  if (fg && fg !== "#000000") cell.fg = fg;
  const al = fmt?.horizontalAlignment;
  if (al === "LEFT" || al === "CENTER" || al === "RIGHT") cell.al = al[0].toLowerCase() as PreviewCell["al"];
  if (fmt?.verticalAlignment === "TOP") cell.va = "t";
  if (fmt?.verticalAlignment === "MIDDLE") cell.va = "m";
  if (t?.fontSize) cell.fs = t.fontSize;
  if (t?.fontFamily) cell.ff = t.fontFamily;
  if (fmt?.wrapStrategy === "WRAP") cell.w = true;
  const dv = v?.dataValidation?.condition?.type;
  if (dv === "ONE_OF_LIST" || dv === "ONE_OF_RANGE") cell.dv = "list";
  if (dv === "BOOLEAN") cell.dv = "check";
  const b = fmt?.borders;
  if (b) {
    const bd = [border(b.top), border(b.right), border(b.bottom), border(b.left)];
    if (bd.some(Boolean)) cell.bd = bd;
  }
  return cell;
}

/** Shrink a cell for the wire: plain text travels as a bare string. */
function compact(cell: PreviewCell): CompactCell {
  for (const k in cell) if (k !== "v") return cell;
  return cell.v;
}

/** How a chart's value axis writes numbers, read from the number format of its first data cell. */
function valueFormat(pattern?: string | null, type?: string | null) {
  if (!pattern) return type === "PERCENT" ? { pct: true as const } : type === "CURRENCY" ? { prefix: "$" } : undefined;
  const sections = pattern.replace(/[\\"]/g, "").split(";");
  const f = {
    ...(sections[0].includes("$") && { prefix: "$" }),
    ...(sections[0].includes("%") && { pct: true as const }),
    ...(sections[1]?.includes("(") && { paren: true as const }),
    ...(sections[2]?.trim() === "-" && { zero_dash: true as const }),
  };
  return Object.keys(f).length ? f : undefined;
}

export interface PreviewTab {
  title: string;
  sheetId: number;
  hidden?: boolean | null;
}

/**
 * Chart data costs three extra Sheets reads per refresh, and the preview refreshes often while Claude works.
 * Reuse it for a few seconds when the charts themselves haven't changed (their data catches up shortly after).
 */
const CHART_DATA_TTL_MS = 20_000;
const chartCache = new Map<string, { at: number; key: string; data: PreviewChart[] }>();
async function cachedChartData(...args: Parameters<typeof chartData>) {
  const [, id, charts] = args;
  const key = JSON.stringify(charts.map((c) => [c.chart.chartId, c.chart.spec, c.left, c.top]));
  const hit = chartCache.get(id);
  if (hit && hit.key === key && Date.now() - hit.at < CHART_DATA_TTL_MS) return hit.data;
  const data = await chartData(...args);
  chartCache.set(id, { at: Date.now(), key, data });
  return data;
}

async function chartData(
  api: sheets_v4.Sheets,
  id: string,
  charts: { chart: sheets_v4.Schema$EmbeddedChart; left: number; top: number }[],
  theme: Map<string, string>,
  themeFont: string | undefined,
  tabs: PreviewTab[] | undefined,
) {
  const known = tabs ?? ((await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(sheetId,title)" })).data.sheets ?? []).map((s) => ({ title: s.properties!.title!, sheetId: s.properties!.sheetId! }));
  const titles = new Map(known.map((t) => [t.sheetId, t.title]));
  const a1 = (g: sheets_v4.Schema$GridRange) =>
    toA1(titles.get(g.sheetId ?? 0), g.startRowIndex ?? 0, g.startColumnIndex ?? 0, g.endRowIndex ?? (g.startRowIndex ?? 0) + MAX_POINTS, g.endColumnIndex ?? (g.startColumnIndex ?? 0) + 1);
  const sources = (cr?: sheets_v4.Schema$ChartData | null) => cr?.sourceRange?.sources ?? [];
  const color = (style?: sheets_v4.Schema$ColorStyle | null, plain?: sheets_v4.Schema$Color | null) =>
    (style?.themeColor && theme.get(style.themeColor)) || hex(style?.rgbColor ?? plain);

  // Lay out every range all the charts need, then fetch them together (one call, however many charts).
  const plans = charts.map(({ chart }) => {
    const spec = chart.spec ?? {};
    const basic = spec.basicChart, pie = spec.pieChart;
    const series: sheets_v4.Schema$BasicChartSeries[] = basic ? (basic.series ?? []).slice(0, MAX_SERIES) : pie ? [{ series: pie.series }] : [];
    return { spec, basic, pie, series, domain: basic ? sources(basic.domains?.[0]?.domain) : pie ? sources(pie.domain) : [], seriesSrc: series.map((s) => sources(s.series)) };
  });
  const ranges: string[] = [];
  const add = (g: sheets_v4.Schema$GridRange) => ranges.push(a1(g)) - 1;
  const index = plans.map((p) => ({ domain: p.domain.map(add), series: p.seriesSrc.map((rs) => rs.map(add)) }));
  // The first data cell of each chart's first series tells us the axis number format.
  const formatCells = plans.map((p) => {
    const g = p.seriesSrc[0]?.[0];
    if (!g) return undefined;
    const h = p.basic?.headerCount ?? 0, r = g.startRowIndex ?? 0, c = g.startColumnIndex ?? 0;
    const columnShaped = (g.endRowIndex ?? r + 2) - r > 1;
    return toA1(titles.get(g.sheetId ?? 0), columnShaped ? r + h : r, columnShaped ? c : c + h, (columnShaped ? r + h : r) + 1, (columnShaped ? c : c + h) + 1);
  });
  const wanted = formatCells.filter((x): x is string => !!x);
  // Shown text, raw numbers and number formats all come from one read (each one counts against the quota).
  const all = [...new Set([...ranges, ...wanted])];
  const res = all.length
    ? await api.spreadsheets.get({
        spreadsheetId: id,
        ranges: all,
        includeGridData: true,
        fields: "sheets(properties/title,data/rowData/values(formattedValue,effectiveValue/numberValue,effectiveFormat/numberFormat))",
      })
    : undefined;
  // Grid data comes back under each tab (in tab order), in request order within the tab.
  const grids = new Map<string, sheets_v4.Schema$CellData[][]>();
  {
    const bySheet = new Map<string, string[]>();
    for (const r of all) {
      const sheet = parseA1(r).sheet ?? "";
      bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), r]);
    }
    for (const s of res?.data.sheets ?? []) {
      const group = bySheet.get(s.properties?.title ?? "") ?? [];
      (s.data ?? []).forEach((d, j) => group[j] && grids.set(group[j], (d.rowData ?? []).map((row) => row.values ?? [])));
    }
  }
  // The cells of one chart source range in order, whether it's a row or a column.
  const cellsOf = (r: string) => {
    const rows = grids.get(r) ?? [];
    return rows.length === 1 ? rows[0] : rows.map((row) => row[0] ?? {});
  };
  const formats = new Map(wanted.map((w) => [w, grids.get(w)?.[0]?.[0]?.effectiveFormat?.numberFormat ?? undefined]));
  const palette = ["ACCENT1", "ACCENT2", "ACCENT3", "ACCENT4", "ACCENT5", "ACCENT6"].map((k) => theme.get(k)).filter((x): x is string => !!x);

  return plans.map((p, i): PreviewChart => {
    const { chart, left, top } = charts[i];
    const headers = p.basic?.headerCount ?? 0;
    const text = (k: number) => cellsOf(ranges[k]).map((x) => x.formattedValue ?? "");
    const labels = index[i].domain.flatMap(text).slice(headers);
    const series = index[i].series.map((ks, si) => {
      const name = headers > 0 && ks.length ? text(ks[0])[0] || undefined : undefined;
      const values = ks.flatMap((k) => cellsOf(ranges[k]).map((x) => x.effectiveValue?.numberValue ?? null).slice(headers));
      const c = color(p.series[si]?.colorStyle, p.series[si]?.color);
      return { ...(name && { name }), values, ...(p.series[si]?.type && { type: p.series[si].type! }), ...(c && { color: c }) };
    });
    const n = Math.min(MAX_POINTS, Math.max(labels.length, ...series.map((s) => s.values.length), 0));
    const nf = formatCells[i] ? formats.get(formatCells[i]!) : undefined;
    const vf = valueFormat(nf?.pattern, nf?.type);
    const pos = chart.position!.overlayPosition!;
    const tf = p.spec.titleTextFormat;
    const titleColor = color(tf?.foregroundColorStyle, tf?.foregroundColor);
    const bg = color(p.spec.backgroundColorStyle, p.spec.backgroundColor);
    const legend = p.basic?.legendPosition ?? p.pie?.legendPosition;
    const font = p.spec.fontName ?? themeFont;
    return {
      id: chart.chartId ?? 0,
      ...(p.spec.title && { title: p.spec.title }),
      type: p.pie ? "PIE" : p.basic?.chartType ?? "OTHER",
      ...(p.basic?.stackedType && p.basic.stackedType !== "NOT_STACKED" && { stacked: true }),
      row: pos.anchorCell!.rowIndex ?? 0,
      col: pos.anchorCell!.columnIndex ?? 0,
      left,
      top,
      width: pos.widthPixels ?? 600,
      height: pos.heightPixels ?? 371,
      labels: labels.slice(0, n),
      series: series.map((s) => ({ ...s, values: s.values.slice(0, n) })),
      ...(p.pie?.pieHole && { pie_hole: p.pie.pieHole }),
      ...(legend && { legend }),
      ...(font && { font }),
      ...(tf?.fontSize && { title_size: tf.fontSize }),
      ...(tf?.bold && { title_bold: true }),
      ...(titleColor && { title_color: titleColor }),
      ...(bg && bg !== "#ffffff" && { bg }),
      ...(palette.length && { palette }),
      ...(vf && { value_format: vf }),
    };
  });
}

export async function buildPreview(
  api: sheets_v4.Sheets,
  id: string,
  sheet: { title: string; sheetId: number },
  win: Rect,
  opts: { highlight?: Rect; keep?: Rect; truncated?: boolean; tabs?: PreviewTab[] } = {},
): Promise<Preview> {
  const { r0, c0, r1, c1 } = win;
  // Rows just above the view, for their heights: a chart anchored up there can hang down into the view.
  const lead = Math.min(r0, LEAD_ROWS);
  const res = await api.spreadsheets.get({
    spreadsheetId: id,
    // Sheets only returns charts anchored inside the requested ranges, so the lead-in spans the view's columns.
    ranges: [toA1(sheet.title, r0, c0, r1, c1), ...(lead ? [toA1(sheet.title, r0 - lead, c0, r0, c1)] : [])],
    includeGridData: true,
    fields:
      "properties(title,defaultFormat/textFormat/fontSize,spreadsheetTheme),sheets(properties(gridProperties(hideGridlines,frozenRowCount,frozenColumnCount)),merges,basicFilter/range," +
      "charts(chartId,spec(title,fontName,titleTextFormat(fontSize,bold,foregroundColor,foregroundColorStyle),backgroundColor,backgroundColorStyle," +
      "basicChart(chartType,stackedType,headerCount,legendPosition,domains/domain/sourceRange/sources,series(series/sourceRange/sources,type,color,colorStyle))," +
      "pieChart(legendPosition,domain/sourceRange/sources,series/sourceRange/sources,pieHole)),position/overlayPosition)," +
      "data(rowMetadata/pixelSize,columnMetadata/pixelSize,rowData/values(" +
      "formattedValue,userEnteredValue/formulaValue,effectiveValue/numberValue,dataValidation/condition/type," +
      "effectiveFormat(backgroundColor,backgroundColorStyle,horizontalAlignment,verticalAlignment,wrapStrategy,borders," +
      "textFormat(bold,italic,strikethrough,underline,fontSize,fontFamily,foregroundColor,foregroundColorStyle)))))",
  });
  const s = res.data.sheets?.[0];
  const data = s?.data?.[0];
  const rowData = data?.rowData ?? [];
  const rowPx = (r: number) => data?.rowMetadata?.[r]?.pixelSize ?? 21;
  const colPx = (c: number) => data?.columnMetadata?.[c]?.pixelSize ?? 100;
  const leadPx = (rowsAbove: number) => {
    let px = 0;
    for (let k = 0; k < rowsAbove; k++) px += s?.data?.[1]?.rowMetadata?.[lead - 1 - k]?.pixelSize ?? 21;
    return px;
  };
  const theme = new Map((res.data.properties?.spreadsheetTheme?.themeColors ?? []).map((t) => [t.colorType ?? "", hex(t.color?.rgbColor) ?? ""]));

  // Charts that show up in the view: anchored inside it, or anchored a little above and hanging into it.
  const placed: { chart: sheets_v4.Schema$EmbeddedChart; left: number; top: number; rect: Rect }[] = [];
  for (const chart of s?.charts ?? []) {
    const p = chart.position?.overlayPosition;
    const a = p?.anchorCell;
    if (!p || !a || (a.sheetId ?? sheet.sheetId) !== sheet.sheetId) continue;
    const ar = a.rowIndex ?? 0, ac = a.columnIndex ?? 0, h = p.heightPixels ?? 371, w = p.widthPixels ?? 600;
    if (ar >= r1 || ac < c0 || ac >= c1 || ar < r0 - lead) continue;
    let top = p.offsetYPixels ?? 0, left = p.offsetXPixels ?? 0;
    if (ar >= r0) for (let r = r0; r < ar; r++) top += rowPx(r - r0);
    else top -= leadPx(r0 - ar);
    if (top + h <= 0) continue;
    for (let c = c0; c < ac; c++) left += colPx(c - c0);
    let r = 0, y = top + h;
    while (y > 0 && r < r1 - r0) y -= rowPx(r++);
    let c = 0, x = left + w;
    while (x > 0 && c < c1 - c0) x -= colPx(c++);
    placed.push({ chart, left, top, rect: { r0: Math.max(ar, r0), c0: ac, r1: r0 + r, c1: c0 + c } });
  }

  // Drop trailing empty rows and columns, but never cut into the highlight, kept cells or charts.
  const used = (row?: sheets_v4.Schema$RowData) =>
    (row?.values ?? []).reduce((n, v, i) => {
      const bg = hex(v.effectiveFormat?.backgroundColorStyle?.rgbColor ?? v.effectiveFormat?.backgroundColor);
      return v.formattedValue || v.userEnteredValue?.formulaValue || (bg && bg !== "#ffffff") ? i + 1 : n;
    }, 0);
  const lastRow = rowData.reduce((n, row, i) => (used(row) ? i + 1 : n), 0);
  const lastCol = Math.max(0, ...rowData.map(used));
  // Charts are always kept in view. Edited areas are too, but only as far as the data goes plus a little
  // room: clearing or formatting A1:AZ400 on a small table shouldn't fill the preview with empty cells.
  const chartArea = union(placed.map((p) => p.rect));
  const edited = union([opts.highlight, opts.keep].filter((x): x is Rect => !!x));
  const mustRows = Math.max(chartArea ? Math.min(chartArea.r1, r1) - r0 : 0, edited ? Math.min(edited.r1 - r0, r1 - r0, lastRow + 2) : 0);
  const mustCols = Math.max(chartArea ? Math.min(chartArea.c1, c1) - c0 : 0, edited ? Math.min(edited.c1 - c0, c1 - c0, lastCol + 2) : 0);
  // An empty or tiny tab still shows a small grid, so the preview doesn't look broken.
  const MIN_ROWS = Math.min(12, r1 - r0), MIN_COLS = Math.min(8, c1 - c0);
  const widthOf = (rowCount: number) => Math.max(MIN_COLS, Math.min(c1 - c0, Math.max(...rowData.slice(0, rowCount).map(used), mustCols) + 1));
  const fullHeight = Math.max(MIN_ROWS, Math.min(r1 - r0, Math.max(lastRow, mustRows) + 1));
  // Keep the result a size the host will pass to the widget; then only as wide as the rows that are kept.
  let height = Math.min(fullHeight, Math.max(mustRows + 1, 20, Math.floor(MAX_CELLS / widthOf(fullHeight))));
  const width = widthOf(height);

  let rows: CompactCell[][] = [];
  for (let r = 0; r < height; r++) rows.push(Array.from({ length: width }, (_, c) => compact(toCell(rowData[r]?.values?.[c]))));
  // Keep the cell JSON under budget: drop formulas first, then rows from the bottom (never the ones that must show).
  const sizes = rows.map((row) => JSON.stringify(row).length);
  let total = sizes.reduce((a, b) => a + b, 0);
  let formulasOmitted = false;
  if (total > MAX_CELL_CHARS && rows.some((row) => row.some((c) => typeof c !== "string" && c.f))) {
    formulasOmitted = true;
    rows = rows.map((row) => row.map((c) => (typeof c === "string" || !c.f ? c : compact((({ f, ...rest }) => rest)(c)))));
    rows.forEach((row, r) => (sizes[r] = JSON.stringify(row).length));
    total = sizes.reduce((a, b) => a + b, 0);
  }
  const minHeight = Math.max(mustRows + 1, 8);
  while (total > MAX_CELL_CHARS && height > minHeight) total -= sizes[--height];
  rows.length = height;

  const merges = (s?.merges ?? [])
    .map((m) => ({ r0: m.startRowIndex ?? 0, c0: m.startColumnIndex ?? 0, r1: m.endRowIndex ?? 0, c1: m.endColumnIndex ?? 0 }))
    .filter((m) => m.r0 >= r0 && m.c0 >= c0 && m.r0 < r0 + height && m.c0 < c0 + width)
    .map((m) => ({ ...m, r1: Math.min(m.r1, r0 + height), c1: Math.min(m.c1, c0 + width) }));
  const shown = placed.filter((p) => p.rect.r0 < r0 + height);
  const charts = shown.length ? await cachedChartData(api, id, shown, theme, res.data.properties?.spreadsheetTheme?.primaryFontFamily ?? undefined, opts.tabs) : [];

  const h = opts.highlight;
  const highlight = h && { ...h, a1: toA1(undefined, h.r0, h.c0, h.r1, h.c1) };
  const focus = highlight?.a1 ?? toA1(undefined, r0, c0, r0 + height, c0 + width);
  const grid = s?.properties?.gridProperties;
  // A filter puts its buttons on the header row: send that row's span when it's in view.
  const fr = s?.basicFilter?.range;
  const filter = fr && (fr.startRowIndex ?? 0) >= r0 && (fr.startRowIndex ?? 0) < r0 + height
    ? { r: fr.startRowIndex ?? 0, c0: Math.max(fr.startColumnIndex ?? 0, c0), c1: Math.min(fr.endColumnIndex ?? c0 + width, c0 + width) }
    : undefined;
  return {
    spreadsheet_id: id,
    title: res.data.properties?.title ?? "",
    tab: sheet.title,
    url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${sheet.sheetId}&range=${focus}`,
    window: toA1(sheet.title, r0, c0, r1, c1),
    start_row: r0,
    start_col: c0,
    col_widths: Array.from({ length: width }, (_, c) => colPx(c)),
    row_heights: Array.from({ length: height }, (_, r) => rowPx(r)),
    rows,
    ...(merges.length && { merges }),
    ...(filter && filter.c1 > filter.c0 && { filter }),
    ...(charts.length && { charts }),
    ...(grid?.hideGridlines && { hide_gridlines: true as const }),
    ...(grid?.frozenRowCount && { frozen_rows: grid.frozenRowCount }),
    ...(grid?.frozenColumnCount && { frozen_cols: grid.frozenColumnCount }),
    ...(opts.tabs && { tabs: opts.tabs.map((t) => ({ title: t.title, ...(t.hidden && { hidden: true as const }) })) }),
    ...(formulasOmitted && { formulas_omitted: true as const }),
    ...(res.data.properties?.defaultFormat?.textFormat?.fontSize && { base_font: res.data.properties.defaultFormat.textFormat.fontSize }),
    ...(highlight && { highlight }),
    ...((opts.truncated || height < fullHeight) && { truncated: true as const }),
  };
}

/** A short line for the model, so it knows what the user is looking at without the grid being repeated. */
export function previewSummary(p: Preview, replayed: number) {
  const shown = toA1(p.tab, p.start_row, p.start_col, p.start_row + p.rows.length, p.start_col + p.col_widths.length);
  return (
    `The user now sees a live view of ${shown}` +
    (replayed ? `, caught up on your ${replayed} earlier step${replayed === 1 ? "" : "s"}` : p.highlight ? `, with ${p.highlight.a1} outlined` : "") +
    `. It follows each read and edit you make in this spreadsheet from now on and folds away by itself when you're done, so don't call show_range again for this task, and don't repeat its contents.` +
    (p.truncated ? ` Only ${MAX_ROWS} rows and ${MAX_COLS} columns are shown.` : "")
  );
}
