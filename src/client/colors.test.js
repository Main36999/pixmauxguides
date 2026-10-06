/**
 * colors.test.js — Save on /colors, src/client/colors.js (Saved Phase 2,
 * M5).
 *
 * Runs the real saved.js and the real colors.js, in that order (as /colors
 * loads /app.js, then /colors/colors.js), in a vm against
 * src/client/test-dom.js, with a stand-in /api/saved and a stand-in
 * colors-data.json. The page is a small copy of colors/index.html: the
 * intro, the filter row, the count line, the grid root, its empty state,
 * the toast and the two live regions.
 *
 * The tests set saved.js's one launch switch themselves, whichever value it
 * ships with. The first run it dormant (LAUNCHED false): no Save button, and
 * every card exactly as before. The rest switch it on in memory, the way
 * launch will.
 *
 * /colors has no Like or favourite: a card's one action is copying its hex
 * from the plate. That copy is what stays separate from Save throughout,
 * and neither writes anything to this browser.
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
const COLORS_JS = fs.readFileSync(path.join(__dirname, "colors.js"), "utf8");
// saved.js's one launch switch, whichever value it ships with.
const GATE = /var LAUNCHED = (?:true|false);/;
const savedWith = (launched) => SAVED.replace(GATE, `var LAUNCHED = ${launched};`);

const SIGNED_IN = { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000000", email: "dee@example.test" } };
const SIGNED_OUT = { authenticated: false, user: null };
const DATA_URL = "/colors/colors-data.json";

// Three records of colors/colors-data.json, in its order: two Reds, a Blue.
const COLORS = [
  { id: "c001", name: "Rosewood", hex: "#9C6D6B", category: "Red" },
  { id: "c005", name: "Oxblood", hex: "#3C1B26", category: "Red" },
  { id: "c151", name: "Nightshade", hex: "#1E193B", category: "Blue" },
];
const IDS = COLORS.map((c) => c.id);
const NAME = { c001: "Rosewood", c005: "Oxblood", c151: "Nightshade" };

// c005's card as colors.js drew it before Saved, byte for byte.
const OXBLOOD_CARD =
  '<article class="color-card" data-id="c005" data-category="Red">' +
  '<button type="button" class="color-card__plate" data-hex="#3C1B26" ' +
  'style="--color-hex:#3C1B26;--color-label:#FFFFFF;--color-veil:rgba(0,0,0,0.45);--color-ring:rgba(0,0,0,0.06)" ' +
  'aria-label="Copy #3C1B26, Oxblood">' +
  '<span class="color-card__hex" aria-hidden="true">3C1B26</span>' +
  '<span class="color-card__copied" aria-hidden="true">' +
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>' +
  "Copied</span></button>" +
  '<p class="color-card__name">Oxblood</p>' +
  "</article>";

/** A stand-in for /api/saved, answering like the real one. */
function fakeServer({ saved = [] } = {}) {
  const rows = saved.map(([kind, id]) => ({ kind, id }));
  const handler = (method, url, body) => {
    const u = new URL(url, "https://bpozz.com");
    if (u.pathname !== "/api/saved") return response(404, { error: "not_found" });
    if (method === "GET") {
      const kind = u.searchParams.get("kind");
      const items = rows.filter((r) => !kind || r.kind === kind).map((r) => ({ ...r, saved_at: "2026-09-30T12:00:00+00:00" }));
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
// a local stand-in for what colors.js uses and test-dom.js (shared, left
// as it is) doesn't have
// ---------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);

// Each parsed element's attribute names, in the order the markup gave them.
const parsedAttrs = new WeakMap();

/**
 * colors.js draws the grid and the filter row with one innerHTML each,
 * which test-dom.js refuses on purpose. This setter, on those two roots
 * alone, builds the same tree from that markup: tags, double-quoted
 * attributes, "/>", text and the five entities escapeHtml writes —
 * everything cardHtml and renderFilters produce — and throws on anything
 * else, or on an attribute given twice. Every other element, saved.js's
 * included, keeps test-dom.js's throwing setter. `seen` keeps every string
 * the root was given.
 */
function allowMarkup(doc, root, seen) {
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
 * Loads saved.js (unless withSaved is false), then colors.js, into a fresh
 * /colors.
 *
 *   launched   false runs saved.js with LAUNCHED false; true with it on
 *   session    what BpozzAuth.getSession() resolves to (or a promise of it)
 *   server     a fakeServer(); api overrides it
 *   colors     what colors-data.json holds; data overrides its answer
 *   channel    a BroadcastChannel class, or none
 *   now        { t } — a clock for saved.js's Date.now()
 */
function load({
  launched = true,
  withSaved = true,
  session = SIGNED_IN,
  server = fakeServer(),
  api = null,
  colors = COLORS,
  data = null,
  channel = null,
  now = null,
} = {}) {
  const doc = makeDocument();
  el(doc, doc.body, "p", { id: "colors-intro" });
  const filters = el(doc, doc.body, "div", { class: "colors-filters", id: "colors-filters" });
  el(doc, doc.body, "p", { class: "colors-count", id: "colors-count" });
  const grid = el(doc, doc.body, "div", { class: "colors-grid", id: "colors-grid-root" });
  const empty = el(doc, doc.body, "div", { class: "empty-state", id: "colors-empty-state" });
  el(doc, doc.body, "div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" });
  el(doc, doc.body, "div", { id: "colors-copy-status", class: "sr-only", role: "status", "aria-live": "polite" });
  el(doc, doc.body, "div", { id: "colors-result-status", class: "sr-only", role: "status", "aria-live": "polite" });
  const seenGrid = [];
  const seenFilters = [];
  allowMarkup(doc, grid, seenGrid);
  allowMarkup(doc, filters, seenFilters);

  const calls = [];
  const log = [];
  const toasts = [];
  const opened = [];
  const copied = [];
  const errors = [];
  const windowListeners = {};
  const local = makeStorage("localStorage", log);

  const ctx = {
    console: { log: () => {}, warn: () => {}, error: (...args) => errors.push(args) },
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: doc,
    location: { hash: "", search: "", pathname: "/colors/" },
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
      if (url === DATA_URL) return Promise.resolve().then(() => (data ? data() : response(200, colors)));
      return Promise.resolve().then(() => (api || server.handler)(method, url, body));
    },
    addEventListener: (type, fn) => (windowListeners[type] ||= []).push(fn),
    bpozzShowToast: (text) => toasts.push(text),
    BpozzAuth: {
      getSession: () => Promise.resolve(session),
      refreshSession: () => Promise.resolve(session),
      open: (mode, trigger) => opened.push([mode, trigger]),
    },
  };
  Object.defineProperty(ctx, "localStorage", { get: () => (log.push(["localStorage", "access"]), local) });
  Object.defineProperty(ctx, "sessionStorage", { get: () => (log.push(["sessionStorage", "access"]), local) });
  if (channel) ctx.BroadcastChannel = channel;
  if (now) ctx.Date = { now: () => now.t };
  ctx.window = ctx;

  if (withSaved) vm.runInNewContext(savedWith(launched), ctx);
  vm.runInNewContext(COLORS_JS, ctx);

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
    copied,
    errors,
    markup: () => seenGrid.join(""),
    renders: () => seenGrid.length,
    apiCalls,
    writes: () => apiCalls().filter((c) => c.method !== "GET"),
    lists: () => apiCalls().filter((c) => c.method === "GET"),
    dataFetches: () => calls.filter((c) => c.url === DATA_URL).length,
    cards: () => grid.children.map((card) => card.getAttribute("data-id")),
    card: (id) => doc.querySelector(`.color-card[data-id="${id}"]`),
    plate: (id) => doc.querySelector(`.color-card[data-id="${id}"] .color-card__plate`),
    save: (id) => doc.querySelector(`.color-save-btn[data-save-id="${id}"]`),
    saves: () => doc.querySelectorAll(".color-save-btn"),
    savePressed: () => Object.fromEntries(IDS.map((id) => [id, doc.querySelector(`.color-save-btn[data-save-id="${id}"]`).getAttribute("aria-pressed")])),
    chip: (category) => doc.querySelector(`.colors-filter[data-category="${category}"]`),
    shown: () => grid.children.filter((card) => !card.hasAttribute("hidden")).map((card) => card.getAttribute("data-id")),
    writesToStorage: () => log.filter(([, op]) => op === "set" || op === "remove"),
    savedStatus: () => {
      const region = doc.querySelector("[data-saved-status]");
      return region ? region.textContent : null;
    },
    copyStatus: () => doc.getElementById("colors-copy-status").textContent,
    fireWindow: (type, extra = {}) => (windowListeners[type] || []).forEach((fn) => fn({ type, ...extra })),
  };
}

const ALL_OFF = { c001: "false", c005: "false", c151: "false" };
const classes = (node) => node.children.map((c) => c.className);

// ---------------------------------------------------------------------
// dormant: exactly as before
// ---------------------------------------------------------------------

test("dormant (LAUNCHED false): no Save button; every card drawn exactly as before; copy works; no account request, nothing in this browser", async () => {
  for (const withSaved of [true, false]) {
    const p = load({ launched: false, withSaved });
    await settle(10);
    assert.deepStrictEqual(p.cards(), IDS);
    assert.strictEqual(p.renders(), 1, "the grid is drawn once");
    assert.ok(p.markup().includes(OXBLOOD_CARD), "c005 byte-identical to before Saved");
    assert.strictEqual(p.markup().split('</button><p class="color-card__name">').length - 1, 3, "every name straight after its plate");
    assert.ok(!p.markup().includes("data-save"), "no Saved attributes drawn");
    assert.ok(!p.markup().includes("color-save"), "no Save button drawn");
    assert.ok(!p.markup().includes("color-card__foot"), "no Save row drawn");
    assert.deepStrictEqual(p.doc.querySelectorAll("[data-save-kind]"), []);
    for (const id of IDS) assert.deepStrictEqual(classes(p.card(id)), ["color-card__plate", "color-card__name"]);
    assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), null);

    fire(p.doc, p.plate("c151"), "click");
    await settle(10);
    assert.deepStrictEqual(p.copied, ["#1E193B"]);
    assert.strictEqual(p.plate("c151").getAttribute("data-copied"), "true");
    await wait(80);
    assert.strictEqual(p.copyStatus(), "Copied #1E193B");

    assert.deepStrictEqual(p.apiCalls(), [], "no account request");
    assert.deepStrictEqual(p.log, [], "no browser storage touched");
    assert.deepStrictEqual(p.opened, []);
    assert.deepStrictEqual(p.toasts, []);
    assert.deepStrictEqual(p.errors, []);
  }
});

