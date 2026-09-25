/**
 * src/build/icons.test.js — the icon library: data, asset rules, routes,
 * pages, downloads.
 *
 *     node --test src/build/icons.test.js
 *
 * Runs against the committed data and icon files and renders the pages in
 * memory through src/build/icons.js, so it needs no prior build. What it pins:
 *
 *   - the data satisfies its validator and the site.config.js contract, and
 *     every rule the validator states is actually enforced (each rejection is
 *     exercised with a broken copy of a real record);
 *   - every SVG is safe to paste — no script, handler, reference or
 *     hard-coded colour — and every PNG is a real square RGBA PNG;
 *   - a card offers exactly the formats its icon ships: Copy SVG and an
 *     SVG/PNG choice for vector icons, one Download PNG link for 3D;
 *   - every URL a page references under /icons/ resolves to something the
 *     build publishes;
 *   - every pack ZIP holds exactly that pack's files of that format, byte for
 *     byte, and is identical across two builds;
 *   - every page carries its title, description, canonical, noindex and Open
 *     Graph, and the client script matches the page's element ids.
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
const icons = require("./icons.js");
const fonts = require("./fonts.js");
const header = require("./header.js");
const build = require("./build.js");

const model = content.load(config);
const ICON_DIR = config.paths.content.iconFiles;
const rawPacks = JSON.parse(fs.readFileSync(config.paths.content.iconPacks, "utf8"));
const rawIcons = JSON.parse(fs.readFileSync(config.paths.content.icons, "utf8"));
const out = icons.build({ config, model });
const pageByFile = new Map(out.pages.map((p) => [p.file, p.html]));
const packageByFile = new Map(out.packages.map((p) => [p.file, p.data]));

const clone = (v) => JSON.parse(JSON.stringify(v));
const validate = (packs, list) => content.validateIcons(packs, list, config);
const checkSvg = (text) => content._internals.checkIconSvg(text, "test.svg");
const styleOf = (slug) => config.icons.styles.find((s) => s.slug === slug);

/** Minimal ZIP reader: the central directory's entries, CRC-checked. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end !== -1, "no end-of-central-directory record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.strictEqual(buf.readUInt32LE(at), 0x02014b50, "bad central header");
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = buf.subarray(start, start + size);
    assert.strictEqual(fonts.crc32(data), crc, `${name} CRC mismatch`);
    entries.push({ name, data });
    at += 46 + nameLen;
  }
  return entries;
}

/** The cards on a page, as { attrs, html } with their data-* attributes. */
function cardsOf(html) {
  return [...html.matchAll(/<li class="icon-card" ([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return { attrs, html: m[2] };
  });
}

// ---------------------------------------------------------------------
// data and contract
// ---------------------------------------------------------------------

test("the committed data satisfies its validator", () => {
  assert.doesNotThrow(() => validate(rawPacks, rawIcons));
});

test("every style and category in the contract is used, and pack counts are derived", () => {
  const styles = new Set(model.iconPacks.map((p) => p.style));
  config.icons.styles.forEach((s) => assert.ok(styles.has(s.slug), s.slug));
  const cats = new Set(model.icons.map((i) => i.category));
  config.icons.categories.forEach((c) => assert.ok(cats.has(c.slug), c.slug));
  model.iconPacks.forEach((p) =>
    assert.strictEqual(p.iconCount, model.icons.filter((i) => i.pack === p.id).length, p.id),
  );
  rawPacks.forEach((p) => assert.ok(!("iconCount" in p), `${p.id} stores a count; it must be derived`));
});

test("vector icons ship an SVG; raster (3D) icons ship a PNG and no SVG", () => {
  model.icons.forEach((i) => {
    if (styleOf(i.style).vector) assert.ok(i.svg, `${i.pack}/${i.id} has no svg`);
    else {
      assert.ok(i.png, `${i.pack}/${i.id} has no png`);
      assert.strictEqual(i.svg, undefined, `${i.pack}/${i.id} is raster but names an svg`);
    }
  });
});

test("no file under public/icons is left unreferenced by the data", () => {
  const referenced = new Set();
  model.icons.forEach((i) => {
    if (i.svg) referenced.add(`${i.pack}/${i.svg}`);
    if (i.png) referenced.add(`${i.pack}/${i.png}`);
  });
  const stray = [];
  const walk = (dir, rel) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (!referenced.has(r)) stray.push(r);
    });
  walk(ICON_DIR, "");
  assert.deepStrictEqual(stray, []);
});

// ---------------------------------------------------------------------
// the validator's rules, each exercised
// ---------------------------------------------------------------------

