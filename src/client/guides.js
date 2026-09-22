/**
 * guides.js — the Guides collection grid, its filters, and the
 * related-guides rail.
 * -----------------------------------------------------------------------
 * PHASE 3 bundle fragment — see the header of core.js for what that means.
 * Runs in core.js's scope and depends on it for GUIDES, state, the DOM
 * handles, cardHtml and showToast.
 *
 * Surfaces: guides/index.html (#grid-root and the Level filter, guarded by
 * hasGuideGrid) and every /guide/ page (#guide-rail).
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

  function getFiltered() {
    var q = state.search.trim().toLowerCase();
    return GUIDES.filter(function (g) {
      if (state.category !== "all" && g.category !== state.category)
        return false;
      if (state.level !== "all" && g.level !== state.level) return false;
      if (q) {
        var hay = (
          g.title +
          " " +
          g.description +
          " " +
          CATEGORIES[g.category].label
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
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

    var q = state.search.trim();
    if (q) {
      // Once a search term is active there's no fixed "total" to show
      // it against (unlike browsing a category), so report a plain
      // count-for-query instead — e.g. `12 Results for "grid"`, or
      // `0 Results for "asdf"` when nothing matches.
      resultsCount.textContent =
        filtered.length +
        " Result" +
        (filtered.length === 1 ? "" : "s") +
        ' for "' +
        q +
        '"';
    } else {
      resultsCount.textContent =
        "Showing " + filtered.length + " of " + GUIDES.length + " guides";
    }

    if (filtered.length === 0) {
      emptyState.setAttribute("data-visible", "true");
      emptyQuery.textContent = q ? '"' + q + '"' : "your current filters";
    } else {
      emptyState.removeAttribute("data-visible");
    }
  }

  // Shared by the empty-state's "reset filters" button. Also clears any
  // query left in the header search inputs so a stale search term can't
  // silently keep filtering the grid after a reset.
  function resetFilters() {
    state = { search: "", category: "all", level: "all" };
    if (levelSelect) levelSelect.value = "all";
    headerSearchForms.forEach(function (form) {
      var input = form.querySelector("input[type='search']");
      if (input) input.value = "";
    });
    render();
  }

  // The level filter (#level-select) and the empty-state's #reset-filters
  // button only exist on the guide-grid page (guides/index.html) — this
  // whole block is skipped everywhere else instead of throwing on the
  // missing elements.
  if (hasGuideGrid) {
    levelSelect.addEventListener("change", function (e) {
      state.level = e.target.value;
      render();
    });
    document
      .getElementById("reset-filters")
      .addEventListener("click", function () {
        resetFilters();
        showToast("Filters reset.");
      });
  }

  // (A dead click delegate was removed here in Phase 4 Step 2B — see
  // this file's header.)
