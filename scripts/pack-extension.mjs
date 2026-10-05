// Builds the one-click Claude Desktop extension: site/downloads/sheets-mcp.mcpb
// Usage: npm run pack:extension   (needs oauth-client.json; see README "Releasing")
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = new URL("..", import.meta.url).pathname;
const out = `${root}build/extension`;
const target = `${root}site/downloads/sheets-mcp.mcpb`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

if (!existsSync(`${root}oauth-client.json`)) {
  console.error("Missing oauth-client.json (the Google OAuth client users sign in with). See README → Releasing.");
  process.exit(1);
}

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

// Tool list for the manifest, straight from the server so it never drifts.
// Claim MCP Apps support so show_range (only offered to hosts that can display it) is listed too.
const client = new Client({ name: "pack", version: "1" }, { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } });
await client.connect(new StdioClientTransport({ command: "node", args: [`${root}dist/index.js`], stderr: "ignore" }));
const { tools } = await client.listTools();
await client.close();

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/server`, { recursive: true });
cpSync(`${root}dist`, `${out}/server`, { recursive: true });
cpSync(`${root}oauth-client.json`, `${out}/oauth-client.json`);
cpSync(`${root}brand/logo-512.png`, `${out}/icon.png`);
writeFileSync(
  `${out}/package.json`,
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", dependencies: pkg.dependencies }, null, 2),
);
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--silent"], { cwd: out, stdio: "inherit" });

const manifest = {
  manifest_version: "0.3",
  name: "sheetsmcp",
  display_name: "Sheets MCP",
  version: pkg.version,
  description: "Let Claude read, edit, format and chart your Google Sheets.",
  long_description:
    "Sheets MCP connects Claude to Google Sheets. Ask Claude to add columns and formulas, clean up formatting, sort and filter, " +
    "build charts, or summarize a spreadsheet, and it makes the change directly in your sheet.\n\n" +
    "The first time Claude uses it, a Google sign-in opens in your browser. Your sign-in is stored only on this computer, " +
    "and Sheets MCP talks to Google directly. There is no Sheets MCP server in between. You can sign in to several Google " +
    "accounts; just ask Claude to \"sign in to another Google account\".",
  author: { name: "Sheets MCP", email: "privacy@sheetsmcp.io", url: "https://sheetsmcp.io" },
  homepage: "https://sheetsmcp.io",
  support: "https://sheetsmcp.io",
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: { command: "node", args: ["${__dirname}/server/index.js"] },
  },
  // Leave out tools only the preview widget calls (MCP Apps visibility ["app"]).
  tools: tools.filter((t) => !(t._meta?.ui?.visibility?.length === 1 && t._meta.ui.visibility[0] === "app")).map((t) => ({ name: t.name, description: t.description.split(/(?<=\.)\s/)[0] })),
  keywords: ["google sheets", "spreadsheets", "google", "sheets", "excel", "charts"],
  license: "MIT",
  privacy_policies: ["https://sheetsmcp.io/privacy"],
  compatibility: { platforms: ["darwin", "win32"], runtimes: { node: ">=18.0.0" } },
};
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));

mkdirSync(`${root}site/downloads`, { recursive: true });
execFileSync("npx", ["mcpb", "validate", `${out}/manifest.json`], { cwd: root, stdio: "inherit" });
execFileSync("npx", ["mcpb", "pack", out, target], { cwd: root, stdio: "inherit" });
console.log(`\nBuilt ${target}`);
