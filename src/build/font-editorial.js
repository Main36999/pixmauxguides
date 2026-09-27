/**
 * src/build/font-editorial.js — the editorial layer of a font detail page.
 *
 * PROTOTYPE. src/data/font-editorial.json holds curated, evidence-backed
 * notes for a declared set of families (site.config.js → fonts.editorial.ids).
 * Families without a record render exactly as before: this module adds
 * sections, it never replaces the metadata, tester or downloads.
 *
 * THE SCHEMA, AND WHY IT IS SHAPED LIKE THIS
 *
 * Every list field is drawn from a fixed vocabulary below, so labels are
 * written once and a typo fails the build instead of shipping. Free text is
 * limited to three places — a pairing's reason, the note, and the evidence —
 * and each is length-bounded.
 *
 * Every claim carries evidence. `evidence` is a list of
 * { for, basis, detail }: `for` names the claim ("bestFor:code",
 * "pairings:lato", "notes"), `basis` says where it comes from, and `detail`
 * records the quote or the measurement. The evidence is never rendered; it
 * is the audit trail a reviewer checks before a record is accepted, and the
 * validator refuses any claim that has none.
 *
 *   upstream-description  the family's DESCRIPTION.en_us.html in google/fonts
 *                         at the commit fonts.json pins
 *   font-file             measured from the shipped font file (glyph
 *                         outlines, hmtx, post, GSUB, cmap)
 *   bpozz-data            a field of the family's record in fonts.json
 *   css-spec              a CSS specification
 *   design-guidance       general typographic practice — allowed for use
 *                         cases and pairings only, never for a characteristic
 *                         or the note, which must be facts about the font
 *   guide-content         the section of a BPOZZ guide that connects it to
 *                         this font — the only basis a related guide takes
 *
 * RELATED GUIDES AND PAIRINGS ARE EARNED, NOT FILLED
 *
 * A record links 0–2 guides, each with guide-content evidence naming the
 * section that makes it relevant to this font; a guide is never a generic
 * fallback. Pairings are 0–3, and "pairings": [] means "no pairing". A
 * pairing's reason leads with the design relationship (display over text,
 * serif against sans, a fixed-width sibling); coverage and weight counts
 * are supporting facts for the evidence, not the reason.
 *
 * MINIMUM USEFULNESS — no word count. The vocabulary lists carry their
 * bounds (LIMITS); beyond them a record must say something in its own
 * words (a pairing or a note), and a note may not repeat the page's About
 * text (the fonts.json description).
 *
 * `notes` is optional. It is BPOZZ's own guidance — rendered as "BPOZZ
 * Design Note", never attributed to the type designer — and a record leaves
 * it out rather than restate what the profile already shows.
 *
 * MEASURED CLAIMS
 *
 * A font-file claim is not taken on trust. Every one is checked against
 * src/build/font-metrics.js (scripts/fonts/sfnt.js measure() over the
 * shipped files), in one of three ways:
 *
 *   a vocabulary term   MEASURED below states its measured claim once
 *   a pairing           the two x-height/cap-height ratios are close
 *   anything else       the evidence entry declares what it claims, as
 *   (a note)            structured data: { …, "measured": [claim, …] }
 *
 * A measured claim is { metric, font?, <comparator>: value } — see
 * COMPARATORS. Evidence details describe the measurement in words and never
 * copy a measured number; `node src/build/font-metrics.js <id>` prints the
 * values.
 *
 * NEAR-DUPLICATE COPY
 *
 * similarEditorial() compares every free-text field (notes, pairing reasons)
 * between different records; a pair scoring SIMILARITY_THRESHOLD or more
 * fails validation. See similarity() for the score.
 *
 * WHAT IS DERIVED, NOT CURATED
 *
 * profileRows() reads weights and italics from the fonts.json record and the
 * scripts from coverage verified against the font file
 * (src/build/font-scripts.js), so none of that is ever typed twice. There is
 * deliberately no spacing row: the only source for one would be the
 * category, which is not a measurement.
 *
 * WHO MAY ESTABLISH A TERM
 *
 * UPSTREAM_ONLY terms (classifications such as Transitional serif, Display
 * face, Text face) need upstream-description evidence; FONT_FILE_ONLY terms
 * (Old-style figures) need font-file evidence, so their measured rule always
 * runs. Text face and Display face exclude each other, and Text face is
 * refused for a family BPOZZ files under Display (EXCLUSIVE_CHARACTERISTICS,
 * NOT_IN_CATEGORY). Whether an upstream sentence states a text-face design
 * intent — "a text typeface", "designed for text setting" — rather than
 * general suitability — "can be used for body text" — is the reviewer's
 * call; the validator enforces the conflicts.
 *
 * SCRIPT AND LANGUAGE CLAIMS
 *
 * COVERAGE_TERMS ties every script or language term ("Cyrillic text",
 * "Scripts other than Latin", …) to the verified coverage, whatever basis its
 * evidence cites: a subset list alone never proves a script.
 */

"use strict";

const fontMetrics = require("./font-metrics.js");
const fontScripts = require("./font-scripts.js");

