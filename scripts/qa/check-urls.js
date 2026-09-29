#!/usr/bin/env node
/**
 * check-urls.js — diffs the current URL surface against the approved
 * baseline and fails on anything that is not explicitly allowlisted.
 *
 *     npm run build && npm run snapshot && npm run check:urls
 *
 * The tool scripts/qa/snapshot.js said Phase 2 would add. It compares:
 *
 *   pages           file, public URL and declared <link rel="canonical">
 *   dataEndpoints   the JSON the running site fetches
 *   siteFiles       robots.txt, sitemap.xml, ads.txt, og-image.png
 *   assets          images
 *   code            every .js/.css the browser loads
 *
 * A URL appearing, vanishing, or changing its canonical is the single
 * loudest signal that a change did more than it claimed.
 *
 * PHASE 4 STEP 2D — BASELINE PROMOTED, ALLOWLIST EMPTY
 *
 * Through Step 1 this measured against the frozen Phase 3 baseline with all
 * 53 token URLs enumerated in ALLOWED_REMOVED. That was right while removal
 * was being judged: the evidence that it removed only what it claimed is the
 * diff against what shipped before, not against a baseline the same change
 * rewrote.
 *
 * Token removal has now been reviewed and approved, so that arrangement has
 * done its job and has been retired — exactly as the candidate baseline's own
 * README said it would be. BASELINE points at the approved post-removal
 * surface and ALLOWED_REMOVED is empty.
 *
 * WHY THAT MATTERS RATHER THAN BEING BOOKKEEPING
 *
 * A non-empty allowlist weakens this gate for every later change, in two
 * ways. It compares against a 142-URL surface that no longer exists, so a
 * later removal is diffed against stale data. And 53 named URLs are exempt
 * from the "nothing moved" assertion, so the gate's headline result is
 * "nothing moved except these 53" — which is not the same sentence, and gets
 * weaker every time a phase adds to it. Emptying it restores the gate to
 * meaning what it says.
 *
 * The next phase that intends a URL change fills ALLOWED_ADDED or
 * ALLOWED_REMOVED for exactly that change, and empties it again on approval.
 *
 * LIMIT OF THIS GATE, worth knowing before trusting it: it can only diff URLs
 * some bucket in scripts/qa/snapshot.js names. Until Step 2D two published
 * files were named by none, so this gate reported "nothing moved" while they
 * left dist/ (see Step 2C). snapshot.js now refuses to record an
 * unclassified file, which is what makes this gate's silence meaningful.
 *
 * The two provenance fields (generatedBy, phase) differ between baseline
 * and current by design and are not compared.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const config = require(path.join(REPO, "site.config.js"));

// Read from site.config.js rather than a literal path: Step 2D moved this
// directory, and a gate that hard-codes where its own baseline lives is a
// gate that silently measures the wrong thing after the next promotion.
const BASELINE = path.join(config.paths.baseline, "url-snapshot.json");
const CURRENT = path.join(config.paths.qa, "url-snapshot.json");

/**
 * URLs this phase is approved to ADD. Empty again, and that is the point —
 * see "BASELINE PROMOTED, ALLOWLIST EMPTY" in this file's header, which
 * applies to this list for exactly the reasons it gives for the other one.
 *
 * PHASE 4 STEP 10 — COLOR LIBRARY held fifteen entries here while its URL change was
 * under review, in two groups:
 *
 *   4  the Color Library itself — /colors, /colors/colors-data.json,
 *      /colors/colors.css, /colors/colors.js.
 *  11  .webp thumbnails that were already in the working tree when Step 10
 *      started: the in-progress half of a PNG -> WebP conversion that this
 *      change did not make and did not finish. They were named rather than
 *      allowed to ride along unnamed inside a count, because this gate
 *      cannot tell "added by the change under review" from "added before
 *      it" — it only diffs the baseline.
 *
 * The gate ran with that list and reported what it was there to prove: 15
 * approved additions, 0 removals, nothing else moved, every surviving page's
 * canonical unchanged. The baseline was then re-recorded at 104 URLs / 42
 * pages, so those fifteen are not "additions to excuse" any more — they are
 * simply part of what this gate now measures against, and the list empties.
 *
 * STEP 10 ALSO FIXED THIS LIST'S ARITHMETIC. Populating it used to fail the
 * counts check below no matter what, because that check reconciled approved
 * removals and not approved additions. See `addedByKey` in main().
 *
 * IMAGE PICKER held three entries here while its URL change was under
 * review — the page itself (/image-picker) and its two page-specific
 * assets (/image-picker/image-picker.js, /image-picker/image-picker.css),
 * the same shape as the Color Library's colors.js/colors.css pair, with no
 * data endpoint because this page's palette comes from whatever image the
 * visitor picks, extracted client-side, not from a fetched JSON file. The
 * baseline was re-recorded at 107 URLs / 43 pages, so those three are not
 * "additions to excuse" any more, and the list empties, exactly as Step 10
 * left it.
 *
 * IMAGE PICKER — STANDBY PHOTO held one entry here while under review:
 * /image-picker/assets/standby.jpg, the local photograph the page loads
 * and extracts its initial palette from before any upload. Classified by
 * snapshot.js's existing `assets` bucket (its extension filter already
 * covers .jpg — no bucket change needed). The gate confirmed it was the
 * only addition — 108 URLs, 1 approved addition, nothing else moved — so
 * the baseline was re-recorded and the list empties again.
 *
 * ICON PACKS (Phase 1) held 103 entries here while its URL change was under
 * review — every one under /icons: 5 pages (/icons and one /icons/<pack>.html
 * per pack), 2 code files (/icons/icons.css, /icons/icons.js), 42 SVG sources,
 * 47 PNGs and 7 pack ZIPs. The gate confirmed they were the only additions —
 * 0 removed, nothing else moved, every surviving canonical unchanged — so the
 * baseline was re-recorded at 1831 URLs / 249 pages and the list empties again.
 *
 * FONTS TO 250 (Batch 1 of the 500-family expansion) held 240 entries here
 * while its URL change was under review — every one under /fonts: 50 detail
 * pages (/fonts/<id>.html) and 190 assets (each new family's original TTFs,
 * WOFF2 previews where its license allows them, OFL.txt and download ZIP).
 * The gate confirmed they were the only additions — 0 removed, nothing else
 * moved, every surviving canonical unchanged — so the baseline was
 * re-recorded at 2071 URLs / 299 pages and the list empties again.
 *
 * FONTS TO 300 (Batch 2 of the 500-family expansion) held 260 entries here
 * while its URL change was under review — every one under /fonts: 50 detail
 * pages (/fonts/<id>.html) and 210 assets (each new family's original TTFs,
 * WOFF2 previews where its license allows them, OFL.txt and download ZIP).
 * The gate confirmed they were the only additions — 0 removed, nothing else
 * moved, every surviving canonical unchanged — so the baseline was
 * re-recorded at 2331 URLs / 349 pages and the list empties again.
 *
 * /hoysomrach held one entry here while under review: the founder's personal
 * page, a hand-authored root page served extensionless. It reuses
 * /assets/founder-somrach-hoy.jpg, already published, so it adds no asset.
 * The gate confirmed it was the only addition — 0 removed, nothing else
 * moved, every surviving canonical unchanged — so the baseline was
 * re-recorded at 2332 URLs / 350 pages and the list empties again.
 *
 * ICONS TO 95 (first-party expansion) held 96 entries here while its URL
 * change was under review — every one under /icons: 48 new original BPOZZ
 * icons (40 outline, 4 solid, 4 duotone), each an SVG source and its PNG.
 * No page was added: the pages and ZIPs that changed were already in the
 * baseline. The gate confirmed they were the only additions — 0 removed,
 * nothing else moved, every surviving canonical unchanged — so the baseline was
 * re-recorded at 2428 URLs / 350 pages and the list empties again.
 *
 * 404 PAGE — one page added: /404.html, the not-found page Netlify serves
 * for any missing path. Listed here so the gate can prove it is the only
 * URL added; empty the list again once the baseline is re-recorded.
 *
 * /account held one entry here while under review: Profile, Saved and
 * Settings for a signed-in visitor, the header account menu's destinations —
 * a hand-authored root page served extensionless, noindex, adding no asset
 * or code file. The gate confirmed it was the only addition — 0 removed,
 * nothing else moved, every surviving canonical unchanged — so the baseline
 * was re-recorded at 2431 URLs / 352 pages and the list empties again.
 *
 * /saved.js held one entry here while under review: the browser half of
 * account Saved (Saved Phase 2, M1), published standalone for /account and
 * bundled into /app.js, shipping dormant. It adds no page. The gate
 * confirmed it was the only addition — 0 removed, nothing else moved, every
 * surviving canonical unchanged — so the baseline was re-recorded at 2432
 * URLs / 352 pages and the list empties again.
 */
