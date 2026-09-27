/**
 * scripts/fonts/sfnt.js — a small, dependency-free reader for the font files
 * the library ships: TrueType/OpenType (sfnt) and WOFF2.
 *
 * It reads only what the font checks need:
 *
 *   name   the naming records (family, style, version, copyright, license)
 *   OS/2   usWeightClass, fsType (embedding permissions), fsSelection
 *   head   macStyle
 *   maxp   numGlyphs
 *   cmap   the set of Unicode code points the font maps
 *
 * and, for measure(), the few numbers the editorial layer compares fonts by:
 *
 *   hhea/hmtx   advance widths
 *   loca/glyf   glyph bounding boxes (x-height and cap height are the tops
 *               of the "x" and "H" boxes — the box only, never the contours)
 *   post        isFixedPitch
 *   GSUB/GPOS   the OpenType feature tags
 *   GSUB        the single and alternate substitutions behind the
 *               alternate-letter features (alternateLetters())
 *   glyf        the boxes of the default digits (figureStyle())
 *   glyf        the contours of a few letters and figures — only for the
 *               two shape properties no box can show (OUTLINES):
 *               stencil-broken counters and unicase lowercase shapes
 *
 * Every measure() value is a pure function of the file bytes, rounded to a
 * fixed precision, so the same file always gives the same numbers.
 *
 * WOFF2 is checked structurally: signature, declared length, table directory,
 * and that the Brotli stream decompresses (with Node's built-in zlib) to
 * exactly the size the directory declares. That catches truncated and
 * corrupted files without a WOFF2 decoder dependency.
 */

"use strict";

const zlib = require("zlib");

const NAME_IDS = {
  copyright: 0,
  family: 1,
  subfamily: 2,
  fullName: 4,
  version: 5,
  postscriptName: 6,
  manufacturer: 8,
  designer: 9,
  licenseDescription: 13,
  licenseUrl: 14,
  typographicFamily: 16,
  typographicSubfamily: 17,
};

function tag(buf, at) {
  return buf.toString("latin1", at, at + 4);
}

function tableDirectory(buf) {
  const flavor = buf.readUInt32BE(0);
  if (flavor !== 0x00010000 && tag(buf, 0) !== "OTTO" && tag(buf, 0) !== "true") {
    throw new Error(`not an sfnt font (flavor 0x${flavor.toString(16)})`);
  }
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const offset = buf.readUInt32BE(at + 8);
    const length = buf.readUInt32BE(at + 12);
    if (offset + length > buf.length) {
      throw new Error(`table ${tag(buf, at)} runs past the end of the file`);
    }
    tables[tag(buf, at)] = { offset, length };
  }
  return tables;
}

function decodeName(buf, platformID, encodingID) {
  if (platformID === 3 || platformID === 0) {
    // UTF-16BE
    const swapped = Buffer.alloc(buf.length);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }
  if (platformID === 1 && encodingID === 0) return buf.toString("latin1");
  return null;
}

/** name table → { copyright, family, … }, preferring Windows English records. */
function readNames(buf, table) {
  const base = table.offset;
  const count = buf.readUInt16BE(base + 2);
  const strings = base + buf.readUInt16BE(base + 4);
  const found = {};
  const rank = {};
  for (let i = 0; i < count; i++) {
    const at = base + 6 + i * 12;
    const platformID = buf.readUInt16BE(at);
    const encodingID = buf.readUInt16BE(at + 2);
    const languageID = buf.readUInt16BE(at + 4);
    const nameID = buf.readUInt16BE(at + 6);
    const length = buf.readUInt16BE(at + 8);
    const offset = buf.readUInt16BE(at + 10);
    const r =
      platformID === 3 && languageID === 0x409 ? 3 :
      platformID === 3 ? 2 :
      platformID === 1 && languageID === 0 ? 1 : 0;
    if (rank[nameID] !== undefined && rank[nameID] >= r) continue;
    const text = decodeName(
      buf.subarray(strings + offset, strings + offset + length),
      platformID,
      encodingID,
    );
    if (text === null) continue;
    found[nameID] = text;
    rank[nameID] = r;
  }
  const names = {};
  for (const [key, id] of Object.entries(NAME_IDS)) {
    if (found[id] !== undefined) names[key] = found[id];
  }
  return names;
}

/**
 * code point → glyph id, from the best Unicode cmap subtable (format 4 or
 * 12). Format 4 leaves out code points that map to glyph 0 (.notdef);
 * format 12 lists every code point in its groups.
 */
function readCmap(buf, table) {
  const base = table.offset;
  const numTables = buf.readUInt16BE(base + 2);
  let best = null;
  for (let i = 0; i < numTables; i++) {
    const at = base + 4 + i * 8;
    const platformID = buf.readUInt16BE(at);
    const encodingID = buf.readUInt16BE(at + 2);
    const offset = base + buf.readUInt32BE(at + 4);
    const format = buf.readUInt16BE(offset);
    const unicode = platformID === 0 || (platformID === 3 && (encodingID === 1 || encodingID === 10));
    if (!unicode) continue;
    if (format === 12 && (!best || best.format !== 12)) best = { format, offset };
    else if (format === 4 && !best) best = { format, offset };
  }
  const cps = new Map();
  if (!best) return cps;
  const o = best.offset;
  if (best.format === 4) {
    const segX2 = buf.readUInt16BE(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = buf.readUInt16BE(ends + s);
      const start = buf.readUInt16BE(starts + s);
      const delta = buf.readInt16BE(deltas + s);
      const rangeOffset = buf.readUInt16BE(ranges + s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph;
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
        else {
          const g = ranges + s + rangeOffset + (c - start) * 2;
          glyph = buf.readUInt16BE(g);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) cps.set(c, glyph);
      }
    }
  } else {
    const groups = buf.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const at = o + 16 + g * 12;
      const start = buf.readUInt32BE(at);
      const end = buf.readUInt32BE(at + 4);
      const glyph = buf.readUInt32BE(at + 8);
      for (let c = start; c <= end; c++) cps.set(c, glyph + (c - start));
    }
  }
  return cps;
}

