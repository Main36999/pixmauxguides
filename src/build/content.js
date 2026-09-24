/**
 * src/content.js — loads every content source into one normalized model.
 *
 * This is the only module in the build that reads content off disk. Every
 * other stage takes the model it returns.
 *
 * WHAT IT ADDS TO THE RAW DATA
 *
 * `palette.meta` — the one attached field. See the note on
 * annotatePaletteMeta() below. It marks the 40 palettes (p001–p040) whose
 * content-index record is built from palettes-meta.json; every other
 * palette's record is built from palettes-data.json alone (see
 * buildPaletteRecords()). Nothing is written into palettes-data.json.
 *
 * `model.guidePages` — the guide pages' own content, read from content/guide/
 * and parsed into src/build/guide-template.js's slots (Phase 4 Step 4). It is
 * loaded here, with the rest of the content, so that a guide with no page —
 * or a page with no guide — fails before anything is rendered. See
 * loadGuidePages().
 *
 * PHASE 4 — TOKEN REMOVAL
 *
 * Colour Tokens were removed as a feature. Before that, palettes p001–p040
 * borrowed their title, description, tags and search metadata from a twin
 * token record in tokens.json, matched by a case-insensitive comparison of
 * the token's background/surface/primary/secondary hexes against the
 * palette's four colours. tokens.json is gone, so that metadata was
 * migrated verbatim into palettes/palettes-meta.json and is now read
 * directly. The resulting 40 palette records are byte-identical to the
 * previously approved ones — see the migration test.
 *
 * The record-building logic further down was ported verbatim from the
 * legacy build-content-index.js so this pipeline could own
 * content-index.json without running that script. That script was deleted
 * in Phase 4 Step 2A; this module is now its only home.
 *
 * PHASE 4 STEP 6 — ONE SCHEMA, STATED ONCE
 *
 * The sentence above — "the only module in the build that reads content off
 * disk" — was not true when Step 6 started: src/build/header.js opened
 * resource-types.json itself with its own fs call and its own validator, and
 * the categories.json schema was written out three more times, in
 * src/build/categories.js and twice in src/build/home.js. Four readers, five
 * validators, no two of them checking the same things.
 *
 * Every rule that says what a content SOURCE must look like now lives in the
 * "schema validation" section below and runs once, in load(), before any
 * builder sees the model. The line that decides what belongs here:
 *
 *   a rule is a SCHEMA rule if it can be answered from the content file
 *   alone. A rule that needs the built site — "does this landingUrl resolve
 *   to a page that exists?" — or a consumer's own capabilities — "does
 *   src/build/home.js render a `home` block at all?" — is a CONSUMER check, and stays
 *   with the consumer that can answer it.
 *
 * The same step made this module the one home for the two pieces of
 * content-index VOCABULARY the render modules had each copied: the type
 * label map and the tag summary. Both are keyed off fields this module
 * writes onto the records, so this is where they belong; see "content-index
 * record vocabulary" below.
 *
 * Nothing here changes a single byte of output. See
 * docs/bpozz-phase-4-step-6-handoff.md.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const guideTemplate = require("./guide-template.js");
const structuredData = require("./structured-data.js");

/** content/guide/'s index of page records. */
const GUIDE_PAGES_INDEX = "pages.json";

/** ISO calendar date, the only form the guide dates have ever been written in. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fixed category pair every Palette record gets. Decided in the original
// Phase 1 and carried forward verbatim — the site's own guides split this
// topic across exactly these two categories.
const PALETTE_CATEGORIES = ["color-theory", "systems"];

// ---------------------------------------------------------------------
// small helpers (ported verbatim from the legacy build-content-index.js)
// ---------------------------------------------------------------------

function readJsonArray(filePath, label) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error(`${label} did not contain a JSON array (${filePath})`);
  }
  return data;
}

function normalizeCategories(item) {
  return Array.isArray(item.categories)
    ? item.categories
    : item.category
      ? [item.category]
      : [];
}

function normalize(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function wordsFromSlug(slug) {
  return String(slug || "").replace(/[-_]+/g, " ");
}

function buildSearchText(fields) {
  const parts = [];
  fields.forEach(function (field) {
    if (Array.isArray(field)) {
      field.forEach(function (v) {
        if (v) parts.push(v);
      });
    } else if (field) {
      parts.push(field);
    }
  });
  const normalized = normalize(parts.join(" "));
  const seen = new Set();
  const words = normalized.split(" ").filter(function (w) {
    if (!w || seen.has(w)) return false;
    seen.add(w);
    return true;
  });
  return words.join(" ");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function addOptionalFields(record, fields) {
  Object.keys(fields).forEach(function (key) {
    if (fields[key] !== undefined) record[key] = fields[key];
  });
  return record;
}

// ---------------------------------------------------------------------
// schema validation (Phase 4 Step 6)
// ---------------------------------------------------------------------
//
// One statement of each content source's shape, applied in load(). Before
// Step 6 these rules were re-written inside each consumer:
//
//   categories.json      src/build/categories.js  loadCategoryData()
//                        src/build/home.js        loadCategoryLabels()
//                        src/build/home.js        loadGuideCategories()
//   resource-types.json  src/build/home.js        assertNoHomeBlocks()
//                        src/build/header.js      loadNavEntries()  (+ its
//                                                 own fs read of the file)
//   guides.json          an Array.isArray guard in each render()
//
// Failing here rather than in a builder also moves every one of these
// failures ahead of the first write: `load` runs while dist/ is still empty.
//
// The wording of each message is kept from whichever consumer owned the rule,
// so an operator who has seen one of these before still recognizes it.

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * guides.json. The fields every consumer dereferences without checking:
 * `id` (the route, the page record, the card link) and `category` (the grid
 * a guide lands in, and the label on its card).
 *
 * NOT checked, deliberately: that `categories` agrees with `category`. All 22
 * records carry `categories: [category]` today and the array is redundant —
 * see D5 in docs/bpozz-phase-4-step-6-handoff.md — but guides.json is a
 * published endpoint, so reconciling the two is a change to deployed bytes
 * and belongs to a separately approved step. normalizeCategories() remains
 * the one place that reads either form.
 */
