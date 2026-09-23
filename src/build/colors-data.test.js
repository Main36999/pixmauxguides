/**
 * colors-data.test.js — the Color Library data contract (Step 10).
 *
 *     npm test
 *
 * THE RISK THIS COVERS
 *
 * colors/colors-data.json is the single source of truth for /colors, and the
 * page renders whatever is in it without inspection: one record becomes one
 * card, and a bad record becomes a bad card rather than an error. Three of
 * the ways it can go wrong are completely silent in a browser —
 *
 *   a duplicate hex      two cards, same colour, different names. Reads as a
 *                        rendering bug; is a data bug.
 *   a duplicate id       nothing visible at all, until something keys off id.
 *   a lowercase hex      renders identically, and copies a value that does
 *                        not match the one the rest of the file uses.
 *
 * — so none of them can be left to be noticed by looking at the page.
 *
 * WHAT THIS ASSERTS THAT THE BUILD DOES NOT
 *
 * Most of it the build already refuses: src/build/content.js validates every
 * record's shape in `load`, and build.js's `load` stage asserts the count and
 * the id range. This file exists for the two things a build cannot check.
 *
 * The first is that the VALIDATOR still works. Every rule below is also
 * exercised against a deliberately broken record, so a future edit that
 * loosens validateColors() — drops the uniqueness check, widens the hex
 * pattern — fails here. A validator nothing tests is a validator that can
 * quietly stop validating, and every build would still be green.
 *
 * The second is the three-way agreement on the category vocabulary. It is
 * declared in site.config.js (the build contract), in src/client/colors.js
 * (the filter order, because a browser cannot read site.config.js) and
 * implicitly in the data. Nothing at build time reads the client file, so
 * only a test can hold the three together. This is the same reasoning
 * src/build/head.test.js applies to the marker pairs: two independent
 * declarations checked against each other beat one shared constant whose
 * drift nobody can see.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");

const LABEL = "colors-data.json";
const SOURCE = config.paths.content.colors;
const colors = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const HEX_RE = new RegExp(config.colors.hexPattern);

/** A record known to be good, used as the base for the broken ones below. */
const VALID = { id: "c001", name: "Rosewood", hex: "#9C6D6B", category: "Red" };

/** Asserts that validateColors rejects `records`, and says what it caught. */
function rejects(records, because) {
  assert.throws(
    () => content.validateColors(records, LABEL, config),
    (err) => err instanceof Error && err.message.includes(LABEL),
    `validateColors accepted ${because} — the rule that catches it is gone`,
  );
}

// ---------------------------------------------------------------------
// 1. the data itself
// ---------------------------------------------------------------------

test("the committed data satisfies its own validator", () => {
  // If this fails, every other test in this file is measuring the wrong
  // thing, so it runs first.
  assert.doesNotThrow(() => content.validateColors(colors, LABEL, config));
});

test("the record count matches the contract in site.config.js", () => {
  assert.strictEqual(
    colors.length,
    config.colors.count,
    `${colors.length} records, site.config.js says ${config.colors.count}. ` +
      `Growing the library means editing both.`,
  );
});

test("ids run c001..c300 with no gap, duplicate or reordering", () => {
  const expected = Array.from(
    { length: config.colors.count },
    (_, i) => "c" + String(i + 1).padStart(3, "0"),
  );
  assert.deepStrictEqual(
    colors.map((c) => c.id),
    expected,
    "the id sequence is broken — ids are positional and the first mismatch " +
      "is where it starts",
  );
  assert.strictEqual(colors[0].id, config.colors.firstId);
  assert.strictEqual(colors[colors.length - 1].id, config.colors.lastId);
});

