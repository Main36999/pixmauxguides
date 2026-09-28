/**
 * src/build/font-editorial.test.js — the font-page editorial layer (prototype).
 *
 *     node --test src/build/font-editorial.test.js
 *
 * Five groups: the font measurements (scripts/fonts/sfnt.js measure() via
 * font-metrics.js), the validator (it accepts the committed data and refuses
 * each kind of bad record), near-duplicate detection, the rendered sections
 * on the prototype pages, and the guarantee that every other font page is
 * byte-for-byte what it would be with no editorial data at all.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const fonts = require("./fonts.js");
const editorial = require("./font-editorial.js");
const fontMetrics = require("./font-metrics.js");
const sfnt = require("../../scripts/fonts/sfnt.js");
const path = require("path");

const model = content.load(config);
const raw = JSON.parse(fs.readFileSync(config.paths.content.fontEditorial, "utf8"));
const PROTOTYPE = config.fonts.editorial.ids;
/** The ten approved prototype records (Batch 1); Batch 2 follows them in PROTOTYPE. */
const BATCH1 = [
  "b612", "be-vietnam-pro", "ibm-plex-mono", "prata", "sue-ellen-francisco",
  "lobster", "im-fell-english", "sanchez", "herr-von-muellerhoff", "mr-dafoe",
];

const withLayer = fonts.build({ config, model });
const withoutLayer = fonts.build({ config, model: Object.assign({}, model, { fontEditorial: {} }) });
const page = (out, id) => out.pages.find((p) => p.file === `fonts/${id}.html`).html;

const clone = (v) => JSON.parse(JSON.stringify(v));
const metrics = fontMetrics.measureLibrary(model.fonts, config.paths.content.fontFiles);
const validate = (data, cfg = config) =>
  editorial.validateFontEditorial(data, { fonts: model.fonts, guides: model.guides, config: cfg, metrics });

/** A copy of the data with one record changed by `edit`. */
function mutated(id, edit) {
  const data = clone(raw);
  edit(data[id]);
  return data;
}

// ---------------------------------------------------------------------
// measurements — scripts/fonts/sfnt.js measure(), src/build/font-metrics.js
// ---------------------------------------------------------------------

const PARTNERS = [...new Set(Object.values(raw).flatMap((r) => r.pairings.map((p) => p.font)))];
const fileOf = (id) => {
  const f = model.fonts.find((x) => x.id === id);
  return path.join(config.paths.content.fontFiles, id, fontMetrics.referenceVariant(f).file);
};

test("measure() is deterministic: the same bytes always give the same numbers", () => {
  PROTOTYPE.concat(PARTNERS).forEach((id) => {
    const buf = fs.readFileSync(fileOf(id));
    assert.deepStrictEqual(sfnt.measure(buf), sfnt.measure(Buffer.from(buf)), id);
  });
  const again = fontMetrics.measureLibrary(model.fonts, config.paths.content.fontFiles);
  assert.deepStrictEqual([...again.byId], [...metrics.byId]);
  assert.deepStrictEqual(again.median, metrics.median);
});

test("measure() reads every shipped family without error and gives plausible values", () => {
  assert.strictEqual(metrics.byId.size, model.fonts.length);
  metrics.byId.forEach((m, id) => {
    assert.ok(m.unitsPerEm >= 16 && m.unitsPerEm <= 16384, `${id} unitsPerEm`);
    // caps-only faces (Bebas Neue, Bungee …) have x = H; Eater's x overshoots H
    assert.ok(m.xHeight > 0 && m.xHeight < 1.5 && m.capHeight > 0 && m.capHeight < 1.5, `${id} heights`);
    assert.ok(m.xToCap > 0 && m.xToCap <= 1.1, `${id} xToCap`);
    assert.ok(m.lowercaseAdvance > 0 && m.lowercaseAdvance < 2, `${id} lowercase advance`);
    assert.ok(m.numGlyphs > 0 && m.codepointCount > 0, `${id} glyphs`);
    assert.deepStrictEqual(m.features, m.features.slice().sort(), `${id} feature order`);
    Object.values(m.percentile).forEach((p) => assert.ok(Number.isInteger(p) && p >= 0 && p <= 100, id));
  });
});

test("measure() gives the known values of the prototype fonts", () => {
  const m = (id) => metrics.byId.get(id);
  PROTOTYPE.forEach((id) => assert.strictEqual(m(id).heightSource, "outline", id));
  assert.strictEqual(m("ibm-plex-mono").fixedPitch, true);
  assert.strictEqual(m("ibm-plex-mono").uniformAdvance, true);
  assert.strictEqual(m("b612").fixedPitch, false);
  assert.strictEqual(m("b612-mono").fixedPitch, true);
  assert.ok(m("ibm-plex-mono").features.includes("zero"));
  assert.ok(m("im-fell-english").features.includes("hist"));
  assert.strictEqual(m("ibm-plex-sans-condensed").widthClass, 3);
  assert.strictEqual(m("lobster").numGlyphs, sfnt.readSfnt(fs.readFileSync(fileOf("lobster"))).numGlyphs);
  // measure() agrees with the OS/2 table where the font declares the same thing
  assert.strictEqual(m("ibm-plex-mono").xHeight, m("ibm-plex-mono").os2XHeight);
  assert.strictEqual(m("ibm-plex-mono").capHeight, m("ibm-plex-mono").os2CapHeight);
});

test("the reference variant is the upright 400, or the upright weight nearest it", () => {
  assert.strictEqual(fontMetrics.referenceVariant({ variants: [
    { weight: 700, style: "normal", file: "b" }, { weight: 400, style: "italic", file: "i" }, { weight: 300, style: "normal", file: "l" },
  ] }).file, "l");
  assert.strictEqual(fontMetrics.referenceVariant({ variants: [{ weight: 400, style: "italic", file: "i" }] }).file, "i");
});

// ---------------------------------------------------------------------
// measured claims — { metric, font?, <comparator> }, checked by the validator
// ---------------------------------------------------------------------

const problem = (claim, id = "b612") => editorial.measuredClaimProblem(claim, id, metrics);

test("every font-file claim in the data is covered by a rule or declares its measured claims", () => {
  Object.entries(raw).forEach(([id, rec]) => {
    rec.evidence.filter((e) => e.basis === "font-file").forEach((e) => {
      const ruled = Boolean(editorial.MEASURED[e.for]) || e.for.startsWith("pairings:");
      assert.ok(ruled !== Array.isArray(e.measured), `${id} ${e.for}: exactly one of a rule or "measured"`);
      (e.measured || []).forEach((c) => assert.strictEqual(problem(c, id), null, `${id} ${e.for}`));
    });
  });
});

test("each comparator holds when the measurement satisfies it and fails when it does not", () => {
  const b = metrics.byId.get("b612");
  const CASES = [
    [{ metric: "xToCap", percentileAtMost: b.percentile.xToCap }, { metric: "xToCap", percentileAtMost: b.percentile.xToCap - 1 }],
    [{ metric: "numGlyphs", percentileAtLeast: b.percentile.numGlyphs }, { metric: "numGlyphs", percentileAtLeast: b.percentile.numGlyphs + 1 }],
    [{ font: "herr-von-muellerhoff", metric: "xToCap", rankFromLowestAtMost: 3 }, { font: "herr-von-muellerhoff", metric: "xToCap", rankFromLowestAtMost: 1 }],
    [{ metric: "xHeight", between: [b.xHeight, b.xHeight] }, { metric: "xHeight", between: [b.xHeight + 0.001, 1] }],
    [{ font: "ibm-plex-mono", metric: "capHeight", sameAs: "ibm-plex-serif" }, { metric: "capHeight", sameAs: "ibm-plex-serif" }],
    [{ font: "ibm-plex-mono", metric: "fixedPitch", is: true }, { metric: "fixedPitch", is: true }],
    [{ font: "ibm-plex-mono", metric: "features", hasAnyFeature: ["ssNN"] }, { metric: "features", hasAnyFeature: ["ssNN", "zero"] }],
    [{ font: "prata", metric: "scripts", includes: "cyrillic" }, { metric: "scripts", includes: "cyrillic" }],
    [{ font: "crimson-text", metric: "features", lacksFeatures: ["onum", "smcp"] }, { font: "crimson-text", metric: "features", lacksFeatures: ["onum", "dlig"] }],
    [{ font: "lobster", metric: "alternateLetterCount", atLeast: 2 }, { font: "radley", metric: "alternateLetterCount", atLeast: 1 }],
  ];
  assert.deepStrictEqual(CASES.map(([ok]) => Object.keys(ok).find((k) => editorial.COMPARATORS[k])).sort(), Object.keys(editorial.COMPARATORS).sort());
  CASES.forEach(([ok, bad]) => {
    assert.strictEqual(problem(ok), null, JSON.stringify(ok));
    assert.match(problem(bad), /fails/, JSON.stringify(bad));
  });
});

test("malformed measured claims are refused", () => {
  [
    [{ metric: "vibes", percentileAtMost: 10 }, /does not apply to metric "vibes"/],
    [{ metric: "fixedPitch", percentileAtMost: 10 }, /does not apply to metric "fixedPitch"/],
    [{ metric: "xToCap", percentileAtMost: 10, percentileAtLeast: 5 }, /exactly one of/],
    [{ metric: "xToCap" }, /exactly one of/],
    [{ metric: "xToCap", percentileAtMost: 101 }, /invalid value/],
    [{ metric: "xToCap", between: [0.6, 0.4] }, /invalid value/],
    [{ metric: "xHeight", sameAs: "comic-sans" }, /invalid value/],
    [{ metric: "features", hasAnyFeature: [] }, /invalid value/],
    [{ metric: "features", lacksFeatures: [] }, /invalid value/],
    [{ metric: "features", lacksFeatures: ["ssNN"] }, /invalid value/],
    [{ metric: "gposFeatures", lacksFeatures: ["mkmk"] }, /does not apply to metric "gposFeatures"/],
    [{ metric: "scripts", hasAnyFeature: ["mkmk"] }, /does not apply to metric "scripts"/],
    [{ font: "comic-sans", metric: "xToCap", percentileAtMost: 10 }, /not a measured family/],
    [{ metric: "xToCap", percentileAtMost: 10, source: "x" }, /unknown field "source"/],
    ["xToCap <= 10", /must be an object/],
  ].forEach(([claim, message]) => assert.match(problem(claim), message, JSON.stringify(claim)));
});

const noteEvidence = (r) => r.evidence.find((e) => e.for === "notes" && e.basis === "font-file");
const MEASURED_REJECTS = [
  ["a note's measured claim the font file contradicts", "prata", (r) => (noteEvidence(r).measured = [{ metric: "xToCap", percentileAtMost: 5 }]), /"prata"\.evidence\[\d+\]: "notes" measured\[0\] Prata-Regular\.ttf fails xToCap percentileAtMost 5/],
  ["a claim about another family that does not hold", "mr-dafoe", (r) => (noteEvidence(r).measured[1].between = [0, 0.2]), /fails herr-von-muellerhoff xToCap between \[0,0\.2\]/],
  ["a font-file note that declares no measured claim", "lobster", (r) => delete noteEvidence(r).measured, /"notes" cites the font files but no rule covers it/],
  ["an empty measured list", "lobster", (r) => (noteEvidence(r).measured = []), /measured must be a non-empty array/],
  ["measured on a claim a vocabulary rule already checks", "prata", (r) => (r.evidence.find((e) => e.for === "characteristics:small-x-height").measured = [{ metric: "xToCap", percentileAtMost: 25 }]), /already checked by its rule/],
  ["measured on evidence that is not font-file", "prata", (r) => (r.evidence.find((e) => e.basis === "upstream-description").measured = [{ metric: "xToCap", percentileAtMost: 25 }]), /measured is only for font-file evidence/],
  ["an unknown evidence field", "prata", (r) => (r.evidence[0].measuredBy = "eye"), /unknown field "measuredBy"/],
];
MEASURED_REJECTS.forEach(([what, id, edit, message]) => {
  test(`the validator rejects ${what}`, () => {
    assert.throws(() => validate(mutated(id, edit)), message);
  });
});

test("font-file evidence names the measurement instead of copying a number", () => {
  Object.entries(raw).forEach(([id, rec]) => {
    rec.evidence.filter((e) => e.basis === "font-file").forEach((e) => {
      assert.ok(!/\b\d\.\d{2,}\b|\d+(st|nd|rd|th) percentile|\brank \d|numGlyphs \d/.test(e.detail), `${id} ${e.for}: "${e.detail}"`);
    });
  });
});

// ---------------------------------------------------------------------
// schema and validation
// ---------------------------------------------------------------------

test("the committed editorial data passes validation", () => {
  assert.doesNotThrow(() => validate(raw));
});

test("exactly the declared families have a record: Batch 1's ten, Batch 2's twenty, Batch 3's twenty, Batch 4's twenty, Batch 5's four, Batch 6's twenty, Batch 7's twenty, Batch 7B's twenty, Batch 7C's sixteen, Batch 8's twenty, Batch 9's twelve, Batch 10's two, Batch 11's one", () => {
  assert.strictEqual(PROTOTYPE.length, 185);
  assert.strictEqual(new Set(PROTOTYPE).size, PROTOTYPE.length);
  assert.deepStrictEqual(PROTOTYPE.slice(0, 10), BATCH1);
  assert.deepStrictEqual(Object.keys(raw), PROTOTYPE, "records appear in declaration order, Batch 1 first");
  PROTOTYPE.forEach((id) => assert.ok(model.fonts.some((f) => f.id === id), `${id} is not a font`));
});

test("every pairing names a font in the library, never itself, never twice", () => {
  Object.entries(raw).forEach(([id, rec]) => {
    const ids = rec.pairings.map((p) => p.font);
    assert.strictEqual(new Set(ids).size, ids.length, id);
    ids.forEach((p) => {
      assert.notStrictEqual(p, id);
      assert.ok(model.fonts.some((f) => f.id === p), `${id} pairs with unknown ${p}`);
    });
  });
});

test("every related guide exists", () => {
  const guides = new Set(model.guides.map((g) => g.id));
  Object.values(raw).forEach((rec) => rec.relatedGuides.forEach((g) => assert.ok(guides.has(g), g)));
});

