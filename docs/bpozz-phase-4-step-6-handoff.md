# Step 6 — content / schema cleanup

Scope: the content model, its schema rules and the content-loading structure.
No URL, no rendered byte, no page behaviour. Search (Step 5), the shared
`<head>`, the accessibility work and the UI are untouched.

## 1. The content/schema flow as it was found

### Sources

Declared in one place already — `site.config.js` → `paths.content`:

| path                          | what it holds                                       |
| ----------------------------- | --------------------------------------------------- |
| `guides.json`                 | 22 guide records                                     |
| `palettes/palettes-data.json` | 300 palettes (colours, names, likes, createdAt)      |
| `palettes/palettes-meta.json` | 40 palette metadata entries, p001–p040               |
| `categories.json`             | 10 categories                                        |
| `resource-types.json`         | 2 resource types (guide, palette)                    |
| `content/guide/`              | `pages.json` + 22 content files, six slots each      |

### Loader

`src/build/content.js` `load(config)` returns one normalized model:

    { guides, guidePages, palettes, categories, resourceTypes, warnings }

`palette.meta` is attached non-enumerably at load time, which is what makes
the F9 filter in `site.config.js` select exactly p001–p040 without writing a
field into `palettes-data.json`.

### Consumers

    routes.js       model.guides, model.categories            -> the 41-route table
    content.js      model.guides, model.categories,           -> content-index.json
                    model.palettes + config.contentIndex         (62 records)
    home.js         model.guides, model.categories,           -> index.html,
                    model.resourceTypes, ctx.contentIndex        guides/index.html,
                                                                 roadmap.html
    categories.js   model.guides, model.categories,           -> category/*.html
                    ctx.contentIndex
    guides.js       model.guidePages                          -> guide/*.html
    header.js       resource-types.json, READ FROM DISK       -> the nav region

`ctx.contentIndex` is the index the `data` stage generates, not the committed
copy at the repo root.

## 2. Duplication and inconsistency found

**D1 — `resource-types.json` was loaded twice, from two readers, with two
divergent validators.**
`content.js` read it into `model.resourceTypes` with a bare `JSON.parse` and
no checks at all. `home.js` `loadResourceTypes()` validated the array, the
`type` slug, duplicate types, `label`, the whole `home` block and
`landingUrl`. `header.js` `loadNavEntries()` **re-read the same file off disk**
and validated the array, the `type` slug, duplicate types, `nav`, `label`,
`landingUrl` and `activePaths`.

Neither validator checked what the other did: a malformed `home.limit` was
caught only if the home builder ran, a malformed `activePaths` only if the
header ran, and `nav` was never checked by home while `home` was never checked
by header. It also contradicted `content.js`'s own stated rule — "this is the
only module in the build that reads content off disk".

**D2 — the categories.json schema was validated three times.**
`categories.js` `loadCategoryData()`, `home.js` `loadCategoryLabels()` and
`home.js` `loadGuideCategories()` each carried their own copy of the same
three rules (is it an array, is `slug` a lowercase slug, is `name` a non-empty
string), with three separately worded error messages. None of them checked for
a duplicate slug, which would have silently collapsed a category page.

**D3 — `TYPE_BADGE_LABEL` was defined twice.**
`{ guide: "Guide", palette: "Palette" }` appeared verbatim in `categories.js`
and in `home.js`, each with a comment asserting it matched the other. It is
content-index vocabulary: it is keyed by the `type` field `content.js` itself
writes onto every record.

**D4 — `tagsMetaFor()` was defined twice, and the two copies disagreed.**
Byte-identical bodies in `categories.js` and `home.js` apart from the guard:
categories tested `!record.tags`, home tested `!Array.isArray(record.tags)`.
Identical output for every real record, different failure modes for a
malformed one.

**D5 — `guides.json` carries both `category` and `categories`.**
All 22 records have `categories === [category]`. `content.js`
`normalizeCategories()` prefers the array; every other consumer reads the
string. The array is therefore a redundant second representation of the same
fact.

**Not changed, and why.** `guides.json` is a published endpoint
(`/guides.json`) and `verify` hashes it, so dropping the field would change
deployed bytes — out of scope for a step that must preserve rendered output.
It is recorded here as the next content-data change to approve, not fixed.

**D6 — `site.config.js` `jsonLd: { guide: [...] }` has no consumer.**
It records the F3 decision and nothing reads it. Left exactly as-is: touching
it is JSON-LD work, which this step is not.

## 3. What Step 6 changed

One rule, applied once, in the loader:

> A rule is a **schema** rule if it can be answered from the content file
> alone. A rule that needs the built site ("does this `landingUrl` resolve to
> a page that exists?") or a consumer's own capabilities ("is this `sort` one
> `home.js` implements?") is a **consumer** check and stays with its consumer.

- `src/build/content.js` gained `validateGuides()`, `validateCategories()` and
  `validateResourceTypes()`, all called from `load()`, plus the single
  definition of `TYPE_BADGE_LABEL` and `tagsMetaFor()`.
- `src/build/header.js` no longer reads `resource-types.json` off disk. It
  takes `ctx.model.resourceTypes` and keeps only the landing-URL resolution
  check, which needs the staging root.
- `src/build/home.js` and `src/build/categories.js` keep their public module
  exports unchanged; the duplicated definitions are re-exported from
  `content.js` instead of being declared again.

`content.js` is now what its own header always claimed: the only module in the
build that reads content off disk, and the only place the content schema is
stated.