function validateGuides(guides, label) {
  if (!Array.isArray(guides)) {
    throw new Error(`${label} did not contain an array`);
  }
  const seen = new Set();
  guides.forEach(function (guide, i) {
    const where = `${label}[${i}]`;
    if (!guide || typeof guide !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof guide.id !== "string" || !SLUG_RE.test(guide.id)) {
      throw new Error(`${where}.id must be a lowercase slug`);
    }
    if (seen.has(guide.id)) {
      throw new Error(`${where}: duplicate guide "${guide.id}"`);
    }
    seen.add(guide.id);
    if (typeof guide.category !== "string" || !guide.category.trim()) {
      throw new Error(`${where} ("${guide.id}") has no category`);
    }
  });
  return guides;
}

/**
 * categories.json. `slug` becomes a URL (/category/<slug>) and `name` is the
 * label on every surface, so both are required everywhere the file is read.
 *
 * The duplicate-slug check is new with Step 6 and is the one rule none of the
 * three old copies had: two entries with the same slug would have produced
 * one category page, silently, with the second entry's guides in it.
 */
function validateCategories(categories, label) {
  if (!Array.isArray(categories)) {
    throw new Error(`${label} did not contain an array`);
  }
  const seen = new Set();
  categories.forEach(function (category, i) {
    const where = `${label}[${i}]`;
    if (!category || typeof category !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof category.slug !== "string" || !SLUG_RE.test(category.slug)) {
      throw new Error(`${where} has no valid slug`);
    }
    if (seen.has(category.slug)) {
      throw new Error(`${where}: duplicate category "${category.slug}"`);
    }
    seen.add(category.slug);
    if (typeof category.name !== "string" || !category.name.trim()) {
      throw new Error(`${where} ("${category.slug}") has no name`);
    }
  });
  return categories;
}

/**
 * colors/colors-data.json — the Color Library (Step 10).
 *
 * Every rule here can be answered from the file alone, which is what makes
 * them schema rules by the line this module draws above: the id, the name,
 * the normalized hex, the category vocabulary, and the two uniqueness
 * constraints. Whether the PAGE renders them is src/client/colors.js's
 * problem and is not checked here.
 *
 * WHY UNIQUENESS IS A BUILD FAILURE AND NOT A WARNING
 *
 * Because both duplicates are silent in the browser. Two records with the
 * same hex render as two identical cards, which reads as a rendering bug
 * rather than a data one; two with the same id break nothing visible at all
 * until something starts keying off id. Neither would ever be noticed by
 * looking at the page, so neither is allowed to reach it.
 *
 * The hex contract is UPPERCASE, six digits, leading #. Stated once in
 * site.config.js as `colors.hexPattern` and compiled here. Lowercase is
 * rejected rather than normalized on the way in: normalizing would mean the
 * committed file and the published file could differ, and this data is
 * published verbatim.
 */
function validateColors(colors, label, config) {
  if (!Array.isArray(colors)) {
    throw new Error(`${label} did not contain an array`);
  }
  const hexRe = new RegExp(config.colors.hexPattern);
  const allowed = new Set(config.colors.categories);
  const seenId = new Set();
  const seenHex = new Set();

  colors.forEach(function (color, i) {
    const where = `${label}[${i}]`;
    if (!color || typeof color !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof color.id !== "string" || !/^c\d{3,}$/.test(color.id)) {
      throw new Error(`${where}.id must look like "c001"`);
    }
    if (seenId.has(color.id)) {
      throw new Error(`${where}: duplicate color id "${color.id}"`);
    }
    seenId.add(color.id);

    if (typeof color.name !== "string" || !color.name.trim()) {
      throw new Error(`${where} ("${color.id}") has no name`);
    }
    if (typeof color.hex !== "string" || !hexRe.test(color.hex)) {
      throw new Error(
        `${where} ("${color.id}") has hex ${JSON.stringify(color.hex)} — ` +
          `every hex must match ${config.colors.hexPattern} (uppercase, six digits)`,
      );
    }
    if (seenHex.has(color.hex)) {
      throw new Error(
        `${where}: duplicate hex ${color.hex} — two cards would render the ` +
          `same colour under different names`,
      );
    }
    seenHex.add(color.hex);

    if (!allowed.has(color.category)) {
      throw new Error(
        `${where} ("${color.id}") has category ${JSON.stringify(color.category)}, ` +
          `which site.config.js's colors.categories does not list`,
      );
    }
  });

  return colors;
}

