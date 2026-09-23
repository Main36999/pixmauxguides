# Website Audit Report

Audit date: 2026-09-23 · Base commit `1271da0` (main) · Three passes: full audit → production verification → pre-commit review
Nothing has been committed or pushed.

**Status meanings.** FIXED = changed in this working tree and verified as described. FOUND (in REMAINING) = real, deliberately not changed, reason given. NEEDS MANUAL REVIEW = can only be verified or done in the Firebase console, production Formspree, the deployed Netlify site, or by a human decision.

## Summary

bpozz.com is a static site: a dependency-free Node build (`src/build/build.js`) renders 43 pages to `dist/` for Netlify. There is no backend, no owned database and no authentication. Its moving parts are client-side search, a palette gallery with Firebase-backed likes, a colour library, a client-side image palette extractor, and a Formspree contact form.

- **No P0 issues.** 30 findings: **22 FIXED**, **4 REMAINING (found, left on purpose)**, **4 NEEDS MANUAL REVIEW**.
- Largest effects: `/guides` thumbnails **23.0 MB → 2.3 MB**, homepage category images **4.7 MB → 121 KB**, 300 Firebase transactions per palettes visit removed, a contact-form PII leak closed, keyboard focus restored on every content card, canonicals no longer point at redirects, and an image-picker race fixed (reproduced first).

| Severity | Total | FIXED | REMAINING | NEEDS MANUAL REVIEW |
| -------- | ----- | ----- | --------- | ------------------- |
| P0 | 0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 | 0 |
| P2 | 13 | 11 | 0 | 2 |
| P3 | 15 | 9 | 4 | 2 |

## Architecture

| Area | What exists |
| ---- | ----------- |
| Build | `node src/build/build.js`: clean → load → copy → data → render → sitemap → verify. `verify` fails on any `dist/` byte not recorded in `scripts/qa/approved-output.json` (there is no `approved-output-checksums.json`). |
| Client | `/app.js` (bundle of `src/shared/*` + `src/client/{core,guides,search,contact,roadmap}.js`); page scripts `palettes.js`, `colors.js`, `image-picker.js`. |
| Data | `guides.json`, `palettes/palettes-data.json`, `palettes/palettes-meta.json`, `colors/colors-data.json`, `categories.json`, `resource-types.json`; generated `content-index.json`. |
| External | Firebase RTDB (likes only), Formspree (contact), GA4 via gtag (Consent Mode v2), Cookiebot, Google Fonts (DM Sans). |
| Deploy | Netlify: `public/_headers`, `public/_redirects`. `public/_htaccess` is an inactive Apache mirror. |
| QA | `npm test` (79 tests), `npm run qa` (build + URL snapshot + checksum baseline). No linter or type checker. |

---

## FIXED

Each item was changed in the working tree and verified as described under VERIFIED.

### P1

| # | Issue | Fix | Location |
| - | ----- | --- | -------- |
| F1 | Guide thumbnails: 11 guides used 1.2–1.5 MB PNGs though WebP twins existed; the other 11 WebPs were 780–930 KB each. `/guides` loaded **23.0 MB**. | Switched to the WebP twins (same 1448×1086 and artwork). Re-encoded the 11 heavy WebPs at q90, **same 1536×1024 dimensions**, 9,283 → 973 KB, PSNR 39.5–41.9 dB vs originals, spot-checked by eye. `/guides` now **2.3 MB**. | `guides.json`, `thumbnail_image_webp/*.webp`, committed page copies |
| F2 | Palettes page ran a Firebase seed transaction for all 300 palettes on every visit. | Seed only when the listener reports a missing node; unlike clamped at 0. | `src/client/palettes.js` |

### P2

