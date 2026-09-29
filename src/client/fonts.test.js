/**
 * fonts.test.js — Save on the font pages, src/client/fonts.js (Saved Phase
 * 2, M3).
 *
 * Runs the real saved.js and the real fonts.js, in that order (as the font
 * pages load /app.js, then /fonts/fonts.js), in a vm against
 * src/client/test-dom.js, with a stand-in /api/saved. The pages are small
 * copies of what src/build/fonts.js renders: a /fonts/ listing (cards,
 * category chips with Saved, search, sort, the empty state) and a detail
 * page (the Save button with its text, and a related card).
 *
 * saved.js ships with LAUNCHED = false. The first tests run it as shipped:
 * the hearts must keep saving to this browser exactly as before. The rest
 * switch that one line on in memory, the way launch will.
 *
 * All account data below is invented.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { makeDocument, fire, makeStorage, response, deferred, settle, wait } = require("./test-dom.js");

const ROOT = path.join(__dirname, "..", "..");
const SAVED = fs.readFileSync(path.join(__dirname, "saved.js"), "utf8");
const FONTS = fs.readFileSync(path.join(__dirname, "fonts.js"), "utf8");
const LAUNCH_LINE = "var LAUNCHED = false;";

const SIGNED_IN = { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000000", email: "dee@example.test" } };
const SIGNED_OUT = { authenticated: false, user: null };
const FONTS_KEY = "bpozz:font-favorites";
const MARKER_KEY = "bpozz:saved-import";

const CATALOGUE = [
  { id: "abeezee", name: "ABeeZee", category: "sans-serif", added: "2012-09-30", featured: 1 },
  { id: "abel", name: "Abel", category: "sans-serif", added: "2011-08-03", featured: 6 },
  { id: "abhaya-libre", name: "Abhaya Libre", category: "serif", added: "2016-06-20", featured: 9 },
];

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
// local stand-ins for what fonts.js uses and test-dom.js (shared, left
// as it is) doesn't have
// ---------------------------------------------------------------------

// element.classList, on this document's elements only.
function addClassList(doc) {
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
}

function el(doc, parent, tag, attrs = {}, text) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return parent.appendChild(node);
}

// A card as src/build/fonts.js renders it, as far as fonts.js reads it.
function card(doc, parent, font) {
  const li = el(doc, parent, "li", {
    class: "font-card",
    "data-font-id": font.id,
    "data-name": font.name,
    "data-category": font.category,
    "data-added": font.added,
    "data-featured": String(font.featured),
    "data-search": `${font.id} ${font.name.toLowerCase()} ${font.category}`,
  });
  el(doc, li, "span", { "data-font-sample": "" }, font.name);
  el(doc, li, "button", {
    type: "button",
    class: "font-icon-btn",
    "data-font-fav": font.id,
    "aria-pressed": "false",
    "aria-label": `Save ${font.name}`,
  });
  return li;
}

function buildListing(doc) {
  el(doc, doc.body, "div", { id: "fonts-status", class: "sr-only", role: "status" });
  const chips = el(doc, doc.body, "div", { class: "fonts-filters" });
  for (const [category, label] of [["", "All"], ["sans-serif", "Sans Serif"], ["serif", "Serif"], ["saved", "Saved"]]) {
    el(
      doc,
      chips,
      "button",
      {
        type: "button",
        class: category === "saved" ? "fonts-filter fonts-filter--saved" : "fonts-filter",
        "data-category": category,
        "aria-pressed": String(category === ""),
      },
      label,
    );
  }
  const search = el(doc, doc.body, "input", { id: "fonts-search" });
  search.value = "";
  const sort = el(doc, doc.body, "select", { id: "fonts-sort" });
  sort.value = "az";
  const preview = el(doc, doc.body, "input", { id: "fonts-preview-text" });
  preview.value = "";
  const count = el(doc, doc.body, "p", { id: "fonts-count" });
  const grid = el(doc, doc.body, "ul", { id: "font-grid" });
  CATALOGUE.forEach((font) => card(doc, grid, font));
  const empty = el(doc, doc.body, "div", { class: "fonts-empty", id: "fonts-empty", hidden: "" });
  const title = el(doc, el(doc, empty, "p"), "strong", {}, "No fonts match your search.");
  const hint = el(doc, empty, "p", {}, "Try another name, designer or category.");
  // fonts.js finds the hint with "p + p"; the test DOM has no "+".
  const own = empty.querySelector.bind(empty);
  empty.querySelector = (selector) => (selector === "p + p" ? hint : own(selector));
  return { grid, search, count, empty, title, hint };
}

function buildDetail(doc) {
  el(doc, doc.body, "div", { id: "fonts-status", class: "sr-only", role: "status" });
  el(doc, doc.body, "h1", { class: "font-detail__title" }, "Abel");
  const action = el(doc, doc.body, "button", {
    type: "button",
    class: "font-action",
    "data-font-fav": "abel",
    "data-font-fav-label": "",
    "aria-pressed": "false",
  });
  el(doc, action, "span", {}, "Save");
  card(doc, el(doc, doc.body, "ul", { class: "font-related" }), CATALOGUE[0]);
  return { action };
}

/**
 * Loads saved.js (unless withSaved is false), then fonts.js, into a fresh
 * font page.
 *
 *   page       "listing" (/fonts/) or "detail" (/fonts/abel.html)
 *   launched   false runs saved.js as shipped; true switches LAUNCHED on
 *   session    what BpozzAuth.getSession() resolves to
 *   server     a fakeServer(); api overrides it
 *   storage    localStorage's contents; storageThrows blocks it entirely
 *   search     location.search, e.g. "?category=saved"
 *   channel    a BroadcastChannel class, or none
 */
