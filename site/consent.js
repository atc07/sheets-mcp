// Analytics consent banner for EU/EEA/UK visitors (same approach as rewriteapp.io).
//
// The inline gtag snippet in each page's <head> sets analytics_storage to "denied" for
// EU/EEA/UK visitors (Google enforces that region list by IP) and "granted" elsewhere.
// This file only decides whether to *show* the banner, by timezone, which over-shows
// slightly (Switzerland, Turkey…): the safe direction. The choice is kept in localStorage
// (strictly necessary, exempt from consent) and replayed by the inline snippet, so we
// never ask twice. Any [data-consent-reset] link reopens the banner.
(() => {
  const KEY = "sm_consent";

  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  })();
  const euLike =
    /^Europe\//.test(tz) ||
    /^Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe|Faeroe)$/.test(tz) ||
    /^Asia\/(Nicosia|Famagusta)$/.test(tz) || // Cyprus
    /^(America\/(Cayenne|Guadeloupe|Martinique|Miquelon|Marigot|St_Barthelemy)|Indian\/(Reunion|Mayotte))$/.test(tz); // French overseas

  function show() {
    if (document.getElementById("consent")) return;
    const box = document.createElement("div");
    box.id = "consent";
    box.className = "consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Analytics cookies");
    box.innerHTML =
      '<p>We use Google Analytics to count visits to this website. Allow an analytics cookie? The app itself has no analytics. <a href="/privacy">Privacy policy</a></p>' +
      '<div class="consent-row"><button class="btn btn-primary btn-sm" type="button" data-choice="granted">Allow</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-choice="denied">No thanks</button></div>';
    box.addEventListener("click", (e) => {
      const choice = e.target.closest("[data-choice]")?.dataset.choice;
      if (!choice) return;
      try {
        localStorage.setItem(KEY, choice);
      } catch {}
      if (typeof gtag === "function") gtag("consent", "update", { analytics_storage: choice });
      box.remove();
    });
    document.body.append(box);
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-consent-reset]")) return;
    e.preventDefault();
    show();
  });

  let decided = false;
  try {
    decided = !!localStorage.getItem(KEY);
  } catch {}
  if (euLike && !decided) show();
})();
