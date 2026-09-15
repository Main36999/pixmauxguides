# Color Palette Library (/tokens) — bpozz web (COMPLETE)

## Goal

Add a palette browsing/building tool in the spirit of colorhunt.co, but
built around bpozz's own editorial stance: **a palette is a token
system, not a row of swatches.** Full spec: `bpozz-color-palette-feature-brief.md`
(the build brief this feature was built from — every §-numbered
reference below points back into it).

Every design decision in the brief's §2 comparison table is a real,
working difference, not just marketing copy: semantic roles instead of
anonymous swatches, computed WCAG contrast (not asserted), real export
formats, computed dark-mode variants, an accessibility-based sort with
actual signal, and cross-links into the existing guide library in both
directions.

## Site architecture (context for whoever picks this up)

Static HTML/CSS/vanilla-JS, no framework or bundler — see
`GUIDE-STYLE-GUIDE.md` and `HEADER-REDESIGN-HANDOFF.md` for the base
site's conventions. This feature follows the same patterns throughout
rather than introducing new ones:

- **Build scripts, not a server.** `build-tokens.js` is a Node script
  (same family as `build-home.js` / `build-categories.js`) that reads
  `tokens.json` and writes real, static `.html` files. Nothing is
  rendered at request time.
- **SSR + client-side re-render.** The gallery grid ships pre-rendered
  (works with JS off, crawlable) and `tokens-gallery.js` re-renders it
  client-side for live filter/sort — the exact relationship `app.js`
  already has with the homepage's guide grid.
