/**
 * scripts/seo/dist.test.js — evidence that lib/html.js reads the REAL
 * published pages correctly, before any finding is trusted.
 *
 *     node --test scripts/seo/dist.test.js
 *
 * For every dist/**.html it compares the scanner's facts with a second,
 * independent extraction: regexes run over the page after comments, <script>,
 * <style> (and, for titles and headings, <svg>) are stripped. The two methods
 * share nothing but entity decoding, so agreement on all 352 pages is the
 * reliability evidence B1 requires; any disagreement fails and names the page.
 *
 * Read-only. Skipped when dist/ does not exist.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("./config.js");
const { extract, decodeEntities, collapse } = require("./lib/html.js");

const DIST = config.paths.dist;

function htmlFiles(dir, prefix = "") {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((e) => {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isSymbolicLink()) return [];
      if (e.isDirectory()) return htmlFiles(path.join(dir, e.name), rel);
      return rel.endsWith(".html") ? [rel] : [];
    });
}

const strip = (html, tags) =>
  tags.reduce((acc, tag) => acc.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), ""), html.replace(/<!--[\s\S]*?-->/g, ""));

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

test("the scanner agrees with an independent extraction on every published page", { skip: !fs.existsSync(DIST) && "dist/ does not exist" }, () => {
  const files = htmlFiles(DIST);
  assert.ok(files.length > 0, "dist/ has no HTML");
  const problems = [];

  files.forEach((file) => {
    const raw = fs.readFileSync(path.join(DIST, ...file.split("/")), "utf8");
    const facts = extract(raw);
    const say = (what) => problems.push(`dist/${file}: ${what}`);

    if (facts.anomalies.length) say(`anomalies ${JSON.stringify(facts.anomalies)}`);

    const code = strip(raw, ["script", "style"]);
    const noSvg = strip(code, ["svg"]);
    const headEnd = noSvg.search(/<\/head\s*>/i);
    const head = headEnd === -1 ? noSvg : noSvg.slice(0, headEnd);

    const titles = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)].map((m) => collapse(decodeEntities(m[1])));
    if (JSON.stringify(titles) !== JSON.stringify(facts.titles.map((t) => t.text))) {
      say(`titles differ: regex ${JSON.stringify(titles)} vs scanner ${JSON.stringify(facts.titles.map((t) => t.text))}`);
    }

    const descriptions = [...head.matchAll(/<meta\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => (attr(tag, "name") || "").toLowerCase() === "description")
      .map((tag) => collapse(decodeEntities(attr(tag, "content") || "")));
    if (JSON.stringify(descriptions) !== JSON.stringify(facts.descriptions.map((d) => d.content))) {
      say(`descriptions differ: regex ${JSON.stringify(descriptions)} vs scanner ${JSON.stringify(facts.descriptions.map((d) => d.content))}`);
    }

    const h1 = (noSvg.match(/<h1\b/gi) || []).length;
    const scannerH1 = facts.headings.filter((h) => h.level === 1).length;
    if (h1 !== scannerH1) say(`<h1> count: regex ${h1} vs scanner ${scannerH1}`);

    const headings = (noSvg.match(/<h[1-6]\b/gi) || []).length;
    if (headings !== facts.headings.length) say(`heading count: regex ${headings} vs scanner ${facts.headings.length}`);

    const anchors = [...code.matchAll(/<a\b[^>]*>/gi)].filter((m) => attr(m[0], "href") !== undefined).length;
    if (anchors !== facts.links.length) say(`<a href> count: regex ${anchors} vs scanner ${facts.links.length}`);

    const images = (code.match(/<img\b/gi) || []).length;
    if (images !== facts.images.length) say(`<img> count: regex ${images} vs scanner ${facts.images.length}`);
  });

  assert.deepStrictEqual(problems, [], `${problems.length} disagreement(s) across ${files.length} pages`);
});
