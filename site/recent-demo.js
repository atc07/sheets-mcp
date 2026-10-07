// "Recently worked on" demo: the real widget (embed/recent-sheets.html, copied from src/recent-html.ts)
// inside a stand-in Claude chat. This page plays the host: it answers the widget's ui/initialize, hands it
// a made-up list of sheets, then a scripted cursor searches, ticks two sheets, types a request and sends it.
// The message the widget sends (ui/message) shows up as the next chat bubble, as it would in Claude.
(() => {
  const demo = document.getElementById("rwDemo");
  if (!demo) return;
  const frame = demo.querySelector("iframe"), cursor = demo.querySelector(".rw-cursor"), msgs = demo.querySelector(".rw-msgs");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const day = (n) => new Date(Date.now() - n * 864e5 - 36e5).toISOString();
  const SHEETS = [
    ["Q3 Budget", "work@acme.com", 0, true], ["East Sales", "work@acme.com", 0], ["West Sales", "work@acme.com", 1],
    ["Cash flow 2026", "work@acme.com", 2], ["Sales Pipeline", "work@acme.com", 3], ["Board Pack", "me@gmail.com", 5],
    ["Hiring plan 2027", "work@acme.com", 15], ["Family budget", "me@gmail.com", 24],
  ].map(([title, account, d, pinned], i) => ({ id: "demo" + i, title, account, url: `https://docs.google.com/spreadsheets/d/demo${i}/edit`, last_used: day(d), ...(pinned && { pinned: true }) }));

  const post = (m) => frame.contentWindow && frame.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
  const theme = () => (dark.matches ? "dark" : "light");
  let ready = false, visible = false, running = false;

  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === "ui/initialize") post({ id: m.id, result: { hostCapabilities: { serverTools: {} }, hostContext: { theme: theme() } } });
    else if (m.method === "ui/notifications/initialized") { ready = true; maybePlay(); }
    else if (m.method === "ui/notifications/size-changed") frame.style.height = m.params.height + "px";
    else if (m.method === "ui/message") { post({ id: m.id, result: {} }); sent(m.params.content[0].text); }
    else if (m.id != null && m.method) post({ id: m.id, result: {} });
  });
  dark.addEventListener("change", () => post({ method: "ui/notifications/host-context-changed", params: { theme: theme() } }));

  // ---------- driving the widget ----------
  const doc = () => frame.contentDocument;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
  const rowNamed = (t) => [...doc().querySelectorAll(".row")].find((r) => r.querySelector(".name").textContent === t);
  function moveTo(el, dx = 0.5, dy = 0.5) {
    const f = frame.getBoundingClientRect(), d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
    cursor.style.transform = `translate(${f.left - d.left + r.left + r.width * dx}px, ${f.top - d.top + r.top + r.height * dy}px)`;
    cursor.classList.add("on");
    return wait(650);
  }
  async function click(el) {
    cursor.classList.add("press");
    await wait(120);
    cursor.classList.remove("press");
    el.click();
    await wait(260);
  }
  async function typeInto(el, text, per = 55) {
    for (let i = 1; i <= text.length; i++) {
      el.value = text.slice(0, i);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(per);
    }
  }

  function sent(text) {
    // Show it as Claude would: the sheets by name (links trimmed), then the request.
    const shown = text.replace(/: https:\/\/\S+/g, "");
    msgs.insertAdjacentHTML("beforeend", '<div class="bubble rw-new"></div>');
    msgs.lastElementChild.textContent = shown;
    setTimeout(() => {
      msgs.insertAdjacentHTML("beforeend", '<div class="asst rw-new"><span class="who">Claude</span><p></p></div>');
      msgs.lastElementChild.querySelector("p").textContent = "On it. Reading East Sales and West Sales, then I'll build the summary in a new spreadsheet.";
    }, reduce ? 0 : 900);
  }

  function reset() {
    msgs.querySelectorAll(".rw-new").forEach((n) => n.remove());
    cursor.classList.remove("on");
    post({ method: "ui/notifications/tool-result", params: { structuredContent: { spreadsheets: SHEETS } } });
    const q = doc() && doc().getElementById("q");
    if (q) { q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); }
  }

  async function play() {
    running = true;
    reset();
    await wait(900);
    const d = doc();
    await moveTo(d.getElementById("q"), 0.3);
    await click(d.getElementById("q"));
    await typeInto(d.getElementById("q"), "sales", 110);
    await wait(400);
    await moveTo(rowNamed("East Sales"), 0.25);
    await click(rowNamed("East Sales"));
    await moveTo(rowNamed("West Sales"), 0.25);
    await click(rowNamed("West Sales"));
    await moveTo(d.getElementById("ask"), 0.35);
    await click(d.getElementById("ask"));
    await typeInto(d.getElementById("ask"), "Combine them into a Q3 summary with a chart", 38);
    await wait(300);
    await moveTo(d.getElementById("send"));
    await click(d.getElementById("send"));
    await wait(700);
    cursor.classList.remove("on");
    await wait(5200);
    running = false;
    if (!reduce) maybePlay();
  }
  function maybePlay() { if (ready && visible && !running) play(); }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; maybePlay(); }, { threshold: 0.4 }).observe(demo);
  // Load the widget only now that the listener above can hear its ui/initialize.
  frame.src = frame.dataset.src;
})();
