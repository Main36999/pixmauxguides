# Step 9 — Accessibility cleanup

Scope: accessibility defects in the published output, fixed at their source.
No URL, no route, no canonical, no metadata value, no JSON-LD, no shared
`<head>`, no search behaviour, no content schema — and, on every page the
fixes touch, **no moved pixel**. Steps 4–8 are locked and were not reopened.

## 1. How the audit was run

axe-core could not be used: the npm registry is unreachable from this
session (403 on every package). Chromium and Playwright are present, so the
audit used the browser itself, which is a stronger instrument for the two
questions that actually decide these defects:

| instrument | what it answers |
| ---------- | --------------- |
| static pass over all 41 built pages (`lxml`) | structure: headings, landmarks, labels, alt, ARIA references, duplicate ids, tabindex |
| CDP `Accessibility.getFullAXTree` | what a screen reader is **actually** handed, hidden subtrees excluded |
| real `Tab` walk, element by element | focus order, and whether a stop is reachable at all |
| screenshot diff of each control, focused vs not | whether a focus indicator **visibly exists** — the only honest test |

The last one earned its place. A computed-style diff says
`#header-search-input` changes `border-color` on focus and looks fine; the
pixel diff says zero pixels move, because that border is `border: none` and
0px wide. Four of the five "no focus indicator" candidates the style pass
produced were false alarms for reasons like that. Only one survived pixels.

Two findings the static pass produced were checked against the real AX tree
and **dismissed** rather than fixed — see §4.

## 2. What was fixed

### F1 — the header search pill had no focus indicator at all (40 pages)

`.site-header--inner .input:focus { outline: none }`, with nothing put back.
Measured: **0 changed pixels** between focused and unfocused, on every page
carrying the inner header. The only control on the site in that state — the
hero search ring, the contact fields' underline and the level filter's
colour change all move real pixels. WCAG 2.4.7 (AA) failure.

`.site-header--inner .input:focus-visible` now restores the site-wide
`2px solid var(--action)` ring. It is restated locally rather than left to
the global `:focus-visible` at the top of the file because
`.site-header--inner .input:focus` outranks a bare `:focus-visible`; equal
specificity, so the new rule sits **after** it.

**This one has a cost, and the source comment states it.** The original
intent was "the pill looks identical clicked or not". It cannot be kept: a
focused text field always matches `:focus-visible` (spec, every current
engine — verified by clicking the field and reading back
`.matches(':focus-visible') === true`), so the ring shows for pointer focus
too. Keeping the clicked pill bare means keeping the keyboard broken. The
cost is narrower than it sounds: the **resting** appearance, which is what
that design note is about, is untouched, and clicking the hero search, any
contact field or the level filter already restyles them today. This brings
the last of the six into line with the other five.

### F2 — roadmap.html exposed no `main` landmark

The only one of 41 pages without one, and its skip link pointed at a
non-focusable `<section>`, so "Skip to roadmap" moved nothing. Every other
page targets a `<main id=… tabindex="-1">`.

`role="main"` + `tabindex="-1"` on the existing `<section id="roadmap">`.
The element, its classes and its markup are unchanged, so nothing in the
layout or the CSS cascade moves — which a `<section>` → `<main>` swap could
not have promised. Verified: Tab, Enter on the skip link now lands focus on
`SECTION#roadmap role=main`.

### F3 — heading level skipped h1 → h3 on 10 category pages

Category card titles were `h3`, but a category page's grid hangs directly
off its `<h1>` with no section heading between — unlike the home and
`/guides` grids, which sit under an `<h2>` ("/ featured_guides",
"/ all_guides") where `h3` is correct.

The shared renderer (`src/shared/card.js`) takes a `titleTag` option,
defaulting to `"h3"`, and only `categories.js` opts into `"h2"`. A value,
not a second copy of the card — the same shape the badge argument already
had. Home, `/guides` and the client-side search renderer are byte-identical.
Only `h2` and `h3` are accepted; anything else falls back to `h3` rather
than interpolating caller text into a tag name.

### F4 — heading level skipped h1 → h3 on roadmap.html

Stage titles (`Foundations`, …) were `h3` directly under the page `h1`. Now
`h2`. `.roadmap-stage-title` carries the size and weight and `styles.css`
resets margin for `h1, h2, h3` alike, so the rendering is identical.

### F5 — Escape in the mobile menu dumped focus to `<body>`

Reproduced with a real keyboard: open the menu, Tab to a link inside it,
press Escape — the panel goes `hidden` with focus still on that link, so
focus collapsed to `<body>` and the next Tab restarted from the top of the
document. WCAG 2.4.3.

`closeMobileMenu()` now returns focus to `#menu-toggle`, **guarded on focus
actually being inside the panel**, so the other three callers — a page-wide
Escape with focus elsewhere, a `hashchange`, a resize past 640px — behave
exactly as before and never pull focus to the header. Verified both ways.

### F6 — the contact form's success message was never announced

On success the whole form, including the button just pressed, is replaced
by a success block carrying no live region — no confirmation for a screen
reader (WCAG 4.1.3). `role="status"` added to that block, in both copies:
`src/client/contact.js` (the in-app `#/contact` view) and the standalone
`contact.html`, which carries its own copy of the same script. Markup,
wording and styling untouched.

## 3. Proof that nothing else moved

`verify` reported **14 changed, 0 added, 0 removed** on the first build —
the 10 category pages, roadmap, contact, `styles.css` and `app.js`, and
nothing else. No guide page, no home page, no `/guides`, no palettes, no
`search.html`, no sitemap, no JSON endpoint.

