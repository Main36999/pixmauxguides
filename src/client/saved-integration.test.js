/**
 * saved-integration.test.js — account Saved across the site (Saved Phase 2,
 * M7): the wiring between saved.js, the page scripts that draw Save
 * controls and the pages that load them.
 *
 * Each page's own behaviour is tested beside it (fonts, palettes, colors,
 * guides and account .test.js, with the real saved.js). This file checks
 * only what none of them can see on its own:
 *
 *   - which Save kinds the site draws, and that each is one saved.js and
 *     /account both know;
 *   - that every page with Save controls loads auth and Saved before its own
 *     script;
 *   - that saved.js alone handles a Save click;
 *   - that there is one launch switch, and every page follows it.
 *
 * It reads the sources, the build's own tables and the committed pages, not
 * dist/, so it needs no build. It holds whether saved.js ships dormant or
 * launched: it switches LAUNCHED itself where it runs the file.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { makeDocument } = require("./test-dom.js");

const ROOT = path.join(__dirname, "..", "..");
const build = require(path.join(ROOT, "src", "build", "build.js"));
const fontsBuild = require(path.join(ROOT, "src", "build", "fonts.js"));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SAVED = read("src/client/saved.js");
const GATE = /var LAUNCHED = (?:true|false);/;

/** Every source file under `dirs` (tests excluded), as repo-relative paths. */
function sources(dirs, exts = [".js", ".mjs"]) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (exts.some((e) => entry.name.endsWith(e)) && !/\.test\.m?js$/.test(entry.name)) out.push(child);
    }
  };
  dirs.forEach(walk);
  return out.sort();
}

/** The script URLs a page loads, in order. */
const scriptsOf = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
/** The site's own scripts among them — not the consent or analytics tags in the head. */
const siteScriptsOf = (html) => scriptsOf(html).filter((src) => src.startsWith("/") && !src.startsWith("//"));

/** saved.js run in a fresh page, dormant or launched, signed out. */
function runSaved(launched) {
  const doc = makeDocument();
  const ctx = {
    Promise,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: doc,
    fetch: () => Promise.reject(new Error("no network here")),
    addEventListener: () => {},
  };
  ctx.window = ctx;
  vm.runInNewContext(SAVED.replace(GATE, `var LAUNCHED = ${launched};`), ctx);
  return { doc, api: ctx.BpozzSaved };
}

// The pages with Save controls: the kind each draws, the script that draws
// it, and where that script runs.
const SAVE_PAGES = [
  { kind: "font", script: "src/client/fonts.js", published: "fonts/fonts.js" },
  { kind: "palette", script: "src/client/palettes.js", published: "palettes/palettes.js", page: "palettes/index.html" },
  { kind: "color", script: "src/client/colors.js", published: "colors/colors.js", page: "colors/index.html" },
  { kind: "guide", script: "src/client/guides.js", bundled: true },
];
const GUIDE_PAGES = fs
  .readdirSync(path.join(ROOT, "guide"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => `guide/${f}`);

test("the site draws Save controls for exactly font, palette, color and guide — one page script each, each a kind saved.js and /account know", () => {
  // Every kind a source draws, the two ways a Save control is made.
  const drawn = {};
  for (const file of sources(["src"])) {
    const text = read(file);
    const kinds = [
      ...[...text.matchAll(/data-save-kind="([a-z_]+)"/g)].map((m) => m[1]),
      ...[...text.matchAll(/setAttribute\("data-save-kind", "([a-z_]+)"\)/g)].map((m) => m[1]),
    ];
    for (const kind of kinds) (drawn[kind] ||= new Set()).add(file);
  }
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(drawn).map(([kind, files]) => [kind, [...files]])),
    Object.fromEntries(SAVE_PAGES.map((p) => [p.kind, [p.script]])),
  );

  const { api } = runSaved(false);
  const groups = [...read("src/client/account.js").matchAll(/\{ kind: "([a-z_]+)", title:/g)].map((m) => m[1]);
  for (const { kind } of SAVE_PAGES) {
    assert.ok(api.kinds.includes(kind), `${kind}: a Saved kind`);
    assert.ok(groups.includes(kind), `${kind}: an /account group`);
  }
  // Kinds the API accepts that no page draws: icons wait for the real packs;
  // Image Picker palettes are listed on /account if an account has any.
  assert.deepStrictEqual(Array.from(api.kinds).filter((k) => !SAVE_PAGES.some((p) => p.kind === k)).sort(), ["icon", "image_palette"]);
});

test("no page ships a Save control in its HTML: they are drawn at runtime, and only once Saved is launched", () => {
  const pages = ["index.html", "account.html", "guides/index.html", "palettes/index.html", "colors/index.html", "image-picker/index.html", ...GUIDE_PAGES];
  for (const page of pages) assert.ok(!read(page).includes("data-save"), `${page}: no Save markup`);
  for (const file of sources(["src/build", "src/shared"])) assert.ok(!read(file).includes("data-save"), `${file}: builds no Save markup`);
  for (const { script } of SAVE_PAGES) {
    assert.match(read(script), /\.active [!=]== true/, `${script}: draws only when window.BpozzSaved.active is true`);
  }
  assert.match(read("src/client/account.js"), /saved\.active !== true/, "account.js: does nothing unless active");
});

