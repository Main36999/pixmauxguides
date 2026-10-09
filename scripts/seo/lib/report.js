/**
 * scripts/seo/lib/report.js — findings to report.json and report.md text.
 *
 * DETERMINISTIC BY CONSTRUCTION
 *
 * No timestamp, hostname, absolute path or Node version is written. Findings
 * are sorted (severity, rule, message, evidence, first page), the pages inside
 * a finding are sorted by URL, and every object is serialized with its keys
 * sorted. Two runs over the same dist/ produce byte-identical files.
 *
 * THE PAIR ID
 *
 * report.json and report.md are written separately, so nothing makes them
 * one unit on disk. Each therefore carries `pairId`: the sha256 of the
 * report data itself (pairId excluded). It is deterministic, so a re-run over
 * the same dist/ yields the same id, and verifyPair() can tell whether the two
 * files on disk came from the same run — and whether report.json still hashes
 * to the id it claims.
 *
 * Pure: returns strings; check-seo.js writes them. (crypto is used for the
 * hash only; nothing here touches the filesystem.)
 */

"use strict";

const crypto = require("crypto");

const SEVERITY_ORDER = ["error", "warning", "info"];
const PAIR_LABEL = "report pair id:";

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sortFindings(findings) {
  return findings
    .map((f) => ({ ...f, pages: f.pages.slice().sort((a, b) => byText(a.url, b.url) || (a.line || 0) - (b.line || 0)) }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        byText(a.rule, b.rule) ||
        byText(a.message, b.message) ||
        byText(a.evidence, b.evidence) ||
        byText(a.pages[0].url, b.pages[0].url) ||
        (a.pages[0].line || 0) - (b.pages[0].line || 0),
    );
}

/** JSON.stringify with every object's keys sorted, recursively. */
function stableStringify(value) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.keys(v)
        .sort()
        .reduce((acc, k) => {
          acc[k] = sortKeys(v[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

/** sha256 of the report data with any pairId removed. */
function pairIdFor(data) {
  const { pairId, ...rest } = data;
  return crypto.createHash("sha256").update(stableStringify(rest)).digest("hex");
}

/**
 * Whether a report.json text and a report.md text belong together.
 *
 *   { ok: true, pairId }  or  { ok: false, reason }
 *
 * Fails when report.json does not parse, when its pairId does not match its
 * own content (edited or partially written), or when report.md does not
 * state that same id on its pair line.
 */
function verifyPair(jsonText, markdownText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, reason: `report.json does not parse: ${err.message}` };
  }
  if (!data || typeof data.pairId !== "string") return { ok: false, reason: "report.json has no pairId" };
  const expected = pairIdFor(data);
  if (data.pairId !== expected) return { ok: false, reason: "report.json content does not match its own pairId" };
  const line = String(markdownText)
    .split("\n")
    .find((l) => l.includes(PAIR_LABEL));
  if (!line) return { ok: false, reason: "report.md has no pair id line" };
  if (line !== `- ${PAIR_LABEL} \`${data.pairId}\``) return { ok: false, reason: "report.md and report.json carry different pair ids" };
  return { ok: true, pairId: data.pairId };
}

/**
 * The report as data.
 *
 *   source      { approvedOutputSha256, distFiles, htmlPages, indexablePages }
 *   findings    after exceptions and template grouping
 *   linkStats   from rules.evaluate()
 *   exceptions  every exceptions.json entry with its `excused` count
 */
function buildReport({ config, source, findings, linkStats, exceptions }) {
  const sorted = sortFindings(findings);

  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byRule = {};
  const byRuleAndType = {};
  sorted.forEach((f) => {
    bySeverity[f.severity] += f.pages.length;
    byRule[f.rule] = (byRule[f.rule] || 0) + f.pages.length;
    f.pages.forEach((pg) => {
      byRuleAndType[f.rule] = byRuleAndType[f.rule] || {};
      byRuleAndType[f.rule][pg.type] = (byRuleAndType[f.rule][pg.type] || 0) + 1;
    });
  });

  const data = {
    schemaVersion: config.schemaVersion,
    tool: config.tool,
    advisory:
      "Advisory only. Length and word-count limits are configurable heuristics, not Google requirements. " +
      "Counts are page occurrences: a finding on 3 pages counts 3.",
    source,
    thresholds: config.thresholds,
    summary: {
      bySeverity,
      byRule,
      byRuleAndType,
      links: linkStats,
      exceptions: {
        applied: exceptions.filter((e) => e.excused > 0).length,
        unused: exceptions.filter((e) => e.excused === 0).length,
      },
    },
    exceptions: exceptions
      .map((e) => ({ ...e }))
      .sort((a, b) => byText(a.rule, b.rule) || byText(a.url || a.pageType, b.url || b.pageType)),
    findings: sorted,
  };
  return { ...data, pairId: pairIdFor(data) };
}

const md = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function renderMarkdown(report) {
  const lines = [];
  const s = report.summary;
  lines.push("# bpozz SEO check (B1)", "", `> ${report.advisory}`, "");
  lines.push(
    "## Source",
    "",
    `- approved-output.json sha256: \`${report.source.approvedOutputSha256}\``,
    `- dist/ files verified: ${report.source.distFiles}`,
    `- HTML pages checked: ${report.source.htmlPages} (${report.source.indexablePages} indexable)`,
    `- ${PAIR_LABEL} \`${report.pairId}\``,
    "",
    "report.json carries the same pair id. If the two differ, these files come from different runs.",
    "",
  );

  lines.push("## Summary", "", "| Severity | Occurrences |", "|---|---|");
  SEVERITY_ORDER.forEach((sev) => lines.push(`| ${sev} | ${s.bySeverity[sev]} |`));
  lines.push("");

  const rules = Object.keys(s.byRule).sort();
  if (rules.length) {
    const types = [...new Set(rules.flatMap((r) => Object.keys(s.byRuleAndType[r])))].sort();
    lines.push(`| Rule | Total | ${types.join(" | ")} |`, `|---|---|${types.map(() => "---").join("|")}|`);
    rules.forEach((r) => lines.push(`| ${r} | ${s.byRule[r]} | ${types.map((t) => s.byRuleAndType[r][t] || 0).join(" | ")} |`));
    lines.push("");
  }

  lines.push("### Internal links", "", "| Outcome | Count |", "|---|---|");
  Object.keys(s.links)
    .sort()
    .forEach((k) => lines.push(`| ${k} | ${s.links[k]} |`));
  lines.push("");

  lines.push("### Exceptions", "");
  if (!report.exceptions.length) lines.push("None.", "");
  else {
    lines.push("| Rule | Scope | Excused | Reason |", "|---|---|---|---|");
    report.exceptions.forEach((e) =>
      lines.push(`| ${e.rule} | ${md(e.url || `type: ${e.pageType}`)} | ${e.excused}${e.excused ? "" : " (unused)"} | ${md(e.reason)} |`),
    );
    lines.push("");
  }

  SEVERITY_ORDER.forEach((sev) => {
    const list = report.findings.filter((f) => f.severity === sev);
    lines.push(`## ${sev[0].toUpperCase()}${sev.slice(1)}s (${list.length} findings)`, "");
    if (!list.length) lines.push("None.", "");
    let rule = null;
    list.forEach((f) => {
      if (f.rule !== rule) {
        rule = f.rule;
        lines.push(`### ${rule}`, "");
      }
      const scope = f.scope === "template" ? ` _(template: ${f.pages.length} pages)_` : f.scope === "group" ? ` _(${f.pages.length} pages)_` : "";
      lines.push(`- **${md(f.message)}**${scope}`);
      if (f.evidence) lines.push(`  - evidence: \`${md(f.evidence).replace(/`/g, "'")}\``);
      f.pages.forEach((pg) => lines.push(`  - ${pg.url} — \`dist/${pg.file}${pg.line ? `:${pg.line}` : ""}\``));
    });
    lines.push("");
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

module.exports = { buildReport, renderMarkdown, stableStringify, sortFindings, pairIdFor, verifyPair };
