/**
 * auth.test.js — header auth state in src/client/auth.js.
 *
 * Runs the real auth.js in a vm context (the search.test.js convention)
 * against a small DOM stub. The stub throws if anything sets innerHTML, so a
 * header drawn from server data can't get there by HTML injection, and it
 * records every touch of localStorage, sessionStorage and document.cookie.
 *
 * The dialog is built with innerHTML from a fixed template. The stub lets
 * exactly that one write through on the <dialog> element and answers it
 * with a skeleton of the same elements (dialogSkeleton), so the email step
 * can be driven; every other innerHTML write still throws.
 *
 * All user data below is invented. No real account, token or cookie.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = fs.readFileSync(path.join(__dirname, "auth.js"), "utf8");

// ---------------------------------------------------------------------
// DOM stub
// ---------------------------------------------------------------------

function parseCompound(text) {
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/.exec(text);
  if (!m) throw new Error(`unsupported selector: ${text}`);
  const parts = { tag: m[1] ? m[1].toUpperCase() : null, classes: [], id: null, attrs: [] };
  for (const token of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
    if (token[0] === ".") parts.classes.push(token.slice(1));
    else if (token[0] === "#") parts.id = token.slice(1);
    else {
      const a = /^\[([\w-]+)(?:=(['"])(.*)\2)?\]$/.exec(token);
      if (!a) throw new Error(`unsupported attribute selector: ${token}`);
      parts.attrs.push({ name: a[1], value: a[3] === undefined ? null : a[3] });
    }
  }
  return parts;
}

function matchesCompound(el, c) {
  if (!el.getAttribute) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  const classes = el.className.split(/\s+/);
  if (!c.classes.every((cls) => classes.includes(cls))) return false;
  return c.attrs.every((a) =>
    a.value === null ? el.hasAttribute(a.name) : el.getAttribute(a.name) === a.value,
  );
}

function matches(el, selector) {
  const chain = selector.trim().split(/\s+/).map(parseCompound);
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let node = el.parentNode; node && i >= 0; node = node.parentNode) {
    if (matchesCompound(node, chain[i])) i--;
  }
  return i < 0;
}

function makeDocument() {
  const doc = { activeElement: null, _listeners: {} };

  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this._attrs = new Map();
      this._text = null;
      this._listeners = {};
      this.style = {};
      const self = this;
      this.classList = {
        add: (c) => !self.classList.contains(c) && (self.className = (self.className + " " + c).trim()),
        remove: (c) => (self.className = self.className.split(/\s+/).filter((x) => x !== c).join(" ")),
        contains: (c) => self.className.split(/\s+/).includes(c),
        toggle: (c, on) => (on ?? !self.classList.contains(c)) ? self.classList.add(c) : self.classList.remove(c),
      };
    }
    setAttribute(n, v) { this._attrs.set(n, String(v)); }
    getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
    hasAttribute(n) { return this._attrs.has(n); }
    removeAttribute(n) { this._attrs.delete(n); }
    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this.getAttribute("class") || ""; }
    set className(v) { this.setAttribute("class", v); }
    get type() { return this.getAttribute("type") || ""; }
    set type(v) { this.setAttribute("type", v); }
    get hidden() { return this.hasAttribute("hidden"); }
    set hidden(v) { v ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); }
    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(v) { v ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
    set innerHTML(_v) { throw new Error("innerHTML was used"); }
    get textContent() {
      return this._text !== null ? this._text : this.children.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      this.children.forEach((c) => (c.parentNode = null));
      this.children = [];
      this._text = String(v);
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      if (this._text !== null) this._text = null;
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    contains(node) {
      for (let n = node; n; n = n.parentNode) if (n === this) return true;
      return false;
    }
    closest(selector) {
      for (let n = this; n && n.getAttribute; n = n.parentNode) if (matches(n, selector)) return n;
      return null;
    }
    matches(selector) { return matches(this, selector); }
    querySelectorAll(selector) {
      const out = [];
      const walk = (n) => n.children.forEach((c) => { if (matches(c, selector)) out.push(c); walk(c); });
      walk(this);
      return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get isConnected() {
      let n = this;
      while (n.parentNode) n = n.parentNode;
      return n === doc.documentElement;
    }
    getClientRects() {
      for (let n = this; n; n = n.parentNode) if (n.hidden) return [];
      return this.isConnected ? [{}] : [];
    }
    focus() { doc.activeElement = this; }
  }

  doc.createElement = (tag) => new El(tag);
  // Text nodes: plain text, no attributes, never matched by a selector.
  doc.createTextNode = (text) => ({ textContent: String(text), children: [], parentNode: null });
  doc.documentElement = new El("html");
  doc.body = doc.documentElement.appendChild(new El("body"));
  doc.getElementById = (id) => doc.documentElement.querySelector("#" + id);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.addEventListener = (type, fn) => (doc._listeners[type] ||= []).push(fn);
  return doc;
}

// Dispatch with bubbling up to the document.
function fire(doc, target, type, extra = {}) {
  const evt = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  for (let n = target; n; n = n.parentNode) (n._listeners[type] || []).forEach((fn) => fn(evt));
  (doc._listeners[type] || []).forEach((fn) => fn(evt));
  return evt;
}

// The two header auth areas exactly as both partials render them.
function buildHeader(doc) {
  const area = (cls) => {
    const box = doc.createElement("div");
    box.className = cls;
    for (const [mode, label, style] of [["signin", "Sign in", "btn-ghost"], ["signup", "Sign up", "btn-primary"]]) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `btn ${style}`;
      b.setAttribute("data-auth-open", mode);
      b.setAttribute("aria-haspopup", "dialog");
      b.textContent = label;
      box.appendChild(b);
    }
    return box;
  };
  const header = doc.body.appendChild(doc.createElement("header"));
  header.appendChild(area("header-auth"));
  const menu = header.appendChild(doc.createElement("div"));
  menu.id = "mobile-menu";
  menu.appendChild(area("mobile-menu__auth"));
}

// The parts of account.html that auth.js touches: the Profile box it draws
// into, the page's own Sign in and its Settings Sign out.
function buildAccountPage(doc) {
  const page = doc.body.appendChild(doc.createElement("div"));
  page.className = "legal-content account-page";
  page.setAttribute("data-account-page", "");
  const signin = page.appendChild(doc.createElement("button"));
  signin.className = "btn btn-primary";
  signin.setAttribute("data-auth-open", "signin");
  signin.textContent = "Sign in";
  const profile = page.appendChild(doc.createElement("div"));
  profile.className = "account-profile";
  profile.setAttribute("data-account-profile", "");
  const signout = page.appendChild(doc.createElement("button"));
  signout.className = "btn account-page__button";
  signout.setAttribute("data-auth-signout", "");
  signout.textContent = "Sign out";
}

// The elements auth.js looks up in its dialog template, with the same
// selectors. Only the fixed MARKUP string can build it.
function dialogSkeleton(doc, dialog) {
  const add = (parent, tag, attrs = {}) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return parent.appendChild(node);
  };
  const body = add(dialog, "div", { class: "auth__body" });
  add(body, "button", { class: "auth__back", "data-auth-back": "", hidden: "" });
  add(body, "h2", { id: "auth-title", class: "auth__title" });
  add(body, "p", { id: "auth-lede", class: "auth__lede" });
  add(body, "p", { class: "auth__notice", "data-auth-notice": "" });
  const choose = add(body, "div", { class: "auth__step", "data-step": "choose" });
  add(choose, "button", { class: "auth__btn", "data-auth-google": "" });
  add(choose, "button", { class: "auth__btn", "data-auth-email": "" });
  const form = add(body, "form", { class: "auth__step auth__form", "data-step": "email", hidden: "" });
  const input = add(form, "input", { id: "auth-email", type: "email" });
  input.value = "";
  input.select = () => {};
  add(form, "p", { id: "auth-email-error", class: "auth__error", hidden: "" });
  add(form, "button", { type: "submit", class: "btn btn-primary auth__submit" });
  const sent = add(body, "div", { class: "auth__step", "data-step": "sent", hidden: "" });
  add(sent, "button", { class: "auth__btn", "data-auth-retry": "" });
  add(body, "span", { "data-auth-switch-text": "" });
  add(body, "button", { class: "auth__link", "data-auth-switch": "" });
}

function installDialog(doc) {
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const node = create(tag);
    if (tag !== "dialog") return node;
    node.open = false;
    node.offsetWidth = 0;
    node.showModal = () => { node.open = true; };
    node.close = () => {
      node.open = false;
      (node._listeners.close || []).forEach((fn) => fn({ type: "close" }));
    };
    Object.defineProperty(node, "innerHTML", {
      set(markup) {
        if (!/data-step="choose"/.test(markup) || node.children.length) throw new Error("innerHTML was used");
        dialogSkeleton(doc, node);
      },
    });
    return node;
  };
}

// ---------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null) },
  json: () => Promise.resolve(body),
});
const html = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => "text/html" },
  json: () => Promise.reject(new Error("not json")),
});

const SIGNED_OUT = { authenticated: false, user: null, providers: { google: true, email: false } };
const signedIn = (user) => ({ authenticated: true, user, providers: { google: true, email: false } });
const USER = {
  id: "00000000-0000-4000-8000-000000000000",
  email: "dee@example.test",
  display_name: "Dee Signer",
  avatar_url: "https://avatars.example.test/dee.png",
};

/**
 * Loads auth.js into a fresh page. `sessions` is the list of answers
 * GET /api/auth/session gives, in order (the last one repeats); each is a
 * response object, or a function returning one or throwing.
 */
