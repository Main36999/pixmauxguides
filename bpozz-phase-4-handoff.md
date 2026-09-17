# BPOZZ — Phase 4 Handoff / Checkpoint

STATUS: COMPLETE

Phase 4 scope was Category Pages only: make `/category/*.html` surface the
existing Guide + Token + Palette content model, using their existing
category assignments, without touching Search (Phase 3) or the homepage
(Phase 5). This document is the authoritative baseline for whoever starts
Phase 5, the same way `bpozz-phase-3-handoff.md` was the baseline for this
phase.

---

## A. Implementation Completed

`build-categories.js` was extended to append up to two optional preview
sections below each category page's existing Guides grid — **Related
tokens** and **Related palettes** — sourced from `content-index.json`
(the generated index Phase 2 built and Phase 3's `search.html` already
reads). A section is filtered to content-index records whose `categories[]`
includes that page's slug, capped at 10, and is omitted entirely (zero
bytes emitted) when nothing matches.

No new business logic, no new data files, no new CSS, and no changes to
`search.html`, `content-index.json`, `build-content-index.js`,
`guides.json`, `tokens.json`, `palettes/palettes-data.json`, or any
homepage file. The Guides grid itself — the pre-existing Phase-0/1
behavior — is untouched.

## B. Files Modified

- `build-categories.js` — the only source file changed.
- `category/color-theory.html` — regenerated output (gains both rails).
- `category/systems.html` — regenerated output (gains both rails).

That is the complete list. No other file was written to during Phase 4.

## C. Files Intentionally Unchanged

Verified byte-identical to the Phase 3 baseline (diffed against a fresh
extraction of `bpozz-web-phase-3.zip`):

- `search.html`
- `content-index.json`
- `build-content-index.js`
- `guides.json`
- `tokens.json`
- `palettes/palettes-data.json`
- `palettes/palettes.js`, `palettes/palettes.css`
- `categories.json`
- `category/accessibility.html`, `adobe-xd.html`, `figma.html`,
  `mobile.html`, `motion.html`, `spacing.html`, `typography.html`,
  `web.html` (all 8 category pages with no matching Tokens/Palettes)

Not touched at all (no read-derived changes, no reason to): `app.js`,
`build-home.js`, `index.html`, `roadmap.html`, `tokens-shared.js`,
`tokens-gallery.js`, `tokens-color.js`, `tokens-a11y.js`,
`tokens-export.js`, `build-tokens.js`, `styles.css`, `guide-article.css`,
`partials/header.html`, `partials/header-home.html`, `partials/footer.html`,
everything under `/guide/`, `/tokens/`, `/palettes/` (except reading
`palettes/palettes-data.json` and `palettes/palettes.js` for the audit —
neither was written to).

The homepage was not modified in any way, directly or as a side effect.

## D. Category Page Behavior

