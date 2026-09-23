#!/usr/bin/env node
/**
 * check-baseline.js — the rest of the gate.
 *
 *     npm run build && npm run snapshot && npm run check:baseline
 *
 * Five questions, each of which would otherwise be answered by eye:
 *
 *   1. HTML  — does every page in dist/ md5 to the same value it has in the
 *              approved baseline? Any difference is listed by file; none are
 *              summarised away.
 *   2. INDEX — does content-index.json hold every guide and every palette
 *              (site.config.js contentIndex.expected), with palette records
 *              p001..p{count} in data order so search covers all of them,
 *              and is it byte-identical to the committed file?
 *   3. PALETTES — are all palettes still present, p001..p{count} per
 *              site.config.js, with the published data byte-identical to
 *              source?
 *   4. GUIDES — 22 guides, and every one of them has a page in dist/.
 *   5. ARCHIVED — is the Phase 3 evidence still exactly as recorded? A
 *              promotion renames it; nothing may edit or delete it.
 *
 * PHASE 4 STEP 2D — THE CANDIDATE BASELINE IS GONE
 *
 * Token removal deliberately changed the page set (84 -> 41) and the header
 * of every surviving page, so every checksum in the Phase 3 baseline was
 * expected to differ. Checking against it would have failed 41 times and
 * told a reviewer nothing. So Step 1 recorded the post-removal surface as a
 * separate CANDIDATE baseline and left the Phase 3 files untouched beside
 * it, and check-urls.js carried the proof that only token URLs went away.
 *
 * That review passed. Step 2D promoted the candidate: it is now simply the
 * baseline, at config.paths.baseline, and the Phase 3 files it sat beside
 * were renamed to baseline-phase3/ and approved-output-phase3.json. The
 * rename changed no bytes — the three sha256s in FROZEN_SHA256 below are the
 * same values they were before the move, which is the proof.
 *
 * There is no candidate baseline any more, and no "is the candidate a
 * separate directory" check: with one baseline there is nothing to confuse
 * it with. The next phase that needs a candidate records one the same way
 * Step 1 did, and promotes it the same way Step 2D did.
 *
 * This tool only reads. It never repairs anything it finds.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..", "..");
const config = require(path.join(REPO, "site.config.js"));

const BASELINE_CHECKSUMS = path.join(
  config.paths.baseline,
  "html-checksums.json",
);
const CURRENT_CHECKSUMS = path.join(config.paths.qa, "html-checksums.json");
const DIST = config.paths.dist;

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`✗ ${message}`);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    console.error(`✗ ${label} not found at ${path.relative(REPO, file)}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function md5(file) {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

// ---------------------------------------------------------------------
// 1. HTML checksums
// ---------------------------------------------------------------------

function checkHtml() {
  console.log("\nHTML checksums");
  if (!fs.existsSync(BASELINE_CHECKSUMS)) {
    fail(
      `no approved baseline at ${path.relative(REPO, BASELINE_CHECKSUMS)}.\n` +
        "    Record it once with: BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline",
    );
    return;
  }
  const base = readJson(BASELINE_CHECKSUMS, "approved baseline").files;
  const now = readJson(CURRENT_CHECKSUMS, "current checksums").files;

  const baseKeys = Object.keys(base);
  const nowKeys = Object.keys(now);

  const missing = baseKeys.filter((f) => !(f in now));
  const added = nowKeys.filter((f) => !(f in base));
  const changed = baseKeys.filter((f) => f in now && base[f] !== now[f]);

  missing.forEach((f) => fail(`HTML missing from dist/: ${f}`));
  added.forEach((f) => fail(`HTML not in the approved baseline: ${f}`));
  changed.forEach((f) =>
    fail(`HTML changed: ${f}\n    baseline ${base[f]}\n    current  ${now[f]}`),
  );

  if (!missing.length && !added.length && !changed.length) {
    ok(`${baseKeys.length} pages byte-identical to the approved baseline`);
  }
  if (baseKeys.length !== config.expected.htmlPages) {
    fail(
      `baseline holds ${baseKeys.length} pages, config expects ${config.expected.htmlPages}`,
    );
  }
}

// ---------------------------------------------------------------------
// 2. content-index
// ---------------------------------------------------------------------

function checkContentIndex() {
  console.log("\ncontent-index.json");
  const built = path.join(DIST, config.contentIndex.output);
  if (!fs.existsSync(built)) {
    fail("dist/content-index.json missing — run 'npm run build' first");
    return;
  }

  const records = readJson(built, "built content-index");
  const want = config.contentIndex.expected;

  const counts = { guides: 0, palettes: 0 };
  records.forEach((r) => {
    if (r.type === "guide") counts.guides += 1;
    else if (r.type === "palette") counts.palettes += 1;
    else fail(`unknown record type "${r.type}" on ${r.id}`);
  });

  // No token records may survive anywhere in the index.
  const tokenRecords = records.filter(
    (r) => r.type === "token" || String(r.id).startsWith("token:"),
  );
  if (tokenRecords.length) {
    fail(`${tokenRecords.length} token record(s) still in content-index.json`);
  } else {
    ok("no token records");
  }

  if (records.length !== want.total) {
    fail(`content-index has ${records.length} records, expected ${want.total}`);
  } else {
    ok(`${records.length} records`);
  }

  ["guides", "palettes"].forEach((k) => {
    if (counts[k] !== want[k]) fail(`${counts[k]} ${k}, expected ${want[k]}`);
    else ok(`${counts[k]} ${k}`);
  });

  const ids = records.map((r) => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) fail(`duplicate record ids: ${[...new Set(dupes)].join(", ")}`);

  const indexedPaletteIds = records
    .filter((r) => r.type === "palette")
    .map((r) => r.slug);
  // Search reads this index, so a palette missing from it is a palette
  // nobody can search for. Every id, in order, no gaps.
  const expectedPaletteIds = Array.from({ length: config.palettes.count }, (_, i) =>
    "p" + String(i + 1).padStart(3, "0"),
  );
  const missing = expectedPaletteIds.filter((id, i) => indexedPaletteIds[i] !== id);
  if (missing.length || indexedPaletteIds.length !== expectedPaletteIds.length) {
    fail(
      `indexed palettes are not ${config.palettes.firstId}–${config.palettes.lastId} in order` +
        (missing.length ? ` (first gaps: ${missing.slice(0, 5).join(", ")})` : ""),
    );
  } else {
    ok(`indexed palettes are ${config.palettes.firstId}–${config.palettes.lastId}, in order — search covers every palette`);
  }

  // Byte-identity against the committed copy at the repo root. The repo's
  // standing convention is that committed output equals built output.
  const approved = path.join(REPO, config.contentIndex.output);
  if (fs.existsSync(approved)) {
    if (md5(approved) === md5(built)) {
      ok("byte-identical to the committed content-index.json");
    } else {
      fail(
        "differs from the committed content-index.json — commit the rebuilt file",
      );
    }
  }
}

// ---------------------------------------------------------------------
// 3. palettes
// ---------------------------------------------------------------------

function checkPalettes() {
  console.log("\npalettes");
  const source = config.paths.content.palettes;
  const published = path.join(DIST, "palettes", "palettes-data.json");

  if (!fs.existsSync(published)) {
    fail("dist/palettes/palettes-data.json missing");
    return;
  }
  if (md5(source) !== md5(published)) {
    fail("published palettes-data.json differs from source");
  } else {
    ok("palettes-data.json published byte-identical to source");
  }

  const palettes = readJson(published, "palettes-data.json");
  if (palettes.length !== config.palettes.count) {
    fail(`${palettes.length} palettes, expected ${config.palettes.count}`);
    return;
  }

  const expectedIds = Array.from({ length: config.palettes.count }, (_, i) =>
    "p" + String(i + 1).padStart(3, "0"),
  );
  const actualIds = palettes.map((p) => p.id);
  const wrong = expectedIds.filter((id, i) => actualIds[i] !== id);
  if (wrong.length) {
    fail(`palette id sequence broken at ${wrong.slice(0, 5).join(", ")}`);
  } else {
    ok(`${palettes.length} palettes, ${config.palettes.firstId}–${config.palettes.lastId}, in order`);
  }

  const leaked = palettes.filter(
    (p) => "meta" in p || "tokenSlug" in p || "_twin" in p,
  ).length;
  if (leaked) {
    fail(
      `${leaked} palette record(s) carry a meta/tokenSlug field on disk — ` +
        "meta is attached at load time and must not be written into the data",
    );
  } else {
    ok("no meta or tokenSlug written into palettes-data.json (attached at load time)");
  }

  // palettes-meta.json: the migrated token-derived metadata.
  const meta = readJson(config.paths.content.palettesMeta, "palettes-meta.json");
  // One entry per migrated palette — the approved Phase 3 records, p001–p040.
  // Not the index's palette count: every palette is indexed, and the ones
  // after p040 are indexed from palettes-data.json without a meta entry.
  const want = readJson(
    path.join(REPO, "scripts", "qa", "fixtures", "phase3-palette-records.json"),
    "phase3-palette-records.json",
  ).length;
  if (meta.length !== want) {
    fail(`palettes-meta.json has ${meta.length} entries, expected ${want}`);
  } else {
    ok(`palettes-meta.json has ${meta.length} entries`);
  }

  const metaIds = meta.map((m) => m.id);
  const expectedMetaIds = Array.from({ length: want }, (_, i) =>
    "p" + String(i + 1).padStart(3, "0"),
  );
  const wrongMeta = expectedMetaIds.filter((id, i) => metaIds[i] !== id);
  if (wrongMeta.length) {
    fail(`palettes-meta.json ids broken at ${wrongMeta.slice(0, 5).join(", ")}`);
  } else {
    ok(`palettes-meta.json covers ${expectedMetaIds[0]}–${expectedMetaIds[want - 1]}`);
  }

  const paletteIds = new Set(palettes.map((p) => p.id));
  const orphans = metaIds.filter((id) => !paletteIds.has(id));
  if (orphans.length) {
    fail(`palettes-meta.json entries with no palette: ${orphans.join(", ")}`);
  }

  // palettes-meta.json must carry no colour data — palettes-data.json stays
  // the sole source of palette colours.
  const withColors = meta.filter((m) => "colors" in m || "hex" in m).length;
  if (withColors) {
    fail(`${withColors} palettes-meta.json entry/entries carry colour data`);
  } else {
    ok("palettes-meta.json carries no colour data");
  }
}

// ---------------------------------------------------------------------
// 4. guides and their pages
// ---------------------------------------------------------------------

function checkPages() {
  console.log("\npages");
  const guides = readJson(config.paths.content.guides, "guides.json");
  const categories = readJson(config.paths.content.categories, "categories.json");

  const missing = [];
  guides.forEach((g) => {
    const f = path.join(DIST, "guide", `${g.id}.html`);
    if (!fs.existsSync(f)) missing.push(`guide/${g.id}.html`);
  });
  categories.forEach((c) => {
    const f = path.join(DIST, "category", `${c.slug}.html`);
    if (!fs.existsSync(f)) missing.push(`category/${c.slug}.html`);
  });

  if (missing.length) missing.forEach((f) => fail(`missing page: ${f}`));
  else
    ok(`${guides.length} guide and ${categories.length} category pages present`);

  // Nothing under tokens/ may be published.
  const tokensDir = path.join(DIST, "tokens");
  if (fs.existsSync(tokensDir)) {
    fail("dist/tokens/ still exists");
  } else {
    ok("no dist/tokens/ directory");
  }
}

// ---------------------------------------------------------------------
// 5. archived Phase 3 evidence
// ---------------------------------------------------------------------

/**
 * The Phase 3 baseline and its output manifest are the record of what
 * shipped before token removal. Nothing may edit or delete them.
 *
 * THE PATHS MOVED IN STEP 2D; THE BYTES DID NOT.
 *
 * Promotion renamed baseline/ -> baseline-phase3/ and approved-output.json
 * -> approved-output-phase3.json, so the current surface could take the
 * unsuffixed names. The three sha256s below are UNCHANGED from what this
 * table held before that rename. That is deliberate and it is the proof:
 * if a promotion had rewritten, truncated or regenerated the evidence
 * instead of moving it, these would not still match.
 *
 * A NOTE ON PROVENANCE, resolved in Step 2D
 *
 * This table used to describe itself as "the sha256s of those files as
 * committed at phase4-step1 (8a29c00)", while the approved Step 1 baseline
 * was commit 6f4a963. Nothing in the build ever resolved either hash — the
 * commit id was a comment, and the file contents are what is actually
 * checked. Rather than pick one unverifiable commit id over another, the
 * reference is dropped: the sha256s below are self-verifying and are
 * re-checked on every `npm run check:baseline`, which is a stronger claim
 * than any commit id in a comment.
 */
