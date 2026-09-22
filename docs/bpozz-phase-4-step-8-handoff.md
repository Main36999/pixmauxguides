# Step 8 — Shared `<head>` / common HTML cleanup

Scope: the duplicated `<head>` frame and the common document scaffolding in
the two modules that write pages from scratch. No URL, no route, no canonical,
no metadata value, no JSON-LD, no layout, no behaviour — and, as it turned
out, **no rendered byte anywhere**. Search (Step 5), the content/schema
architecture (Step 6), the SEO/JSON-LD semantics (Step 7) and the
accessibility work (Step 9) are untouched.

## 1. The duplication as it was found

### Two writers, two complete copies of one `<head>`

`render` runs five builders. Three are patchers (`home`, `header`, `footer`)
and touch no `<head>` at all. The two writers each carried a full copy of the
site's head frame:

| module                        | how it held the frame                                  |
| ----------------------------- | ------------------------------------------------------ |
| `src/build/guide-template.js` | four constants: `DOC_OPEN`, `HEAD_CONSENT`, `HEAD_ANALYTICS`, `HEAD_ASSETS` (+ `HEAD_CLOSE`) |
| `src/build/categories.js`     | literal text inside one ~100-line template literal      |

They were not "similar". Measured band by band, they are the **same bytes in
the same order**, with exactly two differences:

1. the Consent Mode v2 explanatory comment (346 B) is on the guide pages and
   not on the category pages;
2. the guide pages load `/guide-article.css` after `/styles.css`.

Everything else — the Cookiebot tag, the consent default script, `<meta
charset>`, the gtag.js block, `theme-color`, both icons, the two font
preconnects, the DM Sans stylesheet, `/styles.css`, the doctype, `<html
lang>`, the `<head>` open and close — is byte-identical.

Measured across the whole site, these bands are byte-identical on **all 41
published pages**, hand-authored ones included:

```
DOC_OPEN         42 B   41/41      THEME_AND_ICONS  190 B   41/41
COOKIEBOT       211 B   41/41      FONTS            307 B   41/41
CONSENT_DEFAULT 596 B   41/41      HEAD_CLOSE        11 B   41/41
CHARSET          29 B   41/41      HEAD_ANALYTICS   354 B   41/41
```

### The marker contract had three spellings, and one was unchecked

`guide-template.js` declared `HEADER_START/END` and `FOOTER_START/END`;
`categories.js` wrote the same four as bare literals inside its template;
`header.js` and `footer.js` declare their two each. `guides.js`'s
`assertMarkersAgree()` cross-checked the template's against the patchers' —
but **the category pages were outside that check**. A typo in
`categories.js`'s literals would have published 10 pages with a raw,
unpatched partial in them, and every gate would have stayed green.

### The common body scaffolding

Both writers also emitted the same shapes independently: the skip link, the
two marker regions, and `<script src="/app.js"></script></body></html>`.

## 2. What Step 8 changed

One rule: **a band that is identical in two writers is declared once, and a
difference between them is a value, not a second copy.**

- **`src/build/head.js` (new)** — the one shared `<head>` frame and document
  scaffolding. `headHtml()` states the band order once (consent before
  gtag.js; structured data last) and takes the per-page bands — `meta`,
  `social`, `structuredData`, `after` — as text from its caller. Pure: no
  `fs`, no `ctx`, no config, no escaping. It builds **no JSON-LD**; structured
  data arrives already rendered from `src/build/structured-data.js`, exactly
  as it did when the two writers spliced it themselves.
- **`src/build/guide-template.js`** — the four frame constants are gone. Each
  is re-exported at the same name with the same bytes, so `guides.js` and
  `guide-template.test.js` bind to them unchanged; `pageHtml` composes the
  head with `head.headHtml`. What stayed is what is genuinely the guide
  page's: the six-slot content format, the recorded `format` drift, the guide
  layout, the rail and the toast.
- **`src/build/categories.js`** — the inline head is gone. What it composes
  now is its own `meta` and `social` bands, which are built from values
  (title, description, canonical, ogImage) rather than transcribed.
- **The two differences are `HEAD_OPTIONS`**, one per writer:
  `{ consentNote: true, stylesheets: [site, guideArticle] }` for guides,
  `{ consentNote: false, stylesheets: [site] }` for categories. Neither is
  normalized — either change would change what those pages ship.
