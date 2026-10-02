/**
 * roadmap.test.js — Learning Roadmap progress: src/client/roadmap.js on
 * roadmap.html and on the guide pages.
 *
 * roadmap.js is a fragment of /app.js, not a module (see core.js's header),
 * so there is nothing to require. The whole file is run the way /app.js runs
 * it — inside the bundle's own wrapper, with core.js's showToast in scope —
 * in a vm against src/client/test-dom.js.
 *
 * The pages are not hand-written copies. The roadmap page is the committed
 * roadmap.html template with the build's own markup (src/build/home.js)
 * spliced into it, so the hooks the script reads are the ones the build
 * writes. A guide page is the roadmap strip and the previous/next links
 * lifted out of the committed guide/<id>.html, with that page's own
 * <body data-guide-id>, so an off-roadmap guide is one that really has
 * neither.
 *
 * Nothing here signs in or calls a server: roadmap progress is this
 * browser's localStorage only (point-roadmap-progress), and no test reads
 * or writes anything else.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { makeDocument, fire, makeStorage } = require("./test-dom.js");

const ROOT = path.join(__dirname, "..", "..");
const config = require(path.join(ROOT, "site.config.js"));
const build = require(path.join(ROOT, "src", "build", "build.js"));
const content = require(path.join(ROOT, "src", "build", "content.js"));
const home = require(path.join(ROOT, "src", "build", "home.js"));

const ROADMAP_JS = fs.readFileSync(path.join(__dirname, "roadmap.js"), "utf8");
const KEY = "point-roadmap-progress";

// The fragment as /app.js holds it, after the one thing of core.js's it uses.
const FRAGMENT =
  build.APP_BUNDLE.wrapper.open +
  "  var showToast = window.__showToast;\n" +
  ROADMAP_JS +
  build.APP_BUNDLE.wrapper.close;

const model = content.load(config);
const built = home.buildRoadmap(model.guides);

// ---------------------------------------------------------------------
// local stand-ins for what roadmap.js uses and test-dom.js (shared, left
// as it is) doesn't have: markup parsing, classList, checked,
// insertAdjacentHTML
// ---------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);
const VOID = new Set(["input"]);

/**
 * Parses markup into test-dom elements under `parent`: tags, double-quoted
 * or valueless attributes, "/>", text, comments (dropped) and the five
 * entities escapeHtml writes. It throws on anything else, so markup this
 * can't read fails a test instead of being skipped.
 */
function parseInto(doc, parent, html) {
  const TOKEN = /<!--[\s\S]*?-->|<\/([a-z0-9]+)>|<([a-z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/y;
  const stack = [parent];
  let at = 0;
  while (at < html.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(html);
    if (!m) throw new Error(`unexpected markup: ${html.slice(at, at + 60)}`);
    at = TOKEN.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1]) {
      if (stack.length < 2 || top.tagName !== m[1].toUpperCase()) throw new Error(`unbalanced </${m[1]}>`);
      stack.pop();
    } else if (m[2]) {
      const node = doc.createElement(m[2]);
      for (const [, name, , value] of m[3].matchAll(/\s+([a-zA-Z-]+)(="([^"]*)")?/g)) {
        if (node.hasAttribute(name)) throw new Error(`attribute ${name} given twice`);
        node.setAttribute(name, value === undefined ? "" : decode(value));
      }
      top.appendChild(node);
      if (!m[4] && !VOID.has(m[2])) stack.push(node);
    } else if (m[5] !== undefined) {
      top.appendChild(doc.createTextNode(decode(m[5])));
    }
  }
  if (stack.length !== 1) throw new Error("unclosed element");
}

/** A document whose elements also have classList, checked and insertAdjacentHTML. */
function makePage() {
  const doc = makeDocument();
  const proto = Object.getPrototypeOf(doc.createElement("div"));
  const focusCalls = [];

  Object.defineProperty(proto, "classList", {
    get() {
      const el = this;
      const list = () => el.className.split(/\s+/).filter(Boolean);
      const set = (classes) => (classes.length ? el.setAttribute("class", classes.join(" ")) : el.removeAttribute("class"));
      return {
        contains: (name) => list().includes(name),
        toggle(name, on) {
          const has = list().includes(name);
          const want = on === undefined ? !has : !!on;
          if (want && !has) set(list().concat(name));
          if (!want && has) set(list().filter((c) => c !== name));
          return want;
        },
      };
    },
  });
  Object.defineProperty(proto, "checked", {
    get() { return this._checked === true; },
    set(v) { this._checked = !!v; },
  });
  proto.insertAdjacentHTML = function (where, html) {
    const holder = doc.createElement("div");
    parseInto(doc, holder, html);
    const nodes = holder.children.slice();
    if (where === "beforeend") {
      nodes.forEach((n) => this.appendChild(n));
    } else if (where === "beforebegin") {
      const parent = this.parentNode;
      nodes.forEach((n) => {
        holder.removeChild(n);
        parent.children.splice(parent.children.indexOf(this), 0, n);
        n.parentNode = parent;
      });
    } else {
      throw new Error(`unexpected position: ${where}`);
    }
  };
  // focus() still works (test-dom's own); every call is counted.
  const focus = proto.focus;
  proto.focus = function () {
    focusCalls.push(this);
    return focus.call(this);
  };

  return { doc, focusCalls };
}

function el(doc, parent, tag, attrs = {}, text = null) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== null) node.appendChild(doc.createTextNode(text));
  return parent.appendChild(node);
}

// ---------------------------------------------------------------------
// the pages
// ---------------------------------------------------------------------

/** roadmap.html's progress block and stage list, as the build writes them. */
function roadmapMarkup() {
  let html = fs.readFileSync(path.join(ROOT, "roadmap.html"), "utf8");
  html = home.replaceBetween(html, "<!--ROADMAP_STAGES_START-->", "<!--ROADMAP_STAGES_END-->", built.stagesHtml, "roadmap.html");
  html = home.replaceBetween(html, "<!--ROADMAP_CONTINUE_START-->", "<!--ROADMAP_CONTINUE_END-->", built.continueHtml, "roadmap.html");
  const from = html.indexOf('<div class="roadmap-progress" id="roadmap-progress">');
  const trackAt = html.indexOf('<ol class="roadmap-track">');
  const to = html.indexOf("</ol>", trackAt) + "</ol>".length;
  assert.ok(from !== -1 && trackAt > from && to > trackAt, "roadmap.html no longer has the progress block followed by the track");
  return html.slice(from, to);
}
const ROADMAP_MARKUP = roadmapMarkup();

function roadmapPage() {
  const page = makePage();
  const { doc } = page;
  const section = el(doc, doc.body, "section", { class: "roadmap-section roadmap-section--page", id: "roadmap" });
  parseInto(doc, el(doc, section, "div", { class: "wrap" }), ROADMAP_MARKUP);
  el(doc, doc.body, "div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" });
  return page;
}

