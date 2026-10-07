/**
 * error-beacon.js — reports this site's own uncaught script errors to
 * POST /api/client-error (netlify/functions/client-error.mjs).
 * -----------------------------------------------------------------------
 * A SELF-CONTAINED MODULE, NOT A FRAGMENT, shipped the way auth.js is:
 *
 *   - inside /app.js, as the FIRST of APP_BUNDLE's `modules`
 *     (src/build/build.js), so its listeners are in place before any other
 *     bpozz code on the page runs;
 *   - on its own at /error-beacon.js, for the seven pages that do not load
 *     /app.js (404, about, account, contact, hoysomrach, privacy, terms),
 *     ahead of their first site script.
 *
 * The window.BpozzErrorBeacon guard makes a second copy on the same page a
 * no-op. It reports only on bpozz.com: local builds and deploy previews
 * install no listener at all.
 *
 * ONE REPORT (the server accepts exactly these keys, nothing else)
 *
 *   v        1, the payload version
 *   kind     "error" (window error event) or "rejection" (unhandledrejection)
 *   name     the error's name, e.g. TypeError; "Error" when there is none
 *   message  the error message, redacted, at most 300 characters. For a
 *            rejection that is not an Error it is "[non-error: <typeof>]":
 *            the rejected value itself is never read
 *   source   the script's path on this site (no query, no fragment),
 *            "[inline]" for a script written into the page, or ""
 *   line     line and column, 0 when unknown
 *   col
 *   stack    at most 5 stack lines, redacted, at most 1,000 characters
 *   page     location.pathname, redacted, at most 200 characters; "/404" on
 *            the 404 page, whose path is whatever the visitor typed
 *
 * NEVER READ, NEVER SENT
 *
 * Cookies (the request goes with credentials: "omit"), the referrer
 * (referrerPolicy: "no-referrer"), the address's query string or fragment,
 * localStorage, sessionStorage, form fields, page text, and anything about
 * the visitor's account. Text that does go out is redacted first (redact
 * below): other sites' URLs become [external], this site's URLs lose their
 * query and fragment, email addresses become [email], token-like runs
 * become [token] and double-quoted text becomes "[…]". The server repeats
 * every rule, in the same order, and its copy is the one that counts.
 *
 * LIMITS AND FAILURE
 *
 * At most MAX_REPORTS reports per page load, each distinct error once. One
 * attempt each: no retry, no queue, no timer. Errors from another site's
 * script or a browser extension are dropped, not sent. Every failure is
 * silent — the listeners run inside try/catch, the request's promise is
 * caught, and the browser's own console reporting is left as it is.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  if (window.BpozzErrorBeacon || typeof document === "undefined") return;

  var ENDPOINT = "/api/client-error";
  var HOST = "bpozz.com";
  var MAX_REPORTS = 5;
  var MAX_BYTES = 2048;
  var MAX = { message: 300, source: 120, stack: 1000, stackLines: 5, page: 200, position: 1000000 };

  var active = location.hostname === HOST && typeof fetch === "function";
  window.BpozzErrorBeacon = { active: active };
  if (!active) return;

  // --- redaction (the server behind /api/client-error: same rules, order) ---

  var CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/g;
  var ABSOLUTE_URL = /\b(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|data:|blob:)[^\s"'<>()]*/g;
  var RELATIVE_QUERY = /(^|[\s"'(@])(\/[^\s"'<>()?#]*)[?#][^\s"'<>()]*/g;
  var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  var TOKEN = /[A-Za-z0-9_+=-]{24,}/g;
  var QUOTED = /"[^"]*"/g;
  var POSITION = /(?::\d+){1,2}$/;
  var NAME = /^[A-Za-z]{1,40}$/;
  var SOURCE = /^\/[A-Za-z0-9\/_.-]*\.js$/;

  // A URL on this site keeps its path (and a stack frame's :line:col); any
  // other URL, or one that will not parse, is replaced whole.
  function cleanUrl(url) {
    var position = POSITION.exec(url);
    var tail = position ? position[0] : "";
    var parsed;
    try {
      parsed = new URL(tail ? url.slice(0, -tail.length) : url);
    } catch (e) {
      return "[external]";
    }
    var web = parsed.protocol === "https:" || parsed.protocol === "http:";
    return web && parsed.origin === location.origin ? parsed.pathname + tail : "[external]";
  }

  // Long runs that mix letters and digits: JWT segments, hashes, codes.
  // A slug like mobile-breakpoints-device-categories has no digit and stays.
  function cleanToken(run) {
    return /[A-Za-z]/.test(run) && /[0-9]/.test(run) ? "[token]" : run;
  }

  function redact(text, max) {
    var out = String(text)
      .replace(CONTROL, " ")
      .replace(ABSOLUTE_URL, cleanUrl)
      .replace(RELATIVE_QUERY, "$1$2")
      .replace(EMAIL, "[email]")
      .replace(TOKEN, cleanToken)
      .replace(QUOTED, '"[…]"');
    return out.length > max ? out.slice(0, max) : out;
  }

  function redactStack(stack) {
    if (typeof stack !== "string") return "";
    var lines = [];
    stack.split(/\r?\n/).forEach(function (line) {
      var clean = redact(line, MAX.stack).trim();
      if (clean && lines.length < MAX.stackLines) lines.push(clean);
    });
    var out = lines.join("\n");
    return out.length > MAX.stack ? out.slice(0, MAX.stack) : out;
  }

  // --- report fields -----------------------------------------------------

  // Native errors and DOMExceptions in any realm; nothing else counts as one.
  function isError(value) {
    var tag = Object.prototype.toString.call(value);
    return tag === "[object Error]" || tag === "[object DOMException]";
  }

  function nameOf(error) {
    var name = isError(error) && typeof error.name === "string" ? error.name : "";
    return NAME.test(name) ? name : "Error";
  }

  function stackOf(error) {
    return isError(error) && typeof error.stack === "string" ? error.stack : "";
  }

  function position(value) {
    return typeof value === "number" && value >= 0 && value <= MAX.position && Math.floor(value) === value
      ? value
      : 0;
  }

  // null: not this site's script (another origin, an extension, data:).
  function sourceOf(filename) {
    if (!filename || typeof filename !== "string") return "";
    var parsed;
    try {
      parsed = new URL(filename, location.origin + "/");
    } catch (e) {
      return null;
    }
    var web = parsed.protocol === "https:" || parsed.protocol === "http:";
    if (!web || parsed.origin !== location.origin) return null;
    var path = parsed.pathname;
    if (!/\.js$/.test(path)) return "[inline]";
    return path.length <= MAX.source && SOURCE.test(path) && redact(path, MAX.source) === path ? path : "";
  }

  function pagePath() {
    if (document.querySelector && document.querySelector("main.notfound")) return "/404";
    return redact(location.pathname, MAX.page);
  }

  function fromErrorEvent(event) {
    var error = event.error;
    var message = typeof event.message === "string" ? event.message : "";
    if (!message && isError(error) && typeof error.message === "string") message = error.message;
    if (!message && !error) return null;
    // A script on another origin, its details withheld by the browser.
    if (/^(?:Uncaught )?Script error\.?$/.test(message.trim())) return null;
    var source = sourceOf(event.filename);
    if (source === null || source === "/error-beacon.js") return null;
    return {
      v: 1,
      kind: "error",
      name: nameOf(error),
      message: redact(message, MAX.message),
      source: source,
      line: position(event.lineno),
      col: position(event.colno),
      stack: redactStack(stackOf(error)),
      page: pagePath(),
    };
  }

  function fromRejection(event) {
    var reason = event.reason;
    var error = isError(reason);
    var stack = stackOf(reason);
    // Another site's code, judged by its stack: no frame from this origin.
    if (stack && stack.indexOf(location.origin + "/") === -1) return null;
    return {
      v: 1,
      kind: "rejection",
      name: nameOf(reason),
      message: error
        ? redact(typeof reason.message === "string" ? reason.message : "", MAX.message)
        : "[non-error: " + (reason === null ? "null" : typeof reason) + "]",
      source: "",
      line: 0,
      col: 0,
      stack: redactStack(stack),
      page: pagePath(),
    };
  }

  // --- sending -----------------------------------------------------------

  var sent = 0;
  var seen = Object.create(null);
  var busy = false;

  function byteLength(text) {
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;
  }

  // The JSON body, under MAX_BYTES: without its stack if it must be.
  function bodyOf(report) {
    var body = JSON.stringify(report);
    if (byteLength(body) <= MAX_BYTES) return body;
    report.stack = "";
    body = JSON.stringify(report);
    return byteLength(body) <= MAX_BYTES ? body : null;
  }

  function send(report) {
    var key = [report.kind, report.name, report.message, report.source, report.line, report.col].join("|");
    if (seen[key]) return;
    var body = bodyOf(report);
    if (!body) return;
    seen[key] = true;
    sent += 1;
    fetch(ENDPOINT, {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: body,
    }).catch(function () {});
  }

  function handle(build, event) {
    if (busy || sent >= MAX_REPORTS) return;
    busy = true;
    try {
      var report = event ? build(event) : null;
      if (report) send(report);
    } catch (e) {
      // Dropped. Reporting must never become an error of its own.
    }
    busy = false;
  }

  window.addEventListener("error", function (event) {
    handle(fromErrorEvent, event);
  });
  window.addEventListener("unhandledrejection", function (event) {
    handle(fromRejection, event);
  });
})();