const ALLOWED_ADDED = [];

/**
 * Pages that intentionally declare no <link rel="canonical">. Only the 404
 * page: it is noindex and served at whatever URL was missing, so a
 * canonical would be wrong. Every other page must still declare one.
 */
const NO_CANONICAL_BY_DESIGN = new Set(["/404.html"]);

/**
 * URLs this phase is approved to REMOVE. Empty, and that is the point —
 * see "BASELINE PROMOTED, ALLOWLIST EMPTY" in this file's header.
 *
 * Step 1 carried all 53 Colour Token URLs here while removal was under
 * review. They are gone from this list because the post-removal surface is
 * now the baseline: those URLs are not "removals to excuse", they simply do
 * not exist in what this gate compares against.
 *
 * HOW TO USE THIS LIST
 *
 * A change that intends to move a URL enumerates it here — one entry per
 * URL, never a pattern, so the diff a reviewer reads is the exact list and
 * an unintended URL cannot be swallowed alongside an intended one. On
 * approval the baseline is re-recorded and this list empties again.
 *
 * Step 2C is the counter-example worth remembering: it withdrew two
 * published files and needed no entry here, because neither was named by
 * any bucket in snapshot.js and so neither was ever in this baseline. An
 * allowlist can only excuse what the snapshot can see.
 */
