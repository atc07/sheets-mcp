// FAQ: on wide screens, questions on the left and the selected answer in a panel on the right.
// Built from the <details> list, which stays as the accordion on narrow screens and without JS.
(() => {
  const faq = document.querySelector(".faq");
  if (!faq) return;
  const items = [...faq.querySelectorAll("details")].map((d) => ({
    q: d.querySelector("summary").textContent,
    a: [...d.children].filter((el) => el.tagName !== "SUMMARY").map((el) => el.outerHTML).join(""),
  }));

  const split = document.createElement("div");
  split.className = "faq-split";
  split.innerHTML = `<div class="faq-list" role="tablist" aria-orientation="vertical" aria-label="Questions">${items
    .map((it, i) => `<button type="button" role="tab" id="faq-tab-${i}" aria-controls="faq-panel" aria-selected="false" tabindex="-1">${it.q}</button>`)
    .join("")}</div><div class="faq-panel" id="faq-panel" role="tabpanel" tabindex="0"><div class="faq-answer"></div>
    <p class="faq-more">Still have a question? <a href="mailto:privacy@sheetsmcp.io">Email us</a></p></div>`;
  faq.after(split);
  faq.closest("section").classList.add("faq-enhanced");

  const tabs = [...split.querySelectorAll('[role="tab"]')];
  const panel = split.querySelector(".faq-panel");
  const answer = split.querySelector(".faq-answer");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  function select(i, focus = false) {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", tabs[i].id);
    answer.innerHTML = `<h3>${items[i].q}</h3>${items[i].a}`;
    if (!reduce.matches) answer.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    if (focus) tabs[i].focus();
  }

  tabs.forEach((t, i) => t.addEventListener("click", () => select(i)));
  split.querySelector(".faq-list").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select((next + tabs.length) % tabs.length, true);
  });
  select(0);
})();
