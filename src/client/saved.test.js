/**
 * saved.test.js — the browser half of account Saved, src/client/saved.js.
 *
 * Runs the real saved.js in a vm against src/client/test-dom.js: a DOM whose
 * innerHTML throws, storage that logs every key it is asked for, and a fetch
 * that records every request and answers from a small in-memory stand-in
 * for /api/saved. window.BpozzAuth is a stub with auth.js's public shape:
 * getSession, refreshSession (which, like auth.js, fires bpozz:session with
 * the fresh answer) and open.
 *
 * The file ships with LAUNCHED = false. The first tests run it exactly as
 * shipped; the rest switch that one line on in memory, the way launch will.
 *
 * All account data below is invented.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { makeDocument, fire, dispatch, makeStorage, response, deferred, settle, wait } = require("./test-dom.js");

const SOURCE = fs.readFileSync(path.join(__dirname, "saved.js"), "utf8");
const LAUNCH_LINE = "var LAUNCHED = false;";

const SIGNED_IN = { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000000", email: "dee@example.test" } };
const SIGNED_OUT = { authenticated: false, user: null };
const IMAGE = "1e193b-322a57-5438e6";

// Values made inside the vm have its own prototypes; compare their JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A stand-in for /api/saved and /api/saved/import, answering like the real one. */
function fakeServer({ saved = [] } = {}) {
  const rows = saved.map(([kind, id]) => ({ kind, id }));
  const has = (kind, id) => rows.some((r) => r.kind === kind && r.id === id);
  const handler = (method, url, body) => {
    const u = new URL(url, "https://bpozz.com");
    if (u.pathname === "/api/saved" && method === "GET") {
      const kind = u.searchParams.get("kind");
      const items = rows
        .filter((r) => !kind || r.kind === kind)
        .map((r) => ({ kind: r.kind, id: r.id, saved_at: "2026-09-29T12:00:00+00:00" }));
      return response(200, { items, count: items.length, limits: { total: 1000, image_palette: 200 } });
    }
    if (u.pathname === "/api/saved" && method === "POST") {
      const exists = has(body.kind, body.id);
      if (!exists) rows.push({ kind: body.kind, id: body.id });
      return response(exists ? 200 : 201, { saved: true, created: !exists });
    }
    if (u.pathname === "/api/saved" && method === "DELETE") {
      const at = rows.findIndex((r) => r.kind === u.searchParams.get("kind") && r.id === u.searchParams.get("id"));
      if (at >= 0) rows.splice(at, 1);
      return response(200, { saved: false, removed: at >= 0 });
    }
    if (u.pathname === "/api/saved/import" && method === "POST") {
      const results = body.items.map((item) => {
        if (has(item.kind, item.id)) return { ...item, status: "exists" };
        rows.push({ kind: item.kind, id: item.id });
        return { ...item, status: "created" };
      });
      return response(200, { results });
    }
    return response(404, { error: "not_found" });
  };
  return { handler, rows };
}

/**
 * A BroadcastChannel shared by the tabs of one test. Like the real one, a
 * closed channel hears nothing and throws if asked to post.
 */
function channelHub() {
  const members = [];
  const messages = [];
  let created = 0;
  class Channel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      created += 1;
      members.push(this);
    }
    postMessage(data) {
      if (this.closed) throw new Error("InvalidStateError: the channel is closed");
      const copy = JSON.parse(JSON.stringify(data)); // what structured cloning gives the other side
      messages.push(copy);
      members
        .filter((m) => m !== this && m.name === this.name && m.onmessage)
        .forEach((m) => m.onmessage({ data: copy }));
    }
    close() {
      this.closed = true;
      const at = members.indexOf(this);
      if (at >= 0) members.splice(at, 1);
    }
  }
  return { Channel, messages, open: () => members.length, created: () => created };
}

function control(doc, kind, id, attrs = {}) {
  const button = doc.createElement("button");
  button.setAttribute("type", "button");
  button.setAttribute("data-save-kind", kind);
  button.setAttribute("data-save-id", id);
  button.setAttribute("aria-pressed", "false");
  for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
  return doc.body.appendChild(button);
}

/**
 * Loads saved.js into a fresh page.
 *
 *   launched  false runs the file as shipped; true switches LAUNCHED on
 *   session   what BpozzAuth.getSession() resolves to (a value or a promise)
 *   refresh   refreshSession()'s answers in order, the last repeating; each
 *             a value, a promise or a function returning one
 *   api       (method, url, body) => a response (or a promise of one)
 *   controls  [[kind, id, attrs?]] — buttons already in the page
 *   storage   localStorage's contents; storageThrows blocks it entirely
 *   channel   a BroadcastChannel class, or none
 *   toast     false: no site toast (the pages that skip app.js)
 *   now       { t } — a clock for Date.now()
 *   auth      false: no window.BpozzAuth at all
 */
function load({
  launched = true,
  session = SIGNED_IN,
  refresh = [SIGNED_IN],
  api = fakeServer().handler,
  controls = [],
  storage = {},
  storageThrows = false,
  channel = null,
  toast = true,
  now = null,
  auth = true,
} = {}) {
  const doc = makeDocument();
  const nodes = controls.map(([kind, id, attrs]) => control(doc, kind, id, attrs));
  const calls = [];
  const log = [];
  const toasts = [];
  const opened = [];
  const refreshes = [];
  const likeDeltas = [];
  const windowListeners = {};
  const local = makeStorage("localStorage", log, { initial: storage, throws: storageThrows });
  const sessionStore = makeStorage("sessionStorage", log);
  let refreshIndex = 0;

  const ctx = {
    console,
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: doc,
    fetch: (url, init = {}) => {
      const method = init.method || "GET";
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ url, method, credentials: init.credentials, headers: { ...init.headers }, body });
      return Promise.resolve().then(() => api(method, url, body));
    },
    addEventListener: (type, fn) => (windowListeners[type] ||= []).push(fn),
    // The palette Like's Firebase hook: saved.js must never call it.
    __bpozzLikeDelta: (...args) => likeDeltas.push(args),
  };
  Object.defineProperty(ctx, "localStorage", { get: () => (log.push(["localStorage", "access"]), local) });
  Object.defineProperty(ctx, "sessionStorage", { get: () => (log.push(["sessionStorage", "access"]), sessionStore) });
  if (toast) ctx.bpozzShowToast = (message) => toasts.push(message);
  if (channel) ctx.BroadcastChannel = channel;
  if (now) ctx.Date = { now: () => now.t };
  if (auth) {
    ctx.BpozzAuth = {
      getSession: () => Promise.resolve(session),
      refreshSession: () => {
        const answer = refresh[Math.min(refreshIndex++, refresh.length - 1)];
        refreshes.push(answer);
        return Promise.resolve(typeof answer === "function" ? answer() : answer).then((data) => {
          dispatch(doc, "bpozz:session", { authenticated: !!(data && data.authenticated === true && data.user) });
          return data;
        });
      },
      open: (mode, trigger) => opened.push([mode, trigger]),
    };
  }
  ctx.window = ctx;

  const source = launched ? SOURCE.replace(LAUNCH_LINE, "var LAUNCHED = true;") : SOURCE;
  vm.runInNewContext(source, ctx);

  return {
    doc,
    ctx,
    api: ctx.BpozzSaved,
    nodes,
    calls,
    log,
    toasts,
    opened,
    refreshes,
    likeDeltas,
    local,
    writes: () => calls.filter((c) => c.method !== "GET"),
    status: () => {
      const region = doc.querySelector("[data-saved-status]");
      return region ? region.textContent : null;
    },
    fireWindow: (type, extra = {}) => (windowListeners[type] || []).forEach((fn) => fn({ type, ...extra })),
    windowListeners,
  };
}