const REJECTS = [
  ["an unknown vocabulary term", (r) => r.bestFor.push("everything"), /not in the vocabulary/],
  ["a pairing with a font not in the library", (r) => (r.pairings[0].font = "comic-sans"), /not in fonts.json/],
  ["a font paired with itself", (r) => (r.pairings[0].font = "b612"), /pairs the font with itself/],
  ["a duplicate pairing", (r) => r.pairings.push(clone(r.pairings[0])), /paired twice/],
  ["an unknown pairing role", (r) => (r.pairings[0].role = "decoration"), /role "decoration"/],
  ["a guide that does not exist", (r) => r.relatedGuides.push("how-to-pick-fonts"), /not a guide/],
  ["a claim with no evidence", (r) => (r.evidence = r.evidence.filter((e) => e.for !== "characteristics:technical")), /"characteristics:technical" has no evidence/],
  ["evidence for a claim the record does not make", (r) => r.evidence.push({ for: "bestFor:code", basis: "bpozz-data", detail: "x" }), /does not claim/],
  ["design guidance as evidence for a characteristic", (r) => r.evidence.find((e) => e.for === "characteristics:technical").basis = "design-guidance", /must be a fact about the font/],
  ["an unknown evidence basis", (r) => (r.evidence[0].basis = "vibes"), /basis "vibes"/],
  ["placeholder text in the note", (r) => (r.notes = "TODO: write a proper note about this typeface before it ships to the site."), /placeholder/],
  ["a provenance claim without an upstream source", (r) => { r.notes = "A sans serif inspired by road signage, with open counters and clear figures for data."; r.evidence = r.evidence.filter((e) => e.for !== "notes").concat({ for: "notes", basis: "font-file", detail: "x" }); }, /provenance claim/],
  ["a note longer than three sentences", (r) => (r.notes = "One sentence here. Two sentences here. Three sentences here. Four sentences here."), /1–3 sentences/],
  ["too few characteristics", (r) => { r.characteristics = ["technical"]; r.evidence = r.evidence.filter((e) => !/^characteristics:(humanist|legibility)/.test(e.for)); }, /characteristics needs 2–6/],
  ["the same term as best-for and avoid-for", (r) => { r.avoidFor.push("ui-labels"); r.evidence.push({ for: "avoidFor:ui-labels", basis: "bpozz-data", detail: "x" }); }, /both bestFor and avoidFor/],
  ["an unknown field", (r) => (r.history = "…"), /unknown field "history"/],
  ["a related guide with no stated reason", (r) => { r.relatedGuides.push("type-scale-systems"); }, /"relatedGuides:type-scale-systems" has no evidence/],
  ["a related guide backed by anything but guide-content", (r) => { r.relatedGuides.push("type-scale-systems"); r.evidence.push({ for: "relatedGuides:type-scale-systems", basis: "design-guidance", detail: "x" }); }, /a related guide needs "guide-content" evidence/],
  ["guide-content evidence for a claim that is not a guide", (r) => r.evidence.push({ for: "bestFor:ui-labels", basis: "guide-content", detail: "x" }), /"guide-content" backs nothing else/],
  ["more than two related guides", (r) => { ["type-scale-systems", "line-length-reading-constraint"].forEach((g) => { r.relatedGuides.push(g); r.evidence.push({ for: `relatedGuides:${g}`, basis: "guide-content", detail: "x" }); }); }, /relatedGuides needs 0–2 entries/],
  ["a record with neither a pairing nor a note", (r) => { r.pairings = []; delete r.notes; r.evidence = r.evidence.filter((e) => !/^(pairings:|notes$)/.test(e.for)); }, /neither a pairing nor a note/],
  ["a note that repeats the page's About text", (r) => (r.notes = "A sans serif designed and tested by Airbus and partners for aircraft cockpit screens, where data must stay readable in degraded conditions."), /notes repeats the page's About text/],
  ["an empty note (leave it out instead)", (r) => { r.notes = "  "; }, /notes must be non-empty text, or left out/],
  ["a font-file claim the font file contradicts", (r) => { r.characteristics.push("monospaced"); r.evidence.push({ for: "characteristics:monospaced", basis: "font-file", detail: "x" }); }, /"characteristics:monospaced" measured\[0\] B612-Regular\.ttf fails asciiMonospaced is true/],
  ["a font-file claim with no measurement rule", (r) => { r.bestFor.push("display-headings"); r.evidence.push({ for: "bestFor:display-headings", basis: "font-file", detail: "x" }); }, /"bestFor:display-headings" cites the font files but no rule covers it/],
  ["a font-file pairing whose proportions differ", (r) => { r.pairings.push({ font: "herr-von-muellerhoff", role: "heading", reason: "A signature script for a single name above a technical interface set in B612." }); r.evidence.push({ for: "pairings:herr-von-muellerhoff", basis: "font-file", detail: "x" }); }, /x-height\/cap-height ratios differ by/],
];
REJECTS.forEach(([what, edit, message]) => {
  test(`the validator rejects ${what}`, () => {
    assert.throws(() => validate(mutated("b612", edit)), message);
  });
});

test("an explicit empty pairing list is valid when the record has a note, and renders no pairing section", () => {
  const data = mutated("b612", (r) => {
    r.pairings = [];
    r.evidence = r.evidence.filter((e) => !e.for.startsWith("pairings:"));
  });
  assert.doesNotThrow(() => validate(data));
  const edited = fonts.build({ config, model: Object.assign({}, model, { fontEditorial: Object.assign({}, model.fontEditorial, { b612: data.b612 }) }) });
  const html = page(edited, "b612");
  assert.ok(!html.includes("font-pairings-title") && !html.includes('class="font-pairing"'));
  assert.ok(html.includes('id="font-note-title">BPOZZ Design Note</h2>'));
});

test("every related guide states the guide section that makes it relevant", () => {
  Object.entries(raw).forEach(([id, rec]) => {
    assert.ok(rec.relatedGuides.length <= 2, id);
    rec.relatedGuides.forEach((g) => {
      const reasons = rec.evidence.filter((e) => e.for === `relatedGuides:${g}`);
      assert.ok(reasons.length && reasons.every((e) => e.basis === "guide-content" && /Section \d{2}/.test(e.detail)), `${id} -> ${g}`);
    });
  });
});

test("pairing reasons lead with the design relationship, not coverage or weight counts", () => {
  const SPEC_LEAD = /^(Covers|Also covers|A serif with|Nine weights|Seven weights|Five weights|[\w ]+ has (one|a single) weight)/;
  Object.entries(raw).forEach(([id, rec]) =>
    rec.pairings.forEach((p) => assert.ok(!SPEC_LEAD.test(p.reason), `${id} -> ${p.font}: "${p.reason.slice(0, 50)}…"`)),
  );
});

test("the validator rejects a record for a family outside the declared set", () => {
  const data = clone(raw);
  data.abeezee = clone(raw.b612);
  assert.throws(() => validate(data), /"abeezee" has a record but is not declared/);
});

test("the validator rejects a declared family with no record", () => {
  const data = clone(raw);
  delete data.prata;
  assert.throws(() => validate(data), /"prata" is declared in site.config.js but has no record/);
});

test("the validator refuses to run without the font measurements", () => {
  assert.throws(
    () => editorial.validateFontEditorial(raw, { fonts: model.fonts, guides: model.guides, config }),
    /font measurements \(metrics\) are required/,
  );
});

test("a record without a note is valid, and one without its note evidence too", () => {
  const data = mutated("b612", (r) => {
    delete r.notes;
    r.evidence = r.evidence.filter((e) => e.for !== "notes");
  });
  assert.doesNotThrow(() => validate(data));
  // evidence for a note the record no longer has is refused
  assert.throws(() => validate(mutated("b612", (r) => delete r.notes)), /evidence for "notes", which the record does not claim/);
});

// ---------------------------------------------------------------------
// near-duplicate editorial copy
// ---------------------------------------------------------------------

const nameOf = (id) => model.fonts.find((f) => f.id === id).name;

test("the committed records contain no near-duplicate copy", () => {
  assert.deepStrictEqual(editorial.similarEditorial(raw, nameOf), []);
});

test("normalisation ignores case, punctuation, whitespace, stop words and the font's own name", () => {
  assert.deepStrictEqual(
    editorial.contentWords("PRATA has ONE weight,   and   no italics!", ["Prata"]),
    editorial.contentWords("Lobster has one weight — and no italics.", ["Lobster"]),
  );
  assert.deepStrictEqual(editorial.contentWords("The cap-height of the font is tall."), ["cap", "height", "font", "tall"]);
});

const NOTE_A =
  "Its lowercase is among the narrowest in the library, so a word takes little horizontal space but needs a larger size than most fonts to reach the same lowercase height.";
const NEAR_DUPLICATES = [
  ["a note copied with the font name swapped", "B612 is part of a coordinated family, so its figures and capitals sit level with the monospaced companion in dashboards and status screens.", "Sanchez is part of a coordinated family, so its figures and capitals sit level with the monospaced companion in dashboards and status screens."],
  ["a note lightly reworded", NOTE_A, "Its lowercase is one of the narrowest in the library, so words take little horizontal room but need a bigger size than most fonts to reach the same lowercase height."],
  ["a pairing reason with only the numbers changed", "Covers the same Latin Extended set with nine weights and italics, so everything except the signature line can be set in a text face.", "Covers the same Latin Extended set with five weights and italics, so everything except the signature line can be set in a text face."],
];
NEAR_DUPLICATES.forEach(([what, a, b]) => {
  test(`similarity detects ${what}`, () => {
    const score = editorial.similarity(editorial.contentWords(a, ["B612"]), editorial.contentWords(b, ["Sanchez"]));
    assert.ok(score >= editorial.SIMILARITY_THRESHOLD, `${what}: ${score}`);
  });
});

test("similarity does not flag genuinely different notes that share ordinary words", () => {
  const pairs = [
    [NOTE_A, "IM Fell English is a digitisation of one of the Fell Types, the punches and matrices bequeathed to the University of Oxford in 1686."],
    [raw.lobster.notes, raw["mr-dafoe"].notes],
    [raw.b612.notes, raw["ibm-plex-mono"].notes],
    // same subject, same vocabulary, different sentences
    ["A small x-height makes the lowercase look tiny beside the capitals, so set it large.", "Set beside capitals of the same size, the lowercase here is tall and open, which helps small labels."],
  ];
  pairs.forEach(([a, b]) => {
    const score = editorial.similarity(editorial.contentWords(a), editorial.contentWords(b));
    assert.ok(score < editorial.SIMILARITY_THRESHOLD, `${score}: "${a.slice(0, 40)}…" vs "${b.slice(0, 40)}…"`);
  });
});

test("the validator reports near-duplicate notes with both records, the field and the score", () => {
  const data = clone(raw);
  data.prata.notes = data["sue-ellen-francisco"].notes.replace("Kimberly Geswein drew it", "The designer drew it");
  const found = editorial.similarEditorial(data, nameOf);
  assert.strictEqual(found.length, 1);
  assert.deepStrictEqual(found[0].a, { id: "prata", field: "notes" });
  assert.deepStrictEqual(found[0].b, { id: "sue-ellen-francisco", field: "notes" });
  assert.ok(found[0].score >= editorial.SIMILARITY_THRESHOLD && found[0].score <= 1);
  assert.throws(
    () => validate(data),
    /"prata"\.notes and "sue-ellen-francisco"\.notes are near-duplicates \(similarity \d\.\d{3}, limit 0\.55\)/,
  );
});

test("the validator reports near-duplicate pairing reasons", () => {
  const data = clone(raw);
  data["mr-dafoe"].pairings[0].reason = data["herr-von-muellerhoff"].pairings[0].reason.replace("nine weights", "five weights");
  assert.throws(
    () => validate(data),
    /"herr-von-muellerhoff"\.pairings\[0\]\.reason and "mr-dafoe"\.pairings\[0\]\.reason are near-duplicates/,
  );
});

test("repeated text within one record is not a cross-record duplicate", () => {
  const data = clone(raw);
  data["ibm-plex-mono"].pairings[1].reason = data["ibm-plex-mono"].pairings[0].reason;
  assert.deepStrictEqual(editorial.similarEditorial(data, nameOf), []);
});

// ---------------------------------------------------------------------
// rendering on the prototype pages
// ---------------------------------------------------------------------

function sections(html) {
  return {
    profile: html.includes('id="font-profile-title">Typography profile</h2>'),
    pairings: html.includes('id="font-pairings-title">Pairs well with</h2>'),
    note: html.includes('id="font-note-title">BPOZZ Design Note</h2>'),
    guides: html.includes('id="font-guides-title">Related UI/UX guides</h2>'),
  };
}

test("each prototype page renders its sections, a note only when it has one, guides only when it has guides", () => {
  PROTOTYPE.forEach((id) => {
    const s = sections(page(withLayer, id));
    assert.ok(s.profile, `${id} is missing the profile`);
    assert.strictEqual(s.pairings, raw[id].pairings.length > 0, `${id} pairings section`);
    assert.strictEqual(s.note, Object.prototype.hasOwnProperty.call(raw[id], "notes"), `${id} note section`);
    assert.strictEqual(s.guides, raw[id].relatedGuides.length > 0, `${id} guides section`);
    assert.ok(page(withLayer, id).includes('class="font-detail font-detail--editorial"'), id);
  });
});

test("the profile shows every curated term by its label, and the derived rows", () => {
  PROTOTYPE.forEach((id) => {
    const html = page(withLayer, id);
    const rec = raw[id];
    rec.bestFor.forEach((t) => assert.ok(html.includes(`<li class="font-chip">${editorial.BEST_FOR[t]}</li>`), `${id} ${t}`));
    rec.characteristics.forEach((t) => assert.ok(html.includes(`<li class="font-chip">${editorial.CHARACTERISTICS[t]}</li>`), `${id} ${t}`));
    rec.avoidFor.forEach((t) => assert.ok(html.includes(`<li>${editorial.AVOID_FOR[t]}</li>`), `${id} ${t}`));
    const profile = html.slice(html.indexOf('<dl class="font-profile__list">'), html.indexOf("</dl>", html.indexOf('<dl class="font-profile__list">')));
    const expectedRows = ["Weights", "Italics", "Scripts", "Best for"].concat(rec.avoidFor.length ? ["Consider alternatives for"] : [], ["Characteristics"]);
    assert.deepStrictEqual([...profile.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]), expectedRows, id);
    editorial.profileRows(model.fonts.find((f) => f.id === id), metrics.byId.get(id)).forEach(([label, text]) => assert.ok(profile.includes(`<dt>${label}</dt><dd>${text}</dd>`), `${id} ${label}`));
    // no category-derived spacing claim dressed up as a measurement
    assert.ok(!/Spacing|Proportional|Monospaced<\/dd>/.test(profile), `${id} renders a spacing row`);
    assert.ok(!/"[a-z]+-[a-z-]+"<\/li>|>[a-z]+-[a-z-]+<\/li>/.test(html.split("font-profile")[1].split("</section>")[0]), `${id} shows a raw vocabulary key`);
  });
});

test("the derived profile reads the fonts.json record", () => {
  const rows = (id) => Object.fromEntries(editorial.profileRows(model.fonts.find((f) => f.id === id), metrics.byId.get(id)));
  assert.deepStrictEqual(rows("be-vietnam-pro"), {
    Weights: "100–900 · 9 weights",
    Italics: "Every weight",
    Scripts: "Latin (incl. Extended), Vietnamese",
  });
  assert.deepStrictEqual(rows("prata"), {
    Weights: "400 only",
    Italics: "None",
    Scripts: "Latin, Cyrillic, Vietnamese",
  });
  assert.deepStrictEqual(Object.keys(rows("ibm-plex-mono")), ["Weights", "Italics", "Scripts"]);
  assert.strictEqual(rows("b612").Weights, "400 and 700");
});

test("pairings link to real font pages and declare the partner's face", () => {
  PROTOTYPE.forEach((id) => {
    const html = page(withLayer, id);
    raw[id].pairings.forEach((p) => {
      const f = model.fonts.find((x) => x.id === p.font);
      assert.ok(html.includes(`class="font-pairing__name" href="/fonts/${p.font}.html"`), `${id} -> ${p.font}`);
      assert.ok(withLayer.pages.some((pg) => pg.file === `fonts/${p.font}.html`), p.font);
      assert.ok(html.includes(`font-family: "${f.family}"`) || html.includes(`font-family:"${f.family}"`), `${id}: no @font-face for ${p.font}`);
      assert.ok(html.includes(`<p class="font-pairing__role">${editorial.ROLES[p.role]}</p>`), `${id} role`);
    });
  });
});

test("guide links point at existing guide routes", () => {
  const urls = new Set(routes.build(model).map((r) => r.url));
  PROTOTYPE.forEach((id) => {
    const html = page(withLayer, id);
    raw[id].relatedGuides.forEach((g) => {
      assert.ok(urls.has(`/guide/${g}`), g);
      assert.ok(html.includes(`class="font-guide__link" href="/guide/${g}"`), `${id} -> ${g}`);
    });
  });
});

test("every internal link on a prototype page resolves to a route or a published font file", () => {
  const urls = new Set(routes.build(model).map((r) => r.url));
  PROTOTYPE.forEach((id) => {
    const html = page(withLayer, id);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    [...main.matchAll(/href="(\/[^"#?]*)/g)].forEach(([, url]) => {
      const ok = urls.has(url) || /^\/fonts\/[a-z0-9-]+\/[^/]+$/.test(url);
      assert.ok(ok, `${id}: ${url}`);
    });
  });
});

test("no placeholder text or empty editorial section reaches a page", () => {
  PROTOTYPE.forEach((id) => {
    const html = page(withLayer, id);
    const layer = html.slice(html.indexOf("font-profile"), html.indexOf('<div class="font-panel font-panel--info">'));
    assert.ok(!editorial.PLACEHOLDER.test(layer.replace(/<[^>]+>/g, " ")), `${id} contains placeholder text`);
    assert.ok(!/<ul class="font-(chips|pairings|guides|profile__plain)">\s*<\/ul>/.test(layer), `${id} has an empty list`);
    assert.ok(!/<p class="font-note">\s*<\/p>/.test(layer), `${id} has an empty note`);
  });
});

test("a note renders as BPOZZ Design Note, attributed to BPOZZ, not the type designer", () => {
  const withNote = PROTOTYPE.filter((id) => raw[id].notes);
  assert.ok(withNote.length > 0);
  withNote.forEach((id) => {
    const html = page(withLayer, id);
    assert.ok(html.includes(`<p class="font-note">${require("../shared/html.js").escapeHtml(raw[id].notes)}</p>`), id);
    assert.ok(html.includes('<p class="font-note__by">BPOZZ editorial guidance for designers.</p>'), id);
    assert.ok(!html.includes("Designer note"), `${id} still says "Designer note"`);
  });
});