- **No accounts system.** Confirmed before building anything (Build
  Note #1): bpozz has none. The only existing precedent for "a
  visitor's state that persists" is the roadmap page's progress
  checklist — plain `localStorage`, no login. Collections (§3.6)
  follow that same precedent rather than inventing accounts for one
  feature. See "Key decisions" below for the actual tradeoff.

## What was implemented

**Accessibility engine (§3.5) — built first, everything else depends on it**
- `tokens-color.js` — hex/RGB/HSL conversion (pure, no DOM)
- `tokens-a11y.js` — relative luminance, contrast ratio, WCAG badges,
  and `computeAccessibilityScore()` — the one function every score in
  the feature comes from
- `tokens-a11y.test.js` — 16 tests, `node --test tokens-a11y.test.js`.
  Pins known reference values (black/white = 21:1) and the exact
  scoring behavior, including a case that demonstrates why this has to
  be real math: a plausible-looking palette where white text reads
  fine on the background but fails outright on the brand color.

**Data (§3.1, §4, Build Note #3)**
- `scripts/generate-palettes.js` — deterministic generator, 8 mood
  recipes (Pastel, Vintage, Neon, Earth, Night, Monochrome, Retro,
  Jewel) × 4 variants = 32 palettes, plus 8 computed dark-mode variants
  for the lightest ones (40 total) → `tokens.json`. Every
  `accessibility_score` in the file was computed by `tokens-a11y.js` at
  generation time, not hand-typed.

**Export formats (§3.3, shared logic)**
- `tokens-export.js` — CSS, SCSS, Tailwind config, JSON (as a real W3C
  Design Tokens / DTCG color object — matches
  `guide/color-palette-token-system.html#dtcg-color`, so the export
  format is an application of that guide, not a one-off shape), Figma
  Variables (real `{r,g,b,a}` 0-1 float shape from Figma's own
  Variables API), iOS (Swift `Color` extension), Android (`colors.xml`)

**Shared runtime (`tokens-shared.js`)**
- Palette card markup (`cardHtml`) — sits inside the site's real
  `.grid > .guide-card` structure, same rhythm as the homepage
- Collections: `localStorage` under `point-token-collection` (saved
  seed-gallery slugs) and `point-custom-palettes` (full builder-made
  palettes) — naming matches the roadmap page's existing
  `point-roadmap-progress` convention
- Clipboard/toast helpers (calls `window.bpozzShowToast`, exposed by a
  small, additive change to `app.js`'s existing toast — see "Files
  touched outside `/tokens`" below)

**Pages (`build-tokens.js` generates all of these from `tokens.json`)**
- `/tokens` — gallery: family filter (reuses `.field.select-field`,
  the same control as the homepage's level filter), mood chips (reuse
  `.badge`'s monospace look, not colorful pills — brief §5), sort
  (New / Popular / Most Accessible)
- `/tokens/<slug>` — 40 detail pages: breakdown table (role → hex →
  RGB → HSL → contrast vs. white/black → WCAG badge), a live-preview
  mock UI card rendered with the palette's own tokens, a light/dark
  toggle when a paired variant exists, the 7-format export panel, and
  a "Related Guides" module linking 2-3 guides back into the library
  (§3.3's required reverse cross-link)
- `/tokens/create` — builder: manual role editor (fixed 7-role
  vocabulary — see scope trim below) with a **live** contrast checker
  (`tokens-create.js` re-runs `computeAccessibilityScore()` on every
  edit and renders failures as `.guide-callout--danger` blocks,
  reusing the guide component rather than inventing an alert style),
  plus local image color extraction (canvas + coarse RGB-bucket
  quantization, nothing uploaded) with a one-click auto-assign into
  roles
- `/tokens/collection` — the visitor's saved palettes, resolved from
  `localStorage` + `tokens.json`

**Integration into the rest of the site**
- `partials/header.html` / `partials/header-home.html` — added a
  "Tokens" nav link between Color Theory and Typography, synced
  site-wide via `build-header.js` (43 files touched)
- `guide/color-contrast-systems.html`,
  `guide/color-palette-token-system.html`,
  `guide/dark-mode-second-palette.html` — each got one `.guide-cta`
  block linking back into the tool (contrast guide → gallery, token
  guide → builder, dark-mode guide → a real palette with a working
  dark-mode toggle), so the cross-linking in Build Note #5 goes both
  directions, not just palette → guide
- `sitemap.xml` — added `/tokens`, `/tokens/create`, and all 40 detail
  pages (`/tokens/collection` deliberately excluded — see below)
- `_htaccess` — clean-URL rewrite rules for `/tokens/<slug>`, mirroring
  the existing `/guide/<slug>` / `/category/<slug>` rules.
  **`_redirects` needed no change** — Netlify's Pretty URLs toggle
  already covers every `.html` file site-wide, these included.

## Key decisions & why

**Accessibility score = two kinds of pairing, not one flat rule.**
The first working version checked the palette's `text` role against
*every* other role at the 4.5:1 text threshold, including `primary`/
`secondary`. That's wrong: a brand/button color is normally paired
with its own dedicated label color, not the page's general body-text
color, so this flagged most real, working palettes as "inaccessible"
for a pairing no interface actually uses. The corrected model (see
`tokens-a11y.js`'s top comment): `text` is checked against canvas
roles (`background`, `surface`) at 4.5:1; `primary`/`secondary` are
checked against `background` at the WCAG 1.4.11 non-text ratio (3:1)
— "can you tell this color apart from the page", not "would body text
be legible painted on top of it." The 16 unit tests were written
against this corrected model.

**Card badge and "Most Accessible" sort use the WEAKEST pairing, not
an average.** A flattering mean would hide a single bad pairing behind
several good ones. "A palette's contrast is only as strong as its
weakest link" is both more honest and more useful at a glance —
several palettes in the seed set genuinely show a `Fail` badge, and
that's the engine working correctly, not a bug.

**Dark-mode variants are derived, not inverted.** `deriveDarkVariant()`
in `scripts/generate-palettes.js` follows the same reasoning
`guide/dark-mode-second-palette.html` teaches: elevate surfaces with
lightness rather than shadow, desaturate vivid accents so they don't
"vibrate" on near-black, and never land text on pure white. Generated
for the 8 lightest of the 32 base palettes, cross-linked both ways
(`dark_variant_slug` / `light_variant_slug` — the second field is an
additive, documented extension beyond the brief's own JSON example,
needed so the *dark* palette's own detail page can also toggle back to
light).

**No accounts → `localStorage` collections, scoped to the device.**
This is the direct, deliberate answer to Build Note #1. The tradeoff:
a saved palette (or a builder-made one) exists only in the browser
that saved it — no sync across devices, no server-side backup, cleared
if the visitor clears site data. Adding real accounts to fix this
would be a site-wide change far outside this feature's scope; the
`/tokens/create` page says as much directly to the visitor rather than
implying a save is more durable than it is.

**`/tokens/collection` is excluded from `sitemap.xml`.** It has no
unique server-renderable content for an anonymous crawler — every
visitor's collection is empty until their own browser fills it in
client-side. Indexing it would just be indexing an empty state.

## Known limitations / deliberate scope trims

- **Builder: fixed role vocabulary only.** The brief mentions "a fixed
  list (or custom role name)" — the fixed list (background / surface /
  primary / secondary / accent / text / border) is fully implemented;
  free-form custom role names were left out rather than shipped as a
  half-working input squeezed into a 4-column grid row. Documented in
  `tokens-create.js`'s header comment as the natural next increment.
- **Image extraction auto-assigns, rather than click-to-assign.**
  Clicking an extracted swatch to drop it onto a specific role row
  would need either a second click-target per role or a "currently
  selected color" mode with its own UI; the shipped version instead
  sorts extracted colors by lightness/saturation and assigns all six
  roles in one action, which the visitor can then hand-edit in the
  always-visible role list immediately afterward. A real, useful
  starting point rather than a fragile interaction.
- **No drag-reordering, no >6-role palettes.** Matches the brief's
  "4-6 color blocks" card spec exactly; going beyond it would break
  the card thumbnail layout brief §5 asks to reuse as-is.

## How to rebuild

```bash
node scripts/generate-palettes.js              # regenerate tokens.json (only if you want new seed data — it's deterministic, so a re-run without code changes produces the same file)
node build-tokens.js                           # regenerate every /tokens/*.html page from tokens.json
node build-header.js && node build-footer.js   # resync nav/footer into the newly-written pages
node --test tokens-a11y.test.js                # run the accessibility engine's unit tests
```

## Verification done

- `node --test tokens-a11y.test.js` → 16/16 passing
- Every generated file under `/tokens` (43 total: index, create,
  collection, 40 detail pages) scanned for unresolved template
  literals, `undefined`, and `[object Object]` leaks — none found
- One full detail page manually reviewed end-to-end (hero, breakdown
  table, live preview, export panel, related guides)
- `node build-header.js && node build-footer.js` run after adding the
  nav link — 43 files updated, 0 errors, only the pre-existing,
  intentionally-excluded `bpozz-search-demo.html` skipped (see
  `HEADER-REDESIGN-HANDOFF.md` — not something this feature touched)
- `sitemap.xml` validated as well-formed XML after adding 42 new URLs
- Found and fixed a real bug during review: three `aria-label`s and one
  tooltip were JSON-stringifying a plain string instead of HTML-escaping
  it (`escapeAttr(p.name)` where `escapeHtml(p.name)` was meant),
  which would have shown literal stray quote marks in screen readers
  and tooltips. Fixed in `tokens-shared.js`, rebuilt, re-verified.

## Key files to open first

- `bpozz-color-palette-feature-brief.md` — the spec everything above maps to
- `tokens-a11y.js` — the accessibility engine + its own "why" comments
- `scripts/generate-palettes.js` — where the 40 seed palettes and their
  dark variants come from
- `build-tokens.js` — turns `tokens.json` into every `/tokens/*.html` page
- `tokens-shared.js` — card markup + collections, shared by every page
- `tokens-create.js` — the builder's live checker + image extraction
