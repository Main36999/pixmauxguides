# BPOZZ — Phase 5 Handoff / Checkpoint

STATUS: COMPLETE (implemented, validated, packaged — **not committed, not pushed**)

Phase 5 scope was the approved information-architecture change in three
connected parts: **5A** homepage resource-section architecture, **5B**
type-first global header/navigation, and **5C** guide-category crawl path.
It starts from the verified Phase 4 baseline (`bpozz-web-phase-4.zip`,
HEAD `3691b08`, working tree exactly as described in
`bpozz-phase-4-handoff.md` §H) and is the authoritative baseline for
whatever comes next, the same way the Phase 4 handoff was for this phase.

Approved decisions implemented exactly:

1. Token/Palette distinction **1A** — Tokens section uses the existing
   `/tokens` "Popular" sort; Palettes section uses the existing `/palettes`
   "New" sort; twin exclusion applied before the limit.
2. Homepage copy — H1 `Design resources, documented like engineering
   blueprints.`; search placeholder `Search guides, tokens, palettes…`;
   search label `Search bpozz`. `<title>`, meta description, OG, Twitter
   and JSON-LD left unchanged.
3. Active state — Guides on Guide + Category pages; Tokens on Token pages;
   Palettes on Palette pages; Roadmap on Roadmap.
4. Footer category labels — full `name` values from `categories.json`.

No future resource type (Fonts, UI Kits, Wireframes, UI Components) was
built, registered, linked, or given placeholder content.

---

## A. Summary of Changes

### 5A — Homepage

- **`resource-types.json` (new)** — a small, flat registry of the three
  *shipped* resource types only: `guide`, `token`, `palette`. Array order
  is nav order. See §E.
