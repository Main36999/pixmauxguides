/**
 * guides.test.js — Save on the guide article pages: initGuideSave in
 * src/client/guides.js (Saved Phase 2, M6).
 *
 * guides.js is a fragment of /app.js, not a module (see core.js's header),
 * so there is nothing to require. As search.test.js does for search.js,
 * initGuideSave is lifted verbatim out of the file and run the way /app.js
 * runs it: after src/shared/html.js and the real saved.js, inside the
 * bundle's own wrapper, where core.js has set escapeHtml from BpozzHtml —
 * in a vm against src/client/test-dom.js, with a stand-in /api/saved. The
 * page is a small copy of a guide page: the hero (meta line, heading, dek),
 * the table of contents, the article, the related-guides rail and the
 * toast. The last tests check that every committed guide page has the
 * hooks, and that /app.js is assembled in the order this relies on.
 *
 * The tests set saved.js's one launch switch themselves, whichever value it
 * ships with. The first run it dormant (LAUNCHED false): no Save button, and
 * the page exactly as before. The rest switch it on in memory, the way
 * launch will.
 *
 * A guide page has no Like or favourite. Its own interactions are links —
 * the table of contents, the article's anchors, the rail — and those stay
 * separate from Save throughout.
 *
 * The last section covers Save on the /guides cards: drawCardSaves, lifted
 * and run the same way, on a small copy of the /guides grid.
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
const build = require(path.join(ROOT, "src", "build", "build.js"));
const SAVED = fs.readFileSync(path.join(__dirname, "saved.js"), "utf8");
const HTML_JS = fs.readFileSync(path.join(ROOT, "src", "shared", "html.js"), "utf8");
const CORE_JS = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const GUIDES_JS = fs.readFileSync(path.join(__dirname, "guides.js"), "utf8");
// saved.js's one launch switch, whichever value it ships with.
const GATE = /var LAUNCHED = (?:true|false);/;
const savedWith = (launched) => SAVED.replace(GATE, `var LAUNCHED = ${launched};`);

// initGuideSave, exactly as it ships.
const START = GUIDES_JS.indexOf("(function initGuideSave() {");
const END = GUIDES_JS.indexOf("\n  })();", START) + "\n  })();".length;
assert.ok(START !== -1 && END > START, "could not find initGuideSave() in guides.js");
const INIT_GUIDE_SAVE = GUIDES_JS.slice(START, END);
// core.js's one line that initGuideSave depends on, in the shared scope.
const ESCAPE_LINE = "var escapeHtml = BpozzHtml.escapeHtml;";
assert.ok(CORE_JS.includes(ESCAPE_LINE), "core.js no longer sets escapeHtml from BpozzHtml");
const fragment = (block) => build.APP_BUNDLE.wrapper.open + "  " + ESCAPE_LINE + "\n  " + block + "\n" + build.APP_BUNDLE.wrapper.close;

const SIGNED_IN = { authenticated: true, user: { id: "00000000-0000-4000-8000-000000000000", email: "dee@example.test" } };
const SIGNED_OUT = { authenticated: false, user: null };

const ID = "color-contrast-systems";
const NAME = "Color Contrast Is Math, Not Taste";
// The heading as the page has it: indented over three lines.
const HEADING = "\n            Color Contrast Is Math, Not Taste\n          ";
const META = "Color Theory · Beginner · 10 min read";

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
// a local stand-in for what initGuideSave uses and test-dom.js (shared,
// left as it is) doesn't have
// ---------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);

// Each parsed element's attribute names, in the order the markup gave them.
const parsedAttrs = new WeakMap();

/**
 * initGuideSave draws the bookmark with one insertAdjacentHTML("beforeend")
 * on the hero's meta line, which test-dom.js elements don't have. This adds
 * it to that one element: tags, double-quoted attributes, "/>", text and
 * the five entities escapeHtml writes, appended after what is there — and
 * it throws on anything else, on any other position, or on an attribute
 * given twice. Every other element keeps test-dom.js's throwing innerHTML
 * and has no insertAdjacentHTML at all. `seen` keeps every string given.
 */
function allowAppend(doc, target, seen) {
  const TOKEN = /<\/([a-z]+)>|<([a-z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>|([^<]+)/y;
  target.insertAdjacentHTML = (where, html) => {
    if (where !== "beforeend") throw new Error(`unexpected position: ${where}`);
    seen.push(html);
    const stack = [target];
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
  };
}

function el(doc, parent, tag, attrs = {}, text = null) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== null) node.appendChild(doc.createTextNode(text));
  return parent.appendChild(node);
}

/**
 * Loads saved.js (unless withSaved is false), then initGuideSave, into a
 * fresh guide page.
 *
 *   launched   false runs saved.js with LAUNCHED false; true with it on
 *   session    what BpozzAuth.getSession() resolves to (or a promise of it)
 *   server     a fakeServer(); api overrides it
 *   id         the page's data-guide-id (null: none)
 *   heading    the heading's text (null: no heading)
 *   hero       false: a page with data-guide-id but no hero
 *   block      initGuideSave's source (a test may vary it)
 *   channel    a BroadcastChannel class, or none
 *   now        { t } — a clock for saved.js's Date.now()
 */
