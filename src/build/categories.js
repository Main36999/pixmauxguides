/**
 * src/build/categories.js — the category archive pages, rendered in-process.
 *
 * PHASE 4 STEP 3C — the third legacy builder to leave RENDER_ORDER.
 *
 * This is `build-categories.js` ported verbatim in behaviour and deleted at
 * the root. It is the first of the three migrations to move a page WRITER
 * rather than a page PATCHER: the footer and the header rewrite a marker
 * region inside pages that already exist, while this module emits each
 * category page's full HTML from scratch, every run. Nothing about that
 * changes here — the template below, down to its indentation, is the old
 * file's template.
 *
 * WHAT THESE PAGES ARE
 *
 * One standalone, crawlable archive page per category —
 * category/color-theory.html, category/typography.html, … — generated from
 * guides.json. Each is a resourceboy.com/fonts/-style listing: a short title
 * and one-line description, then the SAME .guides-main/.grid/.content-card
 * markup the homepage grid uses. Since Phase 3 that card comes from
 * src/shared/card.js, which build-home.js and the browser's /app.js bundle
 * also render from — one implementation, so the three surfaces cannot drift.
 *
 * WHY THEY EXIST
 *
 * Header/trending-card links to a category (e.g. "Color Theory") used to
 * carry data-jump-category and just re-filter the homepage grid in place via
 * app.js — a real navigation only on pages other than index.html, and never a
 * page of its own. That meant a category had no stable, linkable, indexable
 * URL. These pages give it one, modeled on resourceboy.com's own category
 * archives (a plain breadcrumb, heading, and the same card grid — no separate
 * design system).
 *
 * THE PALETTES PREVIEW RAIL
 *
 * Each page's Guide grid is followed, optionally, by one more section —
 * "related_palettes" — built from content-index.json and filtered to records
 * whose `categories[]` includes this page's slug. Every Palette carries the
 * fixed pair ["color-theory", "systems"], so today only those two category
 * pages gain a section; the other 8 render exactly as before. No section
 * markup is emitted when there are no matching records, mirroring how this
 * file already skips writing a page for a category with zero guides, and how
 * app.js's initRelatedGuides() removes its own rail <aside> when empty rather
 * than leaving a blank box.
 *
 * Preview size and ordering reuse two decisions the codebase already made:
 *   - Cap of 10 — the same number app.js's related-guides rail shows on every
 *     /guide/ page.
 *   - Order — content-index.json preserves palettes-data.json's own record
 *     order, and that source file is already stored newest-first. Taking the
 *     first N of the filtered list is therefore already "the 10 newest".
 *
 * WHAT CHANGED, AND WHAT DID NOT
 *
 * Three deliberate changes, all of them the same moves Steps 3A and 3B made,
 * or a direct consequence of them:
 *
 *   1. THE INPUTS COME FROM ctx, NOT FROM THE STAGING ROOT. The builder
 *      resolved guides.json, categories.json and content-index.json from its
 *      own __dirname, which staging pointed at .build/. This module takes
 *      them from the model the `load` and `data` stages already built:
 *
 *        guides.json         -> ctx.model.guides
 *        categories.json     -> ctx.model.categories
 *        content-index.json  -> ctx.contentIndex
 *
 *      All three were verified equal to the staged copies the builder read
 *      before the swap, by JSON comparison against .build/ on a live build.
 *      ctx.contentIndex matters most: it is the index the `data` stage just
 *      generated, which is what the builder read from the staging root — NOT
 *      the committed copy at the repo root, which is build output and could
 *      in principle be stale. The two agree today (check-baseline.js asserts
 *      it), and this module keeps reading the generated one regardless.
 *
 *      The two partials are the exception, and deliberately so: they are
 *      template inputs rather than content, so they are read from the repo
 *      root with fs — exactly as src/build/header.js and src/build/footer.js
 *      read them. The staged copies were byte-for-byte copies of the same
 *      files (verified), and with this migration they have no reader left at
 *      all, which is why their STAGE_FILES entries leave with this step.
 *
 *   2. THE OUTPUT ROOT IS PASSED IN. The builder wrote to
 *      path.join(__dirname, "category"); this module writes to
 *      path.join(ctx.config.paths.stage, "category") — the same directory,
 *      named rather than inferred. It must stay the staging root: the header
 *      runs next and has to put `aria-current` back into these pages, the
 *      footer after that, and only then does `render` publish them to dist/.
 *
 *   3. THE WARNINGS ARE REPORTED, NOT SWALLOWED. The builder announced an
 *      unknown category slug and a zero-guide category through console.warn.
 *      That is stderr, and `render`'s ⚠ scan reads the child's STDOUT, so
 *      neither warning could ever reach the build log — verified by probe
 *      before this change. Both now return to the caller and go through
 *      ctx.warn, the same channel header and footer report on. Neither fires
 *      against the current data (all 10 categories carry at least one guide
 *      and no guide names a slug categories.json does not have), so the build
 *      log is unchanged today; what changes is that they would be seen.
 *
 * Everything the output depends on is unchanged and deliberately so:
 *
 *   - both partials are `.trim()`ed before insertion, and embedded VERBATIM
 *     inside the HEADER_START/END and FOOTER_START/END marker comments, so
 *     header.js and footer.js can resync these pages the normal way;
 *   - the page template is transcribed character for character, including the
 *     JSON-LD block's two-space indent and the single conditional newline
 *     before the rail;
 *   - categories are visited in categories.json order, via the same
 *     insertion-ordered key map;
 *   - a category with zero guides is skipped and no page is written for it,
 *     which leaves the staged copy of the committed page in place — the same
 *     outcome the builder produced;
 *   - a guide naming a slug categories.json does not carry is dropped from
 *     every grid, not assigned to some fallback;
 *   - CATEGORY_CODE is still a literal map here and still fails loudly on a
 *     slug it has no entry for, rather than emitting a broken eyebrow;
 *     PHASE 4 STEP 6 left that check exactly where it is, and moved only the
 *     categories.json SCHEMA rules loadCategoryData() re-stated alongside it
 *     — see that function, and the module header note below;
 *   - every page is written on every run, unconditionally. The header and
 *     footer modules skip a write when nothing changed; this one does not,
 *     because the builder did not, and a page written from scratch has no
 *     "already current" state to compare against that the template itself
 *     does not already make deterministic.
 *
 * ORDER
 *
 * home → categories → guides → header → footer. This module writes pages
 * from the raw partials; so does src/build/guides.js, added to the sequence in
 * Step 4; the header restores `aria-current` for both; the footer is last and
 * rewrites only its own marker region, so it disturbs neither. This module's
 * own position is unchanged — it has no relationship with the guide pages.
 *
 * PHASE 4 STEP 6 — WHAT THIS MODULE STOPPED OWNING
 *
 * Three things, none of which changed a byte of output:
 *
 *   - the categories.json schema, re-stated by loadCategoryData() and by two
 *     functions in src/build/home.js;
 *   - TYPE_BADGE_LABEL, also declared in src/build/home.js;
 *   - tagsMetaFor(), also declared in src/build/home.js, with a slightly
 *     different guard.
 *
 * All three live in src/build/content.js now, the module that already owns
 * the content model. What stayed here is what is genuinely this module's:
 * CATEGORY_CODE and the check that every category has an entry in it, the
 * page template, and the rail. Both vocabulary bindings are re-exported, so
 * this module's API is unchanged.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("../shared/html.js");
const BpozzCard = require("../shared/card.js");
const content = require("./content.js");
const structuredData = require("./structured-data.js");
const head = require("./head.js");

const HEADER_PARTIAL = path.join("partials", "header.html");
const FOOTER_PARTIAL = path.join("partials", "footer.html");

/**
 * PHASE 4 STEP 8 — this page type's two head variations.
 *
 * The category pages' <head> is the guide pages' <head>, in the same band
 * order, with two differences. Both are stated here as values so the shared
 * frame in src/build/head.js stays one thing:
 *
 *   consentNote  false — these pages carry the Consent Mode v2 default
 *                script WITHOUT the explanatory comment above it. The script
 *                itself is byte-identical to every other page's.
 *   stylesheets  /styles.css only. /guide-article.css styles the .guide-article
 *                prose body, which a category archive has none of.
 *
 * Neither is normalized here: either change would change what these 10 pages
 * ship, which is a formatting decision with its own approval rather than a
 * consolidation.
 */