const pressed = (node) => node.getAttribute("aria-pressed");
const onlyGets = (api) => (method, url, body) => (method === "GET" ? response(200, { items: [] }) : api(method, url, body));

// ---------------------------------------------------------------------
// shipped dormant
// ---------------------------------------------------------------------

test("as shipped (LAUNCHED false): only the pure helpers — no listener, request or storage", async () => {
  const p = load({
    launched: false,
    controls: [["font", "abel"]],
    storage: { "bpozz:font-favorites": JSON.stringify(["abel"]) },
  });
  await settle();
  assert.deepStrictEqual(Object.keys(p.api).sort(), ["active", "imagePaletteId", "isValidItem", "kinds", "limits"]);
  assert.strictEqual(p.api.active, false);
  assert.ok(Object.isFrozen(p.api));
  assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), null);
  assert.deepStrictEqual(Object.keys(p.doc._listeners), []);
  assert.deepStrictEqual(Object.keys(p.windowListeners), []);

  fire(p.doc, p.nodes[0], "click");
  await settle();
  assert.deepStrictEqual(p.calls, []);
  assert.deepStrictEqual(p.log, []);
  assert.deepStrictEqual(p.opened, []);
  assert.strictEqual(pressed(p.nodes[0]), "false");
});

test("the launch switch is one line of the shipped file, and it is off", () => {
  assert.strictEqual(SOURCE.split(LAUNCH_LINE).length - 1, 1);
  assert.ok(!SOURCE.includes("var LAUNCHED = true;"));
});

test("a second copy on the same page does nothing", async () => {
  const p = load({ controls: [["font", "abel"]] });
  await settle();
  const first = p.ctx.BpozzSaved;
  vm.runInNewContext(SOURCE.replace(LAUNCH_LINE, "var LAUNCHED = true;"), p.ctx);
  await settle();
  assert.strictEqual(p.ctx.BpozzSaved, first);
  assert.strictEqual(p.calls.length, 1, "no second list request");
});

// ---------------------------------------------------------------------
// session and lists
// ---------------------------------------------------------------------

test("active: <html data-saved-ui>, and no Saved request until the session answers", async () => {
  const answer = deferred();
  const server = fakeServer({ saved: [["font", "abel"]] });
  const p = load({ session: answer.promise, api: server.handler, controls: [["font", "abel"], ["font", "acme"]] });
  assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), "on");
  await settle();
  assert.deepStrictEqual(p.calls, []);
  assert.strictEqual(p.api.signedIn(), null);
  assert.strictEqual(p.api.has("font", "abel"), null);

  answer.resolve(SIGNED_IN);
  await settle();
  assert.deepStrictEqual(p.calls.map((c) => [c.method, c.url]), [["GET", "/api/saved?kind=font"]]);
  assert.strictEqual(p.api.signedIn(), true);
  assert.strictEqual(pressed(p.nodes[0]), "true");
  assert.strictEqual(pressed(p.nodes[1]), "false");
});

test("one same-origin list request per kind on the page; none on a page without controls", async () => {
  const p = load({ controls: [["font", "abel"], ["font", "acme"], ["palette", "p001"]] });
  await settle();
  assert.deepStrictEqual(p.calls.map((c) => c.url).sort(), ["/api/saved?kind=font", "/api/saved?kind=palette"]);
  for (const call of p.calls) {
    assert.strictEqual(call.method, "GET");
    assert.strictEqual(call.credentials, "same-origin");
    assert.strictEqual(call.headers.Accept, "application/json");
    assert.strictEqual(call.body, undefined);
  }

  const bare = load();
  await settle();
  assert.deepStrictEqual(bare.calls, []);
});

test("the list draws pressed states; items with an unknown kind or a bad id are ignored", async () => {
  const p = load({
    controls: [["font", "abel"], ["font", "acme"]],
    api: () =>
      response(200, {
        items: [
          { kind: "font", id: "abel", saved_at: "2026-09-29T12:00:00+00:00" },
          { kind: "font", id: "Acme" },
          { kind: "roadmap", id: "acme" },
          "acme",
          null,
        ],
      }),
  });
  await settle();
  assert.strictEqual(pressed(p.nodes[0]), "true");
  assert.strictEqual(pressed(p.nodes[1]), "false");
  assert.strictEqual(p.api.has("font", "abel"), true);
  assert.strictEqual(p.api.has("font", "acme"), false);
});

test("signed out: Save opens the existing sign-in dialog — no request, nothing stored", async () => {
  const p = load({ session: SIGNED_OUT, controls: [["font", "abel"]] });
  await settle();
  fire(p.doc, p.nodes[0], "click");
  await settle();
  assert.deepStrictEqual(p.opened.map(([mode, trigger]) => [mode, trigger === p.nodes[0]]), [["signin", true]]);
  assert.deepStrictEqual(p.calls, []);
  assert.deepStrictEqual(p.log, []);
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.strictEqual(p.api.signedIn(), false);
});

