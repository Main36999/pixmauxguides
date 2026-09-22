/**
 * src/build/footer.js — the site footer, rendered in-process.
 *
 * PHASE 4 STEP 3A — the first legacy builder to leave RENDER_ORDER.
 *
 * This is `build-footer.js` ported verbatim in behaviour and deleted at the
 * root. It was the cheapest of the four to move, exactly as the Step 2
 * handoff predicted: one partial, five link rewrites, one marker region, and
 * — since Step 2A dropped the category-nav generator — no dependency on
 * anything, not even src/shared/html.js. The old file's header claimed
 * kinship with `escapeHtml()`; nothing here escapes anything, because the
 * partial is copied through as authored.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 *
 * The one deliberate change is the page set. `build-footer.js` found its
 * pages by walking its whole working root for *.html and skipping
 * node_modules/.git/partials. This module iterates `ctx.routes` instead, so
 * the page set is declared rather than discovered and the same table the
 * sitemap and URL gates are checked against is the one the footer is written
 * into. The two were verified equal before the swap: the walk visited
 * exactly the 41 route pages and nothing else, the three files under
 * partials/ being the only other .html in the staging root and the only ones
 * the ignore list excluded.
 *
 * Everything the output depends on is unchanged and deliberately so:
 *
 *   - the partial is `.trim()`ed before insertion (it ends with a newline
 *     that must not reach the page);
 *   - the markers are kept and only the text between them is replaced, at
 *     the FIRST occurrence of each, via the same indexOf arithmetic;
 *   - the depth rewrite replaces EVERY occurrence of each "../<file>"
 *     literal, via split/join, not just the first;
 *   - a page whose markers are missing or inverted is skipped and reported,
 *     never half-written;
 *   - a page whose footer is already correct is not rewritten at all.
 *
 * THE PARTIAL IS STILL SHARED
 *
 * partials/footer.html has a second reader: src/build/categories.js embeds it
 * verbatim into the pages it writes from scratch, inside the same marker
 * comments, so that this module can resync them afterwards. That is why this
 * module must keep running AFTER categories. Both read the partial from the
 * repo root: it stopped being a staged build input in Step 3C, and Step 3E
 * removed the staging table altogether.
 *
 * ORDER
 *
 * home → categories → guides → header → footer. Categories and guides write
 * pages from the raw partials; header restores `aria-current`; footer is last
 * and rewrites only its own marker region, so it disturbs neither. This
 * module's own position — last — is unchanged; Step 4 added the guide pages
 * ahead of it, which it patches like any other route.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PARTIAL = path.join("partials", "footer.html");

const START_MARKER = "<!--FOOTER_START-->";
const END_MARKER = "<!--FOOTER_END-->";

/**
 * Link targets the partial is authored with, at "one level deep" — i.e.
 * exactly as they should appear on a /guide/*.html page. Every other depth
 * is derived from these by footerFor().
 */
const FOOTER_LINK_FILES = [
  "about.html",
  "roadmap.html",
  "contact.html",
  "privacy.html",
  "terms.html",
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
 * Rewrites the canonical (one-level-deep) partial for a page at `file`
 * (repo-relative, POSIX-style, e.g. "about.html" or "guide/foo.html").
 *
 * No page is special-cased: unlike the header, the footer has no in-page "#"
 * jumps and no home variant, so every page needs only its depth prefix.
 * Depth 0 strips "../"; depth 1 is a no-op; deeper repeats it.
 */
function footerFor(file, partial) {
  const depth = file.split("/").length - 1;
  const prefix = "../".repeat(depth);
  let html = partial;
  for (const name of FOOTER_LINK_FILES) {
    html = html.split(`../${name}`).join(prefix + name);
  }
  return html;
}

/**
 * Syncs the footer into every routed page in the staging root.
 *
 * Reads the partial from the repo root: it is a build input, and staging
 * exists only for the legacy builders that resolve their own __dirname. The
 * staged copy is a byte-for-byte copy of this same file.
 *
 * Returns { updated, unchanged, skipped } for the caller to summarize and
 * warn on. Writes only the pages whose footer actually changed.
 */
function render(ctx) {
  const { root, stage } = ctx.config.paths;
  const partial = fs.readFileSync(path.join(root, PARTIAL), "utf8").trim();

  let updated = 0;
  let unchanged = 0;
  const skipped = [];

  for (const r of ctx.routes) {
    const file = path.join(stage, r.file);
    if (!fs.existsSync(file)) {
      throw new Error(
        `route ${r.url} has no staged file at ${r.file} — the footer runs ` +
          `last and expects every page to exist by now.`,
      );
    }

    const original = fs.readFileSync(file, "utf8");
    const result = replaceBetween(
      original,
      START_MARKER,
      END_MARKER,
      footerFor(r.file, partial),
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

  return { updated, unchanged, skipped };
}

module.exports = {
  render,
  footerFor,
  replaceBetween,
  PARTIAL,
  START_MARKER,
  END_MARKER,
  FOOTER_LINK_FILES,
};
