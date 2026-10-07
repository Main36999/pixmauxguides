#!/usr/bin/env node
/**
 * src/build/build.js — the one authoritative build.
 *
 *     npm run build
 *
 * WHAT THIS REPLACES
 *
 * The site used to be built by running six scripts by hand in an order
 * that was documented in a handoff file rather than encoded anywhere. The
 * order was load-bearing and silently so: `build-categories.js` writes
 * category pages from the raw partial, which drops the `aria-current="page"`
 * marker that `build-header.js` later puts back. Run the two in the wrong
 * order, or only one of them, and the site ships with broken navigation
 * state and nothing complains.
 *
 * That ordering now lives in `render` below, as a fixed sequence of function
 * calls. `npm run build` is the only supported entry point.
 *
 * THE PIPELINE
 *
 *   clean    wipe dist/ and the private staging root
 *   load     read every content source into one normalized model
 *   copy     stage build inputs; publish static files to dist/;
 *            assemble /app.js from src/shared/ + src/client/ (Phase 3)
 *   data     generate content-index.json (every guide and every palette)
 *   render   run the page builders in locked order, publish HTML to dist/
 *   sitemap  validate sitemap URLs against the route table, publish
 *   verify   fail on any dist/ file not matching the approved output (Phase 3)
 *
 * Stages run in order, share one context object, and each reports what it
 * did. Any stage throwing fails the build.
 *
 * DETERMINISM
 *
 * Every directory walk is sorted, JSON is written with a fixed
 * serialization, and nothing embeds a timestamp, hostname or random value.
 * Two runs on the same tree produce a byte-identical dist/.
 *
 * THE BUILD RENDERS EVERY PAGE ITSELF (Phase 4 Step 3D)
 *
 * It did not always. Until Step 3A, `render` shelled out to legacy builders
 * at the repository root, which were the page generators for the length of
 * the transition — Phase 2 was explicitly scoped to establishing the
 * pipeline, not to replacing the templates inside it. Each was ported into
 * src/build/ in turn and its root script deleted:
 *
 *   STEP 3A  the footer. src/build/footer.js renders it in-process at the
 *            end of `render`, in the slot build-footer.js used to hold.
 *   STEP 3B  the header. src/build/header.js renders it between the page
 *            writers and the footer, the slot build-header.js held.
 *   STEP 3C  the category pages — the first WRITER rather than patcher to
 *            move. src/build/categories.js emits category/*.html from
 *            scratch. With it went the last staged reader of
 *            partials/header.html and partials/footer.html; both left
 *            STAGE_FILES, the way partials/header-home.html left in 3B.
 *   STEP 3D  the home surface. src/build/home.js patches index.html,
 *            guides/index.html and roadmap.html, and being the last builder
 *            out it took the whole shell-out mechanism with it: RENDER_ORDER,
 *            the loop that staged the builder scripts themselves, and the
 *            execFileSync call are all gone. `render` no longer starts a
 *            child process, and there is no supported way to run a page
 *            builder on its own.
 *
 * `build-content-index.js` had already made that trip: the `data` stage
 * below superseded it, which is why it never appeared in the render order.
 * Left in the pipeline it would have overwritten the index with 362 records
 * — it mapped over all 300 palettes, having predated the F9 decision. With
 * nothing able to run it, it was deleted in Phase 4 Step 2A; its record
 * builders live on in src/build/content.js, ported verbatim.
 *
 * WHAT STEP 3E REMOVED
 *
 * STAGE_FILES — a table of build inputs copied into the staging root — and
 * the staged copy of content-index.json the `data` stage wrote. Both existed
 * so the shelled-out builders could resolve their inputs from their own
 * __dirname, and Step 3D left them standing only because emptying them
 * changes what `copy` and `data` do, which it scoped out.
 *
 * Nothing read either one. Verified repository-wide, and then measured: a
 * full build instrumented to record every fs access inside the staging root
 * found all eight files written and never opened — not by a build module, a
 * QA script or a require(). The only staged files read are the routed pages.
 *
 * The staging root itself is NOT obsolete and must stay: every routed page is
 * still staged there, and that is where all the builders read and write
 * before `render` publishes to dist/.
 *
 * WHAT STEP 4 ADDED
 *
 * A fifth builder, and the first one that is not a migrated legacy script:
 * src/build/guides.js. The 22 /guide/*.html pages were hand-authored, so
 * `render` had no builder for them at all — it published whatever `copy` had
 * staged, with the header and footer patched into it. Their shared structure
 * is now src/build/guide-template.js and their content is content/guide/,
 * which src/build/content.js loads with the rest of the model. The published
 * bytes are unchanged.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const home = require("./home.js");
const categories = require("./categories.js");
const guides = require("./guides.js");
const fonts = require("./fonts.js");
const icons = require("./icons.js");
const header = require("./header.js");
const footer = require("./footer.js");

/**
 * PHASE 4 STEP 3D — RENDER_ORDER is gone.
 *
 * It was a list of legacy builder FILENAMES, and it existed only so `render`
 * could spawn each of them with execFileSync in a fixed sequence. Every one
 * of those files has been migrated into this directory, so there is nothing
 * left to name and nothing left to spawn. The order it encoded has not
 * changed and is not lost — it is the calls at the top of `render`, which
 * Step 4 extended with the guide pages:
 *
 *     home → categories → guides → fonts → header → footer
 *
 * and it is still load-bearing, for the reason the old list documented:
 * categories and guides write their pages from the raw partials, which carry
 * no aria-current state, so the header must run after them to put that state
 * back; the footer runs last and rewrites only its own marker region.
 * `render` states that dependency at each call rather than in a list header.
 *
 * PHASE 4: build-tokens.js is gone with the feature it rendered, not
 * migrated.
 */

