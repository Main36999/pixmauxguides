/**
 * palettes.test.js — Save on /palettes, src/client/palettes.js (Saved
 * Phase 2, M4).
 *
 * Runs the real saved.js and the real palettes.js, in that order (as
 * /palettes loads /app.js, then /palettes/palettes.js), in a vm against
 * src/client/test-dom.js, with a stand-in /api/saved and a stand-in
 * palettes-data.json. The page is a small copy of palettes/index.html: the
 * grid root, its empty state and the toast.
 *
 * saved.js ships with LAUNCHED = false. The first tests run it as shipped:
 * no Save button, and the heart likes exactly as before. The rest switch
 * that one line on in memory, the way launch will.
 *
 * The Like — bpozz-palette-likes in this browser, and the Firebase counter
 * behind window.__bpozzLikeDelta — is separate from Save throughout: tests
 * that use one check the other didn't move.
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

const ROOT = path.join(__dirname, "..", "..");
const SAVED = fs.readFileSync(path.join(__dirname, "saved.js"), "utf8");
const PALETTES_JS = fs.readFileSync(path.join(__dirname, "palettes.js"), "utf8");
const LAUNCH_LINE = "var LAUNCHED = false;";

const SIGNED_IN = { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000000", email: "dee@example.test" } };
const SIGNED_OUT = { authenticated: false, user: null };
const LIKES_KEY = "bpozz-palette-likes";
const DATA_URL = "/palettes/palettes-data.json";

// The first three records of palettes/palettes-data.json, newest first.
const PALETTES = [
  { id: "p001", colors: ["#1E193B", "#322A57", "#5438E6", "#3876C8"], names: ["Nightshade", "Twilight", "Ultraviolet", "Azure"], createdAt: "2026-09-05" },
  { id: "p002", colors: ["#EDEEE5", "#D9DCC6", "#7B8539", "#4D9140"], names: ["Eggshell", "Oat", "Avocado", "Kelly Green"], createdAt: "2026-09-03" },
  { id: "p003", colors: ["#272312", "#3E391A", "#BAA225", "#30AA6B"], names: ["Espresso", "Peat", "Gold", "Emerald"], createdAt: "2026-08-14" },
];
const IDS = PALETTES.map((p) => p.id);
const NAME = {
  p001: "Nightshade, Twilight, Ultraviolet, Azure",
  p002: "Eggshell, Oat, Avocado, Kelly Green",
  p003: "Espresso, Peat, Gold, Emerald",
};

/** A stand-in for /api/saved, answering like the real one. */
function fakeServer({ saved = [] } = {}) {
  const rows = saved.map(([kind, id]) => ({ kind, id }));
  const handler = (method, url, body) => {
    const u = new URL(url, "https://bpozz.com");
    if (u.pathname !== "/api/saved") return response(404, { error: "not_found" });
    if (method === "GET") {
      const kind = u.searchParams.get("kind");
      const items = rows.filter((r) => !kind || r.kind === kind).map((r) => ({ ...r, saved_at: "2026-09-29T12:00:00+00:00" }));
      return response(200, { items, count: items.length, limits: { total: 1000, image_palette: 200 } });
    }
    if (method === "POST") {
      const exists = rows.some((r) => r.kind === body.kind && r.id === body.id);
      if (!exists) rows.unshift({ kind: body.kind, id: body.id });
      return response(exists ? 200 : 201, { saved: true, created: !exists });
    }
    if (method === "DELETE") {
      const at = rows.findIndex((r) => r.kind === u.searchParams.get("kind") && r.id === u.searchParams.get("id"));
      if (at >= 0) rows.splice(at, 1);
      return response(200, { saved: false, removed: at >= 0 });
    }
    return response(405, { error: "method_not_allowed" });
  };
  return { handler, rows };
}

// ---------------------------------------------------------------------
// local stand-ins for what palettes.js uses and test-dom.js (shared, left
// as it is) doesn't have
// ---------------------------------------------------------------------