/** What roadmap.js reads off a committed guide page. */
function guideSource(id) {
  const html = fs.readFileSync(path.join(ROOT, "guide", id + ".html"), "utf8");
  const body = /<body\b([^>]*)>/.exec(html);
  assert.ok(body, id + ": no <body>");
  const attr = /data-guide-id="([^"]+)"/.exec(body[1]);
  const block = (open) => {
    const m = new RegExp("<nav class=\"" + open + "\"[\\s\\S]*?</nav>").exec(html);
    return m ? m[0] : null;
  };
  return {
    id: attr ? attr[1] : null,
    strip: block("guide-roadmap"),
    order: block("guide-footer-nav"),
    toast: html.includes('id="toast"'),
  };
}

function guidePage(id) {
  const source = guideSource(id);
  const page = makePage();
  const { doc } = page;
  if (source.id !== null) doc.body.setAttribute("data-guide-id", source.id);
  const main = el(doc, doc.body, "main", { class: "wrap", id: "guide-content" });
  const primary = el(doc, el(doc, main, "div", { class: "guide-layout" }), "div", { class: "guide-primary" });
  el(doc, el(doc, primary, "section", { class: "guide-hero" }), "h1", { class: "guide-hero__title" }, "A guide");
  if (source.strip) parseInto(doc, primary, source.strip);
  el(doc, primary, "nav", { class: "guide-toc" });
  const article = el(doc, primary, "article", { class: "guide-article" });
  el(doc, el(doc, article, "p"), "a", { href: "/guide/type-scale-systems" }, "type scale");
  if (source.order) parseInto(doc, primary, source.order);
  el(doc, main, "aside", { class: "guide-rail", id: "guide-rail" });
  if (source.toast) el(doc, doc.body, "div", { class: "toast", id: "toast", role: "status", "aria-live": "polite" });
  return Object.assign(page, { source, primary });
}

/** A page with no roadmap markup at all, such as /guides or /about. */
function plainPage() {
  const page = makePage();
  el(page.doc, page.doc.body, "main", { class: "wrap" });
  el(page.doc, page.doc.body, "div", { class: "toast", id: "toast" });
  return page;
}

// ---------------------------------------------------------------------
// storage and running the script
// ---------------------------------------------------------------------

/** One browser's localStorage. `value` is the raw stored string, if any. */
function makeStore({ value, throws = false } = {}) {
  const log = [];
  const local = makeStorage("localStorage", log, { initial: value === undefined ? {} : { [KEY]: value }, throws });
  return {
    local,
    log,
    raw: () => local.dump()[KEY],
    ids: () => JSON.parse(local.dump()[KEY]),
    /** A change made by another tab: straight into storage, behind this page's back. */
    setElsewhere: (ids) => local.setItem(KEY, JSON.stringify(ids)),
    writes: () => log.filter(([, op]) => op === "set" || op === "remove").length,
  };
}

/**
 * Runs roadmap.js on `page`.
 *
 *   store          a makeStore(); a fresh empty one by default
 *   accessThrows   reading window.localStorage itself throws
 *   toast          "throws": showToast throws, as core.js's does on a page
 *                  with no #toast
 */
function run(page, { store = makeStore(), accessThrows = false, toast = null } = {}) {
  const toasts = [];
  const scrolls = [];
  const windowListeners = {};
  const ctx = {
    console,
    document: page.doc,
    addEventListener: (type, fn) => (windowListeners[type] ||= []).push(fn),
    scrollTo: (...args) => scrolls.push(args),
    scrollBy: (...args) => scrolls.push(args),
    __showToast: (message) => {
      if (toast === "throws") throw new Error("showToast was called");
      toasts.push(message);
    },
  };
  Object.defineProperty(ctx, "localStorage", {
    get() {
      if (accessThrows) throw new Error("SecurityError: storage is not available");
      return store.local;
    },
  });
  ctx.window = ctx;
  vm.runInNewContext(FRAGMENT, ctx);

  const { doc } = page;
  const all = (selector) => doc.querySelectorAll(selector);
  const stateOf = (step) => step.querySelector(".roadmap-step-state").textContent;
  return Object.assign(page, {
    store,
    toasts,
    scrolls,
    windowListeners,
    /** Dispatches a window event to the script's listeners. */
    win: (type, event) => (windowListeners[type] || []).forEach((fn) => fn(event)),
    steps: () => all(".roadmap-step"),
    stepOf: (id) => all(".roadmap-step").find((s) => s.querySelector(".roadmap-step-checkbox").getAttribute("data-roadmap-id") === id),
    boxOf: (id) => all(".roadmap-step-checkbox").find((cb) => cb.getAttribute("data-roadmap-id") === id),
    /** Each step as [id, "read" | "next" | "upcoming"], in page order. */
    states: () =>
      all(".roadmap-step").map((step) => {
        const cb = step.querySelector(".roadmap-step-checkbox");
        const link = step.querySelector(".roadmap-step-link");
        const read = step.classList.contains("is-complete");
        const next = step.classList.contains("is-next");
        // The four signals of a state always agree.
        assert.strictEqual(cb.checked, read, "checkbox and is-complete disagree");
        assert.strictEqual(link.getAttribute("aria-current"), next ? "step" : null, "aria-current and is-next disagree");
        assert.strictEqual(stateOf(step), read ? "Read" : next ? "Next up" : "", "state text disagrees");
        assert.ok(!(read && next), "a step is both Read and Next up");
        return [cb.getAttribute("data-roadmap-id"), read ? "read" : next ? "next" : "upcoming"];
      }),
    stageCounts: () => all(".roadmap-stage").map((s) => s.querySelector(".roadmap-stage-count").textContent),
    stagesComplete: () => all(".roadmap-stage").map((s) => s.classList.contains("is-complete")),
    label: () => doc.getElementById("roadmap-progress-label").textContent,
    fill: () => doc.getElementById("roadmap-progress-fill").style.width,
    cont: () => doc.getElementById("roadmap-continue"),
    status: () => doc.getElementById("roadmap-status"),
    reset: () => doc.getElementById("roadmap-reset"),
    /** Checks or unchecks a guide the way a click on its checkbox does. */
    toggle(id, checked) {
      const cb = this.boxOf(id);
      cb.checked = checked;
      fire(doc, cb, "change");
      return cb;
    },
    // the guide page's parts
    block: () => doc.querySelector(".guide-complete"),
    button: () => doc.querySelector(".guide-complete__btn"),
    blockState: () => doc.querySelector(".guide-complete__state"),
    stripState: () => doc.querySelector(".guide-roadmap__state"),
    guideStatus: () => doc.querySelector(".guide-complete__status"),
  });
}

// The roadmap's guides in the page's own order, and its stages' sizes.
const ORDER = [...built.stagesHtml.matchAll(/data-roadmap-id="([^"]+)"/g)].map((m) => m[1]);
const STAGE_SIZES = built.stagesHtml.split('<li class="roadmap-stage"').slice(1).map((s) => (s.match(/data-roadmap-id=/g) || []).length);
const TITLE = new Map(model.guides.map((g) => [g.id, g.title]));
const TOTAL = ORDER.length;
const stageIds = (n) => ORDER.slice(STAGE_SIZES.slice(0, n).reduce((a, b) => a + b, 0)).slice(0, STAGE_SIZES[n]);
const json = (ids) => JSON.stringify(ids);

