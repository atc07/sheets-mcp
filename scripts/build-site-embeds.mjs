// Copies the real widgets ("Recently worked on" and the live sheet preview) into the site, so the demos there are the product itself.
// Usage: npm run build && node scripts/build-site-embeds.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { RECENT_HTML } from "../dist/recent-html.js";
import { PREVIEW_HTML } from "../dist/preview-html.js";

const dir = new URL("../site/embed/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}recent-sheets.html`, RECENT_HTML);
writeFileSync(`${dir}sheet-preview.html`, PREVIEW_HTML);
console.log(`Wrote ${dir}recent-sheets.html and ${dir}sheet-preview.html`);