- The existing Guides grid, its heading, its `results-count` line
  ("Showing X of X guides"), and its `<head>`/JSON-LD content are
  unchanged on all 10 pages — same markup, same wording, same data
  source (`guides.json`'s `category` field), same skip-if-zero-guides
  rule as before.
- Below that grid, each page may now show up to two additional
  `<aside class="guide-rail">` sections, in this fixed order:
  **Related tokens**, then **Related palettes**.
- A rail is only emitted if at least one matching record exists for
  that category. Today that's true for exactly 2 of the 10 categories
  (see E). The other 8 pages are byte-identical to before — confirmed
  by diff, not just "visually the same."
- Existing site navigation, the shared header/footer, and
  `aria-current="page"` highlighting on the category nav link are
  unaffected.

## E. Token/Palette Integration

- **Source:** `content-index.json`, filtered by `record.type` and
  `record.categories.includes(slug)`. No new matching/derivation logic
  was written — this reuses the category assignments Phase 2 already
  computed (the fixed pair `["color-theory", "systems"]` every Token
  and twinned Palette carries, per `build-content-index.js`).
- **Affected categories today:** `color-theory` and `systems` only —
  the only two slugs any Token/Palette record carries. The other 8
  categories (`typography`, `spacing`, `figma`, `adobe-xd`, `mobile`,
  `web`, `accessibility`, `motion`) show 0 Tokens and 0 Palettes, so no
  rail is rendered for them.
- **Limit:** 10 items per rail (10 tokens, 10 palettes — out of 40 of
  each in the catalog). This number is not new: it's the same cap
  `app.js`'s existing related-guides rail uses on every `/guide/` page.
- **Ordering:** no sort was implemented. Records are taken in
  `content-index.json`'s own array order, which preserves
  `tokens.json`'s and `palettes-data.json`'s own file order. Both
  source files were verified to already be stored newest-first (their
  `created_at`/`createdAt` values are sorted descending in file order),
  which is also each type's own default "New" sort on `/tokens` and
  `/palettes`. So "first 10 in the index" already means "10 newest," by
  construction, with no separate date-sorting code added.
- **Card:** a new, non-interactive card — `.guide-card` shell, a
  `.badge` reading "Token" or "Palette" (same wording as
  `search.html`'s `TYPE_LABELS`), a linked `.card-title`, and a
  `.card-meta` line of Title Cased tags (e.g. "Cool · Night · Dark") —
  built from classes already defined in `styles.css`. This is
  deliberately **not** `tokens-shared.js`'s or `palettes.js`'s live
  card: those render like/save/copy controls wired up by
  `tokens-collection.js` / Firebase-backed scripts that category pages
  don't load, so reusing them here would have shipped inert buttons.
- **Links:** Token cards link to `content-index.json`'s own `url` field
  (`/tokens/<slug>.html`) — verified every one resolves to a real file
  on disk. Palette cards link to `/palettes#<id>` — verified every id
  exists in `palettes/palettes-data.json`. Both are the sites' real,
  existing destinations; no new routes were invented.

## F. Build Steps Run

In order, on the full repository:

1. `node build-categories.js` — regenerates all 10 category pages from
   the updated script.
2. `node build-header.js` — required afterward: `build-categories.js`
   rewrites every category page from scratch each run (pre-existing
   behavior, not introduced by Phase 4), which resets `aria-current`
   nav state; this restores it. Result: 10 files updated (all 10
   category pages, since all 10 were freshly rewritten), 74 already up
   to date, 1 pre-existing skip (`bpozz-search-demo.html`, an orphaned
   file with no `HEADER_START`/`END` markers — unrelated to Phase 4).
3. `node build-footer.js` — run for pipeline completeness per the same
   dependency. Result: 0 files updated, 84 already up to date, same
   1 pre-existing skip.

`node build-content-index.js` was run once, read-only in effect, purely
to confirm `content-index.json` is still reproducible from its sources —
output was byte-identical to the committed file, so nothing was changed
by running it.

No other build script was run. No install step was needed (no new
dependencies).

## G. Validation Results

- **Scope check:** `git status`/`git diff` after the full pipeline run
  shows changes in exactly `build-categories.js`,
  `category/color-theory.html`, and `category/systems.html` beyond the
  pre-existing Phase 1–3 working state. No other tracked file changed;
  no unexpected untracked file appeared.
- **Baseline diff:** every file listed in section C was diffed against
  a fresh extraction of the original `bpozz-web-phase-3.zip` and
  confirmed byte-identical, including all 8 unaffected category pages.
- **Existing automated tests:** this repo has one test file,
  `tokens-a11y.test.js` (Node's built-in test runner; no
  `package.json`/test framework in the repo). Run via
  `node --test tokens-a11y.test.js`:
  **16 passed, 0 failed, 0 skipped.** This suite covers the
  accessibility-contrast engine (`tokens-color.js`/`tokens-a11y.js`),
  unrelated to category pages, and was unaffected — run to confirm the
  broader build wasn't destabilized.
- **HTML well-formedness:** a tag-balance check (Python
  `html.parser`, void-elements handled) on both modified pages plus one
  unmodified page as a control found zero mismatched/unclosed tags.
- **JSON-LD:** the `CollectionPage` structured-data block on both
  modified pages still parses as valid JSON with its original
  `@type`/`name` values.
- **Link integrity:** all 10 new Token links per modified page resolve
  to real files on disk; all 10 new Palette links per modified page
  resolve to ids present in `palettes/palettes-data.json`; the
  pre-existing Guide links on those same pages (3 on `color-theory`, 1
  on `systems`) still resolve to their existing `/guide/*.html` files.
- **Navigation:** `aria-current="page"` is present on the category nav
  link on both modified pages after the full pipeline run.
- **Reproducibility:** the full pipeline (`build-categories.js` →
  `build-header.js` → `build-footer.js`) was run a second time; output
  was byte-identical (`sha256sum` match) to the first run.
- **Cleanliness:** no `node_modules`, no temp files, no test scaffolding
  left behind.
- **No commit/push was performed** at any point.

## H. Git Diff Scope

```
 M build-categories.js
 M category/color-theory.html
 M category/systems.html
 M guides.json                    (pre-existing Phase 1–3 change, not from Phase 4)
 M palettes/palettes.css          (pre-existing Phase 1–3 change, not from Phase 4)
 M palettes/palettes.js           (pre-existing Phase 1–3 change, not from Phase 4)
 M search.html                    (pre-existing Phase 3 change, not from Phase 4)
?? bpozz-phase-1-handoff.md       (pre-existing)
?? bpozz-phase-2-handoff.md       (pre-existing)
?? bpozz-phase-3-handoff.md       (pre-existing)
?? bpozz-phase-4-handoff.md       (this document)
?? build-content-index.js         (pre-existing Phase 2)
?? categories.json                (pre-existing Phase 1)
?? content-index.json             (pre-existing Phase 2)
```

```
 build-categories.js        | 142 +++++++++-
 category/color-theory.html |   1 +
 category/systems.html      |   1 +
 7 files changed, 762 insertions(+), 161 deletions(-)   [full working tree, incl. pre-existing Phase 1–3 diffs]
```

Phase 4's actual contribution is `build-categories.js` (+142/-lines) and
the two regenerated category pages (+1 line each — the rails are
injected as a single conditional line in the template). The `guides.json`
/ `palettes.*` / `search.html` diffs shown above already existed before
this phase started and were not touched during Phase 4 work. Nothing was
committed or pushed — this is the working tree only.

## I. Remaining Risks / Ambiguities

- **The "tokens" category-slug question is still unresolved** — left
  alone deliberately, per your instruction not to create a
  `/category/tokens` page this phase. `categories.json` and
  `build-categories.js`'s category set are unchanged.
- **Latent edge case, not currently reachable:** the page-skip rule in
  `main()` still only checks the Guide count ("Category has no guides —
  skipping page"). If a category ever ended up with 0 guides but a
  nonzero Token/Palette match, no page would be generated for it at
  all, since that check runs before the new Token/Palette lookup. Every
  category with a Token/Palette match today (`color-theory`, `systems`)
  already has guides, so this doesn't affect current output — flagging
  it for awareness, not fixing it, to keep this phase narrowly scoped.
- **Category display metadata stays hard-coded.** `CATEGORIES`/
  `CATEGORY_META` inside `build-categories.js` were left as-is rather
  than re-sourced from `categories.json`, per the "avoid broad
  refactoring" guidance — their values already match `categories.json`
  1:1 (cross-checked in Phase 1), so there's no correctness gap today,
  only duplication that a future phase could clean up if desired.
- **"Newest first" ordering is emergent, not enforced.** The rails'
  ordering depends on `tokens.json`/`palettes-data.json` continuing to
  be authored newest-first, the same assumption the live `/tokens` and
  `/palettes` galleries' default sort already depends on. Nothing in
  Phase 4 added a safeguard or test for that invariant; it was only
  verified against the current data.
- **Two pre-existing, unrelated observations noted during the audit,
  not touched:** `app.js` still contains a `data-jump-category` handler
  that nothing in the current HTML uses anymore (dead code, predates
  Phase 4); `bpozz-search-demo.html` is an orphaned prototype file not
  linked from anywhere and already skipped by `build-header.js`/
  `build-footer.js`. Neither affects Phase 4's output.

## J. Exact Phase 5 Starting Point

Per `bpozz-phase-3-handoff.md`'s own forward pointer, Phase 5 is the
Homepage. Do not start it now. When it begins, it should inspect, in
this order:

1. `bpozz-phase-4-handoff.md` (this document) and `bpozz-phase-3-handoff.md`
   for full context.
2. `index.html` — current homepage markup and marker structure.
3. `build-home.js` — current homepage generator (patches markers inside
   `index.html`; does not rewrite it from scratch the way
   `build-categories.js` does).
4. `app.js` — specifically `isHomePage`/`gridRoot` and the `render()`
   function, plus the dead `data-jump-category` handler noted in
   section I, which a homepage phase may want to either wire back up or
   remove.
5. `content-index.json` and `categories.json` — the same normalized
   discovery data this phase used, likely relevant if the homepage is
   meant to surface Tokens/Palettes as first-class content per the
   original search spec's §3 framing.
6. `build-categories.js` (as shipped by this phase) — for reference on
   how a rail/section was added elsewhere in a way that reuses existing
   CSS and leaves unaffected pages byte-identical, if the homepage work
   wants a consistent pattern.

Do not modify the homepage, do not resolve the "tokens" slug question,
and do not alter this phase's implementation as part of that future
work unless a concrete defect is found in it.
