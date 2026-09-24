// Copy buttons and the app showcase loops. The hero demo lives in hero.js.
(() => {
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

  // ---------- app showcases: only run the CSS loops while on screen ----------
  const shows = document.querySelectorAll(".show");
  if (shows.length && "IntersectionObserver" in window) {
    shows.forEach((s) => s.classList.add("paused"));
    const showIo = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle("paused", !e.isIntersecting));
    });
    shows.forEach((s) => showIo.observe(s));
  }
})();