// element.classList and element.scrollIntoView, on this document's
// elements only. Scrolled elements are pushed to `scrolled`.
function addLayout(doc, scrolled) {
  const proto = Object.getPrototypeOf(doc.body);
  Object.defineProperty(proto, "classList", {
    configurable: true,
    get() {
      const node = this;
      const names = () => node.className.split(/\s+/).filter(Boolean);
      return {
        add: (...add) => (node.className = [...new Set([...names(), ...add])].join(" ")),
        remove: (...drop) => (node.className = names().filter((n) => !drop.includes(n)).join(" ")),
        contains: (name) => names().includes(name),
      };
    },
  });
  Object.defineProperty(proto, "scrollIntoView", {
    configurable: true,
    value() {
      scrolled.push(this);
    },
  });
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);

// Each parsed element's attribute names, in the order the markup gave them.
const parsedAttrs = new WeakMap();

/**
 * palettes.js draws the whole grid with one innerHTML, which test-dom.js
 * refuses on purpose. This setter, on the grid root alone, builds the same
 * tree from that markup: tags, double-quoted attributes, "/>", text and the
 * five entities escapeHtml writes — everything cardHtml produces — and
 * throws on anything else, or on an attribute given twice. Every other
 * element, saved.js's included, keeps test-dom.js's throwing setter.
 * `seen` keeps every string the grid was given.
 */
function allowGridMarkup(doc, root, seen) {
  const TOKEN = /<\/([a-z]+)>|<([a-z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>|([^<]+)/y;
  Object.defineProperty(root, "innerHTML", {
    configurable: true,
    set(html) {
      seen.push(html);
      root.children.slice().forEach((child) => root.removeChild(child));
      const stack = [root];
      let at = 0;
      while (at < html.length) {
        TOKEN.lastIndex = at;
        const m = TOKEN.exec(html);
        if (!m) throw new Error(`unexpected markup: ${html.slice(at, at + 60)}`);
        at = TOKEN.lastIndex;
        const parent = stack[stack.length - 1];
        if (m[1]) {
          if (stack.length < 2 || parent.tagName !== m[1].toUpperCase()) throw new Error(`unbalanced </${m[1]}>`);
          stack.pop();
        } else if (m[2]) {
          const node = doc.createElement(m[2]);
          const names = [];
          for (const [, name, value] of m[3].matchAll(/\s+([a-zA-Z-]+)="([^"]*)"/g)) {
            if (node.hasAttribute(name)) throw new Error(`attribute ${name} given twice`);
            node.setAttribute(name, decode(value));
            names.push(name);
          }
          parsedAttrs.set(node, names);
          parent.appendChild(node);
          if (!m[4]) stack.push(node);
        } else {
          parent.appendChild(doc.createTextNode(decode(m[5])));
        }
      }
      if (stack.length !== 1) throw new Error("unclosed element");
    },
  });
}

function el(doc, parent, tag, attrs = {}) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return parent.appendChild(node);
}

/**
 * Loads saved.js (unless withSaved is false), then palettes.js, into a
 * fresh /palettes.
 *
 *   launched   false runs saved.js as shipped; true switches LAUNCHED on
 *   session    what BpozzAuth.getSession() resolves to (or a promise of it)
 *   server     a fakeServer(); api overrides it
 *   palettes   what palettes-data.json holds; data overrides its answer
 *   storage    localStorage's contents
 *   hash       location.hash, e.g. "#p002"
 *   channel    a BroadcastChannel class, or none
 */