function page({ sessions = [json(200, SIGNED_OUT)], signout = () => json(200, { signed_out: true }), emailStart = () => json(200, { sent: true }), search = "", hash = "", toast = null, hang = false, accountPage = false } = {}) {
  const doc = makeDocument();
  installDialog(doc);
  buildHeader(doc);
  if (accountPage) buildAccountPage(doc);
  const calls = [];
  const storageTouches = [];
  let replaced = null;
  let sessionIndex = 0;

  const ctx = {
    console,
    URL,
    URLSearchParams,
    Promise,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 1500 ? 5 : ms), // REVEAL_MS, fast-forwarded
    clearTimeout,
    innerWidth: 1280,
    matchMedia: () => ({ matches: true }), // reduced motion: the dialog closes at once
    document: doc,
    location: { pathname: "/guides/", search, hash, assign() { throw new Error("navigated"); } },
    history: { state: null, replaceState: (_s, _t, url) => (replaced = url) },
    fetch: (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", credentials: init.credentials, body: init.body, headers: init.headers });
      if (url === "/api/auth/session") {
        if (hang) return new Promise(() => {});
        const answer = sessions[Math.min(sessionIndex++, sessions.length - 1)];
        try {
          return Promise.resolve(typeof answer === "function" ? answer() : answer);
        } catch (e) {
          return Promise.reject(e);
        }
      }
      if (url === "/api/auth/signout") {
        try {
          return Promise.resolve(signout());
        } catch (e) {
          return Promise.reject(e);
        }
      }
      if (url === "/api/auth/email/start") {
        try {
          return Promise.resolve(emailStart());
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return Promise.reject(new Error("unexpected fetch " + url));
    },
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(ctx, name, { get: () => (storageTouches.push(name), {}) });
  }
  Object.defineProperty(doc, "cookie", {
    get: () => (storageTouches.push("document.cookie"), ""),
    set: () => storageTouches.push("document.cookie"),
  });
  if (toast) ctx.bpozzShowToast = toast;
  ctx.window = ctx;
  vm.runInNewContext(SOURCE, ctx);

  const q = (s) => doc.querySelector(s);
  return {
    doc,
    ctx,
    calls,
    storageTouches,
    replaced: () => replaced,
    q,
    state: () => doc.documentElement.getAttribute("data-auth"),
    desktopButtons: () => doc.querySelectorAll(".header-auth [data-auth-open]"),
    mobileButtons: () => doc.querySelectorAll(".mobile-menu__auth [data-auth-open]"),
    desktopAccount: () => q(".header-auth [data-auth-account]"),
    mobileAccount: () => q(".mobile-menu__auth [data-auth-account]"),
  };
}

const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

// ---------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------

test("loading: nothing is drawn until the session answers", () => {
  const p = page();
  assert.strictEqual(p.state(), null, "html[data-auth] must stay unset while loading");
  assert.deepStrictEqual(p.calls.map((c) => [c.method, c.url, c.credentials]), [["GET", "/api/auth/session", "same-origin"]]);
});

test("signed out: the existing Sign in / Sign up buttons, no account UI", async () => {
  const p = page();
  await settle();
  assert.strictEqual(p.state(), "signed-out");
  assert.deepStrictEqual(p.desktopButtons().map((b) => [b.textContent, b.hidden]), [["Sign in", false], ["Sign up", false]]);
  assert.deepStrictEqual(p.mobileButtons().map((b) => [b.textContent, b.hidden]), [["Sign in", false], ["Sign up", false]]);
  assert.strictEqual(p.desktopAccount(), null);
  assert.strictEqual(p.mobileAccount(), null);
});

test("signed in: account UI replaces the buttons on desktop and mobile", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  assert.strictEqual(p.state(), "signed-in");
  assert.ok(p.desktopButtons().every((b) => b.hidden) && p.mobileButtons().every((b) => b.hidden));

  const toggle = p.q(".header-auth [data-account-toggle]");
  assert.strictEqual(p.q(".account__name").textContent, "Dee Signer");
  assert.strictEqual(toggle.getAttribute("aria-label"), "Account menu: Dee Signer");
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
  const menu = p.doc.getElementById(toggle.getAttribute("aria-controls"));
  assert.ok(menu && menu.hidden, "menu starts closed");
  assert.strictEqual(p.q(".header-auth [data-auth-signout]").textContent, "Sign out");

  const img = p.q(".header-auth .account__avatar img");
  assert.strictEqual(img.src, "https://avatars.example.test/dee.png");
  assert.strictEqual(img.alt, "");
  assert.strictEqual(img.referrerPolicy, "no-referrer");

  assert.strictEqual(p.q(".mobile-account__name").textContent, "Dee Signer");
  assert.strictEqual(p.q(".mobile-account__email").textContent, "dee@example.test");
  assert.strictEqual(p.q(".mobile-menu__auth [data-auth-signout]").textContent, "Sign out");
});

