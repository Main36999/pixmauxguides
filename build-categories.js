#!/usr/bin/env node
/**
 * build-categories.js
 * -----------------------------------------------------------------------
 * Generates one standalone, crawlable archive page per category —
 * category/color-theory.html, category/typography.html, etc. — from
 * guides.json. Each page is a resourceboy.com/fonts/-style listing: a
 * short title + one-line description, then the SAME
 * .guides-main/.grid/.guide-card markup the homepage grid uses
 * (cardHtml() below is ported 1:1 from build-home.js — keep the two in
 * sync the same way build-home.js already keeps itself in sync with
 * app.js's client-side renderer; see the note at the top of that file).
 *
 * WHY THIS EXISTS
 * Header/trending-card links to a category (e.g. "Color Theory") used
 * to carry data-jump-category and just re-filter the homepage grid in
 * place via app.js — a real navigation only on pages other than
 * index.html, and never a page of its own. That meant a category had no
 * stable, linkable, indexable URL. These pages give it one, modeled on
 * resourceboy.com's own category archives (a plain breadcrumb, heading,
 * and the same card grid — no separate design system).
 *
 * Unlike build-home.js (which patches markers inside an existing
 * index.html), this script writes each category page's full HTML from
 * scratch every run — these files don't exist until generated. It reads
 * partials/header.html and partials/footer.html directly (already
 * authored "one level deep", i.e. exactly as a /guide/*.html or
 * /category/*.html page needs them) and embeds them verbatim inside the
 * usual HEADER_START/END and FOOTER_START/END marker comments, so a
 * later `node build-header.js` / `node build-footer.js` run can still
 * resync these pages the normal way if the partials change.
 *
 * USAGE
 *   node build-categories.js
 *
 * Run alongside build-home.js/build-header.js/build-footer.js any time
 * guides.json or the header/footer partials change, before you
 * deploy/commit.
 *
 * PHASE 4 ADDITION — Tokens/Palettes preview rails
 * Each page's Guide grid above is unchanged. Below it, this script now
 * optionally appends up to two more sections — "related_tokens" and
 * "related_palettes" — built from /content-index.json (Phase 2's
 * generated index, already used by search.html since Phase 3), filtered
 * to records whose `categories[]` includes this page's slug. Every
 * Token and Palette currently carries the fixed pair
 * ["color-theory", "systems"] (see build-content-index.js), so today
 * only those two category pages gain a section; the other 8 render
 * exactly as before — no section markup is emitted when there are no
 * matching records, mirroring how this file already skips writing a
 * page for a category with zero guides, and how app.js's
 * initRelatedGuides() removes its own rail <aside> when empty rather
 * than leaving a blank box.
 *
 * Preview size and ordering deliberately reuse two decisions the
 * codebase already made elsewhere, instead of inventing new ones:
 *   - Cap of 10 — the same number app.js's related-guides rail shows
 *     on every /guide/ page (see "Shows up to 10" in app.js).
 *   - Order — content-index.json preserves tokens.json's and
 *     palettes-data.json's own record order, and both source files are
 *     already stored newest-first (verified: matches each file's
 *     `created_at`/`createdAt` sorted descending). That's also each
 *     record's default "New" sort on /tokens and /palettes. So taking
 *     the first N of the filtered list is already "the 10 newest," no
 *     extra date-sorting logic needed here.
 * This does not touch tokens.json or palettes/palettes-data.json —
 * content-index.json's normalized {title, url, categories, tags} is
 * sufficient for a discovery preview card, per the search spec's own
 * "Search only needs a normalized representation of these records"
 * principle (§23), applied here to category pages instead of Search.
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const GUIDES_JSON_PATH = path.join(ROOT, "guides.json");
const CONTENT_INDEX_PATH = path.join(ROOT, "content-index.json");
const CATEGORY_DIR = path.join(ROOT, "category");
const HEADER_PARTIAL_PATH = path.join(ROOT, "partials", "header.html");
const FOOTER_PARTIAL_PATH = path.join(ROOT, "partials", "footer.html");

// Same cap app.js's related-guides rail uses (see the Phase 4 note
// above) — one shared constant so the two "preview size" decisions
// can't silently drift apart if either is changed later.
const RAIL_PREVIEW_LIMIT = 10;

// Matches search.html's own TYPE_LABELS map (Phase 3) — same wording
// for the same content types across both discovery surfaces.
const TYPE_BADGE_LABEL = { token: "Token", palette: "Palette" };

// ---------------------------------------------------------------------
// Ported 1:1 from app.js / build-home.js. Mirror any edit there here too.
// ---------------------------------------------------------------------

const CATEGORIES = {
  "color-theory": { label: "Color Theory", code: "COLOR_THEORY" },
  typography: { label: "Typography", code: "TYPOGRAPHY" },
  spacing: { label: "Spacing & Layout", code: "SPACING_LAYOUT" },
  figma: { label: "Figma Workflow", code: "FIGMA" },
  "adobe-xd": { label: "Adobe XD Workflow", code: "ADOBE_XD" },
  mobile: { label: "Mobile App Design", code: "MOBILE_APP" },
  web: { label: "Web Layout", code: "WEB_LAYOUT" },
  systems: { label: "Design Systems", code: "DESIGN_SYSTEMS" },
  accessibility: { label: "Accessibility", code: "ACCESSIBILITY" },
  motion: { label: "Prototyping & Motion", code: "PROTOTYPING" },
};

const THUMBS = {
  "color-theory": `
      <circle cx="102" cy="38" r="20"/>
      <circle cx="138" cy="38" r="20"/>
      <circle cx="120" cy="64" r="20"/>
    `,
  typography: `
      <line x1="60" y1="20" x2="180" y2="20" class="thumb-guide"/>
      <line x1="60" y1="78" x2="180" y2="78" class="thumb-guide"/>
      <text x="78" y="76" class="thumb-glyph">Aa</text>
    `,
  spacing: `
      <circle class="thumb-fill" cx="90" cy="24" r="3.4"/><circle class="thumb-fill" cx="120" cy="24" r="3.4"/><circle class="thumb-fill" cx="150" cy="24" r="3.4"/>
      <circle class="thumb-fill" cx="90" cy="44" r="3.4"/><circle class="thumb-fill" cx="120" cy="44" r="3.4"/><circle class="thumb-fill" cx="150" cy="44" r="3.4"/>
      <circle class="thumb-fill" cx="90" cy="64" r="3.4"/><circle class="thumb-fill" cx="120" cy="64" r="3.4"/><circle class="thumb-fill" cx="150" cy="64" r="3.4"/>
    `,
  figma: `
      <rect x="82" y="16" width="50" height="50" rx="6"/>
      <rect x="110" y="40" width="50" height="50" rx="6"/>
      <rect class="thumb-fill" x="107.5" y="37.5" width="5" height="5"/>
      <rect class="thumb-fill" x="157.5" y="37.5" width="5" height="5"/>
      <rect class="thumb-fill" x="107.5" y="87.5" width="5" height="5"/>
      <rect class="thumb-fill" x="157.5" y="87.5" width="5" height="5"/>
    `,
  "adobe-xd": `
      <path d="M70,86 L100,20 L130,60 L170,16"/>
      <circle class="thumb-fill" cx="100" cy="20" r="3.2"/>
      <circle class="thumb-fill" cx="130" cy="60" r="3.2"/>
      <circle class="thumb-handle-dot" cx="70" cy="86" r="3"/>
      <circle class="thumb-handle-dot" cx="170" cy="16" r="3"/>
      <line x1="100" y1="20" x2="85" y2="6" class="thumb-handle"/>
      <circle class="thumb-handle-dot" cx="85" cy="6" r="2.4"/>
    `,
  mobile: `
      <rect x="99" y="12" width="42" height="78" rx="7"/>
      <line x1="107" y1="24" x2="133" y2="24" stroke-width="1.2"/>
      <rect x="107" y="32" width="26" height="12" rx="2" stroke-width="1.2"/>
      <line x1="107" y1="50" x2="133" y2="50" stroke-width="1.2"/>
      <line x1="107" y1="56" x2="133" y2="56" stroke-width="1.2"/>
      <line x1="113" y1="84" x2="127" y2="84" stroke-width="2.2" stroke-linecap="round"/>
    `,
  web: `
      <rect x="50" y="18" width="140" height="70" rx="4"/>
      <line x1="50" y1="32" x2="190" y2="32" stroke-width="1.2"/>
      <circle class="thumb-fill" cx="60" cy="25" r="2"/>
      <circle class="thumb-fill" cx="68" cy="25" r="2"/>
      <circle class="thumb-fill" cx="76" cy="25" r="2"/>
      <rect x="58" y="40" width="26" height="40" stroke-width="1.2"/>
      <rect x="94" y="40" width="88" height="16" rx="1" stroke-width="1.2"/>
      <rect x="94" y="62" width="60" height="16" rx="1" stroke-width="1.2"/>
    `,
  systems: `
      <rect x="75" y="18" width="44" height="18" rx="4"/>
      <line x1="85" y1="27" x2="109" y2="27" stroke-width="1.2"/>
      <rect x="130" y="18" width="50" height="18" rx="2"/>
      <line x1="140" y1="23" x2="140" y2="31" stroke-width="1.2"/>
      <rect x="75" y="50" width="16" height="16" rx="3"/>
      <path d="M78,58 L82,62 L88,52" stroke-width="1.8"/>
      <line x1="98" y1="58" x2="150" y2="58" stroke-width="1.2"/>
    `,
  accessibility: `
      <path d="M65,44 Q100,18 135,44 Q100,70 65,44 Z"/>
      <circle cx="100" cy="44" r="10"/>
      <circle class="thumb-fill" cx="100" cy="44" r="3"/>
      <rect class="thumb-fill" x="152" y="60" width="9" height="14" style="opacity:.35"/>
      <rect class="thumb-fill" x="166" y="52" width="9" height="22" style="opacity:.65"/>
      <rect class="thumb-fill" x="180" y="44" width="9" height="30"/>
    `,
  motion: `
      <line x1="70" y1="18" x2="70" y2="88" stroke-width="1.2"/>
      <line x1="70" y1="88" x2="185" y2="88" stroke-width="1.2"/>
      <path d="M70,88 C110,80 145,28 185,20" stroke-width="1.8"/>
      <line x1="70" y1="88" x2="110" y2="80" class="thumb-handle"/>
      <line x1="185" y1="20" x2="145" y2="28" class="thumb-handle"/>
      <circle class="thumb-handle-dot" cx="110" cy="80" r="2.6"/>
      <circle class="thumb-handle-dot" cx="145" cy="28" r="2.6"/>
      <circle class="thumb-fill" cx="70" cy="88" r="3"/>
      <circle class="thumb-fill" cx="185" cy="20" r="3"/>
    `,
};

const THUMB_DIM_LABEL = {
  "color-theory": "4.5:1",
  typography: "16 / 24",
  spacing: "8 · 16 · 24",
  figma: "AUTO LAYOUT",
  "adobe-xd": "PEN TOOL",
  mobile: "375 × 812",
  web: "1440 × 900",
  systems: "DESIGN TOKENS",
  accessibility: "WCAG AA",
  motion: "EASE-OUT",
};

const LEVEL_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

// ---------------------------------------------------------------------
// Category-page-only metadata: a one-line description (used as the dek,
// meta description, and OG/Twitter description) and an OG image. Five
// categories already have a hero-ish image under /assets/ (used
// elsewhere for the homepage's trending cards) — reuse it here too;
// everything else falls back to the site's general /og-image.png.
// ---------------------------------------------------------------------

const CATEGORY_META = {
  "color-theory": {
    dek: "Color decisions that hold up to scrutiny: contrast ratios, token-based palettes, and systems that remap cleanly between light and dark.",
    ogImage: "/assets/Color Theory.png",
  },
  typography: {
    dek: "Type scale, hierarchy, and pairing decisions backed by formulas and measurable readability — not gut feel.",
    ogImage: "/assets/Typography.png",
  },
  spacing: {
    dek: "Space as a deliberate, systematic tool: padding vs. margin, whitespace as a UI component, and the token scale that keeps gaps consistent.",
    ogImage: "/assets/Spacing & Layout.png",
  },
  figma: {
    dek: "The mental models behind Figma's most misused features — Auto Layout, variables, and a clean handoff from design file to code.",
    ogImage: "/assets/Figma Workflow.png",
  },
  "adobe-xd": {
    dek: "Rebuilding a design workflow around Adobe XD's shutdown — what actually needs remaking, and what safely carries over.",
    ogImage: "/og-image.png",
  },
  mobile: {
    dek: "Designing for real devices: breakpoints as device categories, thumb zones, and where iOS and Android genuinely diverge.",
    ogImage: "/og-image.png",
  },
  web: {
    dek: "Responsive layout as a contract, not a breakpoint list — CSS Grid, fluid sizing, and the traps no toolbar preview catches.",
    ogImage: "/og-image.png",
  },
  systems: {
    dek: "Design tokens and naming conventions that survive a rebrand instead of drifting back into hardcoded values.",
    ogImage: "/og-image.png",
  },
  accessibility: {
    dek: "Accessibility as a structural decision made in markup and states, not a final pass before shipping.",
    ogImage: "/assets/Accessibility.png",
  },
  motion: {
    dek: "Motion timing backed by real physics — easing curves, duration, and when animation should exist at all.",
    ogImage: "/og-image.png",
  },
};

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

function dimLine(label) {
  const x1 = 64,
    x2 = 176,
    y = 99;
  return (
    `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="thumb-dim-line"/>` +
    `<line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}" class="thumb-dim-tick"/>` +
    `<line x1="${x2}" y1="${y - 4}" x2="${x2}" y2="${y + 4}" class="thumb-dim-tick"/>` +
    `<text x="${(x1 + x2) / 2}" y="${y + 13}" text-anchor="middle" class="thumb-dim-label">${escapeHtml(label)}</text>`
  );
}

function thumbMediaHtml(g) {
  const svg =
    `<svg viewBox="0 0 240 120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    THUMBS[g.category] +
    dimLine(THUMB_DIM_LABEL[g.category]) +
    `</svg>`;
  if (!g.thumbnail) return svg;
  const img = `<img src="${escapeHtml(g.thumbnail)}" alt="${escapeHtml(g.title)}" loading="lazy" onerror="this.style.display='none'">`;
  return svg + img;
}

function thumbHtml(g) {
  return `<div class="card-thumb">${thumbMediaHtml(g)}</div>`;
}

// Identical to build-home.js's cardHtml() — see the note at the top of
// this file for why the two copies must stay in sync.
function cardHtml(g) {
  const cat = CATEGORIES[g.category];
  const meta = `${cat.label} · ${LEVEL_LABEL[g.level]} · ${g.readTime} min read`;
  return (
    `<article class="guide-card">` +
    thumbHtml(g) +
    `<div class="card-body">` +
    `<h3 class="card-title"><a class="card-link" href="/guide/${g.id}">${escapeHtml(g.title)}</a></h3>` +
    `<p class="card-meta">${escapeHtml(meta)}</p>` +
    `</div></article>`
  );
}

// ---------------------------------------------------------------------
// Phase 4 — Tokens/Palettes preview rails (content-index.json)
// ---------------------------------------------------------------------

// Up to RAIL_PREVIEW_LIMIT content-index records of `type` whose
// categories[] includes `slug`, in the index's own order (see the
// Phase 4 note at the top of this file for why that order is already
// "newest first" and needs no re-sorting here).
function recordsForCategory(contentIndex, type, slug) {
  const matches = [];
  for (const record of contentIndex) {
    if (record.type !== type) continue;
    if (!Array.isArray(record.categories) || !record.categories.includes(slug)) continue;
    matches.push(record);
    if (matches.length >= RAIL_PREVIEW_LIMIT) break;
  }
  return matches;
}

// One tag list, Title Cased and joined — identical to search.html's
// snippetFor() fallback for Token/Palette records (neither type has a
// `description` in the index), reused here so the same record reads
// the same way on both discovery surfaces.
function tagsMetaFor(record) {
  if (!record.tags || !record.tags.length) return "";
  return record.tags
    .map(function (t) {
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(" · ");
}

// A lightweight, non-interactive preview card for a Token or Palette
// content-index record. Deliberately NOT tokens-shared.js's cardHtml()
// or palettes.js's cardHtml() — those render live like/save/copy
// controls backed by tokens-collection.js / Firebase, which this page
// never loads; embedding that markup here would ship dead buttons
// (spec §22–23: don't move that business logic into a system that
// doesn't own it). Instead this reuses the same plain
// .guide-card/.card-body/.card-title/.card-meta classes the Guide grid
// above already uses, plus .badge (already used by search.html) for
// the type label, so no new CSS is needed anywhere in this file.
function indexRecordCardHtml(record) {
  const badge = TYPE_BADGE_LABEL[record.type] || record.type;
  const meta = tagsMetaFor(record);
  return (
    `<article class="guide-card">` +
    `<span class="badge">${escapeHtml(badge)}</span>` +
    `<div class="card-body">` +
    `<h3 class="card-title"><a class="card-link" href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></h3>` +
    (meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : "") +
    `</div></article>`
  );
}

// One optional rail section. Returns "" (renders nothing) when there
// are no matching records — same "don't leave an empty box" behavior
// as this file's own guide-count check in main(), and as app.js's
// initRelatedGuides(), which removes its rail <aside> entirely when
// there's nothing relevant to show. Reuses .guide-rail/.guide-rail__
// label verbatim from styles.css's existing /guide/ page rail — a
// generic "labeled divider + grid" component despite its name, and the
// closest existing match to "capped preview section" in the codebase.
function railHtml(labelSlug, ariaLabel, records) {
  if (!records.length) return "";
  const cardsHtml = records.map(indexRecordCardHtml).join("");
  return (
    `<aside class="guide-rail" aria-label="${escapeHtml(ariaLabel)}">` +
    `<p class="section-label mono guide-rail__label">/ ${escapeHtml(labelSlug)}</p>` +
    `<div class="grid">${cardsHtml}</div>` +
    `</aside>`
  );
}

// ---------------------------------------------------------------------
// Page template
// ---------------------------------------------------------------------

function monoLabel(code) {
  return code.toLowerCase();
}

function pageHtml(slug, guides, tokenRecords, paletteRecords, headerPartial, footerPartial) {
  const cat = CATEGORIES[slug];
  const meta = CATEGORY_META[slug];
  const title = `${cat.label} Guides — bpozz`;
  const description = meta.dek;
  const canonical = `https://bpozz.com/category/${slug}`;
  const ogImage = meta.ogImage.startsWith("/")
    ? `https://bpozz.com${meta.ogImage}`
    : meta.ogImage;
  const cardsHtml = guides.map(cardHtml).join("");
  const count = guides.length;
  const tokensRailHtml = railHtml("related_tokens", "Related tokens", tokenRecords);
  const palettesRailHtml = railHtml("related_palettes", "Related palettes", paletteRecords);
  // Concatenated (not just interpolated separately) so that when both
  // are "" — every category except color-theory/systems today — this
  // page's markup is byte-identical to before the Phase 4 change: no
  // stray blank lines left behind for the 8 unaffected category pages.
  const railsHtml = tokensRailHtml + palettesRailHtml;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${cat.label} Guides`,
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "bpozz", url: "https://bpozz.com/" },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://bpozz.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Guides",
          item: "https://bpozz.com/guides",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: cat.label,
          item: canonical,
        },
      ],
    },
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <script
      id="Cookiebot"
      src="https://consent.cookiebot.com/uc.js"
      data-cbid="585f3600-2a77-4ba9-87f7-9aac44c21247"
      data-blockingmode="auto"
      type="text/javascript"
    ></script>

    <script data-cookieconsent="ignore">
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag("consent", "default", {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        functionality_storage: "denied",
        personalization_storage: "denied",
        security_storage: "granted",
        wait_for_update: 500,
      });
      gtag("set", "ads_data_redaction", true);
      gtag("set", "url_passthrough", false);
    </script>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />

    <!-- Google tag (gtag.js) -->
    <script
      async
      src="https://www.googletagmanager.com/gtag/js?id=G-NHGHCTY21D"
    ></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag("js", new Date());

      gtag("config", "G-NHGHCTY21D");
    </script>

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="bpozz" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@bpozz" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

    <meta name="theme-color" content="#0F2A52" />
    <link rel="icon" type="image/png" href="/assets/favicon.png" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="../styles.css" />

    <script type="application/ld+json">
      ${JSON.stringify(jsonLd, null, 2)}
    </script>
  </head>
  <body class="category-page" data-category="${slug}">
    <a href="#category-content" class="skip-link">Skip to guides</a>

    <!--HEADER_START-->${headerPartial}<!--HEADER_END-->

    <main class="wrap guides-main" id="category-content" tabindex="-1">
      <div class="category-hero">
        <p class="section-label mono">/ ${monoLabel(cat.code)}</p>
        <h1 class="category-hero__title">${escapeHtml(cat.label)}</h1>
        <p class="category-hero__dek">${escapeHtml(description)}</p>
      </div>
      <div class="section-head">
        <p class="results-count">Showing ${count} of ${count} guide${count === 1 ? "" : "s"}</p>
      </div>
      <div class="grid">${cardsHtml}</div>${railsHtml ? `\n      ${railsHtml}` : ""}
    </main>

    <!--FOOTER_START-->${footerPartial}<!--FOOTER_END-->

    <script src="../app.js"></script>
  </body>
</html>
`;
}

function main() {
  const guides = JSON.parse(fs.readFileSync(GUIDES_JSON_PATH, "utf8"));
  if (!Array.isArray(guides)) {
    throw new Error("guides.json did not contain an array");
  }
  // Phase 4: content-index.json (Phase 2's generated index) drives the
  // Tokens/Palettes preview rails below. Read-only — never written by
  // this script. Not treated as optional/best-effort: it's committed,
  // reproducible build output (see bpozz-phase-2/3-handoff.md), so a
  // missing or malformed file here means the build is out of order,
  // and this should fail loudly the same way a missing guides.json
  // would rather than silently rendering pages with no rails at all.
  const contentIndex = JSON.parse(fs.readFileSync(CONTENT_INDEX_PATH, "utf8"));
  if (!Array.isArray(contentIndex)) {
    throw new Error("content-index.json did not contain an array");
  }
  const headerPartial = fs.readFileSync(HEADER_PARTIAL_PATH, "utf8").trim();
  const footerPartial = fs.readFileSync(FOOTER_PARTIAL_PATH, "utf8").trim();

  if (!fs.existsSync(CATEGORY_DIR)) {
    fs.mkdirSync(CATEGORY_DIR);
  }

  const bySlug = new Map();
  for (const slug of Object.keys(CATEGORIES)) bySlug.set(slug, []);
  for (const g of guides) {
    if (!bySlug.has(g.category)) {
      console.warn(`⚠ guides.json has unknown category "${g.category}" (guide "${g.id}") — skipped.`);
      continue;
    }
    bySlug.get(g.category).push(g);
  }

  let written = 0;
  for (const slug of Object.keys(CATEGORIES)) {
    const guidesInCategory = bySlug.get(slug);
    if (guidesInCategory.length === 0) {
      console.warn(`⚠ Category "${slug}" has no guides — skipping page.`);
      continue;
    }
    const tokenRecords = recordsForCategory(contentIndex, "token", slug);
    const paletteRecords = recordsForCategory(contentIndex, "palette", slug);
    const html = pageHtml(slug, guidesInCategory, tokenRecords, paletteRecords, headerPartial, footerPartial);
    fs.writeFileSync(path.join(CATEGORY_DIR, `${slug}.html`), html);
    written++;
  }

  console.log(`✓ Category pages written — ${written} page${written === 1 ? "" : "s"} in /category.`);
}

main();
