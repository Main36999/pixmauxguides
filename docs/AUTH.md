# Authentication

**Status (2026-09-26): Phase 2 — Google sign-in implemented. Not yet
tested against a real Supabase project or Google.**

| phase | scope | state |
|---|---|---|
| UI | header Sign in / Sign up, full-screen dialog | done |
| 1 | Netlify Functions foundation, `GET /api/auth/session` | done |
| 2 | Google sign-in, session cookies + refresh, sign-out | **done** |
| 3 | Email magic link | not started |
| 4 | `public.profiles`, account deletion, header signed-in state | not started |

Google appears in the dialog only when it is fully configured (below);
otherwise the dialog keeps saying *"Sign-in isn’t available yet"*. Email
stays unavailable until Phase 3. No success is ever faked.

**Known gap until Phase 4:** after a successful sign-in the header still
shows Sign in / Sign up — there is no signed-in header state or sign-out
button yet. `POST /api/auth/signout` exists; nothing in the UI calls it.

## Architecture (locked)

```text
Browser ──> bpozz.com/api/auth/*  ──> Netlify Functions ──> Supabase Auth ──> Google
            same origin, no CORS      server boundary       identity & session
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
| `netlify/lib/auth.mjs` | config, cookies, Supabase Auth REST calls, provider detection, safe user shape, `safeReturnTo` |
| `netlify/lib/oauth.mjs` | Google sign-in transaction: state, PKCE, signed transaction cookie, authorize URL |
| `netlify/lib/auth.test.mjs`, `netlify/lib/google.test.mjs` | tests (in `lib/`, because every file in `functions/` deploys as a function) |
| `src/client/auth.js` | the dialog — browser half of the contract. **Unchanged by Phase 2**: it already navigates to `/api/auth/google/start` once `providers.google` is true |

No dependencies. The Supabase Auth REST endpoints below are called with
`fetch`; `node:crypto` provides randomness, SHA-256 and HMAC.

## Endpoint contract

| endpoint | caller | phase | state |
|---|---|---|---|
| `GET /api/auth/session` | dialog (`fetch`) | 1–2 | **implemented** |
| `GET /api/auth/google/start?intent=&return_to=` | dialog (full-page navigation) | 2 | **implemented** |
| `GET /api/auth/google/callback` | Supabase redirect | 2 | **implemented** |
| `POST /api/auth/signout` | header account menu (Phase 4) | 2 | **implemented** |
| `POST /api/auth/email/start` | dialog (`fetch`) | 3 | deferred — 404 today |
| `GET /api/auth/email/verify` | link in the email | 3 | deferred |
| `DELETE /api/auth/account` | account settings | 4 | deferred |

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
Google is not enabled in Supabase. The UI does not display `auth_error`
yet (unchanged); the Guides page's own URL sync also drops it.

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
`providers.email` is `false` until Phase 3.

- `providers` is **required by the existing frontend**: `src/client/auth.js`
  treats a response without it, or any non-200, as "auth not deployed".
- `user` never carries access/refresh/provider tokens, `app_metadata`,
  identities or provider IDs. Until `public.profiles` exists,
  `display_name` and `avatar_url` come from Supabase `user_metadata`; that
  is user-editable, so it is capped at 200 characters and `avatar_url`
  must be `https:`.
- Malformed cookies are rejected before any network call.
- The frontend calls this only when someone picks a sign-in method, so
  ordinary page views cost no function invocations.

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

The `__Host-` prefix makes the browser refuse any of these unless it is
Secure, host-only and `Path=/`, so no subdomain can set or read them.
`HttpOnly` keeps every token out of reach of page JavaScript.

**Why not Supabase's default cookies.** `@supabase/ssr` stores the session as
`sb-<project-ref>-auth-token` (chunked across several cookies). That would
need a dependency and gives up the `__Host-` prefix. BPOZZ keeps Supabase's
own tokens and only chooses where they are stored. There is **no parallel
session format**: session tokens are never signed, wrapped or re-issued by
BPOZZ. The only thing BPOZZ signs is the 10-minute OAuth transaction,
which is not a session.

## Configuration

### 1. Supabase dashboard

| where | setting |
|---|---|
| Authentication → URL Configuration → **Site URL** | `https://bpozz.com` — **required**. Supabase accepts `redirect_to` when its scheme, host and port equal the Site URL's, regardless of path and query; that is what lets `…/api/auth/google/callback?state=…` through. |
| Authentication → URL Configuration → Redirect URLs | nothing needed for production. Allow-list entries are matched against the full URL **including the query**, so an exact `…/callback` entry would *not* match `…/callback?state=…`. Do not add broad wildcards. |
| Authentication → Providers → Google | enabled, with Google's **Client ID** and **Client Secret** |

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
| `AUTH_ORIGIN` | browser-safe value | Google, sign-out | bare origin, `https://bpozz.com`; builds `redirect_to` and is an accepted `Origin` for sign-out |
| `AUTH_COOKIE_SECRET` | **server-only secret** | Google | ≥32 characters of randomness; signs the OAuth transaction cookie. Never signs a session. Rotating it only invalidates sign-ins in flight |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only secret** · Supabase configuration | Phase 4 only | bypasses Row Level Security. **Read by no Phase 1–2 code**; not needed yet |

