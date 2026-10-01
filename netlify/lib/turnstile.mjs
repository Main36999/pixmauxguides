/**
 * netlify/lib/turnstile.mjs — Cloudflare Turnstile for the email sign-in
 * request (docs/CLOUDFLARE-SECURITY.md).
 *
 * SERVER ONLY. Turnstile is used on its own: bpozz.com is not behind
 * Cloudflare's proxy, and nothing here depends on it being so.
 *
 *   browser  renders the widget with the public sitekey, gets a token
 *   browser  POST /api/auth/email/start {…, turnstileToken}
 *   BPOZZ    POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 *            {secret, response, remoteip?}          — this file
 *   BPOZZ    only then asks Supabase to send the email
 *
 * A token proves nothing until Siteverify has accepted it: the browser's
 * own "success" is never trusted. Tokens are single use and live 300
 * seconds (Cloudflare's rules), so nothing is cached and nothing is retried.
 *
 * Two environment variables, both or neither:
 *
 *   TURNSTILE_SITE_KEY    public — sent to the browser by /api/auth/session
 *   TURNSTILE_SECRET_KEY  SERVER-ONLY SECRET — sent to Siteverify, nowhere else
 *
 * With neither set the check is off and the email flow behaves exactly as
 * it did before this file existed. With only one set the email flow is
 * closed (503) rather than left unprotected or left asking for a token no
 * browser can obtain.
 */

import { logProblem } from "./auth.mjs";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * The widget's `action`, echoed back by Siteverify: a token minted for any
 * other widget use is refused. src/client/auth.js renders with the same
 * value. (Turnstile allows letters, digits, "_" and "-", 32 at most.)
 */
export const TURNSTILE_ACTION = "email-start";

/** Cloudflare's documented maximum token length. */
export const MAX_TOKEN_LENGTH = 2048;

const SITEVERIFY_TIMEOUT_MS = 5000;
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,200}$/;
// Printable ASCII, no spaces: the token is opaque, so only its size and
// that it is one clean header-safe value are checked here.
const TOKEN_SHAPE = /^[\x21-\x7E]+$/;
const ERROR_CODE = /^[a-z0-9-]{1,64}$/;
// Siteverify refusals that are OUR fault or Cloudflare's, not the visitor's.
const SERVER_SIDE_ERRORS = ["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"];

function envString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Whether the Turnstile check applies:
 *
 *   { state: "off" }                         neither variable is set
 *   { state: "on", siteKey, secretKey }      both set and well formed
 *   { state: "invalid", problem }            anything else — `problem` names
 *                                            the variable, never its value
 */
export function turnstileConfig(env = process.env) {
  const siteKey = envString(env.TURNSTILE_SITE_KEY);
  const secretKey = envString(env.TURNSTILE_SECRET_KEY);
  if (!siteKey && !secretKey) return { state: "off" };
  if (!siteKey) return { state: "invalid", problem: "TURNSTILE_SECRET_KEY is set but TURNSTILE_SITE_KEY is missing" };
  if (!secretKey) return { state: "invalid", problem: "TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY is missing" };
  if (!KEY_SHAPE.test(siteKey)) return { state: "invalid", problem: "TURNSTILE_SITE_KEY is malformed" };
  if (!KEY_SHAPE.test(secretKey)) return { state: "invalid", problem: "TURNSTILE_SECRET_KEY is malformed" };
  // The sitekey is published to every visitor. The same value in both
  // variables means the secret was pasted into the public one.
  if (siteKey === secretKey) {
    return { state: "invalid", problem: "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be different values" };
  }
  return { state: "on", siteKey, secretKey };
}

/** Cheap shape check, so garbage is never forwarded to Siteverify. */
export function looksLikeTurnstileToken(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TOKEN_LENGTH &&
    TOKEN_SHAPE.test(value)
  );
}

function errorCodesOf(body) {
  const codes = body && body["error-codes"];
  if (!Array.isArray(codes)) return [];
  return codes.filter((code) => typeof code === "string" && ERROR_CODE.test(code));
}

/**
 * Asks Cloudflare whether `token` is a solved challenge for this site.
 *
 *   "ok"           Siteverify accepted it, for this hostname and action
 *   "invalid"      refused: wrong, expired, already used, or minted for
 *                  another hostname or action — the visitor may try again
 *   "unavailable"  unreachable, timed out, 5xx, not JSON, or Cloudflare
 *                  rejecting OUR secret — a server problem, logged without
 *                  values. The email is NOT sent: this check fails closed.
 *
 * `hostname` is the host of AUTH_ORIGIN. `remoteIp` is optional and passed
 * through only when it looks like an address.
 */
export async function verifyTurnstile(settings, token, { hostname, remoteIp } = {}) {
  const payload = { secret: settings.secretKey, response: token };
  if (typeof remoteIp === "string" && /^[0-9A-Fa-f:.]{2,45}$/.test(remoteIp)) {
    payload.remoteip = remoteIp;
  }

  let res;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
  } catch {
    logProblem("turnstile", "Siteverify request failed or timed out");
    return "unavailable";
  }

  if (res.status >= 500) {
    logProblem("turnstile", `Siteverify responded ${res.status}`);
    return "unavailable";
  }
  let body;
  try {
    body = await res.json();
  } catch {
    logProblem("turnstile", "Siteverify returned a non-JSON response");
    return "unavailable";
  }
  if (!body || typeof body !== "object") {
    logProblem("turnstile", "Siteverify returned an unexpected response");
    return "unavailable";
  }

  if (body.success !== true) {
    const codes = errorCodesOf(body);
    if (codes.some((code) => SERVER_SIDE_ERRORS.includes(code))) {
      // Fixed machine strings from Cloudflare ([a-z0-9-] only).
      logProblem("turnstile", `Siteverify refused the request (${codes.join(", ")}): check TURNSTILE_SECRET_KEY`);
      return "unavailable";
    }
    return "invalid";
  }

  // A real, unspent token — but was it solved on this site, for this form?
  if (body.hostname !== hostname) {
    logProblem("turnstile", "token was issued for another hostname");
    return "invalid";
  }
  if (body.action !== TURNSTILE_ACTION) {
    logProblem("turnstile", "token was issued for another action");
    return "invalid";
  }
  return "ok";
}
