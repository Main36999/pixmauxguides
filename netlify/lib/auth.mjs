/**
 * netlify/lib/auth.mjs — server-side helpers for the /api/auth/* functions.
 *
 * SERVER ONLY. Nothing under netlify/ is published to dist/ or bundled into
 * /app.js; Netlify bundles this file into the functions that import it.
 *
 * ARCHITECTURE (docs/AUTH.md)
 *
 *   browser -> /api/auth/* (Netlify Functions) -> Supabase Auth -> Google
 *
 * Supabase is the identity and session authority. These helpers never mint,
 * sign or verify a session token of their own: a session is valid exactly
 * when Supabase's GET /auth/v1/user accepts its access token (which also
 * catches sessions Supabase has revoked), and new tokens only ever come from
 * Supabase's /auth/v1/token. Tokens are stored exactly as Supabase issued
 * them, under BPOZZ-owned __Host- cookie names.
 *
 * No dependency: a handful of documented Supabase Auth REST calls do not
 * justify @supabase/supabase-js in a repo that has no dependencies at all.
 */

/**
 * Cookies. All are written HttpOnly; Secure; SameSite=Lax; Path=/ with no
 * Domain (setCookie). The __Host- prefix makes the browser refuse any of them
 * that lacks Secure or Path=/ or carries a Domain, so no subdomain can set or
 * read them.
 *
 *   SESSION_COOKIE  Supabase access token (JWT), lives as long as the token
 *   REFRESH_COOKIE  Supabase refresh token, renewed on every refresh
 *   OAUTH_COOKIE    the in-flight Google sign-in (state, PKCE verifier,
 *                   return_to), signed, 10 minutes, cleared by the callback
 *   EMAIL_COOKIE    the in-flight email sign-in (return_to only), signed,
 *                   1 hour, cleared by /api/auth/email/verify
 */
export const SESSION_COOKIE = "__Host-bpozz_session";
export const REFRESH_COOKIE = "__Host-bpozz_refresh";
export const OAUTH_COOKIE = "__Host-bpozz_oauth";
export const EMAIL_COOKIE = "__Host-bpozz_email";

/** Refresh cookie lifetime: 30 days, restarted by every refresh. */
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * The site's HSTS policy, word for word as public/_headers sends it on
 * every static response. Netlify applies _headers to static files only, and
 * on a function response adds its own shorter default (one year, no
 * includeSubDomains). A browser keeps whichever policy it saw last, so
 * without this every /api call would replace the static pages' policy with
 * the weaker one. A test keeps the two strings identical.
 */
export const HSTS = "max-age=63072000; includeSubDomains; preload";

/** Headers on every /api/auth/* response: never cached, never sniffed. */
export const AUTH_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Strict-Transport-Security": HSTS,
  "X-Content-Type-Options": "nosniff",
});

const SUPABASE_TIMEOUT_MS = 5000;
const MAX_TOKEN_LENGTH = 8192;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// RFC 6265 cookie-octet: printable ASCII minus space, " , ; and \.
const COOKIE_SAFE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

// ---------------------------------------------------------------------
// responses and cookies
// ---------------------------------------------------------------------

function withCookies(headers, cookies) {
  for (const cookie of cookies || []) headers.append("Set-Cookie", cookie);
  return headers;
}

