/**
 * account.test.js — the Saved section of /account, src/client/account.js.
 *
 * Runs the real saved.js and the real account.js, in that order (as
 * account.html loads them), in a vm against src/client/test-dom.js: a DOM
 * whose innerHTML throws, storage that logs every key it is asked for, and
 * a fetch that records every request. /api/saved and the three data files
 * are answered by small in-memory stand-ins. window.BpozzAuth is a stub with
 * auth.js's public shape.
 *
 * account.js does nothing while saved.js is dormant. The tests set
 * saved.js's one launch switch themselves, whichever value it ships with:
 * the first run it dormant (LAUNCHED false); the rest switch it on in
 * memory, the way launch will.
 *
 * The last tests read the real account.html and src/build/build.js.
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
const ACCOUNT = fs.readFileSync(path.join(__dirname, "account.js"), "utf8");
const PAGE = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
// saved.js's one launch switch, whichever value it ships with.
const GATE = /var LAUNCHED = (?:true|false);/;
const savedWith = (launched) => SAVED.replace(GATE, `var LAUNCHED = ${launched};`);

const SIGNED_IN = { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000000", email: "dee@example.test" } };
const SIGNED_OUT = { authenticated: false, user: null };
const IMAGE = "1e193b-322a57-5438e6";
const GUIDE = "color-contrast-systems";

const COLORS = [
  { id: "c001", name: "Rosewood", hex: "#9C6D6B", category: "Red" },
  { id: "c002", name: "Sandstone", hex: "#D8C3A5", category: "Brown" },
  { id: "c003", name: "Harbor", hex: "#2F5D7C", category: "Blue" },
];
const PALETTES = [
  { id: "p001", colors: ["#1E193B", "#322A57", "#5438E6", "#3876C8"], names: ["Nightshade", "Twilight", "Ultraviolet", "Azure"] },
  { id: "p002", colors: ["#111111", "#222222", "#333333"], names: ["Ink", "Soot", "Slate"] },
];
const GUIDES = [{ id: GUIDE, title: "Color Contrast Systems", category: "color" }];
const FILES = {
  "/colors/colors-data.json": COLORS,
  "/palettes/palettes-data.json": PALETTES,
  "/guides.json": GUIDES,
};

const FONTS_KEY = "bpozz:font-favorites";
const LIKES_KEY = "bpozz-palette-likes";
const MARKER_KEY = "bpozz:saved-import";

// Values made inside the vm have its own prototypes; compare their JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * A stand-in for /api/saved and /api/saved/import, answering like the real
 * one. `saved` is newest first, as the API lists it.
 */
function fakeServer({ saved = [], limits = { total: 1000, image_palette: 200 } } = {}) {
  const rows = saved.map(([kind, id]) => ({ kind, id }));
  const has = (kind, id) => rows.some((r) => r.kind === kind && r.id === id);
  const handler = (method, url, body) => {
    const u = new URL(url, "https://bpozz.com");
    if (u.pathname === "/api/saved" && method === "GET") {
      const kind = u.searchParams.get("kind");
      const items = rows
        .filter((r) => !kind || r.kind === kind)
        .map((r) => ({ kind: r.kind, id: r.id, saved_at: "2026-09-29T12:00:00+00:00" }));
      return response(200, { items, count: items.length, limits });
    }
    if (u.pathname === "/api/saved" && method === "POST") {
      const exists = has(body.kind, body.id);
      if (!exists) rows.unshift({ kind: body.kind, id: body.id });
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
        rows.unshift({ kind: item.kind, id: item.id });
        return { ...item, status: "created" };
      });
      return response(200, { results });
    }
    return response(404, { error: "not_found" });
  };
  return { handler, rows };
}

// The parts of account.html's Saved section that account.js uses: the
// original text and the empty, hidden container.
function buildSection(doc) {
  const section = doc.body.appendChild(doc.createElement("section"));
  section.id = "saved";
  const fallback = section.appendChild(doc.createElement("div"));
  fallback.setAttribute("data-account-saved-fallback", "");
  const text = fallback.appendChild(doc.createElement("p"));
  text.textContent = "Fonts you save are kept in this browser, not in your account.";
  const link = fallback.appendChild(doc.createElement("a"));
  link.setAttribute("href", "/fonts/?category=saved");
  link.textContent = "See your saved fonts";
  const root = section.appendChild(doc.createElement("div"));
  root.className = "account-saved";
  root.setAttribute("data-account-saved", "");
  root.hidden = true;
  return { section, fallback, root };
}

/**
 * Loads saved.js, then account.js, into a fresh /account page.
 *
 *   launched  false runs saved.js with LAUNCHED false; true with it on
 *   session   what BpozzAuth.getSession() resolves to
 *   server    a fakeServer(); api overrides it: (method, url, body) => response
 *   files     data file answers by path (a value is sent as 200 JSON)
 *   storage   localStorage's contents; readOnly makes setItem fail
 *   channel   a BroadcastChannel class, or none
 *   now       { t } — a clock for Date.now()
 *   withSaved false: no saved.js on the page at all
 */