| # | Issue | Fix | Location |
| - | ----- | --- | -------- |
| F3 | Section pages' canonical, sitemap, JSON-LD and nav used `/guides` etc., which **production answers with 301 → `/guides/`**. | Route table emits `/guides/`, `/palettes/`, `/colors/`, `/image-picker/`; everything derived from it follows. | `src/build/routes.js`, `header.js`, `structured-data.js`, `resource-types.json`, `public/sitemap.xml`, partials, pages |
| F4 | Contact form had no `action`/`method`: without JS it did a GET with name, email and message in the URL. | `action="https://formspree.io/f/xljrealj" method="POST"`; CSP `form-action` allows Formspree. | `contact.html`, `src/client/core.js` |
| F5 | No visible keyboard focus on any content card (`.card-title` overflow clipped the outline), site-wide. | Ring drawn on the card-wide `.card-link::after` overlay; title turns the action colour. | `src/styles/styles.css` |
| F6 | Image Picker: a slow standby image replaced the user's chosen image. | Load tickets (only the newest load paints); 0×0 decodes rejected. | `src/client/image-picker.js` |
| F7 | Homepage category images were 0.9–1.1 MB PNGs (4.7 MB). | New 800×800 WebP copies (16–29 KB) for the cards, 121 KB total. PNGs unchanged; they remain the `og:image`. | `index.html`, `assets/*.webp` |
| F8 | Category `og:image` URLs had raw spaces/`&`; dimensions hard-coded 1200×630 for 1254×1254 files. | `encodeURI`; real size read from the PNG header. | `src/build/categories.js`, `category/*.html` |
| F9 | `/palettes` fetched `./palettes-data.json` (404 when served without a trailing slash). | Site-root path; `ok` and array checks. | `src/client/palettes.js` |
| F10 | Search silently showed 2 hard-coded sample results when the index failed to load. | Sample only on `file://`; otherwise an error message. | `src/client/search.js` |
| F11 | CSP (report-only) would have blocked Firebase, the no-JS contact POST, **the DM Sans web font on every page**, and parts of GA4. | Added the missing origins (see NEEDS MANUAL REVIEW M3 for the full list). Still report-only. | `public/_headers`, `public/_htaccess` |
| F12 | Terms stated the site "displays advertising … through Google AdSense"; the site has no AdSense integration. | "May display advertising … Where it does, ads are clearly labeled…". Privacy already said "uses, or may use" and is unchanged. | `terms.html`, `src/client/core.js` |
| F13 | Firebase setup doc claimed the open-write rule was safe. | Doc corrected; stricter rule and a Rules Playground test table added. (Applying it is M1.) | `docs/SETUP-FIREBASE.md` |

### P3

| # | Issue | Fix |
| - | ----- | --- |
| F14 | Search highlight could split HTML entities (`&<mark>amp</mark>;`) | Match on raw text, escape each piece |
| F15 | Malformed `/palettes#%E0` showed the empty state over a rendered grid | Guarded `decodeURIComponent` |
| F16 | Contact form showed raw `SyntaxError` / "Failed to fetch" text | Friendly message for non-JSON and network failures (both form copies) |
| F17 | Level `<select>` had a colour-only focus cue | `:focus-visible` outline |
| F18 | Contact fields' focus was a 1 px underline colour change | 2 px on keyboard focus |
| F19 | Search results jumped h1 → h3 | Result titles are `h2` |
| F20 | Search result count not announced to screen readers | `role="status" aria-live="polite"` |
| F21 | Image canvas had no accessible name | `role="img"` + `aria-label` |
| F22 | Homepage search placeholder advertised removed "tokens" and was truncated at 320 px | "Search guides, palettes…" |

---

## REMAINING

Known, real, and deliberately not changed.

| # | Sev | Issue | Why it stays |
| - | --- | ----- | ------------ |
| R1 | P3 | 30 palette card links use `/palettes#pNNN`, costing one 301 per click (the fragment survives; the link works). | The URL is locked by the frozen fixture `scripts/qa/fixtures/phase3-palette-records.json` ("do not update the fixture to match"). Changing it needs an owner decision about that contract. |
| R2 | P3 | A fully transparent image produces one grey swatch. | Documented intentional fallback; no crash (verified). |
| R3 | P3 | Duplicated code: two contact-form implementations, two mobile-menu scripts, repeated helpers. | Refactor, out of scope for a fix pass under the byte-identity regime. The contact fixes were applied to both copies. |
| R4 | P3 | Card image `alt` repeats the card title, so screen readers hear it twice. | `alt=""` is the fix, but it changes every card on the site; left for a deliberate pass. |

Also noted, not counted as defects: no custom 404 page (Netlify default); `/about` and `/about.html` both return 200 (the canonical consolidates them); Image Picker "Share link / PDF / ASE / Embed" exports are labelled "coming soon"; no linter configured.

---

## NEEDS MANUAL REVIEW

Nothing below was performed or verified in production from this environment.

### M1 [P2] Firebase rules: NEEDS MANUAL PRODUCTION VERIFICATION

