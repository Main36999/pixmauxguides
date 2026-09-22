/**
 * src/build/home.js — the three home-surface pages, rendered in-process.
 *
 * PHASE 4 STEP 3D — the last legacy builder to leave RENDER_ORDER, which
 * takes RENDER_ORDER, the staging of build inputs and the child-process
 * machinery with it. `render` no longer shells out to anything.
 *
 * This is `build-home.js` ported verbatim in behaviour and deleted at the
 * root. It is a patcher, like the header and the footer, not a writer like
 * categories — it splices generated regions into three pages that already
 * exist, and every marker pair is required.
 *
 * WHAT IT RENDERS
 *
 *   index.html          the homepage resource sections (Phase 5), between
 *                       RESOURCE_SECTIONS_START/END, from resource-types.json
 *                       + content-index.json (+ guides.json for the Guides
 *                       section's cards and roadmap ordering). Since Phase 6
 *                       the homepage carries no full guide grid; its Guides
 *                       section is a 10-card "Featured Guides" preview.
 *   guides/index.html   the Guides collection (Phase 6): the full guide grid
 *                       (#grid-root, between GUIDES_GRID_START/END), its
 *                       results count (RESULTS_COUNT) and the
 *                       category-discovery links (GUIDE_CATEGORIES_START/END).
 *                       The grid is the exact markup /app.js re-renders
 *                       client-side: both draw the card from
 *                       src/shared/card.js.
 *   roadmap.html        the learning roadmap (#roadmap), which has no
 *                       client-side equivalent at all — app.js only layers
 *                       "mark as read" checkbox/progress-bar behaviour on top
 *                       of what this module writes.
 *
 * WHY THESE PAGES ARE PRE-RENDERED
 *
 * Unchanged from the builder this replaces. #grid-root used to start empty
 * and was filled in by app.js only after a client-side fetch("/guides.json"),
 * so the guide list — the site's core content — did not exist in the raw HTML
 * until JavaScript ran. Pre-rendering closes that gap: guides.json stays the
 * single source of truth, and its contents are written into the three pages
 * as plain HTML, readable with JavaScript off and by any crawler that does
 * not execute JS. The client bundle is unchanged and still re-renders
 * #grid-root for live search/filter — it just now enhances a page that
 * already has real content on it.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 *
 * The same three moves Step 3C made for categories, and one that is specific
 * to being last out:
 *
 *   1. THE INPUTS COME FROM ctx, NOT FROM THE STAGING ROOT. The builder
 *      resolved five inputs from its own __dirname, which staging pointed at
 *      .build/. This module takes them from the model the `load` and `data`
 *      stages already built:
 *
 *        guides.json          -> ctx.model.guides
 *        categories.json      -> ctx.model.categories
 *        resource-types.json  -> ctx.model.resourceTypes
 *        content-index.json   -> ctx.contentIndex
 *
 *      All four were verified equal to the staged copies the builder read
 *      before the swap, by JSON comparison against a live .build/.
 *      ctx.contentIndex matters most, for the reason the builder's own header
 *      gave: it is the index the `data` stage generates immediately
 *      beforehand, NOT the committed copy at the repo root.
 *
 *      categories.json was read twice by the builder — once at require time
 *      for the card renderer's label map, once during the build for the
 *      category-discovery links — through two separate loaders with two
 *      separate validators. Both loaders survive and both now read the same
 *      in-memory array. PHASE 4 STEP 6: they no longer validate. The schema
 *      they each re-stated (and which src/build/categories.js re-stated a
 *      third time) is checked once in `load`; the two functions are
 *      projections over an array that has already been checked.
 *
 *   2. THE PAGES ARE NAMED, NOT INFERRED. The builder wrote to
 *      path.join(__dirname, …); this module resolves the same three pages
 *      under ctx.config.paths.stage. It must stay the staging root:
 *      categories, then the header, then the footer still have to run over
 *      these pages before `render` publishes them to dist/.
 *
 *   3. THE REPORTING IS RETURNED, NOT PRINTED. The builder's three
 *      console.log summaries went to the child's stdout, which `render`
 *      scanned only for lines beginning with ⚠ and otherwise discarded, and
 *      its one console.warn went to stderr, which was never scanned at all —
 *      verified by probe before this change. All of it is returned to the
 *      caller now: the summaries feed the `render` stage's one-line summary,
 *      and the "category with no guides" warning goes through ctx.warn, the
 *      same channel categories, header and footer report on. That warning is
 *      dormant against the current data (all 10 categories carry at least one
 *      guide), so the build log gains nothing today.
 *
 *   4. IT IS NO LONGER STAGED AS A FILE. Every other builder that ran from
 *      .build/ is already gone; this one was the last, which is why Step 3D
 *      also removes the builder-staging loop and the execFileSync call in
 *      src/build/build.js. Route pages are still staged — they are what this
 *      module, categories, the header and the footer all read and write.
 *
 * Everything the output depends on is unchanged and deliberately so:
 *
 *   - every marker pair is REQUIRED. Unlike the header and the footer, which
 *     skip and report a page missing their markers, replaceBetween() here
 *     throws with the file and marker named, so a structural change to one of
 *     the three pages fails the build rather than silently dropping a region;
 *   - only the text between the markers is replaced, at the FIRST occurrence
 *     of each, via the same indexOf arithmetic;
 *   - all three pages are written unconditionally on every run, as the
 *     builder wrote them — there is no "already current" short-circuit here;
 *   - guides/index.html's grid is still built with `guides.map(cardHtml)`,
 *     which hands the renderer the array INDEX as its badge argument. The
 *     renderer ignores a non-string badge by design, and that is what keeps
 *     the collection grid badge-free while the homepage's Featured Guides
 *     cards carry one. It is transcribed exactly, not "fixed";
 *   - the duplicate-colour exclusion, the per-sort comparators, the
 *     resource-type validation, the hex validation and the roadmap grouping
 *     are all byte-for-byte the builder's;
 *   - a content-index record with no matching guides.json entry still fails
 *     the build with the same stale-index explanation.
 *
 * PHASE 4 STEP 6 — WHAT THIS MODULE STOPPED OWNING
 *
 * Four things, none of which changed a byte of output:
 *
 *   - the categories.json schema, re-stated by loadCategoryLabels() and
 *     loadGuideCategories();
 *   - the resource-types.json schema, re-stated by loadResourceTypes() and
 *     — differently, over its own fs read — by src/build/header.js;
 *   - TYPE_BADGE_LABEL, also declared in src/build/categories.js;
 *   - tagsMetaFor(), also declared in src/build/categories.js, with a
 *     slightly different guard.
 *
 * All four live in src/build/content.js now, the module that already owns the
 * content model. loadResourceTypes() keeps the one check that is about THIS
 * module rather than about the file — that `home.sort` names a comparator it
 * implements. Both vocabulary bindings are re-exported here unchanged.
 *
 * ORDER
 *
 * home → categories → guides → header → footer, all of them ordinary
 * function calls in that order. Home needs the content index the `data` stage
 * wrote; categories and guides write their pages from the raw partials; the
 * header restores `aria-current`; the footer is last and rewrites only its
 * own marker region, so it disturbs neither. This module's own position —
 * first — is unchanged; Step 4 added the guide pages after it, and the two
 * touch no file in common.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("../shared/html.js");
const BpozzCard = require("../shared/card.js");
const content = require("./content.js");

/**
 * PHASE 4 STEP 6 — content-index vocabulary, from its one home.
 *
 * Both of these were declared here AND in src/build/categories.js, each copy
 * commented as matching the other. They read a content-index record and are
 * keyed off fields src/build/content.js writes onto it, so that is where they
 * live now. Re-exported below so this module's API is unchanged:
 *
 *   TYPE_BADGE_LABEL  the .badge wording for a record's `type`. The homepage
 *                     is the site's one all-types surface — Guides and
 *                     Palettes in two sections of the same page — so a card
 *                     has to say which of the two it is on its own, not only
 *                     via the section eyebrow above it.
 *   tagsMetaFor       the Title Cased tag summary used as the meta line for
 *                     records with no `description` in the index.
 */
