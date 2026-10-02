/**
 * src/build/guide-template.js — the one guide page structure.
 *
 * PHASE 4 STEP 4 — TEMPLATE MIGRATION
 *
 * Until this step the 22 /guide/*.html pages were the only pages on the site
 * with no template at all. Each carried its own full copy of the page frame:
 * the Cookiebot/consent block, the gtag snippet, the icon/font/stylesheet
 * links, the body scaffolding, the HEADER/FOOTER marker regions, the
 * .guide-layout / .guide-primary / #guide-rail structure, the toast container
 * and the /app.js tag. 22 copies of ~120 lines of frame, hand-maintained,
 * with `docs/archive/_TEMPLATE.html` as the only thing keeping them in step —
 * a file a human had to remember to copy from.
 *
 * That frame lives here now, once. This module is the `src/templates/guide.js`
 * the F3 note in site.config.js anticipated; it is in src/build/ rather than
 * src/templates/ because that is where every builder has lived since Phase 4
 * Step 3 finished migrating them, and a second convention for one file would
 * be worse than the file being where its neighbours are.
 *
 * WHAT IS FRAME AND WHAT IS CONTENT
 *
 * The split is measured, not chosen: a byte is frame only if it is IDENTICAL
 * on all 22 committed pages. Everything else is per-guide content, carried
 * verbatim in content/guide/<slug>.html and spliced into the slots below.
 * The six slots, in page order:
 *
 *   headMeta            viewport, <title>, description, canonical
 *   headSocial          Open Graph + Twitter Card blocks
 *   headStructuredData  per-page additions AFTER the structured data, if any
 *   hero                <section class="guide-hero"> … </section>
 *   toc                 <nav class="guide-toc"> … </nav>
 *   article             <article class="guide-article"> … </article>
 *
 * The two remaining head slots are deliberately coarse. Their contents drift
 * across the 22 pages in ways that are NOT expressible as values — three
 * pages carry a different viewport, and the attribute wrapping differs with
 * the length of each guide's own title. Generating that text from fields
 * would mean either changing bytes or re-implementing the formatter that
 * produced them, so those two bands stay verbatim.
 *
 * PHASE 4 STEP 7 — F2 CLOSED, AND WHAT THE THIRD SLOT IS NOW
 *
 * The third head slot used to hold "the ld+json block(s) and anything after
 * them in <head>", verbatim, and that is where F2 lived: three pages carried
 * `Article` + `BreadcrumbList` where six carried `TechArticle` +
 * `BreadcrumbList` and thirteen carried `TechArticle` alone. The note that
 * used to stand here said one JSON-LD generation path was "a separate,
 * separately approved step that now has exactly one place to happen: here,
 * once, instead of in 22 hand-authored files".
 *
 * That step is Step 7 and that place is `page.structuredData`, composed by
 * src/build/structured-data.js from the content model and attached to the
 * page record by src/build/content.js. No guide authors JSON-LD any more.
 *
 * The slot keeps its name and its position because it still has a job: it
 * carries whatever a page puts after its structured data and before
 * </head>. Three pages have such a thing (a note about the article styles);
 * for the other nineteen the slot is empty, and an empty slot emits nothing
 * at all.
 *
 * RECORDED DRIFT (`page.format`)
 *
 * Four differences are pure formatting, and the frame cannot be one string
 * while they exist. They are recorded per page in content/guide/pages.json so
 * the output is reproducible byte-for-byte, and each is a one-line deletion
 * once a formatting pass is approved to change those bytes:
 *
 *   headerMarkerIndented  2 pages put <!--HEADER_START--> at column 0
 *   railWrapped           8 pages wrap the empty #guide-rail over five lines
 *   primaryCloseIndent    3 pages indent .guide-primary's </div> by 10
 *   trailingNewline       1 page has no newline at end of file
 *
 * `bodyClass` and `toast` sit OUTSIDE `format`, because they are structure
 * rather than whitespace: nine pages carry no `class="guide-page"` on <body>
 * (the class is a hook nothing in styles.css or app.js reads today — checked)
 * and three carry no toast container at all. Normalizing either is a visible
 * change to the markup, so both are stated as data and preserved as-is.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * No fs, no ctx, no site config, and no HTML escaping: every slot is
 * pre-rendered HTML lifted out of a committed page, and escaping it would
 * corrupt it. Composition only. src/build/guides.js is the builder that reads
 * the model and writes the files; that is where the I/O and the gates are.
 *
 * THE HEADER AND FOOTER ARE STILL NOT OURS
 *
 * The frame emits the HEADER_START/HEADER_END and FOOTER_START/FOOTER_END
 * marker pairs with whatever partial the caller passes between them, exactly
 * as src/build/categories.js does — the raw partial, with no aria-current
 * state. src/build/header.js puts that state back and src/build/footer.js
 * rewrites its own region afterwards. That is why the guide builder runs
 * before both of them in `render`, and why the markers are not spelled out
 * here: they are those two modules' constants, they come from
 * src/build/head.js so that both writers use one spelling, and
 * src/build/guides.js asserts they agree with the patchers' on every build
 * rather than trusting this comment.
 *
 * PHASE 4 STEP 8 — THE HEAD FRAME IS NO LONGER THIS MODULE'S
 *
 * Four of the constants below used to be declared here in full:
 * DOC_OPEN, HEAD_CONSENT, HEAD_ANALYTICS and HEAD_ASSETS. They were also
 * declared, as literal text inside one template literal, in
 * src/build/categories.js — the same bytes in the same order, differing only
 * in the Consent Mode v2 comment and the extra /guide-article.css link. Two
 * copies of 1.7 KB of markup, in the two modules that write pages from
 * scratch.
 *
 * They live in src/build/head.js now, and `pageHtml` composes this page's
 * <head> with `head.headHtml`, which states the band ORDER once for both
 * writers. Nothing about this module's output moved: every constant below is
 * re-exported at the same name with the same bytes, which is what keeps
 * guide-template.test.js's frame assertions meaningful — they now check that
 * the shared frame is what a guide page carries, rather than that this file
 * agrees with itself.
 *
 * What stayed here is what is genuinely the GUIDE page's: the six-slot
 * content format, the recorded `format` drift, the guide layout and rail, the
 * toast, and this page type's two head variations (it carries the consent
 * comment, and it loads /guide-article.css).
 */

