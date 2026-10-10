/**
 * Tests for the account Saved API (docs/SAVED.md): netlify/lib/saved.mjs,
 * /api/saved (netlify/functions/saved.mjs) and /api/saved/import
 * (netlify/functions/saved-import.mjs).
 *
 * Supabase is never contacted — global fetch is replaced per test, and each
 * test asserts exactly what would have been sent.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import saved, { config as savedRoute } from "../functions/saved.mjs";
import savedImport, { config as importRoute } from "../functions/saved-import.mjs";
import { REFRESH_COOKIE, SESSION_COOKIE } from "./auth.mjs";
import {
  LIMITS,
  MAX_PAGES,
  SAVED_KINDS,
  isValidItem,
  planImport,
  tokenSubject,
} from "./saved.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Recognisable fake values, so a leak is easy to spot in any assertion.
const ENV = {
  SAVED_ENABLED: "true",
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-FAKE-1234",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-FAKE-5678",
  AUTH_ORIGIN: "https://bpozz.com",
};
const USER = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60";
const EMAIL = "designer@example.com";
const REFRESH = "refresh-token-FAKE-abcdef";
const REST = `${ENV.SUPABASE_URL}/rest/v1/saved_items`;

function makeToken(claims = {}) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = {
    sub: USER,
    email: EMAIL,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.c2lnbmF0dXJl`;
}
const TOKEN = makeToken();
const COOKIE = `${SESSION_COOKIE}=${TOKEN}; ${REFRESH_COOKIE}=${REFRESH}`;

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
    return respond(String(url), init, calls.length);
  };
}

/** A request to one of the two functions, signed in by default. */
function request(method, target, { cookie = COOKIE, origin = ENV.AUTH_ORIGIN, body, type } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", type || "application/json");
  return new Request(`https://bpozz.com${target}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(handler, req) {
  const res = await handler(req);
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
}

const get = (query = "", options) => call(saved, request("GET", `/api/saved${query}`, options));
const post = (body, options) => call(saved, request("POST", "/api/saved", { body, ...options }));
const del = (query, options) => call(saved, request("DELETE", `/api/saved${query}`, options));
const importItems = (body, options) =>
  call(savedImport, request("POST", "/api/saved/import", { body, ...options }));

function row(kind, id, createdAt = "2026-09-28T10:00:00+00:00") {
  return { kind, item_id: id, created_at: createdAt };
}

/** A PostgREST list page with the Content-Range a count=exact request gets. */
function listPage(rows, { start = 0, total = rows.length } = {}) {
  const range = rows.length ? `${start}-${start + rows.length - 1}/${total}` : `*/${total}`;
  return new Response(JSON.stringify(rows), {
    status: rows.length < total ? 206 : 200,
    headers: { "content-type": "application/json", "content-range": range },
  });
}

/** A PostgREST error body. The message deliberately carries the user id. */
function pgError(status, code, message = `Key (user_id)=(${USER}) is involved`) {
  return Response.json({ code, details: `(${USER})`, hint: null, message }, { status });
}

const sentHeaders = (i = 0) => new Headers(calls[i].init.headers);
const sentQuery = (i = 0) => new URL(calls[i].url).searchParams;
const sentBody = (i = 0) => JSON.parse(calls[i].init.body);

function assertNoLeaks(text) {
  for (const secret of [TOKEN, REFRESH, USER, EMAIL, ENV.SUPABASE_ANON_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY]) {
    assert.ok(!text.includes(secret), `leaked ${secret.slice(0, 12)}…`);
  }
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
// routes
// ---------------------------------------------------------------------

test("both functions are routed with literal-only configs and Netlify rate limits", () => {
  assert.deepEqual(savedRoute, {
    path: "/api/saved",
    rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
  });
  assert.deepEqual(importRoute, {
    path: "/api/saved/import",
    rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] },
  });
  // Netlify reads `export const config` statically (see email.test.mjs).
  for (const [file, route] of [
    ["saved.mjs", "/api/saved"],
    ["saved-import.mjs", "/api/saved/import"],
  ]) {
    const source = fs.readFileSync(path.join(REPO, "netlify", "functions", file), "utf8");
    const match = /^export const config = (\{[\s\S]*?\});$/m.exec(source);
    assert.ok(match, `${file}: no top-level config`);
    const config = vm.runInNewContext(`(${match[1]})`, Object.create(null));
    assert.equal(config.path, route);
  }
});

// ---------------------------------------------------------------------
// id rules
// ---------------------------------------------------------------------

test("the six kinds are exactly the saveable sections; roadmap is not one", () => {
  assert.deepEqual([...SAVED_KINDS], ["color", "palette", "font", "icon", "guide", "image_palette"]);
  assert.equal(isValidItem("roadmap", "type-scale-systems"), false);
  assert.equal(isValidItem("roadmap_step", "type-scale-systems"), false);
});

// The Icon Packs feature and its catalog (src/data/icons.json) were removed.
// The `icon` kind stays valid so saved rows are kept; these fixed ids, one
// per former pack, use the documented pack--id shape.
const ICON_IDS = [
  "outline-essentials--arrow-left",
  "solid-essentials--heart",
  "duotone-essentials--bell",
  "3d-essentials--star",
];

test("every id in the site's catalogs passes its kind's rule", () => {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(REPO, file), "utf8"));
  const catalogs = {
    color: read("colors/colors-data.json").map((c) => c.id),
    palette: read("palettes/palettes-data.json").map((p) => p.id),
    font: read("src/data/fonts.json").map((f) => f.id),
    icon: ICON_IDS,
    guide: read("guides.json").map((g) => g.id),
  };
  for (const [kind, ids] of Object.entries(catalogs)) {
    assert.ok(ids.length > 0, `${kind}: empty catalog`);
    for (const id of ids) assert.ok(isValidItem(kind, id), `${kind} ${id}`);
  }
});

test("id rules accept the documented shapes and nothing else", () => {
  const good = [
    ["color", "c001"],
    ["color", "c1200"],
    ["palette", "p600"],
    ["font", "abhaya-libre"],
    ["icon", "3d-essentials--arrow-left"],
    ["guide", "whitespace-as-ui-component"],
    ["image_palette", "1e193b-322a57-5438e6"],
    ["image_palette", Array(8).fill("abcdef").join("-")],
  ];
  const bad = [
    ["color", "c01"],
    ["color", "c12000"],
    ["color", "C001"],
    ["palette", "p1"],
    ["font", "Abel"],
    ["font", "abel-"],
    ["font", "a--b"],
    ["font", "a b"],
    ["font", "a".repeat(65)],
    ["icon", "arrow-left"],
    ["icon", "pack---id"],
    ["icon", `${"a".repeat(60)}--${"b".repeat(60)}`],
    ["guide", "a".repeat(101)],
    ["guide", "../etc"],
    ["image_palette", "1e193b-322a57"],
    ["image_palette", Array(9).fill("abcdef").join("-")],
    ["image_palette", "#1e193b-322a57-5438e6"],
    ["image_palette", "1E193B-322A57-5438E6"],
    ["image_palette", "1e193b-322a57-5438e6\n"],
    ["unknown", "c001"],
    ["color", 1],
    [undefined, "c001"],
    ["__proto__", "c001"],
    ["constructor", "c001"],
  ];
  for (const [kind, id] of good) assert.ok(isValidItem(kind, id), `${kind} ${id}`);
  for (const [kind, id] of bad) assert.equal(isValidItem(kind, id), false, `${String(kind)} ${String(id)}`);
});

// The browser half repeats these rules so a malformed id never leaves the
// page. It lives here rather than in src/client because nothing under src/
// may name this library (see the last test in this file).
test("the browser module's kinds, id rules and limits match this API's (src/client/saved.js)", () => {
  const source = fs.readFileSync(path.join(REPO, "src", "client", "saved.js"), "utf8");
  const context = { document: {} };
  context.window = context;
  // Run dormant whichever way its launch switch ships: the kinds, id rules
  // and limits are published either way, and dormant needs no page. What
  // ships is checked once, in src/client/saved.test.js.
  vm.runInNewContext(source.replace(/var LAUNCHED = (?:true|false);/, "var LAUNCHED = false;"), context);
  const browser = context.BpozzSaved;
  assert.deepEqual([...browser.kinds], [...SAVED_KINDS]);
  assert.deepEqual({ ...browser.limits }, { ...LIMITS });

  const read = (file) => JSON.parse(fs.readFileSync(path.join(REPO, file), "utf8"));
  const cases = [
    ...read("colors/colors-data.json").map((c) => ["color", c.id]),
    ...read("palettes/palettes-data.json").map((p) => ["palette", p.id]),
    ...read("src/data/fonts.json").map((f) => ["font", f.id]),
    ...ICON_IDS.map((id) => ["icon", id]),
    ...read("guides.json").map((g) => ["guide", g.id]),
    ["image_palette", "1e193b-322a57-5438e6"],
    ["image_palette", Array(8).fill("abcdef").join("-")],
    ["color", "c01"],
    ["color", "c12000"],
    ["color", "C001"],
    ["palette", "p1"],
    ["font", "Abel"],
    ["font", "abel-"],
    ["font", "a--b"],
    ["font", "a b"],
    ["font", "a".repeat(64)],
    ["font", "a".repeat(65)],
    ["icon", "arrow-left"],
    ["icon", "pack---id"],
    ["icon", `${"a".repeat(59)}--${"b".repeat(59)}`],
    ["icon", `${"a".repeat(60)}--${"b".repeat(60)}`],
    ["guide", "a".repeat(100)],
    ["guide", "a".repeat(101)],
    ["guide", "../etc"],
    ["image_palette", "1e193b-322a57"],
    ["image_palette", Array(9).fill("abcdef").join("-")],
    ["image_palette", "#1e193b-322a57-5438e6"],
    ["image_palette", "1E193B-322A57-5438E6"],
    ["image_palette", "1e193b-322a57-5438e6\n"],
    ["roadmap", "type-scale-systems"],
    ["unknown", "c001"],
    ["color", 1],
    [undefined, "c001"],
    ["__proto__", "c001"],
    ["constructor", "c001"],
  ];
  for (const [kind, id] of cases) {
    assert.equal(browser.isValidItem(kind, id), isValidItem(kind, id), `${String(kind)} ${String(id)}`);
  }
});

// ---------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------

test("tokenSubject reads the user id of a signed-in user's token only", () => {
  assert.equal(tokenSubject(TOKEN), USER);
  const refused = [
    undefined,
    "not-a-jwt",
    makeToken({ role: "anon" }),
    makeToken({ role: "service_role" }),
    makeToken({ is_anonymous: true }),
    makeToken({ sub: "user-1" }),
    makeToken({ sub: USER.toUpperCase() }),
    "eyJhbGciOiJIUzI1NiJ9.bm90IGpzb24.c2ln",
  ];
  for (const token of refused) assert.equal(tokenSubject(token), null);
});

test("tokenSubject leaves expiry to Supabase", () => {
  // /api/auth/session refreshes only once Supabase refuses a token, so a
  // local expiry check could refuse a token the refresh path keeps.
  const now = Math.floor(Date.now() / 1000);
  for (const exp of [now - 10, now + 2, "later", undefined]) {
    assert.equal(tokenSubject(makeToken({ exp })), USER, String(exp));
  }
});

// ---------------------------------------------------------------------
// shared gates
// ---------------------------------------------------------------------

test("SAVED_ENABLED anything but \"true\": 503, no Supabase call, for both functions", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1", " true"]) {
    setEnv({ ...ENV, SAVED_ENABLED: value });
    if (value === undefined) delete process.env.SAVED_ENABLED;
    logs = [];
    for (const result of [await get(), await post({ kind: "font", id: "abel" }), await importItems({ items: [{ kind: "font", id: "abel" }] })]) {
      assert.equal(result.res.status, 503);
      assert.deepEqual(result.body, { error: "saved_unavailable" });
      assert.ok(!result.text.includes("SAVED_ENABLED"), "variable name reached the browser");
    }
    assert.equal(calls.length, 0);
    assert.ok(logs.some((l) => l.includes('SAVED_ENABLED is not "true"')));
  }
});

test("Supabase not configured: 503 naming nothing to the browser", async () => {
  setEnv({ SAVED_ENABLED: "true" });
  const { res, body, text } = await get();
  assert.equal(res.status, 503);
  assert.deepEqual(body, { error: "saved_unavailable" });
  assert.ok(!text.includes("SUPABASE"));
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => l.includes("missing SUPABASE_URL")));
});

test("wrong methods: 405 with Allow", async () => {
  for (const method of ["PUT", "PATCH"]) {
    const { res, body } = await call(saved, request(method, "/api/saved"));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, POST, DELETE");
    assert.deepEqual(body, { error: "method_not_allowed" });
  }
  for (const method of ["GET", "DELETE", "PUT"]) {
    const { res } = await call(savedImport, request(method, "/api/saved/import"));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  }
  assert.equal(calls.length, 0);
});

test("no session, a malformed one, or a non-user token: 401 without contacting Supabase", async () => {
  const cookies = [
    null,
    `${REFRESH_COOKIE}=${REFRESH}`,
    `${SESSION_COOKIE}=not-a-jwt`,
    `bpozz_session=${TOKEN}`,
    `${SESSION_COOKIE}=${makeToken({ role: "anon" })}`,
  ];
  for (const cookie of cookies) {
    for (const result of [
      await get("", { cookie }),
      await post({ kind: "font", id: "abel" }, { cookie }),
      await del("?kind=font&id=abel", { cookie }),
      await importItems({ items: [{ kind: "font", id: "abel" }] }, { cookie }),
    ]) {
      assert.equal(result.res.status, 401, String(cookie));
      assert.deepEqual(result.body, { error: "unauthenticated" });
    }
  }
  assert.equal(calls.length, 0);
});

test("an expired token goes to Supabase, whose 401 is the answer", async () => {
  const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 1 });
  stubFetch(() => pgError(401, "PGRST303", "JWT expired"));
  const { res, body } = await get("", { cookie: `${SESSION_COOKIE}=${expired}` });
  assert.equal(res.status, 401);
  assert.deepEqual(body, { error: "unauthenticated" });
  assert.equal(calls.length, 1);
  assert.equal(sentHeaders().get("authorization"), `Bearer ${expired}`);
});

test("writes need a same-origin Origin (CSRF); reads do not", async () => {
  for (const origin of [null, "https://evil.example", "null"]) {
    for (const result of [
      await post({ kind: "font", id: "abel" }, { origin }),
      await del("?kind=font&id=abel", { origin }),
      await importItems({ items: [{ kind: "font", id: "abel" }] }, { origin }),
    ]) {
      assert.equal(result.res.status, 403);
      assert.deepEqual(result.body, { error: "forbidden" });
    }
  }
  assert.equal(calls.length, 0);
  stubFetch(() => listPage([]));
  assert.equal((await get("", { origin: null })).res.status, 200);
});

// ---------------------------------------------------------------------
// GET /api/saved
// ---------------------------------------------------------------------

test("list: exact request — own token, anon key, user_id filter, stable order, count", async () => {
  stubFetch(() =>
    listPage([
      row("font", "abel", "2026-09-28T12:00:00+00:00"),
      row("image_palette", "1e193b-322a57-5438e6", "2026-09-27T09:30:00+00:00"),
    ]),
  );
  const { res, body, text } = await get();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.deepEqual(body, {
    items: [
      { kind: "font", id: "abel", saved_at: "2026-09-28T12:00:00+00:00" },
      { kind: "image_palette", id: "1e193b-322a57-5438e6", saved_at: "2026-09-27T09:30:00+00:00" },
    ],
    count: 2,
    limits: { total: 1000, image_palette: 200 },
  });
  assertNoLeaks(text);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.split("?")[0], REST);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(Object.fromEntries(sentQuery()), {
    select: "kind,item_id,created_at",
    user_id: `eq.${USER}`,
    order: "created_at.desc,kind.asc,item_id.asc",
    limit: "1000",
    offset: "0",
  });
  const headers = sentHeaders();
  assert.equal(headers.get("apikey"), ENV.SUPABASE_ANON_KEY);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("prefer"), "count=exact");
  const sent = JSON.stringify([...headers]);
  assert.ok(!sent.includes(REFRESH), "refresh token was sent");
  assert.ok(!sent.includes(ENV.SUPABASE_SERVICE_ROLE_KEY), "service-role key was sent");
  assert.ok(!sent.toLowerCase().includes("cookie"), "cookies were forwarded");
});

test("list: ?kind= filters by kind; an unknown kind is 400 without a call", async () => {
  stubFetch(() => listPage([row("palette", "p001")]));
  const { res, body } = await get("?kind=palette");
  assert.equal(res.status, 200);
  assert.deepEqual(body.items, [{ kind: "palette", id: "p001", saved_at: "2026-09-28T10:00:00+00:00" }]);
  assert.equal(sentQuery().get("kind"), "eq.palette");
  assert.equal(sentQuery().get("user_id"), `eq.${USER}`);

  calls = [];
  for (const query of ["?kind=roadmap", "?kind=", "?kind=Font", "?kind=font,palette"]) {
    const result = await get(query);
    assert.equal(result.res.status, 400, query);
    assert.deepEqual(result.body, { error: "invalid_request" });
  }
  assert.equal(calls.length, 0);
});

test("list: empty account", async () => {
  stubFetch(() => listPage([]));
  const { res, body } = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(body.items, []);
  assert.equal(body.count, 0);
});

test("list: reads every page when Supabase's Max rows is below the page size", async () => {
  const all = Array.from({ length: 5 }, (_, i) => row("color", `c00${i + 1}`));
  stubFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return listPage(all.slice(offset, offset + 2), { start: offset, total: all.length });
  });
  const { res, body } = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(
    body.items.map((item) => item.id),
    ["c001", "c002", "c003", "c004", "c005"],
  );
  assert.deepEqual(
    calls.map((_, i) => sentQuery(i).get("offset")),
    ["0", "2", "4"],
  );
});

test("list: a list that changes mid-read is re-read once, never returned partly", async () => {
  // First pass: the count grows between pages. Second pass: consistent.
  const first = [listPage([row("color", "c001")], { total: 2 }), listPage([row("color", "c002")], { start: 1, total: 3 })];
  const second = [listPage([row("color", "c001"), row("color", "c002"), row("color", "c003")])];
  const replies = [...first, ...second];
  stubFetch(() => replies.shift());
  const { res, body } = await get();
  assert.equal(res.status, 200);
  assert.equal(body.count, 3);
  assert.equal(calls.length, 3);
});

test("list: a 416 after rows were deleted between pages is re-read once, not an outage", async () => {
  // Max rows 2. The first page counts 5 rows; before the second page most
  // are deleted, so offset 2 is past the new total and PostgREST answers 416.
  const replies = [
    () => listPage([row("color", "c001"), row("color", "c002")], { total: 5 }),
    () => pgError(416, "PGRST103", "Requested range not satisfiable"),
    () => listPage([row("color", "c001")]),
  ];
  stubFetch(() => replies.shift()());
  const { res, body } = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(
    body.items.map((item) => item.id),
    ["c001"],
  );
  assert.deepEqual(
    calls.map((_, i) => sentQuery(i).get("offset")),
    ["0", "2", "0"],
  );
  assert.equal(logs.length, 0, "a mid-read change was logged as an outage");

  // Still out of range on the re-read: one retry only, then 503.
  calls = [];
  stubFetch((url) =>
    new URL(url).searchParams.get("offset") === "0"
      ? listPage([row("color", "c001"), row("color", "c002")], { total: 5 })
      : pgError(416, "PGRST103", "Requested range not satisfiable"),
  );
  const again = await get();
  assert.equal(again.res.status, 503);
  assert.deepEqual(again.body, { error: "saved_unavailable" });
  assert.equal(calls.length, 4);
  assert.ok(logs.some((l) => l.includes("changed while it was being read")));
});

test("list: still inconsistent after one retry, or duplicated rows: 503, not a partial list", async () => {
  // Every page claims a total of 2 but only ever returns the same row.
  stubFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return listPage(offset === 0 ? [row("color", "c001")] : [row("color", "c001")], { start: offset, total: 2 });
  });
  const { res, body } = await get();
  assert.equal(res.status, 503);
  assert.deepEqual(body, { error: "saved_unavailable" });
  assert.ok(logs.some((l) => l.includes("changed while it was being read")));

  // Fewer rows than the count promised, then nothing more.
  calls = [];
  stubFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return offset === 0 ? listPage([row("color", "c001")], { total: 2 }) : listPage([], { start: offset, total: 2 });
  });
  assert.equal((await get()).res.status, 503);
});

test("list: Max rows too low to finish within the page limit is 503 and logged", async () => {
  stubFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    const id = `c${String(offset + 1).padStart(3, "0")}`;
    return listPage([row("color", id)], { start: offset, total: 900 });
  });
  const { res } = await get();
  assert.equal(res.status, 503);
  assert.equal(calls.length, MAX_PAGES);
  assert.ok(logs.some((l) => l.includes('raise "Max rows"')));
});

test("list: unexpected responses are 503, not trusted", async () => {
  const replies = [
    () => new Response(JSON.stringify([row("font", "abel")]), { headers: { "content-type": "application/json" } }),
    () => listPage([{ kind: "roadmap", item_id: "x", created_at: "t" }]),
    () => listPage([{ kind: "font", item_id: "abel" }]),
    () => new Response("<html>", { status: 200, headers: { "content-range": "0-0/1" } }),
  ];
  for (const reply of replies) {
    stubFetch(reply);
    const { res } = await get();
    assert.equal(res.status, 503);
  }
  // A ?kind= list that returns another kind is not trusted either.
  stubFetch(() => listPage([row("font", "abel")]));
  assert.equal((await get("?kind=palette")).res.status, 503);
});

// ---------------------------------------------------------------------
// POST /api/saved
// ---------------------------------------------------------------------

test("save: exact insert — body has no user_id, minimal return, own token", async () => {
  stubFetch(() => new Response(null, { status: 201 }));
  const { res, body, text } = await post({ kind: "font", id: "abel" });
  assert.equal(res.status, 201);
  assert.deepEqual(body, { saved: true, created: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("set-cookie"), null);
  assertNoLeaks(text);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, REST);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(sentBody(), { kind: "font", item_id: "abel" });
  const headers = sentHeaders();
  assert.equal(headers.get("prefer"), "return=minimal");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("apikey"), ENV.SUPABASE_ANON_KEY);
});

test("save: every kind's id reaches Supabase unchanged", async () => {
  stubFetch(() => new Response(null, { status: 201 }));
  const items = [
    ["color", "c042"],
    ["palette", "p001"],
    ["font", "abel"],
    ["icon", "outline-essentials--arrow-left"],
    ["guide", "whitespace-as-ui-component"],
    ["image_palette", "1e193b-322a57-5438e6"],
  ];
  for (const [kind, id] of items) {
    assert.equal((await post({ kind, id })).res.status, 201);
  }
  assert.deepEqual(
    calls.map((_, i) => sentBody(i)),
    items.map(([kind, id]) => ({ kind, item_id: id })),
  );
});

test("save: already saved is a success, not an error", async () => {
  stubFetch(() => pgError(409, "23505"));
  const { res, body, text } = await post({ kind: "font", id: "abel" });
  assert.equal(res.status, 200);
  assert.deepEqual(body, { saved: true, created: false });
  assertNoLeaks(text);
});

test("save: the two limits are 409 with which limit", async () => {
  stubFetch(() => pgError(400, "P0001", "saved_items_limit"));
  let result = await post({ kind: "color", id: "c999" });
  assert.equal(result.res.status, 409);
  assert.deepEqual(result.body, { error: "limit_reached", limit: 1000 });

  stubFetch(() => pgError(400, "P0001", "saved_items_image_limit"));
  result = await post({ kind: "image_palette", id: "000001-000000-ffffff" });
  assert.equal(result.res.status, 409);
  assert.deepEqual(result.body, { error: "limit_reached", limit: 200, kind: "image_palette" });

  // Any other raised exception is not mistaken for a limit.
  stubFetch(() => pgError(400, "P0001", "something else"));
  result = await post({ kind: "color", id: "c999" });
  assert.equal(result.res.status, 400);
});

test("save: bad bodies are 400 without contacting Supabase", async () => {
  const bodies = [
    ["not json", undefined],
    [JSON.stringify({ kind: "font", id: "abel" }), "text/plain"],
    [JSON.stringify([{ kind: "font", id: "abel" }]), undefined],
    [JSON.stringify({ kind: "font" }), undefined],
    [JSON.stringify({ kind: "font", id: "abel", user_id: USER }), undefined],
    [JSON.stringify({ kind: "font", id: "Abel" }), undefined],
    [JSON.stringify({ kind: "roadmap", id: "type-scale-systems" }), undefined],
    [JSON.stringify({ kind: "font", id: "abel", pad: "x".repeat(2000) }), undefined],
    ["null", undefined],
    // Raw JSON: JSON.parse makes "__proto__" an own key, never a prototype.
    ['{"kind":"font","id":"abel","__proto__":{"polluted":1}}', undefined],
    ['{"__proto__":{"kind":"font","id":"abel"}}', undefined],
  ];
  for (const [body, type] of bodies) {
    const result = await post(body, { type });
    assert.equal(result.res.status, 400, body.slice(0, 40));
    assert.deepEqual(result.body, { error: "invalid_request" });
  }
  assert.equal(calls.length, 0);
  assert.equal(({}).polluted, undefined, "Object.prototype was polluted");
});

test("save: Supabase refusals map to safe answers, logged by code only", async () => {
  const cases = [
    [() => pgError(401, "PGRST303", "JWT expired"), 401, "unauthenticated"],
    [() => pgError(409, "23503"), 401, "unauthenticated"], // account deleted
    [() => Response.json({ message: "Invalid API key" }, { status: 401 }), 503, "saved_unavailable"],
    [() => pgError(403, "42501"), 503, "saved_unavailable"],
    [() => pgError(404, "PGRST205"), 503, "saved_unavailable"],
    [() => pgError(400, "23514"), 400, "invalid_request"],
    [() => new Response("upstream exploded at /var/task/x.js:1", { status: 502 }), 503, "saved_unavailable"],
    [
      () => {
        throw new TypeError(`fetch failed ${TOKEN}`);
      },
      503,
      "saved_unavailable",
    ],
  ];
  for (const [reply, status, error] of cases) {
    stubFetch(reply);
    const { res, body, text } = await post({ kind: "font", id: "abel" });
    assert.equal(res.status, status);
    assert.deepEqual(body, { error });
    assertNoLeaks(text);
  }
  assert.ok(logs.some((l) => l.includes("rejected SUPABASE_ANON_KEY")));
  assert.ok(logs.some((l) => l.includes("(42501)") && l.includes("grants")));
  assert.ok(logs.some((l) => l.includes("(PGRST205)") && l.includes("migration")));
  for (const line of logs) assertNoLeaks(line);
});

// ---------------------------------------------------------------------
// DELETE /api/saved
// ---------------------------------------------------------------------

test("unsave: exact delete — user_id, kind and item_id filters, representation", async () => {
  stubFetch(() => Response.json([{ kind: "font", item_id: "abel" }]));
  const { res, body, text } = await del("?kind=font&id=abel");
  assert.equal(res.status, 200);
  assert.deepEqual(body, { saved: false, removed: true });
  assertNoLeaks(text);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.split("?")[0], REST);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(Object.fromEntries(sentQuery()), {
    user_id: `eq.${USER}`,
    kind: "eq.font",
    item_id: "eq.abel",
    select: "kind,item_id",
  });
  assert.equal(sentHeaders().get("prefer"), "return=representation");
});

test("unsave: something not saved is still a success", async () => {
  stubFetch(() => Response.json([]));
  const { res, body } = await del("?kind=font&id=abel");
  assert.equal(res.status, 200);
  assert.deepEqual(body, { saved: false, removed: false });
});

test("unsave: missing or bad kind / id is 400 without a call", async () => {
  for (const query of ["", "?kind=font", "?id=abel", "?kind=font&id=Abel", "?kind=roadmap&id=x", "?kind=icon&id=arrow-left"]) {
    const result = await del(query);
    assert.equal(result.res.status, 400, query);
  }
  assert.equal(calls.length, 0);
});

test("unsave: an expired token is 401; Supabase down is 503", async () => {
  stubFetch(() => pgError(401, "PGRST303", "JWT expired"));
  assert.equal((await del("?kind=font&id=abel")).res.status, 401);
  stubFetch(() => new Response("oops", { status: 500 }));
  assert.equal((await del("?kind=font&id=abel")).res.status, 503);
});

test("unsave: other Supabase refusals and unexpected replies are 503, nothing leaked", async () => {
  const replies = [
    () => Response.json({ message: "Invalid API key" }, { status: 401 }),
    () => pgError(403, "42501"),
    () => pgError(404, "PGRST205"),
    () => pgError(400, "23514"),
    () => Response.json({ not: "an array" }),
    () => new Response(null, { status: 204 }),
  ];
  for (const reply of replies) {
    stubFetch(reply);
    const { res, body, text } = await del("?kind=font&id=abel");
    assert.equal(res.status, 503);
    assert.deepEqual(body, { error: "saved_unavailable" });
    assertNoLeaks(text);
  }
  for (const line of logs) assertNoLeaks(line);
});

// ---------------------------------------------------------------------
// POST /api/saved/import
// ---------------------------------------------------------------------

test("planImport: invalid, exists, limit and created, in request order", () => {
  const existing = [{ kind: "font", id: "abel" }];
  const { results, toCreate } = planImport(
    [
      { kind: "font", id: "abel" },
      { kind: "palette", id: "p001" },
      { kind: "palette", id: "p001" },
      { kind: "color", id: "c001" },
      { kind: "font", id: "Bad" },
    ],
    existing,
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["exists", "created", "exists", "invalid", "invalid"],
  );
  assert.deepEqual(toCreate, [{ kind: "palette", item_id: "p001" }]);

  const full = Array.from({ length: LIMITS.total - 1 }, (_, i) => ({ kind: "color", id: `c${i}` }));
  const near = planImport(
    [
      { kind: "font", id: "abel" },
      { kind: "font", id: "acme" },
      { kind: "font", id: "acme" },
    ],
    full,
  );
  assert.deepEqual(
    near.results.map((r) => r.status),
    ["created", "limit", "limit"],
  );
});

test("import: reads the list, inserts only the new items, reports each", async () => {
  stubFetch((url, init) =>
    init.method === "GET" ? listPage([row("font", "abel")]) : new Response(null, { status: 201 }),
  );
  const { res, body, text } = await importItems({
    items: [
      { kind: "font", id: "abel" },
      { kind: "font", id: "acme" },
      { kind: "palette", id: "p001" },
      { kind: "color", id: "c001" },
      { kind: "palette", id: "p9x" },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.deepEqual(body, {
    results: [
      { kind: "font", id: "abel", status: "exists" },
      { kind: "font", id: "acme", status: "created" },
      { kind: "palette", id: "p001", status: "created" },
      { kind: "color", id: "c001", status: "invalid" },
      { kind: "palette", id: "p9x", status: "invalid" },
    ],
    created: 2,
    existing: 1,
    invalid: 2,
    limited: 0,
  });
  assertNoLeaks(text);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(sentQuery(0).get("user_id"), `eq.${USER}`);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].url, REST);
  assert.deepEqual(sentBody(1), [
    { kind: "font", item_id: "acme" },
    { kind: "palette", item_id: "p001" },
  ]);
  assert.equal(sentHeaders(1).get("prefer"), "return=minimal");
});

test("import: nothing new means no insert", async () => {
  stubFetch(() => listPage([row("palette", "p001")]));
  const { res, body } = await importItems({ items: [{ kind: "palette", id: "p001" }] });
  assert.equal(res.status, 200);
  assert.equal(body.existing, 1);
  assert.equal(calls.length, 1);
});

test("import: a save landing in between is handled by one re-read and retry", async () => {
  let inserts = 0;
  stubFetch((url, init) => {
    if (init.method === "GET") {
      return inserts === 0 ? listPage([]) : listPage([row("font", "acme")]);
    }
    inserts += 1;
    return inserts === 1 ? pgError(409, "23505") : new Response(null, { status: 201 });
  });
  const { res, body } = await importItems({
    items: [
      { kind: "font", id: "acme" },
      { kind: "font", id: "abel" },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    body.results.map((r) => r.status),
    ["exists", "created"],
  );
  assert.deepEqual(sentBody(calls.length - 1), [{ kind: "font", item_id: "abel" }]);
});

test("import: still racing after the retry is 503", async () => {
  stubFetch((url, init) => (init.method === "GET" ? listPage([]) : pgError(400, "P0001", "saved_items_limit")));
  const { res } = await importItems({ items: [{ kind: "font", id: "abel" }] });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 4);
  assert.ok(logs.some((l) => l.includes("kept changing")));
});

test("import: list-step failures and non-race insert failures map as documented, without a retry", async () => {
  const cases = [
    // [list step reply, insert reply (null: never reached), status, error]
    [() => pgError(401, "PGRST303", "JWT expired"), null, 401, "unauthenticated"],
    [() => new Response("oops", { status: 500 }), null, 503, "saved_unavailable"],
    [() => pgError(400, "23514"), null, 503, "saved_unavailable"],
    [() => listPage([]), () => pgError(401, "PGRST303", "JWT expired"), 401, "unauthenticated"],
    [() => listPage([]), () => pgError(409, "23503"), 401, "unauthenticated"],
    [() => listPage([]), () => pgError(400, "23514"), 400, "invalid_request"],
    [() => listPage([]), () => new Response("oops", { status: 502 }), 503, "saved_unavailable"],
  ];
  for (const [list, insert, status, error] of cases) {
    calls = [];
    stubFetch((url, init) => (init.method === "GET" ? list() : insert()));
    const { res, body, text } = await importItems({ items: [{ kind: "font", id: "abel" }] });
    assert.equal(res.status, status);
    assert.deepEqual(body, { error });
    assertNoLeaks(text);
    assert.equal(calls.length, insert ? 2 : 1, "a non-race failure was retried");
  }
  for (const line of logs) assertNoLeaks(line);
});

test("import: bad bodies are 400 without contacting Supabase", async () => {
  const many = Array.from({ length: 1001 }, () => ({ kind: "font", id: "abel" }));
  const bodies = [
    "not json",
    JSON.stringify([{ kind: "font", id: "abel" }]),
    JSON.stringify({ items: [] }),
    JSON.stringify({ items: many }),
    JSON.stringify({ items: [{ kind: "font", id: "abel" }], extra: 1 }),
    JSON.stringify({ items: ["abel"] }),
    JSON.stringify({ items: [{ kind: "font", id: 7 }] }),
    JSON.stringify({ items: [{ kind: "font", id: "abel", user_id: USER }] }),
    JSON.stringify({ items: [{ kind: "font", id: "a".repeat(201) }] }),
    JSON.stringify({ items: [{ kind: "font", id: "abel" }], pad: "x".repeat(70 * 1024) }),
    // Raw JSON: JSON.parse makes "__proto__" an own key, never a prototype.
    '{"items":[{"kind":"font","id":"abel","__proto__":{"polluted":1}}]}',
    '{"items":[{"kind":"font","id":"abel"}],"__proto__":{"polluted":1}}',
  ];
  for (const body of bodies) {
    const result = await importItems(body);
    assert.equal(result.res.status, 400, body.slice(0, 40));
  }
  assert.equal(calls.length, 0);
  assert.equal(({}).polluted, undefined, "Object.prototype was polluted");
});

// ---------------------------------------------------------------------
// what never leaves the server
// ---------------------------------------------------------------------

test("no response ever sets a cookie, and all are no-store JSON", async () => {
  stubFetch((url, init) => (init.method === "GET" ? listPage([]) : new Response(null, { status: 201 })));
  const results = [
    await get(),
    await post({ kind: "font", id: "abel" }),
    await importItems({ items: [{ kind: "font", id: "abel" }] }),
    await get("", { cookie: null }),
    await post("bad"),
    await call(saved, request("PUT", "/api/saved")),
  ];
  for (const { res } of results) {
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type"), /^application\/json/);
  }
});

test("logs never contain tokens, user ids, emails, keys or Supabase messages", async () => {
  const replies = [
    () => {
      throw new Error(`boom ${TOKEN} ${ENV.SUPABASE_ANON_KEY}`);
    },
    () => pgError(403, "42501"),
    () => pgError(400, "23514"),
    () => pgError(500, "XX000"),
    () => new Response("not json", { status: 200, headers: { "content-range": "0-0/1" } }),
  ];
  for (const reply of replies) {
    stubFetch(reply);
    await post({ kind: "font", id: "abel" });
    await get();
  }
  assert.ok(logs.length >= replies.length);
  for (const line of logs) {
    assertNoLeaks(line);
    assert.ok(!line.includes("is involved"), "a Supabase message was logged");
  }
});

test("the saved API code is server-only: nothing in src/ or partials/ references it", () => {
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(m?js|html)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  for (const file of [...walk(path.join(REPO, "src")), ...walk(path.join(REPO, "partials"))]) {
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!/SAVED_ENABLED|netlify\/lib\/saved|rest\/v1/.test(text), path.relative(REPO, file));
  }
});
