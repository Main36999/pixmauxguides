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
const BpozzCard = require("../shared/card.js");

const model = content.load(config);
const INDEX = content.buildContentIndex(model, config).records;
const CATEGORIES = JSON.parse(fs.readFileSync(config.paths.content.categories, "utf8"));
const PALETTES = model.palettes;
// /guides.json as published (src/build/build.js copies it verbatim).
const GUIDES_JSON = JSON.parse(fs.readFileSync(config.paths.content.guides, "utf8"));

// The guide card renderer exactly as /app.js binds it: src/shared/card.js
// with core.js's own category label map, read out of core.js itself.
const CORE_SOURCE = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const CORE_CATEGORIES_SOURCE = /\n {2}var CATEGORIES = (\{[\s\S]*?\n {2}\});/.exec(CORE_SOURCE);
assert.ok(CORE_CATEGORIES_SOURCE, "could not find CATEGORIES in core.js");
const CORE_CATEGORIES = vm.runInNewContext("(" + CORE_CATEGORIES_SOURCE[1] + ")");
const CARDS = BpozzCard.createRenderer({ categories: CORE_CATEGORIES });

// initSearchPage(), exactly as it ships.
const SOURCE = fs.readFileSync(path.join(__dirname, "search.js"), "utf8");
const START = SOURCE.indexOf("(function initSearchPage() {");
const END = SOURCE.lastIndexOf("})();") + "})();".length;
assert.ok(START !== -1 && END > START, "could not find initSearchPage() in search.js");
const INIT_SEARCH_PAGE = SOURCE.slice(START, END);
// The same page with one read-only hook, so a test can read the ranked list:
// each result's record, score, matched-term count and match evidence
// (`why`), in rank order. Nothing else differs. Every search below runs with
// it: the page shows its results grouped by type, so the order ACROSS the
// two types is read from here, not from the grid.
assert.ok(INIT_SEARCH_PAGE.includes("scored.sort("), "could not find the ranking sort in search.js");
const INIT_SEARCH_PAGE_SCORED = INIT_SEARCH_PAGE.replace("scored.sort(", "globalThis.__scored = scored; scored.sort(");

function element(created) {
  const attrs = {};
  const classes = new Set();
  const el = {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    textContent: "",
    innerHTML: "",
    hidden: false,
    value: "all",
    style: {},
    listeners: {},
    nextSibling: null,
    setAttribute: (k, v) => (attrs[k] = String(v)),
    removeAttribute: (k) => delete attrs[k],
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (type, fn) => (el.listeners[type] = fn),
    appendChild: () => {},
    insertBefore: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    focus: () => {},
  };
  if (created) created.push(el);
  return el;
}

/**
 * Runs a search for `query` and resolves with the rendered page state.
 * `extra` is appended to the query string as-is ("&type=palette"); a
 * `rawSearch` replaces the whole query string, for input a browser could
 * hand the page but encodeURIComponent never produces.
 *
 * The page draws guide results with the real shared renderer (CARDS above:
 * src/shared/card.js with core.js's label map) from the real /guides.json.
 * `guides` replaces what /guides.json answers: another array, or "fail" for
 * an HTTP error. `index` replaces /content-index.json.
 */
async function search(query, { extra = "", rawSearch, scores = false, guides = GUIDES_JSON, index = INDEX } = {}) {
  const els = {};
  const created = []; // elements the page builds itself, in creation order
  const requestedIds = []; // every id the page looks up
  const cardCalls = []; // ids of the guides drawn with the shared cardHtml()
  const consoleErrors = [];
  let lastUrl = null; // the last history.replaceState() URL
  [
    "search-grid-root",
    "search-heading",
    "search-dek",
    "search-results-count",
    "search-empty-state",
    "search-empty-message",
    "search-filters",
    "search-type-tabs",
    "search-category-select",
  ].forEach((id) => (els[id] = element()));
  // The "All" type tab, so a test can see where Clear filters puts focus.
  let focused = null;
  const allTab = element();
  allTab.focus = () => (focused = "all");
  els["search-type-tabs"].querySelector = (selector) =>
    selector === '.search-type-tab[data-type="all"]' ? allTab : null;
  // The empty state's two browse links (search.html .search-empty-actions).
  const actionsEl = element();
  els["search-empty-state"].querySelector = (selector) =>
    selector === ".search-empty-actions" ? actionsEl : null;

  const context = {
    URLSearchParams,
    console: {
      error: (...args) => consoleErrors.push(args.map(String).join(" ")),
      log: () => {},
      warn: () => {},
    },
    Promise,
    escapeHtml: BpozzHtml.escapeHtml,
    thumbHtml: CARDS.thumbHtml,
    cardHtml: (g) => {
      cardCalls.push(g.id);
      return CARDS.cardHtml(g);
    },
    CATEGORIES: CORE_CATEGORIES,
    BpozzCard,
    location: {
      search: rawSearch != null ? rawSearch : "?s=" + encodeURIComponent(query) + extra,
      pathname: "/search",
      protocol: "http:",
    },
    history: { replaceState: (_state, _title, url) => (lastUrl = url) },
    document: {
      title: "",
      getElementById: (id) => {
        requestedIds.push(id);
        return els[id] || null;
      },
      querySelectorAll: () => [],
      createElement: () => element(created),
    },
    fetch: (url) => {
      if (url === "/guides.json" && guides === "fail") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error("no body")) });
      }
      const body =
        url === "/content-index.json"
          ? index
          : url === "/categories.json"
            ? CATEGORIES
            : url === "/guides.json"
              ? guides
              : null;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
  };
  vm.runInNewContext(INIT_SEARCH_PAGE_SCORED, context);
  await new Promise((resolve) => setImmediate(resolve)); // let the fetches settle

  // The empty state builds two elements of its own: the filtered message
  // (created first) and the "Clear filters" button.
  const [filteredMessageEl, clearButton] = created;
  const shown = (el) => !!el && el.style.display !== "none";
  function state() {
    const grid = els["search-grid-root"].innerHTML;
    const scored = context.__scored || [];
    return {
      ids: [...grid.matchAll(/href="\/palettes#(p\d+)"/g)].map((m) => m[1]),
      hrefs: [...grid.matchAll(/class="card-link" href="([^"]*)"/g)].map((m) => m[1]),
      // The rank order across both types, from the hook (the last
      // runSearch() the page made). The grid groups results by type.
      ranked: Array.from(scored, (s) => s.record.url),
      // url -> the match evidence scoreRecord() recorded for that result,
      // written out as the old "Matched in ..." line (see explain()), or
      // null. The page no longer shows it; the scoring still records it.
      evidence: Object.fromEntries(
        Array.from(scored, (s) => [s.record.url, explain(s.record, JSON.parse(JSON.stringify(s.why)))]),
      ),
      groups: groupsOf(grid),
      grid,
      heading: els["search-heading"].textContent,
      // Anything written to the heading as markup would land here.
      headingHtml: els["search-heading"].innerHTML,
      dek: els["search-dek"].textContent,
      count: els["search-results-count"].textContent,
      // The role=status line is always in the accessibility tree; sr-only
      // only takes it off the screen.
      countVisuallyHidden: els["search-results-count"].classList.contains("sr-only"),
      empty: els["search-empty-state"].getAttribute("data-visible") === "true",
      noResultsMessageShown: shown(els["search-empty-message"]),
      actionsShown: shown(actionsEl),
      filteredMessage: shown(filteredMessageEl) ? filteredMessageEl.textContent : null,
      clearButtonShown: shown(clearButton),
      url: lastUrl,
      // With { scores: true }: [record id, score, terms matched], ranked order.
      // Array.from builds it in this realm: an array made inside the vm has
      // another Array prototype, which deepStrictEqual would reject.
      scored: scores ? Array.from(scored, (s) => [s.record.id, s.score, s.matched]) : undefined,
      focused,
      requestedIds,
      cardCalls,
      consoleErrors,
      /** Clicks the empty state's "Clear filters" button; returns the new state. */
      clearFilters() {
        assert.strictEqual(clearButton.textContent, "Clear filters");
        clearButton.listeners.click();
        return state();
      },
    };
  }
  return state();
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

