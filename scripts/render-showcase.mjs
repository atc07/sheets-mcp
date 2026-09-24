// Renders the Rewrite showcase layers (site/apps/rw-*.webp) from Retype's marketing scenes.
// Each scene is shot as separate layers (email window, panel, rewritten window) so the site can animate them.
// Usage: npm run render:showcase   (needs Google Chrome, cwebp, and the Retype repo; RETYPE_DIR overrides ../Retype)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const scenes = resolve(process.env.RETYPE_DIR ?? `${root}../Retype`, "Scripts/scenes");
const out = `${root}site/apps`;
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [W, H] = [680, 357]; // 40:21, rendered at 2×

if (!existsSync(`${scenes}/scene.css`)) {
  console.error(`Retype scenes not found at ${scenes}. Set RETYPE_DIR to the Retype repo.`);
  process.exit(1);
}
if (!existsSync(chrome)) {
  console.error(`Google Chrome not found at ${chrome}`);
  process.exit(1);
}

// The calm version that lands in the email after Insert (matches the panel's output in scene-rewrite).
const AFTER =
  "Hi Sarah — following up once more on the outstanding invoice. Could you confirm payment today, or give me a call at (415) 555-0192 to talk through what's blocking it? I'd like to get this resolved this week.";

const POSITIONS = {
  rewrite: ".win{left:34px;top:30px;width:520px;height:262px}.stage{left:196px;top:138px;transform:scale(.7)}.win .body{font-size:16.5px}",
  respond: ".win{left:34px;top:30px;width:520px;height:262px}.stage{left:196px;top:150px;transform:scale(.7)}.win .body{font-size:16.5px}.win .body p{margin-bottom:9px}",
};
const LAYERS = {
  win: ".stage{display:none}",
  // Rendered alone, the panel's backdrop blur has nothing to blur, so give it an opaque surface.
  panel: ".panel{background:#F8F8FB!important;backdrop-filter:none!important}.win{display:none}.canvas{background:transparent!important}",
  after: ".stage{display:none}",
};
const SHOTS = [
  ["rewrite", "win"],
  ["rewrite", "after"],
  ["rewrite", "panel"],
  ["respond", "win"],
  ["respond", "panel"],
];

const tmp = mkdtempSync(join(tmpdir(), "showcase-"));
try {
  for (const [scene, layer] of SHOTS) {
    let html = readFileSync(`${scenes}/scene-${scene}.html`, "utf8")
      .replace('href="scene.css"', `href="file://${scenes}/scene.css"`)
      .replace(/<style>[\s\S]*?<\/style>/, `<style>.canvas{width:${W}px;height:${H}px}${POSITIONS[scene]}${LAYERS[layer]}</style>`);
    if (layer === "after") html = html.replace(/(<div class="body"[^>]*>\s*<p>)[\s\S]*?(<\/p>)/, `$1${AFTER}$2`);

    const name = `${scene}-${layer}`;
    writeFileSync(`${tmp}/${name}.html`, html);
    execFileSync(chrome, [
      "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
      `--window-size=${W},${H}`, "--default-background-color=00000000",
      `--screenshot=${tmp}/${name}.png`, `file://${tmp}/${name}.html`,
    ], { stdio: "ignore" });
    const quality = layer === "panel" ? ["-q", "88", "-alpha_q", "100"] : ["-q", "85"];
    execFileSync("cwebp", ["-quiet", ...quality, `${tmp}/${name}.png`, "-o", `${out}/rw-${name}.webp`], { stdio: "inherit" });
    console.log(`rendered site/apps/rw-${name}.webp`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