/**
 * Static files published verbatim to dist/.
 *
 * `to` is the public path, and it is the whole point of this table: a file
 * may move under src/ without its URL moving.
 *
 * PHASE 4 — TOKEN REMOVAL
 *
 * The nine token assets that used to be published here (tokens.css, the
 * four tokens-*.js shared modules, the four tokens-*.js client modules) and
 * the /tokens.json data endpoint are gone. Those URLs are deleted, not
 * redirected.
 *
 * palettes-meta.json is deliberately NOT published: it is a build input
 * that feeds content-index.json, not an endpoint the running site fetches.
 * Publishing it would add a URL, which token removal is not allowed to do.
 *
 * PHASE 4 STEP 2C — two undocumented publications withdrawn
 *
 * `_htaccess` and `resource-types.json` were published here only because
 * they were already deployed and Phase 2 was not allowed to change
 * deployed bytes. Both were flagged in this table for a later decision;
 * this is it.
 *
 *   _htaccess           F7: the deploy target is Netlify. The file is not
 *                       renamed to .htaccess and activates no Apache
 *                       behaviour, so it served a public copy of this
 *                       site's rewrite intentions and nothing else.
 *   resource-types.json Build input only. Verified at Step 2C: no page and
 *                       no client module fetches it — the browser's only
 *                       data fetches are /guides.json, /content-index.json,
 *                       /categories.json and ./palettes-data.json. It is
 *                       still read at build time, from the repo root, by
 *                       src/build/content.js and src/build/header.js; only
 *                       its publication stopped. (Step 3E dropped its staged
 *                       copy, which by then had no reader.)
 *
 * Both are now 410 in public/_redirects, on the same reasoning token
 * removal used: the resource is gone, not moved, and a 410 de-indexes it
 * faster and more honestly than a 404.
 *
 * NOTE FOR FUTURE READERS: neither URL was tracked by scripts/qa/snapshot.js
 * — DATA_ENDPOINTS and SITE_FILES were hard-coded lists that did not name
 * them, so check-urls.js could not see this removal at all. The build's own
 * `verify` stage (which hashes every file in dist/) was the gate that
 * caught it. Step 2D closes that hole by deriving those lists from dist/.
 */