/**
 * The match evidence scoreRecord() records for a result (`why`), written out
 * the way the result cards showed it before the native-card redesign:
 * "Matched in color name: Azure · style: Night". The page no longer shows
 * this line, but the scoring still records the evidence, and these tests
 * pin it field by field and value by value through the ranking hook.
 */
function explain(record, why) {
  const reasons = [];
  const add = (field, values = []) => reasons.push(values.length ? `${field}: ${values.join(", ")}` : field);
  if (why.title) add("title");
  if (why.colorNames.length) add("color name", why.colorNames);
  // A matched tag that is one of the record's styles is named as a style;
  // any other tag keeps the "theme" wording.
  const styles = (record.styles || []).map((s) => String(s).toLowerCase());
  const styleTags = [];
  const otherTags = [];
  why.tags.forEach((t) =>
    (styles.includes(String(t).toLowerCase()) ? styleTags : otherTags).push(t.charAt(0).toUpperCase() + t.slice(1)),
  );
  if (styleTags.length) add("style", styleTags);
  if (otherTags.length) add("theme", otherTags);
  if (why.hex.length) add("HEX", why.hex.map((h) => h.toUpperCase()));
  if (why.slug) add(record.type === "palette" ? "palette ID" : "URL", [record.slug]);
  if (why.category) add("category");
  if (why.keywords.length) add("keyword", why.keywords);
  if (why.description) add("description");
  if (why.text) add("text");
  return reasons.length ? "Matched in " + reasons.join(" · ") : null;
}

/** The grid's result sections, in order: heading label, count, grid class, card links. */
function groupsOf(grid) {
  return grid
    .split('<section class="search-group">')
    .slice(1)
    .map((section) => {
      const title = /^<h2 class="search-group__title">([^<]*) <span class="search-group__count">(\d+)<\/span><\/h2>/.exec(section);
      const body = /<\/h2><div class="([^"]*)">/.exec(section);
      return {
        label: title ? title[1] : null,
        count: title ? Number(title[2]) : null,
        gridClass: body ? body[1] : null,
        hrefs: [...section.matchAll(/class="card-link" href="([^"]*)"/g)].map((m) => m[1]),
      };
    });
}

/** Every palette card in the grid, taken apart. */
function paletteCards(grid) {
  return [...grid.matchAll(/<article class="palette-card"[\s\S]*?<\/article>/g)].map((m) => {
    const html = m[0];
    const link = /<a class="card-link" href="([^"]*)">([\s\S]*?)<\/a>/.exec(html);
    return {
      html,
      id: (/data-id="([^"]*)"/.exec(html) || [])[1],
      swatches: [...html.matchAll(/<span class="palette-swatch" style="--sw-hex:([^"]*)"><\/span>/g)].map((x) => x[1]),
      anchors: (html.match(/<a\b/g) || []).length,
      href: link ? link[1] : null,
      linkHtml: link ? link[2] : null,
    };
  });
}

/** Every guide card in the grid, as markup. */
function guideCards(grid) {
  return [...grid.matchAll(/<article class="content-card">[\s\S]*?<\/article>/g)].map((m) => m[0]);
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
  assert.strictEqual(count, '0 Results for "zzqxnomatchzz" in guides and palettes');
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
// search scope: the wording names exactly what the index holds
// ---------------------------------------------------------------------

// Fonts, icon packs and the colour library are not in content-index.json
// (F9, F10). The search boxes say "Search bpozz"; /search states the scope —
// its intro line, the zero-results count and the no-results panel all name
// guides and (color) palettes. If the index gains a type, the first test
// below fails: update search.html and SCOPE_DEK / countLabel() in search.js
// with it.
const SEARCH_LABEL = "Search bpozz";
const SCOPE_DEK = "Search currently includes guides and color palettes.";

test("the search index holds every guide and every palette, and nothing else", () => {
  assert.deepStrictEqual([...new Set(INDEX.map((r) => r.type))].sort(), ["guide", "palette"]);
  assert.deepStrictEqual(
    INDEX.filter((r) => r.type === "guide").map((r) => r.slug),
    model.guides.map((g) => g.id),
  );
});

for (const [file, inputId] of [
  ["partials/header.html", "header-search-input"],
  ["index.html", "hero-search-input"],
]) {
  test(`${file}: the global search box is labelled "${SEARCH_LABEL}"`, () => {
    const html = fs.readFileSync(path.join(config.paths.root, file), "utf8");
    const forms = html.match(/<form[^>]*role="search"[\s\S]*?<\/form>/g) || [];
    assert.strictEqual(forms.length, 1, "one global search form");
    const form = forms[0];
    assert.match(form, /action="\/search"/);
    assert.match(form, /method="get"/);

    const label = new RegExp(`<label for="${inputId}"[^>]*>\\s*([^<]*?)\\s*</label`).exec(form);
    assert.ok(label, "the input has a <label>");
    assert.strictEqual(label[1], SEARCH_LABEL, "the input's accessible name");

    const submit = /<button\s[^>]*type="submit"[^>]*>/.exec(form);
    assert.ok(submit, "the form has a submit button");
    assert.strictEqual(/aria-label="([^"]*)"/.exec(submit[0])[1], SEARCH_LABEL, "the submit button's name");

    const input = new RegExp(`<input\\s[^>]*id="${inputId}"[^>]*>`).exec(form);
    assert.ok(input, "the search input");
    assert.match(input[0], /type="search"/);
    assert.match(input[0], /name="s"/);
    // The visible hint starts with the accessible name, so what a sighted
    // user reads and what a screen reader says are the same words.
    assert.strictEqual(/placeholder="([^"]*)"/.exec(input[0])[1], SEARCH_LABEL + "…");
  });
}