- **`build-content-index.js`** — appends three OPTIONAL fields after
  `searchText`, each emitted only when the source data actually has it:
  - `colors` — tokens: hex values in canonical role order (background,
    surface, primary, secondary, accent, text, border); palettes: the 4
    stored hex values.
  - `date` — tokens: `created_at`; palettes: `createdAt`.
  - `popularity` — **tokens only** (`tokens.json` `popularity`, the value
    `/tokens`' own Popular sort uses). Palettes get none: their static
    `likes` are a seed; `/palettes`' Popular sort reads live Firebase.
  - Guides get none of the three. (This is slightly narrower than the
    audit's `colors: []` / `null` proposal, following the approval's
    "only where supported by existing project data" instruction.)
  - The original 10 fields of all 102 records are byte-identical in value
    and key order; `searchText` is unchanged.
- **`build-home.js`** — new registry-driven "resource sections" written
  between `<!--RESOURCE_SECTIONS_START-->` / `<!--RESOURCE_SECTIONS_END-->`:
  - One `<section class="resource-section">` per registry entry whose
    `home` is an object, in `home.order`. Guides' entry has `home: null`.
  - Sorts mirror the galleries' own client-side code exactly:
    `popular` = `tokens-gallery.js` `getSorted()`; `latest` =
    `palettes/palettes.js` `sortedList()` "new". Stable sort → ties keep
    index order.
  - **Twin exclusion before limit**: a record is skipped if the first four
    of its `colors` (lowercased) match a record already shown on the
    homepage — the same four-color key `build-content-index.js` uses to
    define a twin — then filling continues until `limit`.
  - Current output: `/ popular_tokens` = 10 of 40 (Faceted Onyx, Even
    Concrete, Weathered Meadow, Terracotta Grove, Blush Feather, Rewind
    Motel, Dusty Darkroom, Royal Ruby, Weathered Darkroom, Even Concrete
    (Dark)); `/ latest_palettes` = 10 of 40 (p001, p004–p012), with
    **2 twins skipped** (p002 Terracotta Grove, p003 Faceted Onyx).
  - Cards reuse `.guide-card` / `.card-thumb` / `.card-body` /
    `.card-title` / `.card-meta`. Token card: full role swatch row + name
    + Title-Cased tags → `/tokens/<slug>.html`. Palette card: 4 stacked
    bars + name → `/palettes#<id>`. Thumbnails `aria-hidden`. No buttons,
    likes, copy controls, Firebase, or new JS.
  - Colors are validated as `#rrggbb` before being written into inline
    styles (build fails otherwise). A type with zero records renders
    nothing. A type with no bespoke card falls back to a generic card.
  - The guide grid (`#grid-root`), Level filter, results count, empty
    state, roadmap generation, and `app.js` are untouched.
- **`index.html`** (static parts only) — marker pair added inside
  `<main id="guides">` after `#empty-state` (outside `#grid-root`);
  H1, hero search label/placeholder/submit `aria-label` updated as
  approved; skip-link text `Skip to guides` → `Skip to main content`
  (target unchanged, per the approved audit). `<head>` byte-identical.
- **`styles.css`** — additive block only: `.resource-section` spacing,
  `.resource-section__all` link, `.card-thumb--swatches` /
  `.card-thumb--bars`, and `.footer-nav--categories` font size.

### 5B — Global Header / Navigation

- **`partials/header.html`, `partials/header-home.html`** — in both the
  desktop `.site-nav` and the `#mobile-menu` nav, "All" and the 10 category
  links were removed and replaced by a generated
  `<!--NAV_RESOURCES_START-->…<!--NAV_RESOURCES_END-->` region followed by
  the static Roadmap link. Result on every page:
  **Guides · Tokens · Palettes · Roadmap**. Inner header search copy
  updated (`Search bpozz` label/button, new placeholder). Form `action`,
  `name="s"`, `#menu-toggle`, `#mobile-menu`, `aria-*`, CSS classes
  unchanged.
- **`build-header.js`** — before syncing pages it now:
  1. loads/validates `resource-types.json`;
  2. rewrites every NAV_RESOURCES region in both partial files (so the
     partials stay complete HTML for `build-categories.js` /
     `build-tokens.js`, which embed them verbatim);
  3. fails the build if a nav entry's `landingUrl` doesn't resolve to a
     real file (and `#fragment` id) — the guard against linking a future
     type before its destination exists.
  The hard-coded category/tokens/palettes active-state rules were replaced
  by an `activePaths` loop. Home/Roadmap rewrite logic unchanged.

### 5C — Guide Category Crawl Path

- **`partials/footer.html`** — second nav
  `<nav class="footer-nav footer-nav--categories" aria-label="Guide categories">`
  with a `<!--FOOTER_CATEGORIES_START-->…<!--FOOTER_CATEGORIES_END-->`
  region, below the existing footer nav (which is unchanged).
- **`build-footer.js`** — fills that region from `categories.json`
  (sorted by `order`, full `name`, `/category/<slug>`), emitting a link
  only if `category/<slug>.html` exists; then syncs pages as before.
- Result: all 10 category pages are linked from all 83 other site pages.
  Before Phase 5, outside the header only 5 categories had any internal
  link (homepage trending strip); Adobe XD, Mobile, Web, Systems and
  Motion had none.

---

## B. Files Changed

### B.1 Phase 5 source files (hand-edited)

| File | Phase 5 change (vs Phase 4 baseline) | Git state |
|---|---|---|
| `resource-types.json` | new registry (+26) | untracked (new in Phase 5) |
| `build-content-index.js` | optional `colors`/`date`/`popularity` (+104 −2) | untracked (pre-existing Phase 2 file) |
| `build-home.js` | resource sections (+312 −8) | modified |
| `build-header.js` | registry nav + active states (+177 −14) | modified |
| `build-footer.js` | category crawl row (+108 −0) | modified |
| `index.html` | static copy + section markers (generated regions also rebuilt) | modified |
| `styles.css` | additive Phase 5 block (+51 −0) | modified |
| `partials/header.html` | type-first nav regions + search copy (+9 −25) | modified |
| `partials/header-home.html` | type-first nav regions (+6 −22) | modified |
| `partials/footer.html` | category nav region (+14 −0) | modified |

The generated regions inside the three partials are written by
`build-header.js` / `build-footer.js`; the surrounding markup is source.

### B.2 Phase 5 generated files (written only by build scripts)

- `content-index.json` — regenerated (+772 −80 vs Phase 4; all original
  fields identical, optional fields appended). Untracked (pre-existing
  Phase 2 file).
- `index.html` — `RESOURCE_SECTIONS` region (new), plus header/footer
  blocks. (`GUIDES_GRID` / `RESULTS_COUNT` regions regenerated identically.)
- **83 HTML pages changed only inside `HEADER_START/END` and
  `FOOTER_START/END` blocks** (verified: with those blocks stripped, every
  one is byte-identical to Phase 4). Each is +23 −25 vs Phase 4:
  - `about.html`, `contact.html`, `privacy.html`, `terms.html`,
    `roadmap.html`, `search.html`, `palettes/index.html`
  - `category/*.html` (10)
  - `guide/*.html` (23, including `guide/_TEMPLATE.html`)
  - `tokens/*.html` (43: 40 detail pages + `index.html`, `create.html`,
    `collection.html`)

Total vs the Phase 4 baseline tree: 93 existing files changed + 1 new
source file (`resource-types.json`) + this handoff.

### B.3 Pre-existing changes from before Phase 5 (Phase 1–4 working tree)

These were already uncommitted in the Phase 4 baseline (`git status`
there, exactly):

```
 M build-categories.js
 M category/color-theory.html
 M category/systems.html
 M guides.json
 M palettes/palettes.css
 M palettes/palettes.js
 M search.html
?? bpozz-phase-1-handoff.md
?? bpozz-phase-2-handoff.md
?? bpozz-phase-3-handoff.md
?? bpozz-phase-4-handoff.md
?? build-content-index.js
?? categories.json
?? content-index.json
```

| Pre-existing path | Touched by Phase 5? |
|---|---|
| `build-categories.js` | **No** — byte-identical to Phase 4 |
| `guides.json` | **No** |
| `palettes/palettes.css` | **No** |
| `palettes/palettes.js` | **No** |
| `categories.json` | **No** |
| `bpozz-phase-1…4-handoff.md` | **No** |
| `category/color-theory.html` | Header/footer blocks only (+23 −25); Phase 4 body/rails byte-identical |
| `category/systems.html` | Header/footer blocks only (+23 −25); Phase 4 body/rails byte-identical |
| `search.html` | Header/footer blocks only (+23 −25); Phase 3 body byte-identical |
| `build-content-index.js` | Yes — source change in B.1 |
| `content-index.json` | Yes — regenerated, B.2 |

So in `git diff --stat` (§J), the counts for `build-categories.js` (142),
`guides.json` (66), `palettes/palettes.css` (10), `palettes/palettes.js`
(23) are entirely pre-Phase-5; `category/color-theory.html` and
`category/systems.html` (49 each) are 1 line Phase 4 + 48 Phase 5;
`search.html` (728) is Phase 3 plus 48 Phase 5 header/footer lines.

---

## C. Files Intentionally Unchanged

`app.js`, `build-categories.js`, `build-tokens.js`,
`scripts/generate-palettes.js`, `guides.json`, `tokens.json`,
`palettes/palettes-data.json`, `categories.json`, `palettes/palettes.js`,
`palettes/palettes.css`, all `tokens-*.js`, `tokens.css`,
`guide-article.css`, `sitemap.xml`, `_redirects`, `_headers`, `_htaccess`,
`robots.txt`, `ads.txt`, `bpozz-search-demo.html`, all assets/images,
Phase 1–4 handoffs. Search logic (`search.html` body) and category-page
bodies (Phase 4 rails) are byte-identical. No Firebase, Cookiebot or
analytics change.

---

## D. Architecture Decisions

1. **Resource Type → Collection → Resource Cards.** Types are the primary
   axis (registry, nav, homepage sections); guide categories are a
   secondary discovery mechanism for Guides only (footer row, trending
   strip, category pages, Search category filter). `tokens`/`palettes` are
   not category slugs.
2. **Registry `type` uses the singular `content-index.json` values**
   (`guide`/`token`/`palette`), with plural `label`s.
3. **Guides are the transitional exception.** The full interactive guide
   grid stays on the homepage (`home: null`), and "Guides" links to
   `/#guides` (the only real destination; also `app.js`'s legacy redirect
   fallback). No Guides landing page was created.
4. **Sections are build-time only and sit outside `#grid-root`** (which
   `app.js` overwrites), inside `<main id="guides">` so they're in the main
   landmark and hidden with `#home-view` on legacy hash routes.
5. **Sorts mirror each gallery's own code**, so a homepage section shows
   exactly what that gallery shows first for that sort.
6. **Twin exclusion uses the index builder's own twin definition**
   (background/surface/primary/secondary colors), applied before `limit`.
7. **Generated regions are written into the partials themselves**, so
   scripts that embed partials verbatim never emit placeholders.
8. **Guards over conventions**: invalid registry values, a nav destination
   that doesn't exist, or a malformed color fail the build.
9. **No new build orchestrator, no package.json, no new dependencies.**

---

## E. Registry Reference (`resource-types.json`)

```json
[
  { "type": "guide",   "label": "Guides",   "landingUrl": "/#guides",  "nav": true,
    "activePaths": ["guide/", "category/"], "home": null },
  { "type": "token",   "label": "Tokens",   "landingUrl": "/tokens",   "nav": true,
    "activePaths": ["tokens/"],   "home": { "order": 1, "limit": 10, "sort": "popular" } },
  { "type": "palette", "label": "Palettes", "landingUrl": "/palettes", "nav": true,
    "activePaths": ["palettes/"], "home": { "order": 2, "limit": 10, "sort": "latest" } }
]
```

| Field | Read by | Meaning |
|---|---|---|
| `type` | both | must equal `content-index.json` `type`; lowercase slug; unique |
| `label` | both | nav text; section label words; "View all" aria-label |
| `landingUrl` | both | nav href; "View all" href; must resolve to a real page if `nav: true` |
| `nav` | build-header | include in primary nav (array order) |
| `activePaths` | build-header | page path prefixes that mark this link `aria-current="page"` |
| `home` | build-home | `null` = no generated section; else `{order, limit, sort}` with `sort` ∈ `popular`, `latest` |

**When a future type actually ships** (not before): add its records to
`content-index.json` via `build-content-index.js`, add one registry entry
once its landing page exists, optionally add a bespoke card renderer in
`build-home.js` (`CARD_RENDERERS`), and add its tab to `search.html`
(Search does not read the registry — see §I).

---

## F. Build Commands & Reproducibility

Run from the project root, in this order (validated on
Node v22.22.2; no install step):

```
node build-content-index.js   # guides.json + tokens.json + palettes-data.json + categories.json → content-index.json
node build-home.js            # guides.json + content-index.json + resource-types.json → index.html, roadmap.html
node build-categories.js      # (unchanged) → category/*.html
node build-tokens.js          # (unchanged) → tokens/*.html
node build-header.js          # resource-types.json → partial nav regions → header block on 84 pages
node build-footer.js          # categories.json → partial footer region → footer block on 84 pages
node --test tokens-a11y.test.js
```

- `build-header.js` and `build-footer.js` must run **after**
  `build-categories.js` and `build-tokens.js` (those rewrite pages from the
  raw partials, resetting `aria-current`; pre-existing requirement).
- `build-home.js` needs a current `content-index.json`.
- `scripts/generate-palettes.js` is a one-time seed generator and is not
  part of the rebuild.
- Expected non-fatal warning (pre-existing): `bpozz-search-demo.html`
  skipped by header/footer sync (no markers).
- Do not hand-edit inside `RESOURCE_SECTIONS`, `NAV_RESOURCES`,
  `FOOTER_CATEGORIES`, `GUIDES_GRID`, `HEADER`, or `FOOTER` marker regions.
- The Netlify note in `build-home.js` (build command `node build-home.js`)
  still works because generated files are committed; if the host is meant
  to regenerate, use the full sequence above.

**Reproducibility verified:** a second full run produced SHA-256-identical
output for all 161 files; a clean-room rebuild (Phase 4 baseline + Phase 5
source edits only, with all generated regions emptied and
`content-index.json` deleted) regenerated a tree byte-identical to the
delivered one.

---

## G. Validation Results & Tests

All validation used scratch tooling outside the repository (jsdom harness,
Python checks, headless Chromium); none of it was added to the project.

| Area | Result |
|---|---|
| Full build pipeline | exit 0 |
| Second run SHA-256 (161 files) | identical |
| Clean-room regeneration | byte-identical to delivered tree |
| Existing tests `node --test tokens-a11y.test.js` | **16 passed, 0 failed, 0 skipped** |
| Phase 3 search checks (baseline and Phase 5) | **16/16** on both, identical observations |
| Phase 3 deep compare (12 queries × 6 filters, full rendered result lists) | **72/72** identical |
| Phase 4 category pages | all 10 bodies byte-identical; rails 10+10 on color-theory & systems, none elsewhere; guide/token/palette links resolve; `aria-current` now on Guides |
| Homepage + header behavior (jsdom, real `app.js`) | **34/34** |
| Static HTML/data/link/crawl checks | **21/21** |
| Registry guard tests (throwaway copy) | all behaved as designed |
| Headless Chromium render | no page errors; nav fits; cards render in existing style |

**Phase 3 checks** — `color` 85 results with the two required guides
first; `starless frost` 6 (token, then twin palette); `night` 24 (12 tokens,
12 palettes); `Amber Arcade` token + palette; `Color Theory` 85, guide
first; `color token` both-term guide first; `xyznotreal123` generic empty
state; `type=token` 40 tokens only and "All" tab restores/removes `type`;
`category=spacing` 0; invalid filters fall back; category select = All +
10 in order; no-query landing; XSS query rendered as text; no console
errors.

**Homepage/header checks** — 22 guide cards rendered by `app.js`; guide
links resolve; Level filter beginner 6 / intermediate 13 / advanced 3 with
correct counts; reset restores 22; Level filter does not affect resource
sections; sections survive `app.js` render byte-identically and sit outside
`#grid-root`; one section per `home` entry in order, none for guides;
headings/counts/"View all" correct; no buttons/forms/likes in cards;
thumbnails `aria-hidden`; Tokens section equals the real `/tokens` gallery
Popular top 10 in order; Palettes section equals the real `/palettes` New
order minus twins, filled to 10 (2 skipped); palette ids exist; no title or
swatch set appears twice; approved hero copy; hero search global
(`/search`, `s`); no homepage console errors; mobile menu open / Escape /
link-click close with links Guides, Tokens, Palettes, Roadmap on the
homepage and a guide page; `/#guides` keeps the home view.

**Static checks** — 84 marked pages; every page's desktop and mobile nav is
exactly Guides/Tokens/Palettes/Roadmap with correct `aria-current`; no
category or "All" links in any header; inner-header search form intact;
all other header markup identical to Phase 4; both partials have 2 nav
regions; every page's footer has the 10 category links (full names, in
order) and the original footer nav unchanged; every category page has
inbound links from 83 other pages; no new tag-balance problems; no
duplicate ids; generated sections well-formed; no new broken internal
links/assets (0 before, 0 after); every header/footer link resolves; all
JSON parses; registry = exactly the 3 shipped types; `content-index.json`
original fields identical; optional fields match source data exactly
(guides none, palettes no popularity); every palette's colors equal its
twin token's `colors[0:4]`; `searchText` unchanged; zero new
Fonts/UI Kits/Wireframes/UI Components strings anywhere; `index.html`
`<head>` byte-identical.

