# Step 7 — SEO / JSON-LD cleanup

Scope: JSON-LD, canonical URLs and SEO metadata. No URL, no route, no page
behaviour, and no rendered byte outside the structured-data region of `<head>`.
Search (Step 5), the content/schema architecture (Step 6), the shared `<head>`
frame (Step 8) and the accessibility work (Step 9) are untouched.

This step closes **F2** (one JSON-LD generation path), which
`src/build/guide-template.js` deferred at Step 4, and **D6** (`site.config.js`
`jsonLd` has no consumer), which the Step 6 handoff deferred as "JSON-LD work,
which this step is not".

## 1. The SEO surface as it was found

### Canonical URLs — already correct, and left alone

All 41 pages declare exactly one `<link rel="canonical">`. Forty of them are
`origin + route`. The one exception is deliberate and was verified rather than
"fixed":

| page          | route (file map) | canonical                   |
| ------------- | ---------------- | --------------------------- |
| `search.html` | `/search.html`   | `https://bpozz.com/search`  |

Every internal link on the site points at `/search` (the header's nav and its
search form's `action`), Netlify's Pretty URLs serves it, and the page is
`noindex, follow` and absent from `sitemap.xml`. The canonical matches the URL
the site actually publishes; the route table's `/search.html` is the file map.
Changing it would have contradicted 20 internal links.

`sitemap.xml` (40 URLs), `robots.txt` and `_redirects` were read and not
touched. The `WebSite` `SearchAction` on the homepage targets
`/search?s={search_term_string}`; `s` is the parameter `src/client/search.js`
actually reads, so it is correct.

### JSON-LD — three shapes across 22 guide pages (F2)

Guide JSON-LD was hand-written text inside `content/guide/<slug>.html`, one
copy per page:

| pages | blocks                              | drift                                                                                             |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| 13    | `TechArticle`                       | no breadcrumb trail; `mainEntityOfPage` a bare string; `inLanguage`; no article metadata            |
| 6     | `TechArticle` + `BreadcrumbList`    | `mainEntityOfPage` a `WebPage` node; `articleSection`/`proficiencyLevel`/`timeRequired`; no `inLanguage` |
| 3     | `BreadcrumbList` + `Article`        | opposite order; plain `Article`; none of the article metadata                                       |

Three further defects cut across those shapes:

- **19 pages pointed `image` at `/thumbnail_image/…`, a directory that has
  never existed.** The published one is `/thumbnail_image_webp/`. Two
  different wrong spellings were in use (`<slug>-thumbnail.png` and
  `<Title>_thumbnail.png`).
- **URLs with raw spaces.** Six of those image URLs were named after their
  guide's title, so they carried unencoded spaces and commas — not valid URLs.
- **`description` disagreed with the page's own `<meta name="description">`
  on 3 pages**, and on one more only by an undecoded `&quot;`.

### JSON-LD — the origin written out four times (category pages)

Category pages were already generated, but by a literal object inside
`src/build/categories.js`'s page template with `https://bpozz.com` hard-coded
in four places — beside a `site.config.js` whose first field is the canonical
`origin`, documented as the one place that value lives.

### The orphaned config key (D6)

`site.config.js` `jsonLd: { guide: ["BreadcrumbList", "TechArticle"] }`
recorded the F3 decision and nothing read it. The pages shipped three shapes;
the config said one. Neither could contradict the other because they were
never compared.

## 2. What Step 7 changed

One rule: **structured data is derived, never authored.**

- **`src/build/structured-data.js` (new)** — the single JSON-LD generation
  path, for guide *and* category pages. Pure: no `fs`, no `ctx`, no config
  require, no origin literal of its own.
- **`site.config.js` `jsonLd.guide` is now read.** It names the blocks a guide
  page carries *and* their order, and a name the module cannot build fails the
  build. The decision can no longer drift from what ships.
- **`content/guide/pages.json`** gained `datePublished` / `dateModified`. They
  are the one fact in the old JSON-LD with no other source in the model; every
  other field derives from `guides.json` or `categories.json`. They are
  validated as ISO dates at load.
- **`content/guide/*.html`** — the `HEAD_STRUCTURED_DATA` slot no longer holds
  JSON-LD. It keeps its name and position and now carries only what a page
  puts *after* its structured data: three pages have such a note, nineteen are
  empty.
- **`src/build/content.js`** composes each page's JSON-LD in `load()` and
  attaches it as `page.structuredData`. Its `description` is lifted from the
  page's own `<meta name="description">` (entities decoded), so the two are
  the same bytes and cannot drift.
- **`src/build/guide-template.js`** splices `page.structuredData`. The 18
  shared frame constants and the six-slot content format are byte-identical —
  Step 8's `<head>` frame is untouched.
- **`src/build/categories.js`** calls the shared module and takes `origin`
  from `ctx.config`.

### The resulting shape, on all 22 guide pages

`BreadcrumbList` (Home → Guides → category → this guide) then `TechArticle`
with `headline`, `description`, `image`, `author`, `publisher`,
`mainEntityOfPage`, `datePublished`, `dateModified`, `articleSection`,
`proficiencyLevel`, `timeRequired`, `inLanguage`.

It is the **union** of the three old shapes, so no page lost a field: 13 pages
gained a breadcrumb trail, 3 gained `TechArticle` in place of a plain
`Article`, and 16 gained the article metadata the other 6 already had.

## 3. What was deliberately NOT changed

- **`og:image` / `twitter:image` on 13 guide pages still 404** under
  `/thumbnail_image/`. Fixing them is not mechanical: the pages declare
  `og:image:width 1200` / `og:image:height 630`, which only `/og-image.png`
  satisfies (the real thumbnails are 1536×1024), and 13 of the 22 thumbnails
  are `.webp`, which X/Twitter will not render on a card. Either fix also
  needs the per-page `og:image:alt` rewritten, because it describes the
  guide-specific illustration. That is an editorial and platform-compatibility
  decision, not a cleanup. See "Remaining" below.
- **`og:description` differs from `<meta name="description">` on 15 pages.**
  Social copy tuned differently from SERP copy is legitimate, and
  reconciling it means choosing wording.
- **`guides.json` `description` differs from 8 pages' meta description.**
  `guides.json` is a published endpoint; changing it changes deployed bytes
  and `content-index.json`.
- **`about/contact/privacy/terms` carry no JSON-LD.** Adding schema is not
  cleanup.
- **Home, guides, palettes and roadmap JSON-LD stays hand-authored** in the
  committed HTML. Generating it means generating those pages' whole `<head>`,
  which is Step 8.
- **`docs/archive/_TEMPLATE.html`** still contains `{{PLACEHOLDER}}` JSON-LD.
  It is archived and builds nothing, but anyone copying it would reintroduce
  hand-authored JSON-LD. Flagged, not edited.
- **One pre-existing non-SEO drift was preserved:** the committed
  `guide/color-contrast-systems.html` carries the raw header partial rather
  than the patched one. The committed pages were refreshed *through the
  template with each page's own header/footer regions*, so that drift survives
  untouched rather than being silently "fixed" by this step.

## 4. Gates

`npm run qa` and `npm test` are green. Two approvals were recorded, both by
their documented explicit commands, and both reviewed before recording:

- `BPOZZ_APPROVE_OUTPUT=1 npm run build` — 32 of 91 output files changed
  (22 guide + 10 category pages), 0 added, 0 removed.
- `BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline` — 32 of 41 HTML
  checksums moved. **`baseline/url-snapshot.json` was re-recorded
  byte-identical**, which is the proof that no URL and no canonical moved.

`check-urls.js` was run against the *pre-Step-7* baseline before the baseline
was re-recorded: 89 URLs before and after, allowlist empty and unused, every
surviving page canonical unchanged.

`src/build/structured-data.test.js` (new, 12 tests) asserts what the two
byte-level gates cannot: that the generated data still agrees with the model.
Every URL it emits must resolve to a route or a published file — the assertion
that would have caught `/thumbnail_image/` the day it was written.

## 5. Remaining Step 7 issues

1. **13 guide pages have a social image that 404s.** Recommended fix, needing
   approval because it is an editorial choice: set `og:image` /
   `twitter:image` to `/og-image.png` (matches the already-declared 1200×630,
   and what the other 28 pages use) and replace the per-page `og:image:alt`
   with the generic site one. The alternative — per-guide thumbnails — needs
   the declared dimensions changed and breaks Twitter cards for the 13 `.webp`
   thumbnails.
2. **`category/spacing.html`'s `og:image` carries an unencoded space**
   (`/assets/Spacing & Layout.png`). The file exists and crawlers tolerate it;
   percent-encoding it is a one-line change in `categories.js` whenever social
   metadata is next opened.
3. **`guides.json` still carries both `category` and `categories`** (D5 from
   Step 6), unchanged for the same reason: it is a published endpoint.