// The search boxes' focus ring is for keyboard users only. A text field
// matches :focus-visible on click too, so an inline script right after each
// global search form marks it data-pointer-focus on a press, and styles.css
// draws the ring only on unmarked forms. Inline rather than in app.js, so it
// also runs on the pages that load no app.js.
function pointerFocusScript(file) {
  const html = fs.readFileSync(path.join(config.paths.root, file), "utf8");
  const form = /<form[^>]*role="search"[\s\S]*?<\/form>/.exec(html);
  assert.ok(form, `${file}: the global search form`);
  const after = html.slice(form.index + form[0].length);
  const script = /^\s*(?:<!--[\s\S]*?-->\s*)?<script data-cookieconsent="ignore">([\s\S]*?)<\/script>/.exec(after);
  assert.ok(script, `${file}: the pointer-focus script directly follows the search form`);
  return script[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

test("partials/header.html and index.html carry the same pointer-focus script after their search form", () => {
  const header = pointerFocusScript("partials/header.html");
  const hero = pointerFocusScript("index.html");
  assert.strictEqual(hero, header);
  assert.match(header, /document\.currentScript\.previousElementSibling/);
});

test("the pointer-focus script marks its form on a press and clears the mark once focus leaves the form", () => {
  const code = pointerFocusScript("partials/header.html");
  const inside = {};
  const listeners = {};
  const attrs = new Map();
  const form = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name),
    contains: (node) => node === inside,
  };
  vm.runInNewContext(code, { document: { currentScript: { previousElementSibling: form } } });
  assert.deepStrictEqual(Object.keys(listeners).sort(), ["focusout", "pointerdown"]);

  listeners.pointerdown({});
  assert.strictEqual(attrs.get("data-pointer-focus"), "");
  listeners.focusout({ relatedTarget: inside });
  assert.ok(attrs.has("data-pointer-focus"), "focus moving within the form keeps the mark");
  listeners.focusout({ relatedTarget: null });
  assert.ok(!attrs.has("data-pointer-focus"), "focus leaving the form clears the mark");

  assert.doesNotThrow(() =>
    vm.runInNewContext(code, { document: { currentScript: { previousElementSibling: null } } }),
  );
});

test("search focus styles: no ring on a pressed form, a visible non-blue ring for keyboard focus", () => {
  const css = fs
    .readFileSync(path.join(config.paths.root, "src", "styles", "styles.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()),
    body: m[2],
  }));
  const BLUE = /--action|#2563eb|37,\s*99,\s*235/i;

  for (const form of [".site-header--inner .form", ".hero-search"]) {
    const ringRules = rules.filter((r) => r.selectors.some((s) => s.startsWith(form + ":focus")));
    assert.ok(ringRules.length > 0, `${form}: has a focus rule`);
    for (const rule of ringRules) {
      for (const s of rule.selectors.filter((sel) => sel.startsWith(form + ":focus"))) {
        assert.ok(s.includes(":not([data-pointer-focus])"), `${s}: skipped on a pressed form`);
      }
      assert.match(rule.body, /box-shadow:\s*0 0 0 [1-9]/, `${form}: keyboard focus draws a ring`);
      assert.ok(!BLUE.test(rule.body), `${form}: the ring is not blue`);
      assert.ok(!/border-color/.test(rule.body), `${form}: the border is left as it is`);
    }
  }
  for (const input of [".site-header--inner .input:focus", ".hero-search input:focus"]) {
    const rule = rules.find((r) => r.selectors.includes(input));
    assert.ok(rule && /outline:\s*none/.test(rule.body), `${input}: the input draws no outline of its own`);
  }
});

test("the /search intro line states the scope, with or without a query", async () => {
  const html = fs.readFileSync(path.join(config.paths.root, "search.html"), "utf8");
  const dek = /<p class="category-hero__dek" id="search-dek">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(dek, "search.html has the intro line");
  assert.strictEqual(dek[1].replace(/\s+/g, " ").trim(), SCOPE_DEK, "the no-JS markup");
  for (const q of ["", "gold", "zzqxnomatchzz"]) {
    assert.strictEqual((await search(q)).dek, SCOPE_DEK, `query "${q}"`);
  }
});

test("no results: the h1 says so, the status line names the scope, the panel offers both libraries", async () => {
  const s = await search("zzqxnomatchzz");
  // One heading carries the outcome, written as text.
  assert.strictEqual(s.heading, '0 results for "zzqxnomatchzz"');
  assert.strictEqual(s.headingHtml, "", "the heading is set as text, never as markup");
  // The scope stays on screen. The status line still announces the
  // scope-naming sentence; it is visually hidden because the h1 shows the
  // outcome, so it is not a second visible copy.
  assert.strictEqual(s.dek, SCOPE_DEK);
  assert.strictEqual(s.count, '0 Results for "zzqxnomatchzz" in guides and palettes', "the role=status line");
  assert.ok(s.countVisuallyHidden);
  assert.ok(s.empty && s.noResultsMessageShown && s.actionsShown);
  assert.ok(!s.clearButtonShown);
  assert.strictEqual(s.grid, "");

  const html = fs.readFileSync(path.join(config.paths.root, "search.html"), "utf8");
  const panel = /<p id="search-empty-message">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(panel, "search.html has the no-results message");
  assert.strictEqual(panel[1].replace(/\s+/g, " ").trim(), "Try another keyword or browse the libraries.");
  const actions = /<div class="search-empty-actions">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(actions, "search.html has the browse links");
  assert.deepStrictEqual(
    [...actions[1].matchAll(/<a href="([^"]*)" class="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2], m[3]]),
    [
      ["/guides/", "btn btn-primary", "Browse guides"],
      ["/palettes/", "search-empty-link", "Browse palettes"],
    ],
  );
  assert.doesNotMatch(html, /No results found/, "the old unscoped wording is gone");
});

test("the removed search-empty-query element is gone from the page and from the code", async () => {
  const html = fs.readFileSync(path.join(config.paths.root, "search.html"), "utf8");
  assert.ok(!html.includes("search-empty-query"), "search.html");
  assert.ok(!SOURCE.includes("search-empty-query"), "search.js");
  for (const q of ["zzqxnomatchzz", "gold"]) {
    assert.ok(!(await search(q)).requestedIds.includes("search-empty-query"), q);
  }
});

test("only a zero count names the scope: result counts are unchanged", async () => {
  for (const extra of ["", "&type=palette"]) {
    const s = await search("gold", { extra });
    assert.ok(s.hrefs.length > 0, `fixture assumption: "gold" has results (${extra})`);
    assert.match(s.count, new RegExp(`^${s.hrefs.length} Results? for "gold"`));
    assert.doesNotMatch(s.count, /in guides and palettes/);
  }
});

// ---------------------------------------------------------------------
// relevance: blanket categories, colour names, whole words, ids
// ---------------------------------------------------------------------

const RECORD = new Map(INDEX.map((r) => [r.slug, r]));
const RECORD_BY_URL = new Map(INDEX.map((r) => [r.url, r]));
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
      holders.some((id) => +id.slice(1) > 40),
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
    const s = await search(q);
    // Nothing typed reaches the markup: the only images are guide
    // thumbnails from the real card renderer, and there is no script.
    [...s.grid.matchAll(/<img\b[^>]*>/gi)].forEach((m) =>
      assert.match(m[0], /^<img src="\/thumbnail_image_webp\/[^"<>]+\.webp"/, `${q} put an unexpected <img> in the grid`),
    );
    assert.ok(!/<script/i.test(s.grid), `${q} put a script in the grid`);
    assert.ok(!s.grid.includes("onerror=alert"), `${q} reached the grid`);
    // The query is shown as typed, as text, in the one heading.
    assert.strictEqual(s.heading, s.hrefs.length ? `Search results for "${q}"` : `0 results for "${q}"`);
    assert.strictEqual(s.headingHtml, "", `${q}: the heading is set as text`);
  }
  // No highlighting any more: no <mark> anywhere in the results.
  assert.doesNotMatch((await search("gold")).grid, /<mark/i);
  // A malformed escape in the URL decodes to text; the page still renders.
  const bad = await search("", { rawSearch: "?s=%E0%A4%A" });
  assert.ok(bad.empty);
  assert.match(bad.count, /^0 Results for "/);
});

