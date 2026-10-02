/**
 * guide-template.test.js — the Phase 4 Step 4 guide template migration.
 *
 *     npm test
 *
 * THE RISK THIS COVERS
 *
 * Step 4 took the page structure out of 22 hand-authored guide/*.html files
 * and put it in src/build/guide-template.js, leaving their content in
 * content/guide/. That is only a migration if the pages it renders are
 * indistinguishable from the pages it replaced. If the frame lost a meta tag,
 * a stylesheet link, a JSON-LD block, an id an anchor depends on, or a byte of
 * whitespace inside <article>, the site would still build and still look
 * roughly right while shipping 22 quietly different pages.
 *
 * So the committed guide/*.html files are the contract here. For each guide
 * the template is rendered and diffed against the committed page byte for
 * byte, with that page's OWN header and footer marker regions passed back in
 * as the partials — those two regions belong to src/build/header.js and
 * src/build/footer.js, and holding them fixed is what isolates this test to
 * the template.
 *
 * If a test here fails, the template or a content file lost something; do not
 * edit the committed page to match.
 *
 * WHY THIS IS NOT JUST THE BUILD'S `verify` STAGE AGAIN
 *
 * `verify` hashes dist/ against an approved manifest, so it proves the output
 * did not move — but it is a hash of the finished page after the header and
 * footer builders have run, and its failure mode is "guide/x.html changed"
 * with no indication of where or why. This asserts the same preservation one
 * layer down, at the template's own boundary, and names the byte offset and
 * both sides of the first difference. The two gates fail for different
 * reasons, which is the point of having both.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const content = require("./content.js");
const template = require("./guide-template.js");
const guides = require("./guides.js");
const header = require("./header.js");
const footer = require("./footer.js");
const home = require("./home.js");
const { escapeHtml } = require("../shared/html.js");

const model = content.load(config);
const pages = model.guidePages;

/** The committed page and the two marker regions the other builders own. */
function committed(id) {
  const text = fs.readFileSync(
    path.join(config.paths.root, "guide", `${id}.html`),
    "utf8",
  );
  const between = (start, end) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end);
    assert.ok(from !== -1 && to > from, `${id}: no ${start} / ${end} region`);
    return text.slice(from + start.length, to);
  };
  return {
    text,
    partials: {
      header: between(template.HEADER_START, template.HEADER_END),
      footer: between(template.FOOTER_START, template.FOOTER_END),
    },
  };
}

/** Byte offset of the first difference, or -1. */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// ---------------------------------------------------------------------
// the migration itself
// ---------------------------------------------------------------------

test("every committed guide page is reproduced byte-identically", () => {
  assert.strictEqual(
    pages.length,
    model.guides.length,
    `${pages.length} page records for ${model.guides.length} guides`,
  );

  pages.forEach((page) => {
    const { text, partials } = committed(page.id);
    const rendered = template.pageHtml(page, partials);
    const at = firstDiff(rendered, text);
    assert.strictEqual(
      at,
      -1,
      `guide/${page.id}.html differs at byte ${at}\n` +
        `  committed ${JSON.stringify(text.slice(at, at + 80))}\n` +
        `  rendered  ${JSON.stringify(rendered.slice(at, at + 80))}`,
    );
  });
});