test("missing display name falls back to the email, shown once", async () => {
  const p = page({ sessions: [json(200, signedIn({ ...USER, display_name: null }))], accountPage: true });
  await settle();
  assert.strictEqual(p.q(".account__name").textContent, "dee@example.test");
  assert.strictEqual(p.q(".mobile-account__name").textContent, "dee@example.test");
  assert.strictEqual(p.q(".mobile-account__email"), null, "email not repeated under itself");
  assert.strictEqual(p.q(".account-profile__name").textContent, "dee@example.test");
  assert.strictEqual(p.q(".account-profile__email"), null);
  // Neither name nor email: a neutral label, never "undefined".
  const q = page({ sessions: [json(200, signedIn({ id: "x", email: null, display_name: "  ", avatar_url: null }))] });
  await settle();
  assert.strictEqual(q.q(".account__name").textContent, "Account");
});

test("missing or unsafe avatar -> initial; a photo that fails to load -> initial", async () => {
  for (const avatar_url of [null, "", "javascript:alert(1)", "http://avatars.example.test/a.png", "data:image/png;base64,AAAA", 42, "not a url"]) {
    const p = page({ sessions: [json(200, signedIn({ ...USER, avatar_url }))] });
    await settle();
    const wrap = p.q(".header-auth .account__avatar");
    assert.strictEqual(wrap.querySelector("img"), null, `no <img> for ${String(avatar_url)}`);
    assert.strictEqual(wrap.textContent, "D");
    assert.ok(wrap.classList.contains("account__avatar--initial"));
    assert.strictEqual(wrap.getAttribute("aria-hidden"), "true");
  }
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const img = p.q(".header-auth .account__avatar img");
  fire(p.doc, img, "error");
  const wrap = p.q(".header-auth .account__avatar");
  assert.strictEqual(wrap.querySelector("img"), null, "broken image removed");
  assert.strictEqual(wrap.textContent, "D");
});