function load({
  launched = true,
  session = SIGNED_IN,
  server = fakeServer(),
  api = null,
  files = FILES,
  storage = {},
  readOnly = false,
  channel = null,
  now = null,
  withSaved = true,
} = {}) {
  const doc = makeDocument();
  const page = buildSection(doc);
  const calls = [];
  const log = [];
  const toasts = [];
  const windowListeners = {};
  const local = makeStorage("localStorage", log, { initial: storage });
  if (readOnly) {
    local.setItem = (key) => {
      log.push(["localStorage", "set", key]);
      throw new Error("QuotaExceededError");
    };
  }
  const answer = (method, url, body) => {
    if (Object.prototype.hasOwnProperty.call(files, url)) {
      const file = files[url];
      return typeof file === "function" ? file() : response(200, file);
    }
    return (api || server.handler)(method, url, body);
  };

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
      calls.push({ url, method, credentials: init.credentials, body });
      return Promise.resolve().then(() => answer(method, url, body));
    },
    addEventListener: (type, fn) => (windowListeners[type] ||= []).push(fn),
    bpozzShowToast: (text) => toasts.push(text),
    BpozzAuth: {
      getSession: () => Promise.resolve(session),
      refreshSession: () =>
        Promise.resolve(SIGNED_OUT).then((data) => {
          dispatch(doc, "bpozz:session", { authenticated: false });
          return data;
        }),
      open: () => {},
    },
  };
  Object.defineProperty(ctx, "localStorage", { get: () => (log.push(["localStorage", "access"]), local) });
  if (channel) ctx.BroadcastChannel = channel;
  if (now) ctx.Date = { now: () => now.t };
  ctx.window = ctx;

  if (withSaved) vm.runInNewContext(savedWith(launched), ctx);
  vm.runInNewContext(ACCOUNT, ctx);

  const q = (selector) => page.root.querySelector(selector);
  const all = (selector) => page.root.querySelectorAll(selector);
  return {
    doc,
    ctx,
    ...page,
    server,
    calls,
    log,
    toasts,
    local,
    windowListeners,
    q,
    all,
    state: () => page.root.getAttribute("data-state"),
    // account.js's own reads of the whole list (saved.js reads per kind).
    lists: () => calls.filter((c) => c.url === "/api/saved" && c.method === "GET"),
    writes: () => calls.filter((c) => c.url.startsWith("/api/saved") && c.method !== "GET"),
    fileCalls: () => calls.filter((c) => !c.url.startsWith("/api/")).map((c) => c.url),
    headings: () => all(".account-saved__group .account-saved__heading").map((h) => h.textContent),
    names: () => all(".account-saved__name").map((n) => n.textContent),
    removeButtons: () => all("[data-account-saved-remove]"),
    removeFor: (name) => all(".account-saved__item").find((row) => row.querySelector(".account-saved__name").textContent === name).querySelector("[data-account-saved-remove]"),
    importBox: () => q(".account-saved__import"),
    // account.js's status line (saved.js has its own, [data-saved-status]).
    live: () => q("[data-account-saved-status]"),
    fireWindow: (type, extra = {}) => (windowListeners[type] || []).forEach((fn) => fn({ type, ...extra })),
  };
}

const text = (node) => (node ? node.textContent : null);

// ---------------------------------------------------------------------
// dormant
// ---------------------------------------------------------------------

