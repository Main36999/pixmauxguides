#!/usr/bin/env node
/**
 * build-content-index.js
 * -----------------------------------------------------------------------
 * Phase 2 ("Build content index") of bpozz-content-architecture-spec-v2.md
 * and bpozz-global-search-spec-v2.md.
 *
 * Reads the three existing content sources —
 *   guides.json
 *   tokens.json
 *   palettes/palettes-data.json
 * — and writes one normalized, static discovery/search index:
 *   content-index.json
 *
 * This script does not change what any page renders. search.html, app.js,
 * build-home.js and build-categories.js still work exactly as they did
 * before this file existed — wiring them up to content-index.json is
 * Phase 3+ (see bpozz-global-search-spec-v2.md). This is only the
 * "shared discovery/search source" the spec calls for.
 *
 * RECORD SHAPE (bpozz-phase-1-handoff.md, "Starting point for Phase 2";
 * bpozz-global-search-spec-v2.md §7):
 *   { id, type, title, slug, url, description, categories, tags,
 *     keywords, searchText }
 * `id` is prefixed by type: "guide:<slug>", "token:<slug>", "palette:<id>".
 *
 * GUIDES
 * categories[] already exists on every guides.json entry (Phase 1). The
 * normalizeCategories() helper from bpozz-content-architecture-spec-v2.md
 * §12 is applied anyway, as a fallback to the legacy `category` string —
 * this is its first real call site (Phase 1 left it unwritten because
 * nothing read categories[] yet). guides.json has no tags/keywords
 * fields, so both come out as [] rather than being invented.
 *
 * TOKENS
 * tokens.json has no categories field at all. Every token gets the same
 * fixed pair, ["color-theory", "systems"] — decided in Phase 1
 * (bpozz-phase-1-handoff.md): the site's own guides already split the
 * "tokens" topic across exactly those two categories, and there is no
 * per-token classification that would do better than that.
 *
 * PALETTES
 * palettes-data.json records are just {id, colors[4], likes, createdAt}
 * — no title, description, tags, or category of their own. Each palette
 * is matched to its "twin" Token by comparing the palette's 4 hex colors
 * against that token's background/surface/primary/secondary colors
 * (case-insensitively) — NOT by array position, since the two source
 * files are not guaranteed to stay in the same order. All 40 palettes in
 * the current data matched exactly one token 1:1 (see the Phase 2
 * handoff for the validation run). A palette inherits its twin token's
 * title, description, categories, and tags. Its url is a deep link into
 * the existing /palettes gallery, `/palettes#<id>` — palettes/palettes.js
 * reads that hash on load and scrolls to + highlights the matching card
 * (small additive change made alongside this script; see that file).
 *
 * A Token and its twin Palette intentionally produce two separate
 * records (same inherited title, different id/type/url) — Phase 3's
 * search UI is expected to show them as two rows, not merge them.
 *
 * PHASE 5 ADDITION — optional display/sort fields
 * The homepage's build-time resource sections (build-home.js, driven by
 * resource-types.json) need a swatch preview, a "latest" sort and a
 * "popular" sort. Three OPTIONAL fields are appended after searchText,
 * and each is emitted ONLY on records whose source data actually has it
 * — nothing is invented, seeded, or defaulted:
 *   colors      tokens: hex values in canonical role order (ROLE_ORDER
 *               below: background, surface, primary, secondary, accent,
 *               text, border; any other role after, in source order).
 *               palettes: the 4 hex values exactly as stored.
 *   date        tokens: created_at. palettes: createdAt. (Both are what
 *               the /tokens and /palettes galleries' own "New" sorts use.)
 *   popularity  tokens only: tokens.json `popularity`, the value /tokens'
 *               own "Popular" sort uses. Palettes get no popularity —
 *               their static `likes` are only a seed; /palettes' "Popular"
 *               sort reads live Firebase counts, which don't exist at
 *               build time.
 * Guides get none of the three (guides.json has no colors/date/
 * popularity). None of them is added to searchText, and neither
 * search.html (Phase 3) nor build-categories.js (Phase 4) reads them, so
 * scoring and category rails are unaffected.
 *
 * USAGE
 *   node build-content-index.js
 * -----------------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const GUIDES_JSON_PATH = path.join(ROOT, "guides.json");
const TOKENS_JSON_PATH = path.join(ROOT, "tokens.json");
const PALETTES_JSON_PATH = path.join(ROOT, "palettes", "palettes-data.json");
const CATEGORIES_JSON_PATH = path.join(ROOT, "categories.json");
const OUTPUT_PATH = path.join(ROOT, "content-index.json");

// Fixed category pair every Token/Palette record gets — see the TOKENS
// note above and bpozz-phase-1-handoff.md.
const TOKEN_PALETTE_CATEGORIES = ["color-theory", "systems"];

// Phase 5 — canonical role order for a token record's optional `colors`
// field. The first four are the same background/surface/primary/secondary
// roles tokenColorKey() uses to match a palette to its twin token, so
// colors.slice(0, 4) on a token record lines up with its twin palette's
// colors (build-home.js relies on this for twin exclusion).
const ROLE_ORDER = [
  "background",
  "surface",
  "primary",
  "secondary",
  "accent",
  "text",
  "border",
];

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

function readJsonArray(filePath, label) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`${label} did not contain a JSON array (${filePath})`);
  }
  return data;
}

// Ported verbatim from bpozz-content-architecture-spec-v2.md §12. First
// real call site — see bpozz-phase-1-handoff.md ("Write the
// normalization helper here").
function normalizeCategories(item) {
  return Array.isArray(item.categories)
    ? item.categories
    : item.category
      ? [item.category]
      : [];
}

// Search-text normalization per bpozz-global-search-spec-v2.md §10 —
// trim, collapse whitespace, lowercase — applied here to the text being
// indexed. The query gets the same treatment at search time (Phase 3),
// so both sides compare on equal footing.
function normalize(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// "color-palette-token-system" -> "color palette token system", so a
// hyphenated slug is still term-searchable on its own words.
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
  // Several source fields legitimately overlap (a token's own `tags`
  // are largely its `family`/`moods`/`lightness` restated — see
  // generate-palettes.js), so dedupe words rather than shipping a
  // searchText that repeats "cool night dark" twice. Order-preserving.
  const seen = new Set();
  const words = normalized.split(" ").filter(function (w) {
    if (!w || seen.has(w)) return false;
    seen.add(w);
    return true;
  });
  return words.join(" ");
}

// Case-insensitive hex compare ("#1E193B" vs "#1e193b").
function hexKey(hex) {
  return String(hex || "")
    .trim()
    .toLowerCase();
}

// Phase 5 — optional display/sort fields. Each helper returns undefined
// when the source has no such value, and addOptionalFields() only copies
// defined values onto the record, so unsupported fields are omitted
// rather than written as invented defaults.
function tokenColorsInRoleOrder(token) {
  if (!Array.isArray(token.colors)) return undefined;
  const withHex = token.colors.filter(function (c) {
    return c && typeof c.hex === "string" && c.hex;
  });
  if (!withHex.length) return undefined;
  const rank = function (c) {
    const i = ROLE_ORDER.indexOf(c.role);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  // Array.prototype.sort is stable, so unknown roles keep source order.
  return withHex
    .slice()
    .sort(function (a, b) {
      return rank(a) - rank(b);
    })
    .map(function (c) {
      return c.hex;
    });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function addOptionalFields(record, fields) {
  Object.keys(fields).forEach(function (key) {
    if (fields[key] !== undefined) record[key] = fields[key];
  });
  return record;
}

// ---------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------

function buildGuideRecords(guides, categorySlugs) {
  return guides.map(function (g) {
    const categories = normalizeCategories(g);
    categories.forEach(function (slug) {
      if (!categorySlugs.has(slug)) {
        console.warn(
          `⚠ guide "${g.id}" references unknown category "${slug}" — kept as-is, but categories.json has no such slug.`,
        );
      }
    });
    // Not present in guides.json today — left as [] rather than invented.
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

    // OPTIONAL display field, same rule as the token/palette ones above:
    // emitted only when guides.json actually carries it, never invented or
    // defaulted. `thumbnail` is the guide's card image path, which
    // search.html needs so a Guide result can render the real thumbnail
    // through app.js's existing renderer instead of the category SVG
    // placeholder on its own. Not added to searchText, so scoring and
    // matching are untouched.
    return addOptionalFields(record, {
      thumbnail: nonEmptyString(g.thumbnail),
    });
  });
}

// ---------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------

function buildTokenRecords(tokens) {
  return tokens.map(function (t) {
    const roles = Array.isArray(t.colors)
      ? t.colors
          .map(function (c) {
            return c.role;
          })
          .filter(Boolean)
      : [];
    const tags = Array.isArray(t.tags) ? t.tags : [];
    const moods = Array.isArray(t.moods) ? t.moods : [];

    const record = {
      id: `token:${t.slug}`,
      type: "token",
      title: t.name || t.slug,
      slug: t.slug,
      url: `/tokens/${t.slug}.html`,
      // tokens.json has no description field — left empty rather than
      // invented (bpozz-global-search-spec-v2.md §7: "do not invent
      // metadata that does not exist").
      description: t.description || "",
      categories: TOKEN_PALETTE_CATEGORIES.slice(),
      tags: tags,
      keywords: [],
      // Per §9: name, slug, family, moods, lightness, tags, color roles —
      // hex values deliberately excluded ("do not over-index raw
      // technical values if they create noisy results").
      searchText: buildSearchText([
        t.name,
        wordsFromSlug(t.slug),
        t.family,
        moods,
        t.lightness,
        tags,
        roles,
      ]),
    };

    // Phase 5 optional fields — see the header note.
    return addOptionalFields(record, {
      colors: tokenColorsInRoleOrder(t),
      date: nonEmptyString(t.created_at),
      popularity: finiteNumber(t.popularity),
    });
  });
}

// The 4-value key used to match a palette's colors to a token's named
// roles: background/surface/primary/secondary, in that fixed order.
function tokenColorKey(token) {
  if (!Array.isArray(token.colors)) return null;
  const byRole = {};
  token.colors.forEach(function (c) {
    byRole[c.role] = hexKey(c.hex);
  });
  const roles = ["background", "surface", "primary", "secondary"];
  if (
    !roles.every(function (r) {
      return byRole[r];
    })
  ) {
    return null;
  }
  return roles
    .map(function (r) {
      return byRole[r];
    })
    .join("|");
}

// ---------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------

function buildPaletteRecords(palettes, tokens) {
  const tokenByColorKey = new Map();
  const firstSlugForKey = new Map();
  tokens.forEach(function (t) {
    const key = tokenColorKey(t);
    if (!key) return;
    if (firstSlugForKey.has(key)) {
      console.warn(
        `⚠ tokens "${firstSlugForKey.get(key)}" and "${t.slug}" share identical background/surface/primary/secondary colors — palette matching may be ambiguous between them.`,
      );
    } else {
      firstSlugForKey.set(key, t.slug);
    }
    // Last one wins on a collision; the warning above is what actually
    // flags the ambiguity so it gets looked at, rather than silently
    // resolving it one way.
    tokenByColorKey.set(key, t);
  });

  return palettes.map(function (p) {
    const paletteKey = Array.isArray(p.colors)
      ? p.colors.map(hexKey).join("|")
      : null;
    const twin = paletteKey ? tokenByColorKey.get(paletteKey) : null;

    if (!twin) {
      console.warn(
        `⚠ palette "${p.id}" has no matching token (compared background/surface/primary/secondary hex values) — title/description/categories/tags left empty rather than guessed.`,
      );
    }

    const title = twin ? twin.name || twin.slug : p.id;
    const description = twin ? twin.description || "" : "";
    const categories = twin ? TOKEN_PALETTE_CATEGORIES.slice() : [];
    const tags = twin && Array.isArray(twin.tags) ? twin.tags : [];
    const moods = twin && Array.isArray(twin.moods) ? twin.moods : [];

    const record = {
      id: `palette:${p.id}`,
      type: "palette",
      title: title,
      slug: p.id,
      url: `/palettes#${p.id}`,
      description: description,
      categories: categories,
      tags: tags,
      keywords: [],
      // Per §9: name, slug/id, tags, family/mood fields "if present" —
      // present here only via the twin token, same as title/description.
      searchText: buildSearchText([
        title,
        wordsFromSlug(p.id),
        tags,
        twin ? twin.family : null,
        moods,
        twin ? twin.lightness : null,
      ]),
    };

    // Phase 5 optional fields — see the header note. No popularity: the
    // palette gallery's "Popular" sort uses live Firebase likes, not data
    // available at build time.
    const colors =
      Array.isArray(p.colors) &&
      p.colors.length &&
      p.colors.every(function (hex) {
        return typeof hex === "string" && hex;
      })
        ? p.colors.slice()
        : undefined;
    return addOptionalFields(record, {
      colors: colors,
      date: nonEmptyString(p.createdAt),
    });
  });
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

function main() {
  const guides = readJsonArray(GUIDES_JSON_PATH, "guides.json");
  const tokens = readJsonArray(TOKENS_JSON_PATH, "tokens.json");
  const palettes = readJsonArray(PALETTES_JSON_PATH, "palettes-data.json");
  const categories = readJsonArray(CATEGORIES_JSON_PATH, "categories.json");
  const categorySlugs = new Set(
    categories.map(function (c) {
      return c.slug;
    }),
  );

  const records = []
    .concat(buildGuideRecords(guides, categorySlugs))
    .concat(buildTokenRecords(tokens))
    .concat(buildPaletteRecords(palettes, tokens));

  const seenIds = new Set();
  records.forEach(function (r) {
    if (seenIds.has(r.id)) {
      throw new Error(`Duplicate content-index id: ${r.id}`);
    }
    seenIds.add(r.id);
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(records, null, 2) + "\n");

  const counts = {};
  records.forEach(function (r) {
    counts[r.type] = (counts[r.type] || 0) + 1;
  });
  console.log(
    `✓ content-index.json written — ${records.length} records ` +
      `(${counts.guide || 0} guides, ${counts.token || 0} tokens, ${counts.palette || 0} palettes).`,
  );
}

main();
