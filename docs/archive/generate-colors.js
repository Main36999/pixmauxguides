#!/usr/bin/env node
/**
 * generate-colors.js — one-off generator for colors/colors-data.json.
 *
 *     node docs/archive/generate-colors.js            # print a summary
 *     node docs/archive/generate-colors.js --write    # rewrite the data file
 *
 * Archived beside generate-palettes.js, and for the same reason: the data
 * file it produces is the committed source of truth, this script is only the
 * record of HOW that file was derived. Nothing in the build runs it, and
 * re-running it is never required to build the site.
 *
 * WHERE THE COLOURS COME FROM
 *
 * Not from nowhere. palettes/palettes-data.json already carries 1,200 colour
 * slots — 300 palettes x 4 — each with a hand-written human name in its
 * positional `names[]` array. That is 1,197 distinct hex values under 952
 * distinct names, all of it already reviewed and already shipping on
 * /palettes. The Color Library is a second reading of that same material:
 * one colour per card instead of four per row.
 *
 * So this script reads palettes-data.json, flattens it to (hex, name) pairs,
 * and selects from those. It NEVER writes to palettes-data.json, and the
 * palette feature is not aware this file exists.
 *
 * THE SELECTION, in order:
 *
 *   1. flatten every palette to its four (hex, name) pairs, in palette id
 *      order, colour index order — so the walk is deterministic.
 *   2. drop a pair whose hex has already been seen (uppercased), so no two
 *      cards can show the same colour.
 *   3. drop a pair whose NAME has already been seen, so no two cards can
 *      read the same. "Gold" appears against several hexes across the
 *      palettes; the first occurrence wins and the rest are skipped, because
 *      two cards both labelled "Gold" is worse than 200 fewer candidates.
 *   4. categorise each survivor with categoryOf() below — pure HSL, no hand
 *      assignment anywhere.
 *   5. take the first PER_CATEGORY from each of the twelve categories, in
 *      the category order the page renders its filters in. A category with
 *      fewer than PER_CATEGORY candidates contributes all of them and the
 *      shortfall is reported rather than silently backfilled.
 *   6. number the result c001.. in category order.
 *
 * WHY EVEN BUCKETS
 *
 * Because the filters are the page's primary control. Selecting the 300
 * most-liked colours instead would have left Turquoise and Brown with a
 * handful of cards each and the filter would read as broken. Even buckets
 * cost nothing here — every bucket has far more candidates than it needs.
 *
 * GROWING THE SET
 *
 * Raise PER_CATEGORY and re-run with --write. The renderer, the filters and
 * the tests are all driven by the data file's length, so 300 -> 600 is this
 * one number and nothing else. Past ~1,197 the palette colours run out and a
 * second source has to be added to `sources()`; the rest of the pipeline does
 * not care where a pair came from.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "palettes", "palettes-data.json");
const OUTPUT = path.join(ROOT, "colors", "colors-data.json");

/** Colours per category. 12 x 25 = 300. */
const PER_CATEGORY = 25;

/**
 * The category vocabulary AND the order the page lists it in — the same
 * twelve the reference uses, warm to cool to neutral. site.config.js states
 * this list as the build-time contract and src/client/colors.js states it as
 * the filter order; src/build/colors-data.test.js asserts all three agree.
 */
const CATEGORIES = [
  "Red",
  "Orange",
  "Brown",
  "Yellow",
  "Green",
  "Turquoise",
  "Blue",
  "Violet",
  "Pink",
  "White",
  "Gray",
  "Black",
];

// ---------------------------------------------------------------------
// colour maths
// ---------------------------------------------------------------------

/**
 * Raw channel spread, 0..255 — how far the colour is from a neutral gray.
 *
 * This is what the neutral rules test, NOT HSL saturation, and the
 * difference is load-bearing. HSL divides by (1 - |2L - 1|), which collapses
 * toward zero at both ends of the lightness range, so a hex two steps off
 * white reports a saturation near 100%: #FDFDFF is S=100, and #FFFAF0 is
 * S=100. Tested on S, every off-white in the source data lands in a hue
 * bucket. Tested on chroma, #FDFDFF is 2 and #FFFAF0 is 15, and both read as
 * what they look like.
 */
