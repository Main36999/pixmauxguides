/**
 * scripts/seo/lib/links.test.mts — every link shape the checker must tell
 * apart: valid, broken, redirected, 410 Gone, fragments, hash routes,
 * external, non-HTTP, and attempts to climb out of dist/.
 *
 *     node --test scripts/seo/lib/links.test.mts
 *
 * The inventory is an in-memory Set; nothing touches the disk.
 */

import test from "node:test";
import assert from "node:assert";

import { classifyHref, parseRedirects, pathSegments, LINK_KIND, STATUS } from "./links.mts";
import type { Classification, LinkSite } from "../types.mts";

const REDIRECTS = `
# comment line
/guide/g6.html   /guide/whitespace-as-ui-component   301
/favicon.ico    /assets/favicon.png    200
/tokens         /   410
/forced         /about   301!
/about          /   410
/missing-target /nowhere.png 200
`;

const site: LinkSite = {
  origin: "https://bpozz.com",
  hosts: ["bpozz.com", "www.bpozz.com"],
  inventory: new Set([
    "index.html",
    "about.html",
    "guides/index.html",
    "guide/whitespace-as-ui-component.html",
    "guide/type-scale-systems.html",
    "fonts/lato.html",
    "styles.css",
    "assets/favicon.png",
    "assets/logo.svg",
  ]),
  redirects: parseRedirects(REDIRECTS),
};

const at = (href: string, page = "/guide/type-scale-systems"): Classification => classifyHref(href, page, site);

test("_redirects: exact rules parsed, comments skipped, forced flag kept", () => {
  const { rules, unsupported } = site.redirects;
  assert.deepStrictEqual(unsupported, []);
  assert.strictEqual(rules.get("/guide/g6.html")?.status, 301);
  assert.strictEqual(rules.get("/forced")?.force, true);
  assert.strictEqual(rules.size, 6);
});

test("_redirects: placeholders, splats and query rules are reported unsupported", () => {
  const { unsupported } = parseRedirects("/blog/:slug /b/:slug 301\n/old/* /new 301\n/q?x=1 / 301\nonlyone\n");
  assert.strictEqual(unsupported.length, 4);
});

test("valid: root-relative, pretty, .html, directory index, asset, absolute same-site", () => {
  for (const href of ["/", "/about", "/about.html", "/guides/", "/fonts/lato", "/styles.css", "https://bpozz.com/fonts/lato", "https://www.bpozz.com/"]) {
    const c = at(href);
    assert.strictEqual(c.kind, LINK_KIND.internal, href);
    assert.strictEqual(c.status, STATUS.ok, href);
  }
});

test("valid: relative links resolve against the page's own URL", () => {
  assert.strictEqual(at("whitespace-as-ui-component").file, "guide/whitespace-as-ui-component.html");
  assert.strictEqual(at("./whitespace-as-ui-component").file, "guide/whitespace-as-ui-component.html");
  assert.strictEqual(at("../about").file, "about.html");
  assert.strictEqual(at("../assets/logo.svg").status, STATUS.ok);
});

test("query strings are ignored; an empty href is the page itself", () => {
  assert.strictEqual(at("/fonts/lato?ref=x").status, STATUS.ok);
  assert.strictEqual(at("").file, "guide/type-scale-systems.html");
});

test("broken: no file, wrong case, trailing slash on a file page", () => {
  assert.strictEqual(at("/guide/nope").status, STATUS.broken);
  assert.strictEqual(at("/About").status, STATUS.broken);
  assert.strictEqual(at("/about/").status, STATUS.broken);
});

test("redirect: a _redirects 3xx rule, and a directory without its slash", () => {
  const rule = at("/guide/g6.html");
  assert.strictEqual(rule.status, STATUS.redirect);
  assert.strictEqual(rule.location, "/guide/whitespace-as-ui-component");
  const slashless = at("/guides");
  assert.strictEqual(slashless.status, STATUS.redirect);
  assert.strictEqual(slashless.location, "/guides/");
});

test("410 Gone, 200 rewrites to an existing and a missing target, forced rules win", () => {
  assert.strictEqual(at("/tokens").status, STATUS.gone);
  const rewrite = at("/favicon.ico");
  assert.strictEqual(rewrite.status, STATUS.rewrite);
  assert.strictEqual(rewrite.file, "assets/favicon.png");
  assert.strictEqual(at("/missing-target").status, STATUS.broken);
  // about.html exists, so the unforced 410 rule for /about never applies…
  assert.strictEqual(at("/about").status, STATUS.ok);
  // …but a forced rule applies even though nothing is in the way.
  assert.strictEqual(at("/forced").status, STATUS.redirect);
});

test("fragments: decoded and returned for the caller to check; '#/route' is a hash route", () => {
  assert.strictEqual(at("#scale-ratios").fragment, "scale-ratios");
  assert.strictEqual(at("#scale-ratios").file, "guide/type-scale-systems.html");
  assert.strictEqual(at("/about#team%20page").fragment, "team page");
  assert.strictEqual(at("#/privacy").kind, LINK_KIND.hashRoute);
  assert.strictEqual(at("/#/privacy").kind, LINK_KIND.hashRoute);
  assert.strictEqual(at("#").fragment, null);
});

