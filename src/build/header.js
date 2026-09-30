/**
 * src/build/header.js — the site header, rendered in-process.
 *
 * PHASE 4 STEP 3B — the second legacy builder to leave RENDER_ORDER.
 *
 * This is `build-header.js` ported verbatim in behaviour and deleted at the
 * root. It is a bigger move than the footer was: the header carries two
 * partials rather than one, a generated nav region inside each of them, a
 * validated link registry (resource-types.json plus the hand-authored
 * MAIN_HEADER_NAV list), depth-based link rewriting and two separate
 * "you are here" rules. All of it is transcribed, not redesigned.
 *
 * PHASE 4 STEP 6 — THE REGISTRY IS NO LONGER READ HERE
 *
 * This module was the last reader of a content file outside
 * src/build/content.js: it opened resource-types.json with its own fs call
 * and validated it with its own rules, while src/build/home.js validated the
 * loaded copy of the same file with a different set. The file is now loaded
 * and shape-checked once, in `load`, and arrives as ctx.model.resourceTypes.
 * The one check that stayed is the one only this module can make — that a
 * nav destination resolves to a page that exists. No markup changed.
 *
 * TWO HEADER VARIANTS: HOME VS. EVERY OTHER PAGE
 *
 *   index.html          partials/header-home.html — one row, logo + nav, no
 *                       search, because the home page's hero already carries
 *                       a large search box.
 *   every other page    partials/header.html — two rows, logo + a persistent
 *                       full-width search bar on top, nav underneath.
 *
 * Both variants share one #mobile-menu panel and #menu-toggle button, and
 * both go through the same per-page rewriting below. Only which partial is
 * loaded differs, selected by whether the page's route file is "index.html".
 *
 * WHY THE HEADER IS PRE-RENDERED AT ALL
 *
 * Unchanged from the builder this replaces, and still load-bearing:
 *   1. the header must exist in the raw HTML for JS-disabled visitors and
 *      crawlers, not appear only after an async fetch resolves;
 *   2. /app.js queries #menu-toggle, #mobile-menu and .header-search
 *      synchronously as soon as it runs (a plain <script> at the end of
 *      <body>, not deferred). Injected later, those elements would not exist
 *      when it looks for them and the menu and search would silently die.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 *
 * Two deliberate changes, both the same ones Step 3A made for the footer, or
 * a direct consequence of them:
 *
 *   1. THE PAGE SET IS DECLARED, NOT DISCOVERED. `build-header.js` walked
 *      its whole working root for *.html, skipping node_modules/.git/
 *      partials. This module iterates `ctx.routes`, so the header is written
 *      into exactly the pages the sitemap and URL gates are checked against.
 *      The two were verified equal before the swap: the walk visited exactly
 *      the 41 route pages, the three files under partials/ being the only
 *      other .html in the staging root and the only ones the ignore list
 *      excluded.
 *
 *   2. THE NAV REGIONS ARE SYNCED IN MEMORY, NOT WRITTEN BACK. The builder
 *      rewrote the NAV_RESOURCES_START/END region inside the partial FILES
 *      before syncing pages, so that build-categories.js — which embeds the
 *      partials verbatim — always got complete markup. Under the pipeline
 *      that write only ever landed on the disposable staged copy, and only
 *      after build-categories.js had already read it, so it could not affect
 *      any output. This module reads the partials from the repo root (they
 *      are build inputs; the staged copies are byte-for-byte copies of the
 *      same files) and applies the same rewrite to the string it is about to
 *      render from. Nothing on disk is written outside the staging root.
 *
 *      Dropping the write would have dropped the signal that kept the two
 *      committed partials in sync, so it is replaced by one: a partial whose
 *      generated region does not already match MAIN_HEADER_NAV is reported
 *      through ctx.warn. Both partials are in sync today and the warning is
 *      silent; the guards that throw — a partial with no region at all, or a
 *      START with no matching END — are unchanged.
 *
 * Everything the output depends on is unchanged and deliberately so:
 *
 *   - each partial is `.trim()`ed after the nav sync and before insertion;
 *   - HEADER_START/HEADER_END are kept and only the text between them is
 *     replaced, at the FIRST occurrence of each, via the same indexOf
 *     arithmetic;
 *   - the depth rewrite replaces EVERY occurrence of each "../<file>"
 *     literal, via split/join, not just the first;
 *   - index.html stays special-cased: the brand link (and, before the homepage
 *     redesign, the "All" nav link)
 *     becomes "/" (a clean root URL, not a bare "#"), while the search form's
 *     action becomes "index.html" — a real GET target for no-JS submits;
 *   - aria-current="page" is applied by the same two rules: a page that IS a
 *     ROOT_LINKS destination marks its own link, and a page whose route file
 *     starts with one of a resource type's `activePaths` marks that type's
 *     link;
 *   - a nav entry's `landingUrl` must still resolve to a real page (and, if
 *     it carries a #fragment, to an element with that id) or the build
 *     fails — resolved, as before, against the tree the pages are built in;
 *   - a page whose HEADER markers are missing or inverted is skipped and
 *     reported, never half-written;
 *   - a page whose header is already correct is not rewritten at all.
 *
 * THE PARTIALS ARE NOT EQUALLY SHARED
 *
 * partials/header.html has a second reader: src/build/categories.js embeds it
 * verbatim into the pages it writes from scratch, inside the same marker
 * comments, so that this module can resync them afterwards. Both read it from
 * the repo root.
 *
 * partials/header-home.html has no second reader — index.html is the only
 * page that uses it, and this module is the only thing that reads it.
 *
 * Neither is a staged build input any more: header-home.html's entry left with
 * the builder in Step 3B, header.html's in Step 3C, and Step 3E removed the
 * staging table itself.
 *
 * ORDER
 *
 * home → categories → guides → header → footer. Categories writes pages from
 * the raw partials and, since Step 4, so does src/build/guides.js; the header
 * restores `aria-current` for both; the footer is last and rewrites only its
 * own marker region, so it disturbs neither. This module's own position is
 * unchanged. What did change is its tally: the committed guide pages carried
 * the finished header, so all 22 used to report "already current"; they are
 * written from the raw partial now and report as updated. The bytes it
 * produces for them are the same.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("../shared/html.js");

const PARTIAL = path.join("partials", "header.html");
const HOME_PARTIAL = path.join("partials", "header-home.html");

/**
 * PHASE 4 STEP 6: the RESOURCE_TYPES filename constant is gone with the fs
 * read it named. resource-types.json is loaded and validated once, by
 * src/build/content.js, and arrives here as ctx.model.resourceTypes — see
 * loadNavEntries() below.
 */

