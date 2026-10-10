/**
 * scripts/seo/lib/html.mts — a small, tolerant HTML scanner and the page facts
 * the SEO checker needs from it.
 *
 * WHY NOT REGEXES OVER THE WHOLE PAGE
 *
 * The published pages defeat single-regex extraction in three measured ways:
 * inline SVG icons carry their own <title> (dist/ holds 388 <title tags across
 * 352 pages), a <meta> tag may put each attribute on its own line
 * (dist/guide/type-scale-systems.html:38), and <script> bodies contain markup-
 * looking strings. So this module tokenizes: comments, doctype and CDATA are
 * skipped, raw-text elements (script, style, textarea, title) are read to
 * their closing tag without being scanned for tags, and attributes are parsed
 * quoted, unquoted or bare, across newlines.
 *
 * FAIL CLOSED
 *
 * Anything the scanner cannot read with confidence — an unterminated comment,
 * attribute quote or raw-text element, unbalanced <svg>, more than one
 * document <title>, a missing </html> — is recorded in `anomalies`. The
 * checker refuses to report on a site with any anomaly rather than classify a
 * page it may have misread.
 *
 * Pure: no fs. Same input, same output.
 */

import type { PageFacts, ScanAnomaly, Token } from "../types.mts";

const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
/** Elements whose subtree is foreign content: its <title> and headings are not the page's. */
const FOREIGN = new Set(["svg", "math"]);
const HEADING = /^h([1-6])$/;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  times: "×",
  copy: "©",
};

/**
 * Decodes character references in one pass, so "&amp;quot;" becomes the text
 * "&quot;" and is not decoded twice (the rule src/build/content.js:1155 keeps
 * by decoding &amp; last). Unknown named references are left as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole: string, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Offsets of every newline, so a token offset can be reported as a line. */