const BEST_FOR = {
  "data-dense-screens": "Data-dense screens",
  "ui-labels": "UI labels",
  "technical-interfaces": "Technical interfaces",
  "vietnamese-text": "Vietnamese text",
  "cyrillic-text": "Cyrillic text",
  "latin-extended-text": "Latin Extended languages",
  "weight-hierarchies": "Weight-based hierarchies",
  code: "Code and snippets",
  "tabular-data": "Aligned tables and figures",
  "display-headings": "Display headings",
  "short-headings": "Short headings",
  "literary-settings": "Literary and book settings",
  "period-typography": "Period typography",
  "handwritten-accents": "Handwritten accents",
  "narrow-spaces": "Words in narrow spaces",
  "signature-lettering": "Signature-style lettering",
  "names-short-phrases": "Names and short phrases",
  "greek-text": "Greek text",
  "hebrew-text": "Hebrew text",
  "devanagari-text": "Devanagari text",
  "sinhala-text": "Sinhala text",
  "gujarati-text": "Gujarati text",
  "armenian-text": "Armenian text",
  "bilingual-interfaces": "Interfaces in two scripts",
  "screenplays-manuscripts": "Screenplays and manuscripts",
  "all-caps-titles": "All-caps titles",
};

const AVOID_FOR = {
  "non-latin-scripts": "Scripts other than Latin",
  "cyrillic-greek": "Cyrillic or Greek text",
  "extended-latin-languages": "Languages beyond basic Latin",
  "many-weight-hierarchies": "Hierarchies that need several weights",
  "bold-italic-emphasis": "Text that relies on bold or italic emphasis",
  "long-prose": "Long passages of prose",
  "long-body-text": "Long body text",
  "small-text": "Small text sizes",
  "letterspaced-settings": "Letter-spaced settings",
  "fluid-sizing": "Fluid or in-between sizes",
};

const CHARACTERISTICS = {
  "humanist-details": "Humanist details",
  "legibility-focused": "Legibility-focused",
  technical: "Technical",
  grotesque: "Grotesque",
  "adaptive-diacritics": "Adaptive diacritics",
  "case-sensitive-forms": "Case-sensitive forms",
  monospaced: "Monospaced",
  "alternate-zero": "Alternate zero",
  "stylistic-sets": "Stylistic sets",
  "high-contrast": "High contrast",
  didone: "Didone",
  "triangular-serifs": "Triangular serifs",
  "small-x-height": "Small x-height",
  "large-x-height": "Large x-height",
  handwritten: "Handwritten",
  narrow: "Narrow",
  "connected-script": "Connected script",
  "alternate-letterforms": "Alternate letterforms",
  "large-glyph-set": "Large glyph set",
  "historical-revival": "Historical revival",
  "historical-forms": "Historical forms",
  "discretionary-ligatures": "Discretionary ligatures",
  "slab-serif": "Slab serif",
  "wide-lowercase": "Wide lowercase",
  "stylistic-alternates": "Stylistic alternates",
  "signature-script": "Signature script",
  rounded: "Rounded",
  geometric: "Geometric",
  condensed: "Condensed",
  expanded: "Expanded",
  blackletter: "Blackletter",
  typewriter: "Typewriter",
  pixel: "Pixel grid",
  "all-caps": "All caps",
  "small-caps": "Small caps",
  // classification terms: upstream-description evidence only (UPSTREAM_ONLY)
  monolinear: "Monolinear",
  transitional: "Transitional serif",
  "old-style": "Old-style",
  "display-face": "Display face",
  "serif-monospace": "Serif monospace",
  slanted: "Slanted",
  "text-face": "Text face",
  // measured on the default digits of every upright style (FONT_FILE_ONLY)
  "oldstyle-figures": "Old-style figures",
};

/**
 * Classification terms no measurement can establish and no BPOZZ data field
 * records: a record may use one only when the family's upstream description
 * states it (evidence basis "upstream-description").
 */
const UPSTREAM_ONLY = ["monolinear", "transitional", "old-style", "display-face", "serif-monospace", "slanted", "text-face"];

/**
 * Terms only the shipped files can establish: a record may use one only with
 * font-file evidence, so its MEASURED rule always runs. An upstream note that
 * a font "has oldstyle numerals" is not enough — optional onum figures and
 * lining defaults are common (Lato, Fira Mono, Cardo).
 */
const FONT_FILE_ONLY = ["oldstyle-figures"];

/**
 * Text face and Display face are opposite design intents. A record may not
 * claim both, and a family BPOZZ files under the Display category may not
 * claim Text face, whatever its upstream text says (Patua One).
 */
const EXCLUSIVE_CHARACTERISTICS = [["text-face", "display-face"]];
const NOT_IN_CATEGORY = { "text-face": "display" };

const ROLES = { heading: "Heading", body: "Body", ui: "UI", mono: "Mono" };

const BASES = [
  "upstream-description",
  "font-file",
  "bpozz-data",
  "css-spec",
  "design-guidance",
  "guide-content",
];

/** The only basis a related guide accepts, and the only claim it may back. */
const GUIDE_BASIS = "guide-content";

/** Claims that must be facts about the font — no design-guidance basis. */
const FACT_ONLY = /^(characteristics:|notes$)/;

/** Wording that asserts provenance; allowed in a note only with an upstream source. */
const PROVENANCE_WORDING = /\b(inspired by|based on|created for|designed for|used by|revival of|revival)\b/i;