function load({
  page = "listing",
  launched = true,
  withSaved = true,
  session = SIGNED_IN,
  server = fakeServer(),
  api = null,
  storage = {},
  storageThrows = false,
  search = "",
  channel = null,
} = {}) {
  const doc = makeDocument();
  addClassList(doc);
  const parts = page === "listing" ? buildListing(doc) : buildDetail(doc);
  const calls = [];
  const log = [];
  const toasts = [];
  const opened = [];
  const windowListeners = {};
  const local = makeStorage("localStorage", log, { initial: storage, throws: storageThrows });

  const ctx = {
    console,
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: doc,
    location: { search, pathname: page === "listing" ? "/fonts/" : "/fonts/abel.html" },
    history: { replaceState: () => {} },
    fetch: (url, init = {}) => {
      const method = init.method || "GET";
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ url, method, body });
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
  if (channel) ctx.BroadcastChannel = channel;
  ctx.window = ctx;

  if (withSaved) vm.runInNewContext(launched ? SAVED.replace(LAUNCH_LINE, "var LAUNCHED = true;") : SAVED, ctx);
  vm.runInNewContext(FONTS, ctx);

  const grid = parts.grid;
  return {
    doc,
    ctx,
    ...parts,
    server,
    calls,
    log,
    toasts,
    opened,
    local,
    writes: () => calls.filter((c) => c.method !== "GET"),
    lists: () => calls.filter((c) => c.method === "GET"),
    button: (id) => doc.querySelector(`.font-icon-btn[data-font-fav="${id}"]`),
    visible: () => (grid ? grid.children.filter((li) => !li.hidden).map((li) => li.getAttribute("data-font-id")) : []),
    pressed: () =>
      Object.fromEntries(CATALOGUE.map((f) => [f.id, doc.querySelector(`.font-icon-btn[data-font-fav="${f.id}"]`).getAttribute("aria-pressed")])),
    status: () => doc.getElementById("fonts-status").textContent,
    savedStatus: () => {
      const region = doc.querySelector("[data-saved-status]");
      return region ? region.textContent : null;
    },
    fireWindow: (type, extra = {}) => (windowListeners[type] || []).forEach((fn) => fn({ type, ...extra })),
  };
}