"use strict";

const head = require("./head.js");
const { escapeHtml } = require("../shared/html.js");

// ---------------------------------------------------------------------
// the frame — the shared bands from src/build/head.js, plus this page
// type's own structure
// ---------------------------------------------------------------------

/**
 * This page type's two head variations, and the only two things `headHtml`
 * needs from it beyond the per-page slots.
 *
 * Every guide page uses /styles.css + /guide-article.css and no page carries
 * a <style> block — the audit `docs/archive/_TEMPLATE.html` opens with, and
 * what guide-template.test.js asserts per page.
 */
const HEAD_OPTIONS = {
  consentNote: true,
  stylesheets: [head.STYLESHEETS.site, head.STYLESHEETS.guideArticle],
};

const DOC_OPEN = head.DOC_OPEN;

/**
 * Cookiebot, Google Consent Mode v2 and <meta charset>. Identical on all 22
 * pages. The consent default must be set before gtag.js loads, which is why
 * this band is above HEAD_META rather than beside HEAD_ANALYTICS.
 */
const HEAD_CONSENT = head.consentHtml(HEAD_OPTIONS.consentNote);

/** gtag.js. Identical on all 22 pages. */
const HEAD_ANALYTICS = head.HEAD_ANALYTICS;

/**
 * Theme colour, icons, fonts and the two stylesheets. Identical on all 22
 * pages. Both hrefs are site-root paths on purpose — a visitor on
 * /guide/<slug>/ resolves "../" one level too shallow and loses every
 * stylesheet.
 */