test("the head survives the split intact", () => {
  // The frame owns three head bands and the content owns three. A page that
  // renders without one of them still builds, so each is asserted present
  // rather than left to the byte diff to notice on some future edit.
  pages.forEach((page) => {
    const html = template.pageHtml(page, { header: "", footer: "" });
    // Scoped to <head>: several guides quote a <meta> tag in their prose —
    // one of them explains the viewport tag line by line — so counting
    // across the whole document counts the article too.
    const head = html.slice(0, html.indexOf("</head>"));
    const once = (needle, what, where = head) =>
      assert.strictEqual(
        where.split(needle).length - 1,
        1,
        `guide/${page.id}.html has ${where.split(needle).length - 1} ${what}, expected 1`,
      );

    // Matched on the attribute, not on "<meta name=…": the committed pages
    // wrap a long tag's attributes onto their own lines, so the opening tag
    // and its name are not always adjacent.
    once('<meta charset="UTF-8" />', "charset declarations");
    once('name="viewport"', "viewport tags");
    once("<title>", "titles");
    once('name="description"', "descriptions");
    once('rel="canonical"', "canonical links");
    once('property="og:title"', "og:title tags");
    once('name="twitter:card"', "twitter:card tags");
    once('href="/styles.css"', "styles.css links");
    once('href="/guide-article.css"', "guide-article.css links");
    once('src="/app.js"', "app.js tags", html);
    assert.ok(
      head.includes('type="application/ld+json"'),
      `guide/${page.id}.html has no JSON-LD`,
    );
    assert.ok(
      !html.includes("{{"),
      `guide/${page.id}.html still carries a _TEMPLATE.html {{PLACEHOLDER}}`,
    );
    // No page may reintroduce a page-level <style> block — the audit
    // docs/archive/_TEMPLATE.html opens with, now enforceable in one place.
    assert.ok(!/<style[\s>]/.test(html), `guide/${page.id}.html has a <style> block`);
  });
});

test("the structure is one template, not 22", () => {
  // The frame bands must be identical across every rendered page: that is
  // the whole claim of the migration, and it is what a copied-and-edited
  // content file could quietly undo if any frame text leaked into a slot.
  const frame = [
    template.DOC_OPEN,
    template.HEAD_CONSENT,
    template.HEAD_ANALYTICS,
    template.HEAD_ASSETS,
    template.MAIN_OPEN,
    template.PAGE_CLOSE,
  ];
  pages.forEach((page) => {
    const html = template.pageHtml(page, { header: "", footer: "" });
    frame.forEach((band) =>
      assert.ok(
        html.includes(band),
        `guide/${page.id}.html does not carry the shared ${JSON.stringify(band.slice(0, 40))}… band`,
      ),
    );
  });
});

test("each guide links Guides and its category above the hero", () => {
  // Expected values come from guides.json and categories.json, not
  // from page.category, so a page attached to the wrong category
  // fails here instead of agreeing with itself.
  const guideById = new Map(model.guides.map((g) => [g.id, g]));
  const categoryBySlug = new Map(
    model.categories.map((c) => [c.slug, c]),
  );
  const navOpen = '<nav class="guide-breadcrumb"';
  const guidesLink = '<a href="/guides/">Guides</a>';

  pages.forEach((page) => {
    const file = "guide/" + page.id + ".html";

    const guide = guideById.get(page.id);
    assert.ok(guide, file + ": no record in guides.json");
    const category = categoryBySlug.get(guide.category);
    assert.ok(
      category,
      file + ": categories.json has no slug " + guide.category,
    );

    const categoryOpen = '<a href="/category/' + category.slug + '">';
    const categoryLink =
      categoryOpen + escapeHtml(category.name) + "</a>";

    const html = template.pageHtml(page, { header: "", footer: "" });
    const at = html.indexOf(navOpen);
    assert.ok(at !== -1, file + ": no breadcrumb");
    assert.strictEqual(
      html.split(navOpen).length - 1,
      1,
      file + ": more than one breadcrumb",
    );

    const hero = html.indexOf('class="guide-hero"');
    assert.ok(hero !== -1, file + ": no hero");
    assert.ok(at < hero, file + ": breadcrumb is not before the hero");

    const end = html.indexOf("</nav>", at);
    assert.ok(end !== -1 && end < hero, file + ": nav is not closed");
    const trail = html.slice(at, end);

    const first = trail.indexOf(guidesLink);
    assert.ok(first !== -1, file + ": no Guides link to /guides/");
    assert.ok(
      trail.indexOf(categoryOpen) !== -1,
      file + ": no link to /category/" + category.slug,
    );
    const second = trail.indexOf(categoryLink);
    assert.ok(
      second !== -1,
      file + ": category link text is not " + category.name,
    );
    assert.ok(first < second, file + ": Guides is not the first link");
    assert.strictEqual(
      trail.split("<a ").length - 1,
      2,
      file + ": breadcrumb does not have exactly two links",
    );
  });
});