export function json(status, body, extraHeaders, cookies) {
  const headers = withCookies(new Headers({ ...AUTH_HEADERS, ...extraHeaders }), cookies);
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * 303 to `location`. Used for the OAuth navigations. Referrer-Policy keeps
 * the callback URL (which carries the one-time code) out of any Referer.
 */
export function redirect(location, cookies) {
  const headers = withCookies(
    new Headers({
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": HSTS,
      "X-Content-Type-Options": "nosniff",
    }),
    cookies,
  );
  return new Response(null, { status: 303, headers });
}

export function setCookie(name, value, maxAgeSeconds) {
  if (!COOKIE_SAFE.test(value)) throw new Error(`unsafe value for cookie ${name}`);
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Operator-facing log line. Callers pass fixed text only — never a token,
 * cookie, code, state, verifier, email address or key value — so a log line
 * can't leak one.
 */
export function logProblem(where, message) {
  console.error(`[auth] ${where}: ${message}`);
}

// ---------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------

function envString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * The Supabase settings a session check needs, and nothing more: the
 * project URL and the anon (least-privileged, publishable) key. The
 * service-role key is deliberately not read — nothing in Phases 1–2 needs
 * it. Returns { ok: false, problem } with the variable NAMES at fault,
 * never their values.
 */
export function supabaseConfig(env = process.env) {
  const url = envString(env.SUPABASE_URL);
  const anonKey = envString(env.SUPABASE_ANON_KEY);
  const missing = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  if (missing.length) return { ok: false, problem: `missing ${missing.join(", ")}` };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problem: "SUPABASE_URL is not a valid URL" };
  }
  // Plain http only for a local Supabase stack (`supabase start`).
  if (parsed.protocol !== "https:" && !(isLocalHost(parsed.hostname) && parsed.protocol === "http:")) {
    return { ok: false, problem: "SUPABASE_URL must use https" };
  }
  return { ok: true, supabaseUrl: parsed.origin, anonKey };
}

/**
 * Everything the Google sign-in flow needs: the Supabase settings plus
 * AUTH_ORIGIN (where Supabase must send the browser back) and
 * AUTH_COOKIE_SECRET (signs the in-flight OAuth cookie). Still no
 * service-role key.
 */
export function oauthConfig(env = process.env) {
  const base = supabaseConfig(env);
  if (!base.ok) return base;

  const rawOrigin = envString(env.AUTH_ORIGIN);
  if (!rawOrigin) return { ok: false, problem: "missing AUTH_ORIGIN" };
  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return { ok: false, problem: "AUTH_ORIGIN is not a valid URL" };
  }
  const httpsOrLocal =
    origin.protocol === "https:" || (origin.protocol === "http:" && isLocalHost(origin.hostname));
  if (!httpsOrLocal || origin.origin !== rawOrigin.replace(/\/$/, "")) {
    return { ok: false, problem: "AUTH_ORIGIN must be a bare https origin, e.g. https://bpozz.com" };
  }

  const cookieSecret = envString(env.AUTH_COOKIE_SECRET);
  if (cookieSecret.length < 32) {
    return { ok: false, problem: "AUTH_COOKIE_SECRET must be at least 32 characters" };
  }
  return { ...base, origin: origin.origin, cookieSecret };
}

// ---------------------------------------------------------------------
// request parsing
// ---------------------------------------------------------------------

/**
 * Parses a Cookie request header. Malformed pairs are skipped rather than
 * thrown on; for a repeated name the first occurrence wins.
 */
export function parseCookies(header) {
  const cookies = Object.create(null);
  if (typeof header !== "string" || !header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Undecodable value: ignore this cookie, keep the others.
    }
  }
  return cookies;
}

/** Cheap shape checks, so garbage is never forwarded to Supabase. */
export function looksLikeAccessToken(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_TOKEN_LENGTH &&
    JWT_SHAPE.test(value)
  );
}

export function looksLikeRefreshToken(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 2048 &&
    COOKIE_SAFE.test(value)
  );
}

/**
 * True when the request carries an Origin header naming this site — the
 * CSRF check for state-changing POSTs. Browsers always send Origin on POST.
 */
export function isSameOriginRequest(request, env = process.env) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  const configured = envString(env.AUTH_ORIGIN).replace(/\/$/, "");
  if (configured) allowed.add(configured);
  return allowed.has(origin);
}

// ---------------------------------------------------------------------
// Supabase Auth REST calls
// ---------------------------------------------------------------------

