/**
 * netlify/lib/saved.mjs — server-side helpers for the account Saved API:
 * /api/saved and /api/saved/import (docs/SAVED.md).
 *
 * SERVER ONLY. Nothing under netlify/ is published to dist/.
 *
 *   browser -> /api/saved* (Netlify Functions) -> Supabase Data API (PostgREST)
 *
 * Every Supabase call is authorised by the signed-in visitor's OWN access
 * token, read from the HttpOnly session cookie (so page JavaScript never
 * sees it), with the anon key as `apikey`. No service-role key. Row-level
 * security on public.saved_items is the ownership boundary; every read and
 * delete also carries `user_id=eq.<sub>` as a second guard. Inserts never
 * name user_id: the database fills it from the token (column default
 * auth.uid()), and the grants refuse any insert that tries.
 *
 * These helpers never set a cookie and never refresh a session: an expired
 * access token is a 401, and the browser asks /api/auth/session (which does
 * refresh) before retrying once.
 *
 * Learning Roadmap progress is not a saved item and never reaches this file.
 */

import {
  SESSION_COOKIE,
  json,
  logProblem,
  looksLikeAccessToken,
  parseCookies,
  supabaseConfig,
} from "./auth.mjs";

/** The six saveable sections. The database CHECK constraint lists the same. */
export const SAVED_KINDS = Object.freeze([
  "color",
  "palette",
  "font",
  "icon",
  "guide",
  "image_palette",
]);

/** The only sections that ever kept saves in the browser, so the only imports. */
export const IMPORT_KINDS = Object.freeze(["font", "palette"]);

/** Per-user caps. The database trigger enforces the same numbers. */
export const LIMITS = Object.freeze({ total: 1000, image_palette: 200 });

export const MAX_BODY_BYTES = 1024;
export const MAX_IMPORT_BODY_BYTES = 64 * 1024;
export const MAX_IMPORT_ITEMS = 1000;

/**
 * Listing asks for PAGE_SIZE rows a request. With Supabase's "Max rows" at
 * 1,000 or more — a required prerequisite (docs/SAVED.md) — every list (at
 * most 1,000 items) is one request: one consistent snapshot. A lower Max rows
 * falls back to paging, up to MAX_PAGES requests: never a short list, but not
 * a guaranteed snapshot (a rare insert-and-delete race between pages).
 */
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 20;

const REST_TIMEOUT_MS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The same rules as the saved_items_item_id_check constraint.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ICON_KEY = /^[a-z0-9]+(-[a-z0-9]+)*--[a-z0-9]+(-[a-z0-9]+)*$/;
const ID_RULES = Object.freeze({
  color: (id) => /^c[0-9]{3,4}$/.test(id),
  palette: (id) => /^p[0-9]{3,4}$/.test(id),
  font: (id) => id.length <= 64 && SLUG.test(id),
  icon: (id) => id.length <= 120 && ICON_KEY.test(id),
  guide: (id) => id.length <= 100 && SLUG.test(id),
  image_palette: (id) => /^[0-9a-f]{6}(-[0-9a-f]{6}){2,7}$/.test(id),
});

// ---------------------------------------------------------------------
// configuration and identity
// ---------------------------------------------------------------------

/**
 * The Supabase settings (URL + anon key), but only while SAVED_ENABLED is
 * exactly "true". Returns { ok: false, problem } with variable NAMES only.
 */
export function savedConfig(env = process.env) {
  if (env.SAVED_ENABLED !== "true") {
    return { ok: false, problem: 'SAVED_ENABLED is not "true"' };
  }
  return supabaseConfig(env);
}

/** The access token from the session cookie, or null. Refresh cookie ignored. */
export function readAccessToken(request) {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  return looksLikeAccessToken(token) ? token : null;
}

/**
 * The user id (`sub`) of a signed-in user's access token, or null.
 *
 * The payload is decoded WITHOUT verifying the signature. That is safe
 * because the id is only used to skip a doomed request (wrong role,
 * anonymous, malformed user id) and as the extra user_id filter: Supabase
 * verifies the signature on every call, so a forged token is refused there
 * (401) whatever its `sub` says.
 *
 * Expiry is deliberately left to Supabase. /api/auth/session, which the
 * browser asks after a 401, issues a fresh token only once Supabase itself
 * refuses the old one, so a stricter local check here would keep refusing a
 * token that the refresh path still treats as valid.
 */
