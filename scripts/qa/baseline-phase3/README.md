# Phase 3 evidence — the pre-token-removal surface

**Status: ARCHIVED. Read-only, permanently.**

These two files record the site as it shipped *before* the Colour Tokens
feature was removed: 84 HTML pages, 142 public URLs.

| file | what it records |
|---|---|
| `url-snapshot.json`   | 142 public URLs + each page's declared canonical |
| `html-checksums.json` | md5 of all 84 published HTML pages |

They gate nothing. They exist so the removal stays auditable after the
baseline moved on — the claim "only token URLs went away" is checkable
against this, and only against this.

## Why it is here and not at `baseline/`

It *was* `baseline/`, through Phase 4 Step 1. Step 2D promoted the reviewed
post-removal surface into that name and renamed this one to say what it is.
The rename changed no bytes: `check-baseline.js` pins all three archived
files by sha256, and those are the same three values the table held before
the move. If a promotion had ever rewritten the evidence instead of moving
it, that check would fail.

The convention, for every phase after this one:

    baseline/            the current approved surface — always this path
    baseline-phase<N>/   an earlier approved surface, kept as evidence

## Protections

- `check-baseline.js` re-checks all three sha256s on every `npm run check:baseline`.
  Deleting or editing any of them fails the gate by name.
- `write-baseline.js` refuses to write to `paths.baselinePhase3`, and refuses
  any output directory matching `*-phase<N>` — so a future `baseline-phase5/`
  is protected without anyone remembering to add it.

Companion file: `../approved-output-phase3.json`, the sha256 manifest of all
102 files the pre-removal `dist/` contained.
