# BPOZZ — Phase 3 Handoff

Checkpoint after Phase 3 ("Fix global Search") of `bpozz-global-search-spec-v2.md`. Builds directly on `bpozz-phase-2-handoff.md`, which is the verified starting state for everything below.

## Status

Phase 3 is complete. Working tree is on `main`; the change below is **unstaged and uncommitted** — nothing has been committed or pushed on your behalf, same as Phase 1 and Phase 2.

Confirmed by diffing the full Phase 2 checkpoint tree against the current working tree (everything except `.git`): **exactly one file differs — `search.html`.** Every other file — `guides.json`, `categories.json`, `content-index.json`, `build-content-index.js`, `palettes/palettes.js`, `palettes/palettes.css`, `app.js`, `build-home.js`, `build-categories.js`, `styles.css`, all partials, all Token/Palette/Guide pages — is byte-identical to the Phase 2 checkpoint.

```
 M search.html
?? bpozz-phase-3-handoff.md
```

(`guides.json`, `categories.json`, `build-content-index.js`, `content-index.json` still show against `git`'s last commit — that's Phase 1/Phase 2's untouched work, not Phase 3's.)

---

## What was changed

### `search.html` — rewired end to end (only file touched)

This page previously fetched `/guides.json` directly and filtered Guide fields only (`bpozz-global-search-spec-v2.md` §2). It now fetches `/content-index.json` (built in Phase 2, 102 records) and `/categories.json` in parallel and implements the full Phase 3 pipeline from the spec: normalize → score → sort → filter → render.

**Query normalization (§10).** `normalizeQuery()` trims and collapses whitespace; lowercasing happens at match time so the displayed heading/count keep the user's original casing (matches the pre-Phase-3 convention). The query is split into terms on whitespace for multi-word matching. Every piece of user-supplied text that reaches the DOM goes through `escapeHtml()` before any `innerHTML` assignment, or is set via `textContent` (heading, dek, empty-state message) which is escape-safe by construction — verified against an HTML-injection query (see Validation).

**Relevance scoring (§12–13).** `scoreRecord()` uses the spec's starting weights exactly as given (exact title +100, title word +50, category +35, tag +30, keyword +25, description +15, searchText +5). Each query term is checked independently against every field and matching contributions are summed, so a record matching more terms accumulates a higher score than one matching only one — this is what makes multi-word queries rank correctly without requiring the literal phrase to appear anywhere (verified: see Validation).

**Category-name query matching (categories.json).** `content-index.json` stores each record's `categories` as slugs, not display names (Phase 2's deliberate choice — see `bpozz-phase-2-handoff.md`, "A categories field in Token/Palette searchText" and "Starting point for Phase 3," which explicitly left this resolution for Phase 3). `categoryName(slug)` resolves a slug to its `categories.json` display name at query time; `categorySearchTextFor()` builds a per-record string from both the resolved name ("Color Theory") and the slug's own words ("color theory"), so a query matches either form. This resolution lives in `search.html` itself — `content-index.json` was not changed, and the index's own field list is untouched.

**Type filter — All / Guides / Tokens / Palettes (§16).** Four tab-style buttons (`.search-type-tab`) filter `content-index.json`'s `type` field before scoring. Synced to the URL as `?type=guide|token|palette` (omitted for "all"), so `/search.html?s=color&type=token` works as a direct link and shows Tokens only (verified).

**Category filter (§16).** A `<select>` populated entirely from `categories.json` (sorted by its own `order` field) — not a hard-coded list, per the spec's explicit instruction. Filters on `record.categories.includes(selectedSlug)`. Synced to the URL as `?category=<slug>` (omitted for "all"). An invalid `type` or `category` value in the URL falls back to "all" rather than erroring (verified).

**Empty state (§17).** Replaced the Guide-specific "No guides matched…" copy with the spec's generic wording plus a short "try a broader keyword / fewer words / check the spelling" list. The word "guides" no longer appears in the empty state.