/**
 * One call to Supabase Auth. Outcomes:
 *
 *   { outcome: "ok", data }    2xx (data is null for 204)
 *   { outcome: "invalid" }     400/401/403/404/422 — the token, code or
 *                              verifier was refused: the visitor's problem
 *   { outcome: "unavailable" } unreachable, timed out, 5xx, 429, non-JSON,
 *                              or Supabase rejecting OUR API key — a server
 *                              problem, logged without values
 *
 * Every result also carries `status` (the HTTP status, 0 when there was no
 * response) and a refusal carries `errorCode` (Supabase's `error_code`, or
 * null). Callers that read only `outcome` see exactly what they always did;
 * the email flow needs the extra detail to tell a 429 or a 422 apart.
 */
export async function supabaseCall(config, where, pathAndQuery, { method = "GET", accessToken, body } = {}) {
  const headers = { apikey: config.anonKey, Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${config.supabaseUrl}/auth/v1${pathAndQuery}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
  } catch {
    logProblem(where, "Supabase request failed or timed out");
    return { outcome: "unavailable", status: 0 };
  }

  const status = res.status;
  if ([400, 401, 403, 404, 422].includes(status)) {
    // A bad API key is also a 401. Tell it apart from a bad session so a
    // misconfiguration shows up in the logs instead of as silent sign-outs.
    const text = await res.text().catch(() => "");
    if (/api[\s_-]?key/i.test(text)) {
      logProblem(where, "Supabase rejected SUPABASE_ANON_KEY");
      return { outcome: "unavailable", status };
    }
    return { outcome: "invalid", status, errorCode: errorCodeOf(text) };
  }
  if (!res.ok) {
    logProblem(where, `Supabase responded ${status}`);
    return { outcome: "unavailable", status };
  }
  if (status === 204) return { outcome: "ok", status, data: null };
  try {
    return { outcome: "ok", status, data: await res.json() };
  } catch {
    logProblem(where, "Supabase returned a non-JSON response");
    return { outcome: "unavailable", status };
  }
}