**Guard tests** (run on a throwaway copy, then deleted):
palette `limit: 4` → 4 cards; swapped `order` → palettes first, tokens
twin-excluded; palette `home: null` → tokens section only; a registered
type with 0 records → section omitted; palette `nav: false` → nav
Guides/Tokens only; errors raised as intended:
- `Error: resource-types.json[3].landingUrl "/fonts" does not resolve to an existing page — only list a resource type in the nav once its destination exists.`
- `Error: resource-types.json[1].home.sort must be one of: popular, latest`
- `Error: content-index record "token:faceted-onyx" has an invalid color value: "red;background:url(x)"`

---

## H. Known Limitations

- `/ latest_palettes` is "newest palettes not already represented in the
  Tokens section", not strictly the 10 newest (p002, p003 skipped today).
- Token `popularity` is the static value in `tokens.json`; live palette
  likes (Firebase) are not reflected on the homepage by design.
- The header no longer highlights the specific category on a category
  page; Guides is highlighted instead (approved).
- One-click category access moved from header to footer; the homepage
  trending strip still shows 5 categories; Search keeps its category filter.
- The footer category row wraps to two lines at 1440px desktop width.
- Mobile layout was verified behaviorally (jsdom); the mobile screenshot
  was not visually reviewed.
- "Latest" ordering depends on `date` string comparison (`YYYY-MM-DD`),
  mirroring the galleries; ties keep file order.