// ---------------------------------------------------------------------
// multi-word coverage and repeated words
// ---------------------------------------------------------------------

/** How many of `terms` occur anywhere in this palette's own text. */
function termsMatched(id, terms) {
  const r = RECORD.get(id);
  const own = lower([r.title, r.description, r.searchText, ...r.colorNames, ...r.tags].join(" "));
  return terms.filter((t) => own.includes(t)).length;
}

/** Ranks never go up as the number of distinct terms matched goes down. */
function assertCoverageOrder(ids, terms, label) {
  ids.forEach((id, i) => {
    if (i === 0) return;
    const prev = termsMatched(ids[i - 1], terms);
    const here = termsMatched(id, terms);
    assert.ok(here <= prev, `${label}: ${id} matches ${here} terms but ranks below ${ids[i - 1]} (${prev})`);
  });
}

test('"dark blue": every palette matching both words outranks every palette matching one', async () => {
  // p005 "Bare Ledger (Dark)" matches only "dark", but in its title, a tag
  // and searchText (85). p482 matches both words (82.5). It used to lose.
  const { ids } = await search("dark blue");
  assert.strictEqual(termsMatched("p005", ["dark", "blue"]), 1);
  assert.strictEqual(termsMatched("p482", ["dark", "blue"]), 2);
  assert.ok(ids.indexOf("p482") < ids.indexOf("p005"), `p482 #${ids.indexOf("p482") + 1}, p005 #${ids.indexOf("p005") + 1}`);
  assertCoverageOrder(ids, ["dark", "blue"], "dark blue");
});

test('"deep sea blue": three words matched beat two, two beat one', async () => {
  const { ids } = await search("deep sea blue");
  assert.strictEqual(termsMatched(ids[0], ["deep", "sea", "blue"]), 3);
  assertCoverageOrder(ids, ["deep", "sea", "blue"], "deep sea blue");
});

test("a repeated word adds nothing: gold gold ranks exactly like gold", async () => {
  const once = await search("gold");
  const twice = await search("gold gold");
  assert.deepStrictEqual(twice.hrefs, once.hrefs);
  assert.deepStrictEqual(twice.hrefs.slice(0, holdersOf("Gold").length).map((h) => h.split("#")[1]).sort(), holdersOf("Gold").sort());
});

test("blue blue gold ranks exactly like blue gold, both words first", async () => {
  const plain = await search("blue gold");
  const repeated = await search("blue blue gold");
  assert.deepStrictEqual(repeated.hrefs, plain.hrefs);
  // p576 (Rich Bluebell + Butter Gold) matches both words; it used to fall
  // to #92 behind palettes matching "blue" alone.
  assert.ok(repeated.ids.indexOf("p576") < repeated.ids.findIndex((id) => termsMatched(id, ["blue", "gold"]) === 1));
  assertCoverageOrder(repeated.ids, ["blue", "gold"], "blue blue gold");
});

test('"gold gold leaf" keeps the "Gold Leaf" phrase: it ranks exactly like "gold leaf"', async () => {
  const plain = await search("gold leaf");
  const repeated = await search("gold gold leaf");
  assert.deepStrictEqual(repeated.hrefs, plain.hrefs);
  const holders = holdersOf("Gold Leaf");
  assert.deepStrictEqual(repeated.ids.slice(0, holders.length).sort(), holders.slice().sort());
});

test('"Leaf Gold" keeps the typed-order rule: no phrase bonus, so the holders only tie', async () => {
  // Both words match p413 (Mustard Gold, Olive Leaf) and the three "Gold
  // Leaf" palettes equally; with no bonus for the reversed phrase they tie,
  // and the title tie-break puts p413 ("Dark Umber …") first.
  const { ids } = await search("Leaf Gold");
  assert.deepStrictEqual(ids.slice(0, 4).sort(), ["p140", "p413", "p450", "p485"]);
  assert.strictEqual(ids[0], "p413");
});

test("a guide title that repeats a word itself still matches exactly when typed in full", async () => {
  const guide = INDEX.find((r) => r.slug === "color-palette-token-system");
  assert.match(guide.title, /\ba\b.*\ba\b/i, "fixture assumption: the title repeats 'a'");
  const { hrefs } = await search(guide.title);
  assert.strictEqual(hrefs[0], guide.url);
});

// ---------------------------------------------------------------------
// the empty state: nothing at all vs. nothing under the filter
// ---------------------------------------------------------------------

test("no results anywhere: the h1, the no-results line and both browse links, no clear button", async () => {
  const s = await search("zzqxnomatchzz", { extra: "&type=palette" });
  assert.ok(s.empty);
  assert.strictEqual(s.count, '0 Results for "zzqxnomatchzz" in guides and palettes');
  assert.strictEqual(s.heading, '0 results for "zzqxnomatchzz"');
  assert.ok(s.noResultsMessageShown);
  assert.ok(s.actionsShown, "both browse links are offered");
  assert.strictEqual(s.filteredMessage, null);
  assert.ok(!s.clearButtonShown);
  // The h1 shows what the status line announces, so the status line is
  // visually hidden rather than a second visible copy.
  assert.ok(s.countVisuallyHidden);
});

test("results exist but not under the type filter: says so, and offers to clear it", async () => {
  const guides = (await search("color")).hrefs.filter((h) => h.startsWith("/guide/")).length;
  assert.ok(guides > 0);
  const s = await search("color", { extra: "&type=palette" });
  const message = `No palettes match "color" — ${guides} guides do.`;
  assert.ok(s.empty);
  assert.strictEqual(s.count, message, "the role=status line announces it");
  assert.strictEqual(s.filteredMessage, message);
  assert.ok(!s.noResultsMessageShown, "the no-results message would be untrue here");
  assert.ok(!s.actionsShown, "the browse links would be untrue here too");
  assert.ok(s.clearButtonShown);
  // Not "0 results": the query does match, the filter hides it.
  assert.strictEqual(s.heading, 'Search results for "color"');
  // Shown once: in the panel. The status line still carries it for screen
  // readers but is visually hidden, so it is not a second visible copy.
  assert.ok(s.countVisuallyHidden, "the status line duplicates the panel on screen");
});

test("results exist but not in the category: names the category and what does match", async () => {
  const palettes = (await search("blue")).ids.length;
  const s = await search("blue", { extra: "&category=typography" });
  assert.strictEqual(s.count, `No results in Typography match "blue" — ${palettes} palettes do.`);
  assert.strictEqual(s.filteredMessage, s.count);
  assert.ok(s.countVisuallyHidden);
  const both = await search("blue", { extra: "&type=guide&category=typography" });
  assert.strictEqual(both.count, `No guides in Typography match "blue" — ${palettes} palettes do.`);
  assert.strictEqual(both.filteredMessage, both.count);
  assert.ok(both.countVisuallyHidden);
  assert.ok(!both.actionsShown && both.clearButtonShown);
});