/**
 * Reads a TTF/OTF buffer. Throws on anything that is not a readable sfnt
 * with the tables a usable font needs.
 */
function readSfnt(buf) {
  const tables = tableDirectory(buf);
  for (const required of ["cmap", "head", "maxp", "name", "OS/2"]) {
    if (!tables[required]) throw new Error(`missing required table ${required}`);
  }
  if (!tables.glyf && !tables["CFF "] && !tables.CFF2) {
    throw new Error("no outline table (glyf, CFF or CFF2)");
  }
  const head = tables.head.offset;
  if (buf.readUInt32BE(head + 12) !== 0x5f0f3cf5) throw new Error("bad head magic number");
  const os2 = tables["OS/2"].offset;
  return {
    outlines: tables.glyf ? "TrueType" : "CFF",
    variable: Boolean(tables.fvar),
    tables: Object.keys(tables).sort(),
    names: readNames(buf, tables.name),
    weightClass: buf.readUInt16BE(os2 + 4),
    fsType: buf.readUInt16BE(os2 + 8),
    fsSelection: buf.readUInt16BE(os2 + 62),
    macStyle: buf.readUInt16BE(head + 44),
    numGlyphs: buf.readUInt16BE(tables.maxp.offset + 4),
    codepoints: new Set(readCmap(buf, tables.cmap).keys()),
  };
}

// ---------------------------------------------------------------------
// measurements
// ---------------------------------------------------------------------

/** Rounds an em fraction to three decimals — the precision measure() reports. */
function em(value) {
  return Math.round(value * 1000) / 1000;
}

/** Sorted, de-duplicated feature tags of a GSUB or GPOS table. */
function readFeatureTags(buf, table) {
  if (!table) return [];
  const featureList = table.offset + buf.readUInt16BE(table.offset + 6);
  const count = buf.readUInt16BE(featureList);
  const tags = new Set();
  for (let i = 0; i < count; i++) tags.add(tag(buf, featureList + 2 + i * 6));
  return [...tags].sort();
}

/** Advance width of every glyph (hmtx repeats the last one past numberOfHMetrics). */
function readAdvances(buf, tables, numGlyphs) {
  const count = buf.readUInt16BE(tables.hhea.offset + 34);
  const out = new Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < count) last = buf.readUInt16BE(tables.hmtx.offset + g * 4);
    out[g] = last;
  }
  return out;
}

/** A glyph's bounding box in glyf, or null (no glyf, no glyph, empty glyph). */
function glyphBox(buf, tables, glyph) {
  if (!tables.glyf || !tables.loca || !glyph) return null;
  const long = buf.readInt16BE(tables.head.offset + 50) === 1;
  const loca = tables.loca.offset;
  const start = long ? buf.readUInt32BE(loca + glyph * 4) : buf.readUInt16BE(loca + glyph * 2) * 2;
  const end = long ? buf.readUInt32BE(loca + glyph * 4 + 4) : buf.readUInt16BE(loca + glyph * 2 + 2) * 2;
  if (end <= start) return null;
  const at = tables.glyf.offset + start;
  return {
    xMin: buf.readInt16BE(at + 2),
    yMin: buf.readInt16BE(at + 4),
    xMax: buf.readInt16BE(at + 6),
    yMax: buf.readInt16BE(at + 8),
  };
}

/** yMax of a glyph's bounding box, or null. */
function glyphTop(buf, tables, glyph) {
  const box = glyphBox(buf, tables, glyph);
  return box ? box.yMax : null;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

const LOWERCASE = Array.from({ length: 26 }, (_, i) => 0x61 + i);
const UPPERCASE = LOWERCASE.map((c) => c - 0x20);
const DIGITS = Array.from({ length: 10 }, (_, i) => 0x30 + i);
const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i);
/** Lowercase letters with an ascender in ordinary lowercase: b d h k l. */
const ASCENDERS = [0x62, 0x64, 0x68, 0x6b, 0x6c];

/**
 * Every one of b d h k l topping out within this share of the "x" top means
 * the lowercase has no ascenders. Every letter, not the average: irregular
 * handwriting (Over the Rainbow) can average close to its x-height while
 * its letters scatter above and below it; true small caps sit level.
 */
const NO_ASCENDER_TOLERANCE = 0.03;
/** x-height within this share of cap height means lowercase is drawn at cap height. */
const CAPS_X_TO_CAP = 0.95;
/** A glyph grid this coarse or coarser (pixels per em) is a pixel/bitmap design. */
const MAX_PIXELS_PER_EM = 64;

/*
 * DEFAULT FIGURES. How the digits the keyboard produces — the cmap glyphs,
 * never an optional onum/lnum substitution — are drawn:
 *
 *   "oldstyle"  0, 1 and 2 top out at x-height (at most FIGURE_X_TOLERANCE ×
 *               the "x" top) and at least three of 3 4 5 7 9 descend at least
 *               FIGURE_DESCENT of the em below the baseline
 *   "lining"    no digit descends and 0, 1 and 2 stand above that x-height
 *               limit: figures at or near cap height
 *   "mixed"     neither (irregular handwriting, hybrid figures)
 *   null        a digit or the "x" is missing, so the question has no answer
 */