/**
 * src/data/fonts.json — the font library, checked against site.config.js's
 * `fonts` contract AND against the files on disk under paths.content.fontFiles.
 *
 * The file checks are the point. Every page, card and download is generated
 * from this data, so a record that names a file which is not there would ship
 * a broken preview or a 404 download. Checking here fails the build instead.
 *
 * The license checks encode the sourcing rules rather than trusting the data:
 *
 *   - `license` must be on site.config.js's verified allow-list;
 *   - the family's shipped license file must exist and actually be the text
 *     of that license (for the OFL: "SIL OPEN FONT LICENSE Version 1.1");
 *   - `reservedFontName` must agree with the license file itself — whether
 *     its copyright header declares a Reserved Font Name;
 *   - a family WITH a Reserved Font Name must be served from its original,
 *     unmodified files (`web` === `file`). Converting it to another format
 *     would be a modification whose status under the RFN clause is unclear,
 *     so the build refuses it rather than guessing.
 */
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FONT_STYLES = ["normal", "italic"];
const LICENSE_TEXT = {
  "SIL Open Font License 1.1": /SIL OPEN FONT LICENSE\s+Version 1\.1/i,
};

function validateFonts(fonts, label, config) {
  if (!Array.isArray(fonts)) {
    throw new Error(`${label} did not contain an array`);
  }
  const fontDir = config.paths.content.fontFiles;
  const categories = new Set(config.fonts.categories.map((c) => c.slug));
  const licenses = new Set(config.fonts.licenses);
  const seenId = new Set();
  const seenName = new Set();
  const seenFeatured = new Set();
  const isUrl = (v) => typeof v === "string" && /^https:\/\/\S+$/.test(v);

  fonts.forEach(function (font, i) {
    const where = `${label}[${i}]`;
    if (!font || typeof font !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof font.id !== "string" || !SLUG_RE.test(font.id)) {
      throw new Error(`${where}.id must be a lowercase slug`);
    }
    if (seenId.has(font.id)) {
      throw new Error(`${where}: duplicate font id "${font.id}"`);
    }
    seenId.add(font.id);
    const at = `${where} ("${font.id}")`;

    ["name", "family", "designer", "description", "copyright", "source"].forEach(
      function (key) {
        if (typeof font[key] !== "string" || !font[key].trim()) {
          throw new Error(`${at}.${key} must be a non-empty string`);
        }
      },
    );
    if (seenName.has(font.name)) {
      throw new Error(`${at}: duplicate font name "${font.name}"`);
    }
    seenName.add(font.name);
    if (/["\\<>;{}]/.test(font.family)) {
      throw new Error(`${at}.family contains a character unsafe in CSS`);
    }
    if (!categories.has(font.category)) {
      throw new Error(
        `${at} has category ${JSON.stringify(font.category)}, which ` +
          `site.config.js's fonts.categories does not list`,
      );
    }
    if (
      !Array.isArray(font.tags) ||
      font.tags.some((t) => typeof t !== "string" || !SLUG_RE.test(t))
    ) {
      throw new Error(`${at}.tags must be an array of lowercase slugs`);
    }
    if (typeof font.background !== "string" || !/^#[0-9A-F]{6}$/.test(font.background)) {
      throw new Error(`${at}.background must be an uppercase six-digit hex`);
    }
    if (!Number.isInteger(font.featured) || font.featured < 1) {
      throw new Error(`${at}.featured must be a positive integer`);
    }
    if (seenFeatured.has(font.featured)) {
      throw new Error(`${at}: featured position ${font.featured} is used twice`);
    }
    seenFeatured.add(font.featured);
    if (typeof font.dateAdded !== "string" || !ISO_DATE_RE.test(font.dateAdded)) {
      throw new Error(`${at}.dateAdded must be an ISO date (YYYY-MM-DD)`);
    }
    ["licenseUrl", "sourceUrl", "repositoryUrl"].forEach(function (key) {
      if (!isUrl(font[key])) throw new Error(`${at}.${key} must be an https URL`);
    });
    // Optional, read from the font files and METADATA.pb by
    // scripts/fonts/import-google-fonts.js; shown on the detail page.
    if (font.version !== undefined && !/^\d+\.\d+$/.test(font.version)) {
      throw new Error(`${at}.version must look like "1.003"`);
    }
    if (
      font.subsets !== undefined &&
      (!Array.isArray(font.subsets) ||
        font.subsets.some((t) => typeof t !== "string" || !SLUG_RE.test(t)))
    ) {
      throw new Error(`${at}.subsets must be an array of lowercase slugs`);
    }
    if (font.upstreamUrl !== undefined && !isUrl(font.upstreamUrl)) {
      throw new Error(`${at}.upstreamUrl must be an https URL`);
    }

    // ---- license, verified against the shipped file ----
    if (!licenses.has(font.license)) {
      throw new Error(
        `${at} has license ${JSON.stringify(font.license)}, which is not on ` +
          `site.config.js's verified fonts.licenses list — a font whose ` +
          `redistribution terms were not verified must not ship`,
      );
    }
    if (typeof font.licenseFile !== "string" || !/^[\w.-]+$/.test(font.licenseFile)) {
      throw new Error(`${at}.licenseFile must be a plain file name`);
    }
    const licensePath = path.join(fontDir, font.id, font.licenseFile);
    if (!fs.existsSync(licensePath)) {
      throw new Error(`${at}: license file missing at ${licensePath}`);
    }
    const licenseText = fs.readFileSync(licensePath, "utf8");
    if (!LICENSE_TEXT[font.license].test(licenseText)) {
      throw new Error(
        `${at}: ${font.licenseFile} is not the text of ${font.license}`,
      );
    }
    const header = licenseText.split(/PREAMBLE/)[0];
    const declaresRfn = /Reserved\s+Font\s+Names?/i.test(header);
    if (font.reservedFontName !== declaresRfn) {
      throw new Error(
        `${at}.reservedFontName is ${font.reservedFontName}, but ` +
          `${font.licenseFile} ${declaresRfn ? "declares" : "does not declare"} ` +
          `a Reserved Font Name`,
      );
    }

    // ---- variants, verified against the shipped files ----
    if (!Array.isArray(font.variants) || !font.variants.length) {
      throw new Error(`${at}.variants must be a non-empty array`);
    }
    const seenVariant = new Set();
    font.variants.forEach(function (v, j) {
      const vat = `${at}.variants[${j}]`;
      if (!FONT_WEIGHTS.includes(v.weight)) {
        throw new Error(`${vat}.weight must be one of ${FONT_WEIGHTS.join(", ")}`);
      }
      if (!FONT_STYLES.includes(v.style)) {
        throw new Error(`${vat}.style must be "normal" or "italic"`);
      }
      const key = `${v.weight}/${v.style}`;
      if (seenVariant.has(key)) {
        throw new Error(`${vat}: ${key} is listed twice`);
      }
      seenVariant.add(key);
      if (typeof v.file !== "string" || !/^[\w-]+\.(ttf|otf)$/.test(v.file)) {
        throw new Error(`${vat}.file must be a .ttf or .otf file name`);
      }
      if (typeof v.web !== "string" || !/^[\w-]+\.(woff2|ttf|otf)$/.test(v.web)) {
        throw new Error(`${vat}.web must be a .woff2, .ttf or .otf file name`);
      }
      if (font.reservedFontName && v.web !== v.file) {
        throw new Error(
          `${vat}: this family declares a Reserved Font Name, so it must be ` +
            `previewed from its original file (web === file), not a converted one`,
        );
      }
      [v.file, v.web].forEach(function (name) {
        if (!fs.existsSync(path.join(fontDir, font.id, name))) {
          throw new Error(`${vat}: ${font.id}/${name} does not exist`);
        }
      });
    });
  });

  const used = new Set(fonts.map((f) => f.category));
  config.fonts.categories.forEach(function (c) {
    if (!used.has(c.slug)) {
      throw new Error(
        `site.config.js lists font category "${c.slug}" but ${label} has no ` +
          `font in it — the filter would be a fake category`,
      );
    }
  });

  return fonts;
}

/**
 * resource-types.json — the union of what src/build/home.js and
 * src/build/header.js each used to check, minus the two rules neither file
 * can answer from the registry alone:
 *
 *   the homepage must render `home` blocks  -> src/build/home.js, which
 *                                              currently refuses them all
 *   `landingUrl` must resolve to a page     -> src/build/header.js, which
 *                                              has the staging root to look in
 *
 * Everything else is shape, and shape is stated here: the type slug and its
 * uniqueness, the label, the nav flag, the activePaths prefixes a nav entry
 * drives its aria-current from, and the home block's order/limit/sort.
 */
function validateResourceTypes(registry, label) {
  if (!Array.isArray(registry)) {
    throw new Error(`${label} did not contain an array`);
  }
  const seen = new Set();
  registry.forEach(function (entry, i) {
    const where = `${label}[${i}]`;
    if (!entry || typeof entry !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof entry.type !== "string" || !SLUG_RE.test(entry.type)) {
      throw new Error(`${where}.type must be a lowercase slug`);
    }
    if (seen.has(entry.type)) {
      throw new Error(`${where}: duplicate type "${entry.type}"`);
    }
    seen.add(entry.type);
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`${where}.label must be a non-empty string`);
    }
    if (typeof entry.nav !== "boolean") {
      throw new Error(`${where}.nav must be true or false`);
    }
    if (
      entry.nav &&
      (!Array.isArray(entry.activePaths) ||
        !entry.activePaths.every(
          (prefix) => typeof prefix === "string" && prefix,
        ))
    ) {
      throw new Error(`${where}.activePaths must be an array of path prefixes`);
    }
    // A destination is required by both consumers that use one: the header
    // renders it as a nav link, the homepage as the section's "View all".
    // Whether it RESOLVES is src/build/header.js's check, not this one.
    if (
      (entry.nav || entry.home !== null) &&
      (typeof entry.landingUrl !== "string" || !entry.landingUrl.trim())
    ) {
      throw new Error(`${where}.landingUrl must be a non-empty string`);
    }
    // `home: null` opts a type out of the homepage loop; anything else must
    // be a complete home block.
    if (entry.home === null) return;
    const home = entry.home;
    if (!home || typeof home !== "object") {
      throw new Error(`${where}.home must be null or an object`);
    }
    if (typeof home.order !== "number" || !Number.isFinite(home.order)) {
      throw new Error(`${where}.home.order must be a number`);
    }
    if (!Number.isInteger(home.limit) || home.limit < 1) {
      throw new Error(`${where}.home.limit must be a positive integer`);
    }
    if (typeof home.sort !== "string" || !home.sort) {
      throw new Error(`${where}.home.sort must be a non-empty string`);
    }
  });
  return registry;
}

