// Records the site's walkthrough demo (site/walkthrough-demo.js) as the README animation, docs/walkthrough.webp.
// Serves site/ itself, drives headless Chrome over the DevTools protocol, screenshots the demo through one run, then
// encodes the frames with img2webp (each frame lasts as long as it was on screen, long holds trimmed).
// Usage: npm run build:site && node scripts/record-walkthrough.mjs   (needs Google Chrome and img2webp: brew install webp)
//        KEEP_FRAMES=<existing folder> also saves every captured frame as PNG there, to check the recording.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = `${root}docs/walkthrough.webp`;
const [PORT, DEBUG] = [4191, 9339];
const WIDTH = 860; // CSS px: wide enough for the sheet and the points side by side
const MAX_HOLD = 2600; // ms: a frame that doesn't change plays at most this long
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), "walkthrough-rec-"));
const server = spawn(process.execPath, [`${root}scripts/serve-site.mjs`], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${tmp}/profile`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const done = () => { browser.kill(); server.kill(); rmSync(tmp, { recursive: true, force: true }); };
process.on("exit", done);

// ---------- a minimal DevTools protocol client ----------
let target;
for (let i = 0; !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find((t) => t.type === "page"); } catch { if (i > 50) throw new Error("Chrome didn't start"); await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting.set(id, (m) => (m.error ? reject(new Error(method + ": " + m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

// ---------- the page: only the demo, light theme, transparent around it ----------
await cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
await cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
await cdp("Page.enable");
await cdp("Page.navigate", { url: `http://localhost:${PORT}/` });
for (let i = 0; !(await js("document.readyState === 'complete' && !!window.fetch")); i++) { if (i > 100) throw new Error("page didn't load"); await sleep(100); }
await js(`(() => {
  const s = document.createElement("style");
  s.textContent = "html, body { background: transparent !important; } body > :not(main), main > :not(#walkthrough), main > .hero, canvas, #walkthrough .section-head, .wt-beats, .wt-note { display: none !important; } #walkthrough { padding: 24px 0 !important; }";
  document.head.append(s);
  scrollTo(0, 0);
})()`);
const box = await js(`(() => { const r = document.getElementById("wtDemo").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const pad = 14; // room for the window's shadow
// The window grows as the widget sizes itself, so measure the clip once it has.
await js(`new Promise((ok) => { const f = document.querySelector("#wtDemo iframe"); const t = setInterval(() => { if (parseFloat(f.style.height) > 300) { clearInterval(t); ok(); } }, 100); })`);
const h = await js(`document.getElementById("wtDemo").getBoundingClientRect().height`);
const clip = { x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: Math.max(box.h, h) + pad * 2, scale: 1 };

// ---------- record one run: until the demo starts fading out for the next ----------
const frames = [];
const t0 = Date.now();
while (!(await js(`document.getElementById("wtDemo").classList.contains("out")`))) {
  if (Date.now() - t0 > 120_000) throw new Error("the demo didn't finish within 2 minutes");
  const at = Date.now();
  const { data } = await cdp("Page.captureScreenshot", { format: "png", clip });
  frames.push({ at, png: Buffer.from(data, "base64") });
}
const end = Date.now();
console.log(`Captured ${frames.length} frames over ${((end - t0) / 1000).toFixed(1)}s`);

// ---------- encode: merge identical frames, trim long holds ----------
if (process.env.KEEP_FRAMES) frames.forEach((f, i) => writeFileSync(join(process.env.KEEP_FRAMES, `frame${String(i).padStart(4, "0")}.png`), f.png));
const kept = [];
frames.forEach((f, i) => {
  const ms = (frames[i + 1] ? frames[i + 1].at : end) - f.at;
  const hash = createHash("sha1").update(f.png).digest("hex");
  const last = kept[kept.length - 1];
  if (last && last.hash === hash) last.ms += ms;
  else kept.push({ hash, png: f.png, ms });
});
const args = ["-loop", "0", "-lossy", "-q", "72", "-m", "6", "-mixed"];
kept.forEach((f, i) => {
  const file = `${tmp}/f${String(i).padStart(4, "0")}.png`;
  writeFileSync(file, f.png);
  args.push("-d", String(Math.max(40, Math.min(MAX_HOLD, Math.round(f.ms)))), file);
});
execFileSync("img2webp", [...args, "-o", out], { stdio: "inherit" });
const total = kept.reduce((s, f) => s + Math.max(40, Math.min(MAX_HOLD, Math.round(f.ms))), 0);
console.log(`Wrote ${out}: ${kept.length} frames, ${(total / 1000).toFixed(1)}s, ${(readFileSync(out).length / 1024).toFixed(0)} KB, ${clip.width * 2}x${clip.height * 2}`);
ws.close();
process.exit(0);
