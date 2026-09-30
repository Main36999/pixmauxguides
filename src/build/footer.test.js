/**
 * src/build/footer.test.js — the footer's Cookie settings entry and the
 * Privacy Policy disclosures it points at.
 *
 *     node --test src/build/footer.test.js
 *
 * The footer is one partial written into every routed page by
 * src/build/footer.js, so the link is asserted on the partial, on
 * footerFor() at every depth, and on render() run twice over a scratch
 * staging root (a second run must not add a second copy). The click handler
 * is executed in a vm against a stubbed window/document, so the assertion is
 * that it really calls window.Cookiebot.show(), not that the text is there.
 *
 * The privacy checks read the SOURCE privacy.html: the build publishes it
 * with only the header and footer regions patched, so its body is the
 * published body.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const config = require("../../site.config.js");
const footer = require("./footer.js");

const ROOT = config.paths.root;
const partial = fs
  .readFileSync(path.join(ROOT, footer.PARTIAL), "utf8")
  .trim();

const COOKIE_LINK = /<a\b[^>]*\bdata-cookie-settings\b[^>]*>([^<]*)<\/a>/g;

function cookieLinks(html) {
  return [...html.matchAll(COOKIE_LINK)];
}

// ---------------------------------------------------------------------
// the footer link
// ---------------------------------------------------------------------

test("the footer partial carries exactly one Cookie settings link", () => {
  const links = cookieLinks(partial);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0][1].trim(), "Cookie settings");
  assert.match(links[0][0], /href="\/privacy#cookies"/);
});

test("the Cookie settings fallback target exists in the Privacy Policy", () => {
  const privacy = fs.readFileSync(path.join(ROOT, "privacy.html"), "utf8");
  assert.match(privacy, /id="cookies"/);
});

test("footerFor() keeps one Cookie settings link at every depth", () => {
  ["about.html", "guide/x.html", "fonts/abel.html", "a/b/c.html"].forEach(
    (file) => {
      const links = cookieLinks(footer.footerFor(file, partial));
      assert.strictEqual(links.length, 1, file);
      assert.match(links[0][0], /href="\/privacy#cookies"/, file);
    },
  );
});

test("no footer link is generated twice", () => {
  const hrefs = [...partial.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const seen = new Set();
  hrefs.forEach((href) => {
    assert.ok(!seen.has(href), `footer links to ${href} more than once`);
    seen.add(href);
  });
});

test("render() writes the footer once, and a second run adds nothing", () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bpozz-footer-"));
  try {
    const page = (body) =>
      `<!doctype html><body>${body}` +
      `${footer.START_MARKER}old${footer.END_MARKER}</body>`;
    const routes = [
      { url: "/", file: "index.html" },
      { url: "/guide/x", file: "guide/x.html" },
    ];
    fs.mkdirSync(path.join(stage, "guide"));
    routes.forEach((r) =>
      fs.writeFileSync(path.join(stage, r.file), page(r.url), "utf8"),
    );
    const ctx = { config: { paths: { root: ROOT, stage } }, routes };

    const first = footer.render(ctx);
    assert.strictEqual(first.updated, 2);
    const second = footer.render(ctx);
    assert.strictEqual(second.updated, 0);
    assert.strictEqual(second.unchanged, 2);

    routes.forEach((r) => {
      const html = fs.readFileSync(path.join(stage, r.file), "utf8");
      assert.strictEqual(cookieLinks(html).length, 1, r.file);
      assert.strictEqual(html.split("<footer").length - 1, 1, r.file);
      assert.strictEqual(html.split("<script data-cookieconsent").length - 1, 1, r.file);
    });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------
// the click handler
// ---------------------------------------------------------------------

function handlerScript() {
  const scripts = [
    ...partial.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g),
  ];
  assert.strictEqual(scripts.length, 1, "footer carries one script");
  return { attrs: scripts[0][1], code: scripts[0][2] };
}

/** Runs the footer script and returns a function that simulates one click. */
function loadHandler(cookiebot) {
  let listener = null;
  const window = cookiebot ? { Cookiebot: cookiebot } : {};
  const document = {
    addEventListener(type, fn) {
      assert.strictEqual(type, "click");
      listener = fn;
    },
  };
  vm.runInNewContext(handlerScript().code, { window, document });
  assert.ok(listener, "the script registers a click listener");

  return (onCookieLink) => {
    const link = { dataset: { cookieSettings: "" } };
    let prevented = false;
    listener({
      target: {
        closest: (sel) =>
          sel === "[data-cookie-settings]" && onCookieLink ? link : null,
      },
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };
}

test("the handler script is exempt from Cookiebot auto-blocking", () => {
  assert.match(handlerScript().attrs, /data-cookieconsent="ignore"/);
});

test("clicking Cookie settings calls window.Cookiebot.show()", () => {
  let shown = 0;
  const click = loadHandler({ show: () => (shown += 1) });
  assert.strictEqual(click(true), true, "navigation is prevented");
  assert.strictEqual(shown, 1);
});

test("clicks elsewhere do not open the consent dialog", () => {
  let shown = 0;
  const click = loadHandler({ show: () => (shown += 1) });
  assert.strictEqual(click(false), false);
  assert.strictEqual(shown, 0);
});

test("without Cookiebot the link falls through to the Privacy Policy", () => {
  const click = loadHandler(null);
  assert.strictEqual(click(true), false, "navigation is not prevented");
});

test("the handler only calls Cookiebot.show() — it touches no consent state", () => {
  const { code } = handlerScript();
  assert.doesNotMatch(code, /gtag|dataLayer|document\.cookie|renew|submitCustomConsent|withdraw/);
});

// ---------------------------------------------------------------------
// the Privacy Policy disclosures
// ---------------------------------------------------------------------

function privacyText() {
  const html = fs.readFileSync(path.join(ROOT, "privacy.html"), "utf8");
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  return main
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

test("the Privacy Policy discloses every service the site uses", () => {
  const text = privacyText();
  [
    "Google Analytics",
    "Netlify",
    "Formspree",
    "Firebase",
    "Realtime Database",
    "Google Fonts",
    "fonts.googleapis.com",
    "DM Sans",
    "local storage",
    "Cookiebot",
    "Usercentrics",
    "Cookie settings",
    "Supabase",
    "Resend",
    "Ads Settings",
    "aboutads.info",
  ].forEach((needle) => assert.ok(text.includes(needle), `missing: ${needle}`));
});

test("the Privacy Policy does not claim ads are currently served", () => {
  const text = privacyText();
  assert.ok(text.includes("BPOZZ does not currently display advertising"));
  assert.ok(!text.includes("uses, or may use"));
  assert.ok(!/DoubleClick/.test(text));
});

test("the Privacy Policy does not describe local storage as cookies", () => {
  const text = privacyText();
  assert.ok(text.includes("Local storage is not a cookie"));
  assert.ok(!text.includes("functional cookies"));
});

test("the Privacy Policy keeps the data-request flow through the Contact page", () => {
  const html = fs.readFileSync(path.join(ROOT, "privacy.html"), "utf8");
  assert.match(html, /Your choices and rights/);
  assert.match(html, /href="\/contact">contact form<\/a> and\s+describe your request/);
});
