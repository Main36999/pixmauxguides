#!/usr/bin/env node
/**
 * build-tokens.js
 * -----------------------------------------------------------------------
 * Generates the whole /tokens feature from tokens.json:
 *   - /tokens/index.html       gallery (grid pre-rendered, JS filters/sorts)
 *   - /tokens/create.html      builder (manual + image-extraction modes)
 *   - /tokens/collection.html  the visitor's saved palettes (localStorage)
 *   - /tokens/<slug>.html      one static detail page per palette (40 files)
 *
 * Follows the exact precedent build-categories.js already set for this
 * codebase: pages that don't exist until generated are written from
 * scratch (not patched via markers like build-home.js does to
 * index.html), using the same head-boilerplate shape (Cookiebot, gtag,
 * OG/Twitter meta, JSON-LD, font preconnects), and reading
 * partials/header.html / partials/footer.html directly so a later
 * `node build-header.js` / `node build-footer.js` run can still resync
 * these pages the normal way if the partials change.
 *
 * Every number on every generated page — contrast ratios, WCAG badges,
 * RGB/HSL values, the accessibility score — comes from tokens-a11y.js /
 * tokens-color.js / tokens-export.js at build time, not from tokens.json
 * being trusted blindly. That's deliberate belt-and-suspenders: even
 * though scripts/generate-palettes.js already computed these same
 * numbers when it wrote tokens.json, recomputing them here means a
 * manually-edited tokens.json (someone hand-adding a 41st palette)
 * can't silently ship a wrong badge.
 *
 * USAGE
 *   node scripts/generate-palettes.js   (only if tokens.json needs regenerating)
 *   node build-tokens.js
 *   node build-header.js && node build-footer.js   (sync nav into the new pages)
 * -----------------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");
const BpozzColor = require("./tokens-color.js");
const BpozzA11y = require("./tokens-a11y.js");
const BpozzExport = require("./tokens-export.js");
const BpozzTokens = require("./tokens-shared.js");

const ROOT = __dirname;
const TOKENS_JSON_PATH = path.join(ROOT, "tokens.json");
const TOKENS_DIR = path.join(ROOT, "tokens");
const HEADER_PARTIAL_PATH = path.join(ROOT, "partials", "header.html");
const FOOTER_PARTIAL_PATH = path.join(ROOT, "partials", "footer.html");
const SITE_URL = "https://bpozz.com";

const ROLE_ORDER = ["background", "surface", "primary", "secondary", "accent", "text", "border"];

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}
function orderedColors(colors) {
  const byRole = BpozzTokens.byRole(colors);
  return ROLE_ORDER.filter((r) => byRole[r]).map((r) => ({ role: r, hex: byRole[r] }));
}

// ---------------------------------------------------------------------
// Page shell — the shared <head>/<body> scaffolding every /tokens page
// uses. Mirrors build-categories.js's pageHtml() head block field for
// field (Cookiebot, gtag, OG/Twitter, theme-color, fonts, styles.css).
// ---------------------------------------------------------------------
function pageShell(opts) {
  const {
    title,
    description,
    canonical,
    ogImage = `${SITE_URL}/og-image.png`,
    bodyClass = "",
    bodyAttrs = "",
    skipLinkHref = "#tokens-content",
    skipLinkLabel = "Skip to content",
    headerPartial,
    footerPartial,
    mainHtml,
    jsonLd = null,
    depthPrefix = "../",
    extraScripts = [],
  } = opts;

  const jsonLdBlock = jsonLd
    ? `\n    <script type="application/ld+json">\n      ${JSON.stringify(jsonLd, null, 2)}\n    </script>`
    : "";

  const scriptTags = extraScripts.map((src) => `    <script src="${src}"></script>`).join("\n");

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
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-NHGHCTY21D"></script>
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
    <link rel="stylesheet" href="${depthPrefix}styles.css" />
    <link rel="stylesheet" href="${depthPrefix}guide-article.css" />
    <link rel="stylesheet" href="${depthPrefix}tokens.css" />${jsonLdBlock}
  </head>
  <body class="${bodyClass}"${bodyAttrs ? " " + bodyAttrs : ""}>
    <a href="${skipLinkHref}" class="skip-link">${escapeHtml(skipLinkLabel)}</a>

    <!--HEADER_START-->${headerPartial}<!--HEADER_END-->

${mainHtml}

    <!--FOOTER_START-->${footerPartial}<!--FOOTER_END-->

    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <script src="${depthPrefix}app.js"></script>
${scriptTags}
  </body>
</html>
`;
}

// ---------------------------------------------------------------------
// Related-guides module (brief §3.3): always the contrast + token-
// system guides, plus the dark-mode guide when a variant actually
// exists, or the naming-system guide (also about token structure) when
// it doesn't — either way, three real, contextually-picked links.
// ---------------------------------------------------------------------
function relatedGuidesFor(p) {
  const links = [
    {
      href: "/guide/color-contrast-systems#the-numbers",
      label: "Accessibility",
      title: "Color Contrast Is Math, Not Taste",
    },
    {
      href: "/guide/color-palette-token-system#three-tiers",
      label: "Token structure",
      title: "A Color Palette Is a Token System, Not a Row of Swatches",
    },
  ];
  if (p.dark_variant_slug || p.light_variant_slug) {
    links.push({
      href: "/guide/dark-mode-second-palette#dark-surface-ramp",
      label: "Dark mode",
      title: "Dark Mode Is a Second Palette, Not an Inverted One",
    });
  } else {
    links.push({
      href: "/guide/design-tokens-naming-system#dtcg",
      label: "Token naming",
      title: "Design Tokens Need a Naming System, Not Just Names",
    });
  }
  return links;
}
function relatedGuidesHtml(p) {
  return relatedGuidesFor(p)
    .map(
      (g) =>
        `<a href="${g.href}"><span class="token-related__label">${escapeHtml(g.label)}</span><span class="token-related__title">${escapeHtml(g.title)}</span></a>`,
    )
    .join("");
}

// ---------------------------------------------------------------------
// Breakdown table (brief §3.3): role, hex, RGB, HSL, contrast vs white,
// contrast vs black, WCAG badge. The badge reflects the BETTER of the
// two ratios — i.e. "if you paired this color with whichever of pure
// black/white reads better on it, how far would that get you" — noted
// in the table caption so the choice is legible, not implicit.
// ---------------------------------------------------------------------
function breakdownRowHtml(c) {
  const rgb = BpozzColor.hexToRgb(c.hex);
  const hsl = BpozzColor.hexToHsl(c.hex);
  const vsWhite = BpozzA11y.contrastRatio(c.hex, "#ffffff");
  const vsBlack = BpozzA11y.contrastRatio(c.hex, "#000000");
  const bestRatio = Math.max(vsWhite, vsBlack);
  const badge = BpozzA11y.wcagBadge(bestRatio);
  const wcagClass = badge === "Fail" || badge === "—" ? "token-wcag-fail" : "token-wcag-pass";
  return `<tr>
        <td><span class="token-breakdown__swatch" style="background:${c.hex}"></span><span class="token-breakdown__role">${escapeHtml(BpozzTokens.roleLabel(c.role))}</span></td>
        <td class="mono">${c.hex}</td>
        <td class="mono">${rgb.r}, ${rgb.g}, ${rgb.b}</td>
        <td class="mono">${hsl.h}°, ${hsl.s}%, ${hsl.l}%</td>
        <td class="mono">${BpozzA11y.formatRatio(vsWhite)}</td>
        <td class="mono">${BpozzA11y.formatRatio(vsBlack)}</td>
        <td class="mono ${wcagClass}">${badge}</td>
      </tr>`;
}
function breakdownTableHtml(colors) {
  return `<div class="token-breakdown-wrap">
      <table class="token-breakdown">
        <caption>WCAG badge reflects the stronger of the two pairings — the best case if this color met pure black or pure white.</caption>
        <thead>
          <tr><th>Role</th><th>Hex</th><th>RGB</th><th>HSL</th><th>vs. White</th><th>vs. Black</th><th>WCAG</th></tr>
        </thead>
        <tbody>
          ${colors.map(breakdownRowHtml).join("\n          ")}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------
// Live preview (brief §3.3): a small mock UI rendered with the
// palette's own CSS custom properties, so the palette is shown in use.
// ---------------------------------------------------------------------
function previewHtml(colors, id) {
  const style = BpozzTokens.cssVarsStyle(colors);
  return `<div class="token-preview" id="${id}" style="${style}">
      <span class="token-preview__eyebrow">Component preview</span>
      <div class="token-preview__card">
        <h3>Weekly digest</h3>
        <p>A short summary of what changed, rendered with this palette's own tokens — not a swatch strip.</p>
        <button type="button" class="token-preview__button">Read more</button>
        <a href="#" class="token-preview__link" onclick="return false">Dismiss</a>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Export panel (brief §3.3): one tab per BpozzExport.FORMATS entry,
// content precomputed at build time (no client-side generation needed
// on the detail page — only tab switching + copy, handled by
// tokens-detail.js).
// ---------------------------------------------------------------------
function exportPanelHtml(colors, paletteName) {
  const tabs = BpozzExport.FORMATS.map(
    (f, i) =>
      `<button type="button" class="token-export__tab" data-tab="${f.id}" role="tab" aria-selected="${i === 0}">${escapeHtml(f.label)}</button>`,
  ).join("");
  const panels = BpozzExport.FORMATS.map((f, i) => {
    const code = f.id === "figma" ? f.generate(colors, paletteName) : f.generate(colors, paletteName);
    return `<div class="token-export__panel" data-panel="${f.id}" data-active="${i === 0}">
        <button type="button" class="btn btn-primary token-export__copy" data-copy-format="${f.id}">Copy</button>
        <pre><code class="language-${f.lang}">${escapeHtml(code)}</code></pre>
      </div>`;
  }).join("\n      ");
  return `<div class="token-export" id="export">
      <div class="token-export__tabs" role="tablist">${tabs}</div>
      ${panels}
    </div>`;
}

// ---------------------------------------------------------------------
// Detail page (/tokens/<slug>.html)
// ---------------------------------------------------------------------
function detailPageHtml(p, bySlug, headerPartial, footerPartial) {
  const colors = orderedColors(p.colors);
  const canonical = `${SITE_URL}/tokens/${p.slug}`;
  const title = `${p.name} — Color Palette & Tokens — bpozz`;
  const summary = BpozzTokens.contrastSummaryFor(p);
  const moods = (p.moods || []).map((m) => BpozzTokens.MOOD_LABEL[m] || m);
  const description = `${p.name}: a ${BpozzTokens.FAMILY_LABEL[p.family] || p.family}${moods.length ? ", " + moods.join("/").toLowerCase() : ""} color palette with WCAG contrast ratios computed for every role pairing, exportable as CSS, SCSS, Tailwind, JSON, Figma Variables, iOS, and Android.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: p.name,
    url: canonical,
    dateCreated: p.created_at,
    keywords: (p.tags || []).join(", "),
    about: "Color palette / design tokens",
    isPartOf: { "@type": "CollectionPage", name: "Color Palette Library", url: `${SITE_URL}/tokens` },
  };

  let darkToggleHtml = "";
  if (p.dark_variant_slug || p.light_variant_slug) {
    const otherSlug = p.dark_variant_slug || p.light_variant_slug;
    const other = bySlug.get(otherSlug);
    const otherColors = other ? orderedColors(other.colors) : [];
    const otherIsDark = !!p.dark_variant_slug;
    darkToggleHtml = `<div class="token-mode-toggle" data-toggle="mode" data-self-colors="${escapeHtml(JSON.stringify(colors))}" data-other-colors="${escapeHtml(JSON.stringify(otherColors))}">
        <button type="button" aria-pressed="true" data-mode="self">${otherIsDark ? "Light" : "Dark"}</button>
        <button type="button" aria-pressed="false" data-mode="other">${otherIsDark ? "Dark" : "Light"}</button>
      </div>
      <p class="card-meta" style="margin-top:-6px;margin-bottom:16px;">Paired with <a href="/tokens/${otherSlug}">${otherIsDark ? "a dark-mode variant" : "its light-mode source"}</a>, generated per <a href="/guide/dark-mode-second-palette#dark-surface-ramp">Dark Mode Is a Second Palette</a>.</p>`;
  }

  const scoreLabel = summary
    ? `${summary.ratio.toFixed(2)}:1 (${summary.badge}) — ${escapeHtml(summary.pairing)}`
    : "Not enough roles to score";

  const heroMetaText = (BpozzTokens.FAMILY_LABEL[p.family] || p.family) + (moods.length ? " · " + moods.join(", ") : "");
  const heroContrastText = BpozzTokens.contrastTextHtml(p);
  const mainHtml = `    <main class="wrap" id="tokens-content" tabindex="-1">
      <div class="token-detail-hero">
        <p class="token-detail-hero__meta">${escapeHtml(heroMetaText)}${heroContrastText ? " · " + heroContrastText : ""}</p>
        <h1>${escapeHtml(p.name)}</h1>
        <p class="card-meta">Weakest pairing: ${scoreLabel} · Added ${escapeHtml(p.created_at)}</p>
        <div class="token-detail-hero__swatches">${BpozzTokens.swatchesHtml(colors)}</div>
        <div class="token-detail-hero__actions">
          <button type="button" class="btn btn-primary" data-action="copy-css" data-colors="${escapeHtml(JSON.stringify(colors))}">Copy as CSS variables</button>
          <button type="button" class="token-icon-btn" data-action="like" data-slug="${p.slug}" aria-pressed="false" aria-label="Save ${escapeHtml(p.name)} to your collection" style="width:auto;padding:0 14px;gap:8px;">${BpozzTokens.ICONS.heart} Save</button>
        </div>
      </div>

      <section aria-labelledby="breakdown-heading">
        <p class="section-label mono" id="breakdown-heading">/ token breakdown</p>
        ${breakdownTableHtml(colors)}
      </section>

      <section aria-labelledby="preview-heading" style="margin-top:40px;">
        <p class="section-label mono" id="preview-heading">/ live preview</p>
        ${darkToggleHtml}
        ${previewHtml(colors, "preview-self")}
      </section>

      <section aria-labelledby="export-heading" style="margin-top:40px;">
        <p class="section-label mono" id="export-heading">/ export tokens</p>
        ${exportPanelHtml(colors, p.name)}
      </section>

      <section aria-labelledby="related-heading" style="margin-top:48px;">
        <p class="section-label mono" id="related-heading">/ related guides</p>
        <div class="token-related">${relatedGuidesHtml(p)}</div>
      </section>

      <aside class="guide-rail" id="token-rail" aria-label="More palettes"></aside>
    </main>`;

  return pageShell({
    title,
    description,
    canonical,
    bodyClass: "tokens-page tokens-detail-page",
    bodyAttrs: `data-slug="${p.slug}"`,
    headerPartial,
    footerPartial,
    mainHtml,
    jsonLd,
    depthPrefix: "../",
    extraScripts: [
      "../tokens-color.js",
      "../tokens-a11y.js",
      "../tokens-export.js",
      "../tokens-shared.js",
      "../tokens-detail.js",
    ],
  });
}

// ---------------------------------------------------------------------
// Gallery page (/tokens/index.html)
// ---------------------------------------------------------------------
function galleryPageHtml(allPalettes, headerPartial, footerPartial) {
  const canonical = `${SITE_URL}/tokens`;
  const title = "Color Palette Library — Tokens, Not Swatches — bpozz";
  const description =
    "Browse color palettes as real token sets: semantic roles, computed WCAG contrast on every pairing, paired dark-mode variants, and export to CSS, SCSS, Tailwind, JSON, Figma, iOS, and Android.";
  const cardsHtml = allPalettes.map(BpozzTokens.cardHtml).join("");
  const count = allPalettes.length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Color Palette Library",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "bpozz", url: `${SITE_URL}/` },
  };

  const moodChips = Object.keys(BpozzTokens.MOOD_LABEL)
    .map(
      (m) =>
        `<button type="button" class="token-mood-chip" data-mood="${m}" aria-pressed="false">${escapeHtml(BpozzTokens.MOOD_LABEL[m])}</button>`,
    )
    .join("");

  const mainHtml = `    <main class="wrap guides-main" id="tokens-content" tabindex="-1">
      <div class="tokens-hero">
        <span class="tokens-hero__eyebrow">/ color_palette_library</span>
        <h1>A palette is a token system, not a row of swatches.</h1>
        <p>Every palette here assigns real semantic roles, scores every pairing against WCAG automatically, and exports as CSS, SCSS, Tailwind, JSON, Figma Variables, iOS, and Android — not just hex codes to copy.</p>
        <div class="tokens-hero__actions">
          <a class="btn btn-primary" href="/tokens/create">Build a palette</a>
          <a class="btn btn-ghost" style="color:var(--ink);border-color:var(--grid-line);" href="/tokens/collection">Your collection</a>
        </div>
      </div>

      <div class="token-filters">
        <div class="field select-field level-filter">
          <label for="family-select" class="sr-only">Filter by family</label>
          <select id="family-select">
            <option value="all">All families</option>
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>
        <div class="field select-field level-filter">
          <label for="sort-select" class="sr-only">Sort</label>
          <select id="sort-select">
            <option value="new">New</option>
            <option value="popular">Popular</option>
            <option value="accessible">Most Accessible</option>
          </select>
        </div>
      </div>
      <div class="token-mood-filters" role="group" aria-label="Filter by mood">${moodChips}</div>

      <div class="section-head">
        <p class="results-count" id="tokens-results-count">Showing ${count} of ${count} palettes</p>
      </div>
      <div class="grid" id="tokens-grid-root">${cardsHtml}</div>
      <div class="empty-state" id="tokens-empty-state">
        <p><strong>No palettes match <span id="tokens-empty-query">your current filters</span>.</strong></p>
        <p>Try a different family or mood, or <a href="/tokens/create">build your own</a>.</p>
      </div>
    </main>`;

  return pageShell({
    title,
    description,
    canonical,
    bodyClass: "tokens-page tokens-gallery-page",
    headerPartial,
    footerPartial,
    mainHtml,
    jsonLd,
    depthPrefix: "../",
    extraScripts: [
      "../tokens-color.js",
      "../tokens-a11y.js",
      "../tokens-export.js",
      "../tokens-shared.js",
      "../tokens-gallery.js",
    ],
  });
}

// ---------------------------------------------------------------------
// Builder page (/tokens/create.html)
// ---------------------------------------------------------------------
function createPageHtml(headerPartial, footerPartial) {
  const canonical = `${SITE_URL}/tokens/create`;
  const title = "Build a Color Palette — bpozz";
  const description =
    "Assign semantic roles to colors — by hand or extracted from an image — with a live WCAG contrast checker that flags failing pairings as you go, following the same math as guide/color-contrast-systems.";

  const mainHtml = `    <main class="wrap" id="tokens-content" tabindex="-1">
      <div class="tokens-hero">
        <span class="tokens-hero__eyebrow">/ builder</span>
        <h1>Build a palette, not a swatch row.</h1>
        <p>Assign a semantic role to every color. The contrast checker on the right runs the same accessibility engine as the rest of the library — live, as you go — following <a href="/guide/color-contrast-systems">Color Contrast Is Math, Not Taste</a>.</p>
      </div>

      <div class="token-mode-tabs" role="tablist">
        <button type="button" data-step="manual" aria-pressed="true">Manual</button>
        <button type="button" data-step="image" aria-pressed="false">From an image</button>
      </div>

      <div class="token-builder">
        <div>
          <div class="token-builder__step" data-step-panel="manual" data-active="true">
            <div class="token-builder__panel">
              <h2>Roles &amp; colors</h2>
              <datalist id="role-datalist">
                <option value="background"></option>
                <option value="surface"></option>
                <option value="primary"></option>
                <option value="secondary"></option>
                <option value="accent"></option>
                <option value="text"></option>
                <option value="border"></option>
              </datalist>
              <div id="role-rows"></div>
              <button type="button" class="token-add-role" id="add-role-btn">+ Add another role</button>
            </div>
          </div>
          <div class="token-builder__step" data-step-panel="image">
            <div class="token-builder__panel">
              <h2>Extract from an image</h2>
              <label class="token-dropzone" id="dropzone" for="image-input">
                <span>Drop an image here, or click to choose one.<br />Colors are extracted locally in your browser — nothing is uploaded.</span>
                <input type="file" id="image-input" accept="image/*" />
              </label>
              <img class="token-extracted-preview" id="extracted-preview" alt="" />
              <div class="token-extracted-swatches" id="extracted-swatches"></div>
              <p class="card-meta" id="extracted-hint" style="margin-top:10px;"></p>
            </div>
          </div>

          <div class="token-builder__panel" style="margin-top:24px;">
            <h2>Name your palette</h2>
            <div class="token-builder__field">
              <label for="palette-name">Name</label>
              <input type="text" id="palette-name" placeholder="e.g. Coastal Fog" />
            </div>
            <button type="button" class="btn btn-primary" id="save-palette-btn">Save to your collection</button>
            <p class="card-meta" style="margin-top:10px;">Saved locally to this browser — see <a href="/tokens/collection">your collection</a>. bpozz doesn't have an account system, so there's no server-side save (or sign-in) yet.</p>
          </div>
        </div>

        <div class="token-builder__side">
          <div class="token-builder__panel">
            <h2>Live preview</h2>
            <div class="token-live-preview-mini" id="builder-preview"></div>
            <div class="token-score-line">
              <span>Accessibility score</span>
              <strong id="builder-score">—</strong>
            </div>
          </div>
          <div id="builder-warnings"></div>
        </div>
      </div>
    </main>`;

  return pageShell({
    title,
    description,
    canonical,
    bodyClass: "tokens-page tokens-create-page",
    headerPartial,
    footerPartial,
    mainHtml,
    depthPrefix: "../",
    extraScripts: [
      "../tokens-color.js",
      "../tokens-a11y.js",
      "../tokens-export.js",
      "../tokens-shared.js",
      "../tokens-create.js",
    ],
  });
}

// ---------------------------------------------------------------------
// Collection page (/tokens/collection.html)
// ---------------------------------------------------------------------
function collectionPageHtml(headerPartial, footerPartial) {
  const canonical = `${SITE_URL}/tokens/collection`;
  const title = "Your Collection — bpozz";
  const description = "Palettes you've saved or built, stored in this browser.";

  const mainHtml = `    <main class="wrap guides-main" id="tokens-content" tabindex="-1">
      <div class="tokens-hero">
        <span class="tokens-hero__eyebrow">/ your_collection</span>
        <h1>Your collection</h1>
        <p>Palettes you've saved from the library, plus anything you've built yourself — stored in this browser only (bpozz has no account system, so there's nothing to sync across devices yet).</p>
      </div>
      <div class="token-collection-toolbar">
        <p class="results-count" id="collection-count">Loading your collection…</p>
        <a class="btn btn-primary" href="/tokens/create">Build a palette</a>
      </div>
      <div class="grid" id="collection-grid-root"></div>
      <div class="empty-state" id="collection-empty-state">
        <p><strong>Nothing saved yet.</strong></p>
        <p>Browse the <a href="/tokens">palette library</a> and tap the heart on any card, or <a href="/tokens/create">build your own</a>.</p>
      </div>
    </main>`;

  return pageShell({
    title,
    description,
    canonical,
    bodyClass: "tokens-page tokens-collection-page",
    headerPartial,
    footerPartial,
    mainHtml,
    depthPrefix: "../",
    extraScripts: [
      "../tokens-color.js",
      "../tokens-a11y.js",
      "../tokens-export.js",
      "../tokens-shared.js",
      "../tokens-collection.js",
    ],
  });
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------
function main() {
  const palettes = JSON.parse(fs.readFileSync(TOKENS_JSON_PATH, "utf8"));
  if (!Array.isArray(palettes)) throw new Error("tokens.json did not contain an array");

  const headerPartial = fs.readFileSync(HEADER_PARTIAL_PATH, "utf8").trim();
  const footerPartial = fs.readFileSync(FOOTER_PARTIAL_PATH, "utf8").trim();

  if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR);

  // Gallery default sort is "New" — same ordering tokens.json is already
  // written in (see generate-palettes.js), kept explicit here too so
  // this script doesn't silently depend on file order.
  const galleryOrder = palettes
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  fs.writeFileSync(
    path.join(TOKENS_DIR, "index.html"),
    galleryPageHtml(galleryOrder, headerPartial, footerPartial),
  );
  fs.writeFileSync(path.join(TOKENS_DIR, "create.html"), createPageHtml(headerPartial, footerPartial));
  fs.writeFileSync(
    path.join(TOKENS_DIR, "collection.html"),
    collectionPageHtml(headerPartial, footerPartial),
  );

  const bySlug = new Map(palettes.map((p) => [p.slug, p]));
  let written = 0;
  for (const p of palettes) {
    fs.writeFileSync(
      path.join(TOKENS_DIR, `${p.slug}.html`),
      detailPageHtml(p, bySlug, headerPartial, footerPartial),
    );
    written++;
  }

  console.log(`✓ Tokens feature built — index.html, create.html, collection.html, and ${written} detail pages in /tokens.`);
  console.log(`  Run 'node build-header.js && node build-footer.js' next to sync nav into the new pages.`);
}

main();
