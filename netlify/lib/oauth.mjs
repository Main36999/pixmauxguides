/**
 * netlify/lib/oauth.mjs — the Google sign-in transaction (Phase 2).
 *
 * SERVER ONLY. Verified flow (Supabase Auth source, docs/AUTH.md):
 *
 *   1. /api/auth/google/start creates `state` and a PKCE verifier, stores
 *      them with return_to in the signed __Host-bpozz_oauth cookie, and
 *      sends the browser to Supabase GET /auth/v1/authorize?provider=google
 *      &redirect_to=<AUTH_ORIGIN>/api/auth/google/callback?state=<state>
 *      &code_challenge=<S256(verifier)>&code_challenge_method=s256
 *   2. Supabase runs Google's authorization-code flow with its own client
 *      secret, verifies Google's identity, and redirects to redirect_to,
 *      keeping its query and adding `code` (prepPKCERedirectURL).
 *   3. /api/auth/google/callback checks the cookie's signature, expiry and
 *      `state`, then exchanges `code` + verifier at Supabase
 *      POST /auth/v1/token?grant_type=pkce for the session.
 *
 * Nothing here verifies a Google ID token: Supabase does that on its leg.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { safeReturnTo } from "./auth.mjs";

export const CALLBACK_PATH = "/api/auth/google/callback";
export const TRANSACTION_TTL_SECONDS = 10 * 60;
export const INTENTS = Object.freeze(["signin", "signup"]);

/** Generic codes appended to return_to as ?auth_error=… — never details. */
export const AUTH_ERRORS = Object.freeze({
  cancelled: "cancelled", // the person declined at Google
  expired: "expired", // no, expired or tampered sign-in cookie
  failed: "failed", // bad state, bad code, provider error, code refused
  unavailable: "unavailable", // not configured, or Supabase unreachable
});

const RANDOM_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const AUTH_CODE_SHAPE = /^[A-Za-z0-9._~-]{1,512}$/;
const MAC_CONTEXT = "bpozz-oauth-v1.";

/** 256 bits from the OS CSPRNG, base64url: 43 characters. */
export function randomToken() {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function mac(secret, data) {
  return createHmac("sha256", secret).update(MAC_CONTEXT + data).digest("base64url");
}

/**
 * The in-flight sign-in, as a cookie value: base64url(JSON) + "." + HMAC.
 * Signed, not encrypted — it is HttpOnly and Secure, so the only readers are
 * this browser's own requests; the signature stops it being forged or
 * edited (e.g. a swapped return_to).
 */
export function sealTransaction(transaction, secret) {
  const data = Buffer.from(JSON.stringify(transaction)).toString("base64url");
  return `${data}.${mac(secret, data)}`;
}

/**
 * Reads the cookie back. { status: "ok", transaction } or
 * { status: "missing" | "invalid" | "expired" }.
 */
export function openTransaction(value, secret, nowMs = Date.now()) {
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
    RANDOM_SHAPE.test(tx.state) &&
    RANDOM_SHAPE.test(tx.verifier) &&
    INTENTS.includes(tx.intent) &&
    typeof tx.returnTo === "string" &&
    safeReturnTo(tx.returnTo, null) === tx.returnTo &&
    Number.isInteger(tx.expiresAt);
  if (!shapeOk) return { status: "invalid" };
  if (tx.expiresAt * 1000 <= nowMs) return { status: "expired" };
  return { status: "ok", transaction: tx };
}

/** A new transaction for `intent` returning to an already-safe path. */
export function newTransaction(intent, returnTo, nowMs = Date.now()) {
  return {
    state: randomToken(),
    verifier: randomToken(),
    intent,
    returnTo,
    expiresAt: Math.floor(nowMs / 1000) + TRANSACTION_TTL_SECONDS,
  };
}

/** Supabase's authorize URL for this transaction. */
export function authorizeUrl(config, transaction) {
  const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set(
    "redirect_to",
    `${config.origin}${CALLBACK_PATH}?state=${transaction.state}`,
  );
  url.searchParams.set("code_challenge", pkceChallenge(transaction.verifier));
  url.searchParams.set("code_challenge_method", "s256");
  return url.toString();
}

export function looksLikeAuthCode(value) {
  return typeof value === "string" && AUTH_CODE_SHAPE.test(value);
}

/**
 * `returnTo` (already safe) with ?auth_error=<code>, or with any stale
 * auth_error removed when `code` is null.
 */
export function withAuthError(returnTo, code) {
  const url = new URL(returnTo, "https://return-to.invalid");
  url.searchParams.delete("auth_error");
  if (code) url.searchParams.set("auth_error", code);
  return url.pathname + url.search + url.hash;
}
