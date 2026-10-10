/**
 * colors.js
 * -----------------------------------------------------------------------
 * Page-specific script for /colors — the Color Library.
 *
 * Sibling of palettes.js, not a fork of it. The two pages look related and
 * share the site's primitives, but they are different things: a palette card
 * is four colours that belong together, a colour card is ONE colour that
 * stands alone. So this file renders its own card, and deliberately carries
 * none of palettes.js's likes, Firebase wiring, localStorage or sort tabs.
 *
 * What it does carry, on purpose, is the copy interaction, because that is
 * the one behaviour a visitor will recognise from /palettes and would be
 * annoyed to find different: Clipboard API first, execCommand fallback, an
 * in-card "Copied" state rather than a toast, one shared screen-reader live
 * region for the whole page, and the site toast reserved for the failure
 * case. Those are transcribed from palettes.js rather than reinvented.
 *
 * Data flow:
 *   1. fetch ./colors-data.json — a flat array of { id, name, hex, category }.
 *   2. render every card once, then filter by toggling a class. The DOM is
 *      built one time and never rebuilt, which is what keeps filtering
 *      instant at 300 cards and still instant at 1000+.
 *   3. the category filter row is built FROM THE DATA, not hard-coded, so
 *      adding a category to colors-data.json adds a chip. CATEGORY_ORDER
 *      below only decides the order they appear in.
 *   4. once account Saved is launched (docs/SAVED.md), each card also gets
 *      a Save button beside its name, handed to saved.js — see saveHtml.
 *      While Saved is dormant there is none, and every card is exactly as
 *      before.
 *
 * NO PAGINATION, NO VIRTUALISATION, deliberately. 300 cards is ~300 nodes;
 * the browser handles that without help, and adding either would be
 * machinery this page does not need yet. The note in render() says what to
 * reach for first if that ever stops being true.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  var gridRoot = document.getElementById("colors-grid-root");
  var filterRoot = document.getElementById("colors-filters");
  var emptyState = document.getElementById("colors-empty-state");
  var countLine = document.getElementById("colors-count");
  var resultStatus = document.getElementById("colors-result-status");
  if (!gridRoot) return;

  /**
   * The order the filter chips appear in — warm, then cool, then neutral.
   *
   * This is presentation order ONLY. The set of chips comes from the data;
   * a category in the data that is missing here still gets a chip, appended
   * alphabetically after the known ones, so new data can never be silently
   * unreachable. site.config.js states the same twelve as the build-time
   * contract and src/build/colors-data.test.js asserts the two lists agree.
   */
  var CATEGORY_ORDER = [
    "Red",
    "Orange",
    "Brown",
    "Yellow",
    "Green",
    "Turquoise",
    "Blue",
    "Violet",
    "Pink",
    "White",
    "Gray",
    "Black",
  ];

  var ALL = "All";

  // Account Saved (docs/SAVED.md), once it is launched: saved.js, inside
  // /app.js, which runs first, then publishes an active window.BpozzSaved.
  // While Saved is dormant this is null, and the page is exactly as it
  // always was.
  var account = window.BpozzSaved && window.BpozzSaved.active === true ? window.BpozzSaved : null;

  // ---- small helpers -----------------------------------------------------

  function toast(message) {
    if (typeof window.bpozzShowToast === "function") {
      window.bpozzShowToast(message);
    }
  }

  // This file builds HTML by concatenation, so anything out of the data file
  // is escaped on the way in rather than trusted. Same rule, same reason, as
  // palettes.js.
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }

  // ---- contrast ----------------------------------------------------------
  // The HEX label sits ON the colour, so its own colour cannot be a constant
  // and cannot be assigned per record by hand. It is computed.
  //
  // WCAG relative luminance and a real contrast ratio, not the YIQ
  // approximation palettes.js uses for its hover label. The difference
  // matters here because this label is always visible and is the card's main
  // text: YIQ's single 150 threshold mislabels the mid-tones, where the two
  // candidates are genuinely close, and those are exactly the colours a
  // 300-swatch grid is full of. Picking whichever of black/white actually
  // scores higher is both cheap and correct by construction.

  function channel(v) {
    var c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    return (
      0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
      0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
      0.0722 * channel(parseInt(hex.slice(5, 7), 16))
    );
  }

  /** Contrast ratio of `hex` against pure white and pure black. */
  function contrasts(hex) {
    var l = luminance(hex);
    return { onWhite: 1.05 / (l + 0.05), onBlack: (l + 0.05) / 0.05 };
  }

  /**
   * The label colour for a swatch: whichever of pure black and pure white
   * scores higher against it.
   *
   * WHY PURE, AND NOT A SOFTER rgba()
   *
   * Because pure is the only version with a guarantee. Softening the label
   * the way palettes.js does (rgba(0,0,0,0.62) / rgba(255,255,255,0.85))
   * looks better and is fine there, where the hex is a small hover-revealed
   * caption. Here it is always-visible body text on 300 different
   * backgrounds, so it has to clear WCAG AA — 4.5:1 — on every one of them,
   * including ones nobody has picked yet.
   *
   * Taking the better of black and white gives exactly that, as arithmetic
   * rather than as a hope. The two ratios are 1.05/(L+0.05) and
   * (L+0.05)/0.05; the first falls as L rises and the second climbs, so the
   * worse case for max(black, white) is where they cross — (L+0.05)² =
   * 0.0525, L ≈ 0.179 — and there they are both 4.58:1. No colour can score
   * lower than that, so no colour in this library can fail AA.
   *
   * A 0.78-alpha black was tried first and measured at 3.83:1 on #3876C8,
   * one of the blues actually in the data. The alpha is what cost it; the
   * choice of black over white was right. Hence pure.
   */
  function labelColorFor(hex) {
    var c = contrasts(hex);
    return c.onBlack >= c.onWhite ? "#000000" : "#FFFFFF";
  }

  /**
   * The scrim behind the "Copied" overlay, in the same polarity as the label
   * so the two always agree: a light swatch gets a white veil under dark
   * text, a dark swatch a black veil under light text.
   */
  function veilColorFor(hex) {
    var c = contrasts(hex);
    return c.onBlack >= c.onWhite
      ? "rgba(255,255,255,0.72)"
      : "rgba(0,0,0,0.45)";
  }

  /**
   * A hairline ring for swatches that are nearly the page background. Without
   * it a #FDFDFF card has no visible edge on white. Returned as a colour, and
   * transparent for everything else, so the ring is always painted and only
   * sometimes visible — no layout difference between the two cases.
   * Neutral black, as the label and veil above and the Image Picker's ring:
   * a tinted ring would tint the swatch it frames.
   */
  function ringColorFor(hex) {
    return contrasts(hex).onWhite < 1.25
      ? "rgba(0,0,0,0.16)"
      : "rgba(0,0,0,0.06)";
  }

  // ---- shared screen-reader announcement ---------------------------------
  // One region for the whole page, not one per card. The visual "Copied"
  // overlay is aria-hidden, so this is what carries the confirmation to
  // assistive tech. Declared in the page markup (#colors-copy-status) and
  // created here only if it is somehow absent, so the announcement can never
  // depend on markup this file does not control.

  var srStatus = null;
  var srTimer = null;

  function getSrStatus() {
    if (srStatus && srStatus.isConnected) return srStatus;
    srStatus = document.getElementById("colors-copy-status");
    if (!srStatus) {
      srStatus = document.createElement("div");
      srStatus.id = "colors-copy-status";
      srStatus.setAttribute("role", "status");
      srStatus.setAttribute("aria-live", "polite");
      srStatus.setAttribute("aria-atomic", "true");
      srStatus.className = "sr-only";
      document.body.appendChild(srStatus);
    }
    return srStatus;
  }

  function announce(message) {
    var region = getSrStatus();
    if (srTimer) clearTimeout(srTimer);
    // Blank it first: copying the same swatch twice would otherwise write an
    // identical string, which is not a text change and so announces nothing.
    region.textContent = "";
    srTimer = setTimeout(function () {
      srTimer = null;
      region.textContent = message;
    }, 60);
  }

  // ---- copy --------------------------------------------------------------

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function copyHex(hex, swatch) {
    function ok() {
      markCopied(swatch);
      announce("Copied " + hex);
    }
    function failed() {
      toast("Couldn't copy — select and copy manually");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(hex).then(ok, function () {
        if (legacyCopy(hex)) ok();
        else failed();
      });
    } else {
      if (legacyCopy(hex)) ok();
      else failed();
    }
  }

  // ---- per-card "Copied" state -------------------------------------------
  // Exactly one card can be in the copied state at a time; copying a second
  // card moves it. The state is an attribute on the button, so it survives
  // filtering (which only toggles a class on the card) and needs no re-render.

  var COPIED_MS = 1400;
  var copiedSwatch = null;
  var copiedTimer = null;

  function clearCopiedState() {
    if (copiedTimer) {
      clearTimeout(copiedTimer);
      copiedTimer = null;
    }
    if (copiedSwatch) {
      copiedSwatch.removeAttribute("data-copied");
      copiedSwatch = null;
    }
  }

  function markCopied(swatch) {
    if (!swatch) return;
    clearCopiedState();
    copiedSwatch = swatch;
    swatch.setAttribute("data-copied", "true");
    copiedTimer = setTimeout(function () {
      copiedTimer = null;
      if (copiedSwatch) copiedSwatch.removeAttribute("data-copied");
      copiedSwatch = null;
    }, COPIED_MS);
  }

  // ---- state -------------------------------------------------------------

  var colors = [];
  var categories = [];
  var activeCategory = ALL;

  // ---- render ------------------------------------------------------------

  /**
   * Once Saved is launched, a bookmark beside the name that saves the
   * colour to the account. It is one of saved.js's controls
   * (data-save-kind, -id and -name): saved.js paints it, saves or removes
   * on click, opens sign-in when signed out and announces the outcome.
   * This file never handles its click — the grid's delegation below knows
   * only .color-card__plate — so the copy is untouched by it. A colour
   * whose id Saved wouldn't accept gets no button.
   */
  function saveHtml(color) {
    if (!account || !account.isValidItem("color", color.id)) return "";
    // Its name, as its card shows it, for the announcement.
    var name = typeof color.name === "string" ? color.name : "";
    return (
      '<button type="button" class="color-save-btn" data-save-kind="color" data-save-id="' +
      color.id +
      '"' +
      (name ? ' data-save-name="' + escapeHtml(name) + '"' : "") +
      ' aria-pressed="false" aria-label="Save this color"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>'
    );
  }

  /**
   * One card = one colour. The whole colour plate is the copy button, so the
   * target is the large thing rather than the small HEX text — which is what
   * §4's "fast copy" actually means on a touch screen.
   *
   * The accessible name carries both values ("Copy #AB274F, Cherry Rose")
   * because the name below the plate is in a separate element and a screen
   * reader on the button alone would otherwise hear a bare hex. The visible
   * HEX text is aria-hidden for the same reason: it would otherwise be read
   * twice, once as itself and once inside the label.
   */
  function cardHtml(color) {
    var hex = color.hex;
    var name = escapeHtml(color.name);
    var label = escapeHtml("Copy " + hex + ", " + color.name);
    // Launched, the name and its Save share one row; otherwise the name
    // stands alone, exactly as before.
    var save = saveHtml(color);
    return (
      '<article class="color-card" data-id="' +
      escapeHtml(color.id) +
      '" data-category="' +
      escapeHtml(color.category) +
      '">' +
      '<button type="button" class="color-card__plate" data-hex="' +
      hex +
      '" style="--color-hex:' +
      hex +
      ";--color-label:" +
      labelColorFor(hex) +
      ";--color-veil:" +
      veilColorFor(hex) +
      ";--color-ring:" +
      ringColorFor(hex) +
      '" aria-label="' +
      label +
      '">' +
      '<span class="color-card__hex" aria-hidden="true">' +
      hex.replace("#", "") +
      "</span>" +
      '<span class="color-card__copied" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>' +
      "Copied</span>" +
      "</button>" +
      (save ? '<div class="color-card__foot">' : "") +
      '<p class="color-card__name">' +
      name +
      "</p>" +
      (save ? save + "</div>" : "") +
      "</article>"
    );
  }

  /**
   * Builds every card once. Filtering never calls this — it toggles
   * [hidden] on cards that are already in the DOM, which is why switching
   * category is a class change rather than 300 re-parsed elements.
   *
   * IF THIS EVER GETS SLOW (it will not at 300, and should be fine into the
   * low thousands): the first thing to reach for is rendering in one
   * requestAnimationFrame-chunked pass, not a framework and not pagination.
   * The data contract and the card markup do not have to change for that.
   */
  function render() {
    if (!colors.length) {
      gridRoot.innerHTML = "";
      if (emptyState) emptyState.setAttribute("data-visible", "true");
      return;
    }
    if (emptyState) emptyState.removeAttribute("data-visible");
    gridRoot.innerHTML = colors.map(cardHtml).join("");
    // The Save buttons just drawn are saved.js's from here (saveHtml).
    if (account) account.sync(gridRoot);
  }

  function applyFilter(announceResult) {
    var shown = 0;
    var cards = gridRoot.children;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var match =
        activeCategory === ALL ||
        card.getAttribute("data-category") === activeCategory;
      if (match) {
        card.removeAttribute("hidden");
        shown += 1;
      } else {
        card.setAttribute("hidden", "");
      }
    }

    var noun = shown === 1 ? "color" : "colors";
    var where = activeCategory === ALL ? "" : " in " + activeCategory;
    if (countLine) {
      countLine.textContent =
        "Showing " + shown + " " + noun + where + ".";
    }
    // The filter buttons expose their own state through aria-pressed; this
    // is the RESULT, which no button can announce. Only fired on a real
    // filter change, never on first paint, so a page load is not narrated.
    if (announceResult && resultStatus) {
      resultStatus.textContent = "";
      setTimeout(function () {
        resultStatus.textContent = "Showing " + shown + " " + noun + where + ".";
      }, 60);
    }
    return shown;
  }

  /**
   * The filter row, built from the categories the data actually contains.
   * A real <button> per category — never a link, because nothing navigates
   * and a link here would promise a URL that does not exist.
   */
  function renderFilters() {
    if (!filterRoot) return;
    var chips = [ALL].concat(categories);
    filterRoot.innerHTML = chips
      .map(function (category) {
        var isAll = category === ALL;
        var swatch = isAll
          ? ""
          : '<span class="colors-filter__dot" style="--dot:' +
            swatchFor(category) +
            '" aria-hidden="true"></span>';
        return (
          '<button type="button" class="colors-filter" data-category="' +
          escapeHtml(category) +
          '" aria-pressed="' +
          (category === activeCategory ? "true" : "false") +
          '">' +
          swatch +
          escapeHtml(category) +
          "</button>"
        );
      })
      .join("");
  }

  /**
   * The dot on a filter chip: the most vivid colour the category actually
   * holds. A sample of the data, not a second hand-picked palette that can
   * drift away from it — add a category to colors-data.json and its chip
   * gets a dot without anyone choosing one.
   *
   * "Most vivid" is raw channel spread, tie-broken toward mid lightness.
   * Chroma rather than a contrast score, because contrast measures how far
   * a colour is from black or white and so rewards the palest member of a
   * bucket: scored that way, Red's dot came out a pale pink and Brown's a
   * beige. Chroma rewards the most colourful member instead, which is what
   * a category dot is meant to be. On the neutral buckets every member has
   * low chroma by construction, so the pick stays neutral there — the
   * lightness tie-break just keeps it from being the most extreme one.
   */
  function swatchFor(category) {
    var pick = null;
    var bestChroma = -1;
    var bestOffset = 1;

    colors.forEach(function (color) {
      if (color.category !== category) return;
      var hex = color.hex;
      var r = parseInt(hex.slice(1, 3), 16);
      var g = parseInt(hex.slice(3, 5), 16);
      var b = parseInt(hex.slice(5, 7), 16);
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      var chroma = max - min;
      var offset = Math.abs((max + min) / 2 / 255 - 0.5);
      if (chroma > bestChroma || (chroma === bestChroma && offset < bestOffset)) {
        bestChroma = chroma;
        bestOffset = offset;
        pick = hex;
      }
    });

    return pick || "#CCCCCC";
  }

  function categoriesFrom(data) {
    var found = [];
    data.forEach(function (color) {
      if (color.category && found.indexOf(color.category) === -1) {
        found.push(color.category);
      }
    });
    var known = CATEGORY_ORDER.filter(function (c) {
      return found.indexOf(c) !== -1;
    });
    // Anything the data has that CATEGORY_ORDER does not name still gets a
    // chip. A category that renders no control is data nobody can reach.
    var extra = found
      .filter(function (c) {
        return CATEGORY_ORDER.indexOf(c) === -1;
      })
      .sort();
    return known.concat(extra);
  }

  // ---- events ------------------------------------------------------------

  gridRoot.addEventListener("click", function (e) {
    var plate = e.target.closest(".color-card__plate");
    if (!plate) return;
    copyHex(plate.getAttribute("data-hex"), plate);
  });

  if (filterRoot) {
    filterRoot.addEventListener("click", function (e) {
      var chip = e.target.closest(".colors-filter");
      if (!chip) return;
      var next = chip.getAttribute("data-category");
      if (next === activeCategory) return;
      activeCategory = next;
      var buttons = filterRoot.querySelectorAll(".colors-filter");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute(
          "aria-pressed",
          buttons[i] === chip ? "true" : "false",
        );
      }
      applyFilter(true);
    });
  }

  // ---- load --------------------------------------------------------------

  // SITE-ROOT, not "./colors-data.json", and the difference is not cosmetic.
  // This page is served at /colors as well as /colors/ — Netlify's Pretty
  // URLs canonicalises one to the other, but a request that arrives at the
  // slashless form resolves "./" against the SITE ROOT, so a relative fetch
  // there asks for /colors-data.json and gets a 404 with nothing but an
  // empty grid to show for it. Caught in browser QA, where the local static
  // server does not redirect.
  //
  // It is also what the rest of the page already does: /styles.css,
  // /colors/colors.css and /colors/colors.js are all site-root, for the
  // reason src/build/head.js states about the stylesheets.
  //
  // src/client/palettes.js had the same exposure (D2 in the Step 10
  // handoff) and now fetches site-root too.
  fetch("/colors/colors-data.json")
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      colors = Array.isArray(data) ? data : [];
      categories = categoriesFrom(colors);
      renderFilters();
      render();
      applyFilter(false);
      // The intro line states the real size of the library rather than a
      // number typed into the HTML, so growing colors-data.json updates the
      // copy by itself. The markup ships a truthful fallback for the
      // no-JS/failed-fetch case.
      var intro = document.getElementById("colors-intro");
      if (intro && colors.length) {
        intro.textContent =
          "Browse " +
          colors.length +
          " named colors. Filter by family, then click any color to copy its HEX value.";
      }
    })
    .catch(function (err) {
      console.error("Couldn't load colors-data.json", err);
      if (emptyState) emptyState.setAttribute("data-visible", "true");
    });
})();