test("with no auth.js on the page it stays signed out and asks for nothing", async () => {
  const p = load({ auth: false, controls: [["font", "abel"]] });
  await settle();
  assert.strictEqual(p.api.signedIn(), false);
  fire(p.doc, p.nodes[0], "click");
  await settle();
  assert.deepStrictEqual(p.calls, []);
});

test("sync(root) takes charge of controls drawn later and loads their kind once", async () => {
  const server = fakeServer({ saved: [["palette", "p003"], ["image_palette", IMAGE]] });
  const p = load({ api: server.handler });
  await settle();
  assert.deepStrictEqual(p.calls, []);

  const grid = p.doc.body.appendChild(p.doc.createElement("div"));
  const later = grid.appendChild(control(p.doc, "palette", "p003"));
  const other = grid.appendChild(control(p.doc, "palette", "p004"));
  p.api.sync(grid);
  await settle();
  assert.deepStrictEqual(p.calls.map((c) => c.url), ["/api/saved?kind=palette"]);
  assert.strictEqual(pressed(later), "true");
  assert.strictEqual(pressed(other), "false");

  p.api.sync(grid);
  await settle();
  assert.strictEqual(p.calls.length, 1, "already loaded");

  // A single control can be handed over too — the Image Picker's, say.
  const single = control(p.doc, "image_palette", IMAGE);
  p.api.sync(single);
  await settle();
  assert.deepStrictEqual(p.calls.map((c) => c.url), ["/api/saved?kind=palette", "/api/saved?kind=image_palette"]);
  assert.strictEqual(pressed(single), "true");
});

// ---------------------------------------------------------------------
// save and unsave
// ---------------------------------------------------------------------

test("save: POST {kind, id} exactly, shown at once; created or already saved both end pressed", async () => {
  for (const status of [201, 200]) {
    const gate = deferred();
    const p = load({
      controls: [["font", "abel", { "data-save-name": "Abel" }]],
      api: onlyGets(() => gate.promise.then(() => response(status, { saved: true, created: status === 201 }))),
    });
    await settle();
    const icon = p.nodes[0].appendChild(p.doc.createElement("span"));
    fire(p.doc, icon, "click");
    await settle();
    assert.strictEqual(pressed(p.nodes[0]), "true", "shown before the answer");
    assert.strictEqual(p.nodes[0].getAttribute("aria-busy"), "true");

    const [post] = p.writes();
    assert.deepStrictEqual(
      { method: post.method, url: post.url, body: post.body, type: post.headers["Content-Type"], credentials: post.credentials },
      { method: "POST", url: "/api/saved", body: { kind: "font", id: "abel" }, type: "application/json", credentials: "same-origin" },
    );

    gate.resolve();
    await settle();
    assert.strictEqual(pressed(p.nodes[0]), "true");
    assert.strictEqual(p.nodes[0].getAttribute("aria-busy"), null);
    await wait(80);
    assert.strictEqual(p.status(), "Abel saved to your account");
    assert.deepStrictEqual(p.toasts, []);
  }
});

test("unsave: DELETE /api/saved?kind=&id=; removed or already gone both end unpressed", async () => {
  for (const removed of [true, false]) {
    const p = load({
      controls: [["image_palette", IMAGE]],
      api: (method) =>
        method === "GET"
          ? response(200, { items: [{ kind: "image_palette", id: IMAGE }] })
          : response(200, { saved: false, removed }),
    });
    await settle();
    assert.strictEqual(pressed(p.nodes[0]), "true");
    fire(p.doc, p.nodes[0], "click");
    await settle();
    const [del] = p.writes();
    assert.strictEqual(del.method, "DELETE");
    assert.strictEqual(del.url, `/api/saved?kind=image_palette&id=${IMAGE}`);
    assert.strictEqual(del.body, undefined);
    assert.strictEqual(pressed(p.nodes[0]), "false");
    await wait(80);
    assert.strictEqual(p.status(), "Removed from your Saved");
  }
});

test("clicks on one item go out one at a time and end where the last click left it", async () => {
  const server = fakeServer();
  const gates = [];
  const p = load({
    controls: [["color", "c001"]],
    api: (method, url, body) => {
      if (method === "GET") return server.handler(method, url, body);
      const gate = deferred();
      gates.push(gate);
      return gate.promise.then(() => server.handler(method, url, body));
    },
  });
  await settle();
  const button = p.nodes[0];

  fire(p.doc, button, "click"); // save
  await settle();
  fire(p.doc, button, "click"); // unsave, while the save is out
  await settle();
  assert.strictEqual(gates.length, 1, "the second change waits for the first");
  assert.strictEqual(pressed(button), "false", "but is shown at once");
  gates[0].resolve();
  await settle();
  assert.strictEqual(gates.length, 2);
  gates[1].resolve();
  await settle();
  assert.deepStrictEqual(p.writes().map((c) => c.method), ["POST", "DELETE"]);
  assert.strictEqual(pressed(button), "false");
  assert.deepStrictEqual(server.rows, []);

  // save, unsave, save: the middle click never needs a request of its own
  fire(p.doc, button, "click");
  await settle();
  fire(p.doc, button, "click");
  await settle();
  fire(p.doc, button, "click");
  await settle();
  gates[2].resolve();
  await settle();
  assert.strictEqual(gates.length, 3);
  assert.strictEqual(pressed(button), "true");
  assert.deepStrictEqual(server.rows, [{ kind: "color", id: "c001" }]);
});

test("save()/remove() use the same queue and resolve with the outcome", async () => {
  const server = fakeServer({ saved: [["color", "c002"]] });
  const p = load({ api: server.handler, controls: [["color", "c002"]] });
  await settle();
  assert.deepStrictEqual(plain(await p.api.remove("color", "c002")), { ok: true, saved: false });
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.deepStrictEqual(plain(await p.api.save("color", "c003")), { ok: true, saved: true });
  const bad = await p.api.save("color", "C003");
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(p.writes().length, 2, "a malformed id never leaves the browser");
});

// ---------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------