const FIGURE_X_TOLERANCE = 1.15;
const FIGURE_DESCENT = 0.08;
const DESCENDING_DIGITS = [0x33, 0x34, 0x35, 0x37, 0x39];
const SHORT_DIGITS = [0x30, 0x31, 0x32];

function figureStyleOf(buf, tables, cmap, upm) {
  const x = glyphTop(buf, tables, cmap.get(0x78));
  const box = (c) => glyphBox(buf, tables, cmap.get(c));
  const desc = DESCENDING_DIGITS.map(box);
  const short = SHORT_DIGITS.map(box);
  if (!x || desc.some((b) => !b) || short.some((b) => !b)) return null;
  const descending = desc.filter((b) => b.yMin / upm <= -FIGURE_DESCENT).length;
  const atX = short.every((b) => b.yMax <= x * FIGURE_X_TOLERANCE);
  if (descending >= 3 && atX) return "oldstyle";
  if (descending === 0 && short.every((b) => b.yMax > x * FIGURE_X_TOLERANCE)) return "lining";
  return "mixed";
}

/** The default-figure style of one font file (see DEFAULT FIGURES). */
function figureStyle(buf) {
  const tables = tableDirectory(buf);
  return figureStyleOf(buf, tables, readCmap(buf, tables.cmap), buf.readUInt16BE(tables.head.offset + 18));
}

/*
 * ALTERNATE LETTERS. A feature tag is not proof of alternate letterforms:
 * 'aalt' (Access All Alternates) collects every substitution the font
 * offers, and in many fonts that is only the ordinals, superiors and
 * locale forms other features already provide (Brawler's aalt covers
 * a → ª, 1 → ¹ and nothing else). So the substitutions themselves are read.
 *
 * A letter has a genuine alternate when one of ALTERNATE_FEATURES
 * substitutes its default glyph — directly, or through a lookup a
 * contextual rule calls (calt) — with a glyph that is
 *
 *   - not produced by any of EXPLAINED_FEATURES (ordinals, superiors,
 *     fractions, locale forms, small caps, figure styles …), and
 *   - not itself the default glyph of another character (Romanian Ş → Ș is
 *     a different character, not a second design of the same one).
 *
 * Letters are code points of Unicode category L, excluding modifier letters
 * (Lm: ˆ ˇ) and the ordinal indicators ª º.
 */
const ALTERNATE_FEATURES = /^(aalt|salt|swsh|cswh|calt|ss\d\d|cv\d\d)$/;
const EXPLAINED_FEATURES = /^(ordn|sups|subs|sinf|numr|dnom|frac|afrc|locl|smcp|c2sc|pcap|c2pc|case|onum|lnum|pnum|tnum|zero|ccmp)$/;

function coverageGlyphs(buf, at) {
  const format = buf.readUInt16BE(at);
  const out = [];
  if (format === 1) {
    for (let i = 0, n = buf.readUInt16BE(at + 2); i < n; i++) out.push(buf.readUInt16BE(at + 4 + i * 2));
  } else if (format === 2) {
    for (let i = 0, n = buf.readUInt16BE(at + 2); i < n; i++) {
      const r = at + 4 + i * 6;
      for (let g = buf.readUInt16BE(r); g <= buf.readUInt16BE(r + 2); g++) out.push(g);
    }
  }
  return out;
}

/** Lookup indices named by the SubstLookupRecords of a context (5) or chaining context (6) subtable. */
function nestedLookups(buf, st, type) {
  const out = [];
  const records = (at, count) => {
    for (let i = 0; i < count; i++) out.push(buf.readUInt16BE(at + i * 4 + 2));
  };
  const format = buf.readUInt16BE(st);
  if (type === 5 && format === 3) {
    const glyphs = buf.readUInt16BE(st + 2);
    records(st + 6 + glyphs * 2, buf.readUInt16BE(st + 4));
  } else if (type === 5) {
    // format 1 (SubRuleSet/SubRule) and 2 (SubClassSet/SubClassRule) share the rule layout
    const setsAt = format === 1 ? st + 6 : st + 8;
    for (let s = 0, n = buf.readUInt16BE(setsAt - 2); s < n; s++) {
      const off = buf.readUInt16BE(setsAt + s * 2);
      if (!off) continue;
      const set = st + off;
      for (let r = 0, m = buf.readUInt16BE(set); r < m; r++) {
        const rule = set + buf.readUInt16BE(set + 2 + r * 2);
        const glyphs = buf.readUInt16BE(rule);
        records(rule + 4 + (glyphs - 1) * 2, buf.readUInt16BE(rule + 2));
      }
    }
  } else if (type === 6 && format === 3) {
    let p = st + 2;
    p += 2 + buf.readUInt16BE(p) * 2; // backtrack coverages
    p += 2 + buf.readUInt16BE(p) * 2; // input coverages
    p += 2 + buf.readUInt16BE(p) * 2; // lookahead coverages
    records(p + 2, buf.readUInt16BE(p));
  } else if (type === 6) {
    // format 1 (ChainSubRuleSet) and 2 (ChainSubClassSet) share the rule layout
    const setsAt = format === 1 ? st + 6 : st + 12;
    for (let s = 0, n = buf.readUInt16BE(setsAt - 2); s < n; s++) {
      const off = buf.readUInt16BE(setsAt + s * 2);
      if (!off) continue;
      const set = st + off;
      for (let r = 0, m = buf.readUInt16BE(set); r < m; r++) {
        let p = set + buf.readUInt16BE(set + 2 + r * 2);
        p += 2 + buf.readUInt16BE(p) * 2; // backtrack
        p += 2 + (buf.readUInt16BE(p) - 1) * 2; // input (first glyph is the coverage)
        p += 2 + buf.readUInt16BE(p) * 2; // lookahead
        records(p + 2, buf.readUInt16BE(p));
      }
    }
  }
  return out;
}

