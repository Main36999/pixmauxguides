/**
 * src/routes.js — the site's URL map, derived from the content model.
 *
 * One table, one set of rules, one place to answer "what URLs does this
 * site have and which file serves each one". Until Phase 2 there was no
 * such place: the answer was spread across build-categories.js,
 * build-home.js, sitemap.xml and _redirects, and the only way to enumerate
 * it was to walk the built output after the fact.
 *
 * URL SHAPE:
 *
 *   index.html               -> /
 *   <name>.html   (root)     -> /<name>             (extensionless)
 *   <dir>/index.html         -> /<dir>/
 *   <dir>/<slug>.html        -> /<dir>/<slug>       (extensionless)
 *
 * PRETTY URL MIGRATION: root pages, /fonts/<id> and /icons/<pack> used to
 * keep their .html while guide and category pages dropped it. Netlify's
 * Pretty URLs serves every page at its extensionless URL and rewrites
 * <a href> links to that form on deploy, so the canonical, og:url, sitemap
 * and JSON-LD now use it too. The .html form still answers 200 and
 * canonicalizes here; there is no redirect. 404.html is the one page that
 * keeps its .html: Netlify serves it by that file name, and it is not linked.
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
  "hoysomrach.html",
  // The not-found page Netlify serves for any missing path. noindex, no
  // canonical, and not in sitemap.xml.
  "404.html",
  // /account — Profile, Saved and Settings for a signed-in visitor, the
  // three destinations of the header's account menu. noindex, and not in
  // sitemap.xml: it is personal, not content.
  "account.html",
];

/**
 * Root pages published at an extensionless URL. Netlify serves /<name> from
 * <name>.html. hoysomrach and account were extensionless from the start; the
 * rest joined in the Pretty URL migration (see URL SHAPE above).
 * scripts/qa/snapshot.js mirrors this set.
 */
const EXTENSIONLESS_ROOT_PAGES = new Set([
  "hoysomrach.html",
  "account.html",
  "about.html",
  "contact.html",
  "privacy.html",
  "roadmap.html",
  "search.html",
  "terms.html",
]);

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
 *
 * PRETTY URL MIGRATION: "fonts" and "icons" joined, so /fonts/<id> and
 * /icons/<pack> are linked and canonicalized extensionless like guides.
 *
 * ICON PACKS REMOVED: "icons" left with the feature. Its old URLs return
 * 410 via public/_redirects.
 */
const EXTENSIONLESS_DIRS = new Set(["guide", "category", "fonts"]);

/** file path (repo-relative, posix) -> public URL */
function urlFor(file) {
  if (file === "index.html") return "/";
  // Section pages keep the trailing slash. They are directories on the host,
  // and Netlify answers the slashless form (/guides) with a 301 to /guides/ —
  // measured against production, 2026-09-23. A canonical, sitemap entry or
  // link without the slash therefore pointed at a redirect.
  if (file.endsWith("/index.html")) {
    return "/" + file.slice(0, -"index.html".length);
  }
  if (EXTENSIONLESS_ROOT_PAGES.has(file)) {
    return "/" + file.slice(0, -".html".length);
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
 * FONTS — the first route group whose pages have NO committed source file.
 *
 * Every other route is a page on disk at the repo root that `copy` stages
 * and a builder then patches or overwrites. The font pages are written from
 * src/data/fonts.json by src/build/fonts.js and nothing else, so committing
 * 51 stub files only for `copy` to stage them would be 51 files that exist to
 * be overwritten. `generated: true` tells `copy` not to stage them; the
 * builder writes them into the staging root before the header and footer run,
 * and `render` publishes them like any other route.
 *
 * URL shape: /fonts/ for the listing and /fonts/<id> for each family, served
 * from fonts/<id>.html (`fonts` is in EXTENSIONLESS_DIRS).
 */
const FONTS_DIR = "fonts";

function fontRoutes(fonts) {
  return [route(`${FONTS_DIR}/index.html`, "section")]
    .concat(fonts.map((f) => route(`${FONTS_DIR}/${f.id}.html`, "font")))
    .map((r) => Object.assign(r, { generated: true }));
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
    )
    .concat(fontRoutes(model.fonts));

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

module.exports = {
  build,
  urlFor,
  canonicalFor,
  EXTENSIONLESS_DIRS,
  FONTS_DIR,
};