- Search type tabs and Phase 4 category rails remain hard-coded to the
  three current types.

## I. Deferred (intentionally not done)

- A dedicated Guides landing page (Guides remain the homepage grid).
- Registry adoption in `search.html` (type tabs/labels) and
  `build-categories.js` (rails, badge labels, zero-guide skip rule).
- De-duplicating `CATEGORIES`/`THUMBS`/card markup across `app.js`,
  `build-home.js`, `build-categories.js`.
- Pre-existing items left alone: `bpozz-search-demo.html` has no
  header/footer markers; dead `data-jump-category` handler in `app.js`;
  both header navs share `aria-label="Primary"`; `<title>`/meta still
  guide-focused (approved to keep).
- Any Fonts, UI Kits, Wireframes, UI Components work.

---

## J. Git Status / Diff (exact, captured on the delivered tree)

Nothing staged (`git diff --cached --name-only` is empty), no stash, HEAD
`3691b08283c2cef0c30daddc4f3b970126160703` ("update palette") — the same
commit as the Phase 4 baseline. `Your branch is up to date with
'origin/main'` reflects stored refs only; no fetch or push was run.

### `git status`

```
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   about.html
	modified:   build-categories.js
	modified:   build-footer.js
	modified:   build-header.js
	modified:   build-home.js
	modified:   category/accessibility.html
	modified:   category/adobe-xd.html
	modified:   category/color-theory.html
	modified:   category/figma.html
	modified:   category/mobile.html
	modified:   category/motion.html
	modified:   category/spacing.html
	modified:   category/systems.html
	modified:   category/typography.html
	modified:   category/web.html
	modified:   contact.html
	modified:   guide/_TEMPLATE.html
	modified:   guide/accessibility-structural-model.html
	modified:   guide/auto-layout-constraint-model.html
	modified:   guide/color-contrast-systems.html
	modified:   guide/color-palette-token-system.html
	modified:   guide/components-variants-contract.html
	modified:   guide/css-grid-two-dimensional-system.html
	modified:   guide/dark-mode-second-palette.html
	modified:   guide/design-tokens-naming-system.html
	modified:   guide/figma-to-code-handoff.html
	modified:   guide/figma-variables-data-layer.html
	modified:   guide/font-pairing-hierarchy-decision.html
	modified:   guide/grid-systems-rhythm.html
	modified:   guide/ios-android-different-systems.html
	modified:   guide/line-length-reading-constraint.html
	modified:   guide/migrating-from-xd-rebuild.html
	modified:   guide/mobile-breakpoints-device-categories.html
	modified:   guide/motion-timing-model.html
	modified:   guide/padding-margin-different-jobs.html
	modified:   guide/responsive-layout-contract.html
	modified:   guide/thumb-zones-layout-constraint.html
	modified:   guide/type-scale-systems.html
	modified:   guide/whitespace-as-ui-component.html
	modified:   guides.json
	modified:   index.html
	modified:   palettes/index.html
	modified:   palettes/palettes.css
	modified:   palettes/palettes.js
	modified:   partials/footer.html
	modified:   partials/header-home.html
	modified:   partials/header.html
	modified:   privacy.html
	modified:   roadmap.html
	modified:   search.html
	modified:   styles.css
	modified:   terms.html
	modified:   tokens/amber-arcade.html
	modified:   tokens/analog-lounge.html
	modified:   tokens/bare-ledger-dark.html
	modified:   tokens/bare-ledger.html
	modified:   tokens/blank-concrete-dark.html
	modified:   tokens/blank-concrete.html
	modified:   tokens/blush-feather-dark.html
	modified:   tokens/blush-feather.html
	modified:   tokens/chalk-petal-dark.html
	modified:   tokens/chalk-petal.html
	modified:   tokens/collection.html
	modified:   tokens/create.html
	modified:   tokens/dusty-darkroom.html
	modified:   tokens/electric-broadcast.html
	modified:   tokens/even-concrete-dark.html
	modified:   tokens/even-concrete.html
	modified:   tokens/faceted-jade.html
	modified:   tokens/faceted-onyx.html
	modified:   tokens/index.html
	modified:   tokens/laser-static.html
	modified:   tokens/lunar-harbor.html
	modified:   tokens/milky-sorbet-dark.html
	modified:   tokens/milky-sorbet.html
	modified:   tokens/neon-pulse.html
	modified:   tokens/old-world-darkroom.html
	modified:   tokens/powder-sorbet-dark.html
	modified:   tokens/powder-sorbet.html
	modified:   tokens/radioactive-broadcast.html
	modified:   tokens/retro-lounge.html
	modified:   tokens/rewind-motel.html
	modified:   tokens/rich-sapphire.html
	modified:   tokens/royal-ruby.html
	modified:   tokens/starless-frost.html
	modified:   tokens/starless-observatory.html
	modified:   tokens/starless-tide.html
	modified:   tokens/studio-ledger-dark.html
	modified:   tokens/studio-ledger.html
	modified:   tokens/sun-baked-canyon.html
	modified:   tokens/terracotta-grove.html
	modified:   tokens/terracotta-riverbank.html
	modified:   tokens/weathered-darkroom.html
	modified:   tokens/weathered-meadow.html
	modified:   tokens/worn-darkroom.html

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	bpozz-phase-1-handoff.md
	bpozz-phase-2-handoff.md
	bpozz-phase-3-handoff.md
	bpozz-phase-4-handoff.md
	bpozz-phase-5-handoff.md
	build-content-index.js
	categories.json
	content-index.json
	resource-types.json

no changes added to commit (use "git add" and/or "git commit -a")
```