/** Text that must never reach a page. */
const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem|ipsum|placeholder|xxx)\b|\{\{|\[\s*[a-z -]+\s*\]/i;

const LIMITS = {
  bestFor: [2, 4],
  avoidFor: [0, 3],
  characteristics: [2, 6],
  pairings: [0, 3],
  relatedGuides: [0, 2],
  reason: [40, 240],
  notes: [80, 480],
  noteSentences: [1, 3],
};

const FIELDS = [
  "bestFor",
  "avoidFor",
  "characteristics",
  "pairings",
  "notes",
  "relatedGuides",
  "evidence",
];

function isString(v) {
  return typeof v === "string" && v.trim() !== "";
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);
}

// ---------------------------------------------------------------------
// measured claims — what a font-file claim must satisfy
// ---------------------------------------------------------------------

/*
 * A MEASURED CLAIM is a small object naming one measurement and one test:
 *
 *   { "metric": "xToCap", "percentileAtMost": 25 }
 *   { "metric": "xHeight", "sameAs": "ibm-plex-serif" }
 *   { "font": "herr-von-muellerhoff", "metric": "xToCap", "between": [0, 0.333] }
 *
 * `metric` is a field of font-metrics.js's measurements; `font` defaults to
 * the record's own family. Exactly one comparator from COMPARATORS. Only the
 * metrics and comparators the vocabulary rules and records use are supported.
 *
 * A claim is refused when its metric cannot speak for the font
 * (font-metrics.js METRIC_SCOPE): an x-height claim about a font whose a–z
 * are capitals or small caps, or a glyph-count claim about a font whose
 * count is swollen by a non-alphabetic script. Percentile claims already
 * fail there — such fonts have no percentile for the metric.
 */

const RANKED_METRICS = ["xHeight", "capHeight", "xToCap", "lowercaseAdvance", "numGlyphs"];
const BOOLEAN_METRICS = ["fixedPitch", "asciiMonospaced", "tabularFigures", "pixelated"];
const LOWERCASE_FORMS = ["lowercase", "caps", "small-caps", "none"];
const FIGURE_STYLES = ["oldstyle", "lining", "mixed"];
/** Whole-number counts, compared with atLeast. */
const COUNT_METRICS = ["alternateLetterCount"];
/** Metrics compared with "is", and the values each may take (booleans otherwise). */
const ENUM_METRICS = { lowercaseForm: LOWERCASE_FORMS, defaultFigures: FIGURE_STYLES };
const SCRIPT_IDS = Object.keys(fontScripts.SCRIPTS).concat(Object.keys(fontScripts.LANGUAGES));

const isPercent = (v) => Number.isInteger(v) && v >= 0 && v <= 100;

/** comparator → which metrics it applies to, a valid argument, and the test. */
const COMPARATORS = {
  percentileAtMost: { metrics: RANKED_METRICS, valid: isPercent, test: (m, k, a) => m.percentile[k] <= a },
  percentileAtLeast: { metrics: RANKED_METRICS, valid: isPercent, test: (m, k, a) => m.percentile[k] >= a },
  rankFromLowestAtMost: {
    metrics: RANKED_METRICS,
    valid: (a) => Number.isInteger(a) && a >= 1,
    test: (m, k, a, lib) => [...lib.byId.values()].filter((x) => fontMetrics.inPopulation(x, k) && x[k] < m[k]).length + 1 <= a,
  },
  between: {
    metrics: RANKED_METRICS.concat("widthClass"),
    valid: (a) => Array.isArray(a) && a.length === 2 && a.every((n) => typeof n === "number") && a[0] <= a[1],
    test: (m, k, a) => m[k] >= a[0] && m[k] <= a[1],
  },
  sameAs: {
    metrics: RANKED_METRICS,
    valid: (a, lib) => lib.byId.has(a),
    test: (m, k, a, lib) => m[k] === lib.byId.get(a)[k],
  },
  is: {
    metrics: BOOLEAN_METRICS.concat(Object.keys(ENUM_METRICS)),
    valid: (a, lib, k) => (ENUM_METRICS[k] ? ENUM_METRICS[k].includes(a) : typeof a === "boolean"),
    test: (m, k, a) => m[k] === a,
  },
  atLeast: {
    metrics: COUNT_METRICS,
    valid: (a) => Number.isInteger(a) && a >= 1,
    test: (m, k, a) => m[k] >= a,
  },
  /** Verified coverage (src/build/font-scripts.js) includes this script or language. */
  includes: {
    metrics: ["scripts", "historical", "languages"],
    valid: (a) => SCRIPT_IDS.includes(a),
    test: (m, k, a) => m[k].includes(a),
  },
  /**
   * Any of these tags — GSUB tags for "features", GPOS tags for
   * "gposFeatures"; "ssNN" stands for any stylistic set ss01–ss20.
   */
  hasAnyFeature: {
    metrics: ["features", "gposFeatures"],
    valid: (a) => Array.isArray(a) && a.length > 0 && a.every((t) => typeof t === "string" && t.length === 4),
    test: (m, k, a) => m[k].some((t) => a.includes(t) || (a.includes("ssNN") && /^ss\d\d$/.test(t))),
  },
  /**
   * None of these GSUB tags. For a note that corrects an upstream promise
   * ("oldstyle figures, small caps") the shipped file does not keep: the
   * absence is checked, never assumed.
   */
  lacksFeatures: {
    metrics: ["features"],
    valid: (a) => Array.isArray(a) && a.length > 0 && a.every((t) => typeof t === "string" && t.length === 4 && t !== "ssNN"),
    test: (m, k, a) => a.every((t) => !m[k].includes(t)),
  },
};

function describeClaim(c) {
  const op = Object.keys(c).find((k) => COMPARATORS[k]);
  return `${c.font ? `${c.font} ` : ""}${c.metric} ${op} ${JSON.stringify(c[op])}`;
}

/**
 * Checks one measured claim about `selfId`. Returns null when it is well
 * formed and holds on the measurements, else what is wrong.
 */
function measuredClaimProblem(claim, selfId, lib) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return "must be an object";
  const extra = Object.keys(claim).filter((k) => k !== "metric" && k !== "font" && !COMPARATORS[k]);
  if (extra.length) return `has an unknown field "${extra[0]}"`;
  const ops = Object.keys(claim).filter((k) => COMPARATORS[k]);
  if (ops.length !== 1) return `needs exactly one of ${Object.keys(COMPARATORS).join(", ")}`;
  const spec = COMPARATORS[ops[0]];
  if (!spec.metrics.includes(claim.metric)) return `"${ops[0]}" does not apply to metric "${claim.metric}"`;
  if (!spec.valid(claim[ops[0]], lib, claim.metric)) return `"${ops[0]}" has an invalid value ${JSON.stringify(claim[ops[0]])}`;
  const m = lib.byId.get(claim.font === undefined ? selfId : claim.font);
  if (!m) return `font "${claim.font}" is not a measured family`;
  // A measurement may only speak for what it measures (font-metrics.js METRIC_SCOPE).
  const outOfScope = (x) => {
    const scope = fontMetrics.METRIC_SCOPE[claim.metric];
    if (scope === "latin-lowercase" && x.lowercaseForm !== "lowercase") {
      return `${claim.metric} describes ordinary lowercase, but ${x.file} draws its a–z as "${x.lowercaseForm}"`;
    }
    if (scope === "glyph-wide" && !fontMetrics.glyphComparable(x)) {
      return `${claim.metric} counts every glyph, and ${x.file} covers ${x.scripts.concat(x.historical).join(", ")}: not comparable with the library's alphabetic fonts`;
    }
    return null;
  };
  const scoped = outOfScope(m) || (ops[0] === "sameAs" ? outOfScope(lib.byId.get(claim.sameAs)) : null);
  if (scoped) return scoped;
  return spec.test(m, claim.metric, claim[ops[0]], lib) ? null : `${m.file} fails ${describeClaim(claim)}`;
}