// ---------------------------------------------------------------------
// content-index record vocabulary (Phase 4 Step 6)
// ---------------------------------------------------------------------
//
// Both of these read a content-index record and are keyed off fields this
// module writes onto it, so this is their one home. Until Step 6 each was
// declared twice — once in src/build/categories.js and once in
// src/build/home.js — with a comment in each copy asserting it matched the
// other. Both modules re-export them, so their own module API is unchanged.

/**
 * Resource-type labels for the .badge on a content-index card. The DOM text
 * stays Title Case; .badge in styles.css renders it uppercase (GUIDE /
 * PALETTE) so assistive tech still gets a normal word.
 *
 * src/client/search.js keeps its own TYPE_LABELS literal with the same two
 * values: it is browser code, assembled into /app.js as an IIFE fragment
 * rather than a module, and it belongs to Search. It is not touched here.
 */
const TYPE_BADGE_LABEL = { guide: "Guide", palette: "Palette" };

/**
 * One tag list, Title Cased and joined — the meta line for a record with no
 * `description` in the index, which is every Palette. Matches search.html's
 * snippetFor() fallback, so the same record reads the same way on all three
 * discovery surfaces.
 *
 * The two copies this replaces differed in one byte of guard: categories.js
 * tested `!record.tags`, home.js tested `!Array.isArray(record.tags)`. The
 * stricter form is kept — identical output for every real record, and it
 * returns "" instead of throwing on a malformed one.
 */
