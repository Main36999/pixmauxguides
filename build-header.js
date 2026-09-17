#!/usr/bin/env node
/**
 * build-header.js
 * -----------------------------------------------------------------------
 * Pre-renders the shared site header into every .html page from two
 * sources of truth: partials/header-home.html (index.html only) and
 * partials/header.html (every other page) — see "TWO HEADER VARIANTS"
 * below for why there are two.
 *
 * WHY THIS EXISTS
 * <header class="site-header">…</header> (nav links, search form, mobile
 * menu) is meant to be identical across all pages of the same variant —
 * app.js's comments say guide *and legal* pages share "header search +
 * mobile menu behavior" — but it used to be hand-duplicated per page and
 * had drifted:
 *
 *   - index.html and every /guide/*.html page: full header, INCLUDING the
 *     hamburger button (#menu-toggle) and the #mobile-menu panel.
 *   - about.html, contact.html, privacy.html, terms.html: missing the
 *     hamburger and #mobile-menu entirely.
 *
 * That's not a cosmetic gap: without #menu-toggle/#mobile-menu markup, a
 * page has no way to reach its nav links at all at phone width once
 * .site-nav hides there (see the "mobile menu" rules in styles.css) —
 * just the logo, nothing else reachable. This script fixes that by
 * making the full header (with mobile menu) the one version that ships
 * everywhere, generated from the matching partial instead of by hand.
 *
 * This does NOT switch to fetching the header client-side with fetch().
 * Two reasons:
 *   1. Same reasoning as build-home.js: the header must exist in the raw
 *      HTML for JS-disabled visitors and crawlers, not appear only after
 *      an async request resolves.
 *   2. app.js queries #menu-toggle, #mobile-menu and .header-search
 *      synchronously as soon as it runs (a plain <script> at the end of
 *      <body>, not deferred). If the header were injected later by a
 *      fetch(), those elements wouldn't exist yet when app.js looks for
 *      them, and the menu/search would silently stop working.
 *
 * TWO HEADER VARIANTS: HOME VS. EVERY OTHER PAGE
 * bpozz's header now structurally differs by page, matching how
 * resourceboy.com does it:
 *   - index.html renders partials/header-home.html: a single row
 *     (logo + nav, no search) because the home page already has a
 *     large, prominent search box in its hero section right below
 *     the header.
 *   - Every other page (guide, category, roadmap, search, about,
 *     contact, privacy, terms — anything without that hero) renders
 *     partials/header.html: a two-row header, logo + a persistent
 *     full-width search bar on top, nav links on a second row
 *     underneath — since those pages have no hero search to fall
 *     back on, the header has to carry search itself.
 * Both variants still share one #mobile-menu panel and #menu-toggle
 * button markup/behavior, and both go through the exact same
 * per-page link rewriting below — only which partial is loaded as
 * the input to that rewriting differs, selected in main() by whether
 * the target file's relPath is "index.html".
 *
 * PER-PAGE LINK REWRITING
 * partials/header.html is authored at "one level deep" (i.e. exactly as
 * it should appear on a /guide/*.html page), using "../index.html" as
 * the literal home link. For every other page, this script rewrites that
 * literal to the correct relative path based on the target file's depth
 * from the project root:
 *   - root-level pages (about.html, contact.html, ...): "../index.html"
 *     -> "index.html"
 *   - a page nested N levels deep: "../index.html" -> "../".repeat(N) +
 *     "index.html"
 *   - index.html itself is special-cased: the brand link and the "All"
 *     nav link both -> "/" (clean root URL, no filename and no trailing
 *     "#"), since a bare "#" would leave a stray hash in the address
 *     bar. The search form's action stays "index.html" (a real fallback
 *     target for no-JS submits).
 *
 * PHASE 5 — TYPE-FIRST NAV FROM resource-types.json
 * The primary nav (desktop .site-nav and the #mobile-menu nav, in both
 * partials) lists resource TYPES — Guides · Tokens · Palettes — then the
 * static Roadmap link. Guide categories are no longer in the header; they
 * stay internally linked from every page via the footer's category row
 * (build-footer.js, from categories.json).
 *
 * The resource-type links are generated, not hand-authored: each nav in
 * each partial has a NAV_RESOURCES_START/END marker region, and main()
 * rewrites every such region in partials/header.html and
 * partials/header-home.html from resource-types.json (entries with
 * `nav: true`, in array order) BEFORE syncing pages. Writing the result
 * into the partial files themselves — rather than only into pages — keeps
 * the partials complete, valid HTML for build-categories.js and
 * build-tokens.js, which embed them verbatim. Don't hand-edit inside
 * those regions; edit resource-types.json and re-run this script.
 *
 * A nav entry's `landingUrl` must resolve to a real file on disk (and, if
 * it has a #fragment, to an element with that id), or this script fails.
 * That is the guard against linking a future resource type before its
 * destination exists.
 *
 * Active state ("you are here"): a page whose relPath starts with one of
 * an entry's `activePaths` gets aria-current="page" on that entry's nav
 * link (e.g. guide/ and category/ -> Guides, tokens/ -> Tokens,
 * palettes/ -> Palettes). Roadmap keeps its existing ROOT_LINKS rule
 * below. This replaces the pre-Phase-5 hard-coded category/tokens/
 * palettes rules.
 *
 * ONE-TIME SETUP PER PAGE
 * Wrap the page's existing <header class="site-header">…</header> block
 * in marker comments:
 *
 *   <!--HEADER_START--><header class="site-header">
 *     ...
 *   </header><!--HEADER_END-->
 *
 * Pages missing either marker are left untouched and reported as
 * skipped — nothing is silently un-synced.
 *
 * USAGE
 *   node build-header.js
 *
 * Run this locally (or as part of your host's build command, alongside
 * build-home.js) any time partials/header.html changes, before you
 * commit/deploy the .html pages.
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const HEADER_PARTIAL_PATH = path.join(ROOT, "partials", "header.html");
const HOME_HEADER_PARTIAL_PATH = path.join(
  ROOT,
  "partials",
  "header-home.html",
);
const START_MARKER = "<!--HEADER_START-->";
const END_MARKER = "<!--HEADER_END-->";
const RESOURCE_TYPES_PATH = path.join(ROOT, "resource-types.json");
const NAV_START_MARKER = "<!--NAV_RESOURCES_START-->";
const NAV_END_MARKER = "<!--NAV_RESOURCES_END-->";
// Indentation of a nav link line inside the partials (both navs, both
// partials), so the generated region reads like the hand-authored markup
// around it.
const NAV_LINK_INDENT = "      ";

// Root-relative links in the partial that need per-page depth
// rewriting. Each `partialText` is the literal substring the partial is
// authored with (one level deep, i.e. exactly as it should appear on a
// /guide/*.html page) — same convention this script has always used for
// the home link, generalized to a list so additional root pages (e.g.
// roadmap.html) can share the rewrite logic instead of only living in
// partials/header.html and drifting out of sync on every other page.
const ROOT_LINKS = [
  { file: "index.html", partialText: "../index.html" },
  { file: "roadmap.html", partialText: "../roadmap.html" },
];

// Directories we never want to walk into looking for .html files.
const IGNORED_DIRS = new Set(["node_modules", ".git", "partials"]);

function findHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      findHtmlFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Same simple marker-replacement approach as build-home.js — returns
// null (instead of throwing) when a file doesn't have both markers, so
// the caller can skip-and-report rather than fail the whole build.
function replaceBetween(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return null;
  return (
    html.slice(0, start + startMarker.length) + replacement + html.slice(end)
  );
}

// ---------------------------------------------------------------------
// Phase 5 — resource-type nav (see "PHASE 5" in the header comment)
// ---------------------------------------------------------------------

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

// "/tokens" -> tokens.html or tokens/index.html; "/" -> index.html;
// "/#guides" -> index.html, which must contain id="guides". Returns the
// resolved file path, or null if the URL doesn't point at something real.
function resolveLandingUrl(url) {
  const hashIndex = url.indexOf("#");
  const pathPart = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex + 1);
  if (!pathPart.startsWith("/")) return null;
  const rel = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  const candidates =
    rel === "" ? ["index.html"] : [rel, `${rel}.html`, `${rel}/index.html`];
  const file = candidates
    .map((candidate) => path.join(ROOT, candidate))
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) return null;
  if (fragment && !fs.readFileSync(file, "utf8").includes(`id="${fragment}"`)) {
    return null;
  }
  return file;
}

function loadNavEntries() {
  const registry = JSON.parse(fs.readFileSync(RESOURCE_TYPES_PATH, "utf8"));
  if (!Array.isArray(registry)) {
    throw new Error("resource-types.json did not contain an array");
  }
  const seen = new Set();
  const navEntries = [];
  registry.forEach((entry, i) => {
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
    if (typeof entry.nav !== "boolean") {
      throw new Error(`${where}.nav must be true or false`);
    }
    if (!entry.nav) return;
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`${where}.label must be a non-empty string`);
    }
    if (typeof entry.landingUrl !== "string" || !resolveLandingUrl(entry.landingUrl)) {
      throw new Error(
        `${where}.landingUrl ${JSON.stringify(entry.landingUrl)} does not resolve to an existing page — ` +
          `only list a resource type in the nav once its destination exists.`,
      );
    }
    if (
      !Array.isArray(entry.activePaths) ||
      !entry.activePaths.every((prefix) => typeof prefix === "string" && prefix)
    ) {
      throw new Error(`${where}.activePaths must be an array of path prefixes`);
    }
    navEntries.push(entry);
  });
  return navEntries;
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

// Rewrites EVERY NAV_RESOURCES_START/END region in one partial file
// (each partial has two: desktop nav + mobile menu nav). Throws if the
// partial has none, so a partial can't silently fall out of sync.
function syncNavRegions(partialPath, linksHtml) {
  const original = fs.readFileSync(partialPath, "utf8");
  let html = original;
  let regions = 0;
  let from = 0;
  while (true) {
    const start = html.indexOf(NAV_START_MARKER, from);
    if (start === -1) break;
    const contentStart = start + NAV_START_MARKER.length;
    const end = html.indexOf(NAV_END_MARKER, contentStart);
    if (end === -1) {
      throw new Error(`${partialPath}: ${NAV_START_MARKER} without a matching ${NAV_END_MARKER}`);
    }
    html = html.slice(0, contentStart) + linksHtml + html.slice(end);
    from = contentStart + linksHtml.length + NAV_END_MARKER.length;
    regions++;
  }
  if (regions === 0) {
    throw new Error(`${partialPath} has no ${NAV_START_MARKER} / ${NAV_END_MARKER} region`);
  }
  if (html !== original) fs.writeFileSync(partialPath, html);
  return { regions, changed: html !== original };
}

// Marks the single `<a href="FILE">…</a>` link that points at the page
// currently being rendered as the active nav item, the same way the
// hand-authored headers used to flag roadmap.html's own "Roadmap" link.
// Only ever called with the href of the page being rendered, so the
// match is unique within the header markup.
function markCurrent(html, file) {
  return html
    .split(`href="${file}"`)
    .join(`href="${file}" aria-current="page"`);
}

// Rewrites the canonical (one-level-deep) header partial for a page at
// `relPath` (POSIX-style, relative to project root, e.g. "about.html" or
// "guide/foo.html").
function headerFor(relPath, partial) {
  const [homeLinkDef, ...otherLinks] = ROOT_LINKS;

  if (relPath === "index.html") {
    // Home page: brand + "All" both become the clean root URL ("/"),
    // not a bare "#", so the address bar doesn't pick up a stray hash.
    // The search form's action keeps pointing at a real file
    // (index.html) since it needs a real GET target for no-JS submits.
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

  const depth = relPath.split("/").length - 1; // "about.html" -> 0, "guide/x.html" -> 1
  const prefix = "../".repeat(depth);
  let html = partial;
  for (const link of ROOT_LINKS) {
    html = html.split(link.partialText).join(prefix + link.file);
  }

  // If this page IS one of the root-linked pages (e.g. roadmap.html),
  // mark its own nav link as current.
  const self = ROOT_LINKS.find((link) => link.file === relPath);
  if (self) {
    html = markCurrent(html, prefix + self.file);
  }

  return html;
}

function main() {
  const navEntries = loadNavEntries();
  const linksHtml = navLinksHtml(navEntries);
  for (const partialPath of [HEADER_PARTIAL_PATH, HOME_HEADER_PARTIAL_PATH]) {
    const result = syncNavRegions(partialPath, linksHtml);
    console.log(
      `✓ ${path.relative(ROOT, partialPath)} nav — ${result.regions} region${result.regions === 1 ? "" : "s"} ` +
        `${result.changed ? "regenerated" : "already up to date"} (${navEntries.map((e) => e.label).join(" · ")}).`,
    );
  }

  const partial = fs.readFileSync(HEADER_PARTIAL_PATH, "utf8").trim();
  const homePartial = fs.readFileSync(HOME_HEADER_PARTIAL_PATH, "utf8").trim();
  const files = findHtmlFiles(ROOT);

  let updated = 0;
  let unchanged = 0;
  const skipped = [];

  for (const file of files) {
    const relPath = path.relative(ROOT, file).split(path.sep).join("/");
    const original = fs.readFileSync(file, "utf8");
    // index.html is the only page that gets the no-search, single-row
    // home header; every other page gets the two-row partial.
    const sourcePartial = relPath === "index.html" ? homePartial : partial;
    let headerHtml = headerFor(relPath, sourcePartial);
    // Resource-type links (/#guides, /tokens, /palettes) are absolute-
    // root-relative, so they need no depth rewriting — but they get the
    // same "you are here" highlight headerFor() gives roadmap.html, driven
    // by each resource-types.json entry's activePaths (Phase 5; replaces
    // the old hard-coded category/tokens/palettes rules).
    for (const entry of navEntries) {
      if (entry.activePaths.some((prefix) => relPath.startsWith(prefix))) {
        headerHtml = markCurrent(headerHtml, escapeHtml(entry.landingUrl));
      }
    }
    const result = replaceBetween(
      original,
      START_MARKER,
      END_MARKER,
      headerHtml,
    );
    if (result === null) {
      skipped.push(relPath);
      continue;
    }
    if (result !== original) {
      fs.writeFileSync(file, result);
      updated++;
    } else {
      unchanged++;
    }
  }

  console.log(
    `✓ Header synced — ${updated} file${updated === 1 ? "" : "s"} updated, ${unchanged} already up to date.`,
  );
  if (skipped.length) {
    console.warn(
      `⚠ Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"} missing ${START_MARKER} / ${END_MARKER} markers:\n  ` +
        skipped.join("\n  ") +
        `\n  Add the markers around that page's <header class="site-header">…</header> block (see index.html) to include it.`,
    );
  }
}

main();
