// Serves site/ locally with clean URLs, as Firebase Hosting does (/embed/sheet-preview → embed/sheet-preview.html),
// so the embedded widget demos load. Usage: node scripts/serve-site.mjs   (then open http://localhost:4181)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 4181);
const ROOT = new URL("../site/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain" };

async function find(path) {
  for (const p of [path, path + ".html", join(path, "index.html")]) {
    try { if ((await stat(p)).isFile()) return p; } catch {}
  }
}

createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent((req.url ?? "/").split("?")[0])));
  const file = path.startsWith(ROOT) && (await find(path));
  if (!file) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(await readFile(file));
}).listen(PORT, () => console.log(`Site: http://localhost:${PORT}`));
