/**
 * GET /api/auth/google/start?intent=signin|signup&return_to=/path
 *
 * Starts Google sign-in. Reached by a full-page navigation from the dialog
 * (src/client/auth.js), only after /api/auth/session reported
 * providers.google === true.
 *
 *   303 -> Supabase /auth/v1/authorize   + Set-Cookie __Host-bpozz_oauth
 *   303 -> return_to?auth_error=failed   intent missing or invalid
 *   303 -> return_to?auth_error=unavailable
 *                                        not configured, or Google not
 *                                        enabled / Supabase unreachable
 *   405                                  anything but GET
 *
 * return_to goes through safeReturnTo(): anything that is not an internal
 * relative path (//evil.example, https://evil.example, …) becomes "/".
 */

import {
  OAUTH_COOKIE,
  googleEnabledInSupabase,
  json,
  logProblem,
  oauthConfig,
  redirect,
  safeReturnTo,
  setCookie,
} from "../lib/auth.mjs";
import {
  AUTH_ERRORS,
  INTENTS,
  TRANSACTION_TTL_SECONDS,
  authorizeUrl,
  newTransaction,
  sealTransaction,
  withAuthError,
} from "../lib/oauth.mjs";

export const config = { path: "/api/auth/google/start" };

export default async function googleStart(request) {
  if (request.method !== "GET") {
    return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
  }

  const params = new URL(request.url).searchParams;
  const returnTo = safeReturnTo(params.get("return_to"));
  const intent = params.get("intent");
  if (!INTENTS.includes(intent)) {
    return redirect(withAuthError(returnTo, AUTH_ERRORS.failed));
  }

  const settings = oauthConfig();
  if (!settings.ok) {
    logProblem("google-start", `Google sign-in is not configured (${settings.problem})`);
    return redirect(withAuthError(returnTo, AUTH_ERRORS.unavailable));
  }
  if (!(await googleEnabledInSupabase(settings))) {
    logProblem("google-start", "Google is not enabled in Supabase, or Supabase is unreachable");
    return redirect(withAuthError(returnTo, AUTH_ERRORS.unavailable));
  }

  const transaction = newTransaction(intent, returnTo);
  return redirect(authorizeUrl(settings, transaction), [
    setCookie(
      OAUTH_COOKIE,
      sealTransaction(transaction, settings.cookieSecret),
      TRANSACTION_TTL_SECONDS,
    ),
  ]);
}
