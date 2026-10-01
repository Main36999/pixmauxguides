/**
 * GET /api/auth/session — who, if anyone, is signed in.
 *
 * Response contract (src/client/auth.js depends on it):
 *
 *   200 { authenticated: false, user: null, providers }
 *   200 { authenticated: true,
 *         user: { id, email, display_name, avatar_url }, providers }
 *   503 { authenticated: false, user: null, error: "auth_unavailable" }
 *       auth not configured, or Supabase unreachable
 *   405 { error: "method_not_allowed" }                     anything but GET
 *
 * `providers` ({ google, email }) tells the dialog which sign-in methods it
 * may offer (currentProviders). The frontend reads any non-200 as "sign-in
 * isn't available yet", so every failure here degrades to that message
 * rather than to an error or a fake signed-in state.
 *
 * Session resolution, Supabase deciding at every step:
 *   1. access-token cookie accepted by GET /auth/v1/user     -> signed in
 *   2. otherwise a refresh-token cookie Supabase will rotate  -> signed in,
 *      both cookies re-issued
 *   3. otherwise signed out, and any stale session cookies cleared
 * A Supabase outage is a 503, never a sign-out: cookies are kept.
 *
 * While the Turnstile check on the email request is on (netlify/lib/
 * turnstile.mjs) and email sign-in is offered, a 200 also carries
 * `turnstile: { siteKey }` — the PUBLIC sitekey the dialog renders the
 * widget with; never the secret. Half-configured Turnstile turns
 * providers.email off, so the dialog never starts a flow the server would
 * refuse. With Turnstile off the response is exactly as above.
 *
 * Every response is Cache-Control: no-store. Uses the anon key only.
 */

import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  currentProviders,
  getSupabaseUser,
  json,
  logProblem,
  looksLikeAccessToken,
  looksLikeRefreshToken,
  parseCookies,
  publicUser,
  refreshSession,
  sessionCookies,
  supabaseConfig,
} from "../lib/auth.mjs";
import { turnstileConfig } from "../lib/turnstile.mjs";

// A custom path makes this the function's only public URL — Netlify no
// longer serves it at /.netlify/functions/auth-session.
export const config = { path: "/api/auth/session" };

const UNAVAILABLE = Object.freeze({
  authenticated: false,
  user: null,
  error: "auth_unavailable",
});

export default async function authSession(request) {
  if (request.method !== "GET") {
    return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
  }

  const settings = supabaseConfig();
  if (!settings.ok) {
    logProblem("session", `auth is not configured (${settings.problem})`);
    return json(503, UNAVAILABLE);
  }

  const challenge = turnstileConfig();
  const configured = await currentProviders(settings);
  const providers =
    challenge.state === "invalid" ? { ...configured, email: false } : configured;
  const turnstile =
    challenge.state === "on" && providers.email ? { turnstile: { siteKey: challenge.siteKey } } : {};
  const signedIn = (user, cookies) =>
    json(200, { authenticated: true, user: publicUser(user), providers, ...turnstile }, undefined, cookies);
  const signedOut = (cookies) =>
    json(200, { authenticated: false, user: null, providers, ...turnstile }, undefined, cookies);

  const cookies = parseCookies(request.headers.get("cookie"));
  const access = cookies[SESSION_COOKIE];
  const refresh = cookies[REFRESH_COOKIE];

  if (looksLikeAccessToken(access)) {
    const result = await getSupabaseUser(settings, access);
    if (result.status === "valid") return signedIn(result.user);
    if (result.status === "unavailable") return json(503, UNAVAILABLE);
  }

  if (looksLikeRefreshToken(refresh)) {
    const result = await refreshSession(settings, refresh);
    if (result.status === "ok") return signedIn(result.session.user, sessionCookies(result.session));
    if (result.status === "unavailable") return json(503, UNAVAILABLE);
    return signedOut([clearCookie(SESSION_COOKIE), clearCookie(REFRESH_COOKIE)]);
  }

  const stale = [];
  if (access !== undefined) stale.push(clearCookie(SESSION_COOKIE));
  if (refresh !== undefined) stale.push(clearCookie(REFRESH_COOKIE));
  return signedOut(stale);
}
