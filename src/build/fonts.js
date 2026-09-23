/**
 * src/build/fonts.js — the font library: /fonts/ and every /fonts/<id>.html.
 *
 * A page WRITER, like src/build/categories.js and src/build/guides.js: it emits
 * each page's full HTML from scratch, every run, from src/data/fonts.json
 * (validated by src/build/content.js before this runs). The shared <head>
 * frame comes from src/build/head.js, the JSON-LD from
 * src/build/structured-data.js, and both partials are embedded raw inside the
 * HEADER/FOOTER markers so src/build/header.js and src/build/footer.js resync
 * them afterwards — which is why this runs before those two in `render`.
 *
 * WHAT IT WRITES
 *
 *   staging root   fonts/index.html        the listing grid, fully rendered
 *                  fonts/<id>.html         one detail page per family
 *   dist/          fonts/<id>/<Name>.zip   the download package per family
 *
 * The listing is rendered at build time rather than fetched and drawn in the
 * browser (the /colors approach) because it is small (one card per family),
 * because every card is a link a crawler should see, and because the page then
 * works with JS off. src/client/fonts.js only filters, sorts and restyles the
 * cards that are already there.
 *
 * THE DOWNLOADS
 *
 * Each family's ZIP holds its original font files and its license file,
 * flat, e.g. ABeeZee.zip = ABeeZee-Regular.ttf, ABeeZee-Italic.ttf, OFL.txt.
 * They are GENERATED here from public/fonts/<id>/ rather than committed, so no
 * font binary is stored twice in the repository.
 *
 * The archives use the STORE method (no compression) with a fixed timestamp.
 * That is deliberate: the build's `verify` stage hashes every output file,
 * and DEFLATE output is only guaranteed stable for one zlib build — a Node
 * upgrade on the deploy host could change every ZIP's bytes and fail the
 * gate. Stored entries are byte-identical everywhere. The cost is size: a
 * stored TTF is roughly twice its deflated size.
 *
 * FONT LOADING
 *
 * Every @font-face rule is inlined into the page that uses it, and declaring
 * a face downloads nothing. A face is only fetched once text is rendered in
 * it, and the listing cards only apply their family when src/client/fonts.js
 * sees them near the viewport — so the listing loads the fonts of the cards on
 * screen, not all of them. A <noscript> rule applies them all when JS is off.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("../shared/html.js");
const structuredData = require("./structured-data.js");
const head = require("./head.js");

const HEADER_PARTIAL = path.join("partials", "header.html");
const FOOTER_PARTIAL = path.join("partials", "footer.html");

/** Output directory, relative to the staging root and to dist/. */
const FONTS_DIR = "fonts";

/** Page-specific assets, published beside the pages by src/build/build.js. */
const STYLESHEET = "/fonts/fonts.css";
const SCRIPT = "/fonts/fonts.js";

/**
 * This page type's head options. The consent note is emitted — the guide
 * pages' choice, and the documented default in src/build/head.js — and the
 * page-specific stylesheet loads after the site's.
 */
const HEAD_OPTIONS = {
  consentNote: true,
  stylesheets: [head.STYLESHEETS.site, STYLESHEET],
};

/** Default specimen line. The listing cards show each family's own name. */
const DEFAULT_SPECIMEN = "The quick brown fox jumps over the lazy dog.";

/** Detail page: the fixed text size row, and the display row's default. */
const TEXT_SIZE = 18;
const DISPLAY_SIZE = 32;

/** How many same-category families the detail page links to. */
const RELATED_LIMIT = 4;

const WEIGHT_NAMES = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** CSS generic family used as the fallback after each category's fonts. */
const GENERIC_FAMILY = {
  serif: "serif",
  "sans-serif": "sans-serif",
  display: "sans-serif",
  handwriting: "cursive",
  monospace: "monospace",
};

const FORMAT = { woff2: "woff2", ttf: "truetype", otf: "opentype" };
const FORMAT_LABEL = { woff2: "WOFF2", ttf: "TTF", otf: "OTF" };

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