const PUBLISH_FILES = [
  // shared client code. /app.js is not here: since Phase 3 it is assembled
  // from seven sources rather than copied — see APP_BUNDLE below.
  { from: "src/styles/styles.css", to: "styles.css" },
  { from: "src/styles/guide-article.css", to: "guide-article.css" },

  /**
   * ERROR BEACON — reports this site's own uncaught script errors to
   * /api/client-error. It is also bundled into /app.js, as the first of
   * APP_BUNDLE.modules; this standalone copy is for the seven pages that do
   * not load app.js (404, about, account, contact, hoysomrach, privacy,
   * terms), ahead of their first site script. The module guards itself, so a
   * page loading both copies runs it once.
   */
  { from: "src/client/error-beacon.js", to: "error-beacon.js" },

  /**
   * AUTH — the header's Sign in / Sign up dialog. It is also bundled into
   * /app.js (APP_BUNDLE.modules); this standalone copy is for the five
   * hand-authored pages that carry the header but not app.js (about,
   * contact, privacy, terms, hoysomrach). The module guards itself, so a
   * page loading both copies runs it once.
   */
  { from: "src/client/auth.js", to: "auth.js" },

  /**
   * SAVED — the browser half of account Saved (docs/SAVED.md). Like auth.js
   * it is also bundled into /app.js (APP_BUNDLE.modules, right after
   * auth.js, which it relies on); this standalone copy is for /account,
   * which loads /auth.js but not app.js. It ships dormant (LAUNCHED false)
   * and guards itself, so a page loading both copies runs it once.
   */
  { from: "src/client/saved.js", to: "saved.js" },

  /**
   * ACCOUNT — the Saved section of /account (account.html), which loads it
   * after /auth.js and /saved.js. Not in APP_BUNDLE: no other page has the
   * section. It does nothing while saved.js is dormant.
   */
  { from: "src/client/account.js", to: "account.js" },

  /**
   * HOMEPAGE — the stylesheet for the tool and resource cards below the
   * hero, published beside index.html at the root. Same shape as
   * colors.css and image-picker.css: styles only one page uses. The hero
   * itself is styled by styles.css, as it always was.
   */
  { from: "src/styles/home.css", to: "home.css" },

  // palettes feature
  { from: "src/client/palettes.js", to: "palettes/palettes.js" },
  { from: "src/styles/palettes.css", to: "palettes/palettes.css" },

  /**
   * PHASE 4 STEP 10 — Color Library. Three files, published under /colors/ in the
   * same shape the palettes feature uses: page-specific client code and a
   * page-specific stylesheet, both authored under src/ and published beside
   * the page they belong to, plus the data the page fetches.
   *
   * They are NOT added to APP_BUNDLE. /app.js is the code every page on the
   * site downloads; this is ~9 KB that only /colors runs. The palettes
   * feature made the same call for the same reason, and this follows it.
   */
  { from: "src/client/colors.js", to: "colors/colors.js" },
  { from: "src/styles/colors.css", to: "colors/colors.css" },

  /**
   * IMAGE PICKER — same shape as the Color Library block above: a
   * page-specific script and stylesheet, published beside the page they
   * belong to. No JSON data file: the palette this page produces comes
   * from whatever image is loaded (the standby photo below, or whatever
   * the visitor browses to), extracted client-side.
   *
   * Not added to APP_BUNDLE for the same reason colors.js/palettes.js
   * aren't: it is code only /image-picker runs, not every page on the
   * site.
   *
   * standby.jpg is the one binary asset this feature owns: a local,
   * royalty-free photograph (Unsplash License, via Picsum) fetched once
   * at authoring time and committed here — never fetched from the
   * network at runtime. It is what the page shows and extracts a palette
   * from immediately on load, before any upload, so a visitor never sees
   * an empty "no image" workspace. Kept under image-picker/assets/ rather
   * than the site-wide assets/ directory so it stays obviously scoped to
   * this one feature.
   */
  { from: "src/client/image-picker.js", to: "image-picker/image-picker.js" },
  { from: "src/styles/image-picker.css", to: "image-picker/image-picker.css" },
  {
    from: "image-picker/assets/standby.jpg",
    to: "image-picker/assets/standby.jpg",
  },

  /**
   * FONTS — the page-specific stylesheet and script for /fonts/ and every
   * /fonts/<id>.html, published beside the pages the way /colors and
   * /image-picker publish theirs. Not added to APP_BUNDLE: only the font
   * pages run them.
   */
  { from: "src/styles/fonts.css", to: "fonts/fonts.css" },
  { from: "src/client/fonts.js", to: "fonts/fonts.js" },

  /**
   * ICON PACKS — the page-specific stylesheet and script for /icons/ and
   * every /icons/<pack>.html, published beside the pages the way the font
   * library publishes its own. Not added to APP_BUNDLE: only the icon pages
   * run them.
   */
  { from: "src/styles/icons.css", to: "icons/icons.css" },
  { from: "src/client/icons.js", to: "icons/icons.js" },

  // data endpoints the running site fetches
  { from: "guides.json", to: "guides.json" },
  { from: "categories.json", to: "categories.json" },
  { from: "palettes/palettes-data.json", to: "palettes/palettes-data.json" },
  { from: "colors/colors-data.json", to: "colors/colors-data.json" },

  // site files
  { from: "public/og-image.png", to: "og-image.png" },
  { from: "public/robots.txt", to: "robots.txt" },
  { from: "public/ads.txt", to: "ads.txt" },

  // deployment config (Netlify)
  { from: "public/_headers", to: "_headers" },
  { from: "public/_redirects", to: "_redirects" },

  // PHASE 4 STEP 2C: public/_htaccess and resource-types.json used to be
  // published here. Both are withdrawn and now return 410 — see the note
  // above this table. public/_htaccess stays in the repo as the record of
  // the Apache rules, and resource-types.json stays as a build input.
];

/**
 * /app.js — assembled, not copied (Phase 3).
 *
 * The repo-root app.js was one 1058-line IIFE carrying five unrelated
 * concerns plus its own private copies of escapeHtml(), the Guide card
 * renderer and every category motif/dimension label. Phase 3 split it into
 * the seven sources below. The PUBLIC URL IS UNCHANGED and so is the
 * program: this is a concatenation, not a bundler. Nothing is rewritten,
 * minified, reordered or renamed on the way through; the only bytes
 * dropped are each source's leading doc header (see bundleApp).
 *
 * `modules` are self-contained UMD files, emitted at the top level where
 * they register
 * window.BpozzHtml and window.BpozzCard. This build's own render modules
 * `require()` the very same two files out of src/shared/, which is what makes
 * the deduplication real rather than a second copy in a nicer place.
 *
 * `fragments` are slices of one IIFE body, not modules. They share a
 * single function scope exactly as they did when they were one file, which
 * is what makes the split provably behaviour-preserving. They are build
 * inputs only: never published, never <script>-loaded individually. WRAPPER
 * below is the only text this build contributes, and it is verbatim
 * app.js's own opening and closing lines.
 *
 * The assembled file is syntax-checked before it is published, so a broken
 * fragment fails the build instead of shipping a dead site.
 */