function tagsMetaFor(record) {
  if (!Array.isArray(record.tags) || !record.tags.length) return "";
  return record.tags
    .map(function (t) {
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(" · ");
}

// ---------------------------------------------------------------------
// palette metadata attachment
// ---------------------------------------------------------------------

/**
 * Annotates each palette with `meta`: its entry in palettes-meta.json, or
 * undefined when it has none.
 *
 * WHY THIS IS ATTACHED AND NOT WRITTEN
 *
 * buildPaletteRecords() reads `p.meta` to decide how a palette's record is
 * built. palettes-data.json carries no `meta` field on any of its records,
 * and writing one in would edit p001–p040, which the gate requires to come
 * through unchanged — so the entry is attached at load time instead:
 * palettes-data.json stays byte-identical to source, and the metadata has
 * exactly one home.
 *
 * On the current data this matches p001–p040 and nothing else. Before token
 * removal that selection was computed by hex twin match against
 * tokens.json; it is now stated directly by the presence of a meta entry.
 */
function annotatePaletteMeta(palettes, meta) {
  const warnings = [];
  const metaById = new Map();

  meta.forEach(function (m) {
    if (!m || typeof m.id !== "string" || !m.id) {
      warnings.push(
        "palettes-meta.json contains an entry with no id — ignored.",
      );
      return;
    }
    if (metaById.has(m.id)) {
      warnings.push(
        `palettes-meta.json has more than one entry for "${m.id}" — the ` +
          `first is used.`,
      );
      return;
    }
    metaById.set(m.id, m);
  });

  const annotated = palettes.map(function (p) {
    const record = Object.assign({}, p);
    const m = metaById.get(p.id);
    // Non-enumerable so the meta object never leaks into JSON output —
    // palettes-data.json is republished from this model byte-for-byte.
    if (m) Object.defineProperty(record, "meta", { value: m, enumerable: false });
    return record;
  });

  // A meta entry naming a palette that does not exist is a migration error,
  // not a style issue: it would silently shrink the index.
  const paletteIds = new Set(palettes.map((p) => p.id));
  metaById.forEach(function (_m, id) {
    if (!paletteIds.has(id)) {
      warnings.push(
        `palettes-meta.json has an entry for "${id}", which is not in ` +
          `palettes-data.json — it indexes nothing.`,
      );
    }
  });

  return { palettes: annotated, warnings };
}

// ---------------------------------------------------------------------
// guide pages (Phase 4 Step 4 — template migration)
// ---------------------------------------------------------------------

/**
 * Loads content/guide/ into one record per guide page.
 *
 * WHY THIS IS HERE AND NOT IN THE BUILDER
 *
 * Because it is content, and this module is the only one that reads content
 * off disk. The two partials src/build/{header,footer,categories}.js read
 * with their own fs calls are template inputs — site chrome, identical on
 * every page — and are read where they are used for that reason.
 * content/guide/ is the guides' prose, their <title>s and their structured
 * data: the same kind of thing guides.json is, so it loads the same way, in
 * the same stage, and the builder takes it from ctx like every other builder
 * takes its inputs.
 *
 * Loading it here also puts the page-set gate in the right place. `load`
 * runs before anything is written, so a guide with no page record, a record
 * with no guide, a malformed content file or a content file whose canonical
 * URL names a different slug fails while dist/ is still empty, rather than
 * half way through `render`.
 *
 * Returns records in pages.json's own order, each with `content` attached:
 * the six slots src/build/guide-template.js splices. pages.json is NOT
 * required to be in guides.json order — only to describe the same 22 ids.
 */
function loadGuidePages(dir, guides, origin) {
  const indexPath = path.join(dir, GUIDE_PAGES_INDEX);
  const records = readJsonArray(indexPath, GUIDE_PAGES_INDEX);

  const byId = new Map();
  records.forEach(function (record, i) {
    const where = `${GUIDE_PAGES_INDEX}[${i}]`;
    if (!record || typeof record !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof record.id !== "string" || !/^[a-z0-9-]+$/.test(record.id)) {
      throw new Error(`${where}.id must be a lowercase slug`);
    }
    if (byId.has(record.id)) {
      throw new Error(`${where}: duplicate page record "${record.id}"`);
    }
    // `null` is a real value here, not a missing field: nine pages carry no
    // class on <body> and the template must reproduce that. An omitted
    // bodyClass is therefore an error, not a shorthand for null.
    if (record.bodyClass !== null && typeof record.bodyClass !== "string") {
      throw new Error(
        `${where}.bodyClass must be a string or null (null = no class attribute)`,
      );
    }
    if (typeof record.toast !== "boolean") {
      throw new Error(`${where}.toast must be true or false`);
    }
    // PHASE 4 STEP 7: the two SEO dates. They used to exist only inside each
    // page's hand-written JSON-LD, which is the one fact in that block with
    // no other source in the model — every other field is derived from
    // guides.json or categories.json. They are page facts, so they live with
    // the other page facts, and they are validated here rather than trusted:
    // a malformed date does not fail a build, it ships a page search engines
    // silently drop the Article from.
    ["datePublished", "dateModified"].forEach(function (key) {
      if (typeof record[key] !== "string" || !ISO_DATE_RE.test(record[key])) {
        throw new Error(
          `${where}.${key} must be an ISO calendar date, "YYYY-MM-DD"`,
        );
      }
    });
    const f = record.format;
    if (!f || typeof f !== "object") {
      throw new Error(`${where}.format is missing`);
    }
    ["headerMarkerIndented", "railWrapped", "trailingNewline"].forEach(
      function (key) {
        if (typeof f[key] !== "boolean") {
          throw new Error(`${where}.format.${key} must be true or false`);
        }
      },
    );
    if (!Number.isInteger(f.primaryCloseIndent) || f.primaryCloseIndent < 0) {
      throw new Error(
        `${where}.format.primaryCloseIndent must be a non-negative integer`,
      );
    }
    byId.set(record.id, record);
  });

  // The page set and the guide set are the same set, in both directions.
  const guideIds = new Set(guides.map((g) => g.id));
  const missing = [...guideIds].filter((id) => !byId.has(id));
  const extra = records.map((r) => r.id).filter((id) => !guideIds.has(id));
  if (missing.length || extra.length) {
    throw new Error(
      [
        `content/guide/${GUIDE_PAGES_INDEX} does not describe the same guides as guides.json.`,
        "",
        ...missing.map((id) => `  no page record for guide "${id}"`),
        ...extra.map((id) => `  page record "${id}" is not a guide`),
        "",
        "  Every guide needs a record here and a content/guide/<id>.html;",
        "  src/build/guides.js renders one page per record.",
      ].join("\n"),
    );
  }

  return records.map(function (record) {
    const rel = `content/guide/${record.id}.html`;
    const file = path.join(dir, `${record.id}.html`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `${rel} is missing — ${GUIDE_PAGES_INDEX} has a record for ` +
          `"${record.id}" but its content file does not exist`,
      );
    }
    const content = guideTemplate.parseContent(
      fs.readFileSync(file, "utf8"),
      rel,
    );
    // Cheap guard against a content file copied to a new slug with its head
    // left pointing at the old one — the exact drift hand-authoring produced.
    const canonical = `href="${origin}/guide/${record.id}"`;
    if (!content.headMeta.includes(canonical)) {
      throw new Error(
        `${rel}: its HEAD_META slot has no canonical ${canonical} — the ` +
          `content file and the page record name different guides`,
      );
    }
    return Object.assign({}, record, { content });
  });
}

// ---------------------------------------------------------------------
// guide structured data (Phase 4 Step 7)
// ---------------------------------------------------------------------

/**
 * The five named entities a <meta> attribute may carry. `&amp;` is decoded
 * last, so "&amp;quot;" survives as the literal text "&quot;" instead of
 * collapsing into a quote character.
 */
const ENTITIES = [
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&amp;/g, "&"],
];

