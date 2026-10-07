/**
 * netlify/lib/client-error.mjs — the server half of the client error beacon:
 * POST /api/client-error (netlify/functions/client-error.mjs), sent by
 * src/client/error-beacon.js.
 *
 * SERVER ONLY. Nothing under netlify/ is published to dist/ or bundled into
 * /app.js; Netlify bundles this file into the function that imports it.
 *
 * Every other function logs fixed text only (logProblem in auth.mjs). This
 * one logs text a browser sent, so nothing in a report is trusted:
 *
 *   - the body must be JSON, at most MAX_BODY_BYTES, with exactly the keys
 *     in REPORT_KEYS, each of the right type and within LIMITS. Anything
 *     else is refused whole, never trimmed into shape;
 *   - every text field is redacted again here (redact below), with the same
 *     rules in the same order as the browser. This copy is the authority;
 *   - the record is logged as one line, "[client-error] " + JSON, so a
 *     report cannot start a line of its own, and LIMITS bound its length.
 *
 * Nothing about the request itself is logged: no header, no IP address, no
 * cookie, no referrer. The one value taken from a header is `browser`, a
 * four-way family worked out from User-Agent; User-Agent is never logged.
 */

import { HSTS } from "./auth.mjs";

/** Largest accepted body, in bytes. The browser never sends more. */
export const MAX_BODY_BYTES = 2048;

/** The payload's keys, all required, no others (error-beacon.js header). */
export const REPORT_KEYS = Object.freeze(["v", "kind", "name", "message", "source", "line", "col", "stack", "page"]);

export const LIMITS = Object.freeze({
  name: 40,
  message: 300,
  source: 120,
  stack: 1000,
  stackLines: 5,
  page: 200,
  position: 1000000,
});

export const INVALID = Object.freeze({ error: "invalid_request" });

/** The 204's headers: json()'s, minus a body type (auth.mjs AUTH_HEADERS). */
export const NO_CONTENT_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Strict-Transport-Security": HSTS,
  "X-Content-Type-Options": "nosniff",
});

const NAME = /^[A-Za-z]{1,40}$/;
const SOURCE = /^\/[A-Za-z0-9/_.-]*\.js$/;

// Redaction — the same rules, in the same order, as src/client/error-beacon.js.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/g;
const ABSOLUTE_URL = /\b(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|data:|blob:)[^\s"'<>()]*/g;
const RELATIVE_QUERY = /(^|[\s"'(@])(\/[^\s"'<>()?#]*)[?#][^\s"'<>()]*/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN = /[A-Za-z0-9_+=-]{24,}/g;
const QUOTED = /"[^"]*"/g;
const POSITION = /(?::\d+){1,2}$/;

/** The switch: CLIENT_ERRORS_ENABLED must be exactly "true". */
export function clientErrorsEnabled(env = process.env) {
  return env.CLIENT_ERRORS_ENABLED === "true";
}

export function noContent() {
  return new Response(null, { status: 204, headers: NO_CONTENT_HEADERS });
}

// ---------------------------------------------------------------------
// request parsing and validation
// ---------------------------------------------------------------------

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function isText(value, max) {
  return typeof value === "string" && value.length <= max;
}

function isPosition(value) {
  return Number.isInteger(value) && value >= 0 && value <= LIMITS.position;
}

/** Exactly the payload error-beacon.js builds: keys, types and lengths. */
export function isValidReport(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, REPORT_KEYS)) return false;
  const { v, kind, name, message, source, line, col, stack, page } = value;
  return (
    v === 1 &&
    (kind === "error" || kind === "rejection") &&
    typeof name === "string" &&
    NAME.test(name) &&
    isText(message, LIMITS.message) &&
    isText(source, LIMITS.source) &&
    (source === "" || source === "[inline]" || SOURCE.test(source)) &&
    isPosition(line) &&
    isPosition(col) &&
    isText(stack, LIMITS.stack) &&
    stack.split("\n").length <= LIMITS.stackLines &&
    isText(page, LIMITS.page) &&
    page.startsWith("/")
  );
}

/** { ok: true, value } for a valid report, else { ok: false }. */
export async function readReport(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) return { ok: false };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false };
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  return isValidReport(value) ? { ok: true, value } : { ok: false };
}

// ---------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------

/**
 * `text` with every redaction rule applied, then cut to `max`. `origin` is
 * the site's own origin (the request's checked Origin): a URL there keeps
 * its path and a stack frame's :line:col, any other URL is [external].
 */
export function redact(text, max, origin) {
  const cleanUrl = (url) => {
    const position = POSITION.exec(url);
    const tail = position ? position[0] : "";
    let parsed;
    try {
      parsed = new URL(tail ? url.slice(0, -tail.length) : url);
    } catch {
      return "[external]";
    }
    const web = parsed.protocol === "https:" || parsed.protocol === "http:";
    return web && parsed.origin === origin ? parsed.pathname + tail : "[external]";
  };
  const cleanToken = (run) => (/[A-Za-z]/.test(run) && /[0-9]/.test(run) ? "[token]" : run);
  const out = String(text)
    .replace(CONTROL, " ")
    .replace(ABSOLUTE_URL, cleanUrl)
    .replace(RELATIVE_QUERY, "$1$2")
    .replace(EMAIL, "[email]")
    .replace(TOKEN, cleanToken)
    .replace(QUOTED, '"[…]"');
  return out.length > max ? out.slice(0, max) : out;
}

function redactStack(stack, origin) {
  const lines = [];
  for (const line of stack.split(/\r?\n/)) {
    const clean = redact(line, LIMITS.stack, origin).trim();
    if (clean && lines.length < LIMITS.stackLines) lines.push(clean);
  }
  const out = lines.join("\n");
  return out.length > LIMITS.stack ? out.slice(0, LIMITS.stack) : out;
}

/** The log record for a valid report: every text field redacted again. */
export function cleanReport(report, origin) {
  const source =
    report.source === "" || report.source === "[inline]" || redact(report.source, LIMITS.source, origin) === report.source
      ? report.source
      : "";
  return {
    kind: report.kind,
    name: report.name,
    message: redact(report.message, LIMITS.message, origin),
    source,
    line: report.line,
    col: report.col,
    stack: redactStack(report.stack, origin),
    page: redact(report.page, LIMITS.page, origin),
  };
}

/** chromium | firefox | safari | other. Every iOS browser runs WebKit. */
export function browserFamily(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return "safari";
  if (/\bFirefox\//.test(ua)) return "firefox";
  if (/\b(?:Chrome|Chromium)\//.test(ua)) return "chromium";
  if (/\bSafari\//.test(ua)) return "safari";
  return "other";
}

/** The one log line per accepted report. */
export function logReport(record) {
  console.error(`[client-error] ${JSON.stringify(record)}`);
}