test("external and non-HTTP links are never resolved against dist/", () => {
  assert.strictEqual(at("https://fonts.google.com/").kind, LINK_KIND.external);
  assert.strictEqual(at("//cdn.example.com/x.js").kind, LINK_KIND.external);
  assert.strictEqual(at("http://evil.example/bpozz.com").kind, LINK_KIND.external);
  for (const href of ["mailto:a@b.c", "tel:+100", "javascript:void(0)", "data:text/plain,x", "ftp://x"]) {
    assert.strictEqual(at(href).kind, LINK_KIND.nonHttp, href);
  }
});

test("traversal: every shape that would climb out of dist/ stays inside or is invalid", () => {
  // URL resolution clamps literal and encoded dot segments at the site root…
  assert.strictEqual(at("/../../../../etc/passwd").file, undefined);
  assert.strictEqual(at("/../../../../etc/passwd").status, STATUS.broken);
  assert.strictEqual(at("../../../../../about").file, "about.html");
  assert.strictEqual(at("/%2e%2e/%2e%2e/about").file, "about.html");
  assert.strictEqual(at("\\..\\..\\about").file, "about.html");
  // …and a percent-encoded separator, NUL or bad escape is refused outright.
  assert.strictEqual(at("/..%2f..%2fetc%2fpasswd").status, STATUS.invalid);
  assert.strictEqual(at("/guide/%5c..%5cabout").status, STATUS.invalid);
  assert.strictEqual(at("/a%00b").status, STATUS.invalid);
  assert.strictEqual(at("/bad%zzescape").status, STATUS.invalid);
  assert.strictEqual(at("/guide//type-scale-systems").status, STATUS.invalid);
});

test("pathSegments refuses dot, dot-dot and separator segments after decoding", () => {
  assert.deepStrictEqual(pathSegments("/guide/x"), ["guide", "x"]);
  assert.deepStrictEqual(pathSegments("/guides/"), ["guides", ""]);
  assert.strictEqual(pathSegments("/a/%2E%2E/b"), null);
  assert.strictEqual(pathSegments("/a/%2f/b"), null);
});

// ---- 410 prefix splats (dist/_redirects "/icons/*  /  410") ----------------

const splatSite = (redirects: string, files = ["index.html", "about.html"]): LinkSite => ({
  origin: site.origin,
  hosts: site.hosts,
  inventory: new Set(files),
  redirects: parseRedirects(redirects),
});

test("_redirects: only a literal-prefix splat answering 410 is supported; every other splat stays unsupported", () => {
  const { rules, prefixes, unsupported } = parseRedirects(
    [
      "/icons/*  /  410",
      "/a/b/*  /  410!",
      "/old/*  /new  301",
      "/r/*  /x  200",
      "/m/*/x  /  410",
      "/*  /  410",
      "/s/*  /:splat  410",
      "/d//*  /  410",
      "/e/*  /  410  extra",
      "/p/:x/*  /  410",
      "/q/*  /  gone",
    ].join("\n"),
  );
  assert.strictEqual(rules.size, 0);
  assert.deepStrictEqual(prefixes.map((p) => [p.prefix, p.status, p.force, p.line]), [["/icons/", 410, false, 1], ["/a/b/", 410, true, 2]]);
  assert.deepStrictEqual(unsupported.map((u) => u.line), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("a 410 splat answers Gone below its prefix, never for the bare prefix or a lookalike path", () => {
  const s = splatSite("/icons/*  /  410\n", ["index.html", "about.html", "icons-guide.html"]);
  const gone = classifyHref("/icons/solid-essentials/svg/a.svg", "/about", s);
  assert.strictEqual(gone.status, STATUS.gone);
  assert.strictEqual(gone.rule, 1);
  assert.strictEqual(classifyHref("/icons/", "/about", s).status, STATUS.gone);
  assert.strictEqual(classifyHref("https://bpozz.com/icons/x.png", "/about", s).status, STATUS.gone);
  assert.strictEqual(classifyHref("/icons", "/about", s).status, STATUS.broken);
  assert.strictEqual(classifyHref("/icons-guide", "/about", s).file, "icons-guide.html");
});

test("exact and splat rules: the first matching rule in the file wins", () => {
  const s = splatSite("/keep/a  /about  301\n/keep/*  /  410\n/keep/b  /about  301\n");
  const a = classifyHref("/keep/a", "/about", s);
  assert.deepStrictEqual([a.status, a.rule], [STATUS.redirect, 1]);
  const b = classifyHref("/keep/b", "/about", s);
  assert.deepStrictEqual([b.status, b.rule], [STATUS.gone, 2]);
  assert.strictEqual(classifyHref("/keep/c", "/about", s).status, STATUS.gone);
});

test("a published file shadows an unforced splat; a forced splat still applies", () => {
  const s = splatSite("/old/*  /  410\n/gone/*  /  410!\n", ["index.html", "about.html", "old/page.html", "gone/page.html"]);
  assert.strictEqual(classifyHref("/old/page", "/about", s).file, "old/page.html");
  assert.strictEqual(classifyHref("/old/missing", "/about", s).status, STATUS.gone);
  const forced = classifyHref("/gone/page", "/about", s);
  assert.deepStrictEqual([forced.status, forced.rule], [STATUS.gone, 2]);
});