/**
 * The measured claim behind each vocabulary term that cites the font files.
 * Written once here, so a record never repeats it. Percentiles are over the
 * whole library (src/build/font-metrics.js); feature tags are GSUB's.
 */
/*
 * MONOSPACED: THE RULE. The user-facing "Monospaced" characteristic needs
 * asciiMonospaced: every printable ASCII character the font maps shares one
 * advance, which is what makes text and code line up. Three other signals
 * are recorded but do not decide:
 *
 *   post.isFixedPitch   a header flag. Cutive Mono, Lekton, Oxygen Mono,
 *                       Press Start 2P and Rubik Mono One leave it unset
 *                       although every ASCII advance is equal.
 *   uniformAdvance      every glyph in the file. Too strict: B612 Mono and
 *                       Major Mono Display keep a few non-ASCII glyphs at
 *                       other widths, yet set ASCII text in exact columns.
 *   category            never proof: Monofett is filed as monospace and its
 *                       ASCII advances differ.
 *
 * "Aligned tables and figures" needs tabularFigures: 0–9 share one default
 * advance, or GSUB offers tnum.
 */
const MEASURED = {
  "characteristics:monospaced": [{ metric: "asciiMonospaced", is: true }],
  "bestFor:tabular-data": [{ metric: "tabularFigures", is: true }],
  "characteristics:condensed": [{ metric: "widthClass", between: [1, 4] }],
  "characteristics:expanded": [{ metric: "widthClass", between: [6, 9] }],
  "characteristics:pixel": [{ metric: "pixelated", is: true }],
  "avoidFor:fluid-sizing": [{ metric: "pixelated", is: true }],
  "characteristics:all-caps": [{ metric: "lowercaseForm", is: "caps" }],
  "bestFor:all-caps-titles": [{ metric: "lowercaseForm", is: "caps" }],
  "characteristics:small-caps": [{ metric: "lowercaseForm", is: "small-caps" }],
  "characteristics:alternate-zero": [{ metric: "features", hasAnyFeature: ["zero"] }],
  "characteristics:stylistic-sets": [{ metric: "features", hasAnyFeature: ["ssNN"] }],
  "characteristics:case-sensitive-forms": [{ metric: "features", hasAnyFeature: ["case"] }],
  "characteristics:historical-forms": [{ metric: "features", hasAnyFeature: ["hist"] }],
  "characteristics:discretionary-ligatures": [{ metric: "features", hasAnyFeature: ["dlig"] }],
  "characteristics:stylistic-alternates": [{ metric: "features", hasAnyFeature: ["salt"] }],
  // Letters with a genuine alternate design, read from the GSUB substitutions
  // (sfnt.js ALTERNATE LETTERS). A feature tag alone is not enough: 'aalt'
  // often holds only ordinals, superiors and locale forms (Brawler, Radley).
  "characteristics:alternate-letterforms": [{ metric: "alternateLetterCount", atLeast: 2 }],
  // Default digits of every upright style; an optional onum never counts.
  "characteristics:oldstyle-figures": [{ metric: "defaultFigures", is: "oldstyle" }],
  "bestFor:period-typography": [{ metric: "features", hasAnyFeature: ["hist", "dlig"] }],
  "characteristics:small-x-height": [{ metric: "xToCap", percentileAtMost: 25 }],
  // The mirror of small-x-height. xToCap is a latin-lowercase metric, so
  // all-caps and small-caps fonts are refused by scope, not by a special case.
  "characteristics:large-x-height": [{ metric: "xToCap", percentileAtLeast: 75 }],
  "bestFor:names-short-phrases": [{ metric: "xToCap", percentileAtMost: 25 }],
  "avoidFor:small-text": [{ metric: "xHeight", percentileAtMost: 25 }],
  "characteristics:narrow": [{ metric: "lowercaseAdvance", percentileAtMost: 15 }],
  "bestFor:narrow-spaces": [{ metric: "lowercaseAdvance", percentileAtMost: 15 }],
  "characteristics:wide-lowercase": [{ metric: "lowercaseAdvance", percentileAtLeast: 75 }],
  "characteristics:large-glyph-set": [{ metric: "numGlyphs", percentileAtLeast: 75 }],
};