test("every color on the site has an id account Saved accepts", () => {
  const colors = JSON.parse(fs.readFileSync(path.join(ROOT, "colors", "colors-data.json"), "utf8"));
  const p = load({ launched: false });
  assert.ok(colors.length > 0);
  assert.deepStrictEqual(
    colors.map((x) => x.id).filter((id) => !p.ctx.BpozzSaved.isValidItem("color", id)),
    [],
  );
});

// ---------------------------------------------------------------------
// launched: account Saved
// ---------------------------------------------------------------------

test("launched: each card gets one Save button beside its name — kind, id, name, label — and one list request paints them", async () => {
  const p = load({ server: fakeServer({ saved: [["color", "c005"], ["palette", "p001"]] }) });
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
    IDS.map((id) => ["BUTTON", "button", "color", id, NAME[id], "Save this color"]),
  );
  for (const id of IDS) {
    assert.deepStrictEqual(classes(p.card(id)), ["color-card__plate", "color-card__foot"]);
    const foot = p.card(id).querySelector(".color-card__foot");
    assert.deepStrictEqual(classes(foot), ["color-card__name", "color-save-btn"], "the name, then its Save");
    assert.strictEqual(foot.querySelector(".color-card__name").textContent, NAME[id]);
    assert.strictEqual(p.plate(id).querySelector(".color-save-btn"), null, "never inside the copy button");
  }
  assert.deepStrictEqual(p.lists().map((c) => c.url), ["/api/saved?kind=color"]);
  assert.deepStrictEqual(p.writes(), []);
  assert.deepStrictEqual(p.savePressed(), { c001: "false", c005: "true", c151: "false" }, "the account's colors only");
  assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), "on");
});

