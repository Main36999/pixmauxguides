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
 *   index.html          the homepage below its static hero: the tool cards
 *                       (HOME_TOOLS_START/END) and the resource cards
 *                       (HOME_RESOURCES_START/END), from the content model —
 *                       colors, palettes, guides, categories — and the route
 *                       table. The hero (headline, search, explore
 *                       strip) is hand-authored and not touched here.
 *                       The old generated resource sections, driven by
 *                       resource-types.json's `home` blocks + the content
 *                       index, are gone; see assertNoHomeBlocks().
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
 * and the homepage's Learning Roadmap card (its guide and stage counts), so
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
// homepage: tool and resource cards (index.html, below the hero)
// ---------------------------------------------------------------------
// The hero (headline, search, explore strip) is static markup in
// index.html. Everything below it is two card sections written here:
//
//   HOME_TOOLS_START/END      the BPOZZ tools — large pastel cards, one per
//                             real, top-level destination
//   HOME_RESOURCES_START/END  more useful resources — neutral title-and-text cards:
//                             Free Fonts, Icon Packs, the guide topics not in
//                             RESOURCE_TOPICS_SKIPPED, plus About
//
// Every card is a real <a> (the title link, stretched over the card), every
// URL is checked against the route table so a card can never point at a
// page the build did not produce, and every count comes from the content
// model rather than from copy that could go stale.

/**
 * The tool cards, in display order. `tone` picks the card's pastel
 * background and heading color in home.css (.tool-card--<tone>); `desc`
 * is a function of the content model so its counts are always live.
 */
const HOME_TOOLS = [
  {
    title: "Colors",
    url: "/colors/",
    tone: "cyan",
    cta: "Explore colors",
    desc: (m) =>
      `${m.colors.length} named colors across ${new Set(m.colors.map((c) => c.category)).size} families. Filter by family and copy any HEX value.`,
  },
  {
    title: "Color Palettes",
    url: "/palettes/",
    tone: "blue",
    cta: "Browse palettes",
    desc: (m) =>
      `${m.palettes.length} palettes of four named colors each. Copy any HEX value and like the ones you want to keep.`,
  },
  {
    title: "Image Picker",
    url: "/image-picker/",
    tone: "lavender",
    cta: "Open the picker",
    desc: () =>
      "Pull a usable palette out of any photo. It runs in your browser; your image is never uploaded.",
  },
  {
    title: "UI/UX Guides",
    url: "/guides/",
    tone: "pink",
    cta: "Read the guides",
    desc: (m) =>
      `${m.guides.length} practical guides on spacing, type, color and systems, written like engineering specs.`,
  },
  {
    title: "Learning Roadmap",
    url: "/roadmap",
    tone: "orange",
    cta: "Start the roadmap",
    desc: (m) => {
      const { roadmapGuides, stagesUsed } = groupRoadmap(m.guides);
      return `A reading order through ${roadmapGuides.length} guides in ${stagesUsed.length} stages. Mark each one read as you go.`;
    },
  },
  {
    title: "Search",
    url: "/search",
    tone: "green",
    cta: "Search BPOZZ",
    desc: () => "Find any guide or color palette on the site by name or topic.",
  },
];

/**
 * The font library, as a resource card. It opens the section, ahead of the
 * guide topics; About stays the closing card.
 */
const HOME_FONTS = {
  title: "Free Fonts",
  url: "/fonts/",
  desc: "Browse free fonts for personal and commercial design projects, with original font files and license information.",
};

/**
 * The icon library, as a resource card beside the font library: one card to
 * /icons/, not a card per pack. Its route is checked against the route table
 * like every other card, so it can only point at the page the build made.
 */
const HOME_ICONS = {
  title: "Icon Packs",
  url: "/icons/",
  desc: "Browse outline, solid, duotone, and 3D icon packs for web and mobile app design.",
};

/** The one resource card that is not a guide topic. */
const HOME_ABOUT = {
  title: "About BPOZZ",
  url: "/about",
  desc: "BPOZZ is an independent platform for practical design tools, resources, and insights.",
};

/**
 * Guide topics the resource cards leave out. They used to be read from the
 * hero's trending row, so the cards never repeated a hero link. The hero's
 * explore strip now links nearly every topic, and deriving the list from the
 * page would empty this section, so it is pinned to the five topics the old
 * row showed: the resource cards stay exactly as they were.
 */
const RESOURCE_TOPICS_SKIPPED = new Set([
  "color-theory",
  "typography",
  "spacing",
  "figma",
  "accessibility",
]);

/**
 * Guide topics that always sort to the end of the resource cards, whatever
 * their guide count: still real, still linked, just not what a visitor
 * should meet first. Adobe XD is a discontinued product, so its workflow
 * topic goes last.
 */
const RESOURCE_TOPICS_LAST = new Set(["adobe-xd"]);

function assertRoute(knownUrls, url, what) {
  if (!knownUrls.has(url)) {
    throw new Error(
      `homepage ${what} links to ${url}, which is not in the route table`,
    );
  }
}

function toolCtaHtml(cta) {
  return (
    `<p class="tool-card__cta" aria-hidden="true">` +
    `<span>${escapeHtml(cta)}</span><span class="tool-card__arrow">→</span>` +
    `</p>`
  );
}

function toolCardsHtml(model, knownUrls) {
  return HOME_TOOLS.map(function (tool) {
    assertRoute(knownUrls, tool.url, `tool card "${tool.title}"`);
    return (
      `<li class="tool-card tool-card--${tool.tone}">` +
      `<h3 class="tool-card__title"><a class="tool-card__link" href="${escapeHtml(tool.url)}">${escapeHtml(tool.title)}</a></h3>` +
      `<p class="tool-card__desc">${escapeHtml(tool.desc(model))}</p>` +
      toolCtaHtml(tool.cta) +
      `</li>`
    );
  }).join("");
}

