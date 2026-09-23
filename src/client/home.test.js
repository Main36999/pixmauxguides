/**
 * home.test.js — pure logic coverage for the homepage palette workspace.
 *
 *     npm test
 *
 * src/client/home.js is a browser script with the same UMD shape as
 * image-picker.js: under Node `document` is undefined, so requiring it
 * returns only the pure color math and initBrowserUI() never runs.
 *
 * The build pre-renders the first palette with describe(), and the browser
 * re-renders every generated palette with the same function, so a wrong
 * conversion or contrast value here would ship in the static HTML.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const home = require("./home.js");
const colorsData = require("../../colors/colors-data.json");

/** Deterministic [0,1) source (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const library = home.prepareLibrary(colorsData);
const SEED_HEXES = ["#101010", "#2563EB", "#22A6C4", "#DBE6F7", "#F5F8FC"];
const unlocked = (hexes) => hexes.map((hex) => ({ hex, name: "", locked: false }));

test("hex / rgb / hsl conversions round-trip", () => {
  assert.deepStrictEqual(home.hexToRgb("#2563eb"), [37, 99, 235]);
  assert.strictEqual(home.rgbToHex([37, 99, 235]), "#2563EB");
  for (const c of library) {
    assert.strictEqual(home.rgbToHex(home.hslToRgb(c.hsl)), c.hex, c.name);
  }
});

test("normalizeHex rejects anything that is not #rrggbb", () => {
  assert.strictEqual(home.normalizeHex("2563eb"), "#2563EB");
  assert.throws(() => home.normalizeHex("#fff"));
  assert.throws(() => home.normalizeHex("red"));
});

test("contrast ratios match WCAG reference values", () => {
  assert.strictEqual(home.contrastRatio("#000000", "#FFFFFF").toFixed(1), "21.0");
  assert.strictEqual(home.contrastRatio("#FFFFFF", "#FFFFFF"), 1);
  // #767676 is the well-known lightest gray that passes AA on white.
  assert.ok(home.contrastRatio("#767676", "#FFFFFF") >= 4.5);
  assert.strictEqual(home.contrastGrade(7), "AAA");
  assert.strictEqual(home.contrastGrade(4.5), "AA");
  assert.strictEqual(home.contrastGrade(3.2), "AA Large");
  assert.strictEqual(home.contrastGrade(2), "Fail");
});

test("describe() picks the better-reading ink for the seed tokens", () => {
  assert.deepStrictEqual(home.describe("#2563eb", "Action blue"), {
    hex: "#2563EB",
    name: "Action blue",
    rgb: "37 99 235",
    hsl: "221° 83% 53%",
    contrast: "White 5.2:1 AA",
    ink: "#FFFFFF",
  });
  assert.strictEqual(home.describe("#F5F8FC").ink, "#101010");
});

test("every harmony mode fills every slot with a distinct, named library color", () => {
  const hexes = new Set(library.map((c) => c.hex));
  for (const mode of Object.keys(home.MODES)) {
    for (let seed = 1; seed <= 25; seed++) {
      const result = home.generatePalette(unlocked(SEED_HEXES), library, {
        mode,
        random: seeded(seed),
      });
      assert.strictEqual(result.mode, mode);
      assert.strictEqual(result.slots.length, 5);
      const out = result.slots.map((s) => s.hex);
      assert.strictEqual(new Set(out).size, 5, `${mode}/${seed} repeated a color`);
      result.slots.forEach((s) => {
        assert.ok(hexes.has(s.hex), `${s.hex} is not a library color`);
        assert.ok(s.name, "library colors carry their name");
      });
    }
  }
});

test("generated palettes read dark to light", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { slots } = home.generatePalette(unlocked(Array(5).fill("#808080")), library, {
      random: seeded(seed),
    });
    const l = slots.map((s) => home.hexToHsl(s.hex)[2]);
    assert.ok(l[0] < l[4], `seed ${seed}: first slot is not darker than the last`);
  }
});

test("locked colors are kept exactly and never duplicated", () => {
  const slots = unlocked(SEED_HEXES);
  slots[1].locked = true;
  slots[1].name = "Action blue";
  for (let seed = 1; seed <= 25; seed++) {
    const result = home.generatePalette(slots, library, { random: seeded(seed) });
    assert.deepStrictEqual(result.slots[1], {
      hex: "#2563EB",
      name: "Action blue",
      locked: true,
    });
    assert.strictEqual(result.slots.filter((s) => s.hex === "#2563EB").length, 1);
  }
});

test("a locked neutral does not anchor the harmony; a locked hue does", () => {
  const slots = unlocked(SEED_HEXES);
  slots[0].locked = true; // near-black: its hue is meaningless
  const neutral = home.pickAnchor(slots, library, seeded(3));
  assert.ok(neutral.hsl[1] >= 0.3, "fell back to a saturated library color");

  slots[1].locked = true;
  const anchor = home.pickAnchor(slots, library, seeded(3));
  assert.strictEqual(anchor.index, 1);
  assert.deepStrictEqual(anchor.hsl, home.hexToHsl("#2563EB"));
});

test("harmony targets put the anchor slot on the anchor hue", () => {
  const anchor = { index: 3, hsl: [200, 0.6, 0.5] };
  const noJitter = () => 0.5;
  for (const mode of Object.keys(home.MODES)) {
    const targets = home.harmonyTargets(anchor, mode, noJitter);
    assert.ok(home.hueDistance(targets[3][0], 200) < 1e-9, mode);
  }
  assert.throws(() => home.harmonyTargets(anchor, "rainbow"));
});

test("generation still works with no library (offline fallback)", () => {
  const { slots } = home.generatePalette(unlocked(Array(5).fill("#808080")), [], {
    random: seeded(9),
  });
  slots.forEach((s) => {
    assert.match(s.hex, /^#[0-9A-F]{6}$/);
    assert.strictEqual(s.name, "");
  });
});

test("varyColor never returns the color itself or one already in the palette", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const next = home.varyColor("#2563EB", SEED_HEXES, library, seeded(seed));
    assert.ok(!SEED_HEXES.includes(next.hex), `${next.hex} already in the palette`);
    assert.ok(next.name);
  }
});