test("launched: colors drawn before the session is known, or after it — sync() hands them over, one list request either way", async () => {
  // Drawn first: the session answer is held.
  const sessionAnswer = deferred();
  const early = load({ server: fakeServer({ saved: [["color", "c151"]] }), session: sessionAnswer.promise });
  await settle(10);
  assert.strictEqual(early.saves().length, 3, "drawn");
  assert.deepStrictEqual(early.apiCalls(), [], "nothing asked while the session is unknown");
  assert.deepStrictEqual(early.savePressed(), ALL_OFF);
  sessionAnswer.resolve(SIGNED_IN);
  await settle(10);
  assert.deepStrictEqual(early.lists().map((c) => c.url), ["/api/saved?kind=color"]);
  assert.deepStrictEqual(early.savePressed(), { c001: "false", c005: "false", c151: "true" });

  // Session first: colors-data.json is held, so only sync() can register the buttons.
  const dataAnswer = deferred();
  const late = load({
    server: fakeServer({ saved: [["color", "c001"]] }),
    data: () => dataAnswer.promise.then(() => response(200, COLORS)),
  });
  await settle(10);
  assert.deepStrictEqual(late.saves(), []);
  assert.deepStrictEqual(late.apiCalls(), [], "no Save control yet, so no list to load");
  dataAnswer.resolve();
  await settle(10);
  assert.deepStrictEqual(late.lists().map((c) => c.url), ["/api/saved?kind=color"]);
  assert.deepStrictEqual(late.savePressed(), { c001: "true", c005: "false", c151: "false" });

  // A later session event with the same answer loads nothing again.
  dispatch(late.doc, "bpozz:session", { authenticated: true });
  await settle(10);
  assert.strictEqual(late.lists().length, 1);
  assert.strictEqual(late.dataFetches(), 1);
  assert.strictEqual(late.renders(), 1);
});