const HEAD_OPTIONS = {
  consentNote: false,
  stylesheets: [head.STYLESHEETS.site],
};

/**
 * The first focusable element on the page. Same shape as the guide pages'
 * (src/build/guide-template.js), differing only in the target id and label,
 * both of which are this page type's own. Step 9 owns any change to either.
 */
const SKIP_LINK = head.skipLinkHtml("category-content", "Skip to content");

/** Output directory, relative to the staging root. */
const CATEGORY_DIR = "category";

/**
 * Same cap app.js's related-guides rail uses — one shared constant so the two
 * "preview size" decisions can't silently drift apart if either is changed
 * later.
 */
const RAIL_PREVIEW_LIMIT = 10;

/**
 * PHASE 4 STEP 6 — content-index vocabulary, from its one home.
 *
 * This map was declared here AND in src/build/home.js, each copy commented as
 * matching the other and search.html. It is keyed by a content-index record's
 * `type`, so it lives with the module that writes that field. Re-exported
 * below, so this module's API is unchanged.
 *
 * A category page is a mixed-resource surface (Guide grid + Palettes rail),
 * so every card on it says which of the two it is. The DOM text stays Title
 * Case; .badge in styles.css renders it uppercase (GUIDE / PALETTE) so screen
 * readers still get a normal word.
 */