function lineIndex(html: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < html.length; i += 1) if (html[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const NAME_START = /[A-Za-z]/;
const TAG_NAME = /[A-Za-z][^\s/>]*/y;
const ATTR_NAME = /[^\s"'>/=]+/y;
const UNQUOTED = /[^\s>]+/y;
const SPACE = /\s*/y;

function matchAt(re: RegExp, text: string, at: number): string | null {
  re.lastIndex = at;
  const m = re.exec(text);
  return m ? m[0] : null;
}

/**
 * Splits a document into start, end and text tokens. Returns the tokens and
 * any anomalies; on an anomaly it stops, because everything after the point
 * it lost track is suspect.
 */
export function tokenize(html: string): { tokens: Token[]; anomalies: ScanAnomaly[] } {
  const tokens: Token[] = [];
  const anomalies: ScanAnomaly[] = [];
  const len = html.length;
  let i = 0;

  const text = (from: number, to: number): void => {
    if (to > from) tokens.push({ type: "text", text: html.slice(from, to), at: from });
  };

  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text(i, len);
      break;
    }
    text(i, lt);

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) {
        anomalies.push({ at: lt, problem: "unterminated comment" });
        break;
      }
      i = end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      if (end === -1) {
        anomalies.push({ at: lt, problem: "unterminated CDATA section" });
        break;
      }
      i = end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      if (end === -1) {
        anomalies.push({ at: lt, problem: "unterminated declaration" });
        break;
      }
      i = end + 1;
      continue;
    }

    if (html[lt + 1] === "/") {
      const name = NAME_START.test(html[lt + 2] || "") ? matchAt(TAG_NAME, html, lt + 2) : null;
      const end = html.indexOf(">", lt);
      if (end === -1) {
        anomalies.push({ at: lt, problem: "unterminated end tag" });
        break;
      }
      // "</" not followed by a name is a bogus comment in HTML: skipped.
      if (name) tokens.push({ type: "end", name: name.toLowerCase(), at: lt });
      i = end + 1;
      continue;
    }

    if (!NAME_START.test(html[lt + 1] || "")) {
      // A literal "<" in text.
      text(lt, lt + 1);
      i = lt + 1;
      continue;
    }

    // start tag
    // NAME_START matched html[lt + 1], so TAG_NAME matches there.
    const rawName = matchAt(TAG_NAME, html, lt + 1)!;
    const name = rawName.toLowerCase();
    const attrs: Record<string, string> = {};
    let j = lt + 1 + rawName.length;
    let closed = false;
    let selfClosing = false;
    while (j < len) {
      // SPACE is /\s*/y: it matches at every offset, possibly empty.
      j += matchAt(SPACE, html, j)!.length;
      if (html[j] === ">") {
        j += 1;
        closed = true;
        break;
      }
      if (html[j] === "/" && html[j + 1] === ">") {
        j += 2;
        closed = true;
        selfClosing = true;
        break;
      }
      if (html[j] === "/") {
        j += 1;
        continue;
      }
      const attrName = matchAt(ATTR_NAME, html, j);
      if (!attrName) {
        // A stray quote or "=" where a name should be: skip one character,
        // the way a browser folds it into the next attribute name.
        j += 1;
        continue;
      }
      j += attrName.length;
      j += matchAt(SPACE, html, j)!.length;
      let value = "";
      if (html[j] === "=") {
        j += 1;
        j += matchAt(SPACE, html, j)!.length;
        const quote = html[j];
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, j + 1);
          if (close === -1) {
            anomalies.push({ at: lt, problem: `unterminated ${quote} in <${name}> attribute "${attrName}"` });
            return { tokens, anomalies };
          }
          value = html.slice(j + 1, close);
          j = close + 1;
        } else {
          value = matchAt(UNQUOTED, html, j) || "";
          j += value.length;
        }
      }
      const key = attrName.toLowerCase();
      // The first occurrence of a duplicated attribute wins, as in browsers.
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) attrs[key] = decodeEntities(value);
    }
    if (!closed) {
      anomalies.push({ at: lt, problem: `unterminated <${name}> tag` });
      break;
    }
    tokens.push({ type: "start", name, attrs, selfClosing, at: lt });
    i = j;

    if (RAW_TEXT.has(name) && !selfClosing) {
      const closeRe = new RegExp(`</${name}\\s*>`, "ig");
      closeRe.lastIndex = i;
      const close = closeRe.exec(html);
      if (!close) {
        anomalies.push({ at: lt, problem: `unterminated <${name}> element` });
        break;
      }
      tokens.push({ type: "text", text: html.slice(i, close.index), at: i, raw: name });
      tokens.push({ type: "end", name, at: close.index });
      i = close.index + close[0].length;
    }
  }

  return { tokens, anomalies };
}

interface OpenTitle {
  readonly line: number;
  readonly inHead: boolean;
}

interface OpenHeading {
  readonly level: number;
  text: string;
  readonly line: number;
}

/**
 * The facts one page contributes to the checker.
 *
 *   titles        document <title> texts (foreign SVG/MathML titles excluded)
 *   descriptions  <meta name="description"> contents
 *   robots        <meta name="robots"> contents
 *   headings      [{ level, text, line }] in document order, outside SVG/MathML
 *   links         [{ href, line }] for every <a href>
 *   images        [{ hasAlt, alt, src, line }] for every <img>
 *   ids           every id (and <a name>) on the page
 *   mainWords     words of text inside <main>, outside script/style/SVG
 *   hasMain       whether the page has a <main>
 *   anomalies     [{ line, problem }] — see FAIL CLOSED above
 */
