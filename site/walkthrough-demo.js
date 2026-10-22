// Walkthrough demo: the real live preview widget (embed/sheet-preview.html, copied from src/preview-html.ts) inside a
// stand-in Claude chat. This page plays the host and the server: it answers the widget's ui/initialize, hands it a
// sample model, moves the progress bar with Claude's reads and adds the points one by one (as start_walkthrough and
// add_walkthrough_point would). Once the walkthrough plays, a scripted cursor clicks Next, asks a question in the
// walkthrough, and a fake Claude answers with two steps on the sheet (2a, 2b). Then it starts over.
(() => {
  const demo = document.getElementById("wtDemo");
  if (!demo) return;
  const frame = demo.querySelector("iframe"), cursor = demo.querySelector(".rw-cursor");
  const beats = [...document.querySelectorAll("#walkthrough .wt-beats li")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const theme = () => (dark.matches ? "dark" : "light");

  // ---------- the sample model (the widget's compact wire format: plain cells are bare strings) ----------
  const money = (n) => ({ v: "$" + Math.round(n).toLocaleString("en-US"), n: true });
  const head = (t) => ({ v: t, b: true, bg: "#1f3864", fg: "#ffffff", al: "c" });
  const input = (v, al = "r") => ({ v, fg: "#0000ff", bg: "#fff2cc", al });
  const TABS = [{ title: "Dashboard" }, { title: "P&L" }, { title: "Inputs" }, { title: "Profit Options" }];
  const BOOK = { spreadsheet_id: "demo", title: "Compass Model", url: "https://docs.google.com/spreadsheets/", start_row: 0, start_col: 0, tabs: TABS };
  function options() {
    const rows = [
      ["", { v: "Profit options", b: true, fs: 14 }, "", "", "", "", "", "", ""],
      ["", { v: "Every number links to the model.", i: true, fg: "#666666", fs: 9 }, "", "", "", "", "", "", ""],
      ["", head("#"), head("Option"), head("Lever"), head("Start"), head("On"), head("FY27 impact"), head("Cash impact"), head("Difficulty")],
    ];
    const opts = [["A1", "Cut sales discounts", "10.0%", "Jan-27", 2050950, 2050950, "Medium"], ["A2", "Raise hosting price", "$0.004", "Jan-27", 1192098, 1192098, "Medium"],
      ["A3", "Renegotiate power rates", "$0.003", "Jan-27", 1071681, 1071681, "Hard"], ["A4", "Drop sites that lose money", "$0", "Nov-26", 504749, 559917, "Medium"],
      ["A5", "Reduce headcount", "15.0%", "Nov-26", 1512073, 1506745, "Medium"], ["A6", "Sublease office space", "50.0%", "Jan-27", 358556, 358556, "Medium"],
      ["A7", "Cut bank and admin fees", "30.0%", "Nov-26", 241020, 280020, "Easy"], ["A8", "Cut travel", "50.0%", "Nov-26", 294168, 341768, "Easy"]];
    for (const [id, name, lever, start, fy, cash, diff] of opts) rows.push(["", { v: id, fg: "#666666", al: "c" }, name, input(lever), { v: start, al: "c" }, input("1", "c"), money(fy), money(cash), { v: diff, al: "c" }]);
    rows.push(["", "", { v: "Selected options", b: true }, "", "", "", { ...money(7225295), b: true }, { ...money(7360893), b: true }, ""]);
    for (let r = 0; r < 4; r++) rows.push(Array(9).fill(""));
    return { ...BOOK, tab: "Profit Options", window: "'Profit Options'!A1:I100", col_widths: [16, 36, 200, 76, 66, 44, 104, 104, 80], row_heights: rows.map(() => 21), rows, hide_gridlines: true, frozen_rows: 3 };
  }
  function inputs() {
    const rows = [[{ v: "Inputs", b: true, fs: 14 }, "", "", ""], ["", head("Assumption"), head("Value"), head("Note")]];
    for (const [a, b, c] of [["Customer churn (%/month)", "0.5%", "Renewals above 95%"], ["Sales discounts", "17.5%", "YTD $3.95M of $22.6M"], ["Host rate change ($/kWh)", "$0.0000", "Scenario"], ["Minimum cash balance", "$500,000", ""], ["Funding plug on (1/0)", "1", ""]])
      rows.push(["", a, input(b), { v: c, fg: "#666666", fs: 9 }]);
    for (let r = 0; r < 8; r++) rows.push(["", "", "", ""]);
    return { ...BOOK, tab: "Inputs", window: "Inputs!A1:D100", col_widths: [16, 220, 96, 220], row_heights: rows.map(() => 21), rows, frozen_rows: 2 };
  }
  function other(tab) {
    const rows = [[{ v: tab, b: true, fs: 14 }, "", "", ""], ...Array.from({ length: 14 }, () => ["", "", "", ""])];
    return { ...BOOK, tab, window: `'${tab}'!A1:D100`, col_widths: [16, 220, 96, 220], row_heights: rows.map(() => 21), rows };
  }
  const tabOf = (range) => /^'?([^'!]+)'?!/.exec(range || "")?.[1];
  const sheetFor = (tab) => (tab === "Profit Options" ? options() : tab === "Inputs" ? inputs() : other(tab));

  const rect = (r0, c0, r1, c1) => ({ r0, c0, r1, c1 });
  const col = (i) => String.fromCharCode(65 + i);
  const a1 = (r) => col(r.c0) + (r.r0 + 1) + (r.r1 - r.r0 > 1 || r.c1 - r.c0 > 1 ? ":" + col(r.c1 - 1) + r.r1 : "");
  const point = (tab, r, title, note, callout, q) => ({ title, tab, rect: r, a1: a1(r), range: (tab.includes(" ") ? `'${tab}'` : tab) + "!" + a1(r), note, callout, ...(q && { q }) });
  const POINTS = [
    point("Profit Options", rect(2, 1, 3, 9), "What this tab compares",
      "Each row is one way to raise profit. The columns run from the lever you set to its FY27 and cash impact.", "One row per profit option"),
    point("Profit Options", rect(3, 3, 11, 4), "The levers you can change",
      "Blue on yellow cells are inputs. Change a lever and its row recalculates.", "Blue on yellow = inputs you can change"),
    point("Inputs", rect(2, 1, 7, 3), "Assumptions behind every option",
      "Churn, discounts and the host rate on the Inputs tab apply to every option at once, so set these first.", "Shared assumptions: set these first"),
    point("Profit Options", rect(11, 6, 12, 8), "The bottom line",
      "The options switched on in column F add up here: about $7.2M in FY27 and $7.4M of cash.", "All selected options: ~$7.2M FY27"),
  ];
  const QUESTION = "Which lever is worth the most?";
  const ANSWER = [
    point("Profit Options", rect(3, 3, 4, 4), "The discount lever",
      "Cutting sales discounts by 10% is the biggest single option.", "10% discount cut", 1),
    point("Profit Options", rect(3, 6, 4, 8), "What it's worth",
      "That one lever adds about $2.05M in FY27, and the same in cash.", "$2.05M FY27 and cash", 1),
  ];

  // ---------- the server's side: Claude's reads and the walkthrough it builds ----------
  let W, log, seq, timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  function read(tool, tab, r, from, to) {
    let id;
    const base = () => ({ id, tool, kind: "read", tab, ...(r && { rect: r, a1: a1(r) }) });
    at(from, () => { id = ++seq; log.push({ ...base(), seq: id, pending: true }); });
    at(to, () => log.push({ ...base(), seq: ++seq }));
  }
  const wtInfo = () => {
    const reads = log.filter((e) => !e.pending);
    return { ...W, points: W.points.slice(), questions: W.questions.map((q) => ({ ...q })), reads: reads.length, tabs_read: new Set(reads.map((e) => e.tab)).size, tabs_total: TABS.length, now: Date.now() };
  };
  function session() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    log = [];
    seq = 0;
    W = { id: 1, title: "How the profit options work", planned: POINTS.length, points: [], done: false, started_at: Date.now(), last_point_at: Date.now(), questions: [] };
    read("get_spreadsheet_info", "Dashboard", null, 500, 1100);
    read("read_range", "Profit Options", rect(2, 1, 12, 9), 1400, 2600);
    read("read_range", "Inputs", rect(1, 1, 7, 4), 2900, 3700);
    read("read_range", "P&L", rect(0, 0, 20, 8), 4000, 4900);
    POINTS.forEach((p, i) => at(5600 + i * 1100, () => {
      W.points.push(p);
      W.last_point_at = Date.now();
      if (i === POINTS.length - 1) W.done = true;
    }));
  }
  // A question typed in the walkthrough: Claude answers a moment later, with two steps on the sheet right after the point.
  function asked(where, text) {
    const q = { id: W.questions.length + 1, point: where, text, at: Date.now() };
    W.questions.push(q);
    at(2600, () => {
      W.points.splice(where + 1, 0, ...ANSWER);
      W.planned = W.points.length;
      Object.assign(q, { answer: "Cutting sales discounts: a 10% cut adds about $2.05M a year.", steps: ANSWER.length });
    });
  }

  // ---------- the host's side of the MCP Apps protocol ----------
  const post = (m) => frame.contentWindow && frame.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === "ui/initialize") {
      post({ id: m.id, result: { protocolVersion: "2026-01-26", hostContext: { theme: theme() }, hostCapabilities: { serverTools: {}, message: {}, updateModelContext: {} } } });
    } else if (m.method === "ui/notifications/initialized") {
      session();
      post({ method: "ui/notifications/tool-input", params: { arguments: { spreadsheet: "demo", range: "'Profit Options'!A1:I30", title: W.title, points: POINTS.length } } });
      post({ method: "ui/notifications/tool-result", params: { structuredContent: { preview: options(), edits: [], seq: 0, account: "you@example.com", walkthrough: wtInfo() } } });
    } else if (m.method === "ui/notifications/size-changed") {
      frame.style.height = Math.ceil(m.params.height) + "px";
    } else if (m.method === "tools/call") {
      const a = m.params.arguments || {};
      if (a.wt_ask) asked(a.wt_at, a.wt_ask);
      const extra = a.peek ? { preview: sheetFor(tabOf(a.range)) } : a.heartbeat ? {} : { edits: log.filter((x) => x.seq > (a.since || 0)) };
      post({ id: m.id, result: { structuredContent: { seq, ...extra, ...(a.wt === W.id && { walkthrough: wtInfo() }) } } });
    } else if (m.id != null && m.method) {
      post({ id: m.id, result: {} }); // ui/message, ui/update-model-context, ui/open-link
    }
  });
  dark.addEventListener("change", () => post({ method: "ui/notifications/host-context-changed", params: { theme: theme() } }));

  // ---------- the scripted user ----------
  let run = 0, visible = false;
  const doc = () => frame.contentDocument;
  const sleep = (ms, mine) => new Promise((ok, stop) => setTimeout(() => (mine === run ? ok() : stop("stale")), ms));
  async function until(test, mine, limit = 15000) {
    for (let t = 0; !test(); t += 150) { if (t > limit) throw "timeout"; await sleep(150, mine); }
  }
  const beat = (i) => beats.forEach((b, k) => b.classList.toggle("on", k === i));
  function moveTo(el, mine, dx = 0.5, dy = 0.5) {
    const f = frame.getBoundingClientRect(), d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
    cursor.style.transform = `translate(${f.left - d.left + r.left + r.width * dx}px, ${f.top - d.top + r.top + r.height * dy}px)`;
    cursor.classList.add("on");
    return sleep(650, mine);
  }
  async function click(el, mine) {
    cursor.classList.add("press");
    await sleep(120, mine);
    cursor.classList.remove("press");
    el.click();
    await sleep(260, mine);
  }
  const nextButton = () => [...doc().querySelectorAll(".wtf .btn")].find((b) => b.textContent === "Next" || b.textContent === "Finish");
  async function next(mine, hold) {
    await moveTo(nextButton(), mine);
    await click(nextButton(), mine);
    await sleep(hold, mine);
  }

  async function play(mine) {
    beat(0);
    await until(() => doc() && doc().querySelector(".wtr.now"), mine, 20000);
    beat(1);
    if (reduce) return; // a still walkthrough on its first point
    await sleep(3600, mine);
    await next(mine, 3400);
    // Ask about the point on screen, in the walkthrough's own box.
    beat(2);
    const box = doc().querySelector(".wtask textarea");
    await moveTo(box, mine, 0.3);
    await click(box, mine);
    for (let i = 1; i <= QUESTION.length; i++) {
      box.value = QUESTION.slice(0, i);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(45, mine);
    }
    await sleep(300, mine);
    await moveTo(doc().querySelector(".wtask .btn"), mine);
    await click(doc().querySelector(".wtask .btn"), mine);
    cursor.classList.remove("on");
    await until(() => doc().querySelector(".wtr.ans.now"), mine);
    await sleep(3600, mine);
    await next(mine, 3600);
    beat(1);
    await next(mine, 4000);
    await next(mine, 4200);
    cursor.classList.remove("on");
    await sleep(2400, mine);
  }
  async function loop() {
    const mine = ++run;
    cursor.classList.remove("on");
    demo.classList.remove("out");
    frame.src = frame.dataset.src + "?" + mine; // a fresh widget for each run
    try {
      await play(mine);
      if (reduce) return;
      demo.classList.add("out");
      await sleep(500, mine);
      loop();
    } catch {}
  }
  // Play once a good part of the demo is in view; scrolled all the way away, it stops and starts over next time.
  new IntersectionObserver(([e]) => {
    if (!visible && e.intersectionRatio >= 0.3) { visible = true; loop(); }
    else if (visible && !e.isIntersecting) { visible = false; run++; for (const t of timers) clearTimeout(t); cursor.classList.remove("on"); }
  }, { threshold: [0, 0.3] }).observe(demo);
})();
