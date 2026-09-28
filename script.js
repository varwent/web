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

  // Hero showreel — always loads paused (never autoplays). The visitor starts it
  // from the player's own Play button, which plays with sound.
  const video = document.querySelector("[data-showreel]");
  if (video) {
    const frame = video.closest(".showreel__frame");
    const playBtn = document.querySelector("[data-showreel-play]");
    const restartBtn = document.querySelector("[data-showreel-restart]");
    const seek = document.querySelector("[data-showreel-seek]");
    const soundBtn = document.querySelector("[data-showreel-sound]");
    let started = false;
    let userPaused = false;
    let scrubbing = false;

    const fmt = (t) => {
      t = Math.max(0, Math.floor(t || 0));
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    };

    const syncSound = () => {
      if (!soundBtn) return;
      soundBtn.setAttribute("aria-pressed", String(!video.muted));
      soundBtn.setAttribute("aria-label", video.muted ? "Unmute video" : "Mute video");
    };

    const syncPlay = () => {
      const playing = !video.paused && !video.ended;
      if (frame) frame.dataset.playing = String(playing);
      if (!playBtn) return;
      playBtn.setAttribute("aria-pressed", String(playing));
      playBtn.setAttribute("aria-label", playing ? "Pause video" : "Play video");
    };

    const syncSeek = () => {
      if (!seek || scrubbing) return;
      const d = video.duration;
      const ratio = d ? video.currentTime / d : 0;
      seek.value = String(Math.round(ratio * 1000));
      seek.style.setProperty("--p", `${ratio * 100}%`);
      seek.setAttribute("aria-valuetext", `${fmt(video.currentTime)} of ${fmt(d)}`);
    };

    // Smooth timeline while playing (timeupdate alone only fires ~4×/s)
    let raf = 0;
    const tick = () => {
      syncSeek();
      raf = video.paused ? 0 : requestAnimationFrame(tick);
    };
    video.addEventListener("play", () => {
      syncPlay();
      if (!raf) raf = requestAnimationFrame(tick);
    });
    video.addEventListener("pause", syncPlay);
    video.addEventListener("ended", syncPlay);
    ["timeupdate", "loadedmetadata", "seeked"].forEach((t) => video.addEventListener(t, syncSeek));
    video.addEventListener("volumechange", syncSound);

    const play = () => {
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    };

    video.addEventListener("play", () => (started = true), { once: true });

    // Pause off-screen; resume on return only if it was started and not paused by the visitor
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) video.pause();
          else if (started && video.paused && !userPaused) play();
        },
        { threshold: 0.25 }
      ).observe(video);
    }

    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (video.paused || video.ended) {
          userPaused = false;
          play();
        } else {
          userPaused = true;
          video.pause();
        }
      });
    }

    if (restartBtn) {
      restartBtn.addEventListener("click", () => {
        video.currentTime = 0;
        userPaused = false;
        syncSeek();
        play();
      });
    }

    if (seek) {
      const seekTo = () => {
        const d = video.duration;
        if (!d) return;
        const ratio = Number(seek.value) / 1000;
        video.currentTime = ratio * d;
        seek.style.setProperty("--p", `${ratio * 100}%`);
        seek.setAttribute("aria-valuetext", `${fmt(ratio * d)} of ${fmt(d)}`);
      };
      seek.addEventListener("pointerdown", () => (scrubbing = true));
      seek.addEventListener("input", seekTo);
      const endScrub = () => {
        scrubbing = false;
        syncSeek();
      };
      seek.addEventListener("pointerup", endScrub);
      seek.addEventListener("pointercancel", endScrub);
      seek.addEventListener("change", endScrub);
    }

    if (soundBtn) {
      soundBtn.addEventListener("click", () => {
        video.muted = !video.muted;
      });
    }

    syncPlay();
    syncSound();
    syncSeek();
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

  // "Let's talk" form — native <dialog>, posts to /api/lets-talk
  const talk = document.querySelector("[data-talk]");
  if (talk && typeof talk.showModal === "function") {
    const form = talk.querySelector("[data-talk-form]");
    const done = talk.querySelector("[data-talk-done]");
    const doneTitle = talk.querySelector("[data-talk-done-title]");
    const status = talk.querySelector("[data-talk-status]");
    const submit = form.querySelector('[type="submit"]');
    const submitLabel = form.querySelector("[data-talk-label]");
    const FALLBACK =
      'Couldn\'t send that just now. Please try again, or email <a href="mailto:varwent@gmail.com">varwent@gmail.com</a>.';
    let openedAt = 0;

    const setError = (name, text) => {
      const field = control(name);
      const slot = form.querySelector(`[data-error-for="${name}"]`);
      if (field) {
        if (text) {
          field.setAttribute("aria-invalid", "true");
          if (slot) {
            slot.id = slot.id || `talk-err-${name}`;
            field.setAttribute("aria-describedby", slot.id);
          }
        } else {
          field.removeAttribute("aria-invalid");
          field.removeAttribute("aria-describedby");
        }
      }
      if (slot) slot.textContent = text || "";
    };

    const FIELDS = ["name", "phone", "email", "businessType"];
    // Keep in sync with PHONE_LENGTHS in api/_lib/lead.js
    const PHONE_LENGTHS = {
      IN: [10, 10], US: [10, 10], CA: [10, 10], GB: [10, 10], AE: [9, 9], AU: [9, 9],
      SG: [8, 8], DE: [10, 11], SA: [9, 9], QA: [8, 8], KW: [8, 8], BH: [8, 8], OM: [8, 8],
      NP: [10, 10], BD: [10, 10], PK: [10, 10], LK: [9, 9], NZ: [8, 10], MY: [9, 10],
    };
    // Country code picker — [ISO code, name, dial code]; the first group is pinned to the top
    const POPULAR = [
      ["IN", "India", "+91"],
      ["US", "United States", "+1"],
      ["GB", "United Kingdom", "+44"],
      ["AE", "United Arab Emirates", "+971"],
      ["CA", "Canada", "+1"],
      ["AU", "Australia", "+61"],
      ["SG", "Singapore", "+65"],
      ["DE", "Germany", "+49"]
    ];
    const OTHERS = [
      ["AF", "Afghanistan", "+93"],
      ["AR", "Argentina", "+54"],
      ["AT", "Austria", "+43"],
      ["BH", "Bahrain", "+973"],
      ["BD", "Bangladesh", "+880"],
      ["BE", "Belgium", "+32"],
      ["BT", "Bhutan", "+975"],
      ["BR", "Brazil", "+55"],
      ["CL", "Chile", "+56"],
      ["CN", "China", "+86"],
      ["CO", "Colombia", "+57"],
      ["CZ", "Czechia", "+420"],
      ["DK", "Denmark", "+45"],
      ["EG", "Egypt", "+20"],
      ["FI", "Finland", "+358"],
      ["FR", "France", "+33"],
      ["GH", "Ghana", "+233"],
      ["GR", "Greece", "+30"],
      ["HK", "Hong Kong", "+852"],
      ["HU", "Hungary", "+36"],
      ["ID", "Indonesia", "+62"],
      ["IE", "Ireland", "+353"],
      ["IL", "Israel", "+972"],
      ["IT", "Italy", "+39"],
      ["JP", "Japan", "+81"],
      ["JO", "Jordan", "+962"],
      ["KE", "Kenya", "+254"],
      ["KW", "Kuwait", "+965"],
      ["MY", "Malaysia", "+60"],
      ["MV", "Maldives", "+960"],
      ["MU", "Mauritius", "+230"],
      ["MX", "Mexico", "+52"],
      ["MA", "Morocco", "+212"],
      ["NP", "Nepal", "+977"],
      ["NL", "Netherlands", "+31"],
      ["NZ", "New Zealand", "+64"],
      ["NG", "Nigeria", "+234"],
      ["NO", "Norway", "+47"],
      ["OM", "Oman", "+968"],
      ["PK", "Pakistan", "+92"],
      ["PH", "Philippines", "+63"],
      ["PL", "Poland", "+48"],
      ["PT", "Portugal", "+351"],
      ["QA", "Qatar", "+974"],
      ["RO", "Romania", "+40"],
      ["SA", "Saudi Arabia", "+966"],
      ["ZA", "South Africa", "+27"],
      ["KR", "South Korea", "+82"],
      ["ES", "Spain", "+34"],
      ["LK", "Sri Lanka", "+94"],
      ["SE", "Sweden", "+46"],
      ["CH", "Switzerland", "+41"],
      ["TW", "Taiwan", "+886"],
      ["TZ", "Tanzania", "+255"],
      ["TH", "Thailand", "+66"],
      ["TR", "Türkiye", "+90"],
      ["UG", "Uganda", "+256"],
      ["UA", "Ukraine", "+380"],
      ["VN", "Vietnam", "+84"]
    ];
    const COUNTRIES = [...POPULAR, ...OTHERS];
    const byCode = Object.fromEntries(COUNTRIES.map((c) => [c[0], c]));

    const picker = form.querySelector("[data-country-picker]");
    const countryInput = picker.querySelector("[data-country-value]");
    const trigger = picker.querySelector("[data-country-trigger]");
    const flagImg = picker.querySelector("[data-country-flag]");
    const dialOut = picker.querySelector("[data-talk-dial]");
    const panel = picker.querySelector("[data-country-panel]");
    const search = picker.querySelector("[data-country-search]");
    const list = picker.querySelector("[data-country-list]");
    const empty = picker.querySelector("[data-country-empty]");
    const flagSrc = (code) => `/assets/flags/${code.toLowerCase()}.svg`;
    const CHECK = '<svg class="talk__country-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

    const current = () => byCode[countryInput.value] || byCode.IN;
    const dialCode = () => current()[2];

    const setCountry = (code) => {
      const [iso, name, dial] = byCode[code] || byCode.IN;
      countryInput.value = iso;
      flagImg.src = flagSrc(iso);
      dialOut.textContent = dial;
      trigger.setAttribute("aria-label", `Country code: ${name} ${dial}`);
    };

    let visible = [];
    let active = -1;

    const renderList = () => {
      const q = search.value.trim().toLowerCase().replace(/^\+/, "");
      const match = (c) => !q || c[1].toLowerCase().includes(q) || c[2].slice(1).startsWith(q) || c[0].toLowerCase() === q;
      const groups = q ? [COUNTRIES.filter(match).sort((x, y) => x[1].localeCompare(y[1]))] : [POPULAR, OTHERS];
      visible = [];
      list.innerHTML = groups
        .map((g) =>
          g
            .map((c) => {
              visible.push(c[0]);
              const selected = c[0] === countryInput.value;
              return `<li role="option" id="country-opt-${c[0]}" data-code="${c[0]}" aria-selected="${selected}">` +
                `<img class="talk__flag" src="${flagSrc(c[0])}" alt="" width="20" height="15" loading="lazy" />` +
                `<span class="talk__country-name">${c[1]}</span>` +
                `<span class="talk__country-dial">${c[2]}</span>${selected ? CHECK : ""}</li>`;
            })
            .join("")
        )
        .join('<li class="talk__country-sep" role="presentation" aria-hidden="true"></li>');
      empty.hidden = visible.length > 0;
      setActive(q ? 0 : visible.indexOf(countryInput.value));
    };

    const setActive = (i) => {
      list.querySelector(".is-active")?.classList.remove("is-active");
      active = visible.length ? Math.max(0, Math.min(i, visible.length - 1)) : -1;
      if (active < 0) return search.removeAttribute("aria-activedescendant");
      const li = list.querySelector(`[data-code="${visible[active]}"]`);
      li.classList.add("is-active");
      search.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    };

    // Place the panel above the phone row (below only if there's clearly more room there)
    const phoneRow = picker.parentElement;
    const placePanel = () => {
      if (panel.hidden) return;
      const row = phoneRow.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewTop = vv ? vv.offsetTop : 0;
      const viewBottom = viewTop + (vv ? vv.height : window.innerHeight);
      const gap = 6;
      const edge = 12;
      const spaceAbove = row.top - viewTop - gap - edge;
      const spaceBelow = viewBottom - row.bottom - gap - edge;
      const up = spaceAbove >= 220 || spaceAbove >= spaceBelow;
      const searchH = panel.firstElementChild.offsetHeight || 46;
      list.style.maxHeight = `${Math.max(120, Math.min(280, (up ? spaceAbove : spaceBelow) - searchH - 14))}px`;
      panel.dataset.side = up ? "top" : "bottom";
      panel.style.left = `${row.left}px`;
      panel.style.width = `${row.width}px`;
      if (up) {
        panel.style.top = "";
        panel.style.bottom = `${window.innerHeight - row.top + gap}px`;
      } else {
        panel.style.bottom = "";
        panel.style.top = `${row.bottom + gap}px`;
      }
    };
    const scroller = talk.querySelector(".talk__panel");
    ["resize", "scroll"].forEach((t) => {
      window.addEventListener(t, placePanel, { passive: true });
      window.visualViewport?.addEventListener(t, placePanel, { passive: true });
    });
    scroller.addEventListener("scroll", placePanel, { passive: true });

    const openPicker = () => {
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      renderList();
      placePanel();
      // Keyboard/mouse users can type straight away; on touch, don't pop the keyboard over the list
      if (window.matchMedia("(hover: hover)").matches) search.focus({ preventScroll: true });
      const sel = list.querySelector('[aria-selected="true"]');
      if (sel) sel.scrollIntoView({ block: "nearest" });
    };
    const closePicker = (focusTrigger = true) => {
      if (panel.hidden) return;
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focusTrigger) trigger.focus();
    };
    const choose = (code) => {
      setCountry(code);
      closePicker(false);
      form.elements.phoneNumber.focus();
      form.dispatchEvent(new Event("input")); // re-check a flagged phone error
    };

    trigger.addEventListener("click", () => (panel.hidden ? openPicker() : closePicker()));
    search.addEventListener("input", renderList);
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Home") { e.preventDefault(); setActive(0); }
      else if (e.key === "End") { e.preventDefault(); setActive(visible.length - 1); }
      else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) choose(visible[active]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePicker(); }
      else if (e.key === "Tab") closePicker(false);
    });
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-code]");
      if (li) choose(li.dataset.code);
    });
    // Esc inside the picker closes only the picker, not the whole dialog
    talk.addEventListener("cancel", (e) => {
      if (!panel.hidden) {
        e.preventDefault();
        closePicker();
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!panel.hidden && !picker.contains(e.target)) closePicker(false);
    });

    // Best guess at the visitor's country: time zone first, then browser language
    (() => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const byTz = { "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dubai": "AE", "Asia/Singapore": "SG",
        "Europe/London": "GB", "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Europe/Berlin": "DE" };
      let cc = byTz[tz];
      if (!cc) {
        const region = ((navigator.language || "").split("-")[1] || "").toUpperCase();
        if (byCode[region]) cc = region;
        else if (tz.startsWith("America/")) cc = "US";
      }
      setCountry(cc || "IN");
    })();

    // Map a logical field to the control that should show the error / take focus
    const control = (name) =>
      name === "phone" ? form.elements.phoneNumber
      : name === "businessType" ? form.querySelector('input[name="businessType"]')
      : form.elements[name];

    const validate = () => {
      const errs = {};
      const { name, email, phoneNumber } = form.elements;
      const digits = phoneNumber.value.replace(/\D/g, "").replace(/^0+/, "");
      if (!name.value.trim()) errs.name = "Please add your name.";
      const [minLen, maxLen] = PHONE_LENGTHS[countryInput.value] || [6, 14];
      if (digits.length < minLen || digits.length > maxLen || digits.length + dialCode().length - 1 > 15) {
        errs.phone = "Please add a valid phone number.";
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) errs.email = "Please add a valid email.";
      if (!form.querySelector('input[name="businessType"]:checked')) errs.businessType = "Please pick your business type.";
      FIELDS.forEach((n) => setError(n, errs[n]));
      return errs;
    };

    const sub = talk.querySelector("[data-talk-sub]");
    const SUB_DEFAULT = sub.textContent;
    const SUB_DONE = "We\u2019ve got you, and we\u2019ll connect with you soon.";

    const openTalk = () => {
      if (talk.open) return;
      if (!done.hidden) {
        // Fresh form after a previous successful send
        form.reset();
        setCountry(countryInput.value);
        sub.textContent = SUB_DEFAULT;
        form.hidden = false;
        done.hidden = true;
      }
      status.innerHTML = "";
      // Clock for the server's bot check starts when a fresh form first opens,
      // so reopening a half-filled form never looks "too fast"
      if (!openedAt) openedAt = Date.now();
      talk.showModal();
      // Focus the first field on desktop; on touch, avoid popping the keyboard over the sheet
      if (window.matchMedia("(hover: hover)").matches) form.elements.name.focus();
    };

    const closeTalk = () => talk.close();

    talk.addEventListener("close", () => {
      closePicker(false);
      if (location.pathname.replace(/\/$/, "") === "/lets-talk" || location.hash === "#lets-talk") {
        history.replaceState(null, "", "/");
      }
    });

    document.querySelectorAll("[data-talk-open]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openTalk();
      });
    });
    talk.querySelectorAll("[data-talk-close]").forEach((el) => el.addEventListener("click", closeTalk));

    // Click on the dimmed backdrop closes (the dialog element itself is the backdrop hit area)
    talk.addEventListener("click", (e) => {
      if (e.target === talk) closeTalk();
    });

    // Clear a field's error as soon as it's fixed
    form.addEventListener("input", () => {
      // Once a field is flagged, clear its error as soon as it's valid (don't flag untouched ones)
      if (!form.querySelector('[aria-invalid="true"]')) return;
      const flagged = FIELDS.filter((n) => control(n)?.getAttribute("aria-invalid") === "true");
      const errs = validate();
      FIELDS.forEach((n) => setError(n, flagged.includes(n) ? errs[n] : ""));
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.innerHTML = "";
      const errs = validate();
      const first = Object.keys(errs)[0];
      if (first) {
        control(first).focus();
        return;
      }

      const fd = new FormData(form);
      const payload = {
        name: fd.get("name"),
        phoneCountry: fd.get("phoneCountry"),
        phoneCode: dialCode(),
        phoneNumber: fd.get("phoneNumber"),
        email: fd.get("email"),
        businessType: fd.get("businessType") || "",
        website: fd.get("website"),
        page: location.pathname + location.search,
        elapsedMs: Date.now() - openedAt,
      };

      submit.disabled = true;
      submitLabel.textContent = "Sending…";
      try {
        const res = await fetch("/api/lets-talk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          const firstName = String(payload.name).trim().split(/\s+/)[0];
          doneTitle.textContent = firstName ? `Thanks, ${firstName}!` : "Got it — thanks!";
          form.hidden = true;
          done.hidden = false;
          sub.textContent = SUB_DONE;
          openedAt = 0;
          talk.querySelector(".talk__panel").scrollTop = 0;
          doneTitle.focus();
        } else if (data.error === "validation" && data.fields) {
          Object.entries(data.fields).forEach(([k, v]) => setError(k, v));
          const k = Object.keys(data.fields)[0];
          if (control(k)) control(k).focus();
        } else if (res.status === 429) {
          status.innerHTML =
            'You\'ve sent a few already — we\'ll be in touch. Anything urgent: <a href="mailto:varwent@gmail.com">varwent@gmail.com</a>.';
        } else {
          status.innerHTML = FALLBACK;
        }
      } catch {
        status.innerHTML = FALLBACK;
      } finally {
        submit.disabled = false;
        submitLabel.textContent = "Send message";
      }
    });

    // Shareable link: varwent.com/lets-talk (or /#lets-talk) opens the form
    if (location.pathname.replace(/\/$/, "") === "/lets-talk" || location.hash === "#lets-talk") {
      openTalk();
    }
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
