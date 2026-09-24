/** A1-notation helpers. All indexes are zero-based; end indexes are exclusive; undefined means unbounded. */

export interface ParsedRange {
  sheet?: string;
  startRow?: number;
  endRow?: number;
  startCol?: number;
  endCol?: number;
}

const CELL_RANGE = /^\$?([A-Z]*)\$?(\d*)(?::\$?([A-Z]*)\$?(\d*))?$/i;

export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToCol(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function splitSheet(a1: string): { sheet?: string; cells: string } {
  const quoted = a1.match(/^'((?:[^']|'')+)'(?:!(.*))?$/);
  if (quoted) return { sheet: quoted[1].replace(/''/g, "'"), cells: quoted[2] ?? "" };
  const bang = a1.lastIndexOf("!");
  if (bang >= 0) return { sheet: a1.slice(0, bang), cells: a1.slice(bang + 1) };
  // No "!": either a bare range ("A1:B2", "B7", "C:D") or a bare sheet name ("Sales").
  const isRange = CELL_RANGE.test(a1) && (a1.includes(":") || /^\$?[A-Z]+\$?\d+$/i.test(a1));
  return isRange ? { cells: a1 } : { sheet: a1, cells: "" };
}

export function parseA1(a1: string): ParsedRange {
  const { sheet, cells } = splitSheet(a1.trim());
  if (!cells) return { sheet };
  const m = cells.match(CELL_RANGE);
  if (!m) throw new Error(`Invalid A1 range: ${a1}`);
  const [, c1, r1, c2, r2] = m;
  const hasEnd = cells.includes(":");
  const out: ParsedRange = { sheet };
  if (c1) out.startCol = colToIndex(c1);
  if (r1) out.startRow = Number(r1) - 1;
  if (hasEnd) {
    if (c2) out.endCol = colToIndex(c2) + 1;
    if (r2) out.endRow = Number(r2);
  } else {
    if (c1) out.endCol = out.startCol! + 1;
    if (r1) out.endRow = out.startRow! + 1;
  }
  return out;
}

/** Build a bounded A1 string such as 'My Sheet'!B2:D10. */
export function toA1(sheet: string | undefined, startRow: number, startCol: number, endRow: number, endCol: number): string {
  const cells = `${indexToCol(startCol)}${startRow + 1}:${indexToCol(endCol - 1)}${endRow}`;
  return sheet ? `${quoteSheet(sheet)}!${cells}` : cells;
}

export function spreadsheetIdFrom(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}

export function hexToColor(hex: string) {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(full, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