test("session request failures are drawn as signed out", async () => {
  const failures = [
    () => { throw new TypeError("network down"); },
    json(503, { authenticated: false, user: null, error: "auth_unavailable" }),
    html(404),
    html(200),
    json(200, { authenticated: true, user: USER }), // no providers: not the auth backend
    json(200, null),
  ];
  for (const answer of failures) {
    const p = page({ sessions: [answer] });
    await settle();
    assert.strictEqual(p.state(), "signed-out");
    assert.ok(p.desktopButtons().every((b) => !b.hidden));
    assert.strictEqual(p.desktopAccount(), null);
  }
});

test("a slow session answer never leaves the auth area blank", async () => {
  const p = page({ hang: true });
  assert.strictEqual(p.state(), null);
  await new Promise((r) => setTimeout(r, 20)); // past the (fast-forwarded) reveal delay
  assert.strictEqual(p.state(), "signed-out");
  assert.ok(p.desktopButtons().every((b) => !b.hidden));
});

test("sign out: POSTs /api/auth/signout, asks the server again, redraws signed out", async () => {
  const p = page({ sessions: [json(200, signedIn(USER)), json(200, SIGNED_OUT)] });
  await settle();
  fire(p.doc, p.q(".header-auth [data-account-toggle]"), "click");
  const button = p.q(".header-auth [data-auth-signout]");
  fire(p.doc, button, "click");
  assert.ok(button.disabled, "disabled while signing out");
  await settle(6);

  const post = p.calls.find((c) => c.url === "/api/auth/signout");
  assert.deepStrictEqual(
    { method: post.method, credentials: post.credentials, body: post.body },
    { method: "POST", credentials: "same-origin", body: undefined },
  );
  assert.strictEqual(p.calls.filter((c) => c.url === "/api/auth/session").length, 2, "session re-checked");
  assert.strictEqual(p.state(), "signed-out");
  assert.strictEqual(p.desktopAccount(), null);
  assert.strictEqual(p.mobileAccount(), null);
  assert.ok(p.desktopButtons().every((b) => !b.hidden) && p.mobileButtons().every((b) => !b.hidden));
  assert.strictEqual(p.doc.activeElement, p.desktopButtons()[0], "focus lands on Sign in");
});

