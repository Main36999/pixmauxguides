# Cloudflare and edge security

**Status (2026-10-01):**

- **bpozz.com is NOT behind the Cloudflare proxy.** DNS is Netlify DNS
  (`dns1–4.p09.nsone.net`), every response is served by Netlify's edge
  (`Server: Netlify`, no `cf-ray`), and no Cloudflare zone is active for the
  domain. No Cloudflare WAF, rate limiting, bot protection, cache or TLS
  setting applies to any request.
- **Cloudflare Turnstile is used on its own**, without Cloudflare's CDN or
  proxy, to protect one endpoint: `POST /api/auth/email/start`. Even once
  deployed it stays **dormant** until its two environment variables are set
  (see [Turnstile](#turnstile)). It has not been run against a real widget.
- **None of the Phase 2A work described here is live.** As of 2026-10-01 it
  is implemented and built locally (the local build and QA pass), but it
  has **not** been pushed or deployed. Wherever this document describes the
  Turnstile check, the HSTS header on API responses, the CSP addition or
  the stricter `safeReturnTo()`, it describes that local code — not what
  production serves today. Production is unchanged until a deploy.
- **Moving behind the Cloudflare proxy is intentionally deferred** (see
  [Why the proxy is deferred](#why-the-proxy-is-deferred)).

Wording in this document: *protected against*, *mitigated*, *reduced risk*,
*not verified* mean exactly that. Nothing here claims the site is "secure".

## Architecture

```text
Browser ──> bpozz.com (Netlify edge) ──> static files
                │
                └──> /api/auth/*, /api/saved*  (Netlify Functions) ──> Supabase
                          │
                          └──> challenges.cloudflare.com/turnstile/v0/siteverify
                               (email start only, and only while Turnstile is on)

Browser ──> challenges.cloudflare.com   Turnstile script + widget iframe, only
                                        when someone submits the email form
```

Authentication is unchanged and is specified in [AUTH.md](AUTH.md).

## Why the proxy is deferred

Audited 2026-10-01. Putting Cloudflare's proxy in front of Netlify would:

1. **Break the existing rate limits.** The Netlify rules on the functions
   count per client IP. Behind a proxy Netlify sees Cloudflare's addresses,
   so all visitors would share a few counters — `email/start` allows 5
   requests a minute — and legitimate sign-ins would be refused.
2. **Not protect the origin.** The site stays reachable at its
   `*.netlify.app` hostname, which bypasses every Cloudflare rule. Locking
   an origin to Cloudflare's addresses is not possible on Netlify below
   Enterprise.
3. **Be unsupported.** Netlify advises against a proxy in front of its CDN
   and gives no technical support for that setup below Enterprise (cached
   content can also break its atomic deploys).
4. **Need a nameserver move**: every DNS record re-created at Cloudflare
   (site verification, `_dmarc`, the email sender's SPF/DKIM), and Netlify's
   wildcard certificate (issued through Netlify DNS) replaced.
5. **Add little on the Free plan** (next section) for a static site whose
   only dynamic surface is a handful of functions that already validate
   their input.

## Cloudflare Free plan limits (checked against Cloudflare's docs, 2026-10-01)

| feature | Free plan | consequence here |
|---|---|---|
| WAF custom rules | 5, no regex | enough for a few path rules, no more |
| Rate limiting rules | 1 rule; counts by IP only; 10 s period; 10 s mitigation | cannot express "5 per minute"; one rule for all of `/api/*` |
| Managed rules | Free Managed Ruleset only (no OWASP, no Cloudflare Managed Ruleset) | covers a short list of widely exploited vulnerabilities; little of it applies to a static site with a few functions |
| Bot Fight Mode | cannot be skipped or excepted per path; "may challenge API or mobile app traffic" | all-or-nothing over `/api/*` and crawlers |
| Origin lock-down | needs an origin that can restrict to Cloudflare's IPs | not available on Netlify |
| Turnstile | up to 20 widgets, 10 hostnames per widget, unlimited challenges, all widget types; no "any hostname" widgets, no branding removal | the one feature the Phase 2A code uses (not live; dormant until configured) — needs no zone, DNS change or proxy |

## Turnstile

### What it protects

`POST /api/auth/email/start` makes Supabase send an email. The `Origin`
check there stops cross-site browser requests, not scripts, which can send
any header. Without a challenge, scripts on many IP addresses could mail
arbitrary addresses and use up the project's hourly email quota, blocking
real sign-ins. With Turnstile on, each request must carry a token that
Cloudflare issued to a browser on `bpozz.com` and that the server has
verified with Cloudflare.

Turnstile is deliberately **not** added to Google sign-in (a redirect to
Google, which runs its own abuse checks), sign-out, the Saved API (needs a
session) or the contact form (posted to Formspree, not to BPOZZ's backend).

### How it works

```text
1. Browser   GET /api/auth/session
             … "turnstile": { "siteKey": "<public sitekey>" }   only while on
2. Browser   on submitting the email form: loads
             https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
             renders one widget (action "email-start", appearance
             "interaction-only"), receives a token
3. Browser   POST /api/auth/email/start  {email, intent, returnTo, turnstileToken}
4. BPOZZ     Origin, body and email checks as before; token present and
             well formed (≤ 2,048 characters), else 403 challenge_failed
             POST https://challenges.cloudflare.com/turnstile/v0/siteverify
                  {secret, response, remoteip}
             accepted only if success === true AND hostname === the host of
             AUTH_ORIGIN AND action === "email-start"
5. BPOZZ     only then POST {SUPABASE_URL}/auth/v1/otp
```

- The browser's own "success" is never trusted; only Siteverify's answer is.
- A token is single use and valid for 300 seconds (Cloudflare's rules). A new
  widget is rendered for every attempt and removed afterwards.
- **Fails closed.** If Siteverify is unreachable, errors, or rejects the
  secret, the answer is `503 auth_unavailable` and no email is sent.
- The widget is visible only if Cloudflare asks for an interaction; otherwise
  the dialog looks as it did. No stylesheet was changed.
- Cloudflare's script is requested only when the email form is submitted —
  never on a page view. It carries `data-cookieconsent="ignore"` so
  Cookiebot's automatic blocking does not hold it back.

Files: `netlify/lib/turnstile.mjs`, `netlify/functions/auth-email-start.mjs`,
`netlify/functions/auth-session.mjs`, `netlify/lib/email.mjs` (body limit),
`src/client/auth.js`; tests in `netlify/lib/turnstile.test.mjs` and
`src/client/auth.test.js`.

### Configuration and secret handling

| variable | classification | where |
|---|---|---|
| `TURNSTILE_SITE_KEY` | public — sent to browsers by `/api/auth/session` | Netlify environment, Functions scope |
| `TURNSTILE_SECRET_KEY` | **server-only secret** | Netlify environment, Functions scope, marked secret |

- Neither set: Turnstile is **off** and the email flow is exactly as before.
- Both set: Turnstile is **on**.
- Only one set, a malformed value, or the same value in both: email sign-in
  is **closed** (`503`, `providers.email: false`) and the log names the
  variable — never its value. Google sign-in is unaffected.

The secret is read only by `auth-email-start.mjs`, sent only to Siteverify in
a request body, and never logged, returned, cached or written to a cookie.
Neither key is in the repository, in `dist/`, or in any test (tests use
invented values and a stubbed `fetch`; Cloudflare's published dummy keys are
not used). Tests fail if browser-facing sources name the secret or call
Siteverify, or if any function other than `auth-email-start.mjs` reads it.

**Never** put `TURNSTILE_SECRET_KEY` in `TURNSTILE_SITE_KEY`: that variable
is published to every visitor.

### Cloudflare dashboard: what to create

A free Cloudflare account is enough; no domain needs to be added to it.

| where | setting | value |
|---|---|---|
| Turnstile → Add widget | Widget name | `BPOZZ email sign-in` |
| | Hostname | `bpozz.com` only. Not `www` (it redirects), not the `*.netlify.app` hostname, no staging host |
| | Widget mode | Managed |
| | Pre-clearance | No |

Copy the **sitekey** into `TURNSTILE_SITE_KEY` and the **secret key** into
`TURNSTILE_SECRET_KEY`. The server compares Siteverify's `hostname` with the
host of `AUTH_ORIGIN`, so a token solved on any other hostname is refused
even if that hostname were added to the widget.

### Rollout order

1. Build and deploy this code with **neither** variable set. Turnstile
   stays dormant: no widget, no request to Cloudflare from the server or
   the browser, and the email flow is as before. That same deploy does ship
   the three changes that are not Turnstile itself, none of them visible on
   a page:
   - **HSTS:** the functions explicitly set
     `max-age=63072000; includeSubDomains; preload` (the static pages'
     policy) on every `/api/*` response. The API responses observed in
     production on 2026-10-01 carried `max-age=31536000`. Whether a
     deployed response then carries the function's header alone, or a
     second `Strict-Transport-Security` header as well, is not verified
     (see [HSTS](#hsts));
   - **CSP:** `https://challenges.cloudflare.com` is allowed in
     `script-src` and `frame-src` (see [CSP changes](#csp-changes)) —
     allowed, but not loaded by anything while Turnstile is dormant;
   - **`safeReturnTo()`:** stricter validation of the post-sign-in return
     path (see [the fix](#safereturnto-fix-2026-10-01)); a return path it
     now refuses sends the visitor to `/` after signing in.
2. Create the widget; set both variables; redeploy.
3. Check: `/api/auth/session` contains `turnstile.siteKey` and not the
   secret; an email sign-in completes in Chrome, Firefox, Safari and a
   phone; the console shows no CSP violation; Cookiebot does not block the
   script; a `POST` without `turnstileToken` gets `403 challenge_failed`.

A page left open across step 2 still runs the old script and sends no
token: its email request fails with "Something went wrong" until the page is
reloaded.

**Rollback:** delete both variables and redeploy.

### Not verified

No real Turnstile widget was available to, or configured for, this Phase 2A
work. (Whether a widget exists in any Cloudflare account was not checked;
this says only that none was used here.) The browser half has therefore run
only against a stand-in for Cloudflare's API, and real-widget end-to-end
behaviour remains unverified. Until step 3 above passes, these are
assumptions: the script loads under the CSP, `interaction-only` keeps the
dialog visually unchanged, and Cookiebot leaves the script alone.

## CSP changes

One origin, in two directives of `public/_headers` (and the unpublished
`public/_htaccess` record kept in step with it):

```text
script-src  … + https://challenges.cloudflare.com
frame-src   … + https://challenges.cloudflare.com
```

These are the two directives Cloudflare documents for Turnstile. Nothing
else changed: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'` and `upgrade-insecure-requests` are as before, and
every origin already required stays (a test checks each):

| origin | needed for |
|---|---|
| `consent.cookiebot.com`, `*.cookiebot.com` | Cookiebot consent |
| `www.googletagmanager.com`, `*.google-analytics.com`, `*.analytics.google.com`, `www.google.com` | Google Analytics |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Google Fonts |
| `www.gstatic.com`, `*.firebasedatabase.app` | Firebase Realtime Database (palette counters) |
| `formspree.io` | contact form |
| `lh3.googleusercontent.com` | Google account avatars |
| `challenges.cloudflare.com` | Turnstile (new) |

Known weakness, unchanged: `script-src` allows `'unsafe-inline'` (the
consent defaults, gtag and footer scripts are inline), so the CSP limits
where scripts load from but does not stop injected inline script. Removing
it needs nonces or hashes in the build — a separate piece of work.

AdSense is not integrated (`ads.txt` is a placeholder), so the CSP has no
AdSense origins. Adding AdSense later needs its own CSP review.

## Rate-limit strategy

Rate limits are Netlify code-based rules in each function's `config`,
counted per client IP and domain — correct for the direct-to-Netlify
architecture.

| endpoint | declared rule | why |
|---|---|---|
| `POST /api/auth/email/start` | 5 per 60 s | each accepted request sends an email |
| `GET`/`POST /api/auth/email/verify` | 20 per 60 s | each POST spends a verification attempt at Supabase |
| `/api/saved` | 120 per 60 s | generous for saving by hand |
| `POST /api/saved/import` | 5 per 60 s | once per browser |
| `/api/auth/session`, `google/start`, `google/callback`, `signout` | none | see below |

**Uncertainty, not resolved.** Netlify's documentation allows **2**
code-based rules per project on Free, Starter and Personal plans and 5 on
Pro. The repository declares **4**. Netlify does not document which rules
apply when more are declared than the plan allows, and the plan could not
be read (no dashboard access). So it is **not known** whether all four are
enforced, and in particular whether the `email/start` rule is. No rule was
added, removed or reordered on a guess.

To resolve it: read the plan and the active rules in the Netlify dashboard.
If only two apply, keep the two email rules (the abuse-sensitive ones) and
drop the two Saved rules, whose abuse is already bounded by requiring a
session and by the per-user caps in the database.

Behind these rules: Supabase's own email limits (a minimum interval per
address and an hourly send limit) and — once on — Turnstile. The figures
this repository quotes for them are **defaults taken from documentation**
(AUTH.md gives 60 s as the default per-address interval); they are **not**
the production project's settings, which have not been read. What the
production project actually enforces has to be verified in the Supabase
dashboard (Authentication → Rate Limits). Supabase's per-IP limits see
Netlify's addresses, not visitors' (see [AUTH.md](AUTH.md)).

False positives: people behind one address (an office, a school, a mobile
carrier's NAT, a VPN) share the 5-per-minute email counter. A sixth person
in the same minute gets "Too many attempts".

## Authentication endpoint protections

| endpoint | method check | CSRF | abuse control | cache |
|---|---|---|---|---|
| `GET /api/auth/session` | 405 otherwise | n/a (reads only) | none — see below | `no-store` |
| `GET /api/auth/google/start` | 405 | n/a; `return_to` through `safeReturnTo()` | none; one cached Supabase settings read | `no-store` |
| `GET /api/auth/google/callback` | 405 | signed cookie + `state` + PKCE | Supabase asked only after the cookie and state check | `no-store` |
| `POST /api/auth/email/start` | 405 | `Origin` exactly `AUTH_ORIGIN` | Netlify rule, Turnstile (when on), Supabase email limits | `no-store` |
| `GET`/`POST /api/auth/email/verify` | 405 | POST: exact `Origin` + signed cookie | Netlify rule; 56-hex token shape | `no-store` |
| `POST /api/auth/signout` | 405 | same-origin `Origin` | none | `no-store` |
| `/api/saved`, `/api/saved/import` | 405 | same-origin `Origin` on writes | Netlify rules; session required; per-user caps | `no-store` |

`DELETE /api/auth/account` does not exist; account deletion is manual
([AUTH.md](AUTH.md#account-deletion)).

### `safeReturnTo()` fix (2026-10-01)

The URL parser resolves dot segments, so `/.//evil.example`,
`/..//evil.example`, `/a/..//evil.example` and `/%2e//evil.example` were
returned as `//evil.example` — a scheme-relative URL. It was **not
exploitable**: every redirect re-parsed the path and both signed cookies
re-validated it, so the browser was sent to `/`.

The function now judges the path exactly as it was given — before the URL
parser can resolve anything in it — and then again as the parser returns
it. A path is refused (the caller falls back to `/`) when it:

- **contains a dot segment**: `.` or `..` as a whole segment, anywhere —
  `/./`, `/../`, a leading or trailing `/.` or `/..`. Dot segments are
  **rejected outright, never resolved**: `/a/../b` is refused, not turned
  into `/b`. The same holds when the dots are written as `%2e`, in either
  case and in any mix (`/%2e%2e/x`, `/.%2E/x`, `/guides/%2e/x`);
- starts with `//`, or holds a backslash or a control character;
- leads into `/api`, in any letter case;
- cannot be percent-decoded (`/%zz`, `/%ff`, a bare `%`).

**Decode limit.** Every rule above is applied to the path as given and to
its successive percent-decodings. The path is decoded at most five times
(`MAX_DECODE_ROUNDS`). The first four decodings are each checked like the
original; the fifth is only compared with the fourth, and a path that is
still changing at that point is refused. So an attack hidden under up to
four layers of encoding is decoded and refused by rule (`/%252e%252e/x`,
`/%252F%252Fevil.example`), and anything encoded five layers deep or more
is refused for its depth, whatever it would decode to.

`%25` is therefore treated as one more layer of encoding, not as a literal
percent sign: `/guide/100%25` is refused (it decodes to a bare `%`, which
is malformed), while a harmless path under up to four layers
(`/a%2520b`) is accepted and returned unchanged. None of the URLs listed
in `public/sitemap.xml` contains a `%` or a dot segment (checked
2026-10-01); URLs outside the sitemap were not checked.

A dot is a dot segment only when it is the whole segment: `/guide/v1.2`
and `/.well-known/security.txt` are ordinary paths and are kept. Only the
path is judged. Query strings and fragments cannot change where a relative
URL points, so they are not validated and are returned with the path:
nothing in them is removed or decoded (`/search?s=../x` is kept as given;
the URL parser percent-encodes a raw space as `%20`, as it always did).

### `/api/auth/session` review

Reviewed, **not changed**. Every response is `no-store`. Cookies that are
not token-shaped are rejected before any network call. A request carrying a
JWT-shaped session cookie and a refresh-shaped cookie costs at most two
Supabase calls (`/user`, then `/token?grant_type=refresh_token`), plus one
settings read per function instance every five minutes.

- An unauthenticated client can therefore turn one request into two Supabase
  requests by sending made-up cookies. No rate limit covers this endpoint.
- A local check of the token's `exp` claim would save one Supabase call for
  honestly expired sessions, but not for an attacker, who can write any
  `exp`. It is not an abuse control and was not implemented.
- The effective control is a rate limit on this endpoint, which depends on
  the unresolved rule count above. The page calls it once per page view, so
  a limit must be generous (for example 60 per minute per IP).

## HSTS

| response | production today (observed 2026-10-01) | Phase 2A code, built locally (not deployed) |
|---|---|---|
| static files (`public/_headers`) | `max-age=63072000; includeSubDomains; preload` | unchanged |
| function responses (`/api/*`) | `max-age=31536000` | `max-age=63072000; includeSubDomains; preload`, set explicitly by the functions; whether a second header also appears on a deployed response is not verified |

Three things, kept apart:

- **What the Phase 2A code sets.** Every function response explicitly
  carries `Strict-Transport-Security: max-age=63072000; includeSubDomains;
  preload` — the static policy word for word; a test keeps the two
  identical. This code is built locally and takes effect only once deployed.
- **What production serves today** (observed 2026-10-01). Static files
  carry the policy from `public/_headers`. The `/api/*` responses observed
  carried `Strict-Transport-Security: max-age=31536000` and no other HSTS
  header. The committed function code sets no HSTS header, so that value
  does not come from this repository's code; what adds it is not
  established here. A browser keeps the HSTS policy it saw most recently,
  and every page view calls `/api/auth/session` after loading the page, so
  today the shorter policy without `includeSubDomains` is the one browsers
  keep.
- **Not verified.** What a deployed `/api/*` response carries once the
  function sets the header itself: the function's header alone, or the
  currently observed `max-age=31536000` header beside it. Neither is
  asserted here. Check with
  `curl -sI https://bpozz.com/api/auth/session` after the next deploy. The
  expected result is one `Strict-Transport-Security` line with the static
  policy; if there are two, which one a browser applies depends on their
  order, and that would need its own decision.

**Subdomains** (checked 2026-10-01): `www.bpozz.com` serves HTTPS and
redirects to the apex; the certificate covers `*.bpozz.com`; there is no
wildcard DNS record; certificate-transparency logs list only `bpozz.com` and
`www.bpozz.com`. `includeSubDomains` was already sent by every static page,
so this change extends no policy to a host that did not already have it.
The standing consequence: any future subdomain must serve HTTPS from its
first day.

**`preload`:** the header carries `preload`, but bpozz.com is not on the
browser preload list (status `unknown` at hstspreload.org). The token is
consent for the domain to be submitted — by anyone — and listing is slow to
undo. Either submit the domain deliberately or remove the token; that
decision is the owner's and was not made here.

## Email authentication (DMARC)

Observed 2026-10-01, **not changed**: `_dmarc.bpozz.com` is
`v=DMARC1; p=none;` with no `rua` reporting address, and the apex has no SPF
record. Mail forged as `@bpozz.com` is therefore not rejected or
quarantined by receivers on BPOZZ's instruction.

Before moving to `quarantine` and then `reject`:

1. Identify every system that sends as `@bpozz.com` or a subdomain (Supabase
   via Resend; anything else).
2. Confirm each passes SPF or DKIM **aligned** with the From domain. The
   usual Resend records (`send.bpozz.com`, `resend._domainkey.bpozz.com`)
   were not found, so the sending domain must be confirmed in Resend first.
3. Add a `rua=` address and read the aggregate reports for a few weeks.
4. Raise the policy in steps (`p=quarantine; pct=…`, then `p=reject`).

A wrong step here makes sign-in emails undeliverable, so it needs explicit
authorization and DNS access.

## COOP and CORP: not added

- **Cross-Origin-Opener-Policy.** `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` already prevent framing; Google sign-in is a
  full-page redirect, not a popup. COOP would add isolation from windows
  that open BPOZZ, a small gain here, and has to be checked against
  Cookiebot and the image picker's share links first. No documented need.
- **Cross-Origin-Resource-Policy.** `same-origin` would stop other sites'
  pages from displaying BPOZZ's images, including link previews rendered in
  a browser. BPOZZ serves no private static resource that this would
  protect.

## Origin exposure

The site is served at its `*.netlify.app` hostname as well as at bpozz.com
(name not recorded here; `bpozz.netlify.app` is not it), and at deploy
permalinks. This is inherent to Netlify. On those hostnames the email
endpoints refuse every browser request (`Origin` must be `AUTH_ORIGIN`);
`/.netlify/functions/*` paths are not served (404).

*Phase 2A code — built locally, not deployed:* while Turnstile is on, the
server also refuses a token whose hostname, as verified by Siteverify, is
not the host of `AUTH_ORIGIN` — so a token solved on one of those other
hostnames would be rejected. This check is implemented and built locally,
but it has not been deployed, and it has been tested only by unit tests
against a stubbed Siteverify: not against a real widget, and not in
production. Production behaviour is unchanged until deployment.

## Secrets

| value | where it may live |
|---|---|
| `TURNSTILE_SECRET_KEY`, `AUTH_COOKIE_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (unused) | Netlify environment only |
| Google client secret, SMTP credentials | Supabase only |
| `TURNSTILE_SITE_KEY`, Firebase web API key, Cookiebot ID, GA measurement ID | public by design |
| a Cloudflare API token | not used: no code in this repository reads or sends a Cloudflare API credential or account/zone configuration, and Turnstile needs none (only the sitekey and secret above). Whether any such token exists in a Cloudflare account was not checked |

Audit 2026-10-01: no secret in tracked files or in `dist/`.

## SEO

Nothing here affects crawlers: no bot blocking, no challenge on any page,
no country rule. Turnstile runs only when a person submits the email form.
`/robots.txt`, `/sitemap.xml` and public pages answered 200 to a Googlebot
user agent on 2026-10-01.

## Emergency procedure

"Under Attack" mode is a Cloudflare proxy feature and is **not available**
while the proxy is deferred. What exists instead:

| situation | action |
|---|---|
| email sign-in is being abused | unset `AUTH_EMAIL_ENABLED`, redeploy: `email/start` answers 503 and sends nothing; Google sign-in keeps working |
| Turnstile misbehaves | delete both `TURNSTILE_*` variables, redeploy |
| Saved API is being abused | unset `SAVED_ENABLED`, redeploy |
| volumetric attack on the site | Netlify's own platform protections apply; contact Netlify support |

## Remaining risks

1. Turnstile is not live and not verified against a real widget.
2. Whether Netlify enforces all four declared rate limits is unknown.
3. `/api/auth/session` has no rate limit and can be used to spend function
   invocations and Supabase requests.
4. Visitors whose browser or network blocks `challenges.cloudflare.com`
   cannot use email sign-in once Turnstile is on (Google sign-in still
   works). Turnstile reduces automated abuse; it does not stop a person, or
   a paid solving service.
5. `script-src 'unsafe-inline'`.
6. DMARC `p=none`.
7. The `preload` token is sent without the domain being on the list.
8. The origin is reachable outside bpozz.com (inherent to Netlify).
9. Adding Turnstile means Cloudflare processes sign-in visitors' browser
   data: the Privacy Policy and the Cookiebot declaration need the owner's
   review before it is switched on.

## If the Cloudflare proxy is reconsidered

All of the following first:

1. A plan for the origin bypass (Netlify Enterprise, or accepting it).
2. Rate limits re-designed: Netlify's per-IP rules would have to be removed
   or replaced, since they would count Cloudflare's addresses.
3. Every DNS record inventoried and re-created at Cloudflare, mail and
   verification records DNS-only, before the nameserver change.
4. SSL/TLS mode **Full (strict)** — never Flexible — and Netlify's
   certificate renewal confirmed to work behind the proxy.
5. No caching of `/api/*`; no "Cache Everything" rule.
6. Bot Fight Mode tested against `/api/*`, the OAuth callback and search
   crawlers before it is left on; it cannot be excepted per path on Free.
7. Netlify's position on support accepted.