const TYPE_BADGE_LABEL = content.TYPE_BADGE_LABEL;
const tagsMetaFor = content.tagsMetaFor;

/** The three pages this module patches, relative to the staging root. */
const INDEX_PAGE = "index.html";
const GUIDES_PAGE = path.join("guides", "index.html");
const ROADMAP_PAGE = "roadmap.html";

/**
 * LEVEL_LABEL is taken from the shared card module because the roadmap's step
 * meta line uses the same "Level · N min read" phrasing as the card meta line.
 */
const LEVEL_LABEL = BpozzCard.LEVEL_LABEL;

// ---------------------------------------------------------------------
// learning roadmap (roadmap.html #roadmap)
// ---------------------------------------------------------------------
// A curated, opinionated reading order through the guides, grouped into
// stages. Unlike the grid, the roadmap has no client-side render path to keep
// in sync — it's built here once, at build time, and the resulting markup is
// static. app.js only layers "mark as read" checkbox + progress-bar behaviour
// on top of it; it never rebuilds this list.
//
// Ordering comes from each guide's `roadmapStage` / `roadmapStep` fields in
// guides.json (roadmapStep is a single 1..N sequence used to sort guides
// within a stage). A guide with no `roadmapStage` is simply left off the
// roadmap — that's the mechanism for keeping a brand-new guide off the
// suggested path until you've decided where it belongs.

