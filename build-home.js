#!/usr/bin/env node
/**
 * build-home.js
 * -----------------------------------------------------------------------
 * Pre-renders two pieces of static HTML from guides.json at build time:
 *   - the homepage guide grid (index.html #grid-root) — the exact same
 *     markup app.js's cardHtml() would produce client-side.
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
 * guides.json changes, before you deploy/commit index.html and
 * roadmap.html.
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

const LEVEL_ABBR = { beginner: "BEG", intermediate: "INT", advanced: "ADV" };

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
  const cat = CATEGORIES[g.category];
  return `<div class="card-thumb">${thumbMediaHtml(g)}<span class="badge">${cat.code}</span></div>`;
}

function cardHtml(g) {
  return (
    `<article class="guide-card bracketed">` +
    thumbHtml(g) +
    `<div class="card-body">` +
    `<h3 class="card-title">${escapeHtml(g.title)}</h3>` +
    `<p class="card-desc">${escapeHtml(g.description)}</p>` +
    `<div class="card-footer">` +
    `<span class="card-meta mono">${LEVEL_ABBR[g.level]} · ${g.readTime} MIN</span>` +
    `<a class="btn btn-card" href="/guide/${g.id}">Read guide <span aria-hidden="true">→</span></a>` +
    `</div></div></article>`
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
      "The advanced layer teams reach for once the basics are solid: naming conventions that survive a rebrand, and motion timing with real physics behind it.",
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
    `<span class="roadmap-step-meta mono">${LEVEL_ABBR[g.level]} · ${g.readTime} MIN</span>` +
    `</a>` +
    `</li>`
  );
}

function roadmapStageHtml(stage, guides) {
  const num = String(stage.id).padStart(2, "0");
  return (
    `<li class="roadmap-stage bracketed" data-stage="${stage.id}">` +
    `<div class="roadmap-stage-marker"><span class="roadmap-stage-num mono">${num}</span></div>` +
    `<div class="roadmap-stage-body">` +
    `<div class="roadmap-stage-headline">` +
    `<h3 class="roadmap-stage-title">${escapeHtml(stage.title)}</h3>` +
    `<span class="badge roadmap-stage-count mono">${guides.length} GUIDE${guides.length === 1 ? "" : "S"}</span>` +
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
  if (h === 0) return `~${m}M`;
  if (m === 0) return `~${h}H`;
  return `~${h}H ${m}M`;
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

function buildIndexHtml(guides) {
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
    "<!--STAT_COUNT-->",
    "<!--/STAT_COUNT-->",
    String(guides.length),
  );

  html = replaceBetween(
    html,
    "<!--RESULTS_COUNT-->",
    "<!--/RESULTS_COUNT-->",
    `Showing ${guides.length} of ${guides.length} guides`,
  );

  fs.writeFileSync(INDEX_HTML_PATH, html);
  console.log(
    `✓ index.html updated — ${guides.length} guide${guides.length === 1 ? "" : "s"} pre-rendered into #grid-root.`,
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

  buildIndexHtml(guides);
  buildRoadmapHtml(guides);
}

main();
