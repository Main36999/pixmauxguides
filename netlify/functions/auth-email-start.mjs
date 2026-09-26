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
 *   405 { "error": "method_not_allowed" }
 *   429 { "error": "rate_limited" }      Supabase's email limits
 *   503 { "error": "auth_unavailable" }  AUTH_EMAIL_ENABLED off, not
 *                                        configured, Email disabled in
 *                                        Supabase, or Supabase down
 *
 * With AUTH_EMAIL_ENABLED off nothing is sent to Supabase at all. The email
 * address is never logged.
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

export default async function emailStart(request) {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
  }

  const settings = emailConfig();
  if (!settings.ok) {
    logProblem("email-start", `email sign-in is off or not configured (${settings.problem})`);
    return json(503, UNAVAILABLE);
  }
  if (!originAllowed(request, settings)) {
    return json(403, { error: "forbidden" });
  }

  const body = await readStartBody(request);
  if (!body.ok) return json(400, { error: "invalid_request" });

  if (!(await emailAvailable(settings))) {
    logProblem("email-start", "Email is not enabled in Supabase, or Supabase is unreachable");
    return json(503, UNAVAILABLE);
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
