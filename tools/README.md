# /tokens/ redesign — QA & guard tooling

## Forbidden-color guard (required)

    node tools/check-forbidden-color.js

Fails (exit 1) if `#0f2a52` appears anywhere the /tokens/ section can render it.
Detects: hex in any case/length (3/4/6/8-digit), `rgb()`/`rgba()` in comma **and**
space-slash syntax with int or percent channels, and indirect leakage through
`var(--ink)` / `var(--ink-2)`. Comments are stripped first, so documentation that
*mentions* the color is not a false positive.

For the two shared stylesheets (`styles.css`, `guide-article.css`) the guard is
**reachability-aware**: it extracts the class names from each `--ink`-consuming
selector and checks them against the classes that actually appear in the generated
`/tokens/*.html`. A guide-only rule such as `.guide-article pre` is ignored because
no token page carries that class; a rule matching `.toast` or `.skip-link` must have
a `body.tokens-page` override or the build fails.

This runs automatically at the end of `node build-tokens.js`
(skip with `--no-check` when deliberately inspecting a broken tree).

## QA suites (require `npm i jsdom`)

    node tools/qa-functional.js        # 60 checks — drives the real pages in jsdom
    node tools/qa-a11y-regression.js   # 65 checks — export regression, contrast, ARIA
    node tools/qa-responsive.js        # 15 checks — layout maths at 8 breakpoints

`qa-functional.js` and `qa-a11y-regression.js` expect a pristine baseline copy at
`/home/claude/pristine/bpozz web active` for the regression comparisons; point the
`BASE` constant at any known-good checkout.