function load({
  launched = true,
  withSaved = true,
  session = SIGNED_IN,
  server = fakeServer(),
  api = null,
  id = ID,
  heading = HEADING,
  hero = true,
  block = INIT_GUIDE_SAVE,
  channel = null,
  now = null,
} = {}) {
  const doc = makeDocument();
  doc.body.setAttribute("class", "guide-page");
  if (id !== null) doc.body.setAttribute("data-guide-id", id);
  const main = el(doc, doc.body, "main", { class: "wrap", id: "guide-content" });
  const primary = el(doc, main, "div", { class: "guide-primary" });
  let meta = null;
  if (hero) {
    const section = el(doc, primary, "section", { class: "guide-hero", "aria-labelledby": "guide-heading" });
    meta = el(doc, section, "p", { class: "guide-hero__meta" }, META);
    if (heading !== null) el(doc, section, "h1", { class: "guide-hero__title", id: "guide-heading" }, heading);
    el(doc, section, "p", { class: "guide-hero__dek" }, "Contrast is the only part of color theory with a pass/fail number.");
  }
  const toc = el(doc, primary, "nav", { class: "guide-toc" });
  const tocLink = el(doc, el(doc, el(doc, toc, "ol"), "li"), "a", { href: "#why-contrast" }, "Why contrast is the right place to start");
  const article = el(doc, primary, "article", { class: "guide-article" });
  el(doc, article, "h2", { id: "why-contrast" }, "Why contrast is the right place to start");
  const articleLink = el(doc, el(doc, article, "p"), "a", { href: "/guide/type-scale-systems" }, "type scale");
  const rail = el(doc, main, "aside", { class: "guide-rail", id: "guide-rail" });
  const railLink = el(doc, rail, "a", { class: "content-card", href: "/guide/dark-mode-second-palette" }, "Dark Mode");
  el(doc, doc.body, "div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" });
  const seen = [];
  if (meta) allowAppend(doc, meta, seen);

  const calls = [];
  const log = [];
  const toasts = [];
  const opened = [];
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
    location: { hash: "", search: "", pathname: `/guide/${id}` },
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
  Object.defineProperty(ctx, "sessionStorage", { get: () => (log.push(["sessionStorage", "access"]), local) });
  if (channel) ctx.BroadcastChannel = channel;
  if (now) ctx.Date = { now: () => now.t };
  ctx.window = ctx;

  vm.runInNewContext(HTML_JS, ctx);
  if (withSaved) vm.runInNewContext(savedWith(launched), ctx);
  vm.runInNewContext(fragment(block), ctx);

  return {
    doc,
    ctx,
    meta,
    toc,
    article,
    rail,
    tocLink,
    articleLink,
    railLink,
    server,
    calls,
    log,
    toasts,
    opened,
    errors,
    markup: () => seen.join(""),
    writes: () => calls.filter((c) => c.method !== "GET"),
    lists: () => calls.filter((c) => c.method === "GET"),
    save: () => doc.querySelector(".guide-save-btn"),
    saves: () => doc.querySelectorAll("[data-save-kind]"),
    pressed: () => doc.querySelector(".guide-save-btn").getAttribute("aria-pressed"),
    writesToStorage: () => log.filter(([, op]) => op === "set" || op === "remove"),
    savedStatus: () => {
      const region = doc.querySelector("[data-saved-status]");
      return region ? region.textContent : null;
    },
    fireWindow: (type, extra = {}) => (windowListeners[type] || []).forEach((fn) => fn({ type, ...extra })),
  };
}

// The page's own parts as plain data: tags, attributes and text.
function shape(node) {
  if (!node.getAttribute) return node.textContent;
  return [node.tagName, Object.fromEntries(node._attrs), node.children.map(shape)];
}

// ---------------------------------------------------------------------
// dormant: exactly as before
// ---------------------------------------------------------------------

test("dormant (LAUNCHED false): no Save button; the page exactly as before; no account request, nothing in this browser", async () => {
  const before = shape(load({ withSaved: false, block: "" }).doc.body);
  for (const withSaved of [true, false]) {
    const p = load({ launched: false, withSaved });
    await settle(10);
    assert.deepStrictEqual(shape(p.doc.body), before, "the page is untouched");
    assert.strictEqual(p.save(), null);
    assert.deepStrictEqual(p.saves(), []);
    assert.deepStrictEqual(p.meta.children.map((c) => c.textContent), [META], "the meta line is its text alone");
    assert.strictEqual(p.markup(), "", "nothing drawn");
    assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), null);
    assert.deepStrictEqual(p.calls, [], "no account request");
    assert.deepStrictEqual(p.log, [], "no browser storage touched");
    assert.deepStrictEqual(p.opened, []);
    assert.deepStrictEqual(p.toasts, []);
    assert.deepStrictEqual(p.errors, []);
  }
});

// ---------------------------------------------------------------------
// launched: account Saved
// ---------------------------------------------------------------------