const ROADMAP_STAGES = [
  {
    id: 1,
    title: "Foundations",
    blurb:
      "Start here. The three principles every later guide assumes you already know: how space, contrast, and line length carry meaning before color or type styling enters the picture.",
  },
  {
    id: 2,
    title: "Typography & Color Systems",
    blurb:
      "Turn one-off choices into systems — a type scale that resizes itself, a color palette built from tokens instead of swatches, and a dark theme that's re-derived rather than inverted.",
  },
  {
    id: 3,
    title: "Layout, Structure & Accessibility",
    blurb:
      "Make an interface hold together everywhere it's used: Figma's constraint model, a responsive layout that's a contract rather than a breakpoint list, and the accessibility tree underneath it all.",
  },
  {
    id: 4,
    title: "Systems & Motion",
    blurb:
      "The advanced layer teams reach for once the basics are solid: Figma's own data layer for theming, naming conventions that survive a rebrand, and motion timing with real physics behind it.",
  },
];

function roadmapStepHtml(g) {
  const ariaLabel = escapeHtml(`Mark "${g.title}" as read`);
  return (
    `<li class="roadmap-step">` +
    `<label class="roadmap-step-check">` +
    `<input type="checkbox" class="roadmap-step-checkbox" data-roadmap-id="${escapeHtml(g.id)}" aria-label="${ariaLabel}">` +
    `<span class="roadmap-step-box" aria-hidden="true"><svg viewBox="0 0 12 10"><path d="M1 5.2L4.4 8.6L11 1.4"/></svg></span>` +
    `</label>` +
    `<a class="roadmap-step-link" href="/guide/${g.id}">` +
    `<span class="roadmap-step-title">${escapeHtml(g.title)}</span>` +
    `<span class="roadmap-step-meta">${LEVEL_LABEL[g.level]} · ${g.readTime} min read</span>` +
    `</a>` +
    `</li>`
  );
}

function roadmapStageHtml(stage, guides) {
  const num = String(stage.id).padStart(2, "0");
  return (
    `<li class="roadmap-stage" data-stage="${stage.id}">` +
    `<div class="roadmap-stage-marker"><span class="roadmap-stage-num mono">${num}</span></div>` +
    `<div class="roadmap-stage-body">` +
    `<div class="roadmap-stage-headline">` +
    // Phase 4 Step 9 (accessibility): h2, not h3. A stage title sits
    // directly under roadmap.html's one <h1> with no intervening heading,
    // so h3 skipped a level (WCAG 1.3.1). Purely a semantic change: the
    // size and weight come from .roadmap-stage-title, and styles.css
    // resets margin for h1/h2/h3 alike, so the rendering is identical.
    `<h2 class="roadmap-stage-title">${escapeHtml(stage.title)}</h2>` +
    `<span class="roadmap-stage-count">${guides.length} guide${guides.length === 1 ? "" : "s"}</span>` +
    `</div>` +
    `<p class="roadmap-stage-blurb">${escapeHtml(stage.blurb)}</p>` +
    `<ul class="roadmap-steps">${guides.map(roadmapStepHtml).join("")}</ul>` +
    `</div>` +
    `</li>`
  );
}

function formatRoadmapTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `~${m}m`;
  if (m === 0) return `~${h}h`;
  return `~${h}h ${m}m`;
}

/**
 * The roadmap's grouping/ordering, shared by buildRoadmap() (roadmap.html)
 * and roadmapOrder() (the homepage's Featured Guides section, Phase 6), so
 * both read guides in exactly one order. Guides with a numeric `roadmapStage`
 * are sorted by `roadmapStep`, grouped by stage, and the stages are kept in
 * ROADMAP_STAGES order.
 */
