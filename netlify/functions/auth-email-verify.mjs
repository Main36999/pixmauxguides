/**
 * GET|POST /api/auth/email/verify
 *
 * The link in the sign-in email, as set in the Supabase email templates:
 *
 *   https://bpozz.com/api/auth/email/verify?token_hash={{ .TokenHash }}&type=email
 *
 * GET consumes nothing. Mail scanners that open links ahead of the reader
 * would otherwise burn the one-time token, so GET only answers with a page
 * whose Continue button POSTs the token back:
 *
 *   200 confirmation page             token_hash well formed + a valid
 *                                     __Host-bpozz_email cookie
 *   303 /?auth_error=link             malformed link, or no valid email
 *                                     cookie (expired, or another browser)
 *   303 /?auth_error=unavailable      email sign-in off or not configured
 *
 * POST (from that page) signs in:
 *
 *   403 { "error": "forbidden" }       Origin is not exactly AUTH_ORIGIN
 *   303 return_to                      + session cookies, email cookie
 *                                      cleared, any previous session
 *                                      revoked at Supabase
 *   303 …?auth_error=link              bad form, no valid email cookie, or
 *                                      Supabase refused the token (used,
 *                                      expired, invalid) — email cookie
 *                                      cleared
 *   303 …?auth_error=unavailable       not configured / Supabase down —
 *                                      email cookie kept, so the same link
 *                                      can be tried again
 *
 * return_to only ever comes from the signed cookie, never from the URL.
 */

import {
  EMAIL_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  json,
  logProblem,
  looksLikeAccessToken,
  looksLikeRefreshToken,
  parseCookies,
  redirect,
  refreshSession,
  revokeSession,
  sessionCookies,
  verifyEmailToken,
} from "../lib/auth.mjs";
import { AUTH_ERRORS, withAuthError } from "../lib/oauth.mjs";
import {
  PAGE_HEADERS,
  VERIFY_PATH,
  confirmationPage,
  emailAvailable,
  emailConfig,
  looksLikeTokenHash,
  openEmailTransaction,
  originAllowed,
  readVerifyForm,
} from "../lib/email.mjs";

// Netlify code-based rate limit, per IP and domain, shared by GET and POST.
export const config = {
  path: VERIFY_PATH,
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const LINK_ERROR = "link";

/**
 * Revokes the session the browser already had, the way sign-out does: with
 * its own access token, or — if that has expired — a current one obtained
 * once from its refresh token. Best effort; logged without values.
 */
async function revokePrevious(settings, cookies) {
  const access = cookies[SESSION_COOKIE];
  const refresh = cookies[REFRESH_COOKIE];
  let outcome = looksLikeAccessToken(access) ? await revokeSession(settings, access) : "invalid";
  if (outcome === "invalid" && looksLikeRefreshToken(refresh)) {
    const refreshed = await refreshSession(settings, refresh, "email-verify");
    outcome = refreshed.status === "ok"
      ? await revokeSession(settings, refreshed.session.accessToken)
      : refreshed.status;
  }
  if (outcome === "unavailable") {
    logProblem("email-verify", "could not revoke the previous session at Supabase");
  }
}

function page(tokenHash, returnTo) {
  return new Response(confirmationPage(tokenHash, returnTo), {
    status: 200,
    headers: PAGE_HEADERS,
  });
}

export default async function emailVerify(request) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
  }
  const clearEmail = clearCookie(EMAIL_COOKIE);

  const settings = emailConfig();
  if (!settings.ok) {
    logProblem("email-verify", `email sign-in is off or not configured (${settings.problem})`);
    return redirect(withAuthError("/", AUTH_ERRORS.unavailable));
  }
  if (request.method === "POST" && !originAllowed(request, settings)) {
    return json(403, { error: "forbidden" });
  }

  let tokenHash;
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const type = params.get("type");
    tokenHash = params.get("token_hash");
    if (!looksLikeTokenHash(tokenHash) || (type !== null && type !== "email")) {
      return redirect(withAuthError("/", LINK_ERROR), [clearEmail]);
    }
  } else {
    tokenHash = await readVerifyForm(request);
    if (!tokenHash) {
      logProblem("email-verify", "missing or malformed token_hash");
      return redirect(withAuthError("/", LINK_ERROR), [clearEmail]);
    }
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  const opened = openEmailTransaction(cookies[EMAIL_COOKIE], settings.cookieSecret);
  if (opened.status !== "ok") {
    logProblem("email-verify", `email sign-in cookie ${opened.status}`);
    return redirect(withAuthError("/", LINK_ERROR), [clearEmail]);
  }
  const { returnTo } = opened.transaction;

  if (!(await emailAvailable(settings))) {
    logProblem("email-verify", "Email is not enabled in Supabase, or Supabase is unreachable");
    return redirect(withAuthError(returnTo, AUTH_ERRORS.unavailable));
  }

  if (request.method === "GET") return page(tokenHash, returnTo);

  const result = await verifyEmailToken(settings, tokenHash);
  if (result.status === "ok") {
    if (SESSION_COOKIE in cookies || REFRESH_COOKIE in cookies) {
      await revokePrevious(settings, cookies);
    }
    return redirect(withAuthError(returnTo, null), [clearEmail, ...sessionCookies(result.session)]);
  }
  if (result.status === "invalid") {
    logProblem("email-verify", "Supabase refused the email link (used, expired or invalid)");
    return redirect(withAuthError(returnTo, LINK_ERROR), [clearEmail]);
  }
  return redirect(withAuthError(returnTo, AUTH_ERRORS.unavailable));
}
