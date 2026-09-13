# Guide page style system — one template, one stylesheet

## Current state (checked against all 22 pages in `/guide`)

Every `/guide/*.html` page already links exactly the same two stylesheets,
in the same order, and nothing else:

```html
<link rel="stylesheet" href="../styles.css" />
<link rel="stylesheet" href="../guide-article.css" />
```

No guide page has its own `<style>` block. Across all 22 pages there are
only **62 distinct CSS classes** in total, used in the same order every
time: `guide-layout → guide-primary → guide-hero → guide-toc →
guide-article → (content components) → guide-rail`. That's already one
style template applied consistently — this doc and `guide/_TEMPLATE.html`
exist to keep it that way as new guides get added.

## The one file to start every new guide from

**`guide/_TEMPLATE.html`** — copy it, fill in the `{{placeholders}}`,
delete any component block you don't need. Never start a new guide by
copying an existing published guide (content drifts along with it) and
never add a page-level `<style>` block or a new class name outside this
system.

## Component vocabulary (all defined in `guide-article.css`)

| Component | Class | Use for |
|---|---|---|
| Hero | `.guide-hero`, `__meta`, `__title`, `__dek`, `__figure` | Title block, required |
| Table of contents | `.guide-toc` | Jump links, required |
| Section heading | `.guide-article h2` + `.guide-article__num` | Numbered `01`, `02`… headings |
| Callout | `.guide-callout` (+ `--success` / `--warning` / `--danger`) | A note pulled out of the paragraph flow |
| Diagram | `.guide-diagram` / `__frame` (+ `--light`) / `__legend` / `__chip` | Mid-article SVG illustration |
| Table | `.guide-table-wrap` wrapping a plain `<table>` | Tabular data, always in the wrap for scroll |
| Do/Don't grid | `.guide-example` | Side-by-side comparison |
| Key takeaways | `.guide-recap` (+ `--warning` for pitfalls) | Always the last numbered section |
| CTA banner | `.guide-cta` | Optional closing call-to-action |
| Spec sheet | `.guide-spec` | Bordered term/value reference box |
| Prev/next nav | `.guide-footer-nav` | Optional sequential guide links |
| Related guides | `.guide-rail` | Leave empty — filled by `app.js` from `guides.json` |

Full CSS + the reasoning behind each token lives in `guide-article.css`
(each section is commented).

## Checklist for adding a new guide

1. Copy `guide/_TEMPLATE.html` → `guide/your-slug.html`.
2. Fill in the head (title, description, canonical URL, OG/Twitter tags,
   JSON-LD) and the hero/TOC/article content.
3. Run `node build-header.js` and `node build-footer.js` from the repo
   root so the header/footer exactly match `partials/header.html` /
   `partials/footer.html`.
4. Add an entry to `guides.json` (`id`, `category`, `level`, `readTime`,
   `title`, `description`, `thumbnail`, `roadmapStage`, `roadmapStep`) —
   this drives the homepage grid, the roadmap, and the related-guides
   rail.
5. Add the real thumbnail to `/thumbnail_image/`.
6. Add the page to `sitemap.xml`.

## Rules that keep it from drifting again

- Never add a `<style>` block to a guide page.
- Never invent a new class name for something already covered above —
  reuse the existing component.
- If a guide genuinely needs a new visual pattern, add it to
  `guide-article.css` as a named, documented component first, then use
  it — don't solve it inline on one page.