/**
 * A guide page's own <meta name="description"> content, as text.
 *
 * WHY THE DESCRIPTION IS READ BACK OUT OF THE PAGE RATHER THAN STORED TWICE
 *
 * It is the one field the generated JSON-LD shares with markup the content
 * file still authors by hand. Copying it into pages.json would create exactly
 * the drift Step 7 exists to remove — two statements of one sentence, free to
 * disagree — and taking it from guides.json instead would make eight pages
 * describe themselves one way in their head and another to a crawler, which
 * is the same bug pointing the other way. Lifting it from the page's own head
 * makes the two provably identical: they are the same bytes.
 *
 * The tag is matched, not the file: the committed pages wrap a long tag's
 * attributes onto their own lines, so `name` and `content` are not adjacent.
 * `[^>]*` cannot cross the tag boundary, and no description on this site
 * contains a raw angle bracket (checked).
 */
function metaDescriptionOf(headMeta, label) {
  const tag = headMeta.match(/<meta\b[^>]*\bname="description"[^>]*>/);
  if (!tag) {
    throw new Error(
      `${label}: its HEAD_META slot has no <meta name="description"> — the ` +
        `generated JSON-LD takes its description from the page's own head`,
    );
  }
  const content = tag[0].match(/\bcontent="([^"]*)"/);
  if (!content) {
    throw new Error(`${label}: its <meta name="description"> has no content`);
  }
  const text = ENTITIES.reduce(
    (s, [re, ch]) => s.replace(re, ch),
    content[1].replace(/\s+/g, " ").trim(),
  );
  if (!text) throw new Error(`${label}: its meta description is empty`);
  return text;
}