/**
 * Map of GSUB feature tag → [[input glyph, output glyph], …] from the single
 * (1) and alternate (3) substitutions a feature applies, including those
 * reached through contextual rules (5, 6) and extension subtables (7).
 */
function gsubSubstitutions(buf, table) {
  const out = new Map();
  if (!table) return out;
  const gsub = table.offset;
  const featureList = gsub + buf.readUInt16BE(gsub + 6);
  const lookupList = gsub + buf.readUInt16BE(gsub + 8);
  const lookupCount = buf.readUInt16BE(lookupList);
  const memo = new Map();
  function pairsOf(index, depth) {
    if (index >= lookupCount || depth > 4) return [];
    if (memo.has(index)) return memo.get(index);
    memo.set(index, []);
    const lookup = lookupList + buf.readUInt16BE(lookupList + 2 + index * 2);
    const type = buf.readUInt16BE(lookup);
    const pairs = [];
    for (let s = 0, n = buf.readUInt16BE(lookup + 4); s < n; s++) {
      let st = lookup + buf.readUInt16BE(lookup + 6 + s * 2);
      let t = type;
      if (t === 7) {
        t = buf.readUInt16BE(st + 2);
        st += buf.readUInt32BE(st + 4);
      }
      const format = buf.readUInt16BE(st);
      if (t === 1) {
        const cov = coverageGlyphs(buf, st + buf.readUInt16BE(st + 2));
        if (format === 1) {
          const delta = buf.readInt16BE(st + 4);
          cov.forEach((g) => pairs.push([g, (g + delta) & 0xffff]));
        } else {
          cov.forEach((g, i) => pairs.push([g, buf.readUInt16BE(st + 6 + i * 2)]));
        }
      } else if (t === 3) {
        const cov = coverageGlyphs(buf, st + buf.readUInt16BE(st + 2));
        cov.forEach((g, i) => {
          const set = st + buf.readUInt16BE(st + 6 + i * 2);
          for (let a = 0, m = buf.readUInt16BE(set); a < m; a++) pairs.push([g, buf.readUInt16BE(set + 2 + a * 2)]);
        });
      } else if (t === 5 || t === 6) {
        nestedLookups(buf, st, t).forEach((li) => pairsOf(li, depth + 1).forEach((p) => pairs.push(p)));
      }
    }
    memo.set(index, pairs);
    return pairs;
  }
  for (let i = 0, n = buf.readUInt16BE(featureList); i < n; i++) {
    const rec = featureList + 2 + i * 6;
    const feature = featureList + buf.readUInt16BE(rec + 4);
    const list = out.get(tag(buf, rec)) || [];
    for (let j = 0, m = buf.readUInt16BE(feature + 2); j < m; j++) {
      pairsOf(buf.readUInt16BE(feature + 4 + j * 2), 0).forEach((p) => list.push(p));
    }
    out.set(tag(buf, rec), list);
  }
  return out;
}

const LETTER = /^[\p{Lu}\p{Ll}\p{Lt}\p{Lo}]$/u;
const ORDINAL_INDICATORS = new Set([0xaa, 0xba]);

/** Sorted code points of the letters that have a genuine alternate design (see ALTERNATE LETTERS). */
function alternateLettersOf(buf, tables, cmap) {
  const subs = gsubSubstitutions(buf, tables.GSUB);
  const explained = new Set();
  subs.forEach((pairs, t) => EXPLAINED_FEATURES.test(t) && pairs.forEach(([, o]) => explained.add(o)));
  const encoded = new Set(cmap.values());
  const letterOf = new Map();
  cmap.forEach((g, cp) => {
    if (!ORDINAL_INDICATORS.has(cp) && LETTER.test(String.fromCodePoint(cp)) && !letterOf.has(g)) letterOf.set(g, cp);
  });
  const found = new Set();
  subs.forEach((pairs, t) => {
    if (!ALTERNATE_FEATURES.test(t)) return;
    pairs.forEach(([i, o]) => {
      if (i !== o && letterOf.has(i) && !explained.has(o) && !encoded.has(o)) found.add(letterOf.get(i));
    });
  });
  return [...found].sort((a, b) => a - b);
}

/** The letters of one font file that have a genuine alternate design. */
function alternateLetters(buf) {
  const tables = tableDirectory(buf);
  return alternateLettersOf(buf, tables, readCmap(buf, tables.cmap));
}

/**
 * How the font draws a–z, from glyph ids and bounding boxes:
 *
 *   "none"        no lowercase letters are mapped
 *   "caps"        a–z are capitals: they share the capitals' glyphs, or they
 *                 have no ascenders and stand at cap height (Bebas Neue)
 *   "small-caps"  a–z have no ascenders but are shorter than the capitals
 *                 (Amatic SC)
 *   "lowercase"   ordinary lowercase: b d h k l rise above the x-height
 *
 * x-height is only a lowercase measurement for "lowercase" fonts; for the
 * others it is the height of a capital-shaped letter.
 */
function lowercaseForm(buf, tables, cmap) {
  const mapped = LOWERCASE.filter((c) => cmap.has(c));
  if (!mapped.length) return "none";
  if (mapped.every((c) => cmap.get(c) === cmap.get(c - 0x20))) return "caps";
  const top = (c) => glyphTop(buf, tables, cmap.get(c));
  const x = top(0x78);
  const H = top(0x48);
  const asc = ASCENDERS.map(top).filter((v) => v !== null);
  if (!x || !H || !asc.length) return "lowercase";
  if (asc.some((a) => Math.abs(a / x - 1) > NO_ASCENDER_TOLERANCE)) return "lowercase";
  return x / H >= CAPS_X_TO_CAP ? "caps" : "small-caps";
}