### `git diff --stat`

```
 about.html                                      |  48 +-
 build-categories.js                             | 142 ++++-
 build-footer.js                                 | 108 ++++
 build-header.js                                 | 191 ++++++-
 build-home.js                                   | 320 ++++++++++-
 category/accessibility.html                     |  48 +-
 category/adobe-xd.html                          |  48 +-
 category/color-theory.html                      |  49 +-
 category/figma.html                             |  48 +-
 category/mobile.html                            |  48 +-
 category/motion.html                            |  48 +-
 category/spacing.html                           |  48 +-
 category/systems.html                           |  49 +-
 category/typography.html                        |  48 +-
 category/web.html                               |  48 +-
 contact.html                                    |  48 +-
 guide/_TEMPLATE.html                            |  48 +-
 guide/accessibility-structural-model.html       |  48 +-
 guide/auto-layout-constraint-model.html         |  48 +-
 guide/color-contrast-systems.html               |  48 +-
 guide/color-palette-token-system.html           |  48 +-
 guide/components-variants-contract.html         |  48 +-
 guide/css-grid-two-dimensional-system.html      |  48 +-
 guide/dark-mode-second-palette.html             |  48 +-
 guide/design-tokens-naming-system.html          |  48 +-
 guide/figma-to-code-handoff.html                |  48 +-
 guide/figma-variables-data-layer.html           |  48 +-
 guide/font-pairing-hierarchy-decision.html      |  48 +-
 guide/grid-systems-rhythm.html                  |  48 +-
 guide/ios-android-different-systems.html        |  48 +-
 guide/line-length-reading-constraint.html       |  48 +-
 guide/migrating-from-xd-rebuild.html            |  48 +-
 guide/mobile-breakpoints-device-categories.html |  48 +-
 guide/motion-timing-model.html                  |  48 +-
 guide/padding-margin-different-jobs.html        |  48 +-
 guide/responsive-layout-contract.html           |  48 +-
 guide/thumb-zones-layout-constraint.html        |  48 +-
 guide/type-scale-systems.html                   |  48 +-
 guide/whitespace-as-ui-component.html           |  48 +-
 guides.json                                     |  66 +++
 index.html                                      |  59 +-
 palettes/index.html                             |  48 +-
 palettes/palettes.css                           |  10 +
 palettes/palettes.js                            |  23 +
 partials/footer.html                            |  14 +
 partials/header-home.html                       |  28 +-
 partials/header.html                            |  34 +-
 privacy.html                                    |  48 +-
 roadmap.html                                    |  48 +-
 search.html                                     | 728 ++++++++++++++++++------
 styles.css                                      |  51 ++
 terms.html                                      |  48 +-
 tokens/amber-arcade.html                        |  48 +-
 tokens/analog-lounge.html                       |  48 +-
 tokens/bare-ledger-dark.html                    |  48 +-
 tokens/bare-ledger.html                         |  48 +-
 tokens/blank-concrete-dark.html                 |  48 +-
 tokens/blank-concrete.html                      |  48 +-
 tokens/blush-feather-dark.html                  |  48 +-
 tokens/blush-feather.html                       |  48 +-
 tokens/chalk-petal-dark.html                    |  48 +-
 tokens/chalk-petal.html                         |  48 +-
 tokens/collection.html                          |  48 +-
 tokens/create.html                              |  48 +-
 tokens/dusty-darkroom.html                      |  48 +-
 tokens/electric-broadcast.html                  |  48 +-
 tokens/even-concrete-dark.html                  |  48 +-
 tokens/even-concrete.html                       |  48 +-
 tokens/faceted-jade.html                        |  48 +-
 tokens/faceted-onyx.html                        |  48 +-
 tokens/index.html                               |  48 +-
 tokens/laser-static.html                        |  48 +-
 tokens/lunar-harbor.html                        |  48 +-
 tokens/milky-sorbet-dark.html                   |  48 +-
 tokens/milky-sorbet.html                        |  48 +-
 tokens/neon-pulse.html                          |  48 +-
 tokens/old-world-darkroom.html                  |  48 +-
 tokens/powder-sorbet-dark.html                  |  48 +-
 tokens/powder-sorbet.html                       |  48 +-
 tokens/radioactive-broadcast.html               |  48 +-
 tokens/retro-lounge.html                        |  48 +-
 tokens/rewind-motel.html                        |  48 +-
 tokens/rich-sapphire.html                       |  48 +-
 tokens/royal-ruby.html                          |  48 +-
 tokens/starless-frost.html                      |  48 +-
 tokens/starless-observatory.html                |  48 +-
 tokens/starless-tide.html                       |  48 +-
 tokens/studio-ledger-dark.html                  |  48 +-
 tokens/studio-ledger.html                       |  48 +-
 tokens/sun-baked-canyon.html                    |  48 +-
 tokens/terracotta-grove.html                    |  48 +-
 tokens/terracotta-riverbank.html                |  48 +-
 tokens/weathered-darkroom.html                  |  48 +-
 tokens/weathered-meadow.html                    |  48 +-
 tokens/worn-darkroom.html                       |  48 +-
 95 files changed, 3380 insertions(+), 2332 deletions(-)
```

