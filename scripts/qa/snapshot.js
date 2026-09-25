/**
 * snapshot.js — records the URL + checksum surface the migration is measured against.
 *
 * Writes two files:
 *
 *   url-snapshot.json    every public URL the deployed site exposes, plus the
 *                        <link rel="canonical"> each page declares.
 *   html-checksums.json  md5 of every HTML file, so later phases can prove
 *                        rendered output did not change.
 *
 *     npm run snapshot          # snapshot dist/ into .qa/
 *
 * PHASE 2 CHANGES — exactly three, and no change to what is measured:
 *
 *   1. Moved from tools/ to src/tools/, as the Phase 1 header said it would.
 *   2. Subject is now dist/ rather than the repo root. dist/ is the site as
 *      of Phase 2; the repo root is the site plus its build machinery.
 *   3. Output goes to .qa/, not next to this script. The frozen baselines
 *      under scripts/qa/ are evidence and nothing may overwrite them.
 *
 * The walk, the URL rules, the sorting and the record shape are untouched, so
 * a snapshot of dist/ is directly comparable to a recorded baseline — and is
 * required by the gate to be byte-identical to it.
 *
 * PHASE 4 — TOKEN REMOVAL
 * /tokens.json left DATA_ENDPOINTS and "tokens" left the extensionless-URL
 * rule, both with the feature. Nothing else about what is measured changed,
 * so the Phase 3 baseline and a current snapshot remain directly diffable —
 * which is how the 142 -> 89 URL delta was reviewed.
 *
 * PHASE 4 STEP 10 — COLOR LIBRARY
 * /colors/colors-data.json JOINED DATA_ENDPOINTS, and it is the only change
 * to this file. The other three URLs the feature adds need no edit here and
 * that is the point of Step 2D's buckets: /colors is a page (it is in dist/
 * as colors/index.html, so `pages` observes it), and /colors/colors.css and
 * /colors/colors.js are code (the `code` bucket is a .js/.css filter, not a
 * list). Only the data endpoint is enumerated, because DATA_ENDPOINTS is the
 * one bucket that is still a literal — by design, since "JSON the running
 * site fetches" cannot be derived from a file extension.
 *
 * PHASE 4 STEP 2D — every published file must be classified
 *
 * DATA_ENDPOINTS and SITE_FILES were hard-coded literals that were copied
 * into the snapshot without ever being checked against dist/. Two holes
 * followed from that, and Step 2C walked straight into the second one:
 *
 *   1. A LISTED endpoint that stopped being published still appeared in
 *      the snapshot. If /guides.json had vanished from dist/, this tool
 *      would have recorded it as present and check-urls.js would have
 *      passed.
 *   2. An UNLISTED file that was published was invisible. /_htaccess and
 *      /resource-types.json were served for the whole of Phases 2-4 and
 *      appear in no baseline. When Step 2C withdrew them, check-urls.js
 *      reported "89 URLs, nothing moved" and passed — only the build's own
 *      verify stage noticed.
 *
 * Both are closed below:
 *
 *   - every path in DATA_ENDPOINTS and SITE_FILES must exist in dist/, or
 *     this tool fails;
 *   - every file in dist/ must fall into exactly one bucket, or this tool
 *     fails and names the strays.
 *
 * The buckets and the recorded shape are otherwise unchanged, so a current
 * snapshot stays directly diffable against the frozen baseline. PLATFORM_FILES
 * is the one addition: deploy-time config the host consumes and never serves,
 * which is a real category rather than an exception (see below).
 *
 * Deterministic: every list is sorted, so two runs on the same tree produce
 * byte-identical output and `diff` is meaningful.
 *
 * NOT a build script. It only reads.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..", "..");
const ROOT = process.env.SNAPSHOT_ROOT
  ? path.resolve(process.env.SNAPSHOT_ROOT)
  : path.join(REPO, "dist");
const OUT_DIR = process.env.SNAPSHOT_OUT
  ? path.resolve(process.env.SNAPSHOT_OUT)
  : path.join(REPO, ".qa");

if (!fs.existsSync(ROOT)) {
  console.error(`✗ nothing to snapshot at ${ROOT} — run 'npm run build' first.`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// Directories that are repo-only and never served as part of the site.
// dist/ contains none of them; the list is kept so the tool still behaves
// correctly when pointed at the repo root via SNAPSHOT_ROOT.
// "content" joined the list in Phase 4 Step 4: content/guide/*.html are the
// guide pages' content slots, a build input, and the pages rendered from them
// are published from guide/ as they always were.
const SKIP_DIRS = new Set([
  "content",
  "docs",
  "tools",
  "src",
  "scripts",
  "partials",
  "node_modules",
  ".git",
]);

// Data endpoints the running site fetches. Verified by grepping every fetch(),
// XMLHttpRequest, dynamic import and preload in the client JS and HTML.
// Each one is asserted to exist in dist/ — see assertDeclaredExist().
const DATA_ENDPOINTS = [
  "/categories.json",
  "/colors/colors-data.json",
  "/content-index.json",
  "/guides.json",
  "/palettes/palettes-data.json",
];

const SITE_FILES = ["/ads.txt", "/og-image.png", "/robots.txt", "/sitemap.xml"];

/**
 * Deploy-time configuration: published into dist/ for the host to read, and
 * never served as a URL. Netlify consumes _headers and _redirects at deploy
 * and does not expose them.
 *
 * This is deliberately NOT a "files we ignore" escape hatch. It is a named
 * category with a rule: a file belongs here only if the host consumes it and
 * no request can retrieve it. /_htaccess looked like it belonged here and did
 * not — Netlify has no idea what that filename means, so it was served as an
 * ordinary static file for three phases (Phase 4 Step 2C withdrew it). If a
 * file's status is unclear, it is served; put it in SITE_FILES.
 */
