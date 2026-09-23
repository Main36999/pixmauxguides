/**
 * color-math.js — the colour arithmetic shared by the palette tools.
 *
 * sRGB hex <-> OKLab / OKLCH (Björn Ottosson's matrices) plus an
 * order-independent palette distance. Dependency-free on purpose: the
 * site has no bundler and the QA scripts run on bare Node.
 *
 * Distances are Euclidean in OKLab scaled by 100, so one unit is roughly
 * one just-noticeable step (ΔEok ≈ 1–2 is hard to tell apart side by side).
 */

"use strict";

const HEX_RE = /^#[0-9A-F]{6}$/;

/** Uppercase, trim, expand #RGB to #RRGGBB. Returns null if not a hex. */
function normalizeHex(value) {
  if (typeof value !== "string") return null;
  let h = value.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(h)) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return HEX_RE.test(h) ? h : null;
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLCH -> linear sRGB triple (may be out of [0,1] when out of gamut). */
function oklchToLinearRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb) {
  return rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
}

/**
 * OKLCH -> hex. Out-of-gamut colours keep their lightness and hue and lose
 * chroma (binary search) until they fit — the standard CSS Color 4 approach,
 * so a "vivid" recipe never turns into a clipped, hue-shifted colour.
 */
function oklchToHex(L, C, h) {
  L = Math.min(1, Math.max(0, L));
  let rgb = oklchToLinearRgb(L, C, h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb(L, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinearRgb(L, lo, h);
  }
  return (
    "#" +
    rgb
      .map((c) => {
        const v = Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, c))))) * 255);
        return v.toString(16).padStart(2, "0");
      })
      .join("")
      .toUpperCase()
  );
}

function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

/** ΔE in OKLab, ×100. */
function deltaE(labA, labB) {
  return (
    100 *
    Math.sqrt(
      (labA[0] - labB[0]) ** 2 + (labA[1] - labB[1]) ** 2 + (labA[2] - labB[2]) ** 2,
    )
  );
}

const PERMS = (function permute(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => {
    permute(arr.slice(0, i).concat(arr.slice(i + 1))).forEach((p) => out.push([x].concat(p)));
  });
  return out;
})([0, 1, 2, 3]);

/**
 * Order-independent palette distance: the mean ΔE of the best one-to-one
 * pairing of the two palettes' colours. Two palettes holding the same four
 * colours in any order score 0. Takes arrays of OKLab triples.
 */
function paletteDistance(a, b) {
  if (a.length !== b.length) return Infinity;
  const perms = a.length === 4 ? PERMS : null;
  if (!perms) {
    // Greedy fallback for sizes other than 4 (not used by the site today).
    let total = 0;
    const used = new Set();
    a.forEach((ca) => {
      let best = Infinity;
      let bi = -1;
      b.forEach((cb, j) => {
        if (used.has(j)) return;
        const d = deltaE(ca, cb);
        if (d < best) (best = d), (bi = j);
      });
      used.add(bi);
      total += best;
    });
    return total / a.length;
  }
  let best = Infinity;
  for (const p of perms) {
    let t = 0;
    for (let i = 0; i < 4; i++) t += deltaE(a[i], b[p[i]]);
    if (t < best) best = t;
  }
  return best / 4;
}

/** Canonical order-independent key: normalised hexes, sorted, joined. */
function canonicalKey(colors) {
  return colors.map(normalizeHex).slice().sort().join(",");
}

module.exports = {
  HEX_RE,
  normalizeHex,
  hexToOklab,
  hexToOklch,
  oklchToHex,
  deltaE,
  paletteDistance,
  canonicalKey,
};
