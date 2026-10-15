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

## Positioning (established)

- Positioning: "A Creative Platform for Graphic Designers."
- Full brand expression: "bpozz — A Creative Platform for Graphic Designers."
- Where the line stands on its own (homepage headline, footer tagline,
  social preview image), write it exactly as above. Inside a sentence, use
  lowercase: "bpozz is a creative platform for graphic designers." In a page
  title, drop the closing period.
- Don't add it to every page title, button, navigation label or
  description. Sections and content keep their own descriptive names.
- It says who bpozz is for and where it is going, not which features exist.
  Don't present designer profiles, project publishing, showcases, discovery
  or contact links as available until they launch.
- "UI/UX" describes the guides' subject, not bpozz as a whole.

Approved by the owner on 2026-10-12 (Issue #29).

## Descriptions (in use)

Current site copy. Quote it exactly.

- Homepage headline (H1) and site footer tagline: "A Creative Platform for
  Graphic Designers."
- Homepage supporting line: "Explore practical design guides, resources,
  and tools to support your creative work."
- Page titles: "bpozz — A Creative Platform for Graphic Designers" (homepage)
  and "About bpozz — A Creative Platform for Graphic Designers" (About).
- Descriptor, used in the homepage and About meta descriptions, the homepage
  structured data and the web app manifest: "bpozz is a creative platform
  for graphic designers. Explore practical design guides, resources, and
  tools to support your creative work."
- About intro: "bpozz is a creative platform for graphic designers. It offers
  practical design guides, resources, and tools to support your creative
  work."
- Social preview image (`public/og-image.png`): "A Creative Platform for
  Graphic Designers."

## Name versus logo (in use)

The name is text. The logo is a visual treatment of that text, and its
styling never changes how the name is written.

- **Header wordmark.** The SVG `assets/bpozz brand logo.svg` ("bpozz" in
  `#101010` on transparent), an `<img alt="">` inside the brand link,
  whose accessible name is "bpozz home". See `partials/header.html` and
  the "header wordmark" block in `src/styles/styles.css`. The 404 page
  keeps its own text wordmark: the HTML text `bpozz` set in the Damion
  typeface (SIL OFL 1.1) under its own font-face name, "Damion Wordmark".
  The artwork, face, size and colors are logo styling only.
- **Icons.** `assets/favicon.png` (favicon, a 64 x 64 downscale of
  `assets/bpozz brand logo.png`), `assets/apple-touch-icon.png` (touch
  icon and footer mark) and `assets/logo.png` (organization logo in
  structured data, `src/build/structured-data.js`).
- **Social preview image.** `public/og-image.png` (1200 x 630), exported
  from its editable source `src/brand/og-image.svg`, which is not
  published. Its wordmark reuses the paths of
  `assets/bpozz logo Brand-01.svg`. When its headline changes, update the
  og:image:alt text that quotes it: `index.html`, `roadmap.html` and the
  guide sources in `content/guide/` with their committed copies in
  `guide/`.
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
- The positioning used from commit `179c8bd` (2026-10-04) until the Issue #29
  brand positioning release: "Design intelligence for building better
  digital products.", the title suffix "Design Intelligence for Digital
  Products" and the descriptor "bpozz is an independent platform for
  practical design tools, resources, guides, and insights for people who
  design and build digital products."

## Not specified

Nothing has been decided yet for:

- a mission statement, or any slogan beyond the positioning line;
- brand colors, typography or design tokens beyond the header wordmark's
  current styling;
- logo usage rules (clear space, minimum size, color or reversed
  versions);
- whether the Damion wordmark is the permanent logo;
- tone of voice.

Add an item here only once it has been decided.