test("dormant (LAUNCHED false): nothing changes — no listener, request or storage; the original text stays", async () => {
  for (const withSaved of [true, false]) {
    const p = load({ launched: false, withSaved, storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
    await settle();
    assert.strictEqual(p.root.hidden, true);
    assert.strictEqual(p.fallback.hidden, false);
    assert.deepStrictEqual(p.root.children, []);
    assert.strictEqual(p.state(), null);
    assert.deepStrictEqual(Object.keys(p.doc._listeners), []);
    assert.deepStrictEqual(Object.keys(p.windowListeners), []);
    assert.deepStrictEqual(p.calls, []);
    assert.deepStrictEqual(p.log, []);
  }
});

test("a second copy on the same page does nothing", async () => {
  const p = load({ server: fakeServer({ saved: [["font", "abel"]] }) });
  await settle(10);
  vm.runInNewContext(ACCOUNT, p.ctx);
  await settle(10);
  assert.strictEqual(p.lists().length, 1);
  assert.strictEqual(p.root.children.length, 3);
});

// ---------------------------------------------------------------------
// states
// ---------------------------------------------------------------------

test("active and signed out: the original text is hidden, the area stays empty, nothing is fetched or read", async () => {
  const p = load({ session: SIGNED_OUT, storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle(10);
  assert.strictEqual(p.fallback.hidden, true);
  assert.strictEqual(p.root.hidden, false);
  assert.strictEqual(p.state(), "signed-out");
  assert.deepStrictEqual(p.q(".account-saved__body").children, []);
  assert.strictEqual(p.importBox().hidden, true);
  assert.deepStrictEqual(p.calls, []);
  assert.deepStrictEqual(p.log, []);
});

test("loading: the area is busy with one loading line until the list answers", async () => {
  const server = fakeServer({ saved: [["font", "abel"]] });
  const held = deferred();
  const p = load({ api: (method, url, body) => held.promise.then(() => server.handler(method, url, body)) });
  await settle();
  const area = p.q(".account-saved__body");
  assert.strictEqual(p.state(), "loading");
  assert.strictEqual(area.getAttribute("aria-busy"), "true");
  assert.strictEqual(area.textContent, "Loading your saved items…");
  held.resolve();
  await settle(10);
  assert.strictEqual(p.state(), "ready");
  assert.strictEqual(area.getAttribute("aria-busy"), null);
});

test("empty: says so, and fetches no data file", async () => {
  const p = load();
  await settle(10);
  assert.strictEqual(p.state(), "empty");
  assert.deepStrictEqual(
    p.all(".account-saved__body p").map((n) => n.textContent),
    ["You haven’t saved anything yet.", "Save colors, palettes, fonts and guides, and they’ll appear here."],
  );
  assert.deepStrictEqual(p.fileCalls(), []);
});

test("populated: five groups in order, newest first; names, previews and links per kind", async () => {
  const server = fakeServer({
    saved: [["guide", GUIDE], ["image_palette", IMAGE], ["font", "abel"], ["palette", "p001"], ["font", "aboreto"], ["color", "c001"]],
  });
  const p = load({ server });
  await settle(10);
  assert.strictEqual(p.state(), "ready");
  assert.strictEqual(text(p.q(".account-saved__summary")), "6 saved items");
  assert.deepStrictEqual(p.headings(), ["Colors (1)", "Palettes (1)", "Fonts (2)", "Image Picker palettes (1)", "UI/UX Guides (1)"]);
  assert.deepStrictEqual(p.names(), [
    "Rosewood",
    "Nightshade · Twilight · Ultraviolet · Azure",
    "abel",
    "aboreto",
    "Image Picker palette",
    "Color Contrast Systems",
  ]);
  const rows = p.all(".account-saved__item");
  const link = (row) => row.querySelector(".account-saved__name");
  assert.deepStrictEqual(
    rows.map((row) => [link(row).tagName, link(row).getAttribute("href")]),
    [
      ["A", "/colors/"],
      ["A", "/palettes#p001"],
      ["A", "/fonts/abel.html"],
      ["A", "/fonts/aboreto.html"],
      ["SPAN", null],
      ["A", `/guide/${GUIDE}`],
    ],
  );
  assert.deepStrictEqual(
    rows.map((row) => text(row.querySelector(".account-saved__detail"))),
    ["#9C6D6B", null, null, null, "#1E193B · #322A57 · #5438E6", null],
  );
  const swatches = (row) => row.querySelectorAll(".account-saved__swatch").map((s) => s.style.backgroundColor);
  assert.deepStrictEqual(swatches(rows[0]), ["#9C6D6B"]);
  assert.deepStrictEqual(swatches(rows[1]), PALETTES[0].colors);
  assert.deepStrictEqual(swatches(rows[2]), []);
  assert.deepStrictEqual(swatches(rows[4]), ["#1E193B", "#322A57", "#5438E6"]);
  assert.ok(rows.every((row) => !row.querySelector(".account-saved__preview") || row.querySelector(".account-saved__preview").getAttribute("aria-hidden") === "true"));

  // Remove reads "Remove"; its full text names the item.
  assert.deepStrictEqual(
    p.removeButtons().map((b) => [b.getAttribute("type"), b.textContent]),
    [
      ["button", "Remove Rosewood"],
      ["button", "Remove Nightshade · Twilight · Ultraviolet · Azure"],
      ["button", "Remove abel"],
      ["button", "Remove aboreto"],
      ["button", "Remove Image Picker palette #1E193B · #322A57 · #5438E6"],
      ["button", "Remove Color Contrast Systems"],
    ],
  );
  // Never saved.js's own Save controls.
  assert.deepStrictEqual(p.root.querySelectorAll("[data-save-kind]"), []);

  // One list request for every kind, and each needed file once.
  assert.deepStrictEqual(plain(p.lists().map((c) => [c.url, c.credentials])), [["/api/saved", "same-origin"]]);
  assert.deepStrictEqual(p.fileCalls().sort(), ["/colors/colors-data.json", "/guides.json", "/palettes/palettes-data.json"]);
});

test("only the data files for the kinds on the list are fetched, and each only once", async () => {
  const none = load({ server: fakeServer({ saved: [["font", "abel"], ["image_palette", IMAGE]] }) });
  await settle(10);
  assert.deepStrictEqual(none.fileCalls(), [], "fonts and Image Picker palettes need no file");

  const clock = { t: 1_000_000 };
  const p = load({ server: fakeServer({ saved: [["color", "c002"]] }), now: clock });
  await settle(10);
  assert.deepStrictEqual(p.fileCalls(), ["/colors/colors-data.json"]);
  clock.t += 60_000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 2, "read again");
  assert.deepStrictEqual(p.fileCalls(), ["/colors/colors-data.json"], "the file is not");
});

test("icons are a valid kind but are not drawn", async () => {
  const p = load({ server: fakeServer({ saved: [["icon", "outline-essentials--menu"], ["font", "abel"]] }) });
  await settle(10);
  assert.deepStrictEqual(p.headings(), ["Fonts (1)"]);
  assert.strictEqual(text(p.q(".account-saved__summary")), "1 saved item");
});

test("a data file that fails: items by id; an id a file no longer has: 'No longer available', unlinked, still removable", async () => {
  const server = fakeServer({ saved: [["color", "c001"], ["palette", "p999"], ["guide", "retired-guide"]] });
  const p = load({ server, files: { ...FILES, "/colors/colors-data.json": () => response(503, { error: "unavailable" }) } });
  await settle(10);
  assert.deepStrictEqual(p.names(), ["Color c001", "Palette p999", "retired-guide"]);
  const rows = p.all(".account-saved__item");
  assert.deepStrictEqual(
    rows.map((row) => [row.querySelector(".account-saved__name").getAttribute("href"), text(row.querySelector(".account-saved__detail"))]),
    [
      ["/colors/", null],
      [null, "No longer available"],
      [null, "No longer available"],
    ],
  );
  fire(p.doc, p.removeFor("Palette p999"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url]), [["DELETE", "/api/saved?kind=palette&id=p999"]]);
  assert.deepStrictEqual(p.names(), ["Color c001", "retired-guide"]);
});

test("a saved colour the colours file no longer has: 'No longer available', not linked; a colour it has is unchanged", async () => {
  const p = load({ server: fakeServer({ saved: [["color", "c999"], ["color", "c001"]] }) });
  await settle(10);
  const rows = p.all(".account-saved__item");
  const name = (row) => row.querySelector(".account-saved__name");
  assert.deepStrictEqual(
    rows.map((row) => [name(row).tagName, name(row).getAttribute("href"), name(row).textContent, text(row.querySelector(".account-saved__detail"))]),
    [
      ["SPAN", null, "Color c999", "No longer available"],
      ["A", "/colors/", "Rosewood", "#9C6D6B"],
    ],
  );
  assert.strictEqual(rows[0].querySelector("a"), null, "no link anywhere in its row");
  assert.deepStrictEqual(rows[0].querySelectorAll(".account-saved__swatch"), []);
  fire(p.doc, p.removeFor("Color c999"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.url), ["/api/saved?kind=color&id=c999"], "still removable");
  assert.deepStrictEqual(p.names(), ["Rosewood"]);
});

test("a list that fails: its message and Try again; a 429 has its own; Try again reads it again and keeps focus", async () => {
  for (const [status, message] of [
    [503, "Couldn’t load your Saved items right now."],
    [0, "Couldn’t load your Saved items right now."],
    [429, "Too many requests. Try again in a minute."],
  ]) {
    const server = fakeServer({ saved: [["font", "abel"]] });
    let fail = true;
    const p = load({
      api: (method, url, body) => {
        if (!fail) return server.handler(method, url, body);
        return status === 0 ? Promise.reject(new TypeError("Failed to fetch")) : response(status, { error: "x" });
      },
    });
    await settle(10);
    assert.strictEqual(p.state(), "error");
    assert.strictEqual(text(p.q(".account-saved__message")), message);
    assert.deepStrictEqual(p.toasts, [], "said once, in the page");
    const retry = p.q(".account-saved__body button");
    assert.strictEqual(retry.textContent, "Try again");
    fail = false;
    retry.focus();
    fire(p.doc, retry, "click");
    await settle(10);
    assert.strictEqual(p.state(), "ready");
    assert.deepStrictEqual(p.names(), ["abel"]);
    assert.strictEqual(p.doc.activeElement, p.q(".account-saved__summary"), "focus is not dropped");
    await wait(80);
    assert.strictEqual(p.live().textContent, "", "read from where focus lands, not said again");
  }
});

// ---------------------------------------------------------------------
// removing
// ---------------------------------------------------------------------

test("remove: busy while its DELETE runs; the row goes once confirmed and focus moves to the next Remove", async () => {
  const server = fakeServer({ saved: [["color", "c001"], ["color", "c002"], ["color", "c003"]] });
  const held = deferred();
  const p = load({
    api: (method, url, body) => (method === "DELETE" ? held.promise.then(() => server.handler(method, url, body)) : server.handler(method, url, body)),
  });
  await settle(10);
  const first = p.removeFor("Rosewood");
  first.focus();
  fire(p.doc, first, "click");
  await settle();
  assert.strictEqual(first.getAttribute("aria-busy"), "true");
  assert.strictEqual(first.getAttribute("aria-disabled"), "true");
  assert.strictEqual(first.textContent, "Removing… Rosewood");
  fire(p.doc, first, "click"); // a second click while it runs
  await settle();
  assert.deepStrictEqual(p.names(), ["Rosewood", "Sandstone", "Harbor"], "not gone before the server says so");
  held.resolve();
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.url), ["/api/saved?kind=color&id=c001"], "one DELETE");
  assert.deepStrictEqual(p.names(), ["Sandstone", "Harbor"]);
  assert.strictEqual(p.doc.activeElement, p.removeFor("Sandstone"));
  assert.deepStrictEqual(p.headings(), ["Colors (2)"]);
  assert.strictEqual(text(p.q(".account-saved__summary")), "2 saved items");

  // The last row's Remove: focus moves back to the one before it.
  const last = p.removeFor("Harbor");
  last.focus();
  fire(p.doc, last, "click");
  await settle(10);
  assert.deepStrictEqual(p.names(), ["Sandstone"]);
  assert.strictEqual(p.doc.activeElement, p.removeFor("Sandstone"));
  assert.deepStrictEqual(server.rows, [{ kind: "color", id: "c002" }]);
});

