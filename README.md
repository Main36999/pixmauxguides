# bpozz

bpozz — A Creative Platform for Graphic Designers.

The site currently offers UI/UX design guides, a learning roadmap, free fonts,
color palettes, a color library and an image palette extractor (Image
Picker).

Website: https://bpozz.com/

Brand naming rules are in [docs/BRAND.md](docs/BRAND.md).

## Technology and architecture

- **Custom static build.** `npm run build` runs `src/build/build.js`, a
  Node script. The root `package.json` declares no dependencies and there
  is no root lockfile, so nothing needs installing. No framework, bundler
  or CMS. Build configuration is in `site.config.js`.
- **Pipeline.** `clean`, `load`, `copy`, `data`, `render`, `sitemap`,
  `verify`. The build writes only `dist/` (the published site) and
  `.build/` (private staging). Both are gitignored and never hand-edited.
- **Output gate.** `verify` hashes every file in `dist/` and fails the
  build if anything differs from `scripts/qa/approved-output.json`.
- **Browser code.** Plain JavaScript in `src/client/` and `src/shared/`,
  assembled into `/app.js` at build time; some page scripts are also
  published as separate files. Styles are plain CSS in `src/styles/`.
- **Server code.** Netlify Functions in `netlify/functions/` (shared code
  in `netlify/lib/`) handle sign-in, saved items and client error
  reports. Sign-in and saved items use Supabase. See
  [docs/AUTH.md](docs/AUTH.md) and [docs/SAVED.md](docs/SAVED.md).
- **Third-party services.** Firebase Realtime Database (palette likes),
  Formspree (contact form), Cookiebot (consent) and Google Analytics 4.

### Node version

`package.json` declares `node >=18`. Netlify builds with Node 24.21.0
(`netlify.toml`); CI runs Node 24.19.0 (`.github/workflows/ci.yml`).

## Commands

All commands come from the `scripts` in `package.json`. There is no
dev-server script.

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the site into `dist/` and runs the `verify` gate. |
| `npm test` | Runs the unit tests (`node --test` on the files listed in `package.json`). |
| `npm run qa` | `build`, then `check:fonts`, `check:palettes`, `snapshot`, `check:urls` and `check:baseline`, stopping at the first failure. |
| `npm run check:fonts` | Checks the font library's licenses and files (`scripts/fonts/check-fonts.js`). |
| `npm run check:palettes` | Checks the palette data's integrity (`scripts/palettes/check-palettes.js`). |
| `npm run snapshot` | Records the URL surface and HTML checksums of `dist/` into `.qa/`. |
| `npm run check:urls` | Compares the URL surface and canonicals with the approved baseline. |
| `npm run check:baseline` | Compares page checksums and data contracts with the approved baseline. |

CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run qa` on every
push to `main` and every pull request into `main`.

### Approving intended output changes

These two commands rewrite approved records. Run them only after the
change has been reviewed.

| Command | What it writes |
| --- | --- |
| `BPOZZ_APPROVE_OUTPUT=1 npm run build` | `scripts/qa/approved-output.json` |
| `BPOZZ_WRITE_BASELINE=1 npm run snapshot:baseline` | `url-snapshot.json` and `html-checksums.json` in `scripts/qa/baseline/` |

Without the environment variable, the build never writes the manifest
and `snapshot:baseline` refuses to run. See
[scripts/qa/baseline/README.md](scripts/qa/baseline/README.md).

### Advisory tools (not part of build, test, QA or CI)

- `scripts/seo/check-seo.mts`: a local SEO checker. Its exact command,
  run under Node's permission model, is in the file's header comment.
- `tools/typescript/`: a dev-only TypeScript type checker for
  `scripts/seo/`, installed by hand. Netlify and CI never install it.

## Repository structure

| Path | Contents |
| --- | --- |
| `src/build/` | Build pipeline and page builders, with tests |
| `src/client/`, `src/shared/` | Browser JavaScript, with tests |
| `src/styles/` | CSS |
| `src/data/` | Font library, font license audit and editorial data, guide resources |
| `src/brand/` | Editable source of the social preview image `public/og-image.png` (not published) |
| `content/guide/` | Guide content ([README](content/guide/README.md)) |
| `guide/` | Generated guide pages that are committed; edit `content/guide/` instead |
| `*.html`, `guides/`, `palettes/`, `colors/`, `image-picker/` | Page sources (plus palette and color data); the build fills in shared regions such as the header and footer |
| `partials/` | Shared header and footer |
| `guides.json`, `categories.json`, `resource-types.json` | Site data |
| `assets/`, `thumbnail_image_webp/` | Images, published as-is |
| `public/` | Published static files, including `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`, `ads.txt`, `og-image.png` and the font files |
| `netlify/` | Netlify Functions and their shared code |
| `scripts/qa/` | QA gates, approved output manifest and baselines |
| `scripts/fonts/`, `scripts/palettes/`, `scripts/seo/` | Data checks and maintenance scripts |
| `docs/` | Internal documentation |
| `site.config.js` | Build configuration |
| `netlify.toml` | Netlify build settings |

## Deployment

The site is hosted on Netlify. `netlify.toml` sets the build command
(`npm run build`), the publish directory (`dist`), the functions directory
(`netlify/functions`) and the Node version. Headers and redirects live in
`public/_headers` and `public/_redirects`, which the build publishes into
`dist/`. Environment variables and secrets are set in the Netlify
dashboard, not in the repository.

Netlify builds and deploys on its own; the CI workflow only verifies and
never deploys. Because Netlify runs `npm run build`, a change that alters
the published output must be committed together with its updated
`scripts/qa/approved-output.json`, or the `verify` stage fails the build.

## Documentation

- [docs/BRAND.md](docs/BRAND.md): brand name and naming rules
- [docs/AUTH.md](docs/AUTH.md): authentication
- [docs/SAVED.md](docs/SAVED.md): account Saved items
- [docs/CLOUDFLARE-SECURITY.md](docs/CLOUDFLARE-SECURITY.md): Cloudflare
  status and Turnstile
- [docs/SETUP-FIREBASE.md](docs/SETUP-FIREBASE.md): palette likes
  (Firebase)
- [content/guide/README.md](content/guide/README.md): guide content format
- [scripts/qa/baseline/README.md](scripts/qa/baseline/README.md): approved
  baseline

Historical records, kept as evidence and not updated:
[AUDIT_REPORT.md](AUDIT_REPORT.md) (2026-09-23 audit),
[docs/icons-provenance-audit.md](docs/icons-provenance-audit.md),
the `docs/bpozz-phase-4-step-*-handoff.md` files and `docs/archive/`.
