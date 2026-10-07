// Use-case demos: each card plays a short scene of Claude working with something beyond one sheet (an API,
// files on your computer, other spreadsheets, a schedule, two Google accounts) and the sheet it changes.
// Tool names mirror the real Sheets MCP tools (src/server.ts); all data is made up.
// Scenes play while on screen and loop; with reduced motion they show their finished state.
(() => {
  const demos = document.querySelectorAll(".uc-demo[data-scene]");
  if (!demos.length) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const ICON = {
    sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5V20"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/></svg>',
  };
  const LIGHTS = '<span class="lights"><i></i><i></i><i></i></span>';
  const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

  // ---------- the scenes ----------
  // steps: { tool, arg, res, ms, mcp?, icon?, start?(sh), end?(sh) } | { say } | { divider }
  const SCENES = {
    api: {
      surface: "code", cwd: "~/finance",
      prompt: "Pull last week's Stripe payouts into the Cash tab and total them.",
      sheet: { file: "Cash flow 2026", tab: "Cash", cols: ["Date", "Payout", "Amount"], align: ["l", "l", "r"], widths: ["26%", "40%", "34%"], rows: 7 },
      steps: [
        { tool: "Bash", arg: "curl -s api.stripe.com/v1/payouts -u $STRIPE_KEY: -G -d created[gte]=…", res: "5 payouts, Sep 29 – Oct 3", ms: 1300 },
        { tool: "write_range", mcp: true, arg: 'range: "Cash!A1"', res: "Updated Cash!A1:C7 · no formula errors", ms: 1500,
          start: (sh) => {
            sh.sel(0, 6);
            sh.row(0, ["Date", "Payout", "Amount"], "head");
            [["Sep 29", "po_1Q8xLm", 4812.4], ["Sep 30", "po_1Q9aTz", 3975.1], ["Oct 1", "po_1QAb2k", 5230], ["Oct 2", "po_1QBc7n", 4406.75], ["Oct 3", "po_1QCd4r", 6118.2]]
              .forEach((r, i) => sh.later(150 + i * 140, () => sh.row(i + 1, [r[0], r[1], String(r[2])])));
            sh.later(900, () => sh.row(6, ["Total", "", "=SUM(C2:C6)"], "total", { 2: "f" }));
          },
          end: (sh) => sh.set(6, 2, "24542.45") },
        { tool: "format_range", mcp: true, arg: 'range: "Cash!A1:C7"', res: "Formatted Cash!A1:C7", ms: 900,
          start: (sh) => sh.sel(0, 6),
          end: (sh) => { sh.cls(0, "styled"); for (let r = 1; r <= 6; r++) sh.set(r, 2, money(+sh.get(r, 2))); sh.unsel(); } },
        { say: "Added 5 payouts ($24,542.45 total) to the Cash tab." },
      ],
    },

    combine: {
      surface: "chat",
      prompt: "Combine the East and West sales sheets into a new Q3 summary with a chart.",
      sheet: { file: "Q3 Sales Summary", tab: "Summary", cols: ["Region", "Q3 revenue", "vs Q2"], align: ["l", "r", "r"], widths: ["34%", "40%", "26%"], rows: 5, hidden: true, chart: true },
      steps: [
        { tool: "read_range", mcp: true, arg: "East Sales › Q3!A1:D48", res: "East Sales › Q3 · 48 rows", ms: 900 },
        { tool: "read_range", mcp: true, arg: "West Sales › Q3!A1:D41", res: "West Sales › Q3 · 41 rows", ms: 900 },
        { tool: "create_spreadsheet", mcp: true, arg: '"Q3 Sales Summary"', res: "Created Q3 Sales Summary", ms: 800, end: (sh) => sh.show() },
        { tool: "write_range", mcp: true, arg: "Summary!A1", res: "Updated Summary!A1:C4", ms: 1300,
          start: (sh) => {
            sh.sel(0, 3);
            sh.row(0, ["Region", "Q3 revenue", "vs Q2"], "head styled");
            sh.later(200, () => sh.row(1, ["East", "$412,300", "+8%"]));
            sh.later(380, () => sh.row(2, ["West", "$356,900", "+12%"]));
            sh.later(560, () => sh.row(3, ["Total", "=SUM(B2:B3)", "+10%"], "total", { 1: "f" }));
          },
          end: (sh) => { sh.set(3, 1, "$769,200"); sh.unsel(); } },
        { tool: "add_chart", mcp: true, arg: "Summary!A1:B3", res: "Chart placed at E1", ms: 900, end: (sh) => sh.chart(["East", "West"], [100, 87]) },
        { say: "Done. Q3 Sales Summary has both regions, the total and a chart." },
      ],
    },

    schedule: {
      surface: "chat",
      prompt: "Every weekday at 8 am, refresh the Pipeline tab from HubSpot.",
      sheet: { file: "Sales Pipeline", tab: "Pipeline", cols: ["Stage", "Deals", "Value"], align: ["l", "r", "r"], widths: ["40%", "22%", "38%"], rows: 6,
        start: [["Stage", "Deals", "Value"], ["Lead", "15", "$88,000"], ["Proposal", "13", "$198,400"], ["Negotiation", "8", "$171,000"], ["Won", "3", "$71,200"], ["Refreshed", "", "Fri 5:12 PM"]] },
      steps: [
        { tool: "create_scheduled_task", arg: "Weekdays at 8:00 AM", res: "Scheduled: weekdays at 8:00 AM", ms: 1000, icon: "clock" },
        { say: "Scheduled. It runs on this computer every weekday at 8:00 AM." },
        { divider: "Later" },
        { tool: "Scheduled run", arg: "Mon 8:00 AM", res: "Mon 8:00 AM · 42 deals updated", ms: 1000, icon: "clock",
          start: (sh) => sh.sel(1, 5), end: (sh) => sh.fill([["16", "$96,000"], ["14", "$212,500"], ["9", "$184,000"], ["3", "$71,200"], ["", "Mon 8:00 AM"]]) },
        { tool: "Scheduled run", arg: "Tue 8:00 AM", res: "Tue 8:00 AM · 45 deals updated", ms: 1000, icon: "clock",
          start: (sh) => sh.sel(1, 5), end: (sh) => sh.fill([["18", "$104,500"], ["15", "$226,000"], ["9", "$184,000"], ["3", "$71,200"], ["", "Tue 8:00 AM"]]) },
        { tool: "Scheduled run", arg: "Wed 8:00 AM", res: "Wed 8:00 AM · 44 deals updated", ms: 1000, icon: "clock",
          start: (sh) => sh.sel(1, 5), end: (sh) => { sh.fill([["17", "$99,000"], ["14", "$219,500"], ["9", "$184,000"], ["4", "$93,700"], ["", "Wed 8:00 AM"]]); sh.unsel(); } },
      ],
    },

    files: {
      surface: "code", cwd: "~/Downloads",
      prompt: "Reconcile the three bank CSVs here against the Ledger tab and flag anything missing.",
      sheet: { file: "Books 2026", tab: "Reconcile", cols: ["Date", "Description", "Amount", "Status"], align: ["l", "l", "r", "l"], widths: ["17%", "33%", "23%", "27%"], rows: 6 },
      steps: [
        { tool: "Read", arg: "checking-sep.csv, card-sep.csv, savings-sep.csv", res: "Read 3 files (207 transactions)", ms: 1100 },
        { tool: "read_range", mcp: true, arg: 'range: "Ledger!A1:E214"', res: "Read 214 rows", ms: 900 },
        { tool: "write_range", mcp: true, arg: 'range: "Reconcile!A1"', res: "Updated Reconcile!A1:D6", ms: 1400,
          start: (sh) => {
            sh.sel(0, 5);
            sh.row(0, ["Date", "Description", "Amount", "Status"], "head styled");
            [["Sep 3", "AWS", "$1,284.10", "Matched"], ["Sep 9", "Payroll", "$18,400.00", "Matched"], ["Sep 14", "Figma", "$45.00", "Missing in ledger"], ["Sep 22", "Wire fee", "$35.00", "Missing in ledger"], ["Sep 28", "Office rent", "$6,500.00", "Matched"]]
              .forEach((r, i) => sh.later(140 + i * 150, () => sh.row(i + 1, r)));
          } },
        { tool: "add_conditional_format", mcp: true, arg: 'range: "Reconcile!D2:D6"', res: "Highlighted 2 rows", ms: 900,
          start: (sh) => sh.sel(1, 5, 3), end: (sh) => { sh.mark(3, 3, "bad"); sh.mark(4, 3, "bad"); sh.unsel(); } },
        { say: "205 of 207 transactions match. Two are missing from the ledger: Figma ($45) and a wire fee ($35)." },
      ],
    },

    accounts: {
      surface: "chat",
      prompt: "Copy the Q4 forecast from my work account into the board sheet on my personal account.",
      sheet: { file: "Board Pack", tab: "Forecast", account: "me@gmail.com", cols: ["Month", "Revenue", "Margin"], align: ["l", "r", "r"], widths: ["30%", "40%", "30%"], rows: 5 },
      steps: [
        { tool: "read_range", mcp: true, arg: "Forecast › Q4!A1:C5 · work@acme.com", res: "Read Forecast › Q4 · work@acme.com", ms: 1100 },
        { tool: "write_range", mcp: true, arg: "Board Pack › Forecast!A1 · me@gmail.com", res: "Updated Forecast!A1:C5 · me@gmail.com", ms: 1500,
          start: (sh) => {
            sh.sel(0, 4);
            sh.row(0, ["Month", "Revenue", "Margin"], "head styled");
            [["Oct", "$182,000", "34%"], ["Nov", "$195,500", "35%"], ["Dec", "$221,000", "37%"]].forEach((r, i) => sh.later(180 + i * 170, () => sh.row(i + 1, r)));
            sh.later(760, () => sh.row(4, ["Q4", "$598,500", "35%"], "total"));
          },
          end: (sh) => sh.unsel() },
        { say: "Copied. The Board Pack's Forecast tab now has Q4 from your work forecast." },
      ],
    },
  };

  // ---------- the sheet ----------
  function makeSheet(root, spec, at) {
    root.innerHTML = `<div class="uc-sbar">${ICON.sheet}<b>${esc(spec.file)}</b><span class="uc-tab">${esc(spec.tab)}</span>${spec.account ? `<span class="uc-acct">${esc(spec.account)}</span>` : ""}</div>
      <div class="uc-grid${spec.chart ? " has-chart" : ""}"><table><colgroup><col class="rn">${spec.widths.map((w) => `<col style="width:${w}">`).join("")}</colgroup><tbody></tbody></table>
      ${spec.chart ? '<div class="uc-chart"><div class="uc-bars"></div><div class="uc-xl"></div></div>' : ""}<div class="uc-sel"></div></div>`;
    const tbody = root.querySelector("tbody"), selBox = root.querySelector(".uc-sel"), grid = root.querySelector(".uc-grid");
    const cell = (r, c) => tbody.rows[r].cells[c + 1];
    const flash = (td) => { td.classList.remove("flash"); void td.offsetWidth; td.classList.add("flash"); };
    const sh = {
      reset() {
        tbody.innerHTML = Array.from({ length: spec.rows }, (_, r) => `<tr><td class="rn">${r + 1}</td>${spec.cols.map((_, c) => `<td class="${spec.align[c]}"></td>`).join("")}</tr>`).join("");
        (spec.start || []).forEach((row, r) => sh.row(r, row, r === 0 ? "head styled" : "", {}, true));
        root.classList.toggle("off", !!spec.hidden);
        if (spec.chart) { root.querySelector(".uc-chart").classList.remove("on"); }
        sh.unsel();
      },
      show() { root.classList.remove("off"); },
      row(r, cells, cls = "", fcls = {}, quiet) {
        const tr = tbody.rows[r];
        tr.className = cls;
        cells.forEach((v, c) => {
          const td = cell(r, c);
          td.textContent = v;
          td.classList.toggle("f", !!fcls[c]);
          if (!quiet && v !== "") flash(td);
        });
      },
      set(r, c, v) { const td = cell(r, c); td.textContent = v; td.classList.remove("f"); flash(td); },
      get: (r, c) => cell(r, c).textContent,
      cls(r, cls) { tbody.rows[r].classList.add(...cls.split(" ")); },
      mark(r, c, cls) { cell(r, c).classList.add(cls); },
      // Columns 2.. of rows 1.., the way a refresh rewrites the numbers.
      fill(rows) { rows.forEach((vals, i) => vals.forEach((v, j) => { if (v !== "" && cell(i + 1, j + 1).textContent !== v) sh.set(i + 1, j + 1, v); })); },
      sel(r1, r2, c1 = 0, c2 = spec.cols.length - 1) {
        const a = cell(r1, c1), b = cell(r2, c2);
        const top = a.offsetTop, left = a.offsetLeft;
        Object.assign(selBox.style, { transform: `translate(${left - 1}px, ${top - 1}px)`, width: `${b.offsetLeft + b.offsetWidth - left + 1}px`, height: `${b.offsetTop + b.offsetHeight - top + 1}px` });
        selBox.classList.add("on");
      },
      unsel() { selBox.classList.remove("on"); },
      chart(labels, heights) {
        const box = root.querySelector(".uc-chart");
        box.querySelector(".uc-bars").innerHTML = heights.map((h) => `<i style="--h:${h}%"></i>`).join("");
        box.querySelector(".uc-xl").innerHTML = labels.map((l) => `<span>${esc(l)}</span>`).join("");
        void box.offsetWidth;
        box.classList.add("on");
      },
      later: (ms, fn) => at.rel(ms, fn),
    };
    void grid;
    return sh;
  }

  // ---------- Claude's side ----------
  function makeLog(root, scene) {
    const code = scene.surface === "code";
    root.className = "uc-win " + (code ? "is-code" : "is-chat");
    // The request stays pinned at the top; Claude's steps scroll up beneath it.
    const ask = code ? '<div class="uc-ask ln you"><span>&gt;</span><span class="t"></span></div>' : '<div class="uc-ask"><div class="bubble"><span class="t"></span></div></div>';
    root.innerHTML = `<div class="uc-wbar">${LIGHTS}<span>${code ? `claude — ${esc(scene.cwd)}` : "Claude"}</span></div>${ask}<div class="uc-log"></div>`;
    const log = root.querySelector(".uc-log"), prompt = root.querySelector(".uc-ask");
    const add = (html) => { log.insertAdjacentHTML("beforeend", html); return log.lastElementChild; };
    return {
      reset() { log.innerHTML = ""; prompt.querySelector(".t").textContent = ""; },
      type(text, caret) { prompt.querySelector(".t").innerHTML = esc(text) + (caret ? '<i class="caret"></i>' : ""); },
      step(s) {
        if (code) {
          const name = s.mcp ? `google-sheets - ${s.tool} <span class="dim">(MCP)(${esc(s.arg)})</span>` : `${esc(s.tool)}<span class="dim">(${esc(s.arg)})</span>`;
          const el = add(`<div class="st"><div class="ln"><span class="b run">⏺</span><span class="nm">${name}</span></div><div class="ln dim"><span>⎿</span><span class="out">Running…</span></div></div>`);
          return (res) => { el.querySelector(".b").classList.replace("run", "ok"); el.querySelector(".out").textContent = res; };
        }
        const el = add(`<div class="tool run">${ICON[s.icon || (s.mcp ? "sheet" : "plug")]}<b>${esc(s.tool)}</b><code>${esc(s.arg)}</code><span class="st"></span></div>`);
        return (res) => { el.classList.replace("run", "ok"); el.querySelector("code").textContent = res; };
      },
      say(text) { add(code ? `<div class="ln"><span>⏺</span><span>${esc(text)}</span></div>` : `<p class="say">${esc(text)}</p>`); },
      divider(text) { add(`<div class="div"><span>${esc(text)}</span></div>`); },
    };
  }

  // ---------- playing a scene ----------
  function setup(demo) {
    const scene = SCENES[demo.dataset.scene];
    if (!scene) return;
    demo.innerHTML = '<div></div><div class="uc-sheet"></div>';
    let timers = [], base = 0, visible = false, waiting = false;
    const at = (ms, fn) => timers.push(setTimeout(fn, reduce ? 0 : ms));
    // Timers relative to "now" in the scene, for sheet effects inside a step.
    at.rel = (ms, fn) => timers.push(setTimeout(fn, reduce ? 0 : ms));
    const ui = makeLog(demo.firstElementChild, scene);
    const sh = makeSheet(demo.lastElementChild, scene.sheet, at);

    function play() {
      timers.forEach(clearTimeout);
      timers = [];
      ui.reset();
      sh.reset();
      let t = 300;
      const p = scene.prompt;
      for (let i = 0; i <= p.length; i += 2) { const s = p.slice(0, i); at(t + i * 11, () => ui.type(s, true)); }
      t += p.length * 11 + 250;
      at(t, () => ui.type(p, false));
      t += 350;
      for (const s of scene.steps) {
        if (s.say) { at(t, () => ui.say(s.say)); t += 700; continue; }
        if (s.divider) { at(t, () => ui.divider(s.divider)); t += 500; continue; }
        let finish;
        at(t, () => { finish = ui.step(s); s.start && s.start(sh); });
        t += s.ms;
        at(t, () => { finish(s.res); s.end && s.end(sh); });
        t += 260;
      }
      if (!reduce) at(t + 4200, () => (visible ? play() : (waiting = true)));
      base = t;
    }

    new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && (!was && (waiting || !base))) { waiting = false; play(); }
    }, { threshold: 0.35 }).observe(demo);
  }

  demos.forEach(setup);
})();
