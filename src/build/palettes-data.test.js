/**
 * palettes-data.test.js — the palette library data contract.
 *
 *     npm test
 *
 * palettes/palettes-data.json is fetched and rendered by /palettes without
 * inspection: one record is one card. The build asserts the count and id
 * range; scripts/palettes/check-palettes.js asserts everything else (valid
 * normalised hexes, no colour repeated inside a card, no two cards holding
 * the same four colours in any order, no near-duplicate of the canonical
 * p001–p300 among the added palettes).
 *
 * This file runs that validator against the real data, and against
 * deliberately broken records so a future edit that loosens a rule fails
 * here instead of passing silently.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const config = require("../../site.config.js");
const { validate } = require("../../scripts/palettes/check-palettes.js");
const M = require("../../scripts/palettes/color-math.js");

const palettes = JSON.parse(fs.readFileSync(config.paths.content.palettes, "utf8"));

test("palettes-data.json passes every palette check", () => {
  const { errors } = validate(palettes);
  assert.deepStrictEqual(errors, []);
});

test("the record count matches the contract in site.config.js", () => {
  assert.strictEqual(palettes.length, config.palettes.count);
  assert.strictEqual(palettes[palettes.length - 1].id, config.palettes.lastId);
});

// ---------------------------------------------------------------------
// the validator itself
// ---------------------------------------------------------------------

function kinds(list) {
  return new Set(validate(list).errors.map((e) => e.kind));
}

test("hex normalisation expands #rgb and uppercases", () => {
  assert.strictEqual(M.normalizeHex(" #abc "), "#AABBCC");
  assert.strictEqual(M.normalizeHex("#a1b2c3"), "#A1B2C3");
  assert.strictEqual(M.normalizeHex("#GGGGGG"), null);
});

test("order-independent duplicates are caught", () => {
  const list = palettes.slice();
  const copy = list[0];
  list.push({ ...copy, id: "px", colors: copy.colors.slice().reverse() });
  assert.ok(kinds(list).has("duplicate-palette"));
  assert.strictEqual(M.paletteDistance(
    copy.colors.map(M.hexToOklab),
    copy.colors.slice().reverse().map(M.hexToOklab),
  ), 0);
});

test("a colour repeated inside one palette is caught", () => {
  const list = palettes.slice();
  const p = list[5];
  list[5] = { ...p, colors: [p.colors[0], p.colors[0], p.colors[2], p.colors[3]] };
  assert.ok(kinds(list).has("duplicate-color"));
});

test("invalid and non-normalised hexes are caught", () => {
  const list = palettes.slice();
  list[7] = { ...list[7], colors: ["#12345", ...list[7].colors.slice(1)] };
  list[8] = { ...list[8], colors: [list[8].colors[0].toLowerCase(), ...list[8].colors.slice(1)] };
  const errors = validate(list).errors.filter((e) => e.kind === "invalid-hex");
  assert.strictEqual(errors.length, 2);
});

test("a near-duplicate of an existing palette is caught", () => {
  const list = palettes.slice();
  const base = list[0].colors;
  // Nudge every channel by one step: technically different, visually identical.
  const nudged = base.map((hex) =>
    "#" + [1, 3, 5].map((i) => {
      const v = Math.min(255, parseInt(hex.slice(i, i + 2), 16) + 1);
      return v.toString(16).padStart(2, "0").toUpperCase();
    }).join(""),
  );
  list[list.length - 1] = { ...list[list.length - 1], colors: nudged };
  assert.ok(kinds(list).has("near-duplicate"));
});

test("duplicate and out-of-sequence ids are caught", () => {
  const list = palettes.slice();
  list[10] = { ...list[10], id: list[9].id };
  const k = kinds(list);
  assert.ok(k.has("duplicate-id"));
  assert.ok(k.has("id-sequence"));
});
