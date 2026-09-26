/**
 * POST /api/auth/signout
 *
 *   200 { "signed_out": true }  + clears session, refresh and OAuth cookies
 *   403 { "error": "forbidden" }        Origin missing or not this site
 *   405 { "error": "method_not_allowed" }
 *
 * Server-side invalidation: Supabase POST /auth/v1/logout?scope=local,
 * authorised by the user's OWN access token (no service-role key), ends
 * this session and revokes its refresh tokens. If the access token has
 * expired, the refresh token is used once to get a current one first.
 *
 * The cookies are cleared whatever Supabase says. If Supabase can't be
 * reached, the browser is still signed out; the refresh token stays valid
 * at Supabase until it expires, and that is logged (without values).
 */

import {
  OAUTH_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  isSameOriginRequest,
  json,
  logProblem,
  looksLikeAccessToken,
  looksLikeRefreshToken,
  parseCookies,
  refreshSession,
  revokeSession,
  supabaseConfig,
} from "../lib/auth.mjs";

export const config = { path: "/api/auth/signout" };

async function revokeAtSupabase(settings, cookies) {
  const access = cookies[SESSION_COOKIE];
  const refresh = cookies[REFRESH_COOKIE];
  let outcome = looksLikeAccessToken(access) ? await revokeSession(settings, access) : "invalid";
  if (outcome === "invalid" && looksLikeRefreshToken(refresh)) {
    const refreshed = await refreshSession(settings, refresh, "signout");
    if (refreshed.status === "ok") {
      outcome = await revokeSession(settings, refreshed.session.accessToken);
    } else {
      outcome = refreshed.status;
    }
  }
  return outcome;
}

export default async function signout(request) {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
  }
  if (!isSameOriginRequest(request)) {
    return json(403, { error: "forbidden" });
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  const hadSession = SESSION_COOKIE in cookies || REFRESH_COOKIE in cookies;
  const settings = supabaseConfig();
  if (hadSession && settings.ok) {
    const outcome = await revokeAtSupabase(settings, cookies);
    if (outcome === "unavailable") {
      logProblem("signout", "could not revoke the session at Supabase; cookies cleared anyway");
    }
  }

  return json(200, { signed_out: true }, undefined, [
    clearCookie(SESSION_COOKIE),
    clearCookie(REFRESH_COOKIE),
    clearCookie(OAUTH_COOKIE),
  ]);
}