test("every page with Save controls loads auth and Saved before its own script", () => {
  // /app.js: its modules, auth.js then saved.js, come before its fragments.
  const { modules, fragments } = build.APP_BUNDLE;
  assert.ok(modules.indexOf("src/client/auth.js") !== -1);
  assert.ok(modules.indexOf("src/client/auth.js") < modules.indexOf("src/client/saved.js"), "auth.js before saved.js");
  const bundler = read("src/build/build.js");
  const modulesAt = bundler.indexOf("bundle.modules.map(read)");
  const fragmentsAt = bundler.indexOf("bundle.fragments.map(read)");
  assert.ok(modulesAt !== -1, "the bundler reads the modules");
  assert.ok(fragmentsAt !== -1, "the bundler reads the fragments");
  assert.ok(modulesAt < fragmentsAt, "modules before fragments");

  const published = (from) => build.PUBLISH_FILES.filter((f) => f.from === from).map((f) => f.to);
  for (const p of SAVE_PAGES) {
    if (p.bundled) {
      assert.ok(fragments.includes(p.script), `${p.script}: part of /app.js`);
      assert.deepStrictEqual(published(p.script), [], `${p.script}: not published on its own`);
    } else {
      assert.deepStrictEqual(published(p.script), [p.published], `${p.script}: published at /${p.published}`);
    }
  }

  // /palettes and /colors: /app.js, then the page's script.
  for (const p of SAVE_PAGES.filter((x) => x.page)) {
    assert.deepStrictEqual(siteScriptsOf(read(p.page)), ["/app.js", `/${p.published}`], p.page);
  }

  // /fonts/ and every /fonts/<id>.html: both end in the builder's one closing
  // block, /app.js then /fonts/fonts.js, and load nothing else.
  const builder = read("src/build/fonts.js");
  assert.strictEqual(fontsBuild.SCRIPT, "/fonts/fonts.js");
  assert.deepStrictEqual(scriptsOf(builder), ["/app.js", "${SCRIPT}"]);
  assert.strictEqual(builder.split("${BODY_CLOSE}").length - 1, 2, "the listing and the detail page");

  // Every guide page: /app.js, which carries guides.js.
  for (const page of GUIDE_PAGES) assert.deepStrictEqual(siteScriptsOf(read(page)), ["/app.js"], page);

  // /account: no /app.js, so auth.js and saved.js on their own, first.
  assert.deepStrictEqual(siteScriptsOf(read("account.html")), ["/auth.js", "/saved.js", "/account.js"]);
  assert.deepStrictEqual(published("src/client/auth.js"), ["auth.js"]);
  assert.deepStrictEqual(published("src/client/saved.js"), ["saved.js"]);
});

test("saved.js alone handles a Save click: one document listener, and no other script looks for Save controls", () => {
  assert.strictEqual(SAVED.split('var SELECTOR = "[data-save-kind][data-save-id]";').length - 1, 1);
  assert.strictEqual(SAVED.split('document.addEventListener("click", onClick);').length - 1, 1);
  assert.match(SAVED, /function onClick\(e\) \{[\s\S]*?closest\(SELECTOR\)/);

  const launched = runSaved(true);
  assert.strictEqual(launched.api.active, true);
  assert.strictEqual((launched.doc._listeners.click || []).length, 1, "launched: one document click listener");
  assert.strictEqual((runSaved(false).doc._listeners.click || []).length, 0, "dormant: none");

  // Only saved.js finds Save controls; page scripts draw them and hand them over.
  const finders = sources(["src", "netlify"]).filter((file) => read(file).includes("[data-save"));
  assert.deepStrictEqual(finders, ["src/client/saved.js"]);
  // The font pages' hearts were a Save button before Saved: their own
  // handler steps aside once it is launched.
  assert.ok(read("src/client/fonts.js").includes("if (!btn || account) return;"));
});

test("one launch switch: saved.js's LAUNCHED, set once and read once, and nothing else sets it", () => {
  const setters = [];
  for (const file of sources(["src", "netlify", "scripts"])) {
    for (const m of read(file).matchAll(/\bLAUNCHED\s*=(?!=)[^;\n]*;?/g)) setters.push([file, m[0]]);
  }
  assert.strictEqual(setters.length, 1, JSON.stringify(setters));
  assert.strictEqual(setters[0][0], "src/client/saved.js");
  assert.match(setters[0][1], /^LAUNCHED = (?:true|false);$/);
  assert.strictEqual(SAVED.split("\n").filter((line) => GATE.test(line)).length, 1, "declared once");
  assert.strictEqual(SAVED.split("var ACTIVE = LAUNCHED;").length - 1, 1, "read once");
  assert.strictEqual(
    SAVED.split("\n").filter((line) => /\bLAUNCHED\b/.test(line) && !/^\s*(\*|\/\/)/.test(line)).length,
    2,
    "in code, only where it is set and where it is read",
  );
});