- **`src/build/guides.js`** — `assertMarkersAgree()` now also asserts the
  template's markers against `head.js`'s, so the check covers **every page the
  build writes from scratch**, category pages included, and a future private
  literal in either writer cannot slip back out of coverage.

Shared `<head>` markup spelled out inside the two page writers:
**3,898 B in two copies → 0 B**, declared once in `head.js` instead.

## 3. What was deliberately NOT changed

- **The 13 hand-authored pages keep their own copies.** `index.html`,
  `about.html`, `contact.html`, `privacy.html`, `terms.html`, `roadmap.html`,
  `search.html`, `guides/index.html` and `palettes/index.html` each carry the
  same bands. Centralizing them means **generating** their `<head>`, which
  means generating the hand-authored JSON-LD four of them carry (Step 7's
  scope, which explicitly deferred it here) and rewriting `search.html`
  (Step 5's). Neither is this step's to open. What this step does for them
  instead is make the duplication **verified rather than merely present** —
  see the new test below.
- **`header.js` and `footer.js` keep declaring their own markers.** They own
  those regions, and a check between two independent declarations is worth
  more than one constant shared by everyone.
- **The skip link's target id and label are not normalized.** `#guide-content`
  / "Skip to guide" against `#category-content` / "Skip to content" is
  accessibility work — Step 9's.
- **Seven root pages spell the stylesheet relatively** (`href="styles.css"`,
  not `/styles.css`). At depth 0 the two resolve to the same URL, so it is
  wrong on no page, but it is a second spelling. Recorded in
  `head.test.js`, not changed: normalizing it changes their deployed bytes.
- **`docs/archive/_TEMPLATE.html`** still contains a full hand-copied head.
  It is archived and builds nothing; flagged by Step 7, still not edited.

## 4. Gates

**No approval run was needed, and none was made.** The build's own `verify`
stage reported **91 files byte-identical to the approved output** on the first
build after the change, which is the strongest available statement that this
step moved nothing: `approved-output.json` and both baselines are untouched.

| gate | result |
| ---- | ------ |
| `npm run build` | ✓ `verify`: 91 files byte-identical to the approved output |
| `npm test` | ✓ 43 tests pass (33 existing + 10 new) |
| `npm run snapshot` | ✓ 89 URLs, 41 HTML checksums |
| `npm run check:urls` | ✓ 89 before and after, allowlist empty and unused, every surviving page canonical unchanged |
| `npm run check:baseline` | ✓ 41 pages byte-identical to the approved baseline, all content/palette checks pass |
| independent `dist/` diff | ✓ 91/91 files identical, 0 added, 0 removed |
| rebuild | ✓ byte-identical to the previous build (determinism preserved) |

`guide-template.test.js`'s 11 tests — which diff every one of the 22 rendered
guide pages against its committed file byte for byte — passed unchanged, and
its frame assertions now check that the **shared** frame is what a guide page
carries rather than that one file agrees with itself.

**`src/build/head.test.js` (new, 10 tests)** asserts what the byte-level gates
structurally cannot. A re-introduced second copy of a band produces identical
output, so `verify`, `check-baseline` and the template diff would all stay
green — which is exactly the state this step found the repo in. It asserts:

1. all 41 published pages carry the shared bands byte for byte, the 13
   hand-authored ones included, so the copies that remain cannot drift;
2. **no writer carries a private copy of a band** — checked against the
   modules' own source, not their output;
3. the variations are still exactly the two documented ones, and are still the
   ones the published pages actually ship;
4. `headHtml` emits the bands in the one load-bearing order;
5. every page carries exactly one of each marker, and one spelling reaches the
   patchers.

## 5. Remaining Step 8 issues

1. **The 13 hand-authored pages still duplicate ~1.7 KB of head each** (≈22 KB
   across the site). Removing it means generating those pages, which requires
   Step 7's hand-authored JSON-LD and Step 5's `search.html` to move first. The
   duplication is now gated against drift, not eliminated.
2. **Two head variations survive as data.** Emitting the Consent Mode v2
   comment on the 10 category pages is a one-word change here and 10 changed
   output files; it is a formatting decision with its own approval.
3. **`docs/archive/_TEMPLATE.html`** would reintroduce a hand-copied head to
   anyone who follows its own instructions. Carried over from Step 7.
4. **Seven root pages use the relative stylesheet href.** One-line each
   whenever those pages' `<head>` is next opened.