test("a record without a note renders no note heading, container or placeholder", () => {
  const without = PROTOTYPE.filter((id) => !raw[id].notes);
  assert.ok(without.length > 0, "the prototype should include a family without a note");
  // and the same for a family that has one, once it is removed
  const edited = fonts.build({
    config,
    model: Object.assign({}, model, {
      fontEditorial: Object.assign({}, model.fontEditorial, { b612: Object.assign({}, raw.b612, { notes: undefined }) }),
    }),
  });
  without.map((id) => page(withLayer, id)).concat(page(edited, "b612")).forEach((html) => {
    ["font-note-title", 'class="font-note"', "font-note__by", "BPOZZ Design Note", "Designer note"].forEach((needle) =>
      assert.ok(!html.includes(needle), needle),
    );
    const layer = html.slice(html.indexOf('<div class="font-editorial">'), html.indexOf('<div class="font-panel font-panel--info">'));
    assert.ok(!/<section[^>]*>\s*<\/section>/.test(layer), "empty section");
    assert.ok(sections(html).pairings, "the rest of the layer still renders");
  });
});

// ---------------------------------------------------------------------
// nothing else changes
// ---------------------------------------------------------------------

test("every non-prototype font page is identical to a build with no editorial data", () => {
  const changed = withLayer.pages
    .filter((p) => p.html !== withoutLayer.pages.find((q) => q.file === p.file).html)
    .map((p) => p.file)
    .sort();
  assert.deepStrictEqual(changed, PROTOTYPE.map((id) => `fonts/${id}.html`).sort());
});

test("the download packages do not depend on the editorial layer", () => {
  withLayer.packages.forEach((p, i) => {
    assert.strictEqual(p.file, withoutLayer.packages[i].file);
    assert.ok(p.data.equals(withoutLayer.packages[i].data), p.file);
  });
});

test("the prototype pages keep every existing feature and their structured data", () => {
  PROTOTYPE.forEach((id) => {
    const f = model.fonts.find((x) => x.id === id);
    const html = page(withLayer, id);
    const before = page(withoutLayer, id);
    [
      `download="${fonts.zipName(f)}"`,
      `data-font-fav="${f.id}"`,
      'data-font-copy="',
      "Copy CSS font-family",
      "View license file",
      'id="font-custom-text"',
      'id="font-size"',
      'class="font-related"',
      "<dt>License</dt>",
      "<dt>Source</dt>",
      "<dt>Available styles</dt>",
    ].forEach((needle) => assert.ok(html.includes(needle), `${id} lost ${needle}`));
    const specimens = (h) => (h.match(/class="font-specimen[ "]/g) || []).length;
    assert.strictEqual(specimens(html), specimens(before), `${id} specimens`);
    assert.strictEqual(specimens(html), f.variants.length * 2, `${id} specimen count`);
    const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)].map((m) => m[0]);
    assert.deepStrictEqual(ld(html), ld(before), `${id} structured data changed`);
    const headMeta = (h) => h.match(/<title>[\s\S]*?rel="canonical"[^>]*>/)[0];
    assert.strictEqual(headMeta(html), headMeta(before), `${id} title/description/canonical changed`);
    // everything the page had before is still there, in order
    const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ");
    const after = text(html);
    let at = 0;
    text(before).forEach((w) => {
      at = after.indexOf(w, at);
      assert.ok(at !== -1, `${id} lost "${w}"`);
      at += 1;
    });
  });
});

// ---------------------------------------------------------------------
// schema hardening for Batch 2 — scripts, case forms, monospace,
// vocabulary, measurement scope, empty pairings. Real font files only; the
// records below are in-memory test fixtures, not editorial content.
// ---------------------------------------------------------------------

const fontScripts = require("./font-scripts.js");
const m = (id) => metrics.byId.get(id);
const label = (id) => fontScripts.scriptsLabel(m(id).coverage);

test("every subset in fonts.json is classified by the scripts model", () => {
  const unknown = model.fonts.flatMap((f) => m(f.id).coverage.unknown.map((s) => `${f.id}:${s}`));
  assert.deepStrictEqual(unknown, []);
});

test("the ten approved Scripts rows are unchanged by the verified-coverage model", () => {
  assert.deepStrictEqual(Object.fromEntries(BATCH1.map((id) => [id, label(id)])), {
    b612: "Latin",
    "be-vietnam-pro": "Latin (incl. Extended), Vietnamese",
    "ibm-plex-mono": "Latin (incl. Extended), Cyrillic, Vietnamese",
    prata: "Latin, Cyrillic, Vietnamese",
    "sue-ellen-francisco": "Latin",
    lobster: "Latin (incl. Extended), Cyrillic, Vietnamese",
    "im-fell-english": "Latin",
    sanchez: "Latin (incl. Extended)",
    "herr-von-muellerhoff": "Latin (incl. Extended)",
    "mr-dafoe": "Latin (incl. Extended)",
  });
});

test("scripts: historical scripts are named as such, symbol sets never appear, partial scripts are dropped", () => {
  // Cardo: Greek and Hebrew are living scripts; Gothic, Old Italic and Runic are historical
  assert.strictEqual(label("cardo"), "Latin (incl. Extended), Greek, Hebrew; historical scripts: Gothic, Old Italic, Runic");
  assert.deepStrictEqual(m("cardo").historical, ["gothic", "old-italic", "runic"]);
  // Fira Mono: symbols2 is a glyph collection, not a script
  assert.strictEqual(label("fira-mono"), "Latin (incl. Extended), Cyrillic, Greek");
  assert.deepStrictEqual(m("fira-mono").coverage.symbols, ["symbols2"]);
  // Great Vibes lists greek-ext but maps no basic Greek lowercase
  assert.ok(!m("great-vibes").scripts.includes("greek"));
  assert.deepStrictEqual(m("great-vibes").coverage.unverified, ["greek-ext"]);
  assert.strictEqual(label("great-vibes"), "Latin (incl. Extended), Cyrillic, Vietnamese");
  // Devanagari and Sinhala are verified from their core letters
  assert.strictEqual(label("hind"), "Latin (incl. Extended), Devanagari");
  assert.strictEqual(label("abhaya-libre"), "Latin (incl. Extended), Sinhala");
  // Amatic SC: Hebrew and Cyrillic both verified
  assert.strictEqual(label("amatic-sc"), "Latin (incl. Extended), Cyrillic, Hebrew, Vietnamese");
  // cyrillic-ext alone, with no basic Cyrillic mapped, is not Cyrillic
  assert.ok(!m("ibm-plex-sans-condensed").scripts.includes("cyrillic"));
  // math / symbols / braille never reach the label
  assert.ok(!/Math|Symbols|Braille/.test(label("iosevka-charon-mono")) && !/Math|Symbols/.test(label("alike")));
});

test("Latin Extended: the label follows the subset, verification is recorded separately", () => {
  assert.strictEqual(m("herr-von-muellerhoff").coverage.latinExtended, true);
  assert.strictEqual(m("herr-von-muellerhoff").coverage.latinExtendedVerified, false);
  assert.strictEqual(m("sanchez").coverage.latinExtendedVerified, true);
});

test("case forms: all-caps, small caps and pixel designs are told apart from ordinary lowercase", () => {
  assert.strictEqual(m("bebas-neue").lowercaseForm, "caps");
  assert.strictEqual(m("bebas-neue").xToCap, 1);
  assert.strictEqual(m("major-mono-display").lowercaseForm, "caps");
  assert.strictEqual(m("amatic-sc").lowercaseForm, "small-caps");
  assert.strictEqual(m("over-the-rainbow").lowercaseForm, "lowercase", "irregular handwriting is not small caps");
  assert.strictEqual(m("press-start-2p").lowercaseForm, "lowercase");
  assert.strictEqual(m("press-start-2p").pixelsPerEm, 8);
  assert.strictEqual(m("silkscreen").pixelated, true);
  assert.strictEqual(m("vt323").pixelated, false, "VT323 imitates CRT dots off-grid; its pixel look is not measurable");
  BATCH1.forEach((id) => {
    assert.strictEqual(m(id).lowercaseForm, "lowercase", id);
    assert.strictEqual(m(id).pixelated, false, id);
  });
});

test("x-height percentiles rank only ordinary lowercase fonts", () => {
  ["bebas-neue", "major-mono-display", "amatic-sc"].forEach((id) => {
    assert.strictEqual(m(id).percentile.xToCap, undefined, id);
    assert.strictEqual(m(id).percentile.xHeight, undefined, id);
    assert.ok(Number.isInteger(m(id).percentile.lowercaseAdvance), id);
  });
});

test("monospaced: measured ASCII advances decide, the header flag and category do not", () => {
  const mono = (id) => [m(id).fixedPitch, m(id).asciiMonospaced, m(id).uniformAdvance];
  assert.deepStrictEqual(mono("ibm-plex-mono"), [true, true, true]);
  assert.deepStrictEqual(mono("courier-prime"), [true, true, true]);
  assert.deepStrictEqual(mono("xanh-mono"), [true, true, true]);
  assert.deepStrictEqual(mono("major-mono-display"), [true, true, false], "a few non-ASCII glyphs differ");
  assert.deepStrictEqual(mono("press-start-2p"), [false, true, true], "flag unset, yet every advance is equal");
  assert.strictEqual(m("monofett").asciiMonospaced, false, "filed as monospace, advances differ");
  assert.strictEqual(m("b612").asciiMonospaced, false);
  const rule = editorial.MEASURED["characteristics:monospaced"];
  ["ibm-plex-mono", "courier-prime", "xanh-mono", "major-mono-display", "press-start-2p"].forEach((id) =>
    rule.forEach((c) => assert.strictEqual(problem(c, id), null, id)),
  );
  ["monofett", "b612", "lobster"].forEach((id) => rule.forEach((c) => assert.match(problem(c, id), /fails asciiMonospaced/, id)));
});

test("measurement scope: a metric cannot speak for a font it does not describe", () => {
  // all-caps: no x-height claim, even an absolute one
  assert.match(problem({ metric: "xToCap", between: [0.9, 1.1] }, "bebas-neue"), /describes ordinary lowercase, but BebasNeue-Regular\.ttf draws its a–z as "caps"/);
  assert.match(problem({ metric: "xHeight", percentileAtMost: 99 }, "amatic-sc"), /"small-caps"/);
  // glyph-wide counts are refused for fonts whose count is swollen by another script
  assert.match(problem({ metric: "numGlyphs", percentileAtLeast: 50 }, "hind"), /counts every glyph, and Hind-Regular\.ttf covers devanagari, latin/);
  assert.match(problem({ metric: "numGlyphs", between: [0, 99999] }, "abhaya-libre"), /not comparable/);
  assert.match(problem({ metric: "numGlyphs", percentileAtLeast: 90 }, "cardo"), /not comparable/);
  // …but Latin, Cyrillic and Greek alphabets compare: Lobster's claim stands
  assert.strictEqual(problem({ metric: "numGlyphs", percentileAtLeast: 90 }, "lobster"), null);
  // Latin-derived measurements still work for multi-script fonts
  assert.strictEqual(problem({ metric: "lowercaseAdvance", percentileAtMost: 100 }, "hind"), null);
  // Arvo maps no OpenType features, so no feature claim can hold
  assert.deepStrictEqual(m("arvo").features, []);
  assert.match(problem({ metric: "features", hasAnyFeature: ["salt", "aalt", "ssNN"] }, "arvo"), /fails/);
  assert.strictEqual(problem({ metric: "is" }, "arvo"), "needs exactly one of " + Object.keys(editorial.COMPARATORS).join(", "));
});

/** An in-memory record for `id`: every claim backed by bpozz-data unless listed in `fontFile`. */
function fixture(id, { bestFor, avoidFor, characteristics, fontFile = [], pairings = [] }) {
  const rec = {
    bestFor,
    avoidFor,
    characteristics,
    pairings,
    notes: "An in-memory record for the schema tests, exercising the validator rules against a real font file.",
    relatedGuides: [],
    evidence: [],
  };
  const claims = bestFor.map((t) => `bestFor:${t}`)
    .concat(avoidFor.map((t) => `avoidFor:${t}`), characteristics.map((t) => `characteristics:${t}`), pairings.map((p) => `pairings:${p.font}`), ["notes"]);
  claims.forEach((c) => rec.evidence.push({ for: c, basis: fontFile.includes(c) ? "font-file" : "bpozz-data", detail: "fixture" }));
  return rec;
}
const validateFixture = (id, rec) =>
  editorial.validateFontEditorial({ [id]: rec }, {
    fonts: model.fonts, guides: model.guides, metrics,
    config: Object.assign({}, config, { fonts: Object.assign({}, config.fonts, { editorial: { ids: [id] } }) }),
  });

test("new vocabulary: measured terms hold on the fonts they describe", () => {
  const ok = [
    ["bebas-neue", { bestFor: ["all-caps-titles", "display-headings"], avoidFor: ["long-body-text"], characteristics: ["all-caps", "condensed", "grotesque"], fontFile: ["bestFor:all-caps-titles", "characteristics:all-caps"] }],
    ["press-start-2p", { bestFor: ["display-headings", "greek-text"], avoidFor: ["fluid-sizing"], characteristics: ["pixel", "monospaced", "technical"], fontFile: ["avoidFor:fluid-sizing", "characteristics:pixel", "characteristics:monospaced"] }],
    ["amatic-sc", { bestFor: ["hebrew-text", "short-headings"], avoidFor: ["long-body-text"], characteristics: ["small-caps", "handwritten", "narrow"], fontFile: ["characteristics:small-caps", "characteristics:narrow"] }],
    ["encode-sans-expanded", { bestFor: ["display-headings", "vietnamese-text"], avoidFor: ["long-body-text"], characteristics: ["expanded", "grotesque", "geometric"], fontFile: ["characteristics:expanded"] }],
    ["barlow-condensed", { bestFor: ["ui-labels", "tabular-data"], avoidFor: ["long-prose"], characteristics: ["condensed", "grotesque", "rounded"], fontFile: ["characteristics:condensed", "bestFor:tabular-data"] }],
    ["hind", { bestFor: ["devanagari-text", "bilingual-interfaces"], avoidFor: ["cyrillic-greek"], characteristics: ["grotesque", "legibility-focused", "technical"] }],
    ["abhaya-libre", { bestFor: ["sinhala-text", "literary-settings"], avoidFor: ["many-weight-hierarchies"], characteristics: ["humanist-details", "historical-revival", "stylistic-sets"] }],
    ["courier-prime", { bestFor: ["screenplays-manuscripts", "code"], avoidFor: ["long-prose"], characteristics: ["typewriter", "monospaced", "slab-serif"], fontFile: ["characteristics:monospaced"] }],
    ["xanh-mono", { bestFor: ["vietnamese-text", "display-headings"], avoidFor: ["long-prose"], characteristics: ["monospaced", "technical", "stylistic-alternates"], fontFile: ["characteristics:monospaced"] }],
    ["unifrakturmaguntia", { bestFor: ["display-headings", "period-typography"], avoidFor: ["small-text"], characteristics: ["blackletter", "historical-forms", "technical"] }],
  ];
  ok.forEach(([id, spec]) => assert.doesNotThrow(() => validateFixture(id, fixture(id, spec)), id));
});

test("new vocabulary: measured and coverage terms are refused where the font does not bear them out", () => {
  const bad = [
    ["bebas-neue", { bestFor: ["display-headings", "names-short-phrases"], avoidFor: ["small-text"], characteristics: ["small-x-height", "condensed", "grotesque"], fontFile: ["characteristics:small-x-height"] }, /describes ordinary lowercase, but BebasNeue-Regular\.ttf draws its a–z as "caps"/],
    ["bebas-neue", { bestFor: ["display-headings", "ui-labels"], avoidFor: ["long-body-text"], characteristics: ["condensed", "grotesque", "technical"], fontFile: ["characteristics:condensed"] }, /fails widthClass between \[1,4\]/],
    ["press-start-2p", { bestFor: ["display-headings", "ui-labels"], avoidFor: ["long-body-text"], characteristics: ["all-caps", "pixel", "technical"], fontFile: ["characteristics:all-caps"] }, /fails lowercaseForm is "caps"/],
    ["major-mono-display", { bestFor: ["display-headings", "ui-labels"], avoidFor: ["long-body-text"], characteristics: ["pixel", "monospaced", "geometric"], fontFile: ["characteristics:pixel"] }, /fails pixelated is true/],
    ["great-vibes", { bestFor: ["greek-text", "signature-lettering"], avoidFor: ["long-body-text"], characteristics: ["connected-script", "handwritten", "narrow"] }, /"bestFor:greek-text" needs verified Greek/],
    ["ibm-plex-sans-condensed", { bestFor: ["cyrillic-text", "ui-labels"], avoidFor: ["long-body-text"], characteristics: ["condensed", "grotesque", "technical"] }, /"bestFor:cyrillic-text" needs verified Cyrillic/],
    ["herr-von-muellerhoff", { bestFor: ["latin-extended-text", "signature-lettering"], avoidFor: ["long-body-text"], characteristics: ["signature-script", "handwritten", "narrow"] }, /needs a verified Latin Extended core/],
    ["hind", { bestFor: ["devanagari-text", "ui-labels"], avoidFor: ["non-latin-scripts"], characteristics: ["large-glyph-set", "grotesque", "technical"], fontFile: ["characteristics:large-glyph-set"] }, /"avoidFor:non-latin-scripts" needs no verified script but Latin[\s\S]*counts every glyph|counts every glyph[\s\S]*"avoidFor:non-latin-scripts" needs/],
    ["cardo", { bestFor: ["literary-settings", "bilingual-interfaces"], avoidFor: ["cyrillic-greek"], characteristics: ["historical-revival", "stylistic-sets", "technical"] }, /"avoidFor:cyrillic-greek" needs neither Cyrillic nor Greek verified/],
    ["arvo", { bestFor: ["display-headings", "short-headings"], avoidFor: ["long-body-text"], characteristics: ["slab-serif", "geometric", "stylistic-alternates"], fontFile: ["characteristics:stylistic-alternates"] }, /Arvo-Regular\.ttf fails features hasAnyFeature \["salt"\]/],
    ["xanh-mono", { bestFor: ["code", "display-headings"], avoidFor: ["long-prose"], characteristics: ["rounded", "typewriter", "technical"], fontFile: ["characteristics:rounded"] }, /"characteristics:rounded" cites the font files but no rule covers it/],
  ];
  bad.forEach(([id, spec, message]) => assert.throws(() => validateFixture(id, fixture(id, spec)), message, id));
});

