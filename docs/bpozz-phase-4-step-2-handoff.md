# BPOZZ — Phase 4 Step 2 Handoff

STATUS: COMPLETE — all gates green. NOT COMMITTED (see §H).

Step 2 was scoped as gate integrity and dead-code removal, deliberately
**not** the legacy-builder → template migration. The reasoning is in the Step 2
discovery report; the short version is that the template migration is a
multi-step programme and should start from a tree with one baseline, an
honest URL gate and no dead code, or every diff it produces is noisier than
it needs to be.

Baseline in: `phase4-token-removal`, commit `6f4a963`.

---

## A. Pre-flight

Two items were required before editing.

**1. The `8a29c00` vs `6f4a963` label mismatch — resolved.**
`check-baseline.js` described its pinned hashes as "the sha256s of those
files as committed at phase4-step1 (8a29c00)", while the approved Step 1
baseline is `6f4a963`. All three pinned files were re-hashed and match their
pins exactly, so the *evidence* was never in question — only the comment.
Nothing in the build ever resolved either commit id; it was prose.

Rather than substitute one unverifiable commit id for another, the reference
was dropped. The sha256s are self-verifying and re-checked on every
`npm run check:baseline`, which is a stronger claim than a commit id in a
comment. This is recorded in the `FROZEN_SHA256` docblock.

**2. Scope re-confirmation — one error found and corrected.**

