/**
 * scripts/seo/config.mts — thresholds and fixed locations for the B1 SEO
 * checker.
 *
 * Every length and word-count limit here is a HEURISTIC. None of them is a
 * Google requirement, and the checker reports them as advisory warnings only.
 * They are stated once, here, so a reviewer can change one number and see
 * exactly which findings move.
 *
 * Plain data. No fs, no side effects.
 */

import path from "node:path";
import { createRequire } from "node:module";

import type { SeoConfig, SiteConfig } from "./types.mts";

const require = createRequire(import.meta.url);
const site: SiteConfig = require("../../site.config.js");

const config: SeoConfig = {
  /** Report identity, written into report.json. Bump when the schema changes. */
  schemaVersion: 1,
  tool: "scripts/seo/check-seo.js (B1, advisory)",

  /** Where the checker reads from and writes to. Nothing else is touched. */
  paths: {
    repo: site.paths.root,
    dist: site.paths.dist,
    approvedOutput: site.paths.approvedOutput,
    qa: site.paths.qa,
    out: path.join(site.paths.qa, "seo"),
    exceptions: path.join(import.meta.dirname, "exceptions.json"),
  },

  /** Hosts whose absolute links are this site's own pages. */
  origin: site.origin,
  siteHosts: ["bpozz.com", "www.bpozz.com"],

  /**
   * Advisory heuristics. Characters, not pixels: Google truncates titles and
   * snippets by rendered width, which a character count only approximates.
   */
  thresholds: {
    title: { min: 30, max: 60 },
    description: { min: 70, max: 160 },
    guideMinWords: 800,
  },

  /**
   * A finding whose message is identical on at least this many pages is
   * reported once, as a template-level finding listing every page — the shape
   * a header or footer problem takes when it repeats on every page.
   */
  templateGroupMin: 5,

  /**
   * The brand suffix stripped from a <title> before it is compared with the
   * page's <h1>: "Font Size Is a Formula — bpozz" compares as
   * "Font Size Is a Formula".
   */
  titleSuffix: /\s*[—–|-]\s*bpozz!?\s*$/i,
};

export default config;
