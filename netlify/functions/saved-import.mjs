/**
 * POST /api/saved/import   {"items": [{"kind", "id"}, …]}
 *
 * Adds a browser's old, browser-only font and palette saves to the signed-in
 * visitor's account (docs/SAVED.md). Only ever sent when the visitor chooses
 * to import; never automatic. Fonts and palettes only, 1–1,000 items.
 *
 *   200 { results: [{ kind, id, status }], created, existing, invalid, limited }
 *       status per item, in request order:
 *         created   added now
 *         exists    already saved (or repeated earlier in the request)
 *         invalid   not a font or palette, or a malformed id
 *         limit     no room left under the 1,000-item cap
 *   400 { error: "invalid_request" }     not JSON, too big, wrong shape, or
 *                                        the database refused the insert's
 *                                        values (logged)
 *   401 { error: "unauthenticated" }     no, malformed or expired session, or
 *                                        the account no longer exists
 *   403 { error: "forbidden" }           Origin missing or not this site
 *   405 { error: "method_not_allowed" }
 *   429                                  Netlify's rate limit (config below),
 *                                        answered before this code runs, so
 *                                        not this API's JSON
 *   503 { error: "saved_unavailable" }   SAVED_ENABLED off, not configured,
 *                                        Supabase unreachable / refusing, or
 *                                        the list kept changing
 *
 * Only new items are inserted, all-or-nothing, after reading the account's
 * list; if another tab or device saves in between, it reads and tries once
 * more. Firebase's anonymous palette counter is not touched.
 */

import { isSameOriginRequest, json, logProblem } from "../lib/auth.mjs";
import {
  INVALID,
  UNAUTHENTICATED,
  UNAVAILABLE,
  failureResponse,
  importSaved,
  readAccessToken,
  readImportBody,
  savedConfig,
  tokenSubject,
} from "../lib/saved.mjs";

// Netlify code-based rate limit, per IP and domain: an import happens once
// per browser.
//
// Every value here must be a literal: Netlify reads this object statically at
// deploy time and silently drops anything it can't evaluate.
export const config = {
  path: "/api/saved/import",
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

export default async function savedImport(request) {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
  }

  const settings = savedConfig();
  if (!settings.ok) {
    logProblem("saved-import", `saved items are off or not configured (${settings.problem})`);
    return json(503, UNAVAILABLE);
  }
  if (!isSameOriginRequest(request)) {
    return json(403, { error: "forbidden" });
  }

  const token = readAccessToken(request);
  const sub = tokenSubject(token);
  if (!sub) return json(401, UNAUTHENTICATED);

  const body = await readImportBody(request);
  if (!body.ok) return json(400, INVALID);

  const result = await importSaved(settings, token, sub, body.items);
  if (result.status !== "ok") return failureResponse(result.status);

  const count = (status) => result.results.filter((item) => item.status === status).length;
  return json(200, {
    results: result.results,
    created: count("created"),
    existing: count("exists"),
    invalid: count("invalid"),
    limited: count("limit"),
  });
}