/**
 * Script and language vocabulary must agree with the font's VERIFIED coverage
 * (src/build/font-scripts.js), whatever basis the evidence cites: a subset
 * list is not proof, so "Greek text" for a font without basic Greek letters
 * is refused even with bpozz-data evidence.
 */
const COVERAGE_TERMS = {
  "bestFor:vietnamese-text": ["verified Vietnamese coverage", (m) => m.languages.includes("vietnamese")],
  "bestFor:cyrillic-text": ["verified Cyrillic", (m) => m.scripts.includes("cyrillic")],
  "bestFor:greek-text": ["verified Greek", (m) => m.scripts.includes("greek")],
  "bestFor:hebrew-text": ["verified Hebrew", (m) => m.scripts.includes("hebrew")],
  "bestFor:devanagari-text": ["verified Devanagari", (m) => m.scripts.includes("devanagari")],
  "bestFor:sinhala-text": ["verified Sinhala", (m) => m.scripts.includes("sinhala")],
  "bestFor:gujarati-text": ["verified Gujarati", (m) => m.scripts.includes("gujarati")],
  "bestFor:armenian-text": ["verified Armenian", (m) => m.scripts.includes("armenian")],
  "bestFor:latin-extended-text": ["a verified Latin Extended core", (m) => m.coverage.latinExtendedVerified],
  "bestFor:bilingual-interfaces": ["two or more verified living scripts", (m) => m.scripts.length >= 2],
  "avoidFor:non-latin-scripts": ["no verified script but Latin", (m) => m.scripts.every((x) => x === "latin") && !m.historical.length],
  "avoidFor:cyrillic-greek": ["neither Cyrillic nor Greek verified", (m) => !m.scripts.includes("cyrillic") && !m.scripts.includes("greek")],
  "avoidFor:extended-latin-languages": ["no verified Latin Extended core", (m) => !m.coverage.latinExtendedVerified],
};

/** A font-file pairing claim: the two x-height/cap-height ratios are this close. */
const PAIRING_X_TO_CAP = 0.05;

// ---------------------------------------------------------------------
// near-duplicate copy
// ---------------------------------------------------------------------

/** Pairs of free-text fields scoring this or more are near-duplicates. */
const SIMILARITY_THRESHOLD = 0.55;

/** Texts shorter than this many content words are too short to compare. */
const SIMILARITY_MIN_WORDS = 5;

/** Function words dropped before comparing — they carry no editorial content. */
const STOP_WORDS = new Set(
  (
    "a an the and or but nor of to in on at by for with from as is are was were be been being " +
    "it its this that these those so than then which who whom whose what when where while " +
    "can could will would should may might must has have had do does did not no into onto " +
    "over under about also only just more most less very each every any all both one same " +
    "such their there here they them he she his her we our you your i"
  ).split(" "),
);

/**
 * Normalised content words: case-folded, accents and punctuation removed,
 * `names` (the font's own name, a partner's) replaced by one shared token so
 * "Prata has one weight" and "Lobster has one weight" compare as equal, stop
 * words dropped, and a plain plural "s" trimmed.
 */
function contentWords(text, names = []) {
  let t = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  names
    .slice()
    .sort((a, b) => b.length - a.length)
    .forEach((n) => {
      t = t.split(n.toLowerCase()).join(" fontname ");
    });
  return t
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}

function overlap(a, b) {
  let shared = 0;
  a.forEach((x) => b.has(x) && shared++);
  return shared;
}

/**
 * Similarity of two word lists, 0–1: the mean of the Jaccard index of their
 * word sets (shared vocabulary) and the Dice coefficient of their adjacent
 * word pairs (shared phrasing). Sharing a few ordinary words scores low;
 * the same sentence with a name or a number swapped scores high.
 */
function similarity(wordsA, wordsB) {
  const a = new Set(wordsA);
  const b = new Set(wordsB);
  const words = overlap(a, b) / (a.size + b.size - overlap(a, b) || 1);
  const pairs = (w) => new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
  const pa = pairs(wordsA);
  const pb = pairs(wordsB);
  const phrasing = pa.size + pb.size ? (2 * overlap(pa, pb)) / (pa.size + pb.size) : 0;
  return Math.round(((words + phrasing) / 2) * 1000) / 1000;
}