test("sign out from the mobile panel lands focus on the panel's Sign in", async () => {
  const p = page({ sessions: [json(200, signedIn(USER)), json(200, SIGNED_OUT)] });
  await settle();
  fire(p.doc, p.q(".mobile-menu__auth [data-auth-signout]"), "click");
  await settle(6);
  assert.strictEqual(p.state(), "signed-out");
  assert.strictEqual(p.doc.activeElement, p.mobileButtons()[0]);
});

test("a failed sign-out stays signed in and says so", async () => {
  const messages = [];
  const p = page({
    sessions: [json(200, signedIn(USER))],
    signout: () => { throw new TypeError("network down"); },
    toast: (m) => messages.push(m),
  });
  await settle();
  const button = p.q(".header-auth [data-auth-signout]");
  fire(p.doc, button, "click");
  await settle(6);
  assert.strictEqual(p.state(), "signed-in", "the server still says signed in");
  assert.deepStrictEqual(messages, ["Couldn’t sign out. Please try again."]);
  assert.strictEqual(p.q(".header-auth [data-auth-signout]").disabled, false);
});

test("user data is written as text, never as markup", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const p = page({
    sessions: [json(200, signedIn({ ...USER, display_name: hostile, email: "<b>x</b>@example.test", avatar_url: "javascript:alert(1)" }))],
    accountPage: true,
  });
  await settle(); // the DOM stub throws on any innerHTML write
  for (const selector of [".account__name", ".mobile-account__name", ".account-profile__name"]) {
    const node = p.q(selector);
    assert.strictEqual(node.textContent, hostile);
    assert.strictEqual(node.children.length, 0, `${selector} has no child elements`);
  }
  assert.strictEqual(p.q(".mobile-account__email").textContent, "<b>x</b>@example.test");
  assert.strictEqual(p.q(".account-profile__email").textContent, "<b>x</b>@example.test");
  assert.strictEqual(p.q(".header-auth [data-account-toggle]").getAttribute("aria-label"), "Account menu: " + hostile);
  assert.strictEqual(p.doc.querySelectorAll("img").length, 0, "no image created from user data");
});

test("no auth state in localStorage, sessionStorage or document.cookie", async () => {
  const p = page({ sessions: [json(200, signedIn(USER)), json(200, SIGNED_OUT)] });
  await settle();
  fire(p.doc, p.q(".header-auth [data-auth-signout]"), "click");
  await settle(6);
  assert.deepStrictEqual(p.storageTouches, []);
  // And no code path at all uses them (comments, which explain the rule, aside).
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(code), "auth.js code uses browser storage");
});

test("account menu: toggle, Escape and outside click close it", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const toggle = p.q(".header-auth [data-account-toggle]");
  const menu = () => p.doc.getElementById(toggle.getAttribute("aria-controls"));
  fire(p.doc, toggle, "click");
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "true");
  assert.strictEqual(menu().hidden, false);
  fire(p.doc, p.doc.body, "keydown", { key: "Escape" });
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
  assert.strictEqual(menu().hidden, true);
  assert.strictEqual(p.doc.activeElement, toggle, "focus returns to the toggle");
  fire(p.doc, toggle, "click");
  fire(p.doc, p.q(".account__title"), "click"); // inside: stays open
  assert.strictEqual(menu().hidden, false);
  fire(p.doc, p.doc.body, "click"); // outside: closes
  assert.strictEqual(menu().hidden, true);
});

// ---------------------------------------------------------------------
// account menu: Profile, Saved, Settings, Sign out
// ---------------------------------------------------------------------

const ACCOUNT_LINKS = [
  ["Profile", "/account#profile"],
  ["Saved", "/account#saved"],
  ["Settings", "/account#settings"],
];
const links = (nodes) => nodes.map((a) => [a.textContent, a.getAttribute("href")]);

test("account menu: exactly Your Account, Profile, Saved, Settings, a divider, Sign out", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const toggle = p.q(".header-auth [data-account-toggle]");
  const menu = p.doc.getElementById(toggle.getAttribute("aria-controls"));
  assert.strictEqual(menu.tagName, "NAV");
  assert.deepStrictEqual(
    menu.children.map((n) => [n.tagName, n.textContent]),
    [["P", "Your Account"], ["A", "Profile"], ["A", "Saved"], ["A", "Settings"], ["HR", ""], ["BUTTON", "Sign out"]],
  );
  const title = menu.children[0];
  assert.strictEqual(menu.getAttribute("aria-labelledby"), title.id, "the menu is named by its title");
  assert.deepStrictEqual(links(menu.querySelectorAll("a")), ACCOUNT_LINKS);
  assert.ok(menu.querySelectorAll("a").every((a) => a.className === "account__item"));
  assert.strictEqual(menu.querySelector("button").getAttribute("type"), "button");
});