test("removing a group's last item removes the group; removing the last item leaves the empty message, focused", async () => {
  const p = load({ server: fakeServer({ saved: [["font", "abel"], ["guide", GUIDE]] }) });
  await settle(10);
  const font = p.removeFor("abel");
  font.focus();
  fire(p.doc, font, "click");
  await settle(10);
  assert.deepStrictEqual(p.headings(), ["UI/UX Guides (1)"]);
  assert.strictEqual(p.doc.activeElement, p.removeFor("Color Contrast Systems"), "the next Remove, in the next group");

  fire(p.doc, p.doc.activeElement, "click");
  await settle(10);
  assert.strictEqual(p.state(), "empty");
  assert.strictEqual(p.doc.activeElement, p.q(".account-saved__message"));
  assert.strictEqual(p.doc.activeElement.textContent, "You haven’t saved anything yet.");
});

test("a remove that fails keeps the row and restores its button; saved.js says why, once", async () => {
  const server = fakeServer({ saved: [["font", "abel"]] });
  const p = load({ api: (method, url, body) => (method === "DELETE" ? response(503, { error: "saved_unavailable" }) : server.handler(method, url, body)) });
  await settle(10);
  const remove = p.removeFor("abel");
  fire(p.doc, remove, "click");
  await settle(10);
  assert.deepStrictEqual(p.names(), ["abel"]);
  assert.strictEqual(remove.getAttribute("aria-busy"), null);
  assert.strictEqual(remove.getAttribute("aria-disabled"), null);
  assert.strictEqual(remove.textContent, "Remove abel");
  assert.deepStrictEqual(p.toasts, ["Saving isn’t available right now. Please try again later."]);
});