/**
 * Every pair of free-text fields, from two different records, that scores
 * `threshold` or more: [{ a: { id, field }, b: { id, field }, score }], most
 * similar first. `nameOf(id)` gives a font's display name.
 */
function similarEditorial(records, nameOf, threshold = SIMILARITY_THRESHOLD) {
  const texts = [];
  Object.entries(records).forEach(([id, rec]) => {
    if (isString(rec.notes)) texts.push({ id, field: "notes", words: contentWords(rec.notes, [nameOf(id)]) });
    (rec.pairings || []).forEach((p, i) => {
      if (!isString(p.reason)) return;
      const names = [nameOf(id), nameOf(p.font)].filter(Boolean);
      texts.push({ id, field: `pairings[${i}].reason`, words: contentWords(p.reason, names) });
    });
  });
  const found = [];
  texts.forEach((a, i) => {
    texts.slice(i + 1).forEach((b) => {
      if (a.id === b.id) return;
      if (a.words.length < SIMILARITY_MIN_WORDS || b.words.length < SIMILARITY_MIN_WORDS) return;
      const score = similarity(a.words, b.words);
      if (score >= threshold) found.push({ a: { id: a.id, field: a.field }, b: { id: b.id, field: b.field }, score });
    });
  });
  return found.sort((x, y) => y.score - x.score);
}

/**
 * Validates the editorial data against the vocabulary, the font list, the
 * guide list, the declared set of families, the font measurements
 * (`metrics`, from font-metrics.js measureLibrary()) and itself — no two
 * records may carry near-duplicate copy. Throws one error listing every
 * problem; returns a plain { id: record } map on success.
 */
