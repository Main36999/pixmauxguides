# BPOZZ — Phase 2 Handoff

Checkpoint after Phase 2 ("Build content index") of `bpozz-content-architecture-spec-v2.md`. Builds directly on `bpozz-phase-1-handoff.md`, which is the verified starting state for everything below.

## Status

Phase 2 is complete. Working tree is on `main`; the changes below are **unstaged and uncommitted** — nothing has been committed or pushed on your behalf, same as Phase 1. Five files differ from the Phase 1 checkpoint:

```
 M palettes/palettes.css
 M palettes/palettes.js
?? build-content-index.js
?? content-index.json
?? bpozz-phase-2-handoff.md
```

Phase 1's own changes (`guides.json` modified, `categories.json` new) are untouched and still present exactly as Phase 1 left them. Everything else in the repository is byte-identical to the Phase 1 checkpoint — confirmed with `git diff --quiet` against `search.html`, `app.js`, `build-home.js`, `build-categories.js`, `categories.json`, and `guides.json`.

---

## What was changed

### 1. `build-content-index.js` — new file

Reads `guides.json`, `tokens.json`, `palettes/palettes-data.json`, and `categories.json`, and writes `content-index.json`. Run with:

```
node build-content-index.js
```

Record shape, exactly per the Phase 1 handoff's "Starting point for Phase 2":

```
{ id, type, title, slug, url, description, categories, tags, keywords, searchText }
```

`id` is prefixed by type: `guide:<slug>`, `token:<slug>`, `palette:<id>`.

**Guides** — `categories` comes from the `categories[]` field Phase 1 added, run through the `normalizeCategories()` helper from `bpozz-content-architecture-spec-v2.md` §12 (ported verbatim) as a fallback to the legacy `category` string. This is that helper's first real call site. `tags`/`keywords` are `[]` — guides.json has neither field, and nothing was invented to fill them.

**Tokens** — every token gets the fixed pair `categories: ["color-theory", "systems"]`, per the Phase 1 decision. `tags` comes straight from `tokens.json`. `description` is `""` — tokens.json has no description field. `searchText` is built from name, slug (hyphens split into words), family, moods, lightness, tags, and color role names (`background`/`surface`/etc.) — **not** hex values, per the search spec's "don't over-index raw technical values" guidance.

**Palettes** — `palettes-data.json` records are just `{id, colors[4], likes, createdAt}`, so every other field is inherited from the palette's "twin" token. The twin is found by comparing the palette's 4 hex colors against each token's `background`/`surface`/`primary`/`secondary` colors (case-insensitive string compare), **not** by array position — confirmed necessary and sufficient: all 40 palettes matched exactly one token 1:1, with zero collisions among the tokens' own color keys (see Validation below). A palette inherits its twin's `title`, `description`, `categories`, and `tags`. `url` is `/palettes#<id>` (see item 2 below for what makes that land somewhere useful).

