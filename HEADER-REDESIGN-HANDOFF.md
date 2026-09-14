# Header Redesign — bpozz web (COMPLETE)

**Status: done and verified.** This file is kept as a record of what changed
and how to extend it later — there is no remaining work from the original
request.

## Goal

Make bpozz's site header structurally different on the home page vs. every
other page, mirroring how **resourceboy.com** does it:

- **Home page** (`index.html`): a single dark row — logo + full nav links.
  No search box in the header, because the home page already has a large,
  prominent search bar in its hero section right below the header.
- **Every other page** (guide, category, roadmap, search, about, contact,
  privacy, terms): a **two-row** header — top row is logo + a persistent,
  full-width search bar; bottom row is the nav links. These pages have no
  hero search, so the header itself has to carry search.

Reference screenshots (resourceboy.com) that this was matched against:
- Home page header: single row, logo left, nav across, "Sign in" pill far
  right (bpozz has no accounts, so that slot is simply absent on bpozz).
- Inner page header: top row = logo + full-width search input; bottom row =
  category nav + "Sign in" pill (again, no pill on bpozz).

## Site architecture (context for whoever picks this up)

This is a static HTML site with **no templating engine**. The header is kept
in sync across all `.html` files via a Node build script:

- `partials/header-home.html` — source of truth for the home-page header
  (single row, no search).
- `partials/header.html` — source of truth for every other page's header
  (two-row: search on top, nav below).
- `build-header.js` — reads both partials, rewrites relative links per page
  depth, marks the current nav item with `aria-current="page"`, and injects
  the result into every `.html` file between `<!--HEADER_START-->` and
  `<!--HEADER_END-->` marker comments.

**Workflow: never hand-edit the `<header>` block inside a page file.** Edit
the relevant partial, then run:

```bash
node build-header.js
```

from the project root. This rewrites the header block in every `.html` file
that has both markers. It reports skipped files (missing markers) — as of
this handoff, only `bpozz-search-demo.html` is skipped (a stray demo page
with no markers at all; not part of the real site nav, left untouched).

There's an analogous `build-home.js` for the homepage's guide grid and
`build-categories.js` / `build-footer.js` for other repeated content — same
marker-comment pattern. Not touched by this work, mentioned for context.

## What was implemented

1. **`partials/header-home.html`** (new file) — single `<div class="header-inner">`
   row: `.brand` + `.site-nav` + `.menu-toggle` button + `#mobile-menu` panel.
   No search markup at all.

2. **`partials/header.html`** (rewritten) — now two rows inside
   `<header class="site-header site-header--inner">`:
   - `.header-top`: `.brand` + `<form class="header-search header-search--full">`
     (always visible, no collapse/toggle) + `.menu-toggle` button.
   - `.header-bottom`: `.site-nav` only.
   - `#mobile-menu` panel unchanged (still nav-only; the top row's search
     stays visible at every width, so it isn't duplicated in the mobile
     panel).

3. **`build-header.js`** — added `HOME_HEADER_PARTIAL_PATH` constant; `main()`
   now picks `homePartial` when `relPath === "index.html"` and `partial`
   (the two-row one) for everything else, then runs both through the
   existing `headerFor()` / `markCurrent()` link-rewriting logic unchanged.