const TYPE_BADGE_LABEL = content.TYPE_BADGE_LABEL;

/**
 * The hero eyebrow's mono code, per category slug.
 *
 * Phase 4 (D1/D2): `label`, `dek` and `ogImage` used to be hand-copied
 * literals alongside this map, duplicating categories.json exactly. They are
 * read from the content model now, which every other consumer already treats
 * as authoritative. The field mapping is:
 *
 *     categories.json .name        -> cat.label
 *     categories.json .description -> meta.dek
 *     categories.json .ogImage     -> meta.ogImage
 *
 * `code` stays here as a literal map: it is a presentation detail of this
 * module alone — the only consumer is monoLabel() for the hero eyebrow — and
 * it is NOT derivable from the slug (spacing -> SPACING_LAYOUT, mobile ->
 * MOBILE_APP, motion -> PROTOTYPING), so it is kept rather than synthesized.
 * It deliberately does not live in categories.json (D2 B).
 */
const CATEGORY_CODE = {
  "color-theory": "COLOR_THEORY",
  typography: "TYPOGRAPHY",
  spacing: "SPACING_LAYOUT",
  figma: "FIGMA",
  "adobe-xd": "ADOBE_XD",
  mobile: "MOBILE_APP",
  web: "WEB_LAYOUT",
  systems: "DESIGN_SYSTEMS",
  accessibility: "ACCESSIBILITY",
  motion: "PROTOTYPING",
};

/**
 * PHASE 3: this surface used to carry its own copy of the Guide card, the
 * category motifs, the dimension labels, the level names and escapeHtml — all
 * "ported 1:1 from build-home.js", which had in turn ported them from app.js.
 * One copy now lives in src/shared/card.js and all three callers bind to it.
 *
 * The badge is the one thing this surface does differently, which is why the
 * grid passes GUIDE_BADGE explicitly instead of using `guides.map(cardHtml)` —
 * map would hand the renderer the array index, and the renderer ignores a
 * non-string badge by design.
 */
const GUIDE_BADGE = `<span class="badge">${TYPE_BADGE_LABEL.guide}</span>`;

// ---------------------------------------------------------------------
// category data
// ---------------------------------------------------------------------

/**
 * Builds { CATEGORIES, CATEGORY_META } from the loaded categories model, and
 * fails loudly on a slug that has no `code` above rather than emitting a
 * broken eyebrow.
 *
 * Key insertion order is categories.json's own order, which is what makes the
 * page-writing loop below deterministic.
 *
 * PHASE 4 STEP 6 — SHAPE MOVED OUT, THE CODE MAP STAYED
 *
 * This was the third of three copies of the categories.json schema (the other
 * two were src/build/home.js's loadCategoryLabels() and
 * loadGuideCategories()). The array, slug and name rules are stated once in
 * src/build/content.js and applied in `load`, so they have already run by the
 * time `render` calls this.
 *
 * The CATEGORY_CODE check stays, because it is not a rule about
 * categories.json at all: it asks whether THIS module has a hero eyebrow for
 * the slug, and the map it checks lives here by design (D2 B).
 */
