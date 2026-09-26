/**
 * card.js — the one Guide card renderer, and the one home for category
 * presentation metadata.
 * -----------------------------------------------------------------------
 * PHASE 3 (deduplication). Three files each carried their own copy of the
 * Guide card: app.js (client-side re-render), build-home.js (the pre-
 * rendered guides/index.html grid and the homepage Featured Guides rail)
 * and build-categories.js (the category archive grids). Each copy carried
 * its own THUMBS, THUMB_DIM_LABEL and LEVEL_LABEL maps, and all three
 * files' headers carried a "keep these in sync by hand" warning. This is
 * that one implementation; the warnings are gone because the drift they
 * warned about is now impossible.
 *
 * WHAT MOVED HERE (category metadata, one data source)
 *   ICONS            24x24 nav-scale category icons
 *   THUMBS           240x120 blueprint motifs drawn on the card plate
 *   THUMB_DIM_LABEL  the dimension callout printed under each motif
 *   LEVEL_LABEL      full-word level names used in the card meta line
 *
 * WHAT DID NOT MOVE
 *   Category *labels*. categories.json is already their single source of
 *   truth for every build-time consumer, and app.js keeps its own literal
 *   map in the browser because a runtime fetch of categories.json was
 *   rejected (D1 A). Phase 3 does not reopen that. The label map is
 *   therefore injected by the caller, via createRenderer().
 *
 * THE BADGE ARGUMENT
 * build-categories.js stamped a "Guide" badge into its copy of cardHtml();
 * build-home.js passed one in as an optional second argument and left it
 * empty for guides/index.html, whose grid app.js re-renders client-side.
 * The optional argument is the general case, so it is what survived — with
 * build-home.js's typeof guard, which exists because cardHtml is also used
 * as `guides.map(cardHtml)` and would otherwise receive the array index as
 * badge markup. guides/index.html's grid must stay badge-free: app.js
 * re-renders it client-side, so anything added unconditionally would be
 * wiped on the first filter keystroke.
 *
 * createRenderer({ categories }) binds cardHtml to a slug -> { label } map.
 * Extra fields on an entry (build-categories.js adds `code`) are ignored.
 *
 *   Browser: concatenated into /app.js by the build -> window.BpozzCard
 *   Node:    const BpozzCard = require("./card.js");
 *
 * This file is a BUILD INPUT ONLY. It is never published on its own — see
 * APP_BUNDLE in src/build.js.
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./html.js"));
  } else {
    root.BpozzCard = factory(root.BpozzHtml);
  }
})(typeof self !== "undefined" ? self : this, function (BpozzHtml) {
  "use strict";

  var escapeHtml = BpozzHtml.escapeHtml;

  var ICONS = {
    "color-theory":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><circle cx="15" cy="9" r="6"/><circle cx="12" cy="15" r="6"/></svg>',
    typography:
      '<svg viewBox="0 0 24 24"><text x="1" y="17" font-family="Georgia, serif" font-size="15" fill="currentColor">Aa</text></svg>',
    spacing:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="1.4"/></svg>',
    figma:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="4" width="12" height="12" rx="2"/><rect x="8" y="8" width="12" height="12" rx="2"/></svg>',
    "adobe-xd":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 L10 6 L14 14 L20 4"/><circle cx="10" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="14" cy="14" r="1.3" fill="currentColor" stroke="none"/></svg>',
    mobile:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="10" y1="19" x2="14" y2="19"/></svg>',
    web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="6" cy="7" r=".6" fill="currentColor" stroke="none"/><circle cx="8.6" cy="7" r=".6" fill="currentColor" stroke="none"/></svg>',
    systems:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    accessibility:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4 A8 8 0 0 1 12 20 Z" fill="currentColor" stroke="none"/></svg>',
    motion:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 A8 8 0 0 1 18 6"/><polygon points="16,3 21,6 16,9" fill="currentColor" stroke="none"/></svg>',
  };

  // Larger, more detailed blueprint-style motifs used on each guide
  // card's thumbnail plate. Each one is an inner SVG fragment (no
  // <svg> wrapper — that's added by thumbHtml) drawn in a shared
  // 240x120 coordinate space so the dimension line stays aligned.
  var THUMBS = {
    "color-theory": `
      <circle cx="102" cy="38" r="20"/>
      <circle cx="138" cy="38" r="20"/>
      <circle cx="120" cy="64" r="20"/>
    `,
    typography: `
      <line x1="60" y1="20" x2="180" y2="20" class="thumb-guide"/>
      <line x1="60" y1="78" x2="180" y2="78" class="thumb-guide"/>
      <text x="78" y="76" class="thumb-glyph">Aa</text>
    `,
    spacing: `
      <circle class="thumb-fill" cx="90" cy="24" r="3.4"/><circle class="thumb-fill" cx="120" cy="24" r="3.4"/><circle class="thumb-fill" cx="150" cy="24" r="3.4"/>
      <circle class="thumb-fill" cx="90" cy="44" r="3.4"/><circle class="thumb-fill" cx="120" cy="44" r="3.4"/><circle class="thumb-fill" cx="150" cy="44" r="3.4"/>
      <circle class="thumb-fill" cx="90" cy="64" r="3.4"/><circle class="thumb-fill" cx="120" cy="64" r="3.4"/><circle class="thumb-fill" cx="150" cy="64" r="3.4"/>
    `,
    figma: `
      <rect x="82" y="16" width="50" height="50" rx="6"/>
      <rect x="110" y="40" width="50" height="50" rx="6"/>
      <rect class="thumb-fill" x="107.5" y="37.5" width="5" height="5"/>
      <rect class="thumb-fill" x="157.5" y="37.5" width="5" height="5"/>
      <rect class="thumb-fill" x="107.5" y="87.5" width="5" height="5"/>
      <rect class="thumb-fill" x="157.5" y="87.5" width="5" height="5"/>
    `,
    "adobe-xd": `
      <path d="M70,86 L100,20 L130,60 L170,16"/>
      <circle class="thumb-fill" cx="100" cy="20" r="3.2"/>
      <circle class="thumb-fill" cx="130" cy="60" r="3.2"/>
      <circle class="thumb-handle-dot" cx="70" cy="86" r="3"/>
      <circle class="thumb-handle-dot" cx="170" cy="16" r="3"/>
      <line x1="100" y1="20" x2="85" y2="6" class="thumb-handle"/>
      <circle class="thumb-handle-dot" cx="85" cy="6" r="2.4"/>
    `,
    mobile: `
      <rect x="99" y="12" width="42" height="78" rx="7"/>
      <line x1="107" y1="24" x2="133" y2="24" stroke-width="1.2"/>
      <rect x="107" y="32" width="26" height="12" rx="2" stroke-width="1.2"/>
      <line x1="107" y1="50" x2="133" y2="50" stroke-width="1.2"/>
      <line x1="107" y1="56" x2="133" y2="56" stroke-width="1.2"/>
      <line x1="113" y1="84" x2="127" y2="84" stroke-width="2.2" stroke-linecap="round"/>
    `,
    web: `
      <rect x="50" y="18" width="140" height="70" rx="4"/>
      <line x1="50" y1="32" x2="190" y2="32" stroke-width="1.2"/>
      <circle class="thumb-fill" cx="60" cy="25" r="2"/>
      <circle class="thumb-fill" cx="68" cy="25" r="2"/>
      <circle class="thumb-fill" cx="76" cy="25" r="2"/>
      <rect x="58" y="40" width="26" height="40" stroke-width="1.2"/>
      <rect x="94" y="40" width="88" height="16" rx="1" stroke-width="1.2"/>
      <rect x="94" y="62" width="60" height="16" rx="1" stroke-width="1.2"/>
    `,
    systems: `
      <rect x="75" y="18" width="44" height="18" rx="4"/>
      <line x1="85" y1="27" x2="109" y2="27" stroke-width="1.2"/>
      <rect x="130" y="18" width="50" height="18" rx="2"/>
      <line x1="140" y1="23" x2="140" y2="31" stroke-width="1.2"/>
      <rect x="75" y="50" width="16" height="16" rx="3"/>
      <path d="M78,58 L82,62 L88,52" stroke-width="1.8"/>
      <line x1="98" y1="58" x2="150" y2="58" stroke-width="1.2"/>
    `,
    accessibility: `
      <path d="M65,44 Q100,18 135,44 Q100,70 65,44 Z"/>
      <circle cx="100" cy="44" r="10"/>
      <circle class="thumb-fill" cx="100" cy="44" r="3"/>
      <rect class="thumb-fill" x="152" y="60" width="9" height="14" style="opacity:.35"/>
      <rect class="thumb-fill" x="166" y="52" width="9" height="22" style="opacity:.65"/>
      <rect class="thumb-fill" x="180" y="44" width="9" height="30"/>
    `,
    motion: `
      <line x1="70" y1="18" x2="70" y2="88" stroke-width="1.2"/>
      <line x1="70" y1="88" x2="185" y2="88" stroke-width="1.2"/>
      <path d="M70,88 C110,80 145,28 185,20" stroke-width="1.8"/>
      <line x1="70" y1="88" x2="110" y2="80" class="thumb-handle"/>
      <line x1="185" y1="20" x2="145" y2="28" class="thumb-handle"/>
      <circle class="thumb-handle-dot" cx="110" cy="80" r="2.6"/>
      <circle class="thumb-handle-dot" cx="145" cy="28" r="2.6"/>
      <circle class="thumb-fill" cx="70" cy="88" r="3"/>
      <circle class="thumb-fill" cx="185" cy="20" r="3"/>
    `,
  };

  // The little dimension-style callout printed under each thumbnail
  // motif — a nod to the "documented like blueprints" framing.
  var THUMB_DIM_LABEL = {
    "color-theory": "4.5:1",
    typography: "16 / 24",
    spacing: "8 · 16 · 24",
    figma: "AUTO LAYOUT",
    "adobe-xd": "PEN TOOL",
    mobile: "375 × 812",
    web: "1440 × 900",
    systems: "DESIGN TOKENS",
    accessibility: "WCAG AA",
    motion: "EASE-OUT",
  };

  // Full-word level labels for the content-card meta line (e.g. "Spacing &
  // Layout · Beginner · 11 min read"), shared by the homepage grid and
  // the related-guides row below each article — both render with the
  // exact same cardHtml().
  var LEVEL_LABEL = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
  };

  // Intrinsic size of every guide thumbnail in thumbnail_image_webp/.
  var THUMB_WIDTH = 1448;
  var THUMB_HEIGHT = 1086;

  function dimLine(label) {
    var x1 = 64,
      x2 = 176,
      y = 99;
    return (
      '<line x1="' +
      x1 +
      '" y1="' +
      y +
      '" x2="' +
      x2 +
      '" y2="' +
      y +
      '" class="thumb-dim-line"/>' +
      '<line x1="' +
      x1 +
      '" y1="' +
      (y - 4) +
      '" x2="' +
      x1 +
      '" y2="' +
      (y + 4) +
      '" class="thumb-dim-tick"/>' +
      '<line x1="' +
      x2 +
      '" y1="' +
      (y - 4) +
      '" x2="' +
      x2 +
      '" y2="' +
      (y + 4) +
      '" class="thumb-dim-tick"/>' +
      '<text x="' +
      (x1 + x2) / 2 +
      '" y="' +
      (y + 13) +
      '" text-anchor="middle" class="thumb-dim-label">' +
      escapeHtml(label) +
      "</text>"
    );
  }

  // Shared media layer for both the content-card thumbnail and the
  // article hero image. The blueprint-style SVG icon is always
  // rendered first as a base layer; if a `thumbnail` image is set,
  // it's layered on top and covers the icon once it loads. If that
  // image file hasn't been added yet (or fails to load for any
  // reason), its onerror handler hides it, so the SVG icon shows
  // through underneath instead of a broken-image glyph.
  function thumbMediaHtml(g) {
    var svg =
      '<svg viewBox="0 0 240 120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      THUMBS[g.category] +
      dimLine(THUMB_DIM_LABEL[g.category]) +
      "</svg>";
    if (!g.thumbnail) return svg;
    // width/height are the thumbnails' intrinsic size (every file in
    // thumbnail_image_webp/ is 1448x1086, 4:3 — card.test.js checks it).
    // They only give the browser an aspect ratio up front: the displayed
    // size still comes from CSS (.card-thumb img / .article-hero img are
    // absolutely positioned at 100% x 100% of a fixed-ratio box).
    var img =
      '<img src="' +
      escapeHtml(g.thumbnail) +
      '" alt="' +
      escapeHtml(g.title) +
      '" width="' +
      THUMB_WIDTH +
      '" height="' +
      THUMB_HEIGHT +
      '" loading="lazy" onerror="this.style.display=\'none\'">';
    return svg + img;
  }

  function thumbHtml(g) {
    return '<div class="card-thumb">' + thumbMediaHtml(g) + "</div>";
  }

  // Binds cardHtml to a category label map (see the file header).
  //
  // PHASE 4 STEP 9 (accessibility) — `titleTag`.
  // The card's title is a real heading, so its LEVEL depends on what the
  // grid hangs off on the page that draws it, and that differs by caller:
  //
  //   home / guides / search   the grid sits under an <h2> section heading
  //                            ("/ featured_guides", "/ all_guides"), so the
  //                            card title is correctly an h3.
  //   category pages           there is no section heading between the page
  //                            <h1> and the grid, so an h3 skipped a level
  //                            (WCAG 1.3.1) and h2 is correct.
  //
  // It is a value rather than a second renderer for the same reason the
  // badge is (see the file header): one implementation, and the difference
  // between callers stays a difference in data. Default "h3" keeps every
  // existing caller's output byte-identical — only categories.js opts in.
  // Only h2/h3 are accepted; anything else falls back to h3 rather than
  // interpolating caller text into a tag name.
  function createRenderer(options) {
    var categories = (options && options.categories) || {};
    var titleTag = (options && options.titleTag) === "h2" ? "h2" : "h3";

    // Minimal, resourceboy.com-style card: plain thumbnail, a title, and
    // one small muted meta line ("category · level · read time"). The
    // title's .card-link stretches over the whole .content-card (see
    // styles.css), so the entire tile is one click target. `badgeHtml` is
    // optional; non-strings are ignored so `.map(cardHtml)` stays safe.
    function cardHtml(g, badgeHtml) {
      var cat = categories[g.category];
      var meta =
        cat.label +
        " · " +
        LEVEL_LABEL[g.level] +
        " · " +
        g.readTime +
        " min read";
      return (
        '<article class="content-card">' +
        thumbHtml(g) +
        '<div class="card-body">' +
        (typeof badgeHtml === "string" ? badgeHtml : "") +
        "<" +
        titleTag +
        ' class="card-title"><a class="card-link" href="/guide/' +
        g.id +
        '">' +
        escapeHtml(g.title) +
        "</a></" +
        titleTag +
        ">" +
        '<p class="card-meta">' +
        escapeHtml(meta) +
        "</p>" +
        "</div>" +
        "</article>"
      );
    }

    return {
      dimLine: dimLine,
      thumbMediaHtml: thumbMediaHtml,
      thumbHtml: thumbHtml,
      cardHtml: cardHtml,
    };
  }

  return {
    ICONS: ICONS,
    THUMBS: THUMBS,
    THUMB_DIM_LABEL: THUMB_DIM_LABEL,
    THUMB_WIDTH: THUMB_WIDTH,
    THUMB_HEIGHT: THUMB_HEIGHT,
    LEVEL_LABEL: LEVEL_LABEL,
    dimLine: dimLine,
    thumbMediaHtml: thumbMediaHtml,
    thumbHtml: thumbHtml,
    createRenderer: createRenderer,
  };
});
