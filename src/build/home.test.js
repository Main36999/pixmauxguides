/**
 * home.test.js — the homepage renderers in src/build/home.js.
 *
 *     npm test
 *
 * Pins what the homepage below the hero promises, against the real content
 * model: every card is a real link to a built route, the counts come from
 * the data, the resource cards skip the pinned topics, the hero holds the
 * brand line as the one H1 and a supporting line that reads as written,
 * and each tool card's heading color is readable on its pastel ground.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");
const routes = require("./routes.js");
const home = require("./home.js");
const { escapeHtml } = require("../shared/html.js");

const model = content.load(config);
const knownUrls = new Set(routes.build(model).map((r) => r.url));
const indexSource = fs.readFileSync(path.join(config.paths.root, "index.html"), "utf8");

test("tool cards: one real link per tool, live counts, no dead routes", () => {
  const html = home.toolCardsHtml(model, knownUrls);
  const hrefs = [...html.matchAll(/<a class="tool-card__link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(hrefs, home.HOME_TOOLS.map((t) => t.url));
  hrefs.forEach((href) => assert.ok(knownUrls.has(href), href));
  assert.strictEqual((html.match(/<h3 class="tool-card__title">/g) || []).length, hrefs.length);
  assert.match(html, new RegExp(`${model.colors.length} named colors across 12 families`));
  assert.match(html, new RegExp(`${model.palettes.length} palettes`));
  assert.match(html, new RegExp(`${model.guides.length} practical guides`));
  // The CTA line is decoration; the link's name is the title alone.
  (html.match(/<p class="tool-card__cta"[^>]*>/g) || []).forEach((tag) =>
    assert.match(tag, /aria-hidden="true"/),
  );
});

test("a tool card pointing at an unbuilt route fails the build", () => {
  assert.throws(() => home.toolCardsHtml(model, new Set()), /not in the route table/);
});

test("resource cards skip the pinned topics", () => {
  const skipped = home.RESOURCE_TOPICS_SKIPPED;
  const topics = home.resourceTopics(model.categories, model.guides, skipped);
  assert.ok(topics.length > 0);
  topics.forEach((t) => {
    assert.ok(!skipped.has(t.category.slug), `${t.category.slug} should be skipped`);
    assert.ok(t.guides > 0, `${t.category.slug} has no guides, so no page`);
  });
  // Most guides first, except the deprioritized topics, which close the list.
  const ranked = topics.filter((t) => !home.RESOURCE_TOPICS_LAST.has(t.category.slug));
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].guides >= ranked[i].guides);
  }
  topics.slice(ranked.length).forEach((t) =>
    assert.ok(home.RESOURCE_TOPICS_LAST.has(t.category.slug), `${t.category.slug} is out of place`),
  );
  assert.deepStrictEqual(
    topics.map((t) => t.category.slug),
    ["mobile", "web", "systems", "motion", "adobe-xd"],
  );

  const { html, count } = home.resourceCardsHtml(topics, knownUrls);
  assert.strictEqual(count, topics.length + 2, "topics plus Fonts and About");
  const hrefs = [...html.matchAll(/<a class="resource-card__link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(hrefs[hrefs.length - 1], home.HOME_ABOUT.url);
  assert.strictEqual(hrefs[0], "/fonts/", "Fonts opens the section");
  assert.deepStrictEqual(
    hrefs,
    ["/fonts/", "/category/mobile", "/category/web", "/category/systems", "/category/motion", "/category/adobe-xd", "/about"],
  );
  assert.ok(html.includes('<li class="resource-card"><h3 class="resource-card__title"><a class="resource-card__link" href="/fonts/">Fonts</a></h3>'));
  // Icon Packs was retired: no resource card links /icons/.
  assert.ok(!html.includes("/icons/"), "no Icon Packs card on Home");
  hrefs.forEach((href) => assert.ok(knownUrls.has(href), href));
});

test("Home has no Icon Packs link anywhere: the feature is retired", () => {
  assert.ok(!indexSource.includes("HOME_ICON_PACKS"), "the standalone section's markers are gone");
  assert.ok(!indexSource.includes("/icons/"), "no /icons/ link in index.html");
  assert.ok(!/Icon Packs/.test(indexSource), "no Icon Packs label in index.html");
  assert.strictEqual((indexSource.match(/>More useful resources</g) || []).length, 1);
  assert.strictEqual(home.iconPacksHtml, undefined, "the per-pack renderer is gone");
  assert.strictEqual(home.HOME_ICONS, undefined, "the Icon Packs card is gone");
});

// ---- hero: static markup in index.html ----

const heroMatch = /<section class="hero"[^>]*>([\s\S]*?)<\/section>/.exec(indexSource);

test("hero: the brand line is the page's one H1, in plain text", () => {
  assert.ok(heroMatch, "index.html has the hero");
  assert.match(heroMatch[0], /^<section class="hero" aria-labelledby="hero-title">/);
  const h1s = [...indexSource.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/g)];
  assert.strictEqual(h1s.length, 1, "one H1 on the homepage");
  assert.strictEqual(h1s[0][1], ' id="hero-title"');
  assert.ok(heroMatch[1].includes(h1s[0][0]), "the H1 is the hero's");
  assert.strictEqual(h1s[0][2].trim(), "A Creative Platform for Graphic&nbsp;Designers.");
  // No markup inside: the line stands as docs/BRAND.md writes it; the
  // rotating phrase belongs to the supporting line.
  assert.doesNotMatch(h1s[0][2], /</);
});

test("hero: the supporting line reads as written, and only its last phrase rotates", () => {
  const lede = /<p class="hero-lede">([\s\S]*?)<\/p>/.exec(heroMatch[1]);
  assert.ok(lede, "the hero has its supporting line");
  // What assistive technology reads: everything but the aria-hidden phrases.
  const read = lede[1]
    .replace(/<span class="hero-rotator__item"[^>]*aria-hidden="true">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  assert.strictEqual(read, "Explore practical design guides, resources, and tools to support your creative work.");

  const phrases = [...lede[1].matchAll(
    /<span class="hero-rotator__item( is-current)?" data-focus="([a-z]+)"( aria-hidden="true")?>([^<]+)<\/span>/g,
  )].map((m) => [m[4], m[2], Boolean(m[1]), Boolean(m[3])]);
  assert.deepStrictEqual(phrases, [
    ["creative work.", "all", true, false],
    ["typography.", "type", false, true],
    ["color choices.", "color", false, true],
    ["layouts.", "layout", false, true],
    ["design ideas.", "all", false, true],
  ]);
  // Every card a phrase selects is in the scene, which starts on "all".
  assert.match(heroMatch[1], /<div class="hero-scene" data-focus="all" aria-hidden="true">/);
  phrases
    .filter(([, focus]) => focus !== "all")
    .forEach(([, focus]) => assert.ok(heroMatch[1].includes(`hero-scene__item--${focus}"`), focus));
});

test("hero: a decorative scene, one pause button, no links or search", () => {
  const hero = heroMatch[1];
  // The scene closes before the button, so the button is outside its
  // aria-hidden subtree.
  const sceneAt = hero.indexOf('<div class="hero-scene"');
  const buttonAt = hero.indexOf("<button");
  const scene = hero.slice(sceneAt, buttonAt);
  assert.ok(sceneAt > 0 && buttonAt > sceneAt);
  assert.strictEqual((scene.match(/<div\b/g) || []).length, (scene.match(/<\/div>/g) || []).length);
  assert.doesNotMatch(scene, /<(a|button|input)\b|tabindex/);

  const buttons = [...hero.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
  assert.deepStrictEqual(buttons, [
    ' type="button" class="hero-motion-toggle" aria-pressed="false" aria-label="Pause motion" hidden',
  ]);
  // The CTAs and topics are gone, and the site's one search box is in the header.
  assert.doesNotMatch(hero, /<a\b|<form|<input|role="search"/);
});

test("hero: none of the previous hero's pieces are left", () => {
  const css = fs.readFileSync(path.join(config.paths.root, "src/styles/styles.css"), "utf8");
  const core = fs.readFileSync(path.join(config.paths.root, "src/client/core.js"), "utf8");
  // the sign-in visual as a backdrop, its drift, the entrance and typing classes, the marquee
  assert.doesNotMatch(heroMatch[0], /auth__|fade-up|hero-type|explore|tagline/);
  assert.doesNotMatch(css, /\.hero__visual|@keyframes (hero-drift|hero-turn|hero-breathe|fadeUp)|\.fade-up|\.hero-type|\.explore/);
  assert.doesNotMatch(core, /heroTyping|hero-type|\.explore/);
});

test("a resource-types.json home block is refused, not silently ignored", () => {
  assert.doesNotThrow(() => home.assertNoHomeBlocks(model.resourceTypes));
  assert.throws(
    () => home.assertNoHomeBlocks([{ type: "guide", home: { order: 0, limit: 8, sort: "roadmap" } }]),
    /set "home": null/,
  );
});

// ---- learning roadmap: roadmap.html as it stands with nothing read ----
//
// app.js (src/client/roadmap.js) marks each step Read, Next up or neither
// from what the reader has checked off. The build writes the page in the
// state that script paints for a reader with nothing read, so the page is
// right before the script runs and for a reader without it — and every link
// on it is a real link either way.

const roadmap = home.buildRoadmap(model.guides);
const roadmapSteps = roadmap.stagesHtml.split('<li class="roadmap-step').slice(1);
const roadmapSource = fs.readFileSync(path.join(config.paths.root, "roadmap.html"), "utf8");

test("roadmap steps: every guide is a real link, and only the first is Next up", () => {
  const { roadmapGuides } = home.groupRoadmap(model.guides);
  assert.strictEqual(roadmapSteps.length, roadmapGuides.length);
  assert.strictEqual(roadmapSteps.length, 20);

  const ids = roadmapSteps.map((step, i) => {
    const link = /<a class="roadmap-step-link" href="\/guide\/([^"]+)"( aria-current="step")?>/.exec(step);
    assert.ok(link, `step ${i + 1} has no link to its guide`);
    assert.ok(knownUrls.has("/guide/" + link[1]), `/guide/${link[1]} is not a built route`);
    // The checkbox stores the id the link goes to.
    assert.ok(step.includes(`data-roadmap-id="${link[1]}"`), `step ${i + 1}: checkbox and link disagree`);

    const state = /<span class="roadmap-step-meta"><span class="roadmap-step-state">([^<]*)<\/span>([^<]+)<\/span><\/a><\/li>/.exec(step);
    assert.ok(state, `step ${i + 1} has no state inside its link's meta line`);
    assert.match(state[2], /^(Beginner|Intermediate|Advanced) · \d+ min read$/);

    const first = i === 0;
    assert.strictEqual(step.startsWith(first ? ' is-next">' : '">'), true, `step ${i + 1}: is-next`);
    assert.strictEqual(link[2] !== undefined, first, `step ${i + 1}: aria-current`);
    assert.strictEqual(state[1], first ? "Next up" : "", `step ${i + 1}: state text`);
    return link[1];
  });
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual((roadmap.stagesHtml.match(/aria-current=/g) || []).length, 1);
  assert.strictEqual((roadmap.stagesHtml.match(/is-next/g) || []).length, 1);
  // No state is written as Read: that is the reader's, not the build's.
  assert.ok(!roadmap.stagesHtml.includes("is-complete"));
  assert.ok(!/roadmap-step-state">Read</.test(roadmap.stagesHtml));
});

test("roadmap Continue: a real link to the first guide listed, worded Continue", () => {
  const first = /<a class="roadmap-step-link" href="(\/guide\/([^"]+))"/.exec(roadmap.stagesHtml);
  const title = model.guides.find((g) => g.id === first[2]).title;
  assert.strictEqual(
    roadmap.continueHtml,
    `<a class="btn btn-primary roadmap-continue" id="roadmap-continue" href="${first[1]}">Continue: ${escapeHtml(title)}</a>`,
  );
  assert.ok(knownUrls.has(first[1]));
  assert.strictEqual(home.buildRoadmap([]).continueHtml, "", "no guides, no link");
  assert.strictEqual(home.buildRoadmap([]).stagesHtml, "");
});

test("roadmap.html: the Continue slot, one empty status region, the progress hooks", () => {
  const filled = home.replaceBetween(
    roadmapSource,
    "<!--ROADMAP_CONTINUE_START-->",
    "<!--ROADMAP_CONTINUE_END-->",
    roadmap.continueHtml,
    "roadmap.html",
  );
  assert.strictEqual(filled.split('id="roadmap-continue"').length - 1, 1);
  // The committed page already holds the link the build writes.
  assert.strictEqual(filled, roadmapSource, "roadmap.html's Continue link is not the build's");

  assert.strictEqual(roadmapSource.split('<p class="sr-only" id="roadmap-status" role="status"></p>').length - 1, 1);
  assert.strictEqual(roadmapSource.split('role="status"').length - 1, 2, "the status line and the toast");
  for (const id of ["roadmap-progress-fill", "roadmap-progress-label", "roadmap-reset", "roadmap-continue", "roadmap-status"]) {
    assert.strictEqual(roadmapSource.split(`id="${id}"`).length - 1, 1, id);
  }
  // Continue and the status line sit inside the progress block, above the stages.
  const progress = roadmapSource.indexOf('id="roadmap-progress"');
  const track = roadmapSource.indexOf('<ol class="roadmap-track">');
  for (const id of ["roadmap-continue", "roadmap-status"]) {
    const at = roadmapSource.indexOf(`id="${id}"`);
    assert.ok(progress < at && at < track, id + " is not in the progress block");
  }
});

// ---- tool card tones: heading ink must pass WCAG AA on both grounds ----

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("every tool tone in home.css has an AA-readable heading color", () => {
  const css = fs.readFileSync(path.join(config.paths.root, "src/styles/home.css"), "utf8");
  const tones = new Set(home.HOME_TOOLS.map((t) => t.tone));
  tones.forEach((tone) => {
    const block = new RegExp(`\\.tool-card--${tone} \\{([^}]*)\\}`).exec(css);
    assert.ok(block, `home.css has no .tool-card--${tone}`);
    const v = (name) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block[1])[1];
    for (const ground of [v("card-bg"), v("card-bg-hover")]) {
      const ratio = contrast(v("card-ink"), ground);
      assert.ok(ratio >= 4.5, `${tone}: ${v("card-ink")} on ${ground} is ${ratio.toFixed(2)}:1`);
      // Description text (#273142) on the same ground.
      assert.ok(contrast("#273142", ground) >= 7, `${tone}: description contrast`);
    }
  });
});
