// Pages shown in the browser at the end of Google sign-in (served from the local loopback server).
// Everything is inline except the app icons and showcase images, which load from sheetsmcp.io.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LOGO = `<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="smbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16271c"/><stop offset="1" stop-color="#0b120d"/></linearGradient>
<radialGradient id="smglow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#34c26a" stop-opacity=".22"/><stop offset="1" stop-color="#34c26a" stop-opacity="0"/></radialGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#smbg)"/><rect width="512" height="512" rx="112" fill="url(#smglow)"/>
<rect x="136" y="136" width="240" height="240" rx="22" fill="#34c26a" fill-opacity=".14"/>
<path d="M256 150V362M150 256H362" stroke="#34c26a" stroke-opacity=".45" stroke-width="10"/>
<rect x="136" y="136" width="240" height="240" rx="22" fill="none" stroke="#3ddc78" stroke-width="30"/>

<path d="M372 286 C381.03 346.2 397.8 362.97 458 372 C397.8 381.03 381.03 397.8 372 458 C362.97 397.8 346.2 381.03 286 372 C346.2 362.97 362.97 346.2 372 286Z" fill="#ffffff" stroke="#0e1810" stroke-width="24" stroke-linejoin="round" paint-order="stroke"/></svg>`;

const SITE = "https://sheetsmcp.io/apps";

// Same looping showcases as the "More from us" section on sheetsmcp.io (site/index.html + site/style.css).
const YT_STEPS = [
  ["1-create", "Type any topic."],
  ["2-generating", "It does the research."],
  ["3-episode", "Two hosts, one episode."],
  ["4-sources", "Every source, cited."],
  ["5-transcript", "Read along as you listen."],
];
const YT_SHOW = `<div class="show show-yt" role="img" aria-label="YourTalks: type a topic, it researches and writes a two-host episode, then plays it with sources and a live transcript">
<div class="yt-copy" aria-hidden="true"><div class="yt-caps">${YT_STEPS.map(([, t], i) => `<span class="yt-cap" style="--i:${i}">${t}</span>`).join("")}</div>
<div class="yt-dots">${YT_STEPS.map((_, i) => `<i style="--i:${i}"></i>`).join("")}</div></div>
<div class="yt-phone" aria-hidden="true"><div class="yt-screen">${YT_STEPS.map(([k], i) => `<img src="${SITE}/yt-${k}.webp" width="440" height="733" alt="" decoding="async" style="--i:${i}">`).join("")}</div></div></div>`;
const rw = (n: string, cls = "") => `<img${cls && ` class="${cls}"`} src="${SITE}/rw-${n}.webp" width="1360" height="714" alt="" decoding="async">`;
const RW_SHOW = `<div class="show show-rw" role="img" aria-label="Rewrite: an angry email draft is rewritten into a calm one and inserted in place, then a reply is drafted to a question in another email">
<div class="rw-scene rw-a" aria-hidden="true">${rw("rewrite-win")}${rw("rewrite-after", "rw-after")}${rw("rewrite-panel", "rw-panel")}</div>
<div class="rw-scene rw-b" aria-hidden="true">${rw("respond-win")}${rw("respond-panel", "rw-panel")}</div></div>`;

const APPS = [
  { name: "YourTalks", tag: "iPhone", url: "https://yourtalks.ai/", icon: `${SITE}/yourtalks-icon.png`, show: YT_SHOW, blurb: "Turn any topic into a two-host AI podcast in minutes." },
  { name: "Rewrite", tag: "Mac", url: "https://rewriteapp.io/", icon: `${SITE}/rewrite-icon.png`, show: RW_SHOW, blurb: "Rewrite, respond and draft in any app, privately." },
];

const STYLE = `
:root { --bg:#fafaf8; --surface:#fff; --surface-2:#f4f4f1; --fg:#171716; --muted:#6b6b67; --faint:#a3a39e; --accent:#188038; --accent-soft:#e6f4ea; --bad:#d93025; --bad-soft:#fce8e6;
  --ring:0 0 0 1px rgba(0,0,0,.07); --shadow:0 0 0 1px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04),0 16px 40px -16px rgba(0,0,0,.16); --ease-out:cubic-bezier(0.23,1,0.32,1); }
