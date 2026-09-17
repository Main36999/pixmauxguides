#!/usr/bin/env node
/**
 * build-home.js
 * -----------------------------------------------------------------------
 * Pre-renders three pieces of static HTML at build time:
 *   - the homepage guide grid (index.html #grid-root), from guides.json —
 *     the exact same markup app.js's cardHtml() would produce client-side.
 *   - the homepage resource sections (index.html, between
 *     RESOURCE_SECTIONS_START/END — Phase 5), from resource-types.json +
 *     content-index.json. See "Homepage resource sections" below.
 *   - the learning roadmap, which lives on its own page (roadmap.html
 *     #roadmap) rather than as a section of the homepage. It has no
 *     client-side equivalent at all (see the ROADMAP_STAGES section
 *     below) — app.js only layers "mark as read" checkbox/progress-bar
 *     behavior on top of what this script writes.
 *
 * WHY THIS EXISTS
 * Previously #grid-root started empty and was only filled in by
 * app.js after a client-side fetch("/guides.json"). That meant the
 * guide list — and the site's core content — didn't exist in the raw
 * HTML at all until JavaScript ran. This script closes that gap:
 * guides.json stays the single source of truth, but running this
 * script writes its contents into index.html and roadmap.html as
 * plain HTML, so both pages are fully readable with JavaScript off
 * and by any crawler that doesn't execute JS.
 *
 * app.js is otherwise UNCHANGED and still fetches guides.json on load
 * and re-renders #grid-root for live search/filter/category
 * interactivity — it just now enhances a page that already has real
 * content on it, instead of building the page from nothing. The
 * roadmap is simpler: it isn't searchable/filterable, so app.js never
 * rebuilds it — it only adds "mark as read" checkbox/progress-bar
 * behavior on top of the static markup this script writes.
 *
 * USAGE
 *   node build-home.js
 *
 * Run this locally (or as your host's build command) every time
 * guides.json, content-index.json or resource-types.json changes, before
 * you deploy/commit index.html and roadmap.html. Since Phase 5 this reads
 * content-index.json, so run `node build-content-index.js` first whenever
 * guides.json / tokens.json / palettes/palettes-data.json change (full
 * order: bpozz-phase-5-handoff.md, "Build commands").
 * Netlify: set "Build command" to `node build-home.js` and
 * "Publish directory" to the repo root.
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const GUIDES_JSON_PATH = path.join(ROOT, "guides.json");
const INDEX_HTML_PATH = path.join(ROOT, "index.html");
const ROADMAP_HTML_PATH = path.join(ROOT, "roadmap.html");
const CONTENT_INDEX_PATH = path.join(ROOT, "content-index.json");
const RESOURCE_TYPES_PATH = path.join(ROOT, "resource-types.json");

// ---------------------------------------------------------------------
// Ported 1:1 from app.js. If you ever edit a card's markup/labels in
// app.js's cardHtml()/thumbHtml()/thumbMediaHtml()/dimLine(), mirror
// the change here too so the pre-rendered HTML and the JS-rendered
// HTML never drift apart.
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

// Full-word level labels, shared by the homepage card's minimal meta
// line (e.g. "Spacing & Layout · Beginner · 11 min read") and the
// roadmap's step meta line below — both use the exact same "Level ·
// N min read" phrasing so the two pages read as one consistent system.
const LEVEL_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
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

// Minimal, resourceboy.com-style card: plain thumbnail, a title, and
// one small muted meta line ("category · level · read time") — no
// badge overlay, no description paragraph, no separate button. The
// title's .card-link stretches over the whole .guide-card (see
// styles.css), so the entire tile is one click target. Keep this in
// sync with app.js's cardHtml()/thumbHtml() — see the note at the top
// of this file.
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
// Learning roadmap (roadmap.html #roadmap)
// ---------------------------------------------------------------------
// A curated, opinionated reading order through the guides, grouped into
// stages. Unlike the grid above, the roadmap has no client-side render
// path to keep in sync — it's built here once, at build time, and the
// resulting markup is static. app.js only layers "mark as read"
// checkbox + progress-bar behavior on top of it (see the "roadmap
// progress" block near the end of app.js); it never rebuilds this list.
//
// Ordering comes from each guide's `roadmapStage` / `roadmapStep` fields
// in guides.json (roadmapStep is a single 1..N sequence used to sort
// guides within a stage). A guide with no `roadmapStage` is simply left
// off the roadmap — that's the mechanism for keeping a brand-new guide
// off the suggested path until you've decided where it belongs.
const ROADMAP_STAGES = [
  {
    id: 1,
    title: "Foundations",
    blurb:
      "Start here. The three principles every later guide assumes you already know: how space, contrast, and line length carry meaning before color or type styling enters the picture.",
  },
  {
    id: 2,
    title: "Typography & Color Systems",
    blurb:
      "Turn one-off choices into systems — a type scale that resizes itself, a color palette built from tokens instead of swatches, and a dark theme that's re-derived rather than inverted.",
  },
  {
    id: 3,
    title: "Layout, Structure & Accessibility",
    blurb:
      "Make an interface hold together everywhere it's used: Figma's constraint model, a responsive layout that's a contract rather than a breakpoint list, and the accessibility tree underneath it all.",
  },
  {
    id: 4,
    title: "Systems & Motion",
    blurb:
      "The advanced layer teams reach for once the basics are solid: Figma's own data layer for theming, naming conventions that survive a rebrand, and motion timing with real physics behind it.",
  },
];

function roadmapStepHtml(g) {
  const ariaLabel = escapeHtml(`Mark "${g.title}" as read`);
  return (
    `<li class="roadmap-step">` +
    `<label class="roadmap-step-check">` +
    `<input type="checkbox" class="roadmap-step-checkbox" data-roadmap-id="${escapeHtml(g.id)}" aria-label="${ariaLabel}">` +
    `<span class="roadmap-step-box" aria-hidden="true"><svg viewBox="0 0 12 10"><path d="M1 5.2L4.4 8.6L11 1.4"/></svg></span>` +
    `</label>` +
    `<a class="roadmap-step-link" href="/guide/${g.id}">` +
    `<span class="roadmap-step-title">${escapeHtml(g.title)}</span>` +
    `<span class="roadmap-step-meta">${LEVEL_LABEL[g.level]} · ${g.readTime} min read</span>` +
    `</a>` +
    `</li>`
  );
}

function roadmapStageHtml(stage, guides) {
  const num = String(stage.id).padStart(2, "0");
  return (
    `<li class="roadmap-stage" data-stage="${stage.id}">` +
    `<div class="roadmap-stage-marker"><span class="roadmap-stage-num mono">${num}</span></div>` +
    `<div class="roadmap-stage-body">` +
    `<div class="roadmap-stage-headline">` +
    `<h3 class="roadmap-stage-title">${escapeHtml(stage.title)}</h3>` +
    `<span class="roadmap-stage-count">${guides.length} guide${guides.length === 1 ? "" : "s"}</span>` +
    `</div>` +
    `<p class="roadmap-stage-blurb">${escapeHtml(stage.blurb)}</p>` +
    `<ul class="roadmap-steps">${guides.map(roadmapStepHtml).join("")}</ul>` +
    `</div>` +
    `</li>`
  );
}

function formatRoadmapTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `~${m}m`;
  if (m === 0) return `~${h}h`;
  return `~${h}h ${m}m`;
}

// Builds every piece build-home.js needs to splice into roadmap.html's
// #roadmap section: the stage-by-stage markup, plus the small stats
// (stage count / guide count / total reading time) shown above it.
function buildRoadmap(guides) {
  const roadmapGuides = guides
    .filter((g) => typeof g.roadmapStage === "number")
    .slice()
    .sort((a, b) => (a.roadmapStep || 0) - (b.roadmapStep || 0));

  const byStage = new Map();
  roadmapGuides.forEach((g) => {
    if (!byStage.has(g.roadmapStage)) byStage.set(g.roadmapStage, []);
    byStage.get(g.roadmapStage).push(g);
  });

  const stagesUsed = ROADMAP_STAGES.filter((s) => byStage.has(s.id));
  const stagesHtml = stagesUsed
    .map((s) => roadmapStageHtml(s, byStage.get(s.id)))
    .join("");

  const totalMinutes = roadmapGuides.reduce(
    (sum, g) => sum + (g.readTime || 0),
    0,
  );

  return {
    stagesHtml,
    stageCount: stagesUsed.length,
    guideCount: roadmapGuides.length,
    totalTimeLabel: formatRoadmapTime(totalMinutes),
  };
}

// ---------------------------------------------------------------------
// Homepage resource sections (Phase 5)
// ---------------------------------------------------------------------
// index.html is still the Guides landing page: the guide grid above
// (#grid-root, the Level filter, app.js's client-side render) is left
// exactly as it was — the transitional exception until a dedicated
// Guides page is intentionally designed. Every OTHER shipped resource
// type is previewed below it in a generated "resource section", one per
// resource-types.json entry whose `home` is an object (Guides' entry has
// `home: null`, which is how it opts out of this loop).
//
// These sections are written between RESOURCE_SECTIONS_START/END, which
// sit inside <main id="guides"> but OUTSIDE #grid-root — app.js replaces
// #grid-root's innerHTML on load, so anything inside it would be wiped.
// They're build-time only: no JS, no Firebase, no like/copy controls
// (those belong to the Tokens/Palettes apps themselves).
//
// Adding a future resource type to the homepage = its records in
// content-index.json + one resource-types.json entry. A type with no
// bespoke card below falls back to genericCardHtml(). A type with zero
// records renders nothing (no empty/placeholder section).
//
// SORTS mirror each gallery's own client-side sort exactly, so a section
// shows the same leading items that gallery shows for that sort:
//   popular — tokens-gallery.js getSorted() "popular"
//   latest  — palettes/palettes.js sortedList() "new"
// Array.prototype.sort is stable, so ties keep content-index.json order.
//
// TWIN EXCLUSION
// Every palette is a 1:1 "twin" of a token (build-content-index.js
// matches them on background/surface/primary/secondary hex values, and
// gives the palette the token's title/tags/date). Without this rule the
// Tokens and Palettes sections would repeat the same names. Sections are
// filled in `home.order`; a record is skipped when the first four of its
// `colors` (lowercased) match a record already shown in an earlier
// section — the same four-color key the index builder uses to define a
// twin. The skip happens BEFORE the limit is applied, so a section still
// fills up to `limit` whenever enough non-twin records exist. Records
// without `colors` are never affected.

const HOME_SORTS = {
  popular: function (a, b) {
    return (b.popularity || 0) - (a.popularity || 0);
  },
  latest: function (a, b) {
    return (b.date || "").localeCompare(a.date || "");
  },
};

// Section label prefix per sort, in the homepage's existing "/ all_guides"
// / "/ trending_categories" label style — e.g. "/ popular_tokens".
const SORT_LABEL = { popular: "popular", latest: "latest" };

const HEX_RE = /^#[0-9a-f]{6}$/i;

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Could not read ${label} (${filePath}): ${err.message}`);
  }
}

function loadResourceTypes() {
  const registry = readJson(RESOURCE_TYPES_PATH, "resource-types.json");
  if (!Array.isArray(registry)) {
    throw new Error("resource-types.json did not contain an array");
  }
  const seen = new Set();
  registry.forEach(function (entry, i) {
    const where = `resource-types.json[${i}]`;
    if (!entry || typeof entry !== "object") {
      throw new Error(`${where} is not an object`);
    }
    if (typeof entry.type !== "string" || !/^[a-z0-9-]+$/.test(entry.type)) {
      throw new Error(`${where}.type must be a lowercase slug`);
    }
    if (seen.has(entry.type)) {
      throw new Error(`${where}: duplicate type "${entry.type}"`);
    }
    seen.add(entry.type);
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`${where}.label must be a non-empty string`);
    }
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
    if (!Object.prototype.hasOwnProperty.call(HOME_SORTS, home.sort)) {
      throw new Error(
        `${where}.home.sort must be one of: ${Object.keys(HOME_SORTS).join(", ")}`,
      );
    }
    if (typeof entry.landingUrl !== "string" || !entry.landingUrl.trim()) {
      throw new Error(`${where}.landingUrl must be a non-empty string`);
    }
  });
  return registry;
}

function colorKey(record) {
  if (!Array.isArray(record.colors) || record.colors.length < 4) return null;
  return record.colors
    .slice(0, 4)
    .map(function (hex) {
      return String(hex).trim().toLowerCase();
    })
    .join("|");
}

// Colors are written into inline style attributes, so each one is
// validated as a plain #rrggbb value first — a malformed value fails the
// build instead of reaching the page.
function validatedColors(record) {
  const colors = Array.isArray(record.colors) ? record.colors : [];
  colors.forEach(function (hex) {
    if (typeof hex !== "string" || !HEX_RE.test(hex)) {
      throw new Error(
        `content-index record "${record.id}" has an invalid color value: ${JSON.stringify(hex)}`,
      );
    }
  });
  return colors;
}

function colorThumbHtml(record, modifier) {
  const colors = validatedColors(record);
  if (!colors.length) return "";
  return (
    `<div class="card-thumb ${modifier}" aria-hidden="true">` +
    colors
      .map(function (hex) {
        return `<span style="background-color:${hex}"></span>`;
      })
      .join("") +
    `</div>`
  );
}

// Title Cased tags, identical to build-categories.js's tagsMetaFor() and
// search.html's Token/Palette snippet, so a record reads the same way on
// every discovery surface.
function tagsMetaFor(record) {
  if (!Array.isArray(record.tags) || !record.tags.length) return "";
  return record.tags
    .map(function (t) {
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(" · ");
}

function recordTitleHtml(record) {
  return `<h3 class="card-title"><a class="card-link" href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></h3>`;
}

// Token: its full role set as a swatch row (a token is a role system, not
// a row of four swatches) + name + tags. Links to /tokens/<slug>.html.
function tokenCardHtml(record) {
  const meta = tagsMetaFor(record);
  return (
    `<article class="guide-card">` +
    colorThumbHtml(record, "card-thumb--swatches") +
    `<div class="card-body">` +
    recordTitleHtml(record) +
    (meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : "") +
    `</div></article>`
  );
}

// Palette: its four colors as stacked bars (the /palettes gallery's own
// visual) + name. Links to /palettes#<id>, which palettes.js resolves.
function paletteCardHtml(record) {
  return (
    `<article class="guide-card">` +
    colorThumbHtml(record, "card-thumb--bars") +
    `<div class="card-body">` +
    recordTitleHtml(record) +
    `</div></article>`
  );
}

// Fallback for a resource type with no bespoke card yet: title + tags,
// plus a swatch row only if the record carries colors.
function genericCardHtml(record) {
  const meta = tagsMetaFor(record);
  return (
    `<article class="guide-card">` +
    colorThumbHtml(record, "card-thumb--swatches") +
    `<div class="card-body">` +
    recordTitleHtml(record) +
    (meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : "") +
    `</div></article>`
  );
}

const CARD_RENDERERS = {
  token: tokenCardHtml,
  palette: paletteCardHtml,
};

function sectionLabelSlug(entry) {
  const words = entry.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${SORT_LABEL[entry.home.sort]}_${words}`;
}

function resourceSectionHtml(entry, records, total) {
  const headingId = `resource-section-${entry.type}`;
  const render = CARD_RENDERERS[entry.type] || genericCardHtml;
  return (
    `<section class="resource-section" aria-labelledby="${headingId}">` +
    `<div class="section-head">` +
    `<h2 class="section-label" id="${headingId}">/ ${escapeHtml(sectionLabelSlug(entry))}</h2>` +
    `<div class="section-head__meta">` +
    `<p class="results-count">Showing ${records.length} of ${total}</p>` +
    `<a class="resource-section__all" href="${escapeHtml(entry.landingUrl)}" aria-label="View all ${escapeHtml(entry.label)}">View all<span aria-hidden="true"> →</span></a>` +
    `</div>` +
    `</div>` +
    `<div class="grid">${records.map(render).join("")}</div>` +
    `</section>`
  );
}

function buildResourceSections(registry, contentIndex) {
  const entries = registry
    .filter(function (entry) {
      return entry.home;
    })
    .slice()
    .sort(function (a, b) {
      return a.home.order - b.home.order;
    });

  const shownColorKeys = new Set();
  const sectionsHtml = [];
  const summary = [];

  entries.forEach(function (entry) {
    const all = contentIndex.filter(function (record) {
      return record.type === entry.type;
    });
    const sorted = all.slice().sort(HOME_SORTS[entry.home.sort]);
    const picked = [];
    let twinsSkipped = 0;
    for (const record of sorted) {
      if (picked.length >= entry.home.limit) break;
      const key = colorKey(record);
      if (key && shownColorKeys.has(key)) {
        twinsSkipped++;
        continue;
      }
      if (typeof record.url !== "string" || !record.url) {
        throw new Error(`content-index record "${record.id}" has no url`);
      }
      picked.push(record);
      if (key) shownColorKeys.add(key);
    }

    if (!picked.length) {
      summary.push(`${entry.type}: 0 records — section omitted`);
      return;
    }
    sectionsHtml.push(resourceSectionHtml(entry, picked, all.length));
    summary.push(
      `${entry.type}: ${picked.length} of ${all.length} (${entry.home.sort}` +
        (twinsSkipped ? `, ${twinsSkipped} twin${twinsSkipped === 1 ? "" : "s"} skipped` : "") +
        `)`,
    );
  });

  return { html: sectionsHtml.join(""), count: sectionsHtml.length, summary };
}

// ---------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------

function replaceBetween(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find markers ${startMarker} / ${endMarker} in index.html — did the file structure change?`,
    );
  }
  return (
    html.slice(0, start + startMarker.length) + replacement + html.slice(end)
  );
}

function buildIndexHtml(guides, resourceSections) {
  let html = fs.readFileSync(INDEX_HTML_PATH, "utf8");

  const cardsHtml = guides.map(cardHtml).join("");
  html = replaceBetween(
    html,
    "<!--GUIDES_GRID_START-->",
    "<!--GUIDES_GRID_END-->",
    cardsHtml,
  );

  html = replaceBetween(
    html,
    "<!--RESULTS_COUNT-->",
    "<!--/RESULTS_COUNT-->",
    `Showing ${guides.length} of ${guides.length} guides`,
  );

  html = replaceBetween(
    html,
    "<!--RESOURCE_SECTIONS_START-->",
    "<!--RESOURCE_SECTIONS_END-->",
    resourceSections.html,
  );

  fs.writeFileSync(INDEX_HTML_PATH, html);
  console.log(
    `✓ index.html updated — ${guides.length} guide${guides.length === 1 ? "" : "s"} pre-rendered into #grid-root; ` +
      `${resourceSections.count} resource section${resourceSections.count === 1 ? "" : "s"} (${resourceSections.summary.join("; ")}).`,
  );
}

function buildRoadmapHtml(guides) {
  let html = fs.readFileSync(ROADMAP_HTML_PATH, "utf8");

  const roadmap = buildRoadmap(guides);
  html = replaceBetween(
    html,
    "<!--ROADMAP_STAGES_START-->",
    "<!--ROADMAP_STAGES_END-->",
    roadmap.stagesHtml,
  );
  html = replaceBetween(
    html,
    "<!--ROADMAP_STAGE_COUNT-->",
    "<!--/ROADMAP_STAGE_COUNT-->",
    String(roadmap.stageCount),
  );
  html = replaceBetween(
    html,
    "<!--ROADMAP_GUIDE_COUNT-->",
    "<!--/ROADMAP_GUIDE_COUNT-->",
    String(roadmap.guideCount),
  );
  html = replaceBetween(
    html,
    "<!--ROADMAP_TOTAL_TIME-->",
    "<!--/ROADMAP_TOTAL_TIME-->",
    roadmap.totalTimeLabel,
  );

  fs.writeFileSync(ROADMAP_HTML_PATH, html);
  console.log(
    `✓ roadmap.html updated — ${roadmap.guideCount} guide${roadmap.guideCount === 1 ? "" : "s"} pre-rendered into #roadmap across ${roadmap.stageCount} stage${roadmap.stageCount === 1 ? "" : "s"}.`,
  );
}

function main() {
  const guides = JSON.parse(fs.readFileSync(GUIDES_JSON_PATH, "utf8"));
  if (!Array.isArray(guides)) {
    throw new Error("guides.json did not contain an array");
  }

  const registry = loadResourceTypes();
  const contentIndex = readJson(CONTENT_INDEX_PATH, "content-index.json");
  if (!Array.isArray(contentIndex)) {
    throw new Error("content-index.json did not contain an array");
  }

  buildIndexHtml(guides, buildResourceSections(registry, contentIndex));
  buildRoadmapHtml(guides);
}

main();
