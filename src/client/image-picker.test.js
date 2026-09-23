/**
 * image-picker.test.js — pure logic coverage for /image-picker.
 *
 *     npm test
 *
 * image-picker.js is a browser bundle (its own <script> tag, never added to
 * /app.js — see that file's header comment) with no build-time reader, so
 * nothing else in the test suite touches it. Its extraction/export math is
 * plain, DOM-free functions, wrapped in the same UMD shape src/shared/html.js
 * uses, so requiring it here (`document` is undefined under plain Node)
 * returns only that pure surface — initBrowserUI() never runs.
 *
 * THE EDGE CASE THIS EXISTS TO PIN DOWN
 *
 * medianCutBuckets()'s range-based recipes (the default on page load) used
 * to stall as soon as every remaining bucket had zero color range — which a
 * flat or near-monochrome image hits immediately, since every pixel's
 * channel range is 0. The palette count control could then show "8" while
 * only 1 swatch actually rendered. The fix (a population-based fallback,
 * see medianCutBuckets()'s own comment) is the one thing here asserted both
 * directly (on medianCutBuckets) and through the public buildPalette() path.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const ip = require("./image-picker.js");

// ---- fixtures ------------------------------------------------------------

/** N pixels spread across a wide color range, so range-based splitting has
 * real work to do — the "normal photo" case every fix must leave alone. */
function variedPixels(n) {
  const pixels = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pixels.push([
      Math.round(255 * t), // r sweeps 0..255
      Math.round(255 * (1 - t)), // g sweeps 255..0
      Math.round(255 * Math.abs(0.5 - t) * 2), // b bows 0..255..0
      t,
      1 - t,
    ]);
  }
  return pixels;
}

/** N pixels, all the exact same flat color — the case medianCutBuckets()
 * used to stall on. */
function uniformPixels(n, rgb) {
  const pixels = [];
  for (let i = 0; i < n; i++) {
    pixels.push([rgb[0], rgb[1], rgb[2], i / n, 0.5]);
  }
  return pixels;
}

const HEX_RE = /^#[0-9A-F]{6}$/;

// ---- medianCutBuckets(): the monochrome/flat-image fix --------------------

test("medianCutBuckets reaches the requested count on a uniform pixel pool (range recipe)", () => {
  const pixels = uniformPixels(200, [128, 128, 128]);
  const rangeRecipe = ip.RECIPES[0]; // { splitBy: "range", ... } — the stalling case
  assert.strictEqual(rangeRecipe.splitBy, "range");
  const buckets = ip.medianCutBuckets(pixels, 8, rangeRecipe);
  assert.strictEqual(buckets.length, 8);
});

test("medianCutBuckets still reaches the requested count on a uniform pool (population recipe, unchanged path)", () => {
  const pixels = uniformPixels(200, [10, 200, 40]);
  const popRecipe = ip.RECIPES[1]; // { splitBy: "population", ... } — never needed the fallback
  assert.strictEqual(popRecipe.splitBy, "population");
  const buckets = ip.medianCutBuckets(pixels, 8, popRecipe);
  assert.strictEqual(buckets.length, 8);
});

test("medianCutBuckets on varied pixels behaves the same with or without the fallback path available", () => {
  const pixels = variedPixels(400);
  for (const recipe of ip.RECIPES) {
    const buckets = ip.medianCutBuckets(pixels, 6, recipe);
    assert.strictEqual(
      buckets.length,
      6,
      `recipe ${JSON.stringify(recipe)} should reach 6 buckets on a varied pool`,
    );
  }
});

test("medianCutBuckets degrades gracefully when the pool is smaller than the requested count", () => {
  const pixels = uniformPixels(2, [50, 50, 50]);
  const buckets = ip.medianCutBuckets(pixels, 8, ip.RECIPES[0]);
  // Only 2 pixels exist — it cannot invent 8 buckets, and must not crash or
  // loop forever trying to.
  assert.strictEqual(buckets.length, 2);
});

// ---- buildPalette(): the public path the UI actually calls ----------------

test("buildPalette returns exactly `count` swatches for a varied image, for every recipe", () => {
  const pixels = variedPixels(500);
  for (const recipe of ip.RECIPES) {
    const palette = ip.buildPalette(pixels, ip.MAX_COUNT, recipe);
    assert.strictEqual(palette.length, ip.MAX_COUNT);
    palette.forEach((p) => assert.match(p.hex, HEX_RE));
  }
});

test("buildPalette honors the requested count on a flat/near-monochrome image instead of stopping short", () => {
  const pixels = uniformPixels(300, [90, 90, 90]);
  for (const count of [ip.MIN_COUNT, 5, ip.MAX_COUNT]) {
    const palette = ip.buildPalette(pixels, count, ip.RECIPES[0]);
    assert.strictEqual(
      palette.length,
      count,
      `expected ${count} swatches from a flat image, got ${palette.length}`,
    );
    palette.forEach((p) => assert.match(p.hex, HEX_RE));
  }
});

