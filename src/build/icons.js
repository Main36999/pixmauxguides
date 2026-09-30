/**
 * src/build/icons.js — the icon library: /icons/ and every /icons/<pack>.html.
 *
 * A page WRITER, the same kind as src/build/fonts.js and built the same way:
 * each page's full HTML is emitted from scratch, every run, from
 * src/data/icon-packs.json and src/data/icons.json (validated by
 * src/build/content.js before this runs). The <head> frame comes from
 * src/build/head.js, and both partials are embedded raw inside the
 * HEADER/FOOTER markers so src/build/header.js and src/build/footer.js resync
 * them afterwards — which is why this runs before those two in `render`.
 *
 * WHAT IT WRITES
 *
 *   staging root   icons/index.html            every pack, then every icon
 *                  icons/<pack>.html           one page per pack
 *   dist/          icons/<pack>/<Name>-SVG.zip the pack's SVGs, if it has any
 *                  icons/<pack>/<Name>-PNG.zip the pack's PNGs, if it has any
 *
 * The icon files themselves are published verbatim from public/icons/ by
 * build.js's PUBLISH_DIRS; the ZIPs are generated here from those same files,
 * with fonts.js's deterministic STORE writer, so no asset is stored twice.
 *
 * ONE ARCHITECTURE FOR EVERY PACK
 *
 * Nothing below knows what an "outline" or a "3D" icon is. A card offers
 * exactly the formats its record names — an SVG gets Copy SVG and a Download
 * choice of SVG or PNG, a PNG-only icon gets a single Download PNG link — and
 * which formats a style may have is enforced by the loader from
 * site.config.js. Adding a pack is data and files; no markup changes.
 *
 * WHAT IS LOADED, AND WHEN
 *
 * Previews are <img> elements with loading="lazy": no SVG markup is inlined
 * into the page, so page weight grows by one small card per icon, not by the
 * icons' geometry, and off-screen previews are not fetched at all. The SVG
 * text is fetched only when a visitor copies it or opens its code view
 * (src/client/icons.js). The listing is still rendered at build time, as the
 * font listing is, so every card is in the HTML and the downloads work with
 * JS off.
 *
 * PHASE 1: the pages carry `noindex` — the library holds a small sample set
 * until the real packs are imported, and is not linked from the header nav
 * or listed in the sitemap yet. See the Phase 1 report.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("../shared/html.js");
const head = require("./head.js");
const { zipStore } = require("./fonts.js");

const HEADER_PARTIAL = path.join("partials", "header.html");
const FOOTER_PARTIAL = path.join("partials", "footer.html");

/** Output directory, relative to the staging root and to dist/. */
const ICONS_DIR = "icons";

/** Page-specific assets, published beside the pages by src/build/build.js. */
const STYLESHEET = "/icons/icons.css";
const SCRIPT = "/icons/icons.js";

const HEAD_OPTIONS = {
  consentNote: true,
  stylesheets: [head.STYLESHEETS.site, STYLESHEET],
};

/** How many icons a pack card on the listing previews. */
const PACK_PREVIEW_COUNT = 4;

const TITLE = "Icon Packs";
const SUBTITLE = "Curated icon sets for modern web and mobile interfaces.";

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

const assetUrl = (icon, file) => `/${ICONS_DIR}/${icon.pack}/${file}`;
const packUrl = (pack) => `/${ICONS_DIR}/${pack.id}`;
const iconKey = (icon) => `${icon.pack}--${icon.id}`;
const compactName = (pack) => pack.name.replace(/[^A-Za-z0-9]+/g, "");
const zipName = (pack, format) => `${compactName(pack)}-${format.toUpperCase()}.zip`;
/** Saved-file name: the style keeps two packs' "arrow-left.svg" apart. */
const downloadName = (icon, ext) => `${icon.id}-${icon.style}.${ext}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function labelsFrom(list) {
  const labels = {};
  list.forEach((x) => (labels[x.slug] = x.label));
  return labels;
}

function vocab(config) {
  return {
    style: labelsFrom(config.icons.styles),
    category: labelsFrom(config.icons.categories),
  };
}

/** The formats an icon ships, in the order they are offered. */
function formatsOf(icon) {
  const out = [];
  if (icon.svg) out.push({ ext: "svg", label: "SVG", note: "Vector", url: assetUrl(icon, icon.svg) });
  if (icon.png) out.push({ ext: "png", label: "PNG", note: `${icon.pngSize} px`, url: assetUrl(icon, icon.png) });
  return out;
}

/** The asset a preview shows: the SVG where there is one, else the PNG. */
const previewUrl = (icon) => assetUrl(icon, icon.svg || icon.png);

/** The words a card is found by. */
function searchText(icon, pack, labels) {
  return [icon.name, icon.id, labels.category[icon.category], labels.style[icon.style], pack.name, ...icon.tags]
    .join(" ")
    .toLowerCase()
    .replace(/[-,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------
// shared markup
// ---------------------------------------------------------------------

const svgIcon = (cls, body) =>
  `<svg class="icons-glyph${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const GLYPH_SEARCH = svgIcon("", '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>');
