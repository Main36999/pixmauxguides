# The approved baseline

**Status: APPROVED.** This is the surface every gate measures against.

| file | what it records |
|---|---|
| `url-snapshot.json`   | 104 public URLs + each page's declared canonical |
| `html-checksums.json` | md5 of all 42 published HTML pages |

Two things measure against these:

- `npm run check:urls` diffs the URL surface and each page's canonical.
- `npm run check:baseline` diffs the HTML checksums, plus the content-index
  and palette contracts.

A third gate, the build's own `verify` stage, is stricter than either: it
hashes **every** file in `dist/` against `../approved-output.json`. Prefer it
when you want to know whether a change moved anything at all.

## History

This directory was `baseline-phase4-candidate/` until Phase 4 Step 2D. It
recorded the surface *after* the Colour Tokens feature was removed, and was
held as a candidate while that removal was reviewed:

| measure | before | after | delta |
|---|---|---|---|
| HTML pages    | 84  | 41 | −43 (40 token detail + index + create + collection) |
| Public URLs   | 142 | 89 | −53 (the 43 pages, /tokens.json, 9 token code/style assets) |
| Sitemap URLs  | 82  | 40 | −42 |
| content-index | 102 | 62 | −40 token records; 22 guides + 40 palettes unchanged |
| Palettes      | 300 | 300 | unchanged |

The review passed, so Step 2D promoted it: this became `baseline/`, the
pre-removal Phase 3 evidence was renamed to `../baseline-phase3/`, and
`check-urls.js` emptied its 53-entry `ALLOWED_REMOVED`.

Step 2 made three further changes to the recorded surface, each gated
separately: `app.js` shed a dead click delegate (2B), and `/_htaccess` and
`/resource-types.json` were withdrawn from publication and now return 410
(2C). `dist/` went from 93 files to 91. The *URL* counts above are unchanged
by that, because neither withdrawn file was ever named by a bucket in
`snapshot.js` — which is the hole Step 2D closed.

### Step 10 — Color Library

The first change to this baseline that **adds**. It was recorded the way
"Changing the surface" below prescribes: fifteen entries in
`ALLOWED_ADDED`, one gate run to prove the diff, then a re-record and an
empty list again.

| measure | before | after | delta |
|---|---|---|---|
| HTML pages    | 41 | 42  | +1 (`colors/index.html`) |
| Public URLs   | 89 | 104 | +4 Color Library, +11 pre-existing `.webp` |
| Sitemap URLs  | 40 | 41  | +1 (`/colors`) |
| content-index | 62 | 62  | unchanged — the 300 colours are **not** indexed |
| Palettes      | 300 | 300 | unchanged |

Two things about that row of +15 are worth knowing before reading the diff:

- **Eleven of the new URLs are not this feature's.** They are `.webp`
  thumbnails that were already in the working tree, the in-progress half of
  a PNG → WebP conversion whose eleven guides still point at `.png` in
  `guides.json`. Step 10 named them rather than letting them ride along
  inside a count, and did not finish the conversion.
- **Every one of the 41 pre-existing pages changed its md5**, because the
  header gained one nav link. That is a large number of changed checksums
  for a small change, so it was measured rather than asserted: all 41 are
  byte-identical to the previous baseline once the two added
  `<a href="/colors">Colors</a>` lines are removed.

## Re-recording this

    npm run build && npm run snapshot
    BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline

Only after the change it records has been reviewed. Recording a baseline
blesses whatever is currently built, which is how a regression gets approved
by accident — hence the explicit environment variable.

## Changing the surface

A change that intends to move a URL enumerates it in `ALLOWED_ADDED` or
`ALLOWED_REMOVED` in `../check-urls.js`, one entry per URL, never a pattern.
On approval, re-record this baseline and empty the list again.

For a change large enough that measuring against the old baseline proves
nothing — as token removal was, where all 41 surviving pages changed — record
a *candidate* in a separate directory first and keep the allowlist pointed at
the old baseline, so the proof is the diff against what actually shipped.
Step 1 did that; Step 2D promoted it. Both halves of that pattern are in the
git history if it is needed again.

## What must never happen here

`../baseline-phase3/` and `../approved-output-phase3.json` are the record of
what shipped before token removal. They are never edited, never overwritten
and never deleted — `check-baseline.js` pins all three by sha256, and
`write-baseline.js` refuses any output path matching `*-phase<N>`.