/**
 * Pixels per em when every letter and figure's bounding box and advance sit
 * on one coarse grid (a pixel/bitmap design), else null.
 */
function pixelGrid(buf, tables, cmap, advances, upm) {
  const values = [];
  LOWERCASE.concat(UPPERCASE, DIGITS).forEach((c) => {
    if (!cmap.has(c)) return;
    const g = cmap.get(c);
    const box = glyphBox(buf, tables, g);
    if (box) values.push(box.xMin, box.yMin, box.xMax, box.yMax);
    values.push(advances[g] || 0);
  });
  const unit = values.map(Math.abs).filter(Boolean).reduce(gcd, 0);
  if (!unit) return null;
  const perEm = upm / unit;
  return perEm <= MAX_PIXELS_PER_EM ? Math.round(perEm * 1000) / 1000 : null;
}

// ---------------------------------------------------------------------
// outlines — the only measurements that read glyph contours
// ---------------------------------------------------------------------

/*
 * OUTLINES. Two properties are about the drawn shapes themselves, so no
 * box, advance or table flag can stand in for them: a stencil's broken
 * counters, and a unicase design's lowercase shapes at cap height. For
 * those, the glyf contours of a few Latin letters and figures are read
 * (composites resolved), their quadratic curves flattened, and the result
 * filled onto a pixel grid with the non-zero winding rule. The grid is
 * integer arithmetic on the file's own coordinates, so the same bytes
 * always give the same count. A CFF font, a missing glyph or unreadable
 * glyph data gives no answer (null) rather than a guess.
 */

/** Contours of one glyf glyph as [[{x, y, on}, …], …]; composites resolved. */
function glyphContours(buf, tables, glyph, depth = 0) {
  if (!tables.glyf || !tables.loca || !glyph || depth > 8) return [];
  const long = buf.readInt16BE(tables.head.offset + 50) === 1;
  const loca = tables.loca.offset;
  const start = long ? buf.readUInt32BE(loca + glyph * 4) : buf.readUInt16BE(loca + glyph * 2) * 2;
  const end = long ? buf.readUInt32BE(loca + glyph * 4 + 4) : buf.readUInt16BE(loca + glyph * 2 + 2) * 2;
  if (end <= start) return [];
  const at = tables.glyf.offset + start;
  const count = buf.readInt16BE(at);
  if (count >= 0) {
    const ends = [];
    for (let i = 0; i < count; i++) ends.push(buf.readUInt16BE(at + 10 + i * 2));
    const points = count ? ends[count - 1] + 1 : 0;
    let p = at + 12 + count * 2 + buf.readUInt16BE(at + 10 + count * 2);
    const flags = [];
    while (flags.length < points) {
      const f = buf[p++];
      flags.push(f);
      if (f & 8) for (let r = buf[p++]; r > 0; r--) flags.push(f);
    }
    const coords = (short, same) => {
      const out = [];
      let v = 0;
      flags.forEach((f) => {
        if (f & short) v += f & same ? buf[p++] : -buf[p++];
        else if (!(f & same)) {
          v += buf.readInt16BE(p);
          p += 2;
        }
        out.push(v);
      });
      return out;
    };
    const xs = coords(2, 16);
    const ys = coords(4, 32);
    let first = 0;
    return ends.map((last) => {
      const c = [];
      for (let i = first; i <= last; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      first = last + 1;
      return c;
    });
  }
  // composite: each component's contours, moved (and scaled) into place
  const out = [];
  let p = at + 10;
  for (let more = true; more; ) {
    const f = buf.readUInt16BE(p);
    const component = buf.readUInt16BE(p + 2);
    p += 4;
    let dx, dy;
    if (f & 1) [dx, dy, p] = [buf.readInt16BE(p), buf.readInt16BE(p + 2), p + 4];
    else [dx, dy, p] = [buf.readInt8(p), buf.readInt8(p + 1), p + 2];
    if (!(f & 2)) [dx, dy] = [0, 0]; // point-matched placement: rare, left unmoved
    let [a, b, c, d] = [1, 0, 0, 1];
    const f2 = (o) => buf.readInt16BE(p + o) / 16384;
    if (f & 8) [a, d, p] = [f2(0), f2(0), p + 2];
    else if (f & 0x40) [a, d, p] = [f2(0), f2(2), p + 4];
    else if (f & 0x80) [a, b, c, d, p] = [f2(0), f2(2), f2(4), f2(6), p + 8];
    glyphContours(buf, tables, component, depth + 1).forEach((contour) =>
      out.push(contour.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on }))),
    );
    more = (f & 0x20) !== 0;
  }
  return out;
}

/** A contour as a closed polyline [[x, y], …]; each quadratic curve becomes CURVE_STEPS lines. */
const CURVE_STEPS = 8;
function flattenContour(contour) {
  const pts = [];
  contour.forEach((q, i) => {
    const next = contour[(i + 1) % contour.length];
    pts.push(q);
    if (!q.on && !next.on) pts.push({ x: (q.x + next.x) / 2, y: (q.y + next.y) / 2, on: true });
  });
  const start = pts.findIndex((q) => q.on);
  if (start < 0) return [];
  const ring = pts.slice(start).concat(pts.slice(0, start));
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    if (!a.on) continue;
    const b = ring[(i + 1) % ring.length];
    out.push([a.x, a.y]);
    if (b.on) continue;
    const c = ring[(i + 2) % ring.length];
    for (let s = 1; s < CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      out.push([(1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * b.x + t * t * c.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * b.y + t * t * c.y]);
    }
  }
  return out;
}