// ---------------------------------------------------------------------
// dormant: exactly as before
// ---------------------------------------------------------------------

test("dormant (Saved as shipped): the heart saves to this browser exactly as before — no account request, no saved.js attributes", async () => {
  for (const withSaved of [true, false]) {
    const p = load({ launched: false, withSaved });
    await settle();
    const heart = p.button("abeezee");
    fire(p.doc, heart, "click");
    assert.strictEqual(heart.getAttribute("aria-pressed"), "true");
    assert.deepStrictEqual(p.local.dump(), { [FONTS_KEY]: JSON.stringify(["abeezee"]) });
    await wait(50);
    assert.strictEqual(p.status(), "ABeeZee saved");
    fire(p.doc, heart, "click");
    assert.strictEqual(heart.getAttribute("aria-pressed"), "false");
    assert.deepStrictEqual(p.local.dump(), { [FONTS_KEY]: "[]" });
    await wait(50);
    assert.strictEqual(p.status(), "ABeeZee removed from saved fonts");
    assert.deepStrictEqual(p.calls, []);
    assert.deepStrictEqual(p.doc.querySelectorAll("[data-save-kind]"), []);
    assert.deepStrictEqual(p.opened, []);
  }
});

test("dormant: the detail page's Save reads Save / Saved from this browser's favorites", async () => {
  const p = load({ page: "detail", launched: false, storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle();
  assert.strictEqual(p.action.querySelector("span").textContent, "Saved");
  assert.strictEqual(p.action.getAttribute("aria-pressed"), "true");
  fire(p.doc, p.action, "click");
  assert.strictEqual(p.action.querySelector("span").textContent, "Save");
  await wait(50);
  assert.strictEqual(p.status(), "Abel removed from saved fonts");
  assert.deepStrictEqual(p.calls, []);
});

test("dormant: ?category=saved lists this browser's favorites; its empty state and another tab's change work as before", async () => {
  const p = load({ launched: false, search: "?category=saved", storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle();
  assert.deepStrictEqual(p.visible(), ["abel"]);
  assert.strictEqual(p.count.textContent, "Showing 1 of 3 fonts");
  assert.strictEqual(p.empty.hidden, true);

  p.local.setItem(FONTS_KEY, "[]"); // another tab removed it
  p.fireWindow("storage", { key: FONTS_KEY });
  assert.deepStrictEqual(p.visible(), []);
  assert.strictEqual(p.empty.hidden, false);
  assert.strictEqual(p.title.textContent, "You haven't saved any fonts yet.");
  assert.strictEqual(p.hint.textContent, "Select the heart on a font to keep it here.");
  assert.deepStrictEqual(p.calls, []);
});

test("dormant: a browser that won't keep favorites is told once, as before", async () => {
  const p = load({ launched: false, storageThrows: true });
  await settle();
  fire(p.doc, p.button("abel"), "click");
  fire(p.doc, p.button("abeezee"), "click");
  assert.deepStrictEqual(p.toasts, ["Saved fonts can't be kept in this browser after you leave"]);
  assert.strictEqual(p.button("abel").getAttribute("aria-pressed"), "true", "still saved for this visit");
});

test("every font in the catalogue has an id account Saved accepts", () => {
  const fonts = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "fonts.json"), "utf8"));
  const p = load({ launched: false });
  assert.ok(fonts.length > 0);
  assert.deepStrictEqual(
    fonts.map((f) => f.id).filter((id) => !p.ctx.BpozzSaved.isValidItem("font", id)),
    [],
  );
});

// ---------------------------------------------------------------------
// launched: account Saved
// ---------------------------------------------------------------------

test("launched: each Save button becomes a saved.js control — kind, id, name — and one list request paints them", async () => {
  const p = load({ server: fakeServer({ saved: [["font", "abel"]] }), storage: { [FONTS_KEY]: JSON.stringify(["abeezee"]) } });
  await settle(10);
  assert.deepStrictEqual(
    p.doc.querySelectorAll("[data-font-fav]").map((b) => [b.getAttribute("data-save-kind"), b.getAttribute("data-save-id"), b.getAttribute("data-save-name")]),
    [
      ["font", "abeezee", "ABeeZee"],
      ["font", "abel", "Abel"],
      ["font", "abhaya-libre", "Abhaya Libre"],
    ],
  );
  assert.deepStrictEqual(p.calls.map((c) => [c.method, c.url]), [["GET", "/api/saved?kind=font"]]);
  assert.deepStrictEqual(p.pressed(), { abeezee: "false", abel: "true", "abhaya-libre": "false" }, "the account's, not this browser's");
  assert.ok(!p.log.some(([, , key]) => key === FONTS_KEY), "this browser's favorites aren't read");
});

test("launched: a Save click is handled once — one request, nothing written to this browser, announced by saved.js only", async () => {
  const p = load({ storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle(10);
  const heart = p.button("abeezee");
  fire(p.doc, heart, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url, c.body]), [["POST", "/api/saved", { kind: "font", id: "abeezee" }]]);
  assert.strictEqual(heart.getAttribute("aria-pressed"), "true");
  assert.deepStrictEqual(p.local.dump(), { [FONTS_KEY]: JSON.stringify(["abel"]) }, "this browser's list is untouched");
  assert.ok(!p.log.some(([, op]) => op === "set" || op === "remove"));
  await wait(80);
  assert.strictEqual(p.savedStatus(), "ABeeZee saved to your account");
  assert.strictEqual(p.status(), "", "fonts.js's own line stays quiet");

  fire(p.doc, heart, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.method), ["POST", "DELETE"]);
  assert.strictEqual(heart.getAttribute("aria-pressed"), "false");
});

