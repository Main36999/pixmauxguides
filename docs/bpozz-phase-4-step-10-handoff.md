# Step 10 — Color Library

**Status: implemented, gated, verified in a browser.**

A new `/colors` page: ~300 individually named colours, one per card, with a
category filter and one-click HEX copy. Additive throughout — no existing
page was redesigned, no existing feature was modified, and `/palettes` is
untouched.

---

## 1. Files added

| file | what it is |
|---|---|
| `colors/index.html` | the page. Hand-authored static HTML, like `palettes/index.html`, patched by the header and footer builders. |
| `colors/colors-data.json` | **the single source of truth.** 300 records, `{ id, name, hex, category }`. |
| `src/client/colors.js` | page client: renders the grid, builds the filter row, copies HEX. Published to `/colors/colors.js`. |
| `src/styles/colors.css` | page stylesheet. Published to `/colors/colors.css`. |
| `src/build/colors-data.test.js` | the data contract, in `npm test`. |
| `docs/archive/generate-colors.js` | the one-off generator that produced the data, archived beside `generate-palettes.js`. |
| `docs/bpozz-phase-4-step-10-handoff.md` | this file. |

## 2. Files modified

| file | change |
|---|---|
| `src/build/routes.js` | `colors/index.html` added to `SECTION_INDEX_PAGES`. No new route *shape* — `urlFor()` already maps `<dir>/index.html` → `/<dir>`. |
| `site.config.js` | `paths.content.colors`; new `colors` contract block; `expected.htmlPages` 41 → 42, `expected.sitemapUrls` 40 → 41. |
| `src/build/content.js` | `validateColors()` added to the schema section; the file is loaded in `load()` and arrives as `model.colors`. |
| `src/build/build.js` | three `PUBLISH_FILES` entries; the `load` stage asserts the colour count and id range. |
| `src/build/header.js` | `MAIN_HEADER_NAV` gains `{ label: "Colors", landingUrl: "/colors" }`. |
| `partials/header.html`, `partials/header-home.html` | the same link in all four `NAV_RESOURCES` regions, so neither partial is reported stale. |
| `resource-types.json` | a `color` entry: `nav: true`, `activePaths: ["colors/"]`, **`home: null`**. |
| `public/sitemap.xml` | one `<url>` for `https://bpozz.com/colors`. |
| `scripts/qa/snapshot.js` | `/colors/colors-data.json` added to `DATA_ENDPOINTS`. |
| `scripts/qa/check-urls.js` | the addition side of the allowlist made to work — see §9. |
| `scripts/qa/baseline/*` | re-recorded: 104 URLs, 42 pages. `README.md` records the delta. |
| `scripts/qa/approved-output.json` | re-recorded: 106 files. |
| `src/build/head.test.js` | a test title that said "all 41" and an assertion that read the config disagreed; the title now matches the assertion. |
| `package.json` | `colors-data.test.js` added to `npm test`. |

**`home: null` is the load-bearing word in the `resource-types.json` row.**
It opts the type out of `src/build/home.js`'s homepage loop, which is why the
homepage gained no Colors section and its two existing sections are
unchanged.

## 3. New route

    /colors        served from colors/index.html

Nothing else moved. `/`, `/palettes`, `/guides`, `/search`, `/category/*`,
`/guide/*` are all present, at the same files, with the same canonicals —
asserted by `check-urls.js` ("every surviving page canonical unchanged") and
re-checked in the browser.

Three more public URLs come with it: `/colors/colors-data.json`,
`/colors/colors.css`, `/colors/colors.js`.

## 4. Data structure

```json
[
  { "id": "c001", "name": "Rosewood", "hex": "#9C6D6B", "category": "Red" },
  { "id": "c002", "name": "Clay Pink", "hex": "#B99896", "category": "Red" }
]
```

Exactly four fields — a test rejects a fifth, so an undocumented field
cannot become load-bearing by accident. HEX is normalised **uppercase**, six
digits, leading `#`; lowercase is rejected rather than corrected on the way
in, because this file is published verbatim and the committed bytes and the
served bytes must be the same.

