/**
 * scripts/seo/lib/report.test.js — report.json and report.md are
 * deterministic, and carry nothing machine-specific.
 *
 *     node --test scripts/seo/lib/report.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const config = require("../config.js");
const report = require("./report.js");

const SOURCE = { approvedOutputSha256: "a".repeat(64), distFiles: 3, htmlPages: 2, indexablePages: 1 };
const LINKS = { internalOk: 1, rewrite: 0, redirect: 0, gone: 0, broken: 1, invalid: 0, fragmentMissing: 0, external: 0, nonHttp: 0, hashRoute: 0 };

const findings = () => [
  { rule: "title-length", severity: "warning", scope: "page", message: "m", evidence: "e|pipe", pages: [{ url: "/b", file: "b.html", type: "page", line: 3 }] },
  { rule: "link-broken", severity: "error", scope: "page", message: "m", evidence: 'href="/x"', pages: [{ url: "/a", file: "a.html", type: "page", line: 9 }] },
  { rule: "title-duplicate", severity: "warning", scope: "group", message: "2 share", evidence: "T", pages: [{ url: "/z", file: "z.html", type: "page" }, { url: "/a", file: "a.html", type: "page" }] },
];

const build = (list) => report.buildReport({ config, source: SOURCE, findings: list, linkStats: LINKS, exceptions: [] });

test("findings are ordered by severity, then rule; pages inside a finding by URL", () => {
  const r = build(findings());
  assert.deepStrictEqual(r.findings.map((f) => f.rule), ["link-broken", "title-duplicate", "title-length"]);
  assert.deepStrictEqual(r.findings[1].pages.map((p) => p.url), ["/a", "/z"]);
  assert.deepStrictEqual(r.summary.bySeverity, { error: 1, warning: 3, info: 0 });
});

test("input order does not change a byte of either report", () => {
  const a = build(findings());
  const b = build(findings().reverse());
  assert.strictEqual(report.stableStringify(a), report.stableStringify(b));
  assert.strictEqual(report.renderMarkdown(a), report.renderMarkdown(b));
});

test("stableStringify sorts keys at every depth", () => {
  assert.strictEqual(report.stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 0 } }), '{\n  "a": {\n    "c": 0,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
});

test("no timestamp, absolute path or runtime version reaches either report", () => {
  const json = report.stableStringify(build(findings()));
  const markdown = report.renderMarkdown(build(findings()));
  [json, markdown].forEach((text) => {
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\/home\//);
    assert.ok(!text.includes(process.version));
  });
});

test("pair id: deterministic, 64 hex, the hash of the report without itself", () => {
  const a = build(findings());
  const b = build(findings().reverse());
  assert.match(a.pairId, /^[0-9a-f]{64}$/);
  assert.strictEqual(a.pairId, b.pairId);
  assert.strictEqual(report.pairIdFor(a), a.pairId);
  const other = report.buildReport({ config, source: { ...SOURCE, distFiles: 4 }, findings: findings(), linkStats: LINKS, exceptions: [] });
  assert.notStrictEqual(other.pairId, a.pairId);
});

test("pair check: files from the same run verify", () => {
  const r = build(findings());
  const result = report.verifyPair(report.stableStringify(r), report.renderMarkdown(r));
  assert.deepStrictEqual(result, { ok: true, pairId: r.pairId });
  assert.match(report.renderMarkdown(r), new RegExp(`^- report pair id: \`${r.pairId}\`$`, "m"));
});

test("pair check: a report.md from another run is detected", () => {
  const current = build(findings());
  const earlier = report.buildReport({ config, source: { ...SOURCE, htmlPages: 1 }, findings: findings().slice(1), linkStats: LINKS, exceptions: [] });
  const result = report.verifyPair(report.stableStringify(current), report.renderMarkdown(earlier));
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /different pair ids/);
});

test("pair check: an edited, truncated or id-less report.json is detected", () => {
  const r = build(findings());
  const json = report.stableStringify(r);
  const markdown = report.renderMarkdown(r);

  const edited = report.verifyPair(json.replace('"htmlPages": 2', '"htmlPages": 3'), markdown);
  assert.match(edited.reason, /does not match its own pairId/);

  const truncated = report.verifyPair(json.slice(0, json.length / 2), markdown);
  assert.match(truncated.reason, /does not parse/);

  const { pairId, ...noId } = r;
  assert.match(report.verifyPair(report.stableStringify(noId), markdown).reason, /no pairId/);

  const noLine = markdown.split("\n").filter((l) => !l.includes("report pair id:")).join("\n");
  assert.match(report.verifyPair(json, noLine).reason, /no pair id line/);
});

test("markdown escapes table pipes and states that the limits are advisory", () => {
  const markdown = report.renderMarkdown(build(findings()));
  assert.match(markdown, /e\\\|pipe/);
  assert.match(markdown, /not Google requirements/);
  assert.match(markdown, /`dist\/a\.html:9`/);
});