function chroma(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function toHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

/**
 * The one place a colour is assigned a category. Deterministic, total, and
 * derived only from HSL — no colour is ever assigned by hand.
 *
 * The three neutral rules come first and in this order, because they are the
 * ones that must win: a very dark navy is Black before it is Blue, and a
 * near-white cream is White before it is Yellow. Hue is only consulted once
 * a colour is chromatic enough for hue to mean anything.
 *
 * Brown is the one hue band that is not a simple wedge, because brown is not
 * a hue — it is dark or muted orange. So the orange/yellow wedge is split by
 * lightness and saturation instead, which is what keeps "Espresso" out of
 * Orange and "Tangerine" out of Brown.
 */
function categoryOf(hex) {
  const { h, s, l } = toHsl(hex);
  const c = chroma(hex);

  if (l <= 13) return "Black";
  if (l >= 88 && c <= 26) return "White";
  if (c <= 20) return "Gray";

  if (h >= 10 && h < 50 && (l < 42 || s < 40)) return "Brown";

  // The magenta end of the wheel splits by lightness, not by hue alone: a
  // dark wine at h=340 ("Oxblood", L=17) is a red, and only the lighter half
  // of that band reads as pink.
  if (h < 12 || h >= 345 || (h >= 305 && l < 28)) return "Red";
  if (h < 40) return "Orange";
  if (h < 66) return "Yellow";
  if (h < 160) return "Green";
  if (h < 196) return "Turquoise";
  if (h < 250) return "Blue";
  if (h < 305) return "Violet";
  return "Pink";
}

// ---------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------

/**
 * Every (hex, name) pair the project already has, deduplicated by hex and
 * then by name, in a fixed walk order. Adding a second source here is the
 * only change needed to grow past what the palettes can supply.
 */
function sources() {
  const palettes = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const pairs = [];
  const seenHex = new Set();
  const seenName = new Set();

  palettes.forEach((p) => {
    (p.colors || []).forEach((raw, i) => {
      const hex = String(raw).toUpperCase();
      const name = ((p.names || [])[i] || "").trim();
      if (!/^#[0-9A-F]{6}$/.test(hex)) return;
      if (!name) return;
      if (seenHex.has(hex) || seenName.has(name)) return;
      seenHex.add(hex);
      seenName.add(name);
      pairs.push({ hex, name, from: p.id });
    });
  });

  return pairs;
}

function select() {
  const pairs = sources();
  const buckets = new Map(CATEGORIES.map((c) => [c, []]));
  const unknown = [];

  pairs.forEach((pair) => {
    const category = categoryOf(pair.hex);
    if (!buckets.has(category)) {
      unknown.push({ ...pair, category });
      return;
    }
    buckets.get(category).push({ ...pair, category });
  });

  if (unknown.length) {
    throw new Error(
      `categoryOf() produced ${unknown.length} category name(s) outside the ` +
        `vocabulary: ${[...new Set(unknown.map((u) => u.category))].join(", ")}`,
    );
  }

  const chosen = [];
  const short = [];
  CATEGORIES.forEach((category) => {
    const available = buckets.get(category);
    if (available.length < PER_CATEGORY) {
      short.push(`${category}: ${available.length} of ${PER_CATEGORY}`);
    }
    available.slice(0, PER_CATEGORY).forEach((pair) => chosen.push(pair));
  });

  const records = chosen.map((pair, i) => ({
    id: "c" + String(i + 1).padStart(3, "0"),
    name: pair.name,
    hex: pair.hex,
    category: pair.category,
  }));

  return { records, buckets, short, candidates: pairs.length };
}

// ---------------------------------------------------------------------

function main() {
  const { records, buckets, short, candidates } = select();

  console.log(`candidates      ${candidates} unique (hex, name) pairs`);
  console.log(`selected        ${records.length} colours`);
  console.log("");
  CATEGORIES.forEach((c) => {
    const picked = records.filter((r) => r.category === c).length;
    console.log(
      `  ${c.padEnd(10)} ${String(picked).padStart(3)} selected  ` +
        `(${buckets.get(c).length} available)`,
    );
  });
  if (short.length) {
    console.log("");
    console.log("  short categories: " + short.join(", "));
  }

  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(
      OUTPUT,
      JSON.stringify(records, null, 2) + "\n",
      "utf8",
    );
    console.log("");
    console.log(`✓ ${path.relative(ROOT, OUTPUT)} — ${records.length} records`);
  } else {
    console.log("");
    console.log("  (dry run — pass --write to rewrite colors/colors-data.json)");
  }
}

if (require.main === module) main();

module.exports = { categoryOf, toHsl, select, CATEGORIES, PER_CATEGORY };