/**
 * Guide topics for the resource cards: every category that has guides (the
 * same rule src/build/categories.js uses to build /category/<slug>) and is
 * not in excludeSlugs, most guides first, then in
 * categories.json order — except RESOURCE_TOPICS_LAST, which always go last.
 */
function resourceTopics(categories, guides, excludeSlugs) {
  const counts = new Map();
  guides.forEach(function (g) {
    counts.set(g.category, (counts.get(g.category) || 0) + 1);
  });
  return categories
    .filter(function (c) {
      return counts.has(c.slug) && !excludeSlugs.has(c.slug);
    })
    .map(function (c) {
      return { category: c, guides: counts.get(c.slug) };
    })
    .sort(function (a, b) {
      const last =
        Number(RESOURCE_TOPICS_LAST.has(a.category.slug)) -
        Number(RESOURCE_TOPICS_LAST.has(b.category.slug));
      return (
        last ||
        b.guides - a.guides ||
        (a.category.order || 0) - (b.category.order || 0)
      );
    });
}

function resourceCardHtml(card) {
  return (
    `<li class="resource-card">` +
    `<h3 class="resource-card__title"><a class="resource-card__link" href="${escapeHtml(card.url)}">${escapeHtml(card.title)}</a></h3>` +
    `<p class="resource-card__desc">${escapeHtml(card.desc)}</p>` +
    `</li>`
  );
}

function resourceCardsHtml(topics, knownUrls) {
  const cards = [HOME_FONTS, HOME_ICONS]
    .concat(
      topics.map(function (t) {
        return {
          title: t.category.name,
          url: `/category/${t.category.slug}`,
          desc: t.category.description,
        };
      }),
    )
    .concat(HOME_ABOUT);
  cards.forEach(function (card) {
    assertRoute(knownUrls, card.url, `resource card "${card.title}"`);
  });
  return { html: cards.map(resourceCardHtml).join(""), count: cards.length };
}

/**
 * resource-types.json's `home` blocks drove the homepage's old generated
 * resource sections. The page no longer has those sections, so a `home`
 * block would be silently ignored — refuse it instead, so nobody configures
 * a section and wonders why it never appears. (The block's SHAPE is still
 * validated in src/build/content.js; this is the consumer's half.)
 */
function assertNoHomeBlocks(registry) {
  registry.forEach(function (entry, i) {
    if (entry.home !== null) {
      throw new Error(
        `resource-types.json[${i}] ("${entry.type}") has a home block, but the ` +
          `homepage no longer renders resource-type sections — set "home": null`,
      );
    }
  });
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
// One filter chip per guide category, from categories.json (sorted by
// `order`, labeled with the full `name`, keyed by the same slug guides.json
// uses). A category is listed only if at least one guide in guides.json has it
// as its `category`, so no chip can filter the grid down to nothing.

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

// Rendered as the same filter chips as /fonts/ (a pressed "All" chip, then one
// per category) and wired up by src/client/guides.js. The /category/<slug>
// pages are still linked from the homepage's resource cards, the footer and
// the sitemap.
function guideCategoriesHtml(categories) {
  return [
    `<button type="button" class="guides-filter" data-category="all" aria-pressed="true">All</button>`,
  ]
    .concat(
      categories.map(function (category) {
        return `<button type="button" class="guides-filter" data-category="${escapeHtml(category.slug)}" aria-pressed="false">${escapeHtml(category.name)}</button>`;
      }),
    )
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
 * Homepage: the tool cards and the resource cards below the static hero.
 * The resource cards skip RESOURCE_TOPICS_SKIPPED.
 */
function buildIndexHtml(file, model, knownUrls) {
  const label = "index.html";
  let html = fs.readFileSync(file, "utf8");

  const topics = resourceTopics(
    model.categories,
    model.guides,
    RESOURCE_TOPICS_SKIPPED,
  );
  const resources = resourceCardsHtml(topics, knownUrls);

  html = replaceBetween(
    html,
    "<!--HOME_TOOLS_START-->",
    "<!--HOME_TOOLS_END-->",
    toolCardsHtml(model, knownUrls),
    label,
  );
  html = replaceBetween(
    html,
    "<!--HOME_RESOURCES_START-->",
    "<!--HOME_RESOURCES_END-->",
    resources.html,
    label,
  );

  fs.writeFileSync(file, html);
  return { tools: HOME_TOOLS.length, resources: resources.count };
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
    `${guides.length} guides`,
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

  assertNoHomeBlocks(ctx.model.resourceTypes);

  const { cardHtml } = BpozzCard.createRenderer({
    categories: loadCategoryLabels(ctx.model.categories),
  });

  const index = buildIndexHtml(
    path.join(stage, INDEX_PAGE),
    ctx.model,
    new Set((ctx.routes || []).map((r) => r.url)),
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
  buildRoadmap,
  groupRoadmap,
  HOME_TOOLS,
  HOME_FONTS,
  HOME_ICONS,
  HOME_ABOUT,
  toolCardsHtml,
  RESOURCE_TOPICS_SKIPPED,
  resourceTopics,
  RESOURCE_TOPICS_LAST,
  resourceCardsHtml,
  assertNoHomeBlocks,
  loadCategoryLabels,
  loadGuideCategories,
  guideCategoriesHtml,
  replaceBetween,
  INDEX_PAGE,
  GUIDES_PAGE,
  ROADMAP_PAGE,
  ROADMAP_STAGES,
};
