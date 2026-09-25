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

  // Mobile menu
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");
  if (nav && navToggle && navMenu) {
    const setMenu = (open) => {
      nav.dataset.menuOpen = open ? "true" : "false";
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    setMenu(false);
    navToggle.addEventListener("click", () => {
      setMenu(nav.dataset.menuOpen !== "true");
    });
    navMenu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setMenu(false));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.dataset.menuOpen === "true") {
        setMenu(false);
        navToggle.focus();
      }
    });
    document.addEventListener("click", (e) => {
      if (nav.dataset.menuOpen === "true" && !nav.contains(e.target)) setMenu(false);
    });
    window.matchMedia("(min-width: 821px)").addEventListener("change", (e) => {
      if (e.matches) setMenu(false);
    });
  }

  // Hero showreel — starts with sound on. Browsers block unmuted autoplay
  // until the visitor interacts, so fall back to muted and switch the sound
  // on at the first tap/click/keypress (unless they muted it themselves).
  const video = document.querySelector("[data-showreel]");
  const soundBtn = document.querySelector("[data-showreel-sound]");
  if (video) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let userMuted = false;

    const syncBtn = () => {
      if (!soundBtn) return;
      soundBtn.setAttribute("aria-pressed", String(!video.muted));
      soundBtn.setAttribute("aria-label", video.muted ? "Unmute video" : "Mute video");
    };

    const play = () => {
      const wantSound = !userMuted;
      video.muted = !wantSound;
      const p = video.play();
      if (!p || !p.catch) return syncBtn();
      p.then(syncBtn).catch(() => {
        if (!wantSound) return syncBtn();
        video.muted = true;
        syncBtn();
        video.play().catch(() => {});
      });
    };

    const unlock = (e) => {
      if (soundBtn && soundBtn.contains(e.target)) return;
      ["pointerdown", "keydown", "touchend"].forEach((t) =>
        document.removeEventListener(t, unlock, true)
      );
      if (userMuted || !video.muted) return;
      video.muted = false;
      video.play().then(syncBtn).catch(() => {
        video.muted = true;
        syncBtn();
      });
    };

    if (reduceMotion) {
      video.removeAttribute("autoplay");
      video.pause();
      video.muted = false;
      video.controls = true;
      if (soundBtn) soundBtn.hidden = true;
    } else {
      ["pointerdown", "keydown", "touchend"].forEach((t) =>
        document.addEventListener(t, unlock, true)
      );
      play();
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              if (video.paused) play();
            } else {
              video.pause();
            }
          },
          { threshold: 0.25 }
        ).observe(video);
      }
    }

    if (soundBtn) {
      soundBtn.addEventListener("click", () => {
        video.muted = !video.muted;
        userMuted = video.muted;
        if (!video.muted && video.paused) video.play().catch(() => {});
        syncBtn();
      });
    }
  }

  // Team cards — tap to swap the front for a short work history
  const members = Array.from(document.querySelectorAll("[data-member]"));
  const setMember = (card, open) => {
    const btn = card.querySelector(".member__toggle");
    const front = card.querySelector(".member__face--front");
    const back = card.querySelector(".member__face--back");
    card.dataset.open = open ? "true" : "false";
    if (btn) btn.setAttribute("aria-expanded", String(open));
    [[back, open], [front, !open]].forEach(([face, visible]) => {
      if (!face) return;
      face.inert = !visible;
      face.setAttribute("aria-hidden", String(!visible));
    });
  };
  members.forEach((card) => {
    const btn = card.querySelector(".member__toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const open = card.dataset.open !== "true";
      if (open) members.forEach((c) => c !== card && c.dataset.open === "true" && setMember(c, false));
      setMember(card, open);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    members.forEach((c) => c.dataset.open === "true" && setMember(c, false));
  });

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
