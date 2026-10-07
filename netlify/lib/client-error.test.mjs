/**
 * Tests for the client error beacon's server half: netlify/lib/client-error.mjs
 * and POST /api/client-error (netlify/functions/client-error.mjs).
 *
 * console.error is captured per test, so every assertion about what reaches
 * the log reads the exact lines the function wrote. No network is used.
 * All values below are invented.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import clientError, { config as route } from "../functions/client-error.mjs";
import { HSTS } from "./auth.mjs";
import {
  LIMITS,
  MAX_BODY_BYTES,
  REPORT_KEYS,
  browserFamily,
  cleanReport,
  isValidReport,
  redact,
} from "./client-error.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://bpozz.com";
const ENV = { CLIENT_ERRORS_ENABLED: "true", AUTH_ORIGIN: ORIGIN };

// Recognisable fake values, so a leak is easy to spot in any log line.
const EMAIL = "dee@example.test";
const JWT_HEADER = "eyJhbGciOiJIUzI1NiJ9";
const JWT_PAYLOAD = "eyJzdWIiOiIxMjM0NTY3ODkwIn0";
const JWT_SIGNATURE = "c2lnbmF0dXJlMTIzNDU2Nzg5MA";
const JWT = `${JWT_HEADER}.${JWT_PAYLOAD}.${JWT_SIGNATURE}`;
const COOKIE = "__Host-bpozz_session=session-FAKE-0a1b2c3d4e5f6a7b8c9d";
const IP = "203.0.113.77";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const realError = console.error;
let savedEnv;
let logs;

function setEnv(values) {
  for (const key of Object.keys(ENV)) delete process.env[key];
  Object.assign(process.env, values);
}

beforeEach(() => {
  savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  setEnv(ENV);
});

afterEach(() => {
  console.error = realError;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** A report exactly as error-beacon.js builds one. */
function report(fields = {}) {
  return {
    v: 1,
    kind: "error",
    name: "TypeError",
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'x')",
    source: "/app.js",
    line: 120,
    col: 7,
    stack: "TypeError: Cannot read properties of undefined (reading 'x')\nat initGuides (/app.js:120:7)",
    page: "/guides/",
    ...fields,
  };
}

function request({ method = "POST", body = report(), origin = ORIGIN, type = "application/json", headers = {} } = {}) {
  const h = new Headers(headers);
  if (origin) h.set("origin", origin);
  if (type) h.set("content-type", type);
  const init = { method, headers: h };
  if (method !== "GET" && method !== "HEAD" && body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(`${ORIGIN}/api/client-error`, init);
}

async function call(options) {
  const res = await clientError(request(options));
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
}

/** The one logged record, parsed; fails unless exactly one line was logged. */
function loggedRecord() {
  assert.equal(logs.length, 1, `expected one log line, got ${logs.length}`);
  const [line] = logs;
  assert.ok(line.startsWith("[client-error] "), line);
  assert.ok(!/[\r\n\u2028\u2029]/.test(line), "the log record is one line");
  return JSON.parse(line.slice("[client-error] ".length));
}

// ---------------------------------------------------------------------
// route
// ---------------------------------------------------------------------

test("routed at /api/client-error with a literal-only config and the audited rate limit", () => {
  assert.deepEqual(route, {
    path: "/api/client-error",
    rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
  });
  // Netlify reads `export const config` statically (see email.test.mjs).
  const source = fs.readFileSync(path.join(REPO, "netlify", "functions", "client-error.mjs"), "utf8");
  const match = /^export const config = (\{[\s\S]*?\});$/m.exec(source);
  assert.ok(match, "no top-level config");
  // Re-made in this realm: an object from the vm context fails a strict deepEqual on its prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`(${match[1]})`, Object.create(null)))), route);
});

// ---------------------------------------------------------------------
// accepted
// ---------------------------------------------------------------------

test("a valid report: 204, empty, no-store, and exactly one bounded log line", async () => {
  const { res, text } = await call({ headers: { "user-agent": UA } });
  assert.equal(res.status, 204);
  assert.equal(text, "");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("strict-transport-security"), HSTS);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.deepEqual(loggedRecord(), {
    kind: "error",
    name: "TypeError",
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'x')",
    source: "/app.js",
    line: 120,
    col: 7,
    stack: "TypeError: Cannot read properties of undefined (reading 'x')\nat initGuides (/app.js:120:7)",
    page: "/guides/",
    browser: "chromium",
  });
});