function groupRoadmap(guides) {
  const roadmapGuides = guides
    .filter((g) => typeof g.roadmapStage === "number")
    .slice()
    .sort((a, b) => (a.roadmapStep || 0) - (b.roadmapStep || 0));

  const byStage = new Map();
  roadmapGuides.forEach((g) => {
    if (!byStage.has(g.roadmapStage)) byStage.set(g.roadmapStage, []);
    byStage.get(g.roadmapStage).push(g);
  });

  const stagesUsed = ROADMAP_STAGES.filter((s) => byStage.has(s.id));
  return { roadmapGuides, byStage, stagesUsed };
}

/**
 * The guides in the order roadmap.html displays them: stage by stage, step by
 * step. Guides not on the roadmap are not included.
 */
function roadmapOrder(guides) {
  const { byStage, stagesUsed } = groupRoadmap(guides);
  return stagesUsed.reduce(
    (ordered, s) => ordered.concat(byStage.get(s.id)),
    [],
  );
}

/**
 * Builds every piece roadmap.html's #roadmap section needs: the stage-by-stage
 * markup, plus the small stats (stage count / guide count / total reading
 * time) shown above it.
 */
function buildRoadmap(guides) {
  const { roadmapGuides, byStage, stagesUsed } = groupRoadmap(guides);
  const stagesHtml = stagesUsed
    .map((s) => roadmapStageHtml(s, byStage.get(s.id)))
    .join("");

  const totalMinutes = roadmapGuides.reduce(
    (sum, g) => sum + (g.readTime || 0),
    0,
  );

  return {
    stagesHtml,
    stageCount: stagesUsed.length,
    guideCount: roadmapGuides.length,
    totalTimeLabel: formatRoadmapTime(totalMinutes),
  };
}

// ---------------------------------------------------------------------
// homepage resource sections (Phase 5; Guides added in Phase 6)
// ---------------------------------------------------------------------
// The homepage is a discovery surface. Every shipped resource type is
// previewed in a generated "resource section", one per resource-types.json
// entry whose `home` is an object (`home: null` opts a type out of this loop).
// Since Phase 6 that includes Guides (Featured Guides, `sort: "roadmap"`); the
// full, filterable guide grid lives on guides/index.html.
//
// These sections are written between RESOURCE_SECTIONS_START/END, which sit
// inside the homepage's <main id="guides">. The homepage has no #grid-root
// since Phase 6; never put these sections inside one — app.js replaces
// #grid-root's innerHTML on load, so anything inside it would be wiped.
// They're build-time only: no JS, no Firebase, no like/copy controls (those
// belong to the Palettes app itself).
//
// Adding a future resource type to the homepage = its records in
// content-index.json + one resource-types.json entry. A type with no bespoke
// card below falls back to genericCardHtml(). A type with zero records renders
// nothing (no empty/placeholder section).
//
// SORTS mirror each collection's own existing ordering exactly, so a section
// shows the same leading items that collection shows:
//   latest  — palettes/palettes.js sortedList() "new"
//   roadmap — roadmap.html's reading order (groupRoadmap() above); Guides
//             only. guides.json has no date or popularity, so Guides are never
//             given a popular/latest sort. Guides that aren't on the roadmap
//             sort after every roadmap guide, in guides.json order.
// Each entry is a factory returning the comparator, given the build context
// (only `roadmap` uses it). Array.prototype.sort is stable, so ties keep
// content-index.json order.
//
// DUPLICATE-COLOUR EXCLUSION
// Sections are filled in `home.order`; a record is skipped when the first four
// of its `colors` (lowercased) match a record already shown in an earlier
// section, so the same colours are never shown twice on the page. The skip
// happens BEFORE the limit is applied, so a section still fills up to `limit`
// whenever enough distinct records exist. Records without `colors` are never
// affected.
//
// PHASE 4: this rule is unchanged, but nothing triggers it any more. It
// existed because every indexed palette was the 1:1 twin of a Colour Token,
// and the Tokens section rendered those same colours first — which is why the
// homepage's latest-palettes row used to read p001, p004, p005, …, skipping
// p002 and p003. With the Tokens section gone there is no earlier section to
// collide with, so the row is now p001-p010. The rule is kept because it is
// generic: it guards any future pair of sections that could show the same
// colours.

const HOME_SORTS = {
  popular: function () {
    return function (a, b) {
      return (b.popularity || 0) - (a.popularity || 0);
    };
  },
  latest: function () {
    return function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    };
  },
  roadmap: function (context) {
    const rank = context.roadmapRank;
    const rankOf = function (record) {
      return rank.has(record.slug) ? rank.get(record.slug) : rank.size;
    };
    return function (a, b) {
      return rankOf(a) - rankOf(b);
    };
  },
};

