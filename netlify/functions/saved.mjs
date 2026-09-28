/**
 * /api/saved — the signed-in visitor's account Saved items (docs/SAVED.md).
 *
 *   GET    /api/saved[?kind=<kind>]
 *     200 { items: [{ kind, id, saved_at }], count, limits }   newest first
 *   POST   /api/saved   {"kind", "id"}
 *     201 { saved: true, created: true }
 *     200 { saved: true, created: false }                       already saved
 *     409 { error: "limit_reached", limit: 1000 }
 *     409 { error: "limit_reached", limit: 200, kind: "image_palette" }
 *   DELETE /api/saved?kind=<kind>&id=<id>
 *     200 { saved: false, removed: true | false }
 *
 *   400 { error: "invalid_request" }     bad kind, id, body or query
 *   401 { error: "unauthenticated" }     no, malformed or expired session —
 *                                        the browser refreshes through
 *                                        /api/auth/session, then retries once
 *   403 { error: "forbidden" }           POST / DELETE without a same-origin Origin
 *   405 { error: "method_not_allowed" }
 *   429                                  Netlify's rate limit (config below),
 *                                        answered before this code runs, so
 *                                        not this API's JSON
 *   503 { error: "saved_unavailable" }   SAVED_ENABLED off, not configured,
 *                                        or Supabase unreachable / refusing
 *
 * Kinds: color, palette, font, icon, guide, image_palette. Reads only the
 * session (access-token) cookie; never sets a cookie, never refreshes a
 * session, never uses the service-role key. Every response is no-store.
 */

import { isSameOriginRequest, json, logProblem } from "../lib/auth.mjs";
import {
  INVALID,
  LIMITS,
  UNAUTHENTICATED,
  UNAVAILABLE,
  addSaved,
  failureResponse,
  isValidItem,
  kindFromQuery,
  listSaved,
  readAccessToken,
  readItemBody,
  removeSaved,
  savedConfig,
  tokenSubject,
} from "../lib/saved.mjs";

// Netlify code-based rate limit, per IP and domain: generous for a person
// saving and unsaving by hand; the database's per-user caps stand behind it.
//
// Every value here must be a literal: Netlify reads this object statically at
// deploy time and silently drops anything it can't evaluate.
export const config = {
  path: "/api/saved",
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

const METHODS = ["GET", "POST", "DELETE"];

export default async function saved(request) {
  if (!METHODS.includes(request.method)) {
    return json(405, { error: "method_not_allowed" }, { Allow: METHODS.join(", ") });
  }

  const settings = savedConfig();
  if (!settings.ok) {
    logProblem("saved", `saved items are off or not configured (${settings.problem})`);
    return json(503, UNAVAILABLE);
  }
  if (request.method !== "GET" && !isSameOriginRequest(request)) {
    return json(403, { error: "forbidden" });
  }

  const token = readAccessToken(request);
  const sub = tokenSubject(token);
  if (!sub) return json(401, UNAUTHENTICATED);

  if (request.method === "GET") return list(request, settings, token, sub);
  if (request.method === "POST") return add(request, settings, token);
  return remove(request, settings, token, sub);
}

async function list(request, settings, token, sub) {
  const kind = kindFromQuery(new URL(request.url).searchParams);
  if (kind === false) return json(400, INVALID);
  const result = await listSaved(settings, token, sub, kind);
  if (result.status !== "ok") return failureResponse(result.status);
  return json(200, { items: result.items, count: result.items.length, limits: LIMITS });
}

async function add(request, settings, token) {
  const body = await readItemBody(request);
  if (!body.ok) return json(400, INVALID);
  const outcome = await addSaved(settings, token, body.kind, body.id);
  if (outcome === "created") return json(201, { saved: true, created: true });
  if (outcome === "exists") return json(200, { saved: true, created: false });
  if (outcome === "limit_total") {
    return json(409, { error: "limit_reached", limit: LIMITS.total });
  }
  if (outcome === "limit_image") {
    return json(409, { error: "limit_reached", limit: LIMITS.image_palette, kind: "image_palette" });
  }
  return failureResponse(outcome);
}

async function remove(request, settings, token, sub) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const id = params.get("id");
  if (!isValidItem(kind, id)) return json(400, INVALID);
  const outcome = await removeSaved(settings, token, sub, kind, id);
  if (outcome === "removed" || outcome === "absent") {
    return json(200, { saved: false, removed: outcome === "removed" });
  }
  return failureResponse(outcome);
}