const ON_ROADMAP = "color-contrast-systems";
const OFF_ROADMAP = ["css-grid-two-dimensional-system", "migrating-from-xd-rebuild"];
const NO_TOAST = ["thumb-zones-layout-constraint", "ios-android-different-systems", "mobile-breakpoints-device-categories"];

test("the fixtures are the real roadmap: 20 guides in 4 stages, in the build's order", () => {
  assert.strictEqual(TOTAL, 20);
  assert.deepStrictEqual(STAGE_SIZES, [4, 4, 9, 3]);
  assert.strictEqual(new Set(ORDER).size, TOTAL, "a guide is listed twice");
  const p = run(roadmapPage());
  assert.deepStrictEqual(p.states().map(([id]) => id), ORDER);
});

// ---------------------------------------------------------------------
// roadmap.html: states
// ---------------------------------------------------------------------

test("empty storage: the first guide is Next up, the rest are Upcoming, nothing is Read", () => {
  const p = run(roadmapPage());
  assert.deepStrictEqual(
    p.states(),
    ORDER.map((id, i) => [id, i === 0 ? "next" : "upcoming"]),
  );
  assert.deepStrictEqual(p.stageCounts(), ["0 of 4 read", "0 of 4 read", "0 of 9 read", "0 of 3 read"]);
  assert.deepStrictEqual(p.stagesComplete(), [false, false, false, false]);
  assert.match(p.label(), /^Check off a guide once you've read it/);
  assert.strictEqual(p.fill(), "0%");
  assert.strictEqual(p.reset().hidden, true);
  assert.strictEqual(p.status().textContent, "", "nothing is announced on load");
  assert.strictEqual(p.store.writes(), 0, "loading the page writes nothing");
  assert.deepStrictEqual(p.toasts, []);
});

test("empty storage paints exactly what the build already wrote", () => {
  const before = roadmapPage();
  const classesBefore = before.doc.querySelectorAll(".roadmap-step").map((s) => s.className);
  const currentBefore = before.doc.querySelectorAll(".roadmap-step-link").map((a) => a.getAttribute("aria-current"));
  const textBefore = before.doc.querySelectorAll(".roadmap-step-state").map((s) => s.textContent);
  const continueBefore = [before.doc.getElementById("roadmap-continue").getAttribute("href"), before.doc.getElementById("roadmap-continue").textContent];

  const p = run(roadmapPage());
  assert.deepStrictEqual(p.steps().map((s) => s.className), classesBefore);
  assert.deepStrictEqual(p.doc.querySelectorAll(".roadmap-step-link").map((a) => a.getAttribute("aria-current")), currentBefore);
  assert.deepStrictEqual(p.doc.querySelectorAll(".roadmap-step-state").map((s) => s.textContent), textBefore);
  assert.deepStrictEqual([p.cont().getAttribute("href"), p.cont().textContent], continueBefore);
});

test("Read: a stored id marks its guide Read, and the first unread guide after is Next up", () => {
  const read = ORDER.slice(0, 3);
  const p = run(roadmapPage(), { store: makeStore({ value: json(read) }) });
  assert.deepStrictEqual(
    p.states(),
    ORDER.map((id, i) => [id, i < 3 ? "read" : i === 3 ? "next" : "upcoming"]),
  );
  assert.strictEqual(p.label(), "3 of 20 guides marked complete.");
  assert.strictEqual(p.fill(), "15%");
  assert.strictEqual(p.reset().hidden, false);
  assert.strictEqual(p.status().textContent, "", "restoring progress announces nothing");
  assert.strictEqual(p.store.writes(), 0);
});

test("Next up is the first unread guide in page order, whatever was read after it", () => {
  // Guides 1, 2 and 6 read: the next one up is guide 3, not guide 7.
  const p = run(roadmapPage(), { store: makeStore({ value: json([ORDER[5], ORDER[0], ORDER[1]]) }) });
  const states = p.states();
  assert.deepStrictEqual(states.filter(([, s]) => s === "next"), [[ORDER[2], "next"]]);
  assert.deepStrictEqual(states.filter(([, s]) => s === "read").map(([id]) => id), [ORDER[0], ORDER[1], ORDER[5]]);
  assert.strictEqual(states.filter(([, s]) => s === "upcoming").length, TOTAL - 4);
});

test("Upcoming: an unread guide after Next up has no class, no state text and no aria-current", () => {
  const p = run(roadmapPage(), { store: makeStore({ value: json([ORDER[0]]) }) });
  const upcoming = p.stepOf(ORDER[5]);
  assert.strictEqual(upcoming.className, "roadmap-step");
  assert.strictEqual(upcoming.querySelector(".roadmap-step-state").textContent, "");
  assert.strictEqual(upcoming.querySelector(".roadmap-step-link").hasAttribute("aria-current"), false);
  assert.strictEqual(upcoming.querySelector(".roadmap-step-checkbox").checked, false);
});

test("stage counts: each stage says how many of its own guides are read", () => {
  const read = [...stageIds(0).slice(0, 2), ...stageIds(2).slice(0, 5), stageIds(3)[2]];
  const p = run(roadmapPage(), { store: makeStore({ value: json(read) }) });
  assert.deepStrictEqual(p.stageCounts(), ["2 of 4 read", "0 of 4 read", "5 of 9 read", "1 of 3 read"]);
  assert.deepStrictEqual(p.stagesComplete(), [false, false, false, false]);
});

test("stage completion: said in words, set and cleared with the stage's last guide", () => {
  const p = run(roadmapPage(), { store: makeStore({ value: json(stageIds(0).slice(0, 3)) }) });
  assert.deepStrictEqual(p.stagesComplete(), [false, false, false, false]);

  p.toggle(stageIds(0)[3], true);
  assert.deepStrictEqual(p.stageCounts(), ["4 of 4 read · Complete", "0 of 4 read", "0 of 9 read", "0 of 3 read"]);
  assert.deepStrictEqual(p.stagesComplete(), [true, false, false, false]);
  // Next up moves into the next stage.
  assert.deepStrictEqual(p.states().filter(([, s]) => s === "next"), [[stageIds(1)[0], "next"]]);

  p.toggle(stageIds(0)[1], false);
  assert.deepStrictEqual(p.stageCounts()[0], "3 of 4 read");
  assert.deepStrictEqual(p.stagesComplete(), [false, false, false, false]);
  assert.deepStrictEqual(p.states().filter(([, s]) => s === "next"), [[stageIds(0)[1], "next"]]);
});

test("a later stage can be complete while an earlier one isn't", () => {
  const p = run(roadmapPage(), { store: makeStore({ value: json(stageIds(3)) }) });
  assert.deepStrictEqual(p.stagesComplete(), [false, false, false, true]);
  assert.strictEqual(p.stageCounts()[3], "3 of 3 read · Complete");
  assert.deepStrictEqual(p.states().filter(([, s]) => s === "next"), [[ORDER[0], "next"]]);
});

test("Continue: a real link to the Next up guide, by that guide's own href and title", () => {
  const fresh = run(roadmapPage());
  assert.strictEqual(fresh.cont().tagName, "A");
  assert.strictEqual(fresh.cont().getAttribute("href"), "/guide/" + ORDER[0]);
  assert.strictEqual(fresh.cont().textContent, "Continue: " + TITLE.get(ORDER[0]));
  assert.strictEqual(fresh.cont().hidden, false);

  const p = run(roadmapPage(), { store: makeStore({ value: json(ORDER.slice(0, 6)) }) });
  assert.strictEqual(p.cont().getAttribute("href"), "/guide/" + ORDER[6]);
  assert.strictEqual(p.cont().textContent, "Continue: " + TITLE.get(ORDER[6]));
  assert.strictEqual(p.cont().getAttribute("href"), p.stepOf(ORDER[6]).querySelector(".roadmap-step-link").getAttribute("href"));

  // It follows every change: the same wording, a different guide.
  p.toggle(ORDER[6], true);
  assert.strictEqual(p.cont().textContent, "Continue: " + TITLE.get(ORDER[7]));
  p.toggle(ORDER[2], false);
  assert.strictEqual(p.cont().getAttribute("href"), "/guide/" + ORDER[2]);
  assert.match(p.cont().textContent, /^Continue: /);
  assert.strictEqual(p.cont().hasAttribute("aria-current"), false);
});

test("all 20 read: no Next up, Continue hidden, every stage complete", () => {
  const p = run(roadmapPage(), { store: makeStore({ value: json(ORDER) }) });
  assert.deepStrictEqual(p.states(), ORDER.map((id) => [id, "read"]));
  assert.strictEqual(p.doc.querySelectorAll('[aria-current="step"]').length, 0);
  assert.strictEqual(p.doc.querySelectorAll(".is-next").length, 0);
  assert.strictEqual(p.cont().hidden, true);
  assert.deepStrictEqual(p.stagesComplete(), [true, true, true, true]);
  assert.deepStrictEqual(p.stageCounts(), ["4 of 4 read · Complete", "4 of 4 read · Complete", "9 of 9 read · Complete", "3 of 3 read · Complete"]);
  assert.strictEqual(p.label(), "All 20 guides marked complete. Nice work.");
  assert.strictEqual(p.fill(), "100%");

  // Unmarking one brings Continue back, for that guide.
  p.toggle(ORDER[11], false);
  assert.strictEqual(p.cont().hidden, false);
  assert.strictEqual(p.cont().getAttribute("href"), "/guide/" + ORDER[11]);
  assert.deepStrictEqual(p.states().filter(([, s]) => s === "next"), [[ORDER[11], "next"]]);
});

test("there is exactly one Next up while any guide is unread", () => {
  const p = run(roadmapPage());
  ORDER.forEach((id, i) => {
    const next = p.states().filter(([, s]) => s === "next");
    assert.deepStrictEqual(next, [[id, "next"]], `after ${i} guides`);
    assert.strictEqual(p.doc.querySelectorAll('[aria-current="step"]').length, 1);
    p.toggle(id, true);
  });
  assert.strictEqual(p.states().filter(([, s]) => s === "next").length, 0);
});

// ---------------------------------------------------------------------
// roadmap.html: marking, storage
// ---------------------------------------------------------------------

test("mark read: stored as a plain array of ids, said once, focus left on the checkbox", () => {
  const p = run(roadmapPage());
  const cb = p.boxOf(ORDER[0]);
  cb.focus();
  p.focusCalls.length = 0;

  p.toggle(ORDER[0], true);
  assert.strictEqual(p.store.raw(), json([ORDER[0]]));
  assert.strictEqual(p.status().textContent, "Marked as read. 1 of 20 guides read.");
  assert.strictEqual(p.label(), "1 of 20 guides marked complete.");
  assert.strictEqual(p.doc.activeElement, cb);
  assert.deepStrictEqual(p.focusCalls, [], "nothing calls focus()");
  assert.deepStrictEqual(p.toasts, [], "no toast");
  assert.deepStrictEqual(p.scrolls, [], "no scrolling");
  assert.strictEqual(p.store.writes(), 1, "one write per change");
});

test("mark unread: the id leaves storage, and that is said once", () => {
  const p = run(roadmapPage(), { store: makeStore({ value: json([ORDER[0], ORDER[1]]) }) });
  const cb = p.toggle(ORDER[0], false);
  assert.strictEqual(p.store.raw(), json([ORDER[1]]));
  assert.strictEqual(p.status().textContent, "Marked as unread. 1 of 20 guides read.");
  assert.strictEqual(cb.checked, false);
  assert.deepStrictEqual(p.states().slice(0, 3), [[ORDER[0], "next"], [ORDER[1], "read"], [ORDER[2], "upcoming"]]);
  assert.deepStrictEqual(p.toasts, []);
});

test("marking a guide that is already stored doesn't store it twice", () => {
  const store = makeStore({ value: json([ORDER[0]]) });
  const p = run(roadmapPage(), { store });
  p.toggle(ORDER[0], true);
  assert.strictEqual(store.raw(), json([ORDER[0]]));
});

test("storage persistence: a later page load shows what an earlier one marked", () => {
  const store = makeStore();
  const first = run(roadmapPage(), { store });
  first.toggle(ORDER[0], true);
  first.toggle(ORDER[1], true);
  first.toggle(ORDER[4], true);
  assert.strictEqual(store.raw(), json([ORDER[0], ORDER[1], ORDER[4]]));
  assert.ok(Array.isArray(store.ids()) && store.ids().every((id) => typeof id === "string"), "the stored value is an array of ids");
  assert.deepStrictEqual(Object.keys(store.local.dump()), [KEY], "the only key written");

  const second = run(roadmapPage(), { store });
  assert.deepStrictEqual(second.states().filter(([, s]) => s !== "upcoming"), [[ORDER[0], "read"], [ORDER[1], "read"], [ORDER[2], "next"], [ORDER[4], "read"]]);
  assert.strictEqual(second.label(), "3 of 20 guides marked complete.");
});

test("an existing reader's stored array is read as it is", () => {
  // What the previous roadmap.js wrote: ids in the order they were checked.
  const stored = json(["type-scale-systems", "whitespace-as-ui-component"]);
  const store = makeStore({ value: stored });
  const p = run(roadmapPage(), { store });
  assert.strictEqual(p.stepOf("type-scale-systems").classList.contains("is-complete"), true);
  assert.strictEqual(p.stepOf("whitespace-as-ui-component").classList.contains("is-complete"), true);
  assert.strictEqual(p.label(), "2 of 20 guides marked complete.");
  assert.strictEqual(store.raw(), stored, "and left untouched");
});

test("malformed storage: an empty effective state, never an error", () => {
  for (const value of ["{", "{}", "null", '"whitespace-as-ui-component"', "42", "true", "", "[", "undefined"]) {
    const store = makeStore({ value });
    const p = run(roadmapPage(), { store });
    assert.deepStrictEqual(p.states(), ORDER.map((id, i) => [id, i === 0 ? "next" : "upcoming"]), `stored ${JSON.stringify(value)}`);
    assert.strictEqual(store.raw(), value, "loading doesn't rewrite it");
    // The next change replaces it with a good array.
    p.toggle(ORDER[0], true);
    assert.strictEqual(store.raw(), json([ORDER[0]]), `after a change, from ${JSON.stringify(value)}`);
  }
});

test("an array with entries that aren't ids: the strings count, the rest is ignored", () => {
  const store = makeStore({ value: JSON.stringify([1, null, { id: ORDER[1] }, [ORDER[2]], ORDER[0], true]) });
  const p = run(roadmapPage(), { store });
  assert.deepStrictEqual(p.states().slice(0, 3), [[ORDER[0], "read"], [ORDER[1], "next"], [ORDER[2], "upcoming"]]);
  assert.strictEqual(p.label(), "1 of 20 guides marked complete.");
});

test("unknown ids stay in storage and count for nothing", () => {
  const store = makeStore({ value: json(["a-retired-guide", ORDER[0], "g6"]) });
  const p = run(roadmapPage(), { store });
  assert.strictEqual(p.label(), "1 of 20 guides marked complete.");
  assert.deepStrictEqual(p.stageCounts(), ["1 of 4 read", "0 of 4 read", "0 of 9 read", "0 of 3 read"]);
  assert.deepStrictEqual(p.states().filter(([, s]) => s === "next"), [[ORDER[1], "next"]]);

  p.toggle(ORDER[1], true);
  assert.deepStrictEqual(store.ids(), ["a-retired-guide", ORDER[0], "g6", ORDER[1]]);
  p.toggle(ORDER[0], false);
  assert.deepStrictEqual(store.ids(), ["a-retired-guide", "g6", ORDER[1]]);
  assert.strictEqual(p.status().textContent, "Marked as unread. 1 of 20 guides read.");
});

test("blocked storage: every call throws, the page still works for this view", () => {
  const store = makeStore({ throws: true });
  let p;
  assert.doesNotThrow(() => (p = run(roadmapPage(), { store })));
  assert.deepStrictEqual(p.states().slice(0, 2), [[ORDER[0], "next"], [ORDER[1], "upcoming"]]);

  assert.doesNotThrow(() => p.toggle(ORDER[0], true));
  assert.doesNotThrow(() => p.toggle(ORDER[1], true));
  // Both marks hold: with storage unreadable the page keeps its own copy.
  assert.deepStrictEqual(p.states().slice(0, 3), [[ORDER[0], "read"], [ORDER[1], "read"], [ORDER[2], "next"]]);
  assert.strictEqual(p.label(), "2 of 20 guides marked complete.");
  assert.strictEqual(p.status().textContent, "Marked as read. 2 of 20 guides read.");

  assert.doesNotThrow(() => p.toggle(ORDER[0], false));
  assert.deepStrictEqual(p.states().slice(0, 2), [[ORDER[0], "next"], [ORDER[1], "read"]]);
  assert.doesNotThrow(() => fire(p.doc, p.reset(), "click"));
  assert.strictEqual(p.label().startsWith("Check off a guide"), true);
});

test("blocked storage: window.localStorage itself throws", () => {
  let p;
  assert.doesNotThrow(() => (p = run(roadmapPage(), { accessThrows: true })));
  assert.doesNotThrow(() => p.toggle(ORDER[0], true));
  assert.deepStrictEqual(p.states().slice(0, 2), [[ORDER[0], "read"], [ORDER[1], "next"]]);
  assert.doesNotThrow(() => p.win("storage", { key: KEY }));
  assert.doesNotThrow(() => p.win("pageshow", { persisted: true }));
  assert.deepStrictEqual(p.states().slice(0, 2), [[ORDER[0], "read"], [ORDER[1], "next"]], "a repaint keeps the page's own copy");
});

test("Reset: clears progress, says so in the toast only", () => {
  const store = makeStore({ value: json([ORDER[0], ORDER[1], "a-retired-guide"]) });
  const p = run(roadmapPage(), { store });
  p.toggle(ORDER[2], true);
  assert.notStrictEqual(p.status().textContent, "");

  fire(p.doc, p.reset(), "click");
  assert.strictEqual(store.raw(), "[]");
  assert.deepStrictEqual(p.toasts, ["Roadmap progress reset."]);
  assert.strictEqual(p.status().textContent, "", "the status line doesn't repeat the toast");
  assert.deepStrictEqual(p.states(), ORDER.map((id, i) => [id, i === 0 ? "next" : "upcoming"]));
  assert.strictEqual(p.reset().hidden, true);
  assert.strictEqual(p.cont().getAttribute("href"), "/guide/" + ORDER[0]);
});

// ---------------------------------------------------------------------
// other tabs, and coming back to the page
// ---------------------------------------------------------------------

/**
 * `elsewhere` is what another tab does to storage; `deliver` is the event
 * this page then gets. Asserts that the page repaints without writing
 * anything back, announcing, toasting or moving focus.
 */
function passive(p, elsewhere, deliver) {
  elsewhere();
  const writes = p.store.writes();
  const status = (p.status() || p.guideStatus()).textContent;
  const focused = p.doc.activeElement;
  p.focusCalls.length = 0;
  deliver();
  assert.strictEqual(p.store.writes(), writes, "a passive repaint writes nothing back");
  assert.strictEqual((p.status() || p.guideStatus()).textContent, status, "a passive repaint announces nothing");
  assert.deepStrictEqual(p.toasts, [], "a passive repaint shows no toast");
  assert.strictEqual(p.doc.activeElement, focused, "a passive repaint leaves focus where it is");
  assert.deepStrictEqual(p.focusCalls, []);
  assert.deepStrictEqual(p.scrolls, []);
}

test("storage event: another tab's change repaints this one, silently", () => {
  const store = makeStore();
  const p = run(roadmapPage(), { store });
  p.boxOf(ORDER[9]).focus();

  passive(
    p,
    () => store.setElsewhere([ORDER[0], ORDER[1]]),
    () => p.win("storage", { key: KEY, newValue: json([ORDER[0], ORDER[1]]) }),
  );
  assert.deepStrictEqual(p.states().slice(0, 3), [[ORDER[0], "read"], [ORDER[1], "read"], [ORDER[2], "next"]]);
  assert.strictEqual(p.label(), "2 of 20 guides marked complete.");
  assert.strictEqual(p.cont().getAttribute("href"), "/guide/" + ORDER[2]);
  assert.strictEqual(p.status().textContent, "");
});

test("storage event for another key changes nothing and reads nothing", () => {
  const store = makeStore();
  const p = run(roadmapPage(), { store });
  store.setElsewhere([ORDER[0]]);
  const calls = store.log.length;
  p.win("storage", { key: "bpozz-palette-likes" });
  p.win("storage", { key: "bpozz:font-favorites" });
  assert.strictEqual(store.log.length, calls, "storage isn't read for another key");
  assert.deepStrictEqual(p.states().slice(0, 2), [[ORDER[0], "next"], [ORDER[1], "upcoming"]]);
});

test("clear event (key null): the cleared storage is what the page shows", () => {
  const store = makeStore({ value: json(ORDER.slice(0, 5)) });
  const p = run(roadmapPage(), { store });
  assert.strictEqual(p.label(), "5 of 20 guides marked complete.");

  passive(
    p,
    () => store.local.removeItem(KEY),
    () => p.win("storage", { key: null }),
  );
  assert.deepStrictEqual(p.states(), ORDER.map((id, i) => [id, i === 0 ? "next" : "upcoming"]));
  assert.strictEqual(p.reset().hidden, true);
  assert.strictEqual(store.raw(), undefined, "and nothing is written back");
});

test("pageshow persisted: a page restored from the back/forward cache reads storage again", () => {
  const store = makeStore();
  const p = run(roadmapPage(), { store });
  store.setElsewhere([ORDER[0]]);

  // A normal first show does nothing: the page has just painted.
  const calls = store.log.length;
  p.win("pageshow", { persisted: false });
  assert.strictEqual(store.log.length, calls);
  assert.deepStrictEqual(p.states().slice(0, 1), [[ORDER[0], "next"]]);

  passive(
    p,
    () => {},
    () => p.win("pageshow", { persisted: true }),
  );
  assert.deepStrictEqual(p.states().slice(0, 2), [[ORDER[0], "read"], [ORDER[1], "next"]]);
});

test("stale-tab write protection: a change is merged into what storage holds now", () => {
  const store = makeStore({ value: json([ORDER[0]]) });
  const p = run(roadmapPage(), { store });
  // Another tab marks two more; this tab hears nothing of it.
  store.setElsewhere([ORDER[0], ORDER[7], ORDER[8]]);

  p.toggle(ORDER[1], true);
  assert.deepStrictEqual(store.ids(), [ORDER[0], ORDER[7], ORDER[8], ORDER[1]], "the other tab's marks survive");
  assert.strictEqual(p.label(), "4 of 20 guides marked complete.", "and this tab now shows them");
  assert.strictEqual(p.status().textContent, "Marked as read. 4 of 20 guides read.");

  // The same for an uncheck, and for a guide the other tab unmarked meanwhile.
  store.setElsewhere([ORDER[7], ORDER[8], ORDER[1], ORDER[12]]);
  p.toggle(ORDER[1], false);
  assert.deepStrictEqual(store.ids(), [ORDER[7], ORDER[8], ORDER[12]]);
  assert.strictEqual(p.stepOf(ORDER[0]).classList.contains("is-complete"), false);
  assert.strictEqual(p.stepOf(ORDER[12]).classList.contains("is-complete"), true);
});

test("a control that holds focus is never hidden by a repaint", () => {
  const store = makeStore({ value: json(ORDER.slice(0, 19)) });
  const p = run(roadmapPage(), { store });
  const link = p.cont();
  assert.strictEqual(link.hidden, false);
  link.focus();

  // Another tab reads the last guide while focus is on Continue.
  passive(
    p,
    () => store.setElsewhere(ORDER),
    () => p.win("storage", { key: KEY }),
  );
  assert.strictEqual(link.hidden, false, "still there: hiding it would drop focus");
  assert.strictEqual(p.label(), "All 20 guides marked complete. Nice work.");

  // Once focus has moved on, it goes.
  p.doc.activeElement = null;
  fire(p.doc, link, "blur");
  assert.strictEqual(link.hidden, true);

  // The same for Reset, when another tab clears everything.
  const q = run(roadmapPage(), { store: makeStore({ value: json([ORDER[0]]) }) });
  q.reset().focus();
  passive(
    q,
    () => q.store.setElsewhere([]),
    () => q.win("storage", { key: KEY }),
  );
  assert.strictEqual(q.reset().hidden, false);
  q.doc.activeElement = null;
  fire(q.doc, q.reset(), "blur");
  assert.strictEqual(q.reset().hidden, true);
});

// ---------------------------------------------------------------------
// roadmap.html: names and states for assistive technology
// ---------------------------------------------------------------------

test("accessibility: native controls, real links, state in words", () => {
  const p = run(roadmapPage(), { store: makeStore({ value: json([ORDER[0]]) }) });

  p.doc.querySelectorAll(".roadmap-step-checkbox").forEach((cb, i) => {
    assert.strictEqual(cb.tagName, "INPUT");
    assert.strictEqual(cb.getAttribute("type"), "checkbox");
    assert.strictEqual(cb.getAttribute("aria-label"), `Mark "${TITLE.get(ORDER[i])}" as read`);
    assert.strictEqual(cb.hasAttribute("aria-checked"), false);
  });
  p.doc.querySelectorAll(".roadmap-step-link").forEach((a, i) => {
    assert.strictEqual(a.tagName, "A");
    assert.strictEqual(a.getAttribute("href"), "/guide/" + ORDER[i]);
  });

  // aria-current="step" on the Next up link, and nowhere else on the page.
  const current = p.doc.querySelectorAll("[aria-current]");
  assert.strictEqual(current.length, 1);
  assert.strictEqual(current[0], p.stepOf(ORDER[1]).querySelector(".roadmap-step-link"));
  assert.strictEqual(current[0].getAttribute("aria-current"), "step");

  // The state is inside the link, so it is part of the link's name.
  assert.match(p.stepOf(ORDER[0]).querySelector(".roadmap-step-link").textContent, /Read/);
  assert.match(p.stepOf(ORDER[1]).querySelector(".roadmap-step-link").textContent, /Next up/);

  // One status region, for the roadmap's own announcements.
  const status = p.status();
  assert.strictEqual(status.tagName, "P");
  assert.strictEqual(status.getAttribute("role"), "status");
  assert.match(status.className, /\bsr-only\b/);
  const regions = p.doc.querySelectorAll('[role="status"]').filter((n) => n.id !== "toast");
  assert.deepStrictEqual(regions, [status]);

  // Nothing the script touches gains a role, a pressed state or a label.
  for (const node of [p.cont(), p.reset(), ...p.steps(), ...p.doc.querySelectorAll(".roadmap-stage")]) {
    for (const attr of ["role", "aria-pressed", "aria-label", "aria-live", "tabindex"]) {
      assert.strictEqual(node.hasAttribute(attr), false, `${node.tagName}.${node.className} has ${attr}`);
    }
  }
  assert.strictEqual(p.reset().tagName, "BUTTON");
});

// ---------------------------------------------------------------------
// guide pages
// ---------------------------------------------------------------------

test("a roadmap guide, unread: a Mark as read button above previous/next, nothing announced", () => {
  const p = run(guidePage(ON_ROADMAP), { toast: "throws" });
  assert.strictEqual(p.doc.querySelectorAll(".guide-complete").length, 1);

  // Directly before the previous/next links, in the same container.
  const siblings = p.primary.children.filter((c) => c.getAttribute);
  const at = siblings.indexOf(p.block());
  assert.ok(at > 0);
  assert.strictEqual(siblings[at + 1].className, "guide-footer-nav");
  assert.strictEqual(siblings[at - 1].className, "guide-article");

  const button = p.button();
  assert.strictEqual(button.tagName, "BUTTON");
  assert.strictEqual(button.getAttribute("type"), "button");
  assert.strictEqual(button.textContent, "Mark as read");
  // The button leads and "Read" follows it, so showing "Read" never moves
  // the button from under the pointer that pressed it.
  assert.deepStrictEqual(
    p.block().children.filter((c) => c.getAttribute).map((c) => c.className),
    ["btn btn-primary guide-complete__btn", "guide-complete__state", "sr-only guide-complete__status"],
  );
  assert.strictEqual(p.blockState().hidden, true);
  assert.strictEqual(p.stripState().hidden, true);
  assert.strictEqual(p.block().classList.contains("is-read"), false);
  assert.strictEqual(p.guideStatus().textContent, "");
  assert.strictEqual(p.guideStatus().getAttribute("role"), "status");
  assert.strictEqual(p.store.writes(), 0, "loading the page writes nothing");
});

test("a roadmap guide: Mark as read stores the page's own id and keeps focus on the button", () => {
  const store = makeStore({ value: json(["a-retired-guide", ORDER[0]]) });
  const p = run(guidePage(ON_ROADMAP), { store, toast: "throws" });
  assert.strictEqual(p.source.id, ON_ROADMAP);
  const button = p.button();
  button.focus();
  p.focusCalls.length = 0;

  fire(p.doc, button, "click");
  assert.deepStrictEqual(store.ids(), ["a-retired-guide", ORDER[0], ON_ROADMAP]);
  assert.strictEqual(p.guideStatus().textContent, "Marked as read.");
  assert.strictEqual(p.button(), button, "the same button element");
  assert.strictEqual(button.textContent, "Mark as unread");
  assert.strictEqual(p.doc.activeElement, button);
  assert.deepStrictEqual(p.focusCalls, [], "nothing calls focus()");
  assert.deepStrictEqual(p.scrolls, [], "no scrolling");
  assert.deepStrictEqual(p.toasts, [], "no toast");

  // Read: said in words in the block and in the strip.
  assert.strictEqual(p.block().classList.contains("is-read"), true);
  assert.strictEqual(p.blockState().hidden, false);
  assert.strictEqual(p.blockState().textContent, "Read");
  assert.strictEqual(p.stripState().hidden, false);
  assert.strictEqual(p.stripState().textContent, "Read");
  assert.strictEqual(p.doc.querySelectorAll(".guide-complete").length, 1);

  // And the roadmap page, opened next, shows it.
  const roadmap = run(roadmapPage(), { store });
  assert.strictEqual(roadmap.stepOf(ON_ROADMAP).classList.contains("is-complete"), true);
  assert.strictEqual(roadmap.label(), "2 of 20 guides marked complete.");
});

test("a roadmap guide: Mark as unread takes the id out again", () => {
  const store = makeStore({ value: json([ORDER[0], ON_ROADMAP, ORDER[5]]) });
  const p = run(guidePage(ON_ROADMAP), { store, toast: "throws" });
  // Read at load: shown, not announced.
  assert.strictEqual(p.button().textContent, "Mark as unread");
  assert.strictEqual(p.blockState().hidden, false);
  assert.strictEqual(p.stripState().hidden, false);
  assert.strictEqual(p.guideStatus().textContent, "");
  assert.strictEqual(store.writes(), 0);

  const button = p.button();
  button.focus();
  fire(p.doc, button, "click");
  assert.deepStrictEqual(store.ids(), [ORDER[0], ORDER[5]]);
  assert.strictEqual(p.guideStatus().textContent, "Marked as unread.");
  assert.strictEqual(button.textContent, "Mark as read");
  assert.strictEqual(p.blockState().hidden, true);
  assert.strictEqual(p.stripState().hidden, true);
  assert.strictEqual(p.block().classList.contains("is-read"), false);
  assert.strictEqual(p.doc.activeElement, button);

  fire(p.doc, button, "click");
  assert.deepStrictEqual(store.ids(), [ORDER[0], ORDER[5], ON_ROADMAP]);
  assert.strictEqual(p.guideStatus().textContent, "Marked as read.");
});

test("a roadmap guide: the button is named by its text, with no ARIA state", () => {
  const p = run(guidePage(ON_ROADMAP), { toast: "throws" });
  const button = p.button();
  for (const read of [false, true, false]) {
    assert.strictEqual(button.textContent, read ? "Mark as unread" : "Mark as read");
    for (const attr of ["aria-pressed", "aria-label", "aria-checked", "role", "tabindex", "disabled"]) {
      assert.strictEqual(button.hasAttribute(attr), false, `button has ${attr}`);
    }
    fire(p.doc, button, "click");
  }
  // The check marks are decoration; "Read" is the text beside them.
  p.doc.querySelectorAll("svg").forEach((svg) => assert.strictEqual(svg.getAttribute("aria-hidden"), "true"));
  // The page's own links are untouched: real links, same hrefs.
  const source = guideSource(ON_ROADMAP);
  for (const cls of ["prev", "next"]) {
    const link = p.doc.querySelector(".guide-footer-nav ." + cls);
    assert.strictEqual(link.tagName, "A");
    assert.ok(source.order.includes('class="' + cls + '" href="' + link.getAttribute("href") + '"'));
  }
  assert.strictEqual(p.doc.querySelector(".guide-roadmap__link").getAttribute("href"), "/roadmap");
  assert.strictEqual(p.doc.querySelectorAll("[aria-current]").length, 0, "aria-current is the roadmap page's");
});

test("a roadmap guide: another tab's change and a restored page repaint silently", () => {
  const store = makeStore();
  const p = run(guidePage(ON_ROADMAP), { store, toast: "throws" });
  p.button().focus();

  passive(
    p,
    () => store.setElsewhere([ON_ROADMAP]),
    () => p.win("storage", { key: KEY }),
  );
  assert.strictEqual(p.button().textContent, "Mark as unread");
  assert.strictEqual(p.stripState().hidden, false);

  passive(
    p,
    () => store.local.removeItem(KEY),
    () => p.win("storage", { key: null }),
  );
  assert.strictEqual(p.button().textContent, "Mark as read");

  passive(
    p,
    () => store.setElsewhere([ON_ROADMAP]),
    () => p.win("pageshow", { persisted: true }),
  );
  assert.strictEqual(p.blockState().hidden, false);
});

test("a roadmap guide: stale-tab write protection", () => {
  const store = makeStore({ value: json([ORDER[0]]) });
  const p = run(guidePage(ON_ROADMAP), { store, toast: "throws" });
  store.setElsewhere([ORDER[0], ORDER[9], ORDER[10]]);
  fire(p.doc, p.button(), "click");
  assert.deepStrictEqual(store.ids(), [ORDER[0], ORDER[9], ORDER[10], ON_ROADMAP]);

  // Another tab already marked this guide read: pressing "Mark as read" keeps it read, once.
  const other = makeStore();
  const q = run(guidePage(ON_ROADMAP), { store: other, toast: "throws" });
  other.setElsewhere([ON_ROADMAP]);
  fire(q.doc, q.button(), "click");
  assert.deepStrictEqual(other.ids(), [ON_ROADMAP]);
  assert.strictEqual(q.button().textContent, "Mark as unread");
});

test("a roadmap guide: malformed and blocked storage", () => {
  for (const value of ["{", "{}", "null", "42", '"' + ON_ROADMAP + '"']) {
    const store = makeStore({ value });
    const p = run(guidePage(ON_ROADMAP), { store, toast: "throws" });
    assert.strictEqual(p.button().textContent, "Mark as read", `stored ${value}`);
    fire(p.doc, p.button(), "click");
    assert.strictEqual(store.raw(), json([ON_ROADMAP]));
  }

  for (const options of [{ store: makeStore({ throws: true }) }, { accessThrows: true }]) {
    let p;
    assert.doesNotThrow(() => (p = run(guidePage(ON_ROADMAP), { ...options, toast: "throws" })));
    assert.doesNotThrow(() => fire(p.doc, p.button(), "click"));
    assert.strictEqual(p.button().textContent, "Mark as unread");
    assert.strictEqual(p.guideStatus().textContent, "Marked as read.");
    assert.doesNotThrow(() => fire(p.doc, p.button(), "click"));
    assert.strictEqual(p.button().textContent, "Mark as read");
  }
});

test("guide without #toast: the three roadmap guides that ship without it work the same", () => {
  for (const id of NO_TOAST) {
    const source = guideSource(id);
    assert.strictEqual(source.toast, false, id + " now has a toast container: update NO_TOAST");
    assert.ok(source.strip && source.order, id + " is a roadmap guide");

    const store = makeStore();
    let p;
    assert.doesNotThrow(() => (p = run(guidePage(id), { store, toast: "throws" })));
    assert.strictEqual(p.doc.getElementById("toast"), null);
    assert.doesNotThrow(() => fire(p.doc, p.button(), "click"));
    assert.deepStrictEqual(store.ids(), [id]);
    assert.strictEqual(p.guideStatus().textContent, "Marked as read.");
    assert.doesNotThrow(() => fire(p.doc, p.button(), "click"));
    assert.deepStrictEqual(store.ids(), []);
  }
});

test("off-roadmap guide: no completion block, no storage access, no listeners", () => {
  for (const id of OFF_ROADMAP) {
    const source = guideSource(id);
    assert.strictEqual(source.strip, null, id + " has a roadmap strip");
    assert.strictEqual(source.order, null, id + " has previous/next links");

    const store = makeStore({ value: json([id, ORDER[0]]) });
    const page = guidePage(id);
    const before = page.primary.children.length;
    const p = run(page, { store, toast: "throws" });
    assert.strictEqual(p.block(), null);
    assert.strictEqual(p.stripState(), null);
    assert.strictEqual(p.doc.querySelectorAll("button").length, 0);
    assert.strictEqual(p.primary.children.length, before, "nothing was added to the page");
    assert.deepStrictEqual(store.log, [], "storage is never touched");
    assert.deepStrictEqual(p.windowListeners, {}, "no storage or pageshow listener");
  }
});

test("pages without roadmap markup: the script does nothing at all", () => {
  const store = makeStore({ value: json([ORDER[0]]) });
  const page = plainPage();
  const p = run(page, { store, toast: "throws" });
  assert.deepStrictEqual(store.log, []);
  assert.deepStrictEqual(p.windowListeners, {});
  assert.strictEqual(p.doc.querySelectorAll("button").length, 0);
  assert.strictEqual(p.block(), null);

  // The same with storage that can't even be read.
  assert.doesNotThrow(() => run(plainPage(), { accessThrows: true, toast: "throws" }));
});

test("roadmap-only behavior: roadmap.html gets no completion block, a guide gets no roadmap states", () => {
  const roadmap = run(roadmapPage(), { store: makeStore({ value: json([ORDER[0]]) }) });
  assert.strictEqual(roadmap.block(), null);
  assert.strictEqual(roadmap.stripState(), null);

  const guide = run(guidePage(ON_ROADMAP), { toast: "throws" });
  assert.strictEqual(guide.doc.querySelectorAll(".roadmap-step").length, 0);
  assert.strictEqual(guide.doc.getElementById("roadmap-continue"), null);
  assert.strictEqual(guide.doc.getElementById("roadmap-status"), null);
});

test("a guide page missing its id or its previous/next links gets no block and no error", () => {
  const noId = guidePage(ON_ROADMAP);
  noId.doc.body.removeAttribute("data-guide-id");
  const store = makeStore();
  let p;
  assert.doesNotThrow(() => (p = run(noId, { store, toast: "throws" })));
  assert.strictEqual(p.block(), null);
  assert.strictEqual(p.stripState(), null);
  assert.deepStrictEqual(p.windowListeners, {});

  const noNav = guidePage(ON_ROADMAP);
  noNav.doc.querySelector(".guide-footer-nav").remove();
  assert.doesNotThrow(() => (p = run(noNav, { toast: "throws" })));
  assert.strictEqual(p.block(), null);
  assert.strictEqual(p.stripState(), null);
});

// ---------------------------------------------------------------------
// the committed pages and the bundle
// ---------------------------------------------------------------------

test("every roadmap guide page has the hooks, under the id the roadmap stores; the two others have none", () => {
  const files = fs.readdirSync(path.join(ROOT, "guide")).filter((f) => f.endsWith(".html"));
  assert.strictEqual(files.length, TOTAL + OFF_ROADMAP.length);

  for (const file of files) {
    const id = file.replace(/\.html$/, "");
    const html = fs.readFileSync(path.join(ROOT, "guide", file), "utf8");
    const count = (s) => html.split(s).length - 1;
    const source = guideSource(id);
    assert.strictEqual(source.id, id, file + ": <body data-guide-id> is not the page's own id");
    assert.strictEqual(count("data-guide-id="), 1, file + ": more than one data-guide-id");

    const onRoadmap = ORDER.includes(id);
    assert.strictEqual(OFF_ROADMAP.includes(id), !onRoadmap, file);
    assert.strictEqual(count('<nav class="guide-roadmap"'), onRoadmap ? 1 : 0, file + ": roadmap strip");
    assert.strictEqual(count('<nav class="guide-footer-nav"'), onRoadmap ? 1 : 0, file + ": previous/next");
    // Nothing of the completion UI is in the page's own HTML.
    assert.strictEqual(count("guide-complete"), 0, file);
    assert.strictEqual(count("guide-roadmap__state"), 0, file);
    assert.strictEqual(count("Mark as read"), 0, file);
  }
});

test("/app.js carries roadmap.js as a fragment, after core.js, and never on its own", () => {
  const { fragments } = build.APP_BUNDLE;
  assert.ok(fragments.indexOf("src/client/roadmap.js") !== -1);
  assert.ok(fragments.indexOf("src/client/core.js") < fragments.indexOf("src/client/roadmap.js"));
  assert.ok(!build.PUBLISH_FILES.some((f) => f.from === "src/client/roadmap.js"), "a fragment, never published on its own");
});

test("roadmap.js keeps to its one key, and to this browser", () => {
  assert.strictEqual((ROADMAP_JS.match(/"point-roadmap-progress"/g) || []).length, 1, "the key is spelled once");
  for (const banned of ["fetch(", "XMLHttpRequest", "sessionStorage", "BpozzSaved", "BpozzAuth", "location.hash", "location.search", "history.", "scrollIntoView", "scrollTo", ".focus(", "aria-pressed", "innerHTML"]) {
    assert.ok(!ROADMAP_JS.includes(banned), "roadmap.js uses " + banned);
  }
  // showToast is roadmap.html's Reset only.
  assert.strictEqual((ROADMAP_JS.match(/showToast\(/g) || []).length, 1);
});