const APP_BUNDLE = {
  to: "app.js",
  modules: [
    "src/client/error-beacon.js",
    "src/shared/html.js",
    "src/shared/card.js",
    "src/client/auth.js",
    "src/client/saved.js",
  ],
  fragments: [
    "src/client/core.js",
    "src/client/guides.js",
    "src/client/search.js",
    "src/client/contact.js",
    "src/client/roadmap.js",
  ],
  wrapper: { open: '(function () {\n  "use strict";\n', close: "})();\n" },
  banner:
    "/* /app.js — assembled by src/build.js from src/shared/ + src/client/.\n" +
    "   Generated file: do not edit. Edit the sources, then `npm run build`. */\n",
};

/** Whole directories published verbatim. */
const PUBLISH_DIRS = [
  { from: "assets", to: "assets" },
  { from: "thumbnail_image_webp", to: "thumbnail_image_webp" },
  /**
   * FONTS — every family's original font files, its WOFF2 preview files
   * (where the license allows a converted copy) and its license file,
   * published verbatim at /fonts/<id>/. The download ZIPs are not here: they
   * are generated from these same files by src/build/fonts.js.
   */
  { from: "public/fonts", to: "fonts" },
  /**
   * ICON PACKS — every pack's SVG and PNG files, published verbatim at
   * /icons/<pack>/svg/ and /icons/<pack>/png/. The pack ZIPs are not here:
   * they are generated from these same files by src/build/icons.js.
   */
  { from: "public/icons", to: "icons" },
];

// ---------------------------------------------------------------------
// fs helpers — all deterministic (sorted walks, no timestamps)
// ---------------------------------------------------------------------

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  const entries = fs
    .readdirSync(from, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  ensureDir(to);
  let count = 0;
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dest);
    else {
      copyFile(src, dest);
      count += 1;
    }
  }
  return count;
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/**
 * Assembles APP_BUNDLE into dist/app.js. Pure concatenation in a fixed
 * order, so two runs on the same tree produce byte-identical output.
 */
function bundleApp(root, dist, bundle) {
  // Each source opens with a /** ... */ header written for someone reading
  // src/, not for a browser. It is the one thing dropped on the way
  // through: it would otherwise add ~7.5 KB of prose to a file every page
  // downloads, and the banner already points readers back to the sources.
  // Only a leading header is removed; every other byte is kept.
  const read = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) throw new Error(`bundle source missing: ${rel}`);
    return fs.readFileSync(abs, "utf8").replace(/^\/\*\*[\s\S]*?\*\/\n\n?/, "");
  };

  const code =
    bundle.banner +
    bundle.modules.map(read).join("\n") +
    "\n" +
    bundle.wrapper.open +
    "\n" +
    bundle.fragments.map(read).join("\n") +
    bundle.wrapper.close;

  // A syntax error anywhere in a fragment is invisible until a browser
  // loads the assembled file, by which point it has already shipped. Fail
  // here instead. `new vm.Script` parses without executing.
  try {
    new vm.Script(code, { filename: bundle.to });
  } catch (err) {
    throw new Error(
      `assembled ${bundle.to} is not valid JavaScript: ${err.message}\n` +
        `  sources: ${[...bundle.modules, ...bundle.fragments].join(", ")}`,
    );
  }

  const out = path.join(dist, bundle.to);
  ensureDir(path.dirname(out));
  fs.writeFileSync(out, code, "utf8");
  return bundle.modules.length + bundle.fragments.length;
}

// ---------------------------------------------------------------------
// stages
// ---------------------------------------------------------------------

function clean(ctx) {
  rmrf(ctx.config.paths.dist);
  rmrf(ctx.config.paths.stage);
  ensureDir(ctx.config.paths.dist);
  ensureDir(ctx.config.paths.stage);
  return "dist/ and .build/ emptied";
}