test("launched: filtering hides and shows cards without redrawing — every Save keeps its button, its state and its one list", async () => {
  const p = load({ server: fakeServer({ saved: [["color", "c001"]] }) });
  await settle(10);
  const before = p.saves();
  fire(p.doc, p.chip("Blue"), "click");
  assert.deepStrictEqual(p.shown(), ["c151"]);
  fire(p.doc, p.save("c151"), "click");
  await settle(10);
  fire(p.doc, p.chip("All"), "click");
  assert.deepStrictEqual(p.shown(), IDS);
  assert.ok(p.saves().every((b, i) => b === before[i]), "the same buttons: colors.js draws once");
  assert.strictEqual(p.renders(), 1);
  assert.deepStrictEqual(p.savePressed(), { c001: "true", c005: "false", c151: "true" });
  assert.strictEqual(p.lists().length, 1);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.body]), [["POST", { kind: "color", id: "c151" }]]);
});

test("launched: until the list arrives every Save shows unsaved and not busy; a change shows at once, busy until its answer", async () => {
  const server = fakeServer({ saved: [["color", "c001"]] });
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
  assert.deepStrictEqual(p.savePressed(), { c001: "true", c005: "false", c151: "false" });

  const save = p.save("c005");
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

test("launched and signed in: a Save click saves, a second removes — one request each, from saved.js, announced by saved.js", async () => {
  const p = load();
  await settle(10);
  const save = p.save("c001");
  // On the icon, as a pointer usually lands.
  fire(p.doc, save.querySelector("path"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url, c.body]), [["POST", "/api/saved", { kind: "color", id: "c001" }]]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.deepStrictEqual(p.server.rows, [{ kind: "color", id: "c001" }]);
  await wait(80);
  assert.strictEqual(p.savedStatus(), "Rosewood saved to your account");

  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url]), [
    ["POST", "/api/saved"],
    ["DELETE", "/api/saved?kind=color&id=c001"],
  ]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.deepStrictEqual(p.server.rows, []);
  await wait(80);
  assert.strictEqual(p.savedStatus(), "Rosewood removed from your Saved");
  assert.deepStrictEqual(p.toasts, []);
  assert.deepStrictEqual(p.copied, [], "saving copies nothing");
  assert.strictEqual(p.copyStatus(), "", "the page's copy announcement isn't used");
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
  const save = p.save("c151");
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
});