**What is known.** The repo has **no rules file**; rules live only in the Firebase console. Read-only probes of production (2026-09-23): `GET /likes/p001.json` → 200; `GET /likes.json` → 401; `GET /.json` → 401; `GET /likes/zzz.json` → 200 `null`. That exactly matches the documented rule `likes/$paletteId: .read true, .write true, .validate number ≥ 0`. Under that rule an unauthenticated client can set any count, create arbitrary keys under `likes/`, or delete a counter; nothing outside `likes` is writable, and there is no rate limiting. **Writes were not tested; no production data was modified.**

**Exact steps:**
1. Firebase Console → project **bpozz-palettes** → Build → **Realtime Database** → **Data** tab. Note the current value of `likes/p001` (call it N).
2. **Rules** tab → paste the stricter rule from `docs/SETUP-FIREBASE.md` §2 → **do not publish yet**.
3. **Rules Playground**, *Authenticated* off. Run every row of the doc's table. Expected results:
   - *valid like/unlike:* `set /likes/p001` N+1 and N−1 → Allowed; `get /likes/p001` → Allowed
   - *arbitrary count:* N+2, 9999999, 0 (when N > 1), N+0.5, `"text"` → Denied
   - *deletion:* `remove /likes/p001` → Denied
   - *arbitrary keys:* `set /likes/evil`, `set /likes/p001/x` → Denied
   - *unauthorized paths:* `set /other`, `get /likes` → Denied
4. Only if every row matches: **Publish**.
5. Open `https://bpozz.com/palettes/` in two browsers; like, then unlike, a palette in one; confirm the count changes in both and the console shows no permission errors.
6. After a day: Realtime Database → **Usage**, where writes should be far lower than before this deploy (F2).

### M2 Contact form (production check of fix F4): NEEDS MANUAL PRODUCTION VERIFICATION

Tested only against a mocked Formspree; **no real message was sent.**

**JavaScript enabled**
1. Open `https://bpozz.com/contact.html`, fill all fields with your own email, subject "Production test", and submit.
2. Expect the button to show "Sending…", then the "Message received. Thanks, <first name> …" panel.
3. Formspree dashboard → form `xljrealj` → **Submissions**: the message is there with all fields and an empty `_gotcha`.
4. Submit with an invalid email: expect the inline error, and nothing new in Formspree.

**JavaScript disabled**
1. DevTools → Ctrl/⌘+Shift+P → "Disable JavaScript" → reload `/contact.html`.
2. Fill in and submit.
3. Expect the browser to navigate to **Formspree's** confirmation page (URL on `formspree.io`, not `bpozz.com`).
4. Confirm the address bar and the back-button history entry contain **no** `?name=`, `?email=` or `?message=`.
5. Confirm the submission arrives in the Formspree dashboard. Re-enable JavaScript.

### M3 [P2] CSP enforcement: NEEDS MANUAL PRODUCTION VERIFICATION

**Current state:** intentionally `Content-Security-Policy-Report-Only` in `public/_headers` (Netlify), mirrored in the inactive `public/_htaccess`. It blocks nothing.

**External origins the site uses (verified from the built HTML and scripts):**

| Service | Origins | Directive(s) |
| ------- | ------- | ------------ |
| Cookiebot | `consent.cookiebot.com`, `*.cookiebot.com` | script, connect, img, frame |
| Google Analytics 4 / gtag | `www.googletagmanager.com`, `*.googletagmanager.com`, `www.google-analytics.com`, `*.google-analytics.com`, `*.analytics.google.com` | script, connect, img |
| Google Fonts (DM Sans, every page) | `fonts.googleapis.com` (CSS), `fonts.gstatic.com` (font files) | style, font |
| Firebase (palettes likes) | `www.gstatic.com` (SDK), `*.firebasedatabase.app` (https + wss, script long-poll fallback) | script, connect |
| Formspree (contact) | `formspree.io` | connect (JS path), form-action (no-JS path) |
| Share links (X, Pinterest) | opened with `window.open` | none needed (navigation) |

**Exact steps:**
1. Deploy. Open DevTools → Console on every page type (home, `/guides/`, a guide, a category, `/palettes/` with a like, `/colors/`, `/image-picker/` with an upload and export, `/search?s=color`, `/contact.html` with a submission), both before and after accepting the Cookiebot banner.
2. Confirm there are **no** `[Report Only] Refused to …` messages. If any appear, add that origin to the named directive in **both** `public/_headers` and `public/_htaccess`.
3. Then make exactly this change in `public/_headers`. The policy value stays byte-for-byte the same:
   ```diff
   -  Content-Security-Policy-Report-Only: default-src 'self'; …
   +  Content-Security-Policy: default-src 'self'; …
   ```
   (Optionally mirror it in `_htaccess`: `Header always set Content-Security-Policy "…"`.)