**Where the colours came from.** Not invented. `palettes/palettes-data.json`
already holds 1,200 colour slots — 300 palettes × 4 — each with a
hand-written name, which is 1,197 distinct hexes under 952 distinct names,
all of it already shipping on `/palettes`. `docs/archive/generate-colors.js`
flattens that to `(hex, name)` pairs, drops repeats of either, categorises
each by HSL, and takes 25 per category. **`palettes-data.json` is not read
at build time by anything new and is not modified** — the gate still reports
it byte-identical to source, and the 300 palettes are still p001–p300.

**Growing it.** Raise `PER_CATEGORY` in the generator, re-run with
`--write`, and update `colors.count` in `site.config.js`. The renderer, the
filters and the tests are all driven by the file's length, so 300 → 500 →
1000+ changes no rendering architecture. Past ~1,197 the palette colours run
out and a second source is added to the generator's `sources()`; nothing
downstream cares where a pair came from.

## 5. Number of colours added

**300**, ids `c001`–`c300`, 25 in each of the twelve categories — Red,
Orange, Brown, Yellow, Green, Turquoise, Blue, Violet, Pink, White, Gray,
Black. 300 unique ids, 300 unique hexes, 300 unique names.

**One deviation from the brief, deliberate.** The supporting line is
*"Browse our library of 300 color names."*, not *"...more than 500..."* — the
brief asked for that sentence and for ~300 records, and shipping the claim
without the colours would put a false statement on a public page. The number
is filled in from the data by `src/client/colors.js`, so at 500 records the
line says 500 by itself and nobody has to remember. The HTML ships the
truthful 300 as its no-JS fallback. If the literal "more than 500" wording
is wanted anyway, it is one string in `colors/index.html` plus deleting the
six lines that update `#colors-intro`.

## 6. Copy interaction

The whole colour plate is the button, so the target is the large thing
rather than the small text. Click or tap or <kbd>Enter</kbd>:

1. `navigator.clipboard.writeText(hex)`;
2. on failure, a hidden-textarea `document.execCommand("copy")` fallback —
   the same two-step `src/client/palettes.js` already uses, transcribed
   rather than reinvented, so the interaction a visitor learned on
   `/palettes` behaves identically here;
3. on success, a **"✓ Copied" overlay inside the card**, which clears itself
   after 1.4 s. No modal, no popup. The site-wide toast is reserved for the
   failure case, where there is nothing to confirm inside the card;
4. and a screen-reader announcement, `"Copied #9C6D6B"`, into one polite
   live region for the whole page. The visual overlay is `aria-hidden`, so
   the announcement is the confirmation for assistive tech and not a
   duplicate of it.

The copied value is the full `#RRGGBB`. The plate's accessible name carries
both values — `"Copy #9C6D6B, Rosewood"` — because the name below the plate
is a separate element and a screen reader on the button alone would
otherwise hear a bare hex.

## 7. Category filter

Real `<button>`s, never links — nothing navigates, and a link would promise
a URL that does not exist. `aria-pressed` carries the selected state, which
is also shown by **inverting the chip** (dark fill, white label) rather than
by hue alone. One `role="group"` with `aria-label="Filter colors by
category"`. Client-side, no reload; the DOM is built once and filtering
toggles `[hidden]`, so it is instant at 300 cards and still instant at
1000+.

The chip set is **built from the data**, not hard-coded: a category that
appears in `colors-data.json` gets a chip, including one `CATEGORY_ORDER`
does not name (appended alphabetically), so new data can never be
unreachable. The dot on each chip is the most vivid colour that category
actually contains — a sample of the data rather than a second palette that
can drift from it.