/** Sorts that only make sense for one resource type. */
const SORT_TYPE_ONLY = { roadmap: "guide" };

/**
 * Section label prefix per sort, in the homepage's existing
 * "/ trending_categories" label style — e.g. "/ latest_palettes",
 * "/ featured_guides".
 */
const SORT_LABEL = {
  popular: "popular",
  latest: "latest",
  roadmap: "featured",
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Checks the registry against what THIS module can render.
 *
 * PHASE 4 STEP 6 — SHAPE MOVED OUT, CAPABILITY STAYED
 *
 * This function used to re-state the whole resource-types.json schema: the
 * array, the `type` slug, duplicate types, `label`, the `home` block's
 * order/limit and `landingUrl`. src/build/header.js checked an overlapping
 * but different subset of the same file, which it opened itself, so a
 * malformed `home.limit` was caught only if this builder ran and a malformed
 * `activePaths` only if the header ran. All of that shape checking is stated
 * once now, in src/build/content.js, and has already run by the time `render`
 * calls this.
 *
 * What stays is the rule only this module can answer: `home.sort` has to name
 * a comparator in HOME_SORTS, and a sort listed in SORT_TYPE_ONLY may only be
 * asked for by the one type it makes sense for. Those are facts about the
 * comparators below, not about the file.
 */
function loadResourceTypes(registry) {
  registry.forEach(function (entry, i) {
    if (entry.home === null) return;
    const where = `resource-types.json[${i}]`;
    const home = entry.home;
    if (!Object.prototype.hasOwnProperty.call(HOME_SORTS, home.sort)) {
      throw new Error(
        `${where}.home.sort must be one of: ${Object.keys(HOME_SORTS).join(", ")}`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(SORT_TYPE_ONLY, home.sort) &&
      SORT_TYPE_ONLY[home.sort] !== entry.type
    ) {
      throw new Error(
        `${where}.home.sort "${home.sort}" is only valid for type "${SORT_TYPE_ONLY[home.sort]}"`,
      );
    }
  });
  return registry;
}

function colorKey(record) {
  if (!Array.isArray(record.colors) || record.colors.length < 4) return null;
  return record.colors
    .slice(0, 4)
    .map(function (hex) {
      return String(hex).trim().toLowerCase();
    })
    .join("|");
}

/**
 * Colors are written into inline style attributes, so each one is validated as
 * a plain #rrggbb value first — a malformed value fails the build instead of
 * reaching the page.
 */
function validatedColors(record) {
  const colors = Array.isArray(record.colors) ? record.colors : [];
  colors.forEach(function (hex) {
    if (typeof hex !== "string" || !HEX_RE.test(hex)) {
      throw new Error(
        `content-index record "${record.id}" has an invalid color value: ${JSON.stringify(hex)}`,
      );
    }
  });
  return colors;
}

function colorThumbHtml(record, modifier) {
  const colors = validatedColors(record);
  if (!colors.length) return "";
  return (
    `<div class="card-thumb ${modifier}" aria-hidden="true">` +
    colors
      .map(function (hex) {
        return `<span style="background-color:${hex}"></span>`;
      })
      .join("") +
    `</div>`
  );
}

function recordTitleHtml(record) {
  return `<h3 class="card-title"><a class="card-link" href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></h3>`;
}

function typeBadgeHtml(type) {
  const label = TYPE_BADGE_LABEL[type];
  return label ? `<span class="badge">${escapeHtml(label)}</span>` : "";
}

/**
 * Palette: its four colors as stacked bars (the /palettes gallery's own
 * visual) + name. Links to /palettes#<id>, which palettes.js resolves.
 */
function paletteCardHtml(record) {
  return (
    `<article class="content-card">` +
    colorThumbHtml(record, "card-thumb--bars") +
    `<div class="card-body">` +
    typeBadgeHtml("palette") +
    recordTitleHtml(record) +
    `</div></article>`
  );
}

/**
 * Fallback for a resource type with no bespoke card yet: title + tags, plus a
 * swatch row only if the record carries colors.
 */
function genericCardHtml(record) {
  const meta = tagsMetaFor(record);
  return (
    `<article class="content-card">` +
    colorThumbHtml(record, "card-thumb--swatches") +
    `<div class="card-body">` +
    recordTitleHtml(record) +
    (meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : "") +
    `</div></article>`
  );
}

/**
 * Guide (Phase 6): the exact card the /guides grid uses — cardHtml() on the
 * guides.json entry matching the content-index record — so Featured Guides and
 * the collection can never drift apart. Links to /guide/<id>.
 *
 * cardHtml arrives on the context rather than as a module-level binding: the
 * renderer is bound to the category label map, which is built per render from
 * ctx.model.categories.
 */
function guideCardHtml(record, context) {
  const guide = context.guidesById.get(record.slug);
  if (!guide) {
    throw new Error(
      `content-index record "${record.id}" has no matching guides.json entry.\n` +
        `  The index and guides.json disagree, which means this build is reading a\n` +
        `  stale content-index.json. The pipeline's \`data\` stage regenerates the\n` +
        `  index from guides.json immediately before \`render\` calls this module.`,
    );
  }
  // The badge is passed in here, not baked into cardHtml(), so it appears on
  // the homepage's Featured Guides cards without also appearing in
  // guides/index.html's grid — a single-type surface that app.js re-renders
  // from its own copy of cardHtml().
  return context.cardHtml(guide, typeBadgeHtml("guide"));
}

/** Renderers receive (record, context); the palette card only needs the record. */
const CARD_RENDERERS = {
  guide: guideCardHtml,
  palette: paletteCardHtml,
};

function sectionLabelSlug(entry) {
  const words = entry.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${SORT_LABEL[entry.home.sort]}_${words}`;
}

function resourceSectionHtml(entry, records, total, context) {
  const headingId = `resource-section-${entry.type}`;
  const render = CARD_RENDERERS[entry.type] || genericCardHtml;
  return (
    `<section class="resource-section" aria-labelledby="${headingId}">` +
    `<div class="section-head">` +
    `<h2 class="section-label" id="${headingId}">/ ${escapeHtml(sectionLabelSlug(entry))}</h2>` +
    `<div class="section-head__meta">` +
    `<p class="results-count">Showing ${records.length} of ${total}</p>` +
    `<a class="resource-section__all" href="${escapeHtml(entry.landingUrl)}" aria-label="View all ${escapeHtml(entry.label)}">View all<span aria-hidden="true"> →</span></a>` +
    `</div>` +
    `</div>` +
    `<div class="grid">${records
      .map(function (record) {
        return render(record, context);
      })
      .join("")}</div>` +
    `</section>`
  );
}

function buildResourceSections(registry, contentIndex, context) {
  const entries = registry
    .filter(function (entry) {
      return entry.home;
    })
    .slice()
    .sort(function (a, b) {
      return a.home.order - b.home.order;
    });

  const shownColorKeys = new Set();
  const sectionsHtml = [];
  const summary = [];

  entries.forEach(function (entry) {
    const all = contentIndex.filter(function (record) {
      return record.type === entry.type;
    });
    const sorted = all.slice().sort(HOME_SORTS[entry.home.sort](context));
    const picked = [];
    let twinsSkipped = 0;
    for (const record of sorted) {
      if (picked.length >= entry.home.limit) break;
      const key = colorKey(record);
      if (key && shownColorKeys.has(key)) {
        twinsSkipped++;
        continue;
      }
      if (typeof record.url !== "string" || !record.url) {
        throw new Error(`content-index record "${record.id}" has no url`);
      }
      picked.push(record);
      if (key) shownColorKeys.add(key);
    }

    if (!picked.length) {
      summary.push(`${entry.type}: 0 records — section omitted`);
      return;
    }
    sectionsHtml.push(resourceSectionHtml(entry, picked, all.length, context));
    summary.push(
      `${entry.type}: ${picked.length} of ${all.length} (${entry.home.sort}` +
        (twinsSkipped
          ? `, ${twinsSkipped} twin${twinsSkipped === 1 ? "" : "s"} skipped`
          : "") +
        `)`,
    );
  });

  return { html: sectionsHtml.join(""), count: sectionsHtml.length, summary };
}

// ---------------------------------------------------------------------
// category data
// ---------------------------------------------------------------------
// PHASE 3: the Guide card renderer, and the category motifs and dimension
// labels behind it, used to be copied into the builder verbatim from app.js
// under a standing "mirror any edit in both files" warning. All of it comes
// from src/shared/card.js, so there is nothing left to mirror and nothing left
// to drift.
//
// The label map is still built here. categories.json is the single source of
// truth for category labels (Phase 4, D1), and src/shared/card.js takes the
// label map from its caller rather than reading the file itself — that is what
// lets the browser copy of the same renderer pass app.js's own literal instead
// (D1 A rejected a runtime fetch). The unused `code` field was dropped (D2 B):
// only the category pages consume a category code, for their hero eyebrow.

// PHASE 4 STEP 6: this is a projection now, not a loader. The slug/name rules
// it used to re-state are stated once in src/build/content.js and applied in
// `load`, so by the time this runs the array has already been checked — as it
// had been by loadGuideCategories() below and by
// src/build/categories.js's loadCategoryData(), each with its own copy of the
// same three rules and its own wording for the same three errors.

function loadCategoryLabels(categories) {
  const map = {};
  categories.forEach(function (category) {
    map[category.slug] = { label: category.name };
  });
  return map;
}

// ---------------------------------------------------------------------
// guides collection: category discovery (guides/index.html — Phase 6)
// ---------------------------------------------------------------------
// One link per guide category, from categories.json (sorted by `order`,
// labeled with the full `name`, linked as /category/<slug> — the same URL form
// as the footer's category row). A category is listed only if at least one
// guide in guides.json has it as its `category`: that is the rule
// src/build/categories.js uses to decide whether /category/<slug> exists, so a
// listed link never points at a page that isn't built. (This module runs
// before categories, so it can't check the file on disk.)

function loadGuideCategories(categories, guides) {
  // PHASE 4 STEP 6: the second of the three copies of the categories.json
  // schema that used to sit here. See loadCategoryLabels() above.
  const withGuides = new Set(
    guides.map(function (g) {
      return g.category;
    }),
  );
  const sorted = categories.slice().sort(function (a, b) {
    return (a.order || 0) - (b.order || 0);
  });
  return {
    listed: sorted.filter(function (category) {
      return withGuides.has(category.slug);
    }),
    skipped: sorted
      .filter(function (category) {
        return !withGuides.has(category.slug);
      })
      .map(function (category) {
        return category.slug;
      }),
  };
}

function guideCategoriesHtml(categories) {
  return categories
    .map(function (category) {
      return `<li><a href="/category/${escapeHtml(category.slug)}">${escapeHtml(category.name)}</a></li>`;
    })
    .join("");
}

// ---------------------------------------------------------------------
// page patching
// ---------------------------------------------------------------------

/**
 * Replaces the text between two markers, keeping the markers themselves.
 *
 * Unlike the header's and footer's replaceBetween(), which return null so the
 * caller can skip a page and report it, this one THROWS. Every marker pair in
 * these three pages is required: a structural change to one of them must fail
 * the build with the file and marker named, not silently drop a region.
 */
function replaceBetween(html, startMarker, endMarker, replacement, fileLabel) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find markers ${startMarker} / ${endMarker} in ${fileLabel} — did the file structure change?`,
    );
  }
  return (
    html.slice(0, start + startMarker.length) + replacement + html.slice(end)
  );
}

