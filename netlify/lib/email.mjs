/**
 * netlify/lib/email.mjs — the email magic-link sign-in (Phase 4A).
 *
 * SERVER ONLY. Flow (docs/AUTH.md):
 *
 *   1. POST /api/auth/email/start {email, returnTo}
 *        -> Supabase POST /auth/v1/otp {email, create_user: true}
 *        -> Set-Cookie __Host-bpozz_email = signed {returnTo, expiresAt}
 *   2. Supabase emails a link built by the project's email templates:
 *        https://bpozz.com/api/auth/email/verify?token_hash=…&type=email
 *   3. GET  /api/auth/email/verify   a confirmation page; consumes nothing,
 *                                     so mail scanners that prefetch links
 *                                     can't burn the one-time token
 *   4. POST /api/auth/email/verify   Supabase POST /auth/v1/verify
 *                                     {type: "email", token_hash} -> the
 *                                     usual session cookies
 *
 * Nothing here is shared with the Google flow's oauth.mjs: the email cookie
 * has its own shape and its own MAC context, so neither cookie can be
 * replayed as the other.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  HSTS,
  emailEnabledInSupabase,
  emailFlagEnabled,
  logProblem,
  oauthConfig,
  safeReturnTo,
  supabaseCall,
} from "./auth.mjs";
import { looksLikeTurnstileToken } from "./turnstile.mjs";

export const START_PATH = "/api/auth/email/start";
export const VERIFY_PATH = "/api/auth/email/verify";

/**
 * Lifetime of the in-flight email cookie. Matches Supabase's default (and
 * maximum recommended) email OTP expiry of one hour; Supabase's own expiry
 * decides whether a link still works, this only has to outlive it.
 */
export const EMAIL_TTL_SECONDS = 60 * 60;

export const MAX_BODY_BYTES = 2048;
// The start request's limit while the Turnstile check is on: the same 2 KB
// plus room for one token (2,048 characters at most).
export const MAX_START_BODY_BYTES_WITH_TOKEN = 4096;
export const MAX_EMAIL_LENGTH = 254;

// Supabase Auth: token_hash = hex(SHA-224(email + otp)) — exactly 56
// lowercase hex characters (internal/crypto GenerateTokenHash).
const TOKEN_HASH_SHAPE = /^[0-9a-f]{56}$/;
// A deliberately plain shape check: one @, a dot in the domain, no spaces,
// controls or characters that have no business in an address. Supabase
// does the real validation.
const EMAIL_SHAPE = /^[^\s@<>()[\]\\,;:"\u0000-\u001f\u007f]+@[^\s@<>()[\]\\,;:"\u0000-\u001f\u007f]+\.[^\s@<>()[\]\\,;:"\u0000-\u001f\u007f]+$/;
const INTENTS = ["signin", "signup"];
const MAC_CONTEXT = "bpozz-email-v1.";

/**
 * Everything the email flow needs, or { ok: false, problem }. The same four
 * variables as Google (oauthConfig) plus the AUTH_EMAIL_ENABLED switch.
 * Supabase's own Email-provider switch is checked separately
 * (emailAvailable) because it costs a request.
 */
export function emailConfig(env = process.env) {
  if (!emailFlagEnabled(env)) return { ok: false, problem: "AUTH_EMAIL_ENABLED is not \"true\"" };
  return oauthConfig(env);
}

/** Config valid, flag on, and Supabase reports the Email provider on. */
export async function emailAvailable(settings) {
  return settings.ok && (await emailEnabledInSupabase(settings));
}

/**
 * CSRF check for both POSTs: the Origin header must be exactly AUTH_ORIGIN.
 * Stricter than sign-out's isSameOriginRequest (no fallback to the
 * request's own host), because these endpoints start or finish a sign-in.
 */
export function originAllowed(request, settings) {
  return request.headers.get("origin") === settings.origin;
}

export function looksLikeTokenHash(value) {
  return typeof value === "string" && TOKEN_HASH_SHAPE.test(value);
}

export function looksLikeEmail(value) {
  return typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(value);
}

// ---------------------------------------------------------------------
// the start request
// ---------------------------------------------------------------------

/**
 * Reads and validates the start request's JSON body.
 *   { ok: true, email, returnTo, turnstileToken } or { ok: false }
 * The email is trimmed but otherwise sent to Supabase as typed.
 *
 * `turnstile` is true while the Turnstile check is on (turnstile.mjs). Only
 * then is `turnstileToken` read: a well-formed token, or null when it is
 * missing or malformed — the caller refuses that separately, so a failed
 * challenge is never reported as a bad email address. With the check off
 * the field is ignored and the 2 KB limit is unchanged.
 */
export async function readStartBody(request, { turnstile = false } = {}) {
  const maxBytes = turnstile ? MAX_START_BODY_BYTES_WITH_TOKEN : MAX_BODY_BYTES;
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) return { ok: false };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };

  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false };

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  if (typeof body.email !== "string") return { ok: false };
  const email = body.email.trim();
  if (!looksLikeEmail(email)) return { ok: false };
  // intent only picks the dialog's wording; Supabase signs in or signs up
  // the same way for both (as with Google). Anything else is a bad request.
  if (body.intent !== undefined && !INTENTS.includes(body.intent)) return { ok: false };
  if (body.returnTo !== undefined && typeof body.returnTo !== "string") return { ok: false };
  const turnstileToken =
    turnstile && looksLikeTurnstileToken(body.turnstileToken) ? body.turnstileToken : null;
  return { ok: true, email, returnTo: safeReturnTo(body.returnTo), turnstileToken };
}