export function tokenSubject(token) {
  if (!looksLikeAccessToken(token)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object") return null;
  if (claims.role !== "authenticated" || claims.is_anonymous === true) return null;
  if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) return null;
  return claims.sub;
}

// ---------------------------------------------------------------------
// input
// ---------------------------------------------------------------------

/** True when `id` is a well-formed id for one of the six kinds. */
export function isValidItem(kind, id) {
  return (
    typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(ID_RULES, kind) &&
    typeof id === "string" &&
    ID_RULES[kind](id)
  );
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

async function readJson(request, maxBytes) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) return { ok: false };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** POST /api/saved body: exactly {"kind", "id"}, a valid item. */
export async function readItemBody(request) {
  const body = await readJson(request, MAX_BODY_BYTES);
  if (!body.ok) return { ok: false };
  const value = body.value;
  if (!isPlainObject(value) || !hasExactKeys(value, ["kind", "id"])) return { ok: false };
  if (!isValidItem(value.kind, value.id)) return { ok: false };
  return { ok: true, kind: value.kind, id: value.id };
}

/**
 * POST /api/saved/import body: exactly {"items": [{"kind", "id"}, …]} with
 * 1–MAX_IMPORT_ITEMS string pairs. Ids are judged per item later, so one
 * stale id in a browser's old list doesn't sink the rest.
 */
export async function readImportBody(request) {
  const body = await readJson(request, MAX_IMPORT_BODY_BYTES);
  if (!body.ok) return { ok: false };
  const value = body.value;
  if (!isPlainObject(value) || !hasExactKeys(value, ["items"])) return { ok: false };
  const items = value.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_IMPORT_ITEMS) {
    return { ok: false };
  }
  const wellFormed = items.every(
    (item) =>
      isPlainObject(item) &&
      hasExactKeys(item, ["kind", "id"]) &&
      typeof item.kind === "string" &&
      typeof item.id === "string" &&
      item.kind.length <= 32 &&
      item.id.length <= 200,
  );
  if (!wellFormed) return { ok: false };
  return { ok: true, items: items.map((item) => ({ kind: item.kind, id: item.id })) };
}

/** GET ?kind=: undefined when absent, the kind when valid, false otherwise. */
export function kindFromQuery(params) {
  if (!params.has("kind")) return undefined;
  const kind = params.get("kind");
  return SAVED_KINDS.includes(kind) ? kind : false;
}

// ---------------------------------------------------------------------
// Supabase Data API (PostgREST)
// ---------------------------------------------------------------------

// Only machine codes are kept from an error body: Postgres SQLSTATEs and
// PostgREST's PGRSTnnn. Messages can carry row values (a user id in a
// duplicate-key detail), so they are never logged or returned — except the
// two fixed messages the limit trigger raises.
const ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;
const LIMIT_MESSAGES = Object.freeze({
  saved_items_limit: "limit_total",
  saved_items_image_limit: "limit_image",
});

function errorOf(text) {
  try {
    const body = JSON.parse(text);
    return {
      code: body && typeof body.code === "string" && ERROR_CODE.test(body.code) ? body.code : null,
      message: body && typeof body.message === "string" ? body.message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

/**
 * Outcomes of a refused request:
 *   unauthenticated  401 (expired, revoked or forged token), or the account
 *                    was deleted (23503: the user_id no longer exists)
 *   duplicate        23505: the item is already saved
 *   limit_total      the 1,000-item trigger
 *   limit_image      the 200-image-palette trigger
 *   invalid          any other 400 — the database refused the values
 *   range            416 while paging a list: rows were deleted between
 *                    pages, so the offset is past the new total. Not an
 *                    outage; the list is re-read.
 *   unavailable      everything else: our API key refused, missing grants
 *                    or table, 5xx, timeouts. Logged with codes only.
 */
function refusal(where, status, text) {
  const error = errorOf(text);
  const code = error.code || "no code";
  if (status === 401) {
    if (/api[\s_-]?key/i.test(text)) {
      logProblem(where, "Supabase rejected SUPABASE_ANON_KEY");
      return { outcome: "unavailable" };
    }
    return { outcome: "unauthenticated" };
  }
  if (error.code === "23505") return { outcome: "duplicate" };
  if (error.code === "23503") return { outcome: "unauthenticated" };
  if (error.code === "P0001" && Object.prototype.hasOwnProperty.call(LIMIT_MESSAGES, error.message)) {
    return { outcome: LIMIT_MESSAGES[error.message] };
  }
  if (status === 403) {
    logProblem(where, `Supabase refused permission (${code}): check the saved_items grants and policies`);
    return { outcome: "unavailable" };
  }
  if (status === 404) {
    logProblem(where, `saved_items not found (${code}): has the docs/SAVED.md migration been run?`);
    return { outcome: "unavailable" };
  }
  if (status === 400) {
    logProblem(where, `Supabase refused the values (${code})`);
    return { outcome: "invalid" };
  }
  if (status === 416) return { outcome: "range" };
  logProblem(where, `Supabase Data API responded ${status} (${code})`);
  return { outcome: "unavailable" };
}

/** One call to {SUPABASE_URL}/rest/v1, as the signed-in user. */
async function restCall(settings, where, token, pathAndQuery, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: settings.anonKey,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${settings.supabaseUrl}/rest/v1${pathAndQuery}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
  } catch {
    logProblem(where, "Supabase Data API request failed or timed out");
    return { outcome: "unavailable" };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) return refusal(where, res.status, text);
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      logProblem(where, "Supabase Data API returned a non-JSON response");
      return { outcome: "unavailable" };
    }
  }
  return { outcome: "ok", data, headers: res.headers };
}