test("mobile panel: Your Account, who is signed in, the same three links, Sign out", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const box = p.mobileAccount();
  assert.deepStrictEqual(
    box.children.map((n) => n.className),
    ["mobile-account__title", "mobile-account__who", "mobile-account__nav", "btn btn-ghost"],
  );
  assert.strictEqual(p.q(".mobile-account__title").textContent, "Your Account");
  const nav = p.q(".mobile-account__nav");
  assert.strictEqual(nav.tagName, "NAV");
  assert.strictEqual(nav.getAttribute("aria-label"), "Your Account");
  assert.deepStrictEqual(links(nav.querySelectorAll("a")), ACCOUNT_LINKS);
});

test("signed out: no account links anywhere", async () => {
  const p = page({ accountPage: true });
  await settle();
  assert.deepStrictEqual(p.doc.querySelectorAll("[data-account-link]"), []);
  assert.deepStrictEqual(p.q("[data-account-profile]").children, []);
});

test("choosing Profile, Saved or Settings closes the menu and the mobile panel", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const toggle = p.q(".header-auth [data-account-toggle]");
  const menu = p.doc.getElementById(toggle.getAttribute("aria-controls"));
  for (const link of menu.querySelectorAll("a")) {
    fire(p.doc, toggle, "click");
    assert.strictEqual(menu.hidden, false);
    const evt = fire(p.doc, link, "click");
    assert.strictEqual(evt.defaultPrevented, false, "the link is followed");
    assert.strictEqual(menu.hidden, true);
    assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
  }
  const panel = p.doc.getElementById("mobile-menu");
  panel.hidden = false; // the panel, opened
  const evt = fire(p.doc, p.q(".mobile-account__nav a"), "click");
  assert.strictEqual(evt.defaultPrevented, false);
  assert.strictEqual(panel.hidden, true, "the mobile panel closes too");
});

test("account menu keyboard: arrows open and move, Home/End jump, Escape returns to the button", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const toggle = p.q(".header-auth [data-account-toggle]");
  const menu = p.doc.getElementById(toggle.getAttribute("aria-controls"));
  const items = menu.children.filter((n) => n.tagName === "A" || n.tagName === "BUTTON");
  const key = (target, k) => fire(p.doc, target, "keydown", { key: k });

  toggle.focus();
  assert.ok(key(toggle, "ArrowDown").defaultPrevented);
  assert.strictEqual(menu.hidden, false, "ArrowDown opens the menu");
  assert.strictEqual(p.doc.activeElement, items[0], "…at Profile");
  key(items[0], "ArrowDown");
  assert.strictEqual(p.doc.activeElement, items[1]);
  key(items[1], "End");
  assert.strictEqual(p.doc.activeElement, items[3], "End: Sign out");
  key(items[3], "ArrowDown");
  assert.strictEqual(p.doc.activeElement, items[0], "wraps to the top");
  key(items[0], "ArrowUp");
  assert.strictEqual(p.doc.activeElement, items[3], "wraps to the bottom");
  key(items[3], "Home");
  assert.strictEqual(p.doc.activeElement, items[0]);
  const letter = key(items[0], "a");
  assert.strictEqual(letter.defaultPrevented, false, "other keys are left alone");

  key(items[0], "Escape");
  assert.strictEqual(menu.hidden, true);
  assert.strictEqual(p.doc.activeElement, toggle);

  toggle.focus();
  key(toggle, "ArrowUp");
  assert.strictEqual(p.doc.activeElement, items[3], "ArrowUp opens at the last item");
  key(items[3], "Escape");
  assert.strictEqual(key(toggle, "Home").defaultPrevented, false, "Home on the closed button does nothing");
  assert.strictEqual(menu.hidden, true);
});

test("account menu: tabbing out closes it; focus moving within it does not", async () => {
  const p = page({ sessions: [json(200, signedIn(USER))] });
  await settle();
  const toggle = p.q(".header-auth [data-account-toggle]");
  const menu = p.doc.getElementById(toggle.getAttribute("aria-controls"));
  const signout = menu.querySelector("button");
  fire(p.doc, toggle, "click");
  fire(p.doc, menu.querySelector("a"), "focusout", { relatedTarget: signout });
  assert.strictEqual(menu.hidden, false, "still inside");
  fire(p.doc, signout, "focusout", { relatedTarget: null });
  assert.strictEqual(menu.hidden, false, "no new focus target: left to the outside-click rule");
  fire(p.doc, signout, "focusout", { relatedTarget: p.desktopButtons()[0] });
  assert.strictEqual(menu.hidden, true, "focus left the menu");
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
});