// ---------------------------------------------------------------------
// the Learning Roadmap connection
// ---------------------------------------------------------------------

/**
 * The roadmap as roadmap.html itself lists it: the guide ids in the order
 * their links appear in the markup src/build/home.js writes into that page,
 * each with the stage it sits under. Read off the rendered list rather than
 * off src/build/roadmap.js's helper, so a guide page that disagrees with
 * the roadmap page fails here instead of agreeing with itself.
 */
function roadmapAsRendered() {
  const stagesHtml = home.buildRoadmap(model.guides).stagesHtml;
  const stages = stagesHtml.split('<li class="roadmap-stage"').slice(1);
  const order = [];
  stages.forEach((stageHtml, i) => {
    const title = stageHtml.match(
      /<h2 class="roadmap-stage-title">([^<]*)<\/h2>/,
    )[1];
    const links = stageHtml.match(/href="\/guide\/[^"]+"/g) || [];
    links.forEach((link) => {
      order.push({
        id: link.slice('href="/guide/'.length, -1),
        stageNumber: i + 1,
        stageTitleHtml: title,
      });
    });
  });
  return { order, stageCount: stages.length };
}

const CONTEXT_OPEN = '<nav class="guide-roadmap"';
const ORDER_OPEN = '<nav class="guide-footer-nav"';

test("a roadmap guide states its stage and position between the hero and the contents", () => {
  const { order, stageCount } = roadmapAsRendered();
  assert.ok(order.length > 0, "roadmap.html lists no guides");

  order.forEach((entry, i) => {
    const file = "guide/" + entry.id + ".html";
    const page = pages.find((p) => p.id === entry.id);
    assert.ok(page, file + ": on the roadmap but has no page record");

    const html = template.pageHtml(page, { header: "", footer: "" });
    assert.strictEqual(
      html.split(CONTEXT_OPEN).length - 1,
      1,
      file + ": expected exactly one roadmap context block",
    );

    const at = html.indexOf(CONTEXT_OPEN);
    const end = html.indexOf("</nav>", at);
    const block = html.slice(at, end);
    assert.ok(
      html.indexOf('class="guide-hero"') < at,
      file + ": roadmap context is not after the hero",
    );
    assert.ok(
      end < html.indexOf('class="guide-toc"'),
      file + ": roadmap context is not before the table of contents",
    );

    // The position is the guide's place in the list roadmap.html shows,
    // 1..N — never guides.json's fractional roadmapStep sort key.
    const place =
      "Stage " +
      entry.stageNumber +
      " of " +
      stageCount +
      " · " +
      entry.stageTitleHtml +
      " · Guide " +
      (i + 1) +
      " of " +
      order.length;
    assert.ok(
      block.includes(">" + place + "</p>"),
      file + ": roadmap context does not read " + JSON.stringify(place),
    );
    assert.ok(
      block.includes('<a class="guide-roadmap__link" href="/roadmap">'),
      file + ": roadmap context has no link to /roadmap",
    );
    assert.strictEqual(
      block.split("<a ").length - 1,
      1,
      file + ": roadmap context does not have exactly one link",
    );
  });
});

