// A stand-in MCP Apps host for the "Recently worked on" widget. It serves the built widget in an iframe,
// answers its ui/initialize, hands it a made-up list of spreadsheets, handles pin/remove, and logs the
// message the widget would send to Claude.
// Usage: npm run build && node scripts/recent-harness.mjs   (then open http://localhost:4179; ?empty for no sheets)
import { createServer } from "node:http";
import { RECENT_HTML } from "../dist/recent-html.js";

const PORT = Number(process.env.PORT ?? 4179);
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const SAMPLE = [
  ["Q3 Budget", "alex@acme.com", 0, true],
  ["Site Balances Summary V3", "alex@acme.com", 0],
  ["Compass Model V1", "alex@partners.co", 1],
  ["Mining Stats (Daily)", "alex@acme.com", 2],
  ["Central Forecast 2026 2027", "alex@acme.com", 4],
  ["P&L V17", "alex@partners.co", 9],
  ["Hiring plan 2027", "alex@acme.com", 16],
  ["Marketing budget", "alex@acme.com", 40],
  ["Old pricing experiments", "alex@partners.co", 120],
].map(([title, account, d, pinned], i) => ({ id: "sheet" + i, title, account, url: `https://docs.google.com/spreadsheets/d/sheet${i}/edit`, last_used: day(d), ...(pinned && { pinned: true }) }));

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Recent sheets harness</title>
<style>
  body { margin: 0; padding: 20px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; background: #f6f5f2; color: #222; }
  body.dark { background: #2b2a28; color: #eee; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c9c6bd; background: #fff; cursor: pointer; margin-bottom: 12px; }
  iframe { display: block; width: 720px; max-width: 100%; height: 200px; border: 0; }
  #log { margin-top: 14px; font: 11.5px/1.5 ui-monospace, Menlo, monospace; color: #666; white-space: pre-wrap; }
</style></head><body>
<button id="theme">Toggle dark</button>
<iframe id="w" src="/widget"></iframe>
<div id="log"></div>
<script>
let list = ${JSON.stringify(SAMPLE)};
if (location.search.includes("empty")) list = [];
const frame = document.getElementById("w"), log = document.getElementById("log");
const say = (s) => { log.textContent = s + "\\n" + log.textContent; };
const post = (m) => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
let dark = false;
document.getElementById("theme").onclick = () => { dark = !dark; document.body.classList.toggle("dark", dark); post({ method: "ui/notifications/host-context-changed", params: { theme: dark ? "dark" : "light" } }); };
window.addEventListener("message", (e) => {
  const m = e.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.method === "ui/initialize") {
    post({ id: m.id, result: { hostCapabilities: { serverTools: {} }, hostContext: { theme: "light" } } });
  } else if (m.method === "ui/notifications/initialized") {
    post({ method: "ui/notifications/tool-result", params: { structuredContent: { spreadsheets: list } } });
  } else if (m.method === "ui/notifications/size-changed") {
    frame.style.height = m.params.height + "px";
  } else if (m.method === "tools/call") {
    const { action, spreadsheet_id } = m.params.arguments;
    say("tools/call " + action + " " + spreadsheet_id);
    if (action === "remove") list = list.filter((x) => x.id !== spreadsheet_id);
    else list.find((x) => x.id === spreadsheet_id).pinned = action === "pin" || undefined;
    list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.last_used.localeCompare(a.last_used));
    post({ id: m.id, result: { structuredContent: { spreadsheets: list } } });
  } else if (m.method === "ui/message") {
    say("ui/message:\\n" + m.params.content[0].text);
    window.lastMessage = m.params.content[0].text;
    post({ id: m.id, result: {} });
  } else if (m.method === "ui/open-link") {
    say("open " + m.params.url); post({ id: m.id, result: {} });
  }
});
</script></body></html>`;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(req.url.startsWith("/widget") ? RECENT_HTML : PAGE);
}).listen(PORT, () => console.log(`Recent sheets harness: http://localhost:${PORT}`));
