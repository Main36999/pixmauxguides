/**
 * removed-pages.test.js — /hoysomrach stays removed; the Image Picker is
 * back.
 *
 *     npm test
 *
 * /hoysomrach was deleted. Its URLs answer 410 with the site's not-found
 * page (public/_redirects). The build's gates catch a page reappearing only
 * once its output differs from the approved manifest; this pins the removal
 * at its sources, so the page cannot come back by accident through a route,
 * a nav entry, a card, a related-resource link, a sitemap entry or a stray
 * link, and so the 410 rules cannot drift into a redirect or a homepage
 * body.
 *
 * The Image Picker was removed with it (598f507) and restored on the
 * owner's decision (2026-10-20): the last test pins that it is routed,
 * published, linked from Resources and the footer, in the sitemap, and no
 * longer answered with a 410.
 *
 * The founder block on /about, which used to link the profile page, is
 * pinned too: removing the page removed a link, not the founder.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const header = require("./header.js");
const footer = require("./footer.js");
const home = require("./home.js");
const build = require("./build.js");

const ROOT = config.paths.root;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const model = content.load(config);
const table = routes.build(model);

const REMOVED = /hoysomrach/i;

/** Every URL the page published, as listed in public/_redirects. */
const RETIRED = ["/hoysomrach", "/hoysomrach.html"];

/** The text between two markers removed, markers kept. */
function withoutRegion(html, start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  return from === -1 || to < from ? html : html.slice(0, from + start.length) + html.slice(to);
}

const hrefsOf = (html) => [...html.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1]);

test("the page is not a route, and its source file is gone", () => {
  const hits = table.filter((r) => REMOVED.test(r.url) || REMOVED.test(r.file));
  assert.deepStrictEqual(hits, [], "a removed page is back in the route table");
  ["hoysomrach.html"].forEach((rel) => assert.ok(!fs.existsSync(path.join(ROOT, rel)), `${rel} exists again`));
});

test("the build publishes none of its files", () => {
  build.PUBLISH_FILES.forEach((f) => {
    assert.ok(!REMOVED.test(f.from) && !REMOVED.test(f.to), `PUBLISH_FILES has ${f.from} -> ${f.to}`);
  });
  build.PUBLISH_DIRS.forEach((d) => {
    assert.ok(!REMOVED.test(d.from) && !REMOVED.test(d.to), `PUBLISH_DIRS has ${d.from}`);
  });
});

test("no nav entry, resource type, tool card, guide resource or explore link points at the page", () => {
  header.MAIN_HEADER_NAV.forEach((e) => assert.ok(!REMOVED.test(e.landingUrl), `header nav: ${e.label}`));
  model.resourceTypes.forEach((t) => {
    assert.ok(!REMOVED.test(t.type) && !REMOVED.test(t.landingUrl || ""), `resource-types.json: ${t.type}`);
  });
  home.HOME_TOOLS.forEach((t) => assert.ok(!REMOVED.test(t.url), `tool card: ${t.title}`));
  Object.entries(model.guideResources).forEach(([id, list]) => {
    list.forEach((r) => assert.ok(!REMOVED.test(r.href), `${id} links ${r.href}`));
  });
});

test("no partial, committed page or sitemap entry links the page", () => {
  ["partials/header.html", "partials/footer.html"].forEach((rel) => {
    const bad = hrefsOf(read(rel)).filter((h) => REMOVED.test(h));
    assert.deepStrictEqual(bad, [], rel);
  });

  // The header and footer regions of a committed page are rewritten from the
  // partials checked above, so what they hold on disk never ships; the rest
  // of the page does.
  const committed = table.filter((r) => !r.generated);
  assert.ok(committed.length > 30, `only ${committed.length} committed pages found`);
  committed.forEach((r) => {
    let html = read(r.file);
    html = withoutRegion(html, header.START_MARKER, header.END_MARKER);
    html = withoutRegion(html, footer.START_MARKER, footer.END_MARKER);
    const bad = hrefsOf(html).filter((h) => REMOVED.test(h));
    assert.deepStrictEqual(bad, [], `${r.file} links a removed page`);
  });

  const locs = [...read("public/sitemap.xml").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(locs.length, config.expected.sitemapUrls);
  assert.deepStrictEqual(locs.filter((l) => REMOVED.test(l)), [], "sitemap.xml lists a removed page");
});

test("every retired URL answers 410 with the not-found page: no redirect, no homepage body", () => {
  const rules = read("public/_redirects")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/));
  // Netlify matches a rule with or without a trailing slash.
  const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

  RETIRED.forEach((url) => {
    const matching = rules.filter((r) => norm(r[0]) === norm(url));
    assert.deepStrictEqual(matching, [[url, "/404.html", "410"]], `${url}: expected exactly one "/404.html 410" rule`);
  });
  const ours = rules.filter((r) => REMOVED.test(r[0]));
  assert.strictEqual(ours.length, RETIRED.length, "a rule for a removed path is not in RETIRED");
  rules.forEach((r) => assert.ok(!REMOVED.test(r[1] || ""), `${r[0]} sends visitors to a removed page`));

  // The body those rules serve: a real, noindex not-found page that resolves
  // its own links from the site root at any depth.
  const notFound = read("404.html");
  assert.match(notFound, /<base href="\/" \/>/);
  assert.match(notFound, /<meta name="robots" content="noindex" \/>/);
});

test("the Image Picker is restored: routed, published, linked, in the sitemap, never a 410", () => {
  const route = table.find((r) => r.file === "image-picker/index.html");
  assert.ok(route && route.url === "/image-picker/", "the /image-picker/ route");
  ["image-picker/index.html", "image-picker/assets/standby.jpg", "src/client/image-picker.js", "src/styles/image-picker.css"].forEach((rel) =>
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is missing`),
  );
  const published = build.PUBLISH_FILES.map((f) => f.to);
  ["image-picker/image-picker.js", "image-picker/image-picker.css", "image-picker/assets/standby.jpg"].forEach((to) =>
    assert.ok(published.includes(to), `${to} is not published`),
  );
  assert.ok(header.MAIN_HEADER_NAV.some((e) => e.landingUrl === "/image-picker/"), "header nav registry");
  const resources = /id="nav-menu-resources"[\s\S]*?<\/div>/.exec(read("partials/header.html"))[0];
  assert.ok(hrefsOf(resources).includes("/image-picker/"), "the Resources panel");
  const phone = /id="mobile-menu-resources"[\s\S]*?<\/div>/.exec(read("partials/header.html"))[0];
  assert.ok(hrefsOf(phone).includes("/image-picker/"), "the phone menu's Resources");
  assert.ok(hrefsOf(read("partials/footer.html")).includes("/image-picker/"), "the footer");
  assert.ok(read("public/sitemap.xml").includes("<loc>https://bpozz.com/image-picker/</loc>"), "sitemap.xml");
  const rules = read("public/_redirects")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  assert.deepStrictEqual(rules.filter((l) => /image-picker/i.test(l)), [], "a _redirects rule still catches the Image Picker");
});

test("the founder stays on About, without the profile-page link", () => {
  const about = read("about.html");
  assert.match(about, /<p class="about-founder__name">Hoy Somrach<\/p>/);
  assert.match(about, /<p class="about-founder__title">Founder &amp; UI\/UX Designer<\/p>/);
  assert.match(about, /src="assets\/founder-somrach-hoy\.jpg"/);
  assert.ok(fs.existsSync(path.join(ROOT, "assets", "founder-somrach-hoy.jpg")), "the founder photo is gone");
});
