/**
 * scripts/seo/lib/links.js — classifies an <a href> against the published
 * file inventory and the published _redirects rules.
 *
 * NOTHING HERE TOUCHES THE FILESYSTEM. A link is resolved against `inventory`,
 * the Set of every file path in dist/ (posix, case-exact) that the checker
 * built once by walking dist/. So a link written to escape dist/ — "../../..",
 * "%2e%2e", a backslash — can never cause a read: it is either normalized
 * away by URL resolution or rejected as `invalid`, and in both cases only a
 * Set is consulted.
 *
 * HOW A PATH MAPS TO A FILE (Netlify with Pretty URLs, as src/build/routes.js
 * documents it)
 *
 *   /                 index.html
 *   /x/               x/index.html
 *   /x.ext            x.ext exactly
 *   /x                x.html, else a file named x, else x/index.html
 *                     (Netlify answers that last one with a 301 to /x/)
 *
 * A path no file serves is looked up in _redirects. Netlify applies an
 * unforced rule only when no file matches, and a forced ("!") rule first;
 * both orders are honoured. Only exact-path rules are understood. A rule with
 * a placeholder, splat or query condition is reported by parseRedirects as
 * unsupported, and the checker fails closed on it rather than guess.
 *
 * Pure. Same input, same output.
 */

"use strict";

const LINK_KIND = {
  external: "external", // another host
  nonHttp: "non-http", // mailto:, tel:, javascript:, data: …
  hashRoute: "hash-route", // "#/privacy": a client-side route, not an element id
  internal: "internal",
};

const STATUS = {
  ok: "ok",
  redirect: "redirect", // 3xx: from _redirects, or a directory without its slash
  rewrite: "rewrite", // 200 rule in _redirects whose target exists
  gone: "gone", // 410
  broken: "broken", // no file and no rule, a 404 rule, or a rewrite to nothing
  invalid: "invalid", // undecodable, or a segment that would climb out of dist/
};

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Parses a Netlify _redirects file. Returns the exact-path rules by `from`,
 * and every rule this module cannot evaluate exactly.
 */
function parseRedirects(text) {
  const rules = new Map();
  const unsupported = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) return;
      const fields = line.split(/\s+/);
      const where = { line: index + 1, text: rawLine.trim() };
      if (fields.length < 2) {
        unsupported.push({ ...where, reason: "fewer than two fields" });
        return;
      }
      const [from, to, statusField = "301"] = fields;
      const force = statusField.endsWith("!");
      const status = Number(statusField.replace(/!$/, ""));
      if (fields.length > 3 || /[*:]/.test(from) || from.includes("?") || !from.startsWith("/") || !Number.isInteger(status)) {
        unsupported.push({ ...where, reason: "not an exact-path rule this checker can evaluate" });
        return;
      }
      if (!rules.has(from)) rules.set(from, { from, to, status, force, line: index + 1 });
    });
  return { rules, unsupported };
}

/**
 * Decodes a URL pathname into dist/-relative segments, or null when any
 * segment cannot be decoded or would name a parent, the current directory, a
 * nested separator or a NUL — the shapes a traversal attempt takes once
 * percent-decoded.
 */
function pathSegments(pathname) {
  const parts = pathname.split("/").slice(1);
  const out = [];
  for (let k = 0; k < parts.length; k += 1) {
    let seg;
    try {
      seg = decodeURIComponent(parts[k]);
    } catch {
      return null;
    }
    const last = k === parts.length - 1;
    if (seg === "" && !last) return null; // "//" inside a path
    if (seg === "." || seg === ".." || /[\\/\0]/.test(seg)) return null;
    out.push(seg);
  }
  return out;
}

/**
 * Resolves a site path to the file that serves it.
 *   { status, file?, location?, rule? }
 */
function resolvePath(pathname, inventory, redirects, depth = 0) {
  const segs = pathSegments(pathname);
  if (!segs) return { status: STATUS.invalid };

  const decodedPath = "/" + segs.join("/");
  const rule = redirects.rules.get(pathname) || redirects.rules.get(decodedPath);

  const applyRule = () => {
    if (REDIRECT_CODES.has(rule.status)) return { status: STATUS.redirect, location: rule.to, rule: rule.line };
    if (rule.status === 410) return { status: STATUS.gone, rule: rule.line };
    if (rule.status === 200) {
      if (depth > 0) return { status: STATUS.broken, rule: rule.line };
      const target = resolvePath(rule.to.split(/[?#]/)[0], inventory, redirects, depth + 1);
      return target.status === STATUS.ok
        ? { status: STATUS.rewrite, file: target.file, rule: rule.line }
        : { status: STATUS.broken, rule: rule.line };
    }
    return { status: STATUS.broken, rule: rule.line };
  };

  if (rule && rule.force) return applyRule();

  const last = segs[segs.length - 1];
  const rel = segs.join("/");
  if (last === "") {
    const index = rel + "index.html";
    if (inventory.has(index)) return { status: STATUS.ok, file: index };
  } else if (last.includes(".")) {
    if (inventory.has(rel)) return { status: STATUS.ok, file: rel };
  } else {
    if (inventory.has(rel + ".html")) return { status: STATUS.ok, file: rel + ".html" };
    if (inventory.has(rel)) return { status: STATUS.ok, file: rel };
    if (inventory.has(rel + "/index.html")) return { status: STATUS.redirect, location: decodedPath + "/" };
  }

  if (rule) return applyRule();
  return { status: STATUS.broken };
}

/**
 * Classifies one href found on the page at `pageUrl` (its site path, e.g.
 * "/guide/type-scale-systems").
 *
 *   { kind, status?, file?, fragment?, location?, path? }
 *
 * `fragment` is the decoded #id the link targets, or null; checking that the
 * id exists is the caller's job, because only the caller has every page's ids.
 */
function classifyHref(href, pageUrl, site) {
  const raw = String(href).trim();
  const base = new URL(pageUrl, site.origin);

  if (raw.startsWith("#/")) return { kind: LINK_KIND.hashRoute };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1])) return { kind: LINK_KIND.nonHttp };

  let url;
  try {
    url = new URL(raw, base);
  } catch {
    return { kind: LINK_KIND.internal, status: STATUS.invalid, path: raw };
  }
  if (!site.hosts.includes(url.hostname)) return { kind: LINK_KIND.external };

  let fragment = null;
  if (url.hash && url.hash !== "#") {
    if (url.hash.startsWith("#/")) return { kind: LINK_KIND.hashRoute };
    try {
      fragment = decodeURIComponent(url.hash.slice(1));
    } catch {
      fragment = url.hash.slice(1);
    }
  }

  const resolved = resolvePath(url.pathname, site.inventory, site.redirects);
  return { kind: LINK_KIND.internal, path: url.pathname, fragment, ...resolved };
}

module.exports = { parseRedirects, resolvePath, classifyHref, pathSegments, LINK_KIND, STATUS };
