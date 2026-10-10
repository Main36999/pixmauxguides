#!/usr/bin/env node
/**
 * scripts/seo/check-seo.mts — B1 SEO checker. Local, advisory, zero
 * dependencies. TypeScript that Node 24 runs directly by stripping types.
 *
 * Run it under Node's permission model, one --allow-fs-read per path:
 *
 *     node --permission
 *       --allow-fs-read="<repo>\dist"
 *       --allow-fs-read="<repo>\scripts\seo"
 *       --allow-fs-read="<repo>\scripts\qa\approved-output.json"
 *       --allow-fs-read="<repo>\src\build\routes.js"
 *       --allow-fs-read="<repo>\site.config.js"
 *       --allow-fs-read="<repo>\package.json"
 *       --allow-fs-read="<repo>\.qa\seo"
 *       --allow-fs-write="<repo>\.qa\seo"
 *       scripts/seo/check-seo.mts
 *
 * WHAT IT DOES
 *
 *   1. integrity  validates scripts/qa/approved-output.json (declared algorithm
 *                 and count), walks dist/ (refusing symlinks and junctions),
 *                 hashes every file and compares the set with the manifest.
 *                 Any added, removed or changed file stops the run.
 *   2. parse      reads every dist/**.html through lib/html.mts. Any page the
 *                 scanner could not read with confidence stops the run.
 *   3. rules      lib/rules.mts, then exceptions.json, then template grouping.
 *   4. report     writes report.json.tmp and report.md.tmp in .qa/seo/, renames
 *                 each into place, then reads both back and checks they carry
 *                 the same pair id (lib/report.mts). These four names in
 *                 .qa/seo/ are the only files this program can write.
 *
 * REPORT PAIRS ARE NOT ATOMIC
 *
 * Two renames are two operations. A failure between them leaves a new
 * report.md beside an old report.json; the pair id makes that detectable, and
 * the read-back check reports it. A run that stops before step 4 writes
 * nothing, which means any reports already in .qa/seo/ are from an EARLIER
 * run: every failure message says so.
 *
 * WHAT IT NEVER DOES
 *
 * It changes no page, asset, manifest or baseline, and it repairs nothing.
 * It is not part of `npm run build`, `npm run qa`, `npm test` or CI. It takes
 * no options, so there is no flag that points its output somewhere else.
 *
 * EXIT CODES
 *
 *   0  both reports written and verified as a pair (findings never change
 *      the exit code in B1)
 *   2  refused: manifest, integrity, parse, _redirects or exceptions.json
 *      problem; nothing written
 *   1  unexpected error, including a pair that fails the read-back check;
 *      .tmp files or a mismatched pair may be left in .qa/seo/
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

import config from "./config.mts";
import * as html from "./lib/html.mts";
import * as links from "./lib/links.mts";
import * as rules from "./lib/rules.mts";
import * as report from "./lib/report.mts";
import * as safe from "./lib/safe-paths.mts";
import { compareManifest, validateManifest } from "./lib/integrity.mts";
import { isRecord, messageOf } from "./lib/guards.mts";
import type { ExceptionEntry, Manifest, PageInput, Routes } from "./types.mts";

const require = createRequire(import.meta.url);
const routes: Routes = require("../../src/build/routes.js");

const { repo, dist, approvedOutput, qa, out, exceptions: exceptionsFile } = config.paths;

export class Refusal extends Error {}

const sha256 = (buf: crypto.BinaryLike): string => crypto.createHash("sha256").update(buf).digest("hex");
const rel = (p: string): string => path.relative(repo, p).split(path.sep).join("/");

/**
 * dist/ as { posixPath: sha256 }, in sorted order. Every read goes through
 * safe.resolveInside. A symlink or junction anywhere fails the run: following
 * one could read outside dist/.
 */