@media (prefers-color-scheme: dark) { :root { --bg:#0e0e0d; --surface:#161615; --surface-2:#1d1d1b; --fg:#ededeb; --muted:#9d9d98; --faint:#62625e; --accent:#5bb974; --accent-soft:rgba(91,185,116,.14); --bad:#f28b82; --bad-soft:rgba(242,139,130,.14);
  --ring:0 0 0 1px rgba(255,255,255,.08); --shadow:0 0 0 1px rgba(255,255,255,.08),0 16px 40px -16px rgba(0,0,0,.6); } }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:40px 16px; background:var(--bg); color:var(--fg);
  font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
main { width:100%; max-width:900px; }
/* Wide: the card fills row 2 so it lines up with the app cards; the "More from" heading sits alone in row 1. */
.cols { display:grid; grid-template-columns:minmax(0,460px) minmax(0,400px); grid-template-rows:auto auto; justify-content:center; column-gap:36px; }
.cols > .card { grid-column:1; grid-row:2; display:grid; align-content:center; }
.cols > .more { grid-column:2; grid-row:1 / span 2; display:grid; grid-template-rows:subgrid; }
@media (max-width:900px) {
  main { max-width:460px; }
  .cols { display:block; }
  .cols > .card { display:block; }
  .cols > .more { display:block; margin-top:28px; }
}
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
.acct { justify-self:center; display:inline-flex; align-items:center; gap:8px; max-width:100%; margin-top:12px; padding:6px 14px 6px 8px; border-radius:999px; background:var(--surface-2); box-shadow:var(--ring); font-size:14.5px; font-weight:600; overflow-wrap:anywhere; }
.acct::before { content:""; flex:none; width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
.next { margin-top:24px; text-align:left; background:var(--surface-2); border-radius:14px; padding:16px 18px; box-shadow:var(--ring); }
.next h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px; }
.next p { margin:0; font-size:15px; }
.chips { list-style:none; margin:12px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px; }
.chips li { font-size:13.5px; background:var(--surface); box-shadow:var(--ring); border-radius:999px; padding:5px 12px; }
.close { margin:18px 0 0; font-size:13.5px; color:var(--faint); }
.more { animation:enter 500ms var(--ease-out) 120ms both; }
.more h2 { font-size:13px; font-weight:600; color:var(--muted); margin:0 0 12px; }
@media (max-width:900px) { .more h2 { text-align:center; } }
.apps { display:grid; gap:14px; }
.app { display:block; overflow:hidden; border-radius:14px; background:var(--surface); box-shadow:var(--ring); color:inherit; text-decoration:none;
  transition:box-shadow 150ms ease, transform 160ms var(--ease-out); }