test("launched and signed out: Save opens the sign-in dialog — no request, nothing in this browser; the copy still works", async () => {
  const p = load({ session: SIGNED_OUT });
  await settle(10);
  const save = p.save("c005");
  assert.ok(save, "drawn for signed-out visitors too");
  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.opened.map(([mode, trigger]) => [mode, trigger === save]), [["signin", true]]);
  assert.deepStrictEqual(p.apiCalls(), []);
  assert.deepStrictEqual(p.writesToStorage(), []);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.deepStrictEqual(p.copied, []);

  fire(p.doc, p.plate("c005"), "click");
  await settle(10);
  assert.deepStrictEqual(p.copied, ["#3C1B26"]);
  assert.strictEqual(p.opened.length, 1, "copying never asks to sign in");
  assert.deepStrictEqual(p.apiCalls(), []);
});

test("launched: a save or a removal the server refuses is undone and said once in the site toast", async () => {
  const server = fakeServer({ saved: [["color", "c005"]] });
  const gate = deferred();
  const p = load({
    api: (method, url, body) =>
      method === "GET" ? server.handler(method, url, body) : gate.promise.then(() => response(500, { error: "boom" })),
  });
  await settle(10);
  const add = p.save("c001");
  const drop = p.save("c005");
  fire(p.doc, add, "click");
  fire(p.doc, drop, "click");
  await settle(2);
  assert.deepStrictEqual(p.savePressed(), { c001: "true", c005: "false", c151: "false" }, "both shown at once");
  gate.resolve();
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), { c001: "false", c005: "true", c151: "false" }, "both undone");
  assert.deepStrictEqual(p.saves().filter((b) => b.hasAttribute("aria-busy")), []);
  assert.deepStrictEqual(p.toasts, ["Couldn’t save that. Please try again.", "Couldn’t remove that. Please try again."]);
  assert.deepStrictEqual(server.rows, [{ kind: "color", id: "c005" }]);
  await wait(80);
  assert.strictEqual(p.savedStatus(), null, "a failure isn't announced as a change");
});

test("launched: a list that fails to load leaves every Save unsaved and is said once; the copy still works", async () => {
  const p = load({ api: () => response(503, { error: "saved_unavailable" }) });
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), ALL_OFF);
  assert.deepStrictEqual(p.toasts, ["Couldn’t load your Saved items right now."]);
  fire(p.doc, p.plate("c001"), "click");
  await settle(10);
  assert.deepStrictEqual(p.copied, ["#9C6D6B"]);
});

