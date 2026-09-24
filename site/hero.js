// Hero demo: a prompt in Claude (Desktop or Code) on the left, the Google Sheet it edits on the right.
// Tool names, arguments and results mirror the real Sheets MCP tools (src/server.ts).
(() => {
  const split = document.getElementById("split");
  if (!split) return;

  const PROMPT = "Add a profit column with totals, format everything as currency, and chart revenue by month.";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel) => document.querySelector(sel);
  const pane = $("#claudePane"), tbody = $("#ss tbody"), cursor = $("#clCursor"), gridwrap = $("#gridwrap"), chart = $("#ssChart");
  const money = (n) => "$" + n.toLocaleString("en-US");

  // ---------- the sheet ----------
  const START = [["Month", "Revenue", "Cost", "", ""], ["Jan", 12400, 8100, "", ""], ["Feb", 15200, 9000, "", ""], ["Mar", 18900, 9700, "", ""]];
  while (START.length < 12) START.push(["", "", "", "", ""]);
  const cellEl = (r, c) => tbody.rows[r].cells[c + 1];
  const setCell = (r, c, text, cls = "") => {
    const td = cellEl(r, c);
    td.innerHTML = `<span class="c ${cls}">${text}</span>`;
    td.classList.remove("flash");
    void td.offsetWidth;
    td.classList.add("flash");
  };
  const formula = (ref, val) => {
    $("#fref").textContent = ref;
    $("#fval").textContent = val;
  };
  function resetSheet() {
    tbody.innerHTML = START.map((row, r) => `<tr${r === 0 ? ' class="head"' : ""}><td class="rn">${r + 1}</td>${row.map((v, c) => `<td${c === 0 ? ' class="l"' : ""}><span class="c">${v}</span></td>`).join("")}</tr>`).join("");
    chart.classList.remove("on");
    cursor.classList.remove("on");
    $("#clAvatar").classList.remove("on");
    formula("A1", "Month");
  }
  const within = (el) => {
    const a = el.getBoundingClientRect(), g = gridwrap.getBoundingClientRect();
    return { l: a.left - g.left, t: a.top - g.top, r: a.right - g.left, b: a.bottom - g.top };
  };
  // Claude's collaborator cursor over a block of cells (0-based rows; columns A = 0).
  function select(r1, c1, r2 = r1, c2 = c1) {
    const a = within(cellEl(r1, c1)), b = within(cellEl(r2, c2));
    cursor.style.transform = `translate(${a.l - 1}px, ${a.t - 1}px)`;
    cursor.style.width = `${b.r - a.l + 1}px`;
    cursor.style.height = `${b.b - a.t + 1}px`;
    cursor.classList.add("on");
    $("#clAvatar").classList.add("on");
  }
  // The chart floats over B7:E10, snapped to the grid, where add_chart reports placing it.
  function placeChart() {
    const a = within(cellEl(6, 1)), b = within(cellEl(9, 4));
    Object.assign(chart.style, { left: `${a.l + 4}px`, top: `${a.t + 4}px`, width: `${b.r - a.l - 8}px`, height: `${b.b - a.t - 8}px` });
  }

  // ---------- the Claude side ----------
  const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const TOOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5V20"/></svg>';
  const LIGHTS = '<span class="lights"><i></i><i></i><i></i></span>';
  const surfaces = {
    chat: {
      build() {
        pane.className = "pane";
        pane.innerHTML = `<div class="pane-bar">${LIGHTS}Claude</div>
          <div class="chat"><div class="msgs fade-top" id="msgs"></div>
          <div class="composer"><span class="field" id="field"></span><span class="send" id="send">${SEND}</span></div></div>`;
      },
      type(text) {
        $("#field").innerHTML = text + '<span class="caret"></span>';
        $("#send").classList.toggle("ready", text.length > 0);
      },
      send() {
        const b = $("#send");
        b.classList.add("press");
        setTimeout(() => b.classList.remove("press"), 160);
        $("#field").textContent = "";
        b.classList.remove("ready");
        $("#msgs").insertAdjacentHTML("beforeend", `<div class="bubble">${PROMPT}</div>`);
      },
      think() { $("#msgs").insertAdjacentHTML("beforeend", '<div class="asst" id="asst"><span class="who">Claude</span><span class="thinking" id="thinking"><i></i><i></i><i></i></span></div>'); },
      say(text) {
        $("#thinking")?.remove();
        $("#asst").insertAdjacentHTML("beforeend", `<p>${text}</p>`);
      },
      tool(id, name, key, arg) { $("#asst").insertAdjacentHTML("beforeend", `<div class="tool run" id="${id}">${TOOL}<b>${name}</b><code>${arg}</code><span class="st"></span></div>`); },
      done(id) { $("#" + id).classList.replace("run", "ok"); },
    },
    code: {
      build() {
        pane.className = "pane term-mode";
        pane.innerHTML = `<div class="pane-bar">${LIGHTS}claude — ~/finance</div>
          <div class="term"><div class="log fade-top" id="log"><div class="welcome"><b>✻</b> Welcome to Claude Code!<div>cwd: ~/finance</div></div></div>
          <div class="inputbox"><span class="pr">&gt; </span><span id="field"></span></div><div class="hint">? for shortcuts</div></div>`;
      },
      add(html) { $("#log").insertAdjacentHTML("beforeend", html); },
      type(text) { $("#field").innerHTML = text + '<span class="caret"></span>'; },
      send() {
        this.add(`<div class="ln you"><span>&gt;</span><span>${PROMPT}</span></div>`);
        $("#field").textContent = "";
      },
      think() { this.add('<div class="ln" id="thinking"><span class="bullet run">✻</span><span style="color:var(--claude)">Thinking…</span></div>'); },
      say(text) {
        $("#thinking")?.remove();
        this.add(`<div class="ln"><span>⏺</span><span>${text}</span></div>`);
      },
      tool(id, name, key, arg) {
        this.add(`<div id="${id}"><div class="ln"><span class="bullet run">⏺</span><span><span class="name">google-sheets - ${name}</span> <span class="arg">(MCP)(${key}: "${arg}")</span></span></div><div class="ln res"><span>⎿</span><span class="out">Running…</span></div></div>`);
      },
      done(id, result) {
        const t = $("#" + id);
        t.querySelector(".bullet").classList.replace("run", "ok");
        t.querySelector(".out").textContent = result;
      },
    },
  };

  // ---------- the timeline ----------
  let mode = "chat", timers = [], visible = true;
  const at = (ms, fn) => timers.push(setTimeout(fn, reduce ? 0 : ms));

  function play() {
    timers.forEach(clearTimeout);
    timers = [];
    resetSheet();
    const ui = surfaces[mode];
    ui.build();

    // Type and send the prompt.
    for (let i = 0; i <= PROMPT.length; i++) at(500 + i * 26, () => ui.type(PROMPT.slice(0, i)));
    const sent = 500 + PROMPT.length * 26 + 350;
    at(sent, () => ui.send());
    at(sent + 300, () => ui.think());
    at(sent + 1050, () => ui.say("I'll add a profit column and a totals row, then format and chart it."));

    // write_range: Profit in D1:D4.
    let t = sent + 1450;
    at(t, () => { ui.tool("t1", "write_range", "range", "Sales!D1"); select(0, 3); formula("D1", "Profit"); setCell(0, 3, "Profit"); });
    [1, 2, 3].forEach((r, i) => {
      at(t + 400 + i * 240, () => { select(r, 3); formula(`D${r + 1}`, `=B${r + 1}-C${r + 1}`); setCell(r, 3, `=B${r + 1}-C${r + 1}`, "f"); });
      at(t + 1200 + i * 80, () => setCell(r, 3, String(START[r][1] - START[r][2])));
    });
    at(t + 1500, () => ui.done("t1", "Updated Sales!D1:D4 · no formula errors"));

    // write_range: totals in row 5.
    t += 1750;
    at(t, () => { ui.tool("t2", "write_range", "range", "Sales!A5"); select(4, 0, 4, 3); formula("B5", "=SUM(B2:B4)"); });
    at(t + 350, () => {
      setCell(4, 0, "Total");
      tbody.rows[4].classList.add("total");
      [[1, "B"], [2, "C"], [3, "D"]].forEach(([c, col]) => setCell(4, c, `=SUM(${col}2:${col}4)`, "f"));
    });
    at(t + 1000, () => { setCell(4, 1, "46500"); setCell(4, 2, "26800"); setCell(4, 3, "19700"); });
    at(t + 1250, () => ui.done("t2", "Updated Sales!A5:D5 · no formula errors"));

    // format_range: currency.
    t += 1500;
    at(t, () => { ui.tool("t3", "format_range", "range", "Sales!B2:D5"); select(1, 1, 4, 3); formula("B2", "12400"); });
    at(t + 450, () => { for (let r = 1; r <= 4; r++) for (let c = 1; c <= 3; c++) setCell(r, c, money(+cellEl(r, c).textContent)); });
    at(t + 900, () => ui.done("t3", "Formatted Sales!B2:D5."));

    // format_range: header row.
    t += 1100;
    at(t, () => { ui.tool("t4", "format_range", "range", "Sales!A1:D1"); select(0, 0, 0, 3); formula("A1", "Month"); });
    at(t + 400, () => tbody.rows[0].classList.add("styled"));
    at(t + 800, () => ui.done("t4", "Formatted Sales!A1:D1."));

    // add_chart: revenue by month, placed at B7.
    t += 1000;
    at(t, () => { ui.tool("t5", "add_chart", "data_range", "Sales!A1:B4"); select(0, 0, 3, 1); });
    at(t + 550, () => { placeChart(); chart.classList.add("on"); cursor.classList.remove("on"); });
    at(t + 1050, () => ui.done("t5", "Chart placed at B7"));
    at(t + 1450, () => {
      ui.say("Done. Profit is in column D with totals in row 5, the numbers are formatted as currency, and a revenue chart sits below the table.");
      $("#clAvatar").classList.remove("on");
    });

    // Loop, but only while the demo is on screen.
    if (!reduce) at(t + 8000, () => (visible ? play() : (pending = true)));
  }

  let pending = false;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && pending) { pending = false; play(); }
  }).observe(split);

  document.querySelectorAll(".surfaces button").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    document.querySelectorAll(".surfaces button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    play();
  }));
  $("#replay").addEventListener("click", play);
  addEventListener("resize", () => {
    cursor.classList.remove("on");
    if (chart.classList.contains("on")) placeChart();
  });
  play();
})();
