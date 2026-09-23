/**
 * search.test.js — /search must reach every palette.
 *
 *     npm test
 *
 * THE REGRESSION THIS PINS DOWN
 *
 * /search matches against content-index.json, and that index used to carry
 * only the 40 palettes with a palettes-meta.json entry (p001–p040). Every
 * palette after that — 560 of the 600 — could not be found by any query.
 *
 * HOW IT IS TESTED
 *
 * Not against a re-implementation. initSearchPage() is lifted verbatim out of
 * src/client/search.js (it is one fragment of /app.js, so there is nothing
 * to require) and run in a vm against a minimal stub DOM, with fetch()
 * answering from the index the build's own `data` stage produces from the
 * real palettes-data.json. Each case then reads the rendered result grid, so
 * matching, scoring, filtering and card rendering are all the shipped code.
 *
 * The queries are taken from the data at test time — a real colour name, a
 * real HEX — so they follow the data rather than hard-coding it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const config = require("../../site.config.js");
const content = require("../build/content.js");
const BpozzHtml = require("../shared/html.js");

const model = content.load(config);
const INDEX = content.buildContentIndex(model, config).records;
const CATEGORIES = JSON.parse(fs.readFileSync(config.paths.content.categories, "utf8"));
const PALETTES = model.palettes;

// initSearchPage(), exactly as it ships.
const SOURCE = fs.readFileSync(path.join(__dirname, "search.js"), "utf8");
const START = SOURCE.indexOf("(function initSearchPage() {");
const END = SOURCE.lastIndexOf("})();") + "})();".length;
assert.ok(START !== -1 && END > START, "could not find initSearchPage() in search.js");
const INIT_SEARCH_PAGE = SOURCE.slice(START, END);

function element() {
  const attrs = {};
  return {
    textContent: "",
    innerHTML: "",
    hidden: false,
    value: "all",
    setAttribute: (k, v) => (attrs[k] = String(v)),
    removeAttribute: (k) => delete attrs[k],
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: () => {},
    appendChild: () => {},
    querySelectorAll: () => [],
  };
}

/** Runs a search for `query` and resolves with the rendered page state. */
async function search(query) {
  const els = {};
  [
    "search-grid-root",
    "search-heading",
    "search-dek",
    "search-results-count",
    "search-empty-state",
    "search-empty-query",
    "search-filters",
    "search-type-tabs",
    "search-category-select",
  ].forEach((id) => (els[id] = element()));

  const context = {
    URLSearchParams,
    console,
    Promise,
    escapeHtml: BpozzHtml.escapeHtml,
    thumbHtml: () => '<div class="card-thumb"></div>',
    location: { search: "?s=" + encodeURIComponent(query), pathname: "/search", protocol: "http:" },
    history: { replaceState: () => {} },
    document: {
      title: "",
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => [],
      createElement: () => element(),
    },
    fetch: (url) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url === "/content-index.json" ? INDEX : url === "/categories.json" ? CATEGORIES : null,
          ),
      }),
  };
  vm.runInNewContext(INIT_SEARCH_PAGE, context);
  await new Promise((resolve) => setImmediate(resolve)); // let the fetches settle

  const grid = els["search-grid-root"].innerHTML;
  const ids = [...grid.matchAll(/href="\/palettes#(p\d+)"/g)].map((m) => m[1]);
  return {
    ids,
    count: els["search-results-count"].textContent,
    empty: els["search-empty-state"].getAttribute("data-visible") === "true",
  };
}

const byId = (id) => PALETTES.find((p) => p.id === id);

// A colour name from `id` that is rare in the data, so the palette is
// expected in a short result list rather than buried in hundreds.
function distinctiveName(id) {
  const counts = new Map();
  PALETTES.forEach((p) => p.names.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1)));
  return byId(id)
    .names.slice()
    .sort((a, b) => counts.get(a) - counts.get(b))[0];
}

// ---------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------

test("the search index carries every palette, p001 to the last", () => {
  const slugs = INDEX.filter((r) => r.type === "palette").map((r) => r.slug);
  assert.deepStrictEqual(slugs, PALETTES.map((p) => p.id));
  assert.strictEqual(slugs.length, config.palettes.count);
});

test("the stub DOM runs the real search: an original palette is found by its title", async () => {
  const title = model.palettes[0].meta.title; // p001, "Starless Frost"
  const { ids, empty } = await search(title);
  assert.strictEqual(ids[0], "p001");
  assert.ok(!empty);
});

for (const id of ["p100", "p200", "p300", "p301", "p400", "p450", "p500", "p600"]) {
  test(`${id} is found by one of its colour names`, async () => {
    const name = distinctiveName(id);
    const { ids } = await search(name);
    assert.ok(ids.includes(id), `searching "${name}" did not return ${id} (got ${ids.slice(0, 10)})`);
  });
}

test("a palette is found by its id", async () => {
  for (const id of ["p041", "p450", config.palettes.lastId]) {
    const { ids } = await search(id);
    assert.ok(ids.includes(id), `searching "${id}" did not return it`);
  }
});

// ---------------------------------------------------------------------
// HEX
// ---------------------------------------------------------------------

test("an exact HEX from a new palette returns that palette and only palettes carrying it", async () => {
  const p = byId("p512");
  const hex = p.colors[2];
  for (const q of [hex, hex.toLowerCase(), hex.slice(1)]) {
    const { ids } = await search(q);
    assert.ok(ids.includes("p512"), `"${q}" did not return p512`);
    ids.forEach((id) =>
      assert.ok(byId(id).colors.includes(hex), `"${q}" returned ${id}, which does not carry ${hex}`),
    );
  }
});

test("an exact HEX from an original palette returns it too", async () => {
  const hex = byId("p001").colors[2];
  const { ids } = await search(hex);
  assert.ok(ids.includes("p001"));
});

test("HEX matching is exact: a partial hex or a hex-like word adds nothing", async () => {
  const hex = byId("p512").colors[2];
  assert.ok(!(await search(hex.slice(0, 5))).ids.includes("p512"), "partial hex matched");
  // "#abcdef" is a well-formed hex no palette uses.
  assert.ok(!PALETTES.some((p) => p.colors.includes("#ABCDEF")));
  assert.deepStrictEqual((await search("#abcdef")).ids, []);
});

// ---------------------------------------------------------------------
// the empty and no-match states are unchanged
// ---------------------------------------------------------------------

test("a query that matches nothing shows the empty state", async () => {
  const { ids, count, empty } = await search("zzqxnomatchzz");
  assert.deepStrictEqual(ids, []);
  assert.strictEqual(count, "");
  assert.ok(empty);
});

test("an empty query renders no results and no count", async () => {
  const { ids, count } = await search("");
  assert.deepStrictEqual(ids, []);
  assert.strictEqual(count, "");
});