`docs/archive/_TEMPLATE.html` was listed as an orphan in the discovery
report. It is not: it is the live hand-authoring template for every new guide
page ("Copy it to `guide/your-new-slug.html`… fill in every
`{{PLACEHOLDER}}`"), and it is the natural home for the deferred F2 JSON-LD
repair.

The misclassification came from testing "is it referenced by code?" against a
directory whose whole purpose is holding things code does not reference.
Applying that correction consistently, **both** `docs/archive/` items were
dropped from scope. The rule adopted: **archive what has no successor, delete
what does.**

| originally proposed | action taken | why |
|---|---|---|
| `build-content-index.js` | **deleted** | superseded; its record builders live on in `src/build/content.js`, ported verbatim |
| `scripts/generate-palettes.js` | **archived** to `docs/archive/` | dead and unrunnable, but the only record of how the 300 palettes were produced (R1) |
| `docs/archive/_TEMPLATE.html` | **kept** | live authoring tool, misclassified |
| `docs/archive/bpozz-search-demo.html` | **kept** | already quarantined; deleting gains nothing |

2A's line count fell from the reported ≈1,894 to ≈973 as a result. Reported to
the user before any edit.

---

## B. What changed, by sub-step

### 2A — dead-code cleanup · **0 output change**

- `build-content-index.js` deleted (478 lines). Not in `RENDER_ORDER`;
  crashed on `ENOENT tokens.json`.
- `scripts/generate-palettes.js` → `docs/archive/` (495 lines). Crashed on
  `Cannot find module '../tokens-color.js'`.
- `build-footer.js`: 242 → 173 lines. Removed `categoryLinks()`,
  `categoryLinksHtml()`, `syncCategoryRegion()`, four constants and the now
  orphaned `escapeHtml` import — all unreachable since `main()` stopped
  calling the generator. The stale PHASE 5 docblock was replaced with a note
  saying what was removed and confirming the crawl path it protected is
  intact (all 10 category pages are linked from `guides/index.html`, 5 more
  from `index.html`, all 10 in `sitemap.xml`).

`src/shared/html.js` was checked before and after: still required by
`build-home.js`, `build-categories.js` and `build-header.js`, so `STAGE_FILES`
was left alone (R3).

**Gate evidence:** `verify` reported *93 files byte-identical* with **no
approval needed**. That is the whole proof for 2A — nothing live was touched.

### 2B — dead client handler · `app.js` only

`src/client/guides.js`: removed the `data-jump-category` click delegate.
Verified beforehand that zero `.html` files carry the attribute, so it could
never fire; it only cost every page a document-level click listener running
`closest()` on every click.

Two things worth noting about how this landed:

- The explanation was first written as an inline comment and the bundle only
  shrank by 5 bytes — the comment was nearly as large as the code. The
  bundler strips each source's *leading* docblock, so the note was moved
  there, where it costs zero shipped bytes. Final saving: **−660 bytes**.
- The words "data-jump-category" were removed from the shipped comment too,
  because leaving the string in `app.js` makes a future "is this dead?" grep
  return a false positive — the exact trap that produced the `_TEMPLATE.html`
  misclassification in pre-flight.

`window.bpozzShowToast` was **not** touched (R2). Its docblock says the
`/tokens/*` scripts that used it are gone, which makes it read like dead
code; `src/client/palettes.js:74` still calls it across the bundle boundary,
and no gate would have caught its removal.

### 2C — undocumented publications withdrawn · −2 files, `_redirects` changed

`_htaccess` and `resource-types.json` left `PUBLISH_FILES`. Both were flagged
in that table for a later decision; this was it.

- `_htaccess` — F7: the target is Netlify, the file is never renamed to
  `.htaccess`, and it activated no Apache behaviour. Serving it published this
  site's rewrite intentions and nothing else.
- `resource-types.json` — build input only. Re-verified at 2C: the browser's
  only data fetches are `/guides.json`, `/content-index.json`,
  `/categories.json` and `./palettes-data.json`. It is still read at build
  time and still staged; only its publication stopped.

Both now return **410** in `public/_redirects`, on token removal's own
reasoning: the resource is gone, not moved.

`ALLOWED_REMOVED` was **not** touched, and that is the finding of this
sub-step. Neither URL was named by any bucket in `snapshot.js`, so neither was
ever in the baseline — `check:urls` reported "89 URLs, nothing moved" and
passed while two files left `dist/`. The build's own `verify` stage was the
only gate that saw it. That is what 2D-i fixes.

### 2D-i — gate hardening

`scripts/qa/snapshot.js` no longer asserts its surface; it observes it.

- `assertDeclaredExist()` — every path in `DATA_ENDPOINTS`, `SITE_FILES` and
  `PLATFORM_FILES` must exist in `dist/`. Previously these were literal lists
  copied into the snapshot unchecked: if `/guides.json` had stopped being
  published, the snapshot would have recorded it as present and the gate
  would have passed.
- `assertNoStrays()` — every file in `dist/` must fall into exactly one
  bucket, or the tool fails and names the strays.
- `PLATFORM_FILES` — a new, named category for deploy config the host
  consumes and never serves (`_headers`, `_redirects`). Deliberately not an
  ignore-list: its docblock records that `_htaccess` looked like it belonged
  there and did not, which is why it was served for three phases.

Recorded outside `counts.total` and outside `check-urls.js`'s `LISTS`, so the
URL surface stays 89 and directly diffable.

Three negative tests were run and all failed correctly: a stray file, a
vanished declared endpoint, and — the regression proof — putting `_htaccess`
and `resource-types.json` back into `dist/`, which the hardened tool now
names as strays.

### 2D-ii — baseline promoted

The dual-baseline state is gone. The convention now established:

    baseline/            the current approved surface — always this path
    baseline-phase<N>/   an earlier approved surface, kept as evidence

| before | after |
|---|---|
| `baseline/` (Phase 3) | `baseline-phase3/` |
| `baseline-phase4-candidate/` | `baseline/` |
| `approved-output.json` (Phase 3) | `approved-output-phase3.json` |
| `approved-output-phase4-candidate.json` | `approved-output.json` |
| `write-candidate-baseline.js` | `write-baseline.js` |
| `npm run snapshot:candidate` | `npm run snapshot:baseline` |
| `BPOZZ_WRITE_CANDIDATE=1` | `BPOZZ_WRITE_BASELINE=1` |

- `check-urls.js` — `ALLOWED_REMOVED` emptied (was 53 entries); `BASELINE`
  now read from `site.config.js` rather than a literal path, so the next
  promotion cannot leave a gate silently measuring the wrong directory.
- `check-baseline.js` — `FROZEN_SHA256` keys repointed, **values unchanged**.
- `site.config.js` — `candidateBaseline` / `candidateApprovedOutput` retired;
  `baselinePhase3` / `approvedOutputPhase3` added.
- `src/build/build.js` — `verify` reads `paths.approvedOutput` again.
- `write-baseline.js` — refuses `paths.baselinePhase3` **and** any directory
  matching `*-phase<N>`, so a future `baseline-phase5/` is protected without
  anyone remembering to add it.
- READMEs rewritten for both `baseline/` and `baseline-phase3/`.

**Preservation proof:** the three archived files hash to the same sha256s they
had before the rename. The gate prints it: *"3 Phase 3 evidence files
unchanged (same sha256s as before the Step 2D rename)"*. A promotion that had
rewritten the evidence instead of moving it would fail that check.

### 2A-followup — stale references to the deleted script

Deleting `build-content-index.js` left nine references to it, one of them a
**runtime error message instructing the operator to run it**
(`build-home.js:500`), and one shipped to browsers in `palettes.js`.

- `build-home.js` — the error message now explains the real failure (a stale
  `content-index.json`) and points at `npm run build`, whose `data` stage
  regenerates the index immediately before `render`. Its docblock's
  "run `node build-content-index.js` first" instruction was replaced with a
  DO NOT RUN THIS DIRECTLY note.
- `src/client/palettes.js` — comment repointed at the build's `data` stage.
- `build-categories.js`, `src/build/build.js`, `src/build/content.js` —
  historical references put in past tense and told where the code went.

---

## C. Exact output delta (verified against the original archive)

All 41 published HTML pages are **byte-identical** to the pre-Step-2 build.
`dist/`: 93 → 91 files.

| file | change | sub-step |
|---|---|---|
| `_htaccess` | removed | 2C |
| `resource-types.json` | removed | 2C |
| `_redirects` | changed (+2 410 rules) | 2C |
| `app.js` | changed (−660 bytes) | 2B |
| `palettes/palettes.js` | changed (comment) | 2A-followup |

Nothing else. Each change was approved by exactly one explicit
`BPOZZ_APPROVE_OUTPUT=1` run whose manifest diff was read before proceeding.

---

## D. Gate results

Run after every sub-step; all green at the end.

| gate | result |
|---|---|
| `npm run build` (`verify`) | ✓ 91 files byte-identical |
| `npm run check:urls` | ✓ 89 → 89, **allowlist empty and nothing needed it** |
| `npm run check:baseline` | ✓ all checks, incl. archived evidence unchanged |
| `npm test` | ✓ 10/10 |
| Determinism | ✓ two clean builds byte-identical (91 files) |
| `npm run qa` ×2 | ✓ both pass |

New gates added by this step:

- declared endpoints must exist in `dist/`
- every published file must be classified
- archived evidence must be a separate directory from the active baseline
- `write-baseline.js` refuses archived-phase output paths

Preservation re-verified: 22 guides · 300 palettes (`p001–p300`,
`palettes-data.json` byte-identical to source) · 41 pages · 40 sitemap URLs ·
41 canonicals · Firebase untouched in `src/client/palettes.js`.

---

## E. Deferred, unchanged

`F1` mobile-menu accessibility · `F2` JSON-LD repair · template migration ·
`search.html` refactor · analytics/CSP work. None was touched.

`F2` is worth re-reading before Step 3: only 6 of 22 guide pages satisfy the
`jsonLd.guide` contract recorded in `site.config.js`. Repairing it by hand
means editing 16 hand-authored pages — the same drift-prone path that caused
it. `docs/archive/_TEMPLATE.html`, kept in pre-flight, is where a durable fix
would start.

---

## F. Open items

1. **410 behaviour is not locally verifiable.** Whether Netlify's edge really
   serves 410 for `/_htaccess` and `/resource-types.json` can only be
   confirmed against a deployment — same caveat the token rules already
   carry. Re-check after deploy. If they come back 404 the rules are still
   correct as written; the fallback is an edge function.
2. **`resource-types.json` external consumers.** Nothing in this repo fetched
   it, but it was publicly reachable for three phases. Low risk, non-zero.
3. **Generated region in a hand-authored file.** `build-header.js` regenerates
   `NAV_RESOURCES_START/END` inside `partials/header.html` from a hard-coded
   `MAIN_HEADER_NAV`. The committed partial currently matches — verified —
   but nothing checks that it does. Gate 9 from the discovery report was
   **not** implemented (it belongs with the header-builder migration). Until
   then, editing `MAIN_HEADER_NAV` can leave the committed partial stale.
4. **Navigation truth is in three places:** `MAIN_HEADER_NAV`,
   `resource-types.json`, and the committed `NAV_RESOURCES` regions. For the
   header migration to resolve.

---

## G. Step 3 starting point

The template migration, in the order the code makes cheapest:

1. `build-footer.js` — now 173 lines. One partial, five link rewrites, one
   marker region. Port it to `src/build/` and iterate `ctx.routes` instead of
   the whole-tree `findHtmlFiles()` walk, which makes the page set explicit
   and gate-checkable.
2. `build-header.js` (464) — two partials, `activePaths`, the index.html
   special case, and open item 3 above.
3. `build-categories.js` (489) — writes pages from scratch.
4. `build-home.js` (800) — three pages, four marker regions.

`RENDER_ORDER` stays load-bearing throughout: home → categories → header →
footer. Categories drop `aria-current`; header restores it.

---

## H. Commit status

**Nothing was committed or tagged.** The supplied archive contains no `.git`,
so this session could not commit even had the gates demanded it. The
delivered tree is the working tree with all gates green.

Suggested on your side, once the diff has been reviewed:

    git switch -c phase4-step2            # from 6f4a963
    git add -A && git commit
    git tag phase4-step2

Generated `dist/`, `.build/` and `.qa/` are gitignored and were removed from
the delivered tree.