function load({
  launched = true,
  withSaved = true,
  session = SIGNED_IN,
  server = fakeServer(),
  api = null,
  palettes = PALETTES,
  data = null,
  storage = {},
  hash = "",
  channel = null,
} = {}) {
  const doc = makeDocument();
  const scrolled = [];
  addLayout(doc, scrolled);
  const grid = el(doc, doc.body, "div", { class: "palettes-grid", id: "palettes-grid-root" });
  const empty = el(doc, doc.body, "div", { class: "empty-state", id: "palettes-empty-state" });
  el(doc, doc.body, "div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" });
  const seen = [];
  allowGridMarkup(doc, grid, seen);

  const calls = [];
  const log = [];
  const toasts = [];
  const opened = [];
  const likeDeltas = [];
  const copied = [];
  const errors = [];
  const likeCounter = (id, delta) => likeDeltas.push([id, delta]);
  const windowListeners = {};
  const local = makeStorage("localStorage", log, { initial: storage });

  const ctx = {
    console: { log: () => {}, warn: () => {}, error: (...args) => errors.push(args) },
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: doc,
    location: { hash, search: "", pathname: "/palettes/" },
    navigator: {
      clipboard: {
        writeText: (text) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    },
    fetch: (url, init = {}) => {
      const method = init.method || "GET";
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ url, method, body });
      if (url === DATA_URL) return Promise.resolve().then(() => (data ? data() : response(200, palettes)));
      return Promise.resolve().then(() => (api || server.handler)(method, url, body));
    },
    addEventListener: (type, fn) => (windowListeners[type] ||= []).push(fn),
    bpozzShowToast: (text) => toasts.push(text),
    // Firebase never loads here: palettes.js loads it with import(), and
    // Node rejects import() in a vm script run without an
    // importModuleDynamically callback, so nothing is fetched and
    // wireFirebase's own fallback runs. This stand-in is therefore what
    // the heart's counter updates reach.
    __bpozzLikeDelta: likeCounter,
    BpozzAuth: {
      getSession: () => Promise.resolve(session),
      refreshSession: () => Promise.resolve(session),
      open: (mode, trigger) => opened.push([mode, trigger]),
    },
  };
  Object.defineProperty(ctx, "localStorage", { get: () => (log.push(["localStorage", "access"]), local) });
  if (channel) ctx.BroadcastChannel = channel;
  ctx.window = ctx;

  if (withSaved) vm.runInNewContext(launched ? SAVED.replace(LAUNCH_LINE, "var LAUNCHED = true;") : SAVED, ctx);
  vm.runInNewContext(PALETTES_JS, ctx);

  const apiCalls = () => calls.filter((c) => c.url !== DATA_URL);
  return {
    doc,
    ctx,
    grid,
    empty,
    server,
    calls,
    log,
    toasts,
    opened,
    likeDeltas,
    likeCounter,
    copied,
    errors,
    scrolled,
    local,
    markup: () => seen.join(""),
    apiCalls,
    writes: () => apiCalls().filter((c) => c.method !== "GET"),
    lists: () => apiCalls().filter((c) => c.method === "GET"),
    dataFetches: () => calls.filter((c) => c.url === DATA_URL).length,
    cards: () => grid.children.map((card) => card.getAttribute("data-id")),
    card: (id) => doc.querySelector(`.palette-card[data-id="${id}"]`),
    like: (id) => doc.querySelector(`.palette-like-btn[data-id="${id}"]`),
    save: (id) => doc.querySelector(`.palette-save-btn[data-save-id="${id}"]`),
    saves: () => doc.querySelectorAll(".palette-save-btn"),
    savePressed: () => Object.fromEntries(IDS.map((id) => [id, doc.querySelector(`.palette-save-btn[data-save-id="${id}"]`).getAttribute("aria-pressed")])),
    likePressed: () => Object.fromEntries(IDS.map((id) => [id, doc.querySelector(`.palette-like-btn[data-id="${id}"]`).getAttribute("aria-pressed")])),
    writesToStorage: () => log.filter(([, op]) => op === "set" || op === "remove"),
    savedStatus: () => {
      const region = doc.querySelector("[data-saved-status]");
      return region ? region.textContent : null;
    },
    copyStatus: () => {
      const region = doc.getElementById("palettes-copy-status");
      return region ? region.textContent : null;
    },
    fireWindow: (type, extra = {}) => (windowListeners[type] || []).forEach((fn) => fn({ type, ...extra })),
  };
}

const ALL_OFF = { p001: "false", p002: "false", p003: "false" };

// ---------------------------------------------------------------------
// dormant: exactly as before
// ---------------------------------------------------------------------