function loadCategoryData(categories) {
  const labels = {};
  const meta = {};
  categories.forEach(function (category, i) {
    if (!CATEGORY_CODE[category.slug]) {
      throw new Error(
        `categories.json[${i}] ("${category.slug}") has no entry in CATEGORY_CODE — add one in src/build/categories.js`,
      );
    }
    labels[category.slug] = {
      label: category.name,
      code: CATEGORY_CODE[category.slug],
    };
    meta[category.slug] = {
      dek: category.description,
      ogImage: category.ogImage,
    };
  });
  return { CATEGORIES: labels, CATEGORY_META: meta };
}

// ---------------------------------------------------------------------
// palettes preview rail (content-index records)
// ---------------------------------------------------------------------

/**
 * Up to RAIL_PREVIEW_LIMIT content-index records of `type` whose categories[]
 * includes `slug`, in the index's own order (see the note at the top of this
 * file for why that order is already "newest first" and needs no re-sorting).
 */
function recordsForCategory(contentIndex, type, slug) {
  const matches = [];
  for (const record of contentIndex) {
    if (record.type !== type) continue;
    if (!Array.isArray(record.categories) || !record.categories.includes(slug))
      continue;
    matches.push(record);
    if (matches.length >= RAIL_PREVIEW_LIMIT) break;
  }
  return matches;
}

/**
 * One tag list, Title Cased and joined — the fallback meta line for Palette
 * records, which have no `description` in the index. Matches search.html's
 * snippetFor(), so the same record reads the same way on both discovery
 * surfaces.
 *
 * PHASE 4 STEP 6: the body lives in src/build/content.js, with the record
 * schema it reads. src/build/home.js carried a second copy whose only
 * difference was an `Array.isArray` guard this one lacked; the stricter form
 * is what survived, and it returns "" for every input this one did.
 * Re-exported below, so this module's API is unchanged.
 */
const tagsMetaFor = content.tagsMetaFor;

/**
 * A lightweight, non-interactive preview card for a Palette content-index
 * record. Deliberately NOT palettes.js's cardHtml() — that renders live
 * like/save/copy controls backed by Firebase, which this page never loads;
 * embedding that markup here would ship dead buttons (spec §22–23: don't move
 * that business logic into a system that doesn't own it). Instead this reuses
 * the same plain .content-card/.card-body/.card-title/.card-meta classes the
 * Guide grid above already uses, plus .badge (already used by search.html) for
 * the type label, so no new CSS is needed anywhere.
 */
function indexRecordCardHtml(record) {
  const badge = TYPE_BADGE_LABEL[record.type] || record.type;
  const meta = tagsMetaFor(record);
  return (
    `<article class="content-card">` +
    `<span class="badge">${escapeHtml(badge)}</span>` +
    `<div class="card-body">` +
    `<h3 class="card-title"><a class="card-link" href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></h3>` +
    (meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : "") +
    `</div></article>`
  );
}

/**
 * One optional rail section. Returns "" (renders nothing) when there are no
 * matching records — same "don't leave an empty box" behaviour as the
 * zero-guide skip in render(), and as app.js's initRelatedGuides(), which
 * removes its rail <aside> entirely when there's nothing relevant to show.
 * Reuses .guide-rail/.guide-rail__label verbatim from styles.css's existing
 * /guide/ page rail — a generic "labeled divider + grid" component despite its
 * name, and the closest existing match to "capped preview section".
 */
function railHtml(labelSlug, ariaLabel, records) {
  if (!records.length) return "";
  const cardsHtml = records.map(indexRecordCardHtml).join("");
  return (
    `<aside class="guide-rail" aria-label="${escapeHtml(ariaLabel)}">` +
    `<p class="section-label mono guide-rail__label">/ ${escapeHtml(labelSlug)}</p>` +
    `<div class="grid">${cardsHtml}</div>` +
    `</aside>`
  );
}