// What a failed call means to the API's caller.
function failure(outcome) {
  return outcome === "unauthenticated" || outcome === "invalid" ? outcome : "unavailable";
}

// ---------------------------------------------------------------------
// list
// ---------------------------------------------------------------------

/** "0-24/25" or "*\/0" -> the total; null for anything else. */
function totalFrom(contentRange) {
  const match = /^(?:[0-9]+-[0-9]+|\*)\/([0-9]+)$/.exec(contentRange || "");
  return match ? Number(match[1]) : null;
}

function listQuery(sub, kind, offset) {
  const query = new URLSearchParams();
  query.set("select", "kind,item_id,created_at");
  query.set("user_id", `eq.${sub}`);
  if (kind) query.set("kind", `eq.${kind}`);
  // item_id breaks ties: rows imported together share created_at.
  query.set("order", "created_at.desc,kind.asc,item_id.asc");
  query.set("limit", String(PAGE_SIZE));
  query.set("offset", String(offset));
  return query.toString();
}

function isRow(row, kind) {
  return (
    isPlainObject(row) &&
    isValidItem(row.kind, row.item_id) &&
    typeof row.created_at === "string" &&
    (!kind || row.kind === kind)
  );
}

/**
 * Every page of one listing. "changed" when the rows didn't add up to the
 * count Supabase reported, or a later page was out of range (416) — a save
 * or unsave landed mid-read.
 */
async function readAllPages(settings, token, sub, kind) {
  const rows = [];
  let total = null;
  for (let page = 0; ; page += 1) {
    if (page === MAX_PAGES) {
      logProblem(
        "saved-list",
        `a list needed more than ${MAX_PAGES} pages: raise "Max rows" in Supabase's Data API settings`,
      );
      return { status: "unavailable" };
    }
    const result = await restCall(settings, "saved-list", token, `/saved_items?${listQuery(sub, kind, rows.length)}`, {
      prefer: "count=exact",
    });
    if (result.outcome === "range") return { status: "changed" };
    if (result.outcome !== "ok") return { status: failure(result.outcome) };
    const pageTotal = totalFrom(result.headers.get("content-range"));
    const pageRows = result.data;
    if (pageTotal === null || !Array.isArray(pageRows) || !pageRows.every((row) => isRow(row, kind))) {
      logProblem("saved-list", "Supabase returned an unexpected list response");
      return { status: "unavailable" };
    }
    if (total === null) total = pageTotal;
    else if (pageTotal !== total) return { status: "changed" };
    rows.push(...pageRows);
    if (rows.length >= total) break;
    if (pageRows.length === 0) return { status: "changed" };
  }
  const keys = new Set(rows.map((row) => `${row.kind}:${row.item_id}`));
  if (rows.length !== total || keys.size !== total) return { status: "changed" };
  return {
    status: "ok",
    items: rows.map((row) => ({ kind: row.kind, id: row.item_id, saved_at: row.created_at })),
  };
}

/**
 * The user's whole saved list (or one kind of it), newest first:
 *   { status: "ok", items: [{ kind, id, saved_at }] }
 *   { status: "unauthenticated" | "unavailable" }
 * Never a short list: a read that doesn't add up to Supabase's count is
 * retried once, then reported as unavailable. An exact snapshot needs Max
 * rows >= 1,000 (see PAGE_SIZE).
 */