const HEAD_ASSETS = head.assetsHtml(HEAD_OPTIONS.stylesheets);

const HEAD_CLOSE = head.HEAD_CLOSE;

const SKIP_LINK = head.skipLinkHtml("guide-content", "Skip to guide");

/** Marker pairs owned by src/build/header.js and src/build/footer.js. */
const HEADER_START = head.HEADER_START;
const HEADER_END = head.HEADER_END;
const FOOTER_START = head.FOOTER_START;
const FOOTER_END = head.FOOTER_END;

/** Indentation of <!--HEADER_START-->; see `format.headerMarkerIndented`. */
const HEADER_MARKER_INDENT = "    ";

const MAIN_OPEN = `    <main class="wrap" id="guide-content" tabindex="-1">
      <div class="guide-layout">
        <div class="guide-primary">
`;

/**
 * The visible trail above the hero: Guides / category, two links.
 *
 * Frame, not content. It is the one band built from data rather than
 * lifted from a committed page, so it is the one place this module
 * escapes: a category name may carry an "&". The argument is the
 * guide's categories.json record, attached to the page record by
 * src/build/content.js. The link uses its slug, the text its name.
 * The "/" between the two links is drawn by guide-article.css, as on
 * the font pages. pageHtml() emits nothing for a record that has no
 * category, which is what lets the template's own fixture render.
 */
function breadcrumbHtml(category) {
  const href = "/category/" + escapeHtml(category.slug);
  const name = escapeHtml(category.name);
  return [
    '          <nav class="guide-breadcrumb" aria-label="Breadcrumb">',
    "            <ol>",
    '              <li><a href="/guides/">Guides</a></li>',
    '              <li><a href="' + href + '">' + name + "</a></li>",
    "            </ol>",
    "          </nav>",
    "",
    "",
  ].join("\n");
}

/**
 * The guide's place on the Learning Roadmap, between the hero and the
 * table of contents: its stage, its position, and a link to /roadmap.
 *
 * Frame, not content, and built from data like the breadcrumb above. The
 * argument is the page record's `roadmap`, derived from guides.json's
 * roadmapStage / roadmapStep by src/build/roadmap.js and attached by
 * src/build/content.js. `position` is the guide's place in the roadmap's
 * own order, never the `roadmapStep` sort key. A stage title may carry
 * an "&", so it is escaped. pageHtml() emits nothing for a guide that is
 * not on the roadmap.
 */
function roadmapContextHtml(roadmap) {
  const place =
    "Stage " +
    roadmap.stageNumber +
    " of " +
    roadmap.stageCount +
    " · " +
    escapeHtml(roadmap.stageTitle) +
    " · Guide " +
    roadmap.position +
    " of " +
    roadmap.total;
  return [
    '          <nav class="guide-roadmap" aria-label="Learning Roadmap">',
    '            <span class="section-label mono guide-roadmap__label">/ learning_roadmap</span>',
    '            <p class="guide-roadmap__position">' + place + "</p>",
    '            <a class="guide-roadmap__link" href="/roadmap">View the roadmap</a>',
    "          </nav>",
    "",
    "",
  ].join("\n");
}

/**
 * Previous / next in roadmap order, after the article and above the
 * related-guides rail. The markup is the .guide-footer-nav component
 * guide-article.css has always carried for exactly this.
 *
 * The same `roadmap` record as above. The first roadmap guide has no
 * `prev` and the last has no `next`; the missing link is left out, not
 * pointed somewhere else.
 *
 * Each link says which way it goes in words: "Previous: " or "Next: " in
 * a .sr-only span, read by assistive technology and not drawn. The arrow
 * is the drawn half of the same statement and is aria-hidden, so a link's
 * accessible name is "Previous: <title>" rather than an arrow character's
 * name followed by the title.
 */