test("the largest valid report still logs one line, and only report fields plus browser", async () => {
  const stack = Array.from({ length: LIMITS.stackLines }, () => "s".repeat(199)).join("\n");
  const body = report({
    kind: "rejection",
    name: "N".repeat(LIMITS.name),
    message: "m".repeat(LIMITS.message),
    source: "/" + "a".repeat(LIMITS.source - 4) + ".js",
    line: LIMITS.position,
    col: LIMITS.position,
    stack,
    page: "/" + "p".repeat(LIMITS.page - 1),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= MAX_BODY_BYTES);
  const { res } = await call({ body });
  assert.equal(res.status, 204);
  const record = loggedRecord();
  assert.deepEqual(Object.keys(record).sort(), [...REPORT_KEYS.filter((k) => k !== "v"), "browser"].sort());
  assert.ok(logs[0].length < 2 * MAX_BODY_BYTES, "the log line is bounded");
});

test("nothing about the request is logged: no cookie, IP, referrer, user agent or other header", async () => {
  await call({
    headers: {
      cookie: COOKIE,
      referer: `${ORIGIN}/search?s=${EMAIL}`,
      "x-forwarded-for": IP,
      "x-nf-client-connection-ip": IP,
      "user-agent": UA,
      authorization: `Bearer ${JWT}`,
    },
  });
  const [line] = logs;
  for (const value of [COOKIE, "session-FAKE", IP, EMAIL, JWT, UA, "Mozilla", "search?s="]) {
    assert.ok(!line.includes(value), `logged ${value}`);
  }
  assert.equal(loggedRecord().browser, "chromium");
});

test("the server redacts again: a report that skipped the browser's redaction is cleaned", async () => {
  const forged = report({
    message: `Failed for ${EMAIL} with ${JWT} at ${ORIGIN}/account?token=${JWT}#x and https://evil.example/p?q=1`,
    stack: `Error: x\nat f (${ORIGIN}/app.js:1:2)\nat g (https://consent.cookiebot.com/uc.js:3:4)`,
    page: `/fonts/${EMAIL}`,
  });
  const { res } = await call({ body: forged });
  assert.equal(res.status, 204);
  const record = loggedRecord();
  // JWT_HEADER is 20 characters, under the 24-character token rule. It is
  // the fixed {"alg":"HS256"} header, not a secret; payload and signature go.
  assert.equal(record.message, `Failed for [email] with ${JWT_HEADER}.[token].[token] at /account and [external]`);
  assert.equal(record.stack, "Error: x\nat f (/app.js:1:2)\nat g ([external])");
  assert.equal(record.page, "/fonts/[email]");
  for (const value of [EMAIL, JWT_PAYLOAD, JWT_SIGNATURE, "evil.example", "token="]) {
    assert.ok(!logs[0].includes(value), `logged ${value}`);
  }
});

test("the response never echoes the report", async () => {
  const { text } = await call({ body: report({ message: "echo-me" }) });
  assert.equal(text, "");
});

// ---------------------------------------------------------------------
// refused
// ---------------------------------------------------------------------

test("POST only: 405 with Allow, nothing logged", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const { res, body } = await call({ method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { error: "method_not_allowed" });
  }
  assert.deepEqual(logs, []);
});

