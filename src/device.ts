// Which device is the user on? Messages carry no device marker, but Sheets MCP runs on the
// user's computer, so it can ask the OS how long since the last keyboard or mouse input. A tool
// call that arrives while the computer has sat idle came from another device (phone or claude.ai
// through Remote Control, or a synced chat), where the live sheet view can't be drawn.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Idle this long or more and the user is taken to be away from the computer (typing a message here leaves idle time near zero). */
export const AWAY_AFTER_S = 60;
/** The OS is asked again at most this often. */
const CACHE_MS = 5_000;

let cached: { at: number; idle: number | undefined } | undefined;

/** Seconds since the last keyboard or mouse input on this computer, or undefined when the OS can't say. */
export async function idleSeconds(): Promise<number | undefined> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.idle;
  let idle: number | undefined;
  try {
    idle = await (process.platform === "darwin" ? macIdle() : process.platform === "win32" ? windowsIdle() : linuxIdle());
  } catch {
    idle = undefined;
  }
  cached = { at: Date.now(), idle };
  return idle;
}

async function macIdle() {
  // IOKit keeps the time since the last HID event, in nanoseconds.
  const { stdout } = await run("ioreg", ["-c", "IOHIDSystem", "-d", "4"], { timeout: 3_000 });
  const m = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return m ? Math.floor(Number(m[1]) / 1e9) : undefined;
}

async function windowsIdle() {
  // GetLastInputInfo gives the tick count of the last input; compare with the current tick count.
  const script =
    "Add-Type @'\nusing System;using System.Runtime.InteropServices;public class I{[StructLayout(LayoutKind.Sequential)]public struct L{public uint s;public uint t;}[DllImport(\"user32.dll\")]public static extern bool GetLastInputInfo(ref L l);public static uint Idle(){L l=new L();l.s=(uint)Marshal.SizeOf(l);GetLastInputInfo(ref l);return ((uint)Environment.TickCount-l.t)/1000;}}\n'@\n[I]::Idle()";
  const { stdout } = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8_000 });
  const n = Number(stdout.trim());
  return Number.isFinite(n) ? n : undefined;
}

async function linuxIdle() {
  // X11 only, and only when xprintidle is installed; Wayland has no portable answer.
  const { stdout } = await run("xprintidle", [], { timeout: 3_000 });
  const n = Number(stdout.trim());
  return Number.isFinite(n) ? Math.floor(n / 1000) : undefined;
}

/** "58 min" or "2 h 05 min". */
export function describeIdle(s: number) {
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min` : `${Math.floor(s / 60)} min`;
}

/**
 * The line added to tool results while the user is away: Claude then skips the live view and shows
 * its work as Markdown, which every Claude app can draw. Undefined while they're at the computer.
 */
export async function deviceHint(): Promise<string | undefined> {
  const idle = await idleSeconds();
  if (idle === undefined || idle < AWAY_AFTER_S) return undefined;
  return (
    `Device hint: this computer has had no keyboard or mouse input for ${describeIdle(idle)}, so the user is on another device (phone or claude.ai) and can't see the live sheet view. ` +
    `Don't call show_range. Phone apps condense the text you write between tool calls, so put it all in your final reply of this turn, short enough to read on a phone: ` +
    `1) What you did, in one to three plain bullets naming the tab and area (no cell-by-cell list). ` +
    `2) What it changed: only the few results someone would ask about, as before → after with the new value in bold (totals, balances, a formula that now works), plus a ▁▂▃▄▅▆▇█ sparkline when a series has a trend worth seeing. ` +
    `3) One link that opens the main area: the spreadsheet URL with #gid=<sheetId>&range=<A1>. ` +
    `For a read, just answer in a sentence or a small table, with the link. List individual cells only when the user asks or when a few cells are the whole point.`
  );
}
