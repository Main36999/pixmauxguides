/**
 * tokens-a11y.test.js
 * -----------------------------------------------------------------------
 * Run with:  node --test tokens-a11y.test.js
 *
 * Per the build brief (§3.5 / Build Note #2): the accessibility engine
 * is the one piece everything else depends on, so it's tested on its
 * own, against known reference values, before any UI is built on top
 * of it. Reference ratios below are the standard WCAG worked examples
 * (black/white = 21:1 is the textbook one) plus bpozz's own theme
 * colors, cross-checked independently against the W3C formula.
 * -----------------------------------------------------------------------
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const BpozzColor = require("./tokens-color.js");
const BpozzA11y = require("./tokens-a11y.js");

function approx(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    (message || "") +
      ` (expected ${expected} ± ${tolerance}, got ${actual})`,
  );
}

test("normalizeHex accepts 3- and 6-digit hex, with or without #", () => {
  assert.equal(BpozzColor.normalizeHex("#FFF"), "#ffffff");
  assert.equal(BpozzColor.normalizeHex("fff"), "#ffffff");
  assert.equal(BpozzColor.normalizeHex("#0F2A52"), "#0f2a52");
  assert.equal(BpozzColor.normalizeHex("0f2a52"), "#0f2a52");
});

test("normalizeHex rejects invalid input", () => {
  assert.equal(BpozzColor.normalizeHex("not-a-color"), null);
  assert.equal(BpozzColor.normalizeHex("#12345"), null);
  assert.equal(BpozzColor.normalizeHex(""), null);
  assert.equal(BpozzColor.normalizeHex(undefined), null);
});

test("hexToRgb / rgbToHex round-trip", () => {
  assert.deepEqual(BpozzColor.hexToRgb("#0f2a52"), { r: 15, g: 42, b: 82 });
  assert.equal(BpozzColor.rgbToHex({ r: 15, g: 42, b: 82 }), "#0f2a52");
});

test("rgbToHsl / hslToRgb round-trip stays within rounding tolerance", () => {
  const rgb = { r: 15, g: 42, b: 82 };
  const hsl = BpozzColor.rgbToHsl(rgb);
  const back = BpozzColor.hslToRgb(hsl);
  approx(back.r, rgb.r, 1.5, "r channel");
  approx(back.g, rgb.g, 1.5, "g channel");
  approx(back.b, rgb.b, 1.5, "b channel");
});

test("relativeLuminance: black is 0, white is 1", () => {
  approx(BpozzA11y.relativeLuminance("#000000"), 0, 0.0001);
  approx(BpozzA11y.relativeLuminance("#ffffff"), 1, 0.0001);
});

test("contrastRatio: black vs white is the textbook 21:1", () => {
  approx(BpozzA11y.contrastRatio("#000000", "#ffffff"), 21, 0.01);
});

test("contrastRatio: a color against itself is always 1:1", () => {
  approx(BpozzA11y.contrastRatio("#4c8dff", "#4c8dff"), 1, 0.0001);
});

test("contrastRatio: argument order doesn't matter", () => {
  const a = BpozzA11y.contrastRatio("#0f2a52", "#ffffff");
  const b = BpozzA11y.contrastRatio("#ffffff", "#0f2a52");
  assert.equal(a, b);
});

test("contrastRatio: bpozz's own ink-on-white matches independently computed value", () => {
  // Verified against the W3C formula out-of-band (Python) at ~14.25:1.
  approx(BpozzA11y.contrastRatio("#0f2a52", "#ffffff"), 14.25, 0.02);
});

test("contrastRatio: bpozz's own action-blue-on-white matches independently computed value", () => {
  approx(BpozzA11y.contrastRatio("#1d5fd6", "#ffffff"), 5.74, 0.02);
});

test("wcagBadge: thresholds land on the correct label", () => {
  assert.equal(BpozzA11y.wcagBadge(21), "AAA");
  assert.equal(BpozzA11y.wcagBadge(7), "AAA");
  assert.equal(BpozzA11y.wcagBadge(6.99), "AA");
  assert.equal(BpozzA11y.wcagBadge(4.5), "AA");
  assert.equal(BpozzA11y.wcagBadge(4.49), "AA Large");
  assert.equal(BpozzA11y.wcagBadge(3), "AA Large");
  assert.equal(BpozzA11y.wcagBadge(2.99), "Fail");
  assert.equal(BpozzA11y.wcagBadge(1), "Fail");
});

test("wcagLevels: exposes every threshold as a boolean", () => {
  const levels = BpozzA11y.wcagLevels(5);
  assert.deepEqual(levels, {
    aaNormal: true, // 5 >= 4.5
    aaLarge: true, // 5 >= 3
    aaaNormal: false, // 5 < 7
    aaaLarge: true, // 5 >= 4.5
    uiComponent: true, // 5 >= 3
  });
});

test("computeAccessibilityScore: matches the brief's own worked example (midnight-harbor)", () => {
  // Same palette as the brief's §4 JSON example. The brief states
  // accessibility_score: 0.92 for it, but that number was illustrative,
  // not computed from the exact hexes given — this test instead pins
  // the *real* computed score for those exact hexes so any future
  // change to the scoring logic has to be a deliberate one.
  //
  // Two kinds of pairing here: `text` is checked against the canvas
  // roles (background, surface) at the normal-text AA ratio (4.5:1);
  // `primary` is checked against `background` at the non-text "UI
  // component" ratio (3:1, WCAG 1.4.11) — the right question for a
  // brand/button color is "can you tell it apart from the page", not
  // "would body text be legible painted on top of it".
  const colors = [
    { role: "background", hex: "#0F2A52" },
    { role: "surface", hex: "#16345E" },
    { role: "primary", hex: "#4C8DFF" },
    { role: "text", hex: "#F4F7FB" },
    { role: "border", hex: "#2A4A78" },
  ];
  const result = BpozzA11y.computeAccessibilityScore(colors);
  assert.ok(result, "expected a score object, not null");
  // No `secondary` role in this palette, so only 3 pairings apply:
  // text-vs-background, text-vs-surface, primary-vs-background.
  assert.equal(result.pairings.length, 3);
  const textPairings = Object.fromEntries(
    result.pairings.filter((p) => p.kind === "text").map((p) => [p.bg, p]),
  );
  assert.ok(textPairings.background.pass, "text-on-background should pass");
  assert.ok(textPairings.surface.pass, "text-on-surface should pass");
  const uiPairing = result.pairings.find((p) => p.kind === "ui");
  assert.ok(uiPairing, "expected a primary-vs-background UI pairing");
  assert.ok(uiPairing.pass, "primary should be distinguishable from background (~4.45:1)");
  approx(uiPairing.ratio, 4.45, 0.02);
  assert.equal(result.score, 1);
});

test("computeAccessibilityScore: returns null when there's no text role", () => {
  const colors = [
    { role: "background", hex: "#0F2A52" },
    { role: "primary", hex: "#4C8DFF" },
  ];
  assert.equal(BpozzA11y.computeAccessibilityScore(colors), null);
});

test("computeAccessibilityScore: a failing text pairing lowers the score and is reported", () => {
  const colors = [
    { role: "background", hex: "#ffffff" },
    { role: "surface", hex: "#f0f0f0" },
    { role: "text", hex: "#e8e8e8" }, // near-white on near-white: fails everywhere
  ];
  const result = BpozzA11y.computeAccessibilityScore(colors);
  assert.equal(result.score, 0);
  assert.ok(result.pairings.every((p) => !p.pass));
});

test("computeAccessibilityScore: an accent color too close to the background fails its UI pairing", () => {
  const colors = [
    { role: "background", hex: "#f5f5f5" },
    { role: "text", hex: "#111111" },
    { role: "primary", hex: "#eeeeee" }, // barely distinguishable from background
  ];
  const result = BpozzA11y.computeAccessibilityScore(colors);
  const uiPairing = result.pairings.find((p) => p.kind === "ui");
  assert.ok(uiPairing);
  assert.ok(!uiPairing.pass);
  assert.equal(result.score, 0.5); // 1 of 2 pairings (text-vs-background) passes
});