export async function listSaved(settings, token, sub, kind) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await readAllPages(settings, token, sub, kind);
    if (result.status !== "changed") {
      return result.status === "invalid" ? { status: "unavailable" } : result;
    }
  }
  logProblem("saved-list", "the list changed while it was being read, twice");
  return { status: "unavailable" };
}

// ---------------------------------------------------------------------
// save, unsave, import
// ---------------------------------------------------------------------

/**
 * Inserts one item. user_id is not sent: the database sets it.
 *   "created" | "exists" | "limit_total" | "limit_image"
 *   | "unauthenticated" | "invalid" | "unavailable"
 */
export async function addSaved(settings, token, kind, id) {
  const result = await restCall(settings, "saved-add", token, "/saved_items", {
    method: "POST",
    body: { kind, item_id: id },
    prefer: "return=minimal",
  });
  if (result.outcome === "ok") return "created";
  if (result.outcome === "duplicate") return "exists";
  if (result.outcome === "limit_total" || result.outcome === "limit_image") return result.outcome;
  return failure(result.outcome);
}

/** Deletes one item: "removed" | "absent" | "unauthenticated" | "unavailable". */
export async function removeSaved(settings, token, sub, kind, id) {
  const query = new URLSearchParams();
  query.set("user_id", `eq.${sub}`);
  query.set("kind", `eq.${kind}`);
  query.set("item_id", `eq.${id}`);
  query.set("select", "kind,item_id");
  const result = await restCall(settings, "saved-remove", token, `/saved_items?${query}`, {
    method: "DELETE",
    prefer: "return=representation",
  });
  if (result.outcome !== "ok") {
    return result.outcome === "unauthenticated" ? "unauthenticated" : "unavailable";
  }
  if (!Array.isArray(result.data)) {
    logProblem("saved-remove", "Supabase returned an unexpected delete response");
    return "unavailable";
  }
  return result.data.length > 0 ? "removed" : "absent";
}

/**
 * Decides, against the account's current list, what an import does with
 * each requested item, in request order:
 *   invalid  not a font or palette, or not a well-formed id
 *   exists   already saved (or repeated earlier in the same request)
 *   limit    no room left under the 1,000-item cap
 *   created  will be inserted (in `toCreate`)
 */
export function planImport(items, existing) {
  const saved = new Set(existing.map((item) => `${item.kind}:${item.id}`));
  const queued = new Set();
  let room = LIMITS.total - existing.length;
  const toCreate = [];
  const results = items.map(({ kind, id }) => {
    if (!IMPORT_KINDS.includes(kind) || !isValidItem(kind, id)) {
      return { kind, id, status: "invalid" };
    }
    const key = `${kind}:${id}`;
    if (saved.has(key) || queued.has(key)) return { kind, id, status: "exists" };
    if (room <= 0) return { kind, id, status: "limit" };
    room -= 1;
    queued.add(key);
    toCreate.push({ kind, item_id: id });
    return { kind, id, status: "created" };
  });
  return { results, toCreate };
}

/**
 * Imports a browser's old font and palette saves: reads the account's list,
 * inserts only the new items (all-or-nothing), and if a save from another
 * tab or device lands in between (duplicate or limit), reads and tries once
 * more. { status: "ok", results } or { status: "unauthenticated" |
 * "invalid" | "unavailable" }.
 */
export async function importSaved(settings, token, sub, items) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const listed = await listSaved(settings, token, sub);
    if (listed.status !== "ok") return listed;
    const { results, toCreate } = planImport(items, listed.items);
    if (toCreate.length) {
      const result = await restCall(settings, "saved-import", token, "/saved_items", {
        method: "POST",
        body: toCreate,
        prefer: "return=minimal",
      });
      const raced = ["duplicate", "limit_total", "limit_image"].includes(result.outcome);
      if (raced) continue;
      if (result.outcome !== "ok") return { status: failure(result.outcome) };
    }
    return { status: "ok", results };
  }
  logProblem("saved-import", "the list kept changing during an import");
  return { status: "unavailable" };
}

// ---------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------

export const INVALID = Object.freeze({ error: "invalid_request" });
export const UNAUTHENTICATED = Object.freeze({ error: "unauthenticated" });
export const UNAVAILABLE = Object.freeze({ error: "saved_unavailable" });

/** The response for a failed helper call. */
export function failureResponse(status) {
  if (status === "unauthenticated") return json(401, UNAUTHENTICATED);
  if (status === "invalid") return json(400, INVALID);
  return json(503, UNAVAILABLE);
}
