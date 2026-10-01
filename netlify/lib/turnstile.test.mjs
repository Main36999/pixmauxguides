/**
 * Tests for the Turnstile check on POST /api/auth/email/start
 * (netlify/lib/turnstile.mjs, docs/CLOUDFLARE-SECURITY.md), and for the
 * HSTS header the functions send.
 *
 * Neither Cloudflare nor Supabase is ever contacted — global fetch is
 * replaced by a router that records every request, as in email.test.mjs.
 * Every key and token below is invented: no real sitekey, secret or
 * Cloudflare test credential appears in this file.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import emailStart from "../functions/auth-email-start.mjs";
import emailVerify from "../functions/auth-email-verify.mjs";
import authSession from "../functions/auth-session.mjs";
import googleStart from "../functions/auth-google-start.mjs";
import { AUTH_HEADERS, EMAIL_COOKIE, HSTS, json, redirect, resetProviderCache } from "./auth.mjs";
import { MAX_START_BODY_BYTES_WITH_TOKEN, PAGE_HEADERS } from "./email.mjs";
import {
  MAX_TOKEN_LENGTH,
  SITEVERIFY_URL,
  TURNSTILE_ACTION,
  looksLikeTurnstileToken,
  turnstileConfig,
  verifyTurnstile,
} from "./turnstile.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const ORIGIN = "https://bpozz.com";
const SUPABASE = "https://example-project.supabase.co";
const SITE_KEY = "sitekey-FAKE-0000000000";
const SECRET_KEY = "turnstile-secret-FAKE-1111111111";
const ENV = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key-FAKE-1234",
  AUTH_ORIGIN: ORIGIN,
  AUTH_COOKIE_SECRET: "cookie-secret-FAKE-0123456789abcdefghijklmnop",
  AUTH_EMAIL_ENABLED: "true",
  TURNSTILE_SITE_KEY: SITE_KEY,
  TURNSTILE_SECRET_KEY: SECRET_KEY,
};
const EMAIL = "reader@example.com";
const TOKEN = "0.token-FAKE_abcDEF123.xyz-789";
const SITEVERIFY = new URL(SITEVERIFY_URL);
const VERIFIED = { success: true, hostname: "bpozz.com", action: TURNSTILE_ACTION, "error-codes": [] };

const realFetch = globalThis.fetch;
const realError = console.error;
let savedEnv;
let calls;
let logs;
let routes;

function route(key, respond) {
  routes[key] = respond;
}

function siteverify(body, status = 200) {
  route(`POST ${SITEVERIFY.pathname}`, () => Response.json(body, { status }));
}

beforeEach(() => {
  savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  resetProviderCache();
  calls = [];
  logs = [];
  routes = {};
  route("GET /auth/v1/settings", () => Response.json({ external: { google: true, email: true } }));
  route("POST /auth/v1/otp", () => Response.json({}));
  siteverify(VERIFIED);
  console.error = (...args) => logs.push(args.join(" "));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = {
      url,
      method: init.method || "GET",
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body) : undefined,
      redirect: init.redirect,
    };
    calls.push(call);
    const respond = routes[`${call.method} ${url.pathname}`];
    if (!respond) throw new Error(`unexpected call ${call.method} ${url.href}`);
    return respond(call);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function startRequest(body, { origin = ORIGIN, raw } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(`${ORIGIN}/api/auth/email/start`, {
    method: "POST",
    headers,
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

const siteverifyCalls = () => calls.filter((c) => c.url.origin === SITEVERIFY.origin);
const otpCalls = () => calls.filter((c) => c.url.pathname === "/auth/v1/otp");

function turnstileOff() {
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
}

async function assertNoLeak(res) {
  const text = await res.clone().text();
  const headers = [...res.headers].flat().join("\n");
  for (const where of [text, headers, logs.join("\n")]) {
    assert.ok(!where.includes(SECRET_KEY), "the Turnstile secret leaked");
    assert.ok(!where.includes(TOKEN), "the Turnstile token leaked");
  }
}

// ---------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------

test("turnstileConfig: off with neither variable, on with both, invalid otherwise", () => {
  for (const env of [{}, { TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "  " }]) {
    assert.deepEqual(turnstileConfig(env), { state: "off" });
  }
  assert.deepEqual(turnstileConfig({ TURNSTILE_SITE_KEY: ` ${SITE_KEY} `, TURNSTILE_SECRET_KEY: SECRET_KEY }), {
    state: "on",
    siteKey: SITE_KEY,
    secretKey: SECRET_KEY,
  });

  const invalid = [
    { TURNSTILE_SITE_KEY: SITE_KEY },
    { TURNSTILE_SECRET_KEY: SECRET_KEY },
    { TURNSTILE_SITE_KEY: "short", TURNSTILE_SECRET_KEY: SECRET_KEY },
    { TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: "short" },
    { TURNSTILE_SITE_KEY: "has spaces in the sitekey", TURNSTILE_SECRET_KEY: SECRET_KEY },
    { TURNSTILE_SITE_KEY: `${SITE_KEY}"><script>`, TURNSTILE_SECRET_KEY: SECRET_KEY },
    // The secret pasted into the public variable must never be published.
    { TURNSTILE_SITE_KEY: SECRET_KEY, TURNSTILE_SECRET_KEY: SECRET_KEY },
  ];
  for (const env of invalid) {
    const result = turnstileConfig(env);
    assert.equal(result.state, "invalid", JSON.stringify(Object.keys(env)));
    assert.match(result.problem, /TURNSTILE_(SITE|SECRET)_KEY/);
    assert.ok(!result.problem.includes(SITE_KEY) && !result.problem.includes(SECRET_KEY), "problem names, not values");
    assert.equal(result.siteKey, undefined);
    assert.equal(result.secretKey, undefined);
  }
});

test("looksLikeTurnstileToken: one clean value, 2,048 characters at most", () => {
  for (const good of [TOKEN, "a", "x".repeat(MAX_TOKEN_LENGTH)]) {
    assert.equal(looksLikeTurnstileToken(good), true, good.slice(0, 20));
  }
  for (const bad of [undefined, null, "", 42, [TOKEN], { token: TOKEN }, "has space", "line\nbreak", "tab\there", "nul\u0000", "é", "x".repeat(MAX_TOKEN_LENGTH + 1)]) {
    assert.equal(looksLikeTurnstileToken(bad), false, String(bad).slice(0, 30));
  }
});

// ---------------------------------------------------------------------
// Siteverify
// ---------------------------------------------------------------------

const SETTINGS = { state: "on", siteKey: SITE_KEY, secretKey: SECRET_KEY };

test("verifyTurnstile: exact Siteverify request; the token is accepted only for this hostname and action", async () => {
  assert.equal(SITEVERIFY_URL, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com", remoteIp: "203.0.113.7" }), "ok");
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url.href, SITEVERIFY_URL);
  assert.equal(call.method, "POST");
  assert.equal(call.redirect, "error");
  assert.equal(call.headers.get("content-type"), "application/json");
  assert.deepEqual(call.body, { secret: SECRET_KEY, response: TOKEN, remoteip: "203.0.113.7" });
  // The secret travels in the body to Cloudflare and nowhere else.
  assert.ok(![...call.headers.values()].some((v) => v.includes(SECRET_KEY)));
  assert.equal(call.url.search, "");

  for (const remoteIp of [undefined, null, "", "not an ip", "x".repeat(60), 42]) {
    calls = [];
    await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com", remoteIp });
    assert.deepEqual(calls[0].body, { secret: SECRET_KEY, response: TOKEN }, `remoteip ${remoteIp}`);
  }
  calls = [];
  await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com", remoteIp: "2001:db8::7" });
  assert.equal(calls[0].body.remoteip, "2001:db8::7");
});

test("verifyTurnstile: refused, replayed or foreign tokens are invalid", async () => {
  const refused = [
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: false, "error-codes": ["missing-input-response"] },
    { success: false, "error-codes": [] },
    { success: false },
    { success: "true", hostname: "bpozz.com", action: TURNSTILE_ACTION },
    { success: 1, hostname: "bpozz.com", action: TURNSTILE_ACTION },
    // Solved, but not on this site or not for this form.
    { success: true, hostname: "evil.example", action: TURNSTILE_ACTION },
    { success: true, hostname: "www.bpozz.com", action: TURNSTILE_ACTION },
    { success: true, hostname: "bpozz.com.evil.example", action: TURNSTILE_ACTION },
    { success: true, action: TURNSTILE_ACTION },
    { success: true, hostname: "bpozz.com", action: "contact-form" },
    { success: true, hostname: "bpozz.com" },
  ];
  for (const body of refused) {
    siteverify(body);
    assert.equal(await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com" }), "invalid", JSON.stringify(body));
  }
});

test("verifyTurnstile: Cloudflare unreachable, erroring or rejecting OUR secret is unavailable, never ok", async () => {
  const cases = [
    () => { throw new TypeError("fetch failed"); },
    () => { throw new DOMException("timed out", "TimeoutError"); },
    () => new Response("boom", { status: 500 }),
    () => Response.json(VERIFIED, { status: 503 }),
    () => new Response("<html>not json</html>", { status: 200 }),
    () => new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
    () => Response.json({ success: false, "error-codes": ["invalid-input-secret"] }),
    () => Response.json({ success: false, "error-codes": ["missing-input-secret"] }),
    () => Response.json({ success: false, "error-codes": ["internal-error"] }),
    () => Response.json({ success: false, "error-codes": ["bad-request"] }, { status: 400 }),
  ];
  for (const respond of cases) {
    logs = [];
    route(`POST ${SITEVERIFY.pathname}`, respond);
    assert.equal(await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com" }), "unavailable");
    assert.equal(logs.length, 1, "one operator log line");
    assert.ok(!logs[0].includes(SECRET_KEY) && !logs[0].includes(TOKEN), "logged without values");
  }
  siteverify({ success: false, "error-codes": ["invalid-input-secret"] });
  logs = [];
  await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com" });
  assert.match(logs[0], /TURNSTILE_SECRET_KEY/, "names the variable to check");
});

test("verifyTurnstile: only Cloudflare's machine error codes reach the log", async () => {
  siteverify({ success: false, "error-codes": ["invalid-input-secret", "<script>alert(1)</script>", `echo ${SECRET_KEY}`, 42] });
  await verifyTurnstile(SETTINGS, TOKEN, { hostname: "bpozz.com" });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /invalid-input-secret/);
  assert.ok(!/script|echo/.test(logs[0]));
});

// ---------------------------------------------------------------------
// POST /api/auth/email/start with Turnstile on
// ---------------------------------------------------------------------

test("start, Turnstile on: a verified token sends the email; Cloudflare is asked first, Supabase never sees the token", async () => {
  const res = await emailStart(
    startRequest({ email: EMAIL, intent: "signin", returnTo: "/guides/", turnstileToken: TOKEN }),
    { ip: "203.0.113.7" },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.clone().json(), { sent: true });
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith(`${EMAIL_COOKIE}=`)));

  assert.equal(siteverifyCalls().length, 1);
  assert.deepEqual(siteverifyCalls()[0].body, { secret: SECRET_KEY, response: TOKEN, remoteip: "203.0.113.7" });
  assert.equal(otpCalls().length, 1);
  assert.ok(calls.indexOf(siteverifyCalls()[0]) < calls.indexOf(otpCalls()[0]), "Siteverify before /otp");
  assert.deepEqual(otpCalls()[0].body, { email: EMAIL, create_user: true });
  for (const call of calls.filter((c) => c.url.origin === SUPABASE)) {
    const sent = JSON.stringify(call.body || {}) + [...call.headers.values()].join("\n") + call.url.href;
    assert.ok(!sent.includes(TOKEN) && !sent.includes(SECRET_KEY) && !sent.includes(SITE_KEY));
  }
  await assertNoLeak(res);
});

test("start, Turnstile on: works without a client address (no Netlify context)", async () => {
  const res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }));
  assert.equal(res.status, 200);
  assert.deepEqual(siteverifyCalls()[0].body, { secret: SECRET_KEY, response: TOKEN });
});

test("start, Turnstile on: missing or malformed token -> 403 challenge_failed, nobody is asked", async () => {
  const bodies = [
    { email: EMAIL },
    { email: EMAIL, turnstileToken: "" },
    { email: EMAIL, turnstileToken: null },
    { email: EMAIL, turnstileToken: 42 },
    { email: EMAIL, turnstileToken: [TOKEN] },
    { email: EMAIL, turnstileToken: "has space" },
    { email: EMAIL, turnstileToken: "x".repeat(MAX_TOKEN_LENGTH + 1) },
    // The widget's own form field name is not the API's contract.
    { email: EMAIL, "cf-turnstile-response": TOKEN },
  ];
  for (const body of bodies) {
    const res = await emailStart(startRequest(body));
    assert.equal(res.status, 403, JSON.stringify(body).slice(0, 60));
    assert.deepEqual(await res.json(), { error: "challenge_failed" });
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(res.headers.getSetCookie(), []);
  }
  assert.equal(siteverifyCalls().length, 0);
  assert.equal(otpCalls().length, 0);
});

test("start, Turnstile on: Cloudflare refuses the token -> 403, no email, no cookie", async () => {
  for (const body of [
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, hostname: "evil.example", action: TURNSTILE_ACTION },
    { success: true, hostname: "bpozz.com", action: "something-else" },
  ]) {
    siteverify(body);
    const res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }));
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.deepEqual(await res.clone().json(), { error: "challenge_failed" });
    assert.deepEqual(res.headers.getSetCookie(), []);
    await assertNoLeak(res);
  }
  assert.equal(otpCalls().length, 0);
});

test("start, Turnstile on: Siteverify down or rejecting the secret fails CLOSED -> 503, no email", async () => {
  for (const respond of [
    () => { throw new TypeError("fetch failed"); },
    () => new Response("boom", { status: 502 }),
    () => Response.json({ success: false, "error-codes": ["invalid-input-secret"] }),
  ]) {
    route(`POST ${SITEVERIFY.pathname}`, respond);
    const res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.clone().json(), { error: "auth_unavailable" });
    assert.deepEqual(res.headers.getSetCookie(), []);
    await assertNoLeak(res);
  }
  assert.equal(otpCalls().length, 0);
});

test("start, Turnstile on: the earlier checks still come first and spend no token", async () => {
  // Wrong Origin (CSRF) — refused before the body is read.
  let res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }, { origin: "https://evil.example" }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "forbidden" });

  // A bad email is still a 400, not a challenge failure.
  res = await emailStart(startRequest({ email: "not-an-email", turnstileToken: TOKEN }));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_request" });

  // Email switched off in Supabase.
  resetProviderCache();
  route("GET /auth/v1/settings", () => Response.json({ external: { google: true, email: false } }));
  res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }));
  assert.equal(res.status, 503);

  // The kill switch.
  process.env.AUTH_EMAIL_ENABLED = "false";
  res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }));
  assert.equal(res.status, 503);

  assert.equal(siteverifyCalls().length, 0);
  assert.equal(otpCalls().length, 0);
});

test("start, Turnstile on: the body limit makes room for one token and no more", async () => {
  assert.equal(MAX_START_BODY_BYTES_WITH_TOKEN, 4096);
  const longToken = "x".repeat(MAX_TOKEN_LENGTH);
  let res = await emailStart(startRequest({ email: EMAIL, returnTo: "/guides/", turnstileToken: longToken }));
  assert.equal(res.status, 200, "a maximum-length token fits");
  assert.equal(siteverifyCalls()[0].body.response, longToken);

  calls = [];
  res = await emailStart(startRequest(null, { raw: JSON.stringify({ email: EMAIL, turnstileToken: TOKEN, pad: "x".repeat(4100) }) }));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("start, Turnstile half-configured: 503 before anything else, the variable named in the log only", async () => {
  for (const drop of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) {
    Object.assign(process.env, ENV);
    delete process.env[drop];
    logs = [];
    const res = await emailStart(startRequest({ email: EMAIL, turnstileToken: TOKEN }));
    assert.equal(res.status, 503, drop);
    assert.deepEqual(await res.clone().json(), { error: "auth_unavailable" });
    assert.ok(logs.some((l) => l.includes(drop)), "the missing variable is named");
    await assertNoLeak(res);
  }
  assert.equal(calls.length, 0);
});

test("start, Turnstile off: exactly the old behaviour — no token needed, Cloudflare never asked, 2 KB limit", async () => {
  turnstileOff();
  let res = await emailStart(startRequest({ email: EMAIL }));
  assert.equal(res.status, 200);
  res = await emailStart(startRequest({ email: EMAIL, turnstileToken: "anything at all, even malformed" }));
  assert.equal(res.status, 200, "the field is ignored while the check is off");
  assert.equal(siteverifyCalls().length, 0);
  assert.equal(otpCalls().length, 2);

  res = await emailStart(startRequest(null, { raw: JSON.stringify({ email: EMAIL, turnstileToken: "x".repeat(2100) }) }));
  assert.equal(res.status, 400, "still 2 KB");
});

// ---------------------------------------------------------------------
// GET /api/auth/session
// ---------------------------------------------------------------------

async function session() {
  resetProviderCache();
  const res = await authSession(new Request(`${ORIGIN}/api/auth/session`));
  return { res, text: await res.clone().text(), body: await res.json() };
}

test("session: publishes the sitekey — and only the sitekey — while the check is on", async () => {
  const { res, text, body } = await session();
  assert.equal(res.status, 200);
  assert.deepEqual(body, {
    authenticated: false,
    user: null,
    providers: { google: true, email: true },
    turnstile: { siteKey: SITE_KEY },
  });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(!text.includes(SECRET_KEY), "the secret is never sent to a browser");
  assert.ok(!text.toLowerCase().includes("secret"));
});

test("session: no turnstile entry when the check is off, or when email sign-in is not offered", async () => {
  turnstileOff();
  let { body } = await session();
  assert.deepEqual(body, { authenticated: false, user: null, providers: { google: true, email: true } });

  Object.assign(process.env, ENV);
  delete process.env.AUTH_EMAIL_ENABLED;
  ({ body } = await session());
  assert.deepEqual(body, { authenticated: false, user: null, providers: { google: true, email: false } });
});

test("session: half-configured Turnstile turns email off, leaves Google alone, publishes nothing", async () => {
  for (const drop of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) {
    Object.assign(process.env, ENV);
    delete process.env[drop];
    const { text, body } = await session();
    assert.deepEqual(body, { authenticated: false, user: null, providers: { google: true, email: false } }, drop);
    assert.ok(!text.includes(SECRET_KEY) && !text.includes(SITE_KEY));
  }
});

// ---------------------------------------------------------------------
// the secret stays on the server
// ---------------------------------------------------------------------

test("browser-facing sources never name the Turnstile secret or call Siteverify", () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(m?js|html|css)$/.test(entry.name) && !entry.name.endsWith(".test.js")) sources.push(full);
    }
  };
  for (const dir of ["src/client", "src/shared", "src/build", "partials", "public"]) walk(path.join(REPO, dir));
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/TURNSTILE_SECRET|TURNSTILE_SITE_KEY|siteverify/i.test(text), `${path.relative(REPO, file)} references server-side Turnstile`);
  }
  assert.ok(sources.some((f) => f.endsWith(path.join("client", "auth.js"))), "auth.js was scanned");
});

test("only the email start function reads the Turnstile secret", () => {
  const dir = path.join(REPO, "netlify", "functions");
  for (const file of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    if (file === "auth-email-start.mjs") assert.match(text, /verifyTurnstile/);
    else assert.ok(!/verifyTurnstile|secretKey/.test(text), `${file} must not touch the Turnstile secret`);
  }
});

// ---------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------

test("CSP: Turnstile is allowed in script-src and frame-src only, and nothing else was loosened", () => {
  const staticHeaders = fs.readFileSync(path.join(REPO, "public", "_headers"), "utf8");
  const match = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(staticHeaders);
  assert.ok(match, "public/_headers sets Content-Security-Policy");
  const csp = Object.fromEntries(
    match[1].split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    }),
  );

  const TURNSTILE = "https://challenges.cloudflare.com";
  const allowing = Object.keys(csp).filter((name) => csp[name].includes(TURNSTILE));
  assert.deepEqual(allowing.sort(), ["frame-src", "script-src"]);

  // Every origin the site already depended on is still there.
  const required = {
    "script-src": ["'self'", "https://www.googletagmanager.com", "https://consent.cookiebot.com", "https://*.cookiebot.com", "https://www.gstatic.com", "https://*.firebasedatabase.app"],
    "style-src": ["'self'", "https://fonts.googleapis.com"],
    "img-src": ["'self'", "https://*.cookiebot.com", "https://*.google-analytics.com", "https://lh3.googleusercontent.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "connect-src": ["'self'", "https://formspree.io", "https://*.google-analytics.com", "https://*.cookiebot.com", "https://*.firebasedatabase.app", "wss://*.firebasedatabase.app"],
    "frame-src": ["https://consent.cookiebot.com", "https://*.cookiebot.com"],
    "form-action": ["'self'", "https://formspree.io"],
  };
  for (const [name, origins] of Object.entries(required)) {
    for (const origin of origins) assert.ok(csp[name].includes(origin), `${name} lost ${origin}`);
  }

  // The restrictive parts are exactly as strict as before.
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.ok("upgrade-insecure-requests" in csp);
  for (const [name, values] of Object.entries(csp)) {
    for (const value of values) {
      assert.ok(!["'unsafe-eval'", "*", "https:", "http:"].includes(value), `${name} allows ${value}`);
    }
  }
  assert.ok(!csp["script-src"].includes("data:"));
});

// ---------------------------------------------------------------------
// HSTS
// ---------------------------------------------------------------------

test("HSTS: functions send the same policy as the static pages (public/_headers)", async () => {
  const staticHeaders = fs.readFileSync(path.join(REPO, "public", "_headers"), "utf8");
  const match = /^\s*Strict-Transport-Security:\s*(.+)$/m.exec(staticHeaders);
  assert.ok(match, "public/_headers sets Strict-Transport-Security");
  assert.equal(HSTS, match[1].trim(), "netlify/lib/auth.mjs HSTS drifted from public/_headers");

  assert.equal(AUTH_HEADERS["Strict-Transport-Security"], HSTS);
  assert.equal(PAGE_HEADERS["Strict-Transport-Security"], HSTS);
  assert.equal(json(200, {}).headers.get("strict-transport-security"), HSTS);
  assert.equal(redirect("/").headers.get("strict-transport-security"), HSTS);

  const responses = [
    await authSession(new Request(`${ORIGIN}/api/auth/session`)),
    await authSession(new Request(`${ORIGIN}/api/auth/session`, { method: "POST" })),
    await googleStart(new Request(`${ORIGIN}/api/auth/google/start?intent=bogus`)),
    await emailStart(startRequest({ email: EMAIL }, { origin: null })),
    await emailVerify(new Request(`${ORIGIN}/api/auth/email/verify`)),
  ];
  for (const res of responses) {
    assert.equal(res.headers.get("strict-transport-security"), HSTS, `status ${res.status}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});
