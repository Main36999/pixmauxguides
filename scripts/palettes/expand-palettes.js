#!/usr/bin/env node
/**
 * expand-palettes.js — grows palettes/palettes-data.json to TARGET records.
 *
 *     node scripts/palettes/expand-palettes.js           # dry run, prints report
 *     node scripts/palettes/expand-palettes.js --write   # rewrites the data file
 *
 * WHAT IT PRESERVES
 *
 * The first BASE records (p001..p300) are canonical and are never touched:
 * the script reads them, keeps them byte-for-byte as objects, and generates
 * only p301..p{TARGET}. Re-running it is safe — it discards anything after
 * p300 and regenerates the same tail (seeded PRNG, no Math.random), so the
 * output is byte-identical run to run.
 *
 * HOW PALETTES ARE MADE
 *
 * Not random RGB. Every palette comes from a named THEME recipe (editorial,
 * ocean, retro, UI-friendly, …) that fixes the roles, lightness bands and
 * chroma of its four colours in OKLCH and relates their hues by a harmony
 * rule (analogous, complementary, split-complementary, triadic, tetradic,
 * monochromatic tonal). Out-of-gamut colours lose chroma, not hue.
 *
 * A candidate is rejected unless:
 *   - its four hexes are distinct and at least MIN_INTERNAL ΔEok apart, so
 *     every swatch on the card reads as a different colour;
 *   - its order-independent palette distance to EVERY existing and already
 *     accepted palette is at least MIN_DISTANCE ΔEok (see color-math.js);
 *   - it passes its theme's own contrast rule where the theme has one.
 *
 * Names are per-colour, like the existing records: the nearest name from
 * the site's own vocabulary (the 1,200 hand-named palette colours) when
 * one is genuinely close, otherwise a descriptive name composed from the
 * colour's hue family, lightness and chroma.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const M = require("./color-math.js");

const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "palettes", "palettes-data.json");

const BASE = 300;
const TARGET = 600;
const MIN_DISTANCE = 6; // palette-to-palette, mean matched ΔEok
const MIN_INTERNAL = 9; // between any two colours inside one palette
const NAME_MATCH = 3.5; // reuse a site name only if this close
const DATE_FROM = "2025-01-03"; // the existing createdAt range
const DATE_TO = "2026-09-14";

// ---------------------------------------------------------------------
// seeded PRNG (mulberry32) — same generator the archived seed script used
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260923);
const rand = (lo, hi) => lo + rng() * (hi - lo);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const wrap = (h) => ((h % 360) + 360) % 360;
const jit = (v, s) => v + rand(-s, s);

// ---------------------------------------------------------------------
// WCAG contrast, for the themes that promise legibility
// ---------------------------------------------------------------------
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------------------------------------------------------------------
// themes — see themes.js. `hue` is a per-theme rotating seed (golden-angle
// stepped) so a theme that may use any hue walks the whole wheel.
// ---------------------------------------------------------------------
const THEMES = require("./themes.js")({ rand, pick, contrast });

// ---------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------
const FAMILY_NOUNS = {
  red: ["Crimson", "Scarlet", "Cherry", "Poppy", "Cardinal", "Garnet", "Ruby", "Vermilion", "Lacquer Red", "Pomegranate"],
  coral: ["Coral", "Salmon", "Persimmon", "Flamingo", "Guava", "Watermelon", "Grapefruit", "Papaya"],
  orange: ["Tangerine", "Marigold", "Apricot", "Pumpkin", "Saffron", "Mandarin", "Kumquat", "Cantaloupe"],
  brown: ["Cinnamon", "Chestnut", "Walnut", "Cocoa", "Umber", "Hazel", "Toffee", "Pecan", "Sienna", "Mocha", "Cedar", "Leather"],
  tan: ["Sand", "Camel", "Biscuit", "Oat", "Fawn", "Parchment", "Dune", "Straw", "Wheat", "Almond"],
  yellow: ["Lemon", "Canary", "Butter", "Sunflower", "Mustard", "Honey", "Dandelion", "Goldenrod", "Buttercup", "Primrose"],
  olive: ["Olive", "Moss", "Pistachio", "Artichoke", "Khaki", "Lichen", "Bay Leaf", "Celery"],
  lime: ["Lime", "Chartreuse", "Kiwi", "Matcha", "Sprout", "Fern", "Clover", "Leaf"],
  green: ["Emerald", "Jade", "Malachite", "Basil", "Pine", "Spruce", "Juniper", "Ivy", "Evergreen", "Shamrock"],
  mint: ["Mint", "Seafoam", "Aloe", "Celadon", "Spearmint", "Eucalyptus", "Sage"],
  teal: ["Teal", "Lagoon", "Verdigris", "Peacock", "Tidepool", "Mallard", "Deep Lake"],
  cyan: ["Aqua", "Turquoise", "Cyan", "Caribbean", "Glacier", "Surf", "Pool"],
  blue: ["Cobalt", "Sapphire", "Azure", "Cornflower", "Denim", "Harbor", "Lapis", "Prussian", "Delft", "Bluebell", "Marine", "Admiral"],
  indigo: ["Indigo", "Ultramarine", "Midnight", "Iris", "Twilight", "Periwinkle", "Bluebird", "Nightfall"],
  violet: ["Violet", "Amethyst", "Lavender", "Wisteria", "Heather", "Grape", "Aubergine", "Lilac", "Mulberry"],
  magenta: ["Magenta", "Fuchsia", "Orchid", "Boysenberry", "Dragonfruit", "Hibiscus", "Plum", "Bougainvillea"],
  pink: ["Rose", "Peony", "Blush", "Carnation", "Petal", "Raspberry", "Bubblegum", "Camellia", "Sorbet"],
  wine: ["Burgundy", "Merlot", "Claret", "Bordeaux", "Oxblood", "Cranberry", "Maroon"],
  neutralWarm: ["Linen", "Ivory", "Stone", "Putty", "Taupe", "Greige", "Mushroom", "Driftwood", "Pebble", "Flax"],
  neutralCool: ["Pewter", "Slate", "Ash", "Steel", "Graphite", "Fog", "Concrete", "Zinc", "Nickel", "Flint"],
  neutral: ["Chalk", "Porcelain", "Smoke", "Charcoal", "Carbon", "Silver", "Cement", "Granite", "Pumice", "Onyx"],
};

function familyOf(L, C, h) {
  if (C < 0.025) {
    if (C < 0.012) return "neutral";
    return h >= 30 && h < 120 ? "neutralWarm" : h >= 180 && h < 290 ? "neutralCool" : "neutral";
  }
  if (h < 20 || h >= 350) return L < 0.42 ? "wine" : L > 0.7 ? "pink" : "red";
  if (h < 45) {
    if (L < 0.5 || (C < 0.08 && L < 0.7)) return "brown";
    return C < 0.08 ? "tan" : "coral";
  }
  if (h < 75) {
    if (L < 0.55) return "brown";
    return C < 0.08 ? "tan" : "orange";
  }
  if (h < 110) {
    if (L < 0.55 || C < 0.07) return C < 0.07 && L > 0.7 ? "tan" : "olive";
    return "yellow";
  }
  if (h < 135) return C < 0.08 ? "olive" : "lime";
  if (h < 165) return L > 0.8 && C < 0.1 ? "mint" : "green";
  if (h < 185) return L > 0.8 ? "mint" : "teal";
  if (h < 215) return L < 0.45 ? "teal" : "cyan";
  if (h < 265) return "blue";
  if (h < 290) return "indigo";
  if (h < 320) return "violet";
  if (h < 335) return L < 0.4 ? "wine" : "magenta";
  return L < 0.42 ? "wine" : "pink";
}

function modifierFor(L, C) {
  if (C >= 0.19 && L > 0.6) return pick(["Electric", "Neon", "Vivid", "Bright"]);
  if (L >= 0.93) return pick(["Pale", "Whisper", "Washed"]);
  if (L >= 0.84) return pick(["Soft", "Powder", "Light", "Airy", "Chalk"]);
  if (L <= 0.2) return pick(["Deep", "Midnight", "Ink", "Night", "Shadow"]);
  if (L <= 0.34) return pick(["Dark", "Smoked", "Dusk", "Forest", "Iron"]);
  if (C < 0.06) return pick(["Dusty", "Muted", "Faded", "Weathered", "Hushed"]);
  if (C >= 0.15) return pick(["Bold", "Rich", "True", "Clear", "Radiant"]);
  return "";
}

function makeNamer(existing) {
  const ref = [];
  existing.forEach((p) =>
    p.colors.forEach((hex, i) => {
      if (p.names && p.names[i]) ref.push({ lab: M.hexToOklab(hex), name: p.names[i] });
    }),
  );
  return function nameColors(hexes) {
    const used = new Set();
    return hexes.map((hex) => {
      const lab = M.hexToOklab(hex);
      const ranked = ref
        .map((r) => ({ d: M.deltaE(lab, r.lab), name: r.name }))
        .filter((r) => r.d <= NAME_MATCH && !used.has(r.name))
        .sort((a, b) => a.d - b.d);
      let name = ranked.length ? ranked[0].name : null;
      if (!name) {
        const [L, C, h] = M.hexToOklch(hex);
        const nouns = FAMILY_NOUNS[familyOf(L, C, h)];
        for (let tries = 0; tries < 40 && (!name || used.has(name)); tries++) {
          const noun = pick(nouns);
          const mod = modifierFor(L, C);
          name = mod && !noun.includes(mod) && tries < 30 ? `${mod} ${noun}` : noun;
        }
      }
      used.add(name);
      return name;
    });
  };
}

// ---------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------
function specToHexes(spec) {
  return spec.map(([L, C, h]) => M.oklchToHex(L, Math.max(0, C), wrap(h)));
}

function internallyDistinct(hexes) {
  if (new Set(hexes).size !== hexes.length) return false;
  const labs = hexes.map(M.hexToOklab);
  for (let i = 0; i < labs.length; i++)
    for (let j = i + 1; j < labs.length; j++)
      if (M.deltaE(labs[i], labs[j]) < MIN_INTERNAL) return false;
  return true;
}

function randomDate() {
  const a = Date.parse(DATE_FROM + "T00:00:00Z");
  const b = Date.parse(DATE_TO + "T00:00:00Z");
  const day = 86400000;
  const t = a + Math.floor(rng() * ((b - a) / day + 1)) * day;
  return new Date(t).toISOString().slice(0, 10);
}

function generate(existing) {
  const need = TARGET - existing.length;
  const accepted = existing.map((p) => ({
    key: M.canonicalKey(p.colors),
    labs: p.colors.map(M.hexToOklab),
  }));
  const keys = new Set(accepted.map((a) => a.key));

  // Even quota per theme; the remainder goes to the first themes in order.
  const quota = THEMES.map((_, i) => Math.floor(need / THEMES.length) + (i < need % THEMES.length ? 1 : 0));
  const hueSeed = THEMES.map((_, i) => (i * 47) % 360);
  const made = [];
  const stats = { tried: 0, internal: 0, near: 0, check: 0 };

  // Round-robin across themes so no theme exhausts the easy regions first.
  // A theme that cannot place a distinct palette in ATTEMPTS tries is full:
  // its leftover quota moves, one at a time, to the themes still producing,
  // so no theme is ever forced into near-duplicates to hit its share.
  const ATTEMPTS = 600;
  const CAP = Math.ceil(need / THEMES.length) * 2; // no theme above ~2× its share
  const exhausted = new Set();
  const perTheme = THEMES.map(() => 0);
  let progress = true;
  while (made.length < need && progress) {
    progress = false;
    THEMES.forEach((theme, t) => {
      if (quota[t] === 0 || exhausted.has(t)) return;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        stats.tried++;
        hueSeed[t] = wrap(hueSeed[t] + 137.508); // golden angle
        const hexes = specToHexes(theme.make(hueSeed[t] + rand(-12, 12)));
        if (!internallyDistinct(hexes)) {
          stats.internal++;
          continue;
        }
        if (theme.check && !theme.check(hexes)) {
          stats.check++;
          continue;
        }
        const key = M.canonicalKey(hexes);
        if (keys.has(key)) continue;
        const labs = hexes.map(M.hexToOklab);
        if (accepted.some((a) => M.paletteDistance(labs, a.labs) < MIN_DISTANCE)) {
          stats.near++;
          continue;
        }
        keys.add(key);
        accepted.push({ key, labs });
        made.push({ theme: theme.name, colors: hexes });
        quota[t]--;
        perTheme[t]++;
        progress = true;
        return;
      }
      exhausted.add(t);
      stats.exhausted = (stats.exhausted || []).concat(theme.name);
      const alive = THEMES.map((_, u) => (t + 1 + u) % THEMES.length).filter((u) => !exhausted.has(u));
      let spare = quota[t];
      for (let k = 0; spare > 0 && k < alive.length * CAP; k++) {
        const u = alive[k % alive.length];
        if (quota[u] + perTheme[u] >= CAP) continue;
        quota[u]++;
        spare--;
      }
      quota[t] = 0;
      progress = alive.length > 0;
    });
  }
  if (made.length < need) {
    const per = {};
    made.forEach((m) => (per[m.theme] = (per[m.theme] || 0) + 1));
    throw new Error(
      `only ${made.length}/${need} palettes could be generated — loosen a theme\n` +
        JSON.stringify({ stats, per }),
    );
  }

  // Interleave themes in the id sequence (seeded shuffle), then name + date.
  for (let i = made.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [made[i], made[j]] = [made[j], made[i]];
  }
  const nameColors = makeNamer(existing);
  const records = made.map((m, i) => ({
    id: "p" + String(existing.length + i + 1).padStart(3, "0"),
    colors: m.colors,
    names: nameColors(m.colors),
    createdAt: randomDate(),
  }));
  return { records, themes: made.map((m) => m.theme), stats };
}

// The data file's own layout (Prettier, printWidth 80): one record per
// block, each array on one line unless that line would pass 80 columns, in
// which case one item per line. Matches the existing file byte-for-byte so
// the diff is append-only.
function serialize(list) {
  const q = (s) => JSON.stringify(s);
  const arr = (key, items) => {
    const line = `    "${key}": [${items.map(q).join(", ")}],`;
    if (line.length <= 80) return line + "\n";
    return `    "${key}": [\n` + items.map((x) => `      ${q(x)}`).join(",\n") + "\n    ],\n";
  };
  const body = list
    .map(
      (p) =>
        "  {\n" +
        `    "id": ${q(p.id)},\n` +
        arr("colors", p.colors) +
        arr("names", p.names) +
        `    "createdAt": ${q(p.createdAt)}\n` +
        "  }",
    )
    .join(",\n");
  return "[\n" + body + "\n]\n";
}

function main() {
  const raw = fs.readFileSync(DATA, "utf8");
  const all = JSON.parse(raw);
  const existing = all.slice(0, BASE);
  if (all.length < BASE) throw new Error(`expected at least ${BASE} canonical palettes, found ${all.length}`);

  const { records, themes, stats } = generate(existing);
  const out = serialize(existing.concat(records));

  // The canonical head must serialise to exactly the bytes already on disk.
  const head = serialize(existing).replace(/\n\]\n$/, "");
  if (!raw.startsWith(head)) {
    throw new Error("serializer does not reproduce the existing records byte-for-byte — refusing to write");
  }

  const perTheme = {};
  themes.forEach((t) => (perTheme[t] = (perTheme[t] || 0) + 1));
  console.log(`generated ${records.length} palettes (${existing.length} kept) — ${JSON.stringify(stats)}`);
  console.log(perTheme);

  if (process.argv.includes("--write")) {
    fs.writeFileSync(DATA, out);
    console.log(`wrote ${path.relative(ROOT, DATA)} (${existing.length + records.length} palettes)`);
  } else {
    console.log("dry run — pass --write to update the data file");
  }
}

if (require.main === module) main();

module.exports = { THEMES, generate, serialize };