test("previous and next follow the order roadmap.html lists the guides in", () => {
  const { order } = roadmapAsRendered();
  const titleById = new Map(model.guides.map((g) => [g.id, g.title]));

  order.forEach((entry, i) => {
    const file = "guide/" + entry.id + ".html";
    const page = pages.find((p) => p.id === entry.id);
    const html = template.pageHtml(page, { header: "", footer: "" });

    assert.strictEqual(
      html.split(ORDER_OPEN).length - 1,
      1,
      file + ": expected exactly one previous/next block",
    );
    const at = html.indexOf(ORDER_OPEN);
    const block = html.slice(at, html.indexOf("</nav>", at));
    assert.ok(
      html.indexOf("</article>") < at,
      file + ": previous/next is not after the article",
    );
    assert.ok(
      at < html.indexOf('id="guide-rail"'),
      file + ": previous/next is not before the related-guides rail",
    );

    // The direction is stated in words for assistive technology
    // ("Previous: " / "Next: ", visually hidden) and the arrow, which says
    // the same thing to the eye, is hidden from it — so a link's accessible
    // name is "Previous: <title>", not an arrow's name and a title.
    const prev = order[i - 1];
    const next = order[i + 1];
    const expected = [];
    if (prev) {
      expected.push(
        '<a class="prev" href="/guide/' +
          prev.id +
          '"><span aria-hidden="true">← </span>' +
          '<span class="sr-only">Previous: </span>' +
          escapeHtml(titleById.get(prev.id)) +
          "</a>",
      );
    }
    if (next) {
      expected.push(
        '<a class="next" href="/guide/' +
          next.id +
          '"><span class="sr-only">Next: </span>' +
          escapeHtml(titleById.get(next.id)) +
          '<span aria-hidden="true"> →</span></a>',
      );
    }
    expected.forEach((link) =>
      assert.ok(block.includes(link), file + ": missing " + link),
    );
    // No arrow may sit outside an aria-hidden span, where it would be read
    // out as part of the link's name.
    const spoken = block.replace(/<span aria-hidden="true">[^<]*<\/span>/g, "");
    assert.ok(
      !/[←→]/.test(spoken),
      file + ": an arrow is exposed to assistive technology",
    );
    // The first guide has no previous and the last has no next: the count
    // is what proves the missing link was left out, not pointed elsewhere.
    assert.strictEqual(
      block.split("<a ").length - 1,
      expected.length,
      file + ": previous/next does not have exactly " + expected.length + " link(s)",
    );
  });

  const first = pages.find((p) => p.id === order[0].id);
  const last = pages.find((p) => p.id === order[order.length - 1].id);
  assert.ok(
    !template.pageHtml(first, { header: "", footer: "" }).includes('class="prev"'),
    "the first roadmap guide has a previous link",
  );
  assert.ok(
    !template.pageHtml(last, { header: "", footer: "" }).includes('class="next"'),
    "the last roadmap guide has a next link",
  );
});

test("a guide that is not on the roadmap carries no roadmap context", () => {
  const onRoadmap = new Set(roadmapAsRendered().order.map((e) => e.id));
  const off = pages.filter((p) => !onRoadmap.has(p.id));

  // Expected from guides.json, so the two sets are checked against each other.
  const unplaced = model.guides
    .filter((g) => typeof g.roadmapStage !== "number")
    .map((g) => g.id)
    .sort();
  assert.deepStrictEqual(off.map((p) => p.id).sort(), unplaced);

  off.forEach((page) => {
    const file = "guide/" + page.id + ".html";
    const html = template.pageHtml(page, { header: "", footer: "" });
    assert.strictEqual(page.roadmap, null, file + ": has a roadmap record");
    assert.ok(!html.includes(CONTEXT_OPEN), file + ": has a roadmap context");
    assert.ok(!html.includes(ORDER_OPEN), file + ": has previous/next links");
    assert.ok(
      !html.includes('href="/roadmap"'),
      file + ": links the roadmap from outside the header and footer",
    );
  });
});

// ---------------------------------------------------------------------
// the content file format
// ---------------------------------------------------------------------

test("content files round-trip through parse/serialize", () => {
  pages.forEach((page) => {
    const file = path.join(config.paths.content.guidePages, `${page.id}.html`);
    const text = fs.readFileSync(file, "utf8");
    assert.strictEqual(
      template.serializeContent(template.parseContent(text, page.id)),
      text,
      `content/guide/${page.id}.html is not canonical`,
    );
  });
});

