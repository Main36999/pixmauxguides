/**
 * head.test.js — the Phase 4 Step 8 shared <head> consolidation.
 *
 *     npm test
 *
 * THE RISK THIS COVERS
 *
 * Step 8 took the <head> frame out of the two modules that write pages from
 * scratch — src/build/guide-template.js and src/build/categories.js — and put
 * it in src/build/head.js. Like the Step 4 template migration before it, that
 * is only a consolidation if the pages it renders are indistinguishable from
 * the pages it replaced.
 *
 * Three gates already cover the OUTPUT: the build's `verify` stage hashes
 * every file in dist/, scripts/qa/check-baseline.js hashes all 41 pages, and
 * guide-template.test.js diffs each rendered guide against its committed file
 * byte for byte. None of them covers the CLAIM: that the bands really are one
 * shared frame rather than a shared frame plus a private copy somewhere.
 * A future edit could reintroduce a literal <head> band in either writer and
 * every one of those gates would stay green, because the bytes would not have
 * moved — which is exactly the state Step 8 found the repo in.
 *
 * So this file asserts the consolidation itself, in three directions:
 *
 *   1. the shared bands are present, unmodified, on every PUBLISHED page —
 *      including the hand-authored ones no builder writes, whose copies
 *      Step 8 deliberately did not centralize (see src/build/head.js). Those
 *      copies still exist; this is what stops them drifting while they do.
 *   2. neither writer carries a private copy of a band it should be taking
 *      from src/build/head.js.
 *   3. the two documented head variations are still exactly two, and are
 *      still the ones the category and guide pages actually ship.
 *
 * WHAT THIS FILE DOES NOT ASSERT
 *
 * Anything about what the bands SAY. The tag IDs, the consent defaults, the
 * font URL and the canonical/social values are Step 7's and the content
 * model's; this file only asserts that one text is shared, not that the text
 * is right.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const head = require("./head.js");
const template = require("./guide-template.js");
const categories = require("./categories.js");

const fonts = require("./fonts.js");
const icons = require("./icons.js");

const model = content.load(config);
const routeTable = routes.build(model);

/**
 * Every published page, keyed by its route file. Committed pages are read
 * from the repo root; routes marked `generated` have no committed file (see
 * src/build/routes.js), so their builder renders them in memory instead.
 */
function committedPages() {
  const generated = new Map(
    fonts
      .build({ config, model })
      .pages.concat(icons.build({ config, model }).pages)
      .map((p) => [p.file, p.html]),
  );
  return routeTable.map((r) => ({
    file: r.file.split(path.sep).join("/"),
    url: r.url,
    text: r.generated
      ? generated.get(r.file)
      : fs.readFileSync(path.join(config.paths.root, r.file), "utf8"),
  }));
}

const pages = committedPages();

/**
 * The bands that are byte-identical on every page of the site, with no
 * variation anywhere. These are the ones the duplication was made of.
 */
const UNIVERSAL_BANDS = {
  DOC_OPEN: head.DOC_OPEN,
  COOKIEBOT: head.COOKIEBOT,
  CONSENT_DEFAULT: head.CONSENT_DEFAULT,
  CHARSET: head.CHARSET,
  HEAD_ANALYTICS: head.HEAD_ANALYTICS,
  THEME_AND_ICONS: head.THEME_AND_ICONS,
  FONTS: head.FONTS,
  HEAD_CLOSE: head.HEAD_CLOSE,
};

// ---------------------------------------------------------------------
// 1. the shared frame is what every published page carries
// ---------------------------------------------------------------------

// The count is read from site.config.js rather than written into the title.
// It said "all 41" until Step 10 added /colors, at which point the title and
// the assertion disagreed and only the assertion was right.
test("every published page carries the shared head bands, byte for byte", () => {
  assert.strictEqual(
    pages.length,
    config.expected.htmlPages,
    `${pages.length} routed pages, expected ${config.expected.htmlPages}`,
  );

  pages.forEach((page) => {
    Object.entries(UNIVERSAL_BANDS).forEach(([name, band]) => {
      assert.ok(
        page.text.includes(band),
        `${page.file} does not carry the shared ${name} band exactly — ` +
          `src/build/head.js is meant to be the one copy of it`,
      );
    });
  });
});

