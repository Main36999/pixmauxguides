/**
 * scripts/seo/lib/rules.js — turns extracted pages into findings.
 *
 * SEVERITIES (B1 is advisory: none of them fails anything)
 *
 *   error    title-missing, description-missing   indexable pages only
 *            link-broken, link-gone, link-invalid  every page
 *            img-alt-missing                       every page
 *   warning  title-duplicate, description-duplicate, title-length,
 *            description-length, h1-title-mismatch indexable pages only
 *            h1-count, heading-skip                every page
 *            guide-word-count                      guide pages only
 *   info     link-redirect, link-fragment-missing  every page
 *
 * A noindex page skips only the indexability rules — the ones about how a
 * page presents itself in search. Its links, images and headings are still
 * checked.
 *
 * Length and word-count limits are heuristics from config.js, not Google
 * requirements.
 *
 * WHAT THIS DOES NOT CHECK, ON PURPOSE
 *
 * Canonicals, sitemap.xml, robots.txt and JSON-LD already have gates
 * (scripts/qa/check-urls.js, the build's sitemap stage, structured-data.test.js),
 * and <img src> resource existence is deferred out of B1. Repeating them here
 * would be a second opinion that can drift from the first.
 *
 * Pure: no fs.
 */

"use strict";

const { classifyHref, LINK_KIND, STATUS } = require("./links.js");

const SEVERITY = { error: "error", warning: "warning", info: "info" };

const RULES = {
  "title-missing": { severity: SEVERITY.error, indexableOnly: true },
  "description-missing": { severity: SEVERITY.error, indexableOnly: true },
  "link-broken": { severity: SEVERITY.error },
  "link-gone": { severity: SEVERITY.error },
  "link-invalid": { severity: SEVERITY.error },
  "img-alt-missing": { severity: SEVERITY.error },
  "title-duplicate": { severity: SEVERITY.warning, indexableOnly: true },
  "description-duplicate": { severity: SEVERITY.warning, indexableOnly: true },
  "title-length": { severity: SEVERITY.warning, indexableOnly: true },
  "description-length": { severity: SEVERITY.warning, indexableOnly: true },
  "h1-title-mismatch": { severity: SEVERITY.warning, indexableOnly: true },
  "h1-count": { severity: SEVERITY.warning },
  "heading-skip": { severity: SEVERITY.warning },
  "guide-word-count": { severity: SEVERITY.warning },
  "link-redirect": { severity: SEVERITY.info },
  "link-fragment-missing": { severity: SEVERITY.info },
};

/**
 * The duplicate rules, and the word each one's message uses. A duplicate
 * finding's message states how many pages share the text, so it is built in
 * one place and rebuilt whenever exceptions change that number.
 */
const DUPLICATE_LABEL = { "title-duplicate": "title", "description-duplicate": "description" };
const duplicateMessage = (rule, count) => `${count} indexable pages share one ${DUPLICATE_LABEL[rule]}.`;

/** Page type from its dist/ path, for reporting and the guide-only rule. */
function pageType(file) {
  if (file.startsWith("guide/")) return "guide";
  if (file.startsWith("category/")) return "category";
  if (file.startsWith("fonts/")) return file === "fonts/index.html" ? "section" : "font";
  if (file.startsWith("icons/")) return file === "icons/index.html" ? "section" : "icon-pack";
  if (file.endsWith("/index.html")) return "section";
  return "page";
}

/** noindex (or "none") anywhere in any robots meta makes a page non-indexable. */
function isIndexable(robots) {
  return !robots.some((content) =>
    content
      .split(",")
      .map((d) => d.trim())
      .some((d) => d === "noindex" || d === "none"),
  );
}

const comparable = (text, suffix) =>
  text
    .replace(suffix, "")
    .toLowerCase()
    .replace(/[\s\xa0]+/g, " ")
    .replace(/[.!?:;,]+$/, "")
    .trim();

/**
 * Runs every rule.
 *
 *   pages   [{ file, url, facts }] — facts from html.extract()
 *   site    { origin, hosts, inventory, redirects }
 *   config  scripts/seo/config.js
 *
 * Returns { findings, linkStats } before exceptions and grouping.
 */
