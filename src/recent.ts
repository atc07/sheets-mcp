import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./auth.js";

/**
 * Spreadsheets the user has worked on through Sheets MCP, kept in a file on their computer so
 * they can be found again by name ("my budget sheet") without asking Google for Drive access.
 */
export interface RecentSpreadsheet {
  id: string;
  title: string;
  account: string;
  last_used: string;
  uses: number;
}

const RECENT_PATH = join(CONFIG_DIR, "recent.json");
const MAX_RECENT = 200;

function load(): RecentSpreadsheet[] {
  try {
    const list = JSON.parse(readFileSync(RECENT_PATH, "utf8"));
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && typeof x.title === "string") : [];
  } catch {
    return [];
  }
}

function save(list: RecentSpreadsheet[]) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(RECENT_PATH, JSON.stringify(list, null, 2), { mode: 0o600 });
  } catch {
    // Remembering sheets is a convenience; never fail a tool call over it.
  }
}

export function rememberSpreadsheet(id: string, title: string, account: string) {
  if (!title) return;
  const list = load();
  const prior = list.find((x) => x.id === id);
  const entry = { id, title, account, last_used: new Date().toISOString(), uses: (prior?.uses ?? 0) + 1 };
  save([entry, ...list.filter((x) => x.id !== id)].slice(0, MAX_RECENT));
}

export function forgetAccount(account: string) {
  const list = load();
  const kept = list.filter((x) => x.account !== account);
  if (kept.length !== list.length) save(kept);
}

export function forgetSpreadsheet(id: string) {
  const list = load();
  const kept = list.filter((x) => x.id !== id);
  if (kept.length !== list.length) save(kept);
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Remembered spreadsheets matching a name, best first: exact title, then titles containing every word. Most recent first within each. */
export function findSpreadsheets(query?: string): RecentSpreadsheet[] {
  const list = load().sort((a, b) => b.last_used.localeCompare(a.last_used));
  const q = query?.trim().toLowerCase();
  if (!q) return list;
  const exact = list.filter((x) => x.title.trim().toLowerCase() === q);
  if (exact.length) return exact;
  // Ignore filler like "my … sheet" when matching words.
  const wanted = words(q).filter((w) => !["my", "the", "a", "our", "sheet", "sheets", "spreadsheet", "spreadsheets", "google", "file", "doc"].includes(w));
  if (!wanted.length) return [];
  return list.filter((x) => {
    const title = words(x.title);
    return wanted.every((w) => title.some((t) => t.startsWith(w)));
  });
}

/** True for a spreadsheet link or ID; anything else is treated as a name to look up. */
export function looksLikeSpreadsheetRef(input: string) {
  const s = input.trim();
  return s.includes("/spreadsheets/d/") || /^[A-Za-z0-9_-]{25,}$/.test(s);
}

export const spreadsheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