test("a refresh while a Remove is pending: the redrawn row stays busy, allows no second removal, and goes once confirmed", async () => {
  const clock = { t: 1_000_000 };
  const server = fakeServer({ saved: [["color", "c001"], ["color", "c002"]] });
  const held = deferred();
  const p = load({
    now: clock,
    api: (method, url, body) => (method === "DELETE" ? held.promise.then(() => server.handler(method, url, body)) : server.handler(method, url, body)),
  });
  await settle(10);
  const first = p.removeFor("Rosewood");
  first.focus();
  fire(p.doc, first, "click");
  await settle();

  clock.t += 60_000;
  dispatch(p.doc, "visibilitychange"); // a quiet refresh while the DELETE is out
  await settle(10);
  assert.strictEqual(p.lists().length, 2, "the list was read again");
  const redrawn = p.removeFor("Rosewood");
  assert.notStrictEqual(redrawn, first, "the row was redrawn");
  assert.deepStrictEqual(p.names(), ["Rosewood", "Sandstone"], "not gone before the server says so");
  assert.strictEqual(redrawn.getAttribute("aria-busy"), "true");
  assert.strictEqual(redrawn.getAttribute("aria-disabled"), "true");
  assert.strictEqual(redrawn.textContent, "Removing… Rosewood");
  assert.strictEqual(p.doc.activeElement, redrawn, "focus follows it");

  fire(p.doc, redrawn, "click");
  await settle();
  assert.strictEqual(p.writes().length, 1, "no second removal");

  held.resolve();
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => c.url), ["/api/saved?kind=color&id=c001"]);
  assert.deepStrictEqual(p.names(), ["Sandstone"]);
  assert.strictEqual(p.doc.activeElement, p.removeFor("Sandstone"));
  assert.deepStrictEqual(server.rows, [{ kind: "color", id: "c002" }]);
});

test("a refresh while a Remove is pending, then the DELETE fails: the redrawn row stays and its button is restored", async () => {
  const clock = { t: 1_000_000 };
  const server = fakeServer({ saved: [["color", "c001"], ["color", "c002"]] });
  const held = deferred();
  const p = load({
    now: clock,
    api: (method, url, body) => (method === "DELETE" ? held.promise.then(() => response(503, { error: "saved_unavailable" })) : server.handler(method, url, body)),
  });
  await settle(10);
  fire(p.doc, p.removeFor("Rosewood"), "click");
  await settle();
  clock.t += 60_000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  held.resolve();
  await settle(10);
  const redrawn = p.removeFor("Rosewood");
  assert.deepStrictEqual(p.names(), ["Rosewood", "Sandstone"]);
  assert.strictEqual(redrawn.getAttribute("aria-busy"), null);
  assert.strictEqual(redrawn.getAttribute("aria-disabled"), null);
  assert.strictEqual(redrawn.textContent, "Remove Rosewood");
  assert.deepStrictEqual(p.toasts, ["Saving isn’t available right now. Please try again later."]);
  fire(p.doc, redrawn, "click"); // and it can be tried again
  await settle(10);
  assert.strictEqual(p.writes().length, 2);
});

test("the full-list and Image Picker notes follow the limits the list reports", async () => {
  const server = fakeServer({ saved: [["image_palette", IMAGE], ["font", "abel"]], limits: { total: 2, image_palette: 1 } });
  const p = load({ server });
  await settle(10);
  const [full] = p.q(".account-saved__body").children.filter((n) => n.className === "account-saved__note");
  const imageNote = p.q(".account-saved__group .account-saved__note");
  assert.strictEqual(full.hidden, false);
  assert.strictEqual(full.textContent, "Your Saved list is full (2 items). Remove something to save more.");
  assert.strictEqual(imageNote.hidden, false);
  assert.strictEqual(imageNote.textContent, "You’ve saved 1 Image Picker palettes, the most allowed.");
  fire(p.doc, p.removeFor("abel"), "click");
  await settle(10);
  assert.strictEqual(full.hidden, true);
});

// ---------------------------------------------------------------------
// staying current, signing out
// ---------------------------------------------------------------------

test("another tab's removal disappears at once; shown again after a minute, the list is read again", async () => {
  const channels = [];
  class Channel {
    constructor() {
      this.onmessage = null;
      channels.push(this);
    }
    postMessage() {}
    close() {}
  }
  const clock = { t: 1_000_000 };
  const server = fakeServer({ saved: [["font", "abel"], ["font", "aboreto"]] });
  const p = load({ server, channel: Channel, now: clock });
  await settle(10);
  server.rows.shift(); // abel, removed in another tab, which says so
  channels[0].onmessage({ data: { type: "item", kind: "font", id: "abel", saved: false } });
  assert.deepStrictEqual(p.names(), ["aboreto"]);

  server.rows.unshift({ kind: "font", id: "abeezee" }); // saved in another tab meanwhile
  clock.t += 30_000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 1, "not yet: under a minute");
  clock.t += 30_000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 2);
  assert.deepStrictEqual(p.names(), ["abeezee", "aboreto"]);

  p.fireWindow("pageshow", { persisted: true });
  await settle(10);
  assert.strictEqual(p.lists().length, 3, "and after a back/forward restore");
});

