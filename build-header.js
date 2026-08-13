#!/usr/bin/env node
/**
 * build-header.js
 * -----------------------------------------------------------------------
 * Pre-renders the shared site header into every .html page from a single
 * source of truth: partials/header.html.
 *
 * WHY THIS EXISTS
 * <header class="site-header">…</header> (nav links, search form, mobile
 * menu) is meant to be identical everywhere — app.js's comments say guide
 * *and legal* pages share "header search + mobile menu behavior" — but it
 * was hand-duplicated per page and had drifted:
 *
 *   - index.html and every /guide/*.html page: full header, INCLUDING the
 *     hamburger button (#menu-toggle) and the #mobile-menu panel.
 *   - about.html, contact.html, privacy.html, terms.html: missing the
 *     hamburger and #mobile-menu entirely.
 *
 * That's not a cosmetic gap. styles.css hides .header-actions outright
 * at max-width:640px and relies on #menu-toggle to reveal #mobile-menu
 * in its place (see the "mobile menu" rules in styles.css). Pages without
 * that markup have NO nav and NO search on any phone-width viewport —
 * just the logo. This script fixes that by making the full header (with
 * mobile menu) the one version that ships everywhere.
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
 *   - index.html itself is special-cased: brand link -> "#", nav links
 *     -> "#guides" / "#toolbar" (in-page jumps, no reload), but the
 *     search form's action stays "index.html" (a real fallback target
 *     for no-JS submits) — this matches index.html's original markup
 *     exactly.
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
const START_MARKER = "<!--HEADER_START-->";
const END_MARKER = "<!--HEADER_END-->";

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
    // Home page: brand + nav become in-page jumps; the search form's
    // action keeps pointing at a real file (index.html) since it needs
    // a real GET target for no-JS submits.
    let html = partial
      .split(`href="${homeLinkDef.partialText}"`)
      .join('href="#"')
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
  const partial = fs.readFileSync(HEADER_PARTIAL_PATH, "utf8").trim();
  const files = findHtmlFiles(ROOT);

  let updated = 0;
  let unchanged = 0;
  const skipped = [];

  for (const file of files) {
    const relPath = path.relative(ROOT, file).split(path.sep).join("/");
    const original = fs.readFileSync(file, "utf8");
    const headerHtml = headerFor(relPath, partial);
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