/**
 * Fills closed polylines onto a width × height grid of pixel centres
 * (non-zero winding). `toGrid` maps a font point to grid coordinates.
 */
function fillGrid(polylines, width, height, toGrid) {
  const bits = new Uint8Array(width * height);
  // each edge is filed under the pixel rows whose centres it crosses
  const rows = Array.from({ length: height }, () => []);
  polylines.forEach((line) => {
    const pts = line.map(toGrid);
    pts.forEach(([x0, y0], i) => {
      const [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 === y1) return;
      const first = Math.max(0, Math.ceil(Math.min(y0, y1) - 0.5));
      const last = Math.min(height - 1, Math.ceil(Math.max(y0, y1) - 0.5) - 1);
      for (let row = first; row <= last; row++) {
        const y = row + 0.5;
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) rows[row].push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1);
      }
    });
  });
  for (let row = 0; row < height; row++) {
    const flat = rows[row];
    const hits = [];
    for (let i = 0; i < flat.length; i += 2) hits.push([flat[i], flat[i + 1]]);
    hits.sort((p, q) => p[0] - q[0]);
    let winding = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      winding += hits[i][1];
      if (!winding) continue;
      const from = Math.max(0, Math.round(hits[i][0]));
      const to = Math.min(width, Math.round(hits[i + 1][0]));
      bits.fill(1, row * width + from, Math.max(row * width + from, row * width + to));
    }
  }
  return bits;
}

/**
 * Connected regions of a filled grid (4-neighbour): how many separate
 * pieces of ink, and how many enclosed counters — background regions that
 * do not reach the grid's edge. Regions under `minSize` pixels are noise
 * from the flattening, not shapes, and are not counted.
 */
function gridRegions(bits, width, height, minSize) {
  const label = new Int32Array(bits.length).fill(-1);
  const stack = new Int32Array(bits.length);
  let ink = 0;
  let counters = 0;
  for (let start = 0; start < bits.length; start++) {
    if (label[start] >= 0) continue;
    const value = bits[start];
    let top = 0;
    let size = 0;
    let edge = false;
    stack[top++] = start;
    label[start] = start;
    while (top) {
      const k = stack[--top];
      size++;
      const x = k % width;
      const y = (k - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      if (x > 0 && label[k - 1] < 0 && bits[k - 1] === value) (label[k - 1] = start), (stack[top++] = k - 1);
      if (x < width - 1 && label[k + 1] < 0 && bits[k + 1] === value) (label[k + 1] = start), (stack[top++] = k + 1);
      if (y > 0 && label[k - width] < 0 && bits[k - width] === value) (label[k - width] = start), (stack[top++] = k - width);
      if (y < height - 1 && label[k + width] < 0 && bits[k + width] === value) (label[k + width] = start), (stack[top++] = k + width);
    }
    if (size < minSize) continue;
    if (value) ink++;
    else if (!edge) counters++;
  }
  return { ink, counters };
}

/** A glyph's outline filled at `pixelsPerEm`, with a one-pixel margin; null for an empty glyph. */
function glyphGrid(buf, tables, glyph, upm, pixelsPerEm) {
  const lines = glyphContours(buf, tables, glyph).map(flattenContour).filter((l) => l.length > 2);
  if (!lines.length) return null;
  const all = lines.flat();
  const xMin = Math.min(...all.map((p) => p[0]));
  const yMin = Math.min(...all.map((p) => p[1]));
  const s = pixelsPerEm / upm;
  const width = Math.ceil((Math.max(...all.map((p) => p[0])) - xMin) * s) + 3;
  const height = Math.ceil((Math.max(...all.map((p) => p[1])) - yMin) * s) + 3;
  return { bits: fillGrid(lines, width, height, ([x, y]) => [(x - xMin) * s + 1, (y - yMin) * s + 1]), width, height };
}

/** A glyph's outline stretched onto a size × size grid (its own bounding box); null for an empty glyph. */
function glyphShape(buf, tables, glyph, size) {
  const lines = glyphContours(buf, tables, glyph).map(flattenContour).filter((l) => l.length > 2);
  if (!lines.length) return null;
  const all = lines.flat();
  const xMin = Math.min(...all.map((p) => p[0]));
  const yMin = Math.min(...all.map((p) => p[1]));
  const sx = size / Math.max(1, Math.max(...all.map((p) => p[0])) - xMin);
  const sy = size / Math.max(1, Math.max(...all.map((p) => p[1])) - yMin);
  return fillGrid(lines, size, size, ([x, y]) => [(x - xMin) * sx, (y - yMin) * sy]);
}

/*
 * STENCIL LETTERS. A letter or figure that normally encloses a counter is
 * drawn stencil-broken when its outline fills into two or more separate
 * pieces of ink and encloses no counter at all: the bridges cut the bowl
 * open instead of leaving a hole. STENCIL_GLYPHS are the counter-bearing
 * reference characters; the count is how many of those the font maps draw
 * broken. An unusual but closed counter (an inline or multi-line design
 * still encloses its holes) does not count, and neither does a letter that
 * is one piece.
 *
 * The grid is STENCIL_PIXELS_PER_EM: fine enough to keep a stencil bridge
 * open, coarse enough to stay fast over the whole library.
 */
const STENCIL_GLYPHS = [..."abdegopqABDOPQR0689"].map((c) => c.codePointAt(0));
const STENCIL_PIXELS_PER_EM = 200;
const STENCIL_MIN_REGION = 3;

function stencilLettersOf(buf, tables, cmap, upm) {
  if (!tables.glyf || !tables.loca) return null;
  let measured = 0;
  let broken = 0;
  STENCIL_GLYPHS.forEach((c) => {
    const grid = cmap.has(c) ? glyphGrid(buf, tables, cmap.get(c), upm, STENCIL_PIXELS_PER_EM) : null;
    if (!grid) return;
    measured++;
    const r = gridRegions(grid.bits, grid.width, grid.height, STENCIL_MIN_REGION);
    if (r.counters === 0 && r.ink >= 2) broken++;
  });
  return measured ? broken : null;
}

/*
 * UNICASE LETTERS. For a font whose a–z stand at cap height (lowercaseForm
 * "caps"), how many of the 26 letters are drawn differently from their
 * capital: the two outlines, each stretched onto its own bounding box on a
 * UNICASE_GRID × UNICASE_GRID grid, overlap by less than UNICASE_OVERLAP
 * (intersection over union). A letter that shares the capital's glyph, or
 * repeats its drawing (Bebas Neue, Bungee), overlaps completely.
 *
 * The count says the shapes differ, not what they are: a second set of
 * capital designs on the lowercase keys (Major Mono Display) differs from
 * the capitals just as a lowercase form does. That is why the Unicase term
 * needs both this count and an upstream statement (font-editorial.js).
 * null for a font whose a–z are not at cap height.
 */
const UNICASE_GRID = 48;
const UNICASE_OVERLAP = 0.75;

function unicaseLettersOf(buf, tables, cmap, form) {
  if (form !== "caps" || !tables.glyf || !tables.loca) return null;
  let distinct = 0;
  LOWERCASE.forEach((c) => {
    const lower = cmap.get(c);
    const upper = cmap.get(c - 0x20);
    if (!lower || !upper || lower === upper) return;
    const a = glyphShape(buf, tables, lower, UNICASE_GRID);
    const b = glyphShape(buf, tables, upper, UNICASE_GRID);
    if (!a || !b) return;
    let both = 0;
    let either = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b[i]) both++;
      if (a[i] || b[i]) either++;
    }
    if (either && both / either < UNICASE_OVERLAP) distinct++;
  });
  return distinct;
}