const ALLOWED_REMOVED = [];

const LISTS = ["dataEndpoints", "siteFiles", "assets", "code"];

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    console.error(`✗ ${label} not found at ${path.relative(REPO, file)}`);
    if (file === CURRENT) console.error("  run 'npm run build && npm run snapshot' first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function diffSets(baseline, current) {
  const b = new Set(baseline);
  const c = new Set(current);
  return {
    added: current.filter((x) => !b.has(x)),
    removed: baseline.filter((x) => !c.has(x)),
  };
}

function main() {
  const base = readJson(BASELINE, "approved baseline");
  const now = readJson(CURRENT, "current snapshot");

  const problems = [];
  const allowedAdd = new Set(ALLOWED_ADDED);
  const allowedRemove = new Set(ALLOWED_REMOVED);

  // ---- pages: URL set, and the canonical/file each URL maps to ----------
  const baseByUrl = new Map(base.pages.map((p) => [p.url, p]));
  const nowByUrl = new Map(now.pages.map((p) => [p.url, p]));

  // Per-category tallies of the additions and removals the allowlist
  // accounted for, so the counts check below can reconcile baseline ->
  // current arithmetically instead of hard-coding the new numbers (which
  // would assert nothing). With an empty allowlist every tally stays 0 and
  // the counts must match the baseline exactly.
  //
  // PHASE 4 STEP 10 — `addedByKey` IS NEW, AND THE GATE WAS BROKEN WITHOUT IT
  //
  // The removal side has always reconciled. The addition side did not: the
  // counts loop below subtracted approved removals and nothing else, so a
  // run with a populated ALLOWED_ADDED passed every set diff and then failed
  // on `count CHANGED` for each affected bucket. ALLOWED_ADDED had been
  // empty since it was written, so nothing ever exercised it, and the first
  // change to add a URL — this one — is what found it.
  //
  // The fix is symmetry, not a loosening: an approved addition now counts
  // for exactly as much as an approved removal, so the arithmetic still says
  // "the surface moved by precisely what the allowlist enumerates and by
  // nothing else". A page quietly added while another was quietly removed
  // still fails here, which is the property the counts check exists for.
  const zeroes = () => ({
    pages: 0,
    dataEndpoints: 0,
    siteFiles: 0,
    assets: 0,
    code: 0,
  });
  const removedByKey = zeroes();
  const addedByKey = zeroes();

  const pageDiff = diffSets([...baseByUrl.keys()], [...nowByUrl.keys()]);
  pageDiff.added.forEach((u) => {
    if (allowedAdd.has(u)) addedByKey.pages += 1;
    else problems.push(`page ADDED      ${u}`);
  });
  pageDiff.removed.forEach((u) => {
    if (allowedRemove.has(u)) removedByKey.pages += 1;
    else problems.push(`page REMOVED    ${u}`);
  });

  for (const [url, basePage] of baseByUrl) {
    const nowPage = nowByUrl.get(url);
    if (!nowPage) continue;
    if (basePage.canonical !== nowPage.canonical) {
      problems.push(
        `canonical CHANGED  ${url}\n    was: ${basePage.canonical}\n    now: ${nowPage.canonical}`,
      );
    }
    if (basePage.file !== nowPage.file) {
      problems.push(
        `served-from CHANGED ${url}\n    was: ${basePage.file}\n    now: ${nowPage.file}`,
      );
    }
  }

  // ---- the four flat URL lists ----------------------------------------
  for (const list of LISTS) {
    const { added, removed } = diffSets(base[list], now[list]);
    added.forEach((u) => {
      if (allowedAdd.has(u)) addedByKey[list] += 1;
      else problems.push(`${list} ADDED      ${u}`);
    });
    removed.forEach((u) => {
      if (allowedRemove.has(u)) removedByKey[list] += 1;
      else problems.push(`${list} REMOVED    ${u}`);
    });
  }

  const present = (u) => nowByUrl.has(u) || LISTS.some((l) => now[l].includes(u));

  // Every allowlisted URL must actually be gone. A stale allowlist entry
  // would otherwise quietly widen what a future run is permitted to drop.
  const stillPresent = ALLOWED_REMOVED.filter(present);
  stillPresent.forEach((u) =>
    problems.push(`allowlisted-but-PRESENT  ${u} — remove it from ALLOWED_REMOVED`),
  );

  // And the mirror of it, new in Step 10 alongside addedByKey: every URL the
  // allowlist permits to appear must actually have appeared. A leftover
  // entry here is worse than untidy — it is standing permission for a future
  // run to introduce that exact URL without anyone reviewing it.
  const neverArrived = ALLOWED_ADDED.filter((u) => !present(u));
  neverArrived.forEach((u) =>
    problems.push(`allowlisted-but-ABSENT   ${u} — remove it from ALLOWED_ADDED`),
  );

  // ---- counts -----------------------------------------------------------
  // Each count must equal the baseline, plus exactly the additions and minus
  // exactly the removals the allowlist accounted for. A count that moved for
  // any other reason — a page quietly added and another removed, say — fails
  // here even though the set diffs above balanced out.
  const total = (tally) =>
    Object.keys(tally).reduce((sum, k) => sum + tally[k], 0);
  removedByKey.total = total(removedByKey);
  addedByKey.total = total(addedByKey);

  for (const key of Object.keys(base.counts)) {
    const removed = removedByKey[key] || 0;
    const added = addedByKey[key] || 0;
    const expected = base.counts[key] + added - removed;
    if (now.counts[key] !== expected) {
      problems.push(
        `count CHANGED   ${key}: ${base.counts[key]} -> ${now.counts[key]} ` +
          `(expected ${expected} after ${added} approved addition(s) and ` +
          `${removed} approved removal(s))`,
      );
    }
  }

  const noCanonical = now.pages.filter((p) => !p.canonical);
  const baseNoCanonical = new Set(
    base.pages.filter((p) => !p.canonical).map((p) => p.url),
  );
  noCanonical
    .filter((p) => !baseNoCanonical.has(p.url) && !NO_CANONICAL_BY_DESIGN.has(p.url))
    .forEach((p) => problems.push(`canonical MISSING  ${p.url}`));

  console.log(
    `URL surface — baseline ${base.counts.total} URLs, current ${now.counts.total} URLs ` +
      `(${removedByKey.total} approved removal(s), ${addedByKey.total} approved addition(s))`,
  );

  if (problems.length) {
    console.error(`\n✗ ${problems.length} unapproved URL difference(s):\n`);
    problems.forEach((p) => console.error(`  ${p}`));
    process.exit(1);
  }

  console.log(
    `✓ as approved — ${now.counts.pages} pages, ${now.counts.dataEndpoints} data endpoints, ` +
      `${now.counts.siteFiles} site files, ${now.counts.assets} assets, ${now.counts.code} code files`,
  );
  console.log(
    ALLOWED_REMOVED.length === 0 && ALLOWED_ADDED.length === 0
      ? "✓ no URL added or removed — the allowlist is empty and nothing needed it"
      : `✓ all ${removedByKey.total} removed and ${addedByKey.total} added URLs were allowlisted, and nothing else moved`,
  );
  console.log("✓ every surviving page canonical unchanged");
}

main();
