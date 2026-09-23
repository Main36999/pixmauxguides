/**
 * src/client/home.js — the homepage palette workspace.
 *
 * Published as /home.js beside index.html, the same shape colors.js and
 * image-picker.js use: page-specific code that only the homepage runs, so it
 * is not added to /app.js.
 *
 * TWO LAYERS, ONE FILE
 *
 *   1. Pure color math (hex/RGB/HSL conversion, WCAG contrast, harmony
 *      targets, nearest-library-color matching, palette generation). No DOM.
 *      Wrapped in the same UMD shape image-picker.js uses, so:
 *        - src/build/home.js requires it to pre-render the first palette's
 *          RGB / HSL / contrast values into the static HTML, and
 *        - src/client/home.test.js requires it to test the math directly.
 *      Under Node `document` is undefined and the UI layer never runs.
 *
 *   2. Progressive enhancement of #palette-stage. The build writes five
 *      complete, readable color columns; this layer un-hides the controls
 *      marked [data-enhanced], then keeps each column's text in sync as the
 *      palette changes. It never builds column markup itself — the structure
 *      has exactly one author, src/build/home.js.
 *
 * GENERATION
 *
 * Every generated color is a real, named entry from /colors/colors-data.json
 * (fetched on the first Generate). A harmony mode picks target hues around an
 * anchor — the first locked color with a real hue (a locked neutral stays
 * locked but does not anchor), or a random saturated library color — and
 * a dark-to-light lightness ladder; each unlocked slot takes one of the
 * nearest unused library colors to its target. If the library cannot be
 * fetched, targets are used directly as unnamed colors so Generate still
 * works offline.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    factory().initBrowserUI(root);
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HEX_RE = /^#?([0-9a-f]{6})$/i;

  // ---- conversion -------------------------------------------------------

  function normalizeHex(hex) {
    var m = HEX_RE.exec(String(hex).trim());
    if (!m) throw new Error("invalid hex color: " + JSON.stringify(hex));
    return "#" + m[1].toUpperCase();
  }

  function hexToRgb(hex) {
    var n = parseInt(normalizeHex(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map(function (v) {
          var c = Math.max(0, Math.min(255, Math.round(v)));
          return (c < 16 ? "0" : "") + c.toString(16);
        })
        .join("")
        .toUpperCase()
    );
  }

  /** [r,g,b] 0–255 → [h 0–360, s 0–1, l 0–1]. */
  function rgbToHsl(rgb) {
    var r = rgb[0] / 255;
    var g = rgb[1] / 255;
    var b = rgb[2] / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var d = max - min;
    if (d === 0) return [0, 0, l];
    var s = d / (1 - Math.abs(2 * l - 1));
    var h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return [h, s, l];
  }

  function hslToRgb(hsl) {
    var h = (((hsl[0] % 360) + 360) % 360) / 60;
    var s = clamp01(hsl[1]);
    var l = clamp01(hsl[2]);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h % 2) - 1));
    var m = l - c / 2;
    var rgb =
      h < 1 ? [c, x, 0]
      : h < 2 ? [x, c, 0]
      : h < 3 ? [0, c, x]
      : h < 4 ? [0, x, c]
      : h < 5 ? [x, 0, c]
      : [c, 0, x];
    return rgb.map(function (v) {
      return Math.round((v + m) * 255);
    });
  }

  function hexToHsl(hex) {
    return rgbToHsl(hexToRgb(hex));
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  // ---- contrast ---------------------------------------------------------

  /** WCAG 2.x relative luminance. */
  function luminance(hex) {
    var lin = hexToRgb(hex).map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrastRatio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** The two text colors a swatch is read against: the site's own ink and white. */
  var INK_DARK = "#101010";
  var INK_LIGHT = "#FFFFFF";

  /**
   * Which of the two text colors reads better on `hex`, and by how much.
   * Returns { ink, label, ratio } — label is "White" or "Black".
   */
  function bestInk(hex) {
    var onLight = contrastRatio(hex, INK_LIGHT);
    var onDark = contrastRatio(hex, INK_DARK);
    return onLight >= onDark
      ? { ink: INK_LIGHT, label: "White", ratio: onLight }
      : { ink: INK_DARK, label: "Black", ratio: onDark };
  }

  /** The WCAG level a ratio passes for normal-size text. */
  function contrastGrade(ratio) {
    if (ratio >= 7) return "AAA";
    if (ratio >= 4.5) return "AA";
    if (ratio >= 3) return "AA Large";
    return "Fail";
  }

  // ---- display strings --------------------------------------------------

  function formatRgb(hex) {
    return hexToRgb(hex).join(" ");
  }

  function formatHsl(hex) {
    var hsl = hexToHsl(hex);
    return (
      Math.round(hsl[0]) +
      "° " +
      Math.round(hsl[1] * 100) +
      "% " +
      Math.round(hsl[2] * 100) +
      "%"
    );
  }

  function formatContrast(hex) {
    var best = bestInk(hex);
    return best.label + " " + best.ratio.toFixed(1) + ":1 " + contrastGrade(best.ratio);
  }

  /**
   * Everything one color column displays, derived from its hex. Shared by the
   * build (first render) and the browser (every re-render), so both always
   * write the same strings.
   */
  function describe(hex, name) {
    var h = normalizeHex(hex);
    return {
      hex: h,
      name: name || "",
      rgb: formatRgb(h),
      hsl: formatHsl(h),
      contrast: formatContrast(h),
      ink: bestInk(h).ink,
    };
  }

  // ---- generation -------------------------------------------------------

  /**
   * Hue offsets per slot, relative to the palette's base hue. Slots read
   * dark → light (see LIGHTNESS), so each mode's accent hues land in the
   * mid-tones where hue is most visible.
   */
  var MODES = {
    analogous: { label: "Analogous", hues: [-30, -15, 0, 15, 30] },
    monochrome: { label: "Monochrome", hues: [0, 0, 0, 0, 0] },
    complementary: { label: "Complementary", hues: [0, 0, 180, 180, 0] },
    triadic: { label: "Triadic", hues: [0, 120, 0, 240, 0] },
    split: { label: "Split complementary", hues: [0, 150, 0, 210, 0] },
  };
  var MODE_KEYS = Object.keys(MODES);

  /** A dark-to-light ladder, so every palette carries a usable text and surface color. */
  var LIGHTNESS = [0.14, 0.34, 0.52, 0.72, 0.92];
  /** Ends of the ladder are quieter; the middle carries the color. */
  var SATURATION = [0.45, 0.85, 1, 0.75, 0.4];

  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /**
   * Perceptual-enough distance between two HSL triples. Hue only counts in
   * proportion to how saturated both colors are — the hue of a near-gray is
   * noise.
   */
  function hslDistance(a, b) {
    var hueWeight = Math.min(a[1], b[1]);
    var dh = (hueDistance(a[0], b[0]) / 180) * hueWeight;
    var ds = a[1] - b[1];
    var dl = a[2] - b[2];
    return dh * dh * 4 + ds * ds * 0.6 + dl * dl * 3;
  }

  /**
   * The target HSL for every slot. `anchor` is { index, hsl }: the base hue is
   * chosen so the anchor's own slot targets the anchor's hue exactly.
   */
  function harmonyTargets(anchor, mode, random) {
    var spec = MODES[mode];
    if (!spec) throw new Error("unknown harmony mode: " + mode);
    var rand = random || Math.random;
    var base = anchor.hsl[0] - spec.hues[anchor.index];
    var sat = Math.max(0.25, anchor.hsl[1]);
    return spec.hues.map(function (offset, i) {
      return [
        (base + offset + (rand() - 0.5) * 16 + 360) % 360,
        clamp01(sat * SATURATION[i] + (rand() - 0.5) * 0.1),
        clamp01(LIGHTNESS[i] + (rand() - 0.5) * 0.08),
      ];
    });
  }

  /** Library entries with their HSL precomputed: [{ name, hex, hsl }]. */
  function prepareLibrary(records) {
    return (records || [])
      .filter(function (r) {
        return r && typeof r.hex === "string" && HEX_RE.test(r.hex);
      })
      .map(function (r) {
        var hex = normalizeHex(r.hex);
        return { name: String(r.name || ""), hex: hex, hsl: hexToHsl(hex) };
      });
  }

  /**
   * One of the `spread` nearest unused library colors to `target`. Picking
   * among a few near neighbours instead of always the single nearest keeps
   * repeated Generates from converging on the same five colors.
   */
  function nearestColor(library, target, used, random, spread) {
    var rand = random || Math.random;
    var ranked = library
      .filter(function (c) {
        return !used.has(c.hex);
      })
      .map(function (c) {
        return { c: c, d: hslDistance(c.hsl, target) };
      })
      .sort(function (a, b) {
        return a.d - b.d;
      });
    if (!ranked.length) return null;
    var pool = Math.min(ranked.length, spread || 3);
    return ranked[Math.floor(rand() * pool)].c;
  }

  /** Below this saturation a color's hue is noise, so it cannot anchor a harmony. */
  var MIN_ANCHOR_SATURATION = 0.15;

  /**
   * The color the harmony is built around: the first locked color that has
   * a meaningful hue. A locked neutral (a near-black ink, a paper white)
   * stays locked but does not anchor — its hue is arbitrary, and anchoring
   * on it would drag every palette toward mud.
   */
  function pickAnchor(slots, library, random) {
    var rand = random || Math.random;
    for (var i = 0; i < slots.length; i++) {
      if (!slots[i].locked) continue;
      var hsl = hexToHsl(slots[i].hex);
      if (hsl[1] >= MIN_ANCHOR_SATURATION) return { index: i, hsl: hsl };
    }
    var vivid = library.filter(function (c) {
      return c.hsl[1] >= 0.3 && c.hsl[2] >= 0.3 && c.hsl[2] <= 0.7;
    });
    var source = vivid.length ? vivid : library;
    if (source.length) {
      var pick = source[Math.floor(rand() * source.length)];
      return { index: 2, hsl: pick.hsl };
    }
    return { index: 2, hsl: [rand() * 360, 0.6 + rand() * 0.3, 0.5] };
  }

  /**
   * A new palette. `slots` is [{ hex, name, locked }]; locked slots are
   * returned untouched. Returns { mode, slots }.
   *
   * options.mode    force a harmony mode (default: random)
   * options.random  a () => [0,1) source, for deterministic tests
   */
  function generatePalette(slots, libraryRecords, options) {
    var opts = options || {};
    var rand = opts.random || Math.random;
    var library = Array.isArray(libraryRecords) && libraryRecords.length && libraryRecords[0].hsl
      ? libraryRecords
      : prepareLibrary(libraryRecords);
    var mode = opts.mode || MODE_KEYS[Math.floor(rand() * MODE_KEYS.length)];
    var anchor = pickAnchor(slots, library, rand);
    var targets = harmonyTargets(anchor, mode, rand);

    var used = new Set(
      slots
        .filter(function (s) {
          return s.locked;
        })
        .map(function (s) {
          return normalizeHex(s.hex);
        }),
    );

    var next = slots.map(function (slot, i) {
      if (slot.locked) return { hex: normalizeHex(slot.hex), name: slot.name, locked: true };
      var match = library.length ? nearestColor(library, targets[i], used, rand) : null;
      var hex = match ? match.hex : rgbToHex(hslToRgb(targets[i]));
      used.add(hex);
      return { hex: hex, name: match ? match.name : "", locked: false };
    });

    return { mode: mode, slots: next };
  }

  /**
   * A variation of one color: a near neighbour in the library (same hue
   * family, shifted lightness or saturation), never the color itself or any
   * other color already in the palette.
   */
  function varyColor(hex, paletteHexes, libraryRecords, random) {
    var rand = random || Math.random;
    var library = Array.isArray(libraryRecords) && libraryRecords.length && libraryRecords[0].hsl
      ? libraryRecords
      : prepareLibrary(libraryRecords);
    var hsl = hexToHsl(hex);
    var shift = (rand() < 0.5 ? -1 : 1) * (0.08 + rand() * 0.1);
    var target = [hsl[0], hsl[1], clamp01(hsl[2] + shift)];
    var used = new Set(paletteHexes.map(normalizeHex));
    used.add(normalizeHex(hex));
    var match = library.length ? nearestColor(library, target, used, rand, 2) : null;
    return match
      ? { hex: match.hex, name: match.name }
      : { hex: rgbToHex(hslToRgb(target)), name: "" };
  }

  // ---- browser UI -------------------------------------------------------

  function initBrowserUI(win) {
    if (typeof document === "undefined") return;
    var stage = document.getElementById("palette-stage");
    if (!stage) return;

    var columns = Array.prototype.slice.call(
      stage.querySelectorAll(".palette-color"),
    );
    var modeEl = stage.querySelector("[data-palette-mode]");
    var statusEl = document.getElementById("palette-status");
    var LIBRARY_URL = stage.getAttribute("data-library") || "/colors/colors-data.json";

    // The seed palette's token labels (e.g. "--action"): a column shows its
    // token only while it still holds the seed color the token names.
    var seeds = columns.map(function (col) {
      return {
        hex: col.getAttribute("data-hex"),
        token: col.getAttribute("data-token") || "",
      };
    });

    var slots = columns.map(function (col) {
      return {
        hex: col.getAttribute("data-hex"),
        name: col.getAttribute("data-name") || "",
        locked: false,
      };
    });

    var libraryPromise = null;
    function loadLibrary() {
      if (!libraryPromise) {
        libraryPromise = fetch(LIBRARY_URL)
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
          })
          .then(prepareLibrary)
          .catch(function () {
            libraryPromise = null; // retry on the next Generate
            return [];
          });
      }
      return libraryPromise;
    }

    function setField(col, field, value) {
      var el = col.querySelector('[data-field="' + field + '"]');
      if (el) el.textContent = value;
    }

    function renderSlot(i) {
      var col = columns[i];
      var slot = slots[i];
      var d = describe(slot.hex, slot.name);
      var label = d.name || "Custom color";
      col.setAttribute("data-hex", d.hex);
      col.setAttribute("data-name", d.name);
      col.style.setProperty("--swatch", d.hex);
      col.style.setProperty("--ink", d.ink);
      col.classList.toggle("is-locked", slot.locked);
      setField(col, "name", label);
      setField(col, "hex", d.hex);
      setField(col, "rgb", d.rgb);
      setField(col, "hsl", d.hsl);
      setField(col, "contrast", d.contrast);
      setField(col, "token", d.hex === seeds[i].hex ? seeds[i].token : "");

      var n = i + 1;
      var copy = col.querySelector('[data-action="copy"]');
      if (copy) copy.setAttribute("aria-label", "Copy " + d.hex + ", " + label);
      var lock = col.querySelector('[data-action="lock"]');
      if (lock) {
        lock.setAttribute("aria-pressed", String(slot.locked));
        lock.setAttribute(
          "aria-label",
          (slot.locked ? "Unlock" : "Lock") + " color " + n + ", " + d.hex,
        );
        lock.setAttribute("title", slot.locked ? "Unlock" : "Lock");
      }
      var vary = col.querySelector('[data-action="vary"]');
      if (vary) {
        vary.setAttribute("aria-label", "Vary color " + n + ", " + d.hex);
        vary.disabled = slot.locked;
      }
    }

    function announce(message) {
      if (statusEl) statusEl.textContent = message;
    }

    function toast(message) {
      if (typeof win.bpozzShowToast === "function") win.bpozzShowToast(message);
      else announce(message);
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(function () {
          return legacyCopy(text);
        });
      }
      return legacyCopy(text);
    }

    function legacyCopy(text) {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (e) {
          ok = false;
        }
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error("copy failed"));
      });
    }

    function copy(text, label) {
      copyText(text).then(
        function () {
          toast("Copied " + label);
        },
        function () {
          toast("Couldn't copy — select the value instead");
        },
      );
    }

    var generating = false;
    function generate() {
      if (generating) return;
      if (slots.every(function (s) { return s.locked; })) {
        toast("Unlock a color to generate");
        return;
      }
      generating = true;
      stage.setAttribute("aria-busy", "true");
      loadLibrary().then(function (library) {
        var result = generatePalette(slots, library);
        slots = result.slots;
        slots.forEach(function (_, i) {
          renderSlot(i);
        });
        var label = MODES[result.mode].label;
        if (modeEl) modeEl.textContent = label;
        announce(
          label +
            " palette: " +
            slots
              .map(function (s) {
                return (s.name ? s.name + " " : "") + s.hex;
              })
              .join(", "),
        );
        stage.removeAttribute("aria-busy");
        generating = false;
      });
    }

    function vary(i) {
      if (slots[i].locked) return;
      loadLibrary().then(function (library) {
        var others = slots.map(function (s) {
          return s.hex;
        });
        var next = varyColor(slots[i].hex, others, library);
        slots[i] = { hex: next.hex, name: next.name, locked: false };
        renderSlot(i);
        if (modeEl) modeEl.textContent = "Custom";
        announce("Color " + (i + 1) + " is now " + (next.name ? next.name + " " : "") + next.hex);
      });
    }

    // Reveal the controls that only work with JavaScript.
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-enhanced]"),
      function (el) {
        el.hidden = false;
      },
    );
    stage.classList.add("is-interactive");
    columns.forEach(function (_, i) {
      renderSlot(i);
    });

    stage.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      if (!button || !stage.contains(button)) return;
      var action = button.getAttribute("data-action");
      var col = button.closest(".palette-color");
      var i = col ? columns.indexOf(col) : -1;

      if (action === "generate") generate();
      else if (action === "copy-all") {
        copy(
          slots
            .map(function (s) {
              return s.hex;
            })
            .join(" "),
          "palette",
        );
      } else if (action === "copy" && i > -1) copy(slots[i].hex, slots[i].hex);
      else if (action === "lock" && i > -1) {
        slots[i].locked = !slots[i].locked;
        renderSlot(i);
        announce("Color " + (i + 1) + (slots[i].locked ? " locked" : " unlocked"));
      } else if (action === "vary" && i > -1) vary(i);
    });

    // Space generates, as long as focus isn't on something Space already
    // means something to (a button, link, field or the search box).
    document.addEventListener("keydown", function (event) {
      if (event.key !== " " && event.code !== "Space") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      var t = event.target;
      if (t && t !== document.body && t !== stage) return;
      var rect = stage.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > (win.innerHeight || 0)) return;
      event.preventDefault();
      generate();
    });

    // Warm the library once the page is idle, so the first Generate is instant.
    var warm = win.requestIdleCallback || function (fn) { return setTimeout(fn, 1200); };
    warm(loadLibrary);
  }

  return {
    normalizeHex: normalizeHex,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    hexToHsl: hexToHsl,
    luminance: luminance,
    contrastRatio: contrastRatio,
    bestInk: bestInk,
    contrastGrade: contrastGrade,
    formatRgb: formatRgb,
    formatHsl: formatHsl,
    formatContrast: formatContrast,
    describe: describe,
    MODES: MODES,
    harmonyTargets: harmonyTargets,
    hueDistance: hueDistance,
    prepareLibrary: prepareLibrary,
    nearestColor: nearestColor,
    pickAnchor: pickAnchor,
    generatePalette: generatePalette,
    varyColor: varyColor,
    initBrowserUI: initBrowserUI,
  };
});