/** An outline count, or null when the glyph data cannot be read. */
function safely(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** How many counter-bearing reference glyphs one font file draws stencil-broken (see STENCIL LETTERS). */
function stencilLetterCount(buf) {
  return safely(() => {
    const tables = tableDirectory(buf);
    return stencilLettersOf(buf, tables, readCmap(buf, tables.cmap), buf.readUInt16BE(tables.head.offset + 18));
  });
}

/** How many of a–z one font file draws at cap height in a shape unlike its capital (see UNICASE LETTERS). */
function unicaseLetterCount(buf) {
  return safely(() => {
    const tables = tableDirectory(buf);
    const cmap = readCmap(buf, tables.cmap);
    return unicaseLettersOf(buf, tables, cmap, lowercaseForm(buf, tables, cmap));
  });
}

/**
 * The comparable numbers of one TTF/OTF file. Lengths are fractions of the
 * em, rounded to three decimals:
 *
 *   xHeight, capHeight   top of the "x" and "H" outlines; the OS/2
 *                        sxHeight / sCapHeight when the font has no glyf
 *                        table or lacks either glyph. heightSource says
 *                        which: "outline" or "os2".
 *   xToCap               xHeight / capHeight
 *   os2XHeight, os2CapHeight   what OS/2 declares (null before OS/2 v2)
 *   lowercaseAdvance     mean advance width of the a–z the font maps
 *   averageAdvance       mean advance of every glyph wider than zero
 *   fixedPitch           post.isFixedPitch is set — a header flag, not proof
 *   uniformAdvance       every glyph wider than zero has the same advance
 *   asciiMonospaced      every mapped printable ASCII character (U+0021–
 *                        U+007E) has the same advance — what makes text and
 *                        code line up in columns
 *   digitsUniform        0–9 share one default advance
 *   tabularFigures       digitsUniform, or GSUB offers tnum
 *   lowercaseForm        "lowercase", "caps", "small-caps" or "none" (above)
 *   pixelsPerEm          the glyph grid of a pixel/bitmap design, else null;
 *                        pixelated is pixelsPerEm !== null
 *   widthClass           OS/2 usWidthClass (5 normal, 3 condensed, …)
 *   features             GSUB feature tags; gposFeatures, the GPOS ones
 *   figureStyle          the default digits: "oldstyle", "lining", "mixed"
 *                        or null (DEFAULT FIGURES, above)
 *   alternateLetterCount letters with a genuine alternate design (ALTERNATE
 *                        LETTERS, above) — substitutions, not feature tags
 *   unicaseLetterCount   a–z drawn at cap height unlike their capitals
 *                        (UNICASE LETTERS); null unless lowercaseForm "caps"
 *   stencilLetterCount   counter-bearing reference glyphs drawn stencil-
 *                        broken (STENCIL LETTERS); null without glyf outlines
 *   numGlyphs, codepointCount
 */
function measure(buf) {
  const info = readSfnt(buf);
  const tables = tableDirectory(buf);
  for (const required of ["hhea", "hmtx", "post"]) {
    if (!tables[required]) throw new Error(`missing required table ${required}`);
  }
  const upm = buf.readUInt16BE(tables.head.offset + 18);
  const cmap = readCmap(buf, tables.cmap);
  const os2 = tables["OS/2"].offset;
  const os2v2 = buf.readUInt16BE(os2) >= 2;
  const os2X = os2v2 ? buf.readInt16BE(os2 + 86) : null;
  const os2H = os2v2 ? buf.readInt16BE(os2 + 88) : null;

  const outlineX = glyphTop(buf, tables, cmap.get(0x78));
  const outlineH = glyphTop(buf, tables, cmap.get(0x48));
  const fromOutline = outlineX !== null && outlineH !== null;
  const x = fromOutline ? outlineX : os2X;
  const h = fromOutline ? outlineH : os2H;

  const advances = readAdvances(buf, tables, info.numGlyphs);
  const lower = LOWERCASE.filter((c) => cmap.has(c)).map((c) => advances[cmap.get(c)] || 0);
  const same = (list) => list.length > 0 && list.every((a) => a === list[0]);
  const advanceOf = (list) => list.filter((c) => cmap.has(c)).map((c) => advances[cmap.get(c)] || 0);
  const features = readFeatureTags(buf, tables.GSUB);
  const digitsUniform = same(advanceOf(DIGITS));
  const pixels = pixelGrid(buf, tables, cmap, advances, upm);
  const inked = advances.filter((a) => a > 0);
  const form = lowercaseForm(buf, tables, cmap);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

  return {
    unitsPerEm: upm,
    xHeight: x ? em(x / upm) : null,
    capHeight: h ? em(h / upm) : null,
    xToCap: x && h ? em(x / h) : null,
    heightSource: fromOutline ? "outline" : "os2",
    os2XHeight: os2X ? em(os2X / upm) : null,
    os2CapHeight: os2H ? em(os2H / upm) : null,
    lowercaseAdvance: lower.length ? em(mean(lower) / upm) : null,
    averageAdvance: inked.length ? em(mean(inked) / upm) : null,
    fixedPitch: buf.readUInt32BE(tables.post.offset + 12) !== 0,
    uniformAdvance: inked.length > 0 && inked.every((a) => a === inked[0]),
    asciiMonospaced: same(advanceOf(PRINTABLE_ASCII)),
    digitsUniform,
    tabularFigures: digitsUniform || features.includes("tnum"),
    lowercaseForm: form,
    pixelsPerEm: pixels,
    pixelated: pixels !== null,
    widthClass: buf.readUInt16BE(os2 + 6),
    features,
    gposFeatures: readFeatureTags(buf, tables.GPOS),
    figureStyle: figureStyleOf(buf, tables, cmap, upm),
    alternateLetterCount: alternateLettersOf(buf, tables, cmap).length,
    unicaseLetterCount: safely(() => unicaseLettersOf(buf, tables, cmap, form)),
    stencilLetterCount: safely(() => stencilLettersOf(buf, tables, cmap, upm)),
    numGlyphs: info.numGlyphs,
    codepointCount: info.codepoints.size,
  };
}

/** Italic according to OS/2 fsSelection bit 0 or head macStyle bit 1. */
function isItalic(info) {
  return Boolean(info.fsSelection & 1 || info.macStyle & 2);
}

/**
 * Embedding permissions from OS/2 fsType (OpenType spec). Bit 1 set alone
 * means "Restricted License embedding": the font must not be embedded —
 * such a file is rejected whatever its license text says.
 */
function embedding(fsType) {
  const low = fsType & 0x000f;
  if (low === 0) return "installable";
  if (low & 0x0008) return "editable";
  if (low & 0x0004) return "preview-print";
  if (low & 0x0002) return "restricted";
  return "unknown";
}

// ---------------------------------------------------------------------
// WOFF2
// ---------------------------------------------------------------------

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ",
  "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp",
  "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF",
  "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc",
  "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx",
  "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos.at++];
    if (i === 0 && byte === 0x80) throw new Error("bad UIntBase128 (leading zero)");
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("bad UIntBase128 (too long)");
}