test("Clear filters restores the unfiltered results and URL", async () => {
  const unfiltered = await search("blue");
  const s = await search("blue", { extra: "&type=guide&category=typography" });
  const cleared = s.clearFilters();
  assert.ok(!cleared.empty);
  assert.deepStrictEqual(cleared.hrefs, unfiltered.hrefs);
  assert.deepStrictEqual(cleared.groups, unfiltered.groups);
  assert.strictEqual(cleared.count, unfiltered.count);
  assert.strictEqual(cleared.url, "/search?s=blue");
  assert.strictEqual(cleared.focused, "all", "focus goes to the All tab");
  // The results are back, and their group headings carry the counts; the
  // status line announces the same total, visually hidden.
  assert.ok(cleared.countVisuallyHidden);
  assert.match(cleared.count, new RegExp(`^${cleared.hrefs.length} Results? for "blue"`));
  assert.strictEqual(
    cleared.groups.reduce((n, g) => n + g.count, 0),
    cleared.hrefs.length,
  );
});

test("the filtered empty state comes back identically from the URL alone (refresh)", async () => {
  const first = await search("color", { extra: "&type=palette" });
  const reloaded = await search("", { rawSearch: "?s=color&type=palette" });
  assert.strictEqual(reloaded.count, first.count);
  assert.strictEqual(reloaded.filteredMessage, first.filteredMessage);
});

// ---------------------------------------------------------------------
// query normalization: hyphens, punctuation, apostrophes
// ---------------------------------------------------------------------

/** `a` and `b` return the same results in the same order. */
async function assertSameResults(a, b) {
  const ra = await search(a);
  const rb = await search(b);
  assert.ok(rb.hrefs.length > 0, `fixture assumption: "${b}" has results`);
  // The rank order across both types, and the grouped page built from it.
  assert.deepStrictEqual(ra.ranked, rb.ranked, `"${a}" and "${b}" rank differently`);
  assert.deepStrictEqual(ra.hrefs, rb.hrefs, `"${a}" and "${b}" differ`);
  return ra;
}

for (const [hyphenated, spaced] of [
  ["color-palette", "color palette"],
  ["design-system", "design system"],
  ["dark-blue", "dark blue"],
]) {
  test(`a hyphen separates words: "${hyphenated}" ranks exactly like "${spaced}"`, async () => {
    const r = await assertSameResults(hyphenated, spaced);
    // Shown as typed; only the matching is normalized.
    assert.strictEqual(r.heading, `Search results for "${hyphenated}"`);
  });
}

test("a hyphenated slug still matches its record exactly", async () => {
  const guide = INDEX.find((r) => r.slug === "color-contrast-systems");
  assert.strictEqual((await search("color-contrast-systems")).ranked[0], guide.url);
  // …and a hyphenated palette title still wins on its exact title.
  assert.ok(RECORD.get("p040").title.includes("-"), "fixture assumption: p040's title is hyphenated");
  assert.strictEqual((await search(RECORD.get("p040").title)).ids[0], "p040");
});

for (const q of [".", ",", "·", "(", ")", "&"]) {
  test(`punctuation on its own is not a word: "${q}" matches nothing`, async () => {
    const s = await search(q);
    assert.deepStrictEqual(s.hrefs, []);
    assert.ok(s.empty);
    assert.strictEqual(s.count, `0 Results for "${q}" in guides and palettes`);
  });
}

for (const q of ["color · palette", "Color · Palette", "color, palette", "(color palette)"]) {
  test(`punctuation around words is ignored: "${q}" ranks exactly like "color palette"`, async () => {
    await assertSameResults(q, "color palette");
  });
}

test('a punctuation word no longer counts as a matched word: "Dark / Light" ranks both-word palettes first', async () => {
  // The "/" used to match inside a guide description and, counted as one of
  // three words matched, put that guide above every palette matching both
  // "dark" and "light".
  // Rank order across both types comes from the hook: the page lists any
  // guide first because it groups by type, not because it ranks higher.
  const { ranked, hrefs, ids } = await search("Dark / Light");
  assert.ok(ranked[0].startsWith("/palettes#"), `#1 is ${ranked[0]}`);
  const plain = await search("dark light");
  assert.deepStrictEqual(ranked, plain.ranked);
  assert.deepStrictEqual(hrefs, plain.hrefs);
  assert.ok(ids.length > 0);
});

test('an exact title containing punctuation still ranks first: "Bare Ledger (Dark)"', async () => {
  assert.strictEqual((await search("Bare Ledger (Dark)")).ids[0], "p005");
});

test('a leading "#" is kept: "#333" is still only the HEX colour, not the id p333', async () => {
  assert.deepStrictEqual((await search("#333")).ids, ["p082"]);
});

for (const [straight, curly] of [
  ["figma's", "figma’s"],
  ["don't", "don’t"],
]) {
  test(`a curly apostrophe matches like a straight one: "${curly}"`, async () => {
    const r = await assertSameResults(curly, straight);
    assert.strictEqual(r.heading, `Search results for "${curly}"`, "the query is shown as typed");
  });
}

// ---------------------------------------------------------------------
// generator theme labels (p301–p600)
// ---------------------------------------------------------------------

/** Palettes whose palettes-data.json tags include `label`. */
const carrying = (label) => PALETTES.filter((p) => (p.tags || []).includes(label)).map((p) => p.id);

test("the index carries each palette's data-file tags, and nothing is added to p041–p300", () => {
  PALETTES.forEach((p) => {
    const n = +p.id.slice(1);
    const tags = RECORD.get(p.id).tags;
    if (n <= 40) return; // curated: palettes-meta.json, pinned by palette-meta.test.js
    if (n <= 300) assert.deepStrictEqual(tags, [], `${p.id} gained tags`);
    else {
      assert.deepStrictEqual(tags, p.tags, p.id);
      p.tags.forEach((t) => assert.ok(RECORD.get(p.id).searchText.split(" ").includes(t), `${p.id} searchText lacks ${t}`));
    }
  });
});

for (const label of ["modern", "luxury", "earthy", "minimal", "vintage", "ui-dark"]) {
  test(`searching the generator label "${label}" returns every palette carrying it`, async () => {
    const holders = carrying(label);
    assert.ok(holders.length > 0, `fixture assumption: some palette is tagged ${label}`);
    const { ids } = await search(label);
    holders.forEach((id) => assert.ok(ids.includes(id), `"${label}" missed ${id}`));
  });
}

test('a label no other text contains finds exactly its tagged palettes: "modern"', async () => {
  assert.deepStrictEqual((await search("modern")).ids.slice().sort(), carrying("modern").sort());
});

// ---------------------------------------------------------------------
// the Pastel style (recipe provenance — src/build/content.js styleLabels())
// ---------------------------------------------------------------------
// For the query "pastel" only (product decision): palettes made by a Pastel
// recipe come first, then the palettes that only have "Pastel" in a colour
// name — still found, never dropped. The style comes from provenance alone,
// never from colours. Every other query ranks exactly as at commit 60edbbe.