**Result rendering (§14–15).** One normalized card renderer (`resultRowHtml()`) is used for every record type: title (with matched terms wrapped in `<mark>`), a type badge (reusing the site's existing `.badge` class), category chips (resolved display names, reusing `.card-meta`), and a type-appropriate one-line snippet — a Guide's `description`, or a Title-Cased join of `tags` for Tokens/Palettes (which have no `description` in the index — `tokens.json` has no description field, per Phase 2). No Guide-specific fields (level, read time) are shown, since the index doesn't carry them and the spec explicitly says not to force them onto other types.

Results render as a single relevance-sorted list rather than type-grouped sections. The spec's §14 mockup shows a grouped "GUIDES / TOKENS / PALETTES / CATEGORIES" layout as an illustration of what the *feature* should surface; the pipeline the spec actually numbers and mandates (§11: fetch → normalize → score → sort → render) is a flat sorted list, which is what's implemented, with the type badge on each card carrying the type distinction instead of a section header. The results-count line adds a parenthetical per-type breakdown when the type filter is "All" (e.g. `85 Results for "color" (5 guides · 40 tokens · 40 palettes)`) as a lightweight nod to that grouped view without restructuring the list.

A **"Categories" result type was deliberately not added.** The spec's architecture diagrams (§4, §14) list Categories as a fourth branch alongside Guides/Tokens/Palettes, but `content-index.json` has no category records — Phase 2 built exactly three record types, and Phase 3's task list was explicit: "Do not add new content types." Category names are used to *boost and filter* Guide/Token/Palette results (the "category-name query matching" task item), not to produce a synthetic fourth card type.

**URL sync.** `?s=`, `?type=`, `?category=` are read on load and written back with `history.replaceState` (no full navigation) whenever a filter changes, so results stay shareable/reload-safe (§18) without adding a server round-trip. Filters only render and apply when a query (`s`) is present — an empty query still shows the original landing copy (now generalized to mention guides/tokens/palettes), matching the page's pre-Phase-3 behavior of doing nothing without a query.

**Local fallback data.** The `SAMPLE_GUIDES` fallback (used if `guides.json` couldn't be fetched, e.g. opened via `file://`) was replaced with a small `SAMPLE_INDEX` / `SAMPLE_CATEGORIES` pair shaped like real `content-index.json` / `categories.json` records, covering one Guide, one Token, and its twin Palette.

**CSS.** All new styling lives in `search.html`'s own `<style>` block (which already held a page-scoped `mark` rule) — new rules for the type tabs, the result list/row/link/title/meta/desc layout, and the empty-state tips list. Everything else reuses existing global classes (`.badge`, `.card-meta`, `.field.select-field`, `.section-head`, `.empty-state`, `.btn-primary`) and CSS custom properties (`--action`, `--text-muted`, `--grid-line`, `--ink`, `--sans`) already defined in `styles.css`. **`styles.css` itself was not touched** — everything needed was achievable by reusing what already existed there.

Nothing in the `<head>` beyond `<title>` and the meta description changed, and neither did the shared header/footer markup (the `HEADER_START…HEADER_END` / `FOOTER_START…FOOTER_END` blocks) — confirmed present and unmodified.

---

## What was intentionally not changed

- **`app.js`.** The homepage's Guide grid, mobile menu, and header-search-form wiring were not touched. The header search form already posts to `/search?s=...` and `search.html` already read `s` — both predate Phase 3 and needed no correction (spec §19's "inspect before changing" requirement was satisfied by confirming this, not by editing it).
- **`build-home.js`, `build-categories.js`, `index.html`.** Homepage and category-page rendering are Phases 4–5, explicitly out of scope here. The homepage was not redesigned.
- **`content-index.json`, `build-content-index.js`, `categories.json`, `guides.json`, `tokens.json`, `palettes/palettes-data.json`.** All untouched — the index and its sources are Phase 2's finished, validated work. Category-name resolution was done in `search.html` at query time (see above) rather than by denormalizing category names into the index, which Phase 2's handoff explicitly left as an open choice for Phase 3 to make either way.
- **`palettes/palettes.js`, `palettes/palettes.css`, `palettes/index.html`.** Untouched. Phase 2's `focusPaletteFromHash()` already resolves a Palette search result's `/palettes#<id>` link into a scroll-and-highlight; Phase 3 needed nothing further there and didn't touch the Palettes feature's own business logic (likes, Firebase, sort tabs), per spec §22–23.
- **`styles.css`, `partials/header.html`, `partials/header-home.html`.** No sitewide style or header markup changes. All new visual treatment for the search results page is scoped locally inside `search.html`.
- **A `package.json` / npm script.** Still none anywhere in this repo. No build-time dependency was introduced; `content-index.json` continues to be generated by running `node build-content-index.js` directly, unchanged from Phase 2.
- **A synthetic "category" search-result type.** See "What was changed" above — deliberate, per the explicit "do not add new content types" instruction and the index's actual three-type shape.
- **Grouping results into GUIDES/TOKENS/PALETTES sections.** See "What was changed" above — the spec's own numbered pipeline (§11) describes one scored, sorted list; that's what's implemented, with a type badge per card and a per-type count breakdown in the results line standing in for the grouped view shown in the spec's §14 mockup.
- **The still-open `"tokens"` category-slug question**, carried over unresolved from Phase 1 and Phase 2 — still not a blocker for anything Phase 3 needed, still worth deciding before Phase 4.

---

## Known limitations / decisions worth a second look

- **"Color" and "Color Theory" queries match all 40 Tokens and all 40 Palettes.** Every Token and Palette carries the fixed category pair `["color-theory", "systems"]` (Phase 1's decision, ported through Phase 2's `content-index.json` unchanged). Since the category-match weight (+35) and category-name matching apply to that fixed pair, any query touching "color" or "systems"/"design systems" legitimately scores and returns every Token/Palette record, not a curated subset. This is a correct, spec-following consequence of Phase 1's categorization choice, not a Phase 3 scoring bug — but it does mean color-related queries return large result sets (85 of 102 records, per Validation below) by design. Worth knowing about; not something Phase 3 should paper over by suppressing a spec-mandated scoring signal.
- **Tag/keyword weights rarely fire for Guides.** `guides.json` has no `tags`/`keywords` fields, so Phase 2 left those arrays empty (`[]`) on every Guide record (per its own handoff). The `tag`/`keyword` weights in the scoring model are exercised by Tokens/Palettes (which do have `tags`) but are effectively inert for Guides today. This isn't a Phase 3 defect — the weights are correctly implemented and will start contributing the moment Guide records gain real tags/keywords — but it's worth flagging so a future phase doesn't mistake "Guides never get a tag-match bonus" for a bug.
- **No stemming/fuzzy matching.** Matching is case-insensitive substring matching per term, exactly what the spec's §10–13 describe. "token" matches "tokens" (substring), but "colour" would not match "color", and a typo returns nothing beyond the generic empty-state tips. Out of scope per the spec (no external search service).

---

## Validation performed

All validation was run against the real, unmodified `content-index.json` (102 records: 22 guides, 40 tokens, 40 palettes) and the real `categories.json` (10 categories), using a jsdom harness that loads the actual `search.html` file, mocks `fetch()` to serve those two real JSON files, and drives the rendered DOM exactly as a browser would (click events on the filter buttons, `change` events on the category `<select>`, and reading back the rendered result list). This is a from-scratch harness built for this phase, not a reuse of Phase 2's validation tooling.

- **Reproducibility / scope:** re-ran `node build-content-index.js`; `content-index.json` came out byte-identical, confirming Phase 3 made no incidental change to the index. Diffed the entire Phase 2 checkpoint tree against the current tree (excluding `.git`): **`search.html` is the only file that differs.**
- **JS validity:** every inline `<script>` block in `search.html` parses cleanly (`new Function(body)` on each, no syntax errors).
- **Guide test (§24):** query `color` → 85 total results; both required titles present at the top — *"Color Contrast Is Math, Not Taste"* and *"A Color Palette Is a Token System, Not a Row of Swatches"* — ranked 1st and 2nd.
- **Token test:** query `starless frost` → 6 results; `token:starless-frost` and `palette:p001` rank 1st and 2nd (exact-title bonus), linking to `/tokens/starless-frost.html` and `/palettes#p001` respectively.
- **Token tag test:** query `night` → 24 results, exactly 12 Tokens and 12 Palettes — matches Phase 2's own cross-check that 12 tokens carry the `night` tag.
- **Palette test:** a unique palette/token name (e.g. "Amber Arcade") returns both the Token and its twin Palette.
- **Category test:** query `Color Theory` → 85 results (see "Known limitations" above for why that number is large and expected), with a Guide genuinely about color contrast ranked first.
- **Multi-word test:** query `color token` → top result is *"A Color Palette Is a Token System, Not a Row of Swatches"* (the one Guide whose title contains both terms), correctly outranking results that only match one term — confirms §13's requirement.
- **Empty test:** query `xyznotreal123` → empty-state shown, message reads `No results found for "xyznotreal123".`, tips list reads "Try a broader keyword / Use fewer words / Check the spelling", results list is empty, no occurrence of the word "guides" anywhere in the empty state.
- **Type filter test:** `?s=color&type=token` → 40 results, all `type === "token"`, no Guides or Palettes; the Tokens tab shows `aria-pressed="true"`. Clicking the "All" tab afterward restores all three types and removes `type` from the URL.
- **Category filter test:** `?s=color&category=spacing` → 0 results (correct: no color-related Guide is categorized "Spacing & Layout", and Tokens/Palettes are never categorized "spacing"). The category `<select>` correctly shows "Spacing & Layout" selected.
- **Invalid filter values:** `?type=bogus` and `?category=bogus-slug` both fall back to "All" without throwing, and the corresponding control reflects "All"/"All Categories".
- **Category options:** the `<select>` is populated with exactly the 10 categories from `categories.json`, in that file's own `order`, plus the built-in "All Categories" option — nothing hard-coded.
- **No-query landing state:** `/search.html` with no `s` param shows the generalized heading ("Search") and dek (mentions guides, tokens, and palettes), filters hidden, no results grid, no empty state — the word "guides" no longer appears anywhere except inside the phrase "find a guide, token, or palette" and the "Browse all guides" link (which still correctly points at the real Guide homepage).
- **XSS/escaping:** a query of `<img src=x onerror=alert(1)>` renders as literal escaped text everywhere it appears (page title, heading, empty-state message); no `<img>` or `<script>` tag is present anywhere inside `#search-content` afterward.
- **Existing URLs:** spot-checked that result hrefs match real files/anchors — `/guide/<slug>.html` and `/tokens/<slug>.html` files exist on disk (already validated in Phase 2), and `/palettes#<id>` is resolved by Phase 2's unmodified `focusPaletteFromHash()`.
- **No console errors** were raised by `search.html`'s own script during any of the above scenarios (checked by intercepting `console.error` during a combined `type` + `category` + query load).

---

## Current state

```
search.html               MODIFIED   fetches content-index.json + categories.json; query
                                      normalization, weighted multi-word scoring, type/category
                                      filters synced to the URL, generalized empty state, one
                                      normalized card renderer for Guides/Tokens/Palettes
bpozz-phase-3-handoff.md  NEW        this file
content-index.json         UNCHANGED  Phase 2 state (102 records) — reproducibility re-verified
categories.json             UNCHANGED  Phase 2 state (10 categories)
build-content-index.js      UNCHANGED  Phase 2 state
guides.json                 UNCHANGED  Phase 1 state (+categories[] on all 22 entries)
palettes/palettes.js        UNCHANGED  Phase 2 state (+focusPaletteFromHash())
palettes/palettes.css       UNCHANGED  Phase 2 state (+.palette-card--highlight)
(all other files)           UNCHANGED  byte-identical to the Phase 2 checkpoint
```

---

## Starting point for Phase 4

Phase 4 is the homepage — making Tokens and Palettes first-class homepage discovery content alongside Guides (`bpozz-global-search-spec-v2.md` §3–4 background; the actual Phase 4 spec, if separate from the global-search spec, wasn't provided as part of this handoff's inputs). Relevant groundwork already in place from Phases 2–3:

- `content-index.json` already has the normalized `{id, type, title, slug, url, description, categories, tags, keywords, searchText}` shape for all three content types, if Phase 4 wants to reuse it for homepage rendering rather than reading `guides.json`/`tokens.json`/`palettes-data.json` directly. Whether to do that, or read the source files directly the way `build-home.js` does today, is an open Phase 4 decision — Phase 3 didn't need an opinion on it.
- `categories.json` — with its `order` field — is the source of truth for category display names and ordering; Phase 3's category filter derives entirely from it, and Phase 4's category pages will likely want the same approach rather than a second hard-coded list.
- The still-unresolved `"tokens"` category-slug question (carried since Phase 1) becomes relevant the moment Phase 4 renders Tokens/Palettes on category pages — worth deciding before that work starts, not during it.
- `app.js` and `build-home.js` are still exactly as they were before Phase 2 — genuinely untouched by any of Phases 2–3 — so Phase 4 is starting from the original, unmodified homepage implementation described in `bpozz-global-search-spec-v2.md` §3.
- Search itself (`search.html`) is now fully wired to all three content types and does not depend on anything Phase 4 will change; Phase 4 rendering the homepage differently should have no effect on Search, and vice versa.
