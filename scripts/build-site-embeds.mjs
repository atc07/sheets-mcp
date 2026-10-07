// Copies the real "Recently worked on" widget into the site, so the demo there is the product itself.
// Usage: npm run build && node scripts/build-site-embeds.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { RECENT_HTML } from "../dist/recent-html.js";

const dir = new URL("../site/embed/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}recent-sheets.html`, RECENT_HTML);
console.log(`Wrote ${dir}recent-sheets.html`);