test("sign-out while the list is shown: nothing about the account stays on the page", async () => {
  const p = load({
    server: fakeServer({ saved: [["font", "abel"]] }),
    storage: { [FONTS_KEY]: JSON.stringify(["aboreto"]) },
  });
  await settle(10);
  assert.strictEqual(p.importBox().hidden, false);
  dispatch(p.doc, "bpozz:session", { authenticated: false });
  await settle();
  assert.strictEqual(p.state(), "signed-out");
  assert.deepStrictEqual(p.q(".account-saved__body").children, []);
  assert.strictEqual(p.importBox().hidden, true);
  assert.deepStrictEqual(p.importBox().children, []);
  await wait(80);
  assert.strictEqual(p.live().textContent, "");
});

test("a list answer that arrives after sign-out is not drawn", async () => {
  const server = fakeServer({ saved: [["font", "abel"]] });
  const held = deferred();
  const p = load({ api: (method, url, body) => held.promise.then(() => server.handler(method, url, body)) });
  await settle();
  dispatch(p.doc, "bpozz:session", { authenticated: false });
  held.resolve();
  await settle(10);
  assert.strictEqual(p.state(), "signed-out");
  assert.deepStrictEqual(p.names(), []);
});

// ---------------------------------------------------------------------
// the status line
// ---------------------------------------------------------------------

test("status line: loading, then how many — never the list itself; empty and a failed list are said too", async () => {
  const server = fakeServer({ saved: [["font", "abel"], ["color", "c001"]] });
  const held = deferred();
  const p = load({ api: (method, url, body) => held.promise.then(() => server.handler(method, url, body)) });
  await settle();
  await wait(80);
  const live = p.live();
  assert.strictEqual(live.getAttribute("role"), "status");
  assert.strictEqual(live.getAttribute("aria-live"), "polite");
  assert.strictEqual(live.getAttribute("aria-atomic"), "true");
  assert.strictEqual(live.className, "sr-only");
  assert.ok(!p.q(".account-saved__body").contains(live), "outside the list, which is redrawn");
  assert.strictEqual(live.textContent, "Loading your saved items…");
  held.resolve();
  await settle(10);
  await wait(80);
  assert.strictEqual(live.textContent, "You have 2 saved items.");

  const empty = load();
  await settle(10);
  await wait(80);
  assert.strictEqual(empty.live().textContent, "You haven’t saved anything yet.");

  const failing = load({ api: () => response(503, { error: "saved_unavailable" }) });
  await settle(10);
  await wait(80);
  assert.strictEqual(failing.live().textContent, "Couldn’t load your Saved items right now.");
});

test("status line: a refresh speaks only when the list changed; another tab's removal is said once, briefly", async () => {
  const channels = [];
  class Channel {
    constructor() {
      this.onmessage = null;
      channels.push(this);
    }
    postMessage() {}
    close() {}
  }
  const clock = { t: 1_000_000 };
  const server = fakeServer({ saved: [["font", "abel"], ["font", "aboreto"]] });
  const p = load({ server, channel: Channel, now: clock });
  await settle(10);
  await wait(80);
  assert.strictEqual(p.live().textContent, "You have 2 saved items.");

  p.live().textContent = "";
  clock.t += 60_000;
  dispatch(p.doc, "visibilitychange"); // nothing changed
  await settle(10);
  await wait(80);
  assert.strictEqual(p.lists().length, 2);
  assert.strictEqual(p.live().textContent, "", "nothing new, nothing said");

  server.rows.unshift({ kind: "font", id: "abeezee" }); // saved in another tab
  clock.t += 60_000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  await wait(80);
  assert.strictEqual(p.live().textContent, "Your saved items were updated. You have 3 saved items.");

  server.rows.shift(); // and removed there again
  channels[0].onmessage({ data: { type: "item", kind: "font", id: "abeezee", saved: false } });
  await wait(80);
  assert.strictEqual(p.live().textContent, "Your saved items were updated. You have 2 saved items.");
});

test("status line: this page's own removal is left to saved.js's announcement; the last one to the focused empty message", async () => {
  const p = load({ server: fakeServer({ saved: [["font", "abel"], ["font", "aboreto"]] }) });
  await settle(10);
  await wait(80);
  p.live().textContent = "";
  const first = p.removeFor("abel");
  first.focus();
  fire(p.doc, first, "click");
  await settle(10);
  await wait(80);
  assert.strictEqual(text(p.doc.querySelector("[data-saved-status]")), "Removed from your Saved");
  assert.strictEqual(p.live().textContent, "", "not said twice");

  fire(p.doc, p.doc.activeElement, "click"); // the last one
  await settle(10);
  await wait(80);
  assert.strictEqual(p.doc.activeElement, p.q(".account-saved__message"));
  assert.strictEqual(p.live().textContent, "", "the empty message is read from focus");
});

// ---------------------------------------------------------------------
// this browser's saves from before accounts
// ---------------------------------------------------------------------