const START_MARKER = "<!--HEADER_START-->";
const END_MARKER = "<!--HEADER_END-->";

const NAV_START_MARKER = "<!--NAV_RESOURCES_START-->";
const NAV_END_MARKER = "<!--NAV_RESOURCES_END-->";

/**
 * Indentation of a nav link line inside the partials (both navs, both
 * partials), so the generated region reads like the hand-authored markup
 * around it.
 */
const NAV_LINK_INDENT = "      ";

/**
 * Root-relative links the partials are authored with, at "one level deep"
 * — i.e. exactly as they should appear on a /guide/*.html page. Each
 * `partialText` is the literal substring to rewrite; every other depth is
 * derived from it by headerFor().
 */
const ROOT_LINKS = [
  { file: "index.html", partialText: "../index.html" },
  { file: "roadmap.html", partialText: "../roadmap.html" },
];

/**
 * MAIN HEADER nav — the list both partials' NAV_RESOURCES regions render.
 *
 * It is deliberately NOT the resource-type registry: it is a short,
 * browse-oriented set that names each destination the way a visitor looks for it
 * (the nav's own short labels, e.g. "Palettes"). resource-types.json still supplies the
 * `activePaths` that drive the aria-current highlight, and its `label`
 * values are also the homepage's section headings (build-home.js) — which is
 * why they are not renamed to match this list.
 *
 * "Explore" (-> /search) is deliberately absent: search is already reachable
 * from the inner header's own search field. /search itself is untouched; the
 * mobile menu no longer carries a separate Explore link either.
 *
 * Same { label, landingUrl } shape as a resource-types.json entry, so
 * navLinksHtml() and resolveLandingUrl() apply unchanged — including the
 * "the destination must already exist" guard in validateMainHeaderNav().
 *
 * PHASE 4 STEP 10 — "Colors" ADDED, AND WHAT THAT COSTS
 *
 * The Color Library is a top-level browse destination, so it belongs in the
 * browse list, ahead of Color Palettes: /colors is the broader surface
 * (every colour) and /palettes the narrower one (colours already grouped).
 *
 * This is a one-line edit with a 42-page blast radius, and that is worth
 * stating rather than discovering: both partials carry this list, every page
 * carries both nav regions, so adding an entry changes the md5 of every
 * published page. That is not a redesign — the diff on each page is exactly
 * one added <a> per nav region, twice — but it does mean the HTML baseline
 * has to be re-recorded, which is why the Step 10 handoff shows the per-page
 * diff rather than only the count.
 *
 * IMAGE PICKER — ADDED
 *
 * routes.js originally shipped /image-picker deliberately absent from this
 * list, to keep that addition isolated to one new page. This entry reverses
 * that call: Image Picker is now a top-level browse/tool destination like
 * Colors and Color Palettes, so it is listed last — after the content
 * browse entries, since it is a tool rather than a content set. Same
 * 43-page blast radius as Step 10's Colors addition and for the same
 * reason: every page carries both nav regions, so the HTML baseline needs
 * re-recording alongside this change.
 *
 * HOMEPAGE REDESIGN — "All" REMOVED
 *
 * "All" named the old homepage, which was an all-types card listing. The
 * homepage is now a palette workspace plus an index of these same four
 * destinations, so "All" no longer described anything; the logo still links
 * home. Same 43-page blast radius as the two additions above.
 *
 * "All" AND "Learning Roadmap" RESTORED
 *
 * The nav now reads All · Colors · Color Palettes · Image Picker · UI/UX
 * Guides · Learning Roadmap, in both rows and the mobile panel. "All" links
 * home and "Learning Roadmap" links /roadmap; neither is a resource type, so
 * their "you are here" state comes from markNavCurrent() in render(), not
 * from resource-types.json's activePaths.
 *
 * FONTS — ADDED
 *
 * The font library is a content browse destination like Colors and Color
 * Palettes, so it sits with them, after the two colour entries and before the
 * Image Picker tool. Its "you are here" state comes from resource-types.json's
 * `font` entry (activePaths ["fonts/"]), which also marks it on every
 * /fonts/<id>.html detail page. Same every-page blast radius as the entries
 * above: one added <a> per nav region.
 *
 * ICONS — ADDED
 *
 * The icon library is a content browse destination like Fonts, so it sits
 * directly after it and before the Image Picker tool. Its "you are here"
 * state comes from resource-types.json's `icon` entry (activePaths
 * ["icons/"]), which marks it on /icons/ and every /icons/<pack>.html. Same
 * every-page blast radius: one added <a> per nav region.
 */
