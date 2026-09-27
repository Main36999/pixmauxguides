/**
 * src/build/font-scripts.js — what a font's subsets mean, and which of them
 * the font file actually supports.
 *
 * fonts.json lists Google Fonts subsets. They are not all writing systems:
 *
 *   script       a living writing system            latin, cyrillic, hebrew …
 *   extension    more of a script already listed    latin-ext, cyrillic-ext …
 *   language     a language written in a script     vietnamese (Latin)
 *   historical   a historical writing system        gothic, old-italic, runic
 *   symbols      technical glyph collections        math, symbols, symbols2,
 *                                                   braille (Braille patterns)
 *
 * A subset only says which characters Google's serving pipeline slices; it
 * is not proof the font can set the script. So coverage is VERIFIED against
 * the font file's cmap: a script, language or historical script counts only
 * when every code point of its CORE set is mapped. Great Vibes lists
 * greek-ext but has no basic Greek lowercase — it does not support Greek.
 *
 * An extension (latin-ext, cyrillic-ext, greek-ext) never adds a script on
 * its own name: it makes its base script eligible, and the base script's core
 * letters decide. Five fonts list only cyrillic-ext and map no basic
 * Cyrillic; they do not support Cyrillic. Symbol collections never appear
 * as scripts.
 *
 * LATIN EXTENDED IS THE ONE UNVERIFIED LABEL. "Latin (incl. Extended)"
 * follows the latin-ext subset, as the approved prototype pages do, because
 * it qualifies Latin rather than naming a script. latinExtendedVerified
 * records whether the Central European core is really mapped (it is for 186
 * of the 233 fonts listing latin-ext), and the validator refuses a Latin
 * Extended claim that it does not back.
 *
 * Every subset in fonts.json must be classified here; font-editorial.test.js
 * fails on an unknown one rather than guessing a label.
 */

"use strict";

const range = (from, to, skip = []) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((c) => !skip.includes(c));

/** Writing systems: user-facing label and the core letters that prove support. */
const SCRIPTS = {
  latin: { label: "Latin", core: range(0x41, 0x5a).concat(range(0x61, 0x7a)) },
  cyrillic: { label: "Cyrillic", core: range(0x410, 0x44f) },
  greek: { label: "Greek", core: range(0x391, 0x3a9, [0x3a2]).concat(range(0x3b1, 0x3c9)) },
  armenian: { label: "Armenian", core: range(0x531, 0x556).concat(range(0x561, 0x586)) },
  hebrew: { label: "Hebrew", core: range(0x5d0, 0x5ea) },
  // Consonants, less the three nukta composites (U+0929, U+0931, U+0934),
  // which fonts build from consonant + U+093C rather than map directly.
  devanagari: { label: "Devanagari", core: range(0x915, 0x939, [0x929, 0x931, 0x934]) },
  gujarati: { label: "Gujarati", core: range(0xa95, 0xab9, [0xaa9, 0xab1, 0xab4]) },
  sinhala: { label: "Sinhala", core: range(0xd9a, 0xdc6, [0xdb2, 0xdbc, 0xdbe, 0xdbf]) },
  gothic: { label: "Gothic", historical: true, core: range(0x10330, 0x1034a) },
  "old-italic": { label: "Old Italic", historical: true, core: range(0x10300, 0x1031e) },
  runic: { label: "Runic", historical: true, core: range(0x16a0, 0x16ea) },
};

/** Language coverage within a script, verified the same way. */
const LANGUAGES = {
  vietnamese: {
    label: "Vietnamese",
    script: "latin",
    core: [0x110, 0x111, 0x1a0, 0x1a1, 0x1af, 0x1b0].concat(range(0x1ea0, 0x1ef9)),
  },
};

/** Latin Extended: the Central European letters that "(incl. Extended)" promises. */
const LATIN_EXTENDED_CORE = [
  0x104, 0x105, 0x106, 0x107, 0x10c, 0x10d, 0x118, 0x119, 0x141, 0x142, 0x143, 0x144,
  0x150, 0x151, 0x158, 0x159, 0x15a, 0x15b, 0x160, 0x161, 0x17b, 0x17c, 0x17d, 0x17e,
];

