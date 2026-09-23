/**
 * src/routes.js — the site's URL map, derived from the content model.
 *
 * One table, one set of rules, one place to answer "what URLs does this
 * site have and which file serves each one". Until Phase 2 there was no
 * such place: the answer was spread across build-categories.js,
 * build-home.js, sitemap.xml and _redirects, and the only way to enumerate
 * it was to walk the built output after the fact.
 *
 * URL SHAPE — transcribed from the deployed site, not chosen:
 *
 *   index.html               -> /
 *   <name>.html   (root)     -> /<name>.html        (keeps its extension)
 *   <dir>/index.html         -> /<dir>
 *   guide|category/<slug>.html -> /<dir>/<slug>     (extensionless)
 *
 * Root-level pages keep .html and the sectioned directories drop it.
 * That asymmetry is pre-existing and load-bearing — every canonical tag,
 * internal link and sitemap entry already assumes it — so it is encoded
 * here rather than tidied. Normalizing the two into one rule is a URL
 * change and belongs to a later, separately approved phase.
 *
 * PHASE 4 — TOKEN REMOVAL
 *
 * The token routes are gone: 40 tokens/<slug>.html detail pages,
 * tokens/index.html, tokens/create.html and tokens/collection.html — 43
 * pages, taking the table from 84 to 41. The deleted URLs are not
 * redirected; they return 410 (see public/_redirects).
 *
 * This module does not render; the builders in src/build/ emit the pages, all
 * of them in-process since Phase 4 Step 3D and, since Step 4, all of them
 * generated — guide/*.html included. What it does do is let the gate assert
 * that the routes the content model implies are exactly the 41 expected,
 * which is how a page silently appearing or vanishing gets caught.
 */

"use strict";

/** Root-level pages that are not generated from the content model. */
const STATIC_ROOT_PAGES = [
  "index.html",
  "about.html",
  "contact.html",
  "privacy.html",
  "roadmap.html",
  "search.html",
  "terms.html",
];

/**
 * Section landing pages served from <dir>/index.html.
 *
 * PHASE 4 STEP 10 — COLOR LIBRARY
 *
 * "colors/index.html" is the third entry, and it is the first route this
 * table has GAINED since it was written. It is listed here, next to
 * /palettes, because /colors is the same KIND of thing: one committed page
 * that the header and footer builders patch, backed by a JSON file the
 * browser fetches. It is not a new route SHAPE — urlFor() already maps
 * <dir>/index.html to /<dir> and needed no change for it.
 *
 * Adding a row here is what takes the table from 41 pages to 42, which
 * site.config.js's expected.htmlPages states and the `load` stage asserts.
 *
 * IMAGE PICKER — "image-picker/index.html" is the fourth entry, added the
 * same way /colors was: one committed page, hand-authored, header/footer
 * patched in place by the existing markers, no new route shape and no
 * backing data file (its palette is produced client-side from whatever
 * image the visitor picks, not fetched). Takes the table from 42 pages to
 * 43 — see site.config.js's expected.htmlPages. It shipped with this route
 * deliberately absent from MAIN_HEADER_NAV in src/build/header.js so the
 * route addition alone touched no other page's output; a follow-up change
 * added it there once the page was live, at the cost this file's Step 10
 * note already describes — see that module's comment above the list.
 */
const SECTION_INDEX_PAGES = [
  "guides/index.html",
  "palettes/index.html",
  "colors/index.html",
  "image-picker/index.html",
];

/**
 * The directories whose pages are linked without the .html extension.
 *
 * PHASE 4: "tokens" is gone from this set with the feature. Its removal is
 * deliberate and is what stops /tokens/<slug> from resolving — those URLs
 * now return 410 via public/_redirects.
 */
const EXTENSIONLESS_DIRS = new Set(["guide", "category"]);

/** file path (repo-relative, posix) -> public URL */
function urlFor(file) {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) {
    return "/" + file.slice(0, -"/index.html".length);
  }
  const dir = file.split("/")[0];
  if (EXTENSIONLESS_DIRS.has(dir) && file.endsWith(".html")) {
    return "/" + file.slice(0, -".html".length);
  }
  return "/" + file;
}

function route(file, type) {
  return { file, url: urlFor(file), type };
}

/**
 * Builds the full route table from a loaded content model.
 * Deterministic: generated routes follow their source array's order, and
 * the table as a whole is sorted by URL before it is returned.
 */
function build(model) {
  const routes = []
    .concat(STATIC_ROOT_PAGES.map((f) => route(f, "page")))
    .concat(SECTION_INDEX_PAGES.map((f) => route(f, "section")))
    .concat(model.guides.map((g) => route(`guide/${g.id}.html`, "guide")))
    .concat(
      model.categories.map((c) => route(`category/${c.slug}.html`, "category")),
    );

  routes.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

  const seen = new Set();
  routes.forEach((r) => {
    if (seen.has(r.url)) throw new Error(`Duplicate route: ${r.url}`);
    seen.add(r.url);
  });

  return routes;
}

/** Absolute canonical URL for a route, using the configured origin. */
function canonicalFor(config, url) {
  return config.origin + url;
}

module.exports = { build, urlFor, canonicalFor, EXTENSIONLESS_DIRS };
