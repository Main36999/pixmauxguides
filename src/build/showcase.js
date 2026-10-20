/**
 * src/build/showcase.js — the platform pages of the redesign (design preview).
 *
 * Writes, from src/data/showcase-demo.json (loaded as ctx.model.showcase):
 *
 *   /projects/            the project gallery: tabs, search, discipline
 *                         chips, "Newest first", 24 per page + Load more
 *   /projects/<slug>      one page per demo project
 *   /designers/           the designer directory, by most recent project
 *   /designers/<handle>   one profile per demo designer
 *   /studio/              the designer dashboard
 *   /studio/projects      manage projects (statuses, edit, delete)
 *   /studio/upload        share a project: upload, details, preview, publish
 *   /studio/profile       edit profile, with a live preview
 *   /studio/settings      account, notifications, privacy, danger zone
 *   /moderation/          the staff moderation queue
 *   /report               report a project
 *   /styleguide           the design system reference
 *
 * and patches the homepage's discovery region (HOME_SHOWCASE markers).
 *
 * EVERYTHING HERE IS A DEMONSTRATION. Every page carries the design-preview
 * bar and robots noindex, nofollow; none is in sitemap.xml. Every sample
 * project and designer carries a "Demo" badge. Interactions that would need
 * a backend (saving, uploading, publishing, reporting, moderating) run in
 * the browser only (src/client/showcase.js) and say so; nothing is sent
 * anywhere.
 *
 * ORDER: after the other page writers and before the header, which puts the
 * aria-current state into these pages and needs /projects/, /designers/ and
 * /studio/upload to exist to validate the header's destinations.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const head = require("./head.js");
const { escapeHtml } = require("../shared/html.js");
const showcaseArt = require("./showcase-art.js");

const HEADER_PARTIAL = path.join("partials", "header.html");
const FOOTER_PARTIAL = path.join("partials", "footer.html");
const INDEX_PAGE = "index.html";
const HOME_START = "<!--HOME_SHOWCASE_START-->";
const HOME_END = "<!--HOME_SHOWCASE_END-->";
const SEARCH_PAGE = "search.html";
const SEARCH_START = "<!--SEARCH_SHOWCASE_START-->";
const SEARCH_END = "<!--SEARCH_SHOWCASE_END-->";

const PER_PAGE = 24;
const HOME_LIMIT = 24;
const SCRIPT = "/showcase.js";

const e = escapeHtml;

// ---------------------------------------------------------------------
// icons (24px line icons, currentColor)
// ---------------------------------------------------------------------

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.8-4.8"/>',
  bookmark: '<path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5"/><path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  folder: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.2"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  pin: '<path d="M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  sparkle: '<path d="M12 4l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  dots: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  sort: '<path d="M7 5v14M3.5 15.5L7 19l3.5-3.5M14 7h7M14 12h5M14 17h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.3C1.6 7.4 3.6 4.5 6.8 4.5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.2 0 5.2 2.9 4 6.2C19.5 15.4 12 20 12 20z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19c1.2-3.2 3.6-5 6.5-5s5.3 1.8 6.5 5"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c1.6.7 2.8 2.3 3.5 4.6"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
};

function icon(name, cls = "") {
  return `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function monthYear(iso) {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

function initials(name) {
  return name
    .replace(/[^A-Za-zÀ-ÿ ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function avatar(designer, size = "") {
  const c = showcaseArt.avatarColors(designer.colors);
  return `<span class="avatar${size ? ` avatar--${size}` : ""}" style="background:${c.bg};color:${c.fg}" aria-hidden="true">${e(initials(designer.name))}</span>`;
}

const DEMO_BADGE = '<span class="badge badge--demo">Demo</span>';

const projectUrl = (p) => `/projects/${p.slug}`;
const designerUrl = (d) => `/designers/${d.handle}`;

// ---------------------------------------------------------------------
// the page frame
// ---------------------------------------------------------------------

function metaBand(title, description) {
  return `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${e(title)}</title>
    <meta name="description" content="${e(description)}" />
    <meta name="robots" content="noindex, nofollow" />

`;
}

const DEMO_COPY = {
  showcase:
    "Projects and designers on this page are sample content for reviewing the layout. Sharing work on bpozz isn't open yet.",
  studio:
    "The designer studio is a design preview. Nothing you enter here is saved, uploaded or published.",
  moderation:
    "The moderation queue is a design preview with sample reports. No action here affects anyone.",
  report:
    "Reporting is a design preview. Nothing is sent when you submit this form.",
  styleguide: "The design system reference for the bpozz redesign. Not a public page.",
};

function demoBar(kind) {
  return `<div class="demo-bar" role="note"><strong>Design preview</strong><span>${e(DEMO_COPY[kind])}</span></div>`;
}

function page({ title, description, bodyClass, demo, main, partials, data }) {
  const headMarkup = head.headHtml({
    meta: metaBand(title, description),
    social: "",
    stylesheets: [head.STYLESHEETS.site, head.STYLESHEETS.showcase],
  });
  const dataScript = data
    ? `\n    <script type="application/json" id="sc-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`
    : "";
  return `${headMarkup}  <body class="sc-page ${bodyClass}">
${head.skipLinkHtml("sc-main", "Skip to content")}

    ${head.headerRegion(partials.header)}
    ${demoBar(demo)}

    <main class="sc-main" id="sc-main" tabindex="-1">
${main}
    </main>

    ${head.footerRegion(partials.footer)}

    <div class="toast" id="toast" role="status" aria-live="polite"></div>${dataScript}
    <script src="/app.js"></script>
    <script src="${SCRIPT}"></script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------
// cards
// ---------------------------------------------------------------------

/** 1240 -> "1.2k", in the compact style the cards' counts use. */
function compactCount(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, "") : String(Math.round(k))) + "k";
}

/**
 * The like button and the view count, with SAMPLE numbers (see
 * showcase-data.js sampleStats). The heart toggles a like kept in this
 * browser only (src/client/showcase.js); it is a button outside the card's
 * link, so pressing it never opens the project. Both say they are samples.
 */
function statsHtml(p, cls = "shot") {
  const { likes, views } = p.sample;
  return `<div class="${cls}__stats">
              <button type="button" class="like-btn" data-demo-like="${p.slug}" data-count="${likes}" aria-pressed="false" aria-label="Like ${e(p.title)} (sample count: ${likes} likes)" title="Sample count for the design preview">${icon("heart")}<span class="like-btn__count">${compactCount(likes)}</span></button>
              <span class="view-count" title="Sample count for the design preview">${icon("eye")}<span aria-hidden="true">${compactCount(views)}</span><span class="sr-only">${views} views (sample count)</span></span>
            </div>`;
}

/** A project's discipline as a compact neutral label. */
function disciplineLabel(p) {
  return `<span class="discipline-label">${e(p.disciplineRecord.label)}</span>`;
}

function shotCard(p, { hidden = false, page = 1 } = {}) {
  const d = p.designerRecord;
  const search = [p.title, d.name, p.disciplineRecord.label, ...(p.tags || [])].join(" ").toLowerCase();
  return `<li class="shot" data-shot data-id="${p.slug}" data-discipline="${p.discipline}" data-search="${e(search)}" data-page="${page}"${hidden ? " hidden" : ""}>
          <div class="shot__media">
            <a class="shot__link" href="${projectUrl(p)}">
              ${showcaseArt.art(p, p.colors, 0)}
              <span class="shot__overlay"><span class="shot__title">${e(p.title)}</span></span>
            </a>
            <button type="button" class="shot__save" data-demo-save="${p.slug}" aria-pressed="false" aria-label="Save ${e(p.title)}">${icon("bookmark")}</button>
          </div>
          <div class="shot__meta">
            <a class="shot__designer" href="${designerUrl(d)}">${avatar(d, "sm")}<span>${e(d.name)}</span></a>
            ${DEMO_BADGE}
            ${statsHtml(p)}
          </div>
          <p class="shot__tags">${disciplineLabel(p)}</p>
        </li>`;
}

function shotGrid(projects, { paged = false, cls = "" } = {}) {
  const cards = projects
    .map((p, i) => {
      const pageNo = Math.floor(i / PER_PAGE) + 1;
      return shotCard(p, { hidden: paged && pageNo > 1, page: pageNo });
    })
    .join("\n        ");
  return `<ul class="shot-grid${cls ? " " + cls : ""}" data-shot-grid>
        ${cards}
      </ul>`;
}

/**
 * A designer as the directory shows them (/designers/, and since revision
 * 04 the homepage's Designers tab and Designers search results too): who
 * they are, three pieces of their latest work, their disciplines and how
 * much they have published. `level` is the name's heading level: an h2
 * under a page's h1, an h3 under a results heading.
 */
function designerCard(d, { level = 2 } = {}) {
  const work = d.projects
    .slice(0, 3)
    .map(
      (p) =>
        `<li><a href="${projectUrl(p)}" aria-label="${e(p.title)}">${showcaseArt.art(p, p.colors, 0)}</a></li>`,
    )
    .join("");
  const disciplines = [...new Set(d.projects.map((p) => p.disciplineRecord.label))];
  const search = [d.name, d.headline, d.location, ...disciplines].join(" ").toLowerCase();
  const slugs = [...new Set(d.projects.map((p) => p.discipline))].join(" ");
  return `<li class="designer-card" data-designer data-id="${d.handle}" data-disciplines="${slugs}" data-search="${e(search)}">
          <div class="designer-card__head">
            ${avatar(d, "lg")}
            <div class="designer-card__who">
              <h${level} class="designer-card__name"><a href="${designerUrl(d)}">${e(d.name)}</a> ${DEMO_BADGE}</h${level}>
              <p class="designer-card__headline">${e(d.headline)}</p>
              <p class="designer-card__meta">${icon("pin")}${e(d.location)}</p>
            </div>
            <a class="btn btn-outline btn-sm designer-card__cta" href="${designerUrl(d)}">View profile</a>
          </div>
          <ul class="designer-card__work">${work}</ul>
          <p class="designer-card__foot">${disciplines.map((l) => `<span class="badge">${e(l)}</span>`).join("")}<span class="designer-card__count">${plural(d.projects.length, "project")} · latest ${shortDate(d.projects[0].date)}</span></p>
        </li>`;
}

// ---------------------------------------------------------------------
// the discovery block (homepage and /projects/)
// ---------------------------------------------------------------------

function disciplineChips(disciplines, label) {
  return `<div class="chip-row" role="group" aria-label="${e(label)}" data-chip-row>
          <button type="button" class="chip" data-chip="" aria-pressed="true">All</button>
          ${disciplines
            .map(
              (d) =>
                `<button type="button" class="chip" data-chip="${d.slug}" aria-pressed="false">${e(d.label)}</button>`,
            )
            .join("\n          ")}
        </div>`;
}