function load(ctx) {
  ctx.model = content.load(ctx.config);
  ctx.routes = routes.build(ctx.model);

  const expected = ctx.config.expected;
  const p = ctx.model.palettes;

  if (ctx.routes.length !== expected.htmlPages) {
    throw new Error(
      `route table has ${ctx.routes.length} pages, expected ${expected.htmlPages}`,
    );
  }
  if (p.length !== ctx.config.palettes.count) {
    throw new Error(
      `palettes-data.json has ${p.length} records, expected ${ctx.config.palettes.count}`,
    );
  }
  if (
    p[0].id !== ctx.config.palettes.firstId ||
    p[p.length - 1].id !== ctx.config.palettes.lastId
  ) {
    throw new Error(
      `palette id range is ${p[0].id}..${p[p.length - 1].id}, expected ` +
        `${ctx.config.palettes.firstId}..${ctx.config.palettes.lastId}`,
    );
  }

  // PHASE 4 STEP 10 — the Color Library contract, asserted exactly the way the
  // palette contract above is. src/build/content.js has already checked
  // every record's SHAPE; what only this stage can check is that the file
  // as a whole is still the set site.config.js says it is, so a truncated
  // or double-appended data file fails here instead of shipping a short or
  // duplicated grid.
  const c = ctx.model.colors;
  if (c.length !== ctx.config.colors.count) {
    throw new Error(
      `colors-data.json has ${c.length} records, expected ${ctx.config.colors.count}`,
    );
  }
  if (
    c[0].id !== ctx.config.colors.firstId ||
    c[c.length - 1].id !== ctx.config.colors.lastId
  ) {
    throw new Error(
      `color id range is ${c[0].id}..${c[c.length - 1].id}, expected ` +
        `${ctx.config.colors.firstId}..${ctx.config.colors.lastId}`,
    );
  }

  ctx.model.warnings.forEach((w) => ctx.warn(w));

  const indexed = p.filter((x) => x.meta).length;
  const colorCategories = new Set(c.map((x) => x.category)).size;
  return (
    `${ctx.model.guides.length} guides ` +
    `(${ctx.model.guidePages.length} pages from content/guide/), ` +
    `${p.length} palettes (${indexed} indexed), ` +
    `${c.length} colors (${colorCategories} categories), ` +
    `${ctx.model.categories.length} categories, ${ctx.routes.length} routes`
  );
}

function copy(ctx) {
  const { root, stage, dist } = ctx.config.paths;

  // PHASE 4 STEP 3E: routed pages are the only thing staged now. The table of
  // staged build inputs is gone with the last module that resolved an input
  // from the staging root, as is — since Step 3D, with RENDER_ORDER — the loop
  // that staged the builder SCRIPTS themselves. Every builder is a module
  // in this directory and takes its inputs from ctx or from the repo root.

  // Stage every page the builders patch in place. Pages they write from
  // scratch are staged too; they get overwritten, which is harmless and
  // keeps the staging rule "every route has a file" simple.
  //
  // FONTS: routes marked `generated` have no committed file to stage — their
  // builder writes them into the staging root from data (see
  // src/build/routes.js). Every other route still must exist on disk.
  let generated = 0;
  for (const r of ctx.routes) {
    if (r.generated) {
      generated += 1;
      continue;
    }
    copyFile(path.join(root, r.file), path.join(stage, r.file));
  }

  let published = 0;
  for (const entry of PUBLISH_FILES) {
    copyFile(path.join(root, entry.from), path.join(dist, entry.to));
    published += 1;
  }
  for (const entry of PUBLISH_DIRS) {
    published += copyDir(
      path.join(root, entry.from),
      path.join(dist, entry.to),
    );
  }

  const bundled = bundleApp(root, dist, APP_BUNDLE);
  published += 1;

  return (
    `staged ${ctx.routes.length - generated} routed pages ` +
    `(${generated} generated by their builder), ` +
    `published ${published} static files (app.js assembled from ${bundled})`
  );
}

function data(ctx) {
  const { records, warnings } = content.buildContentIndex(
    ctx.model,
    ctx.config,
  );
  warnings.forEach((w) => ctx.warn(w));

  const counts = { guides: 0, palettes: 0 };
  records.forEach((r) => {
    if (r.type === "guide") counts.guides += 1;
    else if (r.type === "palette") counts.palettes += 1;
  });

  const want = ctx.config.contentIndex.expected;
  const mismatch = Object.keys(want).some((k) =>
    k === "total" ? records.length !== want.total : counts[k] !== want[k],
  );
  if (mismatch) {
    const lines = [
      "content-index contract violated (F9).",
      "",
      `  expected  ${want.total} records — ${want.guides} guides, ${want.palettes} palettes`,
      `  got       ${records.length} records — ${counts.guides} guides, ${counts.palettes} palettes`,
    ];

    if (counts.palettes !== want.palettes) {
      lines.push(
        "",
        "  Every palette is indexed so /search covers all of them. The",
        "  selection lives in site.config.js:",
        "",
        "      indexedPalettes: (palettes) => palettes.slice()",
        "",
        `  palettes-data.json holds ${ctx.model.palettes.length} palettes; contentIndex.expected`,
        "  must say the same number.",
      );
    }

    throw new Error(lines.join("\n"));
  }

  const out = ctx.config.contentIndex.output;
  // PHASE 4 STEP 3E: the staged copy is gone. It existed for the builder that
  // read the index from the staging root during `render`; since Step 3D both
  // home and categories take it from ctx.contentIndex below, and nothing else
  // ever read the file. The published copy is the only one written.
  writeJson(path.join(ctx.config.paths.dist, out), records);

  ctx.contentIndex = records;
  return `${records.length} records (${counts.guides} guides, ${counts.palettes} palettes)`;
}

/**
 * The page builders, in the only order that produces correct output:
 *
 *     home → categories → guides → fonts → icons → header → footer
 *
 * PHASE 4 STEP 3D: all of them are in-process now. This used to open with a
 * loop that spawned legacy builders from the staging root with execFileSync and
 * scanned each child's stdout for lines beginning with ⚠. Both are gone. A
 * builder that fails now throws straight out of this function, with a real
 * stack trace instead of an exit code and a captured stderr blob, and every
 * builder reports its warnings by returning them.
 */
