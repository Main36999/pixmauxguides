/**
 * scripts/seo/types.mts — the B1 SEO checker's shared contracts: page facts,
 * links and redirects, findings, exceptions, the report, and the two
 * production CommonJS modules the checker reads its configuration from.
 *
 * Types only. Every import of this module is `import type`, so Node strips it
 * and nothing here exists at run time.
 */

// ---- severities, rules, page types ----------------------------------------

export type Severity = "error" | "warning" | "info";

export type RuleId =
  | "title-missing"
  | "description-missing"
  | "link-broken"
  | "link-gone"
  | "link-invalid"
  | "img-alt-missing"
  | "title-duplicate"
  | "description-duplicate"
  | "title-length"
  | "description-length"
  | "h1-title-mismatch"
  | "h1-count"
  | "heading-skip"
  | "guide-word-count"
  | "link-redirect"
  | "link-fragment-missing";

export interface RuleSpec {
  readonly severity: Severity;
  readonly indexableOnly?: true;
}

export type PageType = "guide" | "category" | "section" | "font" | "icon-pack" | "page";

// ---- page facts (lib/html.mts) --------------------------------------------

export interface Anomaly {
  readonly line: number;
  readonly problem: string;
}

export interface TitleFact {
  readonly text: string;
  readonly inHead: boolean;
  readonly line: number;
}

export interface DescriptionFact {
  readonly content: string;
  readonly hasContent: boolean;
  readonly line: number;
}