test("dormant (Saved as shipped): no Save button; the heart likes exactly as before — this browser, the counter, no account request", async () => {
  for (const withSaved of [true, false]) {
    const p = load({ launched: false, withSaved, storage: { [LIKES_KEY]: JSON.stringify(["p002"]) } });
    await settle(10);
    // Firebase's designed fallback, unchanged: the import is refused (see
    // load), wireFirebase logs its local-preview message once with that
    // error, and window.__bpozzLikeDelta is never replaced.
    assert.strictEqual(p.errors.length, 1, "one console error: the Firebase fallback");
    const [message, err] = p.errors[0];
    assert.strictEqual(message, "Firebase failed to load — likes are running in local preview mode instead.");
    assert.strictEqual(err && err.code, "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING", "the vm's refused import(), not a network failure");
    assert.strictEqual(p.ctx.__bpozzLikeDelta, p.likeCounter, "no Firebase transaction wired in its place");
    assert.deepStrictEqual(p.cards(), IDS);
    assert.ok(!p.markup().includes("data-save"), "no Saved attributes drawn");
    assert.ok(!p.markup().includes("palette-save"), "no Save button drawn");
    assert.deepStrictEqual(p.doc.querySelectorAll("[data-save-kind]"), []);
    for (const id of IDS) {
      const foot = p.card(id).querySelector(".palette-card__foot");
      assert.deepStrictEqual(
        foot.children.map((c) => c.className),
        ["palette-like-btn", "palette-card__names"],
        "the card foot is the heart and the names, as before",
      );
    }
    assert.deepStrictEqual(p.likePressed(), { p001: "false", p002: "true", p003: "false" });

    const heart = p.like("p001");
    assert.strictEqual(heart.getAttribute("aria-label"), "Like this palette");
    assert.strictEqual(heart.getAttribute("data-action"), "like");
    fire(p.doc, heart, "click");
    assert.strictEqual(heart.getAttribute("aria-pressed"), "true");
    assert.deepStrictEqual(JSON.parse(p.local.dump()[LIKES_KEY]).sort(), ["p001", "p002"]);
    assert.deepStrictEqual(p.likeDeltas, [["p001", 1]]);
    fire(p.doc, heart, "click");
    assert.strictEqual(heart.getAttribute("aria-pressed"), "false");
    assert.deepStrictEqual(p.local.dump(), { [LIKES_KEY]: JSON.stringify(["p002"]) });
    assert.deepStrictEqual(p.likeDeltas, [["p001", 1], ["p001", -1]]);

    await settle(10);
    assert.deepStrictEqual(p.apiCalls(), [], "no account request");
    assert.deepStrictEqual(p.opened, []);
    assert.deepStrictEqual(p.toasts, []);
    assert.strictEqual(p.errors.length, 1, "nothing else logged");
  }
});

test("every palette on the site has an id account Saved accepts", () => {
  const palettes = JSON.parse(fs.readFileSync(path.join(ROOT, "palettes", "palettes-data.json"), "utf8"));
  const p = load({ launched: false });
  assert.ok(palettes.length > 0);
  assert.deepStrictEqual(
    palettes.map((x) => x.id).filter((id) => !p.ctx.BpozzSaved.isValidItem("palette", id)),
    [],
  );
});

// ---------------------------------------------------------------------
// launched: account Saved
// ---------------------------------------------------------------------

test("launched: each card gets one Save button beside the heart — kind, id, name, label — and one list request paints them", async () => {
  const p = load({ server: fakeServer({ saved: [["palette", "p002"]] }), storage: { [LIKES_KEY]: JSON.stringify(["p001"]) } });
  await settle(10);
  assert.deepStrictEqual(
    p.saves().map((b) => [
      b.tagName,
      b.getAttribute("type"),
      b.getAttribute("data-save-kind"),
      b.getAttribute("data-save-id"),
      b.getAttribute("data-save-name"),
      b.getAttribute("aria-label"),
    ]),
    IDS.map((id) => ["BUTTON", "button", "palette", id, NAME[id], "Save this palette"]),
  );
  for (const id of IDS) {
    const foot = p.card(id).querySelector(".palette-card__foot");
    assert.deepStrictEqual(
      foot.children.map((c) => c.className),
      ["palette-like-btn", "palette-save-btn", "palette-card__names"],
      "Save sits right after the heart",
    );
    const save = p.save(id);
    assert.ok(!save.hasAttribute("data-action"), "not the Like's data-action");
    assert.ok(!save.hasAttribute("data-id"), "not the Like's data-id");
  }
  assert.deepStrictEqual(p.lists().map((c) => c.url), ["/api/saved?kind=palette"]);
  assert.deepStrictEqual(p.writes(), []);
  assert.deepStrictEqual(p.savePressed(), { p001: "false", p002: "true", p003: "false" }, "the account's");
  assert.deepStrictEqual(p.likePressed(), { p001: "true", p002: "false", p003: "false" }, "this browser's, as before");
  assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), "on");
});