test("an explicit empty pairing list is a valid state; a missing pairing field is not", () => {
  const spec = { bestFor: ["display-headings", "all-caps-titles"], avoidFor: ["long-body-text"], characteristics: ["all-caps", "grotesque", "technical"], pairings: [] };
  const rec = fixture("bebas-neue", spec);
  assert.deepStrictEqual(rec.pairings, []);
  assert.doesNotThrow(() => validateFixture("bebas-neue", rec));
  const missing = fixture("bebas-neue", spec);
  delete missing.pairings;
  assert.throws(() => validateFixture("bebas-neue", missing), /pairings must be an array/);
  const bare = fixture("bebas-neue", spec);
  delete bare.notes;
  bare.evidence = bare.evidence.filter((e) => e.for !== "notes");
  assert.throws(() => validateFixture("bebas-neue", bare), /neither a pairing nor a note/);
});

test("the vocabulary stays controlled: new terms are labelled, and no label repeats", () => {
  [editorial.BEST_FOR, editorial.AVOID_FOR, editorial.CHARACTERISTICS].forEach((vocab) => {
    const labels = Object.values(vocab);
    assert.strictEqual(new Set(labels).size, labels.length);
    Object.entries(vocab).forEach(([key, text]) => assert.ok(/^[a-z0-9-]+$/.test(key) && text.trim(), key));
  });
  ["rounded", "geometric", "condensed", "expanded", "blackletter", "typewriter", "pixel", "all-caps", "small-caps", "large-x-height"].forEach((t) => assert.ok(editorial.CHARACTERISTICS[t], t));
  ["greek-text", "hebrew-text", "devanagari-text", "sinhala-text", "gujarati-text", "armenian-text", "bilingual-interfaces", "screenplays-manuscripts", "all-caps-titles"].forEach((t) => assert.ok(editorial.BEST_FOR[t], t));
  assert.ok(editorial.AVOID_FOR["fluid-sizing"]);
});

// ---------------------------------------------------------------------
// Batch 3 schema additions: gujarati-text, armenian-text, large-x-height.
// In-memory fixtures on real font files; no editorial record uses them.
// ---------------------------------------------------------------------

test("new terms: labels, rules and the approved records", () => {
  assert.strictEqual(editorial.BEST_FOR["gujarati-text"], "Gujarati text");
  assert.strictEqual(editorial.BEST_FOR["armenian-text"], "Armenian text");
  assert.strictEqual(editorial.CHARACTERISTICS["large-x-height"], "Large x-height");
  // the exact mirror of small-x-height: same metric, same quartile, other end
  assert.deepStrictEqual(editorial.MEASURED["characteristics:large-x-height"], [{ metric: "xToCap", percentileAtLeast: 75 }]);
  assert.deepStrictEqual(editorial.MEASURED["characteristics:small-x-height"], [{ metric: "xToCap", percentileAtMost: 25 }]);
  assert.ok(editorial.COVERAGE_TERMS["bestFor:gujarati-text"] && editorial.COVERAGE_TERMS["bestFor:armenian-text"]);
  // added for Batch 3: no Batch 1 or Batch 2 record uses the new terms
  Object.entries(raw).slice(0, 30).forEach(([id, rec]) => {
    assert.ok(!rec.bestFor.includes("gujarati-text") && !rec.bestFor.includes("armenian-text"), id);
    assert.ok(!rec.characteristics.includes("large-x-height"), id);
  });
});

test("gujarati-text needs verified Gujarati coverage", () => {
  const spec = (bestFor) => ({ bestFor, avoidFor: ["long-body-text"], characteristics: ["technical", "legibility-focused"] });
  assert.ok(m("shrikhand").scripts.includes("gujarati"), "Shrikhand's Gujarati is verified from its core letters");
  assert.doesNotThrow(() => validateFixture("shrikhand", fixture("shrikhand", spec(["gujarati-text", "display-headings"]))));
  assert.throws(() => validateFixture("hind", fixture("hind", spec(["gujarati-text", "ui-labels"]))), /"bestFor:gujarati-text" needs verified Gujarati, which Hind-Regular\.ttf does not have/);
  assert.throws(() => validateFixture("fira-mono", fixture("fira-mono", spec(["gujarati-text", "code"]))), /"bestFor:gujarati-text" needs verified Gujarati/);
});

test("armenian-text needs verified Armenian coverage", () => {
  const spec = (bestFor) => ({ bestFor, avoidFor: ["long-prose"], characteristics: ["technical", "legibility-focused"] });
  assert.ok(m("iosevka-charon-mono").scripts.includes("armenian"));
  assert.doesNotThrow(() => validateFixture("iosevka-charon-mono", fixture("iosevka-charon-mono", spec(["armenian-text", "code"]))));
  assert.throws(() => validateFixture("fira-mono", fixture("fira-mono", spec(["armenian-text", "code"]))), /"bestFor:armenian-text" needs verified Armenian, which FiraMono-Regular\.ttf does not have/);
});

test("large-x-height holds for ordinary lowercase in the library's top quarter, and nowhere else", () => {
  const spec = { bestFor: ["display-headings", "short-headings"], avoidFor: ["long-body-text"], characteristics: ["large-x-height", "technical"], fontFile: ["characteristics:large-x-height"] };
  ["rozha-one", "glegoo", "cousine", "shrikhand"].forEach((id) => {
    assert.strictEqual(m(id).lowercaseForm, "lowercase", id);
    assert.ok(m(id).percentile.xToCap >= 75, `${id} p${m(id).percentile.xToCap}`);
    assert.doesNotThrow(() => validateFixture(id, fixture(id, spec)), id);
  });
  // all-caps and small-caps: refused by the metric's scope, not a special case
  assert.throws(() => validateFixture("bebas-neue", fixture("bebas-neue", spec)), /xToCap describes ordinary lowercase, but BebasNeue-Regular\.ttf draws its a–z as "caps"/);
  assert.throws(() => validateFixture("amatic-sc", fixture("amatic-sc", spec)), /draws its a–z as "small-caps"/);
  // below the quartile
  assert.ok(m("prata").percentile.xToCap < 75);
  assert.throws(() => validateFixture("prata", fixture("prata", spec)), /Prata-Regular\.ttf fails xToCap percentileAtLeast 75/);
});

// ---------------------------------------------------------------------
// Batch 3: twenty records, and an optional "Consider alternatives for"
// ---------------------------------------------------------------------

const BATCH3 = [
  "fira-sans", "lato", "michroma", "questrial", "didact-gothic", "asap-condensed", "gentium-book-plus",
  "ibm-plex-serif", "rozha-one", "bellefair", "glegoo", "shrikhand", "poiret-one", "monoton",
  "iosevka-charon-mono", "fragment-mono", "cousine", "style-script", "black-ops-one", "uncial-antiqua",
];

test("the 30 approved records are pinned: any edit to Batch 1 or Batch 2 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 30).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "a067bcd885ff7c0cfba265295a4a95fb58266b14c24d7a7adc808898ed35da84",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(30, 50), BATCH3, "Batch 3 follows Batch 2, in declaration order");
});

test("Batch 3: every record stays within 2–6 characteristics, and uses no rejected category as a term", () => {
  BATCH3.forEach((id) => {
    const n = raw[id].characteristics.length;
    assert.ok(n >= 2 && n <= 6, `${id}: ${n}`);
  });
  const all = Object.keys(editorial.CHARACTERISTICS).concat(Object.keys(editorial.BEST_FOR));
  // "stencil" left this list in Batch 10, as a term measured from the outlines only (FONT_FILE_ONLY)
  ["art-deco", "fat-face", "uncial", "upright", "character-variants", "width-stable"].forEach((t) => assert.ok(!all.includes(t), t));
});

test("Batch 3 script terms rest on verified coverage", () => {
  assert.ok(raw.shrikhand.bestFor.includes("gujarati-text") && m("shrikhand").scripts.includes("gujarati"));
  assert.ok(raw["iosevka-charon-mono"].bestFor.includes("armenian-text") && m("iosevka-charon-mono").scripts.includes("armenian"));
  // Black Ops One lists cyrillic-ext but maps no basic Cyrillic: no Cyrillic claim, and the page does not show one
  assert.deepStrictEqual(m("black-ops-one").coverage.unverified, ["cyrillic-ext"]);
  assert.ok(!raw["black-ops-one"].bestFor.includes("cyrillic-text"));
  assert.ok(!/Cyrillic/.test(label("black-ops-one")));
  // Uncial Antiqua covers basic Latin only
  assert.strictEqual(m("uncial-antiqua").coverage.latinExtendedVerified, false);
  assert.ok(!raw["uncial-antiqua"].bestFor.includes("latin-extended-text"));
  assert.strictEqual(label("uncial-antiqua"), "Latin");
});

test("large-x-height is claimed only by ordinary-lowercase fonts in the top quarter", () => {
  const users = Object.entries(raw).filter(([, r]) => r.characteristics.includes("large-x-height")).map(([id]) => id);
  assert.deepStrictEqual(users.sort(), ["anton", "archivo-black", "arsenal", "audiowide", "basic", "black-ops-one", "blinker", "calistoga", "days-one", "eater", "economica", "fauna-one", "fjalla-one", "francois-one", "glegoo", "jersey-25", "judson", "krona-one", "libertinus-mono", "limelight", "noticia-text", "pangolin", "pathway-gothic-one", "play", "rammetto-one", "righteous", "rozha-one", "russo-one", "sansita", "short-stack", "syne-mono", "titan-one"]);
  users.forEach((id) => {
    assert.strictEqual(m(id).lowercaseForm, "lowercase", id);
    assert.ok(m(id).percentile.xToCap >= 75, id);
  });
  // Monoton, a small-caps face, cannot carry it
  assert.ok(!raw.monoton.characteristics.includes("large-x-height"));
});

test("an empty 'Consider alternatives for' is valid and renders no row, placeholder or empty list", () => {
  const empty = BATCH3.filter((id) => raw[id].avoidFor.length === 0);
  assert.deepStrictEqual(empty, ["fira-sans", "lato", "ibm-plex-serif"]);
  assert.deepStrictEqual(editorial.LIMITS.avoidFor, [0, 3]);
  empty.forEach((id) => {
    const html = page(withLayer, id);
    const profile = html.slice(html.indexOf('<section class="font-profile"'), html.indexOf("</section>", html.indexOf('<section class="font-profile"')));
    assert.ok(!profile.includes("Consider alternatives for"), id);
    assert.ok(!/<ul class="font-profile__plain">\s*<\/ul>/.test(profile), `${id} empty list`);
    assert.ok(!/>\s*(None|—|-|n\/a)\s*</i.test(profile), `${id} placeholder`);
    assert.ok(profile.includes("<dt>Best for</dt>") && profile.includes("<dt>Characteristics</dt>"), id);
  });
  // a fixture confirms the rule on its own: an empty list validates
  const spec = { bestFor: ["ui-labels", "greek-text"], avoidFor: [], characteristics: ["legibility-focused", "technical"] };
  assert.doesNotThrow(() => validateFixture("fira-sans", fixture("fira-sans", spec)));
});

test("records that do list alternatives keep the row, with every entry", () => {
  Object.entries(raw).filter(([, r]) => r.avoidFor.length).forEach(([id, rec]) => {
    const html = page(withLayer, id);
    const row = html.match(/<dt>Consider alternatives for<\/dt><dd><ul class="font-profile__plain">([\s\S]*?)<\/ul><\/dd>/);
    assert.ok(row, id);
    assert.deepStrictEqual([...row[1].matchAll(/<li>([^<]+)<\/li>/g)].map((x) => x[1]), rec.avoidFor.map((t) => editorial.AVOID_FOR[t]), id);
  });
});

test("Batch 3 guide links and pairings", () => {
  const withGuides = BATCH3.filter((id) => raw[id].relatedGuides.length);
  assert.deepStrictEqual(withGuides, ["monoton"]);
  assert.ok(raw.monoton.evidence.some((e) => e.for === "relatedGuides:type-scale-systems" && /Section 06/.test(e.detail)));
  // no reciprocal duplicates of approved pairings, and the rejected ones stay out
  assert.deepStrictEqual(raw.bellefair.pairings, []);
  assert.ok(!raw["ibm-plex-serif"].relatedGuides.includes("font-pairing-hierarchy-decision"));
  assert.ok(!raw.glegoo.relatedGuides.length && !raw.bellefair.relatedGuides.length);
  const plexMonoReasons = raw["ibm-plex-mono"].pairings.map((p) => p.reason);
  raw["ibm-plex-serif"].pairings.forEach((p) => plexMonoReasons.forEach((r) => {
    assert.ok(editorial.similarity(editorial.contentWords(p.reason), editorial.contentWords(r)) < 0.3, "Plex Serif restates a Plex Mono reason");
  }));
});

// Project-specific measurement behind Iosevka Charon Mono's note. The
// validator only proves printable-ASCII widths and Armenian coverage; this
// test measures the Armenian widths themselves, in every shipped style.
test("Iosevka Charon Mono keeps every Armenian letter on its ASCII cell", () => {
  const fontScripts = require("./font-scripts.js");
  const font = model.fonts.find((f) => f.id === "iosevka-charon-mono");
  assert.strictEqual(font.variants.length, 8, "300, 400, 500 and 700, each with an italic");
  // letters, the ligature U+0587 and the spacing punctuation; U+055F (abbreviation
  // mark) is a combining mark with zero advance by design, so it is excluded
  const ARMENIAN = fontScripts.SCRIPTS.armenian.core.concat([0x587, 0x55a, 0x55b, 0x55c, 0x55d, 0x55e, 0x589, 0x58a]);
  font.variants.forEach((v) => {
    const buf = fs.readFileSync(path.join(config.paths.content.fontFiles, font.id, v.file));
    const t = sfnt.tableDirectory(buf);
    const cmap = sfnt.readCmap(buf, t.cmap);
    const count = buf.readUInt16BE(t.hhea.offset + 34);
    const upm = buf.readUInt16BE(t.head.offset + 18);
    const advance = (c) => buf.readUInt16BE(t.hmtx.offset + Math.min(cmap.get(c), count - 1) * 4);
    const cell = advance(0x61);
    const style = `${v.weight}${v.style === "italic" ? "i" : ""}`;
    assert.strictEqual(cell / upm, 0.5, `${style}: cell`);
    const ascii = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i).filter((c) => cmap.has(c));
    assert.ok(ascii.every((c) => advance(c) === cell), `${style}: ASCII`);
    const missing = ARMENIAN.filter((c) => !cmap.has(c));
    assert.deepStrictEqual(missing, [], `${style}: unmapped Armenian`);
    const off = ARMENIAN.filter((c) => advance(c) !== cell).map((c) => `U+${c.toString(16).toUpperCase()}`);
    assert.deepStrictEqual(off, [], `${style}: Armenian off the cell`);
  });
});

// ---------------------------------------------------------------------
// Batch 4: twenty records, a checked absence (lacksFeatures) and GPOS tags
// ---------------------------------------------------------------------

const BATCH4 = [
  "ibm-plex-sans-condensed", "pt-sans", "b612-mono", "fira-mono", "barlow", "crimson-text", "charis-sil",
  "old-standard-tt", "noticia-text", "abril-fatface", "dm-serif-display", "anton", "silkscreen", "andika",
  "alegreya-sans", "great-vibes", "tangerine", "mansalva", "bungee", "judson",
];