test("import offer: this browser's fonts ticked, palette likes not; likes for palettes no longer on the site left out", async () => {
  const p = load({
    storage: { [FONTS_KEY]: JSON.stringify(["abel", "aboreto"]), [LIKES_KEY]: JSON.stringify(["p001", "p999"]) },
  });
  await settle(10);
  const box = p.importBox();
  assert.strictEqual(box.hidden, false);
  assert.strictEqual(box.getAttribute("role"), "group");
  assert.strictEqual(text(p.doc.getElementById(box.getAttribute("aria-labelledby"))), "Saved in this browser");
  const choices = box.querySelectorAll(".account-saved__choice");
  assert.deepStrictEqual(
    choices.map((c) => [c.textContent, c.querySelector("input").checked]),
    [
      ["2 fonts you saved", true],
      ["1 palette you liked", false],
    ],
  );
  assert.strictEqual(
    text(box.querySelector(".account-saved__note")),
    "Fonts you add move from this browser’s list to your account. Your palette likes stay as they are.",
  );
  assert.deepStrictEqual(p.fileCalls(), ["/palettes/palettes-data.json"], "read only to check the likes");
  assert.deepStrictEqual(p.writes(), [], "nothing is sent until asked");
});

test("no import offer once dismissed, or with nothing from before; a dismissed offer doesn't even read the old lists", async () => {
  const dismissed = load({
    storage: { [MARKER_KEY]: JSON.stringify({ v: 1, dismissed: true }), [FONTS_KEY]: JSON.stringify(["abel"]) },
  });
  await settle(10);
  assert.strictEqual(dismissed.importBox().hidden, true);
  assert.ok(!dismissed.log.some(([, , key]) => key === FONTS_KEY || key === LIKES_KEY));

  const nothing = load();
  await settle(10);
  assert.strictEqual(nothing.importBox().hidden, true);

  const gone = load({ storage: { [LIKES_KEY]: JSON.stringify(["p999"]) } });
  await settle(10);
  assert.strictEqual(gone.importBox().hidden, true, "only likes for palettes no longer on the site");
});

test("Add to my account: fonts only by default; the outcome replaces the offer, focused; the list is read again", async () => {
  const server = fakeServer({ saved: [["font", "aboreto"]] });
  const p = load({
    server,
    storage: { [FONTS_KEY]: JSON.stringify(["abel", "aboreto"]), [LIKES_KEY]: JSON.stringify(["p001"]) },
  });
  await settle(10);
  await wait(80);
  p.live().textContent = "";
  const add = p.importBox().querySelector(".btn-primary");
  assert.strictEqual(add.textContent, "Add to my account");
  add.focus();
  fire(p.doc, add, "click");
  await settle(10);
  const [sent] = p.writes();
  assert.strictEqual(sent.url, "/api/saved/import");
  assert.deepStrictEqual(sent.body, { items: [{ kind: "font", id: "abel" }, { kind: "font", id: "aboreto" }] });

  const status = p.importBox().querySelector(".account-saved__message");
  assert.deepStrictEqual(p.importBox().children, [status], "only the outcome is left");
  assert.strictEqual(status.textContent, "Added 1 item to your account. 1 was already saved.");
  assert.strictEqual(p.doc.activeElement, status);
  assert.strictEqual(status.getAttribute("role"), null, "read from focus, so no longer a live region: said once");
  assert.strictEqual(p.lists().length, 2);
  assert.deepStrictEqual(p.names(), ["abel", "aboreto"]);
  await wait(80);
  assert.strictEqual(p.live().textContent, "", "the list read after an import says nothing more");

  // Storage, exactly as docs/SAVED.md says.
  assert.deepStrictEqual(p.local.dump(), {
    [LIKES_KEY]: JSON.stringify(["p001"]),
    [MARKER_KEY]: JSON.stringify({ v: 1, dismissed: true }),
  });
});