function hashDist(): Record<string, string> {
  if (!fs.existsSync(dist)) throw new Refusal("dist/ does not exist. Nothing to check.");
  const real = fs.realpathSync.native(dist);
  if (!safe.isWithin(dist, real) || !safe.isWithin(real, dist)) {
    throw new Refusal(`dist/ resolves elsewhere (${real}); refusing to follow it.`);
  }

  const files: Record<string, string> = {};
  const walk = (posixDir: string): void => {
    const abs = posixDir ? safe.resolveInside(dist, posixDir) : dist;
    fs.readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .forEach((entry) => {
        const child = posixDir ? `${posixDir}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Refusal(`dist/${child} is a symbolic link or junction; refusing to follow it.`);
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) files[child] = sha256(fs.readFileSync(safe.resolveInside(dist, child)));
        else throw new Refusal(`dist/${child} is not a regular file or directory.`);
      });
  };
  walk("");
  return files;
}

function checkIntegrity(): { inventory: Set<string>; manifestSha256: string } {
  const manifestBytes = fs.readFileSync(approvedOutput);
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (err) {
    throw new Refusal(`${rel(approvedOutput)} is not valid JSON: ${messageOf(err)}`);
  }
  const manifestProblems = validateManifest(manifest);
  if (manifestProblems.length) {
    throw new Refusal([`${rel(approvedOutput)} cannot be used:`, ""].concat(manifestProblems.map((p) => `  ${p}`)).join("\n"));
  }
  // validateManifest() found no problem, so this is a Manifest.
  const approved = (manifest as Manifest).files;

  const actual = hashDist();
  const diff = compareManifest(actual, approved);
  if (!diff.ok) {
    const lines = [`dist/ does not match ${rel(approvedOutput)}; refusing to report on an unapproved build.`, ""];
    diff.changed.forEach((f) => lines.push(`  changed  ${f}`));
    diff.added.forEach((f) => lines.push(`  added    ${f}`));
    diff.removed.forEach((f) => lines.push(`  removed  ${f}`));
    lines.push("", `  ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed.`);
    throw new Refusal(lines.join("\n"));
  }
  return { inventory: new Set(Object.keys(actual)), manifestSha256: sha256(manifestBytes) };
}

function loadExceptions(): ExceptionEntry[] {
  let entries: unknown;
  try {
    entries = JSON.parse(fs.readFileSync(exceptionsFile, "utf8"));
  } catch (err) {
    throw new Refusal(`${rel(exceptionsFile)} is not valid JSON: ${messageOf(err)}`);
  }
  const problems = rules.validateExceptions(entries);
  if (problems.length) throw new Refusal(problems.join("\n"));
  // validateExceptions() found no problem, so these are ExceptionEntry values.
  return entries as ExceptionEntry[];
}

/**
 * Writes both reports in full under temporary names, renames each into place
 * (report.md first, report.json last), then reads the pair back and verifies
 * it. The renames are two operations, not one atomic swap; see REPORT PAIRS
 * ARE NOT ATOMIC above.
 */
function writeReports(json: string, markdown: string): string {
  safe.assertOutputDir(out, { repo, qa, dist });
  fs.mkdirSync(out, { recursive: true });

  fs.writeFileSync(safe.reportTarget(out, "report.json.tmp"), json, "utf8");
  fs.writeFileSync(safe.reportTarget(out, "report.md.tmp"), markdown, "utf8");

  fs.renameSync(safe.reportTarget(out, "report.md.tmp"), safe.reportTarget(out, "report.md"));
  fs.renameSync(safe.reportTarget(out, "report.json.tmp"), safe.reportTarget(out, "report.json"));

  const check = report.verifyPair(
    fs.readFileSync(safe.reportTarget(out, "report.json"), "utf8"),
    fs.readFileSync(safe.reportTarget(out, "report.md"), "utf8"),
  );
  if (!check.ok) throw new Error(`the reports were written but do not verify as a pair: ${check.reason}`);
  return check.pairId;
}

/** Leftovers from an interrupted run are named, then overwritten by this one. */
function warnAboutLeftovers(): void {
  safe.TEMP_FILES.forEach((name) => {
    const target = safe.reportTarget(out, name);
    if (fs.existsSync(target)) console.warn(`  ⚠ ${rel(target)} is left over from an interrupted run; this run overwrites it.`);
  });
}

export function main(): void {
  if (process.argv.length > 2) throw new Refusal("check-seo.js takes no arguments.");

  const { inventory, manifestSha256 } = checkIntegrity();
  const exceptions = loadExceptions();

  const redirects = links.parseRedirects(
    inventory.has("_redirects") ? fs.readFileSync(safe.resolveInside(dist, "_redirects"), "utf8") : "",
  );
  if (redirects.unsupported.length) {
    throw new Refusal(
      ["dist/_redirects has rules this checker cannot evaluate exactly:", ""]
        .concat(redirects.unsupported.map((u) => `  line ${u.line}: ${u.text} (${u.reason})`))
        .join("\n"),
    );
  }

  const pages: PageInput[] = [...inventory]
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((file) => ({
      file,
      url: routes.urlFor(file),
      facts: html.extract(fs.readFileSync(safe.resolveInside(dist, file), "utf8")),
    }));

  const unreadable = pages.filter((p) => p.facts.anomalies.length);
  if (unreadable.length) {
    const lines = [`${unreadable.length} page(s) could not be read with confidence; refusing to classify them.`, ""];
    unreadable.forEach((p) => p.facts.anomalies.forEach((a) => lines.push(`  dist/${p.file}:${a.line}  ${a.problem}`)));
    throw new Refusal(lines.join("\n"));
  }

  const site = { origin: config.origin, hosts: config.siteHosts, inventory, redirects };
  const evaluated = rules.evaluate(pages, site, config);
  const excused = rules.applyExceptions(evaluated.findings, exceptions);
  const findings = rules.groupTemplates(excused.findings, config.templateGroupMin);

  const data = report.buildReport({
    config,
    source: {
      approvedOutputSha256: manifestSha256,
      distFiles: inventory.size,
      htmlPages: pages.length,
      indexablePages: pages.filter((p) => p.indexable).length,
    },
    findings,
    linkStats: evaluated.linkStats,
    exceptions: excused.exceptions,
  });

  warnAboutLeftovers();
  const pairId = writeReports(report.stableStringify(data), report.renderMarkdown(data));

  const s = data.summary.bySeverity;
  console.log(`✓ dist/ matches the approved output (${inventory.size} files)`);
  console.log(`✓ ${pages.length} pages checked (${data.source.indexablePages} indexable)`);
  console.log(`✓ report pair verified (pair id ${pairId})`);
  console.log(`  ${s.error} error, ${s.warning} warning, ${s.info} info occurrences (advisory)`);
  console.log(`  ${rel(safe.reportTarget(out, "report.json"))}`);
  console.log(`  ${rel(safe.reportTarget(out, "report.md"))}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    const refused = err instanceof Refusal;
    console.error("");
    console.error(refused ? "✗ SEO check refused — this run wrote nothing." : "✗ SEO check failed.");
    console.error("");
    String(isRecord(err) && err.message ? err.message : err)
      .split("\n")
      .forEach((line) => console.error(`  ${line}`));
    console.error("");
    console.error("  Any report.json / report.md already in .qa/seo/ is from an EARLIER run and may be stale:");
    console.error("  compare its approved-output sha256 and pair id before relying on it.");
    if (!refused) console.error("  report.json.tmp / report.md.tmp in .qa/seo/, if present, are from this incomplete run.");
    process.exitCode = refused ? 2 : 1;
  }
}
