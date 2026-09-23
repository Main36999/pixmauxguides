/**
 * scripts/fonts/sfnt.js — a small, dependency-free reader for the font files
 * the library ships: TrueType/OpenType (sfnt) and WOFF2.
 *
 * It reads only what the font checks need — never glyph outlines:
 *
 *   name   the naming records (family, style, version, copyright, license)
 *   OS/2   usWeightClass, fsType (embedding permissions), fsSelection
 *   head   macStyle
 *   maxp   numGlyphs
 *   cmap   the set of Unicode code points the font maps
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

/** Every code point mapped by the best Unicode cmap subtable (format 4 or 12). */
function readCodepoints(buf, table) {
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
  const cps = new Set();
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
        if (glyph) cps.add(c);
      }
    }
  } else {
    const groups = buf.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const at = o + 16 + g * 12;
      const start = buf.readUInt32BE(at);
      const end = buf.readUInt32BE(at + 4);
      for (let c = start; c <= end; c++) cps.add(c);
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
    codepoints: readCodepoints(buf, tables.cmap),
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

module.exports = { readSfnt, isItalic, embedding, checkWoff2, NAME_IDS };
