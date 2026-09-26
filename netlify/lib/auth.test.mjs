/**
 * Tests for the Phase 1 auth backend: netlify/lib/auth.mjs and
 * GET /api/auth/session (netlify/functions/auth-session.mjs).
 *
 * Lives in netlify/lib/, not netlify/functions/: every file in the
 * functions directory is deployed as a function.
 *
 * Supabase is never contacted — global fetch is replaced per test, and each
 * test asserts exactly what would have been sent.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import authSession, { config as routeConfig } from "../functions/auth-session.mjs";
import {
  SESSION_COOKIE,
  currentProviders,
  parseCookies,
  looksLikeAccessToken,
  publicUser,
  safeReturnTo,
  supabaseConfig,
} from "./auth.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Recognisable fake values, so a leak is easy to spot in any assertion.
const ENV = {
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-FAKE-1234",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-FAKE-5678",
  AUTH_ORIGIN: "https://bpozz.com",
  AUTH_COOKIE_SECRET: "cookie-secret-FAKE-9012",
};
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl";

const realFetch = globalThis.fetch;
const realError = console.error;
let savedEnv;
let calls;
let logs;

function setEnv(values) {
  for (const key of Object.keys(ENV)) delete process.env[key];
  Object.assign(process.env, values);
}

function stubFetch(respond) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  };
}

function request(options = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request("https://bpozz.com/api/auth/session", {
    method: options.method || "GET",
    headers,
  });
}

async function call(options) {
  const res = await authSession(request(options));
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
}

function assertNoSecrets(text) {
  for (const key of ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AUTH_COOKIE_SECRET"]) {
    assert.ok(!text.includes(ENV[key]), `${key} value leaked`);
  }
  assert.ok(!text.includes(TOKEN), "access token leaked");
  assert.ok(!/at .+\.m?js:\d+/.test(text), "stack trace leaked");
}

beforeEach(() => {
  savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  calls = [];
  logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  setEnv(ENV);
  stubFetch(() => {
    throw new Error("unexpected network call");
  });
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
// route
// ---------------------------------------------------------------------

test("session function is routed at exactly /api/auth/session", () => {
  assert.deepEqual(routeConfig, { path: "/api/auth/session" });
  assert.ok(
    fs.existsSync(path.join(REPO, "netlify", "functions", "auth-session.mjs")),
  );
});

test("the functions directory holds only deployable functions", () => {
  const files = fs.readdirSync(path.join(REPO, "netlify", "functions"));
  assert.deepEqual(files, [
    "auth-google-callback.mjs",
    "auth-google-start.mjs",
    "auth-session.mjs",
    "auth-signout.mjs",
  ]);
});

// ---------------------------------------------------------------------
// GET /api/auth/session
// ---------------------------------------------------------------------

test("no cookie: signed out, no Supabase call, not cacheable", async () => {
  const { res, body, text } = await call();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(body, {
    authenticated: false,
    user: null,
    providers: { google: false, email: false },
  });
  assert.equal(calls.length, 0);
  assertNoSecrets(text);
});

test("response satisfies the existing frontend probe, which then reports 'not available yet'", async () => {
  // Mirrors src/client/auth.js probe(): ok + JSON + a providers object, then
  // providers.google / providers.email gate each option.
  const { res, body } = await call();
  const accepted =
    res.ok && (res.headers.get("content-type") || "").includes("application/json") && body.providers
      ? body
      : null;
  assert.ok(accepted, "frontend would treat the backend as absent");
  assert.equal(accepted.providers.google, false);
  assert.equal(accepted.providers.email, false);
});

test("providers stay off while the Google flow is not fully configured", async () => {
  // This file's ENV has a 23-character AUTH_COOKIE_SECRET — below the
  // 32-character minimum — so the Google flow counts as unconfigured and
  // Supabase is not even asked. Phase 2 cases live in google.test.mjs.
  assert.deepEqual(await currentProviders(supabaseConfig(ENV), ENV), {
    google: false,
    email: false,
  });
  assert.equal(calls.length, 0);
});

test("malformed session cookie: signed out without contacting Supabase", async () => {
  for (const bad of ["not-a-jwt", "a.b", "a.b.c.d", "x".repeat(9000)]) {
    calls = [];
    const { res, body } = await call({ cookie: `${SESSION_COOKIE}=${bad}` });
    assert.equal(res.status, 200);
    assert.equal(body.authenticated, false);
    assert.equal(calls.length, 0, `forwarded ${bad.slice(0, 20)}`);
  }
});

test("a cookie without the __Host- name is ignored", async () => {
  const { body } = await call({ cookie: `bpozz_session=${TOKEN}` });
  assert.equal(body.authenticated, false);
  assert.equal(calls.length, 0);
});

test("valid session: minimal user, no tokens, anon key only", async () => {
  stubFetch(() =>
    Response.json({
      id: "user-1",
      email: "designer@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: {
        full_name: "Dee Signer",
        avatar_url: "https://lh3.googleusercontent.com/a/photo",
        provider_id: "google-sub-123",
      },
      identities: [{ id: "google-sub-123", provider: "google" }],
    }),
  );
  const { res, body, text } = await call({ cookie: `other=1; ${SESSION_COOKIE}=${TOKEN}` });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    authenticated: true,
    user: {
      id: "user-1",
      email: "designer@example.com",
      display_name: "Dee Signer",
      avatar_url: "https://lh3.googleusercontent.com/a/photo",
    },
    providers: { google: false, email: false },
  });
  assert.ok(!text.includes("google-sub-123"), "provider id leaked");
  assertNoSecrets(text);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example-project.supabase.co/auth/v1/user");
  const sent = new Headers(calls[0].init.headers);
  assert.equal(sent.get("apikey"), ENV.SUPABASE_ANON_KEY);
  assert.equal(sent.get("authorization"), `Bearer ${TOKEN}`);
  assert.ok(
    !JSON.stringify([...sent]).includes(ENV.SUPABASE_SERVICE_ROLE_KEY),
    "service-role key was sent",
  );
});

test("expired or revoked session (401/403): signed out, not an error", async () => {
  for (const status of [401, 403]) {
    stubFetch(() => Response.json({ msg: "invalid JWT" }, { status }));
    const { res, body } = await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
    assert.equal(res.status, 200);
    assert.equal(body.authenticated, false);
  }
});

test("Supabase rejecting our API key is reported as unavailable, not as a sign-out", async () => {
  stubFetch(() => Response.json({ message: "Invalid API key" }, { status: 401 }));
  const { res, body } = await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
  assert.equal(res.status, 503);
  assert.equal(body.error, "auth_unavailable");
  assert.ok(logs.some((l) => l.includes("rejected SUPABASE_ANON_KEY")));
});

test("Supabase down, erroring or timing out: generic 503, no leak", async () => {
  const failures = [
    () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1:443 /internal/path.js");
    },
    () => new Response("upstream exploded at /var/task/x.js:1", { status: 500 }),
    () => new Response("<html>not json</html>", { status: 200 }),
    () => Response.json({ email: "no-id@example.com" }),
  ];
  for (const respond of failures) {
    stubFetch(respond);
    const { res, body, text } = await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { authenticated: false, user: null, error: "auth_unavailable" });
    assert.ok(!text.includes("ECONNREFUSED") && !text.includes("/var/task"));
    assertNoSecrets(text);
  }
});

test("unconfigured: generic 503 naming nothing to the browser, names only in logs", async () => {
  const cases = [
    [{}, "missing SUPABASE_URL, SUPABASE_ANON_KEY"],
    [{ SUPABASE_URL: ENV.SUPABASE_URL }, "missing SUPABASE_ANON_KEY"],
    [{ SUPABASE_URL: "not a url", SUPABASE_ANON_KEY: "k" }, "not a valid URL"],
    [{ SUPABASE_URL: "http://example.supabase.co", SUPABASE_ANON_KEY: "k" }, "must use https"],
  ];
  for (const [env, logged] of cases) {
    setEnv(env);
    logs = [];
    const { res, body, text } = await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { authenticated: false, user: null, error: "auth_unavailable" });
    assert.ok(!text.includes("SUPABASE"), "variable names reached the browser");
    assert.equal(calls.length, 0);
    assert.ok(logs.some((l) => l.includes(logged)), `expected log: ${logged}`);
  }
});

test("service-role key alone does not make auth 'configured'", async () => {
  setEnv({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
  const { res } = await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test("non-GET methods: 405 with Allow, not cacheable", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const { res, body } = await call({ method });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { error: "method_not_allowed" });
  }
});

test("logs never contain tokens, cookies or key values", async () => {
  stubFetch(() => {
    throw new Error(`boom ${TOKEN} ${ENV.SUPABASE_ANON_KEY}`);
  });
  await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
  stubFetch(() => new Response("err", { status: 502 }));
  await call({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
  assert.ok(logs.length >= 2);
  for (const line of logs) assertNoSecrets(line);
});

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

test("supabaseConfig reads only the URL and anon key", () => {
  const result = supabaseConfig(ENV);
  assert.deepEqual(result, {
    ok: true,
    supabaseUrl: "https://example-project.supabase.co",
    anonKey: ENV.SUPABASE_ANON_KEY,
  });
  assert.ok(!JSON.stringify(result).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(
    supabaseConfig({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "k" }).ok,
    true,
    "a local Supabase stack may use http",
  );
});

test("parseCookies tolerates malformed input", () => {
  assert.deepEqual({ ...parseCookies(undefined) }, {});
  assert.deepEqual(
    { ...parseCookies('a=1; b="two"; =x; c; d=%E0%A4%A; a=ignored; e=%20ok') },
    { a: "1", b: "two", e: " ok" },
  );
});

test("looksLikeAccessToken accepts only a JWT shape", () => {
  assert.equal(looksLikeAccessToken(TOKEN), true);
  for (const bad of [undefined, "", "abc", "a.b", "a.b.c.d", "a.b.c d", "x".repeat(8193)]) {
    assert.equal(looksLikeAccessToken(bad), false);
  }
});

test("publicUser drops untrusted avatar URLs and caps names", () => {
  const user = publicUser({
    id: "u",
    user_metadata: { name: "N".repeat(500), picture: "javascript:alert(1)" },
  });
  assert.equal(user.display_name.length, 200);
  assert.equal(user.avatar_url, null);
  assert.equal(user.email, null);
  assert.equal(publicUser({ id: "u", user_metadata: { avatar_url: "http://x.test/a.png" } }).avatar_url, null);
});

test("safeReturnTo keeps internal paths and rejects everything else", () => {
  const allowed = {
    "/": "/",
    "/account": "/account",
    "/guides/?q=color#top": "/guides/?q=color#top",
    "/guide/whitespace-as-ui-component": "/guide/whitespace-as-ui-component",
    "/a/../b": "/b",
  };
  for (const [input, expected] of Object.entries(allowed)) {
    assert.equal(safeReturnTo(input), expected, input);
  }
  const rejected = [
    undefined,
    "",
    "account",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/ok\r\nSet-Cookie: x=1",
    "/tab\there",
    "/api/auth/session",
    "/api",
    "/" + "a".repeat(2048),
  ];
  for (const input of rejected) {
    assert.equal(safeReturnTo(input), "/", JSON.stringify(input));
  }
  assert.equal(safeReturnTo("//evil.example", "/guides/"), "/guides/");
});

// ---------------------------------------------------------------------
// secrets never reach browser code
// ---------------------------------------------------------------------

test("browser-facing sources never reference server secrets or env", () => {
  const browserSources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(m?js|html|css)$/.test(entry.name) && !entry.name.endsWith(".test.js")) {
        browserSources.push(full);
      }
    }
  };
  walk(path.join(REPO, "src", "client"));
  walk(path.join(REPO, "src", "shared"));
  walk(path.join(REPO, "partials"));
  const forbidden = /SUPABASE_SERVICE_ROLE_KEY|service_role|AUTH_COOKIE_SECRET|GOOGLE_CLIENT_SECRET|SUPABASE_ANON_KEY|process\.env|netlify\/lib/;
  for (const file of browserSources) {
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!forbidden.test(text), `${path.relative(REPO, file)} references a server secret`);
  }
  assert.ok(browserSources.some((f) => f.endsWith("auth.js")), "auth.js was scanned");
});

test("the build never publishes netlify/ into dist/", () => {
  const build = fs.readFileSync(path.join(REPO, "src", "build", "build.js"), "utf8");
  assert.ok(!/["'`]netlify\//.test(build), "build.js references netlify/");
});
