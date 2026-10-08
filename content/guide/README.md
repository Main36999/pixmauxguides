# content/guide/ — the guide pages' content

One file per guide, plus `pages.json`. Added in Phase 4 Step 4, when the guide
page structure moved into `src/build/guide-template.js` and stopped being
copy-pasted into 22 hand-authored `guide/*.html` files.

    content/guide/<slug>.html   this guide's content, in six slots
    content/guide/pages.json    one structural record per page
    src/build/guide-template.js the page structure, once
    src/build/guides.js         renders one page per record
    guide/<slug>.html           GENERATED (see "the committed pages" below)

`src/build/content.js` loads this directory in the build's `load` stage, so a
guide with no page, a page with no guide, a malformed content file or a
content file whose canonical URL names a different guide fails before
anything is written.

## The content file

Exactly six blocks, in this order, and nothing else in the file:

    <!--HEAD_META_START-->              viewport, <title>, description, canonical
    <!--HEAD_SOCIAL_START-->            Open Graph + Twitter Card
    <!--HEAD_STRUCTURED_DATA_START-->   the ld+json block(s)
    <!--HERO_START-->                   <section class="guide-hero">
    <!--TOC_START-->                    <nav class="guide-toc">
    <!--ARTICLE_START-->                <article class="guide-article">

each written as

    <!--HERO_START-->
    …content…
    <!--HERO_END-->

**The newline rule.** The newline directly after a `_START` marker and the one
directly before an `_END` marker belong to the marker line, not to the
content. Nothing else is trimmed or added, which is what makes the format
lossless: a slot that ends in a blank line keeps it (you see two blank lines
before the `_END` marker), and so does a slot that ends mid-line.

The file must be exactly what `serializeContent()` produces — the six blocks,
in order, with nothing between or around them. `parseContent()` checks that by
round-tripping the file rather than by a list of rules, so a mistyped marker,
a reordered block, a note dropped between two blocks or an editor stripping a
trailing blank line is a build failure, not a quietly different page.

Content is inserted **verbatim**: it is already-rendered HTML and is never
escaped, re-indented or reformatted. The indentation inside these files
varies between guides because it varied in the pages they came from.

## pages.json

One record per guide, describing what the frame cannot state as a single
string:

| field                       | what it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `id`                        | the guide's slug; must match a `guides.json` id and the filename |
| `bodyClass`                 | the `<body>` class, or `null` for no class attribute            |
| `toast`                     | whether the page carries the `#toast` container                 |
| `format.headerMarkerIndented` | whether `<!--HEADER_START-->` is indented                     |
| `format.railWrapped`        | whether the empty `#guide-rail` is wrapped over five lines      |
| `format.primaryCloseIndent` | spaces before the `</div>` that closes `.guide-primary`         |
| `format.trailingNewline`    | whether the file ends with a newline                            |

Every field is required on every record; there are no defaults, because a
missing field would silently mean "the common case" for a page that is not the
common case.

**The four `format` fields are recorded drift, not design.** They exist
because the 22 committed pages were hand-maintained and disagree with each
other on whitespace, and Step 4 was not allowed to change a published byte.
Same for `bodyClass` (nine pages carry no `guide-page` class — a hook nothing
in `styles.css` or `app.js` reads) and `toast` (three pages have no toast
container). A later, separately approved step can normalize any of them: the
change is one edit here and one deleted branch in the template, for all 22
pages at once, which is the point of the migration.

## The committed pages

`guide/*.html` are generated output that happens to be committed — the same
standing `category/*.html` has had since Step 3C. The build's `copy` stage
stages every routed page from the repo root, then `src/build/guides.js`
overwrites all 22 in the staging root, so the published page is always the
rendered one. **Do not hand-edit them:** the edit is overwritten on the next
build, and `src/build/guide-template.test.js` will fail, because it diffs the
rendered page against the committed one byte for byte. Edit the content file
or the template instead.

## Related resources

`src/data/guide-resources.json` lists, per guide id, the bpozz tools and
libraries that put the guide into practice: one to three entries, each naming
a resource type from `resource-types.json` (its landing page) or one font
family (`/fonts/<id>`), with a short label and a note saying why it is there.
The template renders them as a block after previous/next and before the
related-guides rail; a guide with no entry gets no block. The list is curated
by hand, not matched by keyword — add an entry only where the guide's own text
connects to the destination. `/fonts/` lists, in reverse, the guides that link
it, from the same file.

The build fails on an unknown guide, type or font, a repeated destination, or
an href that is not a published route. The committed `guide/*.html` copies
change with it like any other template output (see above).

## Adding a guide

1. `content/guide/<slug>.html` — the six slots. Copy an existing file.
2. A record in `pages.json`.
3. A record in `guides.json` (that is what puts the guide in the grids).
4. The thumbnail, and the URL in `public/sitemap.xml`.
5. `npm run build` — it renders the page and fails if any of the above
   disagree. `docs/archive/_TEMPLATE.html` section 4 is the component
   catalog for the article body.