function render(ctx) {
  const { stage, dist } = ctx.config.paths;

  // PHASE 4 STEP 3D: the home surface, in-process and still first. It
  // occupies the slot build-home.js held as the first entry of RENDER_ORDER:
  // it needs the content index the `data` stage just wrote, and it patches
  // index.html, guides/index.html and roadmap.html only — no other builder
  // touches those three, and it touches nothing they own.
  //
  // Its three progress lines went to the child's stdout, which the old ⚠ scan
  // discarded, and its one warning to stderr, which was never scanned at all.
  // All of it is returned now; the warning is dormant against current data.
  const homeResult = home.render(ctx);
  homeResult.guides.skippedCategories.forEach((slug) =>
    ctx.warn(
      `home: no guides in category "${slug}" — left out of ` +
        `${home.GUIDES_PAGE.split(path.sep).join("/")}, and ` +
        `src/build/categories.js builds no page for it`,
    ),
  );

  // PHASE 4 STEP 3C: the category pages, in-process and still second. It
  // occupies the same slot build-categories.js held in RENDER_ORDER — after
  // home, and before the header, which has to put the aria-current state back
  // into the pages this writes from the raw partial.
  //
  // Its two warnings used to go to console.warn, i.e. the child process's
  // stderr, which the old ⚠ scan never read — it read stdout. They are
  // reported here instead. Neither fires against the current data.
  const categoriesResult = categories.render(ctx);
  categoriesResult.unknown.forEach((entry) =>
    ctx.warn(
      `categories: guides.json has unknown category "${entry.category}" ` +
        `(guide "${entry.id}") — the guide appears in no category grid`,
    ),
  );
  categoriesResult.skipped.forEach((slug) =>
    ctx.warn(
      `categories: "${slug}" has no guides — no page was written for it, so ` +
        `the staged copy of the committed category/${slug}.html is what ` +
        `publishes`,
    ),
  );

  // PHASE 4 STEP 4: the guide pages. The first builder ADDED to this sequence
  // rather than migrated into it — until this step the 22 guide/*.html pages
  // were hand-authored and `render` published whatever `copy` had staged.
  // src/build/guides.js writes them from content/guide/ through
  // src/build/guide-template.js.
  //
  // It runs in the writers' half of the order, for the reason categories
  // does: it embeds the raw partials, so the header has to follow it to put
  // aria-current back, and the footer after that. It owns guide/*.html alone
  // — no other builder writes those files and it writes nothing else — so it
  // has no ordering relationship with home or categories at all.
  const guidesResult = guides.render(ctx);

  // FONTS: /fonts/ and every /fonts/<id>.html, written from src/data/fonts.json,
  // plus each family's download ZIP written straight to dist/. A writer like
  // categories and guides — it embeds the raw partials — so it sits in the
  // writers' half of the order, before the header puts aria-current back and
  // the footer runs last. It owns fonts/ alone and has no ordering
  // relationship with the other writers.
  const fontsResult = fonts.render(ctx);

  // ICON PACKS: /icons/ and every /icons/<pack>.html, plus each pack's ZIPs
  // written straight to dist/. A writer exactly like fonts — it embeds the raw
  // partials — so it sits beside it in the writers' half of the order, before
  // the header and footer. It owns icons/ alone.
  const iconsResult = icons.render(ctx);

  // PHASE 4 STEP 3B: the header, in-process and still third. It occupies the
  // same slot build-header.js held in RENDER_ORDER — after the page writers,
  // whose category and guide pages carry the raw partial and so need their
  // aria-current state put back — and before the footer.
  const headerResult = header.render(ctx);
  headerResult.stale.forEach((file) =>
    ctx.warn(
      `header: ${file} carries an out-of-date ${header.NAV_START_MARKER} / ` +
        `${header.NAV_END_MARKER} region. The build rendered the current one; ` +
        `re-sync the committed partial so src/build/categories.js embeds it ` +
        `too.`,
    ),
  );
  headerResult.skipped.forEach((file) =>
    ctx.warn(
      `header: ${file} is missing ${header.START_MARKER} / ${header.END_MARKER} ` +
        `markers and was left untouched`,
    ),
  );

  // PHASE 4 STEP 3A: the footer, in-process and still last. It occupies the
  // same slot build-footer.js held at the end of RENDER_ORDER — after the
  // page writers and after the header — and reports through the same warning
  // channel every other builder now does.
  const footerResult = footer.render(ctx);
  footerResult.skipped.forEach((file) =>
    ctx.warn(
      `footer: ${file} is missing ${footer.START_MARKER} / ${footer.END_MARKER} ` +
        `markers and was left untouched`,
    ),
  );

  // Publish exactly the pages the route table declares. A route whose file
  // the builders did not produce fails here rather than going missing.
  for (const r of ctx.routes) {
    const from = path.join(stage, r.file);
    if (!fs.existsSync(from)) {
      throw new Error(`route ${r.url} has no built file at ${r.file}`);
    }
    copyFile(from, path.join(dist, r.file));
  }

  const tally = (name, result) =>
    `${name}: ${result.updated} updated, ${result.unchanged} already current` +
    `${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`;

  // Home and categories are writers, not patchers: neither has an "already
  // current" state to report, so they count what they produced.
  const homeTally =
    `home: ${homeResult.index.tools} tool + ${homeResult.index.resources} resource cards, ` +
    `${homeResult.guides.guides} guides, ` +
    `${homeResult.roadmap.guides} roadmap steps`;
  const categoriesTally =
    `categories: ${categoriesResult.written.length} written` +
    `${categoriesResult.skipped.length ? `, ${categoriesResult.skipped.length} skipped` : ""}`;
  const guidesTally = `guides: ${guidesResult.written.length} written`;
  const fontsTally =
    `fonts: ${fontsResult.written.length} written, ` +
    `${fontsResult.packages} ZIP packages (${(fontsResult.packageBytes / 1048576).toFixed(1)} MB)`;
  const iconsTally =
    `icons: ${iconsResult.written.length} written, ` +
    `${iconsResult.packages} ZIP packages (${Math.round(iconsResult.packageBytes / 1024)} KB)`;

  return (
    `7 in-process builders in locked order, ` +
    `${ctx.routes.length} pages published ` +
    `(${homeTally}; ${categoriesTally}; ${guidesTally}; ${fontsTally}; ${iconsTally}; ` +
    `${tally("header", headerResult)}; ${tally("footer", footerResult)})`
  );
}