test("buildPalette keeps the documented 3-8 palette count range", () => {
  assert.strictEqual(ip.MIN_COUNT, 3);
  assert.strictEqual(ip.MAX_COUNT, 8);
  assert.ok(ip.DEFAULT_COUNT >= ip.MIN_COUNT && ip.DEFAULT_COUNT <= ip.MAX_COUNT);
});

// ---- dedupeColors() --------------------------------------------------------

test("dedupeColors nudges identical colors apart instead of leaving true duplicates", () => {
  const points = [
    { rgb: [100, 100, 100], fx: 0, fy: 0 },
    { rgb: [100, 100, 100], fx: 1, fy: 1 },
  ];
  assert.strictEqual(ip.colorDistance(points[0].rgb, points[1].rgb), 0);
  const result = ip.dedupeColors(points);
  assert.ok(
    ip.colorDistance(result[0].rgb, result[1].rgb) >= ip.DEDUPE_MIN_DISTANCE,
    "dedupeColors should separate two identical colors past DEDUPE_MIN_DISTANCE",
  );
  // No randomness: the same input always nudges the same way.
  const again = ip.dedupeColors([
    { rgb: [100, 100, 100], fx: 0, fy: 0 },
    { rgb: [100, 100, 100], fx: 1, fy: 1 },
  ]);
  assert.deepStrictEqual(again, result);
});

test("dedupeColors leaves already-distinct colors untouched", () => {
  const points = [
    { rgb: [10, 10, 10], fx: 0, fy: 0 },
    { rgb: [240, 240, 240], fx: 1, fy: 1 },
  ];
  const result = ip.dedupeColors(points);
  assert.deepStrictEqual(result[0].rgb, [10, 10, 10]);
  assert.deepStrictEqual(result[1].rgb, [240, 240, 240]);
});

// ---- export builders --------------------------------------------------------

test("buildCssVariables emits one custom property per hex, in order", () => {
  const css = ip.buildCssVariables(["#FF0000", "#00FF00"]);
  assert.strictEqual(
    css,
    ":root {\n" +
      "  --image-picker-color-1: #FF0000;\n" +
      "  --image-picker-color-2: #00FF00;\n" +
      "}",
  );
});

test("buildCodeSnippet is a plain JSON array of the hex strings", () => {
  const hexes = ["#FF0000", "#00FF00", "#0000FF"];
  const code = ip.buildCodeSnippet(hexes);
  assert.strictEqual(code, JSON.stringify(hexes, null, 2));
  assert.deepStrictEqual(JSON.parse(code), hexes);
});

test("buildTailwindSnippet emits one color entry per hex, in order", () => {
  const tw = ip.buildTailwindSnippet(["#FF0000"]);
  assert.strictEqual(tw, "colors: {\n  'image-picker-color-1': '#FF0000',\n}");
});

test("buildSvgMarkup emits one rect per hex, sized and positioned by index", () => {
  const svg = ip.buildSvgMarkup(["#FF0000", "#00FF00"]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="128" height="64"/);
  assert.match(svg, /<rect x="0" y="0" width="64" height="64" fill="#FF0000"\/>/);
  assert.match(svg, /<rect x="64" y="0" width="64" height="64" fill="#00FF00"\/>/);
  assert.strictEqual((svg.match(/<rect/g) || []).length, 2);
});

// ---- cache key --------------------------------------------------------------

test("cacheKey encodes recipe index and count distinctly", () => {
  assert.strictEqual(ip.cacheKey(0, 5), "0:5");
  assert.strictEqual(ip.cacheKey(2, 5), "2:5");
  assert.notStrictEqual(ip.cacheKey(0, 5), ip.cacheKey(0, 6));
});

// ---- upload size guard constant ---------------------------------------------

test("MAX_UPLOAD_BYTES is a ~20-25MB ceiling", () => {
  assert.strictEqual(typeof ip.MAX_UPLOAD_BYTES, "number");
  assert.ok(ip.MAX_UPLOAD_BYTES >= 20 * 1024 * 1024);
  assert.ok(ip.MAX_UPLOAD_BYTES <= 25 * 1024 * 1024);
});

// ---- module never touches the DOM under plain Node --------------------------

test("requiring image-picker.js under Node does not throw (no `document` access at load time)", () => {
  // If this test file loaded at all, the require() above already proved it;
  // this assertion exists so the guarantee has its own name in the report.
  assert.strictEqual(typeof ip, "object");
});