test("launched: the hero's meta line ends in one Save button — kind, id, name, label — and one list request paints it", async () => {
  const p = load({ server: fakeServer({ saved: [["guide", ID], ["color", "c001"]] }) });
  await settle(10);
  const save = p.save();
  assert.deepStrictEqual(
    [
      save.tagName,
      save.getAttribute("type"),
      save.getAttribute("class"),
      save.getAttribute("data-save-kind"),
      save.getAttribute("data-save-id"),
      save.getAttribute("data-save-name"),
      save.getAttribute("aria-label"),
    ],
    ["BUTTON", "button", "guide-save-btn", "guide", ID, NAME, "Save this guide"],
  );
  assert.strictEqual(save.parentNode, p.meta, "in the meta line");
  assert.strictEqual(p.meta.children[p.meta.children.length - 1], save, "at its end");
  assert.strictEqual(p.meta.textContent, META, "the meta line reads as before");
  assert.strictEqual(p.saves().length, 1, "one Save on the page");
  assert.deepStrictEqual(p.lists().map((c) => c.url), ["/api/saved?kind=guide"]);
  assert.deepStrictEqual(p.writes(), []);
  assert.strictEqual(p.pressed(), "true", "the account's guide");
  assert.strictEqual(p.doc.documentElement.getAttribute("data-saved-ui"), "on");
});

test("launched: sync() is what hands the bookmark to saved.js — drawn after saved.js looked, it is painted and its list loaded only because of it", async () => {
  // Drawn while the session is unknown: nothing asked until it is known.
  const sessionAnswer = deferred();
  const early = load({ server: fakeServer({ saved: [["guide", ID]] }), session: sessionAnswer.promise });
  await settle(10);
  assert.ok(early.save(), "drawn at once");
  assert.deepStrictEqual(early.calls, [], "nothing asked while the session is unknown");
  assert.strictEqual(early.pressed(), "false");
  sessionAnswer.resolve(SIGNED_IN);
  await settle(10);
  assert.deepStrictEqual(early.lists().map((c) => c.url), ["/api/saved?kind=guide"]);
  assert.strictEqual(early.pressed(), "true");

  // A later session event with the same answer loads nothing again.
  dispatch(early.doc, "bpozz:session", { authenticated: true });
  await settle(10);
  assert.strictEqual(early.lists().length, 1);

  // Without its sync() line the same bookmark is never registered: saved.js
  // scanned the page before /app.js's fragments ran.
  assert.ok(INIT_GUIDE_SAVE.includes("saved.sync(meta);"));
  const unsynced = load({ server: fakeServer({ saved: [["guide", ID]] }), block: INIT_GUIDE_SAVE.replace("saved.sync(meta);", "") });
  await settle(10);
  assert.ok(unsynced.save());
  assert.deepStrictEqual(unsynced.lists(), [], "no list for a control saved.js was never handed");
  assert.strictEqual(unsynced.pressed(), "false", "and never painted");
});

test("launched: until the list arrives the Save shows unsaved and not busy; a change shows at once, busy until its answer", async () => {
  const server = fakeServer();
  const listGate = deferred();
  const saveGate = deferred();
  const p = load({
    api: (method, url, body) =>
      (method === "GET" ? listGate.promise : method === "POST" ? saveGate.promise : Promise.resolve()).then(() =>
        server.handler(method, url, body),
      ),
  });
  await settle(10);
  const save = p.save();
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.strictEqual(save.hasAttribute("aria-busy"), false);
  listGate.resolve();
  await settle(10);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");

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
  const save = p.save();
  // On the icon, as a pointer usually lands.
  fire(p.doc, save.querySelector("path"), "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url, c.body]), [["POST", "/api/saved", { kind: "guide", id: ID }]]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.deepStrictEqual(p.server.rows, [{ kind: "guide", id: ID }]);
  await wait(80);
  assert.strictEqual(p.savedStatus(), `${NAME} saved to your account`);

  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.url]), [
    ["POST", "/api/saved"],
    ["DELETE", `/api/saved?kind=guide&id=${ID}`],
  ]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.deepStrictEqual(p.server.rows, []);
  await wait(80);
  assert.strictEqual(p.savedStatus(), `${NAME} removed from your Saved`);
  assert.deepStrictEqual(p.toasts, []);
  assert.deepStrictEqual(p.writesToStorage(), []);
});

