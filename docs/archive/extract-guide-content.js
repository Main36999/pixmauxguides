#!/usr/bin/env node
/**
 * extract-guide-content.js — the one-off migration that produced
 * content/guide/ in Phase 4 Step 4.
 *
 *     node docs/archive/extract-guide-content.js          # report only
 *     node docs/archive/extract-guide-content.js --write   # write the files
 *
 * ARCHIVED, NOT LIVE. It ran once. It is kept for the same reason
 * generate-palettes.js is — it is the only record of how a committed data set
 * was produced — and on the same rule: archive what has no successor.
 *
 * WHAT IT DID
 *
 * Step 4 moved the guide page frame into src/build/guide-template.js and the
 * per-guide content into content/guide/. This script performed that split
 * mechanically rather than by hand, so no byte was retyped:
 *
 *   1. Walks each committed guide/<slug>.html with the template's own frame
 *      constants, asserting every one of them appears exactly where the
 *      template puts it. A page that deviates anywhere fails the run instead
 *      of being silently reshaped.
 *   2. Writes what is left — the six content slots — to
 *      content/guide/<slug>.html through the template's serializeContent().
 *   3. Records the per-page structural facts the frame cannot state as one
 *      string (bodyClass, toast and the four `format` fields) in
 *      content/guide/pages.json.
 *   4. Proves the split is lossless: re-renders every page through
 *      guide-template.pageHtml(), passing each page's OWN committed header and
 *      footer marker regions back in as the partials, and requires the result
 *      to be byte-identical to the committed file. 22/22 passed.
 *
 * Step (4) is what makes this a migration rather than a rewrite, and it is
 * asserted again on every build — by src/build/guide-template.test.js at the
 * unit level and by the build's own `verify` stage at the output level.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO = process.env.BPOZZ_REPO || path.resolve(__dirname, "..", "..");
const T = require(path.join(REPO, "src", "build", "guide-template.js"));

const WRITE = process.argv.includes("--write");
const GUIDE_DIR = path.join(REPO, "guide");
const OUT_DIR = path.join(REPO, "content", "guide");

const guides = JSON.parse(
  fs.readFileSync(path.join(REPO, "guides.json"), "utf8"),
);

const HERO_TAG = '<section class="guide-hero"';
const TOC_TAG = '<nav class="guide-toc"';
const ARTICLE_TAG = '<article class="guide-article">';
const ARTICLE_CLOSE = "</article>";

function lineStartOf(text, needle, from) {
  const i = text.indexOf(needle, from);
  if (i === -1) return -1;
  return text.lastIndexOf("\n", i) + 1;
}

/** Splits one committed guide page into { record, slots, header, footer }. */
function split(slug, text) {
  const file = `guide/${slug}.html`;
  let p = 0;
  const expect = (literal, what) => {
    if (!text.startsWith(literal, p)) {
      throw new Error(
        `${file}: expected ${what} at byte ${p}\n` +
          `  wanted ${JSON.stringify(literal.slice(0, 70))}\n` +
          `  found  ${JSON.stringify(text.slice(p, p + 70))}`,
      );
    }
    p += literal.length;
  };
  const upTo = (literal, what) => {
    const i = text.indexOf(literal, p);
    if (i === -1) throw new Error(`${file}: no ${what} after byte ${p}`);
    const slice = text.slice(p, i);
    p = i + literal.length;
    return slice;
  };

  expect(T.DOC_OPEN, "the doctype/html/head opening");
  expect(T.HEAD_CONSENT, "the Cookiebot + consent band");
  const headMeta = upTo(T.HEAD_ANALYTICS, "the gtag band");
  const headSocial = upTo(T.HEAD_ASSETS, "the icon/font/stylesheet band");
  const headStructuredData = upTo(T.HEAD_CLOSE, "</head>");

  const bodyOpen = text.slice(p, text.indexOf(">\n", p) + 2);
  const bodyMatch =
    /^ {2}<body(?: class="([^"]*)")? data-guide-id="([^"]+)">\n$/.exec(bodyOpen);
  if (!bodyMatch) {
    throw new Error(`${file}: unexpected <body> tag ${JSON.stringify(bodyOpen)}`);
  }
  if (bodyMatch[2] !== slug) {
    throw new Error(
      `${file}: data-guide-id is "${bodyMatch[2]}", expected "${slug}"`,
    );
  }
  p += bodyOpen.length;

  expect(T.SKIP_LINK, "the skip link");
  expect("\n\n", "a blank line before the header marker");
  const headerMarkerIndented = text.startsWith(
    T.HEADER_MARKER_INDENT + T.HEADER_START,
    p,
  );
  if (headerMarkerIndented) p += T.HEADER_MARKER_INDENT.length;
  expect(T.HEADER_START, T.HEADER_START);
  const header = upTo(T.HEADER_END, T.HEADER_END);
  expect("\n\n", "a blank line after the header marker");
  expect(T.MAIN_OPEN, "<main> / .guide-layout / .guide-primary");

  if (!text.startsWith(HERO_TAG, text.indexOf(HERO_TAG, p))) {
    throw new Error(`${file}: no ${HERO_TAG}`);
  }
  const iToc = lineStartOf(text, TOC_TAG, p);
  const iArticle = lineStartOf(text, ARTICLE_TAG, iToc);
  if (iToc === -1) throw new Error(`${file}: no ${TOC_TAG}`);
  if (iArticle === -1) throw new Error(`${file}: no ${ARTICLE_TAG}`);
  const closes = text.split(ARTICLE_CLOSE).length - 1;
  if (closes !== 1) {
    throw new Error(`${file}: ${closes} ${ARTICLE_CLOSE} tags, expected 1`);
  }
  const hero = text.slice(p, iToc);
  const toc = text.slice(iToc, iArticle);
  const iArticleEnd =
    text.indexOf(ARTICLE_CLOSE, iArticle) + ARTICLE_CLOSE.length;
  const article = text.slice(iArticle, iArticleEnd);
  p = iArticleEnd;

  expect("\n", "a newline after </article>");
  const closeMatch = /^( *)<\/div>\n/.exec(text.slice(p));
  if (!closeMatch) {
    throw new Error(`${file}: no </div> closing .guide-primary`);
  }
  const primaryCloseIndent = closeMatch[1].length;
  p += closeMatch[0].length;

  const railWrapped = text.startsWith(T.RAIL_WRAPPED, p);
  expect(railWrapped ? T.RAIL_WRAPPED : T.RAIL_INLINE, "the #guide-rail aside");
  expect(T.MAIN_CLOSE, "</div> / </main>");
  expect(T.AFTER_MAIN, "a blank line after </main>");
  const toast = text.startsWith(T.TOAST, p);
  if (toast) {
    p += T.TOAST.length;
    expect(T.AFTER_MAIN, "a blank line after the toast container");
  }
  expect(T.FOOTER_START, T.FOOTER_START);
  const footer = upTo(T.FOOTER_END, T.FOOTER_END);
  expect(T.PAGE_CLOSE, "the /app.js tag and closing tags");

  const rest = text.slice(p);
  if (rest !== "" && rest !== "\n") {
    throw new Error(`${file}: trailing bytes ${JSON.stringify(rest)}`);
  }

  return {
    record: {
      id: slug,
      bodyClass: bodyMatch[1] === undefined ? null : bodyMatch[1],
      toast,
      format: {
        headerMarkerIndented,
        railWrapped,
        primaryCloseIndent,
        trailingNewline: rest === "\n",
      },
    },
    slots: { headMeta, headSocial, headStructuredData, hero, toc, article },
    header,
    footer,
  };
}

// ---------------------------------------------------------------------

const records = [];
const headers = new Set();
const footers = new Set();
let bytesOut = 0;

for (const g of guides) {
  const file = path.join(GUIDE_DIR, `${g.id}.html`);
  const text = fs.readFileSync(file, "utf8");
  const { record, slots, header, footer } = split(g.id, text);

  // Lossless or nothing: re-render through the template with this page's own
  // header/footer regions as the partials and demand the original bytes back.
  const page = Object.assign({}, record, {
    content: T.parseContent(T.serializeContent(slots), `content/guide/${g.id}.html`),
  });
  const rendered = T.pageHtml(page, { header, footer });
  if (rendered !== text) {
    let i = 0;
    while (i < Math.min(rendered.length, text.length) && rendered[i] === text[i]) i++;
    throw new Error(
      `${g.id}: round-trip differs at byte ${i}\n` +
        `  committed ${JSON.stringify(text.slice(i, i + 90))}\n` +
        `  rendered  ${JSON.stringify(rendered.slice(i, i + 90))}`,
    );
  }

  headers.add(header);
  footers.add(footer);
  records.push(record);

  const serialized = T.serializeContent(slots);
  bytesOut += serialized.length;
  if (WRITE) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `${g.id}.html`), serialized, "utf8");
  }
  const f = record.format;
  const drift = [
    record.bodyClass ? "" : "no-body-class",
    record.toast ? "" : "no-toast",
    f.headerMarkerIndented ? "" : "flush-header-marker",
    f.railWrapped ? "rail-wrapped" : "",
    f.primaryCloseIndent === 8 ? "" : `primary-close-${f.primaryCloseIndent}`,
    f.trailingNewline ? "" : "no-eof-newline",
  ].filter(Boolean);
  console.log(
    `  ok  ${g.id.padEnd(38)} ${String(serialized.length).padStart(6)} B` +
      (drift.length ? `   ${drift.join(" ")}` : ""),
  );
}

if (WRITE) {
  fs.writeFileSync(
    path.join(OUT_DIR, "pages.json"),
    JSON.stringify(records, null, 2) + "\n",
    "utf8",
  );
}

console.log("");
console.log(`  ${records.length} pages round-tripped byte-identically`);
console.log(`  ${headers.size} distinct header region(s), ${footers.size} footer region(s)`);
console.log(`  ${bytesOut} bytes of content ${WRITE ? "written to" : "would be written to"} content/guide/`);
console.log(WRITE ? "\n✓ written" : "\n(dry run — pass --write to emit files)");
