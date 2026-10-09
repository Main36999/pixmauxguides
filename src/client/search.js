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
    // The intro line under the heading, with or without a query: what the
    // index covers. search.html carries the same sentence for no-JS visits.
    var SCOPE_DEK = "Search currently includes guides and color palettes.";

    // Relevance weights — bpozz-global-search-spec-v2.md §12. Each is what
    // one query term earns for a WHOLE-WORD hit in that field (see MATCH for
    // partial hits), except the two once-per-record bonuses:
    //   exact    the whole query IS the title, one of the colour names, or
    //            the slug (a palette id such as "p450").
    //   phrase   a multi-word query appears word-for-word in the title, a
    //            colour name or the description.
    // `name` is the title's weight, and a palette's colour names share it: a
    // palette with no hand-written title (p041 on) is titled BY its colour
    // names, so a colour-name hit has to be worth the same on every palette.
    // A term earns it once, from whichever of the two it matches best.
    var WEIGHTS = {
      exact: 100,
      phrase: 50,
      name: 50,
      category: 35,
      tag: 30,
      keyword: 25,
      color: 25,
      description: 15,
      searchText: 5,
    };

    // The share of a field's weight a term earns, by where it occurs: as a
    // whole word ("gold" in "Gold Leaf"), at the start of one ("star" in
    // "Starless" — partial search still works), or only inside one ("gold"
    // in "Marigold", "ink" in "Pink").
    var MATCH = { word: 1, prefix: 0.5, infix: 0.25 };

    function isWordChar(ch) {
      return (
        ch !== "" && (ch.toLowerCase() !== ch.toUpperCase() || (ch >= "0" && ch <= "9"))
      );
    }

    // Best MATCH level of `term` anywhere in `text` (both lowercase), or 0.
    function matchLevel(text, term) {
      var best = 0;
      var at = text.indexOf(term);
      while (at !== -1 && best !== MATCH.word) {
        var startsWord = !isWordChar(text.charAt(at - 1));
        var endsWord = !isWordChar(text.charAt(at + term.length));
        var level = startsWord ? (endsWord ? MATCH.word : MATCH.prefix) : MATCH.infix;
        if (level > best) best = level;
        at = text.indexOf(term, at + 1);
      }
      return best;
    }

    function bestLevel(texts, term) {
      var best = 0;
      texts.forEach(function (text) {
        best = Math.max(best, matchLevel(text, term));
      });
      return best;
    }

    // A query term that is a whole HEX colour ("#E2725B", "e2725b",
    // "#abc") matches a palette carrying exactly that colour. Exact only:
    // substring-matching hex digits would let ordinary words that happen to
    // be hex ("bad", "cafe", "face") pull in unrelated palettes.
    function hexTermValue(term) {
      var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(term);
      if (!m) return null;
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return "#" + h;
    }

    var headingEl = document.getElementById("search-heading");
    var dekEl = document.getElementById("search-dek");
    var countEl = document.getElementById("search-results-count");
    var emptyEl = document.getElementById("search-empty-state");
    var emptyMessageEl = document.getElementById("search-empty-message");
    var emptyActionsEl = emptyEl.querySelector(".search-empty-actions");

    // The empty state's second form: the query DOES match something, just
    // nothing the active type/category filter lets through. Its own message
    // and a button that clears the filters take the place of the
    // no-results line and its two browse links, which would both be wrong
    // there. Built here rather than in search.html so the page markup is
    // unchanged; the classes are the empty state's own.
    var filteredMessageEl = document.createElement("p");
    emptyEl.insertBefore(filteredMessageEl, emptyMessageEl.nextSibling);
    var clearFiltersEl = document.createElement("button");
    clearFiltersEl.type = "button";
    clearFiltersEl.className = "btn btn-primary";
    clearFiltersEl.textContent = "Clear filters";
    emptyEl.appendChild(clearFiltersEl);

    // style.display rather than the hidden attribute: .btn sets its own
    // display, which would override [hidden].
    function showEmptyStateFor(filtered) {
      filteredMessageEl.style.display = filtered ? "" : "none";
      clearFiltersEl.style.display = filtered ? "" : "none";
      [emptyMessageEl, emptyActionsEl].forEach(function (el) {
        if (el) el.style.display = filtered ? "none" : "";
      });
    }
    showEmptyStateFor(false);
    var filtersEl = document.getElementById("search-filters");
    var typeTabsEl = document.getElementById("search-type-tabs");
    var categorySelectEl = document.getElementById("search-category-select");

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

    // The words of a query, for matching only — `query` itself is what the
    // page displays, exactly as typed:
    //   - a hyphen separates words: "color-palette" is "color palette"
    //   - brackets, quotes, sentence punctuation and the "·" separator are
    //     trimmed from either end of a word: "(color" is "color",
    //     "palette," is "palette". Only these — "#333" keeps its "#" (a
    //     HEX colour), and a symbol such as "%" or "$" is left alone
    //     rather than trimmed down to a stray letter that matches
    //     everything.
    //   - a word with no letter or digit at all is dropped: "·", ".", "(",
    //     "&" are not words, so they neither match nor count as a word
    //     the query asked for
    // Apostrophes inside a word stay ("figma's"); the caller has already
    // made curly ones straight.
    var EDGE_PUNCTUATION = /^[.,;:!?()[\]{}"'“”«»·•…]+|[.,;:!?()[\]{}"'“”«»·•…]+$/g;

    function queryWords(lower) {
      return lower
        .replace(/-/g, " ")
        .split(" ")
        .map(function (word) {
          return word.replace(EDGE_PUNCTUATION, "");
        })
        .filter(function (word) {
          for (var i = 0; i < word.length; i++) if (isWordChar(word.charAt(i))) return true;
          return false;
        });
    }

    var initialParams = new URLSearchParams(location.search);
    var query = normalizeQuery(initialParams.get("s") || "");
    // Curly apostrophes (’ ‘, and the modifier letter ʼ) become the straight
    // one the content uses, so "don’t" typed on a phone finds "don't".
    var queryLower = query.toLowerCase().replace(/[‘’ʼ]/g, "'");
    var words = queryWords(queryLower);
    // Each DISTINCT word once, in the order first typed: "gold gold leaf"
    // scores as "gold leaf", so repeating a word adds nothing.
    var terms = words.filter(function (term, i, all) {
      return all.indexOf(term) === i;
    });
    // Style precedence is a product decision for ONE query only: "pastel"
    // (after the normalization above, so "Pastel", "PASTEL" and "pastel."
    // count). It ranks palettes made by a Pastel recipe (their `styles`,
    // content.js styleLabels()) before those that only have "Pastel" in a
    // colour name. Every other query, including other style names, ranks
    // exactly as before — see scoreRecord().
    var PRECEDENCE_STYLE = "pastel";
    var stylePrecedence = terms.length === 1 && terms[0] === PRECEDENCE_STYLE;
    // The query as a whole, for the exact and phrase bonuses: as typed (so a
    // hyphenated slug such as "color-contrast-systems" or a title such as
    // "Bare Ledger (Dark)" still matches exactly), as its words, and with
    // repeats dropped. All are tried, so "gold gold leaf" still finds the
    // colour "Gold Leaf", "color-palette" gets the phrase bonus "color
    // palette" does, and a guide title that repeats a word itself ("A Color
    // Palette Is a Token System…") still matches when typed in full.
    var wholeQueries = [queryLower, words.join(" "), terms.join(" ")].filter(function (whole, i, all) {
      return whole && all.indexOf(whole) === i;
    });

    var typeFilter = initialParams.get("type") || "all";
    if (TYPE_VALUES.indexOf(typeFilter) === -1) typeFilter = "all";
    var categoryFilter = initialParams.get("category") || "all";

    var INDEX_RECORDS = [];
    var PREPARED = []; // one prepareRecord() per INDEX_RECORDS entry, same order
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

    // Matches a query term against both a category's display name
    // ("Color Theory") and its slug's own words ("color theory"), so
    // searching either the label or the raw slug finds it.
    //
    // Only categories that tell records of a type apart are scored. One that
    // EVERY record of the type carries — every palette is filed under
    // color-theory and systems — describes none of them, and scoring it made
    // "color", "design" or "the" match all 600 palettes. Those categories
    // stay on the record for the category filter; they only earn nothing.
    function categorySearchTextFor(record, sharedByType) {
      return record.categories
        .filter(function (slug) {
          return !sharedByType[record.type + " " + slug];
        })
        .map(function (slug) {
          return (
            categoryName(slug) +
            " " +
            slug.replace(/-/g, " ")
          ).toLowerCase();
        })
        .join(" ");
    }

    // {"<type> <slug>": true} for each category carried by every record of
    // its type. A type with a single record is left alone: there is nothing
    // to tell it apart from.
    function categoriesSharedByType(records) {
      var perType = {};
      records.forEach(function (r) {
        var t = perType[r.type] || (perType[r.type] = { count: 0, slugs: {} });
        t.count++;
        r.categories.forEach(function (slug) {
          t.slugs[slug] = (t.slugs[slug] || 0) + 1;
        });
      });
      var shared = {};
      Object.keys(perType).forEach(function (type) {
        var t = perType[type];
        if (t.count < 2) return;
        Object.keys(t.slugs).forEach(function (slug) {
          if (t.slugs[slug] === t.count) shared[type + " " + slug] = true;
        });
      });
      return shared;
    }

    // Each record's searchable fields, lowercased once when the index loads
    // rather than on every search.
    function prepareRecord(record, sharedByType) {
      function lower(value) {
        return String(value == null ? "" : value).toLowerCase();
      }
      return {
        record: record,
        title: lower(record.title),
        colorNames: (Array.isArray(record.colorNames) ? record.colorNames : []).map(lower),
        slug: lower(record.slug),
        description: lower(record.description),
        category: categorySearchTextFor(record, sharedByType),
        tags: record.tags.map(lower),
        // A palette's style labels (recipe provenance, content.js styleLabels()):
        // a subset of its tags. Guides have none.
        styles: (Array.isArray(record.styles) ? record.styles : []).map(lower),
        keywords: record.keywords.map(lower),
        searchText: lower(record.searchText),
        colors: Array.isArray(record.colors) ? record.colors.map(lower) : [],
      };
    }

    // ---------- relevance scoring (spec §12–13) ----------
    // Every query term is checked independently against every
    // weighted field and matches are summed, so a record matching
    // more of the query's terms accumulates a higher score than one
    // matching only one term (§13's multi-term requirement) —
    // without ever requiring the literal multi-word phrase to appear.
    // Any one term matching is enough to be a result (OR); the exact
    // and phrase bonuses then lift records matching the query as a whole.
    //
    // Returns the score and `matched`, how many of the distinct terms the
    // record matched at all. runSearch() ranks on `matched` first: the
    // score adds up every field a term hits, so without it one word found
    // in a title, a tag and searchText (85) outranked a record matching
    // both words of "dark blue" (82.5). An exact whole-query match counts
    // as matching every term.
    //
    // It also returns `styled`: 1 when the query is "pastel" (see
    // stylePrecedence) and the record carries the Pastel style, otherwise 0.
    // runSearch() ranks on it right after `matched`, so a Pastel recipe
    // palette comes before one that only has "Pastel" in a colour name, such
    // as "Sand Pastel" (name 50 outscores tag 30, so the score alone put every
    // such mention first). No weight or score changes; for every other query
    // `styled` is 0 on every record and the order is unchanged.
    //
    // It also returns `why`, the match explanation the result card shows
    // (see matchReasons()): for each field, whether — and on which of its
    // values — a weight above was actually earned. It is written down at
    // the same line that adds that weight, so it can only ever name a field
    // the score came from, and it never feeds back into the score.
    function scoreRecord(p) {
      var result = { score: 0, matched: 0, styled: 0, why: newWhy() };
      if (!terms.length) return result;
      var why = result.why;

      terms.forEach(function (term) {
        var before = result.score;
        var titleLevel = matchLevel(p.title, term);
        var colorNameLevel = bestLevel(p.colorNames, term);
        result.score += WEIGHTS.name * Math.max(titleLevel, colorNameLevel);
        // The name weight is earned from whichever of the two matches best —
        // both on a tie, so a colour name is still named when the card's
        // two-line title clamp hides where it sits in a long title.
        if (titleLevel && titleLevel >= colorNameLevel) why.title = true;
        if (colorNameLevel && colorNameLevel >= titleLevel)
          noteBest(why.colorNames, p.record.colorNames, p.colorNames, term, colorNameLevel);
        var categoryLevel = matchLevel(p.category, term);
        result.score += WEIGHTS.category * categoryLevel;
        if (categoryLevel) why.category = true;
        var tagLevel = bestLevel(p.tags, term);
        result.score += WEIGHTS.tag * tagLevel;
        if (tagLevel) noteBest(why.tags, p.record.tags, p.tags, term, tagLevel);
        var keywordLevel = bestLevel(p.keywords, term);
        result.score += WEIGHTS.keyword * keywordLevel;
        if (keywordLevel) noteBest(why.keywords, p.record.keywords, p.keywords, term, keywordLevel);
        var descriptionLevel = matchLevel(p.description, term);
        result.score += WEIGHTS.description * descriptionLevel;
        if (descriptionLevel) why.description = true;
        var beforeSearchText = result.score;
        result.score += WEIGHTS.searchText * matchLevel(p.searchText, term);
        var hex = p.colors.length ? hexTermValue(term) : null;
        var hexAt = hex ? p.colors.indexOf(hex) : -1;
        if (hexAt !== -1) {
          result.score += WEIGHTS.color;
          addOnce(why.hex, p.record.colors[hexAt]);
        }
        // searchText is every other field run together, so it is only the
        // reason when it is the one thing this term matched — for a palette,
        // that is part of its id ("p45" in "p450").
        if (result.score > beforeSearchText && beforeSearchText === before && hexAt === -1) {
          if (matchLevel(p.slug, term)) why.slug = true;
          else why.text = true;
        }
        if (result.score > before) result.matched++;
      });

      var exact = wholeQueries.some(function (whole) {
        return whole === p.title || whole === p.slug || p.colorNames.indexOf(whole) !== -1;
      });
      if (exact) {
        result.score += WEIGHTS.exact;
        result.matched = terms.length;
        wholeQueries.forEach(function (whole) {
          if (whole === p.title) why.title = true;
          if (whole === p.slug) why.slug = true;
          var at = p.colorNames.indexOf(whole);
          if (at !== -1) addOnce(why.colorNames, p.record.colorNames[at]);
        });
      }

      if (stylePrecedence && p.styles.indexOf(PRECEDENCE_STYLE) !== -1) result.styled = 1;

      if (
        terms.length > 1 &&
        wholeQueries.some(function (whole) {
          return (
            matchLevel(p.title, whole) === MATCH.word ||
            bestLevel(p.colorNames, whole) === MATCH.word ||
            matchLevel(p.description, whole) === MATCH.word
          );
        })
      ) {
        result.score += WEIGHTS.phrase;
        wholeQueries.forEach(function (whole) {
          if (matchLevel(p.title, whole) === MATCH.word) why.title = true;
          p.colorNames.forEach(function (name, i) {
            if (matchLevel(name, whole) === MATCH.word) addOnce(why.colorNames, p.record.colorNames[i]);
          });
          if (matchLevel(p.description, whole) === MATCH.word) why.description = true;
        });
      }

      return result;
    }

    // ---------- match explanation ----------
    // What scoreRecord() found, per field. The value lists hold the
    // record's own spelling ("Kelly Green", "#E5B44C"), in first-matched
    // order, each once.
    function newWhy() {
      return {
        title: false,
        colorNames: [],
        tags: [],
        hex: [],
        slug: false,
        category: false,
        keywords: [],
        description: false,
        text: false,
      };
    }

    function addOnce(list, value) {
      if (list.indexOf(value) === -1) list.push(value);
    }

    // Records the values of one list field (`lowered` is `original`,
    // lowercased) that `term` matches at `level` — the best level, the one
    // that earned the weight — so "gold" names the colour "Gold", not also
    // the "Marigold" it only matched inside of.
    function noteBest(list, original, lowered, term, level) {
      lowered.forEach(function (text, i) {
        if (matchLevel(text, term) === level) addOnce(list, String(original[i]));
      });
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

    // `ignoreFilters` is for the empty state only: it asks whether the
    // query matches anything at all once the type/category filters are off.
    // Each result is { record, why }: `why` only explains a result, and the
    // order is settled without it.
    function runSearch(ignoreFilters) {
      if (!terms.length) return [];
      var scored = [];
      PREPARED.forEach(function (p) {
        if (!ignoreFilters && !passesFilters(p.record)) return;
        var result = scoreRecord(p);
        if (result.score > 0) {
          scored.push({
            record: p.record,
            score: result.score,
            matched: result.matched,
            styled: result.styled,
            why: result.why,
          });
        }
      });
      // More of the query's distinct terms matched first, then — for the
      // query "pastel" only — the Pastel style (see scoreRecord()), then the
      // higher combined score (spec §12); ties broken by title so the same
      // search renders in a stable order every time.
      scored.sort(function (a, b) {
        if (b.matched !== a.matched) return b.matched - a.matched;
        if (b.styled !== a.styled) return b.styled - a.styled;
        if (b.score !== a.score) return b.score - a.score;
        return a.record.title.localeCompare(b.record.title);
      });
      return scored.map(function (s) {
        return { record: s.record, why: s.why };
      });
    }

    // ---------- result cards ----------
    // Each result is drawn with its own section's native card, so a
    // result looks the same here as on its own page:
    //   Guide     the /guides card, from the shared renderer (cardHtml()
    //             in src/shared/card.js, bound by core.js), given the
    //             guide's own guides.json record, the object /guides
    //             renders from.
    //   Palette   the /palettes card's markup and classes (palettes.css),
    //             with decorative colour strips and one link to
    //             /palettes#<id> in place of the copy, like and save
    //             buttons, which only work on /palettes.
    // Every piece of record text is escaped with escapeHtml() before it
    // reaches innerHTML, and nothing from the query is written into a
    // card at all.
    //
    // Nothing here touches matching, scoring, filtering or URL state:
    // runSearch() still returns exactly the same records in exactly the
    // same order, and this only changes how each one is drawn.

    // guides.json records by id, filled when the data loads (see
    // applyLoadedData). Left empty if guides.json could not be loaded.
    var GUIDE_BY_ID = {};

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

    // The guides.json record cardHtml() needs for this result, or null.
    // cardHtml() prints the category, the level and "N min read" (hidden
    // by the /guides grid, but still in the markup), so a record is used
    // only when all three are ones it can print; anything else would put
    // "undefined" into the card.
    function guideRecordFor(record) {
      var own = Object.prototype.hasOwnProperty;
      var guide = own.call(GUIDE_BY_ID, record.slug) ? GUIDE_BY_ID[record.slug] : null;
      if (
        guide &&
        own.call(CATEGORIES, guide.category) &&
        own.call(BpozzCard.LEVEL_LABEL, guide.level) &&
        typeof guide.readTime === "number" &&
        isFinite(guide.readTime)
      ) {
        return guide;
      }
      return null;
    }

    // The /guides card. Its title is an h3, under the Guides group's h2.
    // Without a usable guides.json record (the file failed to load, or no
    // longer has this guide) the card is built from the index record:
    // the same thumbnail, title and link, without the meta line, which
    // the /guides grid hides anyway.
    function guideCardHtml(record) {
      var guide = guideRecordFor(record);
      if (guide) return cardHtml(guide);
      return (
        '<article class="content-card">' +
        guideThumbHtml(record) +
        '<div class="card-body"><h3 class="card-title"><a class="card-link" href="' +
        escapeHtml(record.url) +
        '">' +
        escapeHtml(record.title) +
        "</a></h3></div></article>"
      );
    }

    // The /palettes card (src/client/palettes.js cardHtml()), read-only:
    // the palette's colours as decorative strips, in order, then its colour
    // names joined the way /palettes shows them, as the card's one link.
    // The link's ::after (styles.css .card-link) covers the whole card.
    // A palette with a curated title (palettes-meta.json) carries it ahead
    // of the names, so a search for that title shows why the palette is
    // here; every other palette is titled by its names in the index, so it
    // has none to show.
    function paletteCardHtml(record) {
      // Joined with the same middle-dot separator /palettes and the index
      // use, so a palette titled by its names reads exactly as its title.
      var names = (Array.isArray(record.colorNames) ? record.colorNames : []).join(" · ");
      var curated = !!record.title && record.title !== names;
      var swatches = validatedColors(record)
        .map(function (hex) {
          return '<span class="palette-swatch" style="--sw-hex:' + hex + '"></span>';
        })
        .join("");
      var text =
        (curated ? '<span class="palette-card__title">' + escapeHtml(record.title) + "</span>" : "") +
        (curated && names ? " · " : "") +
        escapeHtml(names);
      if (!curated && !names) text = escapeHtml(record.title || record.slug);
      return (
        '<article class="palette-card" data-id="' +
        escapeHtml(record.slug) +
        '"><div class="palette-card__bars" aria-hidden="true">' +
        swatches +
        '</div><div class="palette-card__foot"><span class="palette-card__names">' +
        '<a class="card-link" href="' +
        escapeHtml(record.url) +
        '">' +
        text +
        "</a></span></div></article>"
      );
    }

    // ---------- grouped results ----------
    // One section per type that has results, Guides first: an h2 with the
    // count, then that type's own grid (the /guides grid, the /palettes
    // grid). Each section is runSearch()'s ranked list filtered to its
    // type, and Array#filter keeps order, so results stay in relevance
    // order within their group. A type with no results gets no section.
    var GROUPS = [
      { type: "guide", label: "Guides", gridClass: "grid guides-grid", card: guideCardHtml },
      { type: "palette", label: "Palettes", gridClass: "palettes-grid", card: paletteCardHtml },
    ];

    function resultsHtml(results) {
      return GROUPS.map(function (group) {
        var records = results
          .filter(function (result) {
            return result.record.type === group.type;
          })
          .map(function (result) {
            return result.record;
          });
        if (!records.length) return "";
        return (
          '<section class="search-group">' +
          '<h2 class="search-group__title">' +
          group.label +
          ' <span class="search-group__count">' +
          records.length +
          "</span></h2>" +
          '<div class="' +
          group.gridClass +
          '">' +
          records
            .map(function (record) {
              return group.card(record);
            })
            .join("") +
          "</div></section>"
        );
      }).join("");
    }

    function countLabel(results) {
      var n = results.length;
      var base = n + " Result" + (n === 1 ? "" : "s") + ' for "' + query + '"';
      // Zero here means nothing in the index matched at all (a query the
      // filters emptied gets filteredEmptyLabel() instead). This line is the
      // page's role="status" region, so it names what was searched: the
      // site's other libraries (fonts, icons, colors) are not in the index.
      if (!n) return base + " in guides and palettes";
      if (typeFilter !== "all") return base;
      var counts = { guide: 0, palette: 0 };
      results.forEach(function (r) {
        if (counts[r.record.type] != null) counts[r.record.type]++;
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

    // 'No palettes match "color" — 5 guides do.' for a query the filters
    // emptied: says what the filter excluded and what the query does match.
    function filteredEmptyLabel(unfiltered) {
      var noun = typeFilter === "all" ? "results" : TYPE_LABELS[typeFilter].toLowerCase() + "s";
      var where = categoryFilter === "all" ? "" : " in " + categoryName(categoryFilter);
      var counts = { guide: 0, palette: 0 };
      unfiltered.forEach(function (r) {
        if (counts[r.record.type] != null) counts[r.record.type]++;
      });
      var parts = [];
      if (counts.guide) parts.push(counts.guide + " guide" + (counts.guide === 1 ? "" : "s"));
      if (counts.palette)
        parts.push(counts.palette + " palette" + (counts.palette === 1 ? "" : "s"));
      return (
        "No " + noun + where + ' match "' + query + '" — ' +
        parts.join(" and ") + (unfiltered.length === 1 ? " does." : " do.")
      );
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

      // The count line is visually hidden whenever the page itself shows
      // what it says (see below); while loading, and on an error, it stays
      // on screen.
      countEl.classList.remove("sr-only");

      if (!query) {
        headingEl.textContent = "Search";
        dekEl.textContent = SCOPE_DEK;
        document.title = "Search — bpozz";
        countEl.textContent = "";
        gridEl.innerHTML = "";
        emptyEl.removeAttribute("data-visible");
        filtersEl.hidden = true;
        return;
      }

      document.title = 'Search results for "' + query + '" — bpozz';
      headingEl.textContent = 'Search results for "' + query + '"';
      dekEl.textContent = SCOPE_DEK;

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
        // The count line is the page's role="status" region, so "0 Results
        // for ..." is what tells a screen reader the search came back empty;
        // the empty-state panel below is not announced. When a filter is
        // what emptied it, both say so instead. Either way the page shows
        // the same thing itself (the h1, or the panel's sentence), so the
        // count line keeps announcing but, visually hidden (the site's
        // .sr-only), is not a second visible copy.
        var filtered = typeFilter !== "all" || categoryFilter !== "all";
        var unfiltered = filtered ? runSearch(true) : [];
        gridEl.innerHTML = "";
        if (unfiltered.length) {
          countEl.textContent = filteredEmptyLabel(unfiltered);
          filteredMessageEl.textContent = countEl.textContent;
        } else {
          countEl.textContent = countLabel(results);
          // Nothing matches anywhere: the page's one heading says so.
          // textContent, so the query is shown as text, never parsed.
          headingEl.textContent = '0 results for "' + query + '"';
        }
        countEl.classList.add("sr-only");
        showEmptyStateFor(unfiltered.length > 0);
        emptyEl.setAttribute("data-visible", "true");
      } else {
        countEl.textContent = countLabel(results);
        // Each group's heading shows its count, so the count line keeps
        // announcing the total but is not shown a second time.
        countEl.classList.add("sr-only");
        gridEl.innerHTML = resultsHtml(results);
        emptyEl.removeAttribute("data-visible");
      }
    }

    // ---------- type + category filter controls (spec §16) ----------
    function syncTypeTabs() {
      typeTabsEl.querySelectorAll(".search-type-tab").forEach(function (btn) {
        btn.setAttribute(
          "aria-pressed",
          btn.getAttribute("data-type") === typeFilter ? "true" : "false",
        );
      });
    }

    function setTypeFilter(next) {
      if (TYPE_VALUES.indexOf(next) === -1 || next === typeFilter) return;
      typeFilter = next;
      syncTypeTabs();
      syncUrl();
      render();
    }

    syncTypeTabs();
    typeTabsEl.querySelectorAll(".search-type-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTypeFilter(btn.getAttribute("data-type"));
      });
    });

    // The filtered empty state's button. Focus goes to the "All" tab it just
    // re-selected, since the button itself disappears with the empty state.
    clearFiltersEl.addEventListener("click", function () {
      typeFilter = "all";
      categoryFilter = "all";
      categorySelectEl.value = "all";
      syncTypeTabs();
      syncUrl();
      render();
      var allTab = typeTabsEl.querySelector('.search-type-tab[data-type="all"]');
      if (allTab) allTab.focus();
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
        url: "/guide/color-contrast-systems",
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
        styles: ["night"],
        keywords: [],
        colorNames: ["Nightshade", "Twilight", "Ultraviolet", "Azure"],
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

    function applyLoadedData(indexData, categoriesData, guidesData) {
      INDEX_RECORDS = Array.isArray(indexData) ? indexData : SAMPLE_INDEX;
      if (Array.isArray(guidesData)) {
        guidesData.forEach(function (guide) {
          if (guide && typeof guide.id === "string") GUIDE_BY_ID[guide.id] = guide;
        });
      }
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
      var sharedByType = categoriesSharedByType(INDEX_RECORDS);
      PREPARED = INDEX_RECORDS.map(function (record) {
        return prepareRecord(record, sharedByType);
      });
      populateCategorySelect();
      dataLoaded = true;
      render();
    }

    Promise.all([
      loadJson("/content-index.json"),
      loadJson("/categories.json"),
      // The guide records the native /guides card is drawn from: the index
      // does not carry a guide's level or read time. Requested once, here;
      // if it fails, guide results fall back to the index's own fields
      // (see guideCardHtml) rather than taking the whole search down.
      loadJson("/guides.json").catch(function (err) {
        console.error("Couldn't load guides.json; guide results use the search index only:", err);
        return null;
      }),
    ])
      .then(function (results) {
        applyLoadedData(results[0], results[1], results[2]);
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
        countEl.classList.remove("sr-only");
        countEl.textContent = query
          ? "Search is unavailable right now — please refresh and try again."
          : "";
      });

    render(); // initial paint (loading/empty state) before data resolves
  })();