export interface HeadingFact {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface LinkFact {
  readonly href: string;
  readonly line: number;
}

export interface ImageFact {
  readonly hasAlt: boolean;
  readonly alt: string | undefined;
  readonly src: string | undefined;
  readonly line: number;
}

export interface PageFacts {
  titles: TitleFact[];
  descriptions: DescriptionFact[];
  robots: string[];
  headings: HeadingFact[];
  links: LinkFact[];
  images: ImageFact[];
  ids: string[];
  mainWords: number;
  hasMain: boolean;
  anomalies: Anomaly[];
}

export interface StartToken {
  readonly type: "start";
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly selfClosing: boolean;
  readonly at: number;
}

export interface EndToken {
  readonly type: "end";
  readonly name: string;
  readonly at: number;
}

export interface TextToken {
  readonly type: "text";
  readonly text: string;
  readonly at: number;
  /** Set on the body of a raw-text element (script, style, textarea, title). */
  readonly raw?: string;
}

export type Token = StartToken | EndToken | TextToken;

export interface ScanAnomaly {
  readonly at: number;
  readonly problem: string;
}

// ---- pages ------------------------------------------------------------------

/** A page as check-seo.mts reads it. rules.evaluate() adds the three optional fields. */
export interface PageInput {
  readonly file: string;
  readonly url: string;
  readonly facts: PageFacts;
  type?: PageType;
  indexable?: boolean;
  idSet?: Set<string>;
}

/** A page after rules.evaluate() has classified it. */
export interface EvaluatedPage extends PageInput {
  type: PageType;
  indexable: boolean;
  idSet: Set<string>;
}

// ---- links and redirects (lib/links.mts) ------------------------------------

export type LinkKind = "external" | "non-http" | "hash-route" | "internal";

export type LinkStatus = "ok" | "redirect" | "rewrite" | "gone" | "broken" | "invalid";

export interface ExactRule {
  readonly from: string;
  readonly to: string;
  readonly status: number;
  readonly force: boolean;
  readonly line: number;
}

export interface PrefixRule extends ExactRule {
  /** The literal part of `from` before its final "*", e.g. "/icons/". */
  readonly prefix: string;
}

export type RedirectRule = ExactRule | PrefixRule;

export interface UnsupportedRule {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface Redirects {
  readonly rules: Map<string, ExactRule>;
  readonly prefixes: PrefixRule[];
  readonly unsupported: UnsupportedRule[];
}

/**
 * A variant of a result that carries `T`'s keys and leaves every other key in
 * `Keys` absent, so code (and tests) can read any key of the union and
 * narrowing on one key types the rest.
 */
type Absent<T, Keys extends PropertyKey> = T & { readonly [K in Exclude<Keys, keyof T>]?: undefined };

type ResolutionKey = "status" | "file" | "location" | "rule";
type LinkKey = ResolutionKey | "kind" | "path" | "fragment";

/** What resolvePath() answers for one site path. */
export type Resolution =
  | Absent<{ readonly status: "ok"; readonly file: string }, ResolutionKey>
  | Absent<{ readonly status: "redirect"; readonly location: string; readonly rule?: number }, ResolutionKey>
  | Absent<{ readonly status: "rewrite"; readonly file: string; readonly rule: number }, ResolutionKey>
  | Absent<{ readonly status: "gone"; readonly rule: number }, ResolutionKey>
  | Absent<{ readonly status: "broken"; readonly rule?: number }, ResolutionKey>
  | Absent<{ readonly status: "invalid" }, ResolutionKey>;

type InternalLink<R> = R extends Resolution
  ? Absent<R & { readonly kind: "internal"; readonly path: string; readonly fragment?: string | null }, LinkKey>
  : never;

/** What classifyHref() answers for one href. */
export type Classification =
  | Absent<{ readonly kind: "external" }, LinkKey>
  | Absent<{ readonly kind: "non-http" }, LinkKey>
  | Absent<{ readonly kind: "hash-route" }, LinkKey>
  | InternalLink<Resolution>;

/** Everything classifyHref() needs to know about the published site. */
export interface LinkSite {
  readonly origin: string;
  readonly hosts: readonly string[];
  readonly inventory: ReadonlySet<string>;
  readonly redirects: Redirects;
}

export interface LinkStats {
  internalOk: number;
  rewrite: number;
  redirect: number;
  gone: number;
  broken: number;
  invalid: number;
  fragmentMissing: number;
  external: number;
  nonHttp: number;
  hashRoute: number;
}

// ---- findings and exceptions (lib/rules.mts) --------------------------------

export interface PageRef {
  readonly url: string;
  readonly file: string;
  readonly type: PageType;
  readonly line?: number;
}

export interface RawFinding {
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly message: string;
  readonly evidence: string;
  readonly pages: readonly PageRef[];
}

export type FindingScope = "page" | "group" | "template";

export interface Finding extends RawFinding {
  readonly scope: FindingScope;
}

/** One exceptions.json entry, after rules.validateExceptions() accepted it. */
export type ExceptionEntry =
  | { readonly rule: RuleId; readonly reason: string; readonly url: string; readonly pageType?: never }
  | { readonly rule: RuleId; readonly reason: string; readonly pageType: string; readonly url?: never };

export type ExceptionUsage = ExceptionEntry & { excused: number };

// ---- configuration (config.mts and the production CommonJS modules) ---------

export interface Thresholds {
  readonly title: { readonly min: number; readonly max: number };
  readonly description: { readonly min: number; readonly max: number };
  readonly guideMinWords: number;
}

export interface SeoConfig {
  readonly schemaVersion: number;
  readonly tool: string;
  readonly paths: {
    readonly repo: string;
    readonly dist: string;
    readonly approvedOutput: string;
    readonly qa: string;
    readonly out: string;
    readonly exceptions: string;
  };
  readonly origin: string;
  readonly siteHosts: readonly string[];
  readonly thresholds: Thresholds;
  readonly templateGroupMin: number;
  readonly titleSuffix: RegExp;
}

/** The part of site.config.js (CommonJS, production) the checker reads. */
export interface SiteConfig {
  readonly origin: string;
  readonly paths: {
    readonly root: string;
    readonly dist: string;
    readonly approvedOutput: string;
    readonly qa: string;
  };
}

/** The part of src/build/routes.js (CommonJS, production) the checker calls. */
export interface Routes {
  urlFor(file: string): string;
}

// ---- integrity (lib/integrity.mts) ------------------------------------------

export type FileHashes = Readonly<Record<string, string>>;

export interface ManifestDiff {
  readonly added: string[];
  readonly removed: string[];
  readonly changed: string[];
  readonly ok: boolean;
}

/** scripts/qa/approved-output.json, after validateManifest() accepted it. */
export interface Manifest {
  readonly algorithm?: string;
  readonly count?: number;
  readonly files: FileHashes;
}

// ---- the report (lib/report.mts) --------------------------------------------

export type ReportSource = {
  readonly approvedOutputSha256: string;
  readonly distFiles: number;
  readonly htmlPages: number;
  readonly indexablePages: number;
};

export type ReportSummary = {
  readonly bySeverity: Record<Severity, number>;
  readonly byRule: Record<string, number>;
  readonly byRuleAndType: Record<string, Record<string, number>>;
  readonly links: LinkStats;
  readonly exceptions: { readonly applied: number; readonly unused: number };
};

/** report.json without its pairId: the content the pair id hashes. */
export type ReportBody = {
  readonly schemaVersion: number;
  readonly tool: string;
  readonly advisory: string;
  readonly source: ReportSource;
  readonly thresholds: Thresholds;
  readonly summary: ReportSummary;
  readonly exceptions: ExceptionUsage[];
  readonly findings: Finding[];
};

export type Report = ReportBody & { readonly pairId: string };

export type PairCheck =
  | { readonly ok: true; readonly pairId: string; readonly reason?: undefined }
  | { readonly ok: false; readonly reason: string; readonly pairId?: undefined };