test("every page below the site root loads /styles.css site-root-relative", () => {
  // The failure docs/archive/_TEMPLATE.html warns about: a page in a
  // subdirectory that loads "styles.css" resolves it against its own
  // directory and loses every stylesheet. Both writers take this link from
  // head.stylesheetLink, which is site-root by construction.
  //
  // RECORDED, NOT FIXED: the seven hand-authored pages AT the site root
  // (index, about, contact, privacy, terms, roadmap, search) carry the
  // relative spelling `href="styles.css"`. At depth 0 the two resolve to the
  // same URL, so it is correct on those pages and wrong on no page — but it
  // is a second spelling, and it is one of the reasons those pages' <head>
  // is not generated yet. Normalizing it changes their deployed bytes, which
  // is not this step's to change.
  const siteRoot = head.stylesheetLink(head.STYLESHEETS.site);
  const relative = head.stylesheetLink("styles.css");

  pages.forEach((page) => {
    const depth = page.file.split("/").length - 1;
    if (depth > 0) {
      assert.ok(
        page.text.includes(siteRoot),
        `${page.file} is ${depth} level(s) deep and does not carry ` +
          `${JSON.stringify(siteRoot.trim())} — a relative href there loses ` +
          `every stylesheet`,
      );
    } else {
      assert.ok(
        page.text.includes(siteRoot) || page.text.includes(relative),
        `${page.file} loads no stylesheet at all`,
      );
    }
  });
});

test("the four marker pairs are one spelling across writers and patchers", () => {
  // guides.assertMarkersAgree() runs this on every build; asserting it here
  // as well means a broken spelling fails `npm test` too, and names which of
  // the two writers moved.
  require("./guides.js").assertMarkersAgree();

  pages.forEach((page) => {
    [
      ["HEADER_START", head.HEADER_START],
      ["HEADER_END", head.HEADER_END],
      ["FOOTER_START", head.FOOTER_START],
      ["FOOTER_END", head.FOOTER_END],
    ].forEach(([name, marker]) => {
      assert.strictEqual(
        page.text.split(marker).length - 1,
        1,
        `${page.file} has ${page.text.split(marker).length - 1} ${name} ` +
          `markers, expected exactly 1`,
      );
    });
  });
});

// ---------------------------------------------------------------------
// 2. neither writer keeps a private copy
// ---------------------------------------------------------------------

test("neither page writer declares its own copy of a shared head band", () => {
  // The literal text of each band, searched for in the writers' SOURCE. This
  // is the assertion the byte-level gates structurally cannot make: a second
  // copy of a band produces identical output and would pass all of them.
  //
  // src/build/head.js is excluded, being the one place the bands are allowed
  // to be spelled out.
  const writers = [
    "src/build/guide-template.js",
    "src/build/categories.js",
    "src/build/home.js",
    "src/build/header.js",
    "src/build/footer.js",
  ];

  // A band's first two lines are enough to catch a re-introduced copy, and
  // short enough to survive a reflow of the lines below them.
  const fingerprints = Object.entries(UNIVERSAL_BANDS)
    .filter(([name]) => name !== "DOC_OPEN" && name !== "HEAD_CLOSE")
    .map(([name, band]) => [name, band.split("\n").slice(0, 2).join("\n")]);

  writers.forEach((rel) => {
    const src = fs.readFileSync(path.join(config.paths.root, rel), "utf8");
    fingerprints.forEach(([name, fingerprint]) => {
      assert.ok(
        !src.includes(fingerprint),
        `${rel} carries its own copy of the ${name} band — it belongs in ` +
          `src/build/head.js, which this module should require instead`,
      );
    });
  });
});

// ---------------------------------------------------------------------
// 3. the variations are exactly the two that are documented
// ---------------------------------------------------------------------

test("the head frame has exactly two documented variations", () => {
  assert.deepStrictEqual(
    Object.keys(template.HEAD_OPTIONS).sort(),
    ["consentNote", "stylesheets"],
    "the guide pages' head takes an option src/build/head.js does not document",
  );
  assert.deepStrictEqual(
    Object.keys(categories.HEAD_OPTIONS).sort(),
    ["consentNote", "stylesheets"],
    "the category pages' head takes an option src/build/head.js does not document",
  );

  assert.strictEqual(template.HEAD_OPTIONS.consentNote, true);
  assert.strictEqual(categories.HEAD_OPTIONS.consentNote, false);
  assert.deepStrictEqual(template.HEAD_OPTIONS.stylesheets, [
    head.STYLESHEETS.site,
    head.STYLESHEETS.guideArticle,
  ]);
  assert.deepStrictEqual(categories.HEAD_OPTIONS.stylesheets, [
    head.STYLESHEETS.site,
  ]);
});

