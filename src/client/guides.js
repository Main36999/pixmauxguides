/**
 * guides.js — the Guides collection grid, its filters, and the
 * related-guides rail.
 * -----------------------------------------------------------------------
 * PHASE 3 bundle fragment — see the header of core.js for what that means.
 * Runs in core.js's scope and depends on it for GUIDES, state, the DOM
 * handles, cardHtml and showToast.
 *
 * Surfaces: guides/index.html (#grid-root and its toolbar — category chips,
 * search and the Level filter — guarded by hasGuideGrid — and each card's
 * Save once account Saved is launched — see drawCardSaves) and every /guide/
 * page (#guide-rail, and the hero's Save once account Saved is launched —
 * see initGuideSave).
 *
 * PHASE 4 STEP 2B — data-jump-category delegate removed
 *
 * Category links used to carry a data-jump-category attribute and
 * re-filter the guide grid in place instead of navigating. Once
 * /category/<slug> pages existed, every such link became a real
 * navigation and the attribute was dropped from the markup — see
 * build-categories.js's own "WHY THIS EXISTS" note. The document-level
 * click delegate that read it stayed behind.
 *
 * Verified before removal: zero .html files in the repo carry the
 * attribute, so the delegate could never fire. It only cost every page
 * that loads /app.js a document-level click listener running closest()
 * on every click anywhere in the document.
 *
 * Category filtering is unaffected: it runs off `state.category` through
 * the normal filter controls and through the /category/ pages.
 * -----------------------------------------------------------------------
 */

  function populateSelects() {
    var statCount = document.getElementById("stat-count");
    if (statCount) statCount.textContent = GUIDES.length;
  }

  // Same matching as the /fonts/ search (src/client/fonts.js): lower-cased,
  // hyphens and commas read as spaces, and every typed word must appear
  // somewhere in the guide's title, description or category label.
  function normalizeGuideQuery(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[-,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getFiltered() {
    var terms = normalizeGuideQuery(state.search).split(" ").filter(Boolean);
    return GUIDES.filter(function (g) {
      if (state.category !== "all" && g.category !== state.category)
        return false;
      if (state.level !== "all" && g.level !== state.level) return false;
      if (terms.length) {
        var hay = normalizeGuideQuery(
          g.title + " " + g.description + " " + CATEGORIES[g.category].label,
        );
        return terms.every(function (t) {
          return hay.indexOf(t) !== -1;
        });
      }
      return true;
    });
  }

  // ---------- related-guides rail (every /guide/ page) ----------
  // Every guide page ships a static, empty <aside id="guide-rail"> (see
  // the .guide-layout / .guide-primary wrapper added around the
  // article) plus a <body data-guide-id="..."> attribute identifying
  // which guide it is. initRelatedGuides() below fills that aside in
  // once GUIDES has loaded, so "related guides" is driven entirely by
  // guides.json — add/remove/recategorize a guide there and every
  // rail across the site picks it up automatically, with no per-page
  // related-guides list to hand-maintain (that's what used to live
  // directly in each guide's markup, and drifted between pages).

  // Same-category guides are the most relevant match (mirrors the
  // site's own category grouping); same-level is a lighter,
  // secondary signal. Ties keep guides.json's own order (Array#sort is
  // stable), which is also roughly the order guides were added in.
  function relatedGuides(current, count) {
    return GUIDES.filter(function (g) {
      return g.id !== current.id;
    })
      .map(function (g) {
        var score = 0;
        if (g.category === current.category) score += 2;
        if (g.level === current.level) score += 1;
        return { g: g, score: score };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, count)
      .map(function (x) {
        return x.g;
      });
  }

  function initRelatedGuides() {
    var rail = document.getElementById("guide-rail");
    if (!rail) return; // not a guide page (or an older page without one)

    var currentId = document.body.getAttribute("data-guide-id");
    var current = GUIDES.filter(function (g) {
      return g.id === currentId;
    })[0];

    // No match means either GUIDES failed to load or this guide was
    // retired from guides.json — either way there's nothing relevant
    // to show, so drop the empty section rather than leave a blank box.
    // Shows up to 10, laid out as a full-width row below the article —
    // reusing cardHtml() (the exact homepage content-card markup) instead
    // of a bespoke bordered/bracketed rail card, so "related guides"
    // reads as the same minimal card used everywhere else on the site.
    var related = current ? relatedGuides(current, 10) : [];
    if (!related.length) {
      rail.remove();
      return;
    }

    rail.innerHTML =
      '<span class="section-label mono guide-rail__label">/ related_guides</span>' +
      '<div class="grid guide-rail__list">' +
      related.map(cardHtml).join("") +
      "</div>";
  }

  function render() {
    if (!hasGuideGrid) return;
    var filtered = getFiltered();
    var cards = filtered.map(cardHtml);
    gridRoot.innerHTML = cards.join("");
    drawCardSaves();

    // The /fonts/ count line: the plain total when nothing is filtered out,
    // "Showing N of total" otherwise.
    var total = GUIDES.length;
    resultsCount.textContent =
      filtered.length === total
        ? total + " guides"
        : "Showing " + filtered.length + " of " + total + " guides";

    var q = state.search.trim();
    if (filtered.length === 0) {
      emptyState.setAttribute("data-visible", "true");
      emptyQuery.textContent = q ? '"' + q + '"' : "your current filters";
    } else {
      emptyState.removeAttribute("data-visible");
    }

    syncGuideControls();
    writeGuidesUrl();
  }

  // ---------- /guides toolbar: category chips, search, level ----------
  // Organised like the /fonts/ toolbar (src/client/fonts.js initListing):
  // aria-pressed chips, a search box that filters as you type, the filter
  // state kept in the query string (?category=&level=&q=) so a filtered
  // view can be shared or reloaded, and a debounced screen-reader summary.

  var guideChips = Array.prototype.slice.call(
    document.querySelectorAll(".guides-filter"),
  );
  var guideSearch = document.getElementById("guides-search");
  var guideStatus = document.getElementById("guides-status");
  var guideAnnounceTimer = null;

  function syncGuideControls() {
    guideChips.forEach(function (chip) {
      chip.setAttribute(
        "aria-pressed",
        String(chip.getAttribute("data-category") === state.category),
      );
    });
    if (levelSelect) levelSelect.value = state.level;
    if (guideSearch && guideSearch.value !== state.search) {
      guideSearch.value = state.search;
    }
  }

  function writeGuidesUrl() {
    var next = new URLSearchParams();
    if (state.category !== "all") next.set("category", state.category);
    if (state.level !== "all") next.set("level", state.level);
    if (state.search) next.set("q", state.search);
    var qs = next.toString();
    try {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? "?" + qs : "") + window.location.hash,
      );
    } catch (e) {
      /* file:// or a sandboxed frame — the filter still works */
    }
  }

  function announceGuides() {
    if (!guideStatus || !GUIDES.length) return;
    window.clearTimeout(guideAnnounceTimer);
    guideAnnounceTimer = window.setTimeout(function () {
      var shown = getFiltered().length;
      var where =
        state.category !== "all" && CATEGORIES[state.category]
          ? " in " + CATEGORIES[state.category].label
          : "";
      guideStatus.textContent =
        shown + " " + (shown === 1 ? "guide" : "guides") + " shown" + where;
    }, 400);
  }

  // Before guides.json arrives (or if it failed) GUIDES is empty and the
  // grid holds the build-time cards; rendering then would wipe them. The
  // state is kept, and init()'s first render() applies it.
  function updateGuides() {
    if (!GUIDES.length) {
      syncGuideControls();
      return;
    }
    render();
    announceGuides();
  }

  // Shared by the empty-state's "reset filters" button. Also clears any
  // query left in the header search inputs so a stale search term can't
  // silently keep filtering the grid after a reset.
  function resetFilters() {
    state = { search: "", category: "all", level: "all" };
    headerSearchForms.forEach(function (form) {
      var input = form.querySelector("input[type='search']");
      if (input) input.value = "";
    });
    render();
  }

  // The toolbar and the empty-state's #reset-filters button only exist on
  // the guide-grid page (guides/index.html) — this whole block is skipped
  // everywhere else instead of throwing on the missing elements.
  if (hasGuideGrid) {
    // Restore a shared/reloaded filter before the first render. Values
    // that don't name a real chip or level option are ignored.
    var guideParams = new URLSearchParams(window.location.search);
    var chipCategories = guideChips.map(function (chip) {
      return chip.getAttribute("data-category");
    });
    var levelValues = Array.prototype.map.call(
      levelSelect.options,
      function (option) {
        return option.value;
      },
    );
    if (chipCategories.indexOf(guideParams.get("category")) !== -1) {
      state.category = guideParams.get("category");
    }
    if (levelValues.indexOf(guideParams.get("level")) !== -1) {
      state.level = guideParams.get("level");
    }
    state.search = guideParams.get("q") || "";
    syncGuideControls();

    guideChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.category = chip.getAttribute("data-category");
        updateGuides();
      });
    });
    if (guideSearch) {
      guideSearch.addEventListener("input", function () {
        state.search = guideSearch.value;
        updateGuides();
      });
    }
    levelSelect.addEventListener("change", function (e) {
      state.level = e.target.value;
      updateGuides();
    });
    document
      .getElementById("reset-filters")
      .addEventListener("click", function () {
        resetFilters();
        showToast("Filters reset.");
        if (guideSearch) guideSearch.focus();
      });

    // The build-time cards get their Save now; render() draws it again on
    // the cards it replaces them with.
    drawCardSaves();
  }

  // ---------- Save on the /guides cards (account Saved) ----------
  // Once account Saved is launched (docs/SAVED.md), every card in the
  // /guides grid carries a Save button over its thumbnail's corner: one of
  // saved.js's controls, like the guide page's bookmark below (see
  // initGuideSave), so saved.js paints it, saves or removes on click, opens
  // sign-in when signed out and announces the outcome. Nothing in this
  // bundle handles its click. It is the bookmark alone, with no visible
  // text: its name is its aria-label, its state aria-pressed.
  //
  // It is drawn here, not in the shared cardHtml() (src/shared/card.js):
  // the build uses that renderer too, and the home, category and
  // related-guides cards stay without Save. The id comes from the card's
  // own link (/guide/<id>) and the name from its title, so the build-time
  // cards are covered before guides.json arrives, and if it never does.
  // The button is the link's sibling, above its stretched ::after
  // (styles.css), so a Save click never follows the link. While Saved is
  // dormant, off /guides, or for an id Saved wouldn't accept, nothing is
  // drawn.
  function drawCardSaves() {
    var saved = window.BpozzSaved;
    if (!hasGuideGrid || !saved || saved.active !== true) return;
    Array.prototype.forEach.call(
      gridRoot.querySelectorAll(".content-card"),
      function (card) {
        var link = card.querySelector(".card-link");
        if (!link || card.querySelector(".card-save-btn")) return;
        var match = /^\/guide\/([^/?#]+)$/.exec(
          link.getAttribute("href") || "",
        );
        if (!match || !saved.isValidItem("guide", match[1])) return;
        var name = link.textContent.replace(/\s+/g, " ").trim();
        card.insertAdjacentHTML(
          "beforeend",
          '<button type="button" class="card-save-btn" data-save-kind="guide" data-save-id="' +
            match[1] +
            '"' +
            (name ? ' data-save-name="' + escapeHtml(name) + '"' : "") +
            ' aria-pressed="false" aria-label="Save ' +
            (name ? escapeHtml(name) : "this guide") +
            '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>',
        );
      },
    );
    // The buttons just drawn are saved.js's from here.
    saved.sync(gridRoot);
  }

  // ---------- Save on a guide page (account Saved) ----------
  // Once account Saved is launched (docs/SAVED.md), the hero's meta line on
  // every /guide/ page ends in a bookmark that saves the guide to the
  // account. It is one of saved.js's controls (data-save-kind, -id and
  // -name): saved.js — bundled into /app.js ahead of these fragments, so
  // window.BpozzSaved is already published here — paints it, saves or
  // removes on click, opens sign-in when signed out and announces the
  // outcome. Nothing in this bundle handles its click.
  //
  // The id is the page's own <body data-guide-id> (guides.json's id, the
  // one the rail reads) and the name is its heading. Both are in the page
  // already, so the bookmark is drawn at once rather than after
  // guides.json loads. While Saved is dormant, on a page that isn't a
  // guide, or for an id Saved wouldn't accept, nothing is drawn.
  (function initGuideSave() {
    var saved = window.BpozzSaved;
    if (!saved || saved.active !== true) return;
    var meta = document.querySelector(".guide-hero .guide-hero__meta");
    var id = document.body.getAttribute("data-guide-id");
    if (!meta || !saved.isValidItem("guide", id)) return;
    var heading = document.querySelector(".guide-hero__title");
    var name = heading ? heading.textContent.replace(/\s+/g, " ").trim() : "";
    meta.insertAdjacentHTML(
      "beforeend",
      '<button type="button" class="guide-save-btn" data-save-kind="guide" data-save-id="' +
        id +
        '"' +
        (name ? ' data-save-name="' + escapeHtml(name) + '"' : "") +
        ' aria-pressed="false" aria-label="Save this guide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>',
    );
    // The bookmark just drawn is saved.js's from here.
    saved.sync(meta);
  })();

  // (A dead click delegate was removed here in Phase 4 Step 2B — see
  // this file's header.)
