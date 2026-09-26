/**
 * auth.test.js — header auth state in src/client/auth.js.
 *
 * Runs the real auth.js in a vm context (the search.test.js convention)
 * against a small DOM stub. The stub throws if anything sets innerHTML, so a
 * header drawn from server data can't get there by HTML injection, and it
 * records every touch of localStorage, sessionStorage and document.cookie.
 *
 * The dialog itself (built with innerHTML from a fixed template) is not
 * opened here; its entry point is checked at source level.
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
function page({ sessions = [json(200, SIGNED_OUT)], signout = () => json(200, { signed_out: true }), search = "", hash = "", toast = null, hang = false } = {}) {
  const doc = makeDocument();
  buildHeader(doc);
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
    document: doc,
    location: { pathname: "/guides/", search, hash, assign() { throw new Error("navigated"); } },
    history: { state: null, replaceState: (_s, _t, url) => (replaced = url) },
    fetch: (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", credentials: init.credentials, body: init.body });
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
  assert.strictEqual(toggle.getAttribute("aria-label"), "Account: Dee Signer");
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
  const menu = p.doc.getElementById(toggle.getAttribute("aria-controls"));
  assert.ok(menu && menu.hidden, "menu starts closed");
  assert.strictEqual(p.q(".account__who-name").textContent, "Dee Signer");
  assert.strictEqual(p.q(".account__email").textContent, "dee@example.test");
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
  const p = page({ sessions: [json(200, signedIn({ ...USER, display_name: null }))] });
  await settle();
  assert.strictEqual(p.q(".account__name").textContent, "dee@example.test");
  assert.strictEqual(p.q(".account__who-name").textContent, "dee@example.test");
  assert.strictEqual(p.q(".account__email"), null, "email not repeated under itself");
  assert.strictEqual(p.q(".mobile-account__email"), null);
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
  });
  await settle(); // the DOM stub throws on any innerHTML write
  for (const selector of [".account__name", ".account__who-name", ".mobile-account__name"]) {
    const node = p.q(selector);
    assert.strictEqual(node.textContent, hostile);
    assert.strictEqual(node.children.length, 0, `${selector} has no child elements`);
  }
  assert.strictEqual(p.q(".account__email").textContent, "<b>x</b>@example.test");
  assert.strictEqual(p.q(".header-auth [data-account-toggle]").getAttribute("aria-label"), "Account: " + hostile);
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
  fire(p.doc, p.q(".account__who"), "click"); // inside: stays open
  assert.strictEqual(menu().hidden, false);
  fire(p.doc, p.doc.body, "click"); // outside: closes
  assert.strictEqual(menu().hidden, true);
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