test("launched and signed out: Save opens the sign-in dialog; nothing is saved, in the account or this browser", async () => {
  const p = load({ session: SIGNED_OUT });
  await settle(10);
  const heart = p.button("abel");
  fire(p.doc, heart, "click");
  await settle(10);
  assert.deepStrictEqual(p.opened.map(([mode, trigger]) => [mode, trigger === heart]), [["signin", true]]);
  assert.deepStrictEqual(p.calls, []);
  assert.deepStrictEqual(p.local.dump(), {});
  assert.ok(!p.log.some(([, op]) => op === "set"));
  assert.strictEqual(heart.getAttribute("aria-pressed"), "false");
});

test("launched, detail page: Save reads Save / Saved from the account, painted by saved.js", async () => {
  const p = load({ page: "detail", server: fakeServer({ saved: [["font", "abel"]] }), storage: { [FONTS_KEY]: "[]" } });
  await settle(10);
  const label = p.action.querySelector("span");
  assert.strictEqual(label.getAttribute("data-save-label"), "");
  assert.strictEqual(p.action.getAttribute("data-save-name"), "Abel");
  assert.strictEqual(label.textContent, "Saved");
  assert.strictEqual(p.action.getAttribute("aria-pressed"), "true");
  assert.strictEqual(p.button("abeezee").getAttribute("data-save-name"), "ABeeZee", "the related card's heart too");

  fire(p.doc, p.action, "click");
  await settle(10);
  assert.strictEqual(label.textContent, "Save");
  assert.deepStrictEqual(p.calls.map((c) => c.method), ["GET", "DELETE"]);
});

test("launched Saved view: the account's fonts; until the list arrives, none, and a note that they haven't loaded", async () => {
  const server = fakeServer({ saved: [["font", "abel"]] });
  const held = deferred();
  const p = load({
    search: "?category=saved",
    api: (method, url, body) => held.promise.then(() => server.handler(method, url, body)),
    storage: { [FONTS_KEY]: JSON.stringify(["abeezee"]) },
  });
  await settle();
  assert.deepStrictEqual(p.visible(), []);
  assert.strictEqual(p.empty.hidden, false);
  assert.strictEqual(p.title.textContent, "Your saved fonts haven't loaded yet.");
  assert.strictEqual(p.hint.textContent, "They'll appear here as soon as they do.");
  held.resolve();
  await settle(10);
  assert.deepStrictEqual(p.visible(), ["abel"], "the account's, not this browser's");
  assert.strictEqual(p.empty.hidden, true);
  assert.strictEqual(p.count.textContent, "Showing 1 of 3 fonts");
});

