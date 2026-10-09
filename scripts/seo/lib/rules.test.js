/**
 * scripts/seo/lib/rules.test.js — what each rule reports, on which pages,
 * and how exceptions and template grouping change that.
 *
 *     node --test scripts/seo/lib/rules.test.js
 *
 * Pages are built in memory with lib/html.js; nothing touches the disk.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const config = require("../config.js");
const { extract } = require("./html.js");
const { parseRedirects } = require("./links.js");
const rules = require("./rules.js");

const LONG_DESC = "A description that is comfortably inside the advisory range of seventy to one hundred sixty characters.";

function page(file, url, { title = "A Perfectly Reasonable Page Title — bpozz", description = LONG_DESC, robots, body = "<main><h1>A Perfectly Reasonable Page Title</h1></main>" } = {}) {
  const head = [
    title === null ? "" : `<title>${title}</title>`,
    description === null ? "" : `<meta name="description" content="${description}" />`,
    robots ? `<meta name="robots" content="${robots}" />` : "",
  ].join("\n");
  return { file, url, facts: extract(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`) };
}

function site(files, redirects = "") {
  return { origin: config.origin, hosts: config.siteHosts, inventory: new Set(files), redirects: parseRedirects(redirects) };
}

const run = (pages, s = site(pages.map((p) => p.file))) => rules.evaluate(pages, s, config);
const ruleIds = (findings) => findings.map((f) => f.rule).sort();

test("a clean page has no findings", () => {
  assert.deepStrictEqual(run([page("about.html", "/about")]).findings, []);
});

test("missing title and description are errors on indexable pages only", () => {
  const indexable = run([page("about.html", "/about", { title: null, description: null })]);
  assert.deepStrictEqual(ruleIds(indexable.findings), ["description-missing", "title-missing"]);
  assert.ok(indexable.findings.every((f) => f.severity === "error"));

  const noindex = run([page("account.html", "/account", { title: null, description: null, robots: "noindex" })]);
  assert.deepStrictEqual(noindex.findings, []);
});

test("noindex skips indexability rules only: broken links, missing alt and headings are still checked", () => {
  const p = page("404.html", "/404.html", {
    title: "x",
    robots: "noindex, follow",
    body: '<main><h1>Not found</h1><h3>Skipped</h3><a href="/gone">x</a><img src="/a.png"></main>',
  });
  assert.deepStrictEqual(ruleIds(run([p]).findings), ["heading-skip", "img-alt-missing", "link-broken"]);
});

test("robots 'none' is noindex; 'index, follow' is not", () => {
  assert.strictEqual(rules.isIndexable(["none"]), false);
  assert.strictEqual(rules.isIndexable(["index, follow"]), true);
  assert.strictEqual(rules.isIndexable([]), true);
});

test("duplicate titles and descriptions: one grouped warning per shared text, indexable pages only", () => {
  const pages = [
    page("a.html", "/a", { title: "Shared Title For Several Pages Here" }),
    page("b.html", "/b", { title: "Shared Title For Several Pages Here" }),
    page("c.html", "/c", { title: "Shared Title For Several Pages Here", robots: "noindex" }),
  ];
  const dup = run(pages).findings.filter((f) => f.rule === "title-duplicate");
  assert.strictEqual(dup.length, 1);
  assert.strictEqual(dup[0].severity, "warning");
  assert.deepStrictEqual(dup[0].pages.map((p) => p.url), ["/a", "/b"]);
  const descDup = run(pages).findings.filter((f) => f.rule === "description-duplicate");
  assert.deepStrictEqual(descDup[0].pages.map((p) => p.url), ["/a", "/b"]);
});

test("length limits come from config and are warnings", () => {
  const short = run([page("a.html", "/a", { title: "Short", description: "Too short." , body: "<h1>Short</h1>" })]).findings;
  assert.deepStrictEqual(ruleIds(short), ["description-length", "title-length"]);
  assert.ok(short.every((f) => f.severity === "warning"));
  assert.match(short.find((f) => f.rule === "title-length").message, /30–60/);
});

test("h1 count and h1/title mismatch", () => {
  const none = run([page("a.html", "/a", { body: "<h2>Only h2</h2>" })]).findings;
  assert.deepStrictEqual(ruleIds(none), ["h1-count"]);
  const two = run([page("a.html", "/a", { body: "<h1>A Perfectly Reasonable Page Title</h1><h1>Again</h1>" })]).findings;
  assert.deepStrictEqual(ruleIds(two), ["h1-count"]);
  const mismatch = run([page("a.html", "/a", { body: "<h1>Something Else Entirely</h1>" })]).findings;
  assert.deepStrictEqual(ruleIds(mismatch), ["h1-title-mismatch"]);
  // Brand suffix, case and trailing punctuation do not count as a difference.
  const same = run([page("a.html", "/a", { title: "Grid Systems and Rhythm | bpozz", body: "<h1>grid systems and rhythm.</h1>" })]).findings;
  assert.deepStrictEqual(same, []);
});

test("heading skips are reported per jump; going back up is fine", () => {
  const f = run([page("a.html", "/a", { body: "<h1>A Perfectly Reasonable Page Title</h1><h2>a</h2><h4>b</h4><h2>c</h2><h3>d</h3><h6>e</h6>" })]).findings;
  assert.deepStrictEqual(f.map((x) => x.message), ["Heading level skips from h2 to h4.", "Heading level skips from h3 to h6."]);
});

test("guide word count applies to guide pages only", () => {
  const thin = '<main><h1>A Perfectly Reasonable Page Title</h1><p>few words</p></main>';
  assert.deepStrictEqual(ruleIds(run([page("guide/x.html", "/guide/x", { body: thin })]).findings), ["guide-word-count"]);
  assert.deepStrictEqual(run([page("about.html", "/about", { body: thin })]).findings, []);
});

test("links: broken, 410, invalid, redirect and missing fragment each get their own rule", () => {
  const p = page("about.html", "/about", {
    body:
      '<main><h1 id="top">A Perfectly Reasonable Page Title</h1>' +
      '<a href="/nope">a</a><a href="/tokens">b</a><a href="/..%2fx">c</a><a href="/old">d</a>' +
      '<a href="#top">e</a><a href="#missing">f</a><a href="https://example.com">g</a><a href="mailto:x@y.z">h</a><a href="#/privacy">i</a>' +
      '<a href="/to-nowhere">j</a></main>',
  });
  const s = site(["about.html"], "/tokens / 410\n/old /about 301\n/to-nowhere /void 301\n");
  const { findings, linkStats } = run([p], s);
  assert.deepStrictEqual(ruleIds(findings), ["link-broken", "link-broken", "link-fragment-missing", "link-gone", "link-invalid", "link-redirect"]);
  assert.deepStrictEqual(linkStats, {
    internalOk: 2,
    rewrite: 0,
    redirect: 2,
    gone: 1,
    broken: 2,
    invalid: 1,
    fragmentMissing: 1,
    external: 1,
    nonHttp: 1,
    hashRoute: 1,
  });
});

test("exceptions: validated strictly, applied by exact url or page type, unused ones visible", () => {
  assert.deepStrictEqual(rules.validateExceptions([{ rule: "h1-count", url: "/a", reason: "intentional" }]), []);
  assert.strictEqual(rules.validateExceptions({}).length, 1);
  const bad = rules.validateExceptions([
    { rule: "nope", url: "/a", reason: "x" },
    { rule: "h1-count", reason: "" },
    { rule: "h1-count", url: "a", pageType: "guide", reason: "x" },
    { rule: "h1-count", url: "/a", reason: "x", pattern: "*" },
  ]);
  assert.strictEqual(bad.length, 6);

  const findings = run([
    page("a.html", "/a", { body: "" }),
    page("guide/x.html", "/guide/x", {
      title: "Another Perfectly Reasonable Title — bpozz",
      description: `${LONG_DESC} Second.`,
      body: "<main>" + "word ".repeat(900) + "</main>",
    }),
  ]).findings;
  assert.deepStrictEqual(ruleIds(findings), ["h1-count", "h1-count"]);
  const { findings: left, exceptions } = rules.applyExceptions(findings, [
    { rule: "h1-count", url: "/a", reason: "intentional" },
    { rule: "h1-count", pageType: "guide", reason: "intentional" },
    { rule: "title-length", url: "/zzz", reason: "unused" },
  ]);
  assert.deepStrictEqual(left, []);
  assert.deepStrictEqual(exceptions.map((e) => e.excused), [1, 1, 0]);
});

test("duplicate groups are recounted after exceptions, and dropped below two pages", () => {
  const shared = { title: "Shared Title For Several Pages Here" };
  const pages = [page("a.html", "/a", shared), page("b.html", "/b", shared), page("c.html", "/c", shared)];
  const dup = run(pages).findings.filter((f) => f.rule === "title-duplicate");
  assert.strictEqual(dup[0].message, "3 indexable pages share one title.");

  const one = rules.applyExceptions(dup, [{ rule: "title-duplicate", url: "/c", reason: "intentional" }]);
  assert.strictEqual(one.findings.length, 1);
  assert.strictEqual(one.findings[0].message, "2 indexable pages share one title.");
  assert.deepStrictEqual(one.findings[0].pages.map((p) => p.url), ["/a", "/b"]);

  const two = rules.applyExceptions(dup, [
    { rule: "title-duplicate", url: "/b", reason: "intentional" },
    { rule: "title-duplicate", url: "/c", reason: "intentional" },
  ]);
  assert.deepStrictEqual(two.findings, []);
  assert.deepStrictEqual(two.exceptions.map((e) => e.excused), [1, 1]);

  // A page-scoped rule keeps its old behaviour: one page left is still a finding.
  const single = rules.applyExceptions(
    [{ rule: "h1-count", severity: "warning", message: "m", evidence: "", pages: [{ url: "/a", type: "page" }, { url: "/b", type: "page" }] }],
    [{ rule: "h1-count", url: "/a", reason: "x" }],
  );
  assert.deepStrictEqual(single.findings[0].pages.map((p) => p.url), ["/b"]);
});

test("redirects: a chain lands (one hop followed), an external target lands, a hop to 410 is broken", () => {
  const p = page("about.html", "/about", {
    body: '<main><h1>A Perfectly Reasonable Page Title</h1><a href="/one">a</a><a href="/out">b</a><a href="/to-gone">c</a></main>',
  });
  const s = site(["about.html"], "/one /two 301\n/two /about 301\n/out https://example.com/ 301\n/to-gone /tokens 301\n/tokens / 410\n");
  const { findings, linkStats } = run([p], s);
  const byRule = (r) => findings.filter((f) => f.rule === r).map((f) => f.evidence);
  assert.deepStrictEqual(byRule("link-redirect"), ['href="/one"', 'href="/out"']);
  assert.deepStrictEqual(byRule("link-broken"), ['href="/to-gone"']);
  assert.strictEqual(linkStats.redirect, 3);
  assert.strictEqual(linkStats.broken, 1);
});

test("fragments are checked against the TARGET page's ids, not the linking page's", () => {
  const from = page("about.html", "/about", {
    body: '<main><h1 id="only-here">A Perfectly Reasonable Page Title</h1><a href="/contact#form">ok</a><a href="/contact#only-here">missing there</a></main>',
  });
  const to = page("contact.html", "/contact", {
    title: "Another Perfectly Reasonable Title — bpozz",
    description: `${LONG_DESC} Contact.`,
    body: '<main><h1>Another Perfectly Reasonable Title</h1><form id="form"></form></main>',
  });
  const missing = run([from, to], site(["about.html", "contact.html"])).findings.filter((f) => f.rule === "link-fragment-missing");
  assert.deepStrictEqual(missing.map((f) => [f.pages[0].url, f.evidence]), [["/about", 'href="/contact#only-here"']]);
  assert.match(missing[0].message, /No element with id "only-here" on \/contact/);
});

test("multiple robots metas: any noindex makes the page non-indexable", () => {
  const p = page("a.html", "/a", { title: null, description: null, robots: "index, follow" });
  // page() writes one robots meta; add a second, conflicting one.
  const twoMetas = { ...p, facts: { ...p.facts, robots: [...p.facts.robots, "noindex"] } };
  assert.deepStrictEqual(run([twoMetas]).findings, []);
  assert.deepStrictEqual(ruleIds(run([p]).findings), ["description-missing", "title-missing"]);
});

test("template grouping folds identical findings on enough pages, and only those", () => {
  const body = "<main><h1>A Perfectly Reasonable Page Title</h1><h3>Footer</h3></main>";
  const many = Array.from({ length: config.templateGroupMin }, (_, i) => page(`p${i}.html`, `/p${i}`, { body, title: `A Perfectly Reasonable Page Title ${i}` }));
  const grouped = rules.groupTemplates(run(many).findings.filter((f) => f.rule === "heading-skip"), config.templateGroupMin);
  assert.strictEqual(grouped.length, 1);
  assert.strictEqual(grouped[0].scope, "template");
  assert.strictEqual(grouped[0].pages.length, config.templateGroupMin);

  const few = rules.groupTemplates(run(many.slice(0, 2)).findings.filter((f) => f.rule === "heading-skip"), config.templateGroupMin);
  assert.deepStrictEqual(few.map((f) => f.scope), ["page", "page"]);
});

test("page types come from dist/ paths", () => {
  assert.strictEqual(rules.pageType("guide/x.html"), "guide");
  assert.strictEqual(rules.pageType("category/web.html"), "category");
  assert.strictEqual(rules.pageType("fonts/index.html"), "section");
  assert.strictEqual(rules.pageType("fonts/lato.html"), "font");
  assert.strictEqual(rules.pageType("icons/solid-essentials.html"), "icon-pack");
  assert.strictEqual(rules.pageType("palettes/index.html"), "section");
  assert.strictEqual(rules.pageType("about.html"), "page");
});
