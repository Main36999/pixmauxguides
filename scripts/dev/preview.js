#!/usr/bin/env node
/**
 * scripts/dev/preview.js — local design preview of the whole site.
 *
 *     npm run preview            build into .preview/ and serve it
 *     npm run preview -- --build-only
 *     npm run preview -- --port 4180
 *
 * WHY THIS EXISTS
 *
 * `npm run build` ends with the `verify` gate, which deletes dist/ whenever
 * the output differs from scripts/qa/approved-output.json. During the
 * platform redesign the output differs on purpose, so the real build cannot
 * leave anything to look at. This script runs the SAME pipeline stages
 * (src/build/build.js PIPELINE) minus `verify`, with dist/ and the staging
 * root pointed at .preview/ instead:
 *
 *   - it never writes dist/, .build/, scripts/qa/ or any tracked file;
 *   - it never reads or writes approved-output.json or the baselines;
 *   - it is not a deploy path: Netlify and CI run `npm run build` only.
 *
 * THE SERVER
 *
 * A tiny static server bound to 127.0.0.1. It resolves URLs the way Netlify
 * Pretty URLs does (/about -> about.html, /guides/ -> guides/index.html) and
 * answers 404 with 404.html. Netlify Functions do not run here, so /api/*
 * gets local stand-ins:
 *
 *   GET /api/auth/session   signed out, or a DEMO account after
 *                           /__preview/sign-in (cleared by /__preview/sign-out)
 *   anything else /api/*    503 JSON, which the client code treats as
 *                           "backend unavailable"
 *
 * Nothing here talks to the network; third-party scripts in the pages
 * (Cookiebot, gtag, fonts CDN) load or fail in the browser as they would.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");
const config = require(path.join(ROOT, "site.config.js"));
const { PIPELINE } = require(path.join(ROOT, "src", "build", "build.js"));

const OUT = path.join(ROOT, ".preview");
const DIST = path.join(OUT, "dist");
const STAGE = path.join(OUT, "stage");

const args = process.argv.slice(2);
const buildOnly = args.includes("--build-only");
const portArg = args.indexOf("--port");
const PORT = portArg !== -1 ? Number(args[portArg + 1]) : 4173;

// ---------------------------------------------------------------------
// build
// ---------------------------------------------------------------------

function build() {
  const warnings = [];
  const ctx = {
    config: Object.assign({}, config, {
      paths: Object.assign({}, config.paths, { dist: DIST, stage: STAGE }),
    }),
    warn: (message) => warnings.push(message),
  };

  console.log("bpozz preview build (no verify gate) -> .preview/dist");
  for (const stage of PIPELINE) {
    if (stage.name === "verify") continue;
    const started = Date.now();
    const summary = stage(ctx);
    console.log(`  ${stage.name.padEnd(8)} ${summary} (${Date.now() - started} ms)`);
  }
  warnings.forEach((w) => console.log(`  warning: ${w}`));
  console.log(`  ${ctx.routes.length} pages`);
}

// ---------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
};

const DEMO_SESSION = {
  authenticated: true,
  providers: { google: true, email: true },
  user: {
    display_name: "Demo Designer",
    email: "demo.designer@example.com",
    avatar_url: "",
  },
};
const SIGNED_OUT = {
  authenticated: false,
  providers: { google: true, email: true },
};

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean.replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(rel, "index.html")]
    : [rel, `${rel}.html`, path.join(rel, "index.html")];
  for (const candidate of candidates) {
    const abs = path.resolve(DIST, candidate);
    if (!inside(DIST, abs)) return null;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function send(res, status, type, body, extra) {
  res.writeHead(status, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra || {}));
  res.end(body);
}

function json(res, status, value, extra) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value), extra);
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    // Signed in as the demo account after /__preview/sign-in (a cookie), or
    // for a page opened with ?preview-auth=demo (its own requests carry that
    // URL as their Referer), which also works inside a framed page where
    // the cookie isn't sent.
    const signedIn =
      /(?:^|;\s*)bpozz_preview_auth=demo/.test(req.headers.cookie || "") ||
      /[?&]preview-auth=demo(?:&|$)/.test(req.headers.referer || "");

    if (url.startsWith("/__preview/sign-in")) {
      return send(res, 302, "text/plain", "", {
        "Set-Cookie": "bpozz_preview_auth=demo; Path=/; SameSite=Lax",
        Location: "/studio/",
      });
    }
    const clearAuth = "bpozz_preview_auth=; Path=/; Max-Age=0; SameSite=Lax";
    if (url.startsWith("/__preview/sign-out")) {
      return send(res, 302, "text/plain", "", { "Set-Cookie": clearAuth, Location: "/" });
    }
    if (url.startsWith("/api/auth/signout")) {
      return json(res, 200, { ok: true }, { "Set-Cookie": clearAuth });
    }
    if (url.startsWith("/api/auth/session")) {
      return json(res, 200, signedIn ? DEMO_SESSION : SIGNED_OUT);
    }
    if (url.startsWith("/api/")) {
      return json(res, 503, { error: "Netlify Functions do not run in the local preview." });
    }

    const file = resolveFile(url);
    if (!file) {
      const notFound = path.join(DIST, "404.html");
      return send(res, 404, TYPES[".html"], fs.existsSync(notFound) ? fs.readFileSync(notFound) : "Not found");
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    send(res, 200, type, fs.readFileSync(file));
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log("");
    console.log(`  Preview: http://localhost:${PORT}/`);
    console.log(`  Demo sign-in: http://localhost:${PORT}/__preview/sign-in`);
    console.log("  Ctrl+C to stop.");
  });
}

build();
if (!buildOnly) serve();