A second live region announces the *result* ("Showing 25 colors in
Turquoise."), which no button can announce about itself. It fires only on a
real filter change, so a page load is not narrated.

## 8. Responsive grid

CSS Grid, `repeat(N, minmax(0, 1fr))` — `minmax(0, …)` rather than `1fr` is
what guarantees a long colour name shortens itself instead of widening its
column. No card position is hard-coded anywhere.

| width | columns | breakpoint |
|---|---|---|
| ≥ 960px | 4 | — |
| 460–959px | 2 | `max-width: 959px` |
| ≤ 459px | 1 | `max-width: 459px` |

The two breakpoint *values* are `/palettes`' own, not new numbers; only the
column counts differ, because one wide colour block needs fewer columns than
a four-strip palette plate. The plate is a fixed **aspect ratio** (5:2), not
a fixed height, so it keeps its proportions at every column count instead of
going letterbox on a phone.

## 9. A QA gate that was broken, and is not now

`scripts/qa/check-urls.js` has always documented `ALLOWED_ADDED` as the way
to approve a new URL. It had been empty since it was written, and Step 10 is
the first change to add one — which is how it was found that **populating it
could not pass.** The counts check reconciled approved *removals* and
nothing else, so every set diff would pass and then each affected bucket
would fail with `count CHANGED`.

Fixed by symmetry, not by loosening: `addedByKey` mirrors `removedByKey`, the
counts check is `baseline + approved additions − approved removals`, and a
new `allowlisted-but-ABSENT` failure mirrors the existing
`allowlisted-but-PRESENT` one so a stale entry cannot sit there as standing
permission for a future run. A page quietly added while another is quietly
removed still fails, which is the property that check exists for.

## 10. Tests run, and results

All commands run from the repository root. **Nothing below is claimed that
was not run.**

    npm test          63/63 pass   (was 43; +20 in colors-data.test.js)
    npm run build     ✓ dist/ built — 42 pages, 62 index records
                      verify: 106 files byte-identical to the approved output
    npm run qa        ✓ as approved — 42 pages, 5 data endpoints, 4 site
                        files, 46 assets, 7 code files
                      ✓ no URL added or removed — the allowlist is empty
                      ✓ every surviving page canonical unchanged
                      ✓ 42 pages byte-identical to the approved baseline
                      ✓ all baseline checks passed

`colors-data.test.js` covers both halves of the contract: the committed data
(count, id sequence, uniqueness of id/name/hex, uppercase six-digit hex,
exactly four fields, category vocabulary, no empty category), **and the
validator itself** — every rule is also fired at a deliberately broken
record, so a future edit that loosens `validateColors()` fails here rather
than silently stopping validating. It also holds the category vocabulary
together across its three declarations (`site.config.js`,
`src/client/colors.js`, the data), and asserts that the URL the page fetches
is the path `PUBLISH_FILES` publishes to.

### Browser verification

`dist/` served over HTTP and driven with Playwright (Chromium) —
**41/41 checks passed**:

- 4 / 2 / 1 columns at 1440 / 820 / 390 px; **zero** horizontal overflow at
  all three; card widths identical within a row (328/328/328/328 …)
- 300 cards; 13 chips; intro and count lines correct
- **worst HEX-label contrast across all 300 swatches: 4.59:1** (see §11)
- clicking a plate puts `#9C6D6B` on the clipboard; overlay reaches
  `opacity: 1`; live region reads `"Copied #9C6D6B"`; state clears itself
- filtering to Turquoise shows exactly 25, all of them Turquoise; exactly
  one chip `aria-pressed`; both the visible count and the live region update;
  "All" restores 300
- keyboard: chip focusable with a visible focus ring, <kbd>Enter</kbd>
  filters; plate focusable, <kbd>Enter</kbd> copies; accessible name matches
  `Copy #RRGGBB, <name>`
- skip link targets `#colors-content`
- nav reads `All | Colors | Color Palettes | UI/UX Guides`, with Colors
  `aria-current="page"` on `/colors`
- `/palettes/` still renders its 300 palettes; `/guides`, `/search.html`
  and `/` still load
- no console errors

## 11. Two things found in the browser that the gates could not see

Both were found by running the page, not by reading it, and both are fixed.

**The data fetch 404'd at `/colors`.** `fetch("./colors-data.json")` resolves
against the *site root* when the page is served without a trailing slash, so
it asked for `/colors-data.json` and the grid rendered empty. Now
site-root — `fetch("/colors/colors-data.json")` — which is also what the
rest of the page already does for its CSS and JS, for the reason
`src/build/head.js` gives about stylesheets. Verified at **both** `/colors`
and `/colors/`, and a test now rejects the relative form.

**The HEX label failed WCAG AA on real data.** The first version softened the
label to `rgba(0,0,0,0.78)`, which measured **3.83:1** on `#3876C8` — a blue
that is in the library. The label is now pure `#000` or `#FFF`, whichever
scores higher, which is not a tuned value but a *guarantee*: the two ratios
are `1.05/(L+0.05)` and `(L+0.05)/0.05`, they cross at `L ≈ 0.179` where both
are 4.58:1, so no colour that could ever be added can score below that.
Measured worst case across all 300: **4.59:1**.

## 12. Decisions recorded

**F10 — the 300 colours are deliberately NOT in `content-index.json`, and
`/colors` is not in the search index yet.** The content-index contract is 62
records (22 guides + 40 palettes), asserted in three places:
`site.config.js`, the build's `data` stage, and `check-baseline.js`, which
also fails any record whose `type` it does not know. Indexing 300 colours
means 362 records, a third record type, a third card renderer in
`src/client/search.js`, and a new `TYPE_LABELS` entry — a schema change to
the site's search contract, carried by a feature that did not ask for one.
The brief's §15 names this case exactly and says to document the decision
rather than force the change. So: **the architecture is ready and the
integration is not made.** `model.colors` is loaded, validated and available
to any future build stage; `content.js`'s record builders are the one place
a `buildColorRecords()` would go; the page's own URL is in the sitemap and
carries `CollectionPage` JSON-LD, so `/colors` is discoverable to crawlers
today. Whoever picks it up should decide first whether search wants 300 more
records or one record for the library.

**D1 — the nav link changes every page's checksum, and that was measured
rather than assumed.** All 41 pre-existing pages differ from the previous
baseline; the *entire* difference is two added
`<a href="/colors">Colors</a>` lines (desktop nav + mobile menu). Proven by
stripping those two lines from each rebuilt page and md5-ing the result
against the previous baseline: **41 of 41 matched exactly.**

**D2 — `src/client/palettes.js` has the same relative-fetch exposure that
§11 fixed here, and it was left alone.** `fetch("./palettes-data.json")` is
safe today only because the host redirects `/palettes` → `/palettes/`; served
without that redirect, the palettes grid renders empty (reproduced locally).
It is not fixed here because `palettes.js` is under a byte-identity gate and
"do not break or rewrite the existing Color Palettes feature" is the
strongest instruction in the brief. One line, whenever it is wanted.

**D3 — eleven `.webp` thumbnails were already in the working tree, and are
not this feature's.** They are the in-progress half of a PNG → WebP
conversion: the files exist and publish, but `guides.json` still points the
same eleven guides at their `.png` originals, so nothing links them. They
were blocking `npm run build` (not in the output manifest) and `npm run qa`
(not in the URL baseline) **before any Step 10 work**. They were named
explicitly in `ALLOWED_ADDED` rather than allowed to ride along inside a
count, and are now in the re-recorded baseline. **The conversion is not
finished here** — finishing it means updating eleven `thumbnail` values in
`guides.json` and deleting the `.png` files.

**D4 — no monospace anywhere.** The HEX is `var(--sans)` at weight 700 with
`font-variant-numeric: tabular-nums`, which gives the column alignment a
monospace face would have been reached for. `styles.css`'s `.mono` already
resolves to `var(--sans)`, so this follows the site rather than departing
from it.

## 13. Deliberately not built

Per §19 of the brief: no colour picker, no per-colour detail pages, no
RGB/HSL/OKLCH converters, no favourites, no auth, no database, no Firebase,
no infinite scroll, no pagination, no admin, no complex animation. The page
is 300 colours, a filter, a grid and a copy button.

`colors.js` is also **not** part of `/app.js`. That bundle is downloaded by
every page on the site; this is ~9 KB that only `/colors` runs. The palettes
feature made the same call for the same reason.

## 14. Remaining issues

1. **Search integration is not done** — by decision, F10 above. Read it
   before adding one.
2. **The PNG → WebP conversion is still half-finished** — D3. Pre-existing,
   untouched, and now recorded in the baseline rather than blocking it.
3. **`palettes.js`'s relative fetch** — D2. Pre-existing, host-dependent,
   deliberately not touched.
4. **The committed `category/*.html` files are stale relative to what
   `src/build/categories.js` generates** (`h3` vs `h2` card titles, among
   others). Pre-existing and harmless — those pages are written from scratch
   on every build, so the committed copies are never published — but it
   means a naive `diff` of a category page against `dist/` shows more than
   the nav link. Noted because it is confusing when first encountered.
5. **410 rules were not added for `/colors*`** — nothing was removed, so
   there is nothing to gone-tombstone.