const MAIN_HEADER_NAV = [
  { label: "All", landingUrl: "/" },
  { label: "Colors", landingUrl: "/colors/" },
  { label: "Palettes", landingUrl: "/palettes/" },
  { label: "Fonts", landingUrl: "/fonts/" },
  { label: "Icons", landingUrl: "/icons/" },
  { label: "Image Picker", landingUrl: "/image-picker/" },
  { label: "UI/UX Guides", landingUrl: "/guides/" },
  { label: "Learning Roadmap", landingUrl: "/roadmap" },
];

/**
 * Replaces the text between two markers, keeping the markers themselves.
 * Returns null — rather than throwing — when a file does not carry both, so
 * the caller can skip and report instead of failing the whole build.
 */
function replaceBetween(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return null;
  return (
    html.slice(0, start + startMarker.length) + replacement + html.slice(end)
  );
}

/**
 * "/palettes" -> palettes.html or palettes/index.html; "/" -> index.html;
 * "/#guides" -> index.html, which must contain id="guides".
 *
 * `pagesRoot` is the tree the pages live in — the staging root, which by the
 * time the header runs holds every routed page as built. Returns the
 * resolved file path, or null if the URL doesn't point at something real.
 */
function resolveLandingUrl(pagesRoot, url) {
  const hashIndex = url.indexOf("#");
  const pathPart = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex + 1);
  if (!pathPart.startsWith("/")) return null;
  const rel = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  const candidates =
    rel === "" ? ["index.html"] : [rel, `${rel}.html`, `${rel}/index.html`];
  const file = candidates
    .map((candidate) => path.join(pagesRoot, candidate))
    .find(
      (candidate) =>
        fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    );
  if (!file) return null;
  if (fragment && !fs.readFileSync(file, "utf8").includes(`id="${fragment}"`)) {
    return null;
  }
  return file;
}

