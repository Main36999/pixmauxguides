/**
 * src/build/head.js — the one shared <head> frame and document scaffolding.
 *
 * PHASE 4 STEP 8 — SHARED HEAD / COMMON HTML CLEANUP
 *
 * Two modules in this directory emit a full page from scratch, and until this
 * step each carried its own complete copy of the site's <head>:
 *
 *   src/build/guide-template.js  the 22 /guide/*.html pages, as four frame
 *                                constants (DOC_OPEN, HEAD_CONSENT,
 *                                HEAD_ANALYTICS, HEAD_ASSETS) plus HEAD_CLOSE
 *   src/build/categories.js      the 10 /category/*.html pages, as literal
 *                                text inside one 100-line template literal
 *
 * The two copies were not "similar". Measured band by band against the
 * committed pages, they are the SAME BYTES in the SAME ORDER, with exactly
 * two differences, both of which are values rather than structure:
 *
 *   1. the Consent Mode v2 explanatory comment (346 bytes) is present on the
 *      guide pages and absent on the category pages;
 *   2. the guide pages load /guide-article.css after /styles.css.
 *
 * Everything else — the Cookiebot tag, the consent default script, the
 * charset, the gtag.js block, the theme colour, both icons, the two font
 * preconnects, the DM Sans stylesheet, /styles.css, the doctype, <html
 * lang>, the <head> open and close — is byte-identical, and is identical
 * again on the 13 hand-authored pages the builders only patch (verified by
 * head.test.js across all 41 published pages).
 *
 * So those bands live here once, and the two differences are stated as
 * arguments: `consentNote` and `stylesheets`. That is the same move the rest
 * of Phase 4 made for drift it could not delete — `page.format` in
 * guide-template.js records four whitespace variations as data rather than
 * pretending they are not there. A difference expressed as a parameter is a
 * difference someone can find, count and later remove; a difference expressed
 * as a second copy of 1.7 KB of markup is one nobody sees until the two
 * copies disagree.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It is not a page template. `headHtml` composes the HEAD FRAME around text
 * its caller supplies for the per-page bands (`meta`, `social`,
 * `structuredData`); it never builds, escapes, orders or validates any of
 * them. In particular:
 *
 *   - it builds no JSON-LD. Structured data is composed by
 *     src/build/structured-data.js and arrives here already rendered, exactly
 *     as it did when the two callers spliced it themselves. Step 7's rule —
 *     structured data is derived, never authored — is untouched, and so are
 *     its bytes and its position in <head>.
 *   - it decides no URL, title, description or canonical. Those are the
 *     caller's `meta` and `social` bands, verbatim.
 *
 * Pure: no fs, no ctx, no site config, no HTML escaping. Same inputs, same
 * bytes, every time.
 *
 * THE MARKER PAIRS
 *
 * HEADER_START/END and FOOTER_START/END are here for the same reason the head
 * bands are: both writers emit them and, before this step, categories.js
 * emitted them as bare literals inside its template while guide-template.js
 * declared them as constants. src/build/guides.js already cross-checked the
 * template's spelling against the two modules that patch those regions
 * (src/build/header.js, src/build/footer.js); the category pages were outside
 * that check, so a typo there would have shipped a page with a raw partial in
 * it and nothing would have failed.
 *
 * Both writers now take the markers from here, and `assertMarkersAgree` in
 * src/build/guides.js checks this module's spelling against the patchers'.
 * header.js and footer.js deliberately keep declaring their own: they OWN
 * those regions, and a check between two independent declarations is worth
 * more than one constant shared by everybody.
 *
 * WHAT IS DELIBERATELY STILL DUPLICATED
 *
 * The 13 committed pages that no builder writes — index.html, about.html,
 * contact.html, privacy.html, terms.html, roadmap.html, search.html,
 * guides/index.html, palettes/index.html — each carry their own copy of these
 * same bands. Centralizing those means GENERATING their <head>, which means
 * generating the hand-authored JSON-LD four of them carry (Step 7's scope) and
 * rewriting search.html (Step 5's). Neither is this step's to open.
 *
 * What this step can do for them, and does, is make the duplication visible
 * and verified rather than merely present: head.test.js asserts that every one
 * of the 41 published pages carries these exact bands, so the copies cannot
 * drift apart silently while they last.
 */

