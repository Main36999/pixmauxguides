/**
 * src/build/fonts.test.js — the font library: data, licensing, routes, pages,
 * downloads.
 *
 *     node --test src/build/fonts.test.js
 *
 * Runs against the committed data and font files and renders the pages in
 * memory through src/build/fonts.js, so it needs no prior build. What it pins:
 *
 *   - the data satisfies its validator and the site.config.js contract;
 *   - every license rule the validator enforces is actually enforced (each
 *     rejection is exercised with a broken copy of a real record);
 *   - every URL a page references — preview faces, download ZIPs, license
 *     files, detail pages — resolves to something the build publishes;
 *   - every ZIP is a valid archive holding exactly the family's original font
 *     files plus its license file, and is byte-identical across two builds;
 *   - a detail page renders exactly the variants the data lists, no more;
 *   - every page carries its title, description, canonical, Open Graph and
 *     parseable JSON-LD;
 *   - every family has a verified license audit record, the offline license
 *     and integrity gate (scripts/fonts/check-fonts.js) passes, and the font
 *     reader it relies on refuses broken files.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const fonts = require("./fonts.js");
const header = require("./header.js");
const build = require("./build.js");

const model = content.load(config);
const FONT_DIR = config.paths.content.fontFiles;
const raw = JSON.parse(fs.readFileSync(config.paths.content.fonts, "utf8"));
const out = fonts.build({ config, model });
const pageByFile = new Map(out.pages.map((p) => [p.file, p.html]));
const packageByFile = new Map(out.packages.map((p) => [p.file, p.data]));

const clone = (v) => JSON.parse(JSON.stringify(v));
const validate = (list) => content.validateFonts(list, "fonts.json", config);

/** Every file the build publishes under /fonts/, as site-root URLs. */
function publishedFontUrls() {
  const urls = new Set();
  const walk = (dir, rel) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const r = rel + "/" + e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else urls.add("/fonts" + r);
    });
  };
  walk(FONT_DIR, "");
  out.packages.forEach((p) => urls.add("/" + p.file));
  out.pages.forEach((p) => urls.add("/" + p.file.replace(/index\.html$/, "").replace(/\.html$/, "")));
  urls.add(fonts.STYLESHEET);
  urls.add(fonts.SCRIPT);
  return urls;
}