test("/account Profile: drawn from the session, cleared on sign-out", async () => {
  const p = page({ sessions: [json(200, signedIn(USER)), json(200, SIGNED_OUT)], accountPage: true });
  await settle();
  const box = p.q("[data-account-profile]");
  assert.strictEqual(box.querySelector(".account__avatar img").src, "https://avatars.example.test/dee.png");
  assert.strictEqual(p.q(".account-profile__name").textContent, "Dee Signer");
  assert.strictEqual(p.q(".account-profile__email").textContent, "dee@example.test");

  // The page's own Settings > Sign out uses the same sign-out as the header.
  fire(p.doc, p.q("[data-account-page] [data-auth-signout]"), "click");
  await settle(6);
  assert.strictEqual(p.calls.filter((c) => c.url === "/api/auth/signout" && c.method === "POST").length, 1);
  assert.strictEqual(p.state(), "signed-out");
  assert.deepStrictEqual(box.children, [], "profile cleared");
  assert.strictEqual(p.doc.activeElement, p.q("[data-account-page] [data-auth-open='signin']"), "focus lands on the page's Sign in");
});

test("?auth_error: message shown once, parameter removed, rest of the URL kept", async () => {
  const messages = [];
  const p = page({ search: "?q=color&auth_error=cancelled", hash: "#top", toast: (m) => messages.push(m) });
  assert.strictEqual(p.replaced(), "/guides/?q=color#top", "removed synchronously, before other scripts");
  await settle();
  assert.deepStrictEqual(messages, ["Sign-in was cancelled."]);

  const expected = {
    failed: "Sign-in didn’t complete. Please try again.",
    expired: "Sign-in took too long. Please try again.",
    unavailable: "Sign-in isn’t available right now. Please try again later.",
  };
  for (const [code, text] of Object.entries(expected)) {
    const got = [];
    const q = page({ search: `?auth_error=${code}`, toast: (m) => got.push(m) });
    assert.strictEqual(q.replaced(), "/guides/");
    await settle();
    assert.deepStrictEqual(got, [text]);
  }

  // Pages without the shared toast (the five that skip app.js) get their own.
  const own = page({ search: "?auth_error=failed" });
  await settle();
  const toast = own.doc.getElementById("auth-toast");
  assert.strictEqual(toast.textContent, expected.failed);
  assert.strictEqual(toast.getAttribute("role"), "status");
  assert.strictEqual(toast.className, "toast");

  // Unknown code: removed, but nothing is said. No parameter: URL untouched.
  const unknown = [];
  const u = page({ search: "?auth_error=%3Cscript%3E", toast: (m) => unknown.push(m) });
  await settle();
  assert.strictEqual(u.replaced(), "/guides/");
  assert.deepStrictEqual(unknown, []);
  const clean = page({ search: "?q=color" });
  assert.strictEqual(clean.replaced(), null);
});

test("public API: getSession, refreshSession, signOut; Google entry point unchanged", async () => {
  const p = page({ sessions: [json(200, SIGNED_OUT), json(200, signedIn(USER))] });
  await settle();
  const api = p.ctx.BpozzAuth;
  for (const fn of ["open", "close", "getSession", "refreshSession", "signOut"]) {
    assert.strictEqual(typeof api[fn], "function", fn);
  }
  await api.getSession();
  assert.strictEqual(p.calls.filter((c) => c.url === "/api/auth/session").length, 1, "getSession is cached");
  await api.refreshSession();
  assert.strictEqual(p.state(), "signed-in", "refreshSession redraws");

  // Sign-in still starts with a full-page navigation to /api/auth/google/start.
  assert.match(SOURCE, /API \+\s*"\/google\/start\?intent=" \+\s*encodeURIComponent\(mode\) \+\s*"&return_to=" \+\s*encodeURIComponent\(returnTo\(\)\)/);
  for (const partial of ["header.html", "header-home.html"]) {
    const text = fs.readFileSync(path.join(ROOT, "partials", partial), "utf8");
    assert.strictEqual((text.match(/data-auth-open="signin"/g) || []).length, 2, partial);
    assert.strictEqual((text.match(/data-auth-open="signup"/g) || []).length, 2, partial);
  }
});

// ---------------------------------------------------------------------
// email sign-in (Phase 4A)
// ---------------------------------------------------------------------

const EMAIL_ON = { authenticated: false, user: null, providers: { google: true, email: true } };