function sitemap(ctx) {
  const { root, dist } = ctx.config.paths;
  const source = path.join(root, "public", "sitemap.xml");
  const xml = fs.readFileSync(source, "utf8");

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length !== ctx.config.expected.sitemapUrls) {
    throw new Error(
      `sitemap.xml has ${locs.length} URLs, expected ${ctx.config.expected.sitemapUrls}`,
    );
  }

  const known = new Set(
    ctx.routes.map((r) => routes.canonicalFor(ctx.config, r.url)),
  );
  const unknown = locs.filter((loc) => !known.has(loc));
  if (unknown.length) {
    throw new Error(
      `sitemap.xml lists ${unknown.length} URL(s) with no matching route:\n  ` +
        unknown.join("\n  "),
    );
  }

  const duplicates = locs.filter((loc, i) => locs.indexOf(loc) !== i);
  if (duplicates.length) {
    throw new Error(`sitemap.xml has duplicate URLs: ${duplicates.join(", ")}`);
  }

  // PHASE 2: emitted verbatim. lastmod/changefreq/priority are hand-authored
  // per URL and have no source in the content model yet, so generating the
  // file would invent values and change deployed bytes. Validation now,
  // generation once Phase 3 gives each page a meta.json to carry them.
  fs.writeFileSync(path.join(dist, "sitemap.xml"), xml, "utf8");

  const omitted = ctx.routes.length - locs.length;
  return `${locs.length} URLs validated against the route table (${omitted} routes intentionally omitted)`;
}

/**
 * The output gate (Phase 3). Hashes every file in dist/ and compares the
 * set against the approved manifest. Any file added, removed or changed
 * fails the build, and — like every other stage failure — removes dist/,
 * so an unapproved change can never leave a deployable tree behind.
 *
 * This is stricter than the gate in scripts/qa/check-baseline.js, which
 * covers HTML, content-index.json and palettes-data.json but not the CSS,
 * JS, JSON endpoints, assets or deploy config. It is also on the build
 * path itself rather than in the separate `npm run qa` step, so the build
 * cannot succeed without it.
 *
 * PHASE 4 STEP 2D: this reads paths.approvedOutput again. Step 1 pointed it
 * at a separate candidate manifest so token removal could be measured
 * without rewriting the manifest it was being judged against; that candidate
 * was reviewed, approved and promoted in Step 2D, so there is one manifest
 * again. The pre-removal manifest is kept as approved-output-phase3.json and
 * is neither read nor written by this build.
 *
 * This stage is the site's most complete gate, and Step 2C proved why it
 * matters: /_htaccess and /resource-types.json were published but named by
 * no bucket in scripts/qa/snapshot.js, so check-urls.js could not see them
 * leave. This stage could — it hashes every file in dist/, named or not.
 * (Step 2D also taught snapshot.js to refuse an unclassified file, so the
 * two gates now agree.)
 *
 * An intended change is approved explicitly:
 *
 *     BPOZZ_APPROVE_OUTPUT=1 npm run build
 *
 * which rewrites the manifest instead of checking it. The manifest's diff is
 * then the reviewable record of exactly which output files a change moved.
 */