function rejects(mutate, pattern) {
  const packs = clone(rawPacks);
  const list = clone(rawIcons);
  mutate(packs, list);
  assert.throws(() => validate(packs, list), pattern);
}

const firstOf = (list, style) => list.find((i) => i.style === style);

test("validateIcons rejects an SVG on a raster-style icon", () => {
  rejects((_p, l) => (firstOf(l, "3d").svg = "svg/heart.svg"), /raster style/);
});

test("validateIcons rejects a vector-style icon without an SVG", () => {
  rejects((_p, l) => delete firstOf(l, "outline").svg, /must ship an svg/);
});

test("validateIcons rejects a raster-style icon without a PNG", () => {
  rejects((_p, l) => delete firstOf(l, "3d").png, /must ship a png/);
});

test("validateIcons rejects an asset file that does not exist", () => {
  rejects((_p, l) => {
    const i = firstOf(l, "outline");
    i.id = "no-such-icon";
    i.svg = "svg/no-such-icon.svg";
    i.png = "png/no-such-icon.png";
  }, /does not exist/);
});

test("validateIcons rejects an unknown category, pack or mismatched style", () => {
  rejects((_p, l) => (l[0].category = "weather"), /icons\.categories does not list/);
  rejects((_p, l) => (l[0].pack = "nope"), /icon-packs\.json does not list/);
  rejects((_p, l) => (l[0].style = "solid"), /but its pack is/);
});

test("validateIcons rejects a duplicate icon id within a pack", () => {
  rejects((_p, l) => l.push(clone(l[0])), /duplicate icon id/);
});

test("validateIcons rejects a pack with no icons and a style with no pack", () => {
  rejects((p) => p.push({ id: "outline-essentials-2", name: "X", style: "outline", description: "X" }), /does not exist|has no icons/);
  rejects((p, l) => {
    p.splice(p.findIndex((x) => x.style === "3d"), 1);
    for (let i = l.length - 1; i >= 0; i--) if (l[i].style === "3d") l.splice(i, 1);
  }, /no pack has it/);
});

