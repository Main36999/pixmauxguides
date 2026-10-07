/**
 * error-beacon.test.js — the browser half of the client error beacon,
 * src/client/error-beacon.js (server half: netlify/lib/client-error.mjs).
 *
 * Runs the real error-beacon.js in a vm context (the auth.test.js convention)
 * against a stub window that records its listeners, every request, and every
 * touch of browser storage, document.cookie, document.referrer and the
 * address's query, fragment and full href. Error and rejection events are
 * dispatched by hand.
 *
 * All values below are invented. No real account, token or address.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = fs.readFileSync(path.join(__dirname, "error-beacon.js"), "utf8");
const ORIGIN = "https://bpozz.com";
const EMAIL = "dee@example.test";
const QUERY = "?s=dee@example.test&code=0a1b2c3d4e5f6a7b8c9d0e1f2a3b";
const FRAGMENT = "#private-fragment";
const KEYS = ["v", "kind", "name", "message", "source", "line", "col", "stack", "page"];
const PAGES_WITHOUT_APP = ["404.html", "about.html", "account.html", "contact.html", "hoysomrach.html", "privacy.html", "terms.html"];
// Bidi formatting characters, built from code points on purpose.
const BIDI_CODES = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const BIDI = BIDI_CODES.map((code) => String.fromCharCode(code)).join("");

// ---------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------

/**
 * Loads error-beacon.js into a fresh page. `respond(url, init)` answers the
 * beacon's fetch (default: a 204). `hasFetch: false` leaves fetch out.
 */
function page({ hostname = "bpozz.com", pathname = "/guides/", notFound = false, respond = null, hasFetch = true } = {}) {
  const origin = `https://${hostname}`;
  const listeners = {};
  const calls = [];
  const touches = [];
  const location = { hostname, origin, pathname };
  const hidden = { search: QUERY, hash: FRAGMENT, href: origin + pathname + QUERY + FRAGMENT };
  for (const [key, value] of Object.entries(hidden)) {
    Object.defineProperty(location, key, { get: () => (touches.push(`location.${key}`), value) });
  }
  const document = { querySelector: (selector) => (notFound && selector === "main.notfound" ? {} : null) };
  Object.defineProperty(document, "cookie", {
    get: () => (touches.push("document.cookie"), ""),
    set: () => touches.push("document.cookie"),
  });
  Object.defineProperty(document, "referrer", { get: () => (touches.push("document.referrer"), "") });

  const ctx = {
    URL,
    location,
    document,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
  };
  if (hasFetch) {
    ctx.fetch = (url, init) => {
      calls.push({ url, init });
      return respond ? respond(url, init) : Promise.resolve({ status: 204 });
    };
  }
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(ctx, name, { get: () => (touches.push(name), {}) });
  }
  ctx.window = ctx;
  vm.runInNewContext(SOURCE, ctx);

  const fire = (type, event) => (listeners[type] || []).forEach((fn) => fn(event));
  return {
    ctx,
    listeners,
    calls,
    touches,
    error: (event) => fire("error", event),
    rejection: (reason) => fire("unhandledrejection", { reason }),
    sent: () => calls.map((c) => JSON.parse(c.init.body)),
  };
}

function thrown(Ctor, message, stack) {
  const error = new Ctor(message);
  Object.defineProperty(error, "stack", { value: stack, configurable: true, writable: true });
  return error;
}

const TYPE_ERROR_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  `    at initGuides (${ORIGIN}/app.js:120:7)`,
  `    at ${ORIGIN}/app.js:900:3`,
].join("\n");