export function extract(html: string): PageFacts {
  const lineOf = lineIndex(html);
  const { tokens, anomalies: scanAnomalies } = tokenize(html);

  const page: PageFacts = {
    titles: [],
    descriptions: [],
    robots: [],
    headings: [],
    links: [],
    images: [],
    ids: [],
    mainWords: 0,
    hasMain: false,
    anomalies: scanAnomalies.map((a) => ({ line: lineOf(a.at), problem: a.problem })),
  };
  const anomaly = (at: number, problem: string): number => page.anomalies.push({ line: lineOf(at), problem });

  const ids = new Set<string>();
  let foreignDepth = 0;
  let mainDepth = 0;
  let inHead = false;
  // Widened on purpose: these are reassigned inside the forEach callback
  // below, which TypeScript's narrowing of a `null` initializer cannot see.
  let openTitle = null as OpenTitle | null;
  let openHeading = null as OpenHeading | null;
  let sawHtmlEnd = false;

  const closeHeading = (): void => {
    if (!openHeading) return;
    page.headings.push({ level: openHeading.level, text: collapse(decodeEntities(openHeading.text)), line: openHeading.line });
    openHeading = null;
  };

  tokens.forEach((t) => {
    if (t.type === "start") {
      const id = t.attrs.id;
      if (id) ids.add(id);
      if (t.name === "a" && t.attrs.name) ids.add(t.attrs.name);

      if (FOREIGN.has(t.name)) {
        if (!t.selfClosing) foreignDepth += 1;
        return;
      }
      if (foreignDepth > 0) {
        if (t.name === "a" && t.attrs.href !== undefined) page.links.push({ href: t.attrs.href, line: lineOf(t.at) });
        return;
      }

      if (t.name === "head") inHead = true;
      else if (t.name === "body") inHead = false;
      else if (t.name === "main" && !t.selfClosing) {
        mainDepth += 1;
        page.hasMain = true;
      } else if (t.name === "title") {
        openTitle = { line: lineOf(t.at), inHead };
      } else if (t.name === "meta") {
        const name = (t.attrs.name || "").toLowerCase();
        if (name === "description") {
          page.descriptions.push({ content: collapse(t.attrs.content || ""), hasContent: t.attrs.content !== undefined, line: lineOf(t.at) });
        } else if (name === "robots") {
          page.robots.push(collapse(t.attrs.content || "").toLowerCase());
        }
      } else if (t.name === "a" && t.attrs.href !== undefined) {
        page.links.push({ href: t.attrs.href, line: lineOf(t.at) });
      } else if (t.name === "img") {
        page.images.push({
          hasAlt: Object.prototype.hasOwnProperty.call(t.attrs, "alt"),
          alt: t.attrs.alt,
          src: t.attrs.src,
          line: lineOf(t.at),
        });
      }

      const h = HEADING.exec(t.name);
      if (h) {
        if (openHeading) anomaly(t.at, `<${t.name}> opened inside an unclosed <h${openHeading.level}>`);
        closeHeading();
        openHeading = { level: Number(h[1]), text: "", line: lineOf(t.at) };
      }
      return;
    }

    if (t.type === "end") {
      if (FOREIGN.has(t.name)) {
        if (foreignDepth === 0) anomaly(t.at, `</${t.name}> without an open <${t.name}>`);
        else foreignDepth -= 1;
        return;
      }
      if (foreignDepth > 0) return;
      if (t.name === "head") inHead = false;
      else if (t.name === "main" && mainDepth > 0) mainDepth -= 1;
      else if (t.name === "html") sawHtmlEnd = true;
      else if (HEADING.test(t.name) && openHeading) closeHeading();
      return;
    }

    // text
    if (t.raw === "title") {
      if (openTitle && foreignDepth === 0) {
        page.titles.push({ text: collapse(decodeEntities(t.text)), inHead: openTitle.inHead, line: openTitle.line });
      }
      openTitle = null;
      return;
    }
    if (t.raw || foreignDepth > 0) return;
    if (openHeading) openHeading.text += t.text;
    if (mainDepth > 0) {
      page.mainWords += decodeEntities(t.text)
        .split(/\s+/)
        .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    }
  });

  if (openHeading) anomaly(html.length, `<h${openHeading.level}> never closed`);
  closeHeading();
  if (foreignDepth !== 0 && !scanAnomalies.length) anomaly(html.length, "unbalanced <svg>/<math> at end of document");
  if (!sawHtmlEnd && !scanAnomalies.length) anomaly(html.length, "no </html>: the file may be truncated");
  if (page.titles.length > 1) anomaly(0, `${page.titles.length} document <title> elements; which one is the title is ambiguous`);
  if (page.titles.length === 1 && !page.titles[0].inHead) anomaly(0, "the document <title> is outside <head>");

  page.ids = [...ids].sort();
  return page;
}