test("401s arriving together share one session refresh, then each request is sent once more", async () => {
  let expired = true;
  const server = fakeServer();
  const refreshed = deferred();
  const p = load({
    controls: [["font", "abel"], ["font", "acme"]],
    refresh: [refreshed.promise],
    api: (method, url, body) =>
      method !== "GET" && expired ? response(401, { error: "unauthenticated" }) : server.handler(method, url, body),
  });
  await settle();
  fire(p.doc, p.nodes[0], "click");
  fire(p.doc, p.nodes[1], "click");
  await settle();
  assert.strictEqual(p.refreshes.length, 1, "one refresh for both");

  expired = false;
  refreshed.resolve(SIGNED_IN);
  await settle(10);
  assert.strictEqual(p.writes().length, 4, "each sent twice: before and after the refresh");
  assert.strictEqual(pressed(p.nodes[0]), "true");
  assert.strictEqual(pressed(p.nodes[1]), "true");
  assert.deepStrictEqual(p.opened, []);
  assert.deepStrictEqual(p.toasts, []);
});

test("a 401 the refresh can't fix: signed out, everything reset, sign-in offered to whoever clicked", async () => {
  const p = load({
    controls: [["guide", "type-scale-systems"], ["font", "abel"]],
    refresh: [SIGNED_OUT],
    api: (method) =>
      method === "GET"
        ? response(200, { items: [{ kind: "font", id: "abel" }] })
        : response(401, { error: "unauthenticated" }),
  });
  await settle();
  assert.strictEqual(pressed(p.nodes[1]), "true");
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  assert.strictEqual(p.refreshes.length, 1);
  assert.strictEqual(p.writes().length, 1, "not sent again");
  assert.strictEqual(p.api.signedIn(), false);
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.strictEqual(pressed(p.nodes[1]), "false", "the saved state was forgotten");
  assert.strictEqual(p.api.has("font", "abel"), null);
  assert.deepStrictEqual(p.opened.map(([mode, trigger]) => [mode, trigger === p.nodes[0]]), [["signin", true]]);
  await wait(80);
  assert.strictEqual(p.status(), "You’ve been signed out. Sign in to save.");
});

test("a 401 again after a refresh that said signed in: treated as signed out", async () => {
  const p = load({
    controls: [["font", "abel"]],
    refresh: [SIGNED_IN],
    api: onlyGets(() => response(401, { error: "unauthenticated" })),
  });
  await settle();
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  assert.strictEqual(p.refreshes.length, 1);
  assert.strictEqual(p.writes().length, 2);
  assert.strictEqual(p.api.signedIn(), false);
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.strictEqual(p.opened.length, 1);
});

test("429: undone, 'Too many changes', never retried, never refreshed, body never read", async () => {
  let read = false;
  const p = load({
    controls: [["palette", "p001"]],
    api: onlyGets(() => ({
      ok: false,
      status: 429,
      headers: { get: () => "text/plain" },
      json: () => {
        read = true;
        return Promise.reject(new Error("read"));
      },
    })),
  });
  await settle();
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.deepStrictEqual(p.toasts, ["Too many changes at once. Try again in a minute."]);
  assert.strictEqual(p.writes().length, 1);
  assert.strictEqual(p.refreshes.length, 0);
  assert.strictEqual(read, false);
});

test("409: the total limit and the Image Picker limit each have their own message", async () => {
  const cases = [
    [
      ["font", "abel"],
      { error: "limit_reached", limit: 1000 },
      "Your Saved list is full (1,000 items). Remove something in Your Account → Saved to save more.",
    ],
    [
      ["image_palette", IMAGE],
      { error: "limit_reached", limit: 200, kind: "image_palette" },
      "You’ve saved 200 Image Picker palettes, the most allowed.",
    ],
  ];
  for (const [item, body, message] of cases) {
    const p = load({ controls: [item], api: onlyGets(() => response(409, body)) });
    await settle();
    fire(p.doc, p.nodes[0], "click");
    await settle(10);
    assert.strictEqual(pressed(p.nodes[0]), "false");
    assert.deepStrictEqual(p.toasts, [message]);
  }
});

test("503, a network failure, a timeout, or a 2xx that isn't JSON: undone, 'isn’t available'", async () => {
  const failures = [
    () => response(503, { error: "saved_unavailable" }),
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => Promise.reject(Object.assign(new Error("signal timed out"), { name: "TimeoutError" })),
    () => response(200, undefined, "text/html"),
  ];
  for (const fail of failures) {
    const p = load({ controls: [["color", "c001"]], api: onlyGets(fail) });
    await settle();
    fire(p.doc, p.nodes[0], "click");
    await settle(10);
    assert.strictEqual(pressed(p.nodes[0]), "false");
    assert.deepStrictEqual(p.toasts, ["Saving isn’t available right now. Please try again later."]);
  }
});

test("400, 403, or a 200 that doesn't confirm the change: undone with the plain message", async () => {
  const cases = [
    [false, () => response(400, { error: "invalid_request" }), "Couldn’t save that. Please try again."],
    [false, () => response(403, { error: "forbidden" }), "Couldn’t save that. Please try again."],
    [false, () => response(200, { saved: false, removed: false }), "Couldn’t save that. Please try again."],
    [true, () => response(400, { error: "invalid_request" }), "Couldn’t remove that. Please try again."],
  ];
  for (const [savedAlready, answer, message] of cases) {
    const p = load({
      controls: [["guide", "type-scale-systems"]],
      api: (method) =>
        method === "GET"
          ? response(200, { items: savedAlready ? [{ kind: "guide", id: "type-scale-systems" }] : [] })
          : answer(),
    });
    await settle();
    fire(p.doc, p.nodes[0], "click");
    await settle(10);
    assert.strictEqual(pressed(p.nodes[0]), String(savedAlready));
    assert.deepStrictEqual(p.toasts, [message]);
  }
});

test("a list that fails: controls stay neutral, one message for the page, and Save still works", async () => {
  const server = fakeServer({ saved: [["font", "abel"]] });
  const p = load({
    controls: [["font", "abel"], ["palette", "p002"]],
    api: (method, url, body) =>
      method === "GET" ? response(503, { error: "saved_unavailable" }) : server.handler(method, url, body),
  });
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.deepStrictEqual(p.toasts, ["Couldn’t load your Saved items right now."], "once, though two lists failed");
  assert.strictEqual(p.api.has("font", "abel"), null);

  fire(p.doc, p.nodes[0], "click"); // already saved on the server: 200 created:false
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "true");
});

// ---------------------------------------------------------------------
// sign-out, other tabs, freshness
// ---------------------------------------------------------------------