const PLATFORM_FILES = ["/_headers", "/_redirects"];

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(rel.split("/")[0])) continue;
      walk(abs, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

/**
 * The URL a file is served at. Mirrors how the site is actually linked:
 * /guide/ and /category/ pages are linked extensionless (and
 * .htaccess 301s the .html form); root-level pages keep their .html.
 */
function urlFor(rel) {
  if (rel === "index.html") return "/";
  // Mirrors EXTENSIONLESS_ROOT_PAGES in src/build/routes.js.
  if (rel === "hoysomrach.html") return "/hoysomrach";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"/index.html".length);
  if (/^(guide|category)\//.test(rel) && rel.endsWith(".html")) {
    return "/" + rel.slice(0, -".html".length);
  }
  return "/" + rel;
}

function md5(abs) {
  return crypto.createHash("md5").update(fs.readFileSync(abs)).digest("hex");
}

function die(lines) {
  console.error("");
  console.error("✗ snapshot refused to record an unverified surface");
  console.error("");
  lines.forEach((line) => console.error(`  ${line}`));
  console.error("");
  process.exit(1);
}

/**
 * Hole 1: a declared endpoint that is no longer published.
 *
 * DATA_ENDPOINTS and SITE_FILES used to be copied into the snapshot
 * verbatim. Recording a URL without looking for it means the snapshot
 * asserts the endpoint rather than observing it, and the gate that reads it
 * inherits that assertion.
 */
function assertDeclaredExist(published) {
  const missing = [];
  [
    ["DATA_ENDPOINTS", DATA_ENDPOINTS],
    ["SITE_FILES", SITE_FILES],
    ["PLATFORM_FILES", PLATFORM_FILES],
  ].forEach(([label, list]) => {
    list.forEach((url) => {
      if (!published.has(url)) missing.push(`${url}   (declared in ${label})`);
    });
  });

  if (missing.length) {
    die([
      `${missing.length} declared file(s) are not in ${path.relative(REPO, ROOT)}:`,
      "",
      ...missing.map((m) => `  ${m}`),
      "",
      "A declared path that is not published is either a build regression or a",
      "list this tool never updated. Fix the build, or update the list in",
      "scripts/qa/snapshot.js — do not record a surface that does not exist.",
    ]);
  }
}

/**
 * Hole 2: a published file that no bucket names.
 *
 * This is the one that let /_htaccess and /resource-types.json be served
 * for three phases without appearing in any baseline, and let Step 2C
 * withdraw them while check-urls.js reported "nothing moved".
 */
function assertNoStrays(published, classified) {
  const strays = [...published].filter((url) => !classified.has(url)).sort();
  if (strays.length) {
    die([
      `${strays.length} published file(s) fall into no bucket:`,
      "",
      ...strays.map((s) => `  ${s}`),
      "",
      "Every file in dist/ must be classified, because an unclassified file is",
      "one no URL gate can see. Add each to the bucket that describes it in",
      "scripts/qa/snapshot.js:",
      "",
      "  DATA_ENDPOINTS  JSON the running site fetches",
      "  SITE_FILES      served files that are not pages, assets or code",
      "  PLATFORM_FILES  deploy config the host consumes and never serves",
      "",
      "If it should not be published at all, remove it from PUBLISH_FILES in",
      "src/build/build.js instead.",
    ]);
  }
}

