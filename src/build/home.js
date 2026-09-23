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
 *   index.html          the homepage (tool-first redesign): the palette
 *                       workspace's five color columns (HOME_PALETTE_START/
 *                       END + HOME_PALETTE_MODE), the numbered toolkit index
 *                       (HOME_TOOLKIT_START/END, counts from the model), and
 *                       the resource sections between RESOURCE_SECTIONS_START/
 *                       END, from resource-types.json + content-index.json
 *                       (+ guides.json for guide rows and roadmap ordering).
 *                       The sections are editorial numbered lists, not card
 *                       grids; the homepage renders no .content-card at all.
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
// The homepage workspace's pure color math (describe(): HEX/RGB/HSL/contrast).
// The browser runs the same file as /home.js, so the first render and every
// client-side re-render share one implementation.
const HomeWorkspace = require("../client/home.js");

/**
 * PHASE 4 STEP 6 — content-index vocabulary, from its one home.
 *
 * Both of these were declared here AND in src/build/categories.js, each copy
 * commented as matching the other. They read a content-index record and are
 * keyed off fields src/build/content.js writes onto it, so that is where they
 * live now. Re-exported below so this module's API is unchanged:
 *
 *   TYPE_BADGE_LABEL  the .badge wording for a record's `type`. No longer
 *                     rendered here — homepage rows sit under a per-type
 *                     section heading — but still re-exported unchanged.
 *   tagsMetaFor       the Title Cased tag summary used as the meta line of
 *                     genericRowHtml(), for a resource type with no bespoke
 *                     homepage row.
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
// homepage: palette workspace (index.html #palette-stage)
// ---------------------------------------------------------------------
// The first viewport of the homepage is a working palette, not a banner. The
// build writes five complete color columns — name, HEX, RGB, HSL and the
// better-reading text color with its WCAG ratio — so the palette is real,
// readable content with JavaScript off. /home.js (src/client/home.js) then
// un-hides the [data-enhanced] controls and takes over: Generate, lock,
// vary, copy. It only ever rewrites the [data-field] text inside the columns
// this module writes; it never builds column markup of its own.
//
// Every derived string comes from src/client/home.js's pure describe(), so
// the first render and every client re-render are guaranteed to agree.
//
// The opening palette is BPOZZ's own system — the five tokens every page on
// the site is drawn with — so the homepage opens on a palette that is
// actually in use, and says so: each column carries its CSS custom property
// name beside its number. home.js clears that token label as soon as a
// column holds anything other than its seed color.

const WORKSPACE_SEED = {
  mode: "BPOZZ system tokens",
  colors: [
    { hex: "#101010", name: "Header ink", token: "--header-bg" },
    { hex: "#2563EB", name: "Action blue", token: "--action" },
    { hex: "#22A6C4", name: "Signal cyan", token: "--cyan" },
    { hex: "#DBE6F7", name: "Grid line", token: "--grid-line" },
    { hex: "#F5F8FC", name: "Paper", token: "--paper" },
  ],
};

const ICON_LOCK =
  `<svg class="palette-tool__icon palette-tool__icon--open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/></svg>` +
  `<svg class="palette-tool__icon palette-tool__icon--closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const ICON_VARY = `<svg class="palette-tool__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/></svg>`;

function paletteColorHtml(color, i) {
  const d = HomeWorkspace.describe(color.hex, color.name);
  const n = i + 1;
  return (
    `<li class="palette-color" data-hex="${d.hex}" data-name="${escapeHtml(d.name)}"` +
    (color.token ? ` data-token="${escapeHtml(color.token)}"` : "") +
    ` style="--swatch:${d.hex};--ink:${d.ink}">` +
    `<button type="button" class="palette-color__copy" data-action="copy" data-enhanced hidden aria-label="Copy ${d.hex}, ${escapeHtml(d.name)}"></button>` +
    `<p class="palette-color__index" aria-hidden="true">` +
    `<span>${String(n).padStart(2, "0")}</span>` +
    `<span class="palette-color__token" data-field="token">${escapeHtml(color.token || "")}</span>` +
    `</p>` +
    `<div class="palette-color__tools" data-enhanced hidden>` +
    `<button type="button" class="palette-tool" data-action="lock" aria-pressed="false" aria-label="Lock color ${n}, ${d.hex}" title="Lock">${ICON_LOCK}</button>` +
    `<button type="button" class="palette-tool" data-action="vary" aria-label="Vary color ${n}, ${d.hex}" title="Vary">${ICON_VARY}</button>` +
    `</div>` +
    `<div class="palette-color__body">` +
    `<p class="palette-color__name" data-field="name">${escapeHtml(d.name)}</p>` +
    `<p class="palette-color__hex" data-field="hex">${d.hex}</p>` +
    `<dl class="palette-color__values">` +
    `<div><dt>RGB</dt><dd data-field="rgb">${d.rgb}</dd></div>` +
    `<div><dt>HSL</dt><dd data-field="hsl">${d.hsl}</dd></div>` +
    `<div><dt>Text</dt><dd data-field="contrast">${d.contrast}</dd></div>` +
    `</dl>` +
    `</div>` +
    `</li>`
  );
}

function buildWorkspace(seed) {
  return {
    mode: escapeHtml(seed.mode),
    columns: seed.colors.map(paletteColorHtml).join(""),
    count: seed.colors.length,
  };
}

// ---------------------------------------------------------------------
// homepage: toolkit index (index.html, between HOME_TOOLKIT_START/END)
// ---------------------------------------------------------------------
// What BPOZZ contains, as four numbered editorial rows rather than four
// boxes. Counts come from the loaded model, so they can never go stale, and
// every URL is checked against the route table so a row can never point at
// a page the build did not produce.

function toolkitEntries(model) {
  const colorFamilies = new Set(model.colors.map((c) => c.category)).size;
  const guideTopics = new Set(model.guides.map((g) => g.category)).size;
  return [
    {
      title: "Colors",
      url: "/colors/",
      desc: "Every color named, valued and grouped by family.",
      meta: `${model.colors.length} colors · ${colorFamilies} families`,
      action: "Explore colors",
    },
    {
      title: "Palettes",
      url: "/palettes/",
      desc: "Finished color systems, surfaces and accents worked out.",
      meta: `${model.palettes.length} palettes`,
      action: "Explore palettes",
    },
    {
      title: "Image Picker",
      url: "/image-picker/",
      desc: "Pull a usable palette from a photo. Nothing is uploaded.",
      meta: "Runs in your browser",
      action: "Open the picker",
    },
    {
      title: "Guides",
      url: "/guides/",
      desc: "Spacing, type, color and systems, written like specs.",
      meta: `${model.guides.length} guides · ${guideTopics} topics`,
      action: "Read the guides",
    },
  ];
}

/**
 * One row per entry: a large index number, the name (the row's one link,
 * stretched over the whole row) with a one-line description, the live count,
 * and a visual "action →" cue. The cue is aria-hidden — the link already
 * names the destination, so a screen reader hears it once.
 */
