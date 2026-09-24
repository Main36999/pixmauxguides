/**
 * palette-meta.test.js — the Phase 4 palette metadata migration.
 *
 *     npm test
 *
 * WHAT THIS REPLACES AND WHY
 *
 * This file takes over from src/shared/tokens-a11y.test.js, which tested the
 * Colour Token accessibility scorer. That module was deleted with the
 * feature, so its tests went with it — but the suite must never be empty,
 * and the riskiest part of token removal deserves the coverage more.
 *
 * THE RISK THIS COVERS
 *
 * Palettes p001–p040 used to take their identity and search metadata from a
 * twin Colour Token, matched at build time by comparing the token's
 * background/surface/primary/secondary hexes against the palette's four
 * colours. Deleting tokens.json would have silently emptied the title,
 * description, tags and searchText of all 40 indexed palette records.
 *
 * That metadata was instead migrated verbatim into
 * palettes/palettes-meta.json. The migration is only correct if the records
 * the pipeline now builds are indistinguishable from the ones it built
 * before — so that is what is asserted here, field by field and as a whole,
 * against a fixture captured from the approved pre-removal
 * content-index.json at commit 8a29c00.
 *
 * The fixture is the contract. If a test here fails, the migration lost or
 * changed data; do not update the fixture to match.
 *
 * ONE APPROVED CORRECTION SINCE (the Pastel style contract)
 *
 * "pastel" is a recipe/style provenance label (src/build/content.js
 * styleLabels()). The legacy dark-mode copies of the Pastel palettes —
 * p007, p009, p020, p024 — inherited it from their light originals without
 * being made by the recipe, so it was removed from their tags and moods by
 * product decision. The fixture is still not edited: PASTEL_CORRECTED below
 * is the only difference allowed, and it is applied to the approved records
 * in the open. Each record's `styles` is a later field, checked on its own.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");

const APPROVED = JSON.parse(
  fs.readFileSync(
    path.join(config.paths.root, "scripts", "qa", "fixtures", "phase3-palette-records.json"),
    "utf8",
  ),
);

const model = content.load(config);
const built = content.buildContentIndex(model, config).records;
const allPalettes = built.filter((r) => r.type === "palette");
// The migrated records are the ones with a meta entry: p001–p040, first in
// the index. Every later palette is indexed from palettes-data.json alone
// (search covers all of them) and is checked in palettes-data.test.js.
const builtPalettes = allPalettes.slice(0, APPROVED.length);
const meta = JSON.parse(
  fs.readFileSync(config.paths.content.palettesMeta, "utf8"),
);

// ---------------------------------------------------------------------
// the migration itself
// ---------------------------------------------------------------------

// Colour-name search: each migrated record's searchText has the palette's
// own colour names (from palettes-data.json) appended after the approved
// text, and the record carries the same names in `colorNames`, the field
// every palette has. Everything else — every other field, and key order — is
// still exactly the approved Phase 3 record. The fixture itself is not
// edited. (colorNames: undefined keeps every other key in place and
// JSON.stringify drops it, so key ORDER is still compared exactly.)
const dataById = new Map(model.palettes.map((p) => [p.id, p]));

// The Pastel style contract (see the header): these four records drop
// "pastel" from their tags and their searchText, and nothing else.
const PASTEL_CORRECTED = ["p007", "p009", "p020", "p024"];

/** The approved record as the Pastel contract requires it. */
function contractRecord(approved) {
  if (!PASTEL_CORRECTED.includes(approved.slug)) return approved;
  return {
    ...approved,
    tags: approved.tags.filter((t) => t !== "pastel"),
    searchText: approved.searchText
      .split(" ")
      .filter((w) => w !== "pastel")
      .join(" "),
  };
}
const CONTRACT = APPROVED.map(contractRecord);

/** The approved searchText plus the colour-name words it did not already hold. */
function expectedSearchText(approved) {
  const words = approved.searchText.split(" ");
  const seen = new Set(words);
  dataById
    .get(approved.slug)
    .names.join(" ")
    .toLowerCase()
    .split(/\s+/)
    .forEach((w) => {
      if (w && !seen.has(w)) {
        seen.add(w);
        words.push(w);
      }
    });
  return words.join(" ");
}