4. **`styles.css`** — header section rewritten (search
   `.site-header` down through the `@media (max-width: 640px)` mobile-menu
   block):
   - `.header-inner` (home, single row, 84px) and `.header-top` (inner,
     top row, 84px) share base flex rules; `.header-bottom` is the new
     52px nav strip with a hairline `border-top` separating it from
     `.header-top`.
   - `.header-search--full` is the modifier that stretches `.header-search`
     to fill `.header-top` (input `width:100%`, flex-grow via
     `flex: 1 1 auto`). Base `.header-search` (fixed ~180px width) is kept
     in case it's ever needed elsewhere, but nothing currently uses it
     without the `--full` modifier.
   - **Removed entirely**: `.header-actions`, `.header-search-collapse`,
     `.header-search-toggle*`, and the `<details>/<summary>` collapse
     behavior + its whole mobile media-query block. Neither partial uses
     `<details>` anymore — the inner header's search is now always
     visible at every viewport width instead of collapsing into an icon
     on mobile. (Double check nothing else in the repo still references
     `header-search-collapse` / `header-actions` / `header-search-toggle`
     before deleting further — a repo-wide grep at the time of this
     handoff came back clean.)
   - Mobile (`max-width: 640px`): `.header-bottom` is `display: none`
     (nav folds into the existing hamburger `#mobile-menu` panel, same as
     the home header already did); `.menu-toggle` got `margin-left: auto`
     added so it pins to the right edge on the home header once `.site-nav`
     hides (on the inner header this is a no-op since
     `.header-search--full`'s flex-grow already pushes it there).
   - `app.js` was **not changed** — it only does
     `document.querySelectorAll(".header-search")` (for blanking stale
     input values on filter-reset) and wires up `#menu-toggle` /
     `#mobile-menu` by ID, both of which still exist unchanged in the new
     markup.

## Verification done

- `node build-header.js` run successfully: 40 files updated, 0 errors,
  1 expected skip (`bpozz-search-demo.html`, no markers — see below).
- Manually inspected rendered header markup in: `index.html`,
  `category/color-theory.html`, `guide/color-contrast-systems.html`,
  `about.html`, `roadmap.html` — link depth-rewriting and
  `aria-current="page"` highlighting all correct.
- **Desktop screenshots** (Playwright + Chromium, 1400px viewport) of every
  page type: home, category, guide, about, contact, privacy, terms,
  roadmap, search. All structurally consistent; `roadmap.html` and
  `category/color-theory.html` correctly show their own nav link
  underlined as current.
- **Mobile screenshots** (375px viewport): home header (logo + hamburger,
  hero search below), inner header (logo + full-width search + hamburger,
  nav row hidden), and the opened `#mobile-menu` panel for both variants.
  Nav highlighting and the search bar both work correctly at this width;
  the search input's placeholder text truncates to "Search guide" at
  375px (cosmetic only — the field is still fully usable, this is normal
  browser text-overflow behavior on a narrow input, not a bug).
- **Accessibility pass**: confirmed via Playwright's accessibility tree —
  exactly one `<header>` landmark per page (the two-row inner layout does
  not create a second, redundant landmark); keyboard Tab order is
  skip-link → logo → search input → search button → nav links, matching
  the visual top-to-bottom reading order.
- `search.html`'s body copy ("Use the search box above") was checked
  against the actual markup — there's no duplicate search form on that
  page now that the header always carries one; the copy is accurate.
- Comment cleanup: the stale doc-comment in `build-header.js` claiming
  ".header-actions hides at max-width:640px" was corrected — that class
  no longer exists at all (deleted, not hidden).
- All changes committed to git (see `git log`, commit
  "Split header into home (single-row, no search) vs inner-page
  (two-row, full-width search) variants").

## Deliberately not changed

- **`bpozz-search-demo.html`** — confirmed via repo-wide grep that nothing
  links to this file. It's a standalone demo page with its own inline
  `<style>` block (doesn't use `styles.css` or the partial/build system at
  all) and has no `HEADER_START`/`HEADER_END` markers, so
  `node build-header.js` already skips it by design. Left as-is since it's
  outside the real site's navigation; update it separately if it turns
  out to be used somewhere.
- **Cross-browser testing beyond Chromium** — only Chromium was available
  in this environment (via Playwright); no Firefox/WebKit engine was
  installed and none could be downloaded (not on the sandbox's network
  allowlist). The CSS used (flexbox, standard media queries, `<details>`
  was removed entirely) is broadly-supported, unexotic CSS, so this is a
  low-risk gap, but a real cross-browser check is still worth doing before
  calling this fully production-verified.

## Key files to open first

```
partials/header-home.html   ← home page header source
partials/header.html        ← every-other-page header source
build-header.js             ← build/sync script (run after editing either partial)
styles.css                  ← search "site-header" for the whole header CSS block
app.js                      ← search "menu-toggle" / "header-search" for the JS wiring (unchanged, just for reference)
```

Run `node build-header.js` after any partial edit, before considering the
work done.
