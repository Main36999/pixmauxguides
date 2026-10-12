# bpozz brand reference

How to name bpozz in documentation, code comments and product copy.
Internal record, not published (`docs/` is not in the build's
`PUBLISH_DIRS`).

Each section says whether it is:

- **Established**: a decision that the current source already follows.
- **In use**: current site copy or styling, with no further rule recorded.
- **Not specified**: nothing has been decided.

## Name (established)

- The brand name is `bpozz`: lowercase, one word, no punctuation.
- It stays lowercase at the start of a sentence and in headings and page
  titles: "bpozz is ...", "About bpozz", "UI/UX Design Guides — bpozz".
- Structured data names the website and the organization `bpozz` and
  declares no `alternateName`.
- `bpozz.com` is the website address, and `https://bpozz.com` is the
  canonical origin (`site.config.js`). Use the domain when you mean the
  address, not as the brand name.

Do not write `Bpozz`, `BPOZZ` or `bpozz!` as the brand name.

## Focus (established)

bpozz is about UI/UX design resources and learning. Its sections, by page
title: UI/UX Design Guides, Learning Roadmap, Free Fonts, Color Palettes,
Color Library and Image Picker.

## Descriptions (in use)

Current site copy. Quote it exactly; this document does not turn it into a
formal tagline or mission statement.

- Descriptor, used in the homepage and About meta descriptions, the
  homepage structured data and the About intro: "bpozz is an independent
  platform for practical design tools, resources, guides, and insights for
  people who design and build digital products."
- Homepage heading (H1) and the line in the site footer: "Design
  intelligence for building better digital products."
- Homepage and About title suffix: "Design Intelligence for Digital
  Products".

These lines were introduced in commit `179c8bd` (2026-10-04).

## Name versus logo (in use)

The name is text. The logo is a visual treatment of that text, and its
styling never changes how the name is written.

- **Header wordmark.** The HTML text `bpozz`, set in the Damion typeface
  (SIL OFL 1.1) under its own font-face name, "Damion Wordmark". Its
  accessible name is "bpozz home". See `partials/header.html` and the
  "header wordmark" block in `src/styles/styles.css`. The script face,
  size and colors are logo styling only.
- **Icons.** `assets/favicon.png` (favicon), `assets/apple-touch-icon.png`
  (touch icon and footer mark) and `assets/logo.png` (organization logo in
  structured data, `src/build/structured-data.js`).
- **Older logo files.** The built header does not use
  `assets/bpozz-logo.svg` or the `assets/bpozz logo*` exports. Some
  committed page sources still contain the old `<img class="brand-logo">`
  header markup; the build replaces it. Their artwork is not a naming
  reference.

## Code identifiers (established)

Identifiers follow their language's conventions and are not brand text:
for example the environment variables `BPOZZ_APPROVE_OUTPUT` and
`BPOZZ_WRITE_BASELINE`, and the browser globals `window.BpozzAuth`,
`window.BpozzSaved` and `window.BpozzCards`. Leave them as they are.

## Retired forms

- `bpozz!` was the public name from commit `179c8bd` (2026-10-04) until
  commit `ad8bea0` (2026-10-05) replaced it with `bpozz`.
- `BPOZZ` still appears in some older comments and historical documents.
  Historical documents keep their original wording; new text uses `bpozz`.

## Not specified

Nothing has been decided yet for:

- a formal tagline, slogan or mission statement;
- brand colors, typography or design tokens beyond the header wordmark's
  current styling;
- logo usage rules (clear space, minimum size, color or reversed
  versions);
- whether the Damion wordmark is the permanent logo;
- tone of voice.

Add an item here only once it has been decided.