const FP8 = ["p007", "p009", "p020", "p024"];
const pastelStyled = () =>
  INDEX.filter((r) => r.type === "palette" && r.styles.includes("pastel")).map((r) => r.slug);
const nameSaysPastel = (id) => RECORD.get(id).colorNames.some((n) => /pastel/i.test(n));

test('"pastel": every Pastel style palette ranks before every colour-name-only match', async () => {
  const styled = pastelStyled();
  assert.strictEqual(styled.length, 12, "fixture assumption: 4 legacy + 8 current Pastel recipe palettes");
  const { ids, evidence } = await search("pastel");
  assert.strictEqual(new Set(ids).size, ids.length, "a result is listed twice");

  const first = ids.slice(0, styled.length);
  assert.deepStrictEqual(first.slice().sort(), styled.slice().sort(), "the first results are not the Pastel style");
  first.forEach((id) => assert.strictEqual(evidence[`/palettes#${id}`], "Matched in style: Pastel", id));

  assert.strictEqual(ids.length, 35, "total results");
  const rest = ids.slice(styled.length);
  assert.strictEqual(rest.length, 23, "colour-name-only matches must stay searchable");
  rest.forEach((id) => {
    assert.ok(!styled.includes(id), `${id} listed after the styles`);
    assert.ok(nameSaysPastel(id), `${id} is neither a Pastel style nor a "Pastel" colour name`);
    assert.match(evidence[`/palettes#${id}`], /color name: .*Pastel/, id);
  });
  // Every palette with a "Pastel" colour name is still found.
  PALETTES.filter((p) => nameSaysPastel(p.id)).forEach((p) => assert.ok(ids.includes(p.id), `lost ${p.id}`));
});

test('"pastel": no dark variant, no p041–p300 palette and no guide is a Pastel style match', async () => {
  const { ids, hrefs } = await search("pastel");
  FP8.forEach((id) => assert.ok(!ids.includes(id), `${id} (dark variant) still matches "pastel"`));
  pastelStyled().forEach((id) => {
    const n = +id.slice(1);
    assert.ok(n <= 40 || n > 300, `${id} (p041–p300) carries the Pastel style`);
  });
  hrefs.forEach((href) => assert.ok(href.startsWith("/palettes#"), `unexpected result ${href}`));
});

for (const spelling of ["Pastel", "PASTEL"]) {
  test(`"${spelling}" finds exactly what "pastel" finds, in the same order`, async () => {
    await assertSameResults(spelling, "pastel");
  });
}

test('"Pastel" and "PASTEL" rank the same 12 styles before the same 23 colour names, with the same scores', async () => {
  const base = await search("pastel", { scores: true });
  for (const spelling of ["Pastel", "PASTEL"]) {
    const r = await search(spelling, { scores: true });
    assert.deepStrictEqual(r.scored, base.scored, spelling);
    assert.deepStrictEqual(Object.values(r.evidence), Object.values(base.evidence), spelling);
  }
});

// Queries the Pastel decision must not move, pinned to their exact ranking at
// commit 60edbbe — other style names, legacy tags, guides and plain words.
// scripts/qa/fixtures/search-ranking-60edbbe.json was captured by running
// that commit's search.js on that commit's content-index.json.
const RANKING_60EDBBE = JSON.parse(
  fs.readFileSync(path.join(config.paths.root, "scripts", "qa", "fixtures", "search-ranking-60edbbe.json"), "utf8"),
).queries;

for (const [query, expected] of Object.entries(RANKING_60EDBBE)) {
  test(`"${query}" ranks exactly as at 60edbbe: same results, order, scores and matched counts`, async () => {
    const r = await search(query, { scores: true });
    assert.deepStrictEqual(r.scored, expected, `"${query}" differs from 60edbbe`);
    // Guides stay where they were.
    const guidesAt = (rows) => rows.map((row, i) => row[0].startsWith("guide:") && `${row[0]}@${i}`).filter(Boolean);
    assert.deepStrictEqual(guidesAt(r.scored), guidesAt(expected), "guide placement");
    assert.strictEqual(r.hrefs.length, expected.length, "rendered count");
  });
}

test("no generic style promotion: a style other than Pastel does not outrank a colour name", async () => {
  // At 60edbbe a "spring" colour-name match ranked first, above the Spring
  // recipe palettes; it still does.
  const styled = new Set(INDEX.filter((r) => r.type === "palette" && r.styles.includes("spring")).map((r) => r.slug));
  const { ids } = await search("spring");
  assert.ok(styled.size > 0, "fixture assumption: some palette has the Spring style");
  assert.ok(!styled.has(ids[0]), `"spring" now leads with the Spring style (${ids[0]})`);
});

// ---------------------------------------------------------------------
// match evidence
// ---------------------------------------------------------------------
// The page no longer shows a "Matched in ..." line, but scoreRecord()
// still records, per result, which fields earned its score (`why`). These
// read that evidence through the ranking hook (explain() writes it out in
// the wording the cards used) and pin it exactly as before. The ranking and
// scoring above are pinned by their own tests; these pin only the evidence.

test('a colour name the title does not show is named: "Azure" on p001 (Starless Frost)', async () => {
  assert.ok(RECORD.get("p001").colorNames.includes("Azure"), "fixture assumption");
  const { evidence } = await search("Azure");
  assert.strictEqual(evidence["/palettes#p001"], "Matched in color name: Azure");
});

test('a title match says so: "Starless" on p001', async () => {
  const { evidence } = await search("Starless");
  assert.strictEqual(evidence["/palettes#p001"], "Matched in title");
});

test('a generator recipe label is named as a style: "modern"', async () => {
  const { evidence, hrefs } = await search("modern");
  assert.ok(hrefs.length > 0);
  hrefs.forEach((href) => assert.strictEqual(evidence[href], "Matched in style: Modern", href));
});

test('several fields read as one concise line: "night" on p001', async () => {
  const { evidence } = await search("night");
  assert.strictEqual(evidence["/palettes#p001"], "Matched in color name: Nightshade · style: Night");
});

test("a tag that is not a style keeps its wording: legacy Cool, and Night on a dark variant", async () => {
  // Cool is computed from the background colour (not a recipe); a legacy
  // dark variant was not made by a recipe, so its inherited Night is no style.
  assert.strictEqual((await search("cool")).evidence["/palettes#p021"], "Matched in theme: Cool");
  assert.strictEqual((await search("night")).evidence["/palettes#p007"], "Matched in theme: Night");
});

test("a colour name only matched inside a word is not claimed over a whole-word one", async () => {
  // p003 carries "Gold"; "gold" must name it, not a "Marigold"-style partial.
  const { evidence } = await search("gold");
  assert.strictEqual(evidence["/palettes#p003"], "Matched in color name: Gold");
});

test("an exact HEX says which colour matched, in every spelling", async () => {
  for (const q of ["#E5B44C", "e5b44c", "#e5b44c"]) {
    const { evidence, hrefs } = await search(q);
    assert.deepStrictEqual(hrefs, ["/palettes#p450"], q);
    assert.strictEqual(evidence["/palettes#p450"], "Matched in HEX: #E5B44C", q);
  }
  assert.strictEqual((await search("#333")).evidence["/palettes#p082"], "Matched in HEX: #333333");
});

