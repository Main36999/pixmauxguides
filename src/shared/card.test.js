/**
 * card.test.js — the guide thumbnail <img> in src/shared/card.js.
 *
 * The thumbnail carries width/height so the browser knows its aspect ratio
 * before the file loads. Those numbers are only right while every file in
 * thumbnail_image_webp/ really is that size, so this checks both halves:
 * the markup, and the pixel size read from each WebP's own header.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const card = require("./card.js");

const THUMB_DIR = path.join(__dirname, "..", "..", "thumbnail_image_webp");

/** Pixel size from a WebP header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.toString("ascii", 0, 4), "RIFF", `${file} is not RIFF`);
  assert.strictEqual(b.toString("ascii", 8, 12), "WEBP", `${file} is not WebP`);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8X") {
    return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  }
  throw new Error(`${file}: unknown WebP chunk ${chunk}`);
}

test("thumbnail <img> carries the thumbnails' intrinsic width and height", () => {
  const category = Object.keys(card.THUMBS)[0];
  const html = card.thumbMediaHtml({
    category,
    title: "A guide",
    thumbnail: "/thumbnail_image_webp/A guide.webp",
  });
  assert.match(html, /<img [^>]*\bwidth="1448"/);
  assert.match(html, /<img [^>]*\bheight="1086"/);
  assert.strictEqual(card.THUMB_WIDTH, 1448);
  assert.strictEqual(card.THUMB_HEIGHT, 1086);
  // The attributes add nothing else: lazy loading and the broken-image
  // fallback are unchanged.
  assert.match(html, /loading="lazy"/);
  assert.match(html, /onerror="this\.style\.display='none'"/);
});

test("no thumbnail: only the SVG plate, no <img>", () => {
  const category = Object.keys(card.THUMBS)[0];
  const html = card.thumbMediaHtml({ category, title: "A guide" });
  assert.ok(!html.includes("<img"));
});

test("every guide thumbnail file is 1448x1086 (4:3)", () => {
  const files = fs.readdirSync(THUMB_DIR).filter((f) => f.endsWith(".webp"));
  assert.ok(files.length > 0, "no thumbnails found");
  for (const f of files) {
    assert.deepStrictEqual(
      webpSize(path.join(THUMB_DIR, f)),
      [card.THUMB_WIDTH, card.THUMB_HEIGHT],
      `${f} is not ${card.THUMB_WIDTH}x${card.THUMB_HEIGHT}`,
    );
  }
});
