/**
 * GET /api/auth/google/callback?state=…&code=…   (or &error=…)
 *
 * Where Supabase sends the browser after Google. Every response clears the
 * one-time __Host-bpozz_oauth cookie and is a 303 to an internal path with
 * no token, code or state in it:
 *
 *   success          -> return_to              + session cookies
 *   declined         -> return_to?auth_error=cancelled
 *   bad state / code / provider error / code refused
 *                    -> return_to?auth_error=failed
 *   cookie missing, expired or tampered
 *                    -> /?auth_error=expired   (return_to is unknown)
 *   not configured / Supabase down
 *                    -> …?auth_error=unavailable
 *
 * Order matters: the signed cookie and `state` are checked before anything
 * in the query is trusted, so a forged callback cannot even pick the page it
 * lands on.
 */

import {
  OAUTH_COOKIE,
  clearCookie,
  exchangeCodeForSession,
  json,
  logProblem,
  oauthConfig,
  parseCookies,
  redirect,
  sessionCookies,
} from "../lib/auth.mjs";
import {
  AUTH_ERRORS,
  looksLikeAuthCode,
  openTransaction,
  safeEqual,
  withAuthError,
} from "../lib/oauth.mjs";

export const config = { path: "/api/auth/google/callback" };

export default async function googleCallback(request) {
  if (request.method !== "GET") {
    return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
  }
  const clearTransaction = clearCookie(OAUTH_COOKIE);
  const back = (returnTo, code, cookies = []) =>
    redirect(withAuthError(returnTo, code), [clearTransaction, ...cookies]);

  const settings = oauthConfig();
  if (!settings.ok) {
    logProblem("google-callback", `Google sign-in is not configured (${settings.problem})`);
    return back("/", AUTH_ERRORS.unavailable);
  }

  const opened = openTransaction(
    parseCookies(request.headers.get("cookie"))[OAUTH_COOKIE],
    settings.cookieSecret,
  );
  if (opened.status !== "ok") {
    logProblem("google-callback", `sign-in cookie ${opened.status}`);
    return back("/", AUTH_ERRORS.expired);
  }
  const { transaction } = opened;
  const params = new URL(request.url).searchParams;

  if (!safeEqual(params.get("state") || "", transaction.state)) {
    logProblem("google-callback", "state mismatch");
    return back(transaction.returnTo, AUTH_ERRORS.failed);
  }

  const providerError = params.get("error");
  if (providerError) {
    if (providerError === "access_denied") {
      return back(transaction.returnTo, AUTH_ERRORS.cancelled);
    }
    logProblem("google-callback", "Supabase or Google returned an OAuth error");
    return back(transaction.returnTo, AUTH_ERRORS.failed);
  }

  const code = params.get("code");
  if (!looksLikeAuthCode(code)) {
    logProblem("google-callback", "missing or malformed authorization code");
    return back(transaction.returnTo, AUTH_ERRORS.failed);
  }

  const result = await exchangeCodeForSession(settings, code, transaction.verifier);
  if (result.status === "ok") {
    return back(transaction.returnTo, null, sessionCookies(result.session));
  }
  if (result.status === "invalid") {
    logProblem("google-callback", "Supabase refused the authorization code");
    return back(transaction.returnTo, AUTH_ERRORS.failed);
  }
  return back(transaction.returnTo, AUTH_ERRORS.unavailable);
}