A token-level diff of all 14 against a pristine build of the Step 8 tree
shows **every changed token is one of**: `h3`→`h2`, the added
`role`/`tabindex`/`role="status"` attributes, the new `:focus-visible` rule,
the `titleTag` variable, the focus-restore lines, and comments. No href, no
visible text, no metadata, no JSON-LD.

Screenshot diffing was run first and was **not** trusted on its own: a
control run of the pristine build against **itself** reproduced the same
artifacts (identical bounding boxes and energies) on an overlapping random
set of pages, including pages whose bytes never changed. It is webfont and
SVG rasterisation timing, not a regression.

So the claim is made deterministically instead. For 20 pages at 1280px and
375px, every element's box geometry and computed typography was compared
between builds:

```
/roadmap.html          286 els  IDENTICAL LAYOUT  [4 × h3->h2]
/category/*.html    73–165 els  IDENTICAL LAYOUT  [1–4 × h3->h2]
/contact.html           79 els  IDENTICAL LAYOUT
/guides/index.html     487 els  IDENTICAL LAYOUT
/guide/…, /about, /privacy, /terms, /search   IDENTICAL LAYOUT
```

Every element, same position, same size, same font, same colour. The only
structural difference anywhere is the intended `h3`→`h2`. (`/index.html` and
`/palettes/index.html` report sub-pixel noise from their in-flight
`.fade-up` and staggered card fade — the self-control run reproduces it at
greater magnitude, and both pages are byte-identical between the builds.)

Focus order was compared stop by stop on 9 representative pages: **identical
on every one**, same count and same sequence.

## 4. Audited and deliberately NOT changed

- **Two `<nav aria-label="Primary">` per page.** The static scan flags this
  on all 41 pages; the AX tree says only one is ever exposed. At ≤640px
  `.site-nav` is `display:none` and the panel carries `hidden`; above 640px
  the toggle is `display:none`, so the panel cannot be opened at all.
  Measured: desktop `['Primary','Footer']`, phone closed `['Footer']`, phone
  open `['Footer','Primary']`. Not a defect.
- **20 "unlabelled" `<svg>` on roadmap.** All 20 are inside
  `aria-hidden="true"`; the scanner reads the svg's own attribute. Correct
  as decoration.
- **Skip link wording.** Step 8 flagged `#guide-content`/"Skip to guide"
  against `#category-content`/"Skip to content" as Step 9's. The *target*
  half was a real defect and is F2. The *label* half is not: each label
  describes its destination, and normalising them changes visible text on
  the pages — a UI change for no accessibility gain. Left as is.
- **Menu toggle keeps `aria-label="Open menu"` while expanded.** Correct
  disclosure pattern; the state is on `aria-expanded`, which is toggled.
- **Card thumbnail `alt` repeats the card title.** Redundant, not a
  violation, and emptying it is a content decision rather than a fix.
- **`#results-count` is not a live region.** A filter result count is a
  status message (WCAG 4.1.3), but a live region there also announces
  "Loading guides…" on every page load. That is a behaviour change with a
  judgement call in it; flagged, not taken.
- **Colour contrast.** Outside this step's stated scope, and any fix
  changes the visual design.

## 5. Gates

| gate | result |
| ---- | ------ |
| `npm run build` | ✓ 91 files, `verify` green against the re-recorded manifest |
| `npm test` | ✓ 43/43 (unchanged; no test edited, added or skipped) |
| `npm run snapshot` | ✓ 89 URLs, 41 HTML checksums |
| `npm run check:urls` | ✓ 89 before and after, allowlist empty and unused, every page canonical unchanged |
| `npm run check:baseline` | ✓ 41 pages byte-identical to the re-recorded baseline, all content/palette checks pass |
| rebuild | ✓ byte-identical to the previous build (determinism preserved) |
| independent `dist/` diff vs Step 8 | ✓ 14 changed, 0 added, 0 removed |

`guide-template.test.js`'s 11 tests diff all 22 rendered guide pages byte
for byte and passed untouched — the guide surface did not move.

**Two approval runs were needed, and both are recorded, not reviewed:**

    BPOZZ_APPROVE_OUTPUT=1 npm run build       # scripts/qa/approved-output.json
    BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline

`approved-output.json` moved 14 entries; `baseline/html-checksums.json`
moved 12 (the HTML subset). `baseline/url-snapshot.json` did **not** move —
the URL surface and every canonical are untouched, which is why
`check-urls.js`'s allowlist stayed empty. The diffs of those two files are
the review material for this step.

## 6. Remaining Step 9 issues

1. **`search.html` repeats the category pages' heading skip.** Its results
   render `h3.card-title` directly under the page `h1`, the same defect F3
   fixed. Step 5 is locked, so it was identified and not touched. The fix is
   the same one-line opt-in: pass `titleTag: "h2"` where `search.js` builds
   its result cards.
2. **The home page's `<h1>`, hero search and trending grid sit outside any
   landmark.** `<main id="guides">` starts below the hero, so that content
   is in no landmark and the skip link jumps past the `h1` and the search
   box. Fixing it means restructuring the hero into `<main>`, which moves
   layout (`.wrap` on main, `.hero` full-bleed) — out of scope for an
   accessibility-only step. Needs a deliberate layout change.
3. **Focus is not managed after the contact form succeeds.** F6 makes the
   result announced; it does not move focus, which is still dropped when the
   submit button is removed from the DOM. The reliable fix is focusing the
   success heading, which is a behaviour change worth deciding on its own.
4. **`#results-count` (WCAG 4.1.3)** — see §4.
5. **Colour contrast has not been audited.** Out of this step's scope.