// Opens the dialog from the header, goes to the email step and submits.
async function submitEmail(p, email, mode = "signin") {
  await settle();
  fire(p.doc, p.q(`.header-auth [data-auth-open='${mode}']`), "click");
  const dialog = p.q("dialog");
  assert.ok(dialog && dialog.open, "dialog opened");
  fire(p.doc, p.q("[data-auth-email]"), "click");
  p.q("#auth-email").value = email;
  fire(p.doc, p.q("form[data-step='email']"), "submit");
  await settle(8);
  return dialog;
}

const emailPosts = (p) => p.calls.filter((c) => c.url === "/api/auth/email/start");

test("email provider off: no email request is ever made, the notice says unavailable", async () => {
  const p = page({ sessions: [json(200, SIGNED_OUT)] });
  await submitEmail(p, "dee@example.test");
  assert.deepStrictEqual(emailPosts(p), []);
  assert.match(p.q("[data-auth-notice]").textContent, /isn’t available yet/);
  assert.strictEqual(p.q("[data-step='sent']").hidden, true);
});

test("email provider on: POSTs email, intent and return path, then shows the sent state", async () => {
  const p = page({ sessions: [json(200, EMAIL_ON)] });
  await submitEmail(p, "  dee@example.test ", "signup");
  const posts = emailPosts(p);
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].method, "POST");
  assert.strictEqual(posts[0].credentials, "same-origin");
  assert.strictEqual(posts[0].headers["Content-Type"], "application/json");
  assert.deepStrictEqual(JSON.parse(posts[0].body), { email: "dee@example.test", intent: "signup", returnTo: "/guides/" });
  assert.strictEqual(p.q("[data-step='sent']").hidden, false);
  assert.strictEqual(p.q("#auth-title").textContent, "Check your email");
  const lede = p.q("#auth-lede");
  assert.strictEqual(lede.querySelector("strong").textContent, "dee@example.test");
  assert.match(lede.textContent, /^We sent a sign-in link to dee@example\.test\. Open it in this browser to finish signing in\./);
  assert.doesNotMatch(lede.textContent, /this device/);
});

test("email sent state writes the address as text, never markup", async () => {
  const hostile = "<b>x</b>@example.test";
  const p = page({ sessions: [json(200, EMAIL_ON)] });
  await submitEmail(p, hostile); // the stub throws on any other innerHTML write
  const strong = p.q("#auth-lede").querySelector("strong");
  assert.strictEqual(strong.textContent, hostile);
  assert.strictEqual(strong.children.length, 0);
});

test("email start failures map to the existing messages", async () => {
  const cases = [
    [() => json(400, { error: "invalid_request" }), "That email address wasn’t accepted. Check it and try again."],
    [() => json(429, { error: "rate_limited" }), "Too many attempts. Wait a few minutes, then try again."],
    [() => json(503, { error: "auth_unavailable" }), "Something went wrong. Please try again."],
    [() => { throw new TypeError("network down"); }, "Something went wrong. Please try again."],
  ];
  for (const [emailStart, message] of cases) {
    const p = page({ sessions: [json(200, EMAIL_ON)], emailStart });
    await submitEmail(p, "dee@example.test");
    assert.strictEqual(p.q("#auth-email-error").textContent, message);
    assert.strictEqual(p.q("[data-step='sent']").hidden, true);
    assert.strictEqual(p.q(".auth__submit").disabled, false, "button re-enabled");
  }
});

test("already signed in (e.g. in another tab): no email is sent, dialog closes, header redrawn", async () => {
  const messages = [];
  const p = page({
    sessions: [json(200, EMAIL_ON), json(200, { ...signedIn(USER), providers: { google: true, email: true } })],
    toast: (m) => messages.push(m),
  });
  const dialog = await submitEmail(p, "dee@example.test");
  assert.deepStrictEqual(emailPosts(p), []);
  assert.strictEqual(dialog.open, false);
  assert.deepStrictEqual(messages, ["You’re already signed in."]);
  assert.strictEqual(p.state(), "signed-in");
});

test("?auth_error=link from the email verify endpoint has its own message", async () => {
  const got = [];
  const p = page({ search: "?auth_error=link", toast: (m) => got.push(m) });
  assert.strictEqual(p.replaced(), "/guides/");
  await settle();
  assert.deepStrictEqual(got, [
    "That sign-in link is invalid or has expired, or was opened in a different browser. Request a new one.",
  ]);
});

test("email flow touches no browser storage", async () => {
  const p = page({ sessions: [json(200, EMAIL_ON)] });
  await submitEmail(p, "dee@example.test");
  assert.deepStrictEqual(p.storageTouches, []);
});
