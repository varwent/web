(() => {
  const nav = document.querySelector("[data-nav]");
  const yearEl = document.getElementById("year");

  if (yearEl) yearEl.textContent = new Date().getFullYear();

  if (nav) {
    const setScrolled = () => {
      nav.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
    };
    setScrolled();
    window.addEventListener("scroll", setScrolled, { passive: true });
  }

  const targets = [
    ".badge",
    ".hero__title",
    ".hero__sub",
    ".hero__ctas",
    ".hero__bullets",
    ".hero__visual",
    ".section-head",
    ".showreel__frame",
    ".team__grid",
    ".bento",
    ".process__list",
    ".why__grid",
    ".reviews__grid",
    ".faq__list",
    ".cta__card",
    ".footer__grid",
  ];
  const els = targets.flatMap((sel) => Array.from(document.querySelectorAll(sel)));

  const seen = new WeakSet();
  els.forEach((el, i) => {
    if (seen.has(el)) return;
    seen.add(el);
    el.classList.add("reveal");
    el.style.transitionDelay = `${Math.min(i, 6) * 60}ms`;
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
    els.forEach((el) => io.observe(el));
  } else {
    els.forEach((el) => el.classList.add("is-visible"));
  }

  const form = document.querySelector("[data-footer-form]");
  const msg = document.querySelector("[data-footer-msg]");
  if (form && msg) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      if (!input || !input.checkValidity()) return;
      msg.hidden = false;
      input.value = "";
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
