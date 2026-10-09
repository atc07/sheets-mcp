import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
const [token, dir, site] = process.argv.slice(2);
const H = { Authorization: `Bearer ${token}`, "x-goog-user-project": "sheets-mcp-k8ajul", "Content-Type": "application/json" };
const api = "https://firebasehosting.googleapis.com/v1beta1";
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: H, body: body && JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(`${method} ${url}: ${JSON.stringify(j)}`); return j;
}
const files = {}, blobs = {};
for (const f of readdirSync(dir, { recursive: true }).filter((p) => statSync(`${dir}/${p}`).isFile())) {
  const gz = gzipSync(readFileSync(`${dir}/${f}`), { level: constants.Z_BEST_COMPRESSION });
  const h = createHash("sha256").update(gz).digest("hex");
  files[`/${f}`] = h; blobs[h] = gz;
}
// Hosting doesn't know .mcpb: it serves the compressed variant browsers ask for as text/html, and Safari then
// names the download "sheets-mcp.mcpb.html". Say what it is, and name the file, so every browser saves it as is.
const v = await call("POST", `${api}/sites/${site}/versions`, {
  config: {
    cleanUrls: true,
    headers: [
      { glob: "/downloads/**", headers: { "Content-Disposition": "attachment" } },
      { glob: "/downloads/*.mcpb", headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="sheets-mcp.mcpb"' } },
      { glob: "**/!(*.@(png|jpg|jpeg|webp|svg|ico|mcpb))", headers: { "Cache-Control": "no-cache" } },
    ],
  },
});
const p = await call("POST", `${api}/${v.name}:populateFiles`, { files });
for (const h of p.uploadRequiredHashes ?? []) {
  const r = await fetch(`${p.uploadUrl}/${h}`, { method: "POST", headers: { Authorization: H.Authorization, "x-goog-user-project": H["x-goog-user-project"], "Content-Type": "application/octet-stream" }, body: blobs[h] });
  if (!r.ok) throw new Error(`upload ${h}: ${r.status} ${await r.text()}`);
}
await call("PATCH", `${api}/${v.name}?update_mask=status`, { status: "FINALIZED" });
const rel = await call("POST", `${api}/sites/${site}/releases?versionName=${v.name}`, {});
console.log("released", rel.name, "files:", Object.keys(files).join(", "));
