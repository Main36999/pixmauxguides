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
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const GUIDES_JSON_PATH = path.join(ROOT, "guides.json");
const CATEGORY_DIR = path.join(ROOT, "category");
const HEADER_PARTIAL_PATH = path.join(ROOT, "partials", "header.html");
const FOOTER_PARTIAL_PATH = path.join(ROOT, "partials", "footer.html");

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
// Page template
// ---------------------------------------------------------------------

function monoLabel(code) {
  return code.toLowerCase();
}

function pageHtml(slug, guides, headerPartial, footerPartial) {
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
          name: "All Guides",
          item: "https://bpozz.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
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
      <div class="grid">${cardsHtml}</div>
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
    const html = pageHtml(slug, guidesInCategory, headerPartial, footerPartial);
    fs.writeFileSync(path.join(CATEGORY_DIR, `${slug}.html`), html);
    written++;
  }

  console.log(`✓ Category pages written — ${written} page${written === 1 ? "" : "s"} in /category.`);
}

main();
