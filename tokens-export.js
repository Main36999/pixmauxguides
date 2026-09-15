/**
 * tokens-export.js
 * -----------------------------------------------------------------------
 * "Export as real tokens" (brief §2/§3.3): CSS custom properties, SCSS,
 * Tailwind config, JSON (as a W3C Design Tokens / DTCG color object —
 * see guide/color-palette-token-system.html#dtcg-color, so the export
 * format matches what that guide already teaches), Figma Variables,
 * iOS (Swift), and Android (colors.xml).
 *
 * One formatter per format, all pure functions of `colors` (the same
 * `[{role, hex}, ...]` array tokens.json already stores). Used from
 * two places that must never disagree about what "the CSS export"
 * looks like:
 *   - build-tokens.js (Node) pre-renders each format into the detail
 *     page's export panel at build time.
 *   - tokens-shared.js (browser) calls toCss() for the palette card's
 *     one-click "Copy as CSS variables" button, and tokens-create.js
 *     calls these when exporting a palette made in the builder.
 *
 * Usage:
 *   Browser: <script src="/tokens-export.js"></script> -> window.BpozzExport
 *   Node:    const BpozzExport = require("./tokens-export.js");
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tokens-color.js"));
  } else {
    root.BpozzExport = factory(root.BpozzColor);
  }
})(typeof self !== "undefined" ? self : this, function (BpozzColor) {
  "use strict";

  // kebab-case is already what our role names look like (single words),
  // but this normalizes any future multi-word custom role names, e.g.
  // "on primary" -> "on-primary".
  function kebab(role) {
    return String(role)
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
  }
  function camel(role) {
    return kebab(role).replace(/-([a-z0-9])/g, function (_, c) {
      return c.toUpperCase();
    });
  }
  function snake(role) {
    return kebab(role).replace(/-/g, "_");
  }

  function toCss(colors) {
    var lines = colors.map(function (c) {
      return "  --color-" + kebab(c.role) + ": " + c.hex + ";";
    });
    return ":root {\n" + lines.join("\n") + "\n}\n";
  }

  function toScss(colors) {
    return (
      colors
        .map(function (c) {
          return "$color-" + kebab(c.role) + ": " + c.hex + ";";
        })
        .join("\n") + "\n"
    );
  }

  function toTailwind(colors) {
    var lines = colors.map(function (c) {
      return '        ' + camel(c.role) + ': "' + c.hex + '",';
    });
    return (
      "/** @type {import('tailwindcss').Config} */\n" +
      "module.exports = {\n" +
      "  theme: {\n" +
      "    extend: {\n" +
      "      colors: {\n" +
      lines.join("\n") +
      "\n      },\n" +
      "    },\n" +
      "  },\n" +
      "};\n"
    );
  }

  // W3C Design Tokens Community Group ("DTCG") color type — the same
  // $type/$value shape guide/color-palette-token-system.html#dtcg-color
  // already introduces, so this JSON export reads as an application of
  // that guide rather than a one-off shape invented just for this tool.
  function toDtcgJson(colors) {
    var obj = {};
    colors.forEach(function (c) {
      obj[kebab(c.role)] = { $type: "color", $value: c.hex };
    });
    return JSON.stringify(obj, null, 2) + "\n";
  }

  // Figma's Variables API represents a color value as {r,g,b,a} floats
  // in the 0-1 range (matching figma.variables.createVariable /
  // setValueForMode) — this mirrors that shape so it can be fed
  // directly to a plugin that imports variables that way, rather than
  // inventing a Figma-flavored format that isn't actually Figma's.
  function toFigmaVariables(colors, collectionName) {
    var variables = colors.map(function (c) {
      var rgb = BpozzColor.hexToRgb(c.hex);
      return {
        name: kebab(c.role),
        type: "COLOR",
        value: {
          r: Math.round((rgb.r / 255) * 1000) / 1000,
          g: Math.round((rgb.g / 255) * 1000) / 1000,
          b: Math.round((rgb.b / 255) * 1000) / 1000,
          a: 1,
        },
      };
    });
    return (
      JSON.stringify(
        {
          collection: collectionName || "Palette",
          modes: ["Default"],
          variables: variables,
        },
        null,
        2,
      ) + "\n"
    );
  }

  function toSwift(colors, paletteName) {
    var typeName = String(paletteName || "Palette")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map(function (w) {
        return w[0].toUpperCase() + w.slice(1);
      })
      .join("");
    var lines = colors.map(function (c) {
      var rgb = BpozzColor.hexToRgb(c.hex);
      var r = (rgb.r / 255).toFixed(3);
      var g = (rgb.g / 255).toFixed(3);
      var b = (rgb.b / 255).toFixed(3);
      return (
        "        static let " +
        camel(c.role) +
        " = Color(red: " +
        r +
        ", green: " +
        g +
        ", blue: " +
        b +
        ") // " +
        c.hex
      );
    });
    return (
      "import SwiftUI\n\n" +
      "extension Color {\n" +
      "    enum " +
      (typeName || "Palette") +
      " {\n" +
      lines.join("\n") +
      "\n    }\n" +
      "}\n"
    );
  }

  function toAndroidXml(colors) {
    var lines = colors.map(function (c) {
      return '    <color name="' + snake(c.role) + '">' + c.hex + "</color>";
    });
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      "<resources>\n" +
      lines.join("\n") +
      "\n</resources>\n"
    );
  }

  // One entry per export tab, in display order — both build-tokens.js
  // and the browser iterate this list rather than hardcoding tab names
  // in two places.
  var FORMATS = [
    { id: "css", label: "CSS", lang: "css", generate: toCss },
    { id: "scss", label: "SCSS", lang: "scss", generate: toScss },
    { id: "tailwind", label: "Tailwind", lang: "js", generate: toTailwind },
    { id: "json", label: "JSON", lang: "json", generate: toDtcgJson },
    {
      id: "figma",
      label: "Figma Variables",
      lang: "json",
      generate: toFigmaVariables,
    },
    { id: "ios", label: "iOS (Swift)", lang: "swift", generate: toSwift },
    { id: "android", label: "Android", lang: "xml", generate: toAndroidXml },
  ];

  return {
    FORMATS: FORMATS,
    toCss: toCss,
    toScss: toScss,
    toTailwind: toTailwind,
    toDtcgJson: toDtcgJson,
    toFigmaVariables: toFigmaVariables,
    toSwift: toSwift,
    toAndroidXml: toAndroidXml,
  };
});
