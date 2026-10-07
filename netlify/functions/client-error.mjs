/**
 * POST /api/client-error — one report from src/client/error-beacon.js: an
 * uncaught script error on a bpozz.com page.
 *
 *   204                                  logged once — or the beacon is
 *                                        switched off, and nothing is read
 *                                        or logged
 *   400 { error: "invalid_request" }     not JSON, too big, or wrong keys,
 *                                        types or lengths (netlify/lib/
 *                                        client-error.mjs); not logged
 *   403 { error: "forbidden" }           Origin missing or not this site
 *   405 { error: "method_not_allowed" }
 *   429                                  Netlify's rate limit (config below),
 *                                        answered before this code runs, so
 *                                        not this API's JSON
 *
 * THE SWITCH: CLIENT_ERRORS_ENABLED must be exactly "true". Anything else
 * answers every POST 204 without reading it.
 *
 * Never reads a cookie, never sets one, never calls out. Every response is
 * no-store, and the browser ignores all of them.
 */

import { isSameOriginRequest, json } from "../lib/auth.mjs";
import {
  INVALID,
  browserFamily,
  cleanReport,
  clientErrorsEnabled,
  logReport,
  noContent,
  readReport,
} from "../lib/client-error.mjs";

// Netlify code-based rate limit, per IP and domain: the browser sends at
// most five reports a page, so this only ever stops a flood.
//
// Every value here must be a literal: Netlify reads this object statically at
// deploy time and silently drops anything it can't evaluate.
export const config = {
  path: "/api/client-error",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

export default async function clientError(request) {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
  }
  if (!clientErrorsEnabled()) return noContent();
  if (!isSameOriginRequest(request)) {
    return json(403, { error: "forbidden" });
  }

  const report = await readReport(request);
  if (!report.ok) return json(400, INVALID);

  const record = cleanReport(report.value, request.headers.get("origin"));
  record.browser = browserFamily(request.headers.get("user-agent"));
  logReport(record);
  return noContent();
}