test("launched: rapid clicks never put two requests in flight; it ends as the last click asked", async () => {
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
  const save = p.save();
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

test("launched and signed out: Save opens the sign-in dialog — no request, nothing in this browser", async () => {
  const p = load({ session: SIGNED_OUT });
  await settle(10);
  const save = p.save();
  assert.ok(save, "drawn for signed-out visitors too");
  fire(p.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(p.opened.map(([mode, trigger]) => [mode, trigger === save]), [["signin", true]]);
  assert.deepStrictEqual(p.calls, []);
  assert.deepStrictEqual(p.writesToStorage(), []);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
});

test("launched: a save or a removal the server refuses is undone and said once in the site toast", async () => {
  const refuse = (server) => (method, url, body) => (method === "GET" ? server.handler(method, url, body) : response(500, { error: "boom" }));

  const unsaved = fakeServer();
  const add = load({ api: refuse(unsaved) });
  await settle(10);
  fire(add.doc, add.save(), "click");
  await settle(10);
  assert.strictEqual(add.pressed(), "false", "undone");
  assert.strictEqual(add.save().hasAttribute("aria-busy"), false);
  assert.deepStrictEqual(add.toasts, ["Couldn’t save that. Please try again."]);
  assert.deepStrictEqual(unsaved.rows, []);

  const saved = fakeServer({ saved: [["guide", ID]] });
  const drop = load({ api: refuse(saved) });
  await settle(10);
  assert.strictEqual(drop.pressed(), "true");
  fire(drop.doc, drop.save(), "click");
  await settle(10);
  assert.strictEqual(drop.pressed(), "true", "undone");
  assert.deepStrictEqual(drop.toasts, ["Couldn’t remove that. Please try again."]);
  assert.deepStrictEqual(saved.rows, [{ kind: "guide", id: ID }]);
  await wait(80);
  assert.strictEqual(add.savedStatus(), null, "a failure isn't announced as a change");
  assert.strictEqual(drop.savedStatus(), null);
});

test("launched: a list that fails to load leaves the Save unsaved and is said once", async () => {
  const p = load({ api: () => response(503, { error: "saved_unavailable" }) });
  await settle(10);
  assert.strictEqual(p.pressed(), "false");
  assert.deepStrictEqual(p.toasts, ["Couldn’t load your Saved items right now."]);
});

test("launched: a stale list is read again — shown after 5 minutes away, or back from the back/forward cache — onto the same button", async () => {
  const clock = { t: 0 };
  const server = fakeServer({ saved: [["guide", ID]] });
  const p = load({ server, now: clock });
  await settle(10);
  const before = p.save();
  assert.strictEqual(p.pressed(), "true");

  // Removed elsewhere while this tab was in the background.
  server.rows.splice(0, server.rows.length);
  clock.t = 4 * 60 * 1000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 1, "under 5 minutes: not stale yet");
  assert.strictEqual(p.pressed(), "true");

  clock.t = 5 * 60 * 1000;
  dispatch(p.doc, "visibilitychange");
  await settle(10);
  assert.strictEqual(p.lists().length, 2, "5 minutes: read again");
  assert.strictEqual(p.pressed(), "false");

  server.rows.push({ kind: "guide", id: ID });
  p.fireWindow("pagehide");
  p.fireWindow("pageshow", { persisted: true });
  await settle(10);
  assert.strictEqual(p.lists().length, 3, "restored from the back/forward cache: read again");
  assert.strictEqual(p.pressed(), "true");

  assert.strictEqual(p.save(), before, "the same button: drawn once");
  assert.strictEqual(p.saves().length, 1);
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
  const p = load({ server: fakeServer({ saved: [["guide", ID]] }), channel: Channel });
  await settle(10);
  assert.strictEqual(p.pressed(), "true");
  channels[0].onmessage({ data: { type: "item", kind: "guide", id: ID, saved: false } });
  assert.strictEqual(p.pressed(), "false");
  channels[0].onmessage({ data: { type: "item", kind: "guide", id: "type-scale-systems", saved: true } });
  assert.strictEqual(p.pressed(), "false", "another guide's save isn't this one");
  channels[0].onmessage({ data: { type: "item", kind: "guide", id: ID, saved: true } });
  assert.strictEqual(p.pressed(), "true");
  assert.strictEqual(p.lists().length, 1);
  assert.deepStrictEqual(p.writes(), []);
});

test("launched: Save is a native toggle named 'Save this guide' — icon hidden, state in aria-pressed, the name never changing; saved.js announces", async () => {
  const p = load();
  await settle(10);
  const save = p.save();
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
  assert.strictEqual(save.getAttribute("aria-label"), "Save this guide", "a toggle keeps its name");
  await wait(80);
  const region = p.doc.querySelector("[data-saved-status]");
  assert.strictEqual(region.getAttribute("role"), "status");
  assert.strictEqual(region.getAttribute("aria-live"), "polite");
  assert.strictEqual(region.textContent, `${NAME} saved to your account`);
});

test("launched: the page's own links stay separate — contents, article and rail clicks are left to the browser and ask nothing; only the hero's meta line gains a child", async () => {
  const plain = load({ withSaved: false, block: "" });
  const p = load();
  await settle(10);

  // The page around the bookmark is as it was.
  assert.deepStrictEqual(shape(p.toc), shape(plain.toc), "table of contents untouched");
  assert.deepStrictEqual(shape(p.article), shape(plain.article), "article untouched");
  assert.deepStrictEqual(shape(p.rail), shape(plain.rail), "rail untouched");
  const hero = p.meta.parentNode.children;
  const plainHero = plain.meta.parentNode.children;
  assert.deepStrictEqual(hero.slice(1).map(shape), plainHero.slice(1).map(shape), "heading and dek untouched");
  assert.deepStrictEqual(p.meta.children.map((c) => c.tagName || c.textContent), [META, "BUTTON"], "the meta line keeps its text, then the Save");

  for (const link of [p.tocLink, p.articleLink, p.railLink]) {
    const evt = fire(p.doc, link, "click");
    assert.strictEqual(evt.defaultPrevented, false, `${link.getAttribute("href")}: still followed`);
  }
  await settle(10);
  assert.deepStrictEqual(p.writes(), [], "no link saves anything");
  assert.deepStrictEqual(p.opened, []);
  assert.strictEqual(p.pressed(), "false");

  const evt = fire(p.doc, p.save(), "click");
  assert.strictEqual(evt.defaultPrevented, true, "the Save's own click is saved.js's");
  await settle(10);
  assert.deepStrictEqual(p.writes().map((c) => [c.method, c.body]), [["POST", { kind: "guide", id: ID }]]);
});

test("launched: odd pages — no guide id, an id Saved wouldn't accept, no hero — get no Save and are left as they were; a missing heading only drops the name", async () => {
  const odd = [null, "", "Color-Contrast", "color_contrast", "color--contrast", "-color", "a".repeat(101), 'x"><img src=x>'];
  for (const id of odd) {
    const plain = load({ withSaved: false, block: "", id });
    const p = load({ id });
    await settle(10);
    assert.strictEqual(p.save(), null, `${id}: no Save`);
    assert.deepStrictEqual(shape(p.doc.body), shape(plain.doc.body), `${id}: page untouched`);
    assert.deepStrictEqual(p.calls, [], `${id}: nothing asked`);
    assert.deepStrictEqual(p.errors, []);
  }

  const noHero = load({ hero: false });
  await settle(10);
  assert.strictEqual(noHero.save(), null);
  assert.deepStrictEqual(noHero.calls, []);
  assert.deepStrictEqual(noHero.errors, []);

  const longest = load({ id: "a".repeat(100) });
  await settle(10);
  assert.strictEqual(longest.save().getAttribute("data-save-id"), "a".repeat(100), "a 100-character slug is a guide id");

  for (const heading of [null, "   \n  "]) {
    const p = load({ heading });
    await settle(10);
    assert.strictEqual(p.save().hasAttribute("data-save-name"), false, "no heading text, no name");
    fire(p.doc, p.save(), "click");
    await settle(10);
    await wait(80);
    assert.strictEqual(p.savedStatus(), "Saved to your account");
  }
});

test("launched: a heading reaches data-save-name escaped, as one attribute, and never as markup", async () => {
  const tricky = `Say "hi" <b>Bold</b> & It's`;
  const p = load({ heading: `\n  ${tricky}\n` });
  await settle(10);
  const save = p.save();
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
  assert.deepStrictEqual(save.children.map((c) => c.tagName), ["SVG"], "no markup from the heading");
  assert.ok(p.markup().includes('data-save-name="Say &quot;hi&quot; &lt;b&gt;Bold&lt;/b&gt; &amp; It&#39;s"'));

  fire(p.doc, save, "click");
  await settle(10);
  await wait(80);
  assert.strictEqual(p.savedStatus(), `${tricky} saved to your account`, "announced as text");
});

// ---------------------------------------------------------------------
// the real pages and the real bundle
// ---------------------------------------------------------------------

test("every committed guide page has the hooks initGuideSave reads, with a guide id Saved accepts and guides.json lists", () => {
  const guides = JSON.parse(fs.readFileSync(path.join(ROOT, "guides.json"), "utf8"));
  const p = load({ launched: false });
  const valid = (id) => p.ctx.BpozzSaved.isValidItem("guide", id);
  assert.deepStrictEqual(guides.map((g) => g.id).filter((id) => !valid(id)), [], "every guides.json id is a guide id");

  const files = fs.readdirSync(path.join(ROOT, "guide")).filter((f) => f.endsWith(".html"));
  assert.strictEqual(files.length, guides.length);
  for (const file of files) {
    const id = file.replace(/\.html$/, "");
    const html = fs.readFileSync(path.join(ROOT, "guide", file), "utf8");
    const count = (s) => html.split(s).length - 1;
    // Some pages' <body> carry class="guide-page" and some don't; the id is
    // what initGuideSave reads.
    const bodies = html.match(/<body\b[^>]*>/g);
    assert.strictEqual(bodies.length, 1, `${file}: one body`);
    assert.strictEqual((/\sdata-guide-id="([^"]*)"/.exec(bodies[0]) || [])[1], id, `${file}: body names its guide`);
    assert.ok(valid(id), `${file}: a guide id`);
    assert.ok(guides.some((g) => g.id === id), `${file}: in guides.json`);
    assert.strictEqual(count('class="guide-hero"'), 1, `${file}: one hero`);
    assert.strictEqual(count('class="guide-hero__meta"'), 1, `${file}: one meta line`);
    assert.strictEqual(count('class="guide-hero__title"'), 1, `${file}: one heading`);
    const hero = html.indexOf('class="guide-hero"');
    const metaAt = html.indexOf('class="guide-hero__meta"');
    assert.ok(hero < metaAt && metaAt < html.indexOf("</section>", hero), `${file}: the meta line is in the hero`);
    assert.strictEqual(count("guide-save-btn"), 0, `${file}: no Save in the page itself`);
    assert.strictEqual(count('src="/app.js"'), 1, `${file}: loads /app.js`);
  }
});

test("build: /app.js runs html.js and saved.js before the fragments, core.js before guides.js — the order initGuideSave relies on", () => {
  const { modules, fragments } = build.APP_BUNDLE;
  assert.ok(modules.includes("src/shared/html.js"));
  assert.ok(modules.includes("src/client/saved.js"));
  assert.ok(fragments.indexOf("src/client/core.js") !== -1);
  assert.ok(fragments.indexOf("src/client/core.js") < fragments.indexOf("src/client/guides.js"));
  assert.ok(!build.PUBLISH_FILES.some((f) => f.from === "src/client/guides.js"), "a fragment, never published on its own");
});

// ---------------------------------------------------------------------
// Save on the /guides cards: drawCardSaves
// ---------------------------------------------------------------------

// drawCardSaves, exactly as it ships, after core.js's two lines it depends
// on. It is run once, as guides.js runs it at boot, and handed to the test
// so it can be run again, as render() does after replacing the cards.
const CARDS_START = GUIDES_JS.indexOf("  function drawCardSaves() {");
const CARDS_END = GUIDES_JS.indexOf("\n  }\n", CARDS_START) + "\n  }\n".length;
assert.ok(CARDS_START !== -1 && CARDS_END > CARDS_START, "could not find drawCardSaves() in guides.js");
const GRID_LINES = ['var gridRoot = document.getElementById("grid-root");', "var hasGuideGrid = !!gridRoot;"];
for (const line of GRID_LINES) assert.ok(CORE_JS.includes(line), `core.js no longer has: ${line}`);
const DRAW_CARD_SAVES =
  GRID_LINES.join("\n  ") + "\n" + GUIDES_JS.slice(CARDS_START, CARDS_END) + "  drawCardSaves();\n  window.drawCardSaves = drawCardSaves;";

const CARDS = [
  [ID, NAME],
  ["whitespace-as-ui-component", "Whitespace as a UI Component, Not a Leftover"],
  ["padding-margin-different-jobs", "Padding and Margin Are Different Jobs, Not Interchangeable Values"],
];
const CARD_LINKS = CARDS.map(([id, title]) => [`/guide/${id}`, title]);

/** One card as cardHtml() draws it; href null leaves the link out. */
function addCard(doc, grid, [href, title], seen) {
  const article = el(doc, grid, "article", { class: "content-card" });
  el(doc, article, "div", { class: "card-thumb" });
  const body = el(doc, article, "div", { class: "card-body" });
  const link = href === null ? null : el(doc, el(doc, body, "h3", { class: "card-title" }), "a", { class: "card-link", href }, title);
  el(doc, body, "p", { class: "card-meta" }, META);
  allowAppend(doc, article, seen);
  return { article, link };
}

/**
 * Loads saved.js (unless withSaved is false), then drawCardSaves, into a
 * fresh /guides page.
 *
 *   cards      [href, title] per card (href null: a card with no link)
 *   grid       false: the cards sit in a grid that isn't #grid-root, as on
 *              the home and category pages
 *   the rest   as load() above
 */
function loadGrid({ launched = true, withSaved = true, session = SIGNED_IN, server = fakeServer(), cards = CARD_LINKS, grid = true, block = DRAW_CARD_SAVES } = {}) {
  const doc = makeDocument();
  doc.body.setAttribute("class", "guides-page");
  const main = el(doc, doc.body, "main", { class: "wrap guides-main", id: "guides-content" });
  const root = el(doc, main, "div", grid ? { class: "grid guides-grid", id: "grid-root" } : { class: "grid" });
  el(doc, doc.body, "div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" });
  const seen = [];
  let drawn = cards.map((c) => addCard(doc, root, c, seen));

  const calls = [];
  const toasts = [];
  const opened = [];
  const errors = [];
  const ctx = {
    console: { log: () => {}, warn: () => {}, error: (...args) => errors.push(args) },
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: doc,
    location: { hash: "", search: "", pathname: "/guides/" },
    fetch: (url, init = {}) => {
      const method = init.method || "GET";
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ url, method, body });
      return Promise.resolve().then(() => server.handler(method, url, body));
    },
    addEventListener: () => {},
    bpozzShowToast: (text) => toasts.push(text),
    BpozzAuth: {
      getSession: () => Promise.resolve(session),
      refreshSession: () => Promise.resolve(session),
      open: (mode, trigger) => opened.push([mode, trigger]),
    },
  };
  ctx.window = ctx;

  vm.runInNewContext(HTML_JS, ctx);
  if (withSaved) vm.runInNewContext(savedWith(launched), ctx);
  vm.runInNewContext(fragment(block), ctx);

  return {
    doc,
    ctx,
    root,
    server,
    calls,
    toasts,
    opened,
    errors,
    cards: () => drawn,
    markup: () => seen.join(""),
    writes: () => calls.filter((c) => c.method !== "GET"),
    lists: () => calls.filter((c) => c.method === "GET"),
    saves: () => doc.querySelectorAll(".card-save-btn"),
    save: (i) => drawn[i].article.querySelector(".card-save-btn"),
    label: (i) => drawn[i].article.querySelector(".card-save-btn span").textContent,
    // What render() does on a filter change: new cards in place of the old,
    // then drawCardSaves().
    rerender: (next) => {
      root.children.slice().forEach((c) => root.removeChild(c));
      drawn = next.map((c) => addCard(doc, root, c, seen));
      ctx.drawCardSaves();
    },
    savedStatus: () => {
      const region = doc.querySelector("[data-saved-status]");
      return region ? region.textContent : null;
    },
  };
}