test("launched: palettes drawn before the session is known, or after it — either way one list request, and the right buttons", async () => {
  // Drawn first: the session answer is held.
  const sessionAnswer = deferred();
  const early = load({ server: fakeServer({ saved: [["palette", "p003"]] }), session: sessionAnswer.promise });
  await settle(10);
  assert.strictEqual(early.saves().length, 3, "drawn");
  assert.deepStrictEqual(early.apiCalls(), [], "nothing asked while the session is unknown");
  assert.deepStrictEqual(early.savePressed(), ALL_OFF);
  sessionAnswer.resolve(SIGNED_IN);
  await settle(10);
  assert.deepStrictEqual(early.lists().map((c) => c.url), ["/api/saved?kind=palette"]);
  assert.deepStrictEqual(early.savePressed(), { p001: "false", p002: "false", p003: "true" });

  // Session first: palettes-data.json is held.
  const dataAnswer = deferred();
  const late = load({
    server: fakeServer({ saved: [["palette", "p001"]] }),
    data: () => dataAnswer.promise.then(() => response(200, PALETTES)),
  });
  await settle(10);
  assert.deepStrictEqual(late.saves(), []);
  assert.deepStrictEqual(late.apiCalls(), [], "no Save control yet, so no list to load");
  dataAnswer.resolve();
  await settle(10);
  assert.deepStrictEqual(late.lists().map((c) => c.url), ["/api/saved?kind=palette"]);
  assert.deepStrictEqual(late.savePressed(), { p001: "true", p002: "false", p003: "false" });

  // A later session event with the same answer loads nothing again.
  dispatch(late.doc, "bpozz:session", { authenticated: true });
  await settle(10);
  assert.strictEqual(late.lists().length, 1);
  assert.strictEqual(late.dataFetches(), 1);
});

test("launched: until the list arrives every Save shows unsaved and not busy; a change shows at once, busy until its answer", async () => {
  const server = fakeServer({ saved: [["palette", "p001"]] });
  const listGate = deferred();
  const saveGate = deferred();
  const p = load({
    api: (method, url, body) =>
      (method === "GET" ? listGate.promise : method === "POST" ? saveGate.promise : Promise.resolve()).then(() =>
        server.handler(method, url, body),
      ),
  });
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), ALL_OFF);
  assert.deepStrictEqual(p.saves().filter((b) => b.hasAttribute("aria-busy")), []);
  listGate.resolve();
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), { p001: "true", p002: "false", p003: "false" });

  const save = p.save("p002");
  fire(p.doc, save, "click");
  await settle(2);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true", "shown at once");
  assert.strictEqual(save.getAttribute("aria-busy"), "true");
  saveGate.resolve();
  await settle(10);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.strictEqual(save.hasAttribute("aria-busy"), false);
  assert.strictEqual(p.lists().length, 1);
});

test("launched: a Save click is handled once, by saved.js — one request, the heart and this browser's likes untouched, announced by saved.js", async () => {
  const p = load({ storage: { [LIKES_KEY]: JSON.stringify(["p002"]) } });
  await settle(10);
  const save = p.save("p001");
  // On the icon, as a pointer usually lands.
  fire(p.doc, save.querySelector("path"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url, c.body]), [["POST", "/api/saved", { kind: "palette", id: "p001" }]]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.deepStrictEqual(p.server.rows, [{ kind: "palette", id: "p001" }]);
  assert.deepStrictEqual(p.likePressed(), { p001: "false", p002: "true", p003: "false" });
  assert.deepStrictEqual(p.likeDeltas, []);
  assert.deepStrictEqual(p.local.dump(), { [LIKES_KEY]: JSON.stringify(["p002"]) });
  assert.deepStrictEqual(p.writesToStorage(), []);
  await wait(80);
  assert.strictEqual(p.savedStatus(), `${NAME.p001} saved to your account`);
  assert.strictEqual(p.copyStatus(), null, "the page's copy announcement isn't used");
});

test("launched: a second click removes it — one DELETE, announced by saved.js; the heart untouched", async () => {
  const p = load({ server: fakeServer({ saved: [["palette", "p003"]] }), storage: { [LIKES_KEY]: JSON.stringify(["p003"]) } });
  await settle(10);
  const save = p.save("p003");
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url]), [["DELETE", "/api/saved?kind=palette&id=p003"]]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.deepStrictEqual(p.server.rows, []);
  await wait(80);
  assert.strictEqual(p.savedStatus(), `${NAME.p003} removed from your Saved`);
  assert.strictEqual(p.like("p003").getAttribute("aria-pressed"), "true");
  assert.deepStrictEqual(p.likeDeltas, []);
  assert.deepStrictEqual(p.writesToStorage(), []);
});