/**
 * Homepage (Phase 6): only the generated resource sections. The full guide
 * grid, its results count and the Level filter live on guides/index.html.
 */
function buildIndexHtml(file, resourceSections) {
  const label = "index.html";
  let html = fs.readFileSync(file, "utf8");

  html = replaceBetween(
    html,
    "<!--RESOURCE_SECTIONS_START-->",
    "<!--RESOURCE_SECTIONS_END-->",
    resourceSections.html,
    label,
  );

  fs.writeFileSync(file, html);
  return {
    sections: resourceSections.count,
    summary: resourceSections.summary,
  };
}

/**
 * Guides collection (Phase 6): the full guide grid + count and the
 * category-discovery links.
 */
function buildGuidesHtml(file, guides, guideCategories, cardHtml) {
  const label = "guides/index.html";
  let html = fs.readFileSync(file, "utf8");

  html = replaceBetween(
    html,
    "<!--GUIDE_CATEGORIES_START-->",
    "<!--GUIDE_CATEGORIES_END-->",
    guideCategoriesHtml(guideCategories.listed),
    label,
  );

  html = replaceBetween(
    html,
    "<!--RESULTS_COUNT-->",
    "<!--/RESULTS_COUNT-->",
    `Showing ${guides.length} of ${guides.length} guides`,
    label,
  );

  // `.map(cardHtml)` hands the renderer the array INDEX as its badge argument.
  // The renderer ignores a non-string badge by design, and that is what keeps
  // this grid badge-free while the homepage's Featured Guides cards carry one.
  // Transcribed exactly from the builder — do not "fix" it to `.map((g) =>
  // cardHtml(g))` without checking what app.js re-renders here.
  const cardsHtml = guides.map(cardHtml).join("");
  html = replaceBetween(
    html,
    "<!--GUIDES_GRID_START-->",
    "<!--GUIDES_GRID_END-->",
    cardsHtml,
    label,
  );

  fs.writeFileSync(file, html);
  return {
    guides: guides.length,
    categoryLinks: guideCategories.listed.length,
    skippedCategories: guideCategories.skipped,
  };
}