test("cards, dormant (LAUNCHED false): no Save button; the grid exactly as before; no account request", async () => {
  const before = shape(loadGrid({ withSaved: false, block: "" }).doc.body);
  for (const withSaved of [true, false]) {
    const g = loadGrid({ launched: false, withSaved });
    await settle(10);
    assert.deepStrictEqual(shape(g.doc.body), before, "the page is untouched");
    assert.deepStrictEqual(g.saves(), []);
    assert.deepStrictEqual(g.doc.querySelectorAll("[data-save-kind]"), []);
    assert.strictEqual(g.markup(), "", "nothing drawn");
    assert.deepStrictEqual(g.calls, [], "no account request");
    assert.deepStrictEqual(g.opened, []);
    assert.deepStrictEqual(g.toasts, []);
    assert.deepStrictEqual(g.errors, []);
  }
});

test("cards, launched: every /guides card ends in one Save button — kind, id, name, 'Save <title>' — beside its link, and one list request paints them all", async () => {
  const plain = loadGrid({ withSaved: false, block: "" });
  const g = loadGrid({ server: fakeServer({ saved: [["guide", CARDS[1][0]], ["color", "c001"]] }) });
  await settle(10);
  assert.strictEqual(g.saves().length, CARDS.length, "one per card");
  g.cards().forEach(({ article, link }, i) => {
    const [id, title] = CARDS[i];
    const save = g.save(i);
    assert.deepStrictEqual(
      [
        save.tagName,
        save.getAttribute("type"),
        save.getAttribute("class"),
        save.getAttribute("data-save-kind"),
        save.getAttribute("data-save-id"),
        save.getAttribute("data-save-name"),
        save.getAttribute("aria-label"),
      ],
      ["BUTTON", "button", "card-save-btn", "guide", id, title, `Save ${title}`],
    );
    assert.strictEqual(save.parentNode, article, "a child of the card");
    assert.strictEqual(article.children[article.children.length - 1], save, "at its end, after the link");
    assert.strictEqual(link.contains(save), false, "not inside the link");
    assert.deepStrictEqual(
      article.children.slice(0, -1).map(shape),
      plain.cards()[i].article.children.map(shape),
      "the rest of the card is as cardHtml() drew it",
    );
    const icon = save.querySelector("svg");
    assert.strictEqual(icon.getAttribute("aria-hidden"), "true");
    assert.strictEqual(icon.getAttribute("focusable"), "false");
    assert.deepStrictEqual(save.children.map((c) => c.tagName), ["SVG", "SPAN"]);
    assert.strictEqual(save.querySelector("span").hasAttribute("data-save-label"), true, "saved.js writes Save / Saved here");
    assert.strictEqual(save.getAttribute("aria-pressed"), i === 1 ? "true" : "false", "the account's guide");
    assert.strictEqual(g.label(i), i === 1 ? "Saved" : "Save");
  });
  assert.deepStrictEqual(g.lists().map((c) => c.url), ["/api/saved?kind=guide"]);
  assert.deepStrictEqual(g.writes(), []);
  assert.deepStrictEqual(g.errors, []);
});

