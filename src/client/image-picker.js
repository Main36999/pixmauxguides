/**
 * image-picker.js
 * -----------------------------------------------------------------------
 * Page-specific script for /image-picker — the Image Picker.
 *
 * Sibling of colors.js and palettes.js, not a fork of either: its own
 * standalone bundle (never added to /app.js), loaded after /app.js the same
 * way colors/colors.js and palettes/palettes.js are. It borrows two things
 * from colors.js on purpose because a visitor would notice if they behaved
 * differently — the WCAG contrast math for a swatch's HEX label, and the
 * Clipboard-API-with-execCommand-fallback copy pattern — transcribed rather
 * than imported, the same way colors.js explains its own copy of
 * escapeHtml(): this file has its own load contract and no shared module to
 * lean on without inventing an undeclared load-order dependency.
 *
 * UMD SHAPE (same idiom as src/shared/html.js): the pure extraction/export
 * logic below has no DOM dependency and is exported for `require()` from
 * src/client/image-picker.test.js. Everything that touches the DOM lives in
 * initBrowserUI(), called only when `document` exists, so requiring this
 * file under plain Node — no browser, no jsdom — never throws.
 *
 * WHAT HAPPENS, IN ORDER
 *   1. A user picks a local image file. It is read with URL.createObjectURL
 *      — never uploaded, never sent anywhere — and drawn into two canvases:
 *      #ip-canvas (visible, capped at a sane display resolution, used for
 *      both rendering and full-resolution manual sampling) and an offscreen
 *      "quant" canvas capped much smaller (<=80px on a side) purely for
 *      palette extraction. Extraction never touches the full-resolution
 *      pixel data.
 *   2. The quant canvas's pixels (with their fractional position in the
 *      image) are pulled once per image and kept in memory. A palette is
 *      then produced by median-cut quantization run against that small,
 *      fixed pool — never against the display canvas.
 *   3. Eight fixed "recipes" (see RECIPES) vary how median-cut splits
 *      buckets and which pixel represents each one. The variation slider
 *      selects a recipe index; a palette is computed once per (recipe,
 *      color count) pair and cached, so scrubbing the slider or the same
 *      count again is a cache read, not a recompute.
 *   4. Clicking/tapping the image moves the nearest sampling point to that
 *      spot and re-samples its color from the full-resolution canvas at
 *      that pixel — it never adds a new swatch, only replaces the color of
 *      whichever swatch's point is closest. That override is intentionally
 *      ephemeral: changing the color count or the variation slider throws
 *      it away and regenerates from the algorithm again.
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    factory(root);
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- tunables (pure) -------------------------------------------------
  var MAX_DISPLAY_DIM = 1400; // display + full-res manual sampling
  var MAX_QUANT_DIM = 80; // extraction pool — at most ~6400 pixels
  var MIN_COUNT = 3;
  var MAX_COUNT = 8;
  var DEFAULT_COUNT = 5;
  var DEDUPE_MIN_DISTANCE = 22; // RGB Euclidean distance

  /** Rejected before URL.createObjectURL/decode ever run — see
   * loadImageFile(). ~25MB: generous for a photo, small enough that a
   * mis-picked huge file fails fast instead of hanging the tab on decode. */
  var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  // ---- pure color helpers ----------------------------------------------

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function toHex(n) {
    var s = clamp(Math.round(n), 0, 255).toString(16).toUpperCase();
    return s.length === 1 ? "0" + s : s;
  }

  function rgbToHex(r, g, b) {
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  // ---- quantization (pure) ---------------------------------------------
  // A pixel while quantizing is [r, g, b, fx, fy] — color plus its
  // fractional position in the image (0..1 on each axis), so a chosen
  // bucket representative can still be turned into a sampling point on the
  // canvas. The array shape (rather than an object) keeps the hot loops
  // (median-cut runs on up to ~6400 of these) allocation-light.

  function quantPixelsFrom(qCanvas) {
    var w = qCanvas.width;
    var h = qCanvas.height;
    var data = qCanvas.getContext("2d").getImageData(0, 0, w, h).data;
    var pixels = [];
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip mostly-transparent pixels
      var p = (i / 4) | 0;
      var px = p % w;
      var py = (p / w) | 0;
      pixels.push([
        data[i],
        data[i + 1],
        data[i + 2],
        (px + 0.5) / w,
        (py + 0.5) / h,
      ]);
    }
    // A fully transparent image (rare, but possible with a PNG) would
    // otherwise produce an empty pool and a crash. One neutral gray pixel
    // keeps every downstream function's assumptions ("at least one pixel")
    // true without a special case at each call site.
    return pixels.length ? pixels : [[128, 128, 128, 0.5, 0.5]];
  }

  function channelRange(pixels, ch) {
    var min = 255;
    var max = 0;
    for (var i = 0; i < pixels.length; i++) {
      var v = pixels[i][ch];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min;
  }

  /** 'auto' picks the channel with the widest spread in this bucket; a
   * fixed channel biases every split toward separating that hue instead,
   * which is what gives two of the eight recipes their own character. */
  function pickSplitChannel(pixels, mode) {
    if (mode === "r") return 0;
    if (mode === "g") return 1;
    if (mode === "b") return 2;
    var ranges = [
      channelRange(pixels, 0),
      channelRange(pixels, 1),
      channelRange(pixels, 2),
    ];
    var best = 0;
    if (ranges[1] > ranges[best]) best = 1;
    if (ranges[2] > ranges[best]) best = 2;
    return best;
  }

  function splitBucket(bucket, ch) {
    bucket.sort(function (a, b) {
      return a[ch] - b[ch];
    });
    var mid = Math.floor(bucket.length / 2);
    return [bucket.slice(0, mid), bucket.slice(mid)];
  }

  /** Largest bucket by pixel count (min 2 to split). Works on ANY bucket
   * content, including one flat color, since it splits by position in the
   * sorted array, not by color spread. */
  function pickBucketByPopulation(buckets) {
    var bestPop = 1;
    var idx = -1;
    for (var i = 0; i < buckets.length; i++) {
      if (buckets[i].length > bestPop) {
        bestPop = buckets[i].length;
        idx = i;
      }
    }
    return idx;
  }

  /** Bucket with the widest color range on its split channel. Returns -1
   * when every eligible bucket has zero range — i.e. every bucket left is a
   * single flat color, which a range-based search has nothing left to act
   * on even though those buckets can still hold >=2 pixels apiece. */
  function pickBucketByRange(buckets, recipe) {
    var bestRange = 0;
    var idx = -1;
    for (var j = 0; j < buckets.length; j++) {
      if (buckets[j].length < 2) continue;
      var range = channelRange(
        buckets[j],
        pickSplitChannel(buckets[j], recipe.channel),
      );
      if (range > bestRange) {
        bestRange = range;
        idx = j;
      }
    }
    return idx;
  }

  /**
   * Classic median-cut: repeatedly split a bucket in half along one
   * channel until there are `count` buckets. `splitBy` picks which bucket
   * to split next (widest color range, or largest population); `channel`
   * optionally overrides which axis every split happens on. Runs against
   * the small quantized pool only — never the full image.
   *
   * FLAT / NEAR-MONOCHROME FALLBACK: a range-based recipe stalls once every
   * remaining bucket has zero color range (a uniform image, or one already
   * split down to same-color buckets) — there is nothing left for it to
   * pick by range even though those buckets are still poppable by size. In
   * that case only, fall back to population-based selection for this
   * split, so a flat/near-flat image still reaches the requested `count`
   * instead of stopping short of it. Population-based recipes never need
   * the fallback — they already split on size, not color spread.
   */
  function medianCutBuckets(pixels, count, recipe) {
    var buckets = [pixels];
    var guard = 0;
    var maxGuard = count * 4;
    while (buckets.length < count && guard < maxGuard) {
      guard++;
      var idx =
        recipe.splitBy === "population"
          ? pickBucketByPopulation(buckets)
          : pickBucketByRange(buckets, recipe);
      if (idx === -1 && recipe.splitBy !== "population") {
        idx = pickBucketByPopulation(buckets);
      }
      if (idx === -1 || buckets[idx].length < 2) break;
      var target = buckets[idx];
      var ch = pickSplitChannel(target, recipe.channel);
      var parts = splitBucket(target, ch);
      if (!parts[0].length || !parts[1].length) break;
      buckets.splice(idx, 1, parts[0], parts[1]);
    }
    return buckets;
  }

  function luminanceRgb(p) {
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  }

  function saturationOf(p) {
    var max = Math.max(p[0], p[1], p[2]);
    var min = Math.min(p[0], p[1], p[2]);
    return max === 0 ? 0 : (max - min) / max;
  }

  function averagePixel(bucket) {
    var r = 0,
      g = 0,
      b = 0,
      fx = 0,
      fy = 0;
    for (var i = 0; i < bucket.length; i++) {
      r += bucket[i][0];
      g += bucket[i][1];
      b += bucket[i][2];
      fx += bucket[i][3];
      fy += bucket[i][4];
    }
    var n = bucket.length;
    return [r / n, g / n, b / n, fx / n, fy / n];
  }

  /**
   * Picks the one pixel a bucket is represented by. "average" has no real
   * pixel at the exact mean, so it finds the bucket member closest to it —
   * every other mode already IS a real pixel (the most saturated / the
   * brightest / the darkest one in the bucket), chosen directly.
   */
  function representativePixel(bucket, mode) {
    if (mode === "vivid") {
      var bestV = bucket[0],
        bestSat = -1;
      for (var i = 0; i < bucket.length; i++) {
        var s = saturationOf(bucket[i]);
        if (s > bestSat) {
          bestSat = s;
          bestV = bucket[i];
        }
      }
      return bestV;
    }
    if (mode === "bright" || mode === "dark") {
      var bestB = bucket[0];
      var bestLum = luminanceRgb(bestB);
      for (var j = 1; j < bucket.length; j++) {
        var lum = luminanceRgb(bucket[j]);
        if (mode === "bright" ? lum > bestLum : lum < bestLum) {
          bestLum = lum;
          bestB = bucket[j];
        }
      }
      return bestB;
    }
    // "average" (default)
    var avg = averagePixel(bucket);
    var closest = bucket[0];
    var bestDist = Infinity;
    for (var k = 0; k < bucket.length; k++) {
      var dr = bucket[k][0] - avg[0];
      var dg = bucket[k][1] - avg[1];
      var db = bucket[k][2] - avg[2];
      var d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        closest = bucket[k];
      }
    }
    return closest;
  }

  function colorDistance(a, b) {
    var dr = a[0] - b[0];
    var dg = a[1] - b[1];
    var db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * Nudges near-duplicate colors apart (alternating lighter/darker) so a
   * flat, low-variety image doesn't hand back the same swatch twice. Not a
   * hard guarantee — see spec: "avoid... where practical" — just a cheap
   * pass over what is already a handful of colors.
   */
  function dedupeColors(points) {
    for (var i = 1; i < points.length; i++) {
      for (var j = 0; j < i; j++) {
        if (colorDistance(points[i].rgb, points[j].rgb) < DEDUPE_MIN_DISTANCE) {
          var factor = i % 2 === 0 ? 0.82 : 1.18;
          points[i].rgb = points[i].rgb.map(function (v) {
            return clamp(v * factor, 0, 255);
          });
          points[i].hex = rgbToHex(
            points[i].rgb[0],
            points[i].rgb[1],
            points[i].rgb[2],
          );
        }
      }
    }
    return points;
  }

  /**
   * Eight fixed, deterministic recipes. Same image + same recipe index
   * always produces the same palette, which is what makes the variation
   * slider cacheable: a slider position is a recipe choice, not a random
   * draw, so returning to a position never needs to recompute anything.
   */
  var RECIPES = [
    { splitBy: "range", channel: "auto", rep: "average" },
    { splitBy: "population", channel: "auto", rep: "average" },
    { splitBy: "range", channel: "auto", rep: "vivid" },
    { splitBy: "range", channel: "auto", rep: "bright" },
    { splitBy: "range", channel: "auto", rep: "dark" },
    { splitBy: "range", channel: "r", rep: "average" },
    { splitBy: "range", channel: "b", rep: "average" },
    { splitBy: "population", channel: "auto", rep: "vivid" },
  ];

  /** Builds one palette: `count` {hex, rgb, fx, fy} points from the quant
   * pixel pool, using the given recipe. */
  function buildPalette(pixels, count, recipe) {
    var buckets = medianCutBuckets(pixels, count, recipe);
    var points = buckets.map(function (bucket) {
      var p = representativePixel(bucket, recipe.rep);
      return { rgb: [p[0], p[1], p[2]], fx: p[3], fy: p[4] };
    });
    points = dedupeColors(
      points.map(function (pt) {
        return { rgb: pt.rgb, fx: pt.fx, fy: pt.fy };
      }),
    );
    return points.map(function (pt) {
      return {
        hex: rgbToHex(pt.rgb[0], pt.rgb[1], pt.rgb[2]),
        fx: pt.fx,
        fy: pt.fy,
      };
    });
  }

  // ---- export: palette -> text/file builders (pure) ---------------------
  // No DOM beyond what's passed in, so each one can be exercised in
  // isolation — see src/client/image-picker.test.js.

  function slugName(i) {
    return "image-picker-color-" + (i + 1);
  }

  function buildCssVariables(hexes) {
    return [":root {"]
      .concat(
        hexes.map(function (hex, i) {
          return "  --" + slugName(i) + ": " + hex + ";";
        }),
      )
      .concat(["}"])
      .join("\n");
  }

  /** "Code" tile: a plain JSON array of hex strings — the most common shape
   * a palette tool's "code" export takes, and it is also how this page
   * preserves the plain "copy HEX values" capability without adding a 13th
   * grid tile the requested 4x3 layout doesn't have room for. */
  function buildCodeSnippet(hexes) {
    return JSON.stringify(hexes, null, 2);
  }

  function buildTailwindSnippet(hexes) {
    return (
      "colors: {\n" +
      hexes
        .map(function (hex, i) {
          return "  '" + slugName(i) + "': '" + hex + "',";
        })
        .join("\n") +
      "\n}"
    );
  }

  function buildSvgMarkup(hexes) {
    var swatch = 64;
    var width = swatch * hexes.length;
    var rects = hexes
      .map(function (hex, i) {
        return (
          '<rect x="' + i * swatch + '" y="0" width="' + swatch +
          '" height="' + swatch + '" fill="' + hex + '"/>'
        );
      })
      .join("");
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
      '" height="' + swatch + '" viewBox="0 0 ' + width + " " + swatch + '">' +
      rects +
      "</svg>"
    );
  }

  function shareText(hexes) {
    return "Color palette: " + hexes.join(", ");
  }

  // ---- palette cache key (pure) -----------------------------------------

  function cacheKey(recipeIndex, count) {
    return recipeIndex + ":" + count;
  }

  // ---- pure API, exported for src/client/image-picker.test.js -----------

  var pureApi = {
    MIN_COUNT: MIN_COUNT,
    MAX_COUNT: MAX_COUNT,
    DEFAULT_COUNT: DEFAULT_COUNT,
    DEDUPE_MIN_DISTANCE: DEDUPE_MIN_DISTANCE,
    MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    RECIPES: RECIPES,
    clamp: clamp,
    rgbToHex: rgbToHex,
    hexToRgb: hexToRgb,
    quantPixelsFrom: quantPixelsFrom,
    medianCutBuckets: medianCutBuckets,
    colorDistance: colorDistance,
    dedupeColors: dedupeColors,
    buildPalette: buildPalette,
    slugName: slugName,
    buildCssVariables: buildCssVariables,
    buildCodeSnippet: buildCodeSnippet,
    buildTailwindSnippet: buildTailwindSnippet,
    buildSvgMarkup: buildSvgMarkup,
    shareText: shareText,
    cacheKey: cacheKey,
  };

  // ---- browser wiring (DOM/events — never runs under plain Node) --------

  function initBrowserUI() {
    var app = document.getElementById("image-picker-app");
    if (!app) return;

    var fileInput = document.getElementById("ip-file-input");
    var browseBtn = document.getElementById("ip-browse-btn");
    var canvas = document.getElementById("ip-canvas");
    var canvasFrame = document.getElementById("ip-canvas-frame");
    var canvasTip = document.getElementById("ip-canvas-tip");
    var pointsRoot = document.getElementById("ip-points");
    var swatchesRoot = document.getElementById("ip-swatches");
    var slider = document.getElementById("ip-variation-slider");
    var countValue = document.getElementById("ip-count-value");
    var countMinus = document.getElementById("ip-count-minus");
    var countPlus = document.getElementById("ip-count-plus");
    var exportToggle = document.getElementById("ip-export-toggle");
    var exportBackdrop = document.getElementById("ip-export-backdrop");
    var exportModal = document.getElementById("ip-export-modal");
    var exportClose = document.getElementById("ip-export-close");
    var exportGrid = document.getElementById("ip-export-grid");
    var statusRegion = document.getElementById("ip-status");

    var ctx = canvas.getContext("2d", { willReadFrequently: true });

    // ---- helpers --------------------------------------------------------

    function toast(message) {
      if (typeof window.bpozzShowToast === "function") {
        window.bpozzShowToast(message);
      }
    }

    // ---- contrast (ported from src/client/colors.js) --------------------
    // Same WCAG relative-luminance math, same "pick whichever of pure black
    // or pure white scores higher" rule — see colors.js for the derivation
    // of why that guarantees >=4.58:1 against any input color.
    function channel(v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function luminance(hex) {
      var rgb = hexToRgb(hex);
      return (
        0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
      );
    }
    function contrasts(hex) {
      var l = luminance(hex);
      return { onWhite: 1.05 / (l + 0.05), onBlack: (l + 0.05) / 0.05 };
    }
    function labelColorFor(hex) {
      var c = contrasts(hex);
      return c.onBlack >= c.onWhite ? "#000000" : "#FFFFFF";
    }
    function veilColorFor(hex) {
      var c = contrasts(hex);
      return c.onBlack >= c.onWhite ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.45)";
    }
    // NOTE: intentionally rgba(0,0,0,…) rather than colors.js's
    // rgba(15,42,82,…) — that triplet is #0F2A52 (--ink) decomposed to RGB,
    // and this page's UI is not allowed to use --ink or an equivalent
    // hardcoded navy anywhere, including inside an inline custom property.
    function ringColorFor(hex) {
      return contrasts(hex).onWhite < 1.25
        ? "rgba(0,0,0,0.18)"
        : "rgba(0,0,0,0.06)";
    }

    // ---- clipboard (ported from src/client/colors.js) --------------------
    function legacyCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    }

    function copyText(text, onOk, onFail) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onOk, function () {
          if (legacyCopy(text)) onOk();
          else onFail();
        });
      } else {
        if (legacyCopy(text)) onOk();
        else onFail();
      }
    }

    // ---- screen-reader announcements -------------------------------------
    var srTimer = null;
    function announce(message) {
      if (!statusRegion) return;
      if (srTimer) clearTimeout(srTimer);
      statusRegion.textContent = "";
      srTimer = setTimeout(function () {
        srTimer = null;
        statusRegion.textContent = message;
      }, 60);
    }

    // ---- per-swatch "Copied" state ----------------------------------------
    var COPIED_MS = 1400;
    var copiedSwatch = null;
    var copiedTimer = null;

    function clearCopiedState() {
      if (copiedTimer) {
        clearTimeout(copiedTimer);
        copiedTimer = null;
      }
      if (copiedSwatch) {
        copiedSwatch.removeAttribute("data-copied");
        copiedSwatch = null;
      }
    }

    function markCopied(swatch) {
      if (!swatch) return;
      clearCopiedState();
      copiedSwatch = swatch;
      swatch.setAttribute("data-copied", "true");
      copiedTimer = setTimeout(function () {
        copiedTimer = null;
        if (copiedSwatch) copiedSwatch.removeAttribute("data-copied");
        copiedSwatch = null;
      }, COPIED_MS);
    }

    // ---- state --------------------------------------------------------

    var quantPixels = null; // pixel pool for the current image, or null
    var paletteCache = {}; // "recipeIndex:count" -> palette array
    var currentPalette = []; // [{ hex, fx, fy }, ...] — the live, on-screen palette
    var currentCount = DEFAULT_COUNT;
    var currentRecipeIndex = 0;
    var hasImage = false;

    function paletteFor(recipeIndex, count) {
      var key = cacheKey(recipeIndex, count);
      if (!paletteCache[key]) {
        paletteCache[key] = buildPalette(
          quantPixels,
          count,
          RECIPES[recipeIndex % RECIPES.length],
        );
      }
      // Copy out of the cache so a manual sample (which mutates
      // currentPalette in place) never corrupts the cached algorithmic
      // result — switching the slider or count away and back must still
      // return the original.
      return paletteCache[key].map(function (p) {
        return { hex: p.hex, fx: p.fx, fy: p.fy };
      });
    }

    function applyPalette(recipeIndex, count, announceChange) {
      currentRecipeIndex = recipeIndex;
      currentCount = count;
      currentPalette = paletteFor(recipeIndex, count);
      // Reflects the ACTUAL rendered swatch count, not just the requested
      // one: medianCutBuckets() now reaches `count` for virtually every
      // real image (see its flat/near-monochrome fallback), but the
      // control must never claim more swatches than are on screen for the
      // rare pool too small to support the request (e.g. a near-solid
      // 1-2px quant pool).
      countValue.textContent = String(currentPalette.length);
      countMinus.disabled = !hasImage || count <= MIN_COUNT;
      countPlus.disabled = !hasImage || count >= MAX_COUNT;
      renderSwatches();
      renderPoints();
      if (announceChange) {
        announce(currentPalette.length + "-color palette updated.");
      }
    }

    // ---- rendering: swatches --------------------------------------------

    function swatchHtml(point, index) {
      var hex = point.hex;
      var label = "Copy " + hex + ", color " + (index + 1);
      return (
        '<li class="ip-swatch">' +
        '<button type="button" class="ip-swatch__plate" data-index="' +
        index +
        '" data-hex="' +
        hex +
        '" style="--ip-hex:' +
        hex +
        ";--ip-label:" +
        labelColorFor(hex) +
        ";--ip-veil:" +
        veilColorFor(hex) +
        ";--ip-ring:" +
        ringColorFor(hex) +
        '" aria-label="' +
        label +
        '">' +
        '<span class="ip-swatch__hex" aria-hidden="true">' +
        hex +
        "</span>" +
        '<span class="ip-swatch__copied" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>' +
        "Copied</span>" +
        "</button>" +
        "</li>"
      );
    }

    function renderSwatches() {
      clearCopiedState();
      if (!currentPalette.length) {
        swatchesRoot.innerHTML = "";
        return;
      }
      swatchesRoot.innerHTML = currentPalette.map(swatchHtml).join("");
    }

    // ---- rendering: sampling points on the image --------------------------

    function pointHtml(point, index) {
      return (
        '<span class="ip-point" data-index="' +
        index +
        '" style="left:' +
        (point.fx * 100).toFixed(3) +
        "%;top:" +
        (point.fy * 100).toFixed(3) +
        "%;--ip-point-hex:" +
        point.hex +
        '"></span>'
      );
    }

    function renderPoints() {
      if (!hasImage) {
        pointsRoot.innerHTML = "";
        return;
      }
      pointsRoot.innerHTML = currentPalette.map(pointHtml).join("");
    }

    // ---- copy: single swatch ------------------------------------------

    function copySwatch(hex, plate) {
      copyText(
        hex,
        function () {
          markCopied(plate);
          announce("Copied " + hex);
        },
        function () {
          toast("Couldn't copy — select and copy manually");
        },
      );
    }

    swatchesRoot.addEventListener("click", function (e) {
      var plate = e.target.closest(".ip-swatch__plate");
      if (!plate) return;
      copySwatch(plate.getAttribute("data-hex"), plate);
    });

    // ---- count controls -------------------------------------------------

    countMinus.addEventListener("click", function () {
      if (!hasImage || currentCount <= MIN_COUNT) return;
      applyPalette(currentRecipeIndex, currentCount - 1, true);
    });
    countPlus.addEventListener("click", function () {
      if (!hasImage || currentCount >= MAX_COUNT) return;
      applyPalette(currentRecipeIndex, currentCount + 1, true);
    });

    // ---- variation slider -------------------------------------------------

    slider.addEventListener("input", function () {
      if (!hasImage) return;
      applyPalette(Number(slider.value), currentCount, true);
    });

    // ---- image loading ----------------------------------------------------

    function scaledSize(width, height, maxDim) {
      if (width <= maxDim && height <= maxDim) {
        return { width: width, height: height };
      }
      var scale = maxDim / Math.max(width, height);
      return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      };
    }

    function setupCanvases(img) {
      var display = scaledSize(
        img.naturalWidth,
        img.naturalHeight,
        MAX_DISPLAY_DIM,
      );
      canvas.width = display.width;
      canvas.height = display.height;
      ctx.drawImage(img, 0, 0, display.width, display.height);

      var quant = scaledSize(img.naturalWidth, img.naturalHeight, MAX_QUANT_DIM);
      var quantCanvas = document.createElement("canvas");
      quantCanvas.width = quant.width;
      quantCanvas.height = quant.height;
      quantCanvas.getContext("2d").drawImage(img, 0, 0, quant.width, quant.height);
      return quantCanvas;
    }

    function onImageReady(img) {
      var quantCanvas = setupCanvases(img);
      quantPixels = quantPixelsFrom(quantCanvas);
      paletteCache = {};
      hasImage = true;

      canvas.hidden = false;
      canvasTip.hidden = false;
      slider.disabled = false;
      slider.value = "0";
      exportToggle.disabled = false;

      applyPalette(0, currentCount, false);
      announce("Image loaded. Generated a " + currentCount + "-color palette.");
    }

    function loadImageFile(file) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        onImageReady(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        toast("Couldn't load that image — try a different file.");
      };
      img.src = url;
    }

    /**
     * The standby photo (image-picker/assets/standby.jpg): a local, static
     * file, loaded exactly like any other same-origin <img>, then handed to
     * the SAME onImageReady() a browsed file goes through — no second
     * extraction path. There is nothing to revoke (no object URL was
     * created), so this is a smaller wrapper than loadImageFile(), not a
     * parallel implementation of it.
     */
    var STANDBY_IMAGE_SRC = "/image-picker/assets/standby.jpg";

    function loadStandbyImage() {
      var img = new Image();
      img.onload = function () {
        onImageReady(img);
      };
      img.onerror = function () {
        // Rare (a bad deploy, a blocked request) — the workspace simply
        // stays on its initial hidden-canvas state; Browse image still
        // works normally from here.
        toast("Couldn't load the standby image — browse your own to get started.");
      };
      img.src = STANDBY_IMAGE_SRC;
    }

    browseBtn.addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = ""; // allow re-picking the same file next time
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        toast("Please choose a JPG, PNG, or WebP image.");
        return;
      }
      // Rejected before URL.createObjectURL/decode ever run — nothing is
      // created here, so there is nothing to revoke on this path.
      if (file.size > MAX_UPLOAD_BYTES) {
        toast("That image is too large (max 25MB) — try a smaller file.");
        return;
      }
      loadImageFile(file);
    });

    // ---- manual sampling ----------------------------------------------

    function nearestPointIndex(fx, fy, rect) {
      var bestIdx = 0;
      var bestDist = Infinity;
      for (var i = 0; i < currentPalette.length; i++) {
        var p = currentPalette[i];
        var dx = (p.fx - fx) * rect.width;
        var dy = (p.fy - fy) * rect.height;
        var d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    function sampleAt(fx, fy) {
      var x = clamp(Math.floor(fx * canvas.width), 0, canvas.width - 1);
      var y = clamp(Math.floor(fy * canvas.height), 0, canvas.height - 1);
      var data = ctx.getImageData(x, y, 1, 1).data;
      return rgbToHex(data[0], data[1], data[2]);
    }

    function handleCanvasSample(clientX, clientY) {
      if (!hasImage || !currentPalette.length) return;
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var fx = clamp((clientX - rect.left) / rect.width, 0, 1);
      var fy = clamp((clientY - rect.top) / rect.height, 0, 1);
      var idx = nearestPointIndex(fx, fy, rect);
      var hex = sampleAt(fx, fy);
      currentPalette[idx] = { hex: hex, fx: fx, fy: fy };
      renderSwatches();
      renderPoints();
      announce("Sampled " + hex + " for color " + (idx + 1) + ".");
    }

    canvas.addEventListener("click", function (e) {
      handleCanvasSample(e.clientX, e.clientY);
    });

    // ---- export: current palette -> hex list -------------------------------

    function paletteHexList() {
      return currentPalette.map(function (p) {
        return p.hex;
      });
    }

    /** Renders the current palette to an offscreen canvas and triggers a PNG
     * download — entirely client-side (canvas.toDataURL), no server, no
     * dependency. */
    function downloadPaletteImage(hexes) {
      var swatch = 240;
      var out = document.createElement("canvas");
      out.width = swatch * hexes.length;
      out.height = swatch;
      var octx = out.getContext("2d");
      hexes.forEach(function (hex, i) {
        octx.fillStyle = hex;
        octx.fillRect(i * swatch, 0, swatch, swatch);
      });
      var link = document.createElement("a");
      link.download = "image-picker-palette.png";
      link.href = out.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    // ---- export: the 12-tile action dispatch -------------------------------
    // Real, client-side actions where one is genuinely possible without a
    // backend or an external processing service: CSS, Code, Tailwind, SVG and
    // Image are all pure text/canvas generation. Share uses the standard Web
    // Share API where the browser supports it. X and Pinterest use the same
    // public share-intent URLs any "share on X/Pinterest" button on the web
    // uses — a plain link to the platform's own share page, carrying only the
    // palette's hex text, never the user's image.
    //
    // URL, PDF, ASE and Embed are left as honest placeholders rather than
    // faked: a "URL" or "Embed" implies a persisted, shareable link, which
    // needs a backend this static site does not have; PDF and ASE are binary
    // formats that would need a hand-rolled writer with no clear payoff yet.
    // The tiles stay visible (dimmed, not hidden) so the grid still reads as
    // the full 4x3 layout, and clicking one says plainly that it isn't wired
    // up rather than doing nothing or silently failing.
    var COMING_SOON = {
      url: "Shareable palette links are coming soon.",
      pdf: "PDF export is coming soon.",
      ase: "ASE export is coming soon.",
      embed: "Embeddable palette widgets are coming soon.",
    };

    function copyAndToast(text, successMessage) {
      copyText(
        text,
        function () {
          toast(successMessage);
        },
        function () {
          toast("Couldn't copy — select and copy manually");
        },
      );
    }

    function runExport(kind) {
      var hexes = paletteHexList();
      if (!hexes.length) return;

      if (COMING_SOON[kind]) {
        toast(COMING_SOON[kind]);
        return;
      }

      switch (kind) {
        case "css":
          copyAndToast(buildCssVariables(hexes), "Copied palette as CSS variables");
          return;
        case "code":
          copyAndToast(buildCodeSnippet(hexes), "Copied palette as code");
          return;
        case "tailwind":
          copyAndToast(buildTailwindSnippet(hexes), "Copied Tailwind color config");
          return;
        case "svg":
          copyAndToast(buildSvgMarkup(hexes), "Copied palette as SVG");
          return;
        case "image":
          downloadPaletteImage(hexes);
          toast("Downloaded palette image");
          return;
        case "share":
          if (navigator.share) {
            navigator.share({ text: shareText(hexes) }).catch(function () {
              // User cancelled the native share sheet — not an error.
            });
          } else {
            toast("Sharing isn't supported in this browser — try Copy CSS or Code instead.");
          }
          return;
        case "x":
          window.open(
            "https://twitter.com/intent/tweet?text=" +
              encodeURIComponent(shareText(hexes)),
            "_blank",
            "noopener,noreferrer",
          );
          return;
        case "pinterest":
          window.open(
            "https://www.pinterest.com/pin/create/button/?description=" +
              encodeURIComponent(shareText(hexes)) +
              "&url=" +
              encodeURIComponent("https://bpozz.com/image-picker"),
            "_blank",
            "noopener,noreferrer",
          );
          return;
        default:
          return;
      }
    }

    // ---- export: modal dialog (open/close, focus trap, Escape) -------------

    var exportLastFocused = null;

    function exportFocusables() {
      return Array.prototype.slice.call(
        exportModal.querySelectorAll(".ip-modal__close, .ip-modal__item"),
      );
    }

    function openExportModal() {
      if (exportToggle.disabled) return;
      exportLastFocused = document.activeElement;
      exportBackdrop.hidden = false;
      exportClose.focus();
    }

    function closeExportModal() {
      if (exportBackdrop.hidden) return;
      exportBackdrop.hidden = true;
      if (exportLastFocused && typeof exportLastFocused.focus === "function") {
        exportLastFocused.focus();
      } else {
        exportToggle.focus();
      }
    }

    exportToggle.addEventListener("click", openExportModal);
    exportClose.addEventListener("click", closeExportModal);

    // Backdrop click closes; a click on the modal card itself must not (it
    // would otherwise bubble to the same listener since the card is inside
    // the backdrop).
    exportBackdrop.addEventListener("click", function (e) {
      if (e.target === exportBackdrop) closeExportModal();
    });

    exportGrid.addEventListener("click", function (e) {
      var item = e.target.closest(".ip-modal__item");
      if (!item) return;
      runExport(item.getAttribute("data-export"));
      closeExportModal();
    });

    document.addEventListener("keydown", function (e) {
      if (exportBackdrop.hidden) return;
      if (e.key === "Escape") {
        closeExportModal();
        return;
      }
      // A minimal focus trap: Tab past either end wraps to the other end,
      // instead of escaping into the page behind the modal.
      if (e.key === "Tab") {
        var focusables = exportFocusables();
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Mark the placeholder tiles once, from the same COMING_SOON map runExport
    // reads — one source of truth for "which tiles are wired up".
    Object.keys(COMING_SOON).forEach(function (kind) {
      var item = exportGrid.querySelector('[data-export="' + kind + '"]');
      if (item) item.setAttribute("data-coming-soon", "true");
    });

    // ---- initial state ----------------------------------------------------
    countValue.textContent = String(currentCount);
    loadStandbyImage();
  }

  if (typeof document !== "undefined") {
    initBrowserUI();
  }

  return pureApi;
});