test("launched: a stale list is read again — shown after 5 minutes away, or back from the back/forward cache — onto the same buttons", async () => {
  const clock = { t: 0 };
  const server = fakeServer({ saved: [["color", "c001"]] });
  const p = load({ server, now: clock });
  await settle(10);
  const before = p.saves();
  assert.deepStrictEqual(p.savePressed(), { c001: "true", c005: "false", c151: "false" });

  // Changed elsewhere while this tab was in the background.
  server.rows.splice(0, server.rows.length, { kind: "color", id: "c005" });
  clock.t = 4 * 60 * 1000;
  p.doc.visibilityState = "visible";
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 1, "under 5 minutes: not stale yet");
  assert.deepStrictEqual(p.savePressed(), { c001: "true", c005: "false", c151: "false" });

  clock.t = 5 * 60 * 1000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 2, "5 minutes: read again");
  assert.deepStrictEqual(p.savePressed(), { c001: "false", c005: "true", c151: "false" });

  server.rows.splice(0, server.rows.length, { kind: "color", id: "c151" });
  p.fireWindow("pagehide");
  p.fireWindow("pageshow", { persisted: true });
  await settle(10);
  assert.strictEqual(p.lists().length, 3, "restored from the back/forward cache: read again");
  assert.deepStrictEqual(p.savePressed(), { c001: "false", c005: "false", c151: "true" });

  assert.ok(p.saves().every((b, i) => b === before[i]), "not redrawn: colors.js renders once");
  assert.strictEqual(p.renders(), 1);
  assert.strictEqual(p.dataFetches(), 1);
  assert.deepStrictEqual(p.writes(), []);
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
  const p = load({ server: fakeServer({ saved: [["color", "c001"]] }), channel: Channel });
  await settle(10);
  assert.deepStrictEqual(p.savePressed(), { c001: "true", c005: "false", c151: "false" });
  channels[0].onmessage({ data: { type: "item", kind: "color", id: "c001", saved: false } });
  channels[0].onmessage({ data: { type: "item", kind: "color", id: "c151", saved: true } });
  channels[0].onmessage({ data: { type: "item", kind: "palette", id: "p001", saved: true } });
  assert.deepStrictEqual(p.savePressed(), { c001: "false", c005: "false", c151: "true" });
  assert.strictEqual(p.lists().length, 1);
  assert.deepStrictEqual(p.writes(), []);
});

test("launched: Save is a native toggle named 'Save this color' — icon hidden, state in aria-pressed, the name never changing; saved.js announces", async () => {
  const p = load();
  await settle(10);
  const save = p.save("c151");
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
  assert.strictEqual(save.getAttribute("aria-label"), "Save this color", "a toggle keeps its name");
  await wait(80);
  const region = p.doc.querySelector("[data-saved-status]");
  assert.strictEqual(region.getAttribute("role"), "status");
  assert.strictEqual(region.getAttribute("aria-live"), "polite");
  assert.strictEqual(region.textContent, "Nightshade saved to your account");
  assert.strictEqual(p.plate("c151").getAttribute("aria-label"), "Copy #1E193B, Nightshade", "the copy button's name is unchanged");
});

test("launched: copy and Save on one card are independent — a plate click copies and saves nothing, a Save click saves and copies nothing", async () => {
  const p = load();
  await settle(10);
  const plate = p.plate("c001");
  const save = p.save("c001");

  fire(p.doc, plate, "click");
  await settle(10);
  assert.deepStrictEqual(p.copied, ["#9C6D6B"]);
  assert.strictEqual(plate.getAttribute("data-copied"), "true");
  assert.deepStrictEqual(p.writes(), []);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  await wait(80);
  assert.strictEqual(p.copyStatus(), "Copied #9C6D6B");
  assert.strictEqual(p.savedStatus(), null);

  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.body]), [["POST", { kind: "color", id: "c001" }]]);
  assert.deepStrictEqual(p.copied, ["#9C6D6B"], "no second copy");
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  await wait(80);
  assert.strictEqual(p.copyStatus(), "Copied #9C6D6B", "the copy announcement is left alone");
  assert.strictEqual(p.savedStatus(), "Rosewood saved to your account");
  assert.deepStrictEqual(p.writesToStorage(), [], "neither writes to this browser");
});