/** Supabase's machine-readable `error_code` from an error body, or null. */
function errorCodeOf(text) {
  try {
    const body = JSON.parse(text);
    const code = body && (body.error_code || body.code);
    return typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function isUser(value) {
  return !!value && typeof value.id === "string" && value.id.length > 0;
}

/**
 * Asks Supabase whom an access token belongs to.
 *
 *   { status: "valid", user }   Supabase accepted the token
 *   { status: "invalid" }       expired, revoked or forged — signed out
 *   { status: "unavailable" }   a server problem, not the visitor's
 */
export async function getSupabaseUser(config, accessToken) {
  const result = await supabaseCall(config, "session", "/user", { accessToken });
  if (result.outcome !== "ok") return { status: result.outcome };
  if (!isUser(result.data)) {
    logProblem("session", "Supabase returned a user without an id");
    return { status: "unavailable" };
  }
  return { status: "valid", user: result.data };
}

/**
 * Keeps only what BPOZZ stores from a Supabase token response. Everything
 * else — notably Google's own provider_token / provider_refresh_token — is
 * dropped here and never reaches a cookie, a response or a log.
 */
function readSession(where, result) {
  if (result.outcome !== "ok") return { status: result.outcome };
  const data = result.data || {};
  if (
    !looksLikeAccessToken(data.access_token) ||
    !looksLikeRefreshToken(data.refresh_token) ||
    !isUser(data.user)
  ) {
    logProblem(where, "Supabase returned an unusable session");
    return { status: "unavailable" };
  }
  const expiresIn =
    Number.isInteger(data.expires_in) && data.expires_in > 0
      ? Math.min(data.expires_in, 24 * 60 * 60)
      : 60 * 60;
  return {
    status: "ok",
    session: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn,
      user: data.user,
    },
  };
}

/** PKCE code exchange: POST /auth/v1/token?grant_type=pkce. */
export async function exchangeCodeForSession(config, authCode, codeVerifier) {
  const result = await supabaseCall(config, "google-callback", "/token?grant_type=pkce", {
    method: "POST",
    body: { auth_code: authCode, code_verifier: codeVerifier },
  });
  return readSession("google-callback", result);
}

/**
 * Email sign-in link: POST /auth/v1/verify { type: "email", token_hash }.
 * Single use. Supabase answers with the same session document as a token
 * exchange, so it goes through the same readSession() filter.
 */
export async function verifyEmailToken(config, tokenHash) {
  const result = await supabaseCall(config, "email-verify", "/verify", {
    method: "POST",
    body: { type: "email", token_hash: tokenHash },
  });
  return readSession("email-verify", result);
}

/** POST /auth/v1/token?grant_type=refresh_token. Supabase rotates it. */
export async function refreshSession(config, refreshToken, where = "session") {
  const result = await supabaseCall(config, where, "/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
  return readSession(where, result);
}

/**
 * POST /auth/v1/logout?scope=local, authorised by the user's OWN access
 * token (no service-role key): Supabase ends this session and revokes its
 * refresh tokens. Returns "ok" | "invalid" | "unavailable".
 */
export async function revokeSession(config, accessToken) {
  const result = await supabaseCall(config, "signout", "/logout?scope=local", {
    method: "POST",
    accessToken,
  });
  return result.outcome;
}

/** The two session cookies for a session Supabase just issued. */
export function sessionCookies(session) {
  return [
    setCookie(SESSION_COOKIE, session.accessToken, session.expiresIn),
    setCookie(REFRESH_COOKIE, session.refreshToken, REFRESH_MAX_AGE),
  ];
}

// ---------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------

const SETTINGS_TTL_MS = 5 * 60 * 1000;
const SETTINGS_RETRY_MS = 30 * 1000;
let settingsCache = null;

/**
 * The provider switches (`external`) from Supabase's public
 * GET /auth/v1/settings, or null when it can't be read. Cached per function
 * instance for 5 minutes (30 s after a failure); one fetch serves both
 * providers.
 */
async function supabaseProviders(config) {
  const now = Date.now();
  const key = `${config.supabaseUrl}|${config.anonKey}`;
  if (settingsCache && settingsCache.key === key && settingsCache.until > now) {
    return settingsCache.external;
  }
  const result = await supabaseCall(config, "settings", "/settings");
  const external =
    result.outcome === "ok" && !!result.data && !!result.data.external
      ? result.data.external
      : null;
  settingsCache = {
    key,
    external,
    until: now + (result.outcome === "ok" ? SETTINGS_TTL_MS : SETTINGS_RETRY_MS),
  };
  return external;
}

/**
 * Is the Google provider switched on in Supabase (`external.google`)? So
 * the dialog never offers a provider Supabase would refuse. Unreachable
 * counts as "no".
 */
export async function googleEnabledInSupabase(config) {
  const external = await supabaseProviders(config);
  return !!external && external.google === true;
}

/** Is the Email provider switched on in Supabase (`external.email`)? */
export async function emailEnabledInSupabase(config) {
  const external = await supabaseProviders(config);
  return !!external && external.email === true;
}

/**
 * BPOZZ's own switch for email sign-in: on only when AUTH_EMAIL_ENABLED is
 * exactly "true". Supabase reports `external.email: true` by default, and
 * nothing in its settings says whether production SMTP and the email
 * templates are ready — only the operator knows that.
 */
export function emailFlagEnabled(env = process.env) {
  return env.AUTH_EMAIL_ENABLED === "true";
}

/** Tests only: forget the cached Supabase settings. */
export function resetProviderCache() {
  settingsCache = null;
}

/**
 * Which sign-in methods the dialog may offer. src/client/auth.js reads
 * `providers.google` / `providers.email` from GET /api/auth/session and
 * shows "not available yet" for any that is false.
 *
 *   google  true only when the whole Google flow is configured here
 *           (oauthConfig) AND Supabase reports the provider enabled
 *   email   true only when the same configuration is valid AND
 *           AUTH_EMAIL_ENABLED is "true" AND Supabase reports the Email
 *           provider enabled. With the flag off Supabase isn't asked.
 */
export async function currentProviders(config, env = process.env) {
  const configured = oauthConfig(env).ok;
  const google = configured && (await googleEnabledInSupabase(config));
  const email = configured && emailFlagEnabled(env) && (await emailEnabledInSupabase(config));
  return { google, email };
}

// ---------------------------------------------------------------------
// output shaping
// ---------------------------------------------------------------------

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}

function httpsUrl(value) {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The only user fields that leave the server. No tokens, no app_metadata,
 * no identities, no provider ids.
 *
 * display_name and avatar_url come from Supabase's user_metadata (what
 * Google supplies at sign-in) until public.profiles exists. That metadata
 * is user-editable, so it is treated as untrusted display text: capped,
 * and avatar_url accepted only as an https URL.
 */
export function publicUser(user) {
  const meta =
    user.user_metadata && typeof user.user_metadata === "object"
      ? user.user_metadata
      : {};
  return {
    id: user.id,
    email: typeof user.email === "string" && user.email ? user.email : null,
    display_name: firstString(meta.full_name, meta.name),
    avatar_url: httpsUrl(firstString(meta.avatar_url, meta.picture)),
  };
}

// How many layers of percent-encoding isLocalPath() will peel. A real BPOZZ
// path has none; anything still changing after this many is refused.
const MAX_DECODE_ROUNDS = 5;
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

/**
 * Is `pathname` a path on this site and nothing else, however many times it
 * is percent-decoded on the way to a browser or a server?
 *
 * Refused: the path itself, and every decoding of it, that starts with
 * "//", holds a backslash (browsers read "\" as "/") or a control
 * character, holds a dot segment ("." or ".." as a whole segment, anywhere),
 * leads into /api, or cannot be decoded at all.
 *
 * safeReturnTo() asks this twice: about the path exactly as it was given,
 * so a dot segment — literal or encoded ("%2e", "%252e", …) — is refused
 * rather than resolved; and about the path the URL parser produced, which
 * is what is actually returned.
 */
function isLocalPath(pathname) {
  let path = pathname;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    if (path[0] !== "/" || path[1] === "/") return false;
    if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
    if (DOT_SEGMENT.test(path)) return false;
    const lower = path.toLowerCase();
    if (lower === "/api" || lower.startsWith("/api/")) return false;
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return false;
    }
    if (decoded === path) return true;
    path = decoded;
  }
  return false;
}

