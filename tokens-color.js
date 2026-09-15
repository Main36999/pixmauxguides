/**
 * tokens-color.js
 * -----------------------------------------------------------------------
 * Pure color-space conversion utilities: hex <-> RGB <-> HSL. No DOM, no
 * fetch, no site-specific assumptions — this file only knows about
 * numbers. It underlies two things that must never disagree:
 *
 *   - tokens-a11y.js (needs RGB channels to compute relative luminance)
 *   - scripts/generate-palettes.js (needs HSL to *build* palettes, and
 *     hex/RGB to describe them in the detail-page breakdown table)
 *
 * Ported into the browser and into Node from one source, same as
 * app.js's shared helpers — this just isn't page-specific, so it lives
 * in its own file instead of inside app.js.
 *
 * Usage:
 *   Browser: <script src="/tokens-color.js"></script> exposes window.BpozzColor
 *   Node:    const BpozzColor = require("./tokens-color.js");
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BpozzColor = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // Accepts "#abc", "abc", "#aabbcc", "aabbcc" (case-insensitive).
  // Returns a normalized lowercase "#rrggbb" string, or null if the
  // input isn't a valid hex color — callers should treat null as "bad
  // input" rather than let a NaN silently propagate into a contrast
  // calculation.
  function normalizeHex(input) {
    if (typeof input !== "string") return null;
    var s = input.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return "#" + s.toLowerCase();
  }

  function isValidHex(input) {
    return normalizeHex(input) !== null;
  }

  function hexToRgb(input) {
    var hex = normalizeHex(input);
    if (!hex) return null;
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  function componentToHex(c) {
    var hex = clamp(Math.round(c), 0, 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }

  function rgbToHex(rgb) {
    return (
      "#" +
      componentToHex(rgb.r) +
      componentToHex(rgb.g) +
      componentToHex(rgb.b)
    );
  }

  // h: 0-360, s/l: 0-100 (the units designers think in, matching the
  // breakdown table's "HSL" column — e.g. hsl(214, 65%, 21%)).
  function rgbToHsl(rgb) {
    var r = rgb.r / 255,
      g = rgb.g / 255,
      b = rgb.b / 255;
    var max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    var h = 0,
      s = 0,
      l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r:
          h = ((g - b) / d) % 6;
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToRgb(hsl) {
    var h = ((hsl.h % 360) + 360) % 360;
    var s = clamp(hsl.s, 0, 100) / 100;
    var l = clamp(hsl.l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r1, g1, b1;
    if (h < 60) {
      r1 = c;
      g1 = x;
      b1 = 0;
    } else if (h < 120) {
      r1 = x;
      g1 = c;
      b1 = 0;
    } else if (h < 180) {
      r1 = 0;
      g1 = c;
      b1 = x;
    } else if (h < 240) {
      r1 = 0;
      g1 = x;
      b1 = c;
    } else if (h < 300) {
      r1 = x;
      g1 = 0;
      b1 = c;
    } else {
      r1 = c;
      g1 = 0;
      b1 = x;
    }
    return {
      r: (r1 + m) * 255,
      g: (g1 + m) * 255,
      b: (b1 + m) * 255,
    };
  }

  function hslToHex(hsl) {
    return rgbToHex(hslToRgb(hsl));
  }

  function hexToHsl(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    return rgbToHsl(rgb);
  }

  return {
    clamp: clamp,
    normalizeHex: normalizeHex,
    isValidHex: isValidHex,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    hslToHex: hslToHex,
    hexToHsl: hexToHsl,
  };
});
