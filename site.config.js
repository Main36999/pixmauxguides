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

      /**
       * FONTS — the single source of truth for /fonts/ and every
       * /fonts/<id>.html detail page. One record per family: its metadata,
       * its license and provenance, and the variant files it ships.
       *
       * Unlike colors-data.json this is a BUILD INPUT, not an endpoint: the
       * listing grid is rendered into the page at build time (so it is
       * crawlable and works without JS), and the browser filters the
       * rendered cards rather than fetching a data file.
       *
       * The font binaries and each family's OFL.txt live beside it under
       * `fontFiles` and are published verbatim; the download ZIPs are
       * generated from those files by src/build/fonts.js at build time, so
       * no font file is stored twice.
       */
      fonts: path.join(ROOT, "src", "data", "fonts.json"),
      fontFiles: path.join(ROOT, "public", "fonts"),

      /**
       * FONT EDITORIAL (prototype) — curated, evidence-backed notes for the
       * families listed in fonts.editorial.ids below, keyed by font id. A
       * build input like fonts.json; never published. Validated and
       * documented in src/build/font-editorial.js.
       */
      fontEditorial: path.join(ROOT, "src", "data", "font-editorial.json"),

      /**
       * ICON PACKS — two build inputs, the same shape as fonts.json: the
       * packs (one record per pack, in display order) and the icons (one
       * record per icon, naming the pack it belongs to and the asset files it
       * ships). The asset files live beside them under `iconFiles`, one
       * directory per pack, and are published verbatim at /icons/<pack>/.
       *
       * A pack's icon count is DERIVED from icons.json, never stored, so the
       * two cannot disagree. The download ZIPs are generated from the asset
       * files by src/build/icons.js at build time.
       */
      iconPacks: path.join(ROOT, "src", "data", "icon-packs.json"),
      icons: path.join(ROOT, "src", "data", "icons.json"),
      iconFiles: path.join(ROOT, "public", "icons"),

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
   * 622 records: 22 guides + all 600 palettes. The 40 token records are
   * gone with the feature.
   *
   * SEARCH COVERAGE: this index is what /search matches against, so every
   * palette is in it. It used to hold only the 40 palettes with a
   * palettes-meta.json entry (p001–p040), which left p041 onward
   * unsearchable. Those 40 records are still built from their meta entry
   * and are byte-identical to the approved Phase 3 records
   * (src/build/palette-meta.test.js); every other palette gets a record
   * built from palettes-data.json alone — see buildPaletteRecords().
   * D1 remains deferred.
   */
  contentIndex: {
    output: "content-index.json",
    expected: { guides: 22, palettes: 600, total: 622 }, // CONTRACT
    /**
     * The palette selection. Applied to LOADED palette records, which
     * src/build/content.js has already annotated with their `meta` entry
     * from palettes-meta.json where one exists. Every palette is indexed,
     * in palettes-data.json's own order.
     *
     * `meta` is attached at load time and is never written into
     * palettes-data.json, which stays byte-identical to source.
     */
    indexedPalettes: (palettes) => palettes.slice(),
  },

  /** Every palette id that must survive the migration untouched. CONTRACT */
  palettes: { count: 600, firstId: "p001", lastId: "p600" },

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
    count: 1200,
    firstId: "c001",
    lastId: "c1200",
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
   * FONTS — the font library contract. CONTRACT
   *
   * `count` is asserted by the `load` stage exactly the way the colour count
   * is, so a truncated or duplicated fonts.json fails the build.
   *
   * `categories` is the vocabulary AND the filter-row order: each record's
   * `category` must be one of these slugs, and every slug must have at least
   * one font (a filter chip with nothing behind it is a fake category).
   *
   * `licenses` is the allow-list of licenses a font may ship under. Only
   * licenses whose redistribution terms were verified belong here; a record
   * naming anything else fails the build. src/build/content.js additionally
   * checks every family's shipped OFL.txt against it.
   */
  fonts: {
    count: 300,
    categories: [
      { slug: "serif", label: "Serif" },
      { slug: "sans-serif", label: "Sans Serif" },
      { slug: "display", label: "Display" },
      { slug: "handwriting", label: "Handwriting" },
      { slug: "monospace", label: "Monospace" },
    ],
    licenses: ["SIL Open Font License 1.1"],

    /**
     * EDITORIAL PROTOTYPE. The families that carry an editorial layer. The
     * validator requires a record for every id here and refuses a record for
     * any other family, so the layer cannot spread to a page by accident.
     */
    editorial: {
      ids: [
        "b612",
        "be-vietnam-pro",
        "ibm-plex-mono",
        "prata",
        "sue-ellen-francisco",
        "lobster",
        "im-fell-english",
        "sanchez",
        "herr-von-muellerhoff",
        "mr-dafoe",
        // Batch 2
        "atkinson-hyperlegible",
        "hind",
        "barlow-condensed",
        "bebas-neue",
        "encode-sans-expanded",
        "varela-round",
        "montserrat-alternates",
        "pt-serif",
        "cardo",
        "abhaya-libre",
        "instrument-serif",
        "arvo",
        "courier-prime",
        "xanh-mono",
        "major-mono-display",
        "kalam",
        "comic-neue",
        "amatic-sc",
        "unifrakturmaguntia",
        "press-start-2p",
        // Batch 3
        "fira-sans",
        "lato",
        "michroma",
        "questrial",
        "didact-gothic",
        "asap-condensed",
        "gentium-book-plus",
        "ibm-plex-serif",
        "rozha-one",
        "bellefair",
        "glegoo",
        "shrikhand",
        "poiret-one",
        "monoton",
        "iosevka-charon-mono",
        "fragment-mono",
        "cousine",
        "style-script",
        "black-ops-one",
        "uncial-antiqua",
        // Batch 4
        "ibm-plex-sans-condensed",
        "pt-sans",
        "b612-mono",
        "fira-mono",
        "barlow",
        "crimson-text",
        "charis-sil",
        "old-standard-tt",
        "noticia-text",
        "abril-fatface",
        "dm-serif-display",
        "anton",
        "silkscreen",
        "andika",
        "alegreya-sans",
        "great-vibes",
        "tangerine",
        "mansalva",
        "bungee",
        "judson",
        // Batch 5
        "alike",
        "lusitana",
        "bentham",
        "radley",
        // Batch 6
        "im-fell-dw-pica",
        "space-mono",
        "monsieur-la-doulaise",
        "aboreto",
        "libre-caslon-display",
        "economica",
        "lekton",
        "mrs-saint-delafield",
        "racing-sans-one",
        "libertinus-mono",
        "kaushan-script",
        "istok-web",
        "vt323",
        "birthstone",
        "calistoga",
        "mate",
        "syne-mono",
        "audiowide",
        "enriqueta",
        "alata",
        // Batch 7
        "anonymous-pro",
        "patrick-hand",
        "jersey-25",
        "livvic",
        "pt-mono",
        "pinyon-script",
        "almendra",
        "arsenal",
        "cutive-mono",
        "pacifico",
        "rowdies",
        "ledger",
        "archivo-black",
        "dm-mono",
        "allura",
        "arizonia",
        "alfa-slab-one",
        "gabriela",
        "oxygen-mono",
        "hurricane",
        // Batch 7B
        "belleza",
        "bad-script",
        "limelight",
        "gilda-display",
        "inria-sans",
        "grand-hotel",
        "balsamiq-sans",
        "paytone-one",
        "kristi",
        "yeseva-one",
        "special-gothic-expanded-one",
        "damion",
        "alice",
        "francois-one",
        "ms-madi",
        "bevan",
        "play",
        "niconne",
        "oranienbaum",
        "fjalla-one",
        // Batch 7C
        "norican",
        "inria-serif",
        "tomorrow",
        "corinthia",
        "trocchi",
        "pangolin",
        "cantata-one",
        "rubik-mono-one",
        "sansita",
        "gloock",
        "fanwood-text",
        "news-cycle",
        "staatliches",
        "zilla-slab",
        "russo-one",
        "righteous",
        // Batch 8
        "blinker",
        "marck-script",
        "meow-script",
        "playball",
        "basic",
        "short-stack",
        "rammetto-one",
        "krona-one",
        "vujahday-script",
        "caveat-brush",
        "fauna-one",
        "tenor-sans",
        "qwitcher-grypen",
        "sacramento",
        "titan-one",
        "cookie",
        "young-serif",
        "delicious-handrawn",
        "parisienne",
        "bangers",
        // Batch 9
        "days-one",
        "allison",
        "pathway-gothic-one",
        "italianno",
        "graduate",
        "alex-brush",
        "eater",
        "linden-hill",
        "yesteryear",
        "sorts-mill-goudy",
        "six-caps",
        "leckerli-one",
        // Batch 10: the two families the Unicase and Stencil terms made eligible
        "unica-one",
        "saira-stencil-one",
        // Batch 11: all caps measured, display face stated upstream
        "monofett",
      ],
    },
  },

  /**
   * ICON PACKS — the icon library contract. CONTRACT
   *
   * `styles` is the vocabulary AND the filter-row order. Every pack names one
   * style and every icon inherits it. `vector` states what the style's assets
   * ARE, and the loader enforces it per icon:
   *
   *   vector: true    the SVG is the source. `svg` is required; `png` is an
   *                   optional raster rendered from it.
   *   vector: false   the source is a raster (3D renders). `png` is required
   *                   and `svg` is refused — the site never offers an SVG it
   *                   would have to fake by wrapping a bitmap.
   *
   * `categories` is the vocabulary and filter order for icon categories.
   * Every slug must have at least one icon, the same no-fake-chip rule the
   * font categories follow.
   *
   * There is no `count` yet, unlike fonts and colors: the library is a
   * Phase 1 sample that is expected to grow pack by pack. Pin one here when
   * the real packs are imported.
   */
  icons: {
    styles: [
      { slug: "outline", label: "Outline", vector: true },
      { slug: "solid", label: "Solid", vector: true },
      { slug: "duotone", label: "Duotone", vector: true },
      { slug: "3d", label: "3D", vector: false },
    ],
    categories: [
      { slug: "arrows", label: "Arrows" },
      { slug: "navigation", label: "Navigation" },
      { slug: "interface", label: "Interface" },
      { slug: "communication", label: "Communication" },
      { slug: "media", label: "Media" },
      { slug: "business", label: "Business" },
      { slug: "social", label: "Social" },
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
   *   sitemapUrls  40 → 41  (+1: https://bpozz.com/colors/)
   *
   * IMAGE PICKER — the second change that ADDS, same shape as Step 10's.
   *   htmlPages    42 → 43  (+1: image-picker/index.html)
   *   sitemapUrls  41 → 42  (+1: https://bpozz.com/image-picker/)
   *
   * snapshotUrls is NOT bumped here and is deliberately left at its Phase 4
   * value, because nothing reads it: it records what the token-removal
   * surface measured and the live number is asserted by
   * scripts/qa/check-urls.js against the recorded baseline, which is a
   * stronger check than a literal in this file. The Step 10 and Image
   * Picker additions to that surface are enumerated one-by-one in
   * check-urls.js's ALLOWED_ADDED before the baseline is re-recorded — see
   * that file.
   *
   * FONTS — the third change that ADDS, and the first to add generated pages
   * in bulk:
   *   htmlPages    43 → 94  (+51: fonts/index.html and one
   *                          fonts/<id>.html per record in fonts.json)
   *   sitemapUrls  42 → 93  (+51: the same 51 URLs)
   *
   * FONTS TO 200 — 150 more families, one detail page each:
   *   htmlPages    94 → 244  (+150: fonts/<id>.html per new record)
   *   sitemapUrls  93 → 243  (+150: the same 150 URLs)
   *
   * ICON PACKS (Phase 1) — the library and one page per pack:
   *   htmlPages    244 → 249  (+5: icons/index.html and one
   *                            icons/<pack>.html per record in icon-packs.json)
   *   sitemapUrls  243 → 243  (unchanged: the Phase 1 pages carry noindex
   *                            and are deliberately left out of the sitemap
   *                            until the real packs are imported)
   *
   * FONTS TO 250 (Batch 1 of the 500-family expansion) — 50 more families,
   * one detail page each:
   *   htmlPages    249 → 299  (+50: fonts/<id>.html per new record)
   *   sitemapUrls  243 → 293  (+50: the same 50 URLs)
   *
   * FONTS TO 300 (Batch 2 of the 500-family expansion) — 50 more families,
   * one detail page each:
   *   htmlPages    299 → 349  (+50: fonts/<id>.html per new record)
   *   sitemapUrls  293 → 343  (+50: the same 50 URLs)
   *
   * /hoysomrach — the founder's personal page, one hand-authored root page
   * served extensionless (see EXTENSIONLESS_ROOT_PAGES in src/build/routes.js):
   *   htmlPages    349 → 350  (+1: hoysomrach.html)
   *   sitemapUrls  343 → 344  (+1: https://bpozz.com/hoysomrach)
   *
   * 404.html — the custom not-found page Netlify serves for any missing
   * path. Hand-authored root page, noindex, no canonical:
   *   htmlPages    350 → 351  (+1: 404.html)
   *   sitemapUrls  344 → 344  (unchanged: an error page is not content)
   */
  expected: {
    htmlPages: 351,
    snapshotUrls: 89,
    sitemapUrls: 344,
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