test("bpozz:session signed out (a sign-out anywhere on the page): memory cleared, controls reset", async () => {
  const server = fakeServer({ saved: [["font", "abel"], ["guide", "type-scale-systems"]] });
  const p = load({ api: server.handler, controls: [["font", "abel"], ["guide", "type-scale-systems"]] });
  await settle();
  const heard = [];
  p.api.onChange(() => heard.push(p.api.signedIn()));
  assert.ok(p.nodes.every((node) => pressed(node) === "true"));

  dispatch(p.doc, "bpozz:session", { authenticated: false });
  assert.ok(p.nodes.every((node) => pressed(node) === "false"));
  assert.strictEqual(p.api.has("font", "abel"), null);
  assert.strictEqual(p.api.signedIn(), false);
  assert.deepStrictEqual(heard, [false]);

  fire(p.doc, p.nodes[0], "click");
  await settle();
  assert.strictEqual(p.opened.length, 1, "signed out now: Save offers sign-in");
});

test("BroadcastChannel: a change in one tab repaints another; a browser without it is fine", async () => {
  const hub = channelHub();
  const server = fakeServer();
  const a = load({ controls: [["font", "abel"]], api: server.handler, channel: hub.Channel });
  const b = load({ controls: [["font", "abel"]], api: server.handler, channel: hub.Channel });
  await settle();
  fire(a.doc, a.nodes[0], "click");
  await settle(10);
  assert.strictEqual(pressed(b.nodes[0]), "true");
  assert.deepStrictEqual(hub.messages, [{ type: "item", kind: "font", id: "abel", saved: true }]);
  assert.strictEqual(b.writes().length, 0, "the other tab sends nothing");

  // A sign-out in one tab makes the other ask the server, not take its word.
  dispatch(a.doc, "bpozz:session", { authenticated: false });
  await settle(10);
  assert.deepStrictEqual(hub.messages.slice(1), [{ type: "session" }]);
  assert.strictEqual(b.refreshes.length, 1);

  const alone = load({ controls: [["font", "abel"]], api: server.handler });
  await settle();
  fire(alone.doc, alone.nodes[0], "click");
  await settle(10);
  assert.strictEqual(alone.writes().length, 1);
});

test("refetched after a back/forward restore, and when shown again 5+ minutes after loading", async () => {
  const clock = { t: 1_000_000 };
  const p = load({ controls: [["color", "c001"]], now: clock });
  await settle();
  const lists = () => p.calls.filter((c) => c.method === "GET").length;
  assert.strictEqual(lists(), 1);

  p.fireWindow("pageshow", { persisted: false });
  await settle();
  assert.strictEqual(lists(), 1, "an ordinary load is not a restore");
  p.fireWindow("pageshow", { persisted: true });
  await settle();
  assert.strictEqual(lists(), 2);

  clock.t += 4 * 60 * 1000;
  dispatch(p.doc, "visibilitychange");
  await settle();
  assert.strictEqual(lists(), 2, "4 minutes: still fresh");

  clock.t += 2 * 60 * 1000;
  p.doc.visibilityState = "hidden";
  dispatch(p.doc, "visibilitychange");
  await settle();
  assert.strictEqual(lists(), 2, "hidden: nothing to refresh for");
  p.doc.visibilityState = "visible";
  dispatch(p.doc, "visibilitychange");
  await settle();
  assert.strictEqual(lists(), 3);
});

test("BroadcastChannel: closed on pagehide, opened again on pageshow; a restored page refetches what it missed", async () => {
  const hub = channelHub();
  const server = fakeServer();
  const a = load({ controls: [["font", "abel"]], api: server.handler, channel: hub.Channel });
  const b = load({ controls: [["font", "abel"]], api: server.handler, channel: hub.Channel });
  await settle();
  assert.strictEqual(hub.open(), 2);

  a.fireWindow("pagehide", { persisted: true }); // a goes into the back/forward cache
  assert.strictEqual(hub.open(), 1, "a's channel is closed");
  fire(b.doc, b.nodes[0], "click"); // b saves meanwhile
  await settle(10);
  assert.strictEqual(pressed(a.nodes[0]), "false", "a hears nothing while hidden");

  a.fireWindow("pageshow", { persisted: true }); // a is restored
  await settle(10);
  assert.strictEqual(hub.open(), 2, "a's channel is open again");
  assert.strictEqual(hub.created(), 3);
  assert.strictEqual(pressed(a.nodes[0]), "true", "the refetch caught what a missed");

  fire(a.doc, a.nodes[0], "click"); // a's new channel works both ways
  await settle(10);
  assert.strictEqual(pressed(b.nodes[0]), "false");
});

test("BroadcastChannel: an ordinary pageshow opens no second one; while dormant none is opened at all", async () => {
  const hub = channelHub();
  const p = load({ controls: [["font", "abel"]], channel: hub.Channel });
  await settle();
  p.fireWindow("pageshow", { persisted: false }); // every page load fires this
  await settle();
  assert.strictEqual(hub.created(), 1);
  assert.strictEqual(hub.open(), 1);

  const dormant = load({ launched: false, controls: [["font", "abel"]], channel: hub.Channel });
  await settle();
  dormant.fireWindow("pagehide", { persisted: true });
  dormant.fireWindow("pageshow", { persisted: true });
  await settle();
  assert.strictEqual(hub.created(), 1, "no channel while LAUNCHED is false");
  assert.deepStrictEqual(Object.keys(dormant.windowListeners), [], "and no pagehide/pageshow listener");
  assert.deepStrictEqual(dormant.calls, []);
});

// ---------------------------------------------------------------------
// a list answer that was already on its way
// ---------------------------------------------------------------------

test("an older list answer does not undo a save confirmed after that list was requested", async () => {
  const server = fakeServer();
  const held = deferred();
  const p = load({
    controls: [["font", "abel"]],
    api: (method, url, body) => {
      const answer = server.handler(method, url, body); // what the server holds at this moment
      return method === "GET" ? held.promise.then(() => answer) : answer;
    },
  });
  await settle(); // the list is asked for; its answer (nothing saved) is held
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "true", "the save is confirmed");
  held.resolve();
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "true", "not undone by the older answer");
  assert.strictEqual(p.api.has("font", "abel"), true);
});

