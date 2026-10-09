/**
 * scripts/seo/lib/safe-paths.test.js — the read and write boundaries, as
 * path computations on both Windows and posix path rules.
 *
 *     node --test scripts/seo/lib/safe-paths.test.js
 *
 * Nothing is read or written: these are the checks check-seo.js routes every
 * page read and both report writes through.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const config = require("../config.js");
const safe = require("./safe-paths.js");

const WIN = { repo: "D:\\site", dist: "D:\\site\\dist", qa: "D:\\site\\.qa" };
const POSIX = { repo: "/srv/site", dist: "/srv/site/dist", qa: "/srv/site/.qa" };

test("reads stay inside dist/ (win32)", () => {
  const p = path.win32;
  assert.strictEqual(safe.resolveInside(WIN.dist, "guide/x.html", p), "D:\\site\\dist\\guide\\x.html");
  for (const bad of ["../package.json", "guide/../../package.json", "C:\\Windows\\win.ini", "D:/site/x", "\\\\server\\share", "/etc/passwd", "a\0b", "", "guide/.."]) {
    assert.throws(() => safe.resolveInside(WIN.dist, bad, p), /refused/, JSON.stringify(bad));
  }
});

test("reads stay inside dist/ (posix)", () => {
  const p = path.posix;
  assert.strictEqual(safe.resolveInside(POSIX.dist, "guide/x.html", p), "/srv/site/dist/guide/x.html");
  for (const bad of ["../package.json", "/etc/passwd", "guide/../../x"]) {
    assert.throws(() => safe.resolveInside(POSIX.dist, bad, p), /refused/, bad);
  }
});

test("a sibling directory that shares dist's prefix is outside it", () => {
  assert.strictEqual(safe.isWithin("D:\\site\\dist", "D:\\site\\dist-old\\x", path.win32), false);
  assert.strictEqual(safe.isWithin("/srv/site/dist", "/srv/site/dist2", path.posix), false);
  assert.strictEqual(safe.isWithin("D:\\Site\\Dist", "d:\\site\\dist\\a", path.win32), true);
});

test("the output directory must be exactly <qa>/seo, never inside dist/", () => {
  const p = path.win32;
  assert.strictEqual(safe.assertOutputDir("D:\\site\\.qa\\seo", WIN, p), "D:\\site\\.qa\\seo");
  assert.throws(() => safe.assertOutputDir("D:\\site\\dist", WIN, p), /must be/);
  assert.throws(() => safe.assertOutputDir("D:\\site\\dist\\seo", WIN, p), /must be/);
  assert.throws(() => safe.assertOutputDir("D:\\site\\scripts\\qa", WIN, p), /must be/);
  // Even if someone pointed qa/ inside dist/, the output is still refused.
  assert.throws(() => safe.assertOutputDir("D:\\site\\dist\\.qa\\seo", { ...WIN, qa: "D:\\site\\dist\\.qa" }, p), /inside dist/);
});

test("only report.json and report.md, and their .tmp names, can be written", () => {
  assert.strictEqual(safe.reportTarget("/o", "report.json", path.posix), "/o/report.json");
  assert.strictEqual(safe.reportTarget("/o", "report.md.tmp", path.posix), "/o/report.md.tmp");
  assert.deepStrictEqual([...safe.TEMP_FILES], ["report.json.tmp", "report.md.tmp"]);
  for (const bad of ["approved-output.json", "../report.json", "index.html", "report.JSON", "report.tmp", "report.json.tmp.tmp", "../report.md.tmp"]) {
    assert.throws(() => safe.reportTarget("/o", bad, path.posix), /refused/, bad);
  }
});

test("the configured locations satisfy the same rules", () => {
  const { repo, dist, qa, out } = config.paths;
  assert.strictEqual(safe.assertOutputDir(out, { repo, qa, dist }), out);
  assert.strictEqual(safe.isWithin(dist, out), false);
  assert.strictEqual(safe.isWithin(dist, config.paths.approvedOutput), false);
});
