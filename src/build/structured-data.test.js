/**
 * structured-data.test.js — the Phase 4 Step 7 JSON-LD consolidation.
 *
 *     npm test
 *
 * THE RISK THIS COVERS
 *
 * Step 7 took the guide pages' JSON-LD out of 22 hand-written blocks and made
 * it derived output. The failure mode that replaces "22 pages drift apart" is
 * "one generator drifts away from the model", and it is quieter: a page still
 * builds, still renders, still looks right, and ships structured data that
 * disagrees with the page it describes or points at a URL the site does not
 * serve. Neither the build's `verify` stage nor the HTML checksum gate can
 * see that — both would happily approve a consistent lie.
 *
 * So these assert the three things the generated data claims:
 *
 *   1. every page carries exactly the blocks site.config.js says it does,
 *      in that order, and one @context per block;
 *   2. every URL in every block is an origin-absolute URL that resolves to a
 *      route in the table or to a file the build publishes — this is the
 *      assertion that would have caught /thumbnail_image/, the directory 19
 *      pages pointed their image at and which has never existed;
 *   3. every derived field still equals its source in the model, including
 *      the description, which must equal the page's own <meta name=
 *      "description"> byte for byte.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");
const structuredData = require("./structured-data.js");
const routes = require("./routes.js");

const model = content.load(config);
const pages = model.guidePages;
const guideById = new Map(model.guides.map((g) => [g.id, g]));
const categoryBySlug = new Map(model.categories.map((c) => [c.slug, c]));
const routeUrls = new Set(routes.build(model).map((r) => r.url));

/** Every JSON-LD block on one rendered guide page, parsed. */
function blocksOf(page) {
  const found = [
    ...page.structuredData.matchAll(
      /<script type="application\/ld\+json">\n([\s\S]*?)\n\s*<\/script>/g,
    ),
  ];
  return found.map((m) => JSON.parse(m[1]));
}

/**
 * Every string value anywhere in a block that looks like a URL, except
 * "@context": that is the vocabulary identifier, not a link to this site, and
 * schema.org is the only value it may ever hold.
 */
function urlsIn(node, acc = []) {
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node)) acc.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((v) => urlsIn(v, acc));
  } else if (node && typeof node === "object") {
    Object.entries(node).forEach(([key, v]) => {
      if (key !== "@context") urlsIn(v, acc);
    });
  }
  return acc;
}

// ---------------------------------------------------------------------
// 1. shape
// ---------------------------------------------------------------------

test("every guide page carries the blocks site.config.js names, in order", () => {
  assert.ok(pages.length > 0, "no guide pages loaded");
  pages.forEach((page) => {
    const blocks = blocksOf(page);
    assert.deepStrictEqual(
      blocks.map((b) => b["@type"]),
      config.jsonLd.guide,
      `guide/${page.id}.html does not carry jsonLd.guide's blocks in order`,
    );
    blocks.forEach((b) =>
      assert.strictEqual(
        b["@context"],
        "https://schema.org",
        `guide/${page.id}.html: a top-level block has no @context`,
      ),
    );
  });
});

test("every guide page's JSON-LD is byte-for-byte the same shape", () => {
  // The whole point of F2: one generator, so the KEY SET of each block is
  // identical across all 22 pages. Values differ; structure may not.
  const signature = (page) =>
    blocksOf(page)
      .map((b) => Object.keys(b).join(","))
      .join(" | ");
  const first = signature(pages[0]);
  pages.forEach((page) =>
    assert.strictEqual(
      signature(page),
      first,
      `guide/${page.id}.html has a different JSON-LD shape from guide/${pages[0].id}.html`,
    ),
  );
});

test("no nested node re-declares @context", () => {
  // A JSON-LD document declares its context once. The category pages' nested
  // `breadcrumb` is the one that tried to: see topLevel() in the module.
  const nested = (node, depth = 0) => {
    if (Array.isArray(node)) return node.some((v) => nested(v, depth));
    if (!node || typeof node !== "object") return false;
    if (depth > 0 && "@context" in node) return true;
    return Object.values(node).some((v) => nested(v, depth + 1));
  };
  pages.forEach((page) =>
    blocksOf(page).forEach((b) =>
      assert.ok(
        !nested(b),
        `guide/${page.id}.html has a nested @context inside its ${b["@type"]}`,
      ),
    ),
  );

  const category = structuredData.categoryJsonLd({
    label: "Spacing & Layout",
    description: "d",
    slug: "spacing",
    origin: config.origin,
  });
  assert.ok(!nested(category), "categoryJsonLd nests a second @context");
});

// ---------------------------------------------------------------------
// 2. URLs
// ---------------------------------------------------------------------