test("an older list answer does not undo a removal confirmed after that list was requested", async () => {
  const server = fakeServer({ saved: [["palette", "p001"]] });
  let hold = null;
  const p = load({
    controls: [["palette", "p001"]],
    api: (method, url, body) => {
      const answer = server.handler(method, url, body);
      return method === "GET" && hold ? hold.promise.then(() => answer) : answer;
    },
  });
  await settle();
  assert.strictEqual(pressed(p.nodes[0]), "true");
  hold = deferred();
  p.fireWindow("pageshow", { persisted: true }); // a refetch goes out; its answer (still saved) is held
  await settle();
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "false", "the removal is confirmed");
  hold.resolve();
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "false", "not undone by the older answer");
  assert.strictEqual(p.api.has("palette", "p001"), false);
});

test("an older list answer does not undo what another tab reported meanwhile", async () => {
  const hub = channelHub();
  const server = fakeServer();
  const held = deferred();
  const a = load({ controls: [["color", "c001"]], api: server.handler, channel: hub.Channel });
  await settle();
  const b = load({
    controls: [["color", "c001"]],
    channel: hub.Channel,
    api: (method, url, body) => {
      const answer = server.handler(method, url, body);
      return method === "GET" ? held.promise.then(() => answer) : answer;
    },
  });
  await settle(); // b's list is out; its answer (nothing saved) is held
  fire(a.doc, a.nodes[0], "click");
  await settle(10);
  assert.strictEqual(pressed(b.nodes[0]), "true", "b heard a's save");
  held.resolve();
  await settle(10);
  assert.strictEqual(pressed(b.nodes[0]), "true", "b's older answer did not undo it");
});

test("list(): an older answer leaves out what was removed since and puts what was saved since first", async () => {
  const server = fakeServer({ saved: [["color", "c001"], ["font", "abel"]] });
  let hold = null;
  const p = load({
    controls: [["color", "c001"]],
    api: (method, url, body) => {
      const answer = server.handler(method, url, body);
      return method === "GET" && hold ? hold.promise.then(() => answer) : answer;
    },
  });
  await settle();
  assert.strictEqual(pressed(p.nodes[0]), "true");
  const gate = (hold = deferred());
  const pending = p.api.list(); // the whole list; its answer (c001 and abel) is held
  await settle();
  hold = null;
  fire(p.doc, p.nodes[0], "click"); // c001 removed while that answer is out
  await settle(10);
  assert.deepStrictEqual(plain(await p.api.save("guide", "type-scale-systems")), { ok: true, saved: true });
  gate.resolve();
  const result = await pending;
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(plain(result.items).map((i) => [i.kind, i.id, i.saved_at]), [
    ["guide", "type-scale-systems", ""],
    ["font", "abel", "2026-09-29T12:00:00+00:00"],
  ]);
  assert.strictEqual(result.count, 2);
  assert.strictEqual(pressed(p.nodes[0]), "false");
  assert.strictEqual(p.api.has("color", "c001"), false);
  assert.strictEqual(p.api.has("guide", "type-scale-systems"), true);
});

test("a change confirmed before a list was requested is not re-applied over that newer answer", async () => {
  const server = fakeServer();
  const p = load({ controls: [["font", "abel"]], api: server.handler });
  await settle();
  fire(p.doc, p.nodes[0], "click"); // saved and confirmed
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "true");
  server.rows.length = 0; // removed on another device; no message reaches this tab
  p.fireWindow("pageshow", { persisted: true }); // the next list is asked for after the save
  await settle(10);
  assert.strictEqual(pressed(p.nodes[0]), "false", "the newer answer wins");
  assert.strictEqual(p.api.has("font", "abel"), false);
});

// ---------------------------------------------------------------------
// what it leaves alone
// ---------------------------------------------------------------------

test("storage: only the three documented keys; roadmap progress unread; likes, sessionStorage and Firebase untouched", async () => {
  const roadmap = JSON.stringify(["type-scale-systems"]);
  const likes = JSON.stringify(["p001", "p002"]);
  const p = load({
    controls: [["font", "abel"], ["palette", "p001"], ["guide", "type-scale-systems"]],
    storage: {
      "bpozz:font-favorites": JSON.stringify(["abel", "acme"]),
      "bpozz-palette-likes": likes,
      "point-roadmap-progress": roadmap,
    },
  });
  await settle();
  p.nodes.forEach((node) => fire(p.doc, node, "click"));
  await settle(10);
  p.api.legacy();
  p.api.importDismissed();
  await p.api.importLegacy({ palettes: true });
  await settle();

  const keys = new Set(p.log.filter(([, op]) => op !== "access").map(([, , key]) => key));
  assert.deepStrictEqual([...keys].sort(), ["bpozz-palette-likes", "bpozz:font-favorites", "bpozz:saved-import"]);
  assert.ok(!p.log.some(([area]) => area === "sessionStorage"), "sessionStorage untouched");
  assert.deepStrictEqual(
    p.log.filter(([, op, key]) => key === "bpozz-palette-likes").map(([, op]) => op),
    ["get", "get"],
    "likes only ever read",
  );
  assert.strictEqual(p.local.dump()["bpozz-palette-likes"], likes);
  assert.strictEqual(p.local.dump()["point-roadmap-progress"], roadmap);
  assert.deepStrictEqual(p.likeDeltas, []);
});

test("nothing from the server, storage or a control reaches the page as markup", async () => {
  const p = load({
    toast: false,
    controls: [["font", "abel", { "data-save-name": "<img src=x onerror=alert(1)>" }]],
    storage: { "bpozz:font-favorites": JSON.stringify(["<script>", "abel"]) },
    api: (method) =>
      method === "GET"
        ? response(200, {
            items: [
              { kind: "font", id: "<b>abel</b>" },
              { kind: "font", id: "abel", saved_at: "<script>" },
            ],
          })
        : response(200, { saved: false, removed: true }),
  });
  await settle(); // the DOM stub throws on any innerHTML write
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  await wait(80);
  assert.strictEqual(p.status(), "<img src=x onerror=alert(1)> removed from your Saved");
  assert.deepStrictEqual(plain(p.api.legacy().fonts), ["abel"]);
});

// ---------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------

test("imagePaletteId: 3 to 8 colours become lowercase hex joined by '-'; anything else is null", () => {
  const { imagePaletteId, isValidItem } = load({ launched: false }).api;
  assert.strictEqual(imagePaletteId(["#1E193B", "#322A57", "#5438E6"]), IMAGE);
  const eight = ["1e193b", "#322a57", "#5438E6", "#3876C8", "#000000", "#FFFFFF", "#ABCDEF", "#123456"];
  assert.strictEqual(imagePaletteId(eight), "1e193b-322a57-5438e6-3876c8-000000-ffffff-abcdef-123456");
  assert.ok(isValidItem("image_palette", imagePaletteId(eight)));
  const bad = [
    ["#1E193B", "#322A57"],
    new Array(9).fill("#1E193B"),
    ["#1E193", "#322A57", "#5438E6"],
    ["#1E193BB", "#322A57", "#5438E6"],
    ["red", "#322A57", "#5438E6"],
    [1, 2, 3],
    null,
    "#1E193B",
  ];
  for (const value of bad) assert.strictEqual(imagePaletteId(value), null, JSON.stringify(value));
});