const extOf = (file) => path.extname(file).slice(1).toLowerCase();

/** "Regular", "Italic", "Bold", "Bold Italic", "Light Italic", … */
function styleName(variant) {
  const weight = WEIGHT_NAMES[variant.weight];
  if (variant.style !== "italic") return weight;
  return variant.weight === 400 ? "Italic" : `${weight} Italic`;
}

/** Variants in a stable reading order: by weight, upright before italic. */
function sortedVariants(font) {
  return font.variants
    .slice()
    .sort(
      (a, b) =>
        a.weight - b.weight ||
        (a.style === b.style ? 0 : a.style === "normal" ? -1 : 1),
    );
}

/** The variant a card previews: Regular if the family has one. */
function previewVariant(font) {
  const variants = sortedVariants(font);
  return (
    variants.find((v) => v.weight === 400 && v.style === "normal") ||
    variants.find((v) => v.style === "normal") ||
    variants[0]
  );
}

const fileUrl = (font, file) => `/${FONTS_DIR}/${font.id}/${file}`;
const pageUrl = (font) => `/${FONTS_DIR}/${font.id}.html`;
const zipName = (font) => `${font.name.replace(/[^A-Za-z0-9]+/g, "")}.zip`;

/** The CSS font-family value for a family, with its generic fallback. */
function cssFamily(font) {
  return `"${font.family}", ${GENERIC_FAMILY[font.category]}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function categoryLabels(config) {
  const labels = {};
  config.fonts.categories.forEach((c) => (labels[c.slug] = c.label));
  return labels;
}

/** The distinct formats a family ships, and what each is used for. */
function formatsOf(font) {
  const download = new Set(font.variants.map((v) => extOf(v.file)));
  const web = new Set(font.variants.map((v) => extOf(v.web)));
  const all = [...new Set([...download, ...web])].sort();
  return all.map((ext) => {
    const uses = [];
    if (download.has(ext)) uses.push("download");
    if (web.has(ext)) uses.push("web preview");
    return { ext, label: FORMAT_LABEL[ext], uses };
  });
}

// ---------------------------------------------------------------------
// @font-face
// ---------------------------------------------------------------------

function fontFaceRule(font, variant) {
  return (
    `@font-face{font-family:"${font.family}";` +
    `src:url("${fileUrl(font, variant.web)}") format("${FORMAT[extOf(variant.web)]}");` +
    `font-weight:${variant.weight};font-style:${variant.style};font-display:swap}`
  );
}

/** One inline <style> block, indented for <head>. */
function fontFaceStyle(rules) {
  return `    <style>\n${rules.map((r) => `      ${r}`).join("\n")}\n    </style>\n`;
}

// ---------------------------------------------------------------------
// ZIP (STORE, fixed timestamp — see the module header)
// ---------------------------------------------------------------------

const CRC_TABLE = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00:00, the earliest DOS date — a fixed, honest "no date". */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * A minimal ZIP archive: `entries` is [{ name, data }] in the order they are
 * stored. Deterministic — same entries, same bytes.
 */
function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  entries.forEach(function (entry) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  });

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

/**
 * The files one family's download contains: every original variant file,
 * then the license file. Web-only conversions (WOFF2) are not included — the
 * download is the family as its authors distribute it.
 */
function packageEntries(font, fontDir) {
  const names = [...new Set(sortedVariants(font).map((v) => v.file))];
  names.push(font.licenseFile);
  return names.map((name) => ({
    name,
    data: fs.readFileSync(path.join(fontDir, font.id, name)),
  }));
}

// ---------------------------------------------------------------------
// shared markup
// ---------------------------------------------------------------------

const ICON_HEART =
  '<svg class="font-icon font-icon--heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 20.3 4.6 13.1a4.8 4.8 0 0 1 0-6.9 4.9 4.9 0 0 1 6.9 0l.5.5.5-.5a4.9 4.9 0 0 1 6.9 0 4.8 4.8 0 0 1 0 6.9Z"/></svg>';
const ICON_MORE =
  '<svg class="font-icon font-icon--dots" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
const ICON_SEARCH =
  '<svg class="font-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/></svg>';
const ICON_DOWNLOAD =
  '<svg class="font-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

/** The words a card is found by: name, designer, category and tags. */
function searchText(font, labels) {
  return [font.name, font.designer, labels[font.category], font.category, ...font.tags]
    .join(" ")
    .toLowerCase()
    .replace(/[-,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One font card. The preview and the name both link to the detail page; the
 * preview link is removed from the tab order and the accessibility tree so a
 * keyboard or screen-reader user meets ONE link per card, followed by the two
 * action buttons — no interactive element is nested inside another.
 */
function cardHtml(font, labels, titleTag) {
  const v = previewVariant(font);
  const url = pageUrl(font);
  const name = escapeHtml(font.name);
  const menuId = `font-menu-${font.id}`;
  const style =
    `--font-bg:${font.background};--ff:${cssFamily(font)};` +
    `--fw:${v.weight};--fst:${v.style}`;
  return (
    `<li class="font-card" data-font-id="${font.id}" data-name="${name}" ` +
    `data-category="${font.category}" data-added="${font.dateAdded}" ` +
    `data-featured="${font.featured}" data-search="${escapeHtml(searchText(font, labels))}" ` +
    `style="${escapeHtml(style)}">` +
    `<a class="font-card__preview" href="${url}" tabindex="-1" aria-hidden="true">` +
    `<span class="font-card__sample" data-font-sample>${name}</span></a>` +
    `<div class="font-card__bar">` +
    `<${titleTag} class="font-card__name"><a href="${url}">${name}</a></${titleTag}>` +
    `<div class="font-card__actions">` +
    `<button type="button" class="font-icon-btn" data-font-fav="${font.id}" aria-pressed="false" aria-label="Save ${name}">${ICON_HEART}</button>` +
    `<div class="font-menu">` +
    `<button type="button" class="font-icon-btn" data-font-menu aria-haspopup="true" aria-expanded="false" aria-controls="${menuId}" aria-label="More options for ${name}">${ICON_MORE}</button>` +
    `<div class="font-menu__list" id="${menuId}" role="menu" hidden>` +
    `<a class="font-menu__item" role="menuitem" href="${url}">View font</a>` +
    `<button type="button" class="font-menu__item" role="menuitem" data-font-copy="${name}">Copy font name</button>` +
    `</div></div></div></div></li>`
  );
}

/** Applies every card's family when JS is off (the lazy loader never runs). */
const NOSCRIPT_FACES =
  "    <noscript><style>.font-card__sample{font-family:var(--ff);font-weight:var(--fw);font-style:var(--fst)}</style></noscript>\n";

const LIVE_REGIONS = `    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div id="fonts-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`;

const BODY_CLOSE = `

    <script src="/app.js"></script>
    <script src="${SCRIPT}"></script>
  </body>
</html>
`;

/** The meta band and social band, built from values — as categories.js does. */
function metaBands({ title, description, canonical, ogImage }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return {
    meta: `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
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
    <meta name="twitter:site" content="@bpozz" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${ogImage}" />

`,
  };
}

// ---------------------------------------------------------------------
// the listing page
// ---------------------------------------------------------------------

function listingHtml(fonts, ctx, partials) {
  const { config } = ctx;
  const origin = config.origin;
  const labels = categoryLabels(config);
  const count = fonts.length;

  const title = "Free Fonts — BPOZZ";
  const description =
    `Browse ${count} free, open-source fonts by category. Preview each font ` +
    `with your own text and download TTF files licensed under the SIL Open ` +
    `Font License 1.1.`;
  const canonical = `${origin}/${FONTS_DIR}/`;

  const bands = metaBands({
    title,
    description,
    canonical,
    ogImage: `${origin}/og-image.png`,
  });

  const jsonLd = structuredData.scriptsHtml(
    [
      structuredData.fontsCollectionJsonLd({
        name: "Fonts",
        description,
        fonts,
        origin,
      }),
    ],
    4,
  );

  const faces = fonts.map((f) => fontFaceRule(f, previewVariant(f)));

  const headMarkup = head.headHtml({
    consentNote: HEAD_OPTIONS.consentNote,
    meta: bands.meta,
    social: bands.social,
    stylesheets: HEAD_OPTIONS.stylesheets,
    structuredData: jsonLd,
    after: fontFaceStyle(faces) + NOSCRIPT_FACES.replace(/\n$/, ""),
  });

  const chips = [`<button type="button" class="fonts-filter" data-category="" aria-pressed="true">All</button>`]
    .concat(
      config.fonts.categories.map(
        (c) =>
          `<button type="button" class="fonts-filter" data-category="${c.slug}" aria-pressed="false">${escapeHtml(c.label)}</button>`,
      ),
    )
    .concat([
      `<button type="button" class="fonts-filter fonts-filter--saved" data-category="saved" aria-pressed="false">${ICON_HEART}<span>Saved</span></button>`,
    ])
    .join("\n          ");

  const cards = fonts.map((f) => cardHtml(f, labels, "h2")).join("\n        ");

  return `${headMarkup}  <body class="fonts-page">
${head.skipLinkHtml("fonts-content", "Skip to content")}

    ${head.headerRegion(partials.header)}

    <main class="wrap fonts-main" id="fonts-content" tabindex="-1">
      <div class="fonts-hero">
        <h1>Fonts</h1>
        <p>Browse ${count} free fonts for your projects. Every family is open source, licensed under the SIL Open Font License 1.1, and ready to download.</p>
      </div>

      <div class="fonts-toolbar">
        <div class="fonts-filters" role="group" aria-label="Filter fonts by category">
          ${chips}
        </div>
        <div class="fonts-controls">
          <div class="fonts-field fonts-field--search">
            <label class="sr-only" for="fonts-search">Search fonts</label>
            ${ICON_SEARCH}
            <input type="search" id="fonts-search" placeholder="Search fonts…" autocomplete="off" spellcheck="false" />
          </div>
          <div class="fonts-field fonts-field--preview">
            <label class="sr-only" for="fonts-preview-text">Preview text</label>
            <input type="text" id="fonts-preview-text" placeholder="Type to preview…" maxlength="80" autocomplete="off" />
          </div>
          <div class="fonts-field fonts-field--sort">
            <label for="fonts-sort">Sort</label>
            <select id="fonts-sort">
              <option value="az">A–Z</option>
              <option value="newest">Newest</option>
              <option value="featured">Featured</option>
            </select>
          </div>
        </div>
      </div>

      <p class="fonts-count" id="fonts-count">${count} fonts</p>

      <ul class="font-grid" id="font-grid">
        ${cards}
      </ul>

      <div class="fonts-empty" id="fonts-empty" hidden>
        <p><strong>No fonts match your search.</strong></p>
        <p>Try another name, designer or category.</p>
      </div>

      <p class="fonts-note">
        Every font here comes from <a href="https://fonts.google.com/">Google Fonts</a> and is distributed under the
        <a href="https://openfontlicense.org/open-font-license-official-text/">SIL Open Font License 1.1</a>.
        Each download includes the family's license file. “Newest” orders by the date a family was added to Google Fonts; “Featured” is BPOZZ's own mixed-style order.
      </p>
    </main>

    ${head.footerRegion(partials.footer)}

${LIVE_REGIONS}${BODY_CLOSE}`;
}

// ---------------------------------------------------------------------
// the detail page
// ---------------------------------------------------------------------

/** Up to RELATED_LIMIT other families in the same category, A–Z after this one. */
function relatedFonts(font, fonts) {
  const same = fonts.filter((f) => f.category === font.category);
  const at = same.indexOf(font);
  const out = [];
  for (let i = 1; i < same.length && out.length < RELATED_LIMIT; i++) {
    out.push(same[(at + i) % same.length]);
  }
  return out;
}

function specimenRows(font) {
  return sortedVariants(font)
    .map((v) => {
      const label = `${escapeHtml(font.name)} ${styleName(v)} ${v.weight}`;
      const style = `font-family:${cssFamily(font)};font-weight:${v.weight};font-style:${v.style}`;
      return [TEXT_SIZE, DISPLAY_SIZE]
        .map((size) => {
          const display = size === DISPLAY_SIZE;
          return (
            `<li class="font-specimen${display ? " font-specimen--display" : ""}">` +
            `<p class="font-specimen__label">${label} at ` +
            (display ? `<span data-display-size>${size}</span>` : `${size}`) +
            `px</p>` +
            `<p class="font-specimen__text" data-specimen${display ? " data-specimen-display" : ""} ` +
            `style="${escapeHtml(style)};font-size:${size}px">${escapeHtml(DEFAULT_SPECIMEN)}</p>` +
            `</li>`
          );
        })
        .join("\n            ");
    })
    .join("\n            ");
}

const PRESETS = [
  { key: "sentence", label: "Sentence", text: DEFAULT_SPECIMEN },
  { key: "aa", label: "Aa", text: "Aa Bb Cc" },
  {
    key: "alphabet",
    label: "Alphabet",
    text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz",
  },
  { key: "numbers", label: "Numbers", text: "0123456789" },
  { key: "symbols", label: "Symbols", text: "! ? & @ # $ % * ( ) [ ] { } / – — “ ” ‘ ’ , . : ;" },
];

function detailHtml(font, fonts, pkg, ctx, partials) {
  const { config } = ctx;
  const origin = config.origin;
  const labels = categoryLabels(config);
  const categoryLabel = labels[font.category];
  const variants = sortedVariants(font);
  const styleCount = `${variants.length} style${variants.length === 1 ? "" : "s"}`;
  const name = escapeHtml(font.name);

  const title = `${font.name} Font — Free Download | BPOZZ`;
  const description =
    `${font.name} is a free ${categoryLabel.toLowerCase()} font by ${font.designer}, ` +
    `licensed under the ${font.license}. Preview its ${styleCount} and ` +
    `download the font files.`;
  const canonical = origin + pageUrl(font);

  const bands = metaBands({
    title,
    description,
    canonical,
    ogImage: `${origin}/og-image.png`,
  });

  const jsonLd = structuredData.scriptsHtml(
    structuredData.fontJsonLd({
      font: Object.assign({}, font, { categoryLabel }),
      description,
      origin,
    }),
    4,
  );

  const related = relatedFonts(font, fonts);
  const faces = variants
    .map((v) => fontFaceRule(font, v))
    .concat(related.map((f) => fontFaceRule(f, previewVariant(f))));

  const headMarkup = head.headHtml({
    consentNote: HEAD_OPTIONS.consentNote,
    meta: bands.meta,
    social: bands.social,
    stylesheets: HEAD_OPTIONS.stylesheets,
    structuredData: jsonLd,
    after: fontFaceStyle(faces) + NOSCRIPT_FACES.replace(/\n$/, ""),
  });

  const hero = previewVariant(font);
  const heroStyle = `font-family:${cssFamily(font)};font-weight:${hero.weight};font-style:${hero.style}`;

  const presets = PRESETS.map(
    (p, i) =>
      `<button type="button" class="font-preset" data-preset="${escapeHtml(p.text)}" aria-pressed="${i === 0}">${escapeHtml(p.label)}</button>`,
  ).join("\n              ");

  const styles = variants
    .map((v) => `<li>${styleName(v)} <span class="font-info__muted">${v.weight}</span></li>`)
    .join("");

  const formats = formatsOf(font)
    .map(
      (f) =>
        `<li>${f.label} <span class="font-info__muted">${f.uses.join(" and ")}</span></li>`,
    )
    .join("");

  const licenseUrl = fileUrl(font, font.licenseFile);
  const rfnNote = font.reservedFontName
    ? `<p class="font-info__note">This family declares a Reserved Font Name: if you modify the font, the modified version must use a different name.</p>`
    : "";

  const relatedHtml = related.length
    ? `
      <section class="font-related" aria-labelledby="font-related-title">
        <h2 class="font-section-title" id="font-related-title">More ${escapeHtml(categoryLabel)} fonts</h2>
        <ul class="font-grid font-grid--related">
          ${related.map((f) => cardHtml(f, labels, "h3")).join("\n          ")}
        </ul>
      </section>`
    : "";

  return `${headMarkup}  <body class="fonts-page font-page" data-font-id="${font.id}">
${head.skipLinkHtml("font-content", "Skip to content")}

    ${head.headerRegion(partials.header)}

    <main class="wrap fonts-main" id="font-content" tabindex="-1">
      <nav class="font-breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li><a href="/${FONTS_DIR}/">Fonts</a></li>
          <li><a href="/${FONTS_DIR}/?category=${font.category}">${escapeHtml(categoryLabel)}</a></li>
          <li><span aria-current="page">${name}</span></li>
        </ol>
      </nav>

      <div class="font-detail">
        <header class="font-detail__head">
          <h1 class="font-detail__title" style="${escapeHtml(heroStyle)}">${name}</h1>
          <p class="font-detail__meta">${escapeHtml(categoryLabel)} · by ${escapeHtml(font.designer)} · ${styleCount}</p>
        </header>

        <div class="font-panel font-panel--actions">
          <div class="font-actions">
            <button type="button" class="font-action" data-font-fav="${font.id}" data-font-fav-label aria-pressed="false">${ICON_HEART}<span>Save</span></button>
            <a class="font-action font-action--primary" href="${fileUrl(font, pkg.file)}" download="${pkg.file}">${ICON_DOWNLOAD}<span>Download</span></a>
            <div class="font-menu">
              <button type="button" class="font-action font-action--icon" data-font-menu aria-haspopup="true" aria-expanded="false" aria-controls="font-menu-detail" aria-label="More options for ${name}">${ICON_MORE}</button>
              <div class="font-menu__list font-menu__list--end" id="font-menu-detail" role="menu" hidden>
                <button type="button" class="font-menu__item" role="menuitem" data-font-copy="${name}">Copy font name</button>
                <button type="button" class="font-menu__item" role="menuitem" data-font-copy="${escapeHtml(`font-family: ${cssFamily(font)};`)}" data-font-copy-label="CSS copied">Copy CSS font-family</button>
                <a class="font-menu__item" role="menuitem" href="${licenseUrl}">View license file</a>
              </div>
            </div>
          </div>
          <p class="font-info__size">${escapeHtml(pkg.file)} · ${formatBytes(pkg.bytes)} · ${pkg.count} files including ${escapeHtml(font.licenseFile)}</p>
        </div>

        <section class="font-specimens" aria-labelledby="font-specimens-title">
          <h2 class="font-section-title" id="font-specimens-title">Styles</h2>
          <div class="font-tester">
            <div class="font-presets" role="group" aria-label="Preview text">
              ${presets}
            </div>
            <div class="font-tester__row">
              <div class="fonts-field fonts-field--preview">
                <label class="sr-only" for="font-custom-text">Custom preview text</label>
                <input type="text" id="font-custom-text" placeholder="Type your own text…" maxlength="120" autocomplete="off" />
              </div>
              <div class="font-size-control">
                <label for="font-size">Size</label>
                <input type="range" id="font-size" min="16" max="120" step="1" value="${DISPLAY_SIZE}" />
                <output for="font-size" id="font-size-value">${DISPLAY_SIZE}px</output>
              </div>
            </div>
          </div>
          <ol class="font-specimen-list">
            ${specimenRows(font)}
          </ol>
        </section>

        <div class="font-panel font-panel--info">
          <h2 class="sr-only">About ${name}</h2>
          <dl class="font-info__list">
            <div><dt>About</dt><dd>${escapeHtml(font.description)}</dd></div>
            <div><dt>Designer</dt><dd>${escapeHtml(font.designer)}</dd></div>
            <div><dt>Category</dt><dd><a href="/${FONTS_DIR}/?category=${font.category}">${escapeHtml(categoryLabel)}</a></dd></div>
            <div><dt>License</dt><dd>
              <a href="${escapeHtml(font.licenseUrl)}" rel="license">${escapeHtml(font.license)}</a>
              <p class="font-info__note">You may use, embed, modify and redistribute this font, including in commercial projects. The font files may not be sold on their own. <a href="${licenseUrl}">Read the full license (${escapeHtml(font.licenseFile)})</a>.</p>
              ${rfnNote}
              <p class="font-info__note font-info__copyright">${escapeHtml(font.copyright)}</p>
            </dd></div>
            <div><dt>Source</dt><dd>
              <a href="${escapeHtml(font.sourceUrl)}">${escapeHtml(font.source)}</a>
              <p class="font-info__note">Files taken unmodified from the <a href="${escapeHtml(font.repositoryUrl)}">google/fonts repository</a>. Added to Google Fonts ${formatDate(font.dateAdded)}.</p>
            </dd></div>
            <div><dt>Available styles</dt><dd><ul class="font-info__styles">${styles}</ul></dd></div>
            <div><dt>Available formats</dt><dd><ul class="font-info__styles">${formats}</ul></dd></div>
          </dl>
        </div>
      </div>
${relatedHtml}
    </main>

    ${head.footerRegion(partials.footer)}

${LIVE_REGIONS}${BODY_CLOSE}`;
}

// ---------------------------------------------------------------------
// render
// ---------------------------------------------------------------------

/**
 * Everything this builder produces, in memory: the pages (by route file) and
 * the download packages (by dist-relative path). Reads the partials and the
 * font files; writes nothing. `render` writes it out, and the tests call it
 * directly so they can check the pages without a build having run.
 */
function build(ctx) {
  const { root } = ctx.config.paths;
  const fontDir = ctx.config.paths.content.fontFiles;

  const fonts = ctx.model.fonts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const partials = {
    header: fs.readFileSync(path.join(root, HEADER_PARTIAL), "utf8").trim(),
    footer: fs.readFileSync(path.join(root, FOOTER_PARTIAL), "utf8").trim(),
  };

  const pages = [
    { file: `${FONTS_DIR}/index.html`, html: listingHtml(fonts, ctx, partials) },
  ];
  const packages = [];

  for (const font of fonts) {
    const entries = packageEntries(font, fontDir);
    const zip = zipStore(entries);
    const file = zipName(font);
    packages.push({ file: `${FONTS_DIR}/${font.id}/${file}`, data: zip });

    const pkg = { file, bytes: zip.length, count: entries.length };
    pages.push({
      file: `${FONTS_DIR}/${font.id}.html`,
      html: detailHtml(font, fonts, pkg, ctx, partials),
    });
  }

  return { pages, packages };
}

/**
 * Writes fonts/index.html and every fonts/<id>.html into the staging root,
 * and every download package into dist/. Pages are written unconditionally,
 * like the other writers.
 *
 * Returns { written, packages, packageBytes } for the caller to summarize.
 */
function render(ctx) {
  const { stage, dist } = ctx.config.paths;
  const out = build(ctx);

  const written = [];
  out.pages.forEach(function (page) {
    const file = path.join(stage, page.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, page.html);
    written.push(page.file);
  });

  let packageBytes = 0;
  out.packages.forEach(function (pkg) {
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
  zipStore,
  crc32,
  packageEntries,
  cardHtml,
  styleName,
  sortedVariants,
  previewVariant,
  formatsOf,
  fontFaceRule,
  zipName,
  pageUrl,
  fileUrl,
  cssFamily,
  formatBytes,
  HEAD_OPTIONS,
  FONTS_DIR,
  STYLESHEET,
  SCRIPT,
  DEFAULT_SPECIMEN,
  TEXT_SIZE,
  DISPLAY_SIZE,
};