/**
 * Projects / Designers, each with its icon. The active tab is told apart
 * by its type (ink and a heavier weight against muted), not by a rule, a
 * fill or a border. They are links to /projects/ and /designers/; on the
 * homepage (`home`) src/client/showcase.js turns them into in-page tabs.
 */
function browseTabs(active, { home = false } = {}) {
  const tab = (key, href, label, ic) =>
    `<a class="tab" href="${href}"${home ? ` data-tab="${key}" aria-controls="feed-${key}"` : ""}${active === key ? ' aria-current="page"' : ""}>${icon(ic, "tab__icon")}<span>${label}</span></a>`;
  return `<nav class="tabs discover__tabs" aria-label="Explore"${home ? " data-feed-tabs" : ""}>
          ${tab("projects", "/projects/", "Projects", "grid")}
          ${tab("designers", "/designers/", "Designers", "users")}
        </nav>`;
}

/**
 * The discovery search (revision 04): the site's one search component, the
 * header's (partials/header.html), at the same size; only its width
 * differs (platform.css .usearch). The original bpozz pill (muted surface,
 * the field, the blue circle with the magnifier) with the category inside
 * it: Projects, Designers or Guides. It opens /search?s=…&scope=…; `scope`
 * is the category it starts on. The one-line script after the form hands
 * it to the header's script at once, which makes the <select> the same
 * category menu as the header's and keeps the two boxes showing the same
 * query and category. (It used to wait for DOMContentLoaded, and could be
 * left as the native <select> where that event was held back.)
 */
const SEARCH_SCOPES = [
  ["projects", "Projects"],
  ["designers", "Designers"],
  ["guides", "Guides"],
];

function discoverSearch({ id, scope = "projects" }) {
  const options = SEARCH_SCOPES.map(
    ([value, label]) => `<option value="${value}"${value === scope ? " selected" : ""}>${label}</option>`,
  ).join("");
  return `<form class="discover__search usearch" role="search" action="/search" method="get" data-usearch data-discover-search>
            <label class="sr-only" for="${id}">Search bpozz</label>
            <input id="${id}" name="s" type="search" placeholder="Search bpozz…" autocomplete="off" />
            <span class="usearch__scope">
              <label class="sr-only" for="${id}-scope">Search in</label>
              <select id="${id}-scope" class="usearch__select" name="scope" autocomplete="off">${options}</select>
              <svg class="usearch__chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" /></svg>
            </span>
            <button type="submit" aria-label="Search bpozz">${icon("search")}</button>
          </form>
          <script data-cookieconsent="ignore">window.bpozzSearchScope && window.bpozzSearchScope.enhance(document.currentScript.previousElementSibling);</script>`;
}

const HOME_BATCH = 12;

/** The loading, error and empty states the preview switch can show. */
function previewStatePanels(noun) {
  return `<div class="discover__state" data-state-panel="loading" hidden>
          <ul class="shot-grid">${Array.from({ length: 8 }, () => '<li class="shot shot--skeleton"><div class="skeleton shot__media"></div><div class="shot__meta"><span class="skeleton" style="width:24px;height:24px;border-radius:50%"></span><span class="skeleton" style="width:40%;height:12px"></span></div></li>').join("")}</ul>
        </div>
        <div class="state-card discover__state" data-state-panel="error" hidden>
          <span class="state-card__art">${icon("alert")}</span>
          <h3>${noun} couldn't load</h3>
          <p>Check your connection and try again. Nothing you saved is lost.</p>
          <div class="cluster"><button type="button" class="btn btn-dark" data-state-reset>Try again</button></div>
        </div>
        <div class="state-card discover__state" data-state-panel="empty" hidden>
          <span class="state-card__art">${icon("image")}</span>
          <h3>No projects yet</h3>
          <p>When designers share their work, it appears here, newest first.</p>
          <div class="cluster"><a class="btn btn-primary" href="/studio/upload">${icon("upload")}Share your work</a></div>
        </div>`;
}

/**
 * The homepage's discovery block (revision 03): Projects and Designers as
 * in-page tabs over one gallery, discipline chips that filter either, and
 * an infinite feed.
 *
 * The first HOME_BATCH project cards are in the page, so it works and reads
 * without JavaScript (with a link on to /projects/). Every card the feed
 * can show is in an inert <template> per tab: src/client/showcase.js pages
 * through it as a cursor-based source, appending a batch as the visitor
 * nears the end of the grid and stopping when the sample set is used up.
 * A real backend replaces that one source (cursor in, items and the next
 * cursor out) without touching the gallery.
 *
 * The Designers tab shows the directory's own designer cards
 * (designerCard, in its .designer-grid), not project cards.
 *
 * The search hands off to /search with its category: Projects and
 * Designers list the sample set there, Guides the real guide and palette
 * index.
 */
function homeDiscoverBlock(showcase) {
  const first = showcase.projects.slice(0, HOME_BATCH);
  return `<section class="discover discover--home" aria-label="Explore" data-home-feed data-batch="${HOME_BATCH}">
      <div class="container container--wide">
        <div class="discover__bar">
          <div class="discover__nav">
            ${browseTabs("projects", { home: true })}
            ${DEMO_BADGE.replace("Demo", "Sample content")}
          </div>
          ${discoverSearch({ id: "home-q", scope: "projects" })}
        </div>
        <div class="discover__filters">
          ${disciplineChips(showcase.disciplines, "Filter by discipline")}
          <p class="discover__order" data-feed-order>${icon("sort")}<span>Newest first</span></p>
        </div>
        <p class="sr-only" data-feed-status aria-live="polite"></p>
        <div class="feed-panel" id="feed-projects" data-feed-panel="projects">
          <ul class="shot-grid" data-feed-grid>
        ${first.map((p) => shotCard(p)).join("\n        ")}
          </ul>
        </div>
        <div class="feed-panel" id="feed-designers" data-feed-panel="designers" hidden>
          <ul class="designer-grid" data-feed-grid></ul>
        </div>
        <div class="state-card" data-feed-empty hidden>
          <span class="state-card__art">${icon("search")}</span>
          <h3 data-feed-empty-title>Nothing matches this filter</h3>
          <p>Clear the discipline filter to see everything.</p>
          <div class="cluster"><button type="button" class="btn btn-outline" data-feed-reset>Clear the filter</button></div>
        </div>
        ${previewStatePanels("Projects")}
        <div class="feed-foot" data-feed-foot>
          <p class="feed-loading" data-feed-loading hidden><span class="spinner" aria-hidden="true"></span>Loading more</p>
          <a class="btn btn-outline btn-lg" href="/projects/" data-feed-more>See all projects ${icon("arrow")}</a>
          <p class="feed-end" data-feed-end hidden>That's everything for now. These are sample projects for the design preview.</p>
          <span class="feed-sentinel" data-feed-sentinel aria-hidden="true"></span>
        </div>
        <template data-feed-source="projects">${showcase.projects.map((p) => shotCard(p)).join("")}</template>
        <template data-feed-source="designers">${showcase.designers.map((d) => designerCard(d)).join("")}</template>
      </div>
    </section>`;
}

