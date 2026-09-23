#!/usr/bin/env node
/**
 * check-palettes.js — integrity and diversity gate for palettes-data.json.
 *
 *     npm run check:palettes
 *
 * HARD CHECKS (any failure exits 1)
 *   - record count equals site.config.js palettes.count
 *   - ids unique and in sequence p001..p{count}
 *   - every colour is a valid, normalised #RRGGBB hex
 *   - no colour repeated inside a palette
 *   - names[] is positional: one non-empty string per colour
 *   - createdAt is a real YYYY-MM-DD date
 *   - no exact duplicate palettes, compared order-independently on
 *     normalised hexes (#rgb expanded, uppercased, trimmed, sorted)
 *   - no near-duplicate pair that involves a palette added after the
 *     canonical set (p001..p{CANONICAL})
 *
 * NEAR-DUPLICATES
 *
 * Palette distance is the mean OKLab ΔE (×100) of the best one-to-one
 * pairing of the two palettes' colours, so colour order never matters.
 * Below NEAR_DUPLICATE the two cards read as the same palette side by side.
 * Pairs inside the canonical set are REPORTED, never failed: those records
 * are preserved as shipped and this tool never edits data.
 *
 * DIVERSITY
 *
 * Also prints how every colour distributes over hue family, lightness and
 * chroma bands, so a skewed collection is visible at a glance.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const M = require("./color-math.js");

const REPO = path.resolve(__dirname, "..", "..");
const config = require(path.join(REPO, "site.config.js"));

const CANONICAL = 300; // p001..p300 predate the 600 expansion and are kept as-is
const NEAR_DUPLICATE = 2.0; // mean matched ΔEok

function hueFamily(hex) {
  const [L, C, h] = M.hexToOklch(hex);
  if (C < 0.03) return "neutral";
  if ((h >= 30 && h < 75 && L < 0.62 && C < 0.13) || (h >= 75 && h < 100 && L < 0.5)) return "brown";
  if (h < 20 || h >= 350) return L > 0.72 ? "pink" : "red";
  if (h < 70) return "orange";
  if (h < 110) return "yellow";
  if (h < 165) return "green";
  if (h < 215) return "cyan";
  if (h < 275) return "blue";
  if (h < 310) return "purple";
  if (h < 335) return "magenta";
  return "pink";
}
function lightnessBand(hex) {
  const L = M.hexToOklch(hex)[0];
  return L < 0.25 ? "very dark" : L < 0.45 ? "dark" : L < 0.65 ? "medium" : L < 0.85 ? "light" : "very light";
}
function chromaBand(hex) {
  const C = M.hexToOklch(hex)[1];
  return C < 0.03 ? "muted" : C < 0.07 ? "soft" : C < 0.12 ? "medium" : C < 0.18 ? "saturated" : "highly saturated";
}

function validate(palettes) {
  const errors = [];
  const add = (kind, msg) => errors.push({ kind, msg });
  const count = config.palettes.count;

  if (!Array.isArray(palettes)) {
    add("shape", "palettes-data.json is not an array");
    return { errors, nearPairs: [], summary: {} };
  }

  // count + ids
  if (palettes.length !== count) add("count", `${palettes.length} palettes, expected ${count}`);
  const seenIds = new Set();
  palettes.forEach((p, i) => {
    const want = "p" + String(i + 1).padStart(3, "0");
    if (seenIds.has(p.id)) add("duplicate-id", `duplicate id ${p.id}`);
    seenIds.add(p.id);
    if (p.id !== want) add("id-sequence", `record ${i + 1} has id ${p.id}, expected ${want}`);
  });

  // per-record checks
  const invalidHex = [];
  const dupColors = [];
  palettes.forEach((p) => {
    if (!Array.isArray(p.colors) || p.colors.length === 0) {
      add("shape", `${p.id} has no colors[]`);
      return;
    }
    p.colors.forEach((c) => {
      const n = M.normalizeHex(c);
      if (!n) invalidHex.push(`${p.id} ${JSON.stringify(c)}`);
      else if (n !== c) invalidHex.push(`${p.id} ${c} (not normalised, want ${n})`);
    });
    const norm = p.colors.map(M.normalizeHex).filter(Boolean);
    if (new Set(norm).size !== norm.length) dupColors.push(p.id);
    if (!Array.isArray(p.names) || p.names.length !== p.colors.length) {
      add("names", `${p.id} names[] does not match colors[]`);
    } else if (p.names.some((n) => typeof n !== "string" || !n.trim())) {
      add("names", `${p.id} has an empty name`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.createdAt || "") || isNaN(Date.parse(p.createdAt + "T00:00:00Z"))) {
      add("createdAt", `${p.id} createdAt ${JSON.stringify(p.createdAt)} is not a date`);
    }
  });
  invalidHex.forEach((m) => add("invalid-hex", m));
  dupColors.forEach((id) => add("duplicate-color", `${id} repeats a colour`));

  // exact, order-independent duplicates
  const byKey = new Map();
  palettes.forEach((p) => {
    const key = M.canonicalKey(p.colors);
    if (byKey.has(key)) add("duplicate-palette", `${p.id} is the same palette as ${byKey.get(key)}`);
    else byKey.set(key, p.id);
  });

  // near-duplicates
  const labs = palettes.map((p) => p.colors.map((c) => M.hexToOklab(M.normalizeHex(c) || "#000000")));
  const nearPairs = [];
  let minNew = Infinity;
  for (let i = 0; i < palettes.length; i++) {
    for (let j = i + 1; j < palettes.length; j++) {
      const d = M.paletteDistance(labs[i], labs[j]);
      if (j >= CANONICAL && d < minNew) minNew = d;
      if (d < NEAR_DUPLICATE) {
        nearPairs.push({ a: palettes[i].id, b: palettes[j].id, d, canonical: j < CANONICAL });
      }
    }
  }
  nearPairs
    .filter((n) => !n.canonical)
    .forEach((n) => add("near-duplicate", `${n.a} ~ ${n.b} (ΔEok ${n.d.toFixed(2)})`));

  // distribution
  const tally = (fn) => {
    const out = {};
    palettes.forEach((p) => p.colors.forEach((c) => {
      const n = M.normalizeHex(c);
      if (!n) return;
      const k = fn(n);
      out[k] = (out[k] || 0) + 1;
    }));
    return out;
  };
  const summary = {
    hue: tally(hueFamily),
    lightness: tally(lightnessBand),
    chroma: tally(chromaBand),
    minDistanceNew: minNew,
  };

  return { errors, nearPairs, summary };
}

function report(palettes, result) {
  const n = (kind) => result.errors.filter((e) => e.kind === kind).length;
  const canonNear = result.nearPairs.filter((p) => p.canonical);
  const newNear = result.nearPairs.filter((p) => !p.canonical);
  const lines = [
    "Palette validation",
    "------------------",
    `Total palettes: ${palettes.length}`,
    `Required: ${config.palettes.count}`,
    "",
    `Duplicate IDs: ${n("duplicate-id")}`,
    `ID sequence errors: ${n("id-sequence")}`,
    `Invalid HEX: ${n("invalid-hex")}`,
    `Duplicate palettes: ${n("duplicate-palette")}`,
    `Duplicate colors inside palettes: ${n("duplicate-color")}`,
    `Name / date errors: ${n("names") + n("createdAt")}`,
    `Near-duplicate palettes (ΔEok < ${NEAR_DUPLICATE}): ${result.nearPairs.length}` +
      ` — ${newNear.length} involving p${String(CANONICAL + 1).padStart(3, "0")}+,` +
      ` ${canonNear.length} within the canonical p001–p${CANONICAL} (kept as shipped)`,
  ];
  if (Number.isFinite(result.summary.minDistanceNew)) {
    lines.push(`Closest pair involving an added palette: ΔEok ${result.summary.minDistanceNew.toFixed(2)}`);
  }
  canonNear.forEach((p) => lines.push(`  canonical  ${p.a} ~ ${p.b}  ΔEok ${p.d.toFixed(2)}`));

  const dist = (title, obj, order) => {
    const total = Object.values(obj).reduce((a, b) => a + b, 0);
    lines.push("", title);
    order.forEach((k) => {
      const v = obj[k] || 0;
      lines.push(`  ${k.padEnd(17)} ${String(v).padStart(5)}  ${((100 * v) / total).toFixed(1).padStart(5)}%`);
    });
  };
  dist("Hue families (all colours)", result.summary.hue,
    ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta", "pink", "brown", "neutral"]);
  dist("Lightness (OKLCH L)", result.summary.lightness, ["very light", "light", "medium", "dark", "very dark"]);
  dist("Chroma (OKLCH C)", result.summary.chroma, ["muted", "soft", "medium", "saturated", "highly saturated"]);

  if (result.errors.length) {
    lines.push("", "Errors:");
    result.errors.slice(0, 50).forEach((e) => lines.push(`  [${e.kind}] ${e.msg}`));
    if (result.errors.length > 50) lines.push(`  … ${result.errors.length - 50} more`);
  }
  lines.push("", `STATUS: ${result.errors.length ? "FAIL" : "PASS"}`);
  return lines.join("\n");
}

if (require.main === module) {
  const palettes = JSON.parse(fs.readFileSync(config.paths.content.palettes, "utf8"));
  const result = validate(palettes);
  console.log(report(palettes, result));
  process.exit(result.errors.length ? 1 : 0);
}

module.exports = { validate, report, CANONICAL, NEAR_DUPLICATE };