test("the two variations are the ones the published pages actually ship", () => {
  const guidePages = pages.filter((p) => p.file.startsWith("guide/"));
  const categoryPages = pages.filter((p) => p.file.startsWith("category/"));
  assert.strictEqual(guidePages.length, 22);
  assert.strictEqual(categoryPages.length, 10);

  const guideArticle = head.stylesheetLink(head.STYLESHEETS.guideArticle);

  guidePages.forEach((page) => {
    assert.ok(
      page.text.includes(head.CONSENT_MODE_NOTE),
      `${page.file} lost the Consent Mode v2 note its HEAD_OPTIONS declares`,
    );
    assert.ok(
      page.text.includes(guideArticle),
      `${page.file} does not load /guide-article.css`,
    );
  });

  categoryPages.forEach((page) => {
    assert.ok(
      !page.text.includes(head.CONSENT_MODE_NOTE),
      `${page.file} now carries the Consent Mode v2 note — its HEAD_OPTIONS ` +
        `says it does not, so one of the two moved`,
    );
    assert.ok(
      !page.text.includes(guideArticle),
      `${page.file} loads /guide-article.css, which a category archive has ` +
        `no .guide-article body for`,
    );
  });
});

// ---------------------------------------------------------------------
// the composer itself
// ---------------------------------------------------------------------

test("headHtml emits the bands in the one load-bearing order", () => {
  const html = head.headHtml({
    meta: "::META::\n",
    social: "::SOCIAL::\n",
    stylesheets: [head.STYLESHEETS.site],
    structuredData: "::JSONLD::",
    after: "::AFTER::",
  });

  const order = [
    head.DOC_OPEN,
    head.COOKIEBOT,
    head.CONSENT_MODE_NOTE,
    head.CONSENT_DEFAULT,
    head.CHARSET,
    "::META::",
    head.HEAD_ANALYTICS,
    "::SOCIAL::",
    head.THEME_AND_ICONS,
    head.FONTS,
    head.stylesheetLink(head.STYLESHEETS.site),
    "::JSONLD::",
    "::AFTER::",
    head.HEAD_CLOSE,
  ].map((band) => html.indexOf(band));

  order.forEach((at, i) =>
    assert.ok(at !== -1, `band ${i} is missing from the composed head`),
  );
  assert.deepStrictEqual(
    order,
    order.slice().sort((a, b) => a - b),
    "headHtml emitted the bands out of order — consent must precede gtag.js, " +
      "and structured data must come last",
  );
});

test("an omitted structuredData or after slot emits nothing at all", () => {
  const withSlots = head.headHtml({
    meta: "",
    social: "",
    stylesheets: [],
    structuredData: "X",
    after: "Y",
  });
  const without = head.headHtml({ meta: "", social: "", stylesheets: [] });

  assert.ok(withSlots.includes("X") && withSlots.includes("Y"));
  assert.strictEqual(
    without,
    withSlots.replace("X", "").replace("\nY", ""),
    "an empty slot left a separator behind",
  );
});

test("consentNote is the only thing that varies in the consent band", () => {
  const withNote = head.consentHtml(true);
  const withoutNote = head.consentHtml(false);
  assert.strictEqual(
    withNote.replace(head.CONSENT_MODE_NOTE, ""),
    withoutNote,
    "the two consent variants differ by more than the explanatory comment",
  );
});

test("the guide template re-exports the shared bands unchanged", () => {
  // src/build/guides.js and guide-template.test.js bind to these names. They
  // are the shared bands now; this asserts the re-export did not transform
  // them on the way through.
  assert.strictEqual(template.DOC_OPEN, head.DOC_OPEN);
  assert.strictEqual(template.HEAD_ANALYTICS, head.HEAD_ANALYTICS);
  assert.strictEqual(template.HEAD_CLOSE, head.HEAD_CLOSE);
  assert.strictEqual(template.PAGE_CLOSE, head.BODY_CLOSE);
  assert.strictEqual(
    template.HEAD_CONSENT,
    head.consentHtml(template.HEAD_OPTIONS.consentNote),
  );
  assert.strictEqual(
    template.HEAD_ASSETS,
    head.assetsHtml(template.HEAD_OPTIONS.stylesheets),
  );
});