test("every approved palette record is reproduced, plus its colour names", () => {
  assert.ok(
    allPalettes.length >= APPROVED.length,
    `built ${allPalettes.length} palette records, approved has ${APPROVED.length}`,
  );

  CONTRACT.forEach((approved, i) => {
    const actual = builtPalettes[i];
    // JSON.stringify compares key ORDER as well as values: a record with the
    // right fields in the wrong order would change content-index.json's bytes
    // and break the build's own output gate. searchText is swapped for the
    // approved value so this compares every OTHER field exactly.
    assert.strictEqual(
      JSON.stringify({ ...actual, searchText: approved.searchText, colorNames: undefined, styles: undefined }),
      JSON.stringify(approved),
      `palette record ${approved.id} differs from the approved Phase 3 record outside searchText, colorNames and styles`,
    );
    assert.deepStrictEqual(
      actual.colorNames,
      dataById.get(approved.slug).names,
      `${approved.id}: colorNames is not the palette's own colour names`,
    );
    assert.ok(
      actual.searchText === approved.searchText ||
        actual.searchText.startsWith(approved.searchText + " "),
      `${approved.id}: the approved searchText is no longer an exact prefix`,
    );
    assert.strictEqual(
      actual.searchText,
      expectedSearchText(approved),
      `${approved.id}: searchText gained something other than its own colour names`,
    );
  });
});

test("the migrated palette section is otherwise byte-identical, in order", () => {
  const withApprovedText = builtPalettes.map((r, i) => ({
    ...r,
    searchText: CONTRACT[i] && CONTRACT[i].searchText,
    colorNames: undefined,
    styles: undefined,
  }));
  assert.strictEqual(
    JSON.stringify(withApprovedText),
    JSON.stringify(CONTRACT),
    "the 40 palette records differ from the approved set as a whole",
  );
});

test("every migrated palette is findable by each of its colour names", () => {
  builtPalettes.forEach((r) => {
    dataById.get(r.slug).names.forEach((name) => {
      name
        .toLowerCase()
        .split(/\s+/)
        .forEach((w) => assert.ok(r.searchText.split(" ").includes(w), `${r.slug} is missing "${w}"`));
    });
  });
});

test("no palette record lost its borrowed metadata", () => {
  // The specific failure mode deleting tokens.json would have caused: the
  // records still exist and still have the right ids, but the fields that
  // came from the twin token are now empty.
  builtPalettes.forEach((r) => {
    assert.ok(r.title && r.title.trim(), `${r.id} has an empty title`);
    assert.ok(r.searchText && r.searchText.trim(), `${r.id} has empty searchText`);
    assert.ok(Array.isArray(r.tags) && r.tags.length, `${r.id} has no tags`);
    assert.ok(Array.isArray(r.colors) && r.colors.length === 4, `${r.id} lost its colours`);
  });
});

// ---------------------------------------------------------------------
// the Pastel style contract (src/build/content.js styleLabels())
// ---------------------------------------------------------------------

const isDarkVariant = (m) => / \(Dark\)$/.test(m.title);
const builtBySlug = new Map(builtPalettes.map((r) => [r.slug, r]));

test("FP8: the four Pastel dark variants carry no pastel, and keep every other label", () => {
  PASTEL_CORRECTED.forEach((id) => {
    const m = meta.find((x) => x.id === id);
    const approved = APPROVED.find((a) => a.slug === id);
    assert.ok(isDarkVariant(m), `${id} is not a dark variant`);
    assert.ok(approved.tags.includes("pastel"), `fixture assumption: ${id} was approved with pastel`);
    assert.ok(!m.tags.includes("pastel") && !m.moods.includes("pastel"), `${id} still carries pastel`);
    assert.deepStrictEqual(m.tags, approved.tags.filter((t) => t !== "pastel"), `${id} lost another tag`);
    assert.deepStrictEqual(m.tags, ["cool", "night", "dark"], id);
    assert.strictEqual(m.lightness, "dark", id);
    assert.deepStrictEqual(builtBySlug.get(id).styles, [], `${id} has a style`);
    assert.deepStrictEqual(builtBySlug.get(id).colors, approved.colors, `${id} colours changed`);
  });
});

test("the legacy Pastel style is exactly the Pastel recipe's own light palettes", () => {
  // Derived from the approved Phase 3 records, not a list of ids: the
  // palettes approved with pastel, minus the dark copies that inherited it.
  const direct = APPROVED.filter((a) => a.tags.includes("pastel"))
    .map((a) => meta.find((m) => m.id === a.slug))
    .filter((m) => !isDarkVariant(m))
    .map((m) => m.id);
  assert.strictEqual(direct.length, 4, "fixture assumption: four legacy Pastel recipe palettes");
  direct.forEach((id) => {
    assert.ok(meta.find((m) => m.id === id).tags.includes("pastel"), `${id} lost pastel`);
    assert.deepStrictEqual(builtBySlug.get(id).styles, ["pastel"], id);
  });
  assert.deepStrictEqual(
    builtPalettes.filter((r) => r.styles.includes("pastel")).map((r) => r.slug),
    direct,
  );
});