test("Add with palette likes ticked sends them too, never a like for a palette no longer on the site", async () => {
  const p = load({ storage: { [FONTS_KEY]: JSON.stringify(["abel"]), [LIKES_KEY]: JSON.stringify(["p999", "p002"]) } });
  await settle(10);
  const likes = p.importBox().querySelectorAll(".account-saved__choice input")[1];
  likes.checked = true;
  fire(p.doc, likes, "change");
  fire(p.doc, p.importBox().querySelector(".btn-primary"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes()[0].body, { items: [{ kind: "font", id: "abel" }, { kind: "palette", id: "p002" }] });
  assert.strictEqual(p.local.dump()[LIKES_KEY], JSON.stringify(["p999", "p002"]), "likes are never written");
  // Focus wasn't in the offer, so the outcome stays a live region and is announced.
  const status = p.importBox().querySelector(".account-saved__message");
  assert.strictEqual(status.getAttribute("role"), "status");
  assert.strictEqual(status.textContent, "Added 2 items to your account.");
});

test("Add with nothing ticked is disabled and sends nothing", async () => {
  const p = load({ storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle(10);
  const fonts = p.importBox().querySelector(".account-saved__choice input");
  const add = p.importBox().querySelector(".btn-primary");
  fonts.checked = false;
  fire(p.doc, fonts, "change");
  assert.strictEqual(add.disabled, true);
  fire(p.doc, add, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes(), []);
});

test("an Add that fails keeps the offer with the reason; browser storage is untouched", async () => {
  const server = fakeServer();
  const storage = { [FONTS_KEY]: JSON.stringify(["abel"]) };
  const p = load({
    storage,
    api: (method, url, body) => (url === "/api/saved/import" ? response(503, { error: "saved_unavailable" }) : server.handler(method, url, body)),
  });
  await settle(10);
  const add = p.importBox().querySelector(".btn-primary");
  fire(p.doc, add, "click");
  await settle(10);
  assert.strictEqual(text(p.importBox().querySelector("[role='status']")), "Saving isn’t available right now. Please try again later.");
  assert.strictEqual(add.textContent, "Add to my account");
  assert.strictEqual(add.getAttribute("aria-disabled"), null);
  assert.deepStrictEqual(p.local.dump(), storage);
});

test("No thanks: remembered as exactly {v:1, dismissed:true}; where storage refuses, put away for this page view only", async () => {
  const p = load({ storage: { [FONTS_KEY]: JSON.stringify(["abel"]) } });
  await settle(10);
  const skip = p.importBox().querySelectorAll("button")[1];
  assert.strictEqual(skip.textContent, "No thanks");
  skip.focus();
  fire(p.doc, skip, "click");
  assert.strictEqual(p.importBox().hidden, true);
  assert.strictEqual(p.doc.activeElement, p.q(".account-saved__message"), "focus moves to the list");
  assert.deepStrictEqual(p.local.dump(), { [FONTS_KEY]: JSON.stringify(["abel"]), [MARKER_KEY]: JSON.stringify({ v: 1, dismissed: true }) });
  assert.deepStrictEqual(p.writes(), []);

  const storage = { [FONTS_KEY]: JSON.stringify(["abel"]) };
  const blocked = load({ storage, readOnly: true });
  await settle(10);
  fire(blocked.doc, blocked.importBox().querySelectorAll("button")[1], "click");
  assert.strictEqual(blocked.importBox().hidden, true);
  const again = load({ storage, readOnly: true });
  await settle(10);
  assert.strictEqual(again.importBox().hidden, false, "offered again on the next visit");
});

// ---------------------------------------------------------------------
// safety
// ---------------------------------------------------------------------

test("data file text is drawn as text, and only a well-formed hex ever becomes a colour", async () => {
  const markup = '<img src=x onerror="alert(1)">';
  const p = load({
    server: fakeServer({ saved: [["color", "c001"], ["palette", "p001"], ["guide", GUIDE]] }),
    files: {
      "/colors/colors-data.json": [{ id: "c001", name: markup, hex: "#9C6D6B" }],
      "/palettes/palettes-data.json": [{ id: "p001", colors: ["red", "#12345G", "#123456", "url(x)"], names: [markup] }],
      "/guides.json": [{ id: GUIDE, title: markup }],
    },
  });
  await settle(10);
  assert.deepStrictEqual(p.names(), [markup, markup, markup]);
  assert.deepStrictEqual(p.all(".account-saved__swatch").map((s) => s.style.backgroundColor), ["#9C6D6B", "#123456"]);

  const badColor = load({
    server: fakeServer({ saved: [["color", "c001"]] }),
    files: { "/colors/colors-data.json": [{ id: "c001", name: "Rosewood", hex: "javascript:1" }] },
  });
  await settle(10);
  assert.deepStrictEqual(badColor.names(), ["Color c001"], "an entry with a bad hex is not used");
  assert.deepStrictEqual(badColor.all(".account-saved__swatch"), []);
});

// ---------------------------------------------------------------------
// account.html and the build
// ---------------------------------------------------------------------

test("account.html: the three sections keep their ids and classes; Saved keeps its text as the fallback", () => {
  for (const id of ["profile", "saved", "settings"]) {
    const opening = `<section class="account-page__section" id="${id}" aria-labelledby="${id}-title">`;
    assert.strictEqual(PAGE.split(opening).length - 1, 1, id);
  }
  const section = /<section[^>]*id="saved"[^>]*>([\s\S]*?)<\/section>/.exec(PAGE)[1];
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  assert.strictEqual(
    squash(section),
    squash(`
      <h2 class="legal-subheading" id="saved-title">Saved</h2>
      <div data-account-saved-fallback>
        <p>
          Fonts you save are kept in this browser, not in your account, so
          they don't follow you to another browser or device.
        </p>
        <p><a href="/fonts/?category=saved">See your saved fonts</a></p>
      </div>
      <div class="account-saved" data-account-saved hidden></div>
    `),
  );
});

test("account.html: /auth.js, /saved.js, /account.js last, in that order; markers and auth hooks once each", () => {
  const scripts = [...PAGE.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((attrs) => /\ssrc="\//.test(attrs));
  assert.deepStrictEqual(scripts, [' src="/auth.js"', ' src="/saved.js"', ' src="/account.js"']);
  const tail = PAGE.slice(PAGE.indexOf("<!--FOOTER_END-->"));
  assert.ok(/<script src="\/auth.js"><\/script>\s*<script src="\/saved.js"><\/script>\s*<script src="\/account.js"><\/script>\s*<\/body>/.test(tail));
  for (const marker of ["<!--HEADER_START-->", "<!--HEADER_END-->", "<!--FOOTER_START-->", "<!--FOOTER_END-->"]) {
    assert.strictEqual(PAGE.split(marker).length - 1, 1, marker);
  }
  const body = PAGE.slice(PAGE.indexOf("<body>"));
  for (const hook of ["data-account-page", "data-account-profile", "data-auth-signout", "data-account-saved-fallback", "data-account-saved "]) {
    assert.strictEqual(body.split(hook).length - 1, 1, hook);
  }
});

test("build: /account.js is published on its own and is not part of /app.js", () => {
  const build = require(path.join(ROOT, "src", "build", "build.js"));
  assert.deepStrictEqual(
    build.PUBLISH_FILES.filter((f) => f.from === "src/client/account.js").map((f) => ({ ...f })),
    [{ from: "src/client/account.js", to: "account.js" }],
  );
  assert.deepStrictEqual(build.APP_BUNDLE.modules, ["src/shared/html.js", "src/shared/card.js", "src/client/auth.js", "src/client/saved.js"]);
});