"use strict";

// ---------------------------------------------------------------------
// the document frame
// ---------------------------------------------------------------------

const DOC_OPEN = '<!doctype html>\n<html lang="en">\n  <head>\n';

const HEAD_CLOSE = "\n  </head>\n";

/**
 * </main>'s tail: the one <script> every page loads, and the document close.
 * Identical on both writers; the category pages add a final newline, which is
 * `trailingNewline` on the guide side.
 */
const BODY_CLOSE =
  '\n\n    <script src="/app.js"></script>\n  </body>\n</html>';

// ---------------------------------------------------------------------
// band 1 — consent, then charset
// ---------------------------------------------------------------------

/**
 * Cookiebot. First thing in <head> on every page, because the consent default
 * below must be set before gtag.js loads and Cookiebot must be able to block
 * what follows it.
 */
const COOKIEBOT = `    <script
      id="Cookiebot"
      src="https://consent.cookiebot.com/uc.js"
      data-cbid="585f3600-2a77-4ba9-87f7-9aac44c21247"
      data-blockingmode="auto"
      type="text/javascript"
    ></script>
`;

/**
 * The explanatory comment above the consent default. Present on 28 of the 41
 * published pages and absent on the 10 category pages, guides/index.html,
 * palettes/index.html and search.html — a documentation difference only: the
 * script it describes is byte-identical everywhere.
 *
 * It is a parameter rather than a constant of the frame so that the category
 * pages keep the exact bytes they ship today. Emitting it on all 41 pages is
 * a one-word change here and 10 changed output files; that is a formatting
 * decision with its own approval, not a cleanup.
 */
const CONSENT_MODE_NOTE = `    <!-- Google Consent Mode v2 — default state, set before gtag.js loads.
         data-cookieconsent="ignore" exempts this script from Cookiebot's
         auto-blocking so the default always fires immediately; Cookiebot
         then pushes gtag('consent','update', …) automatically once the
         visitor makes a choice in the banner. -->
`;

/** Google Consent Mode v2 defaults. Byte-identical on all 41 pages. */
const CONSENT_DEFAULT = `    <script data-cookieconsent="ignore">
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag("consent", "default", {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        functionality_storage: "denied",
        personalization_storage: "denied",
        security_storage: "granted",
        wait_for_update: 500,
      });
      gtag("set", "ads_data_redaction", true);
      gtag("set", "url_passthrough", false);
    </script>
`;

const CHARSET = '    <meta charset="UTF-8" />\n';

/**
 * The consent band, ending at <meta charset>. `note` selects the one
 * documented variation; nothing else about the band varies.
 */
function consentHtml(note) {
  return (
    COOKIEBOT + "\n" + (note ? CONSENT_MODE_NOTE : "") + CONSENT_DEFAULT + CHARSET
  );
}

// ---------------------------------------------------------------------
// band 2 — analytics
// ---------------------------------------------------------------------

/**
 * gtag.js. Byte-identical on all 41 pages, including the trailing blank line
 * that separates it from the social band below.
 */
const HEAD_ANALYTICS = `    <!-- Google tag (gtag.js) -->
    <script
      async
      src="https://www.googletagmanager.com/gtag/js?id=G-NHGHCTY21D"
    ></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag("js", new Date());

      gtag("config", "G-NHGHCTY21D");
    </script>

`;

// ---------------------------------------------------------------------
// band 3 — theme, icons, fonts, stylesheets
// ---------------------------------------------------------------------

/**
 * Theme colour and both icons. Byte-identical on all 41 pages. The theme
 * colour is --header-bg (src/styles/styles.css), the sticky header bar
 * that sits directly under the browser UI.
 */
const THEME_AND_ICONS = `    <meta name="theme-color" content="#101010" />
    <link rel="icon" type="image/png" href="/assets/favicon.png" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
`;

/** The two preconnects and DM Sans. Byte-identical on all 41 pages. */
const FONTS = `    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
      rel="stylesheet"
    />
`;

/**
 * The site's stylesheets, by name rather than by href at each call site.
 *
 * Both are SITE-ROOT paths on purpose, which is the audit
 * docs/archive/_TEMPLATE.html opens with: a visitor on /guide/<slug>/
 * resolves "../" one level too shallow and loses every stylesheet.
 */