test("every id is unique", () => {
  const ids = colors.map((c) => c.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert.deepStrictEqual(dupes, [], `duplicate ids: ${dupes.join(", ")}`);
});

test("every name is a non-empty string, and no name is used twice", () => {
  colors.forEach((c) => {
    assert.strictEqual(
      typeof c.name,
      "string",
      `${c.id} has a non-string name`,
    );
    assert.ok(c.name.trim(), `${c.id} has an empty name`);
    assert.strictEqual(
      c.name,
      c.name.trim(),
      `${c.id} name "${c.name}" has leading or trailing whitespace`,
    );
  });

  // Not a schema rule — validateColors deliberately permits it, because two
  // genuinely different colours could one day want the same word. It is
  // asserted HERE because on a browsable grid it is a real defect: two cards
  // reading "Gold" with different swatches is indistinguishable from a bug.
  const names = colors.map((c) => c.name);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  assert.deepStrictEqual(
    dupes,
    [],
    `${dupes.length} name(s) used by more than one colour: ${dupes.join(", ")}`,
  );
});

test("every hex is valid, uppercase and six digits", () => {
  colors.forEach((c) => {
    assert.ok(
      HEX_RE.test(c.hex),
      `${c.id} ("${c.name}") has hex ${JSON.stringify(c.hex)}, which does ` +
        `not match ${config.colors.hexPattern}`,
    );
    // Stated separately from the pattern so the failure names the actual
    // problem: a lowercase hex fails the pattern too, but "does not match
    // ^#[0-9A-F]{6}$" is a worse message than "is not uppercase".
    assert.strictEqual(
      c.hex,
      c.hex.toUpperCase(),
      `${c.id} ("${c.name}") has a lowercase hex — the contract is uppercase`,
    );
  });
});

test("every hex is unique", () => {
  const hexes = colors.map((c) => c.hex);
  const dupes = [...new Set(hexes.filter((h, i) => hexes.indexOf(h) !== i))];
  assert.deepStrictEqual(
    dupes,
    [],
    `${dupes.length} hex value(s) appear more than once: ${dupes.join(", ")}`,
  );
});

test("every record has exactly the four contracted fields", () => {
  // An extra field is not harmful, but it is undocumented data that the page
  // does not render and nothing validates — the kind of thing that becomes
  // load-bearing by accident. The schema is four fields; this keeps it four.
  const expected = ["category", "hex", "id", "name"];
  colors.forEach((c) => {
    assert.deepStrictEqual(
      Object.keys(c).sort(),
      expected,
      `${c.id} has fields ${Object.keys(c).sort().join(", ")} — the schema ` +
        `is exactly ${expected.join(", ")}`,
    );
  });
});

test("every category is one site.config.js names", () => {
  const allowed = new Set(config.colors.categories);
  colors.forEach((c) => {
    assert.ok(
      allowed.has(c.category),
      `${c.id} ("${c.name}") is in category ${JSON.stringify(c.category)}, ` +
        `which is not one of: ${config.colors.categories.join(", ")}`,
    );
  });
});

test("every declared category has at least one colour in it", () => {
  // The inverse of the rule above, and the one that catches a category
  // rendering a filter chip that selects nothing.
  const used = new Set(colors.map((c) => c.category));
  const empty = config.colors.categories.filter((c) => !used.has(c));
  assert.deepStrictEqual(
    empty,
    [],
    `${empty.length} category/categories have no colours and would render an ` +
      `empty filter: ${empty.join(", ")}`,
  );
});

// ---------------------------------------------------------------------
// 2. the vocabulary is the same in all three places
// ---------------------------------------------------------------------

test("src/client/colors.js lists the same categories as site.config.js", () => {
  // Read as text, not required: it is browser code in an IIFE with no
  // exports, exactly like src/client/palettes.js. The array literal is the
  // thing under test, so lifting it out of the source is the honest way to
  // compare it.
  const src = fs.readFileSync(
    path.join(config.paths.client, "colors.js"),
    "utf8",
  );
  const block = src.match(/var CATEGORY_ORDER = \[([\s\S]*?)\];/);
  assert.ok(
    block,
    "src/client/colors.js no longer declares a CATEGORY_ORDER array — if the " +
      "filter order moved, this test has to move with it",
  );
  const clientOrder = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  assert.deepStrictEqual(
    clientOrder,
    config.colors.categories,
    "the filter order in src/client/colors.js and the vocabulary in " +
      "site.config.js have drifted apart. A category in one and not the " +
      "other either renders a chip that filters nothing, or is data with no " +
      "control at all.",
  );
});

// ---------------------------------------------------------------------
// 3. the validator still rejects what it claims to reject
// ---------------------------------------------------------------------

test("validateColors rejects a malformed record", () => {
  rejects([null], "a null record");
  rejects(["#FFFFFF"], "a string where a record belongs");
  rejects({ id: "c001" }, "an object instead of an array");
});

test("validateColors rejects a bad id", () => {
  rejects([{ ...VALID, id: "1" }], "an id that is not c-prefixed");
  rejects([{ ...VALID, id: "" }], "an empty id");
  rejects([{ ...VALID, id: 1 }], "a numeric id");
});

test("validateColors rejects a duplicate id", () => {
  rejects(
    [VALID, { ...VALID, hex: "#123456", name: "Other" }],
    "two records sharing an id",
  );
});

test("validateColors rejects an empty name", () => {
  rejects([{ ...VALID, name: "" }], "an empty name");
  rejects([{ ...VALID, name: "   " }], "a whitespace-only name");
});

test("validateColors rejects a hex that breaks the contract", () => {
  rejects([{ ...VALID, hex: "#9c6d6b" }], "a lowercase hex");
  rejects([{ ...VALID, hex: "9C6D6B" }], "a hex with no leading #");
  rejects([{ ...VALID, hex: "#9C6D6" }], "a five-digit hex");
  rejects([{ ...VALID, hex: "#9C6D6BB" }], "a seven-digit hex");
  rejects([{ ...VALID, hex: "#GGGGGG" }], "a hex with non-hex digits");
});

test("validateColors rejects a duplicate hex", () => {
  rejects(
    [VALID, { ...VALID, id: "c002", name: "Other" }],
    "two records sharing a hex",
  );
});

test("validateColors rejects an unknown category", () => {
  rejects([{ ...VALID, category: "Chartreuse" }], "a category off the list");
  rejects([{ ...VALID, category: "red" }], "a category in the wrong case");
  rejects([{ ...VALID, category: undefined }], "a missing category");
});

// ---------------------------------------------------------------------
// 4. the page is wired to the data
// ---------------------------------------------------------------------

test("the model carries the colours and the page is a route", () => {
  const model = content.load(config);
  assert.strictEqual(model.colors.length, config.colors.count);

  const table = require("./routes.js").build(model);
  const colorsRoute = table.find((r) => r.url === "/colors/");
  assert.ok(colorsRoute, "/colors/ is not in the route table");
  assert.strictEqual(colorsRoute.file, "colors/index.html");
  assert.strictEqual(colorsRoute.type, "section");

  // The existing section pages must still be there. This is the whole point
  // of the feature being additive.
  ["/palettes/", "/guides/", "/search.html", "/"].forEach((url) => {
    assert.ok(
      table.some((r) => r.url === url),
      `${url} is no longer in the route table`,
    );
  });
});

test("the data file is published at the exact URL the page fetches", () => {
  // The fetch URL and the publish path are set in two different files and
  // nothing but this test connects them. Getting it wrong costs an empty
  // grid and a 404 in the console — which is exactly what browser QA found
  // on the first run, when the fetch was relative.
  const build = require("./build.js");
  const entry = build.PUBLISH_FILES.find(
    (f) => f.to === "colors/colors-data.json",
  );
  assert.ok(
    entry,
    "colors-data.json is not in PUBLISH_FILES — the page would fetch a 404",
  );
  assert.strictEqual(entry.from, "colors/colors-data.json");

  const client = fs.readFileSync(
    path.join(config.paths.client, "colors.js"),
    "utf8",
  );
  assert.ok(
    client.includes('fetch("/' + entry.to + '")'),
    `src/client/colors.js does not fetch "/${entry.to}" — the fetch URL and ` +
      `the published path have to name the same file`,
  );
  // The relative form is the specific bug this guards against: it resolves
  // against the site root when the page is served at /colors rather than
  // /colors/, and asks for /colors-data.json.
  assert.ok(
    !client.includes('fetch("./'),
    "src/client/colors.js fetches a RELATIVE URL. At /colors (no trailing " +
      "slash) that resolves against the site root and 404s — see the note " +
      "on the fetch call.",
  );
});
