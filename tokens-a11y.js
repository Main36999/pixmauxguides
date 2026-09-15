/**
 * tokens-a11y.js
 * -----------------------------------------------------------------------
 * The accessibility engine for the Color Palette Library (/tokens).
 * This is deliberately the FIRST piece of the feature that was built,
 * and every other piece — the gallery card's contrast badge, the detail
 * page's breakdown table, the "Most Accessible" sort, and the builder's
 * live contrast checker — calls into this file rather than recomputing
 * luminance/contrast itself. One implementation, one set of thresholds,
 * everywhere. See tokens-a11y.test.js for the tests that pin its output
 * against known reference values (e.g. black-on-white = 21:1).
 *
 * WCAG 2.x contrast math (per the W3C formula, and the same numbers
 * bpozz's own guide/color-contrast-systems.html walks through):
 *   1. Convert each sRGB channel (0-255) to linear-light values.
 *   2. Relative luminance L = 0.2126R + 0.7152G + 0.0722B.
 *   3. Contrast ratio = (L_lighter + 0.05) / (L_darker + 0.05).
 *
 * Depends on tokens-color.js for hex -> RGB conversion (see that file
 * for the load-order note — this module expects BpozzColor to exist,
 * whether that's `require`d here in Node or already on `window` in the
 * browser, matching the <script> order every /tokens/*.html page uses).
 *
 * Usage:
 *   Browser: <script src="/tokens-color.js"></script>
 *            <script src="/tokens-a11y.js"></script>   (in that order)
 *            -> window.BpozzA11y
 *   Node:    const BpozzA11y = require("./tokens-a11y.js");
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tokens-color.js"));
  } else {
    root.BpozzA11y = factory(root.BpozzColor);
  }
})(typeof self !== "undefined" ? self : this, function (BpozzColor) {
  "use strict";

  // The six roles a palette is expected to carry (see tokens.json's
  // schema / scripts/generate-palettes.js). Kept here, not just in the
  // generator, because computeAccessibilityScore() needs to know which
  // roles are plausible "things text sits on top of" to build its
  // pairing list.
  //
  // `text` is only checked against CANVAS_ROLES (background, surface)
  // at the normal-text AA ratio (4.5:1) — those are the surfaces body
  // copy actually sits on. `text` is deliberately NOT checked against
  // `primary`/`secondary`: a brand/button color is normally paired with
  // its own dedicated label color (an "on-primary" token), not the
  // page's general body-text color — treating them as interchangeable
  // would flag a huge share of real, working palettes as "inaccessible"
  // for a pairing no real interface uses.
  //
  // ACCENT_ROLES ARE instead checked against `background` at the
  // WCAG 1.4.11 non-text ("UI component") ratio (3:1) — the relevant
  // question for a brand color is "can you tell it apart from the
  // page", not "would gray body text be legible painted on top of it".
  var TEXT_ROLE = "text";
  var CANVAS_ROLES = ["background", "surface"];
  var ACCENT_ROLES = ["primary", "secondary"];

  // ---- WCAG 2.x pass thresholds -----------------------------------
  var THRESHOLD = {
    AA_NORMAL: 4.5,
    AA_LARGE: 3.0,
    AAA_NORMAL: 7.0,
    AAA_LARGE: 4.5,
    UI_COMPONENT: 3.0, // WCAG 1.4.11 non-text contrast (icons, borders)
  };

  function srgbChannelToLinear(c8) {
    var c = c8 / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // Relative luminance of a single hex color, 0 (black) to 1 (white).
  function relativeLuminance(hex) {
    var rgb = BpozzColor.hexToRgb(hex);
    if (!rgb) return null;
    var r = srgbChannelToLinear(rgb.r);
    var g = srgbChannelToLinear(rgb.g);
    var b = srgbChannelToLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Contrast ratio between two hex colors, 1 (identical) to 21 (black
  // vs. white). Order of arguments doesn't matter — the formula always
  // divides the lighter luminance by the darker one.
  function contrastRatio(hexA, hexB) {
    var la = relativeLuminance(hexA);
    var lb = relativeLuminance(hexB);
    if (la === null || lb === null) return null;
    var lighter = Math.max(la, lb);
    var darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Full pass/fail breakdown for a given ratio, both text sizes and
  // both WCAG levels, plus the non-text (UI component) threshold.
  function wcagLevels(ratio) {
    if (ratio === null) return null;
    return {
      aaNormal: ratio >= THRESHOLD.AA_NORMAL,
      aaLarge: ratio >= THRESHOLD.AA_LARGE,
      aaaNormal: ratio >= THRESHOLD.AAA_NORMAL,
      aaaLarge: ratio >= THRESHOLD.AAA_LARGE,
      uiComponent: ratio >= THRESHOLD.UI_COMPONENT,
    };
  }

  // Single best-fit label for a ratio, used on the compact card badge
  // and the detail-page breakdown table ("AAA" / "AA" / "AA Large" /
  // "Fail"). Order matters: check the highest bar first.
  function wcagBadge(ratio) {
    if (ratio === null) return "—";
    if (ratio >= THRESHOLD.AAA_NORMAL) return "AAA";
    if (ratio >= THRESHOLD.AA_NORMAL) return "AA";
    if (ratio >= THRESHOLD.AA_LARGE) return "AA Large";
    return "Fail";
  }

  function formatRatio(ratio) {
    if (ratio === null) return "—";
    return ratio.toFixed(2) + ":1";
  }

  // ---- palette-level score -----------------------------------------
  // "accessibility_score" (tokens.json) = the fraction of role pairings
  // that pass their relevant WCAG threshold — see the brief:
  // "text-on-background, text-on-surface, etc." Two kinds of pairing,
  // each with the threshold that actually applies to it (see the
  // CANVAS_ROLES / ACCENT_ROLES comment above):
  //   - kind "text": `text` vs. each defined CANVAS_ROLE, at 4.5:1
  //   - kind "ui":   each defined ACCENT_ROLE vs. `background`, at 3:1
  // Returns null (not 0) if the palette has no `text` role at all,
  // since "0% accessible" and "not applicable" are different things —
  // callers should treat null as "can't be sorted/scored", not "worst
  // possible score".
  function computeAccessibilityScore(colors) {
    var byRole = {};
    (colors || []).forEach(function (c) {
      byRole[c.role] = c.hex;
    });
    var textHex = byRole[TEXT_ROLE];
    var bgHex = byRole.background;
    if (!textHex) return null;

    var pairings = [];
    CANVAS_ROLES.forEach(function (role) {
      var hex = byRole[role];
      if (!hex || role === TEXT_ROLE) return;
      var ratio = contrastRatio(textHex, hex);
      pairings.push({
        kind: "text",
        fg: TEXT_ROLE,
        bg: role,
        ratio: ratio,
        threshold: THRESHOLD.AA_NORMAL,
        pass: ratio !== null && ratio >= THRESHOLD.AA_NORMAL,
      });
    });
    if (bgHex) {
      ACCENT_ROLES.forEach(function (role) {
        var hex = byRole[role];
        if (!hex) return;
        var ratio = contrastRatio(hex, bgHex);
        pairings.push({
          kind: "ui",
          fg: role,
          bg: "background",
          ratio: ratio,
          threshold: THRESHOLD.UI_COMPONENT,
          pass: ratio !== null && ratio >= THRESHOLD.UI_COMPONENT,
        });
      });
    }

    if (!pairings.length) return null;
    var passed = pairings.filter(function (p) {
      return p.pass;
    }).length;
    return {
      score: passed / pairings.length,
      pairings: pairings,
    };
  }

  return {
    TEXT_ROLE: TEXT_ROLE,
    CANVAS_ROLES: CANVAS_ROLES,
    ACCENT_ROLES: ACCENT_ROLES,
    THRESHOLD: THRESHOLD,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    wcagLevels: wcagLevels,
    wcagBadge: wcagBadge,
    formatRatio: formatRatio,
    computeAccessibilityScore: computeAccessibilityScore,
  };
});