const FROZEN_SHA256 = {
  "scripts/qa/baseline-phase3/html-checksums.json": "c39f28dd1a109e5fa215d34b3e75464845d72de349a61fec4c5c669140befe6b",
  "scripts/qa/baseline-phase3/url-snapshot.json": "2a491c375a460ad3d96d4c358f9e81fa0ea73632efd9e186ea425db0cad3b2d6",
  "scripts/qa/approved-output-phase3.json": "8cead33b165728785c3b62ed9fbce06e13796bf991ceeb5d2324b7a845ac6328",
};

function checkFrozen() {
  console.log("\narchived Phase 3 evidence");
  let allOk = true;
  Object.keys(FROZEN_SHA256).forEach((rel) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      fail(`archived evidence DELETED: ${rel}`);
      allOk = false;
      return;
    }
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(abs))
      .digest("hex");
    if (actual !== FROZEN_SHA256[rel]) {
      fail(
        `archived evidence MODIFIED: ${rel}\n    expected ${FROZEN_SHA256[rel]}\n    actual   ${actual}`,
      );
      allOk = false;
    }
  });
  if (allOk) {
    ok(
      `${Object.keys(FROZEN_SHA256).length} Phase 3 evidence files unchanged ` +
        `(same sha256s as before the Step 2D rename)`,
    );
  }

  // The archive and the active baseline must stay distinct artifacts. If a
  // future promotion ever points them at the same directory, the evidence
  // becomes the thing it is supposed to be evidence about.
  if (
    path.resolve(config.paths.baselinePhase3) ===
    path.resolve(config.paths.baseline)
  ) {
    fail(
      "paths.baselinePhase3 and paths.baseline resolve to the same directory — " +
        "the archive would be overwritten by the next promotion",
    );
  } else {
    ok("archived evidence is a separate directory from the active baseline");
  }
}

// ---------------------------------------------------------------------

function main() {
  console.log("bpozz baseline gate");
  checkHtml();
  checkContentIndex();
  checkPalettes();
  checkPages();
  checkFrozen();

  console.log("");
  if (failures) {
    console.error(`✗ ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✓ all baseline checks passed");
}

main();
