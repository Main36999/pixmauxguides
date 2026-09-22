/**
 * site.config.js — the one place the build reads its configuration from.
 *
 * Phase 2 of the bpozz architecture migration. Nothing in here changes what
 * the site renders; it only names, in one file, the values that were
 * previously hard-coded across six separate builders.
 *
 * Every value below is transcribed from the existing site, not chosen.
 * Where a number is a contract the Phase 2 gate checks (record counts,
 * page counts), it is marked CONTRACT and `scripts/qa/check-baseline.js`
 * fails the build if reality disagrees.
 */

"use strict";

const path = require("path");

const ROOT = __dirname;

module.exports = {
  /** Canonical origin. Matches every <link rel="canonical"> already on disk. */
  origin: "https://bpozz.com",

  paths: {
    root: ROOT,

    /**
     * Content sources.
     *
     * PHASE 2 NOTE: these still point at the legacy locations. The target
     * architecture moves them under content/ — that is Phase 3 content
     * extraction, explicitly out of Phase 2 scope. This table is the seam:
     * Phase 3 edits these five paths and nothing else in the pipeline needs
     * to know.
     */
    content: {
      guides: path.join(ROOT, "guides.json"),
      palettes: path.join(ROOT, "palettes", "palettes-data.json"),
      /**
       * PHASE 4 TOKEN REMOVAL: palettes p001–p040 used to borrow their
       * identity and search metadata from a twin token record in
       * tokens.json, matched by hex. Tokens are gone, so that metadata now
       * lives in its own file, migrated verbatim and round-trip verified
       * against the approved content-index palette records.
       *
       * It carries no colour data — palettes-data.json remains the sole
       * source of palette colours and is not modified.
       */
      palettesMeta: path.join(ROOT, "palettes", "palettes-meta.json"),

      /**
       * PHASE 4 STEP 10 — COLOR LIBRARY
       *
       * The single source of truth for /colors: a flat array of
       * { id, name, hex, category }. One record is one card.
       *
       * It is a SEPARATE file from palettes-data.json and deliberately so.
       * The two describe different things — four colours that belong
       * together against one colour that stands alone — and the palette data
       * is under a byte-identity gate that no new feature is allowed to
       * disturb. The colour set is DERIVED from the palette colours (see
       * docs/archive/generate-colors.js), but the derivation ran once and
       * its output is committed; the build never reads one to produce the
       * other.
       */
      colors: path.join(ROOT, "colors", "colors-data.json"),

      categories: path.join(ROOT, "categories.json"),
      resourceTypes: path.join(ROOT, "resource-types.json"),
      /**
       * PHASE 4 STEP 4 — TEMPLATE MIGRATION
       *
       * The guide pages' own content, extracted out of the 22 hand-authored
       * guide/*.html files: `pages.json` (one structural record per page)
       * plus one content/guide/<slug>.html per guide carrying the six
       * template slots. The page STRUCTURE that used to be copied into all
       * 22 of those files now lives once, in src/build/guide-template.js.
       *
       * This is the first entry in this table to point at content/ — the
       * location the Phase 2 note above names as the target for all of them.
       */
      guidePages: path.join(ROOT, "content", "guide"),
    },

    src: path.join(ROOT, "src"),
    shared: path.join(ROOT, "src", "shared"),
    client: path.join(ROOT, "src", "client"),
    styles: path.join(ROOT, "src", "styles"),
    tools: path.join(ROOT, "scripts", "qa"),

    /**
     * THE approved baseline. Read-only to the build; rewritten only by an
     * explicit `BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline`.
     *
     * PHASE 4 STEP 2D — PROMOTION
     *
     * This was `baseline-phase4-candidate/` until Step 2D. Token removal was
     * reviewed and approved, so the post-removal surface (41 pages, 89 URLs)
     * is now the baseline the gates measure against, and the dual-baseline
     * state Step 1 created is gone.
     *
     * The convention this establishes, for every phase after this one:
     *
     *   baseline/            the current approved surface — always this path
     *   baseline-phase<N>/   an earlier approved surface, kept as evidence
     *
     * A promotion renames, it never deletes: `baseline-phase3/` below holds
     * the pre-removal surface byte-for-byte, at the same three sha256s it
     * had before the rename (asserted in scripts/qa/check-baseline.js).
     */
    baseline: path.join(ROOT, "scripts", "qa", "baseline"),

    /**
     * Frozen Phase 3 evidence — the 84-page, 142-URL surface that shipped
     * before token removal. Read-only, permanently. Nothing reads it to
     * gate anything; it exists so the removal stays auditable after the
     * baseline moved on. Was `baseline/` until Step 2D.
     */
    baselinePhase3: path.join(ROOT, "scripts", "qa", "baseline-phase3"),

    /**
     * The output gate. sha256 of every file in dist/ as approved. The
     * build's `verify` stage fails on any added, removed or changed file,
     * and this file is rewritten — only — by an explicit
     * `BPOZZ_APPROVE_OUTPUT=1 npm run build` when a change is intended.
     *
     * PHASE 4 STEP 2D: was `approved-output-phase4-candidate.json`; promoted
     * alongside the baseline above. Its Phase 3 predecessor is kept as
     * `approved-output-phase3.json`.
     */
    approvedOutput: path.join(ROOT, "scripts", "qa", "approved-output.json"),

    /** Frozen Phase 3 output manifest. Read-only, permanently. */
    approvedOutputPhase3: path.join(
      ROOT,
      "scripts",
      "qa",
      "approved-output-phase3.json",
    ),

    /** Private staging root. Generated, disposable, never deployed. */
    stage: path.join(ROOT, ".build"),

    /** Generated website. Never hand-edited. */
    dist: path.join(ROOT, "dist"),

    /** QA output. Generated, disposable, never deployed. */
    qa: path.join(ROOT, ".qa"),
  },

  /**
   * F9 — content index contract (Phase 4 token removal).
   *
   * 62 records: 22 guides + 40 indexed palettes. The 40 token records are
   * gone with the feature.
   *
   * All 300 palettes stay available through palettes-data.json; only the
   * 40 that carry a palettes-meta.json entry participate in
   * content-index.json. That is the same 40 — p001–p040 — that the twin
   * match selected before; the selection is now stated in data instead of
   * being computed from tokens.
   * D1 remains deferred.
   */
  contentIndex: {
    output: "content-index.json",
    expected: { guides: 22, palettes: 40, total: 62 }, // CONTRACT
    /**
     * The palette filter. Applied to LOADED palette records, which
     * src/build/content.js has already annotated with their `meta` entry
     * from palettes-meta.json.
     *
     * `meta` is attached at load time and is never written into
     * palettes-data.json, which stays byte-identical to source.
     */
    indexedPalettes: (palettes) => palettes.filter((p) => p.meta),
  },

  /** Every palette id that must survive the migration untouched. CONTRACT */
  palettes: { count: 300, firstId: "p001", lastId: "p300" },

  /**
   * PHASE 4 STEP 10 — the Color Library contract. CONTRACT
   *
   * `count` is an EXPECTED value the `load` stage asserts, the same way it
   * asserts the palette count — so a truncated or double-appended data file
   * fails the build instead of shipping a short grid. Growing the library is
   * therefore two edits: the data file, and this number.
   *
   * `categories` is the vocabulary AND the order the filter row renders in.
   * It is stated here as the build-time contract; src/client/colors.js
   * states the same twelve as CATEGORY_ORDER because a browser cannot read
   * this file, and src/build/colors-data.test.js asserts the two agree and
   * that every category in the data appears in both. Two independent
   * declarations that are checked against each other are worth more than one
   * shared constant nobody can see drift — the same reasoning
   * src/build/head.js applies to the marker pairs.
   *
   * `hexPattern` is the normalization contract: uppercase, six digits, with
   * the leading #. It is a string rather than a RegExp so this module stays
   * plain data and every consumer builds its own matcher from it.
   */
  colors: {
    count: 300,
    firstId: "c001",
    lastId: "c300",
    hexPattern: "^#[0-9A-F]{6}$",
    categories: [
      "Red",
      "Orange",
      "Brown",
      "Yellow",
      "Green",
      "Turquoise",
      "Blue",
      "Violet",
      "Pink",
      "White",
      "Gray",
      "Black",
    ],
  },

  /**
   * CONTRACT — the Phase 4 candidate surface, after token removal.
   *
   * Was 84 / 142 / 82 before removal. The deltas are entirely token:
   *   htmlPages    84 → 41  (−43: 40 token detail + index + create + collection)
   *   snapshotUrls 142 → 89 (−53: the 43 pages, their extensionless routes,
   *                          and the token-only code/style assets)
   *   sitemapUrls  82 → 40  (−42)
   *
   * PHASE 4 STEP 10 — COLOR LIBRARY. The first change to this table that ADDS.
   *   htmlPages    41 → 42  (+1: colors/index.html)
   *   sitemapUrls  40 → 41  (+1: https://bpozz.com/colors)
   *
   * IMAGE PICKER — the second change that ADDS, same shape as Step 10's.
   *   htmlPages    42 → 43  (+1: image-picker/index.html)
   *   sitemapUrls  41 → 42  (+1: https://bpozz.com/image-picker)
   *
   * snapshotUrls is NOT bumped here and is deliberately left at its Phase 4
   * value, because nothing reads it: it records what the token-removal
   * surface measured and the live number is asserted by
   * scripts/qa/check-urls.js against the recorded baseline, which is a
   * stronger check than a literal in this file. The Step 10 and Image
   * Picker additions to that surface are enumerated one-by-one in
   * check-urls.js's ALLOWED_ADDED before the baseline is re-recorded — see
   * that file.
   */
  expected: {
    htmlPages: 43,
    snapshotUrls: 89,
    sitemapUrls: 42,
  },

  /**
   * F7 — deployment target is Netlify.
   *
   * `_htaccess` is NOT renamed to `.htaccess` and no Apache behaviour is
   * activated. It is carried through to dist/ byte-for-byte only because it
   * is published today and Phase 2 changes no deployed bytes; see the
   * Phase 2 report for the open question about dropping it.
   */
  deploy: { target: "netlify", activateApache: false },

  /**
   * F3 — the guide JSON-LD schema.
   *
   * PHASE 4 STEP 7 — THIS IS NOW READ, NOT JUST RECORDED
   *
   * From Phase 2 until Step 7 this field had no consumer. It recorded the F3
   * decision and nothing resolved it; the Step 6 handoff logged that as D6
   * and left it alone on the grounds that touching it was JSON-LD work.
   *
   * src/build/structured-data.js reads it. The array names the blocks a
   * guide page carries AND the order they are emitted in, and every name in
   * it must be one that module has a builder for — a name it does not know
   * fails the build rather than silently dropping a block. So changing the
   * decision here changes all 22 pages, and the decision cannot drift away
   * from what the pages actually ship.
   *
   * The order is the emitted order: the breadcrumb trail first, then the
   * article. It was the order three of the 22 hand-authored pages used;
   * six used the opposite and thirteen had no breadcrumb at all.
   */
  jsonLd: { guide: ["BreadcrumbList", "TechArticle"] },
};