test("launched: odd color data — an id Saved wouldn't accept gets no Save and is drawn as before; a name that isn't text gets no data-save-name", async () => {
  const odd = [
    { id: "c1", name: "Too Short", hex: "#9C6D6B", category: "Red" },
    { id: "C002", name: "Capital", hex: "#B99896", category: "Red" },
    { id: "c00001", name: "Too Long", hex: "#6C5554", category: "Red" },
    { id: "p001", name: "Other Kind", hex: "#F8426B", category: "Red" },
    { id: 42, name: "Number Id", hex: "#3C1B26", category: "Red" },
    { name: "No Id", hex: "#8C1D2F", category: "Red" },
    { id: "c1200", name: 7, hex: "#1E193B", category: "Blue" },
    { id: "c0151", name: "", hex: "#322A57", category: "Blue" },
  ];
  const p = load({ colors: odd });
  await settle(10);
  assert.deepStrictEqual(p.cards(), ["c1", "C002", "c00001", "p001", "42", "undefined", "c1200", "c0151"], "every color still renders");
  for (const id of ["c1", "C002", "c00001", "p001", "42", "undefined"]) {
    assert.deepStrictEqual(classes(p.card(id)), ["color-card__plate", "color-card__name"], `${id}: no Save, the card as before`);
  }
  assert.deepStrictEqual(p.saves().map((b) => b.getAttribute("data-save-id")), ["c1200", "c0151"]);
  assert.strictEqual(p.save("c1200").hasAttribute("data-save-name"), false, "a number is not a name");
  assert.strictEqual(p.save("c0151").hasAttribute("data-save-name"), false, "an empty name is left out");
  assert.deepStrictEqual(p.lists().map((c) => c.url), ["/api/saved?kind=color"]);

  fire(p.doc, p.save("c1200"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.body), [{ kind: "color", id: "c1200" }]);
  await wait(80);
  assert.strictEqual(p.savedStatus(), "Saved to your account");
});

test("launched: a color name reaches data-save-name escaped, as one attribute, and never as markup", async () => {
  const tricky = `Say "hi" <b>Bold</b> & It's`;
  const p = load({ colors: [{ id: "c001", name: tricky, hex: "#9C6D6B", category: "Red" }] });
  await settle(10);
  const save = p.save("c001");
  assert.strictEqual(save.getAttribute("data-save-name"), tricky);
  assert.deepStrictEqual(parsedAttrs.get(save), [
    "type",
    "class",
    "data-save-kind",
    "data-save-id",
    "data-save-name",
    "aria-pressed",
    "aria-label",
  ]);
  assert.deepStrictEqual(save.children.map((c) => c.tagName), ["SVG"], "no markup from the name");
  assert.ok(p.markup().includes('data-save-name="Say &quot;hi&quot; &lt;b&gt;Bold&lt;/b&gt; &amp; It&#39;s"'));
  assert.strictEqual(p.card("c001").querySelector(".color-card__name").textContent, tricky, "the visible name as before");

  fire(p.doc, save, "click");
  await settle(10);
  await wait(80);
  assert.strictEqual(p.savedStatus(), `${tricky} saved to your account`, "announced as text");
});

test("launched: when colors-data.json doesn't load, the error shows as before and Saved asks for nothing", async () => {
  const bad = load({ data: () => response(500, { error: "boom" }) });
  await settle(10);
  assert.strictEqual(bad.empty.getAttribute("data-visible"), "true");
  assert.deepStrictEqual(bad.cards(), []);
  assert.deepStrictEqual(bad.apiCalls(), []);

  const offline = load({ data: () => Promise.reject(new Error("offline")) });
  await settle(10);
  assert.strictEqual(offline.empty.getAttribute("data-visible"), "true");
  assert.strictEqual(offline.errors.length, 1);
  assert.strictEqual(offline.errors[0][0], "Couldn't load colors-data.json");
  assert.deepStrictEqual(offline.apiCalls(), []);
});
