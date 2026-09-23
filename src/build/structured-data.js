/**
 * src/build/structured-data.js — the one JSON-LD generation path.
 *
 * PHASE 4 STEP 7 — SEO / JSON-LD CLEANUP
 *
 * This module is F2, closed. It is the single place the site's structured
 * data is shaped, and it is the consumer `site.config.js` `jsonLd` spent
 * three phases waiting for (recorded as D6 in the Step 6 handoff: "has no
 * consumer … touching it is JSON-LD work, which this step is not").
 *
 * WHAT IT REPLACES
 *
 * Guide pages carried their JSON-LD as hand-written text inside
 * content/guide/<slug>.html, one copy per page, and 22 copies of a thing a
 * human maintains is 22 chances to drift. They had drifted into three
 * incompatible shapes, which `src/build/guide-template.js` recorded rather
 * than fixed because Step 4 was not allowed to change published bytes:
 *
 *   13 pages   TechArticle alone, no breadcrumb trail at all,
 *              `mainEntityOfPage` as a bare string, `inLanguage`, and an
 *              `image` under /thumbnail_image/ — a directory that does not
 *              exist and never has (the published one is
 *              /thumbnail_image_webp/), so the image 404s
 *    6 pages   TechArticle + BreadcrumbList, `mainEntityOfPage` as a WebPage
 *              node, articleSection/proficiencyLevel/timeRequired, no
 *              `inLanguage`, and a second, differently-wrong /thumbnail_image/
 *              spelling with unescaped spaces in the URL
 *    3 pages   BreadcrumbList + a plain `Article` (not TechArticle), emitted
 *              in the opposite order, with none of the article metadata and
 *              the generic site OG image
 *
 * Category pages were already generated, but by a literal object inside
 * src/build/categories.js's page template with `https://bpozz.com` written
 * out four times — beside a site.config.js whose first field is a canonical
 * `origin` documented as the one place that value lives.
 *
 * THE RULE THIS MODULE ENFORCES
 *
 * Structured data is DERIVED, never authored. Every value below comes from
 * the content model (guides.json, categories.json, content/guide/pages.json)
 * or from the page's own declared metadata. Nothing here is a second place to
 * state a fact the model already states, which is the only way the drift
 * above cannot come back: there is no longer a per-page file to edit.
 *
 * In particular `description` is the guide page's own
 * `<meta name="description">`, lifted from its HEAD_META slot by
 * src/build/content.js. A page cannot now describe itself one way to a search
 * engine's crawler and another way in its own head, because both readings
 * come from the same bytes.
 *
 * NO URL IS INVENTED HERE
 *
 * Every URL is `origin` + a path the route table already serves, or an asset
 * path taken verbatim from the model and percent-encoded. `origin` arrives
 * from site.config.js; this module has no default and no literal of its own,
 * so a future origin change is one edit in one file.
 *
 * PURE. No fs, no ctx, no config require. Callers pass what they have and get
 * objects or a string back, which is what makes this testable and what keeps
 * src/build/content.js the only module that reads content off disk.
 */

"use strict";

const CONTEXT = "https://schema.org";

/** Publisher identity. One statement, used by every node that needs it. */
const ORGANIZATION_NAME = "BPOZZ";
const ORGANIZATION_LOGO = "/assets/logo.png";

/** The site's content language. Every page is English; none declares otherwise. */
const IN_LANGUAGE = "en";

/** Fixed breadcrumb rungs above a guide. Both are real, routed URLs. */
const HOME_CRUMB = { name: "Home", path: "/" };
const GUIDES_CRUMB = { name: "Guides", path: "/guides/" };

// ---------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------

/**
 * Absolute URL for a site-root path.
 *
 * encodeURI, not escape-by-hand: several guide thumbnails are named after
 * their guide's title and carry spaces and commas
 * ("/thumbnail_image_webp/Grid Systems Are a Rhythm, Not a Ruler.png"). A raw
 * space is tolerated by browsers in an href and is NOT valid in a JSON-LD
 * URL, and the pre-Step-7 pages emitted it raw. encodeURI escapes the space
 * and leaves the path separators and commas alone, which is exactly the
 * difference between a URL and a string that looks like one.
 *
 * An already-absolute URL is returned untouched: the model stores a few
 * (og:image overrides), and re-encoding one would double-escape it.
 */
function absolute(origin, pathOrUrl) {
  if (typeof pathOrUrl !== "string" || !pathOrUrl) {
    throw new Error("structured-data: absolute() needs a non-empty path");
  }
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl[0] !== "/") {
    throw new Error(
      `structured-data: "${pathOrUrl}" is neither absolute nor site-root ` +
        `relative — every path in the model starts with "/"`,
    );
  }
  return origin + encodeURI(pathOrUrl);
}

// ---------------------------------------------------------------------
// shared nodes
// ---------------------------------------------------------------------

function organization() {
  return { "@type": "Organization", name: ORGANIZATION_NAME };
}

function publisher(origin) {
  return {
    "@type": "Organization",
    name: ORGANIZATION_NAME,
    logo: {
      "@type": "ImageObject",
      url: absolute(origin, ORGANIZATION_LOGO),
    },
  };
}

/**
 * A BreadcrumbList from an ordered list of { name, path } rungs. `path` is
 * optional: a rung with no path is named without claiming a URL, which is how
 * the category pages' "Categories" level has always been emitted (there is no
 * /categories/ index on this site).
 *
 * NO "@context" HERE. A JSON-LD document declares its context once, at the
 * top. This node is top-level on a guide page and nested inside the
 * CollectionPage on a category page, so the caller that knows which adds it —
 * see `topLevel()`. Emitting it unconditionally would put a second context
 * declaration inside every category page's `breadcrumb`, which is the kind of
 * duplication this module exists to remove.
 */