function toolkitHtml(entries, knownUrls) {
  return entries
    .map(function (entry, i) {
      if (!knownUrls.has(entry.url)) {
        throw new Error(
          `homepage toolkit row "${entry.title}" links to ${entry.url}, which is not in the route table`,
        );
      }
      const num = String(i + 1).padStart(2, "0");
      return (
        `<li class="home-index__row">` +
        `<span class="home-index__num" aria-hidden="true">${num}</span>` +
        `<div class="home-index__main">` +
        `<h3 class="home-index__title"><a class="home-index__link" href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a></h3>` +
        `<p class="home-index__desc">${escapeHtml(entry.desc)}</p>` +
        `</div>` +
        `<p class="home-index__meta">${escapeHtml(entry.meta)}</p>` +
        `<span class="home-index__action" aria-hidden="true">${escapeHtml(entry.action)}<span class="home-arrow">→</span></span>` +
        `</li>`
      );
    })
    .join("");
}

// ---------------------------------------------------------------------
// homepage resource sections (Phase 5; Guides added in Phase 6)
// ---------------------------------------------------------------------
// Every shipped resource type with a `home` object in resource-types.json
// gets one generated section (`home: null` opts a type out). The selection
// rules — order, limit, sort, duplicate-colour exclusion — are unchanged
// from the card-grid homepage; only the presentation is. Each section is an
// editorial index: a sticky heading column and a numbered list of rows,
// never a grid of cards.
//
// These sections are written between RESOURCE_SECTIONS_START/END inside the
// homepage's <main>. The homepage has no #grid-root; never put these sections
// inside one — app.js replaces #grid-root's innerHTML on load.
//
// Adding a future resource type to the homepage = its records in
// content-index.json + one resource-types.json entry. A type with no bespoke
// row renderer below falls back to genericRowHtml() and genericCopy(). A type
// with zero records renders nothing (no empty/placeholder section).
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
// affected. Nothing triggers it against the current data; it is kept because
// it is generic and guards any future pair of sections that could collide.

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
 * Section label prefix per sort, in the site's "/ snake_case" label style —
 * e.g. "/ latest_palettes", "/ featured_guides".
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
 * The resource-types.json shape is checked once, in src/build/content.js,
 * before `render` calls this. What stays here is the rule only this module
 * can answer: `home.sort` has to name a comparator in HOME_SORTS, and a sort
 * listed in SORT_TYPE_ONLY may only be asked for by the one type it makes
 * sense for.
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