/**
 * Selects the nav-eligible entries of the resource-type registry. Their
 * `activePaths` are what drive the aria-current highlight; their labels are
 * not used by the nav regions (see MAIN_HEADER_NAV).
 *
 * PHASE 4 STEP 6 — TAKES THE LOADED REGISTRY, DOES NOT READ THE FILE
 *
 * This function used to open resource-types.json itself and validate its
 * shape: the array, the `type` slug, duplicate types, `nav`, `label` and
 * `activePaths`. src/build/home.js opened the same file's loaded copy and
 * validated a DIFFERENT subset, so neither knew what the other checked and
 * the file was parsed twice per build. All of that shape checking is now
 * stated once, in src/build/content.js, and has already run by the time this
 * is called.
 *
 * What stays here is the one rule this module can answer and that one cannot:
 * a nav destination must resolve to a page that actually exists in
 * `pagesRoot` — the staging root, which by the time the header runs holds
 * every routed page as built. That is a fact about the site, not about the
 * file, so it cannot move into the loader.
 */
function loadNavEntries(registry, pagesRoot) {
  const navEntries = [];
  registry.forEach((entry, i) => {
    if (!entry.nav) return;
    const where = `resource-types.json[${i}]`;
    if (!resolveLandingUrl(pagesRoot, entry.landingUrl)) {
      throw new Error(
        `${where}.landingUrl ${JSON.stringify(entry.landingUrl)} does not resolve to an existing page — ` +
          `only list a resource type in the nav once its destination exists.`,
      );
    }
    navEntries.push(entry);
  });
  return navEntries;
}

/**
 * The same existence guard loadNavEntries() applies to resource-types.json,
 * applied to the hand-authored MAIN_HEADER_NAV list above: a main-header
 * link may not point at a page that isn't there.
 */
function validateMainHeaderNav(pagesRoot) {
  MAIN_HEADER_NAV.forEach((entry, i) => {
    const where = `MAIN_HEADER_NAV[${i}]`;
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`${where}.label must be a non-empty string`);
    }
    if (
      typeof entry.landingUrl !== "string" ||
      !resolveLandingUrl(pagesRoot, entry.landingUrl)
    ) {
      throw new Error(
        `${where}.landingUrl ${JSON.stringify(entry.landingUrl)} does not resolve to an existing page — ` +
          `only list a destination in the main header once it exists.`,
      );
    }
  });
  return MAIN_HEADER_NAV;
}

