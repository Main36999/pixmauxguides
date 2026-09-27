/**
 * src/build/font-metrics.js — measurements of the shipped font files, for the
 * editorial layer (src/build/font-editorial.js).
 *
 * Each family is measured once, from its reference style: the upright 400
 * if it has one, otherwise the upright weight closest to 400, otherwise its
 * first variant. The numbers come from scripts/fonts/sfnt.js measure(), so
 * they are reproducible from the files alone — nothing here is typed by hand.
 * Script coverage comes from src/build/font-scripts.js, verified against the
 * same file's cmap.
 *
 * WHAT EACH MEASUREMENT CAN SPEAK FOR (METRIC_SCOPE)
 *
 *   latin-lowercase  xHeight, xToCap — the "x" against the "H". Meaningful
 *                    only when the font draws ordinary lowercase
 *                    (lowercaseForm "lowercase"); for all-caps, small-caps
 *                    and caseless fonts it is the height of a capital form.
 *   latin            capHeight, lowercaseAdvance, asciiMonospaced,
 *                    digitsUniform, tabularFigures, lowercaseForm,
 *                    pixelsPerEm/pixelated — measured on Latin letters and
 *                    figures only. They describe the Latin text of a
 *                    multi-script font, never its other scripts.
 *   glyph-wide       numGlyphs, codepointCount, averageAdvance,
 *                    uniformAdvance — every glyph in the file, whatever its
 *                    script. A Devanagari or Sinhala font's count is mostly
 *                    its second script, so these only compare like with like
 *                    among fonts whose scripts are all alphabets of the
 *                    Latin–Greek–Cyrillic family (COMPARABLE_SCRIPTS).
 *   declared         fixedPitch, widthClass — what the font's own tables
 *                    say about itself; recorded, never proof on their own.
 *   font-wide        features, gposFeatures — OpenType tags for all scripts
 *                    together.
 *   per-script       scripts, historical, languages, coverage — verified
 *                    script by script.
 *
 * PERCENTILES
 *
 * Library-relative claims ("a small x-height", "narrow") are percentiles:
 * percentile(v) is the share of the POPULATION with a strictly smaller value,
 * 0–100, rounded to a whole number. The population is every family for which
 * the metric means the same thing: latin-lowercase metrics rank only
 * lowercase fonts, glyph-wide metrics only fonts in COMPARABLE_SCRIPTS. A
 * font outside the population gets no percentile for that metric, so no
 * percentile claim about it can be made.
 *
 *     node src/build/font-metrics.js [font-id …]    prints the measurements
 */

"use strict";

const fs = require("fs");
const path = require("path");

const sfnt = require("../../scripts/fonts/sfnt.js");
const fontScripts = require("./font-scripts.js");

const METRIC_SCOPE = {
  xHeight: "latin-lowercase",
  xToCap: "latin-lowercase",
  capHeight: "latin",
  lowercaseAdvance: "latin",
  asciiMonospaced: "latin",
  digitsUniform: "latin",
  tabularFigures: "latin",
  lowercaseForm: "latin",
  pixelsPerEm: "latin",
  pixelated: "latin",
  numGlyphs: "glyph-wide",
  codepointCount: "glyph-wide",
  averageAdvance: "glyph-wide",
  uniformAdvance: "glyph-wide",
  fixedPitch: "declared",
  widthClass: "declared",
  features: "font-wide",
  gposFeatures: "font-wide",
  scripts: "per-script",
  historical: "per-script",
  languages: "per-script",
};

/** Scripts whose glyph budgets are comparable: small alphabets of one family. */
const COMPARABLE_SCRIPTS = ["latin", "cyrillic", "greek"];

/** Whether a measured family's glyph-wide numbers compare with the library's. */
function glyphComparable(m) {
  return m.historical.length === 0 && m.scripts.every((s) => COMPARABLE_SCRIPTS.includes(s));
}

/** The variant a family is measured by. */
function referenceVariant(font) {
  const upright = font.variants.filter((v) => v.style === "normal");
  const pool = upright.length ? upright : font.variants;
  return pool
    .slice()
    .sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400) || a.weight - b.weight)[0];
}

function measureFamily(font, fontDir) {
  const v = referenceVariant(font);
  const buf = fs.readFileSync(path.join(fontDir, font.id, v.file));
  const m = sfnt.measure(buf);
  const coverage = fontScripts.coverage(font.subsets, sfnt.readSfnt(buf).codepoints);
  return Object.assign({ file: v.file }, m, {
    coverage,
    scripts: coverage.scripts,
    historical: coverage.historical,
    languages: coverage.languages,
  });
}

/** Numeric measurements that get a library percentile. */
const RANKED = ["xHeight", "capHeight", "xToCap", "lowercaseAdvance", "averageAdvance", "numGlyphs"];

/** Whether a family belongs to the population a metric is ranked over. */
function inPopulation(m, key) {
  if (m[key] === null) return false;
  if (METRIC_SCOPE[key] === "latin-lowercase") return m.lowercaseForm === "lowercase";
  if (METRIC_SCOPE[key] === "glyph-wide") return glyphComparable(m);
  return true;
}

function percentile(sorted, value) {
  let below = 0;
  while (below < sorted.length && sorted[below] < value) below++;
  return Math.round((below / sorted.length) * 100);
}

/**
 * { byId: Map(id → measurements + percentiles), median: { key: value } }
 * for every family in `fonts`.
 */
function measureLibrary(fonts, fontDir) {
  const byId = new Map(fonts.map((f) => [f.id, measureFamily(f, fontDir)]));
  const sorted = {};
  const median = {};
  RANKED.forEach((key) => {
    sorted[key] = [...byId.values()].filter((m) => inPopulation(m, key)).map((m) => m[key]).sort((a, b) => a - b);
    median[key] = sorted[key][Math.floor(sorted[key].length / 2)];
  });
  byId.forEach((m) => {
    m.percentile = {};
    RANKED.forEach((key) => {
      if (inPopulation(m, key)) m.percentile[key] = percentile(sorted[key], m[key]);
    });
  });
  return { byId, median };
}

module.exports = {
  referenceVariant,
  measureFamily,
  measureLibrary,
  inPopulation,
  glyphComparable,
  RANKED,
  METRIC_SCOPE,
  COMPARABLE_SCRIPTS,
};

if (require.main === module) {
  const config = require("../../site.config.js");
  const fonts = JSON.parse(fs.readFileSync(config.paths.content.fonts, "utf8"));
  const lib = measureLibrary(fonts, config.paths.content.fontFiles);
  const ids = process.argv.slice(2);
  const out = {};
  (ids.length ? ids : [...lib.byId.keys()]).forEach((id) => {
    if (!lib.byId.has(id)) throw new Error(`unknown font id ${id}`);
    out[id] = lib.byId.get(id);
  });
  process.stdout.write(JSON.stringify({ median: lib.median, fonts: out }, null, 2) + "\n");
}