/** A same-origin script error, as the browser dispatches it. */
function scriptError(fields = {}) {
  return {
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'x')",
    filename: `${ORIGIN}/app.js`,
    lineno: 120,
    colno: 7,
    error: thrown(TypeError, "Cannot read properties of undefined (reading 'x')", TYPE_ERROR_STACK),
    ...fields,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------
// where it runs
// ---------------------------------------------------------------------

test("reports only on bpozz.com: anywhere else installs no listener and sends nothing", () => {
  for (const hostname of ["localhost", "127.0.0.1", "bpozz.netlify.app", "deploy-preview-7--bpozz.netlify.app", "www.bpozz.com"]) {
    const p = page({ hostname });
    assert.strictEqual(p.ctx.BpozzErrorBeacon.active, false, hostname);
    assert.deepStrictEqual(Object.keys(p.listeners), [], hostname);
  }
  const noFetch = page({ hasFetch: false });
  assert.strictEqual(noFetch.ctx.BpozzErrorBeacon.active, false, "no fetch");
  assert.deepStrictEqual(Object.keys(noFetch.listeners), []);
});

test("one window error listener and one unhandledrejection listener; a second copy is a no-op", () => {
  const p = page();
  assert.strictEqual(p.ctx.BpozzErrorBeacon.active, true);
  vm.runInContext(SOURCE, p.ctx);
  assert.deepStrictEqual(Object.keys(p.listeners).sort(), ["error", "unhandledrejection"]);
  assert.strictEqual(p.listeners.error.length, 1);
  assert.strictEqual(p.listeners.unhandledrejection.length, 1);
});

// ---------------------------------------------------------------------
// the request and the payload
// ---------------------------------------------------------------------

test("an error: one POST to /api/client-error with exactly the audited options and payload", () => {
  const p = page();
  p.error(scriptError());
  assert.strictEqual(p.calls.length, 1);
  const { url, init } = p.calls[0];
  assert.strictEqual(url, "/api/client-error");
  assert.deepStrictEqual(Object.keys(init).sort(), ["body", "credentials", "headers", "keepalive", "method", "referrerPolicy"]);
  assert.strictEqual(init.method, "POST");
  assert.strictEqual(init.credentials, "omit");
  assert.strictEqual(init.referrerPolicy, "no-referrer");
  assert.strictEqual(init.keepalive, true);
  assert.deepStrictEqual(Object.keys(init.headers), ["Content-Type"]);
  assert.strictEqual(init.headers["Content-Type"], "application/json");
  assert.deepStrictEqual(JSON.parse(init.body), {
    v: 1,
    kind: "error",
    name: "TypeError",
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'x')",
    source: "/app.js",
    line: 120,
    col: 7,
    stack: "TypeError: Cannot read properties of undefined (reading 'x')\nat initGuides (/app.js:120:7)\nat /app.js:900:3",
    page: "/guides/",
  });
});

test("the page is its path only: no query, no fragment, and \"/404\" on the 404 page", () => {
  const p = page({ pathname: `/fonts/${EMAIL}` });
  p.error(scriptError());
  assert.strictEqual(p.sent()[0].page, "/fonts/[email]");
  const body = p.calls[0].init.body;
  for (const value of [EMAIL, "code=", "private-fragment", "?s=", "#"]) assert.ok(!body.includes(value), `sent ${value}`);

  const missing = page({ pathname: "/a/path/the/visitor/typed", notFound: true });
  missing.error(scriptError());
  assert.strictEqual(missing.sent()[0].page, "/404");
});

test("never reads cookies, storage, the referrer, the query, the fragment or the full address", () => {
  const p = page();
  p.error(scriptError());
  p.error(scriptError({ filename: `${ORIGIN}/guides/`, lineno: 3 }));
  p.rejection(thrown(Error, "x", `Error: x\n    at f (${ORIGIN}/app.js:1:1)`));
  p.rejection("a string");
  assert.strictEqual(p.calls.length, 4);
  assert.deepStrictEqual(p.touches, []);
  // And no code path names them (comments, which explain the rule, aside).
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/localStorage|sessionStorage|document\.cookie|document\.referrer|location\.(?:search|hash|href)|innerHTML|innerText|textContent|outerHTML|FormData|\.elements\b|\.value\b|sendBeacon|XMLHttpRequest/.test(code),
    "error-beacon.js reads something it must not",
  );
  assert.strictEqual(code.split("fetch(").length - 1, 1, "one request site");
});

// ---------------------------------------------------------------------
// redaction and filtering
// ---------------------------------------------------------------------

