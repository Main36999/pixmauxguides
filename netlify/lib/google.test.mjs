/**
 * Phase 2 tests: Google sign-in (start + callback), session refresh and
 * sign-out. Supabase is never contacted — global fetch is replaced by a
 * router that records every request, so each test can assert exactly what
 * would have been sent to Supabase and what reached the browser.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import googleStart from "../functions/auth-google-start.mjs";
import googleCallback from "../functions/auth-google-callback.mjs";
import authSession from "../functions/auth-session.mjs";
import signout from "../functions/auth-signout.mjs";
import { OAUTH_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, resetProviderCache } from "./auth.mjs";
import { newTransaction, openTransaction, pkceChallenge, sealTransaction } from "./oauth.mjs";

const ORIGIN = "https://bpozz.com";
const SUPABASE = "https://example-project.supabase.co";
const ENV = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key-FAKE-1234",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-FAKE-5678",
  AUTH_ORIGIN: ORIGIN,
  AUTH_COOKIE_SECRET: "cookie-secret-FAKE-0123456789abcdefghijklmnop",
};
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.b2xkLWFjY2Vzcw";
const NEW_ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.bmV3LWFjY2Vzcw";
const REFRESH = "refresh-FAKE-old-abc123";
const NEW_REFRESH = "refresh-FAKE-new-def456";
const AUTH_CODE = "0b6a4c1e-6f0d-4a8e-9c3b-2f1e7d5a9b10";
const PROVIDER_TOKEN = "ya29.google-provider-token-FAKE";
const USER = {
  id: "user-1",
  email: "designer@example.com",
  user_metadata: { full_name: "Dee Signer", avatar_url: "https://lh3.googleusercontent.com/a/x" },
  app_metadata: { provider: "google" },
};
const SESSION_RESPONSE = {
  access_token: NEW_ACCESS,
  refresh_token: NEW_REFRESH,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  user: USER,
  provider_token: PROVIDER_TOKEN,
  provider_refresh_token: "google-provider-refresh-FAKE",
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

// Supabase double: routes["METHOD /path"] -> () => Response (or throws).
function route(key, respond) {
  routes[key] = respond;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  setEnv(ENV);
  resetProviderCache();
  calls = [];
  logs = [];
  routes = {};
  route("GET /auth/v1/settings", () => Response.json({ external: { google: true, email: true } }));
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

function get(path, { cookie, method = "GET", origin } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return new Request(`${ORIGIN}${path}`, { method, headers });
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

function sealed(overrides = {}, secret = ENV.AUTH_COOKIE_SECRET) {
  const tx = { ...newTransaction("signin", "/guides/?q=color"), ...overrides };
  return { tx, cookie: `${OAUTH_COOKIE}=${sealTransaction(tx, secret)}` };
}

const SENSITIVE = [
  ACCESS, NEW_ACCESS, REFRESH, NEW_REFRESH, AUTH_CODE, PROVIDER_TOKEN,
  ENV.SUPABASE_ANON_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.AUTH_COOKIE_SECRET,
];

function assertNoLeak(text, extra = []) {
  for (const value of [...SENSITIVE, ...extra]) {
    assert.ok(!text.includes(value), `leaked ${value.slice(0, 12)}…`);
  }
}

function assertCleanLogs(extra = []) {
  for (const line of logs) assertNoLeak(line, extra);
}

// ---------------------------------------------------------------------
// GET /api/auth/google/start
// ---------------------------------------------------------------------

test("start: only GET", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await googleStart(get("/api/auth/google/start?intent=signin", { method }));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("start: missing or invalid intent is refused without starting a flow", async () => {
  for (const query of ["", "?return_to=/fonts/", "?intent=admin&return_to=/fonts/", "?intent=SIGNIN"]) {
    const res = await googleStart(get(`/api/auth/google/start${query}`));
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /^\/(fonts\/)?\?auth_error=failed$/);
    assert.deepEqual(setCookies(res), {});
    assert.equal(calls.length, 0);
  }
});

test("start: redirects to Supabase authorize with PKCE S256, state and a signed cookie", async () => {
  const res = await googleStart(get("/api/auth/google/start?intent=signup&return_to=%2Fpalettes%2F%3Fp%3D1"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");

  const location = new URL(res.headers.get("location"));
  assert.equal(location.origin + location.pathname, `${SUPABASE}/auth/v1/authorize`);
  assert.equal(location.searchParams.get("provider"), "google");
  assert.equal(location.searchParams.get("code_challenge_method"), "s256");

  const cookie = setCookies(res)[OAUTH_COOKIE];
  assertSecureCookie(cookie, OAUTH_COOKIE);
  assert.ok(cookie.attrs.includes("Max-Age=600"), "transaction must expire in 10 minutes");

  const opened = openTransaction(cookie.value, ENV.AUTH_COOKIE_SECRET);
  assert.equal(opened.status, "ok");
  const tx = opened.transaction;
  assert.equal(tx.intent, "signup");
  assert.equal(tx.returnTo, "/palettes/?p=1");
  assert.match(tx.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tx.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tx.state, tx.verifier);

  assert.equal(location.searchParams.get("code_challenge"), pkceChallenge(tx.verifier));
  assert.equal(
    location.searchParams.get("redirect_to"),
    `${ORIGIN}/api/auth/google/callback?state=${tx.state}`,
  );
  // The verifier never leaves the HttpOnly cookie.
  assert.ok(!res.headers.get("location").includes(tx.verifier));
  assertCleanLogs([tx.state, tx.verifier]);
});

test("start: RFC 7636 S256 challenge is computed correctly", () => {
  // Appendix B test vector.
  assert.equal(
    pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("start: every flow gets fresh random state and verifier", async () => {
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const res = await googleStart(get("/api/auth/google/start?intent=signin&return_to=/"));
    const { transaction } = openTransaction(setCookies(res)[OAUTH_COOKIE].value, ENV.AUTH_COOKIE_SECRET);
    seen.add(transaction.state);
    seen.add(transaction.verifier);
  }
  assert.equal(seen.size, 10);
});

test("start: open-redirect attempts in return_to collapse to /", async () => {
  for (const evil of [
    "//evil.example",
    "https://evil.example",
    "https://evil.example/path",
    "/\\evil.example",
    "javascript:alert(1)",
    "/api/auth/signout",
  ]) {
    const res = await googleStart(
      get(`/api/auth/google/start?intent=signin&return_to=${encodeURIComponent(evil)}`),
    );
    const { transaction } = openTransaction(setCookies(res)[OAUTH_COOKIE].value, ENV.AUTH_COOKIE_SECRET);
    assert.equal(transaction.returnTo, "/", evil);
  }
});

test("start: not configured -> back with auth_error=unavailable, no cookie, names logged", async () => {
  const cases = [
    [{ ...ENV, AUTH_COOKIE_SECRET: "" }, "AUTH_COOKIE_SECRET"],
    [{ ...ENV, AUTH_COOKIE_SECRET: "too-short" }, "AUTH_COOKIE_SECRET"],
    [{ ...ENV, AUTH_ORIGIN: "" }, "AUTH_ORIGIN"],
    [{ ...ENV, AUTH_ORIGIN: "http://bpozz.com" }, "AUTH_ORIGIN"],
    [{ ...ENV, AUTH_ORIGIN: "https://bpozz.com/path" }, "AUTH_ORIGIN"],
    [{ ...ENV, SUPABASE_ANON_KEY: "" }, "SUPABASE_ANON_KEY"],
  ];
  for (const [env, name] of cases) {
    setEnv(env);
    logs = [];
    const res = await googleStart(get("/api/auth/google/start?intent=signin&return_to=/fonts/"));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/fonts/?auth_error=unavailable");
    assert.deepEqual(setCookies(res), {});
    assert.ok(logs.some((l) => l.includes(name)), `expected ${name} in logs`);
    assertCleanLogs();
  }
});

test("start: Google disabled in Supabase, or Supabase down -> unavailable", async () => {
  for (const respond of [
    () => Response.json({ external: { google: false } }),
    () => new Response("down", { status: 503 }),
    () => {
      throw new TypeError("fetch failed");
    },
  ]) {
    resetProviderCache();
    route("GET /auth/v1/settings", respond);
    const res = await googleStart(get("/api/auth/google/start?intent=signin&return_to=/"));
    assert.equal(res.headers.get("location"), "/?auth_error=unavailable");
    assert.deepEqual(setCookies(res), {});
  }
});

// ---------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------

function callback(query, cookie) {
  return googleCallback(get(`/api/auth/google/callback${query}`, { cookie }));
}

function assertTransactionCleared(res) {
  const cleared = setCookies(res)[OAUTH_COOKIE];
  assert.ok(cleared, "transaction cookie not cleared");
  assert.equal(cleared.value, "");
  assert.ok(cleared.attrs.includes("Max-Age=0"));
  assertSecureCookie(cleared, OAUTH_COOKIE);
}

test("callback: only GET", async () => {
  const res = await googleCallback(get("/api/auth/google/callback", { method: "POST" }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("callback: success exchanges code + verifier, sets session cookies, lands on return_to clean", async () => {
  route("POST /auth/v1/token", () => Response.json(SESSION_RESPONSE));
  const { tx, cookie } = sealed({ returnTo: "/guides/?q=color&auth_error=cancelled" });
  const res = await callback(`?state=${tx.state}&code=${AUTH_CODE}`, cookie);

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/guides/?q=color", "stale auth_error kept or wrong target");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");

  // Exactly one Supabase call: the PKCE exchange, with the cookie's verifier.
  assert.equal(calls.length, 1);
  const [exchange] = calls;
  assert.equal(exchange.method, "POST");
  assert.equal(exchange.url.pathname, "/auth/v1/token");
  assert.equal(exchange.url.searchParams.get("grant_type"), "pkce");
  assert.deepEqual(exchange.body, { auth_code: AUTH_CODE, code_verifier: tx.verifier });
  assert.equal(exchange.headers.get("apikey"), ENV.SUPABASE_ANON_KEY);
  assert.ok(![...exchange.headers.values()].includes(ENV.SUPABASE_SERVICE_ROLE_KEY));

  const cookies = setCookies(res);
  assertSecureCookie(cookies[SESSION_COOKIE], SESSION_COOKIE);
  assertSecureCookie(cookies[REFRESH_COOKIE], REFRESH_COOKIE);
  assert.equal(cookies[SESSION_COOKIE].value, NEW_ACCESS);
  assert.equal(cookies[REFRESH_COOKIE].value, NEW_REFRESH);
  assert.ok(cookies[SESSION_COOKIE].attrs.includes("Max-Age=3600"));
  assert.ok(cookies[REFRESH_COOKIE].attrs.includes("Max-Age=2592000"));
  assertTransactionCleared(res);

  // Google's own tokens are dropped; nothing sensitive in the URL or body.
  const everything = [...res.headers].map((h) => h.join(": ")).join("\n");
  assert.ok(!everything.includes(PROVIDER_TOKEN) && !everything.includes("google-provider-refresh"));
  const location = res.headers.get("location");
  assertNoLeak(location, [tx.state, tx.verifier]);
  assert.equal(await res.text(), "");
  assertCleanLogs([tx.state, tx.verifier]);
});

test("callback: missing, malformed, tampered, foreign-key or expired cookie -> /?auth_error=expired", async () => {
  const { tx, cookie } = sealed();
  const [data, sig] = cookie.slice(OAUTH_COOKIE.length + 1).split(".");
  const edited = Buffer.from(
    JSON.stringify({ ...tx, returnTo: "/elsewhere/" }),
  ).toString("base64url");
  const cases = {
    missing: undefined,
    garbage: `${OAUTH_COOKIE}=not-a-transaction`,
    "edited payload": `${OAUTH_COOKIE}=${edited}.${sig}`,
    "bad signature": `${OAUTH_COOKIE}=${data}.${sig.slice(0, -2)}AA`,
    "other secret": sealed({ state: tx.state }, "some-other-secret-0123456789abcdefghij").cookie,
    expired: sealed({ state: tx.state, expiresAt: Math.floor(Date.now() / 1000) - 1 }).cookie,
  };
  for (const [label, jar] of Object.entries(cases)) {
    calls = [];
    const res = await callback(`?state=${tx.state}&code=${AUTH_CODE}`, jar);
    assert.equal(res.status, 303, label);
    assert.equal(res.headers.get("location"), "/?auth_error=expired", label);
    assert.equal(calls.length, 0, `${label}: exchanged anyway`);
    assert.equal(setCookies(res)[SESSION_COOKIE], undefined, label);
    assertTransactionCleared(res);
  }
});

test("callback: state missing, malformed or mismatched -> failed, no exchange", async () => {
  const { tx, cookie } = sealed();
  for (const query of [
    `?code=${AUTH_CODE}`,
    `?state=&code=${AUTH_CODE}`,
    `?state=short&code=${AUTH_CODE}`,
    `?state=${tx.state.slice(0, -1)}X&code=${AUTH_CODE}`,
    `?state=${encodeURIComponent(tx.state + "'")}&code=${AUTH_CODE}`,
  ]) {
    const res = await callback(query, cookie);
    assert.equal(res.headers.get("location"), "/guides/?q=color&auth_error=failed", query);
    assert.equal(calls.length, 0);
    assertTransactionCleared(res);
  }
  assertCleanLogs([tx.state, tx.verifier]);
});

test("callback: user cancelled at Google -> cancelled; other OAuth errors -> failed", async () => {
  const { tx, cookie } = sealed();
  const cancelled = await callback(
    `?state=${tx.state}&error=access_denied&error_description=The+user+denied`,
    cookie,
  );
  assert.equal(cancelled.headers.get("location"), "/guides/?q=color&auth_error=cancelled");
  const failed = await callback(`?state=${tx.state}&error=server_error&error_code=unexpected_failure`, cookie);
  assert.equal(failed.headers.get("location"), "/guides/?q=color&auth_error=failed");
  assert.equal(calls.length, 0);
  assertTransactionCleared(failed);
});

test("callback: missing or malformed authorization code -> failed, no exchange", async () => {
  const { tx, cookie } = sealed();
  for (const code of ["", "has space", "a".repeat(600), "semi;colon"]) {
    const res = await callback(`?state=${tx.state}&code=${encodeURIComponent(code)}`, cookie);
    assert.equal(res.headers.get("location"), "/guides/?q=color&auth_error=failed");
  }
  const noCode = await callback(`?state=${tx.state}`, cookie);
  assert.equal(noCode.headers.get("location"), "/guides/?q=color&auth_error=failed");
  assert.equal(calls.length, 0);
});

test("callback: Supabase refuses the code (bad verifier / unknown / expired flow) -> failed", async () => {
  for (const [status, code] of [[400, "bad_code_verifier"], [404, "flow_state_not_found"], [422, "flow_state_expired"]]) {
    route("POST /auth/v1/token", () => Response.json({ code: status, error_code: code }, { status }));
    const { tx, cookie } = sealed();
    const res = await callback(`?state=${tx.state}&code=${AUTH_CODE}`, cookie);
    assert.equal(res.headers.get("location"), "/guides/?q=color&auth_error=failed", code);
    assert.equal(setCookies(res)[SESSION_COOKIE], undefined);
    assertTransactionCleared(res);
  }
});

test("callback: Supabase unavailable or returning an unusable session -> unavailable", async () => {
  for (const respond of [
    () => {
      throw new TypeError(`fetch failed ${AUTH_CODE}`);
    },
    () => new Response("boom", { status: 500 }),
    () => new Response("<html>", { status: 200 }),
    () => Response.json({ ...SESSION_RESPONSE, refresh_token: undefined }),
    () => Response.json({ ...SESSION_RESPONSE, access_token: "not-a-jwt" }),
    () => Response.json({ message: "Invalid API key" }, { status: 401 }),
  ]) {
    route("POST /auth/v1/token", respond);
    const { tx, cookie } = sealed();
    const res = await callback(`?state=${tx.state}&code=${AUTH_CODE}`, cookie);
    assert.equal(res.headers.get("location"), "/guides/?q=color&auth_error=unavailable");
    assert.equal(setCookies(res)[SESSION_COOKIE], undefined);
    assertTransactionCleared(res);
  }
  assertCleanLogs();
});

test("callback: not configured -> /?auth_error=unavailable and the cookie is still cleared", async () => {
  const { tx, cookie } = sealed();
  setEnv({ ...ENV, AUTH_COOKIE_SECRET: "" });
  const res = await callback(`?state=${tx.state}&code=${AUTH_CODE}`, cookie);
  assert.equal(res.headers.get("location"), "/?auth_error=unavailable");
  assertTransactionCleared(res);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------
// GET /api/auth/session (Phase 2 behaviour)
// ---------------------------------------------------------------------

async function session(cookie) {
  const res = await authSession(get("/api/auth/session", { cookie }));
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

test("session: providers.google is true only when configured here AND enabled in Supabase", async () => {
  let { body } = await session();
  assert.deepEqual(body, { authenticated: false, user: null, providers: { google: true, email: false } });

  resetProviderCache();
  route("GET /auth/v1/settings", () => Response.json({ external: { google: false } }));
  ({ body } = await session());
  assert.equal(body.providers.google, false);

  resetProviderCache();
  setEnv({ ...ENV, AUTH_ORIGIN: "" });
  calls = [];
  ({ body } = await session());
  assert.equal(body.providers.google, false);
  assert.equal(calls.length, 0, "asked Supabase although the flow is unconfigured");
});

test("session: Supabase settings are cached, not fetched per request", async () => {
  await session();
  await session();
  await session();
  assert.equal(calls.filter((c) => c.url.pathname === "/auth/v1/settings").length, 1);
});

test("session: valid access token -> signed in, no tokens in the body", async () => {
  route("GET /auth/v1/user", () => Response.json(USER));
  const { res, body, text } = await session(`${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    authenticated: true,
    user: {
      id: "user-1",
      email: "designer@example.com",
      display_name: "Dee Signer",
      avatar_url: "https://lh3.googleusercontent.com/a/x",
    },
    providers: { google: true, email: false },
  });
  assert.deepEqual(res.headers.getSetCookie(), []);
  assertNoLeak(text);
});

test("session: expired access token + valid refresh -> rotated cookies, signed in", async () => {
  route("GET /auth/v1/user", () => Response.json({ msg: "JWT expired" }, { status: 401 }));
  route("POST /auth/v1/token", () => Response.json(SESSION_RESPONSE));
  const { res, body, text } = await session(`${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(body.authenticated, true);
  const refresh = calls.find((c) => c.url.pathname === "/auth/v1/token");
  assert.equal(refresh.url.searchParams.get("grant_type"), "refresh_token");
  assert.deepEqual(refresh.body, { refresh_token: REFRESH });
  const cookies = setCookies(res);
  assert.equal(cookies[SESSION_COOKIE].value, NEW_ACCESS);
  assert.equal(cookies[REFRESH_COOKIE].value, NEW_REFRESH);
  assertSecureCookie(cookies[SESSION_COOKIE], SESSION_COOKIE);
  assertSecureCookie(cookies[REFRESH_COOKIE], REFRESH_COOKIE);
  assertNoLeak(text);
});

test("session: only a refresh cookie (access cookie expired in the browser) -> signed in", async () => {
  route("POST /auth/v1/token", () => Response.json(SESSION_RESPONSE));
  const { body } = await session(`${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(body.authenticated, true);
  assert.equal(calls.filter((c) => c.url.pathname === "/auth/v1/user").length, 0);
});

test("session: revoked refresh token -> signed out and both cookies cleared", async () => {
  route("GET /auth/v1/user", () => Response.json({}, { status: 403 }));
  route("POST /auth/v1/token", () => Response.json({ error_code: "refresh_token_not_found" }, { status: 400 }));
  const { res, body } = await session(`${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(body.authenticated, false);
  const cookies = setCookies(res);
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) {
    assert.equal(cookies[name].value, "");
    assert.ok(cookies[name].attrs.includes("Max-Age=0"));
    assertSecureCookie(cookies[name], name);
  }
});

test("session: Supabase down during refresh -> 503, cookies kept", async () => {
  route("POST /auth/v1/token", () => new Response("down", { status: 502 }));
  const { res, body } = await session(`${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(res.status, 503);
  assert.equal(body.error, "auth_unavailable");
  assert.deepEqual(res.headers.getSetCookie(), []);
  assertCleanLogs();
});

test("session: invalid access token and no refresh cookie -> stale cookie cleared", async () => {
  route("GET /auth/v1/user", () => Response.json({}, { status: 401 }));
  const { res, body } = await session(`${SESSION_COOKIE}=${ACCESS}`);
  assert.equal(body.authenticated, false);
  assert.equal(setCookies(res)[SESSION_COOKIE].value, "");
});

// ---------------------------------------------------------------------
// POST /api/auth/signout
// ---------------------------------------------------------------------

function signoutRequest(cookie, origin = ORIGIN, method = "POST") {
  return signout(get("/api/auth/signout", { cookie, origin, method }));
}

function assertAllCleared(res) {
  const cookies = setCookies(res);
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE, OAUTH_COOKIE]) {
    assert.ok(cookies[name], `${name} not cleared`);
    assert.equal(cookies[name].value, "");
    assert.ok(cookies[name].attrs.includes("Max-Age=0"));
    assertSecureCookie(cookies[name], name);
  }
}

test("signout: only POST", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await signoutRequest("", ORIGIN, method);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("signout: cross-site or Origin-less POST is refused (CSRF)", async () => {
  // null = no Origin header at all (undefined would pick up the default).
  for (const origin of [null, "https://evil.example", "https://bpozz.com.evil.example", "null"]) {
    const res = await signoutRequest(`${SESSION_COOKIE}=${ACCESS}`, origin);
    assert.equal(res.status, 403, String(origin));
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.equal(calls.length, 0);
  }
});

test("signout: revokes at Supabase with the user's own token and clears every cookie", async () => {
  route("POST /auth/v1/logout", () => new Response(null, { status: 204 }));
  const res = await signoutRequest(`${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { signed_out: true });
  assertAllCleared(res);

  assert.equal(calls.length, 1);
  const [logout] = calls;
  assert.equal(logout.url.searchParams.get("scope"), "local");
  assert.equal(logout.headers.get("authorization"), `Bearer ${ACCESS}`);
  assert.equal(logout.headers.get("apikey"), ENV.SUPABASE_ANON_KEY);
  assert.ok(![...logout.headers.values()].some((v) => v.includes(ENV.SUPABASE_SERVICE_ROLE_KEY)));
});

test("signout: expired access token -> refreshed once, then revoked", async () => {
  let logoutCalls = 0;
  route("POST /auth/v1/logout", (call) => {
    logoutCalls++;
    return call.headers.get("authorization") === `Bearer ${NEW_ACCESS}`
      ? new Response(null, { status: 204 })
      : Response.json({ msg: "JWT expired" }, { status: 401 });
  });
  route("POST /auth/v1/token", () => Response.json(SESSION_RESPONSE));
  const res = await signoutRequest(`${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(res.status, 200);
  assert.equal(logoutCalls, 2);
  assertAllCleared(res);
  // The freshly issued tokens are revoked, never handed to the browser.
  const cookies = setCookies(res);
  assert.equal(cookies[SESSION_COOKIE].value, "");
  assert.equal(cookies[REFRESH_COOKIE].value, "");
});

test("signout: Supabase down -> still signed out locally, logged without values", async () => {
  route("POST /auth/v1/logout", () => {
    throw new TypeError(`fetch failed ${ACCESS}`);
  });
  route("POST /auth/v1/token", () => {
    throw new TypeError("fetch failed");
  });
  const res = await signoutRequest(`${SESSION_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`);
  assert.equal(res.status, 200);
  assertAllCleared(res);
  assert.ok(logs.some((l) => l.includes("could not revoke")));
  assertCleanLogs();
});

test("signout: nothing to revoke -> no Supabase call, cookies cleared anyway", async () => {
  const res = await signoutRequest(undefined);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
  assertAllCleared(res);
});