test("the 50 approved records are pinned: any edit to Batches 1–3 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 50).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "30e80b536257c815d1dfe5a91bb0592458b5b985fd76d53850d54307bce56212",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(50, 70), BATCH4, "Batch 4 follows Batch 3, in declaration order");
});

test("lacksFeatures checks an absence against the shipped file", () => {
  // Crimson Text's upstream text promises oldstyle figures and small caps; the file has neither
  assert.ok(!m("crimson-text").features.includes("onum") && !m("crimson-text").features.includes("smcp"));
  assert.strictEqual(problem({ font: "crimson-text", metric: "features", lacksFeatures: ["onum", "smcp"] }), null);
  // one present tag is enough to fail the claim
  assert.match(problem({ font: "crimson-text", metric: "features", lacksFeatures: ["smcp", "zero"] }), /fails .*lacksFeatures/);
  // a note that denies a feature the file has is refused by the validator
  const wrong = mutated("anton", (r) => {
    r.evidence.find((e) => e.for === "notes" && e.basis === "font-file").measured = [{ metric: "features", lacksFeatures: ["smcp"] }];
  });
  assert.throws(() => validate(wrong), /"notes" measured\[0\] Anton-Regular\.ttf fails features lacksFeatures \["smcp"\]/);
});

test("hasAnyFeature reads GPOS tags from gposFeatures and GSUB tags from features, never across", () => {
  assert.ok(m("judson").gposFeatures.includes("mkmk"));
  assert.strictEqual(problem({ font: "judson", metric: "gposFeatures", hasAnyFeature: ["mkmk"] }), null);
  assert.match(problem({ font: "judson", metric: "features", hasAnyFeature: ["mkmk"] }), /fails/, "mkmk is a GPOS tag, not GSUB");
  assert.deepStrictEqual(m("b612-mono").gposFeatures, []);
  assert.match(problem({ font: "b612-mono", metric: "gposFeatures", hasAnyFeature: ["mark", "mkmk"] }), /fails/);
});

test("Batch 4: bounds, and script claims rest on verified coverage", () => {
  BATCH4.forEach((id) => {
    const n = raw[id].characteristics.length;
    assert.ok(n >= 2 && n <= 6, `${id}: ${n}`);
    assert.ok(raw[id].pairings.length || raw[id].notes, `${id} says something of its own`);
  });
  // IBM Plex Sans Condensed declares cyrillic-ext but maps no basic Cyrillic: no Cyrillic claim, and the page shows none
  assert.deepStrictEqual(m("ibm-plex-sans-condensed").coverage.unverified, ["cyrillic-ext"]);
  assert.ok(raw["ibm-plex-sans-condensed"].avoidFor.includes("cyrillic-greek"));
  assert.strictEqual(label("ibm-plex-sans-condensed"), "Latin (incl. Extended), Vietnamese");
  // Old Standard TT: Cyrillic verified, Greek neither listed nor verified, as its note says
  assert.ok(m("old-standard-tt").scripts.includes("cyrillic") && !m("old-standard-tt").scripts.includes("greek"));
  assert.ok(!model.fonts.find((f) => f.id === "old-standard-tt").subsets.some((s) => s.startsWith("greek")));
  // Silkscreen lists latin-ext but the Latin Extended core is not in the file: no Latin Extended claim
  assert.strictEqual(m("silkscreen").coverage.latinExtendedVerified, false);
  assert.ok(!raw.silkscreen.bestFor.includes("latin-extended-text"));
  // Tangerine, B612 Mono: basic Latin only, and the records say so
  ["tangerine", "b612-mono"].forEach((id) => {
    assert.strictEqual(label(id), "Latin", id);
    assert.ok(raw[id].avoidFor.includes("extended-latin-languages"), id);
  });
});

test("Batch 4 notes that name a missing companion or style are true of the library", () => {
  const ids = new Set(model.fonts.map((f) => f.id));
  ["dm-serif-text", "alegreya-sans-sc"].forEach((id) => assert.ok(!ids.has(id), id));
  assert.match(raw["dm-serif-display"].notes, /not in the BPOZZ library/);
  assert.match(raw["alegreya-sans"].notes, /not in the BPOZZ library/);
  // Fira Mono has no italic; Fira Sans has one for every weight
  const styles = (id) => model.fonts.find((f) => f.id === id).variants;
  assert.ok(styles("fira-mono").every((v) => v.style === "normal"));
  const sans = styles("fira-sans");
  assert.deepStrictEqual([...new Set(sans.filter((v) => v.style === "italic").map((v) => v.weight))], [...new Set(sans.map((v) => v.weight))]);
  // Judson: no 700 italic
  assert.ok(!styles("judson").some((v) => v.weight === 700 && v.style === "italic"));
});

test("Batch 4 sibling pairings do not restate the approved sibling's reason", () => {
  const SIBLINGS = [
    ["ibm-plex-sans-condensed", "ibm-plex-mono"], ["ibm-plex-sans-condensed", "ibm-plex-serif"], ["pt-sans", "pt-serif"],
    ["b612-mono", "b612"], ["fira-mono", "fira-sans"], ["barlow", "barlow-condensed"],
  ];
  SIBLINGS.forEach(([mine, approved]) => {
    const names = [nameOf(mine), nameOf(approved)];
    const theirs = raw[approved].pairings.map((p) => p.reason);
    raw[mine].pairings.forEach((p) => theirs.forEach((r) => {
      const score = editorial.similarity(editorial.contentWords(p.reason, names), editorial.contentWords(r, names));
      assert.ok(score < 0.3, `${mine} restates ${approved} (${score})`);
    }));
  });
  // one Batch 4 guide link, and it names the section that mentions the family
  const withGuides = BATCH4.filter((id) => raw[id].relatedGuides.length);
  assert.deepStrictEqual(withGuides, ["pt-sans"]);
  assert.ok(raw["pt-sans"].evidence.some((e) => e.for === "relatedGuides:font-pairing-hierarchy-decision" && /Section 05/.test(e.detail) && /PT Sans \/ PT Serif/.test(e.detail)));
});

// ---------------------------------------------------------------------
// Old-style figures (N1), Text face (N3), and alternate letters read from
// the GSUB substitutions instead of the 'aalt' tag
// ---------------------------------------------------------------------

/** An in-memory record with explicit evidence bases: [[term, basis], …]. */
function evidenced(id, characteristics) {
  const rec = {
    bestFor: ["display-headings", "short-headings"],
    avoidFor: [],
    characteristics: characteristics.map(([t]) => t),
    pairings: [],
    notes: "An in-memory record for the vocabulary tests, checking who may establish each characteristic.",
    relatedGuides: [],
    evidence: [
      { for: "bestFor:display-headings", basis: "design-guidance", detail: "fixture" },
      { for: "bestFor:short-headings", basis: "design-guidance", detail: "fixture" },
      { for: "notes", basis: "upstream-description", detail: "fixture" },
    ].concat(characteristics.map(([t, basis]) => ({ for: `characteristics:${t}`, basis, detail: "fixture" }))),
  };
  return rec;
}
const FF = "font-file";
const UP = "upstream-description";
const OLDSTYLE_FIGURES = [
  "actor", "alegreya-sans", "almendra", "bad-script", "bentham", "berkshire-swash", "crete-round", "enriqueta",
  "fanwood-text", "goudy-bookletter-1911", "im-fell-dw-pica", "im-fell-english", "italiana", "linden-hill", "nobile",
  "radley", "rufina", "sorts-mill-goudy", "trocchi", "uncial-antiqua", "young-serif",
];

test("old-style figures: the default digits of every upright style, measured", () => {
  const found = [...metrics.byId].filter(([, x]) => x.lowercaseForm === "lowercase" && x.defaultFigures === "oldstyle").map(([id]) => id).sort();
  assert.deepStrictEqual(found, OLDSTYLE_FIGURES);
  ["bentham", "crete-round", "radley", "actor", "fanwood-text", "goudy-bookletter-1911", "linden-hill", "sorts-mill-goudy", "young-serif", "nobile"].forEach((id) => {
    assert.strictEqual(problem({ font: id, metric: "defaultFigures", is: "oldstyle" }), null, id);
  });
  // each measured style is recorded, so the claim is traceable to the files
  assert.deepStrictEqual(m("crete-round").figureStyles, { "CreteRound-Regular.ttf": "oldstyle" });
  assert.deepStrictEqual(Object.values(m("nobile").figureStyles), ["oldstyle", "oldstyle", "oldstyle"], "three upright weights");
});

test("old-style figures: an optional onum is not evidence — lining defaults are refused", () => {
  ["lato", "fira-mono", "cardo"].forEach((id) => {
    assert.ok(m(id).features.includes("onum"), `${id} offers onum`);
    assert.strictEqual(m(id).defaultFigures, "lining", id);
    assert.match(problem({ font: id, metric: "defaultFigures", is: "oldstyle" }), new RegExp(`fails ${id} defaultFigures is "oldstyle"`), id);
  });
  // lining, and no onum at all
  ["crimson-text", "b612-mono"].forEach((id) => {
    assert.ok(!m(id).features.includes("onum"), id);
    assert.strictEqual(m(id).defaultFigures, "lining", id);
  });
});

test("old-style figures: mixed digits, and every upright style must agree", () => {
  // Zilla Slab offers onum, and its default digits are neither old-style nor lining
  assert.strictEqual(m("zilla-slab").defaultFigures, "mixed");
  // Puritan: the Regular draws old-style figures, the Bold lining ones — the family does not qualify
  assert.deepStrictEqual(m("puritan").figureStyles, { "Puritan-Regular.ttf": "oldstyle", "Puritan-Bold.ttf": "lining" });
  assert.strictEqual(m("puritan").defaultFigures, "mixed");
  assert.strictEqual(m("puritan").figureStyle, "oldstyle", "the reference style alone would have passed");
  assert.throws(() => validateFixture("puritan", evidenced("puritan", [["oldstyle-figures", FF], ["large-x-height", FF]])), /fails defaultFigures is "oldstyle"/);
  // italics are left out, as the reference variant leaves them out: IM Fell DW Pica's italic digits are mixed
  assert.deepStrictEqual(Object.keys(m("im-fell-dw-pica").figureStyles), ["IMFePIrm28P.ttf"]);
  assert.strictEqual(fontMetrics.familyFigures({ a: "oldstyle", b: "oldstyle" }), "oldstyle");
  assert.strictEqual(fontMetrics.familyFigures({ a: "oldstyle", b: "mixed" }), "mixed");
  assert.strictEqual(fontMetrics.familyFigures({ a: "oldstyle", b: null }), null, "an unmeasurable style blocks the claim");
});

test("old-style figures: no ordinary lowercase, no x-height, no claim", () => {
  // Bebas Neue draws its a–z as capitals, so there is no x-height to measure figures against
  assert.strictEqual(m("bebas-neue").lowercaseForm, "caps");
  assert.match(problem({ font: "bebas-neue", metric: "defaultFigures", is: "oldstyle" }), /describes ordinary lowercase/);
  assert.strictEqual(fontMetrics.METRIC_SCOPE.defaultFigures, "latin-lowercase");
  // a claim may not rest on the upstream text: the files decide
  assert.throws(() => validateFixture("bentham", evidenced("bentham", [["oldstyle-figures", UP], ["small-x-height", FF]])), /needs font-file evidence/);
  assert.deepStrictEqual(editorial.FONT_FILE_ONLY, ["oldstyle-figures", "stencil", "unicase"]);
  assert.strictEqual(editorial.CHARACTERISTICS["oldstyle-figures"], "Old-style figures");
  assert.notStrictEqual(editorial.CHARACTERISTICS["oldstyle-figures"], editorial.CHARACTERISTICS["old-style"]);
});

test("text face: upstream evidence only, never with Display face, never for a Display-category family", () => {
  assert.ok(editorial.UPSTREAM_ONLY.includes("text-face"));
  assert.doesNotThrow(() => validateFixture("adamina", evidenced("adamina", [["text-face", UP], ["transitional", UP]])));
  assert.throws(() => validateFixture("adamina", evidenced("adamina", [["text-face", FF], ["transitional", UP]])), /only the upstream description can establish/);
  assert.throws(() => validateFixture("alike", evidenced("alike", [["text-face", UP], ["display-face", UP]])), /opposite design intents/);
  // Patua One's upstream calls it "a slab serif text type", but BPOZZ files it under Display
  assert.strictEqual(model.fonts.find((f) => f.id === "patua-one").category, "display");
  assert.throws(() => validateFixture("patua-one", evidenced("patua-one", [["text-face", UP], ["slab-serif", UP]])), /conflicts with the family's BPOZZ category "display"/);
  assert.deepStrictEqual(editorial.NOT_IN_CATEGORY, { "text-face": "display" });
});

test("alternate letterforms: aalt that holds only ordinals, superiors and locale forms is refused", () => {
  const AALT_ONLY = ["alike", "brawler", "caladea", "gruppo", "marcellus", "philosopher", "radley"];
  AALT_ONLY.forEach((id) => {
    assert.ok(m(id).features.includes("aalt"), id);
    assert.strictEqual(m(id).alternateLetterCount, 0, id);
  });
  // what Brawler's aalt actually substitutes: letters to ordinals, digits to superiors — all produced by ordn/sups
  const buf = fs.readFileSync(fileOf("brawler"));
  const subs = sfnt.gsubSubstitutions(buf, sfnt.tableDirectory(buf).GSUB);
  const explained = new Set(["ordn", "sups"].flatMap((t) => (subs.get(t) || []).map(([, o]) => o)));
  assert.ok(subs.get("aalt").length > 0 && subs.get("aalt").every(([, o]) => explained.has(o)));
  assert.throws(() => validateFixture("radley", evidenced("radley", [["alternate-letterforms", FF], ["discretionary-ligatures", FF]])), /fails alternateLetterCount atLeast 2/);
  assert.deepStrictEqual(editorial.MEASURED["characteristics:alternate-letterforms"], [{ metric: "alternateLetterCount", atLeast: 2 }]);
});

test("alternate letterforms: genuine salt, ss and calt alternates are accepted, and approved records stay valid", () => {
  [["lobster", "salt"], ["style-script", "ss01"], ["mansalva", "calt"]].forEach(([id, t]) => {
    assert.ok(m(id).features.includes(t), id);
    assert.ok(m(id).alternateLetterCount >= 2, `${id}: ${m(id).alternateLetterCount}`);
    assert.ok(raw[id].characteristics.includes("alternate-letterforms"), id);
  });
  assert.doesNotThrow(() => validate(raw));
  // Montserrat Alternates: its aalt letter substitutions are all small capitals (smcp, c2sc), so the file
  // has no switchable alternate letters; its approved claim rests on the upstream text about the design itself
  assert.strictEqual(m("montserrat-alternates").alternateLetterCount, 0);
  assert.deepStrictEqual(raw["montserrat-alternates"].evidence.filter((e) => e.for === "characteristics:alternate-letterforms").map((e) => e.basis), ["upstream-description"]);
});

test("the six Group 1 families reach two evidenced characteristics with the new terms", () => {
  const SIX = {
    bentham: [["oldstyle-figures", FF], ["small-x-height", FF]],
    "crete-round": [["oldstyle-figures", FF], ["slab-serif", UP]],
    radley: [["oldstyle-figures", FF], ["discretionary-ligatures", FF]],
    adamina: [["text-face", UP], ["transitional", UP]],
    alike: [["text-face", UP], ["case-sensitive-forms", FF]],
    lusitana: [["text-face", UP], ["small-x-height", FF]],
  };
  Object.entries(SIX).forEach(([id, chars]) => {
    assert.doesNotThrow(() => validateFixture(id, evidenced(id, chars)), id);
  });
  // neither new term lifts a family that has nothing else: Actor and Italiana measure old-style figures but stay at one
  ["actor", "italiana"].forEach((id) => {
    assert.strictEqual(m(id).defaultFigures, "oldstyle", id);
    assert.throws(() => validateFixture(id, evidenced(id, [["oldstyle-figures", FF]])), /characteristics needs 2–6 entries, has 1/, id);
  });
  assert.ok(!raw.benchnine, "BenchNine stays a normal B classification");
  assert.deepStrictEqual(editorial.LIMITS.characteristics, [2, 6]);
});

test("deferred vocabulary stays out", () => {
  // Stencil and Unicase entered in Batch 10 as measured terms; everything else here stays deferred
  ["squared", "squared-forms", "metric-compatible", "low-contrast", "flared", "inscriptional", "art-deco", "fat-face", "uncial", "upright", "character-variants", "width-stable"]
    .forEach((t) => assert.ok(!editorial.CHARACTERISTICS[t], t));
  // High contrast keeps no measured rule
  assert.ok(!editorial.MEASURED["characteristics:high-contrast"]);
  // Batch 5 introduced the new terms; Batch 6 uses them where the evidence holds
  const users = Object.entries(raw).filter(([, r]) => r.characteristics.includes("text-face") || r.characteristics.includes("oldstyle-figures")).map(([id]) => id);
  assert.deepStrictEqual(users, ["alike", "lusitana", "bentham", "radley", "im-fell-dw-pica", "mate", "enriqueta", "almendra", "arsenal", "bad-script", "alice", "trocchi", "cantata-one", "fanwood-text", "basic", "tenor-sans", "young-serif", "linden-hill", "sorts-mill-goudy"]);
});

// ---------------------------------------------------------------------
// Batch 5: the Group 1 families the new terms made eligible
// ---------------------------------------------------------------------

const BATCH5 = ["alike", "lusitana", "bentham", "radley"];

test("the 70 approved records are pinned: any edit to Batches 1–4 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 70).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "aff7269321a891278c52eb50fbb49219cf141861a1fb7e8b1ca1e11833d6f030",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(70, 74), BATCH5, "Batch 5 follows Batch 4, in declaration order");
});