function evaluate(pages, site, config) {
  const findings = [];
  const add = (rule, page, message, evidence, line) =>
    findings.push({
      rule,
      severity: RULES[rule].severity,
      message,
      evidence: evidence || "",
      pages: [{ url: page.url, file: page.file, type: page.type, ...(line ? { line } : {}) }],
    });

  const linkStats = {
    internalOk: 0,
    rewrite: 0,
    redirect: 0,
    gone: 0,
    broken: 0,
    invalid: 0,
    fragmentMissing: 0,
    external: 0,
    nonHttp: 0,
    hashRoute: 0,
  };

  const byFile = new Map(pages.map((p) => [p.file, p]));
  pages.forEach((p) => {
    p.type = pageType(p.file);
    p.indexable = isIndexable(p.facts.robots);
    p.idSet = new Set(p.facts.ids);
  });

  const { thresholds, titleSuffix } = config;
  const titleGroups = new Map();
  const descriptionGroups = new Map();

  pages.forEach((p) => {
    const f = p.facts;
    const title = f.titles[0] ? f.titles[0].text : "";
    const description = f.descriptions[0] ? f.descriptions[0].content : "";
    const h1s = f.headings.filter((h) => h.level === 1);

    // ---- indexability rules -------------------------------------------
    if (p.indexable) {
      if (!title) add("title-missing", p, "No document <title>, or it is empty.");
      else {
        if (!titleGroups.has(title)) titleGroups.set(title, []);
        titleGroups.get(title).push(p);
        if (title.length < thresholds.title.min || title.length > thresholds.title.max) {
          add(
            "title-length",
            p,
            `Title is ${title.length} characters; the advisory range is ${thresholds.title.min}–${thresholds.title.max}.`,
            title,
            f.titles[0].line,
          );
        }
      }

      if (!description) add("description-missing", p, 'No <meta name="description">, or its content is empty.');
      else {
        if (!descriptionGroups.has(description)) descriptionGroups.set(description, []);
        descriptionGroups.get(description).push(p);
        if (description.length < thresholds.description.min || description.length > thresholds.description.max) {
          add(
            "description-length",
            p,
            `Description is ${description.length} characters; the advisory range is ${thresholds.description.min}–${thresholds.description.max}.`,
            description,
            f.descriptions[0].line,
          );
        }
      }

      if (title && h1s.length === 1 && comparable(title, titleSuffix) !== comparable(h1s[0].text, titleSuffix)) {
        add(
          "h1-title-mismatch",
          p,
          "The <h1> and the <title> (brand suffix removed) say different things.",
          `title: "${title}" · h1: "${h1s[0].text}"`,
          h1s[0].line,
        );
      }
    }

    // ---- every page -----------------------------------------------------
    if (h1s.length !== 1) {
      add(
        "h1-count",
        p,
        `${h1s.length} <h1> elements; one is the usual structure.`,
        h1s.map((h) => `"${h.text}"`).join(", "),
        h1s[1] ? h1s[1].line : undefined,
      );
    }

    let previous = 0;
    f.headings.forEach((h) => {
      if (previous && h.level > previous + 1) {
        add("heading-skip", p, `Heading level skips from h${previous} to h${h.level}.`, `h${h.level} "${h.text}"`, h.line);
      }
      previous = h.level;
    });

    if (p.type === "guide" && f.mainWords < thresholds.guideMinWords) {
      add(
        "guide-word-count",
        p,
        `${f.mainWords} words in <main>; the advisory minimum for a guide is ${thresholds.guideMinWords}.`,
        f.hasMain ? "" : "the page has no <main>",
      );
    }

    f.images.forEach((img) => {
      if (!img.hasAlt) add("img-alt-missing", p, "<img> has no alt attribute (alt=\"\" is fine for a decorative image).", `src="${img.src || ""}"`, img.line);
    });

    f.links.forEach((link) => {
      const c = classifyHref(link.href, p.url, site);
      if (c.kind === LINK_KIND.external) return void (linkStats.external += 1);
      if (c.kind === LINK_KIND.nonHttp) return void (linkStats.nonHttp += 1);
      if (c.kind === LINK_KIND.hashRoute) return void (linkStats.hashRoute += 1);

      const evidence = `href="${link.href}"`;
      if (c.status === STATUS.invalid) {
        linkStats.invalid += 1;
        return add("link-invalid", p, "Internal link cannot be resolved inside dist/ (undecodable, or a segment that would leave the site root).", evidence, link.line);
      }
      if (c.status === STATUS.gone) {
        linkStats.gone += 1;
        return add("link-gone", p, `Internal link points at a URL _redirects answers with 410 Gone (rule line ${c.rule}).`, evidence, link.line);
      }
      if (c.status === STATUS.broken) {
        linkStats.broken += 1;
        return add("link-broken", p, "Internal link resolves to no published file and no working redirect.", evidence, link.line);
      }
      if (c.status === STATUS.redirect) {
        linkStats.redirect += 1;
        const hop = classifyHref(c.location, c.path, site);
        // One hop is followed. A redirect to another redirect still lands
        // somewhere; only a hop to nothing (or to a 410) is broken.
        const lands =
          hop.kind !== LINK_KIND.internal ||
          hop.status === STATUS.ok ||
          hop.status === STATUS.rewrite ||
          hop.status === STATUS.redirect;
        if (!lands) {
          linkStats.broken += 1;
          return add("link-broken", p, `Internal link redirects to ${c.location}, which does not resolve.`, evidence, link.line);
        }
        return add(
          "link-redirect",
          p,
          `Internal link answers with a redirect to ${c.location}${c.rule ? ` (_redirects line ${c.rule})` : " (directory without its trailing slash)"}.`,
          evidence,
          link.line,
        );
      }

      if (c.status === STATUS.rewrite) linkStats.rewrite += 1;
      else linkStats.internalOk += 1;

      if (c.fragment) {
        const target = byFile.get(c.file);
        if (target && !target.idSet.has(c.fragment)) {
          linkStats.fragmentMissing += 1;
          add("link-fragment-missing", p, `No element with id "${c.fragment}" on ${target.url}.`, evidence, link.line);
        }
      }
    });
  });

  const duplicates = (groups, rule) => {
    groups.forEach((group, text) => {
      if (group.length < 2) return;
      findings.push({
        rule,
        severity: RULES[rule].severity,
        message: duplicateMessage(rule, group.length),
        evidence: text,
        pages: group.map((p) => ({ url: p.url, file: p.file, type: p.type })),
      });
    });
  };
  duplicates(titleGroups, "title-duplicate");
  duplicates(descriptionGroups, "description-duplicate");

  return { findings, linkStats };
}