// ---------------------------------------------------------------------
// page template
// ---------------------------------------------------------------------

function monoLabel(code) {
  return code.toLowerCase();
}

/**
 * The full HTML of one category page.
 *
 * `cat`, `meta` and `cardHtml` used to be module-level bindings, closed over
 * from a categories.json read that happened at require() time. They are
 * parameters now because the category map is built per render from ctx. The
 * emitted text is unchanged.
 */
function pageHtml(
  slug,
  guides,
  paletteRecords,
  headerPartial,
  footerPartial,
  cat,
  meta,
  cardHtml,
  origin,
) {
  // Phase 3: neutral category framing. A category page is not a
  // Guides-only archive — it also carries the related_palettes
  // rail below — so the title names the category and
  // the site, nothing else. The <h1> below was already neutral.
  const title = `${cat.label} — BPOZZ`;
  const description = meta.dek;
  // PHASE 4 STEP 7: `origin` instead of four hard-coded "https://bpozz.com"
  // literals. site.config.js's first field is the canonical origin and is
  // documented as the one place it lives; this template was quietly the
  // fourth, fifth, sixth and seventh.
  const canonical = `${origin}/category/${slug}`;
  const ogImage = meta.ogImage.startsWith("/")
    ? origin + meta.ogImage
    : meta.ogImage;
  const cardsHtml = guides.map((g) => cardHtml(g, GUIDE_BADGE)).join("");
  const count = guides.length;
  // PHASE 4 TOKEN REMOVAL: the related_tokens rail is gone. The
  // related_palettes rail is unchanged, and still renders "" for every
  // category except color-theory/systems, so the 8 unaffected category
  // pages keep byte-identical markup.
  const railsHtml = railHtml(
    "related_palettes",
    "Related palettes",
    paletteRecords,
  );

  // PHASE 4 STEP 7: the CollectionPage object used to be written out here,
  // in the middle of a page template, with its own copy of the origin. It is
  // composed by src/build/structured-data.js now — the same module the guide
  // pages' JSON-LD comes from — so the site has one place where structured
  // data is shaped rather than one per page type. The emitted JSON is
  // unchanged; only its indentation inside the <script> tag moved, because
  // the shared renderer indents every block the same way.
  const jsonLdHtml = structuredData.scriptsHtml(
    [
      structuredData.categoryJsonLd({
        label: cat.label,
        description,
        slug,
        origin,
      }),
    ],
    4,
  );

  // PHASE 4 STEP 8: the shared <head> frame used to be written out here too —
  // the Cookiebot tag, the consent default, the charset, gtag.js, the theme
  // colour, both icons, the font preconnects and /styles.css, all as literal
  // text, and all of it a second copy of what src/build/guide-template.js
  // declared as constants. src/build/head.js holds those bands now and states
  // the band order once for both writers. What is composed below is this page
  // type's own text: its meta band and its social band, which are built from
  // values (title, description, canonical, ogImage) rather than transcribed.
  //
  // HEAD_OPTIONS names this page type's two differences from the guide pages'
  // head. Both are recorded rather than normalized: changing either changes
  // the bytes these 10 pages ship.
  const headMarkup = head.headHtml({
    consentNote: HEAD_OPTIONS.consentNote,
    meta: `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />

`,
    social: `    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="BPOZZ" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@bpozz" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

`,
    stylesheets: HEAD_OPTIONS.stylesheets,
    structuredData: jsonLdHtml,
  });

  return `${headMarkup}  <body class="category-page" data-category="${slug}">
${SKIP_LINK}

    ${head.headerRegion(headerPartial)}

    <main class="wrap guides-main" id="category-content" tabindex="-1">
      <div class="category-hero">
        <p class="section-label mono">/ ${monoLabel(cat.code)}</p>
        <h1 class="category-hero__title">${escapeHtml(cat.label)}</h1>
        <p class="category-hero__dek">${escapeHtml(description)}</p>
      </div>
      <div class="section-head">
        <p class="results-count">Showing ${count} of ${count} guide${count === 1 ? "" : "s"}</p>
      </div>
      <div class="grid">${cardsHtml}</div>${railsHtml ? `\n      ${railsHtml}` : ""}
    </main>

    ${head.footerRegion(footerPartial)}${head.BODY_CLOSE}
`;
}