4. Rebuild with `BPOZZ_APPROVE_OUTPUT=1 npm run build` (the `_headers` file is gated), deploy, and repeat step 1 with enforcement on.

Note: `'unsafe-inline'` in `script-src` stays, because the pages carry inline scripts (consent default, gtag config, contact/menu scripts).

### M4 [P3] Unused images: MANUAL DECISION

None is referenced by any page, script, stylesheet or data file (the single `.png` mention in `src/build/structured-data.js` is an explanatory code comment). All are still copied into `dist/` and deployed. Deleting any of them changes the gated URL surface, so it needs `BPOZZ_APPROVE_OUTPUT=1 npm run build` plus a baseline re-record.

| File | Size | Referenced? | Likely source/master? | Safe to delete? |
| ---- | ---: | ----------- | --------------------- | --------------- |
| `thumbnail_image_webp/Font Size Is a Formula, Not a Feeling.png` | 1,338 KB | No | Yes: lossless, same 1448×1086 as its WebP | MANUAL DECISION |
| `thumbnail_image_webp/Grid Systems Are a Rhythm, Not a Ruler.png` | 1,307 KB | No (code comment only) | Yes | MANUAL DECISION |
| `thumbnail_image_webp/iOS and Android Are Different Systems, Not One Design Reused Twice.png` | 1,426 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Line Length Is a Reading Constraint, Not a Layout Afterthought.png` | 1,275 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Migrating From XD Is a Rebuild, Not a File Import.png` | 1,307 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Mobile Breakpoints Are Device Categories, Not Arbitrary Pixels.png` | 1,307 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Motion Timing Is a Physics Model, Not a Preset.png` | 1,280 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Padding and Margin Are Different Jobs, Not Interchangeable Values.png` | 1,252 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Responsive Layout Is a Contract, Not a Breakpoint List.png` | 1,309 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Thumb Zones Are a Layout Constraint, Not a Nice-to-Have.png` | 1,280 KB | No | Yes | MANUAL DECISION |
| `thumbnail_image_webp/Whitespace as a UI Component, Not a Leftover.png` | 1,201 KB | No | Yes | MANUAL DECISION |
| `assets/bpozz logo.png` | 181 KB | No | Likely: 4167×4167 export; `bpozz-logo.svg` is the one in use | MANUAL DECISION |
| `assets/bpozz logo tab-01.png` | 206 KB | No | Likely: 4167×4167 export | MANUAL DECISION |
| `assets/bpozz logo-01.png` | 69 KB | No | Likely: 5000×1250 export | MANUAL DECISION |

Total ≈ 14.8 MB of deploy weight, and zero page weight (no page requests them). If you keep them as masters, the lowest-risk option is to move them out of the published folders (for example to a `design-masters/` directory the build does not copy) instead of deleting them.

### M5 [P3] Canvas colour sampling is pointer-only: MANUAL DECISION

Clicking the image re-samples the nearest swatch; there is no keyboard equivalent. The core flow (choose image, change count/variation, copy swatches, export) is fully keyboard-operable (verified), so this is a feature decision, e.g. arrow keys to move a focused sampling point.

### Other manual checks after deploy

- **Canonicals:** view source on `https://bpozz.com/guides/`, `/palettes/`, `/colors/`, `/image-picker/`; each `<link rel="canonical">` must end in `/`. `https://bpozz.com/sitemap.xml` must list the same four with `/`. Then Search Console → Sitemaps → resubmit.
- **Social previews:** paste `https://bpozz.com/category/spacing` into the Facebook Sharing Debugger and the LinkedIn Post Inspector; the Spacing & Layout image (1254×1254) should load.
- **Visual:** a quick look at the re-encoded guide thumbnails on `/guides/` on a high-DPI screen.
- **Browsers not covered:** Safari/iOS and Firefox. All automated browser checks used Chrome.

---

## VERIFIED

Every result below was actually run in this session against the current working tree unless marked as production.