/** A thin row of color bars; decorative — the hex values are written out as text beside it. */
function colorStripHtml(colors) {
  if (!colors.length) return "";
  return (
    `<span class="home-strip" aria-hidden="true">` +
    colors
      .map(function (hex) {
        return `<span style="background-color:${hex}"></span>`;
      })
      .join("") +
    `</span>`
  );
}

function rowNumber(i) {
  return `<span class="home-row__num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>`;
}

/**
 * Guide row: number, title, topic, reading time — drawn from the guides.json
 * entry matching the content-index record, the same source the /guides grid
 * renders from, so the two can never disagree. Links to /guide/<id>.
 */
function guideRowHtml(record, i, context) {
  const guide = context.guidesById.get(record.slug);
  if (!guide) {
    throw new Error(
      `content-index record "${record.id}" has no matching guides.json entry.\n` +
        `  The index and guides.json disagree, which means this build is reading a\n` +
        `  stale content-index.json. The pipeline's \`data\` stage regenerates the\n` +
        `  index from guides.json immediately before \`render\` calls this module.`,
    );
  }
  const topic = context.categoryLabels[guide.category];
  const meta = (topic ? [topic.label] : []).concat(`${guide.readTime} min read`);
  return (
    `<li class="home-row home-guide">` +
    `<a class="home-row__link" href="/guide/${escapeHtml(guide.id)}">` +
    rowNumber(i) +
    `<span class="home-row__text">` +
    `<span class="home-row__title">${escapeHtml(guide.title)}</span>` +
    `<span class="home-row__meta">${meta.map(escapeHtml).join(" · ")}</span>` +
    `</span>` +
    `</a>` +
    `</li>`
  );
}

/** Palette row: a strip of its four colors, its name and the hex values. Links to /palettes#<id>. */
function paletteRowHtml(record, i) {
  const colors = validatedColors(record);
  return (
    `<li class="home-row home-palette">` +
    `<a class="home-row__link" href="${escapeHtml(record.url)}">` +
    colorStripHtml(colors) +
    `<span class="home-row__text">` +
    `<span class="home-row__title">${escapeHtml(record.title)}</span>` +
    `<span class="home-row__meta">${colors.map(escapeHtml).join(" · ")}</span>` +
    `</span>` +
    `</a>` +
    `</li>`
  );
}

/** Fallback for a resource type with no bespoke row yet: number, title, tag summary. */
function genericRowHtml(record, i) {
  const meta = tagsMetaFor(record);
  return (
    `<li class="home-row">` +
    `<a class="home-row__link" href="${escapeHtml(record.url)}">` +
    rowNumber(i) +
    `<span class="home-row__text">` +
    `<span class="home-row__title">${escapeHtml(record.title)}</span>` +
    (meta ? `<span class="home-row__meta">${escapeHtml(meta)}</span>` : "") +
    `</span>` +
    `</a>` +
    `</li>`
  );
}

/** Renderers receive (record, index, context). */
const ROW_RENDERERS = {
  guide: guideRowHtml,
  palette: paletteRowHtml,
};

/**
 * Per-type section copy. `label` overrides the "/ <sort>_<type>" micro-label;
 * `aside` renders anything extra under the heading column (the guide
 * topics); `listClass` picks the list's layout.
 */
const SECTION_COPY = {
  guide: {
    label: "/ design_notes",
    title: "Guides written like specifications.",
    dek: "Short reads on the decisions behind an interface, in roadmap order.",
    allLabel: (total) => `All ${total} guides`,
    extraLinks: [{ href: "/roadmap.html", label: "Follow the roadmap" }],
    listClass: "home-list home-list--guides",
    aside: (context) =>
      context.guideTopics.length
        ? `<div class="home-topics">` +
          `<h3 class="home-topics__label">Browse by topic</h3>` +
          `<ul class="home-topics__list">${guideCategoriesHtml(context.guideTopics)}</ul>` +
          `</div>`
        : "",
  },
  palette: {
    label: "/ color_systems",
    title: "Palettes, ready to become tokens.",
    dek: "A surface, a deep tone and two accents. Open one to copy its values.",
    allLabel: () => "Explore all palettes",
    extraLinks: [],
    listClass: "home-list home-list--palettes",
    aside: () => "",
  },
};

