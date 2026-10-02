# Account Saved items

**Status (2026-09-30):**

- **Phase 1 is in place.** The migration below has been run and its
  verification passed, in the Supabase SQL editor; neither is to be run
  again. `SAVED_ENABLED` is `"true"` in Netlify's production context, so both
  endpoints are on in production; deploy previews and branch deploys leave it
  unset and answer `503 saved_unavailable`.
- **Phase 2 is launched.** The browser module
  ([Browser module](#browser-module)), the account Saved area
  ([Account Saved area](#account-saved-area)), Save on the font pages
  ([Save on Fonts](#save-on-fonts)), Save on `/palettes`
  ([Save on Palettes](#save-on-palettes)), Save on `/colors`
  ([Save on Colors](#save-on-colors)) and Save on the guide pages
  ([Save on Guides](#save-on-guides)) ship with `LAUNCHED = true`: signed-in
  visitors save to their account, `/account` lists their Saved items, and the
  privacy policy describes it (`privacy.html`, "Saved items").

| phase | scope | state |
|---|---|---|
| 1 | `public.saved_items` (SQL below, run by the owner), `GET`/`POST`/`DELETE /api/saved`, `POST /api/saved/import`, tests | done: table created and verified; `SAVED_ENABLED` `"true"` in production |
| 2 | M1 the browser module · M2 the account Saved area and the import of old browser saves · M3–M6 Save on Fonts, Palettes (beside the Like), Colors and guide article pages · M7 final integration and launch preparation | launched: M1, M2, M3 (Fonts), M4 (Palettes), M5 (Colors) and M6 (guide pages) done; M7 done (M7.1: the cross-page integration test, and `/account`'s empty-state hint no longer names Image Picker palettes; M7.2: the Saved tests set the launch switch both ways themselves; M7.3: the dormant build verified in production; M7.4: the privacy policy, `SAVED_ENABLED` in production, and `LAUNCHED = true`) |
| later | Save on Icons | waits until the real icon packs replace the current sample set |

## What is saved

One account-level list per signed-in user. A row holds its owner
(`user_id`), a **kind**, an **item id** and the time it was saved
(`created_at`) — never a name, preview or anything else.

| kind | item id | from |
|---|---|---|
| `color` | `c001` … `c1200` | `colors/colors-data.json` `id` |
| `palette` | `p001` … `p600` | `palettes/palettes-data.json` `id` |
| `font` | slug, e.g. `abhaya-libre` | `src/data/fonts.json` `id` |
| `icon` | `pack--id`, e.g. `outline-essentials--arrow-left` | `src/data/icons.json` (`id` alone repeats across packs) |
| `guide` | slug | `guides.json` `id` |
| `image_palette` | the colours in order, lowercase, no `#`, joined by `-`, 3–8 of them, e.g. `1e193b-322a57-5438e6` | the Image Picker's on-screen palette |

The account Saved area (Phase 2) shows Colors, Palettes, Fonts, Image Picker
palettes and UI/UX Guides. Icons are already a valid kind; they get Save
buttons once the real icon packs replace the current sample set.

- **Learning Roadmap progress is not a saved item.** It stays in the browser
  (`point-roadmap-progress`, `src/client/roadmap.js`); `roadmap` is not a
  valid kind, and the import accepts only fonts and palettes.
- **Image Picker: colours only.** The image is read on the device and never
  uploaded. The database accepts only 3–8 hex colours in `item_id` and has no
  other column that could hold data.
- **Firebase is unchanged.** The anonymous palette like counter
  (`src/client/palettes.js`, Realtime Database `likes/<id>`) keeps exactly its
  current behaviour. Nothing in this API reads or writes it, and the import
  does not reconcile it. Any change to it needs its own, separately approved
  migration.

## Architecture

```text
Browser ──> bpozz.com/api/saved*  ──> Netlify Functions ──> Supabase Data API (PostgREST)
            same origin, no CORS      reads the HttpOnly      verifies the token; RLS
            HttpOnly session cookie   session cookie          limits rows to its owner
```

How the signed-in user's access token reaches Supabase without page
JavaScript ever seeing it:

1. The page calls `fetch("/api/saved", { credentials: "same-origin" })`. The
   browser attaches `__Host-bpozz_session` itself (HttpOnly, Secure,
   `SameSite=Lax`, `Path=/` — see [AUTH.md](AUTH.md#cookies)).
2. The function reads only that cookie (`readAccessToken`); the refresh
   cookie is never read.
3. It decodes the token's payload **without** verifying it (`tokenSubject`)
   and requires `role: "authenticated"`, a UUID `sub` and not anonymous —
   otherwise 401 without calling Supabase. Expiry is left to Supabase: an
   expired token gets Supabase's 401, and `/api/auth/session` refreshes only
   once Supabase refuses a token, so a local expiry check could refuse a
   token the refresh path still treats as valid.
4. It calls `{SUPABASE_URL}/rest/v1/saved_items` server-to-server with
   `apikey: {SUPABASE_ANON_KEY}` and `Authorization: Bearer <token>`.
5. PostgREST verifies the signature and expiry and runs as `authenticated`
   with `auth.uid()` = the token's `sub`; row-level security applies.
6. The browser gets only `{ items: [{ kind, id, saved_at }] }`-style JSON,
   `Cache-Control: no-store`. Never the token or the user id, never a
   `Set-Cookie`, never Supabase's error text.

The function never refreshes a session. An expired access token is a 401;
the browser (Phase 2) asks `GET /api/auth/session` — which refreshes and
re-issues the cookies — and retries once.

## Files

| file | role |
|---|---|
| `netlify/functions/saved.mjs` | `GET`, `POST`, `DELETE /api/saved` |
| `netlify/functions/saved-import.mjs` | `POST /api/saved/import` |
| `netlify/lib/saved.mjs` | kinds and id rules, request checks, token reading, Supabase Data API calls, list pagination, response mapping. Uses `netlify/lib/auth.mjs` helpers without changing them |
| `netlify/lib/saved.test.mjs` | tests, with Supabase stubbed (`npm test`), including the check that `src/client/saved.js` repeats these kinds, id rules and limits exactly |
| `src/client/saved.js` | the browser module — see [Browser module](#browser-module) |
| `src/client/saved.test.js` | its tests, run in a vm against `src/client/test-dom.js` (`npm test`) |
| `src/client/account.js` | the account Saved area on `/account` — see [Account Saved area](#account-saved-area) |
| `src/client/account.test.js` | its tests, with the real `saved.js`, plus checks on `account.html` and the build wiring (`npm test`) |
| `src/client/fonts.js` | the font pages' script; hands their Save buttons to `saved.js` once launched — see [Save on Fonts](#save-on-fonts) |
| `src/client/fonts.test.js` | its Save tests, dormant and launched, with the real `saved.js` (`npm test`) |
| `src/client/palettes.js` | the `/palettes` script; draws a Save button beside each heart once launched — see [Save on Palettes](#save-on-palettes) |
| `src/client/palettes.test.js` | its Save tests, dormant and launched, with the real `saved.js`, including the Like's independence (`npm test`) |
| `src/client/colors.js` | the `/colors` script; draws a Save button beside each colour's name once launched — see [Save on Colors](#save-on-colors) |
| `src/client/colors.test.js` | its Save tests, dormant and launched, with the real `saved.js`, including the copy's independence (`npm test`) |
| `src/client/guides.js` | an `/app.js` fragment; once launched, adds a Save button to the hero on every `/guide/` page and to each card on `/guides` — see [Save on Guides](#save-on-guides) |
| `src/client/guides.test.js` | its Save tests, dormant and launched, with the real `saved.js`, for the guide pages and for the `/guides` cards, plus checks on every guide page, on `/guides`' build-time cards and on `/app.js`'s order (`npm test`) |
| `src/client/saved-integration.test.js` | the wiring across pages: the Save kinds drawn (font, palette, color, guide), auth and Saved loaded before each page's script, `saved.js` as the one Save click handler, and the one launch switch (`npm test`) |

## API

Every response these two functions send is JSON with
`Cache-Control: no-store`; Netlify's `429` (Rate limits, below) is not.
Writes (`POST`, `DELETE`) need a same-origin `Origin`: exactly this site's
origin or `AUTH_ORIGIN` (`isSameOriginRequest`).

| request | responses |
|---|---|
| `GET /api/saved[?kind=<kind>]` | `200 {"items":[{"kind":"font","id":"abel","saved_at":"…"}],"count":1,"limits":{"total":1000,"image_palette":200}}`, newest first |
| `POST /api/saved` `{"kind","id"}` (exactly these keys) | `201 {"saved":true,"created":true}` · `200 {"saved":true,"created":false}` (already saved) · `409 {"error":"limit_reached","limit":1000}` · `409 {"error":"limit_reached","limit":200,"kind":"image_palette"}` |
| `DELETE /api/saved?kind=<kind>&id=<id>` | `200 {"saved":false,"removed":true}` · `200 {"saved":false,"removed":false}` (was not saved) |
| `POST /api/saved/import` `{"items":[{"kind","id"},…]}` — fonts and palettes, 1–1,000 items, ≤ 64 KB | `200 {"results":[{"kind","id","status"}],"created":n,"existing":n,"invalid":n,"limited":n}`; `status` is `created`, `exists`, `invalid` or `limit` |

Shared failures: `400 {"error":"invalid_request"}` (bad kind, id, body or
query) · `401 {"error":"unauthenticated"}` · `403 {"error":"forbidden"}` ·
`405 {"error":"method_not_allowed"}` · `429` (Netlify's rate limit, below) ·
`503 {"error":"saved_unavailable"}` (`SAVED_ENABLED` off, not configured, or
Supabase unreachable / refusing).

The import trims its inserts to the room left under the cap, so it reports
per-item `limit` rather than a 409. It inserts only new items, all-or-nothing;
if another tab or device saves in between (duplicate or limit), it re-reads
and tries once more, then answers 503.

### Rate limits

Netlify applies these per IP and domain, before the function runs:
`/api/saved` 120 requests per 60 s (`GET`, `POST` and `DELETE` together),
`/api/saved/import` 5 per 60 s. Over the limit Netlify answers `429` itself,
so the body is Netlify's, not this API's JSON: branch on the status, never
parse the body. The per-user caps are in the database (Limits, below).

What the browser (Phase 2) must do with a `429`:

- **Save / unsave:** undo the button's change, show "Too many changes at
  once. Try again in a minute.", and don't retry automatically — a retry
  counts against the same window.
- **List:** leave the Save buttons neutral and show the load error; the
  account page shows its error state with a Try again button.
- **Import:** show the error and leave the browser's old list untouched, so
  the visitor can import later.
- A `429` is not a sign-out: never send it through the 401 refresh-and-retry
  path.

## Browser module

`src/client/saved.js` is the browser half. It ships inside `/app.js`, right
after `auth.js` (whose `window.BpozzAuth` it relies on), and on its own at
`/saved.js` for `/account`, which loads `/auth.js` but not `app.js`.

**The launch switch.** The file holds `var LAUNCHED = true;`: Saved is
launched. Set to false, the module would publish only
`window.BpozzSaved = { active: false, kinds, limits, isValidItem, imagePaletteId }`
and stop: no listener, no request, no storage access, nothing drawn, so every
page would behave exactly as before Saved. The launch changed that one line,
together with the privacy policy.

**Tests and the switch.** Every Saved test sets the switch itself, whichever
value `saved.js` ships with: the dormant tests run it with `LAUNCHED false`,
the launched tests with it `true`, and `saved.test.js` checks that this works
from either value. One test checks what ships — "the shipped file is
launched", in `src/client/saved.test.js` — so changing that line changes that
test's expected value too, and its approval build re-records `saved.js` and
`app.js`.

Once active:

| part | behaviour |
|---|---|
| session | the answer `auth.js` already fetched (`BpozzAuth.getSession()`), then the `bpozz:session` event `auth.js` fires on `document` after every real answer (`{ authenticated }` only — never for the header's 1.5 s placeholder). After a `401` from this API: one `BpozzAuth.refreshSession()` shared by every request that failed together, then each is sent once more; still `401`, or signed out, and the page is treated as signed out |
| state | page memory only, per kind, from `GET /api/saved?kind=<kind>` for the kinds the page has controls for; read again when the page comes back from the back/forward cache, or is shown again 5 minutes or more after its list loaded. Nothing about the account is written to browser storage |
| controls | every `button[data-save-kind][data-save-id]`, plus any drawn later and handed over with `BpozzSaved.sync(root)`: `aria-pressed`, `aria-busy` while a request runs, and a `[data-save-label]` child reading Save / Saved (or the pair it names, e.g. `"Save palette\|Saved"`). Signed out, a click opens the existing sign-in dialog; nothing is remembered for after it |
| changes | shown at once, one request at a time per item. A failed change is undone and said once in the site toast: 429 "Too many changes at once. Try again in a minute." (never retried, never refreshed), the two 409 limits, 503 or no answer "Saving isn’t available right now", anything else "Couldn’t save that" / "Couldn’t remove that". Success is only announced, in a polite live region |
| other tabs | `BroadcastChannel("bpozz-saved")`, where the browser has it: `{ type: "item", kind, id, saved }` after a change, and `{ type: "session" }` after a sign-out, on which other tabs ask the server again. Nothing about who is signed in |
| old browser saves | `legacy()` reads `bpozz:font-favorites` and `bpozz-palette-likes`, keeping only well-formed ids. `importLegacy({ fonts, palettes, known })` sends fonts by default and palette likes only when asked, at most 1,000, to `POST /api/saved/import`. Afterwards it removes from `bpozz:font-favorites` only the ids answered `created` or `exists` (re-reading the list first, deleting it once empty), never writes `bpozz-palette-likes`, and writes `bpozz:saved-import` = `{"v":1,"dismissed":true}`; any failure leaves browser storage as it was |

The rest of `window.BpozzSaved` once active: `signedIn()`, `has(kind, id)`,
`list(kind?)`, `save(kind, id)`, `remove(kind, id)`, `onChange(fn)`,
`importDismissed()` and `dismissImport()`.

It never reads `point-roadmap-progress` (Learning Roadmap progress stays in
the browser), never touches the Firebase like counter, never stores or sends a
token, user id or email address, and never inserts text from the server or
browser storage as HTML.

## Account Saved area

`src/client/account.js`, published at `/account.js` and loaded only by
`account.html`, after `/auth.js` and `/saved.js`. It is not in `/app.js`. The
header's account menu already links its Saved item to `/account#saved`, so
`auth.js` is unchanged.

**Dormant with the module.** Unless `window.BpozzSaved.active` is true it does
nothing: the Saved section keeps its original text (a link to the fonts saved
in this browser) and the list container stays hidden.

Once active:

| part | behaviour |
|---|---|
| list | `BpozzSaved.list()`, drawn newest first in five groups — Colors, Palettes, Fonts, Image Picker palettes, UI/UX Guides. Icon items are not drawn yet |
| names | from `/colors/colors-data.json`, `/palettes/palettes-data.json` and `/guides.json`, each fetched only when the list holds that kind. Fonts have no published names file yet, so a font shows its id; an Image Picker palette is its own colours. Without a file an item shows its id; an id the file no longer has reads "No longer available" and is not linked |
| links | colours `/colors/`, palettes `/palettes#<id>`, fonts `/fonts/<id>.html`, guides `/guide/<id>`; Image Picker palettes have no page |
| states | loading, empty, the list, and a failed list with Try again. Signed out, nothing about the account stays on the page |
| remove | `BpozzSaved.remove()`; the row goes once the server confirms, and focus moves to the next Remove button (or the one before, or the empty message). A failure keeps the row; `saved.js` says why |
| current | a removal in another tab disappears at once; the list is read again when the page is shown after a minute away or restored from the back/forward cache |
| import | offered once when `legacy()` finds old font favorites or palette likes (likes only for palettes still on the site) and the offer wasn't dismissed. Fonts are ticked, likes are not. Add runs `importLegacy`; No thanks runs `dismissImport` |

## Save on Fonts

The heart on every `/fonts/` card and the Save button on each
`/fonts/<id>.html` page (both rendered by `src/build/fonts.js`, unchanged) are
handled by `src/client/fonts.js`, which runs after `/app.js`.

**Dormant with the module.** While `window.BpozzSaved.active` is false,
nothing changes: the buttons save to this browser (`bpozz:font-favorites`),
other tabs follow through the `storage` event, and `?category=saved` lists
this browser's favorites.

Once active, the same buttons are account Saved:

| part | behaviour |
|---|---|
| buttons | at load, each gains `data-save-kind="font"`, `data-save-id` and `data-save-name` (the detail page's text also `data-save-label`) and is handed to `saved.js` with `sync()`. `saved.js` paints, saves, removes, announces and, signed out, opens sign-in; `fonts.js` no longer handles them, so each click is handled once and nothing is written to this browser. The markup and `fonts.css` are unchanged |
| requests | the page's one `GET /api/saved?kind=font`, from `saved.js`; `fonts.js` makes none |
| Saved view | `?category=saved` shows the account's saved fonts, following `onChange`. Until they are known it shows none: signed out, "Sign in to see your saved fonts."; still loading (or failed — `saved.js` then says so), "Your saved fonts haven't loaded yet." This browser's favorites never show here |
| old favorites | never shown or sent from the font pages. When the Saved view is empty and `legacy()` still has fonts (and the offer wasn't dismissed), it points to Your Account, where the import is |

Font names on `/account` are not part of this: it still shows fonts by id.

## Save on Palettes

`/palettes` (`palettes/index.html`, unchanged) is drawn by
`src/client/palettes.js`, which runs after `/app.js`. Styles are in
`src/styles/palettes.css`.

**Dormant with the module.** While `window.BpozzSaved.active` is false there
is no Save button: every card is drawn exactly as before, and nothing asks
the API.

Once active:

| part | behaviour |
|---|---|
| button | each card's foot gets a bookmark `button.palette-save-btn` right after the heart, with `data-save-kind="palette"`, `data-save-id`, `data-save-name` (its colour names, joined with ", "; left out when it has none), `aria-label="Save this palette"` and `aria-pressed`. A palette whose id `isValidItem` refuses gets none. After drawing the grid, `palettes.js` hands the buttons to `saved.js` with `sync(grid)` |
| clicks | `saved.js` paints, saves, removes, announces and, signed out, opens sign-in. `palettes.js` has no Save handler: its own click handling knows only the swatches and `.palette-like-btn`, so each Save click is handled once |
| requests | the page's one `GET /api/saved?kind=palette`, from `saved.js`, once both the session and the grid are known; `palettes.js` makes none |
| styles | `.palette-save-btn` in `palettes.css`: the site's action blue when saved (the heart stays pink), dimmed while `aria-busy`, at least 24 px square. Nothing matches it while dormant |

**The Like is separate and unchanged.** The heart keeps
`bpozz-palette-likes` in this browser and the anonymous Firebase counter
(`likes/<id>`) exactly as before, for signed-in and signed-out visitors
alike. Save never reads or writes either, and the heart never reads or
writes Saved; a palette can be liked, saved, both or neither. M4 migrates no
likes: they reach the account only through the import on `/account`, which
leaves them unticked (see [Account Saved area](#account-saved-area)).

There is no Saved view on `/palettes`: the account's saved palettes are
listed on `/account`, linked back to `/palettes#<id>`. The page's own wording
("Tap the heart to like a palette", "You don't need an account") is
unchanged while Saved is dormant.

## Save on Colors

`/colors` (`colors/index.html`, unchanged) is drawn by
`src/client/colors.js`, which runs after `/app.js`. Styles are in
`src/styles/colors.css`.

**Dormant with the module.** While `window.BpozzSaved.active` is false there
is no Save button: every card is drawn exactly as before, byte for byte, and
nothing asks the API.

Once active:

| part | behaviour |
|---|---|
| button | each card's name moves into a `div.color-card__foot` row, followed by a bookmark `button.color-save-btn` with `data-save-kind="color"`, `data-save-id`, `data-save-name` (the colour's name; left out when it isn't text or is empty), `aria-label="Save this color"` and `aria-pressed`. It sits outside the plate, which stays the copy button. A colour whose id `isValidItem` refuses gets none, and its card is drawn as before. After drawing the grid, `colors.js` hands the buttons to `saved.js` with `sync(grid)` |
| clicks | `saved.js` paints, saves, removes, announces and, signed out, opens sign-in. `colors.js` has no Save handler: its grid click handling knows only `.color-card__plate`, so each Save click is handled once and never copies |
| requests | the page's one `GET /api/saved?kind=color`, from `saved.js`, once both the session and the grid are known; `colors.js` makes none. Filtering only hides and shows cards, so it neither redraws the buttons nor asks again |
| styles | `.color-card__foot` and `.color-save-btn` in `colors.css`: the bookmark and states of `.palette-save-btn` — the site's action blue when saved, dimmed while `aria-busy`, at least 24 px square — with hover only on a fine pointer, as the plate's lift is. Nothing matches either while dormant |

**No Like on `/colors`.** The page has no Like or favourite, and M5 adds
none. A card's other action is copying its hex from the plate, which is
unchanged and separate from Save. Nothing on `/colors` writes to this
browser, launched or not, and there is nothing to import: the account's
saved colours are listed on `/account`, linked back to `/colors/`.

## Save on Guides

Every `/guide/<id>` page (rendered by `src/build/guide-template.js`,
unchanged) loads only `/app.js`. Save there is `initGuideSave` in
`src/client/guides.js`, one of `/app.js`'s fragments, which run after the
bundled `saved.js`. Styles are in `src/styles/guide-article.css`.

**Dormant with the module.** While `window.BpozzSaved.active` is false,
`initGuideSave` returns at once, on every page that loads `/app.js`: no Save
button, the page exactly as before, and nothing asks the API. No page's HTML
changes either way.

Once active:

| part | behaviour |
|---|---|
| button | the hero's meta line ("Color Theory · Beginner · 10 min read") ends in a bookmark `button.guide-save-btn` with `data-save-kind="guide"`, `data-save-id` (the page's `<body data-guide-id>`, its `guides.json` id), `data-save-name` (the page's heading, whitespace collapsed; left out when empty), `aria-label="Save this guide"` and `aria-pressed`. It is drawn at once from what the page holds, not after `guides.json` loads. A page without that id, with an id `isValidItem` refuses, or without the hero gets none. `initGuideSave` then hands it to `saved.js` with `sync(meta)`, which is needed: `saved.js` looked at the page before `/app.js`'s fragments ran |
| clicks | `saved.js` paints, saves, removes, announces and, signed out, opens sign-in. Nothing in `/app.js` handles the Save's click; the table of contents, the article's links and the related-guides rail are untouched and still followed |
| requests | the page's one `GET /api/saved?kind=guide`, from `saved.js`, once the session is known; `guides.js` makes none |
| styles | `.guide-save-btn` in `guide-article.css`: the bookmark and states of `/palettes` and `/colors`, a 16 px icon in a 24 px target whose negative block margins keep the meta line's height, so drawing it never moves the title; hover only on a fine pointer. Nothing matches it while dormant |

A guide page has no Like or favourite. The account's saved guides are listed
on `/account`, linked back to `/guide/<id>`.

### The `/guides` cards

The cards on `/guides` (`guides/index.html`, unchanged) also get a Save, from
`drawCardSaves` in the same fragment. Styles are in `src/styles/styles.css`,
scoped to `.guides-page .guides-grid`.

**Dormant with the module.** While `window.BpozzSaved.active` is false,
`drawCardSaves` returns at once: no button, every card exactly as before, and
nothing asks the API.

Once active:

| part | behaviour |
|---|---|
| button | each `.content-card` in `#grid-root` ends in a `button.card-save-btn` — the bookmark icon alone, with no visible text and no `[data-save-label]` — with `data-save-kind="guide"`, `data-save-id` (from the card's own link, `/guide/<id>`), `data-save-name` (the card's title, whitespace collapsed; left out when empty), `aria-label="Save <title>"` ("Save this guide" without a title), which is its only name and stays the same saved or not, and `aria-pressed`, which carries the state. A card without that link, or with an id `isValidItem` refuses, gets none. It is drawn on the build-time cards when `/app.js` runs, and again after every `render()`, which replaces the cards; each time `drawCardSaves` hands the grid to `saved.js` with `sync(gridRoot)` |
| clicks | `saved.js` paints, saves, removes, announces and, signed out, opens sign-in. The button is the card link's sibling, above the link's stretched `::after`, so a Save click is not a click on the link; the rest of the card still follows it |
| requests | the page's one `GET /api/saved?kind=guide`, from `saved.js`, once the session is known; redrawing the grid asks nothing more |
| styles | `.card-save-btn` in `styles.css`: a 40 px square button with the card thumbnail's own corner radius (`--guides-radius`, 8 px) and a 20 px bookmark, 8 px in from the thumbnail's top-right corner, positioned against `.content-card` and out of the flow, so it never resizes the card. On a fine pointer that can hover it is hidden (`opacity: 0`, still in the tab order) until its card is hovered or holds keyboard focus (`.content-card:has(:focus-visible)`: the card's link or the button itself), so the focus a mouse click leaves on the button does not keep it shown after the pointer leaves; elsewhere it is always shown. The action blue and a filled bookmark when saved; its contents dimmed while `aria-busy`. Nothing matches it while dormant |

Guide cards elsewhere — the home page, the `/category/` pages and the
related-guides rail — get no Save. They come from the shared card renderer,
`src/shared/card.js`, which the build uses too and which carries no Save
markup; `drawCardSaves` only looks in `/guides`' `#grid-root`.

## Supabase requests

Every request carries:

```text
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {access token from __Host-bpozz_session}
Accept: application/json
```

with a 5 s timeout and redirects refused. `{sub}` is the token's user id;
`{kind}` and `{id}` have passed the id rules, so they contain only `a–z`,
`0–9` and `-` and can't carry PostgREST filter syntax.

**List** — pages until every row is read:

```text
GET /rest/v1/saved_items
  ?select=kind,item_id,created_at
  &user_id=eq.{sub}
  &kind=eq.{kind}            (only for GET ?kind=)
  &order=created_at.desc,kind.asc,item_id.asc
  &limit=1000
  &offset={rows read so far}
Prefer: count=exact
```

The total comes from `Content-Range` (`0-24/25`, `*/0`). **Supabase's
Max rows must be 1,000 or more** (Prerequisites): with the 1,000-item cap,
every list is then one request — one consistent snapshot, so it is complete.

With a lower Max rows the function falls back to reading page by page, up to
20 requests (so Max rows ≥ 50 still reaches 1,000 items; needing more pages
is 503 and a log line asking to raise Max rows). If the rows don't add up to
the count or repeat, or a later page is out of range (`416`: rows were
deleted between pages) — a change landed mid-read — the list is read once
more; still inconsistent is 503. So the fallback never returns a short list,
but offset paging can't rule out one rare race: a save that sorts below a
page boundary (its transaction started before newer saves were committed,
e.g. queued behind an import from another tab) while an item above the
boundary is deleted between two page reads. The count still matches, so that
list could swap one saved item for the just-deleted one. That race is why
Max rows ≥ 1,000 is required.

A row that fails the id rules makes the whole list 503 rather than being
skipped (fail-closed).

**Save:**

```text
POST /rest/v1/saved_items
Content-Type: application/json
Prefer: return=minimal

{"kind":"font","item_id":"abel"}
```

No `user_id`: an insert can't carry a filter, and the column can't be
written — the database sets it from the token.

**Unsave:**

```text
DELETE /rest/v1/saved_items
  ?user_id=eq.{sub}
  &kind=eq.{kind}
  &item_id=eq.{id}
  &select=kind,item_id
Prefer: return=representation
```

**Import:** the list request above, then one insert of only the new items:

```text
POST /rest/v1/saved_items
Content-Type: application/json
Prefer: return=minimal

[{"kind":"font","item_id":"abel"},{"kind":"palette","item_id":"p001"}]
```

The `user_id=eq.{sub}` filter is on every read and delete as a second guard
behind row-level security. A forged `sub` fails Supabase's signature check
first (401).

How Supabase's answers map, per endpoint. The import runs the list request
first, and on that step it answers as the list column does; its column below
is its insert.

| Supabase answer | save (`POST`) | unsave (`DELETE`) | list (`GET`) | import (insert) |
|---|---|---|---|---|
| 2xx | `201 created:true` | `200 removed:true` or `false` | `200` (or the next page) | `200` |
| `23505` duplicate | `200 created:false` | — | — | re-read and retry once, then `503` |
| `P0001` `saved_items_limit` | `409` limit 1000 | — | — | re-read and retry once, then `503` |
| `P0001` `saved_items_image_limit` | `409` limit 200, `image_palette` | — | — | — (fonts and palettes only) |
| 401 (expired, revoked or forged token) | `401` | `401` | `401` | `401` |
| `23503` (account deleted since the token was issued) | `401` | — | — | `401` |
| 401 mentioning the API key | `503`, logged | `503`, logged | `503`, logged | `503`, logged |
| other 400 (e.g. `23514`) | `400`, logged | `503`, logged | `503`, logged | `400`, logged |
| 416 (rows deleted between pages) | — | — | re-read once, then `503` | — |
| 403 / `42501` | `503`, logged: check grants and policies | `503`, logged | `503`, logged | `503`, logged |
| 404 / `42P01` / `PGRST205` | `503`, logged: migration not run? | `503`, logged | `503`, logged | `503`, logged |
| other status, timeout, non-JSON, unexpected response | `503`, logged | `503`, logged | `503`, logged | `503`, logged |

A list that is still inconsistent after its one re-read is `503`, logged
once ("changed while it was being read, twice"); a 416 on its own is not
logged, since it means a change, not an outage.

Log lines go through the shared `logProblem` helper in `auth.mjs`, so they
are prefixed `[auth]`: search Netlify's function logs for `[auth] saved`
(`saved`, `saved-list`, `saved-add`, `saved-remove`, `saved-import`). They
carry fixed text and machine codes only — never tokens, user ids, emails,
keys or Supabase's messages (which can contain row values).

## Limits

1,000 items per user in total, of which at most 200 `image_palette`.

| situation | result |
|---|---|
| new item, under both limits | saved (`201`) |
| the same item again, **including at a limit** | the trigger lets it through to the primary key → duplicate → `200 created:false` |
| new item at 1,000 | `409 limit_reached` (1000) |
| new image palette at 200 (total under 1,000) | `409 limit_reached` (200, `image_palette`) |
| unsave at a limit | always works |
| two new saves at once at 999 | the per-user advisory lock serialises them: one `201`, one `409` |
| import near the limit | trimmed to the room left; the rest `limit` |

Exact counting under concurrency relies on the default `READ COMMITTED`
isolation (see Prerequisites) and is proven by Phase 1 check 5.

## Database

Run in the Supabase SQL editor **by the owner**, only after the
prerequisites below. Every line is under 80 characters.

### Migration

```sql
-- BPOZZ: account Saved items, migration 001 (see docs/SAVED.md).
-- Run once, as the default postgres role, in the Supabase SQL editor.
-- All-or-nothing: any error rolls the whole script back.

begin;

-- 1. Table -----------------------------------------------------------

create table public.saved_items (
  user_id    uuid        not null default auth.uid(),
  kind       text        not null,
  item_id    text        not null,
  created_at timestamptz not null default now(),

  constraint saved_items_pkey
    primary key (user_id, kind, item_id),

  constraint saved_items_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,

  -- 2. CHECK constraints ---------------------------------------------

  constraint saved_items_kind_check
    check (
      kind in (
        'color', 'palette', 'font', 'icon', 'guide', 'image_palette'
      )
    ),

  constraint saved_items_item_id_check
    check (
      case kind
        when 'color' then
          item_id ~ '^c[0-9]{3,4}$'
        when 'palette' then
          item_id ~ '^p[0-9]{3,4}$'
        when 'font' then
          char_length(item_id) <= 64
          and item_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        when 'icon' then
          char_length(item_id) <= 120
          and item_id ~ '^[a-z0-9]+(-[a-z0-9]+)*--[a-z0-9]+(-[a-z0-9]+)*$'
        when 'guide' then
          char_length(item_id) <= 100
          and item_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        when 'image_palette' then
          item_id ~ '^[0-9a-f]{6}(-[0-9a-f]{6}){2,7}$'
        else
          false
      end
    )
);

comment on table public.saved_items is
  'BPOZZ account Saved items: one row per user, kind and item.';

-- 3. Per-user limits ---------------------------------------------------
-- In a schema the Data API does not expose, so it is not callable
-- over REST. VOLATILE is required: it makes each query inside see rows
-- inserted earlier in the same statement (bulk import) and rows other
-- transactions committed while this one waited for the lock.

create schema if not exists private;

create or replace function private.saved_items_limits()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  total_count integer;
  image_count integer;
begin
  -- One writer per user until this transaction ends, so two
  -- concurrent saves cannot both pass the counts below.
  perform pg_advisory_xact_lock(
    hashtext('public.saved_items'),
    hashtext(new.user_id::text)
  );

  -- Re-saving an existing item is left to the primary key (unique
  -- violation = "already saved"), even when the user is at a limit.
  if exists (
    select 1
      from public.saved_items s
     where s.user_id = new.user_id
       and s.kind = new.kind
       and s.item_id = new.item_id
  ) then
    return new;
  end if;

  select count(*),
         count(*) filter (where s.kind = 'image_palette')
    into total_count, image_count
    from public.saved_items s
   where s.user_id = new.user_id;

  if total_count >= 1000 then
    raise exception using
      errcode = 'P0001',
      message = 'saved_items_limit';
  end if;

  if new.kind = 'image_palette' and image_count >= 200 then
    raise exception using
      errcode = 'P0001',
      message = 'saved_items_image_limit';
  end if;

  return new;
end;
$$;

revoke all on function private.saved_items_limits() from public;

create trigger saved_items_limits
  before insert on public.saved_items
  for each row
  execute function private.saved_items_limits();

-- 4. Grants and row-level security ------------------------------------

alter table public.saved_items enable row level security;

revoke all on table public.saved_items
  from public, anon, authenticated;

grant select, delete on table public.saved_items
  to authenticated;

-- Only these two columns may be written. user_id and created_at
-- always come from their defaults.
grant insert (kind, item_id) on table public.saved_items
  to authenticated;

create policy saved_items_select_own
  on public.saved_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy saved_items_insert_own
  on public.saved_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy saved_items_delete_own
  on public.saved_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE grant and no UPDATE policy, deliberately.

commit;
```

Why `user_id` can't name another user: the `authenticated` role may insert
only `kind` and `item_id` (naming `user_id` is a permission error); the
default fills it from `auth.uid()`; the insert policy re-checks it; and the
API never sends it. No UPDATE grant or policy is needed: an item is only
ever added or removed.

### Rollback

Only if the table must go. Unset `SAVED_ENABLED` first.

```sql
begin;
drop table if exists public.saved_items;   -- also drops trigger + policies
drop function if exists private.saved_items_limits();
commit;
```

### Verification

Run after the migration. Replace `USER_A_UUID` and `USER_B_UUID` with two real
test accounts from Authentication → Users (they must exist: every row
references `auth.users`). Everything is rolled back at the end. Each block
prints an `ok` notice or stops with a `FAIL` message.

```sql
begin;

-- anon has no access at all
set local role anon;
do $$
begin
  perform 1 from public.saved_items;
  raise exception 'FAIL: anon can read saved_items';
exception when insufficient_privilege then
  raise notice 'ok: anon cannot read';
end $$;
reset role;

-- user A
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"USER_A_UUID","role":"authenticated"}',
  true
);

do $$
declare
  n integer;
begin
  -- 1. A can save; the row belongs to A
  insert into public.saved_items (kind, item_id)
  values ('font', 'abel');
  select count(*) into n
    from public.saved_items
   where user_id = auth.uid();
  if n <> 1 then
    raise exception 'FAIL: expected 1 row for A, got %', n;
  end if;

  -- 2. duplicate -> unique violation
  begin
    insert into public.saved_items (kind, item_id)
    values ('font', 'abel');
    raise exception 'FAIL: duplicate accepted';
  exception when unique_violation then null;
  end;

  -- 3. malformed id -> check violation
  begin
    insert into public.saved_items (kind, item_id)
    values ('font', 'Abel');
    raise exception 'FAIL: malformed id accepted';
  exception when check_violation then null;
  end;

  -- 4. roadmap is not a kind
  begin
    insert into public.saved_items (kind, item_id)
    values ('roadmap', 'type-scale-systems');
    raise exception 'FAIL: roadmap kind accepted';
  exception when check_violation then null;
  end;

  -- 5. user_id cannot be supplied
  begin
    insert into public.saved_items (user_id, kind, item_id)
    values (gen_random_uuid(), 'font', 'abel');
    raise exception 'FAIL: user_id accepted';
  exception when insufficient_privilege then null;
  end;

  -- 6. no updates
  begin
    update public.saved_items set created_at = now();
    raise exception 'FAIL: update allowed';
  exception when insufficient_privilege then null;
  end;

  -- 7. total cap: 1 + 999 = 1000 rows; the next new item is refused
  insert into public.saved_items (kind, item_id)
  select 'color', 'c' || lpad(g::text, 3, '0')
    from generate_series(1, 999) g;
  begin
    insert into public.saved_items (kind, item_id)
    values ('color', 'c1000');
    raise exception 'FAIL: 1001st item accepted';
  exception when raise_exception then
    if sqlerrm <> 'saved_items_limit' then raise; end if;
  end;

  -- 8. a duplicate at the cap is "already saved", not "full"
  begin
    insert into public.saved_items (kind, item_id)
    values ('font', 'abel');
    raise exception 'FAIL: duplicate at cap accepted';
  exception when unique_violation then null;
  end;

  raise notice 'ok: user A checks passed';
end $$;

-- user B
select set_config(
  'request.jwt.claims',
  '{"sub":"USER_B_UUID","role":"authenticated"}',
  true
);

do $$
declare
  n integer;
begin
  -- 9. B sees none of A's rows and cannot delete them
  select count(*) into n from public.saved_items;
  if n <> 0 then
    raise exception 'FAIL: B sees % rows', n;
  end if;
  delete from public.saved_items
   where kind = 'font' and item_id = 'abel';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: B deleted % of A''s rows', n;
  end if;

  -- 10. image-palette cap: 200 allowed, the 201st refused
  insert into public.saved_items (kind, item_id)
  select 'image_palette',
         lpad(to_hex(g), 6, '0') || '-000000-ffffff'
    from generate_series(1, 200) g;
  begin
    insert into public.saved_items (kind, item_id)
    values ('image_palette', '0000c9-000000-ffffff');
    raise exception 'FAIL: 201st image palette accepted';
  exception when raise_exception then
    if sqlerrm <> 'saved_items_image_limit' then raise; end if;
  end;

  -- 11. B can remove its own item
  delete from public.saved_items
   where kind = 'image_palette'
     and item_id = '000001-000000-ffffff';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: B could not delete its own row';
  end if;

  raise notice 'ok: user B checks passed';
end $$;

rollback;
```

What the verification does and doesn't prove:

| group | checks | proves |
|---|---|---|
| **production-equivalent** — table constraints and the trigger, which apply however a request arrives | 2 duplicate · 3 malformed id · 4 `roadmap` refused · 7 1,000 cap · 8 duplicate at the cap · 10 200 image-palette cap | constraints, primary key and limit trigger behave as specified |
| **depends on SQL Editor role switching and hand-set claims** (`set local role`, `set_config('request.jwt.claims', …)`) | anon block · 1 default `user_id` · 5 `user_id` not writable · 6 no update · 9 B can't see / delete A's rows · 11 B deletes its own | the real grants and policies are right — but the identity is simulated, where PostgREST derives it from a verified token. If the editor can't switch roles these fail to run; the Phase 1 API checks cover them |
| **not covered** | a real token through PostgREST · anon REST access without a token · concurrent saves at the cap (one transaction here) · cascade on user deletion · HTTP status mapping · Max rows / pagination | the Phase 1 checks below |

## Prerequisites

**Supabase, before running the migration:**

1. Settings → Data API: the API is on; exposed schemas include `public` and
   **not** `private`; **Max rows is 1,000 or more — required.** That makes
   every saved list a single, consistent read. If it's lower, raise it before
   going live.
2. Database → Schemas: if a `private` schema already exists **and** is
   exposed, stop.
3. Settings → Infrastructure: Postgres 13 or later (`gen_random_uuid()` in
   the verification).
4. In the SQL editor, first run `show default_transaction_isolation;` —
   expected `read committed` (read-only).
5. The key in Netlify's `SUPABASE_ANON_KEY` is the anon (legacy JWT) or
   publishable key, **not** the service-role / secret key. Note the access
   token (JWT) expiry — about 3,600 s expected.
6. Note the "automatically expose new tables" setting (either is fine: the
   grants are explicit), and decide whether GraphQL (`pg_graphql`) stays on —
   it would expose this table under the same grants and policies.
7. Authentication → Users: the user ids of two test accounts (ideally one
   Google, one email) and one throwaway account.
8. After the migration: Security Advisor shows no RLS or search-path
   warnings for `saved_items`; the table shows RLS enabled.

**Netlify, before deploying:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` in
Functions scope (already there for sign-in); `SAVED_ENABLED` **not** set for
the first deploy; deploys build from the repository; rate limiting enforced
on the plan (compare the email functions' limits); note the function
allowance.

**Firebase:** nothing.

**Before Phase 2 (not blocking Phase 1):**

- **Account linking.** Saves belong to the Supabase user id. Confirm that
  Google and an email link for the same address give the **same** id, in
  both orders and after an unclicked email link ([AUTH.md real-project
  checks](AUTH.md#real-project-checks), item 1). If not, saves would split
  across two accounts.
- Supabase plan: database size, egress, inactivity pausing, backups.

## Phase 1 checks

Order: migration → verification → deploy with `SAVED_ENABLED` unset
(`/api/saved` answers `503 saved_unavailable`) → set `SAVED_ENABLED=true`
(Functions scope) and redeploy → checks → cleanup → unset `SAVED_ENABLED`
until Phase 2.

Paste this helper into the DevTools console of **each** bpozz.com tab you
test from — the signed-in window, the private window (check 1), account B's
browser (check 3) and the throwaway account's browser (check 7). It returns
`[status, body]`; a reply that isn't JSON (Netlify's `429`, or a 404 page if
the functions aren't deployed) comes back as its status and first 120
characters instead of throwing.

```js
const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body && JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return [r.status, JSON.parse(text)];
  } catch {
    return [r.status, text.slice(0, 120)];
  }
};
```

1. **Signed out** (private window): `await api("GET", "/api/saved")` →
   `401`.
2. **Account A:**
   `api("POST", "/api/saved", { kind: "font", id: "abel" })` → `201`;
   again → `200 created:false`; `api("GET", "/api/saved")` lists it;
   `api("DELETE", "/api/saved?kind=font&id=abel")` → `removed:true`; again →
   `removed:false`.
3. **Account B** (another browser): `GET` doesn't list A's items; deleting
   one of A's ids → `removed:false`.
4. **Bad requests:** `api("POST", "/api/saved", { kind: "roadmap", id: "x" })`
   → `400`. A POST without an `Origin` header → `403`. Browsers always send
   `Origin` on a POST, so run this one from a terminal; it needs no cookie or
   key. Each command prints the status code.

   Windows PowerShell (5.1 or 7):

   ```powershell
   try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "https://bpozz.com/api/saved" -ContentType "application/json" -Body '{"kind":"font","id":"abel"}' } catch { [int]$_.Exception.Response.StatusCode }
   ```

   bash (Linux, macOS, Git Bash):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://bpozz.com/api/saved" -H "Content-Type: application/json" -d '{"kind":"font","id":"abel"}'
   ```

   Both print `403`.
5. **Concurrent saves at the cap.** Seed account A to 998 items (SQL
   editor, as `postgres`, the table owner):

   ```sql
   insert into public.saved_items (user_id, kind, item_id)
   select 'USER_A_UUID', 'color', 'c' || lpad(g::text, 3, '0')
     from generate_series(1, 998) g;
   ```

   then, as A:

   ```js
   await Promise.all(
     ["c999", "c1000", "c1001", "c1002", "c1003"].map((id) =>
       api("POST", "/api/saved", { kind: "color", id }).then(([s]) => s),
     ),
   ); // two 201 and three 409, in any order
   ```

6. **Full list at the cap:** after check 5, `api("GET", "/api/saved")`
   returns `count: 1000`.
7. **Cascade:** save something as the throwaway account, delete that user in
   Authentication → Users, then
   `select count(*) from public.saved_items where user_id = 'THROWAWAY_UUID';`
   → `0`.
8. **Optional, from your own terminal:** a direct call with only the anon
   key is refused. Replace `YOUR-PROJECT-REF` and `YOUR-ANON-KEY` in the
   command itself (no environment variables needed). The anon key is
   publishable by design, but keep it in your own terminal — never in chat or
   the repository.

   Windows PowerShell (5.1 or 7):

   ```powershell
   try { Invoke-WebRequest -UseBasicParsing -Uri "https://YOUR-PROJECT-REF.supabase.co/rest/v1/saved_items?select=kind" -Headers @{ apikey = "YOUR-ANON-KEY" } } catch { [int]$_.Exception.Response.StatusCode }
   ```

   bash (Linux, macOS, Git Bash):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://YOUR-PROJECT-REF.supabase.co/rest/v1/saved_items?select=kind" -H "apikey: YOUR-ANON-KEY"
   ```

   Both print `401` (PostgREST refuses the `anon` role: `42501`).

Cleanup (SQL editor):

```sql
delete from public.saved_items
 where user_id in ('USER_A_UUID', 'USER_B_UUID');
```

## Rollback

1. Unset `SAVED_ENABLED` and redeploy: both endpoints answer 503, nothing
   else changes.
2. Revert the Phase 1 commit if the code must go.
3. Run the rollback SQL above only if the table must go (it deletes every
   saved item).