function navLinksHtml(navEntries) {
  return (
    navEntries
      .map(
        (entry) =>
          `\n${NAV_LINK_INDENT}<a href="${escapeHtml(entry.landingUrl)}">${escapeHtml(entry.label)}</a>`,
      )
      .join("") +
    "\n" +
    NAV_LINK_INDENT
  );
}

/**
 * Rewrites EVERY NAV_RESOURCES_START/END region in one partial's text (each
 * partial has two: desktop nav + mobile menu nav). Pure — the caller decides
 * what to do with the result. Throws if the partial has none, so a partial
 * cannot silently fall out of sync.
 */
function syncNavRegions(label, source, linksHtml) {
  let html = source;
  let regions = 0;
  let from = 0;
  while (true) {
    const start = html.indexOf(NAV_START_MARKER, from);
    if (start === -1) break;
    const contentStart = start + NAV_START_MARKER.length;
    const end = html.indexOf(NAV_END_MARKER, contentStart);
    if (end === -1) {
      throw new Error(
        `${label}: ${NAV_START_MARKER} without a matching ${NAV_END_MARKER}`,
      );
    }
    html = html.slice(0, contentStart) + linksHtml + html.slice(end);
    from = contentStart + linksHtml.length + NAV_END_MARKER.length;
    regions++;
  }
  if (regions === 0) {
    throw new Error(
      `${label} has no ${NAV_START_MARKER} / ${NAV_END_MARKER} region`,
    );
  }
  return { html, regions, changed: html !== source };
}

/**
 * Marks the single `<a href="FILE">…</a>` link that points at the page
 * currently being rendered as the active nav item, the same way the
 * hand-authored headers used to flag roadmap.html's own "Roadmap" link.
 * Only ever called with the href of the page being rendered, so the match is
 * unique within the header markup.
 */
function markCurrent(html, file) {
  return html
    .split(`href="${file}"`)
    .join(`href="${file}" aria-current="page"`);
}

/**
 * Marks a MAIN_HEADER_NAV link as current by its exact nav markup, so a link
 * sharing its href elsewhere in the header (the brand link's "/" on the home
 * page) is left alone. A link already marked no longer matches, so this never
 * double-marks.
 */
function markNavCurrent(html, entry) {
  const link = `<a href="${escapeHtml(entry.landingUrl)}">${escapeHtml(entry.label)}</a>`;
  return html
    .split(link)
    .join(
      `<a href="${escapeHtml(entry.landingUrl)}" aria-current="page">${escapeHtml(entry.label)}</a>`,
    );
}

/**
 * Rewrites the canonical (one-level-deep) partial for a page at `file`
 * (repo-relative, POSIX-style, e.g. "about.html" or "guide/foo.html").
 */
function headerFor(file, partial) {
  const [homeLinkDef, ...otherLinks] = ROOT_LINKS;

  if (file === "index.html") {
    // Home page: the brand link becomes the clean root URL ("/"), not a
    // bare "#", so the address bar doesn't pick up a stray hash. The search
    // form's action keeps pointing at a real file (index.html) since it
    // needs a real GET target for no-JS submits.
    let html = partial
      .split(`href="${homeLinkDef.partialText}"`)
      .join('href="/"')
      .split(`action="${homeLinkDef.partialText}"`)
      .join('action="index.html"')
      .split(homeLinkDef.partialText)
      .join("");
    // Every other root link (e.g. roadmap.html) still needs its normal
    // depth-based rewrite even on the home page itself.
    for (const link of otherLinks) {
      html = html.split(link.partialText).join(link.file);
    }
    return html;
  }

  const depth = file.split("/").length - 1; // "about.html" -> 0, "guide/x.html" -> 1
  const prefix = "../".repeat(depth);
  let html = partial;
  for (const link of ROOT_LINKS) {
    html = html.split(link.partialText).join(prefix + link.file);
  }

  // If this page IS one of the root-linked pages (e.g. roadmap.html), mark
  // its own nav link as current.
  const self = ROOT_LINKS.find((link) => link.file === file);
  if (self) {
    html = markCurrent(html, prefix + self.file);
  }

  return html;
}

