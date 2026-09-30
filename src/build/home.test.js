/**
 * home.test.js — the homepage renderers in src/build/home.js.
 *
 *     npm test
 *
 * Pins what the homepage below the hero promises, against the real content
 * model: every card is a real link to a built route, the counts come from
 * the data, the resource cards skip the pinned topics, the hero explore
 * strip links only built routes without duplicate tab stops,
 * and each tool card's heading color is readable on its pastel ground.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const home = require("./home.js");

const model = content.load(config);
const knownUrls = new Set(routes.build(model).map((r) => r.url));
const indexSource = fs.readFileSync(path.join(config.paths.root, "index.html"), "utf8");

test("tool cards: one real link per tool, live counts, no dead routes", () => {
  const html = home.toolCardsHtml(model, knownUrls);
  const hrefs = [...html.matchAll(/<a class="tool-card__link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(hrefs, home.HOME_TOOLS.map((t) => t.url));
  hrefs.forEach((href) => assert.ok(knownUrls.has(href), href));
  assert.strictEqual((html.match(/<h3 class="tool-card__title">/g) || []).length, hrefs.length);
  assert.match(html, new RegExp(`${model.colors.length} named colors across 12 families`));
  assert.match(html, new RegExp(`${model.palettes.length} palettes`));
  assert.match(html, new RegExp(`${model.guides.length} practical guides`));
  // The CTA line is decoration; the link's name is the title alone.
  (html.match(/<p class="tool-card__cta"[^>]*>/g) || []).forEach((tag) =>
    assert.match(tag, /aria-hidden="true"/),
  );
});

test("a tool card pointing at an unbuilt route fails the build", () => {
  assert.throws(() => home.toolCardsHtml(model, new Set()), /not in the route table/);
});

test("resource cards skip the pinned topics", () => {
  const skipped = home.RESOURCE_TOPICS_SKIPPED;
  const topics = home.resourceTopics(model.categories, model.guides, skipped);
  assert.ok(topics.length > 0);
  topics.forEach((t) => {
    assert.ok(!skipped.has(t.category.slug), `${t.category.slug} should be skipped`);
    assert.ok(t.guides > 0, `${t.category.slug} has no guides, so no page`);
  });
  // Most guides first, except the deprioritized topics, which close the list.
  const ranked = topics.filter((t) => !home.RESOURCE_TOPICS_LAST.has(t.category.slug));
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].guides >= ranked[i].guides);
  }
  topics.slice(ranked.length).forEach((t) =>
    assert.ok(home.RESOURCE_TOPICS_LAST.has(t.category.slug), `${t.category.slug} is out of place`),
  );
  assert.deepStrictEqual(
    topics.map((t) => t.category.slug),
    ["mobile", "web", "systems", "motion", "adobe-xd"],
  );

  const { html, count } = home.resourceCardsHtml(topics, knownUrls);
  assert.strictEqual(count, topics.length + 3, "topics plus Free Fonts, Icon Packs and About");
  const hrefs = [...html.matchAll(/<a class="resource-card__link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(hrefs[hrefs.length - 1], home.HOME_ABOUT.url);
  assert.strictEqual(hrefs[0], "/fonts/", "Free Fonts opens the section");
  assert.deepStrictEqual(
    hrefs,
    ["/fonts/", "/icons/", "/category/mobile", "/category/web", "/category/systems", "/category/motion", "/category/adobe-xd", "/about"],
  );
  assert.ok(html.includes('<li class="resource-card"><h3 class="resource-card__title"><a class="resource-card__link" href="/fonts/">Free Fonts</a></h3>'));
  // Icon Packs is ONE card in the same card system, straight after Free Fonts — not a card per pack.
  assert.ok(html.includes('<li class="resource-card"><h3 class="resource-card__title"><a class="resource-card__link" href="/icons/">Icon Packs</a></h3><p class="resource-card__desc">Browse outline, solid, duotone, and 3D icon packs for web and mobile app design.</p></li>'));
  assert.ok(!/\/icons\/[a-z0-9-]+(\.html)?"/.test(html), "no per-pack cards on Home");
  hrefs.forEach((href) => assert.ok(knownUrls.has(href), href));
});

test("Home has no standalone Icon Packs section: one resources heading, Icon Packs inside it", () => {
  assert.ok(!indexSource.includes("HOME_ICON_PACKS"), "the standalone section's markers are gone");
  assert.ok(!/<h2[^>]*>\s*Icon Packs\s*<\/h2>/i.test(indexSource), "no Icon Packs heading");
  assert.strictEqual((indexSource.match(/>More useful resources</g) || []).length, 1);
  assert.strictEqual(home.iconPacksHtml, undefined, "the per-pack renderer is gone");
});

// ---- hero explore strip: static markup in index.html ----

test("explore strip: real routes, one focusable list per row, identical loop copies", () => {
  const nav = /<nav class="explore[^"]*"[^>]*>([\s\S]*?)<\/nav>/.exec(indexSource);
  assert.ok(nav, "index.html has the explore strip");
  assert.match(nav[0], /aria-label="Explore BPOZZ"/);
  const rows = [...nav[1].matchAll(/<div class="explore__row [^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.strictEqual(rows.length, 2);
  const hrefsOf = (list) => [...list.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const expected = [
    ["/colors/", "/palettes/", "/image-picker/", "/fonts/", "/icons/", "/guides/", "/roadmap", "/search"],
    ["/category/typography", "/category/color-theory", "/category/web", "/category/mobile",
      "/category/systems", "/category/accessibility", "/category/motion", "/category/figma"],
  ];
  rows.forEach((row, i) => {
    const lists = [...row.matchAll(/<ul ([^>]*)>([\s\S]*?)<\/ul>/g)];
    assert.strictEqual(lists.length, 3, "a real list plus two loop copies");
    const [real, ...copies] = lists;
    assert.match(real[1], /aria-label="[^"]+"/);
    assert.doesNotMatch(real[2], /tabindex/);
    assert.deepStrictEqual(hrefsOf(real[2]), expected[i]);
    hrefsOf(real[2]).forEach((href) => assert.ok(knownUrls.has(href), `${href} is not a built route`));
    copies.forEach((copy) => {
      assert.match(copy[1], /aria-hidden="true"/);
      assert.match(copy[1], /\binert\b/);
      // Same markup as the real list, apart from each link leaving the tab order.
      assert.strictEqual(copy[2].replace(/ tabindex="-1"/g, ""), real[2]);
      assert.strictEqual((copy[2].match(/ tabindex="-1"/g) || []).length, expected[i].length);
    });
  });
});

test("a resource-types.json home block is refused, not silently ignored", () => {
  assert.doesNotThrow(() => home.assertNoHomeBlocks(model.resourceTypes));
  assert.throws(
    () => home.assertNoHomeBlocks([{ type: "guide", home: { order: 0, limit: 8, sort: "roadmap" } }]),
    /set "home": null/,
  );
});

// ---- tool card tones: heading ink must pass WCAG AA on both grounds ----

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("every tool tone in home.css has an AA-readable heading color", () => {
  const css = fs.readFileSync(path.join(config.paths.root, "src/styles/home.css"), "utf8");
  const tones = new Set(home.HOME_TOOLS.map((t) => t.tone));
  tones.forEach((tone) => {
    const block = new RegExp(`\\.tool-card--${tone} \\{([^}]*)\\}`).exec(css);
    assert.ok(block, `home.css has no .tool-card--${tone}`);
    const v = (name) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block[1])[1];
    for (const ground of [v("card-bg"), v("card-bg-hover")]) {
      const ratio = contrast(v("card-ink"), ground);
      assert.ok(ratio >= 4.5, `${tone}: ${v("card-ink")} on ${ground} is ${ratio.toFixed(2)}:1`);
      // Description text (#273142) on the same ground.
      assert.ok(contrast("#273142", ground) >= 7, `${tone}: description contrast`);
    }
  });
});