function buildRoadmapHtml(file, guides) {
  const label = "roadmap.html";
  let html = fs.readFileSync(file, "utf8");

  const roadmap = buildRoadmap(guides);
  html = replaceBetween(
    html,
    "<!--ROADMAP_STAGES_START-->",
    "<!--ROADMAP_STAGES_END-->",
    roadmap.stagesHtml,
    label,
  );
  html = replaceBetween(
    html,
    "<!--ROADMAP_STAGE_COUNT-->",
    "<!--/ROADMAP_STAGE_COUNT-->",
    String(roadmap.stageCount),
    label,
  );
  html = replaceBetween(
    html,
    "<!--ROADMAP_GUIDE_COUNT-->",
    "<!--/ROADMAP_GUIDE_COUNT-->",
    String(roadmap.guideCount),
    label,
  );
  html = replaceBetween(
    html,
    "<!--ROADMAP_TOTAL_TIME-->",
    "<!--/ROADMAP_TOTAL_TIME-->",
    roadmap.totalTimeLabel,
    label,
  );

  fs.writeFileSync(file, html);
  return {
    guides: roadmap.guideCount,
    stages: roadmap.stageCount,
    totalTimeLabel: roadmap.totalTimeLabel,
  };
}

// ---------------------------------------------------------------------
// render
// ---------------------------------------------------------------------

