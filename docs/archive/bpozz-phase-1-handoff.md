# BPOZZ — Phase 1 Handoff

Checkpoint after Phase 1 ("Normalize data") of `bpozz-content-architecture-spec-v2.md`. This document is the precise record of what changed, what didn't, how it was checked, and where Phase 2 picks up.

## Status

Phase 1 is complete. Working tree is on `main`; the changes below are **unstaged and uncommitted** — nothing has been committed or pushed on your behalf. Exactly two files differ from the uploaded `bpozz_web.zip`:

```
 M guides.json
?? categories.json
```

Everything else in the repository is byte-identical to what was uploaded.

---

## What was changed

### 1. `categories.json` — new file

An array of 10 objects, one per existing category:

```json
{ "slug": "color-theory", "name": "Color Theory", "description": "...", "order": 1, "ogImage": "/assets/Color Theory.png" }
```

Consolidated from three existing sources, not newly authored:

| Field | Pulled from |
|---|---|
| `slug`, `name` | `CATEGORIES`, duplicated identically in `app.js`, `build-home.js`, `build-categories.js` |
| `description` | `build-categories.js` → `CATEGORY_META[slug].dek` (existed nowhere else) |
| `ogImage` | `build-categories.js` → `CATEGORY_META[slug].ogImage` (existed nowhere else) |
| `order` | The shared object-key order, common to all three JS sources and to the nav link order in `partials/header.html` / `header-home.html` |

Same 10 slugs, same order, as everywhere else in the codebase: `color-theory, typography, spacing, figma, adobe-xd, mobile, web, systems, accessibility, motion`.

Icon SVGs (`ICONS`) and thumbnail motif SVGs (`THUMBS`) were **not** folded in here — see "Intentionally not changed."

### 2. `guides.json` — modified

Added `"categories": ["<value>"]` immediately after `"category"` on all 22 entries, mirroring that entry's existing `category` string:

```json
"category": "spacing",
"categories": ["spacing"],
```

- `"category"` was left in place, untouched, on every entry.
- No entry received more than one category.
- The diff is 100% additive: 3 new lines × 22 entries, zero deletions, zero reordering, zero changes to any other field.

---

## What was intentionally not changed

- **`ICONS` / `THUMBS` SVG maps** (`app.js`, `build-home.js`, `build-categories.js`) — still duplicated across all three files. Folding these into `categories.json` and rewiring the three files to read from it is Phase 6's job ("Refactor duplicated category definitions"). Doing it now would mix a larger, riskier refactor into what's supposed to be a pure data-normalization step.
- **`app.js`, `build-home.js`, `build-categories.js`, `search.html`** — none were rewired to read `categories.json` or `guides.json`'s new `categories[]` field. They still read the old `category` string and their own local category-label objects, exactly as before. The live site's behavior is unchanged by Phase 1.
- **Multi-category assignment on existing guides.** The spec's own example (§34) suggests a guide like `color-palette-token-system` could eventually carry `categories: [color-theory, tokens, systems, palettes]`. That wasn't done — §34 explicitly requires taxonomy decisions to be based on the actual article content, not applied mechanically. All 22 guides currently carry exactly the single category they already had. Reclassifying any of them is a deliberate, separate editorial step, not part of this migration.
- **`"tokens"` / `"palettes"` as new category slugs.** Not added to `categories.json`, even though the spec's multi-category example names them. This is a real open question, not a silent decision: a `tokens` *topic* category for guides that are about tokens (there are two: `color-palette-token-system`, `design-tokens-naming-system`) is conceptually different from the earlier, separate decision that Token/Palette *content records* shouldn't carry a category matching their own type's name. Worth explicit sign-off before Phase 4, since it changes what a category page is able to show.
- **The `categories` normalization helper** (`Array.isArray(item.categories) ? item.categories : (item.category ? [item.category] : [])`, per §12). Not written yet — nothing in the codebase reads `categories[]` yet, so there's no call site to guard. It belongs in `build-content-index.js`, the first actual consumer.
- **No git commit.** The two file changes are sitting in the working tree, unstaged.

---

## Validation performed

- `categories.json` parsed and checked: exactly 10 entries, each with exactly the 5 expected keys (`slug`, `name`, `description`, `order`, `ogImage`), `order` values 1–10 with no gaps or duplicates.
- Confirmed the 10 slugs in `categories.json` are exactly the set of distinct `category` values actually used across `guides.json`'s 22 entries, in both directions (no category with zero guides, no guide category missing from the list).
- Cross-checked slug order and labels across `app.js`'s `CATEGORIES`, `build-categories.js`'s `CATEGORY_META`, and the nav link order in `partials/header.html` — all agree on order. The nav uses shorter labels in a few places (e.g. "Systems" vs. "Design Systems", "Spacing" vs. "Spacing & Layout") — a pre-existing, presentational difference that predates this change and wasn't touched.
- Diffed the new `guides.json` against the original: confirmed purely additive (no deletions, no reordering, no changes to any pre-existing field or value).
- Reparsed the updated `guides.json` and asserted, for all 22 entries, `categories == [category]`.
- `git status` confirms only `categories.json` and `guides.json` show as changed — nothing else in the tree was touched.

---

## Current state

```
categories.json     NEW        10 categories, not yet consumed by any script
guides.json         MODIFIED   +categories[] on all 22 entries; category untouched
(all other files)   UNCHANGED  byte-identical to the uploaded bpozz_web.zip
```

---

## Starting point for Phase 2

Phase 2 is "Build content index" — new `build-content-index.js` → new `content-index.json`, reading `guides.json`, `tokens.json`, `palettes/palettes-data.json`. Decisions already made and ready to implement directly (no further sign-off needed for these):

- **Record shape**, per the search spec's §7 model: `{id, type, title, slug, url, description, categories, tags, keywords, searchText}`. `id` prefixed by type — `guide:whitespace-as-ui-component`, `token:starless-frost`, `palette:p001`.
- **Guides** — categories come straight from the new `categories[]` field. Use the normalization helper as a fallback to `[category]` for safety, even though Phase 1 guarantees `categories[]` is present on all 22 today.
- **Tokens** — all 40 get `categories: ["color-theory", "systems"]`, uniformly. No per-token classification; this is grounded in how the site's own guides already split "tokens" as a topic across exactly those two categories.
- **Palettes** — all 40 get:
  - `categories`: inherited from their twin Token (same `["color-theory", "systems"]`)
  - `title` / `description`: inherited from their twin Token, matched by **comparing color values**, not array index — palette *p*'s colors exactly match one token's `background`/`surface`/`primary`/`secondary` hex values; match on that, not on shared list position, so it stays correct if either source file is ever regenerated in a different order
  - `url`: a deep-link into the existing `/palettes` gallery (e.g. `/palettes#<slug>`) — this needs a small, separate addition to `palettes/palettes.js` (read `location.hash` or a query param on load, scroll to and highlight the matching `[data-id]` card), since that doesn't exist yet. Worth building alongside `build-content-index.js`, not deferring, since the URL is meaningless until the gallery can resolve it.
  - Search-result display: a Token and its twin Palette (identical inherited title) show as **two separate rows**, not merged.
- **Write the normalization helper here**: `Array.isArray(item.categories) ? item.categories : (item.category ? [item.category] : [])`. This is the first file that actually needs it.

**Not yet decided, and not a Phase 2 blocker** (matters for Phase 4, when category pages start rendering Tokens/Palettes): whether `"tokens"` becomes a real slug in `categories.json` for guides that are *about* tokens as a subject. Worth resolving before Phase 4 starts, since it changes what a category page is able to show — doesn't affect anything Phase 2 needs to build.