test("isValidItem: the six kinds and their id rules; roadmap is not a kind", () => {
  const { isValidItem, kinds, limits } = load({ launched: false }).api;
  assert.deepStrictEqual([...kinds], ["color", "palette", "font", "icon", "guide", "image_palette"]);
  assert.deepStrictEqual({ ...limits }, { total: 1000, image_palette: 200 });
  assert.ok(isValidItem("color", "c1200"));
  assert.ok(isValidItem("icon", "outline-essentials--arrow-left"));
  assert.ok(!isValidItem("roadmap", "type-scale-systems"));
  assert.ok(!isValidItem("__proto__", "c001"));
  assert.ok(!isValidItem("font", "Abel"));
});

// ---------------------------------------------------------------------
// labels, toasts, lists for the account page
// ---------------------------------------------------------------------

test("a control's [data-save-label] reads Save / Saved, or the pair it names", async () => {
  const server = fakeServer({ saved: [["guide", "type-scale-systems"]] });
  const p = load({ api: server.handler, controls: [["guide", "type-scale-systems"], ["image_palette", IMAGE]] });
  const plainLabel = p.nodes[0].appendChild(p.doc.createElement("span"));
  plainLabel.setAttribute("data-save-label", "");
  const named = p.nodes[1].appendChild(p.doc.createElement("span"));
  named.setAttribute("data-save-label", "Save palette|Saved");
  p.api.sync();
  await settle();
  assert.strictEqual(plainLabel.textContent, "Saved");
  assert.strictEqual(named.textContent, "Save palette");
  fire(p.doc, p.nodes[1], "click");
  await settle(10);
  assert.strictEqual(named.textContent, "Saved");
});

test("without the site's toast (the pages that skip app.js), problems use a toast of the same kind", async () => {
  const p = load({ toast: false, controls: [["font", "abel"]], api: onlyGets(() => response(503, {})) });
  await settle();
  fire(p.doc, p.nodes[0], "click");
  await settle(10);
  const toast = p.doc.getElementById("saved-toast");
  assert.deepStrictEqual(
    [toast.className, toast.getAttribute("role"), toast.getAttribute("aria-live"), toast.getAttribute("data-visible")],
    ["toast", "status", "polite", "true"],
  );
  assert.strictEqual(toast.textContent, "Saving isn’t available right now. Please try again later.");
});

test("list(): the whole list, count and limits; it fills every kind; signed out asks for nothing", async () => {
  const server = fakeServer({ saved: [["font", "abel"], ["palette", "p001"], ["image_palette", IMAGE]] });
  const p = load({ api: server.handler });
  await settle();
  const all = await p.api.list();
  assert.strictEqual(all.ok, true);
  assert.deepStrictEqual(plain(all.items).map((i) => [i.kind, i.id]), [["font", "abel"], ["palette", "p001"], ["image_palette", IMAGE]]);
  assert.strictEqual(all.count, 3);
  assert.deepStrictEqual(plain(all.limits), { total: 1000, image_palette: 200 });
  assert.strictEqual(p.api.has("palette", "p001"), true);
  assert.strictEqual(p.api.has("color", "c001"), false, "the whole list answers for every kind");

  await p.api.list("font");
  assert.deepStrictEqual(p.calls.map((c) => c.url), ["/api/saved", "/api/saved?kind=font"]);
  assert.strictEqual((await p.api.list("roadmap")).ok, false);
  assert.strictEqual(p.calls.length, 2, "an unknown kind is never asked for");

  const out = load({ session: SIGNED_OUT });
  await settle();
  assert.deepStrictEqual(plain(await out.api.list()), { ok: false, reason: "signed-out" });
  assert.deepStrictEqual(plain(await out.api.save("font", "abel")), { ok: false, reason: "signed-out" });
  assert.deepStrictEqual(plain(await out.api.importLegacy()), { ok: false, reason: "signed-out" });
  assert.deepStrictEqual(out.calls, []);
});

// ---------------------------------------------------------------------
// this browser's saves from before accounts
// ---------------------------------------------------------------------

test("legacy(): only well-formed, de-duplicated ids survive; junk or blocked storage gives empty lists", async () => {
  const p = load({
    storage: {
      "bpozz:font-favorites": JSON.stringify(["abel", "abel", "Acme", 7, null, "acme", "a".repeat(65)]),
      "bpozz-palette-likes": JSON.stringify(["p001", "p1", "p001", "p0002", "c001"]),
    },
  });
  assert.deepStrictEqual(plain(p.api.legacy()), { fonts: ["abel", "acme"], paletteLikes: ["p001", "p0002"] });
  for (const junk of ["{", '{"abel":true}', '"abel"', "null"]) {
    const q = load({ storage: { "bpozz:font-favorites": junk } });
    assert.deepStrictEqual(plain(q.api.legacy()), { fonts: [], paletteLikes: [] }, junk);
  }
  const blocked = load({ storageThrows: true });
  assert.deepStrictEqual(plain(blocked.api.legacy()), { fonts: [], paletteLikes: [] });
});

