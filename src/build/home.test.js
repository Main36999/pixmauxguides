/**
 * home.test.js — the homepage renderers in src/build/home.js.
 *
 *     npm test
 *
 * Pins what the homepage below the hero promises, against the real content
 * model: every card is a real link to a built route, the counts come from
 * the data, the resource cards never repeat a topic the hero already links,
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

test("resource cards skip the topics the hero already links", () => {
  const heroSlugs = home.linkedCategorySlugs(indexSource);
  assert.ok(heroSlugs.size > 0, "the hero's trending row links category pages");
  const topics = home.resourceTopics(model.categories, model.guides, heroSlugs);
  assert.ok(topics.length > 0);
  topics.forEach((t) => {
    assert.ok(!heroSlugs.has(t.category.slug), `${t.category.slug} repeats a hero link`);
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
  assert.strictEqual(count, topics.length + 1, "topics plus About");
  const hrefs = [...html.matchAll(/<a class="resource-card__link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(hrefs[hrefs.length - 1], home.HOME_ABOUT.url);
  hrefs.forEach((href) => assert.ok(knownUrls.has(href), href));
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
