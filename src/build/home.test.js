/**
 * home.test.js — the homepage renderers in src/build/home.js.
 *
 *     npm test
 *
 * Pins the redesign's structural promises against the real content model:
 * the homepage is a palette workspace, a toolkit index and editorial lists,
 * never a card grid; its counts come from the data; and every link it
 * writes resolves to a built route.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const home = require("./home.js");

const model = content.load(config);
const knownUrls = new Set(routes.build(model).map((r) => r.url));
const contentIndex = content.buildContentIndex(model, config).records;

function context() {
  return {
    categoryLabels: home.loadCategoryLabels(model.categories),
    guideTopics: home.loadGuideCategories(model.categories, model.guides).listed,
    guidesById: new Map(model.guides.map((g) => [g.id, g])),
    roadmapRank: new Map(home.roadmapOrder(model.guides).map((g, i) => [g.id, i])),
  };
}

test("the workspace renders one column per seed color, values included", () => {
  const ws = home.buildWorkspace(home.WORKSPACE_SEED);
  assert.strictEqual(ws.count, 5);
  assert.strictEqual((ws.columns.match(/<li class="palette-color"/g) || []).length, 5);
  assert.match(ws.columns, /data-field="hex">#2563EB</);
  assert.match(ws.columns, /data-field="rgb">37 99 235</);
  assert.match(ws.columns, /data-field="contrast">White 5\.2:1 AA</);

  // JS-only controls ship hidden, so the no-JS page has no dead buttons.
  const enhanced = ws.columns.match(/<(button|div) [^>]*data-enhanced[^>]*>/g) || [];
  assert.strictEqual(enhanced.length, 10);
  enhanced.forEach((tag) => assert.match(tag, /\bhidden\b/, tag));

  // Every button has an accessible name.
  (ws.columns.match(/<button[^>]*>/g) || []).forEach((tag) =>
    assert.match(tag, /aria-label="[^"]+"/, tag),
  );
});

test("toolkit rows carry live counts and resolve to real routes", () => {
  const entries = home.toolkitEntries(model);
  assert.deepStrictEqual(
    entries.map((e) => e.url),
    ["/colors/", "/palettes/", "/image-picker/", "/guides/"],
  );
  assert.strictEqual(entries[0].meta, `${model.colors.length} colors · 12 families`);
  assert.ok(entries[3].meta.startsWith(`${model.guides.length} guides`));

  const html = home.toolkitHtml(entries, knownUrls);
  assert.strictEqual((html.match(/<h3 class="home-index__title">/g) || []).length, 4);
  assert.throws(
    () => home.toolkitHtml([{ ...entries[0], url: "/nowhere/" }], knownUrls),
    /not in the route table/,
  );
});

test("resource sections are editorial lists, not card grids", () => {
  const registry = home.loadResourceTypes(model.resourceTypes);
  const sections = home.buildResourceSections(registry, contentIndex, context());
  const html = sections.html;

  assert.strictEqual(sections.count, 2);
  assert.doesNotMatch(html, /content-card|card-thumb|class="grid"/);
  assert.strictEqual((html.match(/<h2 /g) || []).length, 2);

  const limit = (type) => registry.find((r) => r.type === type).home.limit;
  assert.strictEqual((html.match(/class="home-row home-guide"/g) || []).length, limit("guide"));
  assert.strictEqual(
    (html.match(/class="home-row home-palette"/g) || []).length,
    limit("palette"),
  );

  // Guides keep roadmap order: the first guide row is roadmap step 1.
  const first = home.roadmapOrder(model.guides)[0];
  const rows = html.split('class="home-row home-guide"');
  assert.ok(rows[1].includes(`href="/guide/${first.id}"`));

  // Every guide and category link points at a built page.
  const links = [...html.matchAll(/href="(\/(?:guide|category)\/[^"#]+)"/g)].map((m) => m[1]);
  assert.ok(links.length > limit("guide"));
  links.forEach((href) => assert.ok(knownUrls.has(href), href));
});