/**
 * Structural WOFF2 check. Returns { flavor, numTables, tables, totalSfntSize }
 * or throws.
 */
function checkWoff2(buf) {
  if (tag(buf, 0) !== "wOF2") throw new Error("missing wOF2 signature");
  const length = buf.readUInt32BE(8);
  if (length !== buf.length) {
    throw new Error(`declared length ${length} != file size ${buf.length}`);
  }
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  const pos = { at: 48 };
  const tables = [];
  let expected = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos.at++];
    const t = (flags & 0x3f) === 0x3f ? tag(buf, (pos.at += 4) - 4) : KNOWN_TAGS[flags & 0x3f];
    const version = flags >> 6;
    const origLength = readBase128(buf, pos);
    const transformed =
      t === "glyf" || t === "loca" ? version !== 3 : version !== 0;
    const size = transformed ? readBase128(buf, pos) : origLength;
    tables.push(t);
    expected += size;
  }
  const stream = buf.subarray(pos.at, pos.at + totalCompressedSize);
  if (stream.length !== totalCompressedSize) throw new Error("compressed stream truncated");
  const out = zlib.brotliDecompressSync(stream);
  if (out.length !== expected) {
    throw new Error(`decompressed ${out.length} bytes, directory declares ${expected}`);
  }
  return { flavor: tag(buf, 4), numTables, tables, decompressedBytes: out.length };
}

module.exports = {
  readSfnt,
  readCmap,
  tableDirectory,
  measure,
  figureStyle,
  alternateLetters,
  stencilLetterCount,
  unicaseLetterCount,
  STENCIL_GLYPHS,
  STENCIL_PIXELS_PER_EM,
  UNICASE_GRID,
  UNICASE_OVERLAP,
  gsubSubstitutions,
  isItalic,
  embedding,
  checkWoff2,
  NAME_IDS,
  FIGURE_X_TOLERANCE,
  FIGURE_DESCENT,
};