function breadcrumbList(origin, rungs) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: rungs.map(function (rung, i) {
      const item = { "@type": "ListItem", position: i + 1, name: rung.name };
      if (rung.path) item.item = absolute(origin, rung.path);
      return item;
    }),
  };
}

/** The same node as a standalone document: "@context" first, then its keys. */
function topLevel(node) {
  return Object.assign({ "@context": CONTEXT }, node);
}

// ---------------------------------------------------------------------
// guide pages
// ---------------------------------------------------------------------

/** "beginner" -> "Beginner". schema.org proficiencyLevel is free text. */
function proficiencyLevel(level) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * The article node for one guide.
 *
 * The @type is not hard-coded: it is whichever article type
 * site.config.js's `jsonLd.guide` names, so the F3 decision is read from the
 * config that records it rather than restated here.
 */
function guideArticle(type, input) {
  const { guide, category, page, description, origin } = input;

  return topLevel({
    "@type": type,
    headline: guide.title,
    description,
    image: absolute(origin, guide.thumbnail),
    author: organization(),
    publisher: publisher(origin),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": absolute(origin, `/guide/${guide.id}`),
    },
    datePublished: page.datePublished,
    dateModified: page.dateModified,
    articleSection: category.name,
    proficiencyLevel: proficiencyLevel(guide.level),
    timeRequired: `PT${guide.readTime}M`,
    inLanguage: IN_LANGUAGE,
  });
}

/** Home > Guides > <category> > <this guide>. */
function guideBreadcrumb(input) {
  const { guide, category, origin } = input;
  return topLevel(
    breadcrumbList(origin, [
      HOME_CRUMB,
      GUIDES_CRUMB,
      { name: category.name, path: `/category/${category.slug}` },
      { name: guide.title, path: `/guide/${guide.id}` },
    ]),
  );
}

/**
 * The builders `jsonLd.guide` may name, by @type.
 *
 * A name with no entry here is a build failure rather than a silently missing
 * block: the config states which blocks a guide page carries, and a typo in
 * it must not be able to quietly ship a page with less structured data than
 * the decision says it has.
 */
const GUIDE_BLOCKS = {
  BreadcrumbList: guideBreadcrumb,
  TechArticle: (input) => guideArticle("TechArticle", input),
  Article: (input) => guideArticle("Article", input),
};

/**
 * Every JSON-LD object for one guide page, in the order `types` names.
 *
 *   guide        the guides.json record
 *   category     the categories.json record for guide.category
 *   page         the content/guide/pages.json record (carries the dates)
 *   description  the page's own <meta name="description">, decoded
 *   origin       config.origin
 *   types        config.jsonLd.guide
 */
function guideJsonLd(input) {
  const types = input.types;
  if (!Array.isArray(types) || !types.length) {
    throw new Error(
      "structured-data: jsonLd.guide in site.config.js must name at least " +
        "one block type",
    );
  }
  return types.map(function (type) {
    const build = GUIDE_BLOCKS[type];
    if (!build) {
      throw new Error(
        `structured-data: site.config.js jsonLd.guide names "${type}", which ` +
          `this module has no builder for (known: ${Object.keys(GUIDE_BLOCKS).join(", ")})`,
      );
    }
    return build(input);
  });
}

// ---------------------------------------------------------------------
// category pages
// ---------------------------------------------------------------------

/**
 * The CollectionPage node for one category page.
 *
 * Transcribed from the object that used to sit inside
 * src/build/categories.js's page template, field for field and in the same
 * order, with its four hard-coded "https://bpozz.com" literals replaced by
 * `origin`. The emitted JSON is unchanged; where it comes from is not.
 *
 * The "Categories" rung deliberately carries no `item`: a Category is not a
 * child of Guides — it groups Guides and Palettes alike — and there is no
 * /categories/ index on this site, so the level is named without claiming a
 * page that does not exist.
 */
function categoryJsonLd(input) {
  const { label, description, slug, origin } = input;
  const canonical = absolute(origin, `/category/${slug}`);

  return topLevel({
    "@type": "CollectionPage",
    name: label,
    description,
    url: canonical,
    isPartOf: {
      "@type": "WebSite",
      name: ORGANIZATION_NAME,
      url: absolute(origin, "/"),
    },
    breadcrumb: breadcrumbList(origin, [
      HOME_CRUMB,
      { name: "Categories" },
      { name: label, path: `/category/${slug}` },
    ]),
  });
}

// ---------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------

/**
 * One <script type="application/ld+json"> per object, indented as markup.
 *
 * The JSON body is indented to sit inside its <script> tag. That is a change
 * from the category pages' previous output, whose body was emitted at column
 * 0 because `JSON.stringify(…, null, 2)` was interpolated into a template
 * literal and only its first line picked up the literal's indentation. The
 * JSON is identical either way — this is whitespace inside a script element,
 * asserted equal by parse in the Step 7 verification — and a single renderer
 * that formats every block the same way is the point of having one.
 */
function scriptsHtml(objects, indent) {
  const pad = " ".repeat(indent);
  const body = " ".repeat(indent + 2);
  return objects
    .map(function (object) {
      const json = JSON.stringify(object, null, 2)
        .split("\n")
        .map((line) => body + line)
        .join("\n");
      return `${pad}<script type="application/ld+json">\n${json}\n${pad}</script>`;
    })
    .join("\n");
}

module.exports = {
  guideJsonLd,
  categoryJsonLd,
  scriptsHtml,
  absolute,
  breadcrumbList,
  topLevel,
  organization,
  publisher,
  GUIDE_BLOCKS,
  CONTEXT,
  ORGANIZATION_NAME,
  ORGANIZATION_LOGO,
  IN_LANGUAGE,
};