Both `build-guide/token/palette Records()` functions warn (via `console.warn`, matching `build-categories.js`'s existing convention) rather than fail on: a guide referencing a category slug absent from `categories.json`, two tokens sharing an identical 4-color key (ambiguous palette matching), or a palette with no matching token. None of these warnings fired against the current data — see Validation.

`searchText` is lowercased, whitespace-collapsed, and **de-duplicated word-by-word** before being written. This last step isn't spelled out in either spec — it's a Phase 2 implementation decision, not a Phase 1 carryover — added because a token's own `tags` are largely a restatement of its `family`/`moods`/`lightness` (see `scripts/generate-palettes.js`), so without de-duplication `searchText` for e.g. `token:starless-frost` would read `"starless frost starless frost cool night dark cool night dark background..."`. Flagging this for visibility since Phase 3 owns the matching/scoring logic that will actually consume this field.

### 2. `palettes/palettes.js` — modified (additive, +23 lines)

Added `focusPaletteFromHash()`, called once right after the initial render (not on every re-sort). On page load, if the URL has a hash matching a real palette id, it scrolls that card into view and applies a highlight class for ~2.4s.

This exists because `content-index.json` now points every Palette search result at `/palettes#<id>` — without this, that link would just open the gallery at the top with no way to tell which card it meant. Per the Phase 1 handoff: *"the URL is meaningless until the gallery can resolve it."* Nothing else in the file changed — sort, likes, Firebase wiring, copy-hex all behave exactly as before.

### 3. `palettes/palettes.css` — modified (additive, +10 lines)

Added the `.palette-card--highlight` style `focusPaletteFromHash()` applies (a `box-shadow` glow using the existing `--action` accent variable) and a `transition` on `.palette-card` so the highlight fades out smoothly when the class is removed.

---

## What was intentionally not changed

- **`search.html`, `app.js`, `build-home.js`, `build-categories.js`.** None were rewired to fetch or read `content-index.json`. Wiring Search to the new index is Phase 3 (`bpozz-global-search-spec-v2.md`); the homepage and category pages are Phases 4–5. The live site's search behavior is unchanged by Phase 2.
- **Query normalization, scoring/ranking, multi-word matching, type/category filters, and the "no results" copy** (search spec §§10–19). These are explicitly Phase 3's job — Phase 2 is only the index. `build-content-index.js` contains no matching or scoring logic of any kind.
- **`categories.json`, `guides.json`.** Not touched — Phase 1 already finished normalizing these.
- **A `categories` field in Token/Palette `searchText`.** Deliberate, not an oversight: the search spec's §9 field list for Tokens (`name, slug, family, moods, lightness, tags, color roles, hex values if useful`) and for Palettes (`name, slug/id, tags, family/mood fields if present`) both omit category from `searchText`, unlike the Guide list which explicitly includes it. Since every Token/Palette shares the identical fixed category pair, including it in `searchText` would add zero discriminating signal — category matching for these types is expected to work off the `categories` array field directly (§12: `categories.includes(selectedCategory)`), which every record already carries correctly.
- **A `package.json` / npm script.** None exists anywhere in this repo yet (checked); `build-content-index.js` is invoked directly with `node build-content-index.js`, the same way `build-categories.js` and `build-tokens.js` already are.
- **Palette `tags` inheritance** — decided now, not revisited from Phase 1. The Phase 1 handoff only explicitly decided `title`/`description`/`categories` inheritance for Palettes; `tags` wasn't mentioned either way. Since `palettes-data.json` has no tags of its own and the search spec's §9 Palette field list names `tags` explicitly, inheriting `tags` from the twin token (the same mechanism already used for everything else) was the only way to satisfy that without inventing data. Flagging this as a Phase 2 addition worth a quick sign-off, though the risk is low — it follows the exact pattern Phase 1 already established.
- **The still-open `"tokens"` category-slug question** from the Phase 1 handoff. Still unresolved, still not a blocker for anything Phase 2 needed (Tokens/Palettes never reference it), still worth deciding before Phase 4 category pages start rendering Tokens/Palettes.

---

## Validation performed

- `node build-content-index.js` runs cleanly: `✓ content-index.json written — 102 records (22 guides, 40 tokens, 40 palettes).` No warnings emitted (no unknown category slugs, no ambiguous token color-key collisions, no unmatched palettes).
- **Reproducibility:** ran the script twice in a row; `content-index.json` came out byte-identical both times.
- **Shape:** every one of the 102 records has exactly the 10 keys `{id, type, title, slug, url, description, categories, tags, keywords, searchText}` — no extras, none missing.
- **Identity:** all 102 `id` values are unique; every `id`'s type prefix matches its `type` field.
- **Guides (22):** every `url` resolves to a `guide/<slug>.html` file that actually exists on disk; every `categories[]` entry is a real slug in `categories.json`; none have empty `categories`.
- **Tokens (40):** the 40 token slugs in the index exactly match `tokens.json`'s 40 slugs; every `url` resolves to an existing `tokens/<slug>.html`; every token's `categories` is exactly `["color-theory", "systems"]`.
- **Palettes (40):** the 40 palette ids in the index exactly match `palettes-data.json`'s 40 ids; independently re-derived the color-based twin match in a separate script (not reusing `build-content-index.js`'s own code) and confirmed, for all 40: the twin found matches the twin `build-content-index.js` found, `title` equals the twin's `name`, `tags` equals the twin's `tags`, `categories` is `["color-theory", "systems"]`, and `url` is `/palettes#<id>`.
- **`searchText`:** non-empty, fully lowercase, no double-spaces, for all 102 records.
- **Search-spec §24 checklist, at the data level** (full search flow is Phase 3, so these confirm the *index* has what Phase 3 will need, not that search.html works yet):
  - Guide records whose `searchText` contains "color" — present (`color-contrast-systems`, `color-palette-token-system`, `dark-mode-second-palette`, plus their palette/token counterparts under a broader match).
  - `token:starless-frost` and `palette:p001` (its twin) both findable by the query "starless frost".
  - All 12 tokens actually tagged `"night"` in `tokens.json` are findable via `searchText` — cross-checked set-equality between "tokens where `night` ∈ `tags`" and "records where `night` ∈ `searchText`" (24 records total once their twin palettes are included).
  - Palette records carry inherited, non-empty, searchable titles (no palette fell back to its bare id `pNNN`, since all 40 matched a twin).