/**
 * Attaches `page.structuredData` — the rendered JSON-LD <script> block(s) —
 * to every guide page record.
 *
 * PHASE 4 STEP 7 — F2 CLOSED
 *
 * This is the seam the Step 4 note in src/build/guide-template.js pointed at:
 * "F2 — one JSON-LD generation path — stays a separate, separately approved
 * step that now has exactly one place to happen". This is that step, and this
 * is that place. The JSON-LD is composed by src/build/structured-data.js from
 * the model that is already loaded, and the guide template splices the string
 * exactly as it splices the six content slots.
 *
 * It runs here rather than in src/build/guides.js so that the guide pages
 * carry their structured data everywhere the model goes — including
 * src/build/guide-template.test.js, which renders from `content.load()` and
 * would otherwise be asserting a head this builder never produces.
 *
 * Every input is already validated: guides.json and categories.json by
 * validateGuides/validateCategories, the dates by loadGuidePages above.
 */
function attachGuideStructuredData(pages, guides, categories, config) {
  const guideById = new Map(guides.map((g) => [g.id, g]));
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

  return pages.map(function (page) {
    const guide = guideById.get(page.id);
    const category = categoryBySlug.get(guide.category);
    if (!category) {
      throw new Error(
        `content/guide/${page.id}.html: guides.json puts it in category ` +
          `"${guide.category}", which categories.json does not define — its ` +
          `breadcrumb trail and articleSection have no name to use`,
      );
    }

    const objects = structuredData.guideJsonLd({
      guide,
      category,
      page,
      description: metaDescriptionOf(
        page.content.headMeta,
        `content/guide/${page.id}.html`,
      ),
      origin: config.origin,
      types: config.jsonLd.guide,
    });

    return Object.assign({}, page, {
      structuredData: structuredData.scriptsHtml(objects, GUIDE_LD_INDENT),
    });
  });
}

/** Column the guide pages' <script> tags sit at, inside <head>. */
const GUIDE_LD_INDENT = 4;

// ---------------------------------------------------------------------
// record builders (ported from the legacy build-content-index.js)
// ---------------------------------------------------------------------

function buildGuideRecords(guides, categorySlugs, warnings) {
  return guides.map(function (g) {
    const categories = normalizeCategories(g);
    categories.forEach(function (slug) {
      if (!categorySlugs.has(slug)) {
        warnings.push(
          `guide "${g.id}" references unknown category "${slug}" — kept as-is, ` +
            `but categories.json has no such slug.`,
        );
      }
    });
    const tags = Array.isArray(g.tags) ? g.tags : [];
    const keywords = Array.isArray(g.keywords) ? g.keywords : [];

    const record = {
      id: `guide:${g.id}`,
      type: "guide",
      title: g.title || "",
      slug: g.id,
      url: `/guide/${g.id}.html`,
      description: g.description || "",
      categories: categories,
      tags: tags,
      keywords: keywords,
      searchText: buildSearchText([
        g.title,
        g.description,
        categories,
        tags,
        keywords,
      ]),
    };

    return addOptionalFields(record, { thumbnail: nonEmptyString(g.thumbnail) });
  });
}

/**
 * One content-index record per palette, in palettes-data.json's order.
 *
 * TWO SOURCES, ONE SHAPE
 *
 *   with meta     p001–p040. Title, tags, description and searchText come
 *                 from the palette's palettes-meta.json entry, exactly as
 *                 in the approved Phase 3 set — with one addition: the
 *                 palette's own colour names from palettes-data.json are
 *                 appended to the END of searchText, so a colour-name query
 *                 finds these palettes like every other. Appended, not
 *                 merged: the approved searchText is still an exact prefix
 *                 and every other field but colorNames (below) is
 *                 byte-identical (src/build/palette-meta.test.js).
 *   without meta  every other palette. There is no hand-written title or
 *                 tag set to borrow, so the record is built from the data
 *                 file alone: the title is the palette's colour names
 *                 joined the way the /palettes card foot shows them
 *                 ("Linen · Wheat · Terracotta · Cocoa"), and searchText
 *                 carries those names, the palette id and its tags. The
 *                 tags are the data file's own — p301..p600 carry the
 *                 theme their generator recipe used; earlier palettes have
 *                 none. No tags or description are invented.
 *
 * Both carry `colorNames` — the palette's own colour names from
 * palettes-data.json, one field for all 600, which /search scores as a name
 * of the palette — and `colors`, which is what search.html matches an exact
 * HEX query against and what the result card draws its swatches from.
 */
function buildPaletteRecords(indexedPalettes) {
  return indexedPalettes.map(function (p) {
    const meta = p.meta;
    if (!meta) return buildDataOnlyPaletteRecord(p);

    const title = meta.title;
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const moods = Array.isArray(meta.moods) ? meta.moods : [];

    const record = {
      id: `palette:${p.id}`,
      type: "palette",
      title: title,
      slug: p.id,
      url: `/palettes#${p.id}`,
      description: meta.description || "",
      categories: PALETTE_CATEGORIES.slice(),
      tags: tags,
      keywords: [],
      colorNames: colorNames(p),
      searchText: buildSearchText([
        title,
        wordsFromSlug(p.id),
        tags,
        meta.family,
        moods,
        meta.lightness,
        colorNames(p),
      ]),
    };

    const colors =
      Array.isArray(p.colors) &&
      p.colors.length &&
      p.colors.every((hex) => typeof hex === "string" && hex)
        ? p.colors.slice()
        : undefined;

    return addOptionalFields(record, {
      colors: colors,
      date: nonEmptyString(p.createdAt),
    });
  });
}

/** A palette's own colour names from palettes-data.json, blanks dropped. */
function colorNames(p) {
  return Array.isArray(p.names)
    ? p.names.filter((n) => typeof n === "string" && n.trim())
    : [];
}

/**
 * A palette's own tags from palettes-data.json, blanks and repeats dropped.
 * Only p301..p600 have any: the theme recipe scripts/palettes/expand-palettes.js
 * generated each one from. Everything before p301 gets [] — nothing is inferred.
 */
