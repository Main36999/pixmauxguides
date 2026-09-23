/**
 * themes.js — the palette recipes expand-palettes.js draws from.
 *
 * Each theme is a small design brief: which ROLES its four colours play
 * (surface, deep tone, accent, text…), the OKLCH lightness and chroma band
 * each role lives in, and how their hues relate. Most themes have a few
 * sub-variants and at least one free hue, so a theme is a region of colour
 * space wide enough to hold several genuinely different palettes rather
 * than one palette with jitter.
 *
 * make(hue) returns four [L, C, h] specs; `hue` walks the wheel in golden-
 * angle steps per theme. check(hexes), where present, is a hard rule the
 * theme promises (contrast for the UI and accessibility themes).
 *
 * `r` supplies the seeded randomness and a WCAG contrast function, so the
 * recipes stay deterministic and this file stays pure data + arithmetic.
 */

"use strict";

module.exports = function makeThemes(r) {
  const { rand, pick, contrast } = r;
  const any = () => rand(0, 360);

  return [
    // ---- style -------------------------------------------------------
    {
      name: "minimal",
      make: (hue) => [
        [rand(0.975, 0.99), rand(0.002, 0.008), hue],
        [rand(0.84, 0.9), rand(0.02, 0.06), hue + pick([0, 180])],
        [rand(0.13, 0.22), rand(0.003, 0.03), hue + pick([0, 20, 200])],
        [rand(0.5, 0.7), rand(0.14, 0.21), hue],
      ],
    },
    {
      name: "neutral",
      make: (hue) => {
        const warm = rand(40, 100);
        const cool = rand(200, 280);
        const tint = pick([warm, cool, hue]);
        return [
          [rand(0.93, 0.985), rand(0.006, 0.02), warm],
          [rand(0.66, 0.8), rand(0.01, 0.03), pick([warm, cool])],
          [rand(0.42, 0.56), rand(0.015, 0.045), tint],
          [rand(0.1, 0.26), rand(0.006, 0.03), pick([cool, warm, tint])],
        ];
      },
    },
    {
      name: "monochromatic",
      make: (hue) => {
        const c = rand(0.12, 0.22);
        const dark = rng01() < 0.4;
        const Ls = dark ? [0.18, 0.32, 0.48, 0.7] : [0.93, 0.76, 0.56, 0.32];
        const cs = dark ? [0.35, 0.7, 1, 0.8] : [0.35, 0.8, 1, 0.65];
        return Ls.map((L, i) => [L + rand(-0.03, 0.03), c * cs[i], hue + rand(-6, 6)]);
      },
    },
    {
      name: "pastel",
      make: (hue) => {
        const step = pick([90, 72, 120, 45, 150]);
        const Ls = [rand(0.92, 0.95), rand(0.85, 0.9), rand(0.8, 0.85), rand(0.87, 0.92)];
        return [0, 1, 2, 3].map((i) => [Ls[i], rand(0.06, 0.11), hue + i * step]);
      },
    },
    {
      name: "vibrant",
      make: (hue) => {
        const scheme = pick([[0, 120, 240, 200], [0, 180, 30, 210], [0, 150, 210, 60]]);
        return [
          [rand(0.58, 0.7), rand(0.2, 0.26), hue + scheme[0]],
          [rand(0.76, 0.88), rand(0.16, 0.22), hue + scheme[1]],
          [rand(0.48, 0.6), rand(0.17, 0.23), hue + scheme[2]],
          [rand(0.24, 0.38), rand(0.07, 0.13), hue + scheme[3]],
        ];
      },
    },
    {
      name: "neon",
      make: (hue) => [
        [rand(0.13, 0.2), rand(0.02, 0.06), rand(240, 310)],
        [rand(0.84, 0.92), 0.32, hue],
        [rand(0.62, 0.72), 0.32, hue + pick([150, 180, 210])],
        [rand(0.72, 0.82), 0.32, hue + pick([60, 90, 270])],
      ],
      check: (x) => contrast(x[0], x[1]) >= 7,
    },
    {
      name: "dark",
      make: (hue) => [
        [rand(0.12, 0.18), rand(0.01, 0.04), hue],
        [rand(0.23, 0.31), rand(0.03, 0.07), hue + rand(-15, 15)],
        [rand(0.36, 0.46), rand(0.06, 0.12), hue + pick([30, -30, 60])],
        [rand(0.55, 0.7), rand(0.09, 0.16), hue + pick([180, 150, 210, 0])],
      ],
    },
    {
      name: "light",
      make: (hue) => [
        [rand(0.97, 0.99), rand(0.008, 0.02), hue],
        [rand(0.88, 0.93), rand(0.035, 0.07), hue + pick([40, 60, 90])],
        [rand(0.79, 0.85), rand(0.06, 0.1), hue - pick([40, 60, 90])],
        [rand(0.68, 0.75), rand(0.08, 0.13), hue + 180],
      ],
    },
    {
      name: "luxury",
      make: (hue) => [
        [rand(0.1, 0.16), rand(0.004, 0.02), hue],
        [rand(0.34, 0.46), rand(0.11, 0.17), hue],
        [rand(0.68, 0.78), rand(0.1, 0.14), rand(70, 95)],
        [rand(0.86, 0.94), rand(0.02, 0.06), rand(20, 80)],
      ],
    },
    {
      name: "elegant",
      make: (hue) => [
        [rand(0.94, 0.975), rand(0.008, 0.02), rand(50, 90)],
        [rand(0.72, 0.8), rand(0.04, 0.08), hue],
        [rand(0.55, 0.64), rand(0.03, 0.07), hue + pick([30, -30, 180])],
        [rand(0.22, 0.32), rand(0.04, 0.08), hue + pick([150, 200, 240])],
      ],
    },
    {
      name: "modern",
      make: (hue) => [
        [rand(0.96, 0.99), rand(0, 0.008), hue],
        [rand(0.16, 0.26), rand(0.005, 0.03), hue + 180],
        [rand(0.56, 0.68), rand(0.18, 0.25), hue],
        [rand(0.84, 0.92), rand(0.05, 0.1), hue + pick([120, 150, 210])],
      ],
    },
    {
      name: "editorial",
      make: (hue) => [
        [rand(0.94, 0.975), rand(0.008, 0.025), rand(70, 100)],
        [rand(0.15, 0.22), rand(0.005, 0.03), rand(240, 300)],
        [rand(0.5, 0.62), rand(0.15, 0.22), hue],
        [rand(0.66, 0.78), rand(0.005, 0.03), pick([rand(60, 90), rand(220, 260)])],
      ],
      check: (x) => contrast(x[0], x[1]) >= 12,
    },

    // ---- era ---------------------------------------------------------
    {
      name: "retro",
      make: () =>
        pick([
          // 70s: mustard, burnt orange, teal, brown
          () => [
            [rand(0.76, 0.84), rand(0.12, 0.16), rand(85, 100)],
            [rand(0.58, 0.66), rand(0.14, 0.18), rand(38, 52)],
            [rand(0.46, 0.56), rand(0.06, 0.1), rand(185, 215)],
            [rand(0.3, 0.38), rand(0.05, 0.08), rand(40, 60)],
          ],
          // 50s diner: mint, cherry, cream, black
          () => [
            [rand(0.84, 0.9), rand(0.06, 0.09), rand(165, 185)],
            [rand(0.52, 0.6), rand(0.18, 0.22), rand(20, 30)],
            [rand(0.94, 0.97), rand(0.03, 0.05), rand(85, 100)],
            [rand(0.16, 0.22), rand(0.005, 0.02), rand(0, 360)],
          ],
          // 80s: hot pink, teal, purple, yellow
          () => [
            [rand(0.64, 0.72), rand(0.2, 0.25), rand(350, 365)],
            [rand(0.66, 0.74), rand(0.12, 0.15), rand(185, 200)],
            [rand(0.4, 0.48), rand(0.15, 0.19), rand(295, 310)],
            [rand(0.88, 0.93), rand(0.15, 0.18), rand(100, 108)],
          ],
          // 60s mod: orange, pink, lime, navy
          () => [
            [rand(0.68, 0.74), rand(0.17, 0.2), rand(45, 55)],
            [rand(0.72, 0.78), rand(0.13, 0.16), rand(345, 360)],
            [rand(0.82, 0.88), rand(0.16, 0.19), rand(120, 130)],
            [rand(0.26, 0.32), rand(0.08, 0.11), rand(255, 265)],
          ],
        ])(),
    },
    {
      name: "vintage",
      make: (hue) => [
        [rand(0.9, 0.94), rand(0.03, 0.05), rand(75, 95)],
        [rand(0.56, 0.66), rand(0.05, 0.08), hue],
        [rand(0.68, 0.78), rand(0.08, 0.12), hue + pick([120, 180, 240])],
        [rand(0.36, 0.5), rand(0.06, 0.12), pick([rand(25, 50), hue + 30])],
      ],
    },

    // ---- context -----------------------------------------------------
    {
      name: "corporate",
      make: (hue) => {
        const brand = pick([rand(235, 270), rand(195, 225), rand(145, 165), hue]);
        return [
          [rand(0.24, 0.32), rand(0.07, 0.12), brand],
          [rand(0.5, 0.6), rand(0.12, 0.18), brand - 10],
          [rand(0.94, 0.98), rand(0.006, 0.02), brand],
          [rand(0.64, 0.76), rand(0.12, 0.17), brand + pick([150, 180, 200, 60])],
        ];
      },
      check: (x) => contrast(x[0], x[2]) >= 7,
    },
    {
      name: "tech",
      make: (hue) => [
        [rand(0.14, 0.22), rand(0.02, 0.05), rand(235, 285)],
        [rand(0.28, 0.36), rand(0.03, 0.06), rand(235, 285)],
        [rand(0.62, 0.74), rand(0.15, 0.22), hue],
        [rand(0.82, 0.92), rand(0.07, 0.13), hue + pick([60, 100, -60])],
      ],
    },
    {
      name: "branding",
      make: (hue) => [
        [rand(0.48, 0.62), rand(0.17, 0.24), hue],
        [rand(0.88, 0.95), rand(0.025, 0.06), hue],
        [rand(0.18, 0.28), rand(0.03, 0.07), hue + rand(-10, 20)],
        [rand(0.7, 0.82), rand(0.13, 0.19), hue + pick([150, 210, 120])],
      ],
    },
    {
      name: "ui",
      make: (hue) => [
        [rand(0.97, 0.99), rand(0.004, 0.015), hue],
        [rand(0.84, 0.9), rand(0.04, 0.08), hue + pick([0, 30, -30])],
        [rand(0.48, 0.56), rand(0.16, 0.22), hue],
        [rand(0.18, 0.26), rand(0.02, 0.06), hue + pick([0, 180])],
      ],
      // text on background ≥ 12:1, primary on background ≥ 4.5 (button text)
      check: (x) => contrast(x[0], x[3]) >= 12 && contrast(x[0], x[2]) >= 4.5,
    },
    {
      name: "ui-dark",
      make: (hue) => [
        [rand(0.14, 0.19), rand(0.01, 0.03), hue],
        [rand(0.24, 0.3), rand(0.02, 0.05), hue],
        [rand(0.68, 0.78), rand(0.13, 0.18), hue],
        [rand(0.92, 0.97), rand(0.006, 0.02), hue],
      ],
      check: (x) => contrast(x[0], x[3]) >= 12 && contrast(x[0], x[2]) >= 4.5,
    },
    {
      name: "accessible",
      make: (hue) => [
        [rand(0.96, 0.99), rand(0.008, 0.025), hue + 60],
        [rand(0.16, 0.26), rand(0.03, 0.07), hue],
        [rand(0.42, 0.5), rand(0.13, 0.18), hue],
        [rand(0.4, 0.48), rand(0.12, 0.17), hue + pick([150, 180, 210])],
      ],
      // every colour on the light background meets WCAG AA for body text
      check: (x) => [1, 2, 3].every((i) => contrast(x[0], x[i]) >= 4.5),
    },
    {
      name: "accessible-dark",
      make: (hue) => [
        [rand(0.13, 0.2), rand(0.01, 0.03), hue],
        [rand(0.93, 0.97), rand(0.01, 0.03), hue + pick([0, 60])],
        [rand(0.75, 0.83), rand(0.11, 0.16), hue + 30],
        [rand(0.76, 0.84), rand(0.1, 0.14), hue + pick([180, 200, 240])],
      ],
      check: (x) => [1, 2, 3].every((i) => contrast(x[0], x[i]) >= 7),
    },
    {
      name: "fashion",
      make: (hue) =>
        pick([
          () => [
            [rand(0.1, 0.18), rand(0.005, 0.02), hue],
            [rand(0.52, 0.62), rand(0.2, 0.26), hue],
            [rand(0.84, 0.9), rand(0.14, 0.2), hue + 180],
            [rand(0.68, 0.76), rand(0.05, 0.09), rand(50, 75)],
          ],
          // camel, black, ivory, one statement colour
          () => [
            [rand(0.64, 0.7), rand(0.07, 0.09), rand(60, 72)],
            [rand(0.12, 0.17), rand(0.004, 0.015), any()],
            [rand(0.94, 0.97), rand(0.015, 0.03), rand(80, 95)],
            [rand(0.45, 0.6), rand(0.16, 0.22), hue],
          ],
        ])(),
    },
    {
      name: "interior",
      make: (hue) => [
        [rand(0.92, 0.96), rand(0.012, 0.03), rand(70, 95)],
        [rand(0.62, 0.74), rand(0.04, 0.07), rand(45, 75)],
        [rand(0.38, 0.5), rand(0.07, 0.12), hue],
        [rand(0.16, 0.26), rand(0.01, 0.03), rand(30, 90)],
      ],
    },
    {
      name: "architecture",
      make: (hue) => [
        [rand(0.78, 0.86), rand(0.004, 0.015), rand(60, 100)],
        [rand(0.55, 0.66), rand(0.004, 0.02), rand(210, 260)],
        [rand(0.44, 0.58), rand(0.08, 0.14), pick([rand(25, 42), hue])],
        [rand(0.22, 0.34), rand(0.02, 0.06), rand(220, 260)],
      ],
    },

    // ---- nature ------------------------------------------------------
    {
      name: "nature",
      make: (hue) =>
        pick([
          // meadow
          () => [
            [rand(0.86, 0.92), rand(0.05, 0.08), rand(95, 115)],
            [rand(0.52, 0.62), rand(0.1, 0.14), rand(125, 145)],
            [rand(0.66, 0.76), rand(0.07, 0.1), rand(215, 245)],
            [rand(0.36, 0.46), rand(0.05, 0.08), rand(45, 65)],
          ],
          // bloom: foliage plus one flower in any hue
          () => [
            [rand(0.3, 0.4), rand(0.06, 0.09), rand(135, 155)],
            [rand(0.62, 0.72), rand(0.14, 0.19), hue],
            [rand(0.8, 0.86), rand(0.06, 0.09), hue + rand(-20, 20)],
            [rand(0.92, 0.96), rand(0.02, 0.04), rand(90, 110)],
          ],
          // lake
          () => [
            [rand(0.26, 0.34), rand(0.04, 0.07), rand(150, 175)],
            [rand(0.5, 0.58), rand(0.08, 0.11), rand(215, 235)],
            [rand(0.76, 0.82), rand(0.04, 0.06), rand(80, 95)],
            [rand(0.62, 0.7), rand(0.02, 0.04), rand(200, 240)],
          ],
        ])(),
    },
    {
      name: "ocean",
      make: () => {
        const h = rand(185, 250);
        const accent = pick([
          [rand(0.84, 0.9), rand(0.04, 0.06), rand(75, 90)], // sand
          [rand(0.68, 0.74), rand(0.12, 0.15), rand(25, 40)], // coral
          [rand(0.88, 0.92), rand(0.12, 0.15), rand(95, 105)], // sun
        ]);
        return [
          [rand(0.18, 0.28), rand(0.06, 0.1), h + 15],
          [rand(0.5, 0.62), rand(0.11, 0.15), h - 15],
          [rand(0.8, 0.9), rand(0.05, 0.09), h - 35],
          accent,
        ];
      },
    },
    {
      name: "sunset",
      make: () =>
        pick([
          () => [
            [rand(0.86, 0.92), rand(0.07, 0.11), rand(70, 90)],
            [rand(0.68, 0.76), rand(0.14, 0.18), rand(45, 60)],
            [rand(0.56, 0.64), rand(0.18, 0.22), rand(15, 32)],
            [rand(0.3, 0.42), rand(0.1, 0.15), rand(300, 340)],
          ],
          () => [
            [rand(0.8, 0.86), rand(0.1, 0.13), rand(350, 365)],
            [rand(0.7, 0.76), rand(0.1, 0.13), rand(300, 320)],
            [rand(0.74, 0.8), rand(0.13, 0.16), rand(55, 70)],
            [rand(0.22, 0.3), rand(0.07, 0.1), rand(265, 285)],
          ],
          () => [
            [rand(0.8, 0.86), rand(0.14, 0.17), rand(80, 92)],
            [rand(0.6, 0.66), rand(0.19, 0.22), rand(35, 45)],
            [rand(0.46, 0.52), rand(0.17, 0.2), rand(20, 28)],
            [rand(0.18, 0.24), rand(0.05, 0.08), rand(240, 260)],
          ],
        ])(),
    },
    {
      name: "forest",
      make: (hue) => [
        [rand(0.18, 0.26), rand(0.03, 0.06), rand(140, 175)],
        [rand(0.36, 0.46), rand(0.06, 0.1), rand(125, 155)],
        [rand(0.6, 0.72), rand(0.07, 0.12), rand(105, 135)],
        pick([
          [rand(0.48, 0.58), rand(0.05, 0.08), rand(45, 65)], // bark
          [rand(0.5, 0.58), rand(0.15, 0.19), rand(20, 35)], // toadstool
          [rand(0.85, 0.9), rand(0.01, 0.02), rand(180, 230)], // fog
          [rand(0.45, 0.55), rand(0.12, 0.16), hue], // berry, any
        ]),
      ],
    },
    {
      name: "desert",
      make: () =>
        pick([
          () => [
            [rand(0.86, 0.92), rand(0.035, 0.055), rand(70, 85)],
            [rand(0.6, 0.68), rand(0.1, 0.14), rand(35, 50)],
            [rand(0.62, 0.7), rand(0.03, 0.05), rand(125, 145)],
            [rand(0.74, 0.82), rand(0.04, 0.07), rand(225, 245)],
          ],
          // dusk over dunes
          () => [
            [rand(0.8, 0.86), rand(0.05, 0.08), rand(60, 75)],
            [rand(0.66, 0.72), rand(0.08, 0.1), rand(10, 25)],
            [rand(0.48, 0.54), rand(0.07, 0.09), rand(320, 335)],
            [rand(0.26, 0.32), rand(0.06, 0.08), rand(270, 290)],
          ],
          // cactus bloom
          () => [
            [rand(0.5, 0.58), rand(0.07, 0.09), rand(140, 155)],
            [rand(0.7, 0.76), rand(0.14, 0.17), rand(350, 365)],
            [rand(0.88, 0.92), rand(0.04, 0.06), rand(80, 90)],
            [rand(0.38, 0.44), rand(0.06, 0.08), rand(40, 55)],
          ],
        ])(),
    },
    {
      name: "earthy",
      make: (hue) => [
        [rand(0.18, 0.28), rand(0.02, 0.05), rand(30, 70)],
        [rand(0.52, 0.64), rand(0.09, 0.14), rand(30, 55)],
        [rand(0.7, 0.8), rand(0.07, 0.12), rand(75, 100)],
        pick([
          [rand(0.52, 0.64), rand(0.03, 0.06), rand(200, 245)],
          [rand(0.48, 0.58), rand(0.05, 0.08), rand(115, 140)],
          [rand(0.88, 0.93), rand(0.02, 0.035), rand(70, 90)],
          [rand(0.4, 0.5), rand(0.06, 0.1), hue],
        ]),
      ],
    },
    {
      name: "tropical",
      make: (hue) => [
        [rand(0.58, 0.7), rand(0.12, 0.17), rand(160, 195)],
        [rand(0.82, 0.9), rand(0.14, 0.18), rand(90, 112)],
        [rand(0.62, 0.72), rand(0.17, 0.22), pick([rand(5, 35), rand(340, 360), hue])],
        [rand(0.3, 0.42), rand(0.08, 0.12), rand(145, 170)],
      ],
    },
    {
      name: "floral",
      make: (hue) => [
        [rand(0.84, 0.92), rand(0.05, 0.09), hue],
        [rand(0.6, 0.7), rand(0.13, 0.18), hue + rand(-25, 25)],
        [rand(0.7, 0.78), rand(0.09, 0.13), hue + pick([-50, 50, 90])],
        [rand(0.44, 0.58), rand(0.08, 0.12), rand(125, 150)],
      ],
    },

    // ---- season & food -----------------------------------------------
    {
      name: "spring",
      make: (hue) => [
        [rand(0.9, 0.95), rand(0.06, 0.1), rand(100, 125)],
        [rand(0.78, 0.86), rand(0.08, 0.12), rand(340, 370)],
        [rand(0.7, 0.8), rand(0.1, 0.14), hue],
        [rand(0.56, 0.66), rand(0.1, 0.14), rand(135, 160)],
      ],
    },
    {
      name: "autumn",
      make: () => [
        [rand(0.6, 0.7), rand(0.14, 0.18), rand(40, 60)],
        [rand(0.44, 0.54), rand(0.13, 0.18), rand(22, 40)],
        [rand(0.72, 0.82), rand(0.11, 0.15), rand(78, 95)],
        pick([
          [rand(0.3, 0.4), rand(0.05, 0.08), rand(100, 130)],
          [rand(0.26, 0.34), rand(0.08, 0.11), rand(10, 25)],
          [rand(0.3, 0.38), rand(0.04, 0.07), rand(230, 260)],
        ]),
      ],
    },
    {
      name: "winter",
      make: (hue) => [
        [rand(0.95, 0.985), rand(0.006, 0.018), rand(210, 245)],
        [rand(0.76, 0.86), rand(0.025, 0.05), rand(205, 245)],
        [rand(0.44, 0.58), rand(0.03, 0.07), rand(225, 270)],
        [rand(0.36, 0.5), rand(0.11, 0.16), pick([rand(15, 30), rand(145, 165), hue])],
      ],
    },
    {
      name: "candy",
      make: (hue) => [
        [rand(0.76, 0.84), rand(0.12, 0.16), pick([rand(345, 370), rand(315, 340)])],
        [rand(0.84, 0.9), rand(0.1, 0.14), rand(155, 190)],
        [rand(0.88, 0.94), rand(0.11, 0.15), rand(90, 110)],
        [rand(0.68, 0.78), rand(0.12, 0.17), hue],
      ],
    },
    {
      name: "berry",
      make: () => [
        [rand(0.26, 0.36), rand(0.1, 0.15), rand(340, 365)],
        [rand(0.48, 0.58), rand(0.15, 0.21), rand(320, 350)],
        [rand(0.68, 0.78), rand(0.08, 0.14), rand(285, 325)],
        pick([
          [rand(0.9, 0.95), rand(0.02, 0.045), rand(330, 370)],
          [rand(0.62, 0.7), rand(0.1, 0.13), rand(135, 150)],
          [rand(0.36, 0.44), rand(0.1, 0.14), rand(270, 290)],
        ]),
      ],
    },
    {
      name: "citrus",
      make: () => [
        [rand(0.9, 0.96), rand(0.12, 0.18), rand(98, 110)],
        [rand(0.78, 0.86), rand(0.15, 0.19), rand(75, 92)],
        [rand(0.66, 0.76), rand(0.16, 0.21), rand(45, 65)],
        pick([
          [rand(0.58, 0.68), rand(0.14, 0.18), rand(120, 140)],
          [rand(0.3, 0.38), rand(0.07, 0.1), rand(140, 160)],
          [rand(0.97, 0.99), rand(0.01, 0.025), rand(95, 105)],
        ]),
      ],
    },
    {
      name: "coffee",
      make: (hue) => [
        [rand(0.92, 0.96), rand(0.02, 0.04), rand(70, 90)],
        [rand(0.62, 0.72), rand(0.08, 0.12), rand(55, 70)],
        [rand(0.36, 0.46), rand(0.06, 0.09), rand(40, 58)],
        pick([
          [rand(0.14, 0.2), rand(0.02, 0.04), rand(35, 55)],
          [rand(0.62, 0.7), rand(0.08, 0.12), hue], // flavour accent
        ]),
      ],
    },

    // ---- pure harmony ------------------------------------------------
    {
      name: "complementary",
      make: (hue) => [
        [rand(0.3, 0.4), rand(0.1, 0.15), hue],
        [rand(0.55, 0.65), rand(0.14, 0.2), hue + rand(-10, 10)],
        [rand(0.72, 0.8), rand(0.12, 0.17), hue + 180],
        [rand(0.9, 0.95), rand(0.03, 0.06), hue + 180],
      ],
    },
    {
      name: "split",
      make: (hue) => [
        [rand(0.32, 0.44), rand(0.11, 0.17), hue],
        [rand(0.64, 0.74), rand(0.12, 0.18), hue + 150],
        [rand(0.76, 0.86), rand(0.09, 0.15), hue + 210],
        [rand(0.94, 0.98), rand(0.01, 0.03), hue + 180],
      ],
    },
    {
      name: "triadic",
      make: (hue) => [
        [rand(0.62, 0.72), rand(0.12, 0.16), hue],
        [rand(0.72, 0.82), rand(0.1, 0.14), hue + 120],
        [rand(0.52, 0.62), rand(0.11, 0.15), hue + 240],
        [rand(0.94, 0.98), rand(0.01, 0.025), hue + 60],
      ],
    },
    {
      name: "tetradic",
      make: (hue) => [
        [rand(0.54, 0.64), rand(0.12, 0.17), hue],
        [rand(0.64, 0.74), rand(0.1, 0.15), hue + 90],
        [rand(0.42, 0.52), rand(0.1, 0.15), hue + 180],
        [rand(0.78, 0.88), rand(0.08, 0.13), hue + 270],
      ],
    },
    {
      name: "analogous",
      make: (hue) => {
        const dark = rng01() < 0.5;
        const Ls = dark ? [0.2, 0.34, 0.5, 0.68] : [0.9, 0.78, 0.64, 0.48];
        return Ls.map((L, i) => [L + rand(-0.03, 0.03), rand(0.08, 0.17), hue + i * rand(18, 28)]);
      },
    },
    {
      name: "duotone",
      make: (hue) => {
        const other = hue + pick([150, 180, 210, 90]);
        return [
          [rand(0.24, 0.34), rand(0.08, 0.13), hue],
          [rand(0.62, 0.72), rand(0.12, 0.18), hue + rand(-8, 8)],
          [rand(0.42, 0.52), rand(0.1, 0.15), other],
          [rand(0.82, 0.9), rand(0.06, 0.1), other + rand(-8, 8)],
        ];
      },
    },
  ];

  function rng01() {
    return rand(0, 1);
  }
};