test("launched: rapid clicks on one Save never put two requests for it in flight; it ends as the last click asked", async () => {
  const server = fakeServer();
  const first = deferred(); // holds the first change until released
  let sent = 0;
  let running = 0;
  let most = 0;
  const p = load({
    api: (method, url, body) => {
      if (method === "GET") return server.handler(method, url, body);
      running += 1;
      most = Math.max(most, running);
      return (sent++ === 0 ? first.promise : Promise.resolve()).then(() => {
        running -= 1;
        return server.handler(method, url, body);
      });
    },
  });
  await settle(10);
  const save = p.save("p002");
  fire(p.doc, save, "click");
  fire(p.doc, save, "click");
  fire(p.doc, save, "click");
  await settle(2);
  assert.strictEqual(save.getAttribute("aria-busy"), "true");
  assert.strictEqual(p.writes().length, 1, "three quick clicks, one request");
  fire(p.doc, save, "click"); // the opposite, while that request runs
  await settle(2);
  assert.strictEqual(p.writes().length, 1, "nothing more while it runs");
  first.resolve();
  await settle(10);
  assert.strictEqual(most, 1, "never two at once");
  assert.deepStrictEqual(p.writes().map((c) => c.method), ["POST", "DELETE"]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.strictEqual(save.hasAttribute("aria-busy"), false);
  assert.deepStrictEqual(server.rows, []);
  assert.deepStrictEqual(p.likeDeltas, []);
});

test("launched and signed out: Save opens the sign-in dialog — no request, no like, nothing in this browser; the heart still likes", async () => {
  const p = load({ session: SIGNED_OUT, storage: { [LIKES_KEY]: JSON.stringify(["p001"]) } });
  await settle(10);
  const save = p.save("p002");
  assert.ok(save, "drawn for signed-out visitors too");
  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.opened.map(([mode, trigger]) => [mode, trigger === save]), [["signin", true]]);
  assert.deepStrictEqual(p.apiCalls(), []);
  assert.deepStrictEqual(p.likeDeltas, []);
  assert.deepStrictEqual(p.writesToStorage(), []);
  assert.deepStrictEqual(p.local.dump(), { [LIKES_KEY]: JSON.stringify(["p001"]) });
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.deepStrictEqual(p.likePressed(), { p001: "true", p002: "false", p003: "false" });

  fire(p.doc, p.like("p002"), "click");
  await settle(10);
  assert.deepStrictEqual(p.likeDeltas, [["p002", 1]]);
  assert.deepStrictEqual(JSON.parse(p.local.dump()[LIKES_KEY]).sort(), ["p001", "p002"]);
  assert.strictEqual(p.opened.length, 1, "the heart never asks to sign in");
  assert.deepStrictEqual(p.apiCalls(), []);
});

test("launched: a Save the server refuses is undone and said once in the site toast; the heart is untouched", async () => {
  const server = fakeServer();
  const gate = deferred();
  const p = load({
    api: (method, url, body) =>
      method === "POST" ? gate.promise.then(() => response(503, { error: "saved_unavailable" })) : server.handler(method, url, body),
  });
  await settle(10);
  const save = p.save("p001");
  fire(p.doc, save, "click");
  await settle(2);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true", "shown at once");
  gate.resolve();
  await settle(10);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false", "undone");
  assert.strictEqual(save.hasAttribute("aria-busy"), false);
  assert.deepStrictEqual(p.toasts, ["Saving isn’t available right now. Please try again later."]);
  assert.deepStrictEqual(server.rows, []);
  assert.deepStrictEqual(p.likePressed(), ALL_OFF);
  assert.deepStrictEqual(p.likeDeltas, []);
  await wait(80);
  assert.strictEqual(p.savedStatus(), null, "a failure isn't announced as a save");
});

test("launched: a list that fails to load leaves every Save unsaved and is said once; the heart still likes", async () => {
  const p = load({ api: () => response(503, { error: "saved_unavailable" }) });
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), ALL_OFF);
  assert.deepStrictEqual(p.toasts, ["Couldn’t load your Saved items right now."]);
  fire(p.doc, p.like("p003"), "click");
  assert.deepStrictEqual(p.likeDeltas, [["p003", 1]]);
  assert.strictEqual(p.like("p003").getAttribute("aria-pressed"), "true");
});