/**
 * Validates exceptions.json. Each entry names a known rule, a reason, and
 * exactly one scope: an exact `url`, or a `pageType`. There are no patterns,
 * so the file a reviewer reads is the exact set excused.
 */
function validateExceptions(entries) {
  if (!Array.isArray(entries)) return ["exceptions.json must be a JSON array"];
  const problems = [];
  entries.forEach((e, i) => {
    const at = `exceptions.json[${i}]`;
    if (!e || typeof e !== "object") return problems.push(`${at} is not an object`);
    if (!RULES[e.rule]) problems.push(`${at}.rule "${e.rule}" is not a known rule`);
    if (typeof e.reason !== "string" || !e.reason.trim()) problems.push(`${at}.reason is required`);
    const scopes = ["url", "pageType"].filter((k) => e[k] !== undefined);
    if (scopes.length !== 1) problems.push(`${at} needs exactly one of "url" or "pageType"`);
    if (e.url !== undefined && (typeof e.url !== "string" || !e.url.startsWith("/"))) problems.push(`${at}.url must be a site path starting with "/"`);
    if (e.pageType !== undefined && typeof e.pageType !== "string") problems.push(`${at}.pageType must be a string`);
    Object.keys(e).forEach((k) => {
      if (!["rule", "url", "pageType", "reason"].includes(k)) problems.push(`${at} has unknown key "${k}"`);
    });
  });
  return problems;
}

/**
 * Removes excused pages from findings. A finding left with no pages is
 * dropped. A duplicate finding is a claim about a GROUP, so it is dropped once
 * fewer than two pages remain, and otherwise its message is recounted.
 * Returns the surviving findings and every exception with how many page
 * entries it excused, so an unused one is visible.
 */
function applyExceptions(findings, entries) {
  const usage = entries.map((e) => ({ ...e, excused: 0 }));
  const survivors = [];
  findings.forEach((f) => {
    const pages = f.pages.filter((pg) => {
      const hit = usage.find((e) => e.rule === f.rule && (e.url ? e.url === pg.url : e.pageType === pg.type));
      if (hit) hit.excused += 1;
      return !hit;
    });
    if (DUPLICATE_LABEL[f.rule]) {
      if (pages.length >= 2) survivors.push({ ...f, pages, message: duplicateMessage(f.rule, pages.length) });
      return;
    }
    if (pages.length) survivors.push({ ...f, pages });
  });
  return { findings: survivors, exceptions: usage };
}

/**
 * Folds per-page findings whose rule, message and evidence are identical on
 * at least `min` pages into one template-level finding. Duplicate groups are
 * already one finding each and are left alone.
 */
function groupTemplates(findings, min) {
  const buckets = new Map();
  const out = [];
  findings.forEach((f) => {
    if (f.pages.length !== 1) return out.push({ ...f, scope: "group" });
    const key = `${f.rule}\u0000${f.message}\u0000${f.evidence}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  });
  buckets.forEach((list) => {
    if (list.length >= min) {
      out.push({ ...list[0], scope: "template", pages: list.flatMap((f) => f.pages) });
    } else {
      list.forEach((f) => out.push({ ...f, scope: "page" }));
    }
  });
  return out;
}

module.exports = {
  evaluate,
  validateExceptions,
  applyExceptions,
  groupTemplates,
  pageType,
  isIndexable,
  RULES,
  SEVERITY,
};