function verify(ctx) {
  const { dist } = ctx.config.paths;
  const approvedOutput = ctx.config.paths.approvedOutput;

  const walk = (dir, acc) => {
    fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .forEach((entry) => {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs, acc);
        else acc.push(path.relative(dist, abs).split(path.sep).join("/"));
      });
    return acc;
  };

  const files = {};
  walk(dist, []).forEach((rel) => {
    files[rel] = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(dist, rel)))
      .digest("hex");
  });
  const count = Object.keys(files).length;

  if (process.env.BPOZZ_APPROVE_OUTPUT === "1") {
    writeJson(approvedOutput, {
      generatedBy: "src/build/build.js (verify stage, BPOZZ_APPROVE_OUTPUT=1)",
      algorithm: "sha256",
      phase: "phase4-step10",
      status:
        "RECORDED by an explicit approval run — the diff is the review, not this field",
      count,
      files,
    });
    ctx.warn(
      `output manifest REWRITTEN (${count} files) — review its diff before ` +
        `committing. Recording is not reviewing.`,
    );
    return `${count} files recorded — ${path.relative(ctx.config.paths.root, approvedOutput)} rewritten`;
  }

  if (!fs.existsSync(approvedOutput)) {
    throw new Error(
      `no approved output manifest at ${path.relative(ctx.config.paths.root, approvedOutput)}.\n` +
        "Run `BPOZZ_APPROVE_OUTPUT=1 npm run build` once to record the current output.",
    );
  }

  const approved = JSON.parse(fs.readFileSync(approvedOutput, "utf8")).files;
  const added = Object.keys(files).filter((f) => !(f in approved));
  const removed = Object.keys(approved).filter((f) => !(f in files));
  const changed = Object.keys(files).filter(
    (f) => f in approved && approved[f] !== files[f],
  );

  if (added.length || removed.length || changed.length) {
    const lines = ["dist/ differs from the approved output.", ""];
    changed.forEach((f) => lines.push(`  changed  ${f}`));
    added.forEach((f) => lines.push(`  added    ${f}`));
    removed.forEach((f) => lines.push(`  removed  ${f}`));
    lines.push(
      "",
      `  ${changed.length} changed, ${added.length} added, ${removed.length} removed.`,
      "  If this change is intended, approve it with:",
      "",
      "      BPOZZ_APPROVE_OUTPUT=1 npm run build",
    );
    throw new Error(lines.join("\n"));
  }

  return `${count} files byte-identical to the approved output`;
}

const PIPELINE = [clean, load, copy, data, render, sitemap, verify];

// ---------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------

/**
 * A failed stage leaves dist/ half-written, and a half-written dist/ that
 * looks deployable is worse than no dist/ at all. Every failure path
 * removes it before exiting.
 *
 * PHASE 4 STEP 3F-W1 — QUEUED WARNINGS ARE FLUSHED HERE
 *
 * `main` collects ctx.warn messages and prints them after the pipeline
 * finishes, which a failing stage never reaches: this function exits the
 * process. Warnings raised by an earlier stage were therefore computed,
 * stored and thrown away — the Step 3F audit reproduced it by removing one
 * page's FOOTER_START marker, which queued a footer warning that `verify`'s
 * failure then discarded, leaving "about.html changed" with no explanation.
 *
 * They are printed below instead, before the failure message, so the
 * operator sees the same warnings a successful build would have shown. This
 * is a delivery fix only: no warning is added, removed, reworded or
 * reordered, dist/ is untouched, and a failure with no queued warnings
 * prints exactly what it printed before.
 */
function abort(stageName, err, warnings) {
  rmrf(config.paths.dist);

  console.error("");
  if (warnings && warnings.length) {
    console.error(`  ${warnings.length} warning(s) raised before the failure:`);
    warnings.forEach((w) => console.error(`    ⚠ ${w}`));
    console.error("");
  }
  console.error(`✗ build failed in stage '${stageName}'`);
  console.error("");
  String(err && err.message ? err.message : err)
    .split("\n")
    .forEach((line) => console.error(`  ${line}`));
  console.error("");
  console.error("  dist/ removed — nothing was published.");
  if (process.env.BPOZZ_TRACE && err && err.stack) {
    console.error("");
    console.error(err.stack);
  } else {
    console.error("  Re-run with BPOZZ_TRACE=1 for the full stack trace.");
  }
  process.exit(1);
}

function main() {
  const warnings = [];
  const ctx = {
    config,
    warn: (message) => warnings.push(message),
  };

  console.log("bpozz build");
  console.log("");

  for (const stage of PIPELINE) {
    let summary;
    try {
      summary = stage(ctx);
    } catch (err) {
      abort(stage.name, err, warnings);
    }
    console.log(`  ${stage.name.padEnd(8)} ${summary}`);
  }

  console.log("");
  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log(`    ⚠ ${w}`));
    console.log("");
  }
  console.log(
    `✓ dist/ built — ${ctx.routes.length} pages, ${ctx.contentIndex.length} index records`,
  );
}

if (require.main === module) main();

module.exports = {
  PIPELINE,
  PUBLISH_FILES,
  PUBLISH_DIRS,
  APP_BUNDLE,
};