test("the SVG check refuses anything unsafe to paste", () => {
  const ok = fs.readFileSync(path.join(ICON_DIR, "outline-essentials", "svg", "home.svg"), "utf8");
  assert.doesNotThrow(() => checkSvg(ok));
  const bad = [
    [ok.replace("<path", '<script>alert(1)</script><path'), /not an allowed icon element/],
    [ok.replace("<path", '<path onclick="x()"'), /event-handler/],
    [ok.replace("<path", '<path href="https://x.test/"'), /link or external reference/],
    [ok.replace('stroke="currentColor"', 'stroke="#ff0000"'), /hard-coded colour|currentColor only/],
    [ok.replace('fill="none"', 'fill="red"'), /currentColor only/],
    [ok.replace("<path", '<path style="fill:red"'), /inline style/],
    [ok.replace("<path", "<image"), /not an allowed icon element/],
    [ok.replace(/ viewBox="[^"]*"/, ""), /viewBox/],
    [ok.replace(' xmlns="http://www.w3.org/2000/svg"', ""), /SVG namespace/],
  ];
  bad.forEach(([text, re]) => assert.throws(() => checkSvg(text), re));
});

test("every committed SVG passes the paste-safety check and every PNG is square RGBA", () => {
  model.icons.forEach((i) => {
    if (i.svg) checkSvg(fs.readFileSync(path.join(ICON_DIR, i.pack, i.svg), "utf8"));
    if (i.png) assert.ok(i.pngSize >= 256, `${i.pack}/${i.png} is ${i.pngSize}px`);
  });
});

// ---------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------

test("the icon routes are /icons/ plus one /icons/<pack>.html per pack, all generated", () => {
  const table = routes.build(model).filter((r) => r.file.startsWith("icons/"));
  assert.deepStrictEqual(
    table.map((r) => r.url).sort(),
    ["/icons/"].concat(model.iconPacks.map((p) => `/icons/${p.id}.html`)).sort(),
  );
  table.forEach((r) => assert.strictEqual(r.generated, true, r.url));
});

test("the builder produces exactly the pages the route table declares", () => {
  const declared = routes
    .build(model)
    .filter((r) => r.file.startsWith("icons/"))
    .map((r) => r.file)
    .sort();
  assert.deepStrictEqual(out.pages.map((p) => p.file).sort(), declared);
});

// ---------------------------------------------------------------------
// cards: exactly the formats each icon has
// ---------------------------------------------------------------------

test("the listing renders one card per icon, and each pack page one per pack icon", () => {
  assert.strictEqual(cardsOf(pageByFile.get("icons/index.html")).length, model.icons.length);
  model.iconPacks.forEach((p) => {
    const cards = cardsOf(pageByFile.get(`icons/${p.id}.html`));
    assert.strictEqual(cards.length, p.iconCount, p.id);
    cards.forEach((c) => assert.ok(c.attrs.key.startsWith(`${p.id}--`), c.attrs.key));
  });
});

test("a card offers exactly the formats its icon ships", () => {
  const byKey = new Map(model.icons.map((i) => [`${i.pack}--${i.id}`, i]));
  cardsOf(pageByFile.get("icons/index.html")).forEach(({ attrs, html }) => {
    const icon = byKey.get(attrs.key);
    const copy = html.includes("data-icon-copy");
    const svgLinks = (html.match(/download="[^"]+\.svg"/g) || []).length;
    const pngLinks = (html.match(/download="[^"]+\.png"/g) || []).length;
    assert.strictEqual(copy, Boolean(icon.svg), `${attrs.key}: Copy SVG`);
    assert.strictEqual(svgLinks, icon.svg ? 1 : 0, `${attrs.key}: SVG download`);
    assert.strictEqual(pngLinks, icon.png ? 1 : 0, `${attrs.key}: PNG download`);
    assert.strictEqual(attrs.svg, icon.svg ? `/icons/${icon.pack}/${icon.svg}` : undefined, attrs.key);
    if (!icon.svg) {
      assert.ok(
        html.includes(`aria-label="Download PNG — ${attrs.name} — ${attrs["style-label"]}" title="Download PNG"`),
        `${attrs.key}: raster tile has one named Download PNG link`,
      );
      assert.ok(!html.includes("<details"), `${attrs.key}: raster card needs no format menu`);
    }
  });
});

/** Accessible names of every control in the icon grid: aria-label, else text. */
function controlNames(html) {
  const grid = html.slice(html.indexOf('<ul class="icon-grid"'), html.indexOf("</ul>", html.indexOf('<ul class="icon-grid"')));
  return [...grid.matchAll(/<(button|a|summary)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => {
    const label = /aria-label="([^"]*)"/.exec(m[2]);
    return label ? label[1] : m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  });
}

test("every card action has a unique accessible name on every page", () => {
  out.pages.forEach((page) => {
    const names = controlNames(page.html);
    assert.ok(names.length >= 3 * cardsOf(page.html).length - 10, `${page.file}: found too few card controls`);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepStrictEqual([...new Set(dupes)], [], page.file);
  });
});

test("a tile is the icon, not a product card: no heading or metadata, every icon-only action has a tooltip", () => {
  out.pages.forEach((page) => {
    cardsOf(page.html).forEach(({ attrs, html }) => {
      assert.ok(!/<h[1-6]\b/.test(html), `${page.file} ${attrs.key}: heading inside a tile`);
      assert.ok(!html.includes(attrs["category-label"]), `${page.file} ${attrs.key}: category shown on the tile`);
      assert.ok(html.includes(`<span class="icon-card__caption" aria-hidden="true">${attrs.name}</span>`), `${attrs.key}: caption`);
      const actions = [...html.matchAll(/<(button|summary|a) class="icon-tile-btn[^"]*"([^>]*)>/g)];
      assert.ok(actions.length >= 1, `${attrs.key}: no actions`);
      actions.forEach((m) => {
        assert.ok(/ aria-label="[^"]+"/.test(m[2]) && / title="[^"]+"/.test(m[2]), `${attrs.key}: ${m[1]} needs aria-label and title`);
      });
    });
    // the glyph sprite the tiles reference is on the page, once
    assert.strictEqual((page.html.match(/class="icons-sprite"/g) || []).length, 1, page.file);
  });
});

test("each filter row's All chip has its own accessible name; the visible label stays All", () => {
  out.pages.forEach((page) => {
    const all = [...page.html.matchAll(/<button type="button" class="icons-chip" data-filter="(\w+)" data-value=""[^>]*>([^<]*)<\/button>/g)];
    assert.ok(all.length >= 1, `${page.file}: no All chip`);
    all.forEach((m) => {
      assert.strictEqual(m[2], "All", `${page.file}: visible label`);
      const want = { style: "All styles", category: "All categories" }[m[1]];
      assert.ok(m[0].includes(`aria-label="${want}"`), `${page.file}: ${m[1]} All chip should be named "${want}"`);
    });
  });
  const listing = pageByFile.get("icons/index.html");
  assert.ok(listing.includes('aria-label="All styles">All<') && listing.includes('aria-label="All categories">All<'));
});

test("card actions name the icon and its style", () => {
  cardsOf(pageByFile.get("icons/index.html")).forEach(({ attrs, html }) => {
    const who = `${attrs.name} — ${attrs["style-label"]}`;
    assert.ok(html.includes(`data-icon-open aria-haspopup="dialog" aria-label="${who}"`), `${attrs.key}: tile name`);
    if (attrs.svg) {
      assert.ok(html.includes(`aria-label="Copy SVG code — ${who}"`), `${attrs.key}: copy name`);
      assert.ok(
        html.includes(`aria-label="Download options for ${who}" title="Download options for ${who}"`),
        `${attrs.key}: download control needs a matching aria-label and tooltip`,
      );
    }
  });
});

test("3D cards never mention SVG", () => {
  cardsOf(pageByFile.get("icons/3d-essentials.html")).forEach(({ attrs, html }) => {
    assert.ok(!/svg/i.test(html.replace(/<svg[\s\S]*?<\/svg>/g, "")), attrs.key);
  });
});

test("the pack page offers one ZIP per format its icons ship", () => {
  model.iconPacks.forEach((p) => {
    const html = pageByFile.get(`icons/${p.id}.html`);
    const packIcons = model.icons.filter((i) => i.pack === p.id);
    ["svg", "png"].forEach((fmt) => {
      const name = icons.zipName(p, fmt);
      const has = packIcons.some((i) => i[fmt]);
      assert.strictEqual(html.includes(`download="${name}"`), has, `${p.id} ${fmt} pack link`);
      assert.strictEqual(html.includes(`Download ${fmt.toUpperCase()} Pack`), has, `${p.id} ${fmt} label`);
    });
  });
});

test("pack pages show only the category filters their icons use", () => {
  model.iconPacks.forEach((p) => {
    const html = pageByFile.get(`icons/${p.id}.html`);
    const used = new Set(model.icons.filter((i) => i.pack === p.id).map((i) => i.category));
    config.icons.categories.forEach((c) =>
      assert.strictEqual(html.includes(`data-filter="category" data-value="${c.slug}"`), used.has(c.slug), `${p.id} ${c.slug}`),
    );
    assert.ok(!html.includes('data-filter="style"'), `${p.id} has style chips`);
  });
});

// ---------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------

test("every pack ZIP holds exactly that pack's files of its format, byte for byte", () => {
  model.iconPacks.forEach((p) => {
    ["svg", "png"].forEach((fmt) => {
      const members = model.icons.filter((i) => i.pack === p.id && i[fmt]);
      const zip = packageByFile.get(`icons/${p.id}/${icons.zipName(p, fmt)}`);
      if (!members.length) return assert.strictEqual(zip, undefined, `${p.id} has an empty ${fmt} ZIP`);
      const entries = readZip(zip);
      assert.deepStrictEqual(entries.map((e) => e.name).sort(), members.map((i) => icons.downloadName(i, fmt)).sort());
      entries.forEach((e) => {
        const icon = members.find((i) => icons.downloadName(i, fmt) === e.name);
        assert.ok(e.data.equals(fs.readFileSync(path.join(ICON_DIR, p.id, icon[fmt]))), `${p.id}/${e.name}`);
      });
    });
  });
});

test("a file has one name: its individual download and its ZIP entry match", () => {
  model.iconPacks.forEach((p) => {
    const html = pageByFile.get(`icons/${p.id}.html`);
    ["svg", "png"].forEach((fmt) => {
      const zip = packageByFile.get(`icons/${p.id}/${icons.zipName(p, fmt)}`);
      if (!zip) return;
      readZip(zip).forEach((e) => {
        assert.ok(e.name.endsWith(`-${p.style}.${fmt}`), `${p.id}: ${e.name}`);
        assert.ok(html.includes(`download="${e.name}"`), `${p.id}: no individual download named ${e.name}`);
      });
    });
  });
});

test("the ZIPs are byte-identical across two builds", () => {
  icons.build({ config, model }).packages.forEach((p) => assert.ok(p.data.equals(packageByFile.get(p.file)), p.file));
});

test("every URL an icon page references under /icons/ is published", () => {
  const published = new Set(["/icons/", icons.STYLESHEET, icons.SCRIPT]);
  const walk = (dir, rel) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else published.add(`/icons${r}`);
    });
  walk(ICON_DIR, "");
  out.packages.forEach((p) => published.add(`/${p.file}`));
  out.pages.forEach((p) => published.add(`/${p.file.replace(/index\.html$/, "")}`));

  const missing = [];
  out.pages.forEach((page) => {
    for (const m of page.html.matchAll(/(?:href|src|data-svg|data-png|data-pack-url)="(\/icons\/[^"?#]*)"/g)) {
      if (!published.has(m[1])) missing.push(`${page.file} -> ${m[1]}`);
    }
  });
  assert.deepStrictEqual(missing, []);
});

test("the build publishes the icon files, stylesheet and script", () => {
  assert.ok(build.PUBLISH_DIRS.some((d) => d.from === "public/icons" && d.to === "icons"));
  assert.ok(build.PUBLISH_FILES.some((f) => "/" + f.to === icons.STYLESHEET));
  assert.ok(build.PUBLISH_FILES.some((f) => "/" + f.to === icons.SCRIPT));
});

// ---------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------

test("every icon page carries title, description, canonical, noindex and Open Graph", () => {
  out.pages.forEach((page) => {
    const html = page.html;
    const url = routes.urlFor(page.file);
    assert.ok(/<title>[^<]+<\/title>/.test(html), `${page.file}: title`);
    assert.ok(/<meta name="description" content="[^"]+"/.test(html), `${page.file}: description`);
    assert.ok(html.includes(`<link rel="canonical" href="${config.origin}${url}" />`), `${page.file}: canonical`);
    assert.ok(html.includes('<meta name="robots" content="noindex" />'), `${page.file}: noindex (Phase 1)`);
    assert.ok(html.includes(`<meta property="og:url" content="${config.origin}${url}" />`), `${page.file}: og:url`);
  });
});

test("the listing opens with the Icon Packs title and subtitle, then every pack", () => {
  const html = pageByFile.get("icons/index.html");
  assert.ok(html.includes(`<h1>${icons.TITLE}</h1>`));
  assert.ok(html.includes(`<p>${icons.SUBTITLE}</p>`));
  model.iconPacks.forEach((p) => assert.ok(html.includes(`href="/icons/${p.id}.html"`), p.id));
  config.icons.styles.forEach((s) =>
    assert.ok(html.includes(`data-filter="style" data-value="${s.slug}"`), s.slug),
  );
});

test("the listing is icon-first: search and grid come before the pack cards", () => {
  const html = pageByFile.get("icons/index.html");
  const at = (s) => html.indexOf(s);
  assert.ok(at('id="icons-search"') > at("<h1>"), "search after the title");
  assert.ok(at('id="icon-grid"') < at('class="icon-packs"'), "grid before the pack cards");
  assert.ok(at('class="icon-packs"') > 0, "pack cards still on the page");
});

test("the phone glyph size never applies to 3D (raster) previews", () => {
  const css = fs.readFileSync(path.join(config.paths.styles, "icons.css"), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 479px)"));
  const block = phone.slice(0, phone.indexOf("\n}\n"));
  assert.ok(!/^\s*\.icon-card__preview img\s*\{/m.test(block), "unscoped .icon-card__preview img rule in the phone block");
  assert.ok(block.includes(".icon-card__preview:not(.icon-card__preview--raster) img"), "phone glyph rule is scoped to non-raster tiles");
});

test("Phase 1: the icon pages are not in the sitemap or the header nav", () => {
  const sitemap = fs.readFileSync(path.join(config.paths.root, "public", "sitemap.xml"), "utf8");
  assert.ok(!sitemap.includes("/icons/"), "sitemap lists /icons/");
  assert.ok(!header.MAIN_HEADER_NAV.some((e) => e.landingUrl.startsWith("/icons")), "nav links /icons/");
});

test("the client script parses and matches the page's element ids", () => {
  const src = fs.readFileSync(path.join(config.paths.client, "icons.js"), "utf8");
  assert.doesNotThrow(() => new vm.Script(src, { filename: "icons.js" }));
  const ids = [...src.matchAll(/(?:getElementById\("|querySelector\("#)([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8, "found the ids the script uses");
  out.pages.forEach((page) =>
    ids.forEach((id) => assert.ok(page.html.includes(`id="${id}"`), `${page.file} lacks #${id}`)),
  );
});

test("the SVG sources the builder links are what Copy SVG will fetch", () => {
  cardsOf(pageByFile.get("icons/index.html")).forEach(({ attrs }) => {
    if (!attrs.svg) return;
    const file = path.join(ICON_DIR, attrs.svg.replace(/^\/icons\//, ""));
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.startsWith("<svg"), attrs.key);
  });
});
