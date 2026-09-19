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

  // Smooth FAQ accordion — eases open/close with height + opacity
  document.querySelectorAll(".faq__item").forEach((item) => {
    const summary = item.querySelector("summary");
    const body = item.querySelector(".faq__body");
    if (!summary || !body) return;

    summary.addEventListener("click", (e) => {
      e.preventDefault();
      if (item.dataset.busy === "1") return;
      item.dataset.busy = "1";

      const isOpen = item.hasAttribute("open");
      const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

      if (isOpen) {
        // CLOSE — start from current visible height, animate to 0
        const startH = body.offsetHeight;
        body.style.height = startH + "px";
        body.style.opacity = "1";
        body.style.overflow = "hidden";
        body.offsetHeight; // force reflow to commit the start height
        body.style.transition = `height 320ms ${EASE}, opacity 200ms ease`;
        body.style.height = "0px";
        body.style.opacity = "0";

        const onEnd = (ev) => {
          if (ev.propertyName !== "height") return;
          body.removeEventListener("transitionend", onEnd);
          item.removeAttribute("open");
          body.style.cssText = "";
          item.dataset.busy = "";
        };
        body.addEventListener("transitionend", onEnd);
      } else {
        // OPEN — wait one frame so the body is in layout, then measure
        item.setAttribute("open", "");
        requestAnimationFrame(() => {
          const targetH = body.scrollHeight;
          body.style.height = "0px";
          body.style.opacity = "0";
          body.style.overflow = "hidden";
          body.offsetHeight; // force reflow
          body.style.transition = `height 420ms ${EASE}, opacity 260ms ease`;
          body.style.height = targetH + "px";
          body.style.opacity = "1";

          const onEnd = (ev) => {
            if (ev.propertyName !== "height") return;
            body.removeEventListener("transitionend", onEnd);
            body.style.cssText = "";
            item.dataset.busy = "";
          };
          body.addEventListener("transitionend", onEnd);
        });
      }
    });
  });

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