function roadmapNavHtml(roadmap) {
  const lines = [
    '          <nav class="guide-footer-nav" aria-label="Learning Roadmap order">',
  ];
  if (roadmap.prev) {
    lines.push(
      '            <a class="prev" href="/guide/' +
        escapeHtml(roadmap.prev.id) +
        '"><span aria-hidden="true">← </span>' +
        '<span class="sr-only">Previous: </span>' +
        escapeHtml(roadmap.prev.title) +
        "</a>",
    );
  }
  if (roadmap.next) {
    lines.push(
      '            <a class="next" href="/guide/' +
        escapeHtml(roadmap.next.id) +
        '"><span class="sr-only">Next: </span>' +
        escapeHtml(roadmap.next.title) +
        '<span aria-hidden="true"> →</span></a>',
    );
  }
  lines.push("          </nav>");
  return "\n\n" + lines.join("\n");
}

/**
 * The related-guides rail. Always emitted EMPTY: /app.js fills it from
 * guides.json at runtime, and _TEMPLATE.html's own instruction is "always
 * leave empty — do not hand-write related links here". Two spellings of the
 * same empty element exist in the committed pages; see `format.railWrapped`.
 */
const RAIL_INLINE =
  '        <aside class="guide-rail" id="guide-rail" aria-label="Related guides"></aside>';

const RAIL_WRAPPED = `        <aside
          class="guide-rail"
          id="guide-rail"
          aria-label="Related guides"
        ></aside>`;

const MAIN_CLOSE = "\n      </div>\n    </main>";

/** Separator between </main>, the toast container and <!--FOOTER_START-->. */
const AFTER_MAIN = "\n\n    ";

const TOAST =
  '<div class="toast" id="toast" role="status" aria-live="polite"></div>';

const PAGE_CLOSE = head.BODY_CLOSE;

// ---------------------------------------------------------------------
// the content file format
// ---------------------------------------------------------------------

/**
 * The six slots, in page order, with the marker name each is delimited by in
 * content/guide/<slug>.html. Order is load-bearing twice over: it is the
 * order pageHtml() splices them in, and parseContent() requires the file to
 * carry them in exactly this sequence.
 */
const SLOTS = [
  { key: "headMeta", marker: "HEAD_META" },
  { key: "headSocial", marker: "HEAD_SOCIAL" },
  { key: "headStructuredData", marker: "HEAD_STRUCTURED_DATA" },
  { key: "hero", marker: "HERO" },
  { key: "toc", marker: "TOC" },
  { key: "article", marker: "ARTICLE" },
];

const SLOT_KEYS = SLOTS.map((s) => s.key);

/**
 * Serializes slot text into the canonical content-file form:
 *
 *     <!--HEAD_META_START-->
 *     …slot text…
 *     <!--HEAD_META_END-->
 *
 * THE NEWLINE RULE, which is the whole reason this is lossless: the newline
 * directly after a START marker and the one directly before an END marker
 * belong to the MARKER LINE, not to the slot. Nothing else is added, removed
 * or trimmed, so a slot that genuinely ends in a blank line keeps it (it
 * shows up as two blank lines before the END marker) and a slot that ends
 * mid-line keeps that too.
 */
function serializeContent(slots) {
  return SLOTS.map(
    ({ key, marker }) =>
      `<!--${marker}_START-->\n${slots[key]}\n<!--${marker}_END-->\n`,
  ).join("");
}

/**
 * Reads a content file back into slot text. Strict on purpose: the file must
 * be exactly what serializeContent() produces, and the check is the
 * round-trip itself rather than a list of rules. That makes any edit that
 * loses a byte — a marker mistyped, slots reordered, a note dropped between
 * two blocks, an editor stripping a trailing blank line — a build failure
 * instead of a silently different page.
 */