test("Batch 5: exactly the validated characteristics, each from the source that can establish it", () => {
  const EXPECTED = {
    alike: ["text-face", "case-sensitive-forms"],
    lusitana: ["text-face", "small-x-height"],
    bentham: ["small-x-height", "oldstyle-figures"],
    radley: ["discretionary-ligatures", "oldstyle-figures"],
  };
  Object.entries(EXPECTED).forEach(([id, chars]) => assert.deepStrictEqual(raw[id].characteristics, chars, id));
  const basesOf = (id, term) => raw[id].evidence.filter((e) => e.for === `characteristics:${term}`).map((e) => e.basis);
  BATCH5.filter((id) => raw[id].characteristics.includes("text-face")).forEach((id) => assert.deepStrictEqual(basesOf(id, "text-face"), ["upstream-description"], id));
  BATCH5.filter((id) => raw[id].characteristics.includes("oldstyle-figures")).forEach((id) => {
    assert.deepStrictEqual(basesOf(id, "oldstyle-figures"), ["font-file"], id);
    assert.strictEqual(m(id).defaultFigures, "oldstyle", id);
  });
  // none of the Text face families is filed under Display
  ["alike", "lusitana"].forEach((id) => assert.notStrictEqual(model.fonts.find((f) => f.id === id).category, "display", id));
});

test("Batch 5: coverage claims follow the verified files, not the subset list", () => {
  // Lusitana lists latin-ext, but the Latin Extended core is not in the file
  assert.ok(model.fonts.find((f) => f.id === "lusitana").subsets.includes("latin-ext"));
  assert.strictEqual(m("lusitana").coverage.latinExtendedVerified, false);
  assert.ok(raw.lusitana.avoidFor.includes("extended-latin-languages") && !raw.lusitana.bestFor.includes("latin-extended-text"));
  ["alike", "radley"].forEach((id) => {
    assert.strictEqual(m(id).coverage.latinExtendedVerified, true, id);
    assert.ok(raw[id].bestFor.includes("latin-extended-text"), id);
  });
  BATCH5.forEach((id) => assert.strictEqual(label(id).startsWith("Latin"), true, id));
});

test("Batch 5: the figure notes describe the default digits the files draw", () => {
  // Bentham: old-style, and all ten digits share one advance; no lnum anywhere
  assert.strictEqual(m("bentham").digitsUniform, true);
  assert.ok(!m("bentham").features.includes("lnum"));
  // Radley's note: discretionary ligatures present in the file
  assert.ok(m("radley").features.includes("dlig"));
  assert.strictEqual(m("radley").defaultFigures, "oldstyle");
});

test("Batch 5 excludes Adamina, Crete Round, Shanti and BenchNine, and adds no deferred term", () => {
  // Crete Round: two valid characteristics and a verified Latin Extended core, but only one defensible
  // Best for term — its upstream "sturdy slabs" sentence is about "web use", not headings — so no record
  assert.strictEqual(m("crete-round").coverage.latinExtendedVerified, true);
  assert.ok(!raw["crete-round"] && !PROTOTYPE.includes("crete-round"));
  // Adamina reaches two characteristics but only one honest Best for term (Literary settings):
  // it ships basic Latin only and nothing else in the vocabulary applies, so it gets no record
  assert.strictEqual(m("adamina").coverage.latinExtendedVerified, false);
  assert.ok(!raw.adamina && !PROTOTYPE.includes("adamina"));
  // Shanti: Stylistic sets and Alternate letterforms would rest on the same ss01/ss02 — a review-policy exclusion
  assert.ok(!raw.shanti && !PROTOTYPE.includes("shanti"));
  assert.ok(!raw.benchnine && !PROTOTYPE.includes("benchnine"));
  // Style Script's approved record is untouched by the policy
  assert.deepStrictEqual(raw["style-script"].characteristics, ["stylistic-sets", "alternate-letterforms"]);
  const guides = BATCH5.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, ["alike:font-pairing-hierarchy-decision", "lusitana:type-scale-systems"]);
  assert.ok(raw.alike.evidence.some((e) => e.for === "relatedGuides:font-pairing-hierarchy-decision" && /pitfall 03/.test(e.detail)));
  assert.ok(raw.lusitana.evidence.some((e) => e.for === "relatedGuides:type-scale-systems" && /Section 03/.test(e.detail)));
});

// ---------------------------------------------------------------------
// Batch 6: the next families in the plan sequence the evidence supports
// ---------------------------------------------------------------------

const BATCH6 = [
  "im-fell-dw-pica", "space-mono", "monsieur-la-doulaise", "aboreto", "libre-caslon-display",
  "economica", "lekton", "mrs-saint-delafield", "racing-sans-one", "libertinus-mono",
  "kaushan-script", "istok-web", "vt323", "birthstone", "calistoga",
  "mate", "syne-mono", "audiowide", "enriqueta", "alata",
];

test("the 74 approved records are pinned: any edit to Batches 1–5 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 74).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "9f661d2fcd4267eea243676dd1ab3113cbe6f2da14f9d19a62bb4992c568f80a",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(74, 94), BATCH6, "Batch 6 follows Batch 5, in declaration order");
});

test("Batch 6 leaves out the families the evidence cannot carry", () => {
  // one honest Best for term or one characteristic at most — no record rather than filler
  ["puritan", "antic-slab", "cantarell", "oleo-script", "ropa-sans", "petit-formal-script"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // Quattrocento: Alternate letterforms and Stylistic alternates would both rest on its one salt feature
  assert.ok(m("quattrocento").features.includes("salt"));
  assert.ok(!raw.quattrocento && !PROTOTYPE.includes("quattrocento"));
  // Batch 5's exclusions stay excluded
  ["adamina", "crete-round", "shanti", "benchnine"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
});

test("Batch 6: no record claims Alternate letterforms beside the stylistic sets that supply them", () => {
  BATCH6.forEach((id) => assert.ok(!raw[id].characteristics.includes("alternate-letterforms"), id));
});

test("Batch 6: the notes describe what the shipped files measure, not what upstream promises", () => {
  // Economica: 'very condensed' upstream, normal OS/2 width, measured narrow
  assert.strictEqual(m("economica").widthClass, 5);
  assert.ok(!raw.economica.characteristics.includes("condensed") && raw.economica.characteristics.includes("narrow"));
  // Lekton: 'trispaced' upstream, yet ASCII shares one advance; post.isFixedPitch unset
  assert.strictEqual(m("lekton").asciiMonospaced, true);
  assert.strictEqual(m("lekton").fixedPitch, false);
  // Space Mono: upstream lists old-style figures; the default is lining, onum optional
  assert.strictEqual(m("space-mono").defaultFigures, "lining");
  assert.ok(m("space-mono").features.includes("onum"));
  // VT323: pixel-derived, but not on a coarse grid — no Pixel grid claim, no fluid-sizing warning
  assert.strictEqual(m("vt323").pixelated, false);
  assert.ok(!raw.vt323.characteristics.includes("pixel") && !raw.vt323.avoidFor.includes("fluid-sizing"));
  // Mate: medium-height numbers measure as neither lining nor old-style; no smcp in this file
  assert.strictEqual(m("mate").defaultFigures, "mixed");
  assert.ok(!m("mate").features.includes("smcp"));
  // Libertinus Mono is Latin only while its Serif partner verifies Greek and Cyrillic
  assert.deepStrictEqual(m("libertinus-mono").scripts, ["latin"]);
  ["greek", "cyrillic"].forEach((s) => assert.ok(m("libertinus-serif").scripts.includes(s), s));
});

test("Batch 6: subset lists never stand in for verified Latin Extended coverage", () => {
  ["economica", "monsieur-la-doulaise", "mrs-saint-delafield"].forEach((id) => {
    assert.ok(model.fonts.find((f) => f.id === id).subsets.includes("latin-ext"), id);
    assert.strictEqual(m(id).coverage.latinExtendedVerified, false, id);
    assert.ok(raw[id].avoidFor.includes("extended-latin-languages") && !raw[id].bestFor.includes("latin-extended-text"), id);
  });
});

test("Batch 6 links two guides, each with a section-level reason", () => {
  const guides = BATCH6.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, ["aboreto:type-scale-systems", "istok-web:line-length-reading-constraint"]);
  assert.ok(raw.aboreto.evidence.some((e) => e.for === "relatedGuides:type-scale-systems" && /Section 08/.test(e.detail)));
  assert.ok(raw["istok-web"].evidence.some((e) => e.for === "relatedGuides:line-length-reading-constraint" && /pitfall 04/.test(e.detail)));
});

// ---------------------------------------------------------------------
// Batch 7: the next twenty the plan sequence and the evidence support
// ---------------------------------------------------------------------

const BATCH7 = [
  "anonymous-pro", "patrick-hand", "jersey-25", "livvic", "pt-mono",
  "pinyon-script", "almendra", "arsenal", "cutive-mono", "pacifico",
  "rowdies", "ledger", "archivo-black", "dm-mono", "allura",
  "arizonia", "alfa-slab-one", "gabriela", "oxygen-mono", "hurricane",
];

test("the 94 approved records are pinned: any edit to Batches 1–6 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 94).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "b7cb59dd9d451a4c27943d88abc931e78b91956db21c1867f26f244432b0fe48",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(94, 114), BATCH7, "Batch 7 follows Batch 6, in declaration order");
});

test("Batch 7 leaves out the families with one honest Best for term", () => {
  ["poly", "bowlby-one", "germania-one", "quando", "electrolize", "share-tech-mono", "nobile"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // Nobile lists latin-ext but the core is not in the file, so it cannot take Latin Extended either
  assert.strictEqual(m("nobile").coverage.latinExtendedVerified, false);
  // Batch 6's exclusions stay excluded
  ["puritan", "antic-slab", "cantarell", "oleo-script", "quattrocento", "ropa-sans", "petit-formal-script"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
});

test("Batch 7: no record claims Alternate letterforms beside the sets that supply them", () => {
  BATCH7.forEach((id) => assert.ok(!raw[id].characteristics.includes("alternate-letterforms"), id));
});

test("Batch 7: the notes follow the shipped files where upstream says otherwise", () => {
  // Ledger: 'a large x-height' upstream; mid-library against the em, bottom quarter against its tall capitals
  assert.ok(m("ledger").percentile.xToCap <= 25 && m("ledger").percentile.capHeight >= 80);
  assert.ok(raw.ledger.characteristics.includes("small-x-height"));
  // Arsenal: 'narrow proportions' upstream; not in the narrowest 15%, so no Narrow tag
  assert.ok(m("arsenal").percentile.lowercaseAdvance > 15 && !raw.arsenal.characteristics.includes("narrow"));
  // Patrick Hand: upstream reserves smcp/onum for the download, the served file has them
  ["smcp", "onum"].forEach((t) => assert.ok(m("patrick-hand").features.includes(t), t));
  // Anonymous Pro and Oxygen Mono: no substitution features at all
  assert.deepStrictEqual(m("anonymous-pro").features, []);
  assert.deepStrictEqual(m("oxygen-mono").features, []);
  assert.strictEqual(m("oxygen-mono").fixedPitch, false);
  // Archivo Black: 200+ languages upstream, Latin only in the file
  assert.deepStrictEqual(m("archivo-black").scripts, ["latin"]);
  // Jersey 25 is on a pixel grid, so it carries the fluid-sizing warning
  assert.strictEqual(m("jersey-25").pixelated, true);
  assert.ok(raw["jersey-25"].avoidFor.includes("fluid-sizing"));
});

test("Batch 7 pairs only with family members, and links two guides with section-level reasons", () => {
  const pairs = BATCH7.flatMap((id) => raw[id].pairings.map((p) => `${id}:${p.font}`));
  assert.deepStrictEqual(pairs, ["pt-mono:pt-sans", "oxygen-mono:oxygen"]);
  const guides = BATCH7.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, ["jersey-25:type-scale-systems", "pt-mono:font-pairing-hierarchy-decision"]);
  assert.ok(raw["jersey-25"].evidence.some((e) => e.for === "relatedGuides:type-scale-systems" && /Section 06/.test(e.detail)));
  assert.ok(raw["pt-mono"].evidence.some((e) => e.for === "relatedGuides:font-pairing-hierarchy-decision" && /Section 05/.test(e.detail)));
});

// ---------------------------------------------------------------------
// Batch 7B: the plan sequence from Carter One (position 55)
// ---------------------------------------------------------------------

const BATCH7B = [
  "belleza", "bad-script", "limelight", "gilda-display", "inria-sans",
  "grand-hotel", "balsamiq-sans", "paytone-one", "kristi", "yeseva-one",
  "special-gothic-expanded-one", "damion", "alice", "francois-one", "ms-madi",
  "bevan", "play", "niconne", "oranienbaum", "fjalla-one",
];

test("the 114 approved records are pinned: any edit to Batches 1–7 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 114).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "14c81c31bf5551c5c226a37693d57682b2e4af423598a88877aa730418063f3e",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(114, 134), BATCH7B, "Batch 7B follows Batch 7, in declaration order");
});

test("Batch 7B leaves out the families the evidence cannot carry", () => {
  // one honest Best for term: Display headings, reading use, weights or aligned figures alone
  ["carter-one", "volkhov", "goudy-bookletter-1911", "solway", "gravitas-one", "caprasimo"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // Boogaloo: two Best for terms but Narrow is its only characteristic
  assert.ok(!raw.boogaloo && !PROTOTYPE.includes("boogaloo"));
  // earlier exclusions stay excluded
  ["poly", "bowlby-one", "germania-one", "quando", "electrolize", "share-tech-mono", "nobile",
    "puritan", "antic-slab", "cantarell", "oleo-script", "quattrocento", "ropa-sans", "petit-formal-script",
    "adamina", "crete-round", "shanti", "benchnine"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
});

test("Batch 7B: Alternate letterforms only where no stylistic set or salt could double-count it", () => {
  BATCH7B.filter((id) => raw[id].characteristics.includes("alternate-letterforms")).forEach((id) => {
    assert.ok(!raw[id].characteristics.includes("stylistic-sets") && !raw[id].characteristics.includes("stylistic-alternates"), id);
    assert.ok(!m(id).features.some((t) => /^ssdd$/.test(t) || t === "salt"), id);
  });
  assert.deepStrictEqual(m("kristi").features, ["calt"]);
});

test("Batch 7B: the notes follow the shipped files where names or upstream say otherwise", () => {
  // Special Gothic Expanded One: 'Expanded' in the name, normal OS/2 width, measured wide
  assert.strictEqual(m("special-gothic-expanded-one").widthClass, 5);
  assert.ok(!raw["special-gothic-expanded-one"].characteristics.includes("expanded"));
  // Alice: 'widened proportions' upstream, not in the widest quarter; latin-ext listed but not verified
  assert.ok(m("alice").percentile.lowercaseAdvance < 75 && !raw.alice.characteristics.includes("wide-lowercase"));
  assert.strictEqual(m("alice").coverage.latinExtendedVerified, false);
  // Belleza: default digits already tabular, no tnum
  assert.strictEqual(m("belleza").tabularFigures, true);
  assert.ok(!m("belleza").features.includes("tnum"));
  // Limelight, Niconne, Oranienbaum: no substitution features to switch on
  ["limelight", "niconne", "oranienbaum"].forEach((id) => assert.deepStrictEqual(m(id).features, [], id));
});

test("Batch 7B pairs Inria Sans with its Serif sibling and links one guide", () => {
  const pairs = BATCH7B.flatMap((id) => raw[id].pairings.map((p) => `${id}:${p.font}`));
  assert.deepStrictEqual(pairs, ["inria-sans:inria-serif"]);
  const guides = BATCH7B.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, ["inria-sans:font-pairing-hierarchy-decision"]);
  assert.ok(raw["inria-sans"].evidence.some((e) => e.for === "relatedGuides:font-pairing-hierarchy-decision" && /Section 05/.test(e.detail)));
});

// ---------------------------------------------------------------------
// Batch 7C: the plan sequence from Norican (position 82) to 150 records
// ---------------------------------------------------------------------

const BATCH7C = [
  "norican", "inria-serif", "tomorrow", "corinthia", "trocchi", "pangolin", "cantata-one", "rubik-mono-one",
  "sansita", "gloock", "fanwood-text", "news-cycle", "staatliches", "zilla-slab", "russo-one", "righteous",
];

test("the 134 approved records are pinned: any edit to Batches 1–7B fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 134).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "f2bb092ff30626d9df3b10fe09566a45090b32ff7c18b75b734a357b2007c78b",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(134, 150), BATCH7C, "Batch 7C follows Batch 7B, in declaration order");
});