function discoverBlock(showcase, { home = false } = {}) {
  if (home) return homeDiscoverBlock(showcase);
  const projects = home ? showcase.projects.slice(0, HOME_LIMIT) : showcase.projects;
  const total = showcase.projects.length;
  const more = home
    ? `<a class="btn btn-outline btn-lg" href="/projects/">See all projects ${icon("arrow")}</a>`
    : total > PER_PAGE
      ? `<button type="button" class="btn btn-outline btn-lg" data-load-more>Load more projects</button>
          <p class="discover__end" data-discover-end hidden>You've seen every project.</p>`
      : "";
  // The homepage block has no visible title: it opens with its tabs,
  // search and filters, and is named for assistive technology instead.
  const label = home ? ' aria-label="Explore projects"' : ' aria-labelledby="projects-title"';
  return `<section class="discover${home ? " discover--home" : ""}"${label} data-discover="projects"${home ? " data-home" : ` data-per-page="${PER_PAGE}"`}>
      <div class="container container--wide">
        <div class="discover__bar">
          <div class="discover__nav">
            ${browseTabs("projects")}
            ${home ? DEMO_BADGE.replace("Demo", "Sample projects") : ""}
          </div>
          ${discoverSearch({ id: "projects-q", scope: "projects" })}
        </div>
        <div class="discover__filters">
          ${disciplineChips(showcase.disciplines, "Filter projects by discipline")}
          <p class="discover__order">${icon("sort")}Newest first</p>
        </div>
        <p class="sr-only" data-discover-count${home ? ` data-count-of="${total}"` : ""} aria-live="polite">${home ? `Latest ${projects.length} of ${total} projects` : plural(total, "project")}</p>
        ${shotGrid(projects, { paged: !home })}
        <div class="state-card" data-discover-empty hidden>
          <span class="state-card__art">${icon("search")}</span>
          <h3>No projects match</h3>
          <p>Try another word, or clear the discipline filter to see every project.</p>
          <div class="cluster"><button type="button" class="btn btn-outline" data-discover-reset>Clear search and filters</button></div>
        </div>
        <div class="discover__state" data-state-panel="loading" hidden>
          <ul class="shot-grid">${Array.from({ length: 8 }, () => '<li class="shot shot--skeleton"><div class="skeleton shot__media"></div><div class="shot__meta"><span class="skeleton" style="width:24px;height:24px;border-radius:50%"></span><span class="skeleton" style="width:40%;height:12px"></span></div></li>').join("")}</ul>
        </div>
        <div class="state-card discover__state" data-state-panel="error" hidden>
          <span class="state-card__art">${icon("alert")}</span>
          <h3>Projects couldn't load</h3>
          <p>Check your connection and try again. Nothing you saved is lost.</p>
          <div class="cluster"><button type="button" class="btn btn-dark" data-state-reset>Try again</button></div>
        </div>
        <div class="state-card discover__state" data-state-panel="empty" hidden>
          <span class="state-card__art">${icon("image")}</span>
          <h3>No projects yet</h3>
          <p>When designers share their work, it appears here, newest first.</p>
          <div class="cluster"><a class="btn btn-primary" href="/studio/upload">${icon("upload")}Share your work</a></div>
        </div>
        <div class="discover__more">
          ${more}
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------
// /projects/ and /projects/<slug>
// ---------------------------------------------------------------------

function projectsIndex(showcase, partials) {
  const main = `      <section class="container container--wide page-intro sc-intro">
        <p class="eyebrow">Explore</p>
        <h1 id="projects-title">Projects</h1>
        <p class="page-intro__dek">Identity, illustration, packaging, editorial, type and interface work from designers on bpozz, newest first.</p>
      </section>
      ${discoverBlock(showcase)}`;
  return page({
    title: "Projects - Explore bpozz (design preview)",
    description: "Design preview of the bpozz project gallery, shown with sample projects.",
    bodyClass: "sc-projects",
    demo: "showcase",
    main,
    partials,
  });
}

function factRow(label, value) {
  return `<div class="sc-facts__row"><dt>${e(label)}</dt><dd>${value}</dd></div>`;
}

function projectDetail(p, showcase, partials) {
  const d = p.designerRecord;
  const byDesigner = d.projects.filter((x) => x !== p).slice(0, 4);
  const sameDiscipline = showcase.projects
    .filter((x) => x.discipline === p.discipline && x !== p && x.designer !== p.designer)
    .slice(0, 4);
  const swatches = p.colors
    .map((c) => `<span class="sc-swatch" style="background:${c}" title="${c}"></span>`)
    .join("");

  const main = `      <article class="sc-project">
        <header class="container sc-project__head">
          <nav class="crumbs" aria-label="Breadcrumb">
            <a href="/projects/">Explore</a>
            <span aria-hidden="true">/</span>
            <a href="/projects/?discipline=${p.discipline}">${e(p.disciplineRecord.label)}</a>
          </nav>
          <h1 class="sc-project__title">${e(p.title)}</h1>
          <div class="sc-byline">
            <a class="sc-byline__who" href="${designerUrl(d)}">
              ${avatar(d, "lg")}
              <span class="sc-byline__text">
                <span class="sc-byline__name">${e(d.name)} ${DEMO_BADGE}</span>
                <span class="sc-byline__meta">${e(d.headline)} · ${e(d.location)}</span>
              </span>
            </a>
            <div class="sc-byline__actions">
              <button type="button" class="btn btn-outline like-btn like-btn--large" data-demo-like="${p.slug}" data-count="${p.sample.likes}" aria-pressed="false" aria-label="Like ${e(p.title)} (sample count: ${p.sample.likes} likes)" title="Sample count for the design preview">${icon("heart")}<span class="like-btn__count">${compactCount(p.sample.likes)}</span></button>
              <button type="button" class="btn btn-outline" data-demo-save="${p.slug}" aria-pressed="false">${icon("bookmark")}<span data-demo-save-label>Save</span></button>
              <button type="button" class="btn btn-outline btn-icon" data-copy-link aria-label="Copy link" title="Copy link">${icon("link")}</button>
              <a class="btn btn-outline btn-icon" href="/report?project=${p.slug}" aria-label="Report this project" title="Report this project">${icon("flag")}</a>
            </div>
          </div>
        </header>

        <div class="container sc-project__media">
          ${shotFigure(p, 0, "sc-shot--lead")}
          <p class="sc-project__views">${icon("eye")}<span>${p.sample.views.toLocaleString("en-US")} views</span><span class="badge badge--demo">Sample count</span></p>
        </div>

        <div class="container sc-project__body">
          <div class="sc-project__story">
            <p class="sc-project__lede">${e(p.summary)}</p>
            ${p.body.map((para) => `<p>${e(para)}</p>`).join("\n            ")}
          </div>
          <aside class="sc-facts" aria-label="Project details">
            <dl>
              ${factRow("Discipline", `<a href="/projects/?discipline=${p.discipline}">${e(p.disciplineRecord.label)}</a>`)}
              ${factRow("Published", `<time datetime="${p.date}">${shortDate(p.date)}</time>`)}
              ${factRow("Tools and techniques", `<span class="cluster">${p.tools.map((t) => `<span class="badge">${e(t)}</span>`).join("")}</span>`)}
              ${factRow("Tags", `<span class="cluster">${p.tags.map((t) => `<a class="badge sc-tag" href="/search?s=${encodeURIComponent(t)}&amp;scope=projects">#${e(t)}</a>`).join("")}</span>`)}
              ${factRow("Colors", `<a class="sc-palette" href="/palettes/" title="Colors from bpozz palette ${p.palette}">${swatches}<span>bpozz palette</span></a>`)}
            </dl>
          </aside>
        </div>

        <div class="container sc-project__gallery">
          ${[1, 2, 3].map((v) => shotFigure(p, v)).join("\n          ")}
        </div>

        <section class="container sc-designer-band" aria-label="About the designer">
          ${avatar(d, "xl")}
          <div class="sc-designer-band__text">
            <p class="eyebrow">Designed by</p>
            <h2><a href="${designerUrl(d)}">${e(d.name)}</a> ${DEMO_BADGE}</h2>
            <p>${e(d.bio)}</p>
          </div>
          <a class="btn btn-dark" href="${designerUrl(d)}">View profile</a>
        </section>
      </article>
${byDesigner.length ? relatedSection(`More by ${d.name}`, designerUrl(d), "View profile", byDesigner) : ""}${sameDiscipline.length ? relatedSection(`More ${p.disciplineRecord.label} projects`, `/projects/?discipline=${p.discipline}`, "See all", sameDiscipline) : ""}
      <p class="container sc-report-line">${icon("flag")}<span>Something wrong with this project? <a href="/report?project=${p.slug}">Report it</a>.</span></p>
      <dialog class="sc-lightbox" id="sc-lightbox" aria-label="Artwork, larger">
        <button type="button" class="sc-lightbox__close" data-lightbox-close aria-label="Close">${icon("x")}</button>
        <div class="sc-lightbox__stage" data-lightbox-stage></div>
      </dialog>`;

  return page({
    title: `${p.title} - Explore bpozz (design preview)`,
    description: `Design preview of a bpozz project page, shown with a sample project.`,
    bodyClass: "sc-project-page",
    demo: "showcase",
    main,
    partials,
  });
}

/**
 * One image of a project page. Sized in showcase.css to sit inside the
 * viewport (it never fills more than the screen's height), in its own 4:3
 * frame, never cropped or stretched. The artwork is a named image; the
 * expand button (and a press on the image) opens it larger in a dialog.
 */
const SHOT_NAMES = ["cover", "second image", "third image", "fourth image"];

function shotFigure(p, variant, cls = "") {
  const label = `${p.title}, ${SHOT_NAMES[variant]} (generated sample artwork)`;
  return `<figure class="sc-shot${cls ? " " + cls : ""}" data-lightbox-item>
            ${showcaseArt.art(p, p.colors, variant, { label })}
            <button type="button" class="sc-shot__expand" data-lightbox-open aria-label="View larger: ${e(label)}" title="View larger">${icon("expand")}</button>
          </figure>`;
}

function relatedSection(title, href, linkLabel, projects) {
  return `
      <section class="container section--tight sc-related">
        <div class="block-head">
          <h2>${e(title)}</h2>
          <a class="block-head__link" href="${href}">${e(linkLabel)} ${icon("arrow")}</a>
        </div>
        ${shotGrid(projects, { cls: "shot-grid--four" })}
      </section>
`;
}

// ---------------------------------------------------------------------
// /designers/ and /designers/<handle>
// ---------------------------------------------------------------------

function designersIndex(showcase, partials) {
  const cards = showcase.designers.map((d) => designerCard(d)).join("\n        ");
  const main = `      <section class="container container--wide page-intro sc-intro">
        <p class="eyebrow">Explore</p>
        <h1>Designers</h1>
        <p class="page-intro__dek">Meet the designers sharing work on bpozz. Every designer here has at least one published project.</p>
      </section>
      <section class="discover" aria-label="Designers" data-discover="designers">
        <div class="container container--wide">
          <div class="discover__bar">
            <div class="discover__nav">${browseTabs("designers")}</div>
            ${discoverSearch({ id: "designers-q", scope: "designers" })}
          </div>
          <div class="discover__filters">
            ${disciplineChips(showcase.disciplines, "Filter designers by discipline")}
            <p class="discover__order">${icon("clock")}Ordered by most recent project</p>
          </div>
          <p class="sr-only" data-discover-count aria-live="polite">${plural(showcase.designers.length, "designer")}</p>
          <ul class="designer-grid" data-shot-grid>
        ${cards}
          </ul>
          <div class="state-card" data-discover-empty hidden>
            <span class="state-card__art">${icon("user")}</span>
            <h3>No designers match</h3>
            <p>Try another name or city, or clear the discipline filter.</p>
            <div class="cluster"><button type="button" class="btn btn-outline" data-discover-reset>Clear search and filters</button></div>
          </div>
        </div>
      </section>`;
  return page({
    title: "Designers - Explore bpozz (design preview)",
    description: "Design preview of the bpozz designer directory, shown with sample designers.",
    bodyClass: "sc-designers",
    demo: "showcase",
    main,
    partials,
  });
}

function designerProfile(d, showcase, partials) {
  const disciplines = [...new Set(d.projects.map((p) => p.disciplineRecord.label))];
  const main = `      <section class="profile-band">
        <div class="container profile-band__inner">
          ${avatar(d, "xl")}
          <div class="profile-band__text">
            <p class="eyebrow">Designer ${DEMO_BADGE}</p>
            <h1>${e(d.name)}</h1>
            <p class="profile-band__headline">${e(d.headline)}</p>
            <ul class="profile-band__meta">
              <li>${icon("pin")}${e(d.location)}</li>
              <li>${icon("calendar")}On bpozz since ${monthYear(d.joined)}</li>
              <li>${icon("sparkle")}${e(d.availability)}</li>
            </ul>
          </div>
          <div class="profile-band__actions">
            <button type="button" class="btn btn-dark" data-demo-dialog="message">${icon("mail")}Contact</button>
            <button type="button" class="btn btn-outline" data-copy-link>${icon("link")}Share profile</button>
          </div>
        </div>
      </section>

      <div class="container profile-body" data-tabs>
        <div class="tabs" role="tablist" aria-label="Profile">
          <button type="button" class="tab" role="tab" id="tab-work" aria-controls="panel-work" aria-selected="true">Work <span class="tab__count">${d.projects.length}</span></button>
          <button type="button" class="tab" role="tab" id="tab-about" aria-controls="panel-about" aria-selected="false" tabindex="-1">About</button>
        </div>
        <div class="profile-panel" role="tabpanel" id="panel-work" aria-labelledby="tab-work">
          ${shotGrid(d.projects, { cls: "shot-grid--profile" })}
        </div>
        <div class="profile-panel profile-about" role="tabpanel" id="panel-about" aria-labelledby="tab-about" hidden>
          <div class="profile-about__bio">
            <h2>About</h2>
            <p>${e(d.bio)}</p>
          </div>
          <dl class="sc-facts profile-about__facts">
            ${factRow("Skills", `<span class="cluster">${d.skills.map((s) => `<span class="badge">${e(s)}</span>`).join("")}</span>`)}
            ${factRow("Disciplines", `<span class="cluster">${disciplines.map((s) => `<span class="badge">${e(s)}</span>`).join("")}</span>`)}
            ${factRow("Location", e(d.location))}
            ${factRow("Availability", e(d.availability))}
            ${factRow("Member since", monthYear(d.joined))}
          </dl>
        </div>
      </div>
      ${messageDialog(d)}`;

  return page({
    title: `${d.name} - bpozz Designers (design preview)`,
    description: "Design preview of a bpozz designer profile, shown with a sample designer.",
    bodyClass: "sc-profile",
    demo: "showcase",
    main,
    partials,
  });
}

function messageDialog(d) {
  return `<dialog class="sc-dialog" id="dialog-message" aria-labelledby="dialog-message-title">
        <form method="dialog" class="sc-dialog__body">
          <div class="sc-dialog__head">
            <h2 id="dialog-message-title">Contact ${e(d.name)}</h2>
            <button type="submit" class="btn btn-soft btn-icon btn-sm" aria-label="Close">${icon("x")}</button>
          </div>
          <div class="alert">${icon("info")}<span><strong>Not available yet.</strong> Messaging is part of a later release. In this preview the form shows the planned layout and sends nothing.</span></div>
          <label class="form-field"><span class="form-field__label">Subject</span><input class="input" type="text" placeholder="A project for your studio" /></label>
          <label class="form-field"><span class="form-field__label">Message</span><textarea class="textarea" placeholder="Tell ${e(d.name)} about your project, timeline and budget."></textarea></label>
          <div class="sc-dialog__foot">
            <button type="submit" class="btn btn-outline">Cancel</button>
            <button type="submit" class="btn btn-primary" disabled>Send message</button>
          </div>
        </form>
      </dialog>`;
}

// ---------------------------------------------------------------------
// the studio
// ---------------------------------------------------------------------

/**
 * The studio is shown as the sample designer Mira S. would see it. Her four
 * published projects come from the data; the draft and the projects in
 * review are listed here as studio-only states.
 */
function studioOwner(showcase) {
  return showcase.designers.find((d) => d.handle === "mira-s") || showcase.designers[0];
}

/**
 * The owner's studio list: her published demo projects, plus three
 * studio-only sample projects that show the other states. Those three are
 * not public, so they have no project page.
 */
const STUDIO_ONLY = [
  { slug: "harbour-cafe-menu-boards", title: "Harbour Café menu boards", discipline: "branding", kind: "brand", mark: "Harbour", status: "draft", updated: "2026-10-18", empty: true },
  { slug: "seaside-market-posters", title: "Seaside market posters", discipline: "print-editorial", kind: "poster", mark: "Sea Market", status: "review", updated: "2026-10-17" },
  { slug: "olive-grove-oil-labels", title: "Olive grove oil labels", discipline: "packaging", kind: "pack", mark: "Olea", status: "changes", updated: "2026-10-15", note: "Please credit the photographer in the description." },
];

function studioProjects(owner, showcase) {
  const disciplines = new Map(showcase.disciplines.map((d) => [d.slug, d]));
  const extra = STUDIO_ONLY.map((s, i) => ({
    project: Object.assign({}, s, {
      colors: owner.projects[i % owner.projects.length].colors,
      disciplineRecord: disciplines.get(s.discipline) || { label: s.discipline },
      studioOnly: true,
    }),
    status: s.status,
    updated: s.updated,
  }));
  const published = owner.projects.map((p) => ({ project: p, status: "published", updated: p.date }));
  return extra.concat(published);
}

const STATUS = {
  published: ["badge--success", "Published"],
  draft: ["", "Draft"],
  review: ["badge--info", "In review"],
  changes: ["badge--warning", "Needs changes"],
};

function statusBadge(status) {
  const [cls, label] = STATUS[status];
  return `<span class="badge badge--dot ${cls}">${label}</span>`;
}

function studioNav(active, owner) {
  const item = (key, href, ic, label) =>
    `<a class="studio-nav__item" href="${href}"${active === key ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`;
  return `<aside class="studio__aside">
          <div class="studio-me">
            ${avatar(owner, "lg")}
            <div>
              <p class="studio-me__name">${e(owner.name)} ${DEMO_BADGE}</p>
              <a class="studio-me__link" href="${designerUrl(owner)}">View public profile</a>
            </div>
          </div>
          <nav class="studio-nav" aria-label="Studio">
            ${item("dashboard", "/studio/", "home", "Dashboard")}
            ${item("projects", "/studio/projects", "folder", "Projects")}
            ${item("upload", "/studio/upload", "upload", "Share work")}
            ${item("profile", "/studio/profile", "user", "Profile")}
            ${item("saved", "/account#saved", "bookmark", "Saved")}
            ${item("settings", "/studio/settings", "settings", "Settings")}
          </nav>
          <div class="studio-help panel panel--canvas">
            <p class="panel__title">Community guidelines</p>
            <p class="panel__desc">Share only work you made or have the right to show, and credit everyone who worked on it.</p>
          </div>
        </aside>`;
}

function studioFrame(active, owner, content) {
  return `      <div class="container studio">
        ${studioNav(active, owner)}
        <div class="studio__main">
${content}
        </div>
      </div>`;
}

function projectRow(row) {
  const p = row.project;
  const thumb = p.empty
    ? `<span class="studio-row__thumb studio-row__thumb--empty">${icon("image")}</span>`
    : p.studioOnly
      ? `<span class="studio-row__thumb">${showcaseArt.art(p, p.colors, 0)}</span>`
      : `<a class="studio-row__thumb" href="${projectUrl(p)}" tabindex="-1" aria-hidden="true">${showcaseArt.art(p, p.colors, 0)}</a>`;
  const view = p.studioOnly
    ? ""
    : `<a class="btn btn-soft btn-sm btn-icon" href="${projectUrl(p)}" aria-label="View ${e(p.title)}" title="View">${icon("eye")}</a>`;
  return `<li class="studio-row" data-status="${row.status}">
              ${thumb}
              <div class="studio-row__text">
                <p class="studio-row__title">${p.studioOnly ? e(p.title) : `<a href="${projectUrl(p)}">${e(p.title)}</a>`}</p>
                <p class="studio-row__meta">${e(p.disciplineRecord.label)} · Updated ${shortDate(row.updated)}</p>
              </div>
              ${statusBadge(row.status)}
              <div class="studio-row__actions">
                <a class="btn btn-soft btn-sm" href="/studio/upload?edit=${p.slug}">${icon("edit")}Edit</a>
                ${view}
                <button type="button" class="btn btn-soft btn-sm btn-icon" data-demo-dialog="delete" data-title="${e(p.title)}" aria-label="Delete ${e(p.title)}" title="Delete">${icon("trash")}</button>
              </div>
            </li>`;
}

function deleteDialog() {
  return `<dialog class="sc-dialog" id="dialog-delete" aria-labelledby="dialog-delete-title">
        <form method="dialog" class="sc-dialog__body">
          <div class="sc-dialog__head">
            <h2 id="dialog-delete-title">Delete this project?</h2>
            <button type="submit" class="btn btn-soft btn-icon btn-sm" aria-label="Close">${icon("x")}</button>
          </div>
          <p class="muted"><strong data-dialog-title>This project</strong> and its images will be removed from your profile and the showcase. This can't be undone.</p>
          <div class="sc-dialog__foot">
            <button type="submit" class="btn btn-outline">Cancel</button>
            <button type="submit" class="btn btn-danger" value="confirm" data-demo-toast="Deleted in this preview only. Nothing was removed.">Delete project</button>
          </div>
        </form>
      </dialog>`;
}

function studioDashboard(showcase, partials) {
  const owner = studioOwner(showcase);
  const rows = studioProjects(owner, showcase);
  const count = (s) => rows.filter((r) => r.status === s).length;
  const changes = rows.find((r) => r.status === "changes").project;
  const review = rows.find((r) => r.status === "review").project;
  const content = `          <div class="studio-head">
            <div>
              <p class="eyebrow">Studio</p>
              <h1>Welcome back, ${e(owner.name.split(" ")[0])}</h1>
            </div>
            <a class="btn btn-primary" href="/studio/upload">${icon("upload")}Share new work</a>
          </div>

          <div class="studio-cards">
            <section class="panel studio-card">
              <div class="studio-card__head">
                <h2 class="panel__title">Profile strength</h2>
                <span class="badge badge--success">80%</span>
              </div>
              <div class="progress" role="img" aria-label="Profile 80% complete"><span style="width:80%"></span></div>
              <ul class="checklist">
                <li class="is-done">${icon("check")}Profile photo</li>
                <li class="is-done">${icon("check")}Headline and bio</li>
                <li class="is-done">${icon("check")}Disciplines and skills</li>
                <li>${icon("plus")}Portfolio website link</li>
              </ul>
              <a class="text-link" href="/studio/profile">Finish your profile</a>
            </section>

            <section class="panel studio-card">
              <h2 class="panel__title">Your projects</h2>
              <dl class="studio-stats">
                <div><dt>Published</dt><dd>${count("published")}</dd></div>
                <div><dt>In review</dt><dd>${count("review")}</dd></div>
                <div><dt>Needs changes</dt><dd>${count("changes")}</dd></div>
                <div><dt>Drafts</dt><dd>${count("draft")}</dd></div>
              </dl>
              <a class="text-link" href="/studio/projects">Manage projects</a>
            </section>

            <section class="panel studio-card studio-card--wide">
              <h2 class="panel__title">Notices</h2>
              <ul class="notices">
                <li class="notice notice--warning">${icon("alert")}<div><p><strong>${e(changes.title)}</strong> needs changes before it can be published.</p><p class="muted">Moderator note: ${e(changes.note)}</p></div><a class="btn btn-outline btn-sm" href="/studio/upload?edit=${changes.slug}">Edit</a></li>
                <li class="notice">${icon("clock")}<div><p><strong>${e(review.title)}</strong> is in review.</p><p class="muted">Most projects are reviewed within two working days.</p></div></li>
                <li class="notice notice--success">${icon("check")}<div><p><strong>${e(owner.projects[0].title)}</strong> was published.</p><p class="muted">It's now in the showcase and on your profile.</p></div><a class="btn btn-outline btn-sm" href="${projectUrl(owner.projects[0])}">View</a></li>
              </ul>
            </section>
          </div>

          <section class="studio-section" data-state-scope>
            <div class="block-head">
              <h2>Recent projects</h2>
              <a class="block-head__link" href="/studio/projects">All projects ${icon("arrow")}</a>
            </div>
            <ul class="studio-list" data-state-panel="ready">
            ${rows.slice(0, 4).map(projectRow).join("\n            ")}
            </ul>
            <div class="state-card" data-state-panel="empty" hidden>
              <span class="state-card__art">${icon("folder")}</span>
              <h3>You haven't shared any work yet</h3>
              <p>Upload images of a project, add a title and a few words, and publish it to your profile and the showcase.</p>
              <div class="cluster"><a class="btn btn-primary" href="/studio/upload">${icon("upload")}Share your first project</a></div>
            </div>
          </section>
      ${deleteDialog()}`;

  return page({
    title: "Studio - bpozz (design preview)",
    description: "Design preview of the bpozz designer dashboard.",
    bodyClass: "sc-studio",
    demo: "studio",
    main: studioFrame("dashboard", owner, content),
    partials,
  });
}

function studioProjectsPage(showcase, partials) {
  const owner = studioOwner(showcase);
  const rows = studioProjects(owner, showcase);
  const tab = (key, label, n, selected) =>
    `<button type="button" class="chip" data-status-filter="${key}" aria-pressed="${selected}">${label} <span class="chip__count">${n}</span></button>`;
  const count = (s) => rows.filter((r) => r.status === s).length;
  const content = `          <div class="studio-head">
            <div>
              <p class="eyebrow">Studio</p>
              <h1>Projects</h1>
            </div>
            <a class="btn btn-primary" href="/studio/upload">${icon("upload")}Share new work</a>
          </div>
          <div class="chip-row studio-filters" role="group" aria-label="Filter by status">
            ${tab("", "All", rows.length, true)}
            ${tab("published", "Published", count("published"), false)}
            ${tab("review", "In review", count("review"), false)}
            ${tab("changes", "Needs changes", count("changes"), false)}
            ${tab("draft", "Drafts", count("draft"), false)}
          </div>
          <ul class="studio-list" data-studio-list>
            ${rows.map(projectRow).join("\n            ")}
          </ul>
          <div class="panel panel--canvas studio-statuses">
            <h2 class="panel__title">What the statuses mean</h2>
            <dl>
              <div><dt>${statusBadge("draft")}</dt><dd>Only you can see it. Finish it any time.</dd></div>
              <div><dt>${statusBadge("review")}</dt><dd>Submitted. A moderator checks it against the community guidelines.</dd></div>
              <div><dt>${statusBadge("changes")}</dt><dd>A moderator asked for a change. Edit it and submit again.</dd></div>
              <div><dt>${statusBadge("published")}</dt><dd>Live on your profile and in the showcase.</dd></div>
            </dl>
          </div>
      ${deleteDialog()}`;
  return page({
    title: "Projects - bpozz Studio (design preview)",
    description: "Design preview of managing projects in the bpozz designer studio.",
    bodyClass: "sc-studio",
    demo: "studio",
    main: studioFrame("projects", owner, content),
    partials,
  });
}

function uploadPage(showcase, partials) {
  const owner = studioOwner(showcase);
  const options = showcase.disciplines
    .map((d) => `<option value="${d.slug}">${e(d.label)}</option>`)
    .join("");
  const steps = ["Upload", "Details", "Preview", "Publish"];
  const stepper = steps
    .map(
      (s, i) =>
        `<li class="stepper__step" data-step-marker="${i + 1}"${i === 0 ? ' aria-current="step"' : ""}><span class="stepper__num">${i + 1}</span><span class="stepper__label">${s}</span></li>`,
    )
    .join("");
  const editable = owner.projects.map((p) => ({
    slug: p.slug,
    title: p.title,
    discipline: p.discipline,
    summary: p.summary,
    tags: p.tags.join(", "),
    tools: p.tools.join(", "),
  }));
  STUDIO_ONLY.forEach((s) =>
    editable.push({ slug: s.slug, title: s.title, discipline: s.discipline, summary: "", tags: "", tools: "" }),
  );

  const content = `          <div class="studio-head">
            <div>
              <p class="eyebrow" data-upload-mode>Share work</p>
              <h1 data-upload-title>Share a new project</h1>
            </div>
            <button type="button" class="btn btn-outline" data-demo-toast="Draft saved in this preview only. Nothing was stored.">Save draft</button>
          </div>

          <ol class="stepper" aria-label="Progress">${stepper}</ol>

          <form class="upload" data-upload novalidate>
            <section class="upload__step" data-step="1" aria-labelledby="step-1-title">
              <h2 id="step-1-title" class="upload__title">Add your images</h2>
              <p class="muted">The first image is your cover. Use at least 1600 px wide images; JPG, PNG, WebP or GIF up to 10 MB each, up to 12 images.</p>
              <label class="dropzone" data-dropzone>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple data-file-input />
                <span class="dropzone__art">${icon("image")}</span>
                <span class="dropzone__title">Drag and drop images, or <span class="text-link">browse</span></span>
                <span class="dropzone__hint">Files stay in your browser. Nothing is uploaded in this preview.</span>
              </label>
              <p class="upload__sample"><button type="button" class="btn btn-soft btn-sm" data-use-sample>${icon("sparkle")}Use a sample image</button><span class="muted">No images to hand? Try the flow with generated artwork.</span></p>
              <template data-sample-art>${showcaseArt.art(owner.projects[0], owner.projects[0].colors, 2)}</template>
              <ul class="upload-files" data-file-list aria-live="polite"></ul>
              <p class="form-field__error" data-upload-error hidden>Add at least one image to continue.</p>
            </section>

            <section class="upload__step" data-step="2" aria-labelledby="step-2-title" hidden>
              <h2 id="step-2-title" class="upload__title">Tell people about it</h2>
              <div class="form-grid">
                <label class="form-field form-grid__full"><span class="form-field__label">Title</span><input class="input" name="title" type="text" maxlength="80" required placeholder="e.g. Harbour Café identity" data-preview-source="title" /><span class="form-field__help">Up to 80 characters. Shown on the card and the project page.</span></label>
                <label class="form-field"><span class="form-field__label">Discipline</span><select class="select" name="discipline" data-preview-source="discipline">${options}</select></label>
                <label class="form-field"><span class="form-field__label">Tags <span class="muted">(optional)</span></span><input class="input" name="tags" type="text" placeholder="coffee, identity, packaging" /><span class="form-field__help">Separate with commas. Up to 8.</span></label>
                <label class="form-field form-grid__full"><span class="form-field__label">Description</span><textarea class="textarea" name="summary" maxlength="1200" placeholder="What was the brief, what did you make, and what changed because of it?" data-preview-source="summary" data-counter></textarea><span class="form-field__help"><span data-counter-value>0</span> / 1200</span></label>
                <label class="form-field"><span class="form-field__label">Tools and techniques <span class="muted">(optional)</span></span><input class="input" name="tools" type="text" placeholder="Logo design, Screen printing" /></label>
                <label class="form-field"><span class="form-field__label">Credits <span class="muted">(optional)</span></span><input class="input" name="credits" type="text" placeholder="Photography by …" /><span class="form-field__help">Name everyone who worked on it.</span></label>
              </div>
            </section>

            <section class="upload__step" data-step="3" aria-labelledby="step-3-title" hidden>
              <h2 id="step-3-title" class="upload__title">Preview</h2>
              <p class="muted">This is how your project will look in the showcase and on its own page.</p>
              <div class="upload-preview">
                <div class="upload-preview__card">
                  <p class="eyebrow">Card</p>
                  <div class="shot">
                    <div class="shot__media"><span class="upload-preview__cover" data-preview-cover>${icon("image")}</span></div>
                    <div class="shot__meta"><span class="shot__designer">${avatar(owner, "sm")}<span>${e(owner.name)}</span></span><span class="shot__discipline" data-preview="discipline">Branding</span></div>
                  </div>
                </div>
                <div class="upload-preview__page">
                  <p class="eyebrow">Project page</p>
                  <div class="panel">
                    <h3 class="upload-preview__title" data-preview="title">Untitled project</h3>
                    <p class="upload-preview__by">${avatar(owner, "sm")} ${e(owner.name)}</p>
                    <div class="upload-preview__image" data-preview-cover-large>${icon("image")}</div>
                    <p class="upload-preview__summary" data-preview="summary">Your description appears here.</p>
                  </div>
                </div>
              </div>
            </section>

            <section class="upload__step" data-step="4" aria-labelledby="step-4-title" hidden>
              <h2 id="step-4-title" class="upload__title">Publish</h2>
              <fieldset class="choice-list">
                <legend class="form-field__label">Who can see it</legend>
                <label class="choice"><input type="radio" name="visibility" value="public" checked /><span><strong>Public</strong><span class="muted">Submitted for review, then shown on your profile and in the showcase.</span></span></label>
                <label class="choice"><input type="radio" name="visibility" value="draft" /><span><strong>Keep as draft</strong><span class="muted">Only you can see it. Publish it later from your studio.</span></span></label>
              </fieldset>
              <div class="stack upload-confirm">
                <label class="check"><input type="checkbox" required data-required-check /><span>I made this work, or I have the right to share it, and everyone who worked on it is credited.</span></label>
                <label class="check"><input type="checkbox" required data-required-check /><span>It follows the <a class="text-link" href="/terms">community guidelines</a>.</span></label>
              </div>
              <p class="form-field__error" data-confirm-error hidden>Please confirm both statements to publish.</p>
            </section>

            <section class="upload__done" data-step="done" hidden>
              <div class="state-card upload-success">
                <span class="state-card__art upload-success__art">${icon("check")}</span>
                <h2>Submitted for review</h2>
                <p>In the real studio your project would now wait for a moderator. In this preview nothing was uploaded or published.</p>
                <div class="cluster"><a class="btn btn-dark" href="/studio/projects">Go to your projects</a><a class="btn btn-outline" href="/studio/upload">Share another</a></div>
              </div>
            </section>

            <div class="upload__nav" data-upload-nav>
              <button type="button" class="btn btn-outline" data-step-back hidden>${icon("back")}Back</button>
              <button type="button" class="btn btn-dark" data-step-next>Continue ${icon("arrow")}</button>
              <button type="submit" class="btn btn-primary" data-step-publish hidden>Publish project</button>
            </div>
          </form>`;

  return page({
    title: "Share work - bpozz Studio (design preview)",
    description: "Design preview of uploading, editing, previewing and publishing a project on bpozz.",
    bodyClass: "sc-studio sc-upload",
    demo: "studio",
    main: studioFrame("upload", owner, content),
    partials,
    data: { editable },
  });
}

function profilePage(showcase, partials) {
  const owner = studioOwner(showcase);
  const discChecks = showcase.disciplines
    .map(
      (d) =>
        `<label class="toggle-chip"><input type="checkbox" name="disciplines" value="${d.slug}"${owner.projects.some((p) => p.discipline === d.slug) ? " checked" : ""} /><span>${e(d.label)}</span></label>`,
    )
    .join("");
  const content = `          <div class="studio-head">
            <div>
              <p class="eyebrow">Studio</p>
              <h1>Edit profile</h1>
            </div>
            <a class="btn btn-outline" href="${designerUrl(owner)}">${icon("eye")}View profile</a>
          </div>
          <div class="profile-edit">
            <form class="profile-edit__form stack" data-profile-form>
              <section class="panel stack">
                <h2 class="panel__title">Photo</h2>
                <div class="avatar-edit">
                  ${avatar(owner, "xl")}
                  <div class="stack">
                    <div class="cluster"><label class="btn btn-outline btn-sm">${icon("upload")}Upload photo<input type="file" accept="image/*" class="sr-only" data-avatar-input /></label><button type="button" class="btn btn-soft btn-sm">Remove</button></div>
                    <p class="form-field__help">Square image, at least 400 × 400 px. Stays in your browser in this preview.</p>
                  </div>
                </div>
              </section>
              <section class="panel stack">
                <h2 class="panel__title">Basics</h2>
                <div class="form-grid">
                  <label class="form-field"><span class="form-field__label">Display name</span><input class="input" type="text" value="${e(owner.name)}" data-live="name" /></label>
                  <label class="form-field"><span class="form-field__label">Profile address</span><span class="input-affix"><span class="input-affix__prefix">bpozz.com/designers/</span><input class="input" type="text" value="${owner.handle}" /></span><span class="form-field__help">Lowercase letters, numbers and hyphens.</span></label>
                  <label class="form-field form-grid__full"><span class="form-field__label">Headline</span><input class="input" type="text" maxlength="60" value="${e(owner.headline)}" data-live="headline" /></label>
                  <label class="form-field"><span class="form-field__label">Location</span><input class="input" type="text" value="${e(owner.location)}" data-live="location" /></label>
                  <label class="form-field"><span class="form-field__label">Availability</span><select class="select" data-live="availability"><option>${e(owner.availability)}</option><option>Open to full-time roles</option><option>Not taking new work</option></select></label>
                  <label class="form-field form-grid__full"><span class="form-field__label">Bio</span><textarea class="textarea" maxlength="600" data-counter>${e(owner.bio)}</textarea><span class="form-field__help"><span data-counter-value>${owner.bio.length}</span> / 600</span></label>
                </div>
              </section>
              <section class="panel stack">
                <h2 class="panel__title">Disciplines</h2>
                <p class="panel__desc">Choose up to three. They decide where your profile appears in the designer directory.</p>
                <div class="cluster">${discChecks}</div>
              </section>
              <section class="panel stack">
                <h2 class="panel__title">Links</h2>
                <div class="form-grid">
                  <label class="form-field"><span class="form-field__label">Portfolio website</span><input class="input" type="url" placeholder="https://" /></label>
                  <label class="form-field"><span class="form-field__label">Social profile</span><input class="input" type="url" placeholder="https://" /></label>
                </div>
              </section>
              <div class="form-actions">
                <a class="btn btn-outline" href="/studio/">Cancel</a>
                <button type="submit" class="btn btn-primary">Save profile</button>
              </div>
            </form>
            <aside class="profile-edit__preview">
              <p class="eyebrow">Live preview</p>
              <div class="panel profile-preview">
                ${avatar(owner, "lg")}
                <p class="profile-preview__name" data-live-out="name">${e(owner.name)}</p>
                <p class="profile-preview__headline" data-live-out="headline">${e(owner.headline)}</p>
                <p class="profile-preview__meta">${icon("pin")}<span data-live-out="location">${e(owner.location)}</span></p>
                <p class="profile-preview__meta">${icon("sparkle")}<span data-live-out="availability">${e(owner.availability)}</span></p>
                <ul class="designer-card__work">${owner.projects.slice(0, 3).map((p) => `<li>${showcaseArt.art(p, p.colors, 0)}</li>`).join("")}</ul>
              </div>
            </aside>
          </div>`;
  return page({
    title: "Edit profile - bpozz Studio (design preview)",
    description: "Design preview of editing a designer profile on bpozz.",
    bodyClass: "sc-studio",
    demo: "studio",
    main: studioFrame("profile", owner, content),
    partials,
  });
}

function settingsPage(showcase, partials) {
  const owner = studioOwner(showcase);
  const sw = (label, desc, checked) =>
    `<label class="switch"><span class="switch__text"><span class="switch__label">${label}</span><span class="switch__desc">${desc}</span></span><input type="checkbox"${checked ? " checked" : ""} /><span class="switch__track" aria-hidden="true"></span></label>`;
  const content = `          <div class="studio-head">
            <div>
              <p class="eyebrow">Studio</p>
              <h1>Settings</h1>
            </div>
          </div>
          <div class="settings stack">
            <section class="panel settings__section">
              <div class="settings__intro"><h2 class="panel__title">Account</h2><p class="panel__desc">How you sign in to bpozz.</p></div>
              <div class="stack">
                <label class="form-field"><span class="form-field__label">Email</span><input class="input" type="email" value="mira.demo@example.com" readonly /><span class="form-field__help">Sign-in links are sent here.</span></label>
                <div class="signin-methods">
                  <div class="signin-method"><span class="signin-method__icon">${icon("globe")}</span><div><p><strong>Google</strong></p><p class="muted">Connected</p></div><button type="button" class="btn btn-outline btn-sm">Disconnect</button></div>
                  <div class="signin-method"><span class="signin-method__icon">${icon("mail")}</span><div><p><strong>Email link</strong></p><p class="muted">Always available</p></div></div>
                </div>
              </div>
            </section>
            <section class="panel settings__section">
              <div class="settings__intro"><h2 class="panel__title">Notifications</h2><p class="panel__desc">Emails about your work. Never marketing.</p></div>
              <div class="stack">
                ${sw("Review results", "When a project is published or needs changes.", true)}
                ${sw("Reports on my work", "When a moderator acts on a report about your project.", true)}
                ${sw("Monthly digest", "New guides, palettes and fonts on bpozz.", false)}
              </div>
            </section>
            <section class="panel settings__section">
              <div class="settings__intro"><h2 class="panel__title">Privacy</h2><p class="panel__desc">What your public profile shows.</p></div>
              <div class="stack">
                ${sw("Show my location", "Your city and country on your profile.", true)}
                ${sw("Show my availability", "Whether you're taking on work.", true)}
                ${sw("List me in the designer directory", "Your profile still works by its address when this is off.", true)}
              </div>
            </section>
            <section class="panel settings__section">
              <div class="settings__intro"><h2 class="panel__title">Your data</h2><p class="panel__desc">A copy of your profile, projects and saved items.</p></div>
              <div><button type="button" class="btn btn-outline" data-demo-toast="Exports are not available in this preview.">Request a download</button></div>
            </section>
            <section class="panel settings__section settings__section--danger">
              <div class="settings__intro"><h2 class="panel__title">Delete account</h2><p class="panel__desc">Removes your profile and every project. This can't be undone.</p></div>
              <div><button type="button" class="btn btn-danger" data-demo-dialog="delete" data-title="Your account">Delete account</button></div>
            </section>
          </div>
      ${deleteDialog()}`;
  return page({
    title: "Settings - bpozz Studio (design preview)",
    description: "Design preview of designer account settings on bpozz.",
    bodyClass: "sc-studio",
    demo: "studio",
    main: studioFrame("settings", owner, content),
    partials,
  });
}

// ---------------------------------------------------------------------
// /report and /moderation/
// ---------------------------------------------------------------------

const REPORT_REASONS = [
  ["copyright", "Copyright or stolen work", "It copies someone else's work, or the uploader doesn't have the right to share it."],
  ["impersonation", "Impersonation", "The account pretends to be another designer or studio."],
  ["misleading", "Spam or misleading", "Advertising, unrelated content or false claims about the work."],
  ["inappropriate", "Inappropriate content", "Hateful, violent, sexual or otherwise harmful content."],
  ["other", "Something else", "Tell us what's wrong in the details below."],
];

function reportPage(showcase, partials) {
  const projects = showcase.projects.map((p) => ({
    slug: p.slug,
    title: p.title,
    designer: p.designerRecord.name,
    discipline: p.disciplineRecord.label,
  }));
  const p = showcase.projects[0];
  const reasons = REPORT_REASONS.map(
    ([value, label, desc], i) =>
      `<label class="choice"><input type="radio" name="reason" value="${value}"${i === 0 ? " required" : ""} /><span><strong>${label}</strong><span class="muted">${desc}</span></span></label>`,
  ).join("\n              ");
  const main = `      <div class="container container--narrow report">
        <div class="page-intro">
          <p class="eyebrow">${icon("flag")}Report</p>
          <h1>Report a project</h1>
          <p class="page-intro__dek">Tell the moderators what's wrong. Reports are confidential: the designer isn't told who sent one.</p>
        </div>
        <div class="report__target panel" data-report-target>
          <div class="report__thumb" data-report-thumb>${showcaseArt.art(p, p.colors, 0)}</div>
          <div>
            <p class="report__title" data-report-title>${e(p.title)}</p>
            <p class="muted" data-report-meta>${e(p.designerRecord.name)} · ${e(p.disciplineRecord.label)}</p>
          </div>
        </div>
        <form class="report__form stack" data-report-form novalidate>
          <fieldset class="choice-list">
            <legend class="form-field__label">What's the problem?</legend>
              ${reasons}
          </fieldset>
          <p class="form-field__error" data-reason-error hidden>Choose a reason.</p>
          <label class="form-field"><span class="form-field__label">Details</span><textarea class="textarea" maxlength="1000" placeholder="Links to the original work, or anything else that helps the moderators."></textarea></label>
          <label class="form-field"><span class="form-field__label">Your email <span class="muted">(optional)</span></span><input class="input" type="email" placeholder="So we can tell you the outcome" /></label>
          <div class="form-actions">
            <a class="btn btn-outline" href="${projectUrl(p)}" data-report-cancel>Cancel</a>
            <button type="submit" class="btn btn-primary">Send report</button>
          </div>
        </form>
        <div class="state-card" data-report-done hidden>
          <span class="state-card__art upload-success__art">${icon("check")}</span>
          <h2>Thanks, we'll take a look</h2>
          <p>In the real service a moderator reviews every report. In this preview nothing was sent.</p>
          <div class="cluster"><a class="btn btn-dark" href="/projects/">Back to Explore</a></div>
        </div>
      </div>`;
  return page({
    title: "Report a project - bpozz (design preview)",
    description: "Design preview of reporting a project on bpozz.",
    bodyClass: "sc-report",
    demo: "report",
    main,
    partials,
    data: { projects },
  });
}

function moderationPage(showcase, partials) {
  const pick = (slug) => showcase.projects.find((p) => p.slug === slug) || showcase.projects[0];
  const reports = [
    { id: "R-1042", project: pick("night-market-posters"), reason: "Copyright or stolen work", count: 3, age: "2 hours ago", status: "open", note: "Looks like a poster I saw at another festival last year." },
    { id: "R-1041", project: pick("ledger-budgeting-app"), reason: "Spam or misleading", count: 1, age: "5 hours ago", status: "open", note: "The description links to a paid course." },
    { id: "R-1039", project: pick("steep-tea-tins"), reason: "Something else", count: 1, age: "Yesterday", status: "open", note: "Wrong discipline, this is packaging not illustration." },
    { id: "R-1036", project: pick("monsoon-city"), reason: "Impersonation", count: 2, age: "2 days ago", status: "review", note: "This account uses another illustrator's name." },
    { id: "R-1030", project: pick("grain-serif-revival"), reason: "Copyright or stolen work", count: 1, age: "4 days ago", status: "resolved", note: "Is this font licensed for redistribution?" },
  ];
  const first = reports[0];
  const item = (r, i) => {
    const p = r.project;
    return `<li><button type="button" class="mod-item" data-report-item="${r.id}" aria-pressed="${i === 0}" data-status="${r.status}">
              <span class="mod-item__thumb">${showcaseArt.art(p, p.colors, 0)}</span>
              <span class="mod-item__text">
                <span class="mod-item__title">${e(p.title)}</span>
                <span class="mod-item__meta">${e(r.reason)} · ${plural(r.count, "report")}</span>
              </span>
              <span class="mod-item__age">${e(r.age)}</span>
            </button></li>`;
  };
  const detail = (r, i) => {
    const p = r.project;
    const d = p.designerRecord;
    return `<section class="mod-detail" data-report-detail="${r.id}"${i === 0 ? "" : " hidden"} aria-labelledby="mod-${r.id}">
            <div class="mod-detail__head">
              <div>
                <p class="eyebrow">${r.id} · ${statusLabel(r.status)}</p>
                <h2 id="mod-${r.id}">${e(p.title)}</h2>
                <p class="muted">by <a href="${designerUrl(d)}">${e(d.name)}</a> ${DEMO_BADGE} · ${e(p.disciplineRecord.label)}</p>
              </div>
              <a class="btn btn-outline btn-sm" href="${projectUrl(p)}">${icon("eye")}Open project</a>
            </div>
            <div class="mod-detail__media">${showcaseArt.art(p, p.colors, 0)}</div>
            <dl class="sc-facts">
              ${factRow("Reason", `<span class="badge badge--warning">${e(r.reason)}</span>`)}
              ${factRow("Reports", plural(r.count, "report"))}
              ${factRow("First reported", e(r.age))}
              ${factRow("Reporter's note", `“${e(r.note)}”`)}
            </dl>
            <ol class="timeline">
              <li><span class="timeline__dot"></span><div><p><strong>Report received</strong></p><p class="muted">${e(r.age)}</p></div></li>
              <li><span class="timeline__dot"></span><div><p><strong>Project published</strong></p><p class="muted">${shortDate(p.date)}</p></div></li>
            </ol>
            <div class="mod-actions">
              <button type="button" class="btn btn-outline" data-demo-toast="Report dismissed in this preview only.">Dismiss</button>
              <button type="button" class="btn btn-outline" data-demo-dialog="changes" data-title="${e(p.title)}">Request changes</button>
              <button type="button" class="btn btn-danger" data-demo-dialog="remove" data-title="${e(p.title)}">Remove project</button>
            </div>
          </section>`;
  };
  const counts = (s) => reports.filter((r) => r.status === s).length;
  const main = `      <div class="container moderation">
        <div class="studio-head">
          <div>
            <p class="eyebrow">${icon("shield")}Staff</p>
            <h1>Moderation</h1>
          </div>
          <span class="badge">Visible to moderators only</span>
        </div>
        <div class="chip-row mod-filters" role="group" aria-label="Filter reports">
          <button type="button" class="chip" data-mod-filter="open" aria-pressed="true">Open <span class="chip__count">${counts("open")}</span></button>
          <button type="button" class="chip" data-mod-filter="review" aria-pressed="false">In review <span class="chip__count">${counts("review")}</span></button>
          <button type="button" class="chip" data-mod-filter="resolved" aria-pressed="false">Resolved <span class="chip__count">${counts("resolved")}</span></button>
        </div>
        <div class="mod-layout">
          <ul class="mod-list" aria-label="Reports">
            ${reports.map(item).join("\n            ")}
          </ul>
          <div class="mod-panel">
          ${reports.map(detail).join("\n          ")}
          </div>
        </div>
      </div>
      <dialog class="sc-dialog" id="dialog-changes" aria-labelledby="dialog-changes-title">
        <form method="dialog" class="sc-dialog__body">
          <div class="sc-dialog__head"><h2 id="dialog-changes-title">Request changes</h2><button type="submit" class="btn btn-soft btn-icon btn-sm" aria-label="Close">${icon("x")}</button></div>
          <p class="muted">The designer sees this note in their studio. <strong data-dialog-title></strong> stays hidden from the showcase until it's fixed.</p>
          <label class="form-field"><span class="form-field__label">Note to the designer</span><textarea class="textarea" placeholder="What needs to change, and why."></textarea></label>
          <div class="sc-dialog__foot"><button type="submit" class="btn btn-outline">Cancel</button><button type="submit" class="btn btn-dark" data-demo-toast="Request sent in this preview only.">Send request</button></div>
        </form>
      </dialog>
      <dialog class="sc-dialog" id="dialog-remove" aria-labelledby="dialog-remove-title">
        <form method="dialog" class="sc-dialog__body">
          <div class="sc-dialog__head"><h2 id="dialog-remove-title">Remove this project?</h2><button type="submit" class="btn btn-soft btn-icon btn-sm" aria-label="Close">${icon("x")}</button></div>
          <p class="muted"><strong data-dialog-title></strong> is taken down from the showcase and the designer's profile, and the designer is told why.</p>
          <label class="form-field"><span class="form-field__label">Reason shown to the designer</span><select class="select">${REPORT_REASONS.map(([, label]) => `<option>${label}</option>`).join("")}</select></label>
          <div class="sc-dialog__foot"><button type="submit" class="btn btn-outline">Cancel</button><button type="submit" class="btn btn-danger" data-demo-toast="Removed in this preview only. Nothing changed.">Remove project</button></div>
        </form>
      </dialog>`;
  return page({
    title: "Moderation - bpozz (design preview)",
    description: "Design preview of the bpozz moderation queue.",
    bodyClass: "sc-moderation",
    demo: "moderation",
    main,
    partials,
  });
}

function statusLabel(status) {
  return { open: "Open", review: "In review", resolved: "Resolved" }[status];
}

// ---------------------------------------------------------------------
// /styleguide
// ---------------------------------------------------------------------

function styleguidePage(showcase, partials) {
  const swatch = (name, value, note = "") =>
    `<li class="sg-swatch"><span class="sg-swatch__chip" style="background:var(${name})"></span><span class="sg-swatch__name">${name}</span><span class="sg-swatch__value">${value}${note ? ` · ${note}` : ""}</span></li>`;
  const p = showcase.projects[0];
  const d = showcase.designers[0];
  const main = `      <div class="container sg">
        <div class="page-intro">
          <p class="eyebrow">Design system</p>
          <h1>bpozz design system</h1>
          <p class="page-intro__dek">Tokens, components and states used across the redesign. The reference for building the platform later.</p>
        </div>

        <nav class="sg-toc" aria-label="On this page">
          <a href="#sg-color">Color</a><a href="#sg-type">Type</a><a href="#sg-buttons">Buttons</a><a href="#sg-forms">Forms</a><a href="#sg-nav">Navigation</a><a href="#sg-cards">Cards</a><a href="#sg-feedback">Feedback</a><a href="#sg-states">States</a><a href="#sg-auth">Log in</a>
        </nav>

        <section class="sg-section" id="sg-color" aria-labelledby="sg-color-title">
          <h2 id="sg-color-title">Color</h2>
          <p class="muted">Quiet chrome: ink, white and one canvas grey carry the interface, so the work supplies the colour. Blue is only for the main action, links in text and focus.</p>
          <ul class="sg-swatches">
            ${swatch("--ink", "#101010", "text, brand")}
            ${swatch("--text-secondary", "#3d4556")}
            ${swatch("--text-muted", "#5c6b85")}
            ${swatch("--line-strong", "#cfd4dd")}
            ${swatch("--line", "#e7e9ee")}
            ${swatch("--surface-2", "#f2f3f5")}
            ${swatch("--canvas", "#f7f7f8")}
            ${swatch("--action", "#2563eb", "primary action, focus")}
            ${swatch("--success", "#15803d")}
            ${swatch("--warning", "#a35200")}
            ${swatch("--danger", "#c0392b")}
            ${swatch("--demo", "#ffd23f", "design preview only")}
          </ul>
        </section>

        <section class="sg-section" id="sg-type" aria-labelledby="sg-type-title">
          <h2 id="sg-type-title">Type</h2>
          <p class="muted">Mona Sans everywhere, with its double-storey a and g (ss05, ss06) and spurred G (ss07).</p>
          <div class="sg-type">
            <p style="font-size:var(--fs-display);font-weight:600;letter-spacing:-0.02em;line-height:1.05">Display</p>
            <p style="font-size:var(--fs-h1);font-weight:600;letter-spacing:-0.02em">Heading 1</p>
            <p style="font-size:var(--fs-h2);font-weight:600">Heading 2</p>
            <p style="font-size:var(--fs-h3);font-weight:600">Heading 3</p>
            <p style="font-size:16px">Body text for reading, 16px with 1.6 line height.</p>
            <p style="font-size:14px" class="muted">Secondary text and labels, 14px.</p>
            <p class="eyebrow">Eyebrow label</p>
          </div>
        </section>

        <section class="sg-section" id="sg-buttons" aria-labelledby="sg-buttons-title">
          <h2 id="sg-buttons-title">Buttons</h2>
          <div class="sg-row"><button class="btn btn-primary">Primary</button><button class="btn btn-dark">Dark</button><button class="btn btn-outline">Outline</button><button class="btn btn-soft">Soft</button><button class="btn btn-danger">Danger</button><button class="btn btn-primary" disabled>Disabled</button></div>
          <div class="sg-row"><button class="btn btn-dark btn-lg">Large</button><button class="btn btn-dark">Default</button><button class="btn btn-dark btn-sm">Small</button><button class="btn btn-outline btn-icon" aria-label="Save">${icon("bookmark")}</button><button class="btn btn-outline">${icon("upload")}With icon</button></div>
        </section>

        <section class="sg-section" id="sg-forms" aria-labelledby="sg-forms-title">
          <h2 id="sg-forms-title">Forms</h2>
          <div class="form-grid sg-forms">
            <label class="form-field"><span class="form-field__label">Text field</span><input class="input" placeholder="Placeholder" /><span class="form-field__help">Help text explains the field.</span></label>
            <label class="form-field"><span class="form-field__label">With an error</span><input class="input" aria-invalid="true" value="not an email" /><span class="form-field__error">Enter an email address like name@example.com.</span></label>
            <label class="form-field"><span class="form-field__label">Select</span><select class="select"><option>Branding</option><option>Illustration</option></select></label>
            <label class="form-field"><span class="form-field__label">Prefixed</span><span class="input-affix"><span class="input-affix__prefix">bpozz.com/</span><input class="input" value="your-name" /></span></label>
            <label class="form-field form-grid__full"><span class="form-field__label">Text area</span><textarea class="textarea">Longer answers go here.</textarea></label>
            <div class="stack"><label class="check"><input type="checkbox" checked /><span>Checkbox, checked</span></label><label class="check"><input type="checkbox" /><span>Checkbox</span></label></div>
            <div class="stack"><label class="switch"><span class="switch__text"><span class="switch__label">Switch</span><span class="switch__desc">For settings that apply at once.</span></span><input type="checkbox" checked /><span class="switch__track" aria-hidden="true"></span></label></div>
          </div>
        </section>

        <section class="sg-section" id="sg-nav" aria-labelledby="sg-nav-title">
          <h2 id="sg-nav-title">Navigation</h2>
          <div class="stack">
            <nav class="tabs discover__tabs" aria-label="Example tabs"><a class="tab" href="#sg-nav" aria-current="page">Projects</a><a class="tab" href="#sg-nav">Designers</a></nav>
            <div>${discoverSearch({ id: "sg-q", scope: "projects" })}</div>
            <div class="chip-row"><button class="chip" aria-pressed="true">All</button><button class="chip" aria-pressed="false">Branding</button><button class="chip" aria-pressed="false">Illustration</button><button class="chip" aria-pressed="false">UI/UX</button></div>
            <div><div class="segmented" role="group" aria-label="Example"><button aria-pressed="true">Grid</button><button aria-pressed="false">List</button></div></div>
            <ol class="stepper" aria-label="Example steps"><li class="stepper__step is-done"><span class="stepper__num">1</span><span class="stepper__label">Upload</span></li><li class="stepper__step" aria-current="step"><span class="stepper__num">2</span><span class="stepper__label">Details</span></li><li class="stepper__step"><span class="stepper__num">3</span><span class="stepper__label">Preview</span></li><li class="stepper__step"><span class="stepper__num">4</span><span class="stepper__label">Publish</span></li></ol>
          </div>
        </section>

        <section class="sg-section" id="sg-cards" aria-labelledby="sg-cards-title">
          <h2 id="sg-cards-title">Cards</h2>
          <div class="sg-cards">
            <ul class="shot-grid shot-grid--four">${shotCard(p)}</ul>
            <ul class="designer-grid">${designerCard(d)}</ul>
          </div>
        </section>

        <section class="sg-section" id="sg-feedback" aria-labelledby="sg-feedback-title">
          <h2 id="sg-feedback-title">Feedback</h2>
          <div class="stack">
            <div class="cluster"><span class="badge">Neutral</span><span class="badge badge--dot badge--success">Published</span><span class="badge badge--dot badge--info">In review</span><span class="badge badge--dot badge--warning">Needs changes</span><span class="badge badge--danger">Removed</span>${DEMO_BADGE}</div>
            <div class="alert">${icon("info")}<span><strong>Information.</strong> Neutral context for the task at hand.</span></div>
            <div class="alert alert--success">${icon("check")}<span><strong>Saved.</strong> Your profile is up to date.</span></div>
            <div class="alert alert--warning">${icon("alert")}<span><strong>Needs attention.</strong> One project needs changes.</span></div>
            <div class="alert alert--danger">${icon("alert")}<span><strong>Something went wrong.</strong> Try again in a moment.</span></div>
            <div><button class="btn btn-outline" data-demo-toast="This is a toast message.">Show a toast</button></div>
          </div>
        </section>

        <section class="sg-section" id="sg-states" aria-labelledby="sg-states-title">
          <h2 id="sg-states-title">Empty, loading and error</h2>
          <div class="sg-states">
            <div class="state-card"><span class="state-card__art">${icon("folder")}</span><h3>Nothing here yet</h3><p>Explain what will appear and offer the one action that fills it.</p><div class="cluster"><button class="btn btn-primary">Primary action</button></div></div>
            <div class="panel stack"><span class="skeleton" style="height:140px"></span><span class="skeleton" style="height:14px;width:70%"></span><span class="skeleton" style="height:14px;width:45%"></span></div>
            <div class="state-card"><span class="state-card__art">${icon("alert")}</span><h3>Couldn't load</h3><p>Say what failed in plain words, and that nothing was lost.</p><div class="cluster"><button class="btn btn-dark">Try again</button></div></div>
          </div>
        </section>

        <section class="sg-section" id="sg-auth" aria-labelledby="sg-auth-title">
          <h2 id="sg-auth-title">Log in and sign up</h2>
          <p class="muted">The real dialog, as every page opens it from the header.</p>
          <div class="sg-row"><button type="button" class="btn btn-dark" data-auth-open="signin" aria-haspopup="dialog">Open log in</button><button type="button" class="btn btn-outline" data-auth-open="signup" aria-haspopup="dialog">Open sign up</button></div>
        </section>
      </div>`;
  return page({
    title: "Design system - bpozz (design preview)",
    description: "The bpozz design system reference.",
    bodyClass: "sc-styleguide",
    demo: "styleguide",
    main,
    partials,
  });
}

// ---------------------------------------------------------------------
// /search: sample projects and designers (revision 03)
// ---------------------------------------------------------------------

/**
 * The part of /search that lists SAMPLE projects and designers matching the
 * query, below the real guide and palette results (src/client/search.js,
 * unchanged). Its own heading and badge say it is a design preview; it
 * shows only cards the sample data really matches (src/client/showcase.js)
 * and stays hidden when nothing does.
 */
/**
 * /search for the Projects and Designers categories (revision 04): the
 * sample set, searched in the browser by src/client/showcase.js, which also
 * writes the page's heading, intro and status line for these two
 * categories (src/client/search.js answers Guides). Projects are the
 * gallery's cards, designers the directory's; each carries its Demo badge,
 * and the section says it is the design preview's sample content.
 */
function searchSampleSection(showcase) {
  return `<section class="search-sample" data-search-sample aria-labelledby="search-sample-title" hidden>
        <div class="search-sample__head">
          <h2 class="search-sample__title" id="search-sample-title" data-sample-title>Sample projects</h2>
          ${DEMO_BADGE.replace("Demo", "Design preview")}
        </div>
        <div class="search-sample__group" data-sample-group="projects" hidden>
          <ul class="shot-grid" data-sample-grid></ul>
        </div>
        <div class="search-sample__group" data-sample-group="designers" hidden>
          <ul class="designer-grid" data-sample-grid></ul>
        </div>
        <div class="state-card search-sample__empty" data-sample-empty hidden>
          <span class="state-card__art">${icon("search")}</span>
          <h3 data-sample-empty-title>No sample projects match</h3>
          <p data-sample-empty-text></p>
          <div class="cluster">
            <a class="btn btn-primary" href="/search?scope=guides" data-sample-guides>Search guides instead</a>
            <a class="btn btn-outline" href="/projects/" data-sample-browse>Browse sample projects</a>
          </div>
        </div>
        <template data-sample-source="projects">${showcase.projects.map((p) => shotCard(p)).join("")}</template>
        <template data-sample-source="designers">${showcase.designers.map((d) => designerCard(d, { level: 3 })).join("")}</template>
      </section>`;
}

// ---------------------------------------------------------------------
// build + render
// ---------------------------------------------------------------------

function build(ctx) {
  const { root } = ctx.config.paths;
  const showcase = ctx.model.showcase;
  const partials = {
    header: fs.readFileSync(path.join(root, HEADER_PARTIAL), "utf8").trim(),
    footer: fs.readFileSync(path.join(root, FOOTER_PARTIAL), "utf8").trim(),
  };

  const pages = [
    { file: "projects/index.html", html: projectsIndex(showcase, partials) },
    { file: "designers/index.html", html: designersIndex(showcase, partials) },
    { file: "studio/index.html", html: studioDashboard(showcase, partials) },
    { file: "studio/projects.html", html: studioProjectsPage(showcase, partials) },
    { file: "studio/upload.html", html: uploadPage(showcase, partials) },
    { file: "studio/profile.html", html: profilePage(showcase, partials) },
    { file: "studio/settings.html", html: settingsPage(showcase, partials) },
    { file: "moderation/index.html", html: moderationPage(showcase, partials) },
    { file: "report.html", html: reportPage(showcase, partials) },
    { file: "styleguide.html", html: styleguidePage(showcase, partials) },
  ]
    .concat(showcase.projects.map((p) => ({ file: `projects/${p.slug}.html`, html: projectDetail(p, showcase, partials) })))
    .concat(showcase.designers.map((d) => ({ file: `designers/${d.handle}.html`, html: designerProfile(d, showcase, partials) })));

  return { pages, home: discoverBlock(showcase, { home: true }), search: searchSampleSection(showcase) };
}

/** Writes `region` between a page's start and end markers, or throws. */
function patchRegion(file, label, startMarker, endMarker, region) {
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`showcase: ${label} is missing ${startMarker} / ${endMarker}`);
  }
  fs.writeFileSync(file, html.slice(0, start + startMarker.length) + "\n    " + region + "\n    " + html.slice(end));
}

function render(ctx) {
  const { stage } = ctx.config.paths;
  const out = build(ctx);

  out.pages.forEach((p) => {
    const file = path.join(stage, p.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, p.html);
  });

  // The homepage's discovery region, under the hero.
  patchRegion(path.join(stage, INDEX_PAGE), INDEX_PAGE, HOME_START, HOME_END, out.home);
  // /search: the sample projects and designers, after the real results.
  patchRegion(path.join(stage, SEARCH_PAGE), SEARCH_PAGE, SEARCH_START, SEARCH_END, out.search);

  return { written: out.pages.map((p) => p.file) };
}

module.exports = { render, build, shotCard, designerCard, discoverBlock, PER_PAGE, HOME_LIMIT };