| Check | How | Result |
| ----- | --- | ------ |
| Build | `node src/build/build.js` | **pass**: 43 pages, 62 index records; `verify` 115 files byte-identical to the approved output |
| Unit tests | `npm test` | **79/79 pass** |
| QA gate | `npm run qa` | **pass**: 113 URLs as approved, no URL added or removed, canonicals match baseline, 43 pages byte-identical to baseline, all baseline checks pass |
| Internal links | crawler over `dist/` | 43 pages, **0 broken** |
| URL consistency | grep over `dist/` | all 4 section canonicals and sitemap `<loc>`s end in `/`; **0** slashless section URLs in `og:url`/`twitter:url`/JSON-LD; nav links all `/section/` |
| Syntax | `node --check` on the 4 published scripts | pass |
| Diff hygiene | `git diff --check`; per-file residual review (HEAD + known transforms vs working tree) | clean; 40/49 changed data/page files fully explained by the intended mechanical changes, the other 9 contain only the listed hand edits. One accidental leftover was found and reverted in this pass (see below). |
| Image Picker, real Chrome | scripted, 24 checks | **24/24**: 5/5 race runs (the **original code fails 5/5**), 3/3 rapid picks incl. a 48 MP decode, JPG/PNG/WebP, 1400 px display cap, transparent PNG, rejects GIF / 26 MB / text-as-PNG / truncated JPEG keeping the previous image, PNG download 1200×240, CSS/code/Tailwind/SVG clipboard exports, modal Escape + focus restore |
| Contact form, real Chrome + **mocked** Formspree | scripted, 9 checks | **9/9**: empty and invalid email blocked, success panel with `role=status`, 422 message shown, 500 HTML and network failure produce a friendly message, no-JS POSTs to Formspree. The **old markup leaks PII into the URL** (reproduced). |
| Responsive, real Chrome | 11 pages × 320/375/390/430/768/1024/1280/1440/1920 | **0 horizontal overflow** in 99 combinations (the only flag is the contact honeypot at `left:-9999px`, which does not scroll); 320 px and 1440 px screenshots reviewed |
| Accessibility, real Chrome | 8 pages: alt, names, heading order, contrast, focus on up to 200 Tab stops | **0 real failures**. 2 verified false positives: the home search pill shows focus via its border, and the image tip is white on a dark translucent pill |
| Dev artifacts | `grep -R console.log/debugger/localhost src public` | no `debugger` or `localhost`; `console.log` only in the build CLI; client `console.error` only on failure paths |
| Secrets | pattern scan of the repo and every added diff line | none found |
| Dependencies | `npm audit` | N/A: zero dependencies, no lockfile (`ENOLOCK`) |
| **Production (read-only)** | `curl` to bpozz.com | status/redirect behaviour below |
| **Production (read-only)** | `curl` to the Firebase RTDB REST API | read rules as described in M1; no writes |

Production redirect behaviour measured 2026-09-23:

| URL | Result |
| --- | --- |
| `/guides`, `/palettes`, `/colors`, `/image-picker` | 301 → same + `/` |
| `/guides/`, `/palettes/`, `/image-picker/` | 200 |
| `/about`, `/about.html`, `/contact.html`, `/privacy.html`, `/terms.html`, `/roadmap.html` | 200 |
| `/guide/<slug>` and `.html`, `/category/<slug>` and `.html`, `/search`, `/search.html` | 200 |
| `/guide/g6.html` | 301 → `/guide/whitespace-as-ui-component` |
| `/tokens`, `/_htaccess` | 410 |
| `/nope` | 404 (Netlify default page) |

**Gate files.** Intentional output changes were recorded with the repo's own tools: `scripts/qa/approved-output.json` (`BPOZZ_APPROVE_OUTPUT=1`) and `scripts/qa/baseline/{html-checksums,url-snapshot}.json` (`BPOZZ_WRITE_BASELINE=1`). Before re-recording, the URL gate listed exactly 4 canonical changes and 5 added WebP assets. Archived Phase 3 evidence and the palette fixture are untouched.

**Pre-commit review corrections (this pass).**
- Reverted an accidental leftover: three committed page copies (`index.html`, `category/color-theory.html`, `category/systems.html`) still carried `/palettes/#pNNN` after that change was abandoned in pass 2. Published output was never affected (the build regenerates those regions; a gated build confirmed no output change).
- Fixed a stale comment in `search.js` and a doc comment in `categories.js` that had ended up above the wrong function. No output change.
- Firebase doc: concrete Rules Playground values, and restored a paragraph break.
- CSP: added Google Fonts and the remaining GA4 origins (F11).

**Not verified anywhere:** Firebase write rules; a real Formspree delivery; live Netlify header and CSP behaviour; Safari/iOS and Firefox; real screen readers (the checks were structural, not NVDA/VoiceOver).

**Audit tooling** (`sharp`, `puppeteer-core`, test scripts, image backups) lives in a temporary scratch directory outside the repository and is not part of the diff.