const GLYPH_DOWNLOAD = svgIcon("", '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>');
const GLYPH_CLOSE = svgIcon("", '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>');

/**
 * The action glyphs every tile uses, defined ONCE per page and referenced
 * with <use>. At 2,000 icons that is 2,000 tiny <use> elements rather than
 * 2,000 copies of each glyph's geometry.
 */
const GLYPH_SPRITE =
  '<svg class="icons-sprite" aria-hidden="true" focusable="false">' +
  '<symbol id="icons-g-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></symbol>' +
  '<symbol id="icons-g-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>' +
  '<symbol id="icons-g-download" viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></symbol>' +
  "</svg>";
const use = (id, cls) =>
  `<svg class="icons-glyph${cls ? " " + cls : ""}" aria-hidden="true" focusable="false"><use href="#icons-g-${id}"/></svg>`;

/**
 * One icon TILE in the dense browser grid.
 *
 * The tile itself is a button that opens the detail dialog, named
 * "<Icon> — <Style>" — unique on every page, and read in full by assistive
 * technology. The icon's name is also a caption the tile reveals on hover and
 * keyboard focus; it is aria-hidden only because the button's name already
 * says it.
 *
 * The actions sit in the tile's corner as compact icon buttons, revealed on
 * hover and keyboard focus (icons.css) but always in the DOM, the tab order
 * and the accessibility tree, each with a unique name and a native tooltip:
 *
 *   Copy SVG          only for an icon with an SVG
 *   Download options  a <details> disclosure when there is a choice of format
 *   Download PNG      a plain link when there is not (3D)
 *
 * So there is no heading and no metadata per tile: style and category are in
 * the dialog, and in the tile's accessible name (style) and filters.
 */