/**
 * Where to send someone after sign-in: an internal, relative path, or the
 * fallback.
 *
 * Rejects anything that could leave bpozz.com: absolute URLs, scheme-
 * relative "//host" — written plainly or percent-encoded ("/%2F%2Fhost") —
 * "/\host" (browsers treat "\" as "/"), control characters, malformed
 * percent-encoding, and paths into /api/ itself.
 *
 * Dot segments are refused outright, never resolved: "/a/../b" is not
 * turned into "/b", and "/.//host" never gets the chance to become
 * "//host". That holds for "/./", "/../", a leading or trailing "/." or
 * "/..", and the same written as "%2e" under any number of encodings up to
 * the decode limit. No page on this site has such a path.
 *
 * Only the path is judged this way: a query string or fragment cannot
 * change where a relative URL points, so they are kept as given.
 *
 * What it returns is stable: safeReturnTo(result) === result. The signed
 * sign-in cookies rely on that when they re-check a stored path.
 */
export function safeReturnTo(value, fallback = "/") {
  if (typeof value !== "string" || !value || value.length > 2048) return fallback;
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  // The path as given, before the URL parser resolves any dot segment in it.
  if (!isLocalPath(value.split(/[?#]/, 1)[0])) return fallback;
  const base = "https://return-to.invalid";
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  if (!isLocalPath(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}