test("switched off unless CLIENT_ERRORS_ENABLED is exactly \"true\": 204, body not read, nothing logged", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1", " true"]) {
    setEnv({ ...ENV, CLIENT_ERRORS_ENABLED: value });
    if (value === undefined) delete process.env.CLIENT_ERRORS_ENABLED;
    const req = request({ origin: "https://evil.example", body: "not json" });
    const res = await clientError(req);
    assert.equal(res.status, 204, String(value));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(req.bodyUsed, false, "the body is not read");
  }
  assert.deepEqual(logs, []);
});

test("another origin, or none: 403, nothing logged", async () => {
  for (const origin of [null, "https://evil.example", "http://bpozz.com", "https://www.bpozz.com", "null"]) {
    const { res, body } = await call({ origin });
    assert.equal(res.status, 403, String(origin));
    assert.deepEqual(body, { error: "forbidden" });
  }
  assert.deepEqual(logs, []);
});

test("not application/json, too big, or not JSON: 400, nothing logged", async () => {
  const cases = [
    { type: "text/plain" },
    { type: "application/x-www-form-urlencoded" },
    { type: null },
    { headers: { "content-length": String(MAX_BODY_BYTES + 1) } },
    { body: JSON.stringify(report({ message: "é".repeat(LIMITS.message) })) + " ".repeat(MAX_BODY_BYTES) },
    { body: "{" },
    { body: "" },
    { body: "[]" },
    { body: "null" },
  ];
  for (const options of cases) {
    const { res, body } = await call(options);
    assert.equal(res.status, 400, JSON.stringify(options).slice(0, 80));
    assert.deepEqual(body, { error: "invalid_request" });
  }
  assert.deepEqual(logs, []);
});

test("exact keys, types and lengths: anything else is 400 and nothing is logged", async () => {
  const base = report();
  const { v: _v, ...missingV } = base;
  const bad = [
    missingV,
    { ...base, extra: 1 },
    { ...base, __proto__: null, cookie: "x" },
    { ...base, v: 2 },
    { ...base, v: "1" },
    { ...base, kind: "warning" },
    { ...base, name: "Type Error" },
    { ...base, name: "N".repeat(LIMITS.name + 1) },
    { ...base, name: "" },
    { ...base, message: 1 },
    { ...base, message: "m".repeat(LIMITS.message + 1) },
    { ...base, source: "https://bpozz.com/app.js" },
    { ...base, source: "/app.js?v=1" },
    { ...base, source: "/style.css" },
    { ...base, source: "/" + "a".repeat(LIMITS.source) + ".js" },
    { ...base, line: -1 },
    { ...base, line: 1.5 },
    { ...base, col: LIMITS.position + 1 },
    { ...base, col: "7" },
    { ...base, stack: null },
    { ...base, stack: "s".repeat(LIMITS.stack + 1) },
    { ...base, stack: "1\n2\n3\n4\n5\n6" },
    { ...base, page: "guides/" },
    { ...base, page: "/" + "p".repeat(LIMITS.page) },
    { ...base, page: ["/"] },
  ];
  for (const body of bad) {
    assert.equal(isValidReport(body), false, JSON.stringify(body).slice(0, 80));
    const { res } = await call({ body });
    assert.equal(res.status, 400);
  }
  const raw = JSON.stringify(base).replace('"v":1,', '"v":1,"__proto__":{"x":1},');
  assert.equal((await call({ body: raw })).res.status, 400, "a __proto__ key is an extra key");
  assert.deepEqual(logs, []);
  assert.equal(isValidReport(base), true);
});

// ---------------------------------------------------------------------
// redaction rules
// ---------------------------------------------------------------------