test("every URL in every guide block resolves to a route or a published file", () => {
  // "Published" is decided from the build's own publish tables — the same
  // PUBLISH_FILES / PUBLISH_DIRS the copy stage reads — mapped back to the
  // source file it would copy. That keeps the check independent of dist/,
  // which the build's approval gate deletes when it stops.
  const { PUBLISH_FILES, PUBLISH_DIRS, APP_BUNDLE } = require("./build.js");
  const root = config.paths.root;
  const distHas = (rel) => {
    if (rel === APP_BUNDLE.to) return true;
    if (PUBLISH_FILES.some((e) => e.to === rel && fs.existsSync(path.join(root, e.from)))) return true;
    return PUBLISH_DIRS.some(
      (e) => rel.startsWith(e.to + "/") && fs.statSync(path.join(root, e.from, rel.slice(e.to.length + 1)), { throwIfNoEntry: false })?.isFile(),
    );
  };
  // the resolver itself: it finds real published files and nothing else
  assert.ok(distHas("styles.css") && distHas("fonts/b612/OFL.txt"));
  assert.ok(!distHas("thumbnail_image_webp/no-such-thumbnail.webp") && !distHas("thumbnail_image_webp") && !distHas("src/build/build.js"));

  pages.forEach((page) => {
    blocksOf(page).forEach((block) => {
      urlsIn(block).forEach((url) => {
        assert.ok(
          url.startsWith(config.origin + "/"),
          `guide/${page.id}.html: ${url} is not under ${config.origin}`,
        );
        const rest = decodeURIComponent(url.slice(config.origin.length));
        if (routeUrls.has(rest)) return;
        assert.ok(
          distHas(rest.replace(/^\//, "")),
          `guide/${page.id}.html: ${url} is neither a route nor a file the build publishes ` +
            `(build.js PUBLISH_FILES / PUBLISH_DIRS)`,
        );
      });
    });
  });
});

test("a URL with a space is percent-encoded, not emitted raw", () => {
  // Nineteen thumbnails are named after their guide's title and carry spaces.
  // A raw space is not a valid URL and the pre-Step-7 pages emitted it.
  pages.forEach((page) =>
    blocksOf(page).forEach((block) =>
      urlsIn(block).forEach((url) =>
        assert.ok(
          !/\s/.test(url),
          `guide/${page.id}.html: ${JSON.stringify(url)} has raw whitespace`,
        ),
      ),
    ),
  );
});

test("absolute() refuses a path that is neither absolute nor site-root", () => {
  assert.throws(
    () => structuredData.absolute(config.origin, "assets/logo.png"),
    /neither absolute nor site-root/,
  );
  assert.strictEqual(
    structuredData.absolute(config.origin, "https://example.com/a.png"),
    "https://example.com/a.png",
  );
});

// ---------------------------------------------------------------------
// 3. derived values
// ---------------------------------------------------------------------

test("every derived field still equals its source in the content model", () => {
  pages.forEach((page) => {
    const guide = guideById.get(page.id);
    const category = categoryBySlug.get(guide.category);
    const article = blocksOf(page).find((b) => b["@type"] !== "BreadcrumbList");

    assert.strictEqual(article.headline, guide.title, `${page.id}: headline`);
    assert.strictEqual(
      article.articleSection,
      category.name,
      `${page.id}: articleSection`,
    );
    assert.strictEqual(
      article.timeRequired,
      `PT${guide.readTime}M`,
      `${page.id}: timeRequired`,
    );
    assert.strictEqual(
      article.proficiencyLevel.toLowerCase(),
      guide.level,
      `${page.id}: proficiencyLevel`,
    );
    assert.strictEqual(
      article.datePublished,
      page.datePublished,
      `${page.id}: datePublished`,
    );
    assert.strictEqual(
      article.mainEntityOfPage["@id"],
      `${config.origin}/guide/${guide.id}`,
      `${page.id}: mainEntityOfPage`,
    );
    assert.strictEqual(
      decodeURI(article.image),
      config.origin + guide.thumbnail,
      `${page.id}: image is not the guide's own thumbnail`,
    );
  });
});

test("the JSON-LD description is the page's own meta description", () => {
  pages.forEach((page) => {
    const article = blocksOf(page).find((b) => b["@type"] !== "BreadcrumbList");
    assert.strictEqual(
      article.description,
      content.metaDescriptionOf(page.content.headMeta, page.id),
      `guide/${page.id}.html describes itself differently in its head and ` +
        `in its structured data`,
    );
  });
});

test("the breadcrumb trail ends at the page it is on", () => {
  pages.forEach((page) => {
    const crumbs = blocksOf(page).find((b) => b["@type"] === "BreadcrumbList");
    const last = crumbs.itemListElement[crumbs.itemListElement.length - 1];
    assert.strictEqual(last.position, crumbs.itemListElement.length);
    assert.strictEqual(last.name, guideById.get(page.id).title);
    assert.strictEqual(last.item, `${config.origin}/guide/${page.id}`);
    crumbs.itemListElement.forEach((item, i) =>
      assert.strictEqual(item.position, i + 1, `${page.id}: breadcrumb order`),
    );
  });
});

// ---------------------------------------------------------------------
// the config is load-bearing
// ---------------------------------------------------------------------

test("a block type site.config.js names but this module cannot build fails loudly", () => {
  assert.throws(
    () =>
      structuredData.guideJsonLd({
        guide: model.guides[0],
        category: model.categories[0],
        page: pages[0],
        description: "d",
        origin: config.origin,
        types: ["FAQPage"],
      }),
    /no builder for/,
  );
  assert.throws(
    () => structuredData.guideJsonLd({ types: [] }),
    /at least one block type/,
  );
});

test("a guide page with no meta description fails the load", () => {
  assert.throws(
    () => content.metaDescriptionOf("<title>x</title>", "fixture"),
    /fixture: its HEAD_META slot has no <meta name="description">/,
  );
});

test("named entities in a meta description are decoded, not passed through", () => {
  assert.strictEqual(
    content.metaDescriptionOf(
      '<meta name="description" content="a &quot;b&quot; &amp; c" />',
      "fixture",
    ),
    'a "b" & c',
  );
  // &amp;quot; is the literal text "&quot;", not a quote character.
  assert.strictEqual(
    content.metaDescriptionOf(
      '<meta name="description" content="&amp;quot;" />',
      "fixture",
    ),
    "&quot;",
  );
});