/**
 * Supabase POST /auth/v1/otp {email, create_user: true}. The answer is
 * reduced to what the browser may learn — never whether the address
 * already has an account:
 *
 *   "sent"         200, and every refusal that would reveal whether the
 *                  address exists (422 signups disabled / otp_disabled,
 *                  403, 404) — masked as a send
 *   "invalid"      400: Supabase rejected the address itself
 *   "limited"      429: per-address or project email rate limit
 *   "unavailable"  unreachable, 5xx, a rejected API key, or a 400 that
 *                  means the project's mailer refuses the address
 *                  (email_address_not_authorized: no custom SMTP yet)
 */
export async function requestEmailOtp(settings, email) {
  const result = await supabaseCall(settings, "email-start", "/otp", {
    method: "POST",
    body: { email, create_user: true },
  });
  if (result.outcome === "ok") return "sent";
  if (result.status === 429) return "limited";
  if (result.outcome === "invalid") {
    // The status and Supabase's error_code are fixed machine strings
    // (errorCodeOf allows [a-z0-9_] only) — never the address.
    const code = `${result.status} ${result.errorCode || "no error_code"}`;
    if (result.status === 400 && result.errorCode === "email_address_not_authorized") {
      logProblem("email-start", "Supabase's mailer refused the address: custom SMTP is not configured");
      return "unavailable";
    }
    if (result.status === 400) {
      logProblem("email-start", `Supabase rejected the request (${code})`);
      return "invalid";
    }
    logProblem("email-start", `Supabase refused the request; answered as sent (${code})`);
    return "sent";
  }
  return "unavailable";
}

// ---------------------------------------------------------------------
// the in-flight email cookie
// ---------------------------------------------------------------------

