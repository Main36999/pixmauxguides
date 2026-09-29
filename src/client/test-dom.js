/**
 * test-dom.js — a small DOM, storage and fetch stand-in for client tests
 * that run a real src/client script in a vm (saved.test.js, and the page
 * tests that follow it). Test support only: build.js never publishes it,
 * and package.json's test list names the tests, not this file.
 *
 * The same idea as the stub inside auth.test.js, shared instead of copied:
 * elements with attributes, children, text and listeners; a selector engine
 * for the compound selectors the scripts use (tag, .class, #id, [attr],
 * [attr="value"], and descendant chains); and an innerHTML that throws, so
 * nothing from a server or from storage can reach a page as markup without
 * a test failing.
 */

"use strict";

// ---------------------------------------------------------------------
// selectors
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
  if (!el || !el.getAttribute) return false;
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

// ---------------------------------------------------------------------
// document
// ---------------------------------------------------------------------

function makeDocument() {
  const doc = { activeElement: null, visibilityState: "visible", _listeners: {} };

  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this._attrs = new Map();
      this._text = null;
      this._listeners = {};
      this.style = {};
    }
    setAttribute(n, v) { this._attrs.set(n, String(v)); }
    getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
    hasAttribute(n) { return this._attrs.has(n); }
    removeAttribute(n) { this._attrs.delete(n); }
    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this.getAttribute("class") || ""; }
    set className(v) { this.setAttribute("class", v); }
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
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
    }
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
      const walk = (n) => n.children.forEach((c) => {
        if (c.getAttribute && matches(c, selector)) out.push(c);
        if (c.children) walk(c);
      });
      walk(this);
      return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get isConnected() {
      let n = this;
      while (n.parentNode) n = n.parentNode;
      return n === doc.documentElement;
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
  doc.removeEventListener = (type, fn) => {
    doc._listeners[type] = (doc._listeners[type] || []).filter((f) => f !== fn);
  };
  return doc;
}

/** A click, keydown, … on `target`, bubbling up to the document. */
function fire(doc, target, type, extra = {}) {
  const evt = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  for (let n = target; n; n = n.parentNode) ((n._listeners && n._listeners[type]) || []).forEach((fn) => fn(evt));
  (doc._listeners[type] || []).forEach((fn) => fn(evt));
  return evt;
}

/** An event dispatched on the document itself, such as bpozz:session. */
function dispatch(doc, type, detail) {
  const evt = { type, detail };
  (doc._listeners[type] || []).forEach((fn) => fn(evt));
  return evt;
}

// ---------------------------------------------------------------------
// storage and network
// ---------------------------------------------------------------------

/**
 * A Storage whose every call is logged as [area, "get"|"set"|"remove", key].
 * `throws` makes every call fail, as blocked site data does.
 */
function makeStorage(area, log, { initial = {}, throws = false } = {}) {
  const data = new Map(Object.entries(initial));
  const call = (op, key, fn) => {
    log.push([area, op, key]);
    if (throws) throw new Error(`${area} is blocked`);
    return fn();
  };
  return {
    getItem: (key) => call("get", key, () => (data.has(key) ? data.get(key) : null)),
    setItem: (key, value) => call("set", key, () => void data.set(key, String(value))),
    removeItem: (key) => call("remove", key, () => void data.delete(key)),
    dump: () => Object.fromEntries(data),
  };
}

/** A fetch Response: JSON unless `contentType` says otherwise. */
function response(status, body, contentType = "application/json; charset=utf-8") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    json: () =>
      body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(JSON.parse(JSON.stringify(body))),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise chains run to the end. */
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { matches, makeDocument, fire, dispatch, makeStorage, response, deferred, settle, wait };
