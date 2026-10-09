/**
 * scripts/seo/lib/safe-paths.js — the checker's read and write boundaries.
 *
 *   reads   only inside dist/ (plus the two fixed inputs check-seo.js names:
 *           approved-output.json and exceptions.json)
 *   writes  only <repo>/.qa/seo/report.json and <repo>/.qa/seo/report.md,
 *           each first under its temporary name (report.json.tmp,
 *           report.md.tmp) and then renamed into place
 *
 * These are path computations, not I/O, so they are tested without touching
 * the disk. check-seo.js routes every read of a page and every write through
 * them. Run the checker under Node's permission model as well (see its
 * header): that makes the same boundary a runtime guarantee instead of a
 * convention.
 *
 * Pure: `path` only.
 */

"use strict";

const path = require("path");

const REPORT_FILES = Object.freeze(["report.json", "report.md"]);
/** The same two reports under their temporary names, written before they are renamed into place. */
const TEMP_FILES = Object.freeze(REPORT_FILES.map((name) => `${name}.tmp`));

/** Windows paths compare case-insensitively; posix paths do not. */
function key(p, platformPath = path) {
  const resolved = platformPath.resolve(p);
  return platformPath === path.win32 || (platformPath === path && process.platform === "win32")
    ? resolved.toLowerCase()
    : resolved;
}

/** True when `target` is `dir` itself or anywhere beneath it. */
function isWithin(dir, target, platformPath = path) {
  const rel = platformPath.relative(key(dir, platformPath), key(target, platformPath));
  return rel === "" || (!rel.startsWith("..") && !platformPath.isAbsolute(rel));
}

/**
 * The absolute path of `rel` (posix, as the inventory stores it) inside
 * `root`, or a thrown error. Refuses absolute paths, NUL, and anything that
 * resolves to `root` itself or outside it.
 */
function resolveInside(root, rel, platformPath = path) {
  if (typeof rel !== "string" || !rel || rel.includes("\0")) throw new Error(`refused path: ${JSON.stringify(rel)}`);
  if (platformPath.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("\\") || rel.startsWith("/")) {
    throw new Error(`refused absolute path: ${rel}`);
  }
  const abs = platformPath.resolve(root, ...rel.split("/"));
  const inside = platformPath.relative(key(root, platformPath), key(abs, platformPath));
  if (!inside || inside.startsWith("..") || platformPath.isAbsolute(inside)) {
    throw new Error(`refused path outside ${root}: ${rel}`);
  }
  return abs;
}

/**
 * Checks the output directory against the fixed locations: it must be
 * exactly <qa>/seo, inside the repository, and not inside dist/.
 */
function assertOutputDir(outDir, { repo, qa, dist }, platformPath = path) {
  const expected = platformPath.join(qa, "seo");
  if (key(outDir, platformPath) !== key(expected, platformPath)) throw new Error(`output directory must be ${expected}, got ${outDir}`);
  if (!isWithin(repo, outDir, platformPath)) throw new Error(`output directory is outside the repository: ${outDir}`);
  if (isWithin(dist, outDir, platformPath)) throw new Error(`output directory is inside dist/: ${outDir}`);
  return outDir;
}

/** The absolute path of one of the two reports or its temporary name, and nothing else. */
function reportTarget(outDir, name, platformPath = path) {
  if (!REPORT_FILES.includes(name) && !TEMP_FILES.includes(name)) throw new Error(`refused report file name: ${name}`);
  return platformPath.join(outDir, name);
}

module.exports = { resolveInside, isWithin, assertOutputDir, reportTarget, REPORT_FILES, TEMP_FILES };