function canonicalOf(abs) {
  const html = fs.readFileSync(abs, "utf8");
  const m = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return m ? m[1] : null;
}

function main() {
  const files = walk(ROOT, []).sort();

  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  const pages = [];
  const checksums = {};

  for (const rel of htmlFiles) {
    const abs = path.join(ROOT, rel);
    checksums[rel] = md5(abs);
    pages.push({ file: rel, url: urlFor(rel), canonical: canonicalOf(abs) });
  }
  pages.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

  const siteFileSet = new Set(SITE_FILES);
  // FONTS: the font library's binaries, download packages and per-family
  // license files are static assets too. The .txt rule is scoped to
  // fonts/<id>/ so a stray text file anywhere else still fails as unclassified
  // instead of being swept in here.
  //
  // ICON PACKS: the icon SVGs and PNGs are already images by extension; the
  // one new file type is each pack's generated download ZIP, scoped to
  // icons/<pack>/ the same way the font rule is scoped to fonts/<id>/.
  const assets = files
    .filter(
      (f) =>
        /\.(png|jpe?g|webp|svg|ico)$/i.test(f) ||
        /^fonts\/[a-z0-9-]+\/[^/]+\.(woff2|ttf|otf|zip|txt)$/.test(f) ||
        /^icons\/[a-z0-9-]+\/[^/]+\.zip$/.test(f),
    )
    .map((f) => "/" + f)
    .filter((u) => !siteFileSet.has(u)) // og-image.png is listed under siteFiles
    .sort();

  const code = files
    .filter((f) => /\.(js|css)$/i.test(f))
    .filter((f) => !f.startsWith("build-") && !f.endsWith(".test.js"))
    .map((f) => "/" + f)
    .sort();

  // PHASE 4 STEP 2D — observe the surface instead of asserting it.
  // Every published file, and every URL some bucket claims. The two
  // assertions below have to agree before anything is recorded.
  const published = new Set(files.map((f) => "/" + f));
  const classified = new Set([
    ...pages.map((p) => "/" + p.file),
    ...DATA_ENDPOINTS,
    ...SITE_FILES,
    ...PLATFORM_FILES,
    ...assets,
    ...code,
  ]);

  assertDeclaredExist(published);
  assertNoStrays(published, classified);

  const snapshot = {
    generatedBy: "scripts/qa/snapshot.js",
    phase: "2",
    counts: {
      pages: pages.length,
      dataEndpoints: DATA_ENDPOINTS.length,
      siteFiles: SITE_FILES.length,
      assets: assets.length,
      code: code.length,
      total: pages.length + DATA_ENDPOINTS.length + SITE_FILES.length + assets.length + code.length,
    },
    pages,
    dataEndpoints: DATA_ENDPOINTS.slice().sort(),
    siteFiles: SITE_FILES.slice().sort(),
    assets,
    code,
    // Recorded for completeness, deliberately outside `counts.total` and
    // outside check-urls.js's LISTS: these are deployed but not served, so
    // they are not part of the site's URL surface.
    platformFiles: PLATFORM_FILES.slice().sort(),
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "url-snapshot.json"),
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf8"
  );

  const sortedChecksums = {};
  for (const k of Object.keys(checksums).sort()) sortedChecksums[k] = checksums[k];
  fs.writeFileSync(
    path.join(OUT_DIR, "html-checksums.json"),
    JSON.stringify({ generatedBy: "scripts/qa/snapshot.js", phase: "2", count: htmlFiles.length, files: sortedChecksums }, null, 2) + "\n",
    "utf8"
  );

  console.log(`✓ ${path.relative(REPO, OUT_DIR)}/url-snapshot.json    — ${snapshot.counts.total} URLs (${pages.length} pages, ${DATA_ENDPOINTS.length} data, ${SITE_FILES.length} site files, ${assets.length} assets, ${code.length} code)`);
  console.log(`✓ ${path.relative(REPO, OUT_DIR)}/html-checksums.json  — ${htmlFiles.length} HTML files`);
}

main();