Example — **placeholders only**:

```text
SUPABASE_URL=https://example.supabase.co
SUPABASE_ANON_KEY=...
AUTH_ORIGIN=https://bpozz.com
AUTH_COOKIE_SECRET=...
```

Generate `AUTH_COOKIE_SECRET` with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

### 4. Browser

Nothing. The browser receives no key, secret, client ID or token; it
only ever holds the three HttpOnly cookies above.

**Never** in the browser or Netlify: Google's client secret (Supabase only).
**Never** in the browser: `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_COOKIE_SECRET`,
SMTP credentials, the PKCE verifier, `state`, or any session token.

**Least privilege.** Every Supabase call in Phases 1–2 uses the anon key,
plus the user's own access token where one is needed (`/user`, `/logout`).
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
  `AUTH_ORIGIN` at a dedicated staging domain.
- Runtime: Node matching the build's Node version (`engines.node >= 18`);
  global `fetch`, `Request`, `Response`, `Headers` and `node:crypto`.
- Nothing under `netlify/` is copied into `dist/`, so the `verify` output
  manifest and the QA baselines are unaffected by functions.
- Misconfigured, the functions log which variable **names** are wrong and
  degrade to "not available yet" / `auth_error=unavailable`.

Local check without deploying: `npm test` runs every function against a
stubbed Supabase. Running them over HTTP needs the Netlify CLI
(`netlify dev`), which is not a project dependency.

## Future phases — required design

### Email magic link (Phase 3): `/email/start`, `/email/verify`

- **Production SMTP is required.** Supabase's built-in sender only reaches
  the project's own team and is rate-limited to a few emails per hour;
  configure a transactional provider (Resend, Postmark, SES, …) with SPF,
  DKIM and DMARC on bpozz.com.
- `start`: check `Origin` against `AUTH_ORIGIN`; rate-limit per IP and per
  address (Supabase's limits plus our own); call Supabase `/auth/v1/otp`;
  return the **same** 2xx whether or not the address has an account
  (account-enumeration protection) — mask Supabase's "signups not allowed"
  and similar errors.
- Email template links to
  `https://bpozz.com/api/auth/email/verify?token_hash={{ .TokenHash }}&type=email`.
  The `token_hash` form works even when the link is opened on another
  device.
- `verify`: `POST /auth/v1/verify` (single use; Supabase expiry set short,
  e.g. 15 minutes), set the session cookies, redirect via `safeReturnTo()`.
- Flip `providers.email` to `true`.

### Database (Phase 4) — planned, not created

No application tables exist yet; the migration is deferred until data is
actually stored. Planned model:

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
| Cookies | `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain | `setCookie()` / `clearCookie()` + tests |
| Redirects | internal relative paths only; never `/api/*`; no token, code or state after the callback | `safeReturnTo()`, `withAuthError()` + tests |
| Responses | `Cache-Control: no-store`; redirects `Referrer-Policy: no-referrer` | `json()` / `redirect()` + tests |
| Errors | generic codes (`auth_unavailable`, `auth_error=cancelled/failed/expired/unavailable`); no stacks, paths, keys or upstream text | tests |
| Logging | fixed messages only — never tokens, codes, state, verifier, cookies, emails or keys | `logProblem()` + tests |
| CSRF | sign-out requires a same-site `Origin`; SameSite=Lax cookies; OAuth callback bound to the browser by the signed cookie + `state` + PKCE | tests |

## Still to do before accounts are real

1. **Real-project test:** configure Supabase + Google as above and sign in
   on the production domain. Phase 2 is tested against a stubbed Supabase
   (unit tests) and a local Supabase stand-in with real PKCE checks
   (browser end-to-end), never against Supabase or Google themselves.
2. Phase 3 (email) and Phase 4 (profiles, account deletion).
3. Header signed-in state: an account menu with **Sign out** in place of
   Sign in / Sign up (desktop row and mobile panel), and a visible message
   for `?auth_error=…`.
4. Privacy Policy and Terms: account data (email, Google name and photo),
   retention, deletion, and Supabase as processor. Cookiebot: declare the
   three `__Host-bpozz_*` cookies as strictly necessary.
5. Move the CSP from `Report-Only` to enforced before accounts launch.