// ---------------------------------------------------------------------
// render
// ---------------------------------------------------------------------

/**
 * Writes one category page per category that has at least one guide, into the
 * staging root, from scratch.
 *
 * Takes guides, categories and the content index from ctx; reads the two
 * partials from the repo root, the way header.js and footer.js do. Writes
 * nothing outside the staging root.
 *
 * Returns { written, skipped, unknown } for the caller to summarize and warn
 * on:
 *   written  slugs that got a page
 *   skipped  slugs with zero guides, whose page was NOT written
 *   unknown  "<guide id>" / "<slug>" pairs naming a category that isn't in
 *            categories.json; those guides appear in no grid
 */
function render(ctx) {
  const { root, stage } = ctx.config.paths;

  // PHASE 4 STEP 6: no Array.isArray(guides) guard here any more — `load`
  // validates guides.json once, for every builder, before dist/ exists.
  const guides = ctx.model.guides;

  // The index the `data` stage just generated — not the committed copy at the
  // repo root. Read-only here; this module never writes it.
  const contentIndex = ctx.contentIndex;
  if (!Array.isArray(contentIndex)) {
    throw new Error(
      "content-index.json did not contain an array — the categories builder " +
        "runs after the `data` stage and expects ctx.contentIndex to be set.",
    );
  }

  const { CATEGORIES, CATEGORY_META } = loadCategoryData(ctx.model.categories);
  // titleTag: "h2" — Phase 4 Step 9 (accessibility). A category page's grid
  // hangs directly off its <h1> (the .category-hero title); unlike the home
  // and /guides grids there is no "/ all_guides"-style <h2> above it, so the
  // renderer's default h3 skipped a heading level here (WCAG 1.3.1). Only
  // the tag name changes — .card-title carries the size and weight, so the
  // cards render exactly as before.
  const { cardHtml } = BpozzCard.createRenderer({
    categories: CATEGORIES,
    titleTag: "h2",
  });

  const headerPartial = fs
    .readFileSync(path.join(root, HEADER_PARTIAL), "utf8")
    .trim();
  const footerPartial = fs
    .readFileSync(path.join(root, FOOTER_PARTIAL), "utf8")
    .trim();

  const outDir = path.join(stage, CATEGORY_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  const unknown = [];
  const bySlug = new Map();
  for (const slug of Object.keys(CATEGORIES)) bySlug.set(slug, []);
  for (const g of guides) {
    if (!bySlug.has(g.category)) {
      unknown.push({ id: g.id, category: g.category });
      continue;
    }
    bySlug.get(g.category).push(g);
  }

  const written = [];
  const skipped = [];
  for (const slug of Object.keys(CATEGORIES)) {
    const guidesInCategory = bySlug.get(slug);
    if (guidesInCategory.length === 0) {
      skipped.push(slug);
      continue;
    }
    const paletteRecords = recordsForCategory(contentIndex, "palette", slug);
    const html = pageHtml(
      slug,
      guidesInCategory,
      paletteRecords,
      headerPartial,
      footerPartial,
      CATEGORIES[slug],
      CATEGORY_META[slug],
      cardHtml,
      ctx.config.origin,
    );
    fs.writeFileSync(path.join(outDir, `${slug}.html`), html);
    written.push(slug);
  }

  return { written, skipped, unknown };
}

module.exports = {
  render,
  pageHtml,
  loadCategoryData,
  recordsForCategory,
  tagsMetaFor,
  indexRecordCardHtml,
  railHtml,
  monoLabel,
  HEADER_PARTIAL,
  FOOTER_PARTIAL,
  CATEGORY_DIR,
  HEAD_OPTIONS,
  SKIP_LINK,
  CATEGORY_CODE,
  TYPE_BADGE_LABEL,
  GUIDE_BADGE,
  RAIL_PREVIEW_LIMIT,
};
