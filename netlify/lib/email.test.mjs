/**
 * Phase 4A tests: email magic-link sign-in (start + verify), the email
 * cookie, provider detection, and that Google is unaffected. Supabase is
 * never contacted — global fetch is replaced by a router that records every
 * request, as in google.test.mjs.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

import emailStart, { config as startConfig } from "../functions/auth-email-start.mjs";
import emailVerify, { config as verifyConfig } from "../functions/auth-email-verify.mjs";
import authSession from "../functions/auth-session.mjs";
import googleStart from "../functions/auth-google-start.mjs";
import {
  EMAIL_COOKIE,
  OAUTH_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  currentProviders,
  resetProviderCache,
  supabaseConfig,
} from "./auth.mjs";
import { newTransaction, openTransaction, sealTransaction } from "./oauth.mjs";
import {
  EMAIL_TTL_SECONDS,
  PAGE_HEADERS,
  confirmationPage,
  escapeHtml,
  looksLikeEmail,
  looksLikeTokenHash,
  newEmailTransaction,
  openEmailTransaction,
  sealEmailTransaction,
} from "./email.mjs";

const ORIGIN = "https://bpozz.com";
const SUPABASE = "https://example-project.supabase.co";
const ENV = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key-FAKE-1234",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-FAKE-5678",
  AUTH_ORIGIN: ORIGIN,
  AUTH_COOKIE_SECRET: "cookie-secret-FAKE-0123456789abcdefghijklmnop",
  AUTH_EMAIL_ENABLED: "true",
};
const SECRET = ENV.AUTH_COOKIE_SECRET;
const EMAIL = "reader@example.com";
// The shape Supabase issues: hex(SHA-224(email + otp)), 56 characters.
const TOKEN_HASH = createHash("sha224").update(`${EMAIL}123456`).digest("hex");
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.b2xkLWFjY2Vzcw";
const NEW_ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.bmV3LWFjY2Vzcw";
const FRESH_ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.ZnJlc2gtYWNjZXNz";
const REFRESH = "refresh-FAKE-old-abc123";
const NEW_REFRESH = "refresh-FAKE-new-def456";
const USER = {
  id: "user-2",
  email: EMAIL,
  user_metadata: {},
  app_metadata: { provider: "email" },
};
const SESSION_RESPONSE = {
  access_token: NEW_ACCESS,
  refresh_token: NEW_REFRESH,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  user: USER,
};

const realFetch = globalThis.fetch;
const realError = console.error;
let savedEnv;
let calls;
let logs;
let routes;

function setEnv(values) {
  for (const key of Object.keys(ENV)) delete process.env[key];
  Object.assign(process.env, values);
}

function route(key, respond) {
  routes[key] = respond;
}

function settings({ google = true, email = true } = {}) {
  route("GET /auth/v1/settings", () => Response.json({ external: { google, email } }));
}

beforeEach(() => {
  savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  setEnv(ENV);
  resetProviderCache();
  calls = [];
  logs = [];
  routes = {};
  settings();
  console.error = (...args) => logs.push(args.join(" "));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = {
      url,
      method: init.method || "GET",
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const respond = routes[`${call.method} ${url.pathname}`];
    if (!respond) throw new Error(`unexpected Supabase call ${call.method} ${url.pathname}`);
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

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function startRequest(body, { origin = ORIGIN, method = "POST", type = "application/json", cookie, raw } = {}) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (type) headers.set("content-type", type);
  if (cookie) headers.set("cookie", cookie);
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") init.body = raw !== undefined ? raw : JSON.stringify(body);
  return new Request(`${ORIGIN}/api/auth/email/start`, init);
}

function verifyGet(query, { cookie, method = "GET" } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${ORIGIN}/api/auth/email/verify${query}`, { method, headers });
}

function verifyPost(form, { origin = ORIGIN, cookie, type = "application/x-www-form-urlencoded", query = "" } = {}) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (type) headers.set("content-type", type);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${ORIGIN}/api/auth/email/verify${query}`, { method: "POST", headers, body: form });
}

function setCookies(res) {
  const out = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split("; ");
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs, line };
  }
  return out;
}

function assertSecureCookie(cookie, name) {
  assert.ok(name.startsWith("__Host-"), `${name} lacks the __Host- prefix`);
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
    assert.ok(cookie.attrs.includes(attr), `${name} lacks ${attr}`);
  }
  assert.ok(!cookie.line.toLowerCase().includes("domain="), `${name} has a Domain`);
}

function assertEmailCleared(res) {
  const cleared = setCookies(res)[EMAIL_COOKIE];
  assert.ok(cleared, "email cookie not cleared");
  assert.equal(cleared.value, "");
  assert.ok(cleared.attrs.includes("Max-Age=0"));
  assertSecureCookie(cleared, EMAIL_COOKIE);
}

function emailCookie(returnTo = "/guides/?q=color", overrides = {}, secret = SECRET) {
  const tx = { ...newEmailTransaction(returnTo), ...overrides };
  return `${EMAIL_COOKIE}=${sealEmailTransaction(tx, secret)}`;
}

const supabaseCalls = (path) => calls.filter((c) => c.url.pathname === path);

const SENSITIVE = [
  ACCESS, NEW_ACCESS, FRESH_ACCESS, REFRESH, NEW_REFRESH, TOKEN_HASH, EMAIL,
  ENV.SUPABASE_ANON_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY, SECRET,
];

function assertNoLeak(text, extra = []) {
  for (const value of [...SENSITIVE, ...extra]) {
    assert.ok(!text.includes(value), `leaked ${value.slice(0, 12)}…`);
  }
}

// ---------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------

test("email functions are routed at their paths with conservative Netlify rate limits", () => {
  assert.deepEqual(startConfig, {
    path: "/api/auth/email/start",
    rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] },
  });
  assert.deepEqual(verifyConfig, {
    path: "/api/auth/email/verify",
    rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
  });
});

// Netlify reads `export const config` STATICALLY at deploy time and keeps
// only literal values. An imported constant (`path: START_PATH`) is correct
// at runtime — so the import-based test above passes — but Netlify reads it
// as undefined and registers no route: in production the function answered
// only at /.netlify/functions/<name> and /api/auth/email/* was a 404.
// This checks the source text itself: the config object must evaluate in an
// empty context, where any identifier throws a ReferenceError.
test("every function's config is literal-only source, so Netlify can read its route", () => {
  const expected = {
    "auth-email-start.mjs": "/api/auth/email/start",
    "auth-email-verify.mjs": "/api/auth/email/verify",
    "auth-google-callback.mjs": "/api/auth/google/callback",
    "auth-google-start.mjs": "/api/auth/google/start",
    "auth-session.mjs": "/api/auth/session",
    "auth-signout.mjs": "/api/auth/signout",
    "saved-import.mjs": "/api/saved/import",
    "saved.mjs": "/api/saved",
  };
  const dir = new URL("../functions/", import.meta.url);
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(expected).sort());

  for (const [file, route] of Object.entries(expected)) {
    const source = fs.readFileSync(new URL(file, dir), "utf8");
    const match = /^export const config = (\{[\s\S]*?\});$/m.exec(source);
    assert.ok(match, `${file}: no top-level \`export const config = {…};\``);
    let config;
    assert.doesNotThrow(() => {
      config = vm.runInNewContext(`(${match[1]})`, Object.create(null));
    }, `${file}: config uses a non-literal value Netlify can't read statically`);
    assert.equal(config.path, route, `${file}: route`);
    assert.match(match[1], new RegExp(`path: "${route.replace(/\//g, "\\/")}"`), `${file}: path is a string literal`);
  }
});

test("the literal-only check rejects an imported path (the 9d6e9b3 mistake)", () => {
  const broken = `{ path: START_PATH, rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] } }`;
  // The error comes from the vm's own realm, so match by name, not class.
  assert.throws(
    () => vm.runInNewContext(`(${broken})`, Object.create(null)),
    (error) => error.name === "ReferenceError" && /START_PATH/.test(error.message),
  );
});

// ---------------------------------------------------------------------
// provider detection
// ---------------------------------------------------------------------

test("providers.email: true only with valid config + AUTH_EMAIL_ENABLED=true + Supabase external.email", async () => {
  const cfg = supabaseConfig(process.env);
  assert.deepEqual(await currentProviders(cfg, process.env), { google: true, email: true });

  for (const flag of [undefined, "", "false", "TRUE", "True", " true", "1", "yes"]) {
    resetProviderCache();
    const env = { ...ENV, AUTH_EMAIL_ENABLED: flag };
    if (flag === undefined) delete env.AUTH_EMAIL_ENABLED;
    assert.deepEqual(await currentProviders(cfg, env), { google: true, email: false }, `flag ${flag}`);
  }

  resetProviderCache();
  settings({ google: true, email: false });
  assert.deepEqual(await currentProviders(cfg, process.env), { google: true, email: false });

  resetProviderCache();
  route("GET /auth/v1/settings", () => new Response("down", { status: 503 }));
  assert.deepEqual(await currentProviders(cfg, process.env), { google: false, email: false });

  // Not fully configured (short cookie secret): neither, and no request.
  resetProviderCache();
  calls = [];
  const short = { ...ENV, AUTH_COOKIE_SECRET: "too-short" };
  assert.deepEqual(await currentProviders(cfg, short), { google: false, email: false });
  assert.equal(calls.length, 0);
});

test("providers: one cached /settings request serves both providers", async () => {
  const cfg = supabaseConfig(process.env);
  await currentProviders(cfg, process.env);
  await currentProviders(cfg, process.env);
  assert.equal(supabaseCalls("/auth/v1/settings").length, 1);
});

test("Google regression: providers.google is identical with the email flag on or off", async () => {
  const cfg = supabaseConfig(process.env);
  for (const external of [
    { google: true, email: true },
    { google: true, email: false },
    { google: false, email: true },
    { google: false, email: false },
    { google: "true", email: "true" },
    {},
  ]) {
    const results = [];
    for (const flag of ["true", undefined]) {
      resetProviderCache();
      route("GET /auth/v1/settings", () => Response.json({ external }));
      const env = { ...ENV, AUTH_EMAIL_ENABLED: flag };
      if (flag === undefined) delete env.AUTH_EMAIL_ENABLED;
      results.push((await currentProviders(cfg, env)).google);
    }
    assert.equal(results[0], results[1], JSON.stringify(external));
    assert.equal(results[0], external.google === true);
  }
});

test("session endpoint reports providers.email from the flag", async () => {
  let res = await authSession(new Request(`${ORIGIN}/api/auth/session`));
  assert.deepEqual((await res.json()).providers, { google: true, email: true });

  delete process.env.AUTH_EMAIL_ENABLED;
  resetProviderCache();
  res = await authSession(new Request(`${ORIGIN}/api/auth/session`));
  assert.deepEqual(await res.json(), {
    authenticated: false,
    user: null,
    providers: { google: true, email: false },
  });
});

test("Google regression: start redirect is unchanged with the email flag on", async () => {
  const res = await googleStart(
    new Request(`${ORIGIN}/api/auth/google/start?intent=signin&return_to=/guides/`),
  );
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get("location"));
  assert.equal(location.origin + location.pathname, `${SUPABASE}/auth/v1/authorize`);
  assert.equal(location.searchParams.get("provider"), "google");
  const cookie = setCookies(res)[OAUTH_COOKIE];
  assert.ok(cookie);
  assert.equal(openTransaction(cookie.value, SECRET).status, "ok");
  assert.equal(setCookies(res)[EMAIL_COOKIE], undefined);
});

// ---------------------------------------------------------------------
// POST /api/auth/email/start
// ---------------------------------------------------------------------

function otpOk() {
  route("POST /auth/v1/otp", () => Response.json({}));
}

test("start: only POST", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await emailStart(startRequest(null, { method }));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls.length, 0);
});

test("start: flag off -> 503 and no Supabase request of any kind", async () => {
  otpOk();
  for (const flag of [undefined, "false", "TRUE"]) {
    if (flag === undefined) delete process.env.AUTH_EMAIL_ENABLED;
    else process.env.AUTH_EMAIL_ENABLED = flag;
    const res = await emailStart(startRequest({ email: EMAIL }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "auth_unavailable" });
    assert.deepEqual(setCookies(res), {});
  }
  assert.equal(calls.length, 0);
});

test("start: not configured -> 503, variable names logged, values not", async () => {
  process.env.AUTH_COOKIE_SECRET = "short";
  const res = await emailStart(startRequest({ email: EMAIL }));
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => l.includes("AUTH_COOKIE_SECRET")));
  assertNoLeak(logs.join("\n"));
});

test("start: Origin must be exactly AUTH_ORIGIN", async () => {
  otpOk();
  for (const origin of [null, "null", "https://evil.example", "http://bpozz.com", "https://bpozz.com.evil.example", "https://www.bpozz.com", "https://bpozz.com/"]) {
    const res = await emailStart(startRequest({ email: EMAIL }, { origin }));
    assert.equal(res.status, 403, `origin ${origin}`);
    assert.deepEqual(await res.json(), { error: "forbidden" });
    assert.deepEqual(setCookies(res), {});
  }
  assert.equal(calls.length, 0);
});

test("start: malformed requests -> 400 before any Supabase request", async () => {
  otpOk();
  const bad = [
    [{ email: EMAIL }, { type: "text/plain" }],
    [{ email: EMAIL }, { type: "application/x-www-form-urlencoded" }],
    [{ email: EMAIL }, { type: null }],
    [null, { raw: "{not json" }],
    [null, { raw: "" }],
    [null, { raw: "[]" }],
    [null, { raw: "null" }],
    [null, { raw: JSON.stringify({ email: EMAIL, pad: "x".repeat(2100) }) }],
    [{}, {}],
    [{ email: 42 }, {}],
    [{ email: ["a@b.co"] }, {}],
    [{ email: "" }, {}],
    [{ email: "no-at-sign.example.com" }, {}],
    [{ email: "two@@example.com" }, {}],
    [{ email: "space in@example.com" }, {}],
    [{ email: "a@nodot" }, {}],
    [{ email: "<script>@example.com" }, {}],
    [{ email: "ctrl\u0000@example.com" }, {}],
    [{ email: `${"a".repeat(250)}@x.co` }, {}],
    [{ email: EMAIL, intent: "admin" }, {}],
    [{ email: EMAIL, returnTo: { path: "/" } }, {}],
  ];
  for (const [body, opts] of bad) {
    const res = await emailStart(startRequest(body, opts));
    assert.equal(res.status, 400, JSON.stringify(opts.raw ?? body).slice(0, 60));
    assert.deepEqual(await res.json(), { error: "invalid_request" });
    assert.deepEqual(setCookies(res), {});
  }
  assert.equal(calls.length, 0);
});

test("start: a declared Content-Length over 2 KB is refused unread", async () => {
  otpOk();
  const headers = new Headers({ origin: ORIGIN, "content-type": "application/json", "content-length": "5000" });
  const res = await emailStart(
    new Request(`${ORIGIN}/api/auth/email/start`, { method: "POST", headers, body: JSON.stringify({ email: EMAIL }) }),
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("start: Email disabled in Supabase or Supabase unreachable -> 503, no OTP request", async () => {
  otpOk();
  for (const respond of [
    () => Response.json({ external: { google: true, email: false } }),
    () => new Response("down", { status: 503 }),
    () => { throw new TypeError("fetch failed"); },
  ]) {
    resetProviderCache();
    route("GET /auth/v1/settings", respond);
    const res = await emailStart(startRequest({ email: EMAIL }));
    assert.equal(res.status, 503);
  }
  assert.equal(supabaseCalls("/auth/v1/otp").length, 0);
});

test("start: success -> Supabase /otp with create_user, anon key only; 200 + signed email cookie", async () => {
  otpOk();
  const res = await emailStart(startRequest({ email: `  ${EMAIL} `, intent: "signin", returnTo: "/guides/?q=color#top" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: true });
  assert.equal(res.headers.get("cache-control"), "no-store");

  const [otp] = supabaseCalls("/auth/v1/otp");
  assert.equal(otp.method, "POST");
  assert.equal(otp.url.origin, SUPABASE);
  assert.equal(otp.url.search, "", "no redirect_to: the link comes from the email template");
  assert.deepEqual(otp.body, { email: EMAIL, create_user: true });
  assert.equal(otp.headers.get("apikey"), ENV.SUPABASE_ANON_KEY);
  assert.equal(otp.headers.get("authorization"), null);
  for (const call of calls) {
    assert.ok(![...call.headers.values()].some((v) => v.includes(ENV.SUPABASE_SERVICE_ROLE_KEY)));
  }

  const cookies = setCookies(res);
  assert.deepEqual(Object.keys(cookies), [EMAIL_COOKIE]);
  const cookie = cookies[EMAIL_COOKIE];
  assertSecureCookie(cookie, EMAIL_COOKIE);
  assert.ok(cookie.attrs.includes(`Max-Age=${EMAIL_TTL_SECONDS}`));
  const opened = openEmailTransaction(cookie.value, SECRET);
  assert.equal(opened.status, "ok");
  assert.equal(opened.transaction.returnTo, "/guides/?q=color#top");
  // Only a return path and an expiry: no address, no token.
  const payload = Buffer.from(cookie.value.split(".")[0], "base64url").toString("utf8");
  assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ["expiresAt", "returnTo", "v"]);
  assertNoLeak(payload);
  assertNoLeak(logs.join("\n"));
});

test("start: intent is optional and does not change the request", async () => {
  otpOk();
  for (const intent of [undefined, "signin", "signup"]) {
    calls = [];
    const res = await emailStart(startRequest({ email: EMAIL, intent }));
    assert.equal(res.status, 200);
    assert.deepEqual(supabaseCalls("/auth/v1/otp")[0].body, { email: EMAIL, create_user: true });
  }
});

test("start: open-redirect attempts in returnTo collapse to /", async () => {
  otpOk();
  for (const returnTo of [undefined, "", "https://evil.example/", "//evil.example", "/\\evil.example", "/api/auth/session", "javascript:alert(1)", "/ok\u0000"]) {
    const res = await emailStart(startRequest({ email: EMAIL, returnTo }));
    assert.equal(res.status, 200);
    const opened = openEmailTransaction(setCookies(res)[EMAIL_COOKIE].value, SECRET);
    assert.equal(opened.transaction.returnTo, "/", String(returnTo));
  }
});

test("start: refusals that could reveal whether an account exists look exactly like a send", async () => {
  otpOk();
  const ok = await emailStart(startRequest({ email: EMAIL }));
  const okBody = await ok.json();
  const okCookie = setCookies(ok)[EMAIL_COOKIE];

  for (const [status, body] of [
    [422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" }],
    [422, { code: 422, error_code: "signup_disabled", msg: "Signups not allowed for this instance" }],
    [422, { error_code: "user_banned" }],
    [403, { error_code: "user_not_found" }],
    [404, { error_code: "user_not_found" }],
  ]) {
    route("POST /auth/v1/otp", () => Response.json(body, { status }));
    const res = await emailStart(startRequest({ email: EMAIL }));
    assert.equal(res.status, 200, `${status} ${body.error_code}`);
    assert.deepEqual(await res.json(), okBody);
    const cookie = setCookies(res)[EMAIL_COOKIE];
    assert.ok(cookie, "the masked answer sets the same cookie");
    assert.deepEqual(cookie.attrs, okCookie.attrs);
    assert.deepEqual([...res.headers.keys()].sort(), [...ok.headers.keys()].sort());
  }
  assertNoLeak(logs.join("\n"));
});

test("start: Supabase 400 -> 400; 429 -> 429; SMTP not set up, 5xx, bad key, network -> 503", async () => {
  const cases = [
    [() => Response.json({ error_code: "validation_failed", msg: "Unable to validate email address: invalid format" }, { status: 400 }), 400, { error: "invalid_request" }],
    [() => Response.json({ error_code: "over_email_send_rate_limit" }, { status: 429 }), 429, { error: "rate_limited" }],
    [() => Response.json({ error_code: "email_address_not_authorized" }, { status: 400 }), 503, { error: "auth_unavailable" }],
    [() => new Response("boom", { status: 500 }), 503, { error: "auth_unavailable" }],
    [() => new Response("bad gateway", { status: 502 }), 503, { error: "auth_unavailable" }],
    [() => Response.json({ message: "Invalid API key" }, { status: 401 }), 503, { error: "auth_unavailable" }],
    [() => { throw new TypeError("fetch failed"); }, 503, { error: "auth_unavailable" }],
    [() => new Response("<html>", { status: 200 }), 503, { error: "auth_unavailable" }],
  ];
  for (const [respond, status, body] of cases) {
    route("POST /auth/v1/otp", respond);
    const res = await emailStart(startRequest({ email: EMAIL }));
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), body);
    assert.deepEqual(setCookies(res), {}, "no email cookie unless the answer is 'sent'");
  }
  assertNoLeak(logs.join("\n"));
});

// ---------------------------------------------------------------------
// the email cookie
// ---------------------------------------------------------------------

test("email cookie: round trip, tampering, other secret, expiry, shape", () => {
  const now = Date.now();
  const tx = newEmailTransaction("/guides/", now);
  const value = sealEmailTransaction(tx, SECRET);
  assert.deepEqual(openEmailTransaction(value, SECRET, now), { status: "ok", transaction: tx });

  const [data, mac] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ ...tx, returnTo: "/evil" })).toString("base64url");
  assert.equal(openEmailTransaction(`${forged}.${mac}`, SECRET, now).status, "invalid");
  assert.equal(openEmailTransaction(`${data}.${mac.slice(0, -2)}AA`, SECRET, now).status, "invalid");
  assert.equal(openEmailTransaction(`${data}.${mac}.x`, SECRET, now).status, "invalid");
  assert.equal(openEmailTransaction(value, "another-secret-0123456789abcdefghijkl", now).status, "invalid");
  assert.equal(openEmailTransaction(undefined, SECRET).status, "missing");
  assert.equal(openEmailTransaction("", SECRET).status, "missing");
  assert.equal(openEmailTransaction("x".repeat(5000), SECRET).status, "invalid");
  assert.equal(openEmailTransaction(value, SECRET, (tx.expiresAt + 1) * 1000).status, "expired");
  assert.equal(EMAIL_TTL_SECONDS, 3600);
  assert.equal(tx.expiresAt, Math.floor(now / 1000) + 3600);

  // Correctly signed but not a valid email transaction.
  for (const bad of [
    { ...tx, returnTo: "//evil.example" },
    { ...tx, returnTo: "https://evil.example" },
    { ...tx, v: 2 },
    { ...tx, expiresAt: "soon" },
    { ...tx, email: EMAIL },
  ]) {
    assert.equal(openEmailTransaction(sealEmailTransaction(bad, SECRET), SECRET, now).status, "invalid");
  }
});

test("email and Google cookies use separate MAC contexts: neither opens as the other", () => {
  const google = sealTransaction(newTransaction("signin", "/"), SECRET);
  assert.equal(openEmailTransaction(google, SECRET).status, "invalid");
  const email = sealEmailTransaction(newEmailTransaction("/"), SECRET);
  assert.equal(openTransaction(email, SECRET).status, "invalid");
  // Even a payload shaped for the other flow, re-signed by the wrong flow.
  const [data] = google.split(".");
  const [, emailMac] = sealEmailTransaction(newEmailTransaction("/"), SECRET).split(".");
  assert.equal(openTransaction(`${data}.${emailMac}`, SECRET).status, "invalid");
});

test("token_hash and email shape checks", () => {
  assert.equal(TOKEN_HASH.length, 56);
  assert.ok(looksLikeTokenHash(TOKEN_HASH));
  for (const bad of [
    undefined, null, 42, "", TOKEN_HASH.toUpperCase(), TOKEN_HASH.slice(1), `${TOKEN_HASH}0`,
    `${TOKEN_HASH.slice(1)}g`, `${TOKEN_HASH.slice(2)} a`, `pkce_${TOKEN_HASH.slice(5)}`, `${TOKEN_HASH.slice(1)}"`,
  ]) {
    assert.equal(looksLikeTokenHash(bad), false, String(bad));
  }
  assert.ok(looksLikeEmail("a.b+c@sub.example.co.uk"));
  assert.equal(looksLikeEmail(`${"a".repeat(249)}@x.co`), true, "254 characters is allowed");
  assert.equal(looksLikeEmail(`${"a".repeat(250)}@x.co`), false, "255 is not");
});

// ---------------------------------------------------------------------
// GET /api/auth/email/verify
// ---------------------------------------------------------------------

function verifyOk() {
  route("POST /auth/v1/verify", () => Response.json(SESSION_RESPONSE));
}

test("verify: only GET and POST", async () => {
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const res = await emailVerify(verifyGet("", { method }));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, POST");
  }
});

test("verify GET: flag off -> /?auth_error=unavailable, nothing asked of Supabase", async () => {
  delete process.env.AUTH_EMAIL_ENABLED;
  const res = await emailVerify(verifyGet(`?token_hash=${TOKEN_HASH}&type=email`, { cookie: emailCookie() }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/?auth_error=unavailable");
  assert.equal(calls.length, 0);
});

test("verify GET: malformed link -> /?auth_error=link, email cookie cleared, nothing rendered", async () => {
  verifyOk();
  for (const query of [
    "",
    "?type=email",
    `?token_hash=${TOKEN_HASH.toUpperCase()}&type=email`,
    `?token_hash=${TOKEN_HASH.slice(3)}&type=email`,
    `?token_hash=${TOKEN_HASH}%22%3E%3Cscript%3E&type=email`,
    `?token_hash=${TOKEN_HASH}&type=magiclink`,
    `?token_hash=${TOKEN_HASH}&type=recovery`,
  ]) {
    const res = await emailVerify(verifyGet(query, { cookie: emailCookie() }));
    assert.equal(res.status, 303, query);
    assert.equal(res.headers.get("location"), "/?auth_error=link");
    assert.equal(res.headers.get("content-type"), null, "no page rendered");
    assertEmailCleared(res);
  }
  assert.equal(calls.length, 0);
});

test("verify GET: no, tampered or expired email cookie -> /?auth_error=link, token not consumed", async () => {
  verifyOk();
  const expired = emailCookie("/guides/", { expiresAt: Math.floor(Date.now() / 1000) - 1 });
  for (const cookie of [undefined, `${EMAIL_COOKIE}=garbage`, emailCookie("/", {}, "wrong-secret-0123456789abcdefghijklmn"), expired]) {
    const res = await emailVerify(verifyGet(`?token_hash=${TOKEN_HASH}&type=email`, { cookie }));
    assert.equal(res.headers.get("location"), "/?auth_error=link");
    assertEmailCleared(res);
  }
  assert.equal(supabaseCalls("/auth/v1/verify").length, 0);
});

test("verify GET: renders the confirmation page and does NOT consume the token", async () => {
  verifyOk();
  const res = await emailVerify(verifyGet(`?token_hash=${TOKEN_HASH}&type=email`, { cookie: emailCookie("/guides/?q=color") }));
  assert.equal(res.status, 200);
  assert.equal(supabaseCalls("/auth/v1/verify").length, 0, "GET must not call /verify");
  assert.deepEqual(setCookies(res), {}, "GET sets and clears nothing");

  const page = await res.text();
  assert.match(page, new RegExp(`<form method="post" action="/api/auth/email/verify">`));
  assert.ok(page.includes(`<input type="hidden" name="token_hash" value="${TOKEN_HASH}">`));
  assert.match(page, /<button type="submit">Continue<\/button>/);
  assert.ok(page.includes(`<a href="/guides/?q=color">Cancel</a>`));
  assert.ok(!/<script|<link|<img|<iframe|src=|url\(|@import/i.test(page), "no scripts or external assets");
  assert.ok(!/https?:\/\//i.test(page), "no absolute URL at all");
  assert.ok(!/googletagmanager|analytics|cookiebot/i.test(page));
  assert.equal(page.split(TOKEN_HASH).length - 1, 1, "token appears once, in the hidden field");
  assert.ok(!logs.join("\n").includes(TOKEN_HASH), "token not logged");
});

test("verify GET: confirmation page security headers", async () => {
  const res = await emailVerify(verifyGet(`?token_hash=${TOKEN_HASH}&type=email`, { cookie: emailCookie() }));
  assert.equal(res.headers.get("content-security-policy"),
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  // same-origin, not no-referrer: under no-referrer browsers send
  // `Origin: null` on the form POST and the exact-Origin check would fail.
  // same-origin still sends nothing to any other site.
  assert.equal(res.headers.get("referrer-policy"), "same-origin");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.deepEqual(Object.fromEntries(res.headers), Object.fromEntries(new Headers(PAGE_HEADERS)));
});

test("verify GET: `type` may be omitted (Supabase's type is fixed server-side)", async () => {
  const res = await emailVerify(verifyGet(`?token_hash=${TOKEN_HASH}`, { cookie: emailCookie() }));
  assert.equal(res.status, 200);
});

test("confirmation page escapes everything it embeds", () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  const page = confirmationPage(`"><script>alert(1)</script>`, `/"><script>alert(2)</script>`);
  assert.ok(!page.includes("<script"));
  assert.ok(page.includes("&quot;&gt;&lt;script&gt;"));
});

// ---------------------------------------------------------------------
// POST /api/auth/email/verify
// ---------------------------------------------------------------------

const form = (hash = TOKEN_HASH) => `token_hash=${hash}`;

test("verify POST: Origin must be exactly AUTH_ORIGIN — no Supabase call, no cookie change", async () => {
  verifyOk();
  for (const origin of [null, "null", "https://evil.example", "http://bpozz.com", "https://www.bpozz.com"]) {
    const res = await emailVerify(verifyPost(form(), { origin, cookie: emailCookie() }));
    assert.equal(res.status, 403, `origin ${origin}`);
    assert.deepEqual(await res.json(), { error: "forbidden" });
    assert.deepEqual(setCookies(res), {});
  }
  assert.equal(calls.length, 0);
});

test("verify POST: flag off -> unavailable, nothing asked of Supabase", async () => {
  process.env.AUTH_EMAIL_ENABLED = "false";
  const res = await emailVerify(verifyPost(form(), { cookie: emailCookie() }));
  assert.equal(res.headers.get("location"), "/?auth_error=unavailable");
  assert.equal(calls.length, 0);
});

test("verify POST: bad form -> /?auth_error=link, cookie cleared, token never sent", async () => {
  verifyOk();
  for (const [body, type] of [
    ["", undefined],
    ["token_hash=", undefined],
    [form(TOKEN_HASH.toUpperCase()), undefined],
    [form(TOKEN_HASH.slice(1)), undefined],
    [JSON.stringify({ token_hash: TOKEN_HASH }), "application/json"],
    [form(), "text/plain"],
    [`${form()}&pad=${"x".repeat(2100)}`, undefined],
  ]) {
    const res = await emailVerify(verifyPost(body, { cookie: emailCookie(), type }));
    assert.equal(res.headers.get("location"), "/?auth_error=link");
    assertEmailCleared(res);
  }
  assert.equal(supabaseCalls("/auth/v1/verify").length, 0);
});

test("verify POST: no valid email cookie -> /?auth_error=link without spending the token", async () => {
  verifyOk();
  const expired = emailCookie("/guides/", { expiresAt: Math.floor(Date.now() / 1000) - 1 });
  for (const cookie of [undefined, `${EMAIL_COOKIE}=x.y`, expired, `${OAUTH_COOKIE}=${sealTransaction(newTransaction("signin", "/"), SECRET)}`]) {
    const res = await emailVerify(verifyPost(form(), { cookie }));
    assert.equal(res.headers.get("location"), "/?auth_error=link");
    assertEmailCleared(res);
  }
  assert.equal(supabaseCalls("/auth/v1/verify").length, 0);
});

test("verify POST: success -> Supabase /verify type=email, exactly the session cookies, clean redirect", async () => {
  verifyOk();
  const res = await emailVerify(verifyPost(form(), { cookie: emailCookie("/guides/?q=color&auth_error=failed") }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/guides/?q=color", "stale auth_error removed");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("cache-control"), "no-store");

  const [verify] = supabaseCalls("/auth/v1/verify");
  assert.equal(verify.method, "POST");
  assert.deepEqual(verify.body, { type: "email", token_hash: TOKEN_HASH });
  assert.equal(verify.headers.get("apikey"), ENV.SUPABASE_ANON_KEY);
  assert.equal(verify.headers.get("authorization"), null);
  assert.equal(supabaseCalls("/auth/v1/logout").length, 0, "no previous session, nothing revoked");

  const cookies = setCookies(res);
  assert.deepEqual(Object.keys(cookies).sort(), [EMAIL_COOKIE, REFRESH_COOKIE, SESSION_COOKIE].sort());
  assertEmailCleared(res);
  assert.equal(cookies[SESSION_COOKIE].value, NEW_ACCESS);
  assert.ok(cookies[SESSION_COOKIE].attrs.includes("Max-Age=3600"));
  assert.equal(cookies[REFRESH_COOKIE].value, NEW_REFRESH);
  assert.ok(cookies[REFRESH_COOKIE].attrs.includes(`Max-Age=${30 * 24 * 60 * 60}`));
  assertSecureCookie(cookies[SESSION_COOKIE], SESSION_COOKIE);
  assertSecureCookie(cookies[REFRESH_COOKIE], REFRESH_COOKIE);

  const location = res.headers.get("location");
  assertNoLeak(location);
  assert.equal(await res.text(), "", "no body: tokens only ever in HttpOnly cookies");
  assertNoLeak(logs.join("\n"));
});

test("verify POST: return path comes only from the signed cookie, never the URL", async () => {
  verifyOk();
  const res = await emailVerify(
    verifyPost(form(), { cookie: emailCookie("/palettes"), query: "?return_to=//evil.example&returnTo=https://evil.example" }),
  );
  assert.equal(res.headers.get("location"), "/palettes");
});

test("verify POST: a previous session is revoked with its own token before being replaced", async () => {
  verifyOk();
  route("POST /auth/v1/logout", () => new Response(null, { status: 204 }));
  const cookie = `${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}; ${emailCookie("/")}`;
  const res = await emailVerify(verifyPost(form(), { cookie }));
  assert.equal(res.headers.get("location"), "/");
  const order = calls.map((c) => c.url.pathname).filter((p) => p !== "/auth/v1/settings");
  assert.deepEqual(order, ["/auth/v1/verify", "/auth/v1/logout"], "verified first, then the old session revoked");
  const [logout] = supabaseCalls("/auth/v1/logout");
  assert.equal(logout.url.search, "?scope=local");
  assert.equal(logout.headers.get("authorization"), `Bearer ${ACCESS}`);
  assert.equal(setCookies(res)[SESSION_COOKIE].value, NEW_ACCESS);
});

test("verify POST: an expired previous access token is refreshed once, then revoked", async () => {
  verifyOk();
  route("POST /auth/v1/token", () => Response.json({ ...SESSION_RESPONSE, access_token: FRESH_ACCESS, refresh_token: "refresh-FAKE-rotated-1" }));
  route("POST /auth/v1/logout", (call) =>
    call.headers.get("authorization") === `Bearer ${ACCESS}`
      ? Response.json({ error_code: "bad_jwt" }, { status: 401 })
      : new Response(null, { status: 204 }));
  const cookie = `${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}; ${emailCookie("/")}`;
  const res = await emailVerify(verifyPost(form(), { cookie }));
  assert.equal(res.headers.get("location"), "/");
  const refresh = supabaseCalls("/auth/v1/token")[0];
  assert.equal(refresh.url.search, "?grant_type=refresh_token");
  assert.deepEqual(refresh.body, { refresh_token: REFRESH });
  const logouts = supabaseCalls("/auth/v1/logout").map((c) => c.headers.get("authorization"));
  assert.deepEqual(logouts, [`Bearer ${ACCESS}`, `Bearer ${FRESH_ACCESS}`]);
  // The new email session is what the browser keeps — not the refreshed old one.
  assert.equal(setCookies(res)[SESSION_COOKIE].value, NEW_ACCESS);
  assert.equal(setCookies(res)[REFRESH_COOKIE].value, NEW_REFRESH);
});

test("verify POST: revocation failing at Supabase still completes the new sign-in, logged without values", async () => {
  verifyOk();
  route("POST /auth/v1/logout", () => new Response("down", { status: 503 }));
  const cookie = `${SESSION_COOKIE}=${ACCESS}; ${emailCookie("/")}`;
  const res = await emailVerify(verifyPost(form(), { cookie }));
  assert.equal(setCookies(res)[SESSION_COOKIE].value, NEW_ACCESS);
  assert.ok(logs.some((l) => l.includes("could not revoke the previous session")));
  assertNoLeak(logs.join("\n"));
});

test("verify POST: used, expired or invalid token -> return_to?auth_error=link, cookie cleared, old session kept", async () => {
  route("POST /auth/v1/logout", () => new Response(null, { status: 204 }));
  for (const [status, body] of [
    [403, { error_code: "otp_expired", msg: "Email link is invalid or has expired" }],
    [400, { error_code: "validation_failed" }],
    [404, {}],
    [422, {}],
    [401, { error_code: "bad_jwt" }],
  ]) {
    calls = [];
    route("POST /auth/v1/verify", () => Response.json(body, { status }));
    const cookie = `${SESSION_COOKIE}=${ACCESS}; ${emailCookie("/guides/")}`;
    const res = await emailVerify(verifyPost(form(), { cookie }));
    assert.equal(res.headers.get("location"), "/guides/?auth_error=link", String(status));
    const cookies = setCookies(res);
    assert.deepEqual(Object.keys(cookies), [EMAIL_COOKIE]);
    assertEmailCleared(res);
    assert.equal(supabaseCalls("/auth/v1/logout").length, 0, "a failed link never signs the old session out");
  }
});

test("verify POST: Supabase unavailable -> return_to?auth_error=unavailable, email cookie kept for a retry", async () => {
  for (const respond of [
    () => new Response("boom", { status: 500 }),
    () => Response.json({ error_code: "over_request_rate_limit" }, { status: 429 }),
    () => { throw new TypeError("fetch failed"); },
    () => Response.json({ access_token: "not-a-jwt", user: USER }), // unusable session
  ]) {
    route("POST /auth/v1/verify", respond);
    const res = await emailVerify(verifyPost(form(), { cookie: emailCookie("/guides/") }));
    assert.equal(res.headers.get("location"), "/guides/?auth_error=unavailable");
    assert.deepEqual(setCookies(res), {});
  }
  assertNoLeak(logs.join("\n"));
});

test("verify POST: Email switched off in Supabase -> unavailable before the token is spent", async () => {
  verifyOk();
  settings({ google: true, email: false });
  const res = await emailVerify(verifyPost(form(), { cookie: emailCookie("/guides/") }));
  assert.equal(res.headers.get("location"), "/guides/?auth_error=unavailable");
  assert.equal(supabaseCalls("/auth/v1/verify").length, 0);
});

test("logs from the whole email flow never contain the address, token hash or tokens", async () => {
  otpOk();
  verifyOk();
  route("POST /auth/v1/logout", () => new Response("down", { status: 503 }));
  await emailStart(startRequest({ email: EMAIL }));
  route("POST /auth/v1/otp", () => Response.json({ error_code: "otp_disabled" }, { status: 422 }));
  await emailStart(startRequest({ email: EMAIL }));
  await emailVerify(verifyGet(`?token_hash=${TOKEN_HASH}`, { cookie: emailCookie() }));
  await emailVerify(verifyPost(form(), { cookie: `${SESSION_COOKIE}=${ACCESS}; ${emailCookie()}` }));
  route("POST /auth/v1/verify", () => Response.json({}, { status: 403 }));
  await emailVerify(verifyPost(form(), { cookie: emailCookie() }));
  assert.ok(logs.length > 0);
  assertNoLeak(logs.join("\n"));
});

// ---------------------------------------------------------------------
// account linking — documented, not implemented
// ---------------------------------------------------------------------

test("no custom identity linking: the email flow sends only email + create_user to Supabase", async () => {
  // Whether a Google user and an email user with the same address become
  // one Supabase user is decided by Supabase's automatic identity linking.
  // BPOZZ adds nothing; this must be verified against the real project
  // before AUTH_EMAIL_ENABLED is turned on (docs/AUTH.md).
  otpOk();
  await emailStart(startRequest({ email: EMAIL }));
  assert.deepEqual(Object.keys(supabaseCalls("/auth/v1/otp")[0].body).sort(), ["create_user", "email"]);
  verifyOk();
  await emailVerify(verifyPost(form(), { cookie: emailCookie() }));
  assert.deepEqual(Object.keys(supabaseCalls("/auth/v1/verify")[0].body).sort(), ["token_hash", "type"]);
  for (const call of calls) {
    assert.ok(!/identit|link|admin/i.test(call.url.pathname), `unexpected ${call.url.pathname}`);
  }
});