/** Minimal ZIP reader: the central directory's entries, CRC-checked. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end !== -1, "no end-of-central-directory record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.strictEqual(buf.readUInt32LE(at), 0x02014b50, "bad central header");
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    assert.strictEqual(buf.readUInt32LE(offset), 0x04034b50, `bad local header for ${name}`);
    const localNameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLen + extraLen;
    const data = buf.subarray(start, start + size);
    assert.strictEqual(method, 0, `${name} is not STORE`);
    assert.strictEqual(fonts.crc32(data), crc, `${name} CRC mismatch`);
    entries.push({ name, data });
    at += 46 + nameLen;
  }
  return entries;
}

// ---------------------------------------------------------------------
// data and contract
// ---------------------------------------------------------------------

test("the committed data satisfies its validator", () => {
  assert.doesNotThrow(() => validate(clone(raw)));
});

test("the record count matches the contract in site.config.js", () => {
  assert.strictEqual(model.fonts.length, config.fonts.count);
});

test("every category in the contract has fonts, and no font uses another", () => {
  const slugs = config.fonts.categories.map((c) => c.slug);
  slugs.forEach((slug) =>
    assert.ok(model.fonts.some((f) => f.category === slug), `no font in ${slug}`),
  );
  model.fonts.forEach((f) => assert.ok(slugs.includes(f.category), f.id));
});

test("every font carries license and source fields", () => {
  model.fonts.forEach((f) => {
    assert.ok(config.fonts.licenses.includes(f.license), f.id);
    assert.match(f.licenseUrl, /^https:\/\//);
    assert.ok(f.copyright.length > 10, `${f.id} has no copyright notice`);
    assert.strictEqual(f.source, "Google Fonts");
    assert.match(f.sourceUrl, /^https:\/\/fonts\.google\.com\/specimen\//);
    assert.match(f.repositoryUrl, /^https:\/\/github\.com\/google\/fonts\/tree\/[0-9a-f]{40}\/ofl\//);
  });
});

test("the copyright notice is the one in the shipped license file", () => {
  model.fonts.forEach((f) => {
    const text = fs
      .readFileSync(path.join(FONT_DIR, f.id, f.licenseFile), "utf8")
      .replace(/\s+/g, " ");
    assert.ok(text.includes(f.copyright), `${f.id}: notice not found in ${f.licenseFile}`);
  });
});

test("WOFF2 previews exist only for families without a Reserved Font Name", () => {
  model.fonts.forEach((f) => {
    f.variants.forEach((v) => {
      if (f.reservedFontName) {
        assert.strictEqual(v.web, v.file, `${f.id} converts an RFN font`);
      } else {
        assert.match(v.web, /\.woff2$/, `${f.id} has no WOFF2 preview`);
        const magic = fs.readFileSync(path.join(FONT_DIR, f.id, v.web)).toString("ascii", 0, 4);
        assert.strictEqual(magic, "wOF2", `${f.id}/${v.web} is not a WOFF2 file`);
      }
    });
    const onDisk = fs.readdirSync(path.join(FONT_DIR, f.id));
    if (f.reservedFontName) {
      assert.ok(!onDisk.some((n) => n.endsWith(".woff2")), `${f.id} ships a converted file`);
    }
  });
});

test("no file under public/fonts is left unreferenced by the data", () => {
  const referenced = new Set();
  model.fonts.forEach((f) => {
    referenced.add(`${f.id}/${f.licenseFile}`);
    f.variants.forEach((v) => {
      referenced.add(`${f.id}/${v.file}`);
      referenced.add(`${f.id}/${v.web}`);
    });
  });
  fs.readdirSync(FONT_DIR).forEach((dir) => {
    assert.ok(model.fonts.some((f) => f.id === dir), `public/fonts/${dir} has no record`);
    fs.readdirSync(path.join(FONT_DIR, dir)).forEach((name) =>
      assert.ok(referenced.has(`${dir}/${name}`), `public/fonts/${dir}/${name} is unreferenced`),
    );
  });
});

// ---------------------------------------------------------------------
// the validator's rejections
// ---------------------------------------------------------------------

function rejects(mutate, pattern) {
  const list = clone(raw);
  mutate(list[0], list);
  assert.throws(() => validate(list), pattern);
}

test("validateFonts rejects a license that is not on the verified list", () => {
  rejects((f) => (f.license = "Freeware"), /not on site\.config\.js's verified/);
});

test("validateFonts rejects a reservedFontName flag the license file contradicts", () => {
  rejects((f) => (f.reservedFontName = !f.reservedFontName), /Reserved Font Name/);
});

test("validateFonts rejects a converted preview for a Reserved Font Name family", () => {
  const list = clone(raw);
  const rfn = list.find((f) => f.reservedFontName);
  rfn.variants[0].web = rfn.variants[0].file.replace(/\.ttf$/, ".woff2");
  assert.throws(() => validate(list), /original file/);
});

test("validateFonts rejects a variant whose file does not exist", () => {
  rejects((f) => {
    f.variants[0].file = "Missing-Regular.ttf";
    f.variants[0].web = f.reservedFontName ? "Missing-Regular.ttf" : "Missing-Regular.woff2";
  }, /does not exist/);
});

test("validateFonts rejects a duplicated variant", () => {
  rejects((f) => f.variants.push(clone(f.variants[0])), /listed twice/);
});

test("validateFonts rejects an unknown category", () => {
  rejects((f) => (f.category = "script"), /fonts\.categories does not list/);
});

test("validateFonts rejects a declared category with no fonts", () => {
  const list = clone(raw).filter((f) => f.category !== "monospace");
  assert.throws(() => validate(list), /fake category/);
});

test("validateFonts rejects a duplicate id", () => {
  rejects((f, list) => (list[1].id = f.id), /duplicate font id/);
});

// ---------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------

test("the font routes are /fonts/ plus one /fonts/<id> per record", () => {
  const table = routes.build(model).filter((r) => r.file.startsWith("fonts/"));
  assert.strictEqual(table.length, model.fonts.length + 1);
  assert.ok(table.every((r) => r.generated));
  assert.ok(table.some((r) => r.url === "/fonts/" && r.file === "fonts/index.html"));
  model.fonts.forEach((f) =>
    assert.ok(table.some((r) => r.url === `/fonts/${f.id}` && r.file === `fonts/${f.id}.html`), f.id),
  );
  assert.strictEqual(routes.build(model).length, config.expected.htmlPages);
});

test("the builder produces exactly the pages the route table declares", () => {
  // Scoped to fonts/: the icon library is a second generated route group,
  // and src/build/icons.test.js makes the same assertion for icons/.
  const declared = routes
    .build(model)
    .filter((r) => r.generated && r.file.startsWith("fonts/"))
    .map((r) => r.file)
    .sort();
  assert.deepStrictEqual([...pageByFile.keys()].sort(), declared);
});

// ---------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------

test("every family has one ZIP: its original files plus its license file", () => {
  assert.strictEqual(out.packages.length, model.fonts.length);
  model.fonts.forEach((f) => {
    const file = `fonts/${f.id}/${fonts.zipName(f)}`;
    const zip = packageByFile.get(file);
    assert.ok(zip, `no package at ${file}`);
    const entries = readZip(zip);
    const expected = [...new Set(f.variants.map((v) => v.file))].concat(f.licenseFile);
    assert.deepStrictEqual(entries.map((e) => e.name).sort(), expected.sort(), f.id);
    entries.forEach((e) =>
      assert.ok(
        e.data.equals(fs.readFileSync(path.join(FONT_DIR, f.id, e.name))),
        `${f.id}: ${e.name} in the ZIP differs from the source file`,
      ),
    );
  });
});

test("the ZIPs are byte-identical across two builds", () => {
  const again = fonts.build({ config, model }).packages;
  again.forEach((p) => assert.ok(p.data.equals(packageByFile.get(p.file)), p.file));
});

// ---------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------

test("every URL a font page references under /fonts/ is published", () => {
  const published = publishedFontUrls();
  const missing = [];
  out.pages.forEach((page) => {
    const refs = [...page.html.matchAll(/(?:href|src)="(\/fonts\/[^"?#]*)"|url\("(\/fonts\/[^"]+)"\)/g)];
    refs.forEach((m) => {
      const url = m[1] || m[2];
      if (!published.has(url)) missing.push(`${page.file} -> ${url}`);
    });
  });
  assert.deepStrictEqual(missing, []);
});

test("every detail page's Download button points at that family's ZIP", () => {
  model.fonts.forEach((f) => {
    const html = pageByFile.get(`fonts/${f.id}.html`);
    const zip = fonts.zipName(f);
    assert.ok(
      html.includes(`href="/fonts/${f.id}/${zip}" download="${zip}"`),
      `${f.id} has no download link to its ZIP`,
    );
  });
});

test("a detail page renders exactly the variants the data lists", () => {
  model.fonts.forEach((f) => {
    const html = pageByFile.get(`fonts/${f.id}.html`);
    const rows = [...html.matchAll(/<p class="font-specimen__label">([^<]+) at /g)].map((m) => m[1]);
    const expected = fonts
      .sortedVariants(f)
      .flatMap((v) => {
        const label = `${f.name} ${fonts.styleName(v)} ${v.weight}`.replace(/&/g, "&amp;");
        return [label, label];
      });
    assert.deepStrictEqual(rows, expected, f.id);
    const faces = [...html.matchAll(new RegExp(`font-family:"${f.family}";src:url\\("[^"]+"\\)[^}]+font-weight:(\\d+);font-style:(\\w+)`, "g"))]
      .map((m) => `${m[1]}/${m[2]}`)
      .sort();
    assert.deepStrictEqual(
      faces,
      f.variants.map((v) => `${v.weight}/${v.style}`).sort(),
      `${f.id} declares a face the data does not list`,
    );
  });
});

test("the listing renders one card per font, each linking to its page", () => {
  const html = pageByFile.get("fonts/index.html");
  const cards = [...html.matchAll(/<li class="font-card" data-font-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(cards.sort(), model.fonts.map((f) => f.id).sort());
  model.fonts.forEach((f) =>
    assert.ok(html.includes(`<a href="/fonts/${f.id}">`), `${f.id} card has no link`),
  );
  config.fonts.categories.forEach((c) =>
    assert.ok(html.includes(`data-category="${c.slug}" aria-pressed="false">${c.label}</button>`), c.slug),
  );
});

test("the listing links back, once each, to the guides that link the font library", () => {
  const html = pageByFile.get("fonts/index.html");
  const expected = Object.keys(model.guideResources).filter((id) =>
    model.guideResources[id].some((r) => r.href === "/fonts/"),
  );
  assert.ok(expected.length > 0, "no guide links /fonts/ — nothing to link back to");
  assert.deepStrictEqual(fonts.learnGuides(model).map((g) => g.id), expected);

  const at = html.indexOf('<section class="tool-notes" aria-labelledby="fonts-learn">');
  assert.ok(at !== -1, "the listing has no learning notes");
  assert.ok(html.indexOf('id="font-grid"') < at, "the notes come before the grid");
  assert.ok(at < html.indexOf("</main>"), "the notes are outside <main>");
  assert.ok(html.includes('<h2 id="fonts-learn">'), "the notes have no heading for aria-labelledby");

  const guideLinks = [...html.matchAll(/href="\/guide\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(guideLinks, expected, "guide links on /fonts/ are not exactly the expected ones, once each");
  expected.forEach((id) => {
    const g = model.guides.find((x) => x.id === id);
    assert.ok(html.includes(`<a href="/guide/${id}">${g.title}</a>`), `${id} is not linked by its title`);
  });
});

test("the listing draws no learning notes when no guide links the font library", () => {
  // One family with no editorial record keeps this a one-ZIP build.
  const one = model.fonts.filter((f) => !model.fontEditorial[f.id]).slice(0, 1);
  const bare = Object.assign({}, model, { guideResources: {}, fonts: one });
  const html = fonts.build({ config, model: bare }).pages[0].html;
  assert.ok(html.includes(`data-font-id="${one[0].id}"`), "not the listing");
  assert.ok(!html.includes("fonts-learn"));
  assert.ok(!html.includes('href="/guide/'));
});

test("every Font Save control draws the site's Save bookmark, never a heart", () => {
  const BOOKMARK =
    '<svg class="font-icon font-icon--bookmark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  let controls = 0;
  out.pages.forEach(({ file, html }) => {
    assert.ok(!html.includes("font-icon--heart") && !html.includes("M12 20.3"), `${file} still draws the heart`);
    const saves = [...html.matchAll(/<button [^>]*data-font-fav="[^"]+"[^>]*>(.*?)<\/button>/g)];
    saves.forEach((m) => assert.ok(m[1].startsWith(BOOKMARK), `${file}: a Save button without the bookmark`));
    controls += saves.length;
  });
  assert.ok(controls > model.fonts.length, "every card and every detail page has a Save control");
  const chip = pageByFile.get("fonts/index.html").match(/<button [^>]*data-category="saved"[^>]*>(.*?)<\/button>/);
  assert.ok(chip, "the listing has its Saved filter chip");
  assert.strictEqual(chip[1], `${BOOKMARK}<span>Saved</span>`, "the Saved chip is the bookmark and its label");
});

test("every font page carries title, description, canonical, Open Graph and valid JSON-LD", () => {
  out.pages.forEach((page) => {
    const html = page.html;
    const url = page.file === "fonts/index.html" ? "/fonts/" : "/" + page.file.replace(/\.html$/, "");
    const canonical = config.origin + url;
    assert.match(html, /<title>[^<]+<\/title>/, page.file);
    assert.match(html, /<meta name="description" content="[^"]{50,}" \/>/, page.file);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`), page.file);
    assert.ok(html.includes(`<meta property="og:url" content="${canonical}" />`), page.file);
    assert.ok(html.includes('<meta property="og:title"'), page.file);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length >= 1, `${page.file} has no JSON-LD`);
    blocks.forEach((b) => assert.doesNotThrow(() => JSON.parse(b[1]), page.file));
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, `${page.file} h1 count`);
  });
  model.fonts.forEach((f) => {
    const html = pageByFile.get(`fonts/${f.id}.html`);
    assert.ok(html.includes(`<title>${f.name.replace(/&/g, "&amp;")} Font — Free Download | bpozz</title>`), f.id);
  });
});

test("the detail pages make no licensing claim beyond the OFL's terms", () => {
  out.pages.forEach((page) => {
    assert.ok(!/100% free|public domain|royalty-free|no attribution/i.test(page.html), page.file);
  });
});

// ---------------------------------------------------------------------
// integration: nav, sitemap, publication, client script
// ---------------------------------------------------------------------

test("Fonts is in the main header nav and both partials are in sync", () => {
  assert.ok(header.MAIN_HEADER_NAV.some((e) => e.label === "Fonts" && e.landingUrl === "/fonts/"));
  const links = header.navLinksHtml(header.MAIN_HEADER_NAV);
  [header.PARTIAL, header.HOME_PARTIAL].forEach((rel) => {
    const source = fs.readFileSync(path.join(config.paths.root, rel), "utf8");
    assert.strictEqual(header.syncNavRegions(rel, source, links).changed, false, rel);
  });
  assert.ok(model.resourceTypes.some((t) => t.landingUrl === "/fonts/" && t.activePaths.includes("fonts/")));
});

test("the sitemap lists /fonts/ and every font page", () => {
  const xml = fs.readFileSync(path.join(config.paths.root, "public", "sitemap.xml"), "utf8");
  assert.ok(xml.includes(`<loc>${config.origin}/fonts/</loc>`));
  model.fonts.forEach((f) =>
    assert.ok(xml.includes(`<loc>${config.origin}/fonts/${f.id}</loc>`), f.id),
  );
});

test("the build publishes the font files, stylesheet and script", () => {
  assert.ok(build.PUBLISH_DIRS.some((d) => d.from === "public/fonts" && d.to === "fonts"));
  assert.ok(build.PUBLISH_FILES.some((f) => "/" + f.to === fonts.STYLESHEET));
  assert.ok(build.PUBLISH_FILES.some((f) => "/" + f.to === fonts.SCRIPT));
});

test("the client script parses and matches the page's element ids", () => {
  const src = fs.readFileSync(path.join(config.paths.client, "fonts.js"), "utf8");
  assert.doesNotThrow(() => new vm.Script(src, { filename: "fonts.js" }));
  const listing = pageByFile.get("fonts/index.html");
  ["font-grid", "fonts-search", "fonts-sort", "fonts-preview-text", "fonts-count", "fonts-empty", "fonts-status"].forEach(
    (id) => assert.ok(listing.includes(`id="${id}"`), id),
  );
  const detail = pageByFile.get(`fonts/${model.fonts[0].id}.html`);
  ["font-custom-text", "font-size", "font-size-value", "fonts-status"].forEach((id) =>
    assert.ok(detail.includes(`id="${id}"`), id),
  );
});

// ---------------------------------------------------------------------
// license audit and font integrity (scripts/fonts/)
// ---------------------------------------------------------------------

const sfnt = require("../../scripts/fonts/sfnt.js");

test("the license and integrity gate passes (scripts/fonts/check-fonts.js)", () => {
  const { spawnSync } = require("child_process");
  const run = spawnSync(process.execPath, [path.join(config.paths.root, "scripts", "fonts", "check-fonts.js")], {
    encoding: "utf8",
  });
  assert.strictEqual(run.status, 0, run.stderr || run.stdout);
});

test("every family has exactly one verified audit record, and rejected candidates carry reasons", () => {
  const audit = JSON.parse(
    fs.readFileSync(path.join(path.dirname(config.paths.content.fonts), "font-license-audit.json"), "utf8"),
  );
  assert.deepStrictEqual(
    audit.families.map((r) => r.id).sort(),
    model.fonts.map((f) => f.id).sort(),
  );
  audit.families.forEach((r) => {
    assert.strictEqual(r.verificationStatus, "verified", r.id);
    assert.strictEqual(r.licenseId, "OFL-1.1", r.id);
    // The evidence basis is explicit, and "upstream verified" is only ever
    // claimed with a verified upstream OFL 1.1 file on record.
    assert.ok(
      ["upstream_license_file_verified", "google_fonts_evidence_only"].includes(r.licenseEvidence),
      r.id,
    );
    assert.strictEqual(
      r.licenseEvidence === "upstream_license_file_verified",
      r.upstream.status === "ofl-1.1" && Boolean(r.upstream.licenseFileUrl),
      r.id,
    );
  });
  audit.rejected.forEach((r) => assert.ok(r.reasons.length, r.name));
  const names = new Set(model.fonts.map((f) => f.name));
  audit.rejected.forEach((r) => assert.ok(!names.has(r.name), `${r.name} is rejected but listed`));
});

test("sfnt reads a real font and refuses broken ones", () => {
  const f = model.fonts.find((x) => x.variants.some((v) => v.web.endsWith(".woff2")));
  const v = f.variants.find((x) => x.web.endsWith(".woff2"));
  const ttf = fs.readFileSync(path.join(FONT_DIR, f.id, v.file));
  const info = sfnt.readSfnt(ttf);
  assert.ok(info.codepoints.has(0x41) && info.numGlyphs > 0);
  assert.throws(() => sfnt.readSfnt(Buffer.from("not a font at all, just text")), /sfnt/);

  const woff = fs.readFileSync(path.join(FONT_DIR, f.id, v.web));
  assert.doesNotThrow(() => sfnt.checkWoff2(woff));
  assert.throws(() => sfnt.checkWoff2(woff.subarray(0, woff.length - 10)), /length/);
  const corrupt = Buffer.from(woff);
  corrupt.fill(0xff, 200, 400); // inside the Brotli stream
  assert.throws(() => sfnt.checkWoff2(corrupt));
  assert.strictEqual(sfnt.embedding(0x0002), "restricted");
  assert.strictEqual(sfnt.embedding(0), "installable");
});

test("each detail page's meta description is the family's own, and no two pages share one", () => {
  const seen = new Set();
  model.fonts.forEach((f) => {
    const html = pageByFile.get(`fonts/${f.id}.html`);
    const m = html.match(/<meta name="description" content="([^"]*)"/);
    assert.ok(m, f.id);
    assert.ok(!seen.has(m[1]), `${f.id} repeats a description`);
    seen.add(m[1]);
  });
});

test("a detail page shows version, character sets and upstream project only when the data has them", () => {
  const withAll = model.fonts.find((f) => f.version && f.subsets && f.upstreamUrl);
  const html = pageByFile.get(`fonts/${withAll.id}.html`);
  assert.ok(html.includes(`<dt>Version</dt><dd>${withAll.version}</dd>`));
  assert.ok(html.includes("<dt>Character sets</dt>"));
  assert.ok(html.includes(`href="${withAll.upstreamUrl}"`));

  const noVersion = model.fonts.find((f) => !f.version);
  assert.ok(noVersion, "fixture: a family without a readable version");
  assert.ok(!pageByFile.get(`fonts/${noVersion.id}.html`).includes("<dt>Version</dt>"));
});