const STYLESHEETS = {
  site: "/styles.css",
  guideArticle: "/guide-article.css",
};

const stylesheetLink = (href) =>
  `    <link rel="stylesheet" href="${href}" />\n`;

/**
 * The assets band, ending in the blank line that separates it from the
 * structured data. `stylesheets` is a list of hrefs in load order — the one
 * place the guide pages' extra /guide-article.css is stated.
 */
function assetsHtml(stylesheets) {
  return (
    THEME_AND_ICONS + "\n" + FONTS + stylesheets.map(stylesheetLink).join("") + "\n"
  );
}

// ---------------------------------------------------------------------
// the whole <head>
// ---------------------------------------------------------------------

/**
 * One <head>, from <!doctype html> through </head>.
 *
 *   consentNote     emit the Consent Mode v2 explanatory comment
 *   meta            viewport, <title>, description, canonical — verbatim,
 *                   ending in the blank line before the analytics band
 *   social          the Open Graph and Twitter Card blocks — verbatim,
 *                   ending in the blank line before the assets band
 *   stylesheets     stylesheet hrefs, in load order
 *   structuredData  the rendered JSON-LD <script> block(s), already indented
 *                   for <head>, from src/build/structured-data.js. "" emits
 *                   nothing.
 *   after           anything a page puts AFTER its structured data and before
 *                   </head>. "" emits nothing.
 *
 * `meta` and `social` are spliced, not built. On the guide pages they are
 * per-page content slots whose attribute wrapping follows each guide's own
 * title length; on the category pages they are that template's own text. Both
 * arrive rendered, and this module changes neither.
 *
 * The band ORDER, however, is shared and load-bearing, and stating it once is
 * most of the point of this function: consent before analytics (the consent
 * default must be set before gtag.js loads), and structured data last so a
 * page can append to it.
 */
function headHtml({
  consentNote = true,
  meta,
  social,
  stylesheets,
  structuredData = "",
  after = "",
}) {
  return (
    DOC_OPEN +
    consentHtml(consentNote) +
    meta +
    HEAD_ANALYTICS +
    social +
    assetsHtml(stylesheets) +
    structuredData +
    (after ? "\n" + after : "") +
    HEAD_CLOSE
  );
}

// ---------------------------------------------------------------------
// common body scaffolding
// ---------------------------------------------------------------------

/**
 * Marker pairs owned by src/build/header.js and src/build/footer.js. Both
 * writers emit them from here; the patchers keep their own declarations and
 * src/build/guides.js asserts the two agree on every build.
 */
const HEADER_START = "<!--HEADER_START-->";
const HEADER_END = "<!--HEADER_END-->";
const FOOTER_START = "<!--FOOTER_START-->";
const FOOTER_END = "<!--FOOTER_END-->";

/**
 * The first focusable element on every page. Both writers emit this exact
 * shape; only the target id and the label differ, and both of those are
 * genuinely per-page-type (`#guide-content` / "Skip to guide" against
 * `#category-content` / "Skip to content").
 *
 * The text and the id are NOT normalized here: that is accessibility work,
 * which is Step 9's, not this step's.
 */
const skipLinkHtml = (target, label) =>
  `    <a href="#${target}" class="skip-link">${label}</a>`;

/** The header region, for src/build/header.js to resync afterwards. */
const headerRegion = (partial) => HEADER_START + partial + HEADER_END;

/** The footer region, for src/build/footer.js to resync afterwards. */
const footerRegion = (partial) => FOOTER_START + partial + FOOTER_END;

module.exports = {
  headHtml,
  consentHtml,
  assetsHtml,
  skipLinkHtml,
  headerRegion,
  footerRegion,
  stylesheetLink,

  DOC_OPEN,
  HEAD_CLOSE,
  BODY_CLOSE,
  COOKIEBOT,
  CONSENT_MODE_NOTE,
  CONSENT_DEFAULT,
  CHARSET,
  HEAD_ANALYTICS,
  THEME_AND_ICONS,
  FONTS,
  STYLESHEETS,

  HEADER_START,
  HEADER_END,
  FOOTER_START,
  FOOTER_END,
};
