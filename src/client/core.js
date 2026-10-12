/**
 * core.js — shared scaffolding for /app.js.
 * -----------------------------------------------------------------------
 * PHASE 3 (deduplication). app.js was one 1058-line IIFE holding five
 * unrelated concerns. It is now five files under src/client/, concatenated
 * back into a single /app.js by the build — the public URL, the load order
 * and the executed program are unchanged (see APP_BUNDLE in src/build.js).
 *
 * THIS FILE IS A BUNDLE FRAGMENT, NOT A MODULE. It is one slice of an IIFE
 * body: the opening `(function () {` and the closing `})();` are emitted by
 * the bundler, and the fragments share one function scope exactly as
 * they did when they were one file. That is deliberate — it is what makes
 * the split provably behaviour-preserving rather than a rewrite. Fragments
 * are never published individually and are never loaded by a <script> tag.
 *
 * BOOT ORDER. app.js called init() as its final statement; it is now the
 * final statement of this fragment instead, ahead of guides.js and the
 * rest. The two are equivalent: init()'s only synchronous work is setting
 * the "Loading guides…" label and starting fetch("/guides.json"), and
 * everything after its first await is queued as a microtask, which cannot
 * run until the whole assembled bundle — every later fragment's listener
 * registration included — has finished executing. Function declarations
 * in later fragments (render, populateSelects, initRelatedGuides) are
 * hoisted to the shared IIFE scope, so they are callable from here.
 *
 * SHARED RENDERERS. escapeHtml() and the Guide card used to be defined in
 * this file, as one of three byte-identical copies (app.js, build-home.js,
 * build-categories.js). They now come from src/shared/html.js and
 * src/shared/card.js, which the build emits ahead of these fragments. The
 * category thumbnails, icons, motifs and dimension labels moved with them;
 * CATEGORIES did not, because it is a label map and a runtime fetch of
 * categories.json was rejected (D1 A) — so the browser hands its literal
 * to the renderer.
 *
 * WHAT LIVES HERE
 *   category labels, the shared-renderer wiring, GUIDES, filter state,
 *   DOM handles, the toast, legacy hash redirects, the mobile menu, and
 *   the guides.json load + boot.
 *
 * WHAT MOVED OUT
 *   guides.js    grid rendering, filtering, the related-guides rail
 *   search.js    the header quick-search forms
 *   contact.js   the in-app contact form (deleted in Issue #19: #/contact
 *                now redirects to /contact, which has its own form script)
 *   roadmap.js   roadmap progress checkboxes
 *   html.js      escapeHtml            (src/shared/, deduplicated)
 *   card.js      the Guide card + category metadata (src/shared/, ditto)
 * -----------------------------------------------------------------------
 */

  var CATEGORIES = {
    "color-theory": { label: "Color Theory" },
    typography: { label: "Typography" },
    spacing: { label: "Spacing & Layout" },
    figma: { label: "Figma Workflow" },
    "adobe-xd": { label: "Adobe XD Workflow" },
    mobile: { label: "Mobile App Design" },
    web: { label: "Web Layout" },
    systems: { label: "Design Systems" },
    accessibility: { label: "Accessibility" },
    motion: { label: "Prototyping & Motion" },
  };

  // Shared renderers — src/shared/html.js + card.js (see file header).
  var escapeHtml = BpozzHtml.escapeHtml;
  var cardRenderer = BpozzCard.createRenderer({ categories: CATEGORIES });
  var cardHtml = cardRenderer.cardHtml;
  var thumbHtml = cardRenderer.thumbHtml;
  var thumbMediaHtml = cardRenderer.thumbMediaHtml;

  // Each guide's `thumbnail` points to a local image file (any web
  // image format) that sits in a "thumbnail_image_webp" folder next to
  // index.html. It's used for the card thumbnail on the guide list
  // below. If the file at that path doesn't exist yet, the card
  // automatically falls back to this category's blueprint-style SVG
  // icon (THUMBS in src/shared/card.js) — so the site never shows a broken
  // image.
  // (The same fallback pattern is used for each guide's own hero
  // image too, but that markup now lives directly in each guide's
  // static page under /guide/ rather than being rendered here.)
  //
  // The guide data itself now lives in guides.json (fetched below by
  // loadGuides()) instead of being hardcoded here. GUIDES starts empty
  // and is populated once that fetch resolves.
  var GUIDES = [];

  var state = { search: "", category: "all", level: "all" };

  var gridRoot = document.getElementById("grid-root");
  var resultsCount = document.getElementById("results-count");
  var emptyState = document.getElementById("empty-state");
  var emptyQuery = document.getElementById("empty-query");
  var levelSelect = document.getElementById("level-select");
  var toast = document.getElementById("toast");
  var toastTimer = null;
  var homeView = document.getElementById("home-view");

  // Two separate questions, two flags (Phase 6):
  //   hasGuideGrid — does this page carry the guide grid + filters
  //     (#grid-root, #level-select, #results-count, #empty-state,
  //     #reset-filters)? Since Phase 6 that is the Guides collection,
  //     guides/index.html. Grid rendering, the Level filter, the
  //     loading/empty/error states and reset all check this.
  //   isHomePage — is this the homepage (index.html, the only page with
  //     #home-view)? Only the homepage's legacy hash routes
  //     (#/guide/<id>, #/about|contact, #roadmap) check
  //     this, so they keep working now that the homepage has no grid,
  //     and never fire on /guides.
  // Guide pages (/guide/*.html), search, palettes and roadmap load this
  // same app.js for the shared header search and have neither. The
  // standalone about/contact/privacy/terms pages do not load app.js.
  var hasGuideGrid = !!gridRoot;
  var isHomePage = !!homeView;

  // --- Shared card-thumbnail renderer export ---------------------------
  // The same category thumbnail the build-time grids draw
  // (src/shared/card.js), as a global. search.js, which this was exported
  // for, now takes thumbHtml from this bundle's shared scope instead; the
  // global is kept, name and shape unchanged, for compatibility.
  //
  // This assignment runs while the IIFE body executes, before init()
  // at the bottom of this file, so the global is in place regardless of
  // what init() finds (or doesn't find) on the page.
  //
  // Callers pass a guides.json-shaped object: { category, title,
  // thumbnail? }. With no `thumbnail` the renderer returns the category
  // SVG on its own, which is exactly the base layer it already draws
  // under guide images elsewhere.
  window.BpozzCards = {
    thumbMediaHtml: thumbMediaHtml,
    thumbHtml: thumbHtml,
  };

  function showToast(message) {
    toast.textContent = message;
    toast.setAttribute("data-visible", "true");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.removeAttribute("data-visible");
    }, 2600);
  }

  // Exposed globally so other page-specific scripts can reuse this exact
  // toast element and timing instead of re-implementing their own. The
  // /tokens/* scripts that used it are gone. Guarded on `toast`
  // existing at all, since every page that loads app.js also ships the
  // shared <div class="toast" id="toast">.
  if (toast) {
    window.bpozzShowToast = showToast;
  }

  // ---------- legacy hash routes ----------
  // Every guide and static page lives at its own URL. The homepage used
  // to render some of them in place from hash links; handleRoute() below
  // now only redirects those old links to the real pages.

  // Guide ids that have since been renamed to a more descriptive slug
  // (e.g. "g6" -> "whitespace-as-ui-component"). Kept so an old
  // #/guide/<old-id> bookmark or shared link still resolves to
  // today's file instead of silently falling back to the guide list.
  // /guide/g6.html itself (the old crawlable URL, as opposed to this
  // in-app hash route) redirects separately, with a real HTTP 301 in
  // public/_redirects (and public/_htaccess).
  var LEGACY_GUIDE_IDS = {
    g6: "whitespace-as-ui-component",
  };

  // Guides used to be rendered in place at #/guide/<id>. They now
  // each have their own real, crawlable page at /guide/<id> (the
  // underlying file is still <id>.html on disk; the host rewrites the
  // extensionless URL to it), so an old bookmarked or shared
  // #/guide/<id> link is redirected there instead of being rendered
  // inside the SPA. Unrecognized ids (e.g.
  // a link to one of the guides retired from GUIDES/guides.json) fall
  // back to the guide list (/guides) rather than redirecting to a 404.
  function handleRoute() {
    if (!isHomePage) return;
    var hash = location.hash;
    // The learning roadmap used to be a section of this page (#roadmap)
    // and is now its own real, crawlable file — send an old bookmarked
    // or shared index.html#roadmap link there instead of landing on a
    // dead fragment now that the section itself is gone.
    if (hash === "#roadmap") {
      location.replace("/roadmap");
      return;
    }
    var guideMatch = hash.match(/^#\/guide\/([\w-]+)$/);
    if (guideMatch) {
      var id = LEGACY_GUIDE_IDS[guideMatch[1]] || guideMatch[1];
      var exists = GUIDES.some(function (g) {
        return g.id === id;
      });
      location.replace(exists ? "/guide/" + id : "/guides/");
      return;
    }
    // About and Contact were rendered in place at #/about and #/contact,
    // from a copy that had drifted from about.html and contact.html. An old
    // link now goes to the real page, the same way #roadmap does (Issue
    // #19). #/privacy and #/terms never redirected: they leave the homepage
    // as it is.
    var pageMatch = hash.match(/^#\/(about|contact)$/);
    if (pageMatch) {
      location.replace("/" + pageMatch[1]);
    }
  }

  window.addEventListener("hashchange", handleRoute);

  // The mobile menu is wired by the script at the end of the header itself
  // (partials/header.html), on every page; it used to be repeated here.

  // ---------- homepage explore strip ----------
  // Its rows are overflow-hidden marquees; keyboard focus stops a row
  // (styles.css). A browser only scrolls a focused link into view when it
  // is wholly hidden, so one straddling the row's edge would stay half
  // clipped: scroll it in here. When focus leaves a row, its scroll resets
  // so the restarted loop lines up again. Mouse focus is left alone.
  var exploreStrip = document.querySelector(".explore");
  if (exploreStrip) {
    exploreStrip.addEventListener("focusin", function (e) {
      if (e.target.matches(":focus-visible")) {
        e.target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
    exploreStrip.addEventListener("focusout", function (e) {
      var row = e.target.closest(".explore__row");
      if (row && !row.contains(e.relatedTarget)) row.scrollLeft = 0;
    });
  }

  // ---------- homepage hero headline: typing loop ----------
  // The headline is held, deleted letter by letter, and typed again, on a
  // slow loop. It never leaves the page: its text is split into the typed
  // part and a transparent remainder, so the whole sentence is always laid
  // out — same size, same line breaks, nothing shifts — and assistive
  // technology always reads it in full; only the colour of the untyped
  // letters changes. The thin cursor sits after all of the text and is
  // moved (transform) to the end of the typed part: any box between the
  // two parts, even an out-of-flow one, splits the text for shaping and
  // drops the kerning pair across it, nudging centred lines by up to half
  // a pixel. After the text it touches nothing. The loop opens on the complete
  // sentence after the fade-up entrance, stops while the hero is off
  // screen, and never runs under reduced motion (the markup then stays as
  // it shipped).
  (function heroTyping() {
    var title = document.querySelector(".hero h1");
    if (!title || !window.matchMedia) return;
    var TYPE_MS = 90;
    var DELETE_MS = 50;
    var HOLD_MS = 2000;
    var GAP_MS = 500;
    var FIRST_HOLD_MS = HOLD_MS + 600; // lets the 0.6s fade-up finish first
    var text = title.textContent.trim();
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    var typed = null;
    var rest = null;
    var cursor = null;
    var timer = null;
    var onScreen = true;
    var started = false;
    var shown = text.length;
    var phase = "hold";

    function render() {
      typed.textContent = text.slice(0, shown);
      rest.textContent = text.slice(shown);
      place();
    }
    // Right after the last typed letter (or just before the first letter
    // while nothing is typed), centred on that letter's line.
    function place() {
      var node = shown ? typed.firstChild : rest.firstChild;
      if (!node) return;
      var range = document.createRange();
      range.setStart(node, shown ? shown - 1 : 0);
      range.setEnd(node, shown ? shown : 1);
      var rects = range.getClientRects();
      var letter = shown ? rects[rects.length - 1] : rects[0];
      if (!letter) return;
      var box = title.getBoundingClientRect();
      var gap = parseFloat(getComputedStyle(title).fontSize) * 0.05;
      var x = shown ? letter.right - box.left + gap : letter.left - box.left - gap - cursor.offsetWidth;
      var y = letter.top - box.top + (letter.height - cursor.offsetHeight) / 2;
      cursor.style.transform = "translate(" + x + "px, " + y + "px)";
    }
    function build() {
      if (typed) return;
      typed = document.createElement("span");
      rest = document.createElement("span");
      cursor = document.createElement("span");
      rest.className = "hero-type__rest";
      cursor.className = "hero-type__cursor";
      cursor.setAttribute("aria-hidden", "true");
      title.textContent = "";
      title.classList.add("hero-type");
      title.appendChild(typed);
      title.appendChild(rest);
      title.appendChild(cursor);
      render();
      // re-wrapping (resize, late web font) moves the letters under it
      window.addEventListener("resize", place);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    }
    function next(ms) {
      timer = setTimeout(tick, ms);
    }
    function tick() {
      if (phase === "hold") phase = "delete";
      else if (phase === "gap") phase = "type";
      shown += phase === "delete" ? -1 : 1;
      render();
      if (phase === "delete" && shown === 0) {
        phase = "gap";
        title.classList.remove("is-typing");
        return next(GAP_MS);
      }
      if (phase === "type" && shown === text.length) {
        phase = "hold";
        title.classList.remove("is-typing");
        return next(HOLD_MS);
      }
      title.classList.add("is-typing");
      next(phase === "delete" ? DELETE_MS : TYPE_MS);
    }
    function stop() {
      clearTimeout(timer);
      timer = null;
      if (!typed) return;
      shown = text.length;
      phase = "hold";
      title.classList.remove("is-typing");
      render();
    }
    function start() {
      if (timer || reduced.matches || !onScreen) return;
      build();
      next(started ? HOLD_MS : FIRST_HOLD_MS);
      started = true;
    }

    if (reduced.addEventListener) {
      reduced.addEventListener("change", function () {
        if (reduced.matches) stop();
        else start();
      });
    }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) start();
        else stop();
      }).observe(title);
    }
    start();
  })();

  // ---------- data loading ----------
  // Guide data lives in guides.json, fetched here with async/await
  // instead of being hardcoded in this file. Everything that depends
  // on GUIDES (rendering, search, filtering, routing) waits for this
  // fetch to resolve before it runs for the first time.
  async function loadGuides() {
    // Absolute path: this file is now loaded from nested pages too
    // (e.g. /guide/whitespace-as-ui-component.html), where a relative
    // "guides.json" would
    // resolve to /guide/guides.json and 404.
    const response = await fetch("/guides.json");
    if (!response.ok) {
      throw new Error(
        "Failed to load guides.json (HTTP " + response.status + ")",
      );
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("guides.json did not contain an array");
    }
    return data;
  }

  function renderLoadError() {
    if (!hasGuideGrid) return;
    // guides/index.html ships with the guide grid pre-rendered at build
    // time (see src/build/home.js) as a static fallback for crawlers, no-
    // JS visitors, and this exact case. If that pre-rendered markup
    // is already sitting in the DOM, keep it visible instead of
    // wiping a working page just because the *live* refresh failed —
    // search/filtering won't work against fresh data, but the guides
    // themselves are still right there.
    if (gridRoot.children.length > 0) {
      resultsCount.textContent =
        "Showing guides (couldn't refresh — search & filtering unavailable).";
      return;
    }
    gridRoot.innerHTML = "";
    resultsCount.textContent = "Couldn't load guides.";
    emptyState.setAttribute("data-visible", "true");
    emptyQuery.textContent =
      "a problem loading guides.json — check the console and try refreshing";
  }

  async function init() {
    // Pages without the guide grid load this same app.js for the shared
    // header search + mobile menu behavior but have no grid/results UI to
    // report loading progress on, so this is skipped there — see the
    // hasGuideGrid checks inside render() and renderLoadError(), and the
    // isHomePage check inside handleRoute(). guides.json itself is still
    // fetched on every page: guide pages' related-guides rail and the
    // homepage's #/guide/<id> redirect both need it.
    if (hasGuideGrid) resultsCount.textContent = "Loading guides…";
    try {
      GUIDES = await loadGuides();
    } catch (err) {
      console.error(err);
      populateSelects();
      renderLoadError();
      handleRoute();
      initRelatedGuides();
      return;
    }

    populateSelects();
    render();
    handleRoute();
    initRelatedGuides();
  }

  // Boot. Safe ahead of the later fragments — see BOOT ORDER in the header.
  init();