/** Every subset fonts.json uses, and what kind of thing it is. */
const SUBSETS = {
  latin: { kind: "script", script: "latin" },
  "latin-ext": { kind: "extension", script: "latin" },
  cyrillic: { kind: "script", script: "cyrillic" },
  "cyrillic-ext": { kind: "extension", script: "cyrillic" },
  greek: { kind: "script", script: "greek" },
  "greek-ext": { kind: "extension", script: "greek" },
  armenian: { kind: "script", script: "armenian" },
  hebrew: { kind: "script", script: "hebrew" },
  devanagari: { kind: "script", script: "devanagari" },
  gujarati: { kind: "script", script: "gujarati" },
  sinhala: { kind: "script", script: "sinhala" },
  vietnamese: { kind: "language", language: "vietnamese" },
  gothic: { kind: "historical", script: "gothic" },
  "old-italic": { kind: "historical", script: "old-italic" },
  runic: { kind: "historical", script: "runic" },
  math: { kind: "symbols" },
  symbols: { kind: "symbols" },
  symbols2: { kind: "symbols" },
  braille: { kind: "symbols" },
};

const covers = (codepoints, core) => core.every((c) => codepoints.has(c));

/**
 * Verified coverage of a font: its listed subsets checked against the code
 * points its file maps. Returns
 *
 *   scripts       living scripts, in subset order         ["cyrillic", "latin"]
 *   historical    historical scripts                      ["gothic", "runic"]
 *   languages     verified language coverage              ["vietnamese"]
 *   latinExtended latin-ext listed (the label follows the subset)
 *   latinExtendedVerified  and its Central European core is mapped
 *   unverified    listed subsets the file does not back   ["greek-ext"]
 *   symbols       symbol collections (never shown as scripts)
 *   unknown       subsets this module does not classify (a test fails on any)
 */
function coverage(subsets, codepoints) {
  const out = { scripts: [], historical: [], languages: [], latinExtended: false, unverified: [], symbols: [], unknown: [] };
  const claimed = [];
  subsets.forEach((s) => {
    const info = SUBSETS[s];
    if (!info) return out.unknown.push(s);
    if (info.kind === "symbols") return out.symbols.push(s);
    if (info.kind === "language") {
      const lang = LANGUAGES[info.language];
      if (covers(codepoints, lang.core)) out.languages.push(info.language);
      else out.unverified.push(s);
      return;
    }
    if (!claimed.includes(info.script)) claimed.push(info.script);
    if (s === "latin-ext" && !covers(codepoints, LATIN_EXTENDED_CORE)) out.unverified.push(s);
  });
  claimed.forEach((id) => {
    const script = SCRIPTS[id];
    if (!covers(codepoints, script.core)) {
      subsets.filter((s) => SUBSETS[s] && SUBSETS[s].script === id).forEach((s) => out.unverified.push(s));
      return;
    }
    (script.historical ? out.historical : out.scripts).push(id);
  });
  out.latinExtended = subsets.includes("latin-ext") && out.scripts.includes("latin");
  out.latinExtendedVerified = out.latinExtended && !out.unverified.includes("latin-ext");
  return out;
}

/**
 * The profile's Scripts text: Latin first, then the other living scripts in
 * data order, then verified language coverage (Vietnamese is written in
 * Latin, but it is what a reader looks for), then historical scripts named as
 * such. "(incl. Extended)" follows the latin-ext subset — see above.
 */
function scriptsLabel(cov) {
  const names = cov.scripts
    .slice()
    .sort((a, b) => (a === "latin" ? -1 : b === "latin" ? 1 : 0))
    .map((id) => (id === "latin" && cov.latinExtended ? "Latin (incl. Extended)" : SCRIPTS[id].label))
    .concat(cov.languages.map((id) => LANGUAGES[id].label));
  const text = names.join(", ");
  if (!cov.historical.length) return text;
  const historical = `historical scripts: ${cov.historical.map((id) => SCRIPTS[id].label).join(", ")}`;
  return text ? `${text}; ${historical}` : historical;
}

module.exports = { SCRIPTS, LANGUAGES, SUBSETS, LATIN_EXTENDED_CORE, coverage, scriptsLabel };
