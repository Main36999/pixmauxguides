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
const builtPalettes = built.filter((r) => r.type === "palette");
const meta = JSON.parse(
  fs.readFileSync(config.paths.content.palettesMeta, "utf8"),
);

// ---------------------------------------------------------------------
// the migration itself
// ---------------------------------------------------------------------

test("every approved palette record is reproduced byte-identically", () => {
  assert.strictEqual(
    builtPalettes.length,
    APPROVED.length,
    `built ${builtPalettes.length} palette records, approved has ${APPROVED.length}`,
  );

  APPROVED.forEach((approved, i) => {
    const actual = builtPalettes[i];
    // JSON.stringify compares key ORDER as well as values: a record with the
    // right fields in the wrong order would change content-index.json's bytes
    // and break the build's own output gate.
    assert.strictEqual(
      JSON.stringify(actual),
      JSON.stringify(approved),
      `palette record ${approved.id} differs from the approved Phase 3 record`,
    );
  });
});

test("the whole palette section is byte-identical, in order", () => {
  assert.strictEqual(
    JSON.stringify(builtPalettes),
    JSON.stringify(APPROVED),
    "the 40 palette records differ from the approved set as a whole",
  );
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
// palettes-meta.json's own shape
// ---------------------------------------------------------------------

test("palettes-meta.json has one entry per indexed palette, p001–p040", () => {
  assert.strictEqual(meta.length, config.contentIndex.expected.palettes);
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

test("exactly the 40 palettes with a meta entry are indexed", () => {
  const indexed = config.contentIndex.indexedPalettes(model.palettes);
  assert.strictEqual(indexed.length, 40);
  assert.deepStrictEqual(
    indexed.map((p) => p.id),
    meta.map((m) => m.id),
  );
  assert.strictEqual(model.palettes.length, config.palettes.count);
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

test("a palette with no meta entry is excluded, not indexed empty", () => {
  // Widening the filter used to yield a 322-record index; the record builder
  // must refuse rather than emit a blank record.
  const orphan = model.palettes.find((p) => !p.meta);
  assert.ok(orphan, "expected at least one unindexed palette (p041+)");
  assert.throws(
    () => content._internals.buildPaletteRecords([orphan]),
    /F9 violated/,
    "buildPaletteRecords should refuse a palette with no meta entry",
  );
});

// ---------------------------------------------------------------------
// the rest of the index is unaffected
// ---------------------------------------------------------------------

test("token removal left the content-index contract at 22 guides + 40 palettes", () => {
  const counts = {};
  built.forEach((r) => (counts[r.type] = (counts[r.type] || 0) + 1));
  assert.deepStrictEqual(counts, { guide: 22, palette: 40 });
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