test("Batch 7C leaves out the families the evidence cannot carry, and every earlier exclusion stays out", () => {
  // one honest Best for term, or one characteristic
  ["belanosima", "rye", "rambla", "nixie-one", "handlee", "pirata-one", "vast-shadow", "neucha", "gochi-hand", "courgette"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  ["carter-one", "volkhov", "goudy-bookletter-1911", "solway", "gravitas-one", "caprasimo", "boogaloo",
    "poly", "bowlby-one", "germania-one", "quando", "electrolize", "share-tech-mono", "nobile",
    "puritan", "antic-slab", "cantarell", "oleo-script", "quattrocento", "ropa-sans", "petit-formal-script",
    "adamina", "crete-round", "shanti", "benchnine"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
});

test("Batch 7C: no record claims Alternate letterforms", () => {
  BATCH7C.forEach((id) => assert.ok(!raw[id].characteristics.includes("alternate-letterforms"), id));
});

test("Batch 7C: the notes follow the shipped files where upstream says otherwise", () => {
  // Corinthia: 'three weights' upstream, two in the served family
  assert.deepStrictEqual([...new Set(model.fonts.find((f) => f.id === "corinthia").variants.map((v) => v.weight))], [400, 700]);
  // Gloock: cyrillic-ext subset, Latin only verified
  assert.deepStrictEqual(m("gloock").scripts, ["latin"]);
  assert.ok(raw.gloock.avoidFor.includes("cyrillic-greek") && !raw.gloock.bestFor.includes("cyrillic-text"));
  // News Cycle: Greek and Cyrillic 'soon' upstream, both verified now
  ["greek", "cyrillic"].forEach((s) => assert.ok(m("news-cycle").scripts.includes(s), s));
  // Staatliches: discretionary ligatures promised upstream, absent from the file
  assert.ok(!m("staatliches").features.includes("dlig") && !raw.staatliches.characteristics.includes("discretionary-ligatures"));
  // Cantata One: 'extended' upstream, normal OS/2 width, measured wide
  assert.strictEqual(m("cantata-one").widthClass, 5);
  assert.ok(!raw["cantata-one"].characteristics.includes("expanded") && raw["cantata-one"].characteristics.includes("wide-lowercase"));
  // Rubik Mono One is a caps-only monospace: no x-height claim can reach it
  assert.strictEqual(m("rubik-mono-one").lowercaseForm, "caps");
});

test("Batch 7C pairs Inria Serif back to Inria Sans and links one guide", () => {
  const pairs = BATCH7C.flatMap((id) => raw[id].pairings.map((p) => `${id}:${p.font}`));
  assert.deepStrictEqual(pairs, ["inria-serif:inria-sans"]);
  const guides = BATCH7C.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, ["rubik-mono-one:type-scale-systems"]);
});

// ---------------------------------------------------------------------
// Batch 8: the plan sequence from Fenix (position 108) to 170 records
// ---------------------------------------------------------------------

const BATCH8 = [
  "blinker", "marck-script", "meow-script", "playball", "basic", "short-stack", "rammetto-one", "krona-one",
  "vujahday-script", "caveat-brush", "fauna-one", "tenor-sans", "qwitcher-grypen", "sacramento", "titan-one",
  "cookie", "young-serif", "delicious-handrawn", "parisienne", "bangers",
];

test("the 150 approved records are pinned: any edit to Batches 1–7C fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 150).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "ab584bee0b4420e14c611b647cfa92d4ce330119edd80019ec6aabd860ca064a",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(150, 170), BATCH8, "Batch 8 follows Batch 7C, in declaration order");
  assert.deepStrictEqual(PROTOTYPE.slice(150, 170), BATCH8, "site.config declares Batch 8 in the same order");
});

test("Batch 8 leaves out the families the evidence cannot carry, and every earlier exclusion stays out", () => {
  // one honest Best for term or none (Display headings alone, Latin Extended alone), or fewer than two characteristics
  ["fenix", "unna", "abel", "antic-didone", "balthazar", "cabin-sketch", "ovo", "quattrocento-sans", "squada-one",
    "cinzel-decorative", "coustard", "text-me-one", "vidaloka", "aldrich", "fugaz-one", "doppio-one", "passion-one",
    "asul", "abeezee"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // Unica One: measured "caps", but upstream draws it unicase with lowercase forms, so All caps would mislead.
  // Batch 10 reopened it once the Unicase term existed; it still never claims All caps.
  assert.strictEqual(m("unica-one").lowercaseForm, "caps");
  assert.ok(raw["unica-one"].characteristics.includes("unicase") && !raw["unica-one"].characteristics.includes("all-caps"));
  assert.ok(!raw["unica-one"].bestFor.includes("all-caps-titles"));
  ["belanosima", "rye", "rambla", "nixie-one", "handlee", "pirata-one", "vast-shadow", "neucha", "gochi-hand", "courgette",
    "carter-one", "volkhov", "goudy-bookletter-1911", "solway", "gravitas-one", "caprasimo", "boogaloo",
    "poly", "bowlby-one", "germania-one", "quando", "electrolize", "share-tech-mono", "nobile",
    "puritan", "antic-slab", "cantarell", "oleo-script", "quattrocento", "ropa-sans", "petit-formal-script",
    "adamina", "crete-round", "shanti", "benchnine"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
});

test("Batch 8: no alternate mechanism is counted twice", () => {
  BATCH8.forEach((id) => {
    const c = raw[id].characteristics;
    assert.ok(!c.includes("alternate-letterforms"), id);
    assert.ok(!(c.includes("stylistic-sets") && c.includes("stylistic-alternates")), id);
    // each font-file characteristic cites its own measurement
    const details = raw[id].evidence.filter((e) => e.for.startsWith("characteristics:") && e.basis === "font-file").map((e) => e.detail);
    assert.strictEqual(new Set(details).size, details.length, id);
  });
  // salt is present in these files but backs no characteristic
  ["meow-script", "playball", "vujahday-script"].forEach((id) => {
    assert.ok(m(id).features.includes("salt"), id);
    assert.ok(!raw[id].characteristics.includes("stylistic-alternates"), id);
  });
});

test("Batch 8: the notes follow the shipped files where names or upstream say otherwise", () => {
  const weights = (id) => [...new Set(model.fonts.find((f) => f.id === id).variants.map((v) => v.weight))];
  // Blinker: a headline weight upstream, eight text weights served, no Medium
  assert.deepStrictEqual(weights("blinker"), [100, 200, 300, 400, 600, 700, 800, 900]);
  // Caveat Brush: positional variation upstream, no contextual or positional features in the file
  ["calt", "init", "medi", "fina", "salt"].forEach((t) => assert.ok(!m("caveat-brush").features.includes(t), t));
  // Fauna One 'slightly condensed' and Krona One 'semi-extended': normal OS/2 width, measured wide
  ["fauna-one", "krona-one"].forEach((id) => {
    assert.strictEqual(m(id).widthClass, 5, id);
    assert.ok(!raw[id].characteristics.includes("condensed") && !raw[id].characteristics.includes("expanded"), id);
    assert.ok(raw[id].characteristics.includes("wide-lowercase"), id);
  });
  // Cookie: 'legible even in text sizes' upstream, x-height in the bottom tenth; latin-ext listed, core not verified
  assert.ok(m("cookie").percentile.xHeight <= 10);
  assert.strictEqual(m("cookie").coverage.latinExtendedVerified, false);
  assert.ok(raw.cookie.avoidFor.includes("extended-latin-languages") && !raw.cookie.bestFor.includes("latin-extended-text"));
  // Vujahday Script: 'a plain and a script stylistic set' upstream, one ssNN in the file
  assert.deepStrictEqual(m("vujahday-script").features.filter((t) => /^ss\d\d$/.test(t)), ["ss01"]);
  // Young Serif: 'heavy weight' upstream, registered as 400
  assert.deepStrictEqual(weights("young-serif"), [400]);
  // Tenor Sans: a body face without tabular figures
  assert.strictEqual(m("tenor-sans").tabularFigures, false);
  assert.ok(!raw["tenor-sans"].bestFor.includes("tabular-data"));
});

test("Batch 8 adds no pairing and links four guides, each to a named section", () => {
  assert.deepStrictEqual(BATCH8.flatMap((id) => raw[id].pairings.map((p) => `${id}:${p.font}`)), []);
  const guides = BATCH8.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, [
    "marck-script:type-scale-systems",
    "basic:font-pairing-hierarchy-decision",
    "tenor-sans:font-pairing-hierarchy-decision",
    "bangers:type-scale-systems",
  ]);
  guides.forEach((pair) => {
    const [id, g] = pair.split(":");
    assert.ok(raw[id].evidence.some((e) => e.for === `relatedGuides:${g}` && /Section 0\d/.test(e.detail)), pair);
  });
});

// ---------------------------------------------------------------------
// Batch 9: the plan sequence from Lustria (position 148) to its end (168)
// ---------------------------------------------------------------------

const BATCH9 = [
  "days-one", "allison", "pathway-gothic-one", "italianno", "graduate", "alex-brush",
  "eater", "linden-hill", "yesteryear", "sorts-mill-goudy", "six-caps", "leckerli-one",
];

test("the 170 approved records are pinned: any edit to Batches 1–8 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 170).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "b15946f56e3bc0f4f0ee67fe1d2dbf74de86e4009cc26ea2e49f315c8f34ddf9",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(170, 182), BATCH9, "Batch 9 follows Batch 8, in declaration order");
  assert.deepStrictEqual(PROTOTYPE.slice(170, 182), BATCH9, "site.config declares Batch 9 in the same order");
});