function cardHtml(icon, pack, labels) {
  const key = iconKey(icon);
  const name = escapeHtml(icon.name);
  const styleLabel = labels.style[icon.style];
  const categoryLabel = labels.category[icon.category];
  const formats = formatsOf(icon);
  const svg = formats.find((f) => f.ext === "svg");
  const png = formats.find((f) => f.ext === "png");

  const data = [
    `data-key="${key}"`,
    `data-name="${name}"`,
    `data-style="${icon.style}"`,
    `data-category="${icon.category}"`,
    `data-style-label="${escapeHtml(styleLabel)}"`,
    `data-category-label="${escapeHtml(categoryLabel)}"`,
    `data-search="${escapeHtml(searchText(icon, pack, labels))}"`,
    `data-tags="${escapeHtml(icon.tags.join(" "))}"`,
    `data-pack-name="${escapeHtml(pack.name)}"`,
    `data-pack-url="${packUrl(pack)}"`,
    svg ? `data-svg="${svg.url}" data-svg-file="${downloadName(icon, "svg")}"` : "",
    png ? `data-png="${png.url}" data-png-file="${downloadName(icon, "png")}" data-png-size="${icon.pngSize}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Every control is named with the icon AND its style, so the same icon in
  // Outline, Solid and Duotone never produces two controls with one name.
  const who = escapeHtml(`${icon.name} — ${styleLabel}`);

  // The label span is visually hidden at rest and shown while the button is
  // in its copied/failed state (the client writes "✓ Copied" into it).
  const copy = svg
    ? `<button type="button" class="icon-tile-btn icon-tile-btn--copy" data-icon-copy aria-label="Copy SVG code — ${who}" title="Copy SVG">` +
      `${use("copy", "icon-tile-btn__idle")}${use("check", "icon-tile-btn__done")}<span class="icon-tile-btn__label" data-copy-label>Copy SVG</span></button>`
    : "";

  let download;
  if (formats.length > 1) {
    download =
      `<details class="icon-download">` +
      `<summary class="icon-tile-btn" aria-label="Download options for ${who}" title="Download options for ${who}">${use("download")}</summary>` +
      `<div class="icon-download__list">` +
      formats
        .map(
          (f) =>
            `<a class="icon-download__item" href="${f.url}" download="${downloadName(icon, f.ext)}">` +
            `<span>${f.label}</span><span class="icon-download__note">${escapeHtml(f.note)}</span>` +
            `<span class="sr-only"> — ${who}</span></a>`,
        )
        .join("") +
      `</div></details>`;
  } else {
    const f = formats[0];
    download =
      `<a class="icon-tile-btn" href="${f.url}" download="${downloadName(icon, f.ext)}" aria-label="Download ${f.label} — ${who}" title="Download ${f.label}">` +
      `${use("download")}</a>`;
  }

  // PNG-only previews are rendered objects, not glyphs: they get their own
  // class so they fill more of the tile.
  const raster = svg ? "" : " icon-card__preview--raster";

  return (
    `<li class="icon-card" ${data}>` +
    `<button type="button" class="icon-card__preview${raster}" data-icon-open aria-haspopup="dialog" aria-label="${who}">` +
    `<img src="${previewUrl(icon)}" alt="" width="28" height="28" loading="lazy" decoding="async" />` +
    `<span class="icon-card__caption" aria-hidden="true">${name}</span></button>` +
    `<div class="icon-card__actions">${copy}${download}</div>` +
    `</li>`
  );
}

/** Filter chips: "All" plus one per value, in the contract's order. */
/**
 * Each row's "All" chip reads "All" but is named for its row ("All styles",
 * "All categories"), so the two rows never expose two controls called "All".
 * The name starts with the visible word, for voice control (WCAG 2.5.3).
 */
const ALL_CHIP_NAME = { style: "All styles", category: "All categories" };

function chipsHtml(filter, entries, indent) {
  return [`<button type="button" class="icons-chip" data-filter="${filter}" data-value="" aria-pressed="true" aria-label="${ALL_CHIP_NAME[filter]}">All</button>`]
    .concat(
      entries.map(
        (e) =>
          `<button type="button" class="icons-chip" data-filter="${filter}" data-value="${e.slug}" aria-pressed="false">${escapeHtml(e.label)}</button>`,
      ),
    )
    .join(`\n${indent}`);
}

const SEARCH_FIELD = `<div class="icons-search">
            <label class="sr-only" for="icons-search">Search icons</label>
            ${GLYPH_SEARCH}
            <input type="search" id="icons-search" placeholder="Search icons…" autocomplete="off" spellcheck="false" />
          </div>`;

/** The grid and everything the filter script drives, shared by both pages. */
function browserHtml({ cards, total, styleChips, categoryChips, label }) {
  const styleRow = styleChips
    ? `
          <div class="icons-chips" role="group" aria-label="Filter icons by style">
            ${styleChips}
          </div>`
    : "";
  return `<div class="icons-toolbar">${styleRow}
          ${SEARCH_FIELD}
        </div>
        <div class="icons-chips icons-chips--category" role="group" aria-label="Filter icons by category">
          ${categoryChips}
        </div>

        <p class="icons-count" id="icons-count">${plural(total, "icon")}</p>

        <ul class="icon-grid" id="icon-grid" aria-label="${escapeHtml(label)}">
          ${cards.join("\n          ")}
        </ul>

        <div class="icons-empty" id="icons-empty" hidden>
          <p><strong>No icons match your search.</strong></p>
          <p>Try another name or tag, or clear a filter.</p>
          <button type="button" class="icons-btn" data-icons-reset>Clear filters</button>
        </div>`;
}

/**
 * The one detail dialog each page carries, filled from the card that opened
 * it. A native <dialog> opened with showModal(): focus moves into it, Escape
 * closes it, the rest of the page is inert, and focus returns to the card.
 */
const DIALOG = `
    <dialog class="icon-dialog" id="icon-dialog" aria-labelledby="icon-dialog-title">
      <div class="icon-dialog__inner">
        <button type="button" class="icon-dialog__close" data-icon-close aria-label="Close">${GLYPH_CLOSE}</button>
        <div class="icon-dialog__preview" id="icon-dialog-preview"></div>
        <div class="icon-dialog__body">
          <h2 class="icon-dialog__title" id="icon-dialog-title">Icon</h2>
          <dl class="icon-dialog__meta">
            <div><dt>Style</dt><dd data-field="style"></dd></div>
            <div><dt>Category</dt><dd data-field="category"></dd></div>
            <div><dt>Pack</dt><dd><a data-field="pack" href="/${ICONS_DIR}/"></a></dd></div>
            <div><dt>Formats</dt><dd data-field="formats"></dd></div>
            <div class="icon-dialog__tags"><dt>Tags</dt><dd><ul class="icon-tags" data-field="tags"></ul></dd></div>
          </dl>
          <div class="icon-dialog__actions">
            <button type="button" class="icons-btn icons-btn--primary" data-icon-copy data-dialog-action="copy" hidden><span data-copy-label>Copy SVG</span></button>
            <a class="icons-btn" data-dialog-action="svg" href="/${ICONS_DIR}/" download hidden>${GLYPH_DOWNLOAD}<span>Download SVG</span></a>
            <a class="icons-btn" data-dialog-action="png" href="/${ICONS_DIR}/" download hidden>${GLYPH_DOWNLOAD}<span>Download PNG</span></a>
          </div>
          <details class="icon-dialog__code" id="icon-dialog-code" hidden>
            <summary>View SVG code</summary>
            <pre tabindex="0"><code id="icon-dialog-code-text"></code></pre>
          </details>
        </div>
      </div>
    </dialog>`;

/** Controls that need JS are hidden when it is off; downloads still work. */
const NOSCRIPT =
  "    <noscript><style>[data-icon-copy],.icon-card__preview{pointer-events:none}[data-icon-copy]{display:none}</style></noscript>\n";

const LIVE_REGIONS = `    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div id="icons-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`;

const BODY_CLOSE = `

    <script src="/app.js"></script>
    <script src="${SCRIPT}"></script>
  </body>
</html>
`;

/** The meta and social bands, built from values as fonts.js builds them. */
function metaBands({ title, description, canonical, ogImage }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return {
    meta: `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta name="robots" content="noindex" />
    <link rel="canonical" href="${canonical}" />

`,
    social: `    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="BPOZZ" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${ogImage}" />

`,
  };
}

function pageHead(ctx, { title, description, urlPath }) {
  const origin = ctx.config.origin;
  const bands = metaBands({
    title,
    description,
    canonical: origin + urlPath,
    ogImage: `${origin}/og-image.png`,
  });
  return head.headHtml({
    consentNote: HEAD_OPTIONS.consentNote,
    meta: bands.meta,
    social: bands.social,
    stylesheets: HEAD_OPTIONS.stylesheets,
    after: NOSCRIPT.replace(/\n$/, ""),
  });
}

function pageShell(headMarkup, bodyClass, mainId, partials, main) {
  return `${headMarkup}  <body class="${bodyClass}">
${head.skipLinkHtml(mainId, "Skip to content")}
    ${GLYPH_SPRITE}

    ${head.headerRegion(partials.header)}

    <main class="wrap icons-main" id="${mainId}" tabindex="-1">
${main}
    </main>

    ${head.footerRegion(partials.footer)}
${DIALOG}

${LIVE_REGIONS}${BODY_CLOSE}`;
}

const NOTE = `      <p class="icons-note">
        Every SVG is coloured with <code>currentColor</code>, so a pasted icon takes the text colour around it.
        3D icons are rendered artwork and are available as PNG only.
      </p>`;

// ---------------------------------------------------------------------
// the listing page
// ---------------------------------------------------------------------

function packCardHtml(pack, icons, labels) {
  const preview = icons
    .slice(0, PACK_PREVIEW_COUNT)
    .map((i) => `<img src="${previewUrl(i)}" alt="" width="28" height="28" decoding="async" />`)
    .join("");
  const raster = icons[0] && !icons[0].svg ? " icon-pack-card__preview--raster" : "";
  return (
    `<li class="icon-pack-card">` +
    `<a class="icon-pack-card__link" href="${packUrl(pack)}">` +
    `<span class="icon-pack-card__preview${raster}" aria-hidden="true">${preview}</span>` +
    `<span class="icon-pack-card__name">${escapeHtml(pack.name)}</span>` +
    `<span class="icon-pack-card__meta">${escapeHtml(labels.style[pack.style])} · ${plural(pack.iconCount, "icon")}</span>` +
    `</a></li>`
  );
}

function listingHtml(model, ctx, partials) {
  const labels = vocab(ctx.config);
  const packs = model.iconPacks;
  const byPack = groupByPack(model.icons);
  const icons = packs.flatMap((p) => byPack.get(p.id));
  const packById = new Map(packs.map((p) => [p.id, p]));

  const description =
    `${SUBTITLE} Browse ${plural(icons.length, "icon")} in outline, solid, duotone and 3D styles — ` +
    `copy the SVG code or download SVG and PNG files.`;

  const headMarkup = pageHead(ctx, {
    title: `${TITLE} — BPOZZ`,
    description,
    urlPath: `/${ICONS_DIR}/`,
  });

  const main = `      <div class="icons-hero">
        <h1>${TITLE}</h1>
        <p>${SUBTITLE}</p>
      </div>

      <section class="icon-browser" aria-labelledby="icon-browser-title">
        <h2 class="sr-only" id="icon-browser-title">All icons</h2>
        ${browserHtml({
          cards: icons.map((i) => cardHtml(i, packById.get(i.pack), labels)),
          total: icons.length,
          styleChips: chipsHtml("style", ctx.config.icons.styles, "            "),
          categoryChips: chipsHtml("category", ctx.config.icons.categories, "          "),
          label: "Icons",
        })}
      </section>

      <section class="icon-packs" aria-labelledby="icon-packs-title">
        <h2 class="icons-section-title" id="icon-packs-title">Packs</h2>
        <ul class="icon-pack-list">
          ${packs.map((p) => packCardHtml(p, byPack.get(p.id), labels)).join("\n          ")}
        </ul>
      </section>

${NOTE}`;

  return pageShell(headMarkup, "icons-page", "icons-content", partials, main);
}

// ---------------------------------------------------------------------
// the pack page
// ---------------------------------------------------------------------

function packHtml(pack, icons, zips, ctx, partials) {
  const labels = vocab(ctx.config);
  const styleLabel = labels.style[pack.style];
  const name = escapeHtml(pack.name);

  // Only the categories this pack actually has: a chip with nothing behind it
  // would be a fake filter.
  const present = new Set(icons.map((i) => i.category));
  const categories = ctx.config.icons.categories.filter((c) => present.has(c.slug));

  const actions = zips
    .map(
      (z, i) =>
        `<a class="icons-btn${i === 0 ? " icons-btn--primary" : ""}" href="${z.url}" download="${z.file}">` +
        `${GLYPH_DOWNLOAD}<span>Download ${z.format.toUpperCase()} Pack</span></a>`,
    )
    .join("\n            ");
  const sizes = zips
    .map((z) => `${z.format.toUpperCase()}: ${plural(z.count, "file")}, ${formatBytes(z.bytes)}`)
    .join(" · ");

  const headMarkup = pageHead(ctx, {
    title: `${pack.name} — ${styleLabel} Icon Pack | BPOZZ`,
    description: pack.description,
    urlPath: packUrl(pack),
  });

  const main = `      <nav class="icons-breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li><a href="/${ICONS_DIR}/">${TITLE}</a></li>
          <li><span aria-current="page">${name}</span></li>
        </ol>
      </nav>

      <header class="icon-pack-head">
        <div class="icon-pack-head__text">
          <h1>${name}</h1>
          <p class="icon-pack-head__meta">${escapeHtml(styleLabel)} · ${plural(icons.length, "icon")}</p>
          <p class="icon-pack-head__desc">${escapeHtml(pack.description)}</p>
        </div>
        <div class="icon-pack-head__actions">
          <div class="icon-pack-head__buttons">
            ${actions}
          </div>
          <p class="icon-pack-head__size">ZIP archives · ${escapeHtml(sizes)}</p>
        </div>
      </header>

      <section class="icon-browser" aria-labelledby="icon-browser-title">
        <h2 class="sr-only" id="icon-browser-title">Icons in ${name}</h2>
        ${browserHtml({
          cards: icons.map((i) => cardHtml(i, pack, labels)),
          total: icons.length,
          styleChips: "",
          categoryChips: chipsHtml("category", categories, "          "),
          label: `Icons in ${pack.name}`,
        })}
      </section>

${NOTE}`;

  return pageShell(headMarkup, "icons-page icon-pack-page", "icons-content", partials, main);
}

// ---------------------------------------------------------------------
// build / render
// ---------------------------------------------------------------------

function groupByPack(icons) {
  const map = new Map();
  icons.forEach((icon) => {
    if (!map.has(icon.pack)) map.set(icon.pack, []);
    map.get(icon.pack).push(icon);
  });
  return map;
}

/** The pack's download archives: one per format its icons ship, flat. */
function packArchives(pack, icons, iconDir) {
  return ["svg", "png"]
    .map((format) => {
      const members = icons.filter((i) => i[format]);
      if (!members.length) return null;
      // Entries carry the same file name as the icon's individual download
      // (downloadName), so a file saved on its own and the same file unzipped
      // from its pack are named identically.
      const entries = members.map((i) => ({
        name: downloadName(i, format),
        data: fs.readFileSync(path.join(iconDir, pack.id, i[format])),
      }));
      const data = zipStore(entries);
      const file = zipName(pack, format);
      return {
        format,
        file,
        path: `${ICONS_DIR}/${pack.id}/${file}`,
        url: `/${ICONS_DIR}/${pack.id}/${file}`,
        count: entries.length,
        bytes: data.length,
        data,
      };
    })
    .filter(Boolean);
}

/**
 * Everything this builder produces, in memory: the pages (by route file) and
 * the archives (by dist-relative path). Reads the partials and the icon
 * files; writes nothing. `render` writes it out, and the tests call it
 * directly so they can check the pages without a build having run.
 */
function build(ctx) {
  const { root } = ctx.config.paths;
  const iconDir = ctx.config.paths.content.iconFiles;
  const partials = {
    header: fs.readFileSync(path.join(root, HEADER_PARTIAL), "utf8").trim(),
    footer: fs.readFileSync(path.join(root, FOOTER_PARTIAL), "utf8").trim(),
  };

  const byPack = groupByPack(ctx.model.icons);
  const pages = [{ file: `${ICONS_DIR}/index.html`, html: listingHtml(ctx.model, ctx, partials) }];
  const packages = [];

  ctx.model.iconPacks.forEach((pack) => {
    const icons = byPack.get(pack.id);
    const zips = packArchives(pack, icons, iconDir);
    zips.forEach((z) => packages.push({ file: z.path, data: z.data }));
    pages.push({ file: `${ICONS_DIR}/${pack.id}.html`, html: packHtml(pack, icons, zips, ctx, partials) });
  });

  return { pages, packages };
}

/**
 * Writes icons/index.html and every icons/<pack>.html into the staging root,
 * and every pack archive into dist/. Returns { written, packages,
 * packageBytes } for the caller to summarize.
 */
function render(ctx) {
  const { stage, dist } = ctx.config.paths;
  const out = build(ctx);

  const written = [];
  out.pages.forEach((page) => {
    const file = path.join(stage, page.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, page.html);
    written.push(page.file);
  });

  let packageBytes = 0;
  out.packages.forEach((pkg) => {
    const file = path.join(dist, pkg.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, pkg.data);
    packageBytes += pkg.data.length;
  });

  return { written, packages: out.packages.length, packageBytes };
}

module.exports = {
  render,
  build,
  cardHtml,
  formatsOf,
  downloadName,
  zipName,
  packUrl,
  assetUrl,
  HEAD_OPTIONS,
  ICONS_DIR,
  STYLESHEET,
  SCRIPT,
  TITLE,
  SUBTITLE,
};