test("redacted in the browser: emails, URLs, queries, quoted text; at most five stack lines", () => {
  const p = page();
  const stack = [
    `Error: save failed for ${EMAIL}`,
    `    at send (${ORIGIN}/saved.js:10:5)`,
    "    at https://consent.cookiebot.com/uc.js:1:2",
    `    at a (${ORIGIN}/app.js:1:1)`,
    `    at b (${ORIGIN}/app.js:2:1)`,
    `    at c (${ORIGIN}/app.js:3:1)`,
    `    at d (${ORIGIN}/app.js:4:1)`,
  ].join("\n");
  p.error(
    scriptError({
      message: `Uncaught Error: save failed for ${EMAIL} at ${ORIGIN}/account?id=42#top via https://evil.example/x?y=1`,
      filename: `${ORIGIN}/saved.js`,
      error: thrown(Error, "save failed", stack),
    }),
  );
  p.error(scriptError({ message: `Uncaught SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, lineno: 2 }));
  const [first, second] = p.sent();
  assert.strictEqual(first.message, "Uncaught Error: save failed for [email] at /account via [external]");
  assert.strictEqual(first.source, "/saved.js");
  assert.strictEqual(
    first.stack,
    ["Error: save failed for [email]", "at send (/saved.js:10:5)", "at [external]", "at a (/app.js:1:1)", "at b (/app.js:2:1)"].join("\n"),
  );
  assert.strictEqual(second.message, `Uncaught SyntaxError: Unexpected token '<', "[…]"... is not valid JSON`);
});

test("bidi formatting characters become spaces in the message, stack and page", () => {
  const p = page({ pathname: `/x${BIDI}y` });
  const stack = `Error${BIDI}x\n    at f (${ORIGIN}/app.js:1:1)`;
  p.error(scriptError({ message: `a${BIDI}b`, error: thrown(Error, "x", stack) }));
  const [report] = p.sent();
  const spaces = " ".repeat(BIDI_CODES.length);
  assert.strictEqual(report.message, `a${spaces}b`);
  assert.strictEqual(report.stack, `Error${spaces}x\nat f (/app.js:1:1)`);
  assert.strictEqual(report.page, `/x${spaces}y`);
  for (const code of BIDI_CODES) {
    assert.ok(!p.calls[0].init.body.includes(String.fromCharCode(code)), code.toString(16));
  }
});

test("dropped, not sent: other sites' scripts, extensions, \"Script error.\", its own file", () => {
  const p = page();
  p.error({ message: "Script error.", filename: "", lineno: 0, colno: 0, error: null });
  p.error({ message: "Uncaught Script error.", filename: "", lineno: 0, colno: 0, error: null });
  p.error(scriptError({ filename: "https://consent.cookiebot.com/uc.js" }));
  p.error(scriptError({ filename: "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js" }));
  p.error(scriptError({ filename: "chrome-extension://abcdefghijklmnop/content.js" }));
  p.error(scriptError({ filename: "http://bpozz.com/app.js" }));
  p.error(scriptError({ filename: `${ORIGIN}/error-beacon.js` }));
  p.error({});
  p.error(null);
  // A rejection whose stack has no frame from this site: someone else's code.
  p.rejection(thrown(Error, "quota", "Error: quota\n    at x (https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js:1:1)"));
  assert.strictEqual(p.calls.length, 0);
});

test("a script written into the page is [inline], never the page's address", () => {
  const p = page();
  p.error(scriptError({ filename: `${ORIGIN}/guides/${QUERY}${FRAGMENT}`, lineno: 4, colno: 9, error: null }));
  const [report] = p.sent();
  assert.strictEqual(report.source, "[inline]");
  assert.strictEqual(report.name, "Error");
  assert.strictEqual(report.stack, "");
  assert.ok(!p.calls[0].init.body.includes(EMAIL));
});

test("rejections: an Error keeps name, message and stack; anything else is only its type", () => {
  const p = page();
  p.rejection(thrown(TypeError, `bad ${EMAIL}`, `TypeError: bad ${EMAIL}\n    at load (${ORIGIN}/fonts/fonts.js:5:2)`));
  const abort = new DOMException("The operation was aborted.", "AbortError");
  Object.defineProperty(abort, "stack", { value: undefined, configurable: true });
  p.rejection(abort);
  assert.deepStrictEqual(p.sent(), [
    {
      v: 1,
      kind: "rejection",
      name: "TypeError",
      message: "bad [email]",
      source: "",
      line: 0,
      col: 0,
      stack: "TypeError: bad [email]\nat load (/fonts/fonts.js:5:2)",
      page: "/guides/",
    },
    { v: 1, kind: "rejection", name: "AbortError", message: "The operation was aborted.", source: "", line: 0, col: 0, stack: "", page: "/guides/" },
  ]);

  const other = page();
  for (const reason of [EMAIL, { token: EMAIL, message: EMAIL }, null, undefined, 42]) other.rejection(reason);
  assert.deepStrictEqual(
    other.sent().map((r) => [r.name, r.message, r.stack]),
    [
      ["Error", "[non-error: string]", ""],
      ["Error", "[non-error: object]", ""],
      ["Error", "[non-error: null]", ""],
      ["Error", "[non-error: undefined]", ""],
      ["Error", "[non-error: number]", ""],
    ],
  );
  for (const c of other.calls) assert.ok(!c.init.body.includes(EMAIL));
});

// ---------------------------------------------------------------------
// limits and failure
// ---------------------------------------------------------------------

test("at most five reports a page, and each distinct error only once", () => {
  const p = page();
  for (let i = 0; i < 3; i += 1) p.error(scriptError());
  assert.strictEqual(p.calls.length, 1, "identical errors are sent once");
  for (let line = 1; line <= 10; line += 1) p.error(scriptError({ lineno: line }));
  p.rejection(thrown(Error, "late", `Error: late\n    at f (${ORIGIN}/app.js:1:1)`));
  assert.strictEqual(p.calls.length, 5);
});

test("every body is at most 2,048 bytes; a stack that does not fit is dropped first", () => {
  const p = page();
  const wideStack = Array.from({ length: 5 }, () => "ж".repeat(199)).join("\n");
  p.error(scriptError({ message: "é".repeat(400), error: thrown(Error, "x", wideStack) }));
  const asciiStack = Array.from({ length: 8 }, (_, i) => `at f${i} (${ORIGIN}/app.js:${i}:1) ${"s".repeat(300)}`).join("\n");
  p.error(scriptError({ message: "m".repeat(400), lineno: 2, error: thrown(Error, "x", asciiStack) }));
  for (const c of p.calls) assert.ok(Buffer.byteLength(c.init.body, "utf8") <= 2048, `${Buffer.byteLength(c.init.body)} bytes`);
  const [wide, ascii] = p.sent();
  assert.strictEqual(wide.message.length, 300);
  assert.strictEqual(wide.stack, "", "a stack that does not fit is dropped");
  assert.strictEqual(ascii.message.length, 300);
  assert.ok(ascii.stack.length <= 1000 && ascii.stack.split("\n").length <= 5);
  assert.ok(ascii.stack.startsWith("at f0 (/app.js:0:1)"));
});

test("silent failure: a request that rejects or throws is not retried and breaks nothing", async () => {
  const rejecting = page({ respond: () => Promise.reject(new TypeError("Failed to fetch")) });
  assert.doesNotThrow(() => rejecting.error(scriptError()));
  await tick();
  assert.strictEqual(rejecting.calls.length, 1, "no retry");

  const throwing = page({
    respond: () => {
      throw new TypeError("keepalive request exceeds the quota");
    },
  });
  assert.doesNotThrow(() => throwing.error(scriptError()));
  assert.doesNotThrow(() => throwing.error(scriptError({ lineno: 2 })));
  assert.strictEqual(throwing.calls.length, 2, "one attempt each, no retry");

  const odd = page({ respond: () => undefined });
  assert.doesNotThrow(() => odd.error(scriptError()));

  const hostile = page();
  const event = scriptError();
  Object.defineProperty(event, "error", {
    get() {
      throw new Error("getter");
    },
  });
  assert.doesNotThrow(() => hostile.error(event));
  assert.strictEqual(hostile.calls.length, 0);
});

test("recursion guard: an error raised while a report is being sent is not reported", () => {
  let p;
  p = page({
    respond: () => {
      p.error(scriptError({ message: "Uncaught Error: raised during send", lineno: 99 }));
      p.rejection(thrown(Error, "also during send", `Error\n    at f (${ORIGIN}/app.js:1:1)`));
      return Promise.resolve({ status: 204 });
    },
  });
  p.error(scriptError());
  assert.strictEqual(p.calls.length, 1);
  assert.strictEqual(p.sent()[0].line, 120);
});

// ---------------------------------------------------------------------
// the same rules as the server
// ---------------------------------------------------------------------

test("the browser and the server redact identically, and the server accepts the browser's report as is", async () => {
  const server = await import(pathToFileURL(path.join(ROOT, "netlify", "lib", "client-error.mjs")).href);
  const separator = String.fromCharCode(0x2028);
  const corpus = [
    `Failed for ${EMAIL}`,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2Nzg5MA",
    `${ORIGIN}/account?token=abc#x`,
    "see https://evil.example/p?q=1 and http://bpozz.com/b",
    `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    "GET /api/saved?kind=font&id=abel failed",
    `a${String.fromCharCode(7)}b${separator}c${String.fromCharCode(0x9f)}d\ne`,
    `left${BIDI}right`,
    "x".repeat(500),
    "chrome-extension://abc/x.js:1:2 failed",
    "hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "/guide/mobile-breakpoints-device-categories",
  ];
  for (const raw of corpus) {
    const p = page();
    const stack = `Error: ${raw}\n    at f (${ORIGIN}/app.js:1:1)`;
    p.error(scriptError({ message: raw, error: thrown(Error, raw, stack) }));
    const [report] = p.sent();
    assert.strictEqual(report.message, server.redact(raw, server.LIMITS.message, ORIGIN), raw.slice(0, 40));
    assert.strictEqual(server.isValidReport(report), true, raw.slice(0, 40));
    const { v: _v, ...expected } = report;
    assert.deepStrictEqual(server.cleanReport(report, ORIGIN), expected, raw.slice(0, 40));
  }
});

// ---------------------------------------------------------------------
// where it ships
// ---------------------------------------------------------------------

test("build: the first of /app.js's modules, and published on its own at /error-beacon.js", () => {
  const build = require(path.join(ROOT, "src", "build", "build.js"));
  assert.strictEqual(build.APP_BUNDLE.modules[0], "src/client/error-beacon.js");
  assert.ok(!build.APP_BUNDLE.fragments.includes("src/client/error-beacon.js"));
  assert.deepStrictEqual(
    build.PUBLISH_FILES.filter((f) => f.from === "src/client/error-beacon.js").map((f) => ({ ...f })),
    [{ from: "src/client/error-beacon.js", to: "error-beacon.js" }],
  );
});

test("the seven pages without /app.js load /error-beacon.js once, before any other site script", () => {
  for (const file of PAGES_WITHOUT_APP) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    const site = srcs.filter((src) => src.startsWith("/") && !src.startsWith("//"));
    assert.strictEqual(site[0], "/error-beacon.js", file);
    assert.strictEqual(site.filter((src) => src === "/error-beacon.js").length, 1, file);
    assert.ok(!srcs.some((src) => /(^|\/)app\.js$/.test(src)), `${file}: loads no app.js`);
    // Ahead of the page's own inline scripts after the footer, too.
    const tail = html.slice(html.indexOf("<!--FOOTER_END-->"));
    assert.ok(/^<!--FOOTER_END-->\s*<script src="\/error-beacon\.js"><\/script>\s*<!--/.test(tail), `${file}: first after the footer`);
  }
  // Pages that load /app.js get the beacon inside it, not a second tag.
  for (const file of ["index.html", "roadmap.html", "search.html"]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, file), "utf8").includes("error-beacon.js"), file);
  }
});

test("the Privacy Policy discloses error reports, with no numeric retention period", () => {
  const html = fs.readFileSync(path.join(ROOT, "privacy.html"), "utf8");
  const text = html
    .match(/<main[\s\S]*?<\/main>/)[0]
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const start = text.indexOf("If a script on a page fails");
  assert.ok(start !== -1, "the error-report disclosure is missing");
  const end = text.indexOf("deleted automatically.", start);
  assert.ok(end !== -1);
  const disclosure = text.slice(start, end + "deleted automatically.".length);
  for (const needle of [
    "short error report through a Netlify function",
    "without any query string",
    "It contains no cookies, account or contact details, form contents or browser-storage contents",
    "only to find and fix errors",
    "kept only for the limited period Netlify retains its function logs, and then deleted automatically.",
  ]) {
    assert.ok(disclosure.includes(needle), `missing: ${needle}`);
  }
  assert.ok(!/\d/.test(disclosure), "no number (no retention period) in the disclosure");
  assert.ok(text.includes("to maintain site security, and to find and fix errors in the site"));
});
