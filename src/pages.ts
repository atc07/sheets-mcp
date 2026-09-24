// Pages shown in the browser at the end of Google sign-in (served from the local loopback server).
// Everything is inline except the app icons, which load from sheetsmcp.io.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#0f1712"/><path d="M6 3v18M12 3v18M18 3v18M3 6h18M3 12h18M3 18h18" stroke="#fff" stroke-opacity=".13" stroke-width=".8"/><rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="#34c26a" fill-opacity=".16" stroke="#34c26a" stroke-width="2"/><rect x="15.1" y="15.1" width="4.8" height="4.8" rx="1.1" fill="#34c26a" stroke="#0f1712" stroke-width="1.3"/></svg>`;

const APPS = [
  { name: "YourTalks", tag: "iPhone", url: "https://yourtalks.ai/", icon: "https://sheetsmcp.io/apps/yourtalks-icon.png", blurb: "Turn any topic into a two-host AI podcast in minutes." },
  { name: "Rewrite", tag: "Mac", url: "https://rewriteapp.io/", icon: "https://sheetsmcp.io/apps/rewrite-icon.png", blurb: "Rewrite, respond and draft in any app, privately." },
];

const STYLE = `
:root { --bg:#fafaf8; --surface:#fff; --surface-2:#f4f4f1; --fg:#171716; --muted:#6b6b67; --faint:#a3a39e; --accent:#188038; --accent-soft:#e6f4ea; --bad:#d93025; --bad-soft:#fce8e6;
  --ring:0 0 0 1px rgba(0,0,0,.07); --shadow:0 0 0 1px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04),0 16px 40px -16px rgba(0,0,0,.16); --ease-out:cubic-bezier(0.23,1,0.32,1); }
@media (prefers-color-scheme: dark) { :root { --bg:#0e0e0d; --surface:#161615; --surface-2:#1d1d1b; --fg:#ededeb; --muted:#9d9d98; --faint:#62625e; --accent:#5bb974; --accent-soft:rgba(91,185,116,.14); --bad:#f28b82; --bad-soft:rgba(242,139,130,.14);
  --ring:0 0 0 1px rgba(255,255,255,.08); --shadow:0 0 0 1px rgba(255,255,255,.08),0 16px 40px -16px rgba(0,0,0,.6); } }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:40px 16px; background:var(--bg); color:var(--fg);
  font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
main { width:100%; max-width:460px; }
.brand { display:flex; align-items:center; justify-content:center; gap:9px; font-weight:600; font-size:15px; letter-spacing:-.01em; margin-bottom:22px; }
.brand svg { width:22px; height:22px; }
.card { background:var(--surface); border-radius:20px; box-shadow:var(--shadow); padding:36px 32px 30px; text-align:center;
  animation:enter 500ms var(--ease-out) both; }
.badge { width:64px; height:64px; margin:0 auto 20px; border-radius:50%; display:grid; place-items:center; background:var(--accent-soft); color:var(--accent); }
.badge.bad { background:var(--bad-soft); color:var(--bad); }
.badge svg { width:30px; height:30px; }
.badge .draw { stroke-dasharray:24; stroke-dashoffset:24; animation:draw 450ms var(--ease-out) 220ms forwards; }
h1 { font-size:26px; line-height:1.15; letter-spacing:-.03em; font-weight:650; margin:0 0 10px; }
.lede { color:var(--muted); margin:0; }
.lede b { color:var(--fg); font-weight:600; }
.acct { display:inline-flex; align-items:center; gap:8px; max-width:100%; margin-top:12px; padding:6px 14px 6px 8px; border-radius:999px; background:var(--surface-2); box-shadow:var(--ring); font-size:14.5px; font-weight:600; overflow-wrap:anywhere; }
.acct::before { content:""; flex:none; width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
.next { margin-top:24px; text-align:left; background:var(--surface-2); border-radius:14px; padding:16px 18px; box-shadow:var(--ring); }
.next h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px; }
.next p { margin:0; font-size:15px; }
.chips { list-style:none; margin:12px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px; }
.chips li { font-size:13.5px; background:var(--surface); box-shadow:var(--ring); border-radius:999px; padding:5px 12px; }
.close { margin:18px 0 0; font-size:13.5px; color:var(--faint); }
.more { margin-top:28px; animation:enter 500ms var(--ease-out) 120ms both; }
.more h2 { font-size:13px; font-weight:600; color:var(--muted); text-align:center; margin:0 0 12px; }
.apps { display:grid; gap:10px; }
.app { display:grid; grid-template-columns:40px 1fr auto; gap:12px; align-items:center; padding:12px 14px; border-radius:14px; background:var(--surface);
  box-shadow:var(--ring); color:inherit; text-decoration:none; transition:box-shadow 150ms ease, transform 160ms var(--ease-out); }
.app:active { transform:scale(.98); }
.app img { width:40px; height:40px; border-radius:10px; box-shadow:var(--ring); }
.app b { display:block; font-size:15px; font-weight:600; }
.app span { display:block; font-size:13px; color:var(--muted); line-height:1.4; }
.app i { font-style:normal; font-size:11.5px; font-weight:500; color:var(--muted); background:var(--surface-2); box-shadow:var(--ring); border-radius:999px; padding:2px 8px; }
@media (hover:hover) and (pointer:fine) { .app:hover { box-shadow:var(--shadow); } }
footer { margin-top:24px; text-align:center; font-size:13px; color:var(--faint); }
footer a { color:inherit; }
@keyframes enter { from { opacity:0; transform:translateY(8px) scale(.98); } }
@keyframes draw { to { stroke-dashoffset:0; } }
@media (prefers-reduced-motion: reduce) {
  .card, .more { animation:fade 300ms ease both; }
  .badge .draw { animation:none; stroke-dashoffset:0; }
  .app:active { transform:none; }
}
@keyframes fade { from { opacity:0; } }
`;

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="draw" d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>`;

function layout(title: string, body: string) {
  const apps = APPS.map(
    (a) =>
      `<a class="app" href="${a.url}" target="_blank" rel="noopener"><img src="${a.icon}" alt="" width="40" height="40"><div><b>${a.name}</b><span>${a.blurb}</span></div><i>${a.tag}</i></a>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Sheets MCP</title><style>${STYLE}</style></head><body><main>