- **`palettes/palettes.js` hash-focus behavior** — smoke-tested in a jsdom harness (not just read): a valid hash (`#p002`) finds the card, highlights it immediately, and the highlight class is removed after the timeout; an empty hash highlights nothing; an invalid hash (`#does-not-exist`) highlights nothing and throws no error.
- **Scope check:** `git diff --quiet` confirms `search.html`, `app.js`, `build-home.js`, `build-categories.js`, `categories.json`, and `guides.json` are all byte-identical to the Phase 1 checkpoint.

---

## Current state

```
build-content-index.js   NEW        generator script; run with `node build-content-index.js`
content-index.json       NEW        102 records (22 guides, 40 tokens, 40 palettes); not yet read by any page
palettes/palettes.js     MODIFIED   +focusPaletteFromHash(), additive only
palettes/palettes.css    MODIFIED   +.palette-card--highlight style, additive only
categories.json          UNCHANGED  Phase 1 state (10 categories)
guides.json              UNCHANGED  Phase 1 state (+categories[] on all 22 entries)
(all other files)        UNCHANGED  byte-identical to the Phase 1 checkpoint
```

---

## Starting point for Phase 3

Phase 3 is "Fix global Search" (`bpozz-global-search-spec-v2.md`). `content-index.json` now exists at the repo root with all 102 records in the shape described above — Phase 3's job is to point `search.html` at it instead of `guides.json`, and to actually implement what Phase 2 deliberately left out:

- Query normalization (§10), multi-word term scoring (§11–13), the weighted relevance model (§12) — none of this exists yet anywhere in the codebase.
- Type filters (`All`/`Guides`/`Tokens`/`Palettes`) and category filtering, both against the `categories`/`type` fields the index already carries.
- The updated empty-state copy (§17) — current copy ("No guides matched…") is still Guide-specific and still live, since `search.html` hasn't been touched.
- Category-name matching for query text (e.g. a search for "Color Theory" matching `categories: ["color-theory"]`) will need to resolve against `categories.json`'s `name` field — that lookup wasn't put into `content-index.json` itself (see "What was intentionally not changed" above), so Phase 3 either does that resolution in `search.html`/`app.js` at query time, or decides it wants that data denormalized into the index after all.
- Palette search results already have somewhere real to go: `/palettes#<id>`, which `palettes/palettes.js` now resolves into a scroll-and-highlight on load. No further work needed there for Phase 3 to link to a Palette result.
- Not a Phase 3 blocker, but worth resolving before Phase 4: whether `"tokens"` becomes a real category slug (carried over from the Phase 1 handoff, still open).