function genericCopy(entry) {
  return {
    label: null,
    title: entry.label,
    dek: "",
    allLabel: () => `View all ${entry.label}`,
    extraLinks: [],
    listClass: "home-list",
    aside: () => "",
  };
}

function sectionLabelSlug(entry) {
  const words = entry.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${SORT_LABEL[entry.home.sort]}_${words}`;
}

function homeLinkHtml(href, label) {
  return `<a class="home-link" href="${escapeHtml(href)}">${escapeHtml(label)}<span class="home-arrow" aria-hidden="true">→</span></a>`;
}

function resourceSectionHtml(entry, records, total, context) {
  const headingId = `home-section-${entry.type}`;
  const render = ROW_RENDERERS[entry.type] || genericRowHtml;
  const copy = SECTION_COPY[entry.type] || genericCopy(entry);
  const links = [homeLinkHtml(entry.landingUrl, copy.allLabel(total))]
    .concat(
      copy.extraLinks.map(function (l) {
        return homeLinkHtml(l.href, l.label);
      }),
    )
    .join("");
  return (
    `<section class="home-section home-section--${escapeHtml(entry.type)}" aria-labelledby="${headingId}">` +
    `<div class="home-section__aside">` +
    `<p class="home-label">${escapeHtml(copy.label || `/ ${sectionLabelSlug(entry)}`)}</p>` +
    `<h2 class="home-section__title" id="${headingId}">${escapeHtml(copy.title)}</h2>` +
    (copy.dek ? `<p class="home-section__dek">${escapeHtml(copy.dek)}</p>` : "") +
    `<p class="home-section__links">${links}</p>` +
    copy.aside(context) +
    `</div>` +
    `<ol class="${copy.listClass}">${records
      .map(function (record, i) {
        return render(record, i, context);
      })
      .join("")}</ol>` +
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
 * Homepage: the palette workspace's five columns and mode label, the toolkit
 * index, and the generated resource sections. The full guide grid, its
 * results count and the Level filter live on guides/index.html.
 */
function buildIndexHtml(file, workspace, toolkit, resourceSections) {
  const label = "index.html";
  let html = fs.readFileSync(file, "utf8");

  html = replaceBetween(
    html,
    "<!--HOME_PALETTE_MODE-->",
    "<!--/HOME_PALETTE_MODE-->",
    workspace.mode,
    label,
  );
  html = replaceBetween(
    html,
    "<!--HOME_PALETTE_START-->",
    "<!--HOME_PALETTE_END-->",
    workspace.columns,
    label,
  );
  html = replaceBetween(
    html,
    "<!--HOME_TOOLKIT_START-->",
    "<!--HOME_TOOLKIT_END-->",
    toolkit.html,
    label,
  );
  html = replaceBetween(
    html,
    "<!--RESOURCE_SECTIONS_START-->",
    "<!--RESOURCE_SECTIONS_END-->",
    resourceSections.html,
    label,
  );

  fs.writeFileSync(file, html);
  return {
    colors: workspace.count,
    toolkitRows: toolkit.count,
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
  // The renderer ignores a non-string badge by design, which keeps this grid
  // badge-free, matching what app.js re-renders here from its own copy of
  // cardHtml(). Do not "fix" it to `.map((g) => cardHtml(g))` without
  // checking that re-render.
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

  const categoryLabels = loadCategoryLabels(ctx.model.categories);
  const { cardHtml } = BpozzCard.createRenderer({ categories: categoryLabels });
  const guideCategories = loadGuideCategories(ctx.model.categories, guides);

  const context = {
    categoryLabels,
    guideTopics: guideCategories.listed,
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

  const toolkit = toolkitEntries(ctx.model);
  const knownUrls = new Set((ctx.routes || []).map((r) => r.url));
  const index = buildIndexHtml(
    path.join(stage, INDEX_PAGE),
    buildWorkspace(WORKSPACE_SEED),
    { html: toolkitHtml(toolkit, knownUrls), count: toolkit.length },
    buildResourceSections(registry, contentIndex, context),
  );
  const guidesPage = buildGuidesHtml(
    path.join(stage, GUIDES_PAGE),
    guides,
    guideCategories,
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
  buildWorkspace,
  toolkitEntries,
  toolkitHtml,
  WORKSPACE_SEED,
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