test("launched: another tab's change — a removal on /account, a save elsewhere — repaints the Save at once, with no request", async () => {
  const channels = [];
  class Channel {
    constructor() {
      this.onmessage = null;
      channels.push(this);
    }
    postMessage() {}
    close() {}
  }
  const p = load({ server: fakeServer({ saved: [["palette", "p001"]] }), channel: Channel });
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), { p001: "true", p002: "false", p003: "false" });
  channels[0].onmessage({ data: { type: "item", kind: "palette", id: "p001", saved: false } });
  channels[0].onmessage({ data: { type: "item", kind: "palette", id: "p003", saved: true } });
  assert.deepStrictEqual(p.savePressed(), { p001: "false", p002: "false", p003: "true" });
  assert.strictEqual(p.lists().length, 1);
  assert.deepStrictEqual(p.writes(), []);
  assert.deepStrictEqual(p.likePressed(), ALL_OFF);
});

test("launched: back from the back/forward cache, the page reads its list again — the same buttons show what changed meanwhile", async () => {
  const server = fakeServer({ saved: [["palette", "p001"]] });
  const p = load({ server });
  await settle(10);
  const before = p.saves();
  assert.deepStrictEqual(p.savePressed(), { p001: "true", p002: "false", p003: "false" });
  server.rows.splice(0, server.rows.length, { kind: "palette", id: "p002" }); // changed elsewhere while away
  p.fireWindow("pagehide");
  p.fireWindow("pageshow", { persisted: true });
  await settle(10);
  assert.strictEqual(p.lists().length, 2);
  assert.deepStrictEqual(p.savePressed(), { p001: "false", p002: "true", p003: "false" });
  assert.ok(
    p.saves().every((b, i) => b === before[i]),
    "not redrawn: palettes.js renders once",
  );
  assert.strictEqual(p.dataFetches(), 1);
  assert.deepStrictEqual(p.writes(), []);
});

test("launched: Save is a native toggle named 'Save this palette' — icon hidden, state in aria-pressed, the name never changing; saved.js announces", async () => {
  const p = load();
  await settle(10);
  const save = p.save("p002");
  assert.strictEqual(save.tagName, "BUTTON");
  assert.strictEqual(save.getAttribute("type"), "button");
  assert.strictEqual(save.textContent, "", "no text: the name is aria-label");
  const icon = save.querySelector("svg");
  assert.strictEqual(icon.getAttribute("aria-hidden"), "true");
  assert.strictEqual(icon.getAttribute("focusable"), "false");
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");

  fire(p.doc, save, "click");
  await settle(10);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.strictEqual(save.getAttribute("aria-label"), "Save this palette", "a toggle keeps its name");
  await wait(80);
  const region = p.doc.querySelector("[data-saved-status]");
  assert.strictEqual(region.getAttribute("role"), "status");
  assert.strictEqual(region.getAttribute("aria-live"), "polite");
  assert.strictEqual(region.textContent, `${NAME.p002} saved to your account`);
  assert.strictEqual(p.copyStatus(), null);
  assert.strictEqual(p.like("p002").getAttribute("aria-label"), "Like this palette");
});

test("launched: Like and Save on one card are independent — one Like action, one Save action, neither moves the other", async () => {
  const p = load();
  await settle(10);
  const heart = p.like("p001");
  const save = p.save("p001");

  fire(p.doc, heart, "click");
  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.likeDeltas, [["p001", 1]]);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.body]), [["POST", { kind: "palette", id: "p001" }]]);
  assert.strictEqual(heart.getAttribute("aria-pressed"), "true");
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.deepStrictEqual(p.local.dump(), { [LIKES_KEY]: JSON.stringify(["p001"]) });

  fire(p.doc, heart, "click"); // unlike: the save stays
  await settle(10);
  assert.deepStrictEqual(p.likeDeltas, [["p001", 1], ["p001", -1]]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.strictEqual(p.writes().length, 1);

  fire(p.doc, heart, "click");
  fire(p.doc, save, "click"); // unsave: the like stays
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.method), ["POST", "DELETE"]);
  assert.strictEqual(heart.getAttribute("aria-pressed"), "true");
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.deepStrictEqual(p.local.dump(), { [LIKES_KEY]: JSON.stringify(["p001"]) });
  assert.deepStrictEqual(p.likeDeltas, [["p001", 1], ["p001", -1], ["p001", 1]]);
});

