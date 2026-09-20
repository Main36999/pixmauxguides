#!/usr/bin/env node
/**
 * tools/check-forbidden-color.js
 * -----------------------------------------------------------------------
 * Build-time guard for the Phase 4 /tokens/ redesign.
 *
 * The brief for that redesign is absolute: #0f2a52 — the site's navy
 * brand ink — must not render anywhere in the /tokens/ section, in ANY
 * notation. A plain `grep '#0f2a52'` is not enough to prove that, for
 * three reasons, so this guard checks all three:
 *
 *   1. NOTATION. The same color can be written #0f2a52, #0F2A52, #0f2A52,
 *      rgb(15,42,82), rgba(15, 42, 82, .3), rgb(15 42 82 / 30%) … Every
 *      hex and functional form is normalised to one canonical value and
 *      compared numerically, so casing and whitespace cannot hide it.
 *
 *   2. INDIRECTION. tokens.css never writes the hex — it used to reach
 *      the color through `var(--ink)`, which :root in styles.css defines
 *      as #0f2a52. A token page that consumes var(--ink) renders the
 *      forbidden color just as surely as one that hard-codes it. So any
 *      var(--ink)/var(--ink-2) use in CSS that a /tokens/ page loads is
 *      reported unless it is explicitly neutralised for .tokens-page.
 *
 *   3. REACH. The section loads three stylesheets, only one of which it
 *      owns. styles.css and guide-article.css are shared with the rest
 *      of the site, where the navy is legitimate — so those two are
 *      scanned for *tokens-page-reachable* leakage, not banned outright.
 *
 * Usage:
 *   node tools/check-forbidden-color.js          # scan, exit 1 on any hit
 *   node tools/check-forbidden-color.js --quiet  # only print failures
 *
 * Exit codes: 0 = clean, 1 = forbidden color found, 2 = guard error.
 * -----------------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TOKENS_DIR = path.join(ROOT, "tokens");
const QUIET = process.argv.includes("--quiet");

/** The one color under interdiction, as canonical RGB. */
const FORBIDDEN = { r: 15, g: 42, b: 82 }; // #0f2a52
const FORBIDDEN_KEY = "15,42,82";

/**
 * Files scanned with a HARD ban: nothing here may reference the color in
 * any form, directly or through the --ink custom properties.
 */
const HARD_BANNED = [
  { label: "generated token pages", files: () => listHtml(TOKENS_DIR) },
  { label: "token stylesheet", files: () => [path.join(ROOT, "tokens.css")] },
  {
    label: "token-page scripts",
    files: () =>
      [
        "tokens-shared.js",
        "tokens-gallery.js",
        "tokens-detail.js",
        "tokens-create.js",
        "tokens-collection.js",
        "tokens-tabs.js",
        "tokens-color.js",
        "tokens-a11y.js",
        "tokens-export.js",
      ].map((f) => path.join(ROOT, f)),
  },
  { label: "token page generator", files: () => [path.join(ROOT, "build-tokens.js")] },
];

/**
 * Shared stylesheets the token pages LOAD but do not own. The navy is
 * legitimate elsewhere on the site, so these are scanned only for
 * declarations that could reach a .tokens-page element.
 */
const SHARED_CSS = [path.join(ROOT, "styles.css"), path.join(ROOT, "guide-article.css")];

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function listHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join(dir, f));
}

function rel(p) {
  return path.relative(ROOT, p) || p;
}

/** #rgb / #rrggbb / #rrggbbaa -> {r,g,b} */
function parseHex(token) {
  let h = token.replace(/^#/, "");
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (h.length === 8) {
    h = h.slice(0, 6);
  } else if (h.length !== 6) {
    return null;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** rgb()/rgba() in comma OR modern space/slash syntax, ints or percents. */
function parseRgbFunc(body) {
  const nums = body
    .replace(/\//g, " ")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (nums.length < 3) return null;
  const chan = nums.slice(0, 3).map((n) => {
    if (n.endsWith("%")) return Math.round((parseFloat(n) / 100) * 255);
    return Number(n);
  });
  if (chan.some((n) => !Number.isFinite(n))) return null;
  return { r: chan[0], g: chan[1], b: chan[2] };
}

function isForbidden(rgb) {
  return rgb && rgb.r === FORBIDDEN.r && rgb.g === FORBIDDEN.g && rgb.b === FORBIDDEN.b;
}

// ---------------------------------------------------------------------
// scanners
// ---------------------------------------------------------------------
const findings = [];

function record(file, lineNo, matched, why) {
  findings.push({ file: rel(file), line: lineNo, matched: matched.trim(), why });
}

/**
 * Remove comments before scanning. A mention of the color inside a
 * comment — including the ones in tokens.css and this file that document
 * the ban — is prose, not a rendered color. Replaced with equal-length
 * blanks so line numbers stay accurate.
 */
function stripComments(src, isHtml) {
  let out = src;
  const blank = (m) => m.replace(/[^\n]/g, " ");
  if (isHtml) {
    out = out.replace(/<!--[\s\S]*?-->/g, blank);
  }
  // /* block */ — valid in both CSS and JS
  out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (!isHtml) {
    // // line comment — JS only. Skip anything that looks like a URL
    // scheme (https://) so real code is not mangled.
    out = out.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
  }
  return out;
}

/** Colour literals in any notation, plus --ink indirection if asked. */
function scanFile(file, opts) {
  opts = opts || {};
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  const lines = stripComments(raw, file.endsWith(".html")).split(/\r?\n/);

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // hex literals (3/4/6/8 digit)
    const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
    let m;
    while ((m = hexRe.exec(line))) {
      if (isForbidden(parseHex(m[0]))) record(file, lineNo, m[0], "hex literal");
    }

    // rgb()/rgba(), comma or space/slash syntax
    const fnRe = /rgba?\(([^)]*)\)/gi;
    while ((m = fnRe.exec(line))) {
      if (isForbidden(parseRgbFunc(m[1]))) record(file, lineNo, m[0], "rgb/rgba literal");
    }

    // indirection through the site's navy custom properties
    if (opts.banInk && /var\(\s*--ink(-2)?\s*\)/.test(line)) {
      const v = line.match(/var\(\s*--ink(-2)?\s*\)/)[0];
      record(file, lineNo, v, "resolves to the forbidden color via :root --ink");
    }
  });
}

/**
 * Shared stylesheets: find every var(--ink)/var(--ink-2) consumer and
 * report the ones that can actually reach a /tokens/ page.
 *
 * "Can reach" is decided from evidence, not a hand-maintained allowlist:
 * the class names in the selector are checked against the classes that
 * actually appear in the generated /tokens/*.html. A rule like
 * `.guide-article pre { background: var(--ink) }` cannot paint anything
 * in this section because no token page carries .guide-article — whereas
 * `.skip-link` and `.toast` do, so those must be neutralised.
 *
 * This means a NEW --ink consumer whose selector does match a token page
 * fails the build automatically, and a guide-only rule does not have to
 * be excused by hand.
 */
function tokenPageClasses() {
  const set = new Set();
  for (const f of listHtml(TOKENS_DIR)) {
    const html = fs.readFileSync(f, "utf8");
    const re = /class="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      m[1]
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => set.add(c));
    }
  }
  return set;
}