function parseContent(text, label) {
  const slots = {};
  let from = 0;

  for (const { key, marker } of SLOTS) {
    const start = `<!--${marker}_START-->\n`;
    const end = `\n<!--${marker}_END-->\n`;
    const iStart = text.indexOf(start, from);
    if (iStart === -1) {
      throw new Error(
        `${label}: no <!--${marker}_START--> block (expected the six slots ` +
          `${SLOT_KEYS.join(", ")} in that order)`,
      );
    }
    const iEnd = text.indexOf(end, iStart + start.length);
    if (iEnd === -1) {
      throw new Error(
        `${label}: <!--${marker}_START--> has no matching <!--${marker}_END-->`,
      );
    }
    slots[key] = text.slice(iStart + start.length, iEnd);
    from = iEnd + end.length;
  }

  const canonical = serializeContent(slots);
  if (canonical !== text) {
    throw new Error(
      `${label} is not in canonical slot form — the six slot blocks must be ` +
        `the whole file, in order, with nothing between or around them.\n` +
        `  expected ${canonical.length} bytes, file has ${text.length}`,
    );
  }

  return slots;
}

// ---------------------------------------------------------------------
// the template
// ---------------------------------------------------------------------

/**
 * The full HTML of one guide page.
 *
 *   page      a record from content/guide/pages.json with its `content` slots
 *             and its `structuredData` attached — see src/build/content.js
 *   partials  { header, footer }, each already trimmed, inserted verbatim
 *             between the marker pairs for header.js/footer.js to resync
 *
 * `page.structuredData` is the rendered JSON-LD <script> block(s), already
 * indented to sit in <head>. It is spliced, not built: this module composes
 * a page and does not decide what its structured data says. A record without
 * it renders a page with no JSON-LD rather than throwing, which is what lets
 * the template's own fixtures exercise the frame without a content model.
 *
 * Pure: same inputs, same bytes, every time.
 */
function pageHtml(page, partials) {
  const c = page.content;
  const f = page.format;

  const bodyAttrs =
    (page.bodyClass ? ` class="${page.bodyClass}"` : "") +
    ` data-guide-id="${page.id}"`;

  return (
    head.headHtml({
      consentNote: HEAD_OPTIONS.consentNote,
      meta: c.headMeta,
      social: c.headSocial,
      stylesheets: HEAD_OPTIONS.stylesheets,
      structuredData: page.structuredData || "",
      after: c.headStructuredData,
    }) +
    `  <body${bodyAttrs}>\n` +
    SKIP_LINK +
    "\n\n" +
    (f.headerMarkerIndented ? HEADER_MARKER_INDENT : "") +
    head.headerRegion(partials.header) +
    "\n\n" +
    MAIN_OPEN +
    (page.category ? breadcrumbHtml(page.category) : "") +
    c.hero +
    (page.roadmap ? roadmapContextHtml(page.roadmap) : "") +
    c.toc +
    c.article +
    (page.roadmap ? roadmapNavHtml(page.roadmap) : "") +
    "\n" +
    " ".repeat(f.primaryCloseIndent) +
    "</div>\n" +
    (f.railWrapped ? RAIL_WRAPPED : RAIL_INLINE) +
    MAIN_CLOSE +
    AFTER_MAIN +
    (page.toast ? TOAST + AFTER_MAIN : "") +
    head.footerRegion(partials.footer) +
    PAGE_CLOSE +
    (f.trailingNewline ? "\n" : "")
  );
}

module.exports = {
  pageHtml,
  HEAD_OPTIONS,
  parseContent,
  serializeContent,
  SLOTS,
  SLOT_KEYS,
  DOC_OPEN,
  HEAD_CONSENT,
  HEAD_ANALYTICS,
  HEAD_ASSETS,
  HEAD_CLOSE,
  SKIP_LINK,
  HEADER_START,
  HEADER_END,
  FOOTER_START,
  FOOTER_END,
  HEADER_MARKER_INDENT,
  MAIN_OPEN,
  RAIL_INLINE,
  RAIL_WRAPPED,
  MAIN_CLOSE,
  AFTER_MAIN,
  TOAST,
  PAGE_CLOSE,
};