test("launched: odd palette data — an id Saved wouldn't accept gets no Save but still renders; names reach data-save-name escaped, as one attribute", async () => {
  const odd = [
    { id: "p001", colors: PALETTES[0].colors, names: ['Say "hi"', "<b>Bold</b>", "Salt & Pepper", "It's"], createdAt: "2026-09-05" },
    { id: "p1", colors: PALETTES[1].colors, names: PALETTES[1].names, createdAt: "2026-09-04" },
    { id: "p002", colors: PALETTES[1].colors, names: ["Only"], createdAt: "2026-09-03" },
    { id: "p003", colors: PALETTES[2].colors, createdAt: "2026-08-14" },
  ];
  const p = load({ palettes: odd });
  await settle(10);
  assert.deepStrictEqual(p.cards(), ["p001", "p1", "p002", "p003"], "every palette still renders");
  assert.ok(p.like("p1"), "its heart too");
  assert.strictEqual(p.card("p1").querySelector(".palette-save-btn"), null, "but no Save");
  assert.deepStrictEqual(p.saves().map((b) => b.getAttribute("data-save-id")), ["p001", "p002", "p003"]);

  const tricky = p.save("p001");
  assert.strictEqual(tricky.getAttribute("data-save-name"), `Say "hi", <b>Bold</b>, Salt & Pepper, It's`);
  assert.deepStrictEqual(parsedAttrs.get(tricky), [
    "type",
    "class",
    "data-save-kind",
    "data-save-id",
    "data-save-name",
    "aria-pressed",
    "aria-label",
  ]);
  assert.deepStrictEqual(tricky.children.map((c) => c.tagName), ["SVG"], "no markup from the names");
  assert.ok(
    p.markup().includes('data-save-name="Say &quot;hi&quot;, &lt;b&gt;Bold&lt;/b&gt;, Salt &amp; Pepper, It&#39;s"'),
  );
  assert.strictEqual(p.save("p002").getAttribute("data-save-name"), "Only", "missing names are left out");
  assert.strictEqual(p.save("p003").hasAttribute("data-save-name"), false, "no names, no name");

  fire(p.doc, p.save("p003"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.body), [{ kind: "palette", id: "p003" }]);
  await wait(80);
  assert.strictEqual(p.savedStatus(), "Saved to your account");
});

test("/palettes#<id> still scrolls to and highlights that card, dormant or launched, with Save beside its heart", async () => {
  for (const launched of [false, true]) {
    const p = load({ launched, hash: "#p002" });
    await settle(10);
    assert.deepStrictEqual(p.scrolled.map((n) => n.getAttribute("data-id")), ["p002"]);
    assert.ok(p.card("p002").classList.contains("palette-card--highlight"));
    assert.strictEqual(!!p.save("p002"), launched);
  }
  const p = load({ hash: "#p999" });
  await settle(10);
  assert.deepStrictEqual(p.scrolled, [], "an unknown id scrolls nowhere");
  assert.strictEqual(p.saves().length, 3);
});

test("a swatch click still copies its hex, with the in-swatch confirmation and announcement — and saves nothing, dormant or launched", async () => {
  for (const launched of [false, true]) {
    const p = load({ launched });
    await settle(10);
    const swatch = p.card("p001").querySelector(".palette-swatch");
    fire(p.doc, swatch, "click");
    await settle(10);
    assert.deepStrictEqual(p.copied, ["#1E193B"]);
    assert.strictEqual(swatch.getAttribute("data-copied"), "true");
    await wait(80);
    assert.strictEqual(p.copyStatus(), "Copied #1E193B");
    assert.deepStrictEqual(p.writes(), []);
    assert.deepStrictEqual(p.likeDeltas, []);
    assert.strictEqual(p.savedStatus(), null);
    if (launched) assert.strictEqual(p.save("p001").getAttribute("aria-pressed"), "false");
  }
});

test("launched: when palettes-data.json doesn't load, the error shows as before and Saved asks for nothing", async () => {
  const p = load({ data: () => response(500, { error: "boom" }) });
  await settle(10);
  assert.strictEqual(p.empty.getAttribute("data-visible"), "true");
  assert.deepStrictEqual(p.cards(), []);
  assert.deepStrictEqual(p.apiCalls(), []);
});
