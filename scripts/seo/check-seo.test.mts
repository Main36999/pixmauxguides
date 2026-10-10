/**
 * scripts/seo/check-seo.test.mts — the integrity comparison, and static
 * guarantees about what the checker's source can do.
 *
 *     node --test scripts/seo/check-seo.test.mts
 *
 * The static tests read this directory's own source files. They do not run
 * the checker, read dist/ or write anything.
 */

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import config from "./config.mts";
import * as rules from "./lib/rules.mts";
import { compareManifest, validateManifest } from "./lib/integrity.mts";

const src = (rel: string): string => fs.readFileSync(path.join(import.meta.dirname, rel), "utf8");
const LIBS = [
  "lib/html.mts",
  "lib/links.mts",
  "lib/rules.mts",
  "lib/report.mts",
  "lib/safe-paths.mts",
  "lib/integrity.mts",
  "lib/guards.mts",
  "config.mts",
  "types.mts",
];
/** A static import, dynamic import or require() of a module that reaches the disk, network or other processes. */
const SIDE_EFFECT_MODULE = /(?:\brequire\(\s*|\bimport\(\s*|\bfrom\s*|\bimport\s+)["'](node:)?(fs|fs\/promises|child_process|net|http|https)["']/;

test("integrity: identical maps pass", () => {
  assert.deepStrictEqual(compareManifest({ a: "1", b: "2" }, { b: "2", a: "1" }), { added: [], removed: [], changed: [], ok: true });
});

test("integrity: added, removed and changed files each fail, sorted", () => {
  const diff = compareManifest({ a: "1", c: "X", z: "9", y: "8" }, { a: "1", c: "3", b: "2" });
  assert.deepStrictEqual(diff, { added: ["y", "z"], removed: ["b"], changed: ["c"], ok: false });
});

test("integrity: an inherited key is not mistaken for an approved file", () => {
  assert.strictEqual(compareManifest({ toString: "x" }, {}).ok, false);
});

test("manifest: declared algorithm and count are checked when present", () => {
  const files = { "a.html": "1", "b.css": "2" };
  assert.deepStrictEqual(validateManifest({ algorithm: "sha256", count: 2, files }), []);
  assert.deepStrictEqual(validateManifest({ files }), []);
  assert.match(validateManifest({ algorithm: "md5", files })[0], /algorithm "md5"/);
  assert.match(validateManifest({ count: 3, files })[0], /declares count 3 but lists 2/);
  assert.match(validateManifest({ count: 2 })[0], /no "files" map/);
  assert.match(validateManifest({ files: ["a"] })[0], /no "files" map/);
  assert.match(validateManifest([])[0], /not a JSON object/);
  assert.match(validateManifest(null)[0], /not a JSON object/);
});

test("manifest: the real approved-output.json passes, read here without being changed", () => {
  const manifest: unknown = JSON.parse(fs.readFileSync(config.paths.approvedOutput, "utf8"));
  assert.deepStrictEqual(validateManifest(manifest), []);
});

test("only check-seo.js touches the filesystem: no lib module or config requires fs or child_process", () => {
  LIBS.forEach((file) => {
    const code = src(file);
    assert.doesNotMatch(code, SIDE_EFFECT_MODULE, file);
  });
});

test("check-seo.js mutates the disk in exactly five calls, all through the output guards, and never deletes", () => {
  const code = src("check-seo.mts");
  const mutating = code.match(/\bfs\.(writeFile|appendFile|copyFile|rename|rm|rmdir|unlink|truncate|cp|symlink|link|mkdir|mkdtemp|chmod|utimes|createWriteStream)\w*\(/g) || [];
  assert.deepStrictEqual(mutating, ["fs.mkdirSync(", "fs.writeFileSync(", "fs.writeFileSync(", "fs.renameSync(", "fs.renameSync("]);

  const lines = code.split("\n");
  lines.filter((l) => /fs\.writeFileSync\(/.test(l)).forEach((l) => assert.match(l, /safe\.reportTarget\(out, "report\.(json|md)\.tmp"\)/));
  lines.filter((l) => /fs\.renameSync\(/.test(l)).forEach((l) => {
    assert.match(l, /safe\.reportTarget\(out, "report\.(json|md)\.tmp"\), safe\.reportTarget\(out, "report\.\1"\)/);
  });
  assert.deepStrictEqual(code.match(/fs\.mkdirSync\(([^,]+),/g), ["fs.mkdirSync(out,"]);
});

test("check-seo.js renames report.md before report.json, then reads the pair back", () => {
  const code = src("check-seo.mts");
  const md = code.indexOf('fs.renameSync(safe.reportTarget(out, "report.md.tmp")');
  const json = code.indexOf('fs.renameSync(safe.reportTarget(out, "report.json.tmp")');
  const verify = code.indexOf("report.verifyPair(");
  assert.ok(md > 0 && json > md && verify > json);
});

test("check-seo.js never names approved-output.json, a baseline or dist/ as a write target", () => {
  const code = src("check-seo.mts");
  const writeArgs = (code.match(/fs\.(writeFileSync|mkdirSync|renameSync)\([^;]*;/g) || []).join("\n");
  assert.doesNotMatch(writeArgs, /approvedOutput|baseline|dist/);
});

test("every failure message warns that existing reports may be stale", () => {
  const code = src("check-seo.mts");
  assert.match(code, /from an EARLIER run and may be stale/);
});

test("check-seo.js takes no options, so nothing can redirect its output", () => {
  const code = src("check-seo.mts");
  assert.match(code, /process\.argv\.length > 2\) throw new Refusal/);
  assert.doesNotMatch(code, /process\.env\.\w+/);
});

test("exceptions.json starts empty and is valid", () => {
  const entries: unknown = JSON.parse(src("exceptions.json"));
  assert.deepStrictEqual(rules.validateExceptions(entries), []);
});