test("an exact or partial palette id says it matched the palette ID", async () => {
  assert.strictEqual((await search("p450")).evidence["/palettes#p450"], "Matched in palette ID: p450");
  const partial = await search("p45");
  assert.strictEqual(partial.evidence["/palettes#p451"], "Matched in palette ID: p451");
});

test("a guide names the guide fields it matched", async () => {
  const { evidence } = await search("contrast");
  assert.strictEqual(evidence["/guide/color-contrast-systems"], "Matched in title · description");
});

test("no highlighting: no <mark> in the results, and the matched colour name is plain text in its card", async () => {
  const { grid, evidence } = await search("Azure");
  assert.doesNotMatch(grid, /<mark/i);
  assert.strictEqual(evidence["/palettes#p001"], "Matched in color name: Azure");
  const p001 = paletteCards(grid).find((card) => card.id === "p001");
  assert.ok(p001, "p001 is drawn");
  assert.ok(p001.linkHtml.split(" · ").includes("Azure"), "the card shows the colour name it matched on");
  assert.ok(!/class="card-match"/.test(grid), "no match line is drawn");
});

for (const q of ["Azure", "Kelly Green", "Gold", "modern", "earthy", "night", "dark blue", "#333", "design-system", "color-palette"]) {
  test(`every "${q}" result carries match evidence`, async () => {
    const { evidence, hrefs } = await search(q);
    assert.ok(hrefs.length > 0);
    hrefs.forEach((href) => assert.match(evidence[href] || "", /^Matched in \S/, `${href} has no evidence`));
  });
}

// ---------------------------------------------------------------------
// grouped results: Guides first, each in rank order, nothing lost
// ---------------------------------------------------------------------

// Result counts measured on production at 3f8bd0a (2026-10-08), before the
// redesign. The grouped page must show every one of them.
const BROAD_COUNTS = {
  e: { guide: 22, palette: 596 },
  a: { guide: 22, palette: 594 },
  blue: { guide: 0, palette: 98 },
  dark: { guide: 2, palette: 80 },
  green: { guide: 0, palette: 74 },
  color: { guide: 5, palette: 0 },
};