function mac(secret, data) {
  return createHmac("sha256", secret).update(MAC_CONTEXT + data).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A new email sign-in for an already-safe return path. */
export function newEmailTransaction(returnTo, nowMs = Date.now()) {
  return { v: 1, returnTo, expiresAt: Math.floor(nowMs / 1000) + EMAIL_TTL_SECONDS };
}

/**
 * base64url(JSON) + "." + HMAC-SHA256. Signed, not encrypted: it holds only
 * a return path and an expiry, and is HttpOnly. No email address, no token.
 */
export function sealEmailTransaction(transaction, secret) {
  const data = Buffer.from(JSON.stringify(transaction)).toString("base64url");
  return `${data}.${mac(secret, data)}`;
}

/** { status: "ok", transaction } or { status: "missing" | "invalid" | "expired" }. */
export function openEmailTransaction(value, secret, nowMs = Date.now()) {
  if (value === undefined || value === "") return { status: "missing" };
  if (typeof value !== "string" || value.length > 4096) return { status: "invalid" };
  const parts = value.split(".");
  if (parts.length !== 2 || !safeEqual(parts[1], mac(secret, parts[0]))) {
    return { status: "invalid" };
  }
  let tx;
  try {
    tx = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return { status: "invalid" };
  }
  const shapeOk =
    tx &&
    typeof tx === "object" &&
    tx.v === 1 &&
    typeof tx.returnTo === "string" &&
    safeReturnTo(tx.returnTo, null) === tx.returnTo &&
    Number.isInteger(tx.expiresAt) &&
    Object.keys(tx).length === 3;
  if (!shapeOk) return { status: "invalid" };
  if (tx.expiresAt * 1000 <= nowMs) return { status: "expired" };
  return { status: "ok", transaction: tx };
}

// ---------------------------------------------------------------------
// the confirmation page
// ---------------------------------------------------------------------

/**
 * Security headers for the confirmation page. Sent by the function itself —
 * public/_headers is not relied on for function responses.
 *
 * Referrer-Policy is `same-origin`, not `no-referrer`: under no-referrer
 * browsers send `Origin: null` on the page's form POST, which would fail
 * the exact-Origin CSRF check. same-origin still sends no Referer to any
 * other site, and the page loads nothing from any other site anyway.
 */
export const PAGE_HEADERS = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
  "Strict-Transport-Security": HSTS,
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
});

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The page behind the emailed link: one button that POSTs the token back.
 * No script, no external asset, no analytics. The token hash has already
 * passed looksLikeTokenHash() and is escaped anyway; returnTo has passed
 * safeReturnTo().
 */
export function confirmationPage(tokenHash, returnTo) {
  const token = escapeHtml(tokenHash);
  const cancel = escapeHtml(returnTo);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in to BPOZZ</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#18181b;--muted:#52525b;--line:#e4e4e7;--btn:#18181b;--btn-fg:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f10;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a;--btn:#f4f4f5;--btn-fg:#18181b}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:400px;border:1px solid var(--line);border-radius:16px;padding:32px 24px;text-align:center}
.brand{margin:0 0 20px;font-weight:700;letter-spacing:.08em;font-size:14px}
h1{margin:0 0 8px;font-size:24px;line-height:1.25}
p{margin:0 0 24px;color:var(--muted)}
button{width:100%;min-height:48px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-fg);font:inherit;font-weight:600;cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--fg);outline-offset:3px}
a{display:inline-block;margin-top:16px;color:var(--muted)}
</style>
</head>
<body>
<main>
<p class="brand">BPOZZ</p>
<h1>Sign in to BPOZZ</h1>
<p>Continue to finish signing in with your email link.</p>
<form method="post" action="${VERIFY_PATH}">
<input type="hidden" name="token_hash" value="${token}">
<button type="submit">Continue</button>
</form>
<a href="${cancel}">Cancel</a>
</main>
</body>
</html>
`;
}

/**
 * token_hash from the confirmation page's POST (form-urlencoded), or null.
 * The body is tiny; anything bigger, or of another type, is refused.
 */
export async function readVerifyForm(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!/^application\/x-www-form-urlencoded\s*(;|$)/.test(type)) return null;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  let text;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
  const value = new URLSearchParams(text).get("token_hash");
  return looksLikeTokenHash(value) ? value : null;
}