test("Batch 9 leaves out the families the evidence cannot carry, and every earlier exclusion stays out", () => {
  // one honest Best for term: Lustria and Rufina (headings only), Chango (headlines only), Concert One
  // (display category only), Armata and Sintony (no use the vocabulary can state beyond one)
  ["lustria", "rufina", "chango", "concert-one", "armata", "sintony"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // one defensible characteristic: Fondamento (handwritten only)
  assert.ok(!raw.fondamento && !PROTOTYPE.includes("fondamento"));
  // Sofia: 'unconventional ligatures' upstream, but the file has no GSUB feature at all
  assert.deepStrictEqual(m("sofia").features, []);
  assert.ok(!raw.sofia && !PROTOTYPE.includes("sofia"));
  // Architects Daughter: its one distinguishing trait (squared architectural lettering) has no term or measurement
  assert.ok(!raw["architects-daughter"] && !PROTOTYPE.includes("architects-daughter"));
  ["fenix", "unna", "abel", "antic-didone", "balthazar", "cabin-sketch", "ovo", "quattrocento-sans", "squada-one",
    "cinzel-decorative", "coustard", "text-me-one", "vidaloka", "aldrich", "fugaz-one", "doppio-one", "passion-one",
    "asul", "abeezee",
    "belanosima", "rye", "rambla", "nixie-one", "handlee", "pirata-one", "vast-shadow", "neucha", "gochi-hand", "courgette",
    "carter-one", "volkhov", "goudy-bookletter-1911", "solway", "gravitas-one", "caprasimo", "boogaloo",
    "poly", "bowlby-one", "germania-one", "quando", "electrolize", "share-tech-mono", "nobile",
    "puritan", "antic-slab", "cantarell", "oleo-script", "quattrocento", "ropa-sans", "petit-formal-script",
    "adamina", "crete-round", "shanti", "benchnine", "berkshire-swash"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
});

test("Batch 9: no alternate mechanism is counted twice, and small-caps faces claim no lowercase width", () => {
  BATCH9.forEach((id) => {
    const c = raw[id].characteristics;
    const alternates = ["alternate-letterforms", "stylistic-sets", "stylistic-alternates"].filter((t) => c.includes(t));
    assert.ok(alternates.length <= 1, id);
    const details = raw[id].evidence.filter((e) => e.for.startsWith("characteristics:") && e.basis === "font-file").map((e) => e.detail);
    assert.strictEqual(new Set(details).size, details.length, id);
  });
  // Italianno: ss01–ss03 and salt are in the file; only Alternate letterforms is claimed
  assert.ok(m("italianno").alternateLetterCount >= 2);
  assert.ok(!raw.italianno.characteristics.includes("stylistic-sets") && !raw.italianno.characteristics.includes("stylistic-alternates"));
  // Graduate: a–z are small capitals, so no Wide lowercase although the advance ranks wide
  assert.strictEqual(m("graduate").lowercaseForm, "small-caps");
  assert.ok(!raw.graduate.characteristics.includes("wide-lowercase"));
});

test("Batch 9: the notes follow the shipped files where names or upstream say otherwise", () => {
  const weights = (id) => [...new Set(model.fonts.find((f) => f.id === id).variants.map((v) => v.weight))];
  // Six Caps 'highly condensed' upstream: normal OS/2 width, measured narrow — Narrow, never Condensed
  assert.strictEqual(m("six-caps").widthClass, 5);
  assert.ok(raw["six-caps"].characteristics.includes("narrow") && !raw["six-caps"].characteristics.includes("condensed"));
  // Pathway Gothic One: 'the first of many' weights upstream, one served
  assert.deepStrictEqual(weights("pathway-gothic-one"), [400]);
  assert.ok(!raw["pathway-gothic-one"].characteristics.includes("condensed"));
  // Days One: Numans named upstream, not in the library, so no pairing
  assert.ok(!model.fonts.some((f) => f.id === "numans"));
  // Eater: x-height above cap height
  assert.ok(m("eater").xToCap > 1);
  // Graduate: tabular by default, not through tnum
  assert.strictEqual(m("graduate").tabularFigures, true);
  assert.ok(!m("graduate").features.includes("tnum"));
  // Yesteryear and Leckerli One ship basic Latin only
  ["yesteryear", "leckerli-one", "six-caps"].forEach((id) => {
    assert.strictEqual(m(id).coverage.latinExtendedVerified, false, id);
    assert.ok(raw[id].avoidFor.includes("extended-latin-languages"), id);
  });
});

test("Batch 9 adds no pairing and links three guides, each to a named section", () => {
  assert.deepStrictEqual(BATCH9.flatMap((id) => raw[id].pairings.map((p) => `${id}:${p.font}`)), []);
  const guides = BATCH9.flatMap((id) => raw[id].relatedGuides.map((g) => `${id}:${g}`));
  assert.deepStrictEqual(guides, [
    "days-one:font-pairing-hierarchy-decision",
    "graduate:type-scale-systems",
    "six-caps:type-scale-systems",
  ]);
  guides.forEach((pair) => {
    const [id, g] = pair.split(":");
    assert.ok(raw[id].evidence.some((e) => e.for === `relatedGuides:${g}` && /Section 0\d/.test(e.detail)), pair);
  });
});

// ---------------------------------------------------------------------
// Batch 10: Unicase and Stencil, measured from the glyph outlines
// (scripts/fonts/sfnt.js OUTLINES), and the two families they made eligible
// ---------------------------------------------------------------------

const BATCH10 = ["unica-one", "saira-stencil-one"];

test("the 182 approved records are pinned: any edit to Batches 1–9 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 182).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "4974b5b6123b2be1d308fc420e5c37b2a49b526d8b1724c5b45918e2e68e596f",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(182, 184), BATCH10, "Batch 10 follows Batch 9, in declaration order");
  assert.deepStrictEqual(PROTOTYPE.slice(182, 184), BATCH10, "site.config declares Batch 10 in the same order");
  assert.strictEqual(Object.keys(raw).length, 185);
});

/** An evidenced() record with a second evidence entry for one characteristic. */
function withSecondBasis(rec, term, basis, detail = "'a condensed unicase sans serif style' (fixture)") {
  rec.evidence.push({ for: `characteristics:${term}`, basis, detail });
  return rec;
}

test("Unicase: the rule, its threshold, and the library's counts", () => {
  assert.strictEqual(editorial.CHARACTERISTICS.unicase, "Unicase");
  assert.deepStrictEqual(editorial.MEASURED["characteristics:unicase"], [
    { metric: "lowercaseForm", is: "caps" },
    { metric: "unicaseLetterCount", atLeast: 10 },
  ]);
  assert.strictEqual(fontMetrics.METRIC_SCOPE.unicaseLetterCount, "latin");
  // counted only where a–z stand at cap height
  metrics.byId.forEach((x, id) => assert.strictEqual(x.unicaseLetterCount === null, x.lowercaseForm !== "caps", id));
  // all-caps faces that repeat or re-encode their capitals score 0
  ["bebas-neue", "bungee", "staatliches", "aboreto", "bangers", "creepster", "monofett", "rubik-mono-one", "silkscreen"].forEach((id) =>
    assert.strictEqual(m(id).unicaseLetterCount, 0, id));
  // Unica One's lowercase shapes, and Major Mono Display's second capital designs, both reach the threshold
  assert.ok(m("unica-one").unicaseLetterCount >= 10);
  assert.ok(m("major-mono-display").unicaseLetterCount >= 10);
  const passing = [...metrics.byId].filter(([, x]) => x.lowercaseForm === "caps" && x.unicaseLetterCount >= 10).map(([id]) => id);
  assert.deepStrictEqual(passing.sort(), ["major-mono-display", "unica-one"]);
  // the comparator holds at the count and fails one above it
  const n = m("unica-one").unicaseLetterCount;
  assert.strictEqual(problem({ metric: "unicaseLetterCount", atLeast: n }, "unica-one"), null);
  assert.match(problem({ metric: "unicaseLetterCount", atLeast: n + 1 }, "unica-one"), /fails unicaseLetterCount atLeast/);
  // the helper and measure() agree
  assert.strictEqual(sfnt.unicaseLetterCount(fs.readFileSync(fileOf("unica-one"))), n);
});

test("Unicase needs the measurement and the upstream description, and excludes All caps", () => {
  const both = () => withSecondBasis(evidenced("unica-one", [["unicase", FF], ["large-glyph-set", FF]]), "unicase", UP);
  assert.doesNotThrow(() => validateFixture("unica-one", both()));
  // the file alone cannot say the shapes are lowercase
  assert.throws(() => validateFixture("unica-one", evidenced("unica-one", [["unicase", FF], ["large-glyph-set", FF]])), /also needs upstream-description evidence/);
  // the word "unicase" alone is not enough either
  assert.throws(() => validateFixture("unica-one", evidenced("unica-one", [["unicase", UP], ["large-glyph-set", FF]])), /needs font-file evidence/);
  // an ordinary all-caps face fails the count; a lowercase face fails the height
  assert.throws(() => validateFixture("bebas-neue", withSecondBasis(evidenced("bebas-neue", [["unicase", FF], ["narrow", FF]]), "unicase", UP)), /fails unicaseLetterCount atLeast 10/);
  assert.throws(() => validateFixture("lato", withSecondBasis(evidenced("lato", [["unicase", FF], ["humanist-details", UP]]), "unicase", UP)), /fails lowercaseForm is "caps"/);
  // Unicase suppresses All caps: never both on one record
  const twice = withSecondBasis(evidenced("unica-one", [["unicase", FF], ["all-caps", FF]]), "unicase", UP);
  assert.throws(() => validateFixture("unica-one", twice), /"unicase" and "all-caps" are two readings of the same a–z at cap height/);
  assert.deepStrictEqual(Object.keys(editorial.CONFIRMED_BY_UPSTREAM), ["unicase"]);
  // an upstream entry that does not name the design is not confirmation
  assert.throws(() => validateFixture("unica-one", withSecondBasis(evidenced("unica-one", [["unicase", FF], ["large-glyph-set", FF]]), "unicase", UP, "'mixes capital and lowercase forms at one height'")), /needs upstream-description evidence that names the design/);
});

test("Major Mono Display stays All caps: its lowercase keys hold capital designs, not lowercase forms", () => {
  // The outlines differ from the capitals (the count passes), but upstream calls the family
  // "all-uppercase", and its approved note describes two capital alphabets. The count cannot tell
  // a second capital design from a lowercase form, so the record keeps All caps (pinned above).
  assert.ok(m("major-mono-display").unicaseLetterCount >= 10);
  assert.ok(raw["major-mono-display"].characteristics.includes("all-caps"));
  assert.ok(!raw["major-mono-display"].characteristics.includes("unicase"));
  assert.ok(raw["major-mono-display"].evidence.some((e) => e.for === "characteristics:geometric" && /all-uppercase/.test(e.detail)));
  // the regression itself: the passing count plus Major Mono Display's real upstream sentence is refused
  const mmd = withSecondBasis(evidenced("major-mono-display", [["unicase", FF], ["monospaced", FF]]), "unicase", UP, "'a monospaced geometric sans serif all-uppercase typeface'.");
  assert.throws(() => validateFixture("major-mono-display", mmd), /needs upstream-description evidence that names the design/);
  // every other record on a font that passes the Unicase count claims Unicase, never All caps
  Object.entries(raw).forEach(([id, rec]) => {
    if (id === "major-mono-display" || !(m(id).lowercaseForm === "caps" && m(id).unicaseLetterCount >= 10)) return;
    assert.ok(rec.characteristics.includes("unicase") && !rec.characteristics.includes("all-caps"), id);
  });
});

test("Stencil: the rule, its threshold, and the library's counts", () => {
  assert.strictEqual(editorial.CHARACTERISTICS.stencil, "Stencil");
  assert.deepStrictEqual(editorial.MEASURED["characteristics:stencil"], [{ metric: "stencilLetterCount", atLeast: 15 }]);
  assert.strictEqual(fontMetrics.METRIC_SCOPE.stencilLetterCount, "latin");
  assert.strictEqual(sfnt.STENCIL_GLYPHS.length, 19);
  assert.strictEqual(String.fromCodePoint(...sfnt.STENCIL_GLYPHS), "abdegopqABDOPQR0689");
  ["saira-stencil-one", "stardos-stencil", "black-ops-one"].forEach((id) => assert.ok(m(id).stencilLetterCount >= 15, id));
  // Monoton's multi-line capitals are separate strokes, but every counter stays enclosed
  assert.ok(m("monoton").stencilLetterCount < 15);
  const passing = [...metrics.byId].filter(([, x]) => x.stencilLetterCount >= 15).map(([id]) => id);
  assert.deepStrictEqual(passing.sort(), ["black-ops-one", "saira-stencil-one", "stardos-stencil"]);
  // nothing else comes close to the threshold
  metrics.byId.forEach((x, id) => {
    if (!passing.includes(id) && id !== "monoton") assert.ok(x.stencilLetterCount <= 5, `${id} ${x.stencilLetterCount}`);
  });
  const n = m("saira-stencil-one").stencilLetterCount;
  assert.strictEqual(problem({ metric: "stencilLetterCount", atLeast: n }, "saira-stencil-one"), null);
  assert.match(problem({ metric: "stencilLetterCount", atLeast: n + 1 }, "saira-stencil-one"), /fails stencilLetterCount atLeast/);
  assert.strictEqual(sfnt.stencilLetterCount(fs.readFileSync(fileOf("saira-stencil-one"))), n);
});

test("Stencil is established by the outlines, never by the name or the upstream word", () => {
  assert.doesNotThrow(() => validateFixture("saira-stencil-one", evidenced("saira-stencil-one", [["stencil", FF], ["alternate-zero", FF]])));
  assert.throws(() => validateFixture("saira-stencil-one", evidenced("saira-stencil-one", [["stencil", UP], ["alternate-zero", FF]])), /needs font-file evidence/);
  assert.throws(() => validateFixture("monoton", evidenced("monoton", [["stencil", FF], ["small-caps", FF]])), /fails stencilLetterCount atLeast 15/);
  // Black Ops One passes the rule; its approved record is unchanged (pinned above)
  assert.doesNotThrow(() => validateFixture("black-ops-one", evidenced("black-ops-one", [["stencil", FF], ["wide-lowercase", FF]])));
  assert.ok(!raw["black-ops-one"].characteristics.includes("stencil"));
});

test("outline measurements fail safely on missing or malformed glyph data", () => {
  [Buffer.alloc(0), Buffer.alloc(12), Buffer.from("not a font at all")].forEach((b) => {
    assert.strictEqual(sfnt.stencilLetterCount(b), null);
    assert.strictEqual(sfnt.unicaseLetterCount(b), null);
  });
  const good = fs.readFileSync(fileOf("saira-stencil-one"));
  // truncated before the glyph data ends
  assert.strictEqual(sfnt.stencilLetterCount(good.subarray(0, Math.floor(good.length / 3))), null);
  // no glyf table: no outlines, so no answer rather than a guess
  const noGlyf = Buffer.from(good);
  const numTables = noGlyf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    if (noGlyf.toString("latin1", 12 + i * 16, 16 + i * 16) === "glyf") noGlyf.write("xxxx", 12 + i * 16, "latin1");
  }
  assert.ok(sfnt.tableDirectory(good).glyf && !sfnt.tableDirectory(noGlyf).glyf);
  assert.strictEqual(sfnt.stencilLetterCount(noGlyf), null);
  // scrambled glyph data: a number or null, never an exception
  const caps = Buffer.from(fs.readFileSync(fileOf("unica-one")));
  const glyf = sfnt.tableDirectory(caps).glyf;
  caps.fill(0xff, glyf.offset, glyf.offset + glyf.length);
  [sfnt.unicaseLetterCount(caps), sfnt.stencilLetterCount(caps)].forEach((v) => assert.ok(v === null || Number.isInteger(v)));
  // and a null count never passes a rule
  const fake = { byId: new Map([["x", Object.assign({}, m("unica-one"), { unicaseLetterCount: null, stencilLetterCount: null })]]) };
  assert.match(editorial.measuredClaimProblem({ metric: "unicaseLetterCount", atLeast: 10 }, "x", fake), /fails/);
  assert.match(editorial.measuredClaimProblem({ metric: "stencilLetterCount", atLeast: 15 }, "x", fake), /fails/);
});

test("the vocabulary gains exactly Unicase and Stencil; unknown and deferred terms are still refused", () => {
  assert.strictEqual(Object.keys(editorial.CHARACTERISTICS).length, 45, "43 before Batch 10, plus Unicase and Stencil");
  ["unicase", "stencil"].forEach((t) => assert.ok(editorial.CHARACTERISTICS[t], t));
  ["unicameral", "stencilled", "stencil-cut", "squared", "mufi", "medieval", "low-contrast", "flared", "inscriptional"].forEach((t) => {
    assert.ok(!editorial.CHARACTERISTICS[t], t);
    assert.throws(() => validateFixture("unica-one", evidenced("unica-one", [[t, UP], ["large-glyph-set", FF]])), new RegExp(`"${t}" is not in the vocabulary`), t);
  });
});

test("Batch 10: exactly the validated characteristics, each from the sources that can establish it", () => {
  assert.deepStrictEqual(raw["unica-one"].characteristics, ["unicase", "large-glyph-set"]);
  assert.deepStrictEqual(raw["saira-stencil-one"].characteristics, ["stencil", "alternate-zero", "case-sensitive-forms", "large-glyph-set"]);
  const basesOf = (id, term) => raw[id].evidence.filter((e) => e.for === `characteristics:${term}`).map((e) => e.basis).sort();
  assert.deepStrictEqual(basesOf("unica-one", "unicase"), ["font-file", "upstream-description"]);
  assert.deepStrictEqual(basesOf("saira-stencil-one", "stencil"), ["font-file", "upstream-description"]);
  // Unica One: upstream "condensed" is not claimed — the file's width class reads Normal
  assert.strictEqual(m("unica-one").widthClass, 5);
  assert.ok(!raw["unica-one"].characteristics.includes("condensed") && !raw["unica-one"].characteristics.includes("narrow"));
  // no pairing, no guide: nothing in the library or the guides is specific to either
  BATCH10.forEach((id) => {
    assert.deepStrictEqual(raw[id].pairings, [], id);
    assert.deepStrictEqual(raw[id].relatedGuides, [], id);
    assert.ok(raw[id].notes, id);
  });
});

test("Batch 10 reopens only Unica One and Saira Stencil One; every other exclusion stays out", () => {
  // Stardos Stencil passes the Stencil rule but has one honest Best for term (display-only) and no verified Latin Extended core
  assert.ok(m("stardos-stencil").stencilLetterCount >= 15);
  assert.strictEqual(m("stardos-stencil").coverage.latinExtendedVerified, false);
  // (Monofett was on this list until Batch 11 found upstream evidence for a second characteristic)
  ["stardos-stencil", "benchnine", "berkshire-swash", "caudex", "comic-relief", "caladea", "libertinus-serif",
    "electrolize", "aldrich", "quantico", "architects-daughter", "italiana", "forum", "marcellus", "sofia"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // the approved 182 do not include either Batch 10 family
  const before = PROTOTYPE.slice(0, 182);
  assert.ok(!before.includes("unica-one") && !before.includes("saira-stencil-one"));
});

test("Batch 10 pages show Unicase and Stencil; Major Mono Display still shows All caps", () => {
  const html = (id) => page(withLayer, id);
  assert.match(html("unica-one"), />Unicase</);
  assert.doesNotMatch(html("unica-one"), />All caps</);
  assert.match(html("saira-stencil-one"), />Stencil</);
  assert.match(html("major-mono-display"), />All caps</);
  assert.doesNotMatch(html("major-mono-display"), />Unicase</);
});

// ---------------------------------------------------------------------
// Batch 11: Monofett — all caps measured, display face stated upstream
// ---------------------------------------------------------------------

const BATCH11 = ["monofett"];

test("the 184 approved records are pinned: any edit to Batches 1–10 fails here", () => {
  const crypto = require("crypto");
  const approved = Object.keys(raw).slice(0, 184).map((k) => [k, raw[k]]);
  assert.strictEqual(
    crypto.createHash("sha256").update(JSON.stringify(approved)).digest("hex"),
    "05e7851bebc5772d89981ef8e5f45a8628f6b35ce0913fc93bb0e58615e10d72",
  );
  assert.deepStrictEqual(Object.keys(raw).slice(184), BATCH11, "Batch 11 follows Batch 10, in declaration order");
  assert.deepStrictEqual(PROTOTYPE.slice(184), BATCH11, "site.config declares Batch 11 in the same order");
});

test("Batch 11: Monofett claims exactly what the file and upstream establish, and nothing its Monospace filing suggests", () => {
  const rec = raw.monofett;
  assert.deepStrictEqual(rec.characteristics, ["all-caps", "display-face"]);
  assert.deepStrictEqual(rec.bestFor, ["all-caps-titles", "tabular-data", "latin-extended-text"]);
  const basesOf = (claim) => rec.evidence.filter((e) => e.for === claim).map((e) => e.basis);
  assert.deepStrictEqual(basesOf("characteristics:all-caps"), ["font-file"]);
  assert.deepStrictEqual(basesOf("characteristics:display-face"), ["upstream-description"]);
  assert.deepStrictEqual(basesOf("bestFor:tabular-data"), ["font-file"]);
  // filed as monospace, but the ASCII advances differ: never Monospaced
  assert.strictEqual(model.fonts.find((f) => f.id === "monofett").category, "monospace");
  assert.strictEqual(m("monofett").asciiMonospaced, false);
  assert.strictEqual(m("monofett").lowercaseForm, "caps");
  assert.strictEqual(m("monofett").tabularFigures, true);
  assert.ok(!m("monofett").features.includes("tnum"), "tabular by default, not through tnum");
  // a–z are capitals, so no lowercase width (the Graduate precedent), and no unicase reading
  ["monospaced", "wide-lowercase", "unicase", "technical"].forEach((t) => assert.ok(!rec.characteristics.includes(t), t));
  assert.strictEqual(m("monofett").unicaseLetterCount, 0);
  assert.deepStrictEqual(rec.pairings, []);
  assert.deepStrictEqual(rec.relatedGuides, []);
  assert.ok(rec.notes);
});

test("Batch 11 adds only Monofett; the other reviewed families and every earlier exclusion stay out", () => {
  // reviewed with Monofett: no second characteristic upstream
  ["creepster", "titillium-web", "proza-libre"].forEach((id) => assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  ["stardos-stencil", "benchnine", "berkshire-swash", "caudex", "comic-relief", "caladea", "libertinus-serif",
    "electrolize", "aldrich", "quantico", "architects-daughter", "italiana", "forum", "marcellus", "sofia"].forEach((id) =>
    assert.ok(!raw[id] && !PROTOTYPE.includes(id), id));
  // Black Ops One is unchanged: it still does not claim Stencil
  assert.ok(!raw["black-ops-one"].characteristics.includes("stencil"));
});

test("Batch 11 page shows All caps and Display face, never Monospaced", () => {
  const html = page(withLayer, "monofett");
  assert.match(html, />All caps</);
  assert.match(html, />Display face</);
  assert.doesNotMatch(html, />Monospaced</);
});