test("redact: each rule", () => {
  const r = (text, max = 300) => redact(text, max, ORIGIN);
  assert.equal(r("a\u0000b\nc\u2028d\u009fe"), "a b c d e");
  assert.equal(r(`${ORIGIN}/guide/x?s=1#y`), "/guide/x");
  assert.equal(r(`at f (${ORIGIN}/app.js:10:5)`), "at f (/app.js:10:5)");
  assert.equal(r(`at f (${ORIGIN}/search?s=dee:10:5)`), "at f (/search:10:5)");
  assert.equal(r("see https://evil.example/a and http://bpozz.com/b"), "see [external] and [external]");
  assert.equal(r("chrome-extension://abcdef/x.js:1:2"), "[external]");
  assert.equal(r("data:text/javascript,alert(1)"), "[external](1)");
  assert.equal(r(`blob:${ORIGIN}/0a1b2c3d`), "[external]");
  assert.equal(r("GET /api/saved?kind=font&id=abel failed"), "GET /api/saved failed");
  assert.equal(r("open /guides/#roadmap"), "open /guides/");
  assert.equal(r(`mail ${EMAIL} now`), "mail [email] now");
  assert.equal(r("hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 end"), "hash [token] end");
  assert.equal(r("/guide/mobile-breakpoints-device-categories"), "/guide/mobile-breakpoints-device-categories");
  assert.equal(r(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`), `Unexpected token '<', "[…]"... is not valid JSON`);
  assert.equal(r("reading 'x'"), "reading 'x'");
  assert.equal(r("x".repeat(400), 300).length, 300);
});

// Bidi formatting characters: they can't start a line, but they can make a
// record read differently in a log viewer. Built from code points on purpose.
const BIDI = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const char = (code) => String.fromCharCode(code);

test("redact: bidi formatting characters become spaces; neighbours outside the ranges stay", () => {
  for (const code of BIDI) {
    assert.equal(redact(`a${char(code)}b`, 300, ORIGIN), "a b", code.toString(16));
  }
  for (const code of [0x200d, 0x2010, 0x202f, 0x206a]) {
    assert.equal(redact(`a${char(code)}b`, 300, ORIGIN), `a${char(code)}b`, code.toString(16));
  }
});

test("bidi formatting characters never reach the log", async () => {
  const bidi = BIDI.map(char).join("");
  const body = report({ message: `a${bidi}b`, stack: `Error${bidi}x\nat f (/app.js:1:1)`, page: `/x${bidi}y` });
  const { res } = await call({ body });
  assert.equal(res.status, 204);
  const record = loggedRecord();
  const spaces = " ".repeat(BIDI.length);
  assert.equal(record.message, `a${spaces}b`);
  assert.equal(record.stack, `Error${spaces}x\nat f (/app.js:1:1)`);
  assert.equal(record.page, `/x${spaces}y`);
  for (const code of BIDI) assert.ok(!logs[0].includes(char(code)), code.toString(16));
});

test("redact is idempotent, so the browser's output passes through the server unchanged", () => {
  const raw = `Failed ${EMAIL} ${JWT} ${ORIGIN}/a?b=c "quoted" https://evil.example/x \u0007`;
  const once = redact(raw, LIMITS.message, ORIGIN);
  assert.equal(redact(once, LIMITS.message, ORIGIN), once);
  const clean = report({ message: once, page: "/[email]" });
  const { v: _v, ...expected } = clean;
  assert.deepEqual(cleanReport(clean, ORIGIN), expected);
});

test("a source that redaction would change is dropped to \"\"", () => {
  const source = "/a9f86d081884c7d659a2feaa0c55ad015a3b.js";
  assert.equal(isValidReport(report({ source })), true);
  assert.equal(cleanReport(report({ source }), ORIGIN).source, "");
  assert.equal(cleanReport(report({ source: "[inline]" }), ORIGIN).source, "[inline]");
});

test("browserFamily: four families, never the user agent itself", () => {
  const cases = [
    [UA, "chromium"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "chromium"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "firefox"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "safari"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1", "safari"],
    ["curl/8.0", "other"],
    ["", "other"],
    [null, "other"],
  ];
  for (const [ua, family] of cases) assert.equal(browserFamily(ua), family, String(ua));
});
