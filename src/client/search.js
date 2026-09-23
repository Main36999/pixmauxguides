/**
 * search.js — the header quick-search forms, and the /search results page.
 * -----------------------------------------------------------------------
 * PHASE 3 bundle fragment — see the header of core.js for what that means.
 *
 * TWO CONCERNS, BOTH SEARCH
 *
 *   headerSearchForms   the handle on the header/hero search forms that
 *                       resetFilters() in guides.js uses to blank a stale
 *                       query. There is no submit handler and there never
 *                       was one — the forms are plain HTML GETs
 *                       (action="/search", method="get", input name="s"),
 *                       so submitting one is an ordinary navigation to
 *                       /search?s=... from any page, including that one.
 *
 *   initSearchPage()    the /search results page itself: query parsing,
 *                       relevance scoring, the type/category filters, URL
 *                       sync and result-card rendering.
 *
 * PHASE 4 STEP 5 — THE SEARCH PAGE MOVED HERE
 *
 * Until this step the second one did not exist. The whole results
 * implementation was a ~580-line inline <script> at the bottom of
 * search.html: the one page on the site carrying its own program rather
 * than only its markup, unreachable from the build, unlintable, and
 * holding private copies of helpers the rest of the site had already
 * deduplicated in Phase 3.
 *
 * It is transcribed here verbatim, as ONE named IIFE, which is the same
 * shape initRoadmapProgress() below uses for the same reason: this
 * fragment is part of /app.js, which every page loads, so page-specific
 * code has to carry its own scope and its own no-op guard.
 *
 *   SCOPE. The search page declares render(), query, terms, escapeHtml
 *   and more — names this bundle's shared IIFE scope already uses for
 *   other things (guides.js has its own render(); core.js has its own
 *   escapeHtml). A named IIFE keeps every one of them private, so the
 *   move cannot collide with, or be collided with by, another fragment.
 *
 *   GUARD. #search-grid-root exists on search.html and nowhere else, so
 *   the function returns immediately on all 40 other pages — exactly as
 *   the inline script, which only ever existed on that one page, did.
 *
 *   BOOT ORDER. The inline script ran after all of /app.js; this runs in
 *   the middle of it, after core.js and guides.js and before contact.js
 *   and roadmap.js. Equivalent, and checked rather than assumed: it reads
 *   only the DOM (this bundle is loaded at the end of <body>, so the
 *   page is parsed) and core.js's renderers (assigned at the top of that
 *   fragment, well before this one runs). It depends on nothing from
 *   contact.js or roadmap.js, and neither depends on anything here.
 *
 * TWO PRIVATE COPIES DROPPED (identical implementations, so identical
 * output — this is Phase 3's deduplication reaching the last file that
 * was out of its reach, not a behaviour change):
 *
 *   escapeHtml    was a byte-for-byte copy of src/shared/html.js's. Now
 *                 core.js's binding of it, from the shared scope.
 *   thumbHtml     was reached through window.BpozzCards, the global
 *                 core.js exports for exactly this caller. Same function
 *                 object, now taken from the scope it is defined in; the
 *                 `!cards` fallback it needed as a separate script is
 *                 gone with the indirection, and the `!category` one
 *                 stays. window.BpozzCards itself is untouched.
 *
 * Nothing else moved: matching, scoring, filtering, URL sync, the sample
 * fallback data and every string are as they were on the page.
 * -----------------------------------------------------------------------
 */

  // --- Header quick search ---
  // Both the desktop header form and the homepage's hero search form
  // share the ".header-search" class, so this covers either without
  // duplicating logic. Each one is plain HTML (action="/search",
  // method="get", input name="s") and needs no JS to work: submitting it
  // (Enter or the button) is a normal browser GET to /search?s=... from
  // any page, including that one — initSearchPage() below reads the query
  // param itself, fetches /content-index.json, and renders matching
  // results (or a "no results" message) there. Nothing here intercepts
  // the submit or filters this page's grid in place anymore.
  // headerSearchForms is kept only so resetFilters() (in guides.js) can
  // blank a stale value left in the input.
  var headerSearchForms = document.querySelectorAll(".header-search");

  // ---------- the /search results page ----------
  // No-ops on every page without the results grid — see GUARD in the
  // file header.
  (function initSearchPage() {
    var gridEl = document.getElementById("search-grid-root");
    if (!gridEl) return;

    // ---------------------------------------------------------------
    // Phase 3: global search over content-index.json
    // ---------------------------------------------------------------
    // Replaces the guide-only pipeline this page used before (fetch
    // /guides.json, filter title/description/category label — see
    // bpozz-global-search-spec-v2.md §2 for what was wrong with that).
    // This now fetches the generated /content-index.json
    // (bpozz-phase-2-handoff.md), which already carries Guides
    // and Palettes as one normalized record shape, plus
    // /categories.json for category display names and for building
    // the category filter's option list (spec §16: "Do not hard-code
    // the filter list separately from the category data if it can be
    // derived from the index").
    // ---------------------------------------------------------------

    var TYPE_LABELS = {
      guide: "Guide",
      palette: "Palette",
    };
    var TYPE_VALUES = ["all", "guide", "palette"];

    // Relevance weights — bpozz-global-search-spec-v2.md §12. Starting
    // values from the spec, used as given ("not immutable
    // requirements", but nothing here needed adjusting).
    var WEIGHTS = {
      exactTitle: 100,
      titleWord: 50,
      category: 35,
      tag: 30,
      keyword: 25,
      description: 15,
      searchText: 5,
    };

    var headingEl = document.getElementById("search-heading");
    var dekEl = document.getElementById("search-dek");
    var countEl = document.getElementById("search-results-count");
    var emptyEl = document.getElementById("search-empty-state");
    var emptyQueryEl = document.getElementById("search-empty-query");
    var filtersEl = document.getElementById("search-filters");
    var typeTabsEl = document.getElementById("search-type-tabs");
    var categorySelectEl = document.getElementById("search-category-select");

    function escapeRegExp(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // ---------- query normalization (spec §10) ----------
    // 1. trim  2. collapse repeated whitespace  3. lowercase for
    // comparison (done at match time, below)  4. empty query is
    // handled explicitly in render()  5. multi-word support is the
    // term split below  6. every piece of user text is HTML-escaped
    // before it reaches innerHTML — see highlightTerms().
    function normalizeQuery(raw) {
      return String(raw == null ? "" : raw)
        .replace(/\s+/g, " ")
        .trim();
    }

    var initialParams = new URLSearchParams(location.search);
    var query = normalizeQuery(initialParams.get("s") || "");
    var queryLower = query.toLowerCase();
    var terms = queryLower ? queryLower.split(" ").filter(Boolean) : [];

    var typeFilter = initialParams.get("type") || "all";
    if (TYPE_VALUES.indexOf(typeFilter) === -1) typeFilter = "all";
    var categoryFilter = initialParams.get("category") || "all";

    var INDEX_RECORDS = [];
    var CATEGORY_NAME_BY_SLUG = {};
    var CATEGORY_LIST = []; // [{slug, name}], in categories.json's own order
    var dataLoaded = false;

    // ---------- category-name query matching (categories.json) ----------
    // content-index.json stores each record's categories as slugs (the
    // same slugs categories.json uses) rather than display names — see
    // bpozz-phase-2-handoff.md, "A categories field in Palette
    // searchText" and "Starting point for Phase 3". Resolving a slug to
    // its display name at query time, here, is exactly what that
    // handoff left for Phase 3 to decide.
    function categoryName(slug) {
      return CATEGORY_NAME_BY_SLUG[slug] || slug;
    }

    function categoryLabelsFor(record) {
      return record.categories.map(categoryName);
    }

    // Matches a query term against both a category's display name
    // ("Color Theory") and its slug's own words ("color theory"), so
    // searching either the label or the raw slug finds it.
    function categorySearchTextFor(record) {
      return record.categories
        .map(function (slug) {
          return (
            categoryName(slug) +
            " " +
            slug.replace(/-/g, " ")
          ).toLowerCase();
        })
        .join(" ");
    }

    // ---------- relevance scoring (spec §12–13) ----------
    // Every query term is checked independently against every
    // weighted field and matches are summed, so a record matching
    // more of the query's terms accumulates a higher score than one
    // matching only one term (§13's multi-term requirement) —
    // without ever requiring the literal multi-word phrase to appear.
    function scoreRecord(record) {
      if (!terms.length) return 0;

      var titleLower = record.title.toLowerCase();
      var descLower = (record.description || "").toLowerCase();
      var categoryText = categorySearchTextFor(record);
      var tagsLower = record.tags.map(function (t) {
        return t.toLowerCase();
      });
      var keywordsLower = record.keywords.map(function (k) {
        return k.toLowerCase();
      });
      var searchTextLower = record.searchText || "";

      var score = 0;

      // Exact title match: the whole normalized query equals the
      // whole title (e.g. "starless frost" against the Palette titled
      // "Starless Frost") — on top of, not instead of, the per-term
      // title-word matches below.
      if (queryLower && titleLower === queryLower) {
        score += WEIGHTS.exactTitle;
      }

      terms.forEach(function (term) {
        if (titleLower.indexOf(term) !== -1) score += WEIGHTS.titleWord;
        if (categoryText.indexOf(term) !== -1) score += WEIGHTS.category;
        if (
          tagsLower.some(function (t) {
            return t.indexOf(term) !== -1;
          })
        )
          score += WEIGHTS.tag;
        if (
          keywordsLower.some(function (k) {
            return k.indexOf(term) !== -1;
          })
        )
          score += WEIGHTS.keyword;
        if (descLower.indexOf(term) !== -1) score += WEIGHTS.description;
        if (searchTextLower.indexOf(term) !== -1) score += WEIGHTS.searchText;
      });

      return score;
    }

    function passesFilters(record) {
      if (typeFilter !== "all" && record.type !== typeFilter) return false;
      if (
        categoryFilter !== "all" &&
        record.categories.indexOf(categoryFilter) === -1
      )
        return false;
      return true;
    }

    function runSearch() {
      if (!terms.length) return [];
      var scored = [];
      INDEX_RECORDS.forEach(function (record) {
        if (!passesFilters(record)) return;
        var score = scoreRecord(record);
        if (score > 0) scored.push({ record: record, score: score });
      });
      // Higher combined score first (spec §12); ties broken by title
      // so the same search renders in a stable order every time.
      scored.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.record.title.localeCompare(b.record.title);
      });
      return scored.map(function (s) {
        return s.record;
      });
    }

    // ---------- rendering ----------
    // Wraps every matched query term in <mark>. Nothing user-supplied
    // ever lands in innerHTML unescaped (spec §10, rule 6): matching runs
    // on the RAW text and each piece is escaped on its own. Matching the
    // already-escaped text instead let a term like "amp" or "quot" land
    // inside an entity ("&<mark>amp</mark>;").
    function highlightTerms(text) {
      var raw = String(text == null ? "" : text);
      var rawTerms = terms.map(escapeRegExp).filter(Boolean);
      if (!rawTerms.length) return escapeHtml(raw);
      // Longest term first so a term that's a substring of another
      // doesn't shadow the longer match.
      rawTerms.sort(function (a, b) {
        return b.length - a.length;
      });
      var re = new RegExp("(" + rawTerms.join("|") + ")", "gi");
      // split() with a capture group puts the matches at odd indexes.
      return raw
        .split(re)
        .map(function (part, i) {
          return i % 2 ? "<mark>" + escapeHtml(part) + "</mark>" : escapeHtml(part);
        })
        .join("");
    }

    // Palettes have no description in the index (palettes-meta.json
    // has no description text of its own), so their card shows a
    // short tag summary instead ("Cool · Night ·
    // Dark") rather than an empty line. Spec §15: "Do not force every
    // result to use Guide-specific metadata... Only display fields
    // that make sense for that type."
    function snippetFor(record) {
      if (record.description) return record.description;
      if (record.tags && record.tags.length) {
        return record.tags
          .map(function (t) {
            return t.charAt(0).toUpperCase() + t.slice(1);
          })
          .join(" · ");
      }
      return "";
    }

    // ---------- result cards (Plan 1) ----------
    // Results render through the site's shared resource card instead
    // of the flat text rows this page used before. The markup below is
    // the same .content-card / .card-thumb / .card-body / .card-title /
    // .card-link / .card-meta / .badge structure src/build/home.js emits
    // for the homepage's mixed-resource sections and
    // src/build/categories.js emits for the category rails, so a result
    // tile is indistinguishable from the same resource shown anywhere
    // else. No shared class is redefined — this only composes them.
    //
    // Nothing here touches matching, scoring, filtering or URL state:
    // runSearch() still returns exactly the same records in exactly the
    // same order, and this only changes how each one is drawn.

    // One muted line per card, picked per type — the index simply
    // doesn't carry the same fields for both:
    //   Guide            its category label(s) ("Color Theory")
    //   Palette          snippetFor()'s tag summary ("Cool · Night ·
    //                    Dark"), the same string src/build/categories.js's
    //                    tagsMetaFor() and src/build/home.js already show
    // No author line: BPOZZ has no author data and none is invented.
    function cardMetaFor(record) {
      if (record.type === "guide") {
        return categoryLabelsFor(record).join(" · ");
      }
      return snippetFor(record);
    }

    // Only well-formed 6-digit hex reaches an inline style attribute.
    // Same rule as src/build/home.js's HEX_RE/validatedColors(), but this
    // runs client-side against fetched JSON, so a bad value is skipped
    // rather than thrown on — a malformed color must never be able to
    // break out of the style attribute.
    var HEX_RE = /^#[0-9a-f]{6}$/i;
    function validatedColors(record) {
      if (!Array.isArray(record.colors)) return [];
      return record.colors.filter(function (hex) {
        return typeof hex === "string" && HEX_RE.test(hex);
      });
    }

    // Palette thumbnail plate: the record's own colors as stacked
    // bars. The modifier class already exists in styles.css and is
    // used by the homepage resource sections — nothing new is styled
    // for it here.
    // aria-hidden because the colors are decoration; the title and
    // badge carry the meaning.
    function colorThumbHtml(record, modifier) {
      var colors = validatedColors(record);
      if (!colors.length) return "";
      return (
        '<div class="card-thumb ' +
        modifier +
        '" aria-hidden="true">' +
        colors
          .map(function (hex) {
            return '<span style="background-color:' + hex + '"></span>';
          })
          .join("") +
        "</div>"
      );
    }

    // Guide thumbnail plate: drawn by the shared renderer from
    // src/shared/card.js (THUMBS + THUMB_DIM_LABEL + thumbMediaHtml),
    // which is the same code that draws Guide thumbnails on the
    // homepage and /guides. It's reused rather than reimplemented so
    // there is exactly one category-illustration map in the codebase.
    // core.js binds it as thumbHtml in this bundle's shared scope; it is
    // the identical function window.BpozzCards.thumbHtml exposes, which
    // is how this page reached it while it was a separate script.
    //
    // `thumbnail` is the guide's real card image, carried on guide
    // records in content-index.json. The renderer layers it over the
    // category SVG and hides it via onerror if the file is missing, so
    // a Guide result shows the actual image and degrades to the SVG
    // rather than a broken-image glyph — identical behaviour to the
    // homepage and /guides grids.
    function guideThumbHtml(record) {
      var category = record.categories && record.categories[0];
      if (!category) return '<div class="card-thumb"></div>';
      return thumbHtml({
        category: category,
        title: record.title,
        thumbnail: record.thumbnail,
      });
    }

    function thumbFor(record) {
      if (record.type === "palette") {
        return colorThumbHtml(record, "card-thumb--bars");
      }
      if (record.type === "guide") return guideThumbHtml(record);
      return "";
    }

    // The title is an h2: this grid hangs straight off the page h1 with no
    // section heading between them, so an h3 skipped a level (WCAG 1.3.1) —
    // the same reasoning src/shared/card.js gives for category pages.
    function resultCardHtml(record) {
      var meta = cardMetaFor(record);
      return (
        '<article class="content-card">' +
        thumbFor(record) +
        '<div class="card-body">' +
        '<span class="badge">' +
        escapeHtml(TYPE_LABELS[record.type] || record.type) +
        "</span>" +
        '<h2 class="card-title"><a class="card-link" href="' +
        escapeHtml(record.url) +
        '">' +
        // Kept from the previous UI: matched terms stay wrapped in
        // <mark> so it's still obvious why a result matched.
        highlightTerms(record.title) +
        "</a></h2>" +
        (meta ? '<p class="card-meta">' + escapeHtml(meta) + "</p>" : "") +
        "</div></article>"
      );
    }

    function countLabel(results) {
      var n = results.length;
      var base = n + " Result" + (n === 1 ? "" : "s") + ' for "' + query + '"';
      if (typeFilter !== "all") return base;
      var counts = { guide: 0, palette: 0 };
      results.forEach(function (r) {
        if (counts[r.type] != null) counts[r.type]++;
      });
      var parts = [];
      if (counts.guide)
        parts.push(counts.guide + " guide" + (counts.guide === 1 ? "" : "s"));
      if (counts.palette)
        parts.push(
          counts.palette + " palette" + (counts.palette === 1 ? "" : "s"),
        );
      return parts.length ? base + " (" + parts.join(" · ") + ")" : base;
    }

    // ---------- URL sync ----------
    // Keeps /search.html?s=...&type=...&category=... shareable and
    // reload-safe (spec §18) without a full navigation when a filter
    // changes — filtering stays client-side, matching the rest of
    // this static site (spec §11: "Do not fetch every Guide
    // and Palette separately on every search").
    function syncUrl() {
      var params = new URLSearchParams();
      if (query) params.set("s", query);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      var qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
    }

    function render() {
      // Keep the header search box showing the term the results on
      // this page actually match, in case the person glances back up.
      document
        .querySelectorAll('.header-search input[type="search"]')
        .forEach(function (input) {
          input.value = query;
        });

      if (!query) {
        headingEl.textContent = "Search";
        dekEl.textContent =
          "Use the search box above to find a guide or palette by title, topic, tag, or category.";
        document.title = "Search — BPOZZ";
        countEl.textContent = "";
        gridEl.innerHTML = "";
        emptyEl.removeAttribute("data-visible");
        filtersEl.hidden = true;
        return;
      }

      document.title = 'Search results for "' + query + '" — BPOZZ';
      headingEl.textContent = 'Search results for "' + query + '"';
      dekEl.textContent =
        "Showing guides and palettes whose title, description, tags, or category match your search.";

      if (!dataLoaded) {
        filtersEl.hidden = true;
        countEl.textContent = "Loading…";
        gridEl.innerHTML = "";
        emptyEl.removeAttribute("data-visible");
        return;
      }

      filtersEl.hidden = false;

      var results = runSearch();

      if (results.length === 0) {
        countEl.textContent = "";
        gridEl.innerHTML = "";
        emptyQueryEl.textContent = '"' + query + '"';
        emptyEl.setAttribute("data-visible", "true");
      } else {
        countEl.textContent = countLabel(results);
        gridEl.innerHTML = results.map(resultCardHtml).join("");
        emptyEl.removeAttribute("data-visible");
      }
    }

    // ---------- type + category filter controls (spec §16) ----------
    function setTypeFilter(next) {
      if (TYPE_VALUES.indexOf(next) === -1 || next === typeFilter) return;
      typeFilter = next;
      typeTabsEl.querySelectorAll(".search-type-tab").forEach(function (btn) {
        btn.setAttribute(
          "aria-pressed",
          btn.getAttribute("data-type") === typeFilter ? "true" : "false",
        );
      });
      syncUrl();
      render();
    }

    typeTabsEl.querySelectorAll(".search-type-tab").forEach(function (btn) {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-type") === typeFilter ? "true" : "false",
      );
      btn.addEventListener("click", function () {
        setTypeFilter(btn.getAttribute("data-type"));
      });
    });

    categorySelectEl.addEventListener("change", function () {
      categoryFilter = categorySelectEl.value;
      syncUrl();
      render();
    });

    // Category options are derived entirely from categories.json, not
    // hard-coded here (spec §16), sorted by that file's own `order`.
    function populateCategorySelect() {
      CATEGORY_LIST.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.slug;
        opt.textContent = c.name;
        categorySelectEl.appendChild(opt);
      });
      var validFromUrl = CATEGORY_LIST.some(function (c) {
        return c.slug === categoryFilter;
      });
      categorySelectEl.value = validFromUrl ? categoryFilter : "all";
      categoryFilter = categorySelectEl.value;
    }

    // ---------- data loading ----------
    // Small local fallback so this page still renders something if
    // /content-index.json can't be fetched — e.g. opened as file://
    // instead of through a server, which blocks fetch() in most
    // browsers. On the live site the real fetch below is what
    // actually runs. Mirrors the shape content-index.json's records
    // and categories.json actually have (bpozz-phase-2-handoff.md §7).
    var SAMPLE_INDEX = [
      {
        id: "guide:color-contrast-systems",
        type: "guide",
        title: "Color Contrast Is Math, Not Taste",
        slug: "color-contrast-systems",
        url: "/guide/color-contrast-systems.html",
        description:
          "Measurable contrast ratios, semantic color tokens, and the exact WCAG numbers a palette either passes or fails.",
        categories: ["color-theory"],
        tags: [],
        keywords: [],
        searchText:
          "color contrast is math, not taste measurable contrast ratios semantic color tokens wcag color theory",
      },
      {
        id: "palette:p001",
        type: "palette",
        title: "Starless Frost",
        slug: "p001",
        url: "/palettes#p001",
        description: "",
        categories: ["color-theory", "systems"],
        tags: ["cool", "night", "dark"],
        keywords: [],
        searchText: "starless frost p001 cool night dark",
      },
    ];
    var SAMPLE_CATEGORIES = [
      { slug: "color-theory", name: "Color Theory", order: 1 },
      { slug: "systems", name: "Design Systems", order: 8 },
    ];

    function loadJson(url) {
      return fetch(url).then(function (response) {
        if (!response.ok)
          throw new Error("HTTP " + response.status + " for " + url);
        return response.json();
      });
    }

    function applyLoadedData(indexData, categoriesData) {
      INDEX_RECORDS = Array.isArray(indexData) ? indexData : SAMPLE_INDEX;
      var categories = Array.isArray(categoriesData)
        ? categoriesData
        : SAMPLE_CATEGORIES;
      categories
        .slice()
        .sort(function (a, b) {
          return (a.order || 0) - (b.order || 0);
        })
        .forEach(function (c) {
          CATEGORY_NAME_BY_SLUG[c.slug] = c.name;
          CATEGORY_LIST.push({ slug: c.slug, name: c.name });
        });
      populateCategorySelect();
      dataLoaded = true;
      render();
    }

    Promise.all([loadJson("/content-index.json"), loadJson("/categories.json")])
      .then(function (results) {
        applyLoadedData(results[0], results[1]);
      })
      .catch(function (err) {
        // The sample set is for file:// previews only. On the live site a
        // failed fetch used to fall back to it too, silently presenting two
        // hard-coded records as the real results for any query.
        if (location.protocol === "file:") {
          console.error(
            "Couldn't load content-index.json / categories.json, using sample data:",
            err,
          );
          applyLoadedData(SAMPLE_INDEX, SAMPLE_CATEGORIES);
          return;
        }
        console.error("Couldn't load content-index.json / categories.json:", err);
        filtersEl.hidden = true;
        gridEl.innerHTML = "";
        emptyEl.removeAttribute("data-visible");
        countEl.textContent = query
          ? "Search is unavailable right now — please refresh and try again."
          : "";
      });

    render(); // initial paint (loading/empty state) before data resolves
  })();
