// Hero demo timeline + copy buttons.
// Motion follows transform/opacity/clip-path only, strong ease-out, reduced-motion fallback.
(() => {
  const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
  const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- copy buttons ----------
  document.querySelectorAll(".copy").forEach((btn) => {
    let timer;
    btn.addEventListener("click", async () => {
      const text = btn.parentElement.querySelector("pre").textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      btn.classList.add("copied");
      btn.setAttribute("aria-label", "Copied");
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove("copied");
        btn.setAttribute("aria-label", "Copy command");
      }, 1600);
    });
  });

  // ---------- demo ----------
  const demo = document.getElementById("demo");
  if (!demo || !("animate" in Element.prototype)) return;

  // Split the prompt into words so it can stream in.
  const prompt = demo.querySelector("[data-type]");
  const words = prompt.textContent.trim().split(/\s+/);
  prompt.textContent = "";
  const wordEls = words.map((w, i) => {
    const s = document.createElement("span");
    s.textContent = w;
    s.style.display = "inline-block";
    prompt.append(s, i < words.length - 1 ? " " : "");
    return s;
  });

  // First layers of multi-state cells start visible (CSS hides them for the no-JS final state).
  demo.querySelectorAll(".cell").forEach((cell) => {
    const first = cell.querySelector(".v");
    if (cell.querySelectorAll(".v").length > 1) first.style.opacity = "1";
  });
  const replay = demo.querySelector(".replay");
  replay.hidden = false;

  function build(reduce) {
    const anims = [];
    const add = (el, keyframes, delay, duration, fill = "both", easing = EASE_OUT) =>
      anims.push(el.animate(keyframes, { delay, duration, fill, easing }));

    const fade = [{ opacity: 0 }, { opacity: 1 }];
    const enter = reduce ? fade : [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }];
    const swapIn = reduce ? fade : [{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0px)" }];
    const swapOut = [...swapIn].reverse();

    // Prompt streams in word by word.
    wordEls.forEach((w, i) => add(w, swapIn, 150 + i * 35, 240));

    // Status ticker: new status rises in, previous one fades out upward.
    const statuses = [...demo.querySelectorAll(".status")];
    statuses.forEach((s, i) => {
      const at = +s.dataset.at;
      add(s, reduce ? fade : [{ opacity: 0, transform: "translateY(6px)", filter: "blur(2px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], at, 260);
      const next = statuses[i + 1];
      if (next) {
        add(s, reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px)" }], +next.dataset.at, 180, "forwards");
      }
    });

    // Elements that enter: new cells, header tint, chart card, replay button.
    demo.querySelectorAll("[data-in]").forEach((el) => {
      const at = +el.dataset.in;
      if (el.classList.contains("tint")) add(el, fade, at, 300, "both", "ease");
      else if (el.hasAttribute("data-pop")) {
        add(el, reduce ? fade : [{ opacity: 0, transform: "translateY(8px) scale(0.97)" }, { opacity: 1, transform: "none" }], at, 450);
      } else add(el, enter, at, 300);
    });

    // Cell value changes (formula -> result -> currency) crossfade with a touch of blur.
    demo.querySelectorAll(".cell").forEach((cell) => {
      const layers = [...cell.querySelectorAll(".v")];
      layers.forEach((v, i) => {
        if (i > 0) add(v, swapIn, +v.dataset.at, 220);
        if (i < layers.length - 1) add(v, swapOut, +layers[i + 1].dataset.at, 220, "forwards");
      });
    });

    // Chart bars grow from the baseline.
    demo.querySelectorAll("[data-grow]").forEach((bar) => {
      add(bar, reduce ? fade : [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)" }], +bar.dataset.grow, 600);
    });

    return anims;
  }

  let anims = build(reduceQuery.matches);
  anims.forEach((a) => a.pause());

  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        anims.forEach((a) => a.play());
        io.disconnect();
      }
    },
    { threshold: 0.35 },
  );
  io.observe(demo);

  replay.addEventListener("click", () => {
    io.disconnect();
    anims.forEach((a) => a.cancel());
    anims = build(reduceQuery.matches);
  });
})();