test("a content file that loses a byte is a build failure, not a different page", () => {
  const slots = {};
  template.SLOT_KEYS.forEach((key) => (slots[key] = `  <!-- ${key} -->\n`));
  const canonical = template.serializeContent(slots);

  assert.deepStrictEqual(template.parseContent(canonical, "fixture"), slots);

  const broken = {
    "a blank line left at end of file": canonical + "\n",
    "a note added between two blocks": canonical.replace(
      "<!--HERO_START-->",
      "<!-- editor's note -->\n<!--HERO_START-->",
    ),
    "a missing slot": canonical.replace(
      /<!--TOC_START-->[\s\S]*?<!--TOC_END-->\n/,
      "",
    ),
    "a mistyped end marker": canonical.replace(
      "<!--ARTICLE_END-->",
      "<!--ARTICLE-END-->",
    ),
  };
  Object.entries(broken).forEach(([what, text]) => {
    assert.throws(
      () => template.parseContent(text, "fixture"),
      /fixture/,
      `parseContent accepted ${what}`,
    );
  });
});

test("slot order is the page order the template splices in", () => {
  const slots = {};
  template.SLOT_KEYS.forEach((key) => (slots[key] = `::${key}::`));
  const html = template.pageHtml(
    {
      id: "fixture",
      bodyClass: null,
      toast: false,
      format: {
        headerMarkerIndented: true,
        railWrapped: false,
        primaryCloseIndent: 8,
        trailingNewline: true,
      },
      content: slots,
    },
    { header: "", footer: "" },
  );
  assert.deepStrictEqual(
    template.SLOT_KEYS.map((key) => html.indexOf(`::${key}::`)).slice(),
    template.SLOT_KEYS.map((key) => html.indexOf(`::${key}::`))
      .slice()
      .sort((a, b) => a - b),
    "the slots are not spliced in SLOT_KEYS order",
  );
});

// ---------------------------------------------------------------------
// the page records
// ---------------------------------------------------------------------

test("pages.json describes exactly the guides in guides.json", () => {
  const guideIds = model.guides.map((g) => g.id).sort();
  const pageIds = pages.map((p) => p.id).sort();
  assert.deepStrictEqual(pageIds, guideIds);
});

test("a guide with no page record fails the load, loudly", () => {
  assert.throws(
    () =>
      content.loadGuidePages(
        config.paths.content.guidePages,
        model.guides.concat([{ id: "not-a-real-guide" }]),
        config.origin,
      ),
    /no page record for guide "not-a-real-guide"/,
  );
});

test("a content file whose canonical names another guide fails the load", () => {
  // The drift hand-authoring produced: a page copied to a new slug with its
  // head left pointing at the old one.
  assert.throws(
    () =>
      content.loadGuidePages(
        config.paths.content.guidePages,
        model.guides,
        "https://example.invalid",
      ),
    /has no canonical/,
  );
});

// ---------------------------------------------------------------------
// the marker contract with the header and footer builders
// ---------------------------------------------------------------------

test("the template's marker comments are the ones the patchers look for", () => {
  guides.assertMarkersAgree();
  assert.strictEqual(template.HEADER_START, header.START_MARKER);
  assert.strictEqual(template.HEADER_END, header.END_MARKER);
  assert.strictEqual(template.FOOTER_START, footer.START_MARKER);
  assert.strictEqual(template.FOOTER_END, footer.END_MARKER);
});

test("every rendered page carries both marker regions for them to patch", () => {
  pages.forEach((page) => {
    const html = template.pageHtml(page, { header: "H", footer: "F" });
    assert.ok(
      html.includes(template.HEADER_START + "H" + template.HEADER_END),
      `guide/${page.id}.html has no patchable header region`,
    );
    assert.ok(
      html.includes(template.FOOTER_START + "F" + template.FOOTER_END),
      `guide/${page.id}.html has no patchable footer region`,
    );
  });
});