test("cards, launched and signed in: a Save click saves that guide and never follows the card's link; a second removes it; the link is still followed", async () => {
  const g = loadGrid();
  await settle(10);
  const [id, title] = CARDS[0];
  const { link } = g.cards()[0];
  const save = g.save(0);

  const follow = fire(g.doc, link, "click");
  assert.strictEqual(follow.defaultPrevented, false, "the card's link is left to the browser");
  await settle(10);
  assert.deepStrictEqual(g.writes(), [], "following a card saves nothing");
  assert.deepStrictEqual(g.opened, []);

  // On the icon, as a pointer usually lands.
  const evt = fire(g.doc, save.querySelector("path"), "click");
  assert.strictEqual(evt.defaultPrevented, true, "the Save's own click is saved.js's");
  await settle(10);
  assert.deepStrictEqual(g.writes().map((c) => [c.method, c.url, c.body]), [["POST", "/api/saved", { kind: "guide", id }]]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "true");
  assert.strictEqual(g.label(0), "Saved");
  assert.strictEqual(save.getAttribute("aria-label"), `Save ${title}`, "a toggle keeps its name");
  assert.deepStrictEqual([g.save(1), g.save(2)].map((b) => b.getAttribute("aria-pressed")), ["false", "false"], "only that card");
  assert.deepStrictEqual(g.server.rows, [{ kind: "guide", id }]);
  await wait(80);
  assert.strictEqual(g.savedStatus(), `${title} saved to your account`);

  fire(g.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(g.writes().map((c) => [c.method, c.url]), [
    ["POST", "/api/saved"],
    ["DELETE", `/api/saved?kind=guide&id=${id}`],
  ]);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
  assert.strictEqual(g.label(0), "Save");
  assert.deepStrictEqual(g.server.rows, []);
  assert.deepStrictEqual(g.toasts, []);
  assert.strictEqual(g.lists().length, 1);
});

test("cards, launched and signed out: the Save is drawn and opens the sign-in dialog — no request", async () => {
  const g = loadGrid({ session: SIGNED_OUT });
  await settle(10);
  assert.strictEqual(g.saves().length, CARDS.length, "drawn for signed-out visitors too");
  const save = g.save(2);
  fire(g.doc, save, "click");
  await settle(10);
  assert.deepStrictEqual(g.opened.map(([mode, trigger]) => [mode, trigger === save]), [["signin", true]]);
  assert.deepStrictEqual(g.calls, []);
  assert.strictEqual(save.getAttribute("aria-pressed"), "false");
});

test("cards, launched: drawing again adds nothing to a card that has its Save; the cards render() puts in their place get theirs, painted at once and without asking again", async () => {
  const g = loadGrid({ server: fakeServer({ saved: [["guide", CARDS[2][0]]] }) });
  await settle(10);
  const first = g.saves();
  g.ctx.drawCardSaves();
  assert.deepStrictEqual(g.saves(), first, "the same buttons: one per card");

  // A filter leaving two cards, the saved one among them.
  g.rerender([CARD_LINKS[2], CARD_LINKS[0]]);
  assert.strictEqual(g.saves().length, 2);
  assert.ok(!first.includes(g.save(0)), "new cards, new buttons");
  assert.deepStrictEqual([g.save(0), g.save(1)].map((b) => b.getAttribute("data-save-id")), [CARDS[2][0], CARDS[0][0]]);
  assert.deepStrictEqual([g.save(0), g.save(1)].map((b) => b.getAttribute("aria-pressed")), ["true", "false"], "painted from what is known");
  assert.deepStrictEqual([g.label(0), g.label(1)], ["Saved", "Save"]);
  await settle(10);
  assert.strictEqual(g.lists().length, 1, "the list is read once, however often the grid is redrawn");

  // No match at all: an empty grid, and nothing to draw.
  g.rerender([]);
  assert.deepStrictEqual(g.saves(), []);
  assert.deepStrictEqual(g.errors, []);
});

test("cards, launched: odd cards — no link, a link that isn't a guide's, an id Saved wouldn't accept — get no Save; a grid that isn't /guides' gets none at all", async () => {
  const odd = [
    [null, "No link"],
    ["/palettes/", "Color Palettes"],
    ["/guide/", "No id"],
    ["/guide/Color_Contrast", "Not a slug"],
    ["/guide/color-contrast-systems/extra", "Deeper"],
    ["/guide/color-contrast-systems?x=1", "With a query"],
    [`/guide/${"a".repeat(101)}`, "Too long"],
    ['/guide/x"><img src=x>', "Markup"],
  ];
  const plain = loadGrid({ withSaved: false, block: "", cards: [...odd, CARD_LINKS[0]] });
  const g = loadGrid({ cards: [...odd, CARD_LINKS[0]] });
  await settle(10);
  assert.strictEqual(g.saves().length, 1, "only the real guide card");
  assert.strictEqual(g.save(odd.length).getAttribute("data-save-id"), ID);
  odd.forEach(([href], i) => {
    assert.deepStrictEqual(shape(g.cards()[i].article), shape(plain.cards()[i].article), `${href}: card untouched`);
  });
  assert.deepStrictEqual(g.errors, []);

  // The home, category and related-guides grids are not #grid-root.
  const elsewhere = loadGrid({ grid: false });
  await settle(10);
  assert.deepStrictEqual(elsewhere.saves(), []);
  assert.strictEqual(elsewhere.markup(), "");
  assert.deepStrictEqual(elsewhere.calls, []);
  assert.deepStrictEqual(elsewhere.errors, []);

  // A title with no text only drops the name.
  const untitled = loadGrid({ cards: [[`/guide/${ID}`, "  \n "]] });
  await settle(10);
  assert.strictEqual(untitled.save(0).hasAttribute("data-save-name"), false);
  assert.strictEqual(untitled.save(0).getAttribute("aria-label"), "Save this guide");
});

test("cards, launched: a title reaches data-save-name and aria-label escaped, each as one attribute, and never as markup", async () => {
  const tricky = `Say "hi" <b>Bold</b> & It's`;
  const g = loadGrid({ cards: [[`/guide/${ID}`, `\n  ${tricky}\n`]] });
  await settle(10);
  const save = g.save(0);
  assert.strictEqual(save.getAttribute("data-save-name"), tricky);
  assert.strictEqual(save.getAttribute("aria-label"), `Save ${tricky}`);
  assert.deepStrictEqual(parsedAttrs.get(save), [
    "type",
    "class",
    "data-save-kind",
    "data-save-id",
    "data-save-name",
    "aria-pressed",
    "aria-label",
  ]);
  assert.deepStrictEqual(save.children.map((c) => c.tagName), ["SVG", "SPAN"], "no markup from the title");
  const escaped = "Say &quot;hi&quot; &lt;b&gt;Bold&lt;/b&gt; &amp; It&#39;s";
  assert.ok(g.markup().includes(`data-save-name="${escaped}"`));
  assert.ok(g.markup().includes(`aria-label="Save ${escaped}"`));
});

test("cards: guides.js draws the Save at boot and after every render(); the shared card renderer and the /guides page itself carry none", () => {
  assert.ok(GUIDES_JS.includes('gridRoot.innerHTML = cards.join("");\n    drawCardSaves();'), "render() redraws it on the cards it replaces");
  assert.strictEqual(GUIDES_JS.split("drawCardSaves();").length - 1, 2, "render() and the boot call, nothing else");
  const bootBlock = GUIDES_JS.slice(GUIDES_JS.indexOf("  if (hasGuideGrid) {"), CARDS_START);
  assert.ok(bootBlock.includes("\n    drawCardSaves();\n  }\n"), "the boot call is inside the /guides-only block");
  assert.ok(!fs.readFileSync(path.join(ROOT, "src", "shared", "card.js"), "utf8").includes("card-save-btn"));

  // Every build-time card on /guides has the link drawCardSaves reads.
  const guides = JSON.parse(fs.readFileSync(path.join(ROOT, "guides.json"), "utf8"));
  const page = fs.readFileSync(path.join(ROOT, "guides", "index.html"), "utf8");
  assert.strictEqual(page.split('id="grid-root"').length - 1, 1);
  const grid = page.slice(page.indexOf("<!--GUIDES_GRID_START-->"), page.indexOf("<!--GUIDES_GRID_END-->"));
  const ids = [...grid.matchAll(/<a class="card-link" href="\/guide\/([^"/?#]+)">/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids.slice().sort(), guides.map((g) => g.id).sort());
  assert.strictEqual(grid.split('class="content-card"').length - 1, guides.length, "one card each");
  assert.ok(!page.includes("card-save-btn"), "no Save in the page itself");
});
