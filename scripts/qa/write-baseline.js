#!/usr/bin/env node
/**
 * write-baseline.js — records the current .qa/ snapshot as THE baseline.
 *
 *     npm run build && npm run snapshot
 *     BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline
 *
 * Writes scripts/qa/baseline/{url-snapshot,html-checksums}.json.
 *
 * PHASE 4 STEP 2D — RETARGETED
 *
 * This was write-candidate-baseline.js, writing to a separate candidate
 * directory while token removal was under review. That review passed and
 * Step 2D promoted the candidate, so there is one baseline again and this
 * tool writes to it. The candidate mechanism is not gone — it is just not
 * standing: a future phase that changes the surface records a candidate the
 * same way Step 1 did (a second directory plus an allowlist in
 * check-urls.js) and promotes it the same way Step 2D did.
 *
 * THREE THINGS THIS DELIBERATELY WILL NOT DO
 *
 *   1. Run without BPOZZ_WRITE_BASELINE=1. Recording a baseline blesses
 *      whatever happens to be built right now, which is exactly how a
 *      regression gets approved by accident. It takes an explicit act.
 *   2. Overwrite archived phase evidence. The guard below refuses any
 *      output path that looks like an archive (…-phase<N>) or that resolves
 *      to paths.baselinePhase3. Evidence of what shipped before is not a
 *      thing a later phase gets to rewrite.
 *   3. Claim the result is reviewed. It records; a human reviews. The diff
 *      this produces is the review material, not its conclusion.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const config = require(path.join(REPO, "site.config.js"));

const QA_DIR = config.paths.qa;
const OUT_DIR = config.paths.baseline;
const FILES = ["url-snapshot.json", "html-checksums.json"];

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (process.env.BPOZZ_WRITE_BASELINE !== "1") {
  die(
    "refusing to write a baseline without BPOZZ_WRITE_BASELINE=1.\n" +
      "    Recording a baseline blesses whatever is currently built, so it is\n" +
      "    never a side effect of another command. Re-run as:\n\n" +
      "        BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline",
  );
}

// Archived phase evidence is never a write target — by explicit path, and
// by naming convention, so a future `baseline-phase5/` is protected without
// anyone remembering to add it here.
if (path.resolve(OUT_DIR) === path.resolve(config.paths.baselinePhase3)) {
  die(
    "paths.baseline resolves to the archived Phase 3 evidence.\n" +
      "    That directory records what shipped before token removal and is\n" +
      "    never overwritten. Check paths.baseline in site.config.js.",
  );
}
if (/-phase\d+$/.test(path.basename(path.resolve(OUT_DIR)))) {
  die(
    `paths.baseline points at "${path.basename(path.resolve(OUT_DIR))}", which is\n` +
      "    an archived-phase directory by naming convention. Archived evidence is\n" +
      "    never a write target. The active baseline lives at scripts/qa/baseline/.",
  );
}

fs.mkdirSync(OUT_DIR, { recursive: true });

FILES.forEach((name) => {
  const src = path.join(QA_DIR, name);
  if (!fs.existsSync(src)) {
    die(`${path.relative(REPO, src)} missing — run 'npm run snapshot' first.`);
  }
  const data = JSON.parse(fs.readFileSync(src, "utf8"));
  data.phase = "phase4-step10";
  data.status =
    "RECORDED by an explicit BPOZZ_WRITE_BASELINE=1 run — the diff is the review, not this field";
  data.generatedBy = "scripts/qa/snapshot.js (recorded as the baseline)";
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    JSON.stringify(data, null, 2) + "\n",
    "utf8",
  );
  console.log(`✓ ${path.relative(REPO, path.join(OUT_DIR, name))}`);
});

console.log("");
console.log("  Baseline recorded. Recording is not reviewing —");
console.log("  read the diff before committing it.");
