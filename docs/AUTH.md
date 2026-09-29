# Authentication

**Status (2026-09-26):**

- **Google sign-in is production-ready and live** on bpozz.com (commit
  `607363a`): sign-in, the signed-in header, session refresh and sign-out.
- **Email magic link is live** on bpozz.com (commit `653265c`,
  `AUTH_EMAIL_ENABLED=true`, Supabase custom SMTP via Resend). Verified in
  production on 2026-09-26: confirmation email delivered, the link reached
  the BPOZZ confirmation page, Continue created a session
  (`/api/auth/session` → `authenticated: true`, `providers.email: true`),
  sign-out returned to signed out.
- **No passwords.** BPOZZ has no password sign-in, password reset, profile
  management or marketing email.

| phase | scope | state |
|---|---|---|
| UI | header Sign in / Sign up, full-screen dialog | done |
| 1 | Netlify Functions foundation, `GET /api/auth/session` | done |
| 2 | Google sign-in, session cookies + refresh, sign-out | **live** |
| 3 | header signed-in state, account menu, sign-out UI, `?auth_error` messages | **live** |
| 4A | Email magic link | **live** behind `AUTH_EMAIL_ENABLED=true` |
| Saved | account Saved items: `public.saved_items`, `/api/saved*` — see [SAVED.md](SAVED.md) | Phase 1 done: table created and verified, `SAVED_ENABLED` not set (off). Phase 2 browser module written, dormant |
| later | `public.profiles`, self-service account deletion | not started (deletion is manual — see [Account deletion](#account-deletion)) |

Each provider appears in the dialog only when it is fully configured
(below); otherwise the dialog says *"Sign-in isn’t available yet"*.
`AUTH_EMAIL_ENABLED` is the kill switch: unset it (and redeploy) and email
behaves exactly as before Phase 4A — the option is shown as unavailable and
no email request is ever made. No success is ever faked.

## Architecture (locked)

```text
Browser ──> bpozz.com/api/auth/*  ──> Netlify Functions ──> Supabase Auth ──> Google
            same origin, no CORS      server boundary       identity & session  └─> SMTP (email links)
            HttpOnly cookies          holds all secrets     authority
```

- **Supabase is the identity and session authority.** BPOZZ never mints,
  signs or verifies its own session tokens. A session is valid exactly when
  Supabase's `GET /auth/v1/user` accepts its access token (which also
  catches revoked sessions); new tokens only ever come from Supabase's
  `/auth/v1/token`.
- **Supabase verifies Google.** Google's client secret, Google's
  authorization code and the identity Google returns are all handled on
  Supabase's leg of the flow. BPOZZ never sees or verifies a Google token;
  an ID-token `nonce` does not apply to BPOZZ's leg, which receives no ID
  token (a code, bound by `state` + PKCE).
- **Netlify Functions are the only server code.** The static site, the
  build and `dist/` are unchanged; functions deploy alongside it.
- **Same origin.** The existing CSP (`connect-src 'self'`,
  `form-action 'self'`) needs no change, cookies are first-party, and no
  CORS headers are sent.

## Files

| file | role |
|---|---|
| `netlify/functions/auth-session.mjs` | `GET /api/auth/session` |
| `netlify/functions/auth-google-start.mjs` | `GET /api/auth/google/start` |
| `netlify/functions/auth-google-callback.mjs` | `GET /api/auth/google/callback` |
| `netlify/functions/auth-signout.mjs` | `POST /api/auth/signout` |
| `netlify/functions/auth-email-start.mjs` | `POST /api/auth/email/start` |
| `netlify/functions/auth-email-verify.mjs` | `GET` + `POST /api/auth/email/verify` |
| `netlify/lib/auth.mjs` | config, cookies, Supabase Auth REST calls (incl. `/verify`), provider detection, the `AUTH_EMAIL_ENABLED` switch, safe user shape, `safeReturnTo` |
| `netlify/lib/oauth.mjs` | Google sign-in transaction: state, PKCE, signed transaction cookie, authorize URL. **Not touched by Phase 4A** |
| `netlify/lib/email.mjs` | email sign-in: request validation, Supabase `/otp`, the signed email cookie, the confirmation page |
| `netlify/lib/auth.test.mjs`, `google.test.mjs`, `email.test.mjs` | tests (in `lib/`, because every file in `functions/` deploys as a function) |
| `src/client/auth.js` | the dialog and header — browser half of the contract. After every session answer it draws from (not the header's 1.5 s placeholder) it fires `bpozz:session` on `document`, `{ authenticated }` only, for `src/client/saved.js` |

No dependencies. The Supabase Auth REST endpoints below are called with
`fetch`; `node:crypto` provides randomness, SHA-256 and HMAC.

## Endpoint contract

| endpoint | caller | phase | state |
|---|---|---|---|
| `GET /api/auth/session` | dialog (`fetch`) | 1–2 | **implemented** |
| `GET /api/auth/google/start?intent=&return_to=` | dialog (full-page navigation) | 2 | **implemented** |
| `GET /api/auth/google/callback` | Supabase redirect | 2 | **implemented** |
| `POST /api/auth/signout` | header account menu | 2 | **implemented** |
| `POST /api/auth/email/start` | dialog (`fetch`) | 4A | **implemented** — 503 while `AUTH_EMAIL_ENABLED` is off |
| `GET /api/auth/email/verify` | link in the email | 4A | **implemented** — confirmation page, consumes nothing |
| `POST /api/auth/email/verify` | the confirmation page's form | 4A | **implemented** |
| `DELETE /api/auth/account` | account settings | later | deferred |

Each function sets `export const config = { path: "/api/auth/…" }`. With
a custom path Netlify serves the function **only** at that path, not at
`/.netlify/functions/<name>`, so there is no second public URL.

Every response carries `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`. Redirects also carry
`Referrer-Policy: no-referrer`.

### Google sign-in — the implemented flow

Verified against Supabase Auth's source (`supabase/auth`:
`internal/api/external.go`, `pkce.go`, `verify.go`, `token.go`,
`internal/models/flow_state.go`, `internal/utilities/request.go`).

```text
1. Browser   GET /api/auth/google/start?intent=signin&return_to=/guides/
   BPOZZ     intent ∈ {signin, signup}; return_to through safeReturnTo()
             state    = 32 random bytes (base64url)
             verifier = 32 random bytes (base64url, 43 chars)
             Set-Cookie __Host-bpozz_oauth = HMAC-signed {state, verifier,
                        intent, return_to, expiresAt}; Max-Age=600
   303 ->    {SUPABASE_URL}/auth/v1/authorize?provider=google
               &redirect_to={AUTH_ORIGIN}/api/auth/google/callback?state={state}
               &code_challenge=BASE64URL(SHA256(verifier))
               &code_challenge_method=s256

2. Supabase  -> Google consent (Google's authorization-code flow with
             Supabase's client secret; Supabase verifies the identity) ->
             Supabase's callback https://<ref>.supabase.co/auth/v1/callback
   302 ->    redirect_to with its query kept and `code` added
             (prepPKCERedirectURL), or with error=… on failure/cancel

3. Browser   GET /api/auth/google/callback?state=…&code=…
   BPOZZ     cookie signature + expiry, then state (constant-time) — before
             any query value is trusted
             POST {SUPABASE_URL}/auth/v1/token?grant_type=pkce
                  {auth_code, code_verifier}      (anon key only)
             Set-Cookie __Host-bpozz_session (access token, Max-Age=expires_in)
             Set-Cookie __Host-bpozz_refresh (refresh token, 30 days)
             Set-Cookie __Host-bpozz_oauth=; Max-Age=0
   303 ->    return_to   — no token, code or state in the URL
```

Supabase's token response also contains Google's `provider_token` /
`provider_refresh_token`; they are dropped on receipt and never stored,
returned or logged.

Outcomes of the callback (every one clears the transaction cookie):

| situation | redirect |
|---|---|
| success | `return_to` (any stale `auth_error` removed) |
| declined at Google (`error=access_denied`) | `return_to?auth_error=cancelled` |
| state missing/mismatched, other OAuth error, missing/malformed code, Supabase refused the code (400 `bad_code_verifier`, 404 `flow_state_not_found`, 422 `flow_state_expired`) | `return_to?auth_error=failed` |
| transaction cookie missing, expired, tampered or signed with another key | `/?auth_error=expired` (return_to is unknown) |
| not configured, Supabase unreachable/erroring | `…?auth_error=unavailable` |

`start` answers `return_to?auth_error=failed` for a missing/invalid
`intent` and `return_to?auth_error=unavailable` when not configured or
Google is not enabled in Supabase. `src/client/auth.js` removes
`auth_error` from the address bar on load and shows a short message for it.

### Email magic link — the implemented flow (Phase 4A)

Behind `AUTH_EMAIL_ENABLED`. Verified against Supabase Auth's source
(`internal/api/otp.go`, `internal/crypto` `GenerateTokenHash`) and, with
a local Supabase stand-in, end to end in headless Chrome, and in
production against the real Supabase project (2026-09-26).

```text
1. Browser   POST /api/auth/email/start   (fetch from the dialog)
             {"email", "intent", "returnTo"}
   BPOZZ     Origin must equal AUTH_ORIGIN exactly; JSON, ≤ 2 KB,
             email ≤ 254 chars; returnTo through safeReturnTo()
             POST {SUPABASE_URL}/auth/v1/otp  {email, create_user: true}
             (anon key only; no redirect_to)
             Set-Cookie __Host-bpozz_email = HMAC-signed {v, returnTo,
                        expiresAt}; Max-Age=3600
   200       {"sent": true}

2. Supabase  emails the Magic Link (existing user) or Confirm signup (new
             user) template — both edited to link to
             https://bpozz.com/api/auth/email/verify?token_hash={{ .TokenHash }}&type=email

3. Browser   GET /api/auth/email/verify?token_hash=…&type=email
   BPOZZ     token_hash must be 56 lowercase hex (SHA-224); type absent or
             "email"; valid email cookie. Consumes NOTHING.
   200       confirmation page: one Continue button, token_hash in an
             escaped hidden field. Mail scanners that open links first get
             this page (or, with no cookie, a redirect) — the token survives.

4. Browser   POST /api/auth/email/verify   (the page's form)
   BPOZZ     Origin exactly AUTH_ORIGIN; token_hash shape; valid email
             cookie — all before Supabase is asked
             POST {SUPABASE_URL}/auth/v1/verify {type: "email", token_hash}
             same readSession() filter as the Google code exchange;
             any previous BPOZZ session revoked (/logout?scope=local with
             its own token, refreshed once if expired)
             Set-Cookie __Host-bpozz_session, __Host-bpozz_refresh
             Set-Cookie __Host-bpozz_email=; Max-Age=0
   303 ->    returnTo from the signed cookie — never from the URL; no token
```

**Same browser only.** The POST requires the `__Host-bpozz_email` cookie
set by step 1, so a link opened in another browser or device ends at
`/?auth_error=link` without spending the token. That also stops a stranger's
link from signing someone into the stranger's account (login CSRF): the
victim's browser has no email cookie. The dialog's sent-state copy says
"Open it in this browser".

`intent` only changes the dialog's wording: as with Google, Supabase signs
in an existing user and creates a new one the same way.

`POST /api/auth/email/start`:

| status | body | when |
|---|---|---|
| 200 | `{ "sent": true }` + email cookie | Supabase sent the link — **or** refused in a way that would reveal whether the address has an account (422 `otp_disabled` / `signup_disabled`, 403, 404). Identical body, headers and cookie either way |
| 400 | `{ "error": "invalid_request" }` | not `application/json`, over 2 KB, not an object, email missing / malformed / over 254 chars, unknown `intent`, non-string `returnTo`; or Supabase 400 (address rejected) |
| 403 | `{ "error": "forbidden" }` | `Origin` missing or not exactly `AUTH_ORIGIN` |
| 405 | `{ "error": "method_not_allowed" }` + `Allow: POST` | not POST |
| 429 | `{ "error": "rate_limited" }` | Supabase's per-address / project email limit (Netlify's own limit also answers 429) |
| 503 | `{ "error": "auth_unavailable" }` | `AUTH_EMAIL_ENABLED` not `"true"`, configuration invalid, Email disabled in Supabase, Supabase down / 5xx / rejecting the key, or 400 `email_address_not_authorized` (Supabase's built-in mailer: custom SMTP not set up) |

With the flag off, the function answers 503 before reading the body and
makes **no** Supabase request.

`/api/auth/email/verify` outcomes:

| situation | answer |
|---|---|
| GET, well formed, valid email cookie | 200 confirmation page — Supabase not asked to verify |
| GET or POST, malformed `token_hash`, other `type`, bad form | 303 `/?auth_error=link`, email cookie cleared |
| GET or POST, email cookie missing / expired / tampered | 303 `/?auth_error=link`, email cookie cleared, token not spent |
| POST, `Origin` missing / `null` / foreign | 403 `{ "error": "forbidden" }`, nothing changed |
| POST, Supabase accepts the token | 303 `returnTo`, session + refresh cookies, email cookie cleared |
| POST, Supabase refuses (403 `otp_expired`, 400, 401, 404, 422: used / expired / invalid) | 303 `returnTo?auth_error=link`, email cookie cleared, previous session kept |
| flag off / not configured | 303 `/?auth_error=unavailable` |
| Email disabled in Supabase, Supabase down / 5xx / 429 / unusable answer | 303 `returnTo?auth_error=unavailable`, email cookie **kept** so the same link can be retried |
| any other method | 405, `Allow: GET, POST` |

The confirmation page sends its own headers (`public/_headers` is not
relied on for function responses):

```text
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'
X-Frame-Options: DENY
Referrer-Policy: same-origin
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow
```

**Why `Referrer-Policy: same-origin` and not `no-referrer`.** Under
`no-referrer`, browsers send `Origin: null` with the page's form POST
(Fetch standard; confirmed in Chrome), and the exact-Origin check would
refuse every legitimate sign-in. `same-origin` sends no Referer to any
other site, and the page loads nothing from any other site. The 303 after
the POST carries `Referrer-Policy: no-referrer`, so the landing page's
`document.referrer` is empty and analytics there never see the token URL.

Rate limits: Netlify code-based rules in each function's `config` —
`start` 5 per 60 s, `verify` 20 per 60 s, both `aggregateBy: ["ip",
"domain"]` (all plans; Free/Starter/Personal allow 2 code-based rules per
project, exactly these two). Supabase's email and verification limits stay
the authority behind them.

### `GET /api/auth/session`

| status | body | when |
|---|---|---|
| 200 | `{ "authenticated": false, "user": null, "providers": {…} }` | no / malformed / expired / revoked session |
| 200 | `{ "authenticated": true, "user": { "id", "email", "display_name", "avatar_url" }, "providers": {…} }` | Supabase accepts the session |
| 503 | `{ "authenticated": false, "user": null, "error": "auth_unavailable" }` | env vars missing or invalid, Supabase unreachable or rejecting the API key |
| 405 | `{ "error": "method_not_allowed" }` + `Allow: GET` | any method but GET |

Resolution, Supabase deciding at every step:

1. access-token cookie accepted by `GET /auth/v1/user` → signed in;
2. otherwise a refresh-token cookie → `POST /auth/v1/token?grant_type=refresh_token`
   (Supabase rotates it) → signed in, **both cookies re-issued**;
3. otherwise signed out, and stale session cookies cleared.

A Supabase outage is a 503 with cookies kept, never a sign-out.

`providers.google` is `true` only when **both** the Netlify side is fully
configured (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUTH_ORIGIN`,
`AUTH_COOKIE_SECRET` all valid) **and** Supabase's public
`GET /auth/v1/settings` reports `external.google: true` (cached per
function instance for 5 minutes, 30 s after a failure; unreachable counts
as false). So the dialog never offers a provider Supabase would refuse.

`providers.email` is `true` only when the same four variables are valid
**and** `AUTH_EMAIL_ENABLED` is exactly `"true"` **and** the same cached
settings report `external.email: true`. With the flag off Supabase is not
asked about email at all, and `providers.google` is computed exactly as
before (one `/settings` fetch serves both).

- `providers` is **required by the existing frontend**: `src/client/auth.js`
  treats a response without it, or any non-200, as "auth not deployed".
- `user` never carries access/refresh/provider tokens, `app_metadata`,
  identities or provider IDs. Until `public.profiles` exists,
  `display_name` and `avatar_url` come from Supabase `user_metadata`; that
  is user-editable, so it is capped at 200 characters and `avatar_url`
  must be `https:`.
- Malformed cookies are rejected before any network call.
- The frontend asks it once per page view, to draw the header (and again
  when someone requests an email sign-in link or signs out), so every page
  view costs one function invocation.

### `POST /api/auth/signout`

| status | body | when |
|---|---|---|
| 200 | `{ "signed_out": true }` + all three cookies cleared | same-origin POST |
| 403 | `{ "error": "forbidden" }` | `Origin` header missing or not this site (CSRF) |
| 405 | `{ "error": "method_not_allowed" }` + `Allow: POST` | any other method |

Server-side invalidation: `POST /auth/v1/logout?scope=local`, authorised
by the user's **own** access token (no service-role key) — Supabase ends
this session and revokes its refresh tokens. If the access token has
expired, the refresh token is used once to obtain a current one first. The
cookies are cleared whatever Supabase answers; if Supabase is unreachable
the refresh token stays valid at Supabase until it expires, and that is
logged (without values).

## Cookies

| cookie | holds | lifetime | attributes |
|---|---|---|---|
| `__Host-bpozz_session` | the Supabase **access token**, exactly as issued | the token's `expires_in` (≈1 h) | `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain` |
| `__Host-bpozz_refresh` | the Supabase **refresh token**, exactly as issued | 30 days, restarted on every refresh | same |
| `__Host-bpozz_oauth` | the in-flight Google sign-in: `state`, PKCE verifier, `intent`, `return_to`, expiry — HMAC-SHA256-signed with `AUTH_COOKIE_SECRET` | 10 minutes; cleared by the callback | same |
| `__Host-bpozz_email` | the in-flight email sign-in: `{v: 1, returnTo, expiresAt}` only — no address, no token — HMAC-SHA256-signed with `AUTH_COOKIE_SECRET` under its own MAC context (`bpozz-email-v1.`), so it and the Google cookie can't be swapped | 1 hour (Supabase's default email OTP expiry); cleared by a successful or refused verify | same |

Sign-out clears the first three. It leaves a pending `__Host-bpozz_email`
alone: it grants nothing by itself (a link still needs Supabase to accept
its token) and expires within the hour.

The `__Host-` prefix makes the browser refuse any of these unless it is
Secure, host-only and `Path=/`, so no subdomain can set or read them.
`HttpOnly` keeps every token out of reach of page JavaScript.

**Why not Supabase's default cookies.** `@supabase/ssr` stores the session as
`sb-<project-ref>-auth-token` (chunked across several cookies). That would
need a dependency and gives up the `__Host-` prefix. BPOZZ keeps Supabase's
own tokens and only chooses where they are stored. There is **no parallel
session format**: session tokens are never signed, wrapped or re-issued by
BPOZZ. The only things BPOZZ signs are the two in-flight sign-in cookies
(Google's 10-minute transaction, email's 1-hour return path), which are not
sessions.

## Configuration

### 1. Supabase dashboard

| where | setting |
|---|---|
| Authentication → URL Configuration → **Site URL** | `https://bpozz.com` — **required**. Supabase accepts `redirect_to` when its scheme, host and port equal the Site URL's, regardless of path and query; that is what lets `…/api/auth/google/callback?state=…` through. |
| Authentication → URL Configuration → Redirect URLs | nothing needed for production. Allow-list entries are matched against the full URL **including the query**, so an exact `…/callback` entry would *not* match `…/callback?state=…`. Do not add broad wildcards. |
| Authentication → Providers → Google | enabled, with Google's **Client ID** and **Client Secret** |
| Authentication → Providers → **Email** | enabled (email only); keep **Confirm email** on. Password sign-in is not used by BPOZZ |
| Authentication → "Allow new users to sign up" | on — otherwise a new address's request is refused, and BPOZZ masks that as "sent" (no email arrives) |
| Authentication → **SMTP Settings** | **custom SMTP — production uses Resend**: host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key with sending access (stored **only** in this Supabase field — never in Netlify or the repo), sender = an address on the Resend-verified sending domain, name "BPOZZ". SPF/DKIM records for that domain are exactly the ones Resend generates, in Netlify DNS; Resend click/open tracking off. Without custom SMTP, Supabase's built-in sender only mails the project's team (other addresses get `email_address_not_authorized`, answered as 503) |
| Authentication → Email Templates → **Magic Link** *and* **Confirm signup** | both links must be `https://bpozz.com/api/auth/email/verify?token_hash={{ .TokenHash }}&type=email` (or the same with `{{ .SiteURL }}` when Site URL is exactly `https://bpozz.com`). Supabase uses Magic Link for existing users and Confirm signup for new ones — edit **both**, or one group receives the default `…supabase.co/auth/v1/verify` link, which mail scanners can spend and which bypasses BPOZZ. Never put `returnTo` in the link |
| Authentication → Rate Limits | set "emails sent per hour" deliberately once SMTP is on; keep a per-address minimum interval (default 60 s) |
| Authentication → Email → **Email OTP Expiration** | ≤ 3600 s (the email cookie lives 1 hour); 900 s suggested |

No Redirect URL entry is needed for email: `/otp` is called without
`redirect_to`, and the template builds the link from the Site URL.

### 2. Google Cloud Console

OAuth client of type **Web application**. Authorized redirect URI:
**Supabase's** callback, `https://<ref>.supabase.co/auth/v1/callback`,
entered exactly. Consent screen: BPOZZ, links to
`https://bpozz.com/privacy.html` and `https://bpozz.com/terms.html`,
scopes `openid email profile`. Google's consent screen names
`<ref>.supabase.co` unless Supabase's paid custom-domain add-on is used.

### 3. Netlify Functions environment

Netlify → Site configuration → Environment variables, scoped to
*Functions*. Never in the repo, never in `src/client/`; `.env` files are
git-ignored for local use.

| variable | classification | used by | purpose |
|---|---|---|---|
| `SUPABASE_URL` | Supabase configuration · browser-safe value | all | project URL, e.g. `https://<ref>.supabase.co` (`http://127.0.0.1:54321` allowed for a local stack) |
| `SUPABASE_ANON_KEY` | Supabase configuration · browser-safe *by Supabase's design* — kept server-side anyway | all | least-privileged key for every call BPOZZ makes. Supabase's newer *publishable* key (`sb_publishable_…`) goes here too |
| `AUTH_ORIGIN` | browser-safe value | Google, email, sign-out | bare origin, `https://bpozz.com`; builds `redirect_to`, is an accepted `Origin` for sign-out and the **only** accepted `Origin` for the email POSTs |
| `AUTH_COOKIE_SECRET` | **server-only secret** | Google, email | ≥32 characters of randomness; signs the Google and email in-flight cookies (separate MAC contexts). Never signs a session. Rotating it only invalidates sign-ins in flight |
| `AUTH_EMAIL_ENABLED` | switch · not secret | email | email sign-in is on only when this is exactly `true` — **`true` in production** (Functions scope). Unset / anything else: `providers.email` is false, `/email/start` answers 503 and no email request is made. Changing it takes effect after a redeploy |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only secret** · Supabase configuration | later only | bypasses Row Level Security. **Read by no code** — Google and email both use the anon key; not needed yet |

Example — **placeholders only**:

```text
SUPABASE_URL=https://example.supabase.co
SUPABASE_ANON_KEY=...
AUTH_ORIGIN=https://bpozz.com
AUTH_COOKIE_SECRET=...
AUTH_EMAIL_ENABLED=true
```

Generate `AUTH_COOKIE_SECRET` with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

### 4. Browser

Nothing. The browser receives no key, secret, client ID or token; it
only ever holds the four HttpOnly cookies above.

**Never** in the browser or Netlify: Google's client secret (Supabase only).
**Never** in the browser: `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_COOKIE_SECRET`,
SMTP credentials, the PKCE verifier, `state`, or any session token.

**Least privilege.** Every server-side Supabase call (`/settings`, `/token`,
`/otp`, `/verify`) uses the anon key, plus the user's own access token where
one is needed (`/user`, `/logout`). `/authorize` is not a server call: the
browser is redirected there, carrying no key.
Setting only the service-role key does not make auth "configured".

## Deploying

- Netlify picks up `netlify/functions/` automatically; **no `netlify.toml`
  was added**, so the build command and publish directory configured in the
  Netlify dashboard stay authoritative.
- Functions deploy only when Netlify **builds from the repository** (or via
  `netlify deploy`). A drag-and-drop upload of `dist/` publishes the static
  site **without** the functions — the dialog then says "not available
  yet", exactly as before Phase 1.
- Google sign-in completes only on the `AUTH_ORIGIN` host: Supabase sends
  the browser back there, and the transaction cookie is host-only. On a
  deploy preview (`*.netlify.app`) the flow ends at
  `/?auth_error=expired` on production — expected, not a bug. Test on the
  production domain, or point a separate Supabase project's Site URL and
  `AUTH_ORIGIN` at a dedicated staging domain. The same holds for email:
  the emailed link always points at the Site URL, and the email cookie is
  host-only.
- Runtime: Node matching the build's Node version (`engines.node >= 18`);
  global `fetch`, `Request`, `Response`, `Headers` and `node:crypto`.
- Nothing under `netlify/` is copied into `dist/`, so the `verify` output
  manifest and the QA baselines are unaffected by functions. Changing
  `src/client/auth.js` does change `dist/auth.js` and `dist/app.js`; Phase 4A
  re-recorded exactly those two hashes in `scripts/qa/approved-output.json`.
- Misconfigured, the functions log which variable **names** are wrong and
  degrade to "not available yet" / `auth_error=unavailable`.

Local check without deploying: `npm test` runs every function against a
stubbed Supabase. Running them over HTTP needs the Netlify CLI
(`netlify dev`), which is not a project dependency.

## Email in production

**Enabled 2026-09-26.** Done: code deployed with the switch off and Google
re-checked; Supabase custom SMTP via Resend and both templates; switch set
and redeployed; production sign-in and sign-out verified (see Status).

**Rollback:** delete `AUTH_EMAIL_ENABLED` in Netlify and redeploy. Google
is unaffected and nothing else needs undoing.

### Real-project checks

Verified in production: new-address confirmation email delivered with the
BPOZZ link; confirmation page → Continue → signed-in session; sign-out.
Still worth running once (they depend on how the real Supabase project and
mail providers behave, and are not proven by the unit tests):

1. **Account and provider linking** (BPOZZ adds no linking logic of its
   own; it relies entirely on Supabase's automatic identity linking):
   - an address that already signed in with Google, then uses a magic
     link → must be the **same** Supabase user id (check Authentication →
     Users); the header keeps the Google name and photo;
   - an address that first signed in by magic link, then uses Google →
     same user id;
   - an address that requested a link but never clicked it (unconfirmed
     user), then signs in with Google → confirm whether Supabase links,
     replaces or duplicates it.
2. New address → the email arrives from the BPOZZ sender, passes
   SPF/DKIM/DMARC, uses the **Confirm signup** template with the BPOZZ link.
   Existing address → **Magic Link** template with the BPOZZ link. Both
   verify with `type=email`.
3. A link opened through a scanning mail provider (Outlook / Microsoft
   365, Gmail) still signs in.
4. Used link, expired link, link opened in another browser →
   `auth_error=link` message; old session untouched.
5. Repeated sends → 429 message, no enumeration difference between a known
   and an unknown address.
6. Sign-out after an email sign-in → session revoked at Supabase.
7. DevTools: no token in any URL, response body, `localStorage`,
   `sessionStorage` or `document.cookie`.
8. **Supabase per-IP limits.** Every Supabase call comes from Netlify's
   servers, so Supabase's per-IP limits (token verifications, OTP sends,
   token refresh) see Netlify's addresses, not visitors'. Check the
   project's Rate Limits page and the auth logs under real use; raise the
   per-IP limits if sign-ins start failing with 429.

### Account deletion

The Privacy Policy lets people ask, through the contact form, for their
account to be deleted. There is no self-service deletion. The owner deletes
the user in Supabase → Authentication → Users (which removes the user and
its linked Google/email identities, and their saved items in
`public.saved_items` — `on delete cascade`, see [SAVED.md](SAVED.md));
BPOZZ stores no other account data.
The person's browser keeps any session cookie until it expires, but
Supabase then refuses it and `/api/auth/session` clears it.

### Database

**`public.saved_items`** (account Saved items) is implemented in Saved
Phase 1. The code is in `netlify/functions/saved.mjs`,
`netlify/functions/saved-import.mjs` and `netlify/lib/saved.mjs`, with tests
in `netlify/lib/saved.test.mjs`; [SAVED.md](SAVED.md) documents the
migration SQL, the verification script and the API. The owner has run the
migration and its verification in the Supabase SQL editor; neither is run
again.

**`public.profiles`** is planned, not created; its migration is deferred
until profile data is actually stored. Planned model:

```sql
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 200),
  avatar_url   text check (avatar_url like 'https://%'),
  preferences  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table public.profiles enable row level security;
create policy "own profile: read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile: update" on public.profiles for update using (auth.uid() = id);
```

`profiles.id` **is** the Supabase auth user id. No credentials, tokens,
Google passwords or OAuth secrets are ever stored in `public.*`; Supabase
keeps identities in `auth.identities`, keyed by Google's stable `sub`.

## Security baseline

| area | rule | where enforced |
|---|---|---|
| Secrets | server-only; the browser never receives `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, SMTP credentials, `AUTH_COOKIE_SECRET` or any token | test scans `src/client`, `src/shared`, `partials`; `dist/` scanned at QA |
| Sessions | Supabase is the authority; no BPOZZ-minted session tokens | `getSupabaseUser()`, `refreshSession()` |
| Least privilege | anon key (+ the user's own token) for every call; service-role key unused | `supabaseConfig()` / `oauthConfig()` + tests |
| OAuth | Authorization Code via Supabase; `state` (256-bit, constant-time compare); PKCE S256 (256-bit verifier); Google identity verified by Supabase; no ID token on BPOZZ's leg, so no nonce; fixed `redirect_to` from `AUTH_ORIGIN` | `oauth.mjs` + tests |
| Transaction | HMAC-SHA256-signed, 10-minute expiry, single use (cleared on every callback) | `sealTransaction()` / `openTransaction()` + tests |
| Email link | `/otp` with `create_user: true`, no `redirect_to`; link on bpozz.com with a 56-hex `token_hash`; GET never spends it; POST needs exact `Origin` + the signed email cookie before Supabase `/verify` (`type` fixed to `email`); return path only from the cookie; previous session revoked on success | `email.mjs`, `auth-email-*.mjs` + tests + headless-Chrome end-to-end |
| Enumeration | `/email/start` answers identically (body, headers, cookie) whether or not the address has an account; the address is never logged | `requestEmailOtp()` + tests |
| Rate limits | Netlify code-based rules on both email functions; Supabase's email and verification limits behind them | function `config` + tests |
| Confirmation page | no script, no external asset, no analytics; own CSP, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `no-store`, `noindex`; every embedded value escaped | `confirmationPage()`, `PAGE_HEADERS` + tests |
| Cookies | `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain | `setCookie()` / `clearCookie()` + tests |
| Redirects | internal relative paths only; never `/api/*`; no token, code or state after the callback | `safeReturnTo()`, `withAuthError()` + tests |
| Responses | `Cache-Control: no-store`; redirects `Referrer-Policy: no-referrer` | `json()` / `redirect()` + tests |
| Errors | generic codes (`auth_unavailable`, `invalid_request`, `rate_limited`, `auth_error=cancelled/failed/expired/unavailable/link`); no stacks, paths, keys or upstream text | tests |
| Logging | fixed messages only — never tokens, token hashes, codes, state, verifier, cookies, email addresses or keys (Supabase's machine `error_code`, `[a-z0-9_]` only, may appear) | `logProblem()` + tests |
| CSRF | sign-out requires a same-site `Origin`; both email POSTs require `Origin` exactly `AUTH_ORIGIN`; SameSite=Lax cookies; OAuth callback bound to the browser by the signed cookie + `state` + PKCE; email verify bound to the requesting browser by the signed email cookie | tests |
| CSP | no new origin: every email request is same-origin (`connect-src 'self'`, `form-action 'self'`); `public/_headers` unchanged | — |

## Still to do

1. The remaining [real-project checks](#real-project-checks) (linking,
   scanners, deliverability headers, rate limits).
2. Cookiebot: add the four `__Host-bpozz_*` cookies to the cookie
   declaration as **Necessary** in the Cookiebot manager. Its scanner never
   signs in, so it has not found them; they are server-set HttpOnly cookies,
   so Cookiebot's blocking cannot affect them either way.
3. Move the site CSP from `Report-Only` to enforced.
4. Profiles and self-service account deletion (later, if ever needed).
