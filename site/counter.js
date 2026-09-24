// Download counter: Claude Desktop downloads (Firestore, +1 per click) + Claude Code installs (npm).
(() => {
  const PROJECT = "sheets-mcp-k8ajul";
  const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const DOC = `projects/${PROJECT}/databases/(default)/documents/counters/downloads`;
  const LAUNCH = "2026-09-23";
  const els = [...document.querySelectorAll("[data-downloads]")];
  if (!els.length) return;
  const fmt = new Intl.NumberFormat("en-US");
  let total = null;

  function render() {
    for (const el of els) {
      const pill = el.closest(".dl-stat");
      if (total === null) {
        pill?.setAttribute("hidden", "");
        continue;
      }
      el.textContent = fmt.format(total);
      const label = pill?.querySelector("[data-downloads-label]");
      if (label) label.textContent = total === 1 ? "download" : "downloads";
      pill?.removeAttribute("hidden");
      pill?.classList.add("is-ready");
    }
  }

  async function desktopCount() {
    const res = await fetch(`${DB}/counters/downloads`);
    if (!res.ok) throw new Error(`counter ${res.status}`);
    return Number((await res.json()).fields?.count?.integerValue ?? 0);
  }

  async function npmCount() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`https://api.npmjs.org/downloads/point/${LAUNCH}:${today}/@sheetsmcp/server`);
    if (!res.ok) return 0; // new packages aren't in npm's stats for a day or two
    return Number((await res.json()).downloads ?? 0);
  }

  Promise.allSettled([desktopCount(), npmCount()]).then(([desktop, npm]) => {
    if (desktop.status !== "fulfilled") return render(); // can't read the counter: hide rather than show a wrong number
    total = desktop.value + (npm.status === "fulfilled" ? npm.value : 0);
    render();
  });

  // Count Claude Desktop downloads.
  document.addEventListener("click", (e) => {
    const link = e.target instanceof Element && e.target.closest('a[href$=".mcpb"]');
    if (!link) return;
    fetch(`${DB}:commit`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [{ transform: { document: DOC, fieldTransforms: [{ fieldPath: "count", increment: { integerValue: "1" } }] } }],
      }),
    }).catch(() => {});
    if (total !== null) {
      total += 1;
      render();
    }
  });
})();
