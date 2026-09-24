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

/**
 * Runs a search for `query` and resolves with the rendered page state.
 * `extra` is appended to the query string as-is ("&type=palette"); a
 * `rawSearch` replaces the whole query string, for input a browser could
 * hand the page but encodeURIComponent never produces.
 */
async function search(query, { extra = "", rawSearch } = {}) {
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
    location: {
      search: rawSearch != null ? rawSearch : "?s=" + encodeURIComponent(query) + extra,
      pathname: "/search",
      protocol: "http:",
    },
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
  const hrefs = [...grid.matchAll(/class="card-link" href="([^"]*)"/g)].map((m) => m[1]);
  return {
    ids,
    hrefs,
    grid,
    heading: els["search-heading"].textContent,
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

// ---------------------------------------------------------------------
// colour names reach the original, hand-titled palettes too
// ---------------------------------------------------------------------

test('"Ultraviolet" (a colour in p001) finds p001', async () => {
  assert.ok(byId("p001").names.includes("Ultraviolet"), "fixture assumption: p001 has Ultraviolet");
  const { ids } = await search("Ultraviolet");
  assert.ok(ids.includes("p001"), `got ${ids.slice(0, 10)}`);
});

for (const id of ["p017", "p040"]) {
  test(`an original palette, ${id}, is found by one of its colour names`, async () => {
    const name = distinctiveName(id);
    const { ids } = await search(name);
    assert.ok(ids.includes(id), `searching "${name}" did not return ${id} (got ${ids.slice(0, 10)})`);
  });
}

test("every one of the 600 index records carries all of its palette's colour-name words", () => {
  const records = new Map(INDEX.filter((r) => r.type === "palette").map((r) => [r.slug, r]));
  PALETTES.forEach((p) => {
    const words = new Set(records.get(p.id).searchText.split(" "));
    p.names.forEach((name) =>
      name
        .toLowerCase()
        .split(/\s+/)
        .forEach((w) => assert.ok(words.has(w), `${p.id} searchText is missing "${w}" (${name})`)),
    );
  });
});

test("the original palettes are still found by their title", async () => {
  const p = model.palettes[16]; // p017
  const { ids } = await search(p.meta.title);
  assert.strictEqual(ids[0], p.id);
});

test("a palette is found by its id", async () => {
  for (const id of ["p001", "p040", "p041", "p450", config.palettes.lastId]) {
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
  const { ids, empty } = await search("zzqxnomatchzz");
  assert.deepStrictEqual(ids, []);
  assert.ok(empty);
});

test("zero results are announced through the role=status count line", async () => {
  // The empty-state panel is not a live region; the count line is. It used to
  // be blanked on zero results, so a screen reader heard nothing at all.
  const { count } = await search("zzqxnomatchzz");
  assert.strictEqual(count, '0 Results for "zzqxnomatchzz"');
  const html = fs.readFileSync(path.join(config.paths.root, "search.html"), "utf8");
  assert.match(html, /<p[^>]*id="search-results-count"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /<form[^>]*role="search"/);
  assert.match(html, /<label for="header-search-input"[^>]*>Search BPOZZ<\/label>/);
  assert.match(html, /role="group"\s+aria-label="Filter by type"/);
  assert.match(html, /<label for="search-category-select"/);
});

test("an empty query renders no results and no count", async () => {
  const { ids, count } = await search("");
  assert.deepStrictEqual(ids, []);
  assert.strictEqual(count, "");
});

// ---------------------------------------------------------------------
// relevance: blanket categories, colour names, whole words, ids
// ---------------------------------------------------------------------

const RECORD = new Map(INDEX.map((r) => [r.slug, r]));
const lower = (s) => String(s).toLowerCase();

/** The palettes carrying a colour named exactly `name`, in data order. */
const holdersOf = (name) =>
  PALETTES.filter((p) => p.names.some((n) => lower(n) === lower(name))).map((p) => p.id);

/** Does `term` occur as a whole word in this palette's title, colour names or tags? */
function wholeWordIn(id, term) {
  const r = RECORD.get(id);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term}($|[^\\p{L}\\p{N}])`, "iu");
  return [r.title, ...r.colorNames, ...r.tags].some((text) => re.test(text));
}

/** Every id satisfying `pred` comes before every id that does not. */
function assertGroupedFirst(ids, pred, label) {
  const firstMiss = ids.findIndex((id) => !pred(id));
  if (firstMiss === -1) return;
  const lateHit = ids.slice(firstMiss).find(pred);
  assert.ok(!lateHit, `${label}: ${lateHit} ranks below ${ids[firstMiss]} (order ${ids.slice(0, 12)})`);
}

test("every palette record carries its colour names as a field of its own", () => {
  PALETTES.forEach((p) => assert.deepStrictEqual(RECORD.get(p.id).colorNames, p.names, p.id));
});

for (const q of ["color", "theory", "systems", "design"]) {
  test(`"${q}" no longer matches palettes through their blanket categories`, async () => {
    // Every palette is filed under color-theory and systems. Those words
    // used to score on all 600 of them; now a palette is returned only when
    // the term is in its own text.
    const { ids, hrefs } = await search(q);
    ids.forEach((id) => {
      const r = RECORD.get(id);
      const own = lower([r.title, r.description, r.searchText, ...r.colorNames, ...r.tags].join(" "));
      assert.ok(own.includes(q), `"${q}" returned ${id}, which does not contain it`);
    });
    assert.ok(ids.length < 50, `"${q}" still returns ${ids.length} palettes`);
    assert.ok(hrefs.some((h) => h.startsWith("/guide/")), `"${q}" lost its guide results`);
  });
}

test("guide category search still works", async () => {
  const guides = INDEX.filter((r) => r.type === "guide" && r.categories.includes("typography"));
  assert.ok(guides.length, "fixture assumption: a typography guide exists");
  const { hrefs } = await search("typography");
  guides.forEach((g) => assert.ok(hrefs.includes(g.url), `"typography" missed ${g.url}`));
});

test("the category filter still includes every palette", async () => {
  const all = await search("blue", { extra: "&type=palette" });
  const filtered = await search("blue", { extra: "&category=systems" });
  assert.ok(all.ids.length > 0);
  assert.deepStrictEqual(filtered.ids, all.ids);
});

for (const [name, curated] of [
  ["Azure", "p001"],
  ["Kelly Green", "p040"],
]) {
  test(`"${name}": every palette with that exact colour ranks first, curated or not`, async () => {
    const holders = holdersOf(name);
    assert.ok(holders.includes(curated), `fixture assumption: ${curated} has ${name}`);
    assert.ok(
      holders.some((id) => !RECORD.get(id).tags.length),
      `fixture assumption: a p041+ palette has ${name} too`,
    );
    const { ids } = await search(name);
    assert.deepStrictEqual(ids.slice(0, holders.length).sort(), holders.slice().sort());
  });
}

test('"night": whole-word matches rank above "Midnight"-style partials, p001 first', async () => {
  assert.ok(RECORD.get("p001").tags.includes("night"), "fixture assumption: p001 is tagged night");
  const { ids } = await search("night");
  assert.strictEqual(ids[0], "p001");
  assertGroupedFirst(ids, (id) => wholeWordIn(id, "night"), "night");
});

test('"Gold Leaf": the palettes with that exact colour lead, ahead of Golden Sand + Spring Leaf', async () => {
  const holders = holdersOf("Gold Leaf");
  assert.ok(holders.includes("p450"));
  const { ids } = await search("Gold Leaf");
  assert.deepStrictEqual(ids.slice(0, holders.length).sort(), holders.slice().sort());
  assert.ok(ids.indexOf("p442") > holders.length, `p442 ranks at ${ids.indexOf("p442")}`);
});

test('"gold": a Gold colour ranks before Goldenrod or Marigold', async () => {
  const holders = holdersOf("Gold");
  const { ids } = await search("gold");
  assert.deepStrictEqual(ids.slice(0, holders.length).sort(), holders.slice().sort());
  assertGroupedFirst(ids, (id) => wholeWordIn(id, "gold"), "gold");
  assert.ok(
    ids.some((id) => !wholeWordIn(id, "gold")),
    "partial matches (Goldenrod, Marigold) should still be found, just lower",
  );
});

test('"ink": Ink ranks before Pink and Periwinkle', async () => {
  const { ids } = await search("ink");
  assertGroupedFirst(ids, (id) => wholeWordIn(id, "ink"), "ink");
});

test('partial search still works: "star" finds Starless before a mid-word "star"', async () => {
  const { ids } = await search("star");
  ["p001", "p019", "p022"].forEach((id) => assert.ok(ids.includes(id), `"star" missed ${id}`));
  const startsWord = (id) =>
    [RECORD.get(id).title, ...RECORD.get(id).colorNames].some((t) => /(^|[^a-z])star/i.test(t));
  assertGroupedFirst(ids, startsWord, "star");
});

test("an exact palette id ranks first; a partial id still finds its range", async () => {
  for (const id of ["p001", "p450", "p600"]) {
    assert.strictEqual((await search(id)).ids[0], id);
  }
  const { ids } = await search("p45");
  assert.deepStrictEqual(ids.slice().sort(), [
    "p450", "p451", "p452", "p453", "p454", "p455", "p456", "p457", "p458", "p459",
  ]);
});

test("a 3-digit HEX means the doubled 6-digit colour", async () => {
  const isShort = (c) => /^#(.)\1(.)\2(.)\3$/.test(c);
  const p = PALETTES.find((x) => x.colors.some(isShort));
  const hex = p.colors.find(isShort);
  const short = "#" + hex[1] + hex[3] + hex[5];
  const { ids } = await search(short.toLowerCase());
  assert.ok(ids.includes(p.id), `${short} did not return ${p.id}`);
  ids.forEach((id) => assert.ok(byId(id).colors.includes(hex), `${short} returned ${id}`));
  // "#abc" is well-formed but no palette carries #AABBCC.
  assert.ok(!PALETTES.some((x) => x.colors.includes("#AABBCC")));
  assert.deepStrictEqual((await search("#abc")).ids, []);
});

test("#E5B44C in every spelling still returns p450 alone; invalid HEX returns nothing", async () => {
  for (const q of ["#E5B44C", "e5b44c", "#e5b44c", "E5B44C"]) {
    assert.deepStrictEqual((await search(q)).ids, ["p450"], q);
  }
  for (const q of ["#e5b44", "#e5b44c1", "#gggggg", "#12345"]) {
    assert.deepStrictEqual((await search(q)).ids, [], q);
  }
});

test("multi-word queries stay OR, with the whole-query match on top", async () => {
  const both = await search("Starless Frost");
  const starless = await search("Starless");
  const frost = await search("Frost");
  assert.strictEqual(both.ids[0], "p001");
  assert.deepStrictEqual(both.ids.slice().sort(), [...new Set([...starless.ids, ...frost.ids])].sort());
  assert.strictEqual((await search("Frost Starless")).ids[0], "p001");
});

test("results are deterministic and never duplicated", async () => {
  const a = await search("blue");
  const b = await search("blue");
  assert.deepStrictEqual(a.hrefs, b.hrefs);
  const broad = await search("e");
  assert.strictEqual(new Set(broad.hrefs).size, broad.hrefs.length);
});

test("hostile input renders as text, never markup, and never throws", async () => {
  for (const q of [
    "<img src=x onerror=alert(1)>",
    '"><script>alert(1)</script>',
    "(a+)+$",
    ".*",
    "[",
    "\\",
    "$&",
    "a".repeat(2000),
    "·",
    "ui/ux",
    "🎨",
  ]) {
    const { grid, heading } = await search(q);
    assert.ok(!/<img|<script/i.test(grid), `${q} put markup in the grid`);
    assert.strictEqual(heading, `Search results for "${q}"`);
  }
  // Highlighting wraps matches in <mark> and escapes everything else.
  assert.match((await search("gold")).grid, /<mark>Gold<\/mark>/);
  // A malformed escape in the URL decodes to text; the page still renders.
  const bad = await search("", { rawSearch: "?s=%E0%A4%A" });
  assert.ok(bad.empty);
  assert.match(bad.count, /^0 Results for "/);
});