function validateFontEditorial(raw, { fonts, guides, config, metrics, label = "font-editorial.json" }) {
  const errors = [];
  const err = (msg) => errors.push(`${label}: ${msg}`);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: must be an object keyed by font id`);
  }

  const fontIds = new Set(fonts.map((f) => f.id));
  const guideIds = new Set(guides.map((g) => g.id));
  const declared = ((config.fonts && config.fonts.editorial && config.fonts.editorial.ids) || []).slice();
  const declaredSet = new Set(declared);

  if (!metrics) err("font measurements (metrics) are required to check font-file evidence");

  declared.forEach((id) => {
    if (!fontIds.has(id)) err(`site.config.js declares "${id}", which is not in fonts.json`);
    if (!Object.prototype.hasOwnProperty.call(raw, id)) err(`"${id}" is declared in site.config.js but has no record`);
  });

  const out = {};
  for (const [id, rec] of Object.entries(raw)) {
    const at = `"${id}"`;
    if (!fontIds.has(id)) err(`${at} is not a font id in fonts.json`);
    if (!declaredSet.has(id)) err(`${at} has a record but is not declared in site.config.js fonts.editorial.ids`);
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
      err(`${at} must be an object`);
      continue;
    }
    Object.keys(rec).forEach((k) => {
      if (!FIELDS.includes(k)) err(`${at} has an unknown field "${k}"`);
    });

    const claims = [];
    const list = (field, vocab) => {
      const v = rec[field];
      const [min, max] = LIMITS[field];
      if (!Array.isArray(v)) return err(`${at}.${field} must be an array`);
      if (v.length < min || v.length > max) err(`${at}.${field} needs ${min}–${max} entries, has ${v.length}`);
      if (new Set(v).size !== v.length) err(`${at}.${field} has duplicates`);
      v.forEach((term) => {
        if (!Object.prototype.hasOwnProperty.call(vocab, term)) err(`${at}.${field}: "${term}" is not in the vocabulary`);
        claims.push(`${field}:${term}`);
      });
    };
    list("bestFor", BEST_FOR);
    list("avoidFor", AVOID_FOR);
    list("characteristics", CHARACTERISTICS);
    (rec.bestFor || []).forEach((t) => {
      if ((rec.avoidFor || []).includes(t)) err(`${at}: "${t}" is both bestFor and avoidFor`);
    });

    // pairings
    if (!Array.isArray(rec.pairings)) err(`${at}.pairings must be an array`);
    else {
      const [min, max] = LIMITS.pairings;
      if (rec.pairings.length < min || rec.pairings.length > max) {
        err(`${at}.pairings needs ${min}–${max} entries, has ${rec.pairings.length}`);
      }
      const seen = new Set();
      rec.pairings.forEach((p, i) => {
        const pat = `${at}.pairings[${i}]`;
        if (!p || typeof p !== "object") return err(`${pat} must be an object`);
        Object.keys(p).forEach((k) => {
          if (!["font", "role", "reason"].includes(k)) err(`${pat} has an unknown field "${k}"`);
        });
        if (!fontIds.has(p.font)) err(`${pat}.font "${p.font}" is not in fonts.json`);
        if (p.font === id) err(`${pat} pairs the font with itself`);
        if (seen.has(p.font)) err(`${pat}: "${p.font}" is paired twice`);
        seen.add(p.font);
        if (!Object.prototype.hasOwnProperty.call(ROLES, p.role)) err(`${pat}.role "${p.role}" is not one of ${Object.keys(ROLES).join(", ")}`);
        const [rmin, rmax] = LIMITS.reason;
        if (!isString(p.reason)) err(`${pat}.reason is required`);
        else if (p.reason.length < rmin || p.reason.length > rmax) err(`${pat}.reason must be ${rmin}–${rmax} characters, is ${p.reason.length}`);
        else if (PLACEHOLDER.test(p.reason)) err(`${pat}.reason contains placeholder text`);
        claims.push(`pairings:${p.font}`);
      });
    }

    // notes — optional. A record without one renders no BPOZZ Design Note;
    // a present note must be real text (an empty string is an error, never
    // an empty section).
    const [nmin, nmax] = LIMITS.notes;
    if (rec.notes === undefined) {
      // no note
    } else if (!isString(rec.notes)) err(`${at}.notes must be non-empty text, or left out`);
    else {
      if (rec.notes.length < nmin || rec.notes.length > nmax) err(`${at}.notes must be ${nmin}–${nmax} characters, is ${rec.notes.length}`);
      const n = sentences(rec.notes).length;
      if (n < LIMITS.noteSentences[0] || n > LIMITS.noteSentences[1]) err(`${at}.notes must be 1–3 sentences, has ${n}`);
      if (PLACEHOLDER.test(rec.notes)) err(`${at}.notes contains placeholder text`);
      claims.push("notes");
    }

    // related guides
    if (!Array.isArray(rec.relatedGuides)) err(`${at}.relatedGuides must be an array`);
    else {
      const [gmin, gmax] = LIMITS.relatedGuides;
      if (rec.relatedGuides.length < gmin || rec.relatedGuides.length > gmax) err(`${at}.relatedGuides needs ${gmin}–${gmax} entries`);
      if (new Set(rec.relatedGuides).size !== rec.relatedGuides.length) err(`${at}.relatedGuides has duplicates`);
      rec.relatedGuides.forEach((g) => {
        if (!guideIds.has(g)) err(`${at}.relatedGuides: "${g}" is not a guide in guides.json`);
        claims.push(`relatedGuides:${g}`);
      });
    }

    // minimum usefulness: the vocabulary lists are bounded above; beyond
    // them, a record must say something in its own words — a justified
    // pairing or a note. `"pairings": []` is an explicit "no pairing".
    if (Array.isArray(rec.pairings) && !rec.pairings.length && rec.notes === undefined) {
      err(`${at} has neither a pairing nor a note — nothing on the page would be specific to this font`);
    }
    const self = fonts.find((f) => f.id === id);
    if (self && isString(rec.notes) && isString(self.description)) {
      const score = similarity(contentWords(rec.notes, [self.name]), contentWords(self.description, [self.name]));
      if (score >= SIMILARITY_THRESHOLD) {
        err(`${at}.notes repeats the page's About text from fonts.json (similarity ${score.toFixed(3)}, limit ${SIMILARITY_THRESHOLD})`);
      }
    }

    // evidence: every claim needs at least one entry, with a valid basis
    const evidence = Array.isArray(rec.evidence) ? rec.evidence : [];
    if (!Array.isArray(rec.evidence)) err(`${at}.evidence must be an array`);
    const byClaim = new Map();
    const stated = []; // [eat, claim, measured[]] — font-file evidence that states its own measured claims
    evidence.forEach((e, i) => {
      const eat = `${at}.evidence[${i}]`;
      if (!e || !isString(e.for) || !isString(e.detail)) return err(`${eat} needs "for" and "detail"`);
      Object.keys(e).forEach((k) => {
        if (!["for", "basis", "detail", "measured"].includes(k)) err(`${eat} has an unknown field "${k}"`);
      });
      if (!BASES.includes(e.basis)) err(`${eat}.basis "${e.basis}" is not one of ${BASES.join(", ")}`);
      if (e.measured !== undefined) {
        if (e.basis !== "font-file") err(`${eat}.measured is only for font-file evidence`);
        else if (!Array.isArray(e.measured) || !e.measured.length) err(`${eat}.measured must be a non-empty array`);
        else if (MEASURED[e.for] || e.for.startsWith("pairings:")) err(`${eat}.measured: "${e.for}" is already checked by its rule; leave measured out`);
        else stated.push([eat, e.for, e.measured]);
      } else if (e.basis === "font-file" && !MEASURED[e.for] && !e.for.startsWith("pairings:")) {
        err(`${eat}: "${e.for}" cites the font files but no rule covers it — declare the claim in "measured" (or add a vocabulary rule to MEASURED)`);
      }
      if (!claims.includes(e.for)) err(`${eat} is evidence for "${e.for}", which the record does not claim`);
      if (FACT_ONLY.test(e.for) && e.basis === "design-guidance") err(`${eat}: "${e.for}" must be a fact about the font, not design guidance`);
      if (e.for.startsWith("relatedGuides:") !== (e.basis === GUIDE_BASIS)) {
        err(`${eat}: a related guide needs "${GUIDE_BASIS}" evidence naming the section that connects it to this font, and "${GUIDE_BASIS}" backs nothing else`);
      }
      if (!byClaim.has(e.for)) byClaim.set(e.for, []);
      byClaim.get(e.for).push(e.basis);
    });
    claims.forEach((c) => {
      if (!byClaim.has(c)) err(`${at}: "${c}" has no evidence`);
    });
    UPSTREAM_ONLY.forEach((t) => {
      const c = `characteristics:${t}`;
      if (byClaim.has(c) && !byClaim.get(c).includes("upstream-description")) {
        err(`${at}: "${c}" is a classification only the upstream description can establish; it needs upstream-description evidence`);
      }
    });
    FONT_FILE_ONLY.forEach((t) => {
      const c = `characteristics:${t}`;
      if (byClaim.has(c) && !byClaim.get(c).includes("font-file")) {
        err(`${at}: "${c}" is measured from the shipped files; it needs font-file evidence, whatever the upstream text says`);
      }
    });
    const chars = Array.isArray(rec.characteristics) ? rec.characteristics : [];
    EXCLUSIVE_CHARACTERISTICS.forEach(([a, b]) => {
      if (chars.includes(a) && chars.includes(b)) err(`${at}: "${a}" and "${b}" are opposite design intents; a record may claim only one`);
    });
    Object.entries(NOT_IN_CATEGORY).forEach(([t, category]) => {
      if (chars.includes(t) && self && self.category === category) {
        err(`${at}: "${t}" conflicts with the family's BPOZZ category "${category}"`);
      }
    });

    // font-file claims must hold on the shipped files
    if (metrics && metrics.byId.has(id)) {
      const m = metrics.byId.get(id);
      const check = (where, claim, measured) =>
        measured.forEach((c, j) => {
          const problem = measuredClaimProblem(c, id, metrics);
          if (problem) err(`${where}: "${claim}" measured[${j}] ${problem}`);
        });
      stated.forEach(([eat, claim, measured]) => check(eat, claim, measured));
      byClaim.forEach((bases, claim) => {
        if (!bases.includes("font-file")) return;
        if (claim.startsWith("pairings:")) {
          const partner = metrics.byId.get(claim.slice("pairings:".length));
          if (!partner) return; // unknown font, reported above
          const gap = Math.abs(m.xToCap - partner.xToCap);
          if (!(gap <= PAIRING_X_TO_CAP)) {
            err(`${at}: "${claim}" cites the font files, but the x-height/cap-height ratios differ by ${gap.toFixed(3)} (limit ${PAIRING_X_TO_CAP})`);
          }
          return;
        }
        if (MEASURED[claim]) check(at, claim, MEASURED[claim]);
      });
      claims.forEach((claim) => {
        const rule = COVERAGE_TERMS[claim];
        if (rule && !rule[1](m)) err(`${at}: "${claim}" needs ${rule[0]}, which ${m.file} does not have (scripts: ${fontScripts.scriptsLabel(m.coverage) || "none"})`);
      });
    }
    if (isString(rec.notes) && PROVENANCE_WORDING.test(rec.notes) && !(byClaim.get("notes") || []).includes("upstream-description")) {
      err(`${at}.notes makes a provenance claim ("${rec.notes.match(PROVENANCE_WORDING)[0]}") without upstream-description evidence`);
    }

    out[id] = rec;
  }

  const nameOf = (fid) => (fonts.find((f) => f.id === fid) || {}).name;
  similarEditorial(out, nameOf).forEach(({ a, b, score }) => {
    err(`"${a.id}".${a.field} and "${b.id}".${b.field} are near-duplicates (similarity ${score.toFixed(3)}, limit ${SIMILARITY_THRESHOLD})`);
  });

  if (errors.length) throw new Error(errors.join("\n"));
  return out;
}