test("importLegacy: fonts by default, palette likes only when asked, never roadmap progress, at most 1,000", async () => {
  const bodies = [];
  const api = (method, url, body) => {
    if (url !== "/api/saved/import") return response(200, { items: [] });
    bodies.push(body);
    return response(200, { results: body.items.map((item) => ({ ...item, status: "created" })) });
  };
  const storage = {
    "bpozz:font-favorites": JSON.stringify(["abel", "acme"]),
    "bpozz-palette-likes": JSON.stringify(["p001"]),
    "point-roadmap-progress": JSON.stringify(["type-scale-systems"]),
  };

  await load({ api, storage }).api.importLegacy();
  assert.deepStrictEqual(bodies[0], { items: [{ kind: "font", id: "abel" }, { kind: "font", id: "acme" }] });

  await load({ api, storage }).api.importLegacy({ palettes: true });
  assert.deepStrictEqual(bodies[1], {
    items: [{ kind: "font", id: "abel" }, { kind: "font", id: "acme" }, { kind: "palette", id: "p001" }],
  });

  const none = await load({ api, storage }).api.importLegacy({
    fonts: false,
    palettes: true,
    known: { palette: (id) => id !== "p001" }, // no longer in the catalogue
  });
  assert.strictEqual(none.ok, true);
  assert.strictEqual(bodies.length, 2, "nothing to send, so no request");

  const many = Array.from({ length: 1200 }, (_, i) => `font-${i}`);
  await load({ api, storage: { "bpozz:font-favorites": JSON.stringify(many) } }).api.importLegacy();
  assert.strictEqual(bodies[2].items.length, 1000);

  assert.ok(bodies.every((b) => b.items.every((item) => item.kind === "font" || item.kind === "palette")));
  assert.ok(!JSON.stringify(bodies).includes("type-scale-systems"));
});

test("importLegacy: only fonts answered created or exists leave the old list, re-read first; likes untouched", async () => {
  const likes = JSON.stringify(["p001", "p002"]);
  let p;
  const api = (method, url, body) => {
    if (url !== "/api/saved/import") return response(200, { items: [] });
    // Another tab saves a favorite while the import is out.
    p.local.setItem("bpozz:font-favorites", JSON.stringify(["abel", "acme", "alice", "anton", "arvo"]));
    const status = { abel: "created", acme: "exists", alice: "limit", anton: "invalid", p001: "created", p002: "limit" };
    return response(200, { results: body.items.map((item) => ({ ...item, status: status[item.id] })) });
  };
  p = load({
    api,
    controls: [["palette", "p001"]],
    storage: { "bpozz:font-favorites": JSON.stringify(["abel", "acme", "alice", "anton"]), "bpozz-palette-likes": likes },
  });
  await settle();
  const result = await p.api.importLegacy({ palettes: true });
  assert.deepStrictEqual(
    [result.ok, result.created, result.existing, result.invalid, result.limited, result.storageUpdated],
    [true, 2, 1, 1, 2, true],
  );
  assert.strictEqual(p.local.dump()["bpozz:font-favorites"], JSON.stringify(["alice", "anton", "arvo"]));
  assert.strictEqual(p.local.dump()["bpozz-palette-likes"], likes);
  assert.strictEqual(p.local.dump()["bpozz:saved-import"], '{"v":1,"dismissed":true}');
  assert.strictEqual(pressed(p.nodes[0]), "true", "what was imported shows as saved");

  const all = load({
    api: (method, url, body) =>
      url === "/api/saved/import"
        ? response(200, { results: body.items.map((item) => ({ ...item, status: "created" })) })
        : response(200, { items: [] }),
    storage: { "bpozz:font-favorites": JSON.stringify(["abel"]) },
  });
  await all.api.importLegacy();
  assert.ok(!("bpozz:font-favorites" in all.local.dump()), "an emptied list is deleted");
});

test("importLegacy: any failure leaves browser storage exactly as it was", async () => {
  const storage = {
    "bpozz:font-favorites": JSON.stringify(["abel"]),
    "bpozz-palette-likes": JSON.stringify(["p001"]),
  };
  const cases = [
    [() => ({ ok: false, status: 429, headers: { get: () => "text/plain" }, json: () => Promise.reject(new Error("no")) }), "rate-limited", "Too many attempts. Try again in a minute."],
    [() => response(503, { error: "saved_unavailable" }), "unavailable", "Saving isn’t available right now. Please try again later."],
    [() => Promise.reject(new TypeError("Failed to fetch")), "unavailable", "Saving isn’t available right now. Please try again later."],
    [() => response(400, { error: "invalid_request" }), "failed", "Couldn’t save that. Please try again."],
    [() => response(200, { results: "not a list" }), "failed", "Couldn’t save that. Please try again."],
  ];
  for (const [answer, reason, message] of cases) {
    const p = load({ storage, api: (method, url) => (url === "/api/saved/import" ? answer() : response(200, { items: [] })) });
    const before = JSON.stringify(p.local.dump());
    const result = await p.api.importLegacy({ palettes: true });
    assert.deepStrictEqual([result.ok, result.reason, result.message], [false, reason, message]);
    assert.strictEqual(JSON.stringify(p.local.dump()), before);
    assert.deepStrictEqual(p.toasts, [], "the page that asked says it, in its own place");
  }
});

test("importLegacy: a 401 is refreshed once and sent once more", async () => {
  let expired = true;
  const p = load({
    refresh: [() => ((expired = false), SIGNED_IN)],
    storage: { "bpozz:font-favorites": JSON.stringify(["abel"]) },
    api: (method, url, body) => {
      if (url !== "/api/saved/import") return response(200, { items: [] });
      if (expired) return response(401, { error: "unauthenticated" });
      return response(200, { results: body.items.map((item) => ({ ...item, status: "created" })) });
    },
  });
  const result = await p.api.importLegacy();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(p.refreshes.length, 1);
  assert.strictEqual(p.calls.filter((c) => c.url === "/api/saved/import").length, 2);
});

test("importLegacy: a second call while one is running shares it", async () => {
  const gate = deferred();
  const p = load({
    storage: { "bpozz:font-favorites": JSON.stringify(["abel"]) },
    api: (method, url, body) =>
      url === "/api/saved/import"
        ? gate.promise.then(() => response(200, { results: body.items.map((item) => ({ ...item, status: "created" })) }))
        : response(200, { items: [] }),
  });
  const first = p.api.importLegacy();
  const second = p.api.importLegacy();
  assert.strictEqual(first, second);
  gate.resolve();
  await first;
  assert.strictEqual(p.calls.filter((c) => c.url === "/api/saved/import").length, 1);
});

test("the import marker is exactly {v:1, dismissed:true} — no ids, nothing about the account", async () => {
  const p = load();
  assert.strictEqual(p.api.importDismissed(), false);
  assert.strictEqual(p.api.dismissImport(), true);
  assert.strictEqual(p.api.importDismissed(), true);
  assert.strictEqual(p.local.dump()["bpozz:saved-import"], '{"v":1,"dismissed":true}');

  const blocked = load({ storageThrows: true });
  assert.strictEqual(blocked.api.dismissImport(), false);
  assert.strictEqual(blocked.api.importDismissed(), false);
});