(`git diff` covers tracked files only; the untracked files listed in
`git status` — including Phase 5's `resource-types.json` and this
handoff, and the pre-existing `build-content-index.js` /
`content-index.json` — are not in these counts.)

### `git diff --name-only`

```
about.html
build-categories.js
build-footer.js
build-header.js
build-home.js
category/accessibility.html
category/adobe-xd.html
category/color-theory.html
category/figma.html
category/mobile.html
category/motion.html
category/spacing.html
category/systems.html
category/typography.html
category/web.html
contact.html
guide/_TEMPLATE.html
guide/accessibility-structural-model.html
guide/auto-layout-constraint-model.html
guide/color-contrast-systems.html
guide/color-palette-token-system.html
guide/components-variants-contract.html
guide/css-grid-two-dimensional-system.html
guide/dark-mode-second-palette.html
guide/design-tokens-naming-system.html
guide/figma-to-code-handoff.html
guide/figma-variables-data-layer.html
guide/font-pairing-hierarchy-decision.html
guide/grid-systems-rhythm.html
guide/ios-android-different-systems.html
guide/line-length-reading-constraint.html
guide/migrating-from-xd-rebuild.html
guide/mobile-breakpoints-device-categories.html
guide/motion-timing-model.html
guide/padding-margin-different-jobs.html
guide/responsive-layout-contract.html
guide/thumb-zones-layout-constraint.html
guide/type-scale-systems.html
guide/whitespace-as-ui-component.html
guides.json
index.html
palettes/index.html
palettes/palettes.css
palettes/palettes.js
partials/footer.html
partials/header-home.html
partials/header.html
privacy.html
roadmap.html
search.html
styles.css
terms.html
tokens/amber-arcade.html
tokens/analog-lounge.html
tokens/bare-ledger-dark.html
tokens/bare-ledger.html
tokens/blank-concrete-dark.html
tokens/blank-concrete.html
tokens/blush-feather-dark.html
tokens/blush-feather.html
tokens/chalk-petal-dark.html
tokens/chalk-petal.html
tokens/collection.html
tokens/create.html
tokens/dusty-darkroom.html
tokens/electric-broadcast.html
tokens/even-concrete-dark.html
tokens/even-concrete.html
tokens/faceted-jade.html
tokens/faceted-onyx.html
tokens/index.html
tokens/laser-static.html
tokens/lunar-harbor.html
tokens/milky-sorbet-dark.html
tokens/milky-sorbet.html
tokens/neon-pulse.html
tokens/old-world-darkroom.html
tokens/powder-sorbet-dark.html
tokens/powder-sorbet.html
tokens/radioactive-broadcast.html
tokens/retro-lounge.html
tokens/rewind-motel.html
tokens/rich-sapphire.html
tokens/royal-ruby.html
tokens/starless-frost.html
tokens/starless-observatory.html
tokens/starless-tide.html
tokens/studio-ledger-dark.html
tokens/studio-ledger.html
tokens/sun-baked-canyon.html
tokens/terracotta-grove.html
tokens/terracotta-riverbank.html
tokens/weathered-darkroom.html
tokens/weathered-meadow.html
tokens/worn-darkroom.html
```

---

## K. Packaging, `.git`, and No Commit/Push

- Delivered as `bpozz-web-phase-5.zip`, top-level folder `bpozz_web/`,
  **including `.git`**.
- `.git` verified: `git fsck` clean; HEAD, refs, reflog, and object store
  (226 loose objects, 1149 packed, 2 packs) identical to the Phase 4
  baseline. The only difference inside `.git` is `.git/index`, whose stat
  cache is refreshed by running `git status`; nothing was staged.
- **No commit was made. No push was made.**

## L. Notes for Whoever Starts the Next Phase

Do not start it from this document alone — get explicit scope first. Read
this handoff and `bpozz-phase-4-handoff.md`, then `resource-types.json`,
`build-home.js` ("Homepage resource sections"), and `build-header.js` /
`build-footer.js` ("PHASE 5" comments). Keep §F's build order, and do not
add a resource type to the registry until its content and landing page
genuinely exist.