/**
 * Patches the three home-surface pages in the staging root.
 *
 * Takes guides, categories, the resource-type registry and the content index
 * from ctx. Writes nothing outside the staging root, and writes all three
 * pages unconditionally, as the builder did.
 *
 * Returns { index, guides, roadmap } for the caller to summarize, plus the
 * category slugs left out of guides/index.html for it to warn on.
 */
function render(ctx) {
  const { stage } = ctx.config.paths;

  // PHASE 4 STEP 6: no Array.isArray(guides) guard here any more — `load`
  // validates guides.json once, for every builder, before dist/ exists.
  const guides = ctx.model.guides;

  const registry = loadResourceTypes(ctx.model.resourceTypes);

  // The index the `data` stage just generated — not the committed copy at the
  // repo root. Read-only here; this module never writes it.
  const contentIndex = ctx.contentIndex;
  if (!Array.isArray(contentIndex)) {
    throw new Error(
      "content-index.json did not contain an array — the home builder runs " +
        "after the `data` stage and expects ctx.contentIndex to be set.",
    );
  }

  const { cardHtml } = BpozzCard.createRenderer({
    categories: loadCategoryLabels(ctx.model.categories),
  });

  const context = {
    cardHtml,
    guidesById: new Map(
      guides.map(function (g) {
        return [g.id, g];
      }),
    ),
    roadmapRank: new Map(
      roadmapOrder(guides).map(function (g, i) {
        return [g.id, i];
      }),
    ),
  };

  const index = buildIndexHtml(
    path.join(stage, INDEX_PAGE),
    buildResourceSections(registry, contentIndex, context),
  );
  const guidesPage = buildGuidesHtml(
    path.join(stage, GUIDES_PAGE),
    guides,
    loadGuideCategories(ctx.model.categories, guides),
    cardHtml,
  );
  const roadmap = buildRoadmapHtml(path.join(stage, ROADMAP_PAGE), guides);

  return { index, guides: guidesPage, roadmap };
}

module.exports = {
  render,
  buildIndexHtml,
  buildGuidesHtml,
  buildRoadmapHtml,
  buildResourceSections,
  buildRoadmap,
  groupRoadmap,
  roadmapOrder,
  loadResourceTypes,
  loadCategoryLabels,
  loadGuideCategories,
  guideCategoriesHtml,
  replaceBetween,
  INDEX_PAGE,
  GUIDES_PAGE,
  ROADMAP_PAGE,
  ROADMAP_STAGES,
  HOME_SORTS,
  SORT_TYPE_ONLY,
  SORT_LABEL,
  TYPE_BADGE_LABEL,
};