.app:active { transform:scale(.99); }
.app-row { display:grid; grid-template-columns:40px 1fr auto; gap:12px; align-items:center; padding:12px 14px; }
.app-row img { width:40px; height:40px; border-radius:10px; box-shadow:var(--ring); }
.app-row b { display:block; font-size:15px; font-weight:600; }
.app-row span { display:block; font-size:13px; color:var(--muted); line-height:1.4; }
.app-row i { font-style:normal; font-size:11.5px; font-weight:500; color:var(--muted); background:var(--surface-2); box-shadow:var(--ring); border-radius:999px; padding:2px 8px; }
@media (hover:hover) and (pointer:fine) { .app:hover { box-shadow:var(--shadow); } }
/* Showcases: kept in sync with site/style.css. */
.show { position:relative; overflow:hidden; aspect-ratio:40/21; container-type:inline-size; box-shadow:inset 0 -1px 0 rgba(0,0,0,.07); }
.show img { display:block; }
.show-yt { background:radial-gradient(90% 120% at 72% 10%,#3a2a8c 0%,#1a1440 45%,#0a0818 100%); }
.yt-copy { position:absolute; left:7cqw; top:50%; transform:translateY(-50%); width:46cqw; }
.yt-caps { display:grid; }
.yt-cap { grid-area:1/1; font-size:4.6cqw; font-weight:650; line-height:1.15; letter-spacing:-.02em; color:#fff;
  opacity:0; animation:yt-step 15s var(--ease-out) calc(var(--i) * 3s - .45s) infinite backwards; }
.yt-dots { display:flex; gap:1cqw; margin-top:3.2cqw; }
.yt-dots i { position:relative; width:1.4cqw; height:1.4cqw; border-radius:999px; background:rgba(255,255,255,.22); overflow:hidden; }
.yt-dots i::after { content:""; position:absolute; inset:0; background:#a996ff; opacity:0; animation:yt-dot 15s ease calc(var(--i) * 3s - .45s) infinite backwards; }
.yt-phone { position:absolute; right:8cqw; top:6.5cqw; bottom:-3cqw; width:30cqw; padding:1cqw; border-radius:5.4cqw 5.4cqw 0 0; background:#1c1a26;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 0 12cqw rgba(124,92,255,.35); }
.yt-screen { position:relative; height:100%; overflow:hidden; border-radius:4.4cqw 4.4cqw 0 0; background:#000; }
.yt-screen img { position:absolute; left:0; top:0; width:100%; height:auto; opacity:0; animation:yt-step 15s var(--ease-out) calc(var(--i) * 3s - .45s) infinite backwards; }
@keyframes yt-step { 0% { opacity:0; transform:translateY(3%); } 3%, 20% { opacity:1; transform:none; } 23%, 100% { opacity:0; transform:translateY(-1.5%); } }
@keyframes yt-dot { 0% { opacity:0; } 3%, 20% { opacity:1; } 23%, 100% { opacity:0; } }
.show-rw { background:#eceef4; }
.rw-scene, .rw-scene img { position:absolute; inset:0; width:100%; height:100%; }
.rw-a { animation:rw-a 11s ease infinite; }
.rw-b { opacity:0; animation:rw-b 11s ease infinite; }
.rw-panel { transform-origin:66% 68%; }
.rw-a .rw-panel { opacity:0; animation:rw-panel-a 11s var(--ease-out) infinite; }
.rw-a .rw-after { opacity:0; animation:rw-after 11s ease infinite; }
.rw-b .rw-panel { opacity:0; animation:rw-panel-b 11s var(--ease-out) infinite; }
@keyframes rw-a { 0%, 47% { opacity:1; } 51%, 96% { opacity:0; } 100% { opacity:1; } }
@keyframes rw-b { 0%, 47% { opacity:0; } 51%, 96% { opacity:1; } 100% { opacity:0; } }
@keyframes rw-panel-a { 0%, 9% { opacity:0; transform:translateY(2.5%) scale(.96); } 13%, 31% { opacity:1; transform:none; } 34%, 100% { opacity:0; transform:scale(.98); } }
@keyframes rw-after { 0%, 31% { opacity:0; } 35%, 50% { opacity:1; } 52%, 100% { opacity:0; } }
@keyframes rw-panel-b { 0%, 59% { opacity:0; transform:translateY(2.5%) scale(.96); } 63%, 100% { opacity:1; transform:none; } }
footer { margin-top:24px; text-align:center; font-size:13px; color:var(--faint); }
footer a { color:inherit; }
@keyframes enter { from { opacity:0; transform:translateY(8px) scale(.98); } }
@keyframes draw { to { stroke-dashoffset:0; } }
@media (prefers-reduced-motion: reduce) {
  .card, .more { animation:fade 300ms ease both; }
  .badge .draw { animation:none; stroke-dashoffset:0; }
  .app:active { transform:none; }
  .show *, .show *::after { animation:none !important; }
  .yt-cap[style*="--i:0"], .yt-screen img[style*="--i:0"], .yt-dots i[style*="--i:0"]::after, .rw-a .rw-panel { opacity:1; }
}
@keyframes fade { from { opacity:0; } }
`;

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="draw" d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>`;

function layout(title: string, body: string) {
  const apps = APPS.map(
    (a) =>
      `<a class="app" href="${a.url}" target="_blank" rel="noopener">${a.show}<div class="app-row"><img src="${a.icon}" alt="" width="40" height="40"><div><b>${a.name}</b><span>${a.blurb}</span></div><i>${a.tag}</i></div></a>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Sheets MCP</title><style>${STYLE}</style></head><body><main>
<div class="brand">${LOGO}Sheets MCP</div>
<div class="cols">
${body}
<section class="more"><h2>More from the makers of Sheets MCP</h2><div class="apps">${apps}</div></section>
</div>
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
