/**
 * POST /api/auth/email/start   {"email", "intent"?, "returnTo"?}
 *
 * Asks Supabase to email a sign-in link. Called with fetch from the dialog
 * (src/client/auth.js), only after /api/auth/session reported
 * providers.email === true.
 *
 *   200 { "sent": true }          + Set-Cookie __Host-bpozz_email
 *                                   also for refusals that would reveal
 *                                   whether the address has an account
 *   400 { "error": "invalid_request" }   not JSON, too big, bad email
 *   403 { "error": "forbidden" }         Origin is not exactly AUTH_ORIGIN
 *   403 { "error": "challenge_failed" }  Turnstile on, and the token is
 *                                        missing, malformed or refused by
 *                                        Cloudflare
 *   405 { "error": "method_not_allowed" }
 *   429 { "error": "rate_limited" }      Supabase's email limits
 *   503 { "error": "auth_unavailable" }  AUTH_EMAIL_ENABLED off, not
 *                                        configured, Email disabled in
 *                                        Supabase, Supabase down, or
 *                                        Turnstile half-configured or
 *                                        Siteverify unreachable
 *
 * With AUTH_EMAIL_ENABLED off nothing is sent to Supabase at all. The email
 * address is never logged.
 *
 * Turnstile (netlify/lib/turnstile.mjs) applies only while TURNSTILE_SITE_KEY
 * and TURNSTILE_SECRET_KEY are both set: the body must then carry
 * `turnstileToken`, and Cloudflare's Siteverify must accept it before
 * Supabase is asked to send anything. With neither variable set this
 * function behaves exactly as it did without the check.
 */

import { EMAIL_COOKIE, json, logProblem, setCookie } from "../lib/auth.mjs";
import {
  EMAIL_TTL_SECONDS,
  emailAvailable,
  emailConfig,
  newEmailTransaction,
  originAllowed,
  readStartBody,
  requestEmailOtp,
  sealEmailTransaction,
} from "../lib/email.mjs";
import { turnstileConfig, verifyTurnstile } from "../lib/turnstile.mjs";

// Netlify code-based rate limit, per IP and domain: a few sends a minute is
// plenty for a person. Supabase's own per-address and per-project email
// limits stay the authority behind it.
//
// Every value here must be a literal: Netlify reads this object statically at
// deploy time and silently drops anything it can't evaluate — an imported
// constant as `path` left this function without its /api route.
export const config = {
  path: "/api/auth/email/start",
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

const UNAVAILABLE = Object.freeze({ error: "auth_unavailable" });
const CHALLENGE_FAILED = Object.freeze({ error: "challenge_failed" });

export default async function emailStart(request, context) {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
  }

  const settings = emailConfig();
  if (!settings.ok) {
    logProblem("email-start", `email sign-in is off or not configured (${settings.problem})`);
    return json(503, UNAVAILABLE);
  }
  const challenge = turnstileConfig();
  if (challenge.state === "invalid") {
    logProblem("email-start", `Turnstile is not configured (${challenge.problem})`);
    return json(503, UNAVAILABLE);
  }
  if (!originAllowed(request, settings)) {
    return json(403, { error: "forbidden" });
  }

  const body = await readStartBody(request, { turnstile: challenge.state === "on" });
  if (!body.ok) return json(400, { error: "invalid_request" });
  if (challenge.state === "on" && !body.turnstileToken) return json(403, CHALLENGE_FAILED);

  if (!(await emailAvailable(settings))) {
    logProblem("email-start", "Email is not enabled in Supabase, or Supabase is unreachable");
    return json(503, UNAVAILABLE);
  }

  // Cloudflare decides whether the challenge was solved — before Supabase
  // is asked to send anything, and failing closed if it can't be asked.
  if (challenge.state === "on") {
    const verdict = await verifyTurnstile(challenge, body.turnstileToken, {
      hostname: new URL(settings.origin).hostname,
      remoteIp: context && context.ip,
    });
    if (verdict === "invalid") return json(403, CHALLENGE_FAILED);
    if (verdict !== "ok") return json(503, UNAVAILABLE);
  }

  const outcome = await requestEmailOtp(settings, body.email);
  if (outcome === "sent") {
    // The same answer, cookie included, whether or not the address has an
    // account.
    const transaction = newEmailTransaction(body.returnTo);
    return json(200, { sent: true }, undefined, [
      setCookie(EMAIL_COOKIE, sealEmailTransaction(transaction, settings.cookieSecret), EMAIL_TTL_SECONDS),
    ]);
  }
  if (outcome === "invalid") return json(400, { error: "invalid_request" });
  if (outcome === "limited") return json(429, { error: "rate_limited" });
  return json(503, UNAVAILABLE);
}