test("launched Saved view, signed out: asks to sign in, whatever the search; this browser's favorites never show", async () => {
  const p = load({ session: SIGNED_OUT, search: "?category=saved", storage: { [FONTS_KEY]: JSON.stringify(["abel", "abeezee"]) } });
  await settle(10);
  assert.deepStrictEqual(p.visible(), []);
  assert.strictEqual(p.empty.hidden, false);
  assert.strictEqual(p.title.textContent, "Sign in to see your saved fonts.");
  assert.strictEqual(p.hint.textContent, "Fonts you save are kept in your account, wherever you sign in.");
  p.search.value = "abel";
  fire(p.doc, p.search, "input");
  assert.deepStrictEqual(p.visible(), []);
  assert.strictEqual(p.title.textContent, "Sign in to see your saved fonts.");
  assert.deepStrictEqual(p.calls, []);
  assert.ok(!p.log.some(([, , key]) => key === FONTS_KEY), "not even read");
});

test("launched Saved view follows the account — a removal here, a save in another tab — with no further list requests", async () => {
  const channels = [];
  class Channel {
    constructor() {
      this.onmessage = null;
      channels.push(this);
    }
    postMessage() {}
    close() {}
  }
  const p = load({ search: "?category=saved", server: fakeServer({ saved: [["font", "abel"]] }), channel: Channel });
  await settle(10);
  assert.deepStrictEqual(p.visible(), ["abel"]);

  fire(p.doc, p.button("abel"), "click");
  await settle(10);
  assert.deepStrictEqual(p.visible(), []);
  assert.strictEqual(p.title.textContent, "You haven't saved any fonts yet.");

  channels[0].onmessage({ data: { type: "item", kind: "font", id: "abhaya-libre", saved: true } });
  assert.deepStrictEqual(p.visible(), ["abhaya-libre"]);

  fire(p.doc, p.doc.querySelector('.fonts-filter[data-category=""]'), "click");
  p.search.value = "ab";
  fire(p.doc, p.search, "input");
  await settle(10);
  assert.strictEqual(p.lists().length, 1, "one list request, ever");
});

test("launched Saved view, signed in, none saved: old browser favorites aren't shown or sent from here; it points to Your Account", async () => {
  const p = load({ search: "?category=saved", storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle(10);
  assert.deepStrictEqual(p.visible(), []);
  assert.strictEqual(p.title.textContent, "You haven't saved any fonts yet.");
  assert.strictEqual(
    p.hint.textContent,
    "Select the heart on a font to keep it here. Fonts saved in this browser before accounts can be added from Your Account.",
  );
  assert.strictEqual(p.hint.querySelector("a").getAttribute("href"), "/account#saved");
  assert.deepStrictEqual(p.writes(), [], "nothing imported from here");
  assert.deepStrictEqual(p.local.dump(), { [FONTS_KEY]: JSON.stringify(["abel"]) }, "left for the import on /account");

  const dismissed = load({
    search: "?category=saved",
    storage: { [FONTS_KEY]: JSON.stringify(["abel"]), [MARKER_KEY]: JSON.stringify({ v: 1, dismissed: true }) },
  });
  await settle(10);
  assert.strictEqual(dismissed.hint.textContent, "Select the heart on a font to keep it here.", "no pointer once the offer was dismissed");

  const nothingOld = load({ search: "?category=saved" });
  await settle(10);
  assert.strictEqual(nothingOld.hint.textContent, "Select the heart on a font to keep it here.");
});