for (const [q, expected] of Object.entries(BROAD_COUNTS)) {
  test(`"${q}": every result is shown, at its own URL, with the counts measured before the redesign`, async () => {
    const s = await search(q);
    const guides = s.hrefs.filter((h) => h.startsWith("/guide/"));
    const palettes = s.hrefs.filter((h) => h.startsWith("/palettes#"));
    assert.strictEqual(guides.length, expected.guide, "guides");
    assert.strictEqual(palettes.length, expected.palette, "palettes");
    assert.strictEqual(s.hrefs.length, guides.length + palettes.length, "nothing but guides and palettes");
    assert.strictEqual(new Set(s.hrefs).size, s.hrefs.length, "nothing listed twice");
    // Each link is its record's own URL, in the shape the site uses.
    const urls = new Set(INDEX.map((r) => r.url));
    s.hrefs.forEach((h) => assert.ok(urls.has(h), `${h} is no record's URL`));
    guides.forEach((h) => assert.match(h, /^\/guide\/[a-z0-9-]+$/));
    palettes.forEach((h) => assert.match(h, /^\/palettes#p\d{3}$/));
    assert.match(s.count, new RegExp(`^${s.hrefs.length} Results? for "${q}"`));
  });
}

for (const q of [...Object.keys(BROAD_COUNTS), ...Object.keys(RANKING_60EDBBE)]) {
  test(`"${q}": grouped Guides then Palettes, each in rank order, no empty group`, async () => {
    const s = await search(q);
    const guides = s.ranked.filter((u) => u.startsWith("/guide/"));
    const palettes = s.ranked.filter((u) => u.startsWith("/palettes#"));
    assert.ok(s.ranked.length > 0, "fixture assumption: the query has results");
    // The page is the ranked list, split by type, Guides first.
    assert.deepStrictEqual(s.hrefs, guides.concat(palettes));
    const expected = [];
    if (guides.length) expected.push({ label: "Guides", count: guides.length, gridClass: "grid guides-grid", hrefs: guides });
    if (palettes.length) expected.push({ label: "Palettes", count: palettes.length, gridClass: "palettes-grid", hrefs: palettes });
    assert.deepStrictEqual(s.groups, expected);
    // The status line announces the same total, visually hidden: the group
    // headings show the counts.
    assert.match(s.count, new RegExp(`^${s.ranked.length} Results? for `));
    assert.ok(s.countVisuallyHidden);
    assert.strictEqual(s.heading, `Search results for "${q}"`);
  });
}

test("the type filter shows only that type's group; the category filter narrows within it", async () => {
  const all = await search("dark");
  const guidesOnly = await search("dark", { extra: "&type=guide" });
  const palettesOnly = await search("dark", { extra: "&type=palette" });
  assert.deepStrictEqual(guidesOnly.groups.map((g) => g.label), ["Guides"]);
  assert.deepStrictEqual(palettesOnly.groups.map((g) => g.label), ["Palettes"]);
  assert.deepStrictEqual(guidesOnly.hrefs, all.groups.find((g) => g.label === "Guides").hrefs);
  assert.deepStrictEqual(palettesOnly.hrefs, all.groups.find((g) => g.label === "Palettes").hrefs);
  // "e" matches nearly every record, so Typography gets a non-empty result (asserted
  // below): the filter must return exactly the unfiltered results that carry the
  // category, in ranked order.
  const allE = await search("e");
  const typography = await search("e", { extra: "&category=typography" });
  const expected = allE.hrefs.filter((h) => RECORD_BY_URL.get(h).categories.includes("typography"));
  assert.ok(expected.length > 0, "fixture must have Typography results");
  assert.ok(expected.length < allE.hrefs.length, "the category must actually narrow the results");
  assert.deepStrictEqual(typography.hrefs, expected);
  // Only guides carry Typography (palettes are color-theory/systems), so one group.
  assert.deepStrictEqual(typography.groups.map((g) => g.label), ["Guides"]);
});

// ---------------------------------------------------------------------
// native guide cards: the shared renderer, and its fallback
// ---------------------------------------------------------------------

const GUIDE_BY_ID = new Map(GUIDES_JSON.map((g) => [g.id, g]));

test("guide results are the shared cardHtml() card, drawn from the guide's guides.json record", async () => {
  const s = await search("color");
  const cards = guideCards(s.grid);
  const ids = s.hrefs.map((h) => h.slice("/guide/".length));
  assert.ok(cards.length > 0, "fixture assumption: guides match");
  // The page called the shared renderer once per guide result, in order...
  assert.deepStrictEqual(s.cardCalls, ids);
  // ...and drew exactly what it returns for that record: the /guides card.
  cards.forEach((html, i) => assert.strictEqual(html, CARDS.cardHtml(GUIDE_BY_ID.get(ids[i])), ids[i]));
  // So each card carries its h3 title, link, thumbnail and full meta line.
  cards.forEach((html, i) => {
    const g = GUIDE_BY_ID.get(ids[i]);
    assert.ok(html.includes(`<h3 class="card-title"><a class="card-link" href="/guide/${g.id}">`), g.id);
    assert.ok(html.includes(`<img src="${BpozzHtml.escapeHtml(g.thumbnail)}"`), `${g.id} thumbnail`);
    const meta = `${CORE_CATEGORIES[g.category].label} · ${BpozzCard.LEVEL_LABEL[g.level]} · ${g.readTime} min read`;
    assert.ok(html.includes(`<p class="card-meta">${BpozzHtml.escapeHtml(meta)}</p>`), `${g.id} meta`);
  });
  assert.ok(!s.grid.includes("undefined"));
});

test("fallback: if guides.json fails, guide results are drawn from the index, with no meta and no 'undefined'", async () => {
  const normal = await search("color");
  const s = await search("color", { guides: "fail" });
  assert.deepStrictEqual(s.hrefs, normal.hrefs, "the same guides, in the same order");
  assert.deepStrictEqual(s.cardCalls, [], "the shared cardHtml() was not used");
  assert.strictEqual(s.consoleErrors.length, 1, "the failure is logged once");
  assert.match(s.consoleErrors[0], /guides\.json/);
  const cards = guideCards(s.grid);
  assert.strictEqual(cards.length, s.hrefs.length);
  cards.forEach((html, i) => {
    const record = RECORD_BY_URL.get(s.hrefs[i]);
    assert.ok(html.startsWith('<article class="content-card"><div class="card-thumb">'), record.slug);
    assert.ok(html.includes(`<h3 class="card-title"><a class="card-link" href="${record.url}">`), record.slug);
    assert.ok(!html.includes("card-meta"), `${record.slug} has a meta line`);
  });
  assert.ok(!s.grid.includes("undefined"));
});

test("fallback, per guide: a guides.json record cardHtml() cannot print is drawn from the index instead", async () => {
  const normal = await search("color");
  const ids = normal.hrefs.map((h) => h.slice("/guide/".length));
  assert.ok(ids.length >= 4, "fixture assumption: at least four guides match");
  const [noReadTime, badLevel, badCategory] = ids;
  const guides = GUIDES_JSON.map((g) => {
    if (g.id === noReadTime) return { ...g, readTime: undefined };
    if (g.id === badLevel) return { ...g, level: "expert" };
    if (g.id === badCategory) return { ...g, category: "no-such-category" };
    return g;
  });
  const s = await search("color", { guides });
  assert.deepStrictEqual(s.hrefs, normal.hrefs);
  assert.deepStrictEqual(s.cardCalls, ids.slice(3), "only the complete records use cardHtml()");
  const cards = guideCards(s.grid);
  cards.slice(0, 3).forEach((html) => assert.ok(!html.includes("card-meta")));
  cards.slice(3).forEach((html) => assert.ok(html.includes("card-meta")));
  assert.ok(!s.grid.includes("undefined"));
});

// ---------------------------------------------------------------------
// native palette cards
// ---------------------------------------------------------------------

/** A palette's colour names joined the way /palettes and the index join them. */
const namesLine = (r) => r.colorNames.join(" · ");
const CURATED = INDEX.filter((r) => r.type === "palette" && r.title !== namesLine(r));

test("exactly the 40 palettes with a palettes-meta.json title are curated; the rest are titled by their names", () => {
  assert.strictEqual(CURATED.length, 40);
  const withMeta = PALETTES.filter((p) => p.meta).map((p) => p.id);
  assert.deepStrictEqual(CURATED.map((r) => r.slug), withMeta);
});

test('palette results are the /palettes card: four swatches in order, one link to /palettes#id, no buttons', async () => {
  const s = await search("e");
  const cards = paletteCards(s.grid);
  assert.strictEqual(cards.length, BROAD_COUNTS.e.palette);
  assert.doesNotMatch(s.grid, /<button/i, "no copy, like or save controls");
  assert.doesNotMatch(s.grid, /tabindex/i, "nothing taken out of, or added to, the tab order");
  cards.forEach((card) => {
    const r = RECORD.get(card.id);
    assert.ok(r, `${card.id} is a palette`);
    assert.strictEqual(card.anchors, 1, `${card.id}: one link`);
    assert.strictEqual(card.href, `/palettes#${r.slug}`, card.id);
    assert.deepStrictEqual(card.swatches, byId(card.id).colors, `${card.id}: swatches`);
    assert.strictEqual(card.swatches.length, 4, card.id);
    assert.ok(card.html.includes('<div class="palette-card__bars" aria-hidden="true">'), `${card.id}: decorative`);
  });
});

test("palette link text: the colour names, with the curated title first on the 40 that have one", async () => {
  const s = await search("e");
  const cards = paletteCards(s.grid);
  const curatedShown = cards.filter((card) => CURATED.some((r) => r.slug === card.id));
  assert.ok(curatedShown.length > 0, "fixture assumption: some curated palettes match");
  cards.forEach((card) => {
    const r = RECORD.get(card.id);
    const names = BpozzHtml.escapeHtml(namesLine(r));
    const expected = CURATED.includes(r)
      ? `<span class="palette-card__title">${BpozzHtml.escapeHtml(r.title)}</span> · ${names}`
      : names;
    assert.strictEqual(card.linkHtml, expected, card.id);
  });
  const p001 = paletteCards((await search("Starless")).grid).find((card) => card.id === "p001");
  assert.strictEqual(
    p001.linkHtml,
    '<span class="palette-card__title">Starless Frost</span> · Nightshade · Twilight · Ultraviolet · Azure',
  );
});

test("an invalid HEX never reaches a swatch's style attribute", async () => {
  const base = RECORD.get("p001");
  const record = { ...base, colors: ["#112233", "red;background:url(x)", "#445566", "#zzzzzz", '"><script>'] };
  const s = await search("Starless", { index: [record] });
  const [card] = paletteCards(s.grid);
  assert.deepStrictEqual(card.swatches, ["#112233", "#445566"]);
  assert.ok(!s.grid.includes("url(") && !/<script/i.test(s.grid) && !s.grid.includes("red;"));
});

test("the page markup keeps the hooks search.js and assistive tech rely on", () => {
  const html = fs.readFileSync(path.join(config.paths.root, "search.html"), "utf8");
  assert.match(html, /<h1 class="category-hero__title" id="search-heading">/);
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.strictEqual((markup.match(/<h1\b/g) || []).length, 1, "one h1");
  assert.match(html, /<div class="search-results" id="search-grid-root"><\/div>/);
  assert.match(html, /<link rel="stylesheet" href="\/palettes\/palettes.css" \/>/);
  // The type filter: a labelled group of three toggle buttons.
  const tabs = /<div\s+class="search-type-tabs"[\s\S]*?<\/div>/.exec(html)[0];
  assert.deepStrictEqual(
    [...tabs.matchAll(/data-type="([^"]*)"\s+aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]),
    [
      ["all", "true"],
      ["guide", "false"],
      ["palette", "false"],
    ],
  );
  assert.match(html, /<a href="#search-content" class="skip-link">Skip to results<\/a>/);
});
