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

test("icon packs: one card per pack from the data, linking its page, plus the Explore link", () => {
  const { html, count } = home.iconPacksHtml(model, config, knownUrls);
  assert.strictEqual(count, model.iconPacks.length);
  const hrefs = [...html.matchAll(/<a class="resource-card__link" href="([^"]+)">([^<]+)<\/a>/g)];
  assert.deepStrictEqual(
    hrefs.map((m) => [m[1], m[2]]),
    model.iconPacks.map((p) => [`/icons/${p.id}.html`, p.name]),
  );
  hrefs.forEach((m) => assert.ok(knownUrls.has(m[1]), m[1]));
  model.iconPacks.forEach((p) => assert.ok(html.includes(`${p.iconCount} icons</p>`), `${p.id} count`));
  assert.ok(html.includes('<a class="home-more__link" href="/icons/">Explore Icon Packs'));
  // previews are the packs' own published files, never copies
  [...html.matchAll(/<img src="([^"]+)"/g)].forEach((m) => {
    assert.match(m[1], /^\/icons\/[a-z0-9-]+\/(svg|png)\/[a-z0-9-]+\.(svg|png)$/);
    assert.ok(fs.existsSync(path.join(config.paths.content.iconFiles, m[1].replace(/^\/icons\//, ""))), m[1]);
  });
  (html.match(/<p class="pack-card__icons[^>]*>/g) || []).forEach((tag) => assert.match(tag, /aria-hidden="true"/));
  assert.ok(indexSource.includes("<!--HOME_ICON_PACKS_START--><!--HOME_ICON_PACKS_END-->"));
});

test("an icon pack card pointing at an unbuilt route fails the build", () => {
  assert.throws(() => home.iconPacksHtml(model, config, new Set()), /not in the route table/);
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
  assert.strictEqual(count, topics.length + 2, "topics plus Free Fonts plus About");
  const hrefs = [...html.matchAll(/<a class="resource-card__link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(hrefs[hrefs.length - 1], home.HOME_ABOUT.url);
  assert.strictEqual(hrefs[0], "/fonts/", "Free Fonts opens the section");
  assert.deepStrictEqual(
    hrefs,
    ["/fonts/", "/category/mobile", "/category/web", "/category/systems", "/category/motion", "/category/adobe-xd", "/about.html"],
  );
  assert.ok(html.includes('<li class="resource-card"><h3 class="resource-card__title"><a class="resource-card__link" href="/fonts/">Free Fonts</a></h3>'));
  hrefs.forEach((href) => assert.ok(knownUrls.has(href), href));
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
    ["/colors/", "/palettes/", "/image-picker/", "/fonts/", "/guides/", "/roadmap.html", "/search.html"],
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