test("a legacy palette's styles are its recipe moods; a dark variant has none", () => {
  const darks = meta.filter(isDarkVariant);
  assert.strictEqual(darks.length, 8, "the legacy generator made eight dark variants");
  meta.forEach((m) => {
    const record = builtBySlug.get(m.id);
    if (isDarkVariant(m)) {
      // "<source> (Dark)" is the legacy generator's own naming of a copy.
      assert.ok(meta.some((s) => s.title === m.title.replace(/ \(Dark\)$/, "")), `${m.id} has no light source`);
      assert.deepStrictEqual(record.styles, [], m.id);
    } else {
      assert.deepStrictEqual(record.styles, m.moods, m.id);
    }
    // family and lightness are colour-derived labels, never styles.
    record.styles.forEach((s) => assert.ok(m.tags.includes(s) && s !== m.family && s !== m.lightness, `${m.id}: ${s}`));
  });
});

// ---------------------------------------------------------------------
// palettes-meta.json's own shape
// ---------------------------------------------------------------------

test("palettes-meta.json has one entry per migrated palette, p001–p040", () => {
  assert.strictEqual(meta.length, APPROVED.length);
  const expected = Array.from({ length: meta.length }, (_, i) =>
    "p" + String(i + 1).padStart(3, "0"),
  );
  assert.deepStrictEqual(meta.map((m) => m.id), expected);
});

test("palettes-meta.json carries no colour data", () => {
  // palettes-data.json remains the sole source of palette colours. A hex in
  // the metadata file would be a second, divergeable copy.
  meta.forEach((m) => {
    assert.ok(!("colors" in m), `${m.id} carries colors`);
    assert.ok(!("hex" in m), `${m.id} carries hex`);
    const blob = JSON.stringify(m);
    assert.ok(
      !/#[0-9a-fA-F]{6}/.test(blob),
      `${m.id} contains a hex colour literal`,
    );
  });
});

// ---------------------------------------------------------------------
// the F9 filter and the no-write rule
// ---------------------------------------------------------------------

test("every palette is indexed, in data order, the 40 with meta first", () => {
  const indexed = config.contentIndex.indexedPalettes(model.palettes);
  assert.strictEqual(model.palettes.length, config.palettes.count);
  assert.deepStrictEqual(
    indexed.map((p) => p.id),
    model.palettes.map((p) => p.id),
  );
  assert.deepStrictEqual(
    indexed.filter((p) => p.meta).map((p) => p.id),
    meta.map((m) => m.id),
  );
  assert.deepStrictEqual(
    allPalettes.map((r) => r.slug),
    model.palettes.map((p) => p.id),
  );
});

test("meta is attached at load time and never serialized into palette data", () => {
  // The guard that keeps palettes-data.json byte-identical to source: `meta`
  // must be present to the filter but invisible to JSON.stringify.
  const first = model.palettes[0];
  assert.ok(first.meta, "expected p001 to carry meta");
  assert.ok(
    !Object.keys(JSON.parse(JSON.stringify(first))).includes("meta"),
    "meta leaked into the serialized palette record",
  );

  const onDisk = JSON.parse(fs.readFileSync(config.paths.content.palettes, "utf8"));
  onDisk.forEach((p) => {
    assert.ok(!("meta" in p), `${p.id} has meta written into palettes-data.json`);
    assert.ok(!("tokenSlug" in p), `${p.id} has tokenSlug written into palettes-data.json`);
  });
});

test("a palette with no meta entry is indexed from its data, never empty", () => {
  const orphan = model.palettes.find((p) => !p.meta);
  assert.ok(orphan, "expected at least one palette without meta (p041+)");
  const [record] = content._internals.buildPaletteRecords([orphan]);
  assert.strictEqual(record.id, `palette:${orphan.id}`);
  assert.strictEqual(record.title, orphan.names.join(" · "));
  assert.deepStrictEqual(record.colorNames, orphan.names);
  assert.deepStrictEqual(record.colors, orphan.colors);
  assert.ok(record.searchText.includes(orphan.id.toLowerCase()));
  // Same key order as a migrated record, so the index has one shape.
  assert.deepStrictEqual(Object.keys(record), Object.keys(builtPalettes[0]));

  // A palette with neither meta nor names has nothing to be found by.
  assert.throws(
    () => content._internals.buildPaletteRecords([{ ...orphan, names: [] }]),
    /no colour names/,
  );
});

// ---------------------------------------------------------------------
// the rest of the index is unaffected
// ---------------------------------------------------------------------

test("the content index holds 22 guides + every palette", () => {
  const counts = {};
  built.forEach((r) => (counts[r.type] = (counts[r.type] || 0) + 1));
  assert.deepStrictEqual(counts, { guide: 22, palette: config.palettes.count });
  assert.strictEqual(built.length, config.contentIndex.expected.total);
  assert.strictEqual(
    built.filter((r) => String(r.id).startsWith("token:")).length,
    0,
    "a token record survived into the content index",
  );
});

test("the model no longer loads tokens at all", () => {
  assert.ok(!("tokens" in model), "model still exposes a tokens collection");
  assert.ok(
    !("tokens" in config.paths.content),
    "site.config.js still declares a tokens content path",
  );
});