/**
 * Syncs the header into every routed page in the staging root.
 *
 * Reads both partials from the repo root: they are template inputs, and
 * staging exists only for the legacy builders that resolve their own
 * __dirname. Landing URLs resolve against the staging root, which is where
 * the pages themselves are.
 *
 * PHASE 4 STEP 6: the resource-type registry is CONTENT, not a template
 * input, so it comes from ctx.model like every other content source instead
 * of being re-read here.
 *
 * Returns { updated, unchanged, skipped, stale } for the caller to summarize
 * and warn on. Writes only the pages whose header actually changed.
 */
function render(ctx) {
  const { root, stage } = ctx.config.paths;

  // activePaths drive the aria-current highlight; the link text comes from
  // MAIN_HEADER_NAV, which both partials share so the two stay consistent.
  const navEntries = loadNavEntries(ctx.model.resourceTypes, stage);
  const linksHtml = navLinksHtml(validateMainHeaderNav(stage));

  const stale = [];
  const readPartial = (rel) => {
    const result = syncNavRegions(
      rel.split(path.sep).join("/"),
      fs.readFileSync(path.join(root, rel), "utf8"),
      linksHtml,
    );
    if (result.changed) stale.push(rel.split(path.sep).join("/"));
    return result.html.trim();
  };

  const partial = readPartial(PARTIAL);
  const homePartial = readPartial(HOME_PARTIAL);

  let updated = 0;
  let unchanged = 0;
  const skipped = [];

  for (const r of ctx.routes) {
    const file = path.join(stage, r.file);
    if (!fs.existsSync(file)) {
      throw new Error(
        `route ${r.url} has no staged file at ${r.file} — the header runs ` +
          `after the page writers and expects every page to exist by now.`,
      );
    }

    const original = fs.readFileSync(file, "utf8");
    // index.html is the only page that gets the no-search, single-row home
    // header; every other page gets the two-row partial.
    let headerHtml = headerFor(
      r.file,
      r.file === "index.html" ? homePartial : partial,
    );
    // Resource-type links (/guides, /palettes) are absolute root-relative,
    // so they need no depth rewriting — but they get the same "you are here"
    // highlight headerFor() gives roadmap.html, driven by each
    // resource-types.json entry's activePaths.
    for (const entry of navEntries) {
      if (entry.activePaths.some((prefix) => r.file.startsWith(prefix))) {
        headerHtml = markCurrent(headerHtml, escapeHtml(entry.landingUrl));
      }
    }
    // Nav entries that are not resource types ("All", "Learning Roadmap")
    // are current when their landing URL resolves to this very page.
    for (const entry of MAIN_HEADER_NAV) {
      if (resolveLandingUrl(stage, entry.landingUrl) === file) {
        headerHtml = markNavCurrent(headerHtml, entry);
      }
    }

    const result = replaceBetween(
      original,
      START_MARKER,
      END_MARKER,
      headerHtml,
    );

    if (result === null) {
      skipped.push(r.file);
      continue;
    }
    if (result !== original) {
      fs.writeFileSync(file, result, "utf8");
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged, skipped, stale };
}

module.exports = {
  render,
  headerFor,
  navLinksHtml,
  syncNavRegions,
  markCurrent,
  replaceBetween,
  resolveLandingUrl,
  loadNavEntries,
  validateMainHeaderNav,
  PARTIAL,
  HOME_PARTIAL,
  START_MARKER,
  END_MARKER,
  NAV_START_MARKER,
  NAV_END_MARKER,
  NAV_LINK_INDENT,
  ROOT_LINKS,
  MAIN_HEADER_NAV,
};