<div class="brand">${LOGO}Sheets MCP</div>
${body}
<section class="more"><h2>More from the makers of Sheets MCP</h2><div class="apps">${apps}</div></section>
<footer><a href="https://sheetsmcp.io" target="_blank" rel="noopener">sheetsmcp.io</a> · <a href="https://sheetsmcp.io/privacy" target="_blank" rel="noopener">Privacy</a></footer>
</main></body></html>`;
}

export function signedInPage(email: string) {
  return layout(
    "You're signed in",
    `<div class="card">
  <div class="badge">${CHECK}</div>
  <h1>You're signed in</h1>
  <p class="lede">Sheets MCP can now work in your Google Sheets.</p>
  <div class="acct">${esc(email)}</div>
  <div class="next">
    <h2>Next</h2>
    <p>Go back to Claude and say <b>“I'm signed in”</b>. It will pick up where it left off. Or try:</p>
    <ul class="chips"><li>Summarize this sheet: <i>link</i></li><li>Add a totals row</li><li>Chart sales by month</li></ul>
  </div>
  <p class="close">You can close this tab.</p>
</div>`,
  );
}

export function signInFailedPage(message: string) {
  return layout(
    "Sign-in didn't finish",
    `<div class="card">
  <div class="badge bad">${CROSS}</div>
  <h1>Sign-in didn't finish</h1>
  <p class="lede">${esc(message)}</p>
  <div class="next">
    <h2>Try again</h2>
    <p>Close this tab, go back to Claude and ask it to <b>“sign in to Google Sheets”</b>. A fresh sign-in page will open.</p>
  </div>
</div>`,
  );
}