function dataTags(p) {
  return Array.isArray(p.tags)
    ? p.tags.filter((t, i, all) => typeof t === "string" && t.trim() && all.indexOf(t) === i)
    : [];
}

/** Same field set and key order as a meta record, so the index has one shape. */
function buildDataOnlyPaletteRecord(p) {
  const names = colorNames(p);
  const tags = dataTags(p);
  const colors =
    Array.isArray(p.colors) &&
    p.colors.length &&
    p.colors.every((hex) => typeof hex === "string" && hex)
      ? p.colors.slice()
      : undefined;
  if (!names.length) {
    throw new Error(
      `palette "${p.id}" has no colour names — a palette without a palettes-meta.json ` +
        "entry takes its search title from names[], so it cannot be indexed without them.",
    );
  }

  const record = {
    id: `palette:${p.id}`,
    type: "palette",
    title: names.join(" · "),
    slug: p.id,
    url: `/palettes#${p.id}`,
    description: "",
    categories: PALETTE_CATEGORIES.slice(),
    tags: tags,
    keywords: [],
    colorNames: names,
    searchText: buildSearchText([names, wordsFromSlug(p.id), tags]),
  };

  return addOptionalFields(record, {
    colors: colors,
    date: nonEmptyString(p.createdAt),
  });
}

// ---------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------

/**
 * Reads every content source and returns the normalized model.
 *
 * PHASE 4 STEP 6: every source is validated here, against the one statement
 * of its schema above, before it is handed to a builder. resource-types.json
 * in particular is read HERE AND ONLY HERE — src/build/header.js used to open
 * it a second time with its own fs call and its own rules, and now takes
 * ctx.model.resourceTypes like every other consumer.
 */
function load(config) {
  const src = config.paths.content;

  const guides = validateGuides(
    readJsonArray(src.guides, "guides.json"),
    "guides.json",
  );
  const rawPalettes = readJsonArray(src.palettes, "palettes-data.json");
  const paletteMeta = readJsonArray(src.palettesMeta, "palettes-meta.json");
  const colors = validateColors(
    readJsonArray(src.colors, "colors-data.json"),
    "colors-data.json",
    config,
  );
  const fonts = validateFonts(
    readJsonArray(src.fonts, "fonts.json"),
    "fonts.json",
    config,
  );
  const categories = validateCategories(
    readJsonArray(src.categories, "categories.json"),
    "categories.json",
  );
  const resourceTypes = validateResourceTypes(
    JSON.parse(fs.readFileSync(src.resourceTypes, "utf8")),
    "resource-types.json",
  );

  const annotated = annotatePaletteMeta(rawPalettes, paletteMeta);

  // PHASE 4 STEP 7: the pages are loaded first and then given their
  // structured data, because composing it needs categories.json as well —
  // a guide's breadcrumb trail and articleSection are named by its category.
  const guidePages = attachGuideStructuredData(
    loadGuidePages(src.guidePages, guides, config.origin),
    guides,
    categories,
    config,
  );

  return {
    guides,
    guidePages,
    palettes: annotated.palettes,
    /**
     * PHASE 4 STEP 10: the Color Library, loaded and shape-checked like every other
     * content source. It feeds no page BUILDER — colors/index.html is a
     * committed page and the grid is rendered in the browser — so the model
     * carries it for exactly two reasons: the `load` stage asserts its
     * contract against site.config.js before anything is written, and
     * src/build/colors-data.test.js reads it through this loader rather than
     * opening the file itself. See F10 in the Step 10 handoff for why the
     * 300 colours are deliberately NOT in content-index.json.
     */
    colors,
    /**
     * FONTS: validated against the contract and the files on disk. Feeds
     * src/build/fonts.js, which writes /fonts/ and every /fonts/<id>.html,
     * and src/build/routes.js, which derives those routes from it. Not part
     * of content-index.json — the F9 contract fixes that index at guides and
     * palettes.
     */
    fonts,
    categories,
    resourceTypes,
    warnings: annotated.warnings.slice(),
  };
}

/**
 * Builds the content-index records from a loaded model, applying the F9
 * palette filter from site.config.js.
 */
function buildContentIndex(model, config) {
  const categorySlugs = new Set(model.categories.map((c) => c.slug));
  const warnings = [];

  const indexedPalettes = config.contentIndex.indexedPalettes(model.palettes);

  const records = []
    .concat(buildGuideRecords(model.guides, categorySlugs, warnings))
    .concat(buildPaletteRecords(indexedPalettes));

  const seen = new Set();
  records.forEach(function (r) {
    if (seen.has(r.id)) throw new Error(`Duplicate content-index id: ${r.id}`);
    seen.add(r.id);
  });

  return { records, warnings };
}

module.exports = {
  load,
  buildContentIndex,
  loadGuidePages,
  GUIDE_PAGES_INDEX,

  // Phase 4 Step 7 — guide structured data, composed once in load()
  attachGuideStructuredData,
  metaDescriptionOf,

  // the content schema, stated once and applied in load()
  validateGuides,
  validateCategories,
  validateResourceTypes,
  validateColors,
  validateFonts,

  // content-index record vocabulary, re-exported by the render modules that
  // used to declare their own copies
  TYPE_BADGE_LABEL,
  tagsMetaFor,

  // exported for QA tooling and tests
  _internals: { annotatePaletteMeta, buildPaletteRecords, buildSearchText },
};
