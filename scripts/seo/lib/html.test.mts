/**
 * scripts/seo/lib/html.test.mts — the scanner on malformed and edge-case HTML.
 *
 *     node --test scripts/seo/lib/html.test.mts
 *
 * In-memory fixtures only; nothing is read from or written to disk.
 */

import test from "node:test";
import assert from "node:assert";

import { extract, decodeEntities } from "./html.mts";

const doc = (head: string, body: string): string => `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

test("title and description are read from <head>, across lines and quote styles", () => {
  const page = extract(
    doc(
      `<TITLE>Font Size Is a Formula — bpozz</TITLE>
       <meta
         name="description"
         content="Type scales,
                  explained."
       />
       <meta name='robots' content='NoIndex, Follow'>`,
      "<h1>Font Size</h1>",
    ),
  );
  assert.deepStrictEqual(page.anomalies, []);
  assert.strictEqual(page.titles.length, 1);
  assert.strictEqual(page.titles[0].text, "Font Size Is a Formula — bpozz");
  assert.strictEqual(page.titles[0].line, 4);
  assert.strictEqual(page.descriptions[0].content, "Type scales, explained.");
  assert.deepStrictEqual(page.robots, ["noindex, follow"]);
});

test("an inline SVG <title> is not the document title, and its headings are not page headings", () => {
  const page = extract(
    doc("<title>Real</title>", '<svg viewBox="0 0 1 1"><title>Icon</title><text><h2>not a heading</h2></text></svg><h1>Page</h1>'),
  );
  assert.deepStrictEqual(page.anomalies, []);
  assert.deepStrictEqual(page.titles.map((t) => t.text), ["Real"]);
  assert.deepStrictEqual(page.headings.map((h) => [h.level, h.text]), [[1, "Page"]]);
});

test("markup inside comments, <script> and <style> is not scanned", () => {
  const page = extract(
    doc(
      "<title>T</title><!-- <title>fake</title> <h1>fake</h1> --><style>a::after{content:'<h1>'}</style>",
      `<script>const s = "<a href='/nowhere'>x</a><h1>no</h1><title>no</title>";</script><h1>Yes</h1>`,
    ),
  );
  assert.deepStrictEqual(page.anomalies, []);
  assert.deepStrictEqual(page.titles.map((t) => t.text), ["T"]);
  assert.deepStrictEqual(page.headings.map((h) => h.text), ["Yes"]);
  assert.deepStrictEqual(page.links, []);
});

test("unquoted, bare, uppercase and duplicated attributes", () => {
  const page = extract(doc("<title>T</title>", '<A HREF=/guides/ id=top>x</A><img src=/a.png alt><img src="/b.png"><a href="/x" href="/y">y</a>'));
  assert.deepStrictEqual(page.links.map((l) => l.href), ["/guides/", "/x"]);
  assert.deepStrictEqual(page.images.map((i) => i.hasAlt), [true, false]);
  assert.strictEqual(page.images[0].alt, "");
  assert.ok(page.ids.includes("top"));
});

test("heading text keeps inline markup's words and decodes entities", () => {
  const page = extract(doc("<title>T</title>", "<h1>Grids &amp; <em>Rhythm</em>&nbsp;&#8212; &#x2014;</h1>"));
  assert.strictEqual(page.headings[0].text, "Grids & Rhythm — —");
});

test("entities decode in one pass: &amp;quot; stays &quot;", () => {
  assert.strictEqual(decodeEntities("&amp;quot; &quot; &unknown; &#0;"), '&quot; " &unknown; &#0;');
});

test("words are counted inside <main> only, without script, style or SVG text", () => {
  const page = extract(
    doc("<title>T</title>", "<p>outside words here</p><main><p>one two three</p><script>var a = 1;</script><svg><text>four</text></svg><p>4 five</p></main>"),
  );
  assert.strictEqual(page.hasMain, true);
  assert.strictEqual(page.mainWords, 5);
});

test("fail closed: unterminated comment, quote and raw-text element", () => {
  assert.match(extract("<html><!-- never closed").anomalies[0].problem, /unterminated comment/);
  assert.match(extract('<html><a href="/x>y</a></html>').anomalies[0].problem, /unterminated " in <a>/);
  assert.match(extract("<html><script>var a;</html>").anomalies[0].problem, /unterminated <script> element/);
});

test("fail closed: two document titles, a title outside <head>, unbalanced SVG, a truncated file", () => {
  const two = extract(doc("<title>A</title><title>B</title>", ""));
  assert.ok(two.anomalies.some((a) => /2 document <title>/.test(a.problem)));

  const outside = extract("<html><head></head><body><title>late</title></body></html>");
  assert.ok(outside.anomalies.some((a) => /outside <head>/.test(a.problem)));

  const svg = extract(doc("<title>T</title>", "<svg><g></g>"));
  assert.ok(svg.anomalies.some((a) => /unbalanced <svg>/.test(a.problem)));

  const truncated = extract("<!doctype html><html><head><title>T</title></head><body><p>cut");
  assert.ok(truncated.anomalies.some((a) => /no <\/html>/.test(a.problem)));
});

test("a heading opened inside another heading is an anomaly, not a silent merge", () => {
  const page = extract(doc("<title>T</title>", "<h2>One<h3>Two</h3>"));
  assert.ok(page.anomalies.some((a) => /opened inside an unclosed <h2>/.test(a.problem)));
});

test("a stray '<' in text and '</' without a name do not derail the scan", () => {
  const page = extract(doc("<title>T</title>", "<p>a < b and </ c ></p><h1>After</h1>"));
  assert.deepStrictEqual(page.anomalies, []);
  assert.deepStrictEqual(page.headings.map((h) => h.text), ["After"]);
});

test("every robots meta is kept, in order", () => {
  const page = extract(doc('<title>T</title><meta name="robots" content="index, follow"><meta name="ROBOTS" content="noindex">', ""));
  assert.deepStrictEqual(page.robots, ["index, follow", "noindex"]);
});

test("an XML declaration and SVG CDATA are skipped without hiding real content", () => {
  const page = extract(doc('<?xml version="1.0"?><title>T</title>', "<svg><![CDATA[ <h1>not a heading</h1> ]]></svg><h1>Real</h1>"));
  assert.deepStrictEqual(page.anomalies, []);
  assert.deepStrictEqual(page.headings.map((h) => h.text), ["Real"]);
});

test("fail closed: a tag cut off at the end of the file", () => {
  assert.match(extract("<html><head><title>T</title></head><body><div class=a").anomalies[0].problem, /unterminated <div> tag/);
  assert.match(extract("<html><body></di").anomalies[0].problem, /unterminated end tag/);
  assert.match(extract("<html><![CDATA[ never closed").anomalies[0].problem, /unterminated CDATA/);
});

test("fail closed: an abruptly closed comment '<!-->' with no later '-->' is not guessed at", () => {
  assert.match(extract("<html><body><!--><p>text</p></body></html>").anomalies[0].problem, /unterminated comment/);
});

test("a meta description without content is recorded as empty, not absent", () => {
  const page = extract(doc('<title>T</title><meta name="description">', ""));
  assert.strictEqual(page.descriptions.length, 1);
  assert.strictEqual(page.descriptions[0].hasContent, false);
  assert.strictEqual(page.descriptions[0].content, "");
});