function selectorClasses(sel) {
  const out = [];
  const re = /\.([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = re.exec(sel))) out.push(m[1]);
  return out;
}

function scanSharedCss(file, present) {
  if (!fs.existsSync(file)) return;
  const css = stripComments(fs.readFileSync(file, "utf8"), false);

  // A literal inside a rule already scoped to .tokens-page is always a
  // hard failure — that rule paints this section by definition.
  css.split(/\r?\n/).forEach((line, i) => {
    if (!/tokens-page/.test(line)) return;
    const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
    let m;
    while ((m = hexRe.exec(line))) {
      if (isForbidden(parseHex(m[0]))) record(file, i + 1, m[0], "hex literal inside a .tokens-page rule");
    }
    const fnRe = /rgba?\(([^)]*)\)/gi;
    while ((m = fnRe.exec(line))) {
      if (isForbidden(parseRgbFunc(m[1]))) record(file, i + 1, m[0], "rgb/rgba inside a .tokens-page rule");
    }
  });

  // Collect the .tokens-page overrides: property -> set of classes the
  // overriding selector mentions. Used to confirm a specific component
  // was neutralised, not just that some rule happens to set the property.
  const overrides = new Map();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let r;
  while ((r = ruleRe.exec(css))) {
    const sel = r[1];
    if (!/tokens-page/.test(sel)) continue;
    const classes = new Set(selectorClasses(sel));
    r[2].replace(/([a-z-]+)\s*:/gi, (_, prop) => {
      const p = prop.trim().toLowerCase();
      if (!overrides.has(p)) overrides.set(p, new Set());
      classes.forEach((c) => overrides.get(p).add(c));
      return _;
    });
  }

  ruleRe.lastIndex = 0;
  while ((r = ruleRe.exec(css))) {
    const sel = r[1].trim();
    const body = r[2];
    if (!/var\(\s*--ink(-2)?\s*\)/.test(body)) continue;
    if (/tokens-page/.test(sel)) continue; // already scoped away

    // Reachability: every class the selector requires must exist on at
    // least one token page. No classes at all (element/attr selector) is
    // treated as reachable, which is the conservative reading.
    const needed = selectorClasses(sel);
    const reachable = needed.every((c) => present.has(c));
    if (!reachable) continue;

    const lineNo = css.slice(0, r.index).split(/\r?\n/).length;
    body.replace(/([a-z-]+)\s*:\s*([^;]*var\(\s*--ink(-2)?\s*\)[^;]*)/gi, (_, prop, value) => {
      const p = prop.trim().toLowerCase();
      const covered = overrides.has(p) && needed.some((c) => overrides.get(p).has(c));
      if (!covered) {
        record(
          file,
          lineNo,
          `${sel.replace(/\s+/g, " ").slice(0, 70)} { ${p}: ${value.trim()} }`,
          `reachable from /tokens/ and consumes --ink with no body.tokens-page override for "${p}"`,
        );
      }
      return _;
    });
  }
}

// ---------------------------------------------------------------------
// run
// ---------------------------------------------------------------------
let scanned = 0;
try {
  for (const group of HARD_BANNED) {
    for (const f of group.files()) {
      scanFile(f, { banInk: true });
      scanned++;
    }
  }
  const present = tokenPageClasses();
  for (const f of SHARED_CSS) {
    scanSharedCss(f, present);
    scanned++;
  }
} catch (err) {
  console.error("check-forbidden-color: guard failed to run —", err.message);
  process.exit(2);
}

if (findings.length) {
  console.error("\n✗ FORBIDDEN COLOR #0f2a52 FOUND — " + findings.length + " occurrence(s):\n");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`      matched: ${f.matched}`);
    console.error(`      reason:  ${f.why}\n`);
  }
  console.error("The /tokens/ section must not render #0f2a52 in any notation.");
  console.error("See the header comment in tokens.css.\n");
  process.exit(1);
}

if (!QUIET) {
  console.log(`✓ forbidden-color guard: 0 occurrences of #0f2a52 across ${scanned} scanned files.`);
  console.log("  checked: hex (3/4/6/8-digit, any case), rgb()/rgba() (comma + space/slash,");
  console.log("  int + percent), and var(--ink)/var(--ink-2) indirection.");
}
process.exit(0);
