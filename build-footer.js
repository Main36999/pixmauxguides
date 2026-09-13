#!/usr/bin/env node
/**
 * build-footer.js
 * -----------------------------------------------------------------------
 * Pre-renders the shared site footer into every .html page from a single
 * source of truth: partials/footer.html — the same one-partial-many-pages
 * pattern build-header.js already uses for <header>.
 *
 * WHY THIS EXISTS
 * The footer had drifted worse than the header ever did: every page
 * carried its own hand-copied multi-column footer (brand blurb + social
 * links, a JS-filled category list, Company, Legal, and a newsletter
 * blurb), and the site's rename from PUG/pointuxguides to bpozz never
 * made it into the /guide/*.html copies — they still link out to
 * https://x.com/pointuxguides and friends. Meanwhile resourceboy.com,
 * the layout this pass is matching, ships a single row of links plus
 * one copyright line. This script fixes both problems at once: one
 * footer, defined once, resourceboy-simple.
 *
 * PER-PAGE LINK REWRITING
 * partials/footer.html is authored at "one level deep" (i.e. exactly as
 * it should appear on a /guide/*.html page), using "../about.html" etc.
 * as the literal targets. For every other page, this script rewrites
 * those literals to the correct relative path based on the target
 * file's depth from the project root:
 *   - root-level pages (about.html, index.html, ...): "../about.html"
 *     -> "about.html"
 *   - a page nested N levels deep: "../about.html" -> "../".repeat(N) +
 *     "about.html"
 *
 * ONE-TIME SETUP PER PAGE
 * Wrap the page's existing <footer class="site-footer">…</footer> block
 * in marker comments:
 *
 *   <!--FOOTER_START--><footer class="site-footer">
 *     ...
 *   </footer><!--FOOTER_END-->
 *
 * Pages missing either marker are left untouched and reported as
 * skipped — nothing is silently un-synced.
 *
 * USAGE
 *   node build-footer.js
 *
 * Run this locally (or as part of your host's build command, alongside
 * build-header.js) any time partials/footer.html changes, before you
 * commit/deploy the .html pages.
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const FOOTER_PARTIAL_PATH = path.join(ROOT, "partials", "footer.html");
const START_MARKER = "<!--FOOTER_START-->";
const END_MARKER = "<!--FOOTER_END-->";

// Root-relative link targets the partial is authored with (one level
// deep, i.e. exactly as they should appear on a /guide/*.html page).
const FOOTER_LINK_FILES = [
  "about.html",
  "roadmap.html",
  "contact.html",
  "privacy.html",
  "terms.html",
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

// Same simple marker-replacement approach as build-header.js — returns
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

// Rewrites the canonical (one-level-deep) footer partial for a page at
// `relPath` (POSIX-style, relative to project root, e.g. "about.html" or
// "guide/foo.html"). Unlike headerFor() in build-header.js, no page gets
// special-cased: the footer never links to "#" in-page jumps, so every
// page — index.html included — just needs the ordinary depth prefix.
function footerFor(relPath, partial) {
  const depth = relPath.split("/").length - 1; // "about.html" -> 0, "guide/x.html" -> 1
  const prefix = "../".repeat(depth);
  let html = partial;
  for (const file of FOOTER_LINK_FILES) {
    html = html.split(`../${file}`).join(prefix + file);
  }
  return html;
}

function main() {
  const partial = fs.readFileSync(FOOTER_PARTIAL_PATH, "utf8").trim();
  const files = findHtmlFiles(ROOT);

  let updated = 0;
  let unchanged = 0;
  const skipped = [];

  for (const file of files) {
    const relPath = path.relative(ROOT, file).split(path.sep).join("/");
    const original = fs.readFileSync(file, "utf8");
    const footerHtml = footerFor(relPath, partial);
    const result = replaceBetween(
      original,
      START_MARKER,
      END_MARKER,
      footerHtml,
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
    `✓ Footer synced — ${updated} file${updated === 1 ? "" : "s"} updated, ${unchanged} already up to date.`,
  );
  if (skipped.length) {
    console.warn(
      `⚠ Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"} missing ${START_MARKER} / ${END_MARKER} markers:\n  ` +
        skipped.join("\n  ") +
        `\n  Add the markers around that page's <footer class="site-footer">…</footer> block (see index.html) to include it.`,
    );
  }
}

main();