// ---------------------------------------------------------------------
// derived profile — read from the fonts.json record, never curated
// ---------------------------------------------------------------------

function weightsText(font) {
  const w = [...new Set(font.variants.map((v) => v.weight))].sort((a, b) => a - b);
  if (w.length === 1) return `${w[0]} only`;
  if (w.length === 2) return `${w[0]} and ${w[1]}`;
  return `${w[0]}–${w[w.length - 1]} · ${w.length} weights`;
}

function italicsText(font) {
  const weights = new Set(font.variants.map((v) => v.weight));
  const italic = new Set(font.variants.filter((v) => v.style === "italic").map((v) => v.weight));
  if (italic.size === 0) return "None";
  if (italic.size === weights.size) return weights.size === 1 ? "Yes" : "Every weight";
  return `${italic.size} of ${weights.size} weights`;
}

/**
 * [label, text] pairs for the Typography profile, all derived: weights and
 * italics from the fonts.json record, scripts from the coverage verified
 * against the font file (`measured`, font-metrics.js measureFamily()).
 */
function profileRows(font, measured) {
  if (!measured || !measured.coverage) throw new Error(`profileRows(${font.id}) needs the family's measurements`);
  return [
    ["Weights", weightsText(font)],
    ["Italics", italicsText(font)],
    ["Scripts", fontScripts.scriptsLabel(measured.coverage)],
  ];
}

module.exports = {
  validateFontEditorial,
  profileRows,
  BEST_FOR,
  AVOID_FOR,
  CHARACTERISTICS,
  ROLES,
  BASES,
  LIMITS,
  PLACEHOLDER,
  MEASURED,
  COVERAGE_TERMS,
  UPSTREAM_ONLY,
  FONT_FILE_ONLY,
  EXCLUSIVE_CHARACTERISTICS,
  NOT_IN_CATEGORY,
  COMPARATORS,
  measuredClaimProblem,
  PAIRING_X_TO_CAP,
  SIMILARITY_THRESHOLD,
  contentWords,
  similarity,
  similarEditorial,
};
