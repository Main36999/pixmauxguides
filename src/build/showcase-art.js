/**
 * src/build/showcase-art.js — generated cover art for the DEMO projects.
 *
 * PLATFORM REDESIGN (design preview). The sample projects in
 * src/data/showcase-demo.json have no real artwork, and none may be
 * borrowed. Each one gets compositions drawn here instead: plain inline SVG,
 * coloured from one of bpozz's own palettes (palettes/palettes-data.json),
 * in the style of its discipline (identity, poster, packaging, type
 * specimen, interface, illustration, editorial spread).
 *
 * art(project, palette, variant) returns one <svg> string on a 4:3
 * (800 x 600) viewBox. Variant 0 is the gallery cover; 1-3 are the extra
 * shots on the project page. Deterministic: the same inputs always give the
 * same bytes, so the build stays reproducible.
 */

"use strict";

const { escapeHtml } = require("../shared/html.js");

const W = 800;
const H = 600;
const SANS = "Mona Sans, Helvetica Neue, Arial, sans-serif";
const SERIF = "Georgia, Times New Roman, serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

// ---------------------------------------------------------------------
// colour helpers
// ---------------------------------------------------------------------

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const c = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return (
    "#" +
    x
      .map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Roles for a four-colour palette: the darkest and lightest colours, the two
 * others as accents, and an ink that reads on a given ground.
 */
function roles(colors) {
  const sorted = colors.slice().sort((a, b) => luminance(a) - luminance(b));
  const dark = sorted[0];
  const light = sorted[3];
  const accents = [sorted[2], sorted[1]];
  const deep = luminance(dark) > 0.08 ? mix(dark, "#101010", 0.55) : dark;
  const pale = luminance(light) < 0.75 ? mix(light, "#ffffff", 0.7) : light;
  return {
    dark: deep,
    light: pale,
    a1: colors[2],
    a2: colors[3],
    m1: accents[0],
    m2: accents[1],
    all: colors,
    ink: (ground) => (contrast(ground, deep) >= contrast(ground, pale) ? deep : pale),
  };
}

// ---------------------------------------------------------------------
// drawing helpers
// ---------------------------------------------------------------------

const r = (n) => Math.round(n * 10) / 10;

function rect(x, y, w, h, fill, extra = "") {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}"${extra ? " " + extra : ""}/>`;
}

function circle(cx, cy, rad, fill, extra = "") {
  return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${fill}"${extra ? " " + extra : ""}/>`;
}

function text(x, y, value, { size = 24, weight = 600, fill = "#000", family = SANS, anchor = "start", spacing = 0, extra = "" } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : "";
  const ta = anchor !== "start" ? ` text-anchor="${anchor}"` : "";
  return `<text x="${r(x)}" y="${r(y)}" font-family="${family}" font-size="${r(size)}" font-weight="${weight}" fill="${fill}"${ta}${ls}${extra ? " " + extra : ""}>${escapeHtml(value)}</text>`;
}

/** A font size that fits `value` into `width`, capped at `max`. */
function fit(value, width, max, ratio = 0.56) {
  return Math.min(max, width / Math.max(1, value.length * ratio));
}

/** Rows of rounded bars standing in for running text. */
function lines(x, y, w, count, gap, fill, h = 6, ragged = true) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const lw = ragged && i === count - 1 ? w * 0.6 : ragged && i % 3 === 1 ? w * 0.92 : w;
    out += rect(x, y + i * gap, lw, h, fill, `rx="${h / 2}"`);
  }
  return out;
}

function svg(inner, ground) {
  return (
    `<svg class="art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    rect(0, 0, W, H, ground) +
    inner +
    `</svg>`
  );
}

/** A brand mark built from circle segments, scaled around (cx, cy). */
function mark(cx, cy, s, c1, c2, c3) {
  return (
    `<g transform="translate(${r(cx)} ${r(cy)}) scale(${r(s / 100)})">` +
    `<path d="M-100 0A100 100 0 0 1 100 0Z" fill="${c1}"/>` +
    `<path d="M-100 0H100A100 100 0 0 1 0 100A100 100 0 0 1 -100 0Z" fill="${c2}"/>` +
    circle(0, 0, 36, c3) +
    `</g>`
  );
}

// ---------------------------------------------------------------------
// the disciplines
// ---------------------------------------------------------------------

function brand(p, k, v) {
  const word = p.mark;
  if (v === 1) {
    // stationery: a letterhead and two business cards on a mid ground
    const ground = mix(k.m2, k.light, 0.35);
    const ink = k.ink(k.light);
    return svg(
      `<g transform="rotate(-6 400 300)">` +
        rect(140, 90, 300, 420, k.light, 'rx="6"') +
        mark(190, 150, 22, k.a1, k.a2, k.dark) +
        text(222, 158, word, { size: 18, weight: 700, fill: ink }) +
        lines(170, 220, 230, 9, 22, mix(ink, k.light, 0.82), 6) +
        `</g>` +
        `<g transform="rotate(8 560 300)">` +
        rect(430, 180, 260, 150, k.dark, 'rx="10"') +
        mark(560, 255, 40, k.a1, k.a2, k.light) +
        `</g>` +
        `<g transform="rotate(-3 560 420)">` +
        rect(450, 360, 260, 150, k.light, 'rx="10"') +
        text(475, 410, word, { size: 26, weight: 700, fill: ink }) +
        lines(475, 440, 150, 3, 16, mix(ink, k.light, 0.7), 5, false) +
        `</g>`,
      ground,
    );
  }
  if (v === 2) {
    // the colour system
    const bars = k.all
      .map((c, i) => {
        const x = 60 + i * 172;
        const label = k.ink(c);
        return (
          rect(x, 80, 160, 440, c, 'rx="14"') +
          text(x + 18, 488, c.toUpperCase(), { size: 18, weight: 600, fill: label, family: MONO })
        );
      })
      .join("");
    return svg(bars, k.light);
  }
  if (v === 3) {
    // mark construction on a grid
    const ground = k.dark;
    const guide = mix(k.light, ground, 0.72);
    let grid = "";
    for (let x = 40; x < W; x += 40) grid += `<path d="M${x} 0V${H}" stroke="${guide}" stroke-width="1"/>`;
    for (let y = 20; y < H; y += 40) grid += `<path d="M0 ${y}H${W}" stroke="${guide}" stroke-width="1"/>`;
    return svg(
      grid +
        circle(400, 300, 200, "none", `stroke="${mix(k.light, ground, 0.4)}" stroke-width="1.5" stroke-dasharray="6 6"`) +
        circle(400, 300, 72, "none", `stroke="${mix(k.light, ground, 0.4)}" stroke-width="1.5" stroke-dasharray="6 6"`) +
        mark(400, 300, 200, k.a1, k.a2, k.light),
      ground,
    );
  }
  // cover: the lockup
  const dark = luminance(p.colors[0]) < 0.2;
  const ground = dark ? k.dark : k.light;
  const ink = k.ink(ground);
  const size = fit(word, 380, 78, 0.6);
  return svg(
    mark(250, 280, 110, k.a1, k.a2, ink) +
      text(390, 280 + size * 0.35, word, { size, weight: 700, fill: ink, spacing: -1 }) +
      text(392, 280 + size * 0.35 + 40, (p.tagline || "Brand identity").toUpperCase(), {
        size: 15,
        weight: 600,
        fill: mix(ink, ground, 0.35),
        spacing: 3,
      }) +
      k.all.map((c, i) => circle(80 + i * 34, 540, 13, c, `stroke="${mix(ink, ground, 0.8)}" stroke-width="1"`)).join(""),
    ground,
  );
}

function poster(p, k, v) {
  const words = p.mark.split(" ");
  if (v === 1) {
    // three posters on a wall
    const wall = k.light;
    const frames = [0, 1, 2]
      .map((i) => {
        const x = 70 + i * 230;
        const g = [k.a1, k.dark, k.a2][i];
        const ink = k.ink(g);
        return (
          rect(x + 6, 116, 200, 290, mix(wall, "#000000", 0.12), 'rx="2"') +
          rect(x, 110, 200, 290, g, 'rx="2"') +
          circle(x + 140, 180, 46, [k.a2, k.a1, k.dark][i]) +
          text(x + 18, 330, words[0], { size: fit(words[0], 170, 40), weight: 800, fill: ink }) +
          text(x + 18, 370, words[1] || "2026", { size: 22, weight: 600, fill: ink })
        );
      })
      .join("");
    return svg(frames + rect(0, 470, W, 130, mix(wall, "#000000", 0.05)), wall);
  }
  if (v === 2) {
    // a crop of the type
    const g = k.dark;
    return svg(
      text(-30, 420, words[0].toUpperCase(), { size: 360, weight: 900, fill: k.a1, spacing: -12 }) +
        text(220, 560, (words[1] || words[0]).toUpperCase(), { size: 150, weight: 900, fill: k.a2, spacing: -4 }),
      g,
    );
  }
  if (v === 3) {
    // the poster, framed
    const wall = mix(k.light, "#000000", 0.04);
    const ink = k.ink(k.a1);
    return svg(
      rect(250, 46, 300, 420, mix(wall, "#000000", 0.1)) +
        rect(244, 40, 300, 420, k.a1) +
        circle(450, 150, 70, k.a2) +
        text(266, 360, words[0], { size: fit(words[0], 260, 60), weight: 800, fill: ink }) +
        text(266, 410, words.slice(1).join(" ") || "Series", { size: 30, weight: 600, fill: ink }) +
        rect(0, 520, W, 80, mix(wall, "#000000", 0.08)),
      wall,
    );
  }
  const g = k.a1;
  const ink = k.ink(g);
  return svg(
    circle(600, 170, 150, k.a2) +
      circle(600, 170, 150, "none", `stroke="${ink}" stroke-width="2"`) +
      text(48, 80, "SERIES / 2026", { size: 16, weight: 700, fill: ink, spacing: 3 }) +
      text(48, 400, words[0], { size: fit(words[0], 520, 150, 0.6), weight: 800, fill: ink, spacing: -3 }) +
      text(48, 530, words.slice(1).join(" ") || "Posters", { size: fit(words.slice(1).join(" ") || "Posters", 520, 120, 0.6), weight: 800, fill: ink, spacing: -3 }) +
      rect(48, 556, 704, 3, ink),
    g,
  );
}

function can(x, y, w, h, body, band, ink, word) {
  return (
    `<ellipse cx="${r(x + w / 2)}" cy="${r(y + h + 6)}" rx="${r(w * 0.55)}" ry="12" fill="rgba(0,0,0,0.12)"/>` +
    rect(x, y, w, h, body, `rx="${r(w * 0.12)}"`) +
    rect(x, y + h * 0.34, w, h * 0.36, band) +
    rect(x + w * 0.08, y + 8, w * 0.84, 10, "rgba(255,255,255,0.35)", 'rx="5"') +
    text(x + w / 2, y + h * 0.54, word, { size: fit(word, w * 0.8, 30), weight: 800, fill: ink, anchor: "middle" })
  );
}

function box(x, y, w, h, d, front, side, top, ink, word) {
  return (
    `<ellipse cx="${r(x + w / 2 + d / 2)}" cy="${r(y + h + 8)}" rx="${r(w * 0.7)}" ry="14" fill="rgba(0,0,0,0.12)"/>` +
    `<path d="M${x} ${y}L${x + d} ${y - d * 0.6}H${x + w + d}L${x + w} ${y}Z" fill="${top}"/>` +
    `<path d="M${x + w} ${y}L${x + w + d} ${y - d * 0.6}V${y + h - d * 0.6}L${x + w} ${y + h}Z" fill="${side}"/>` +
    rect(x, y, w, h, front) +
    text(x + w / 2, y + h * 0.45, word, { size: fit(word, w * 0.85, 34), weight: 800, fill: ink, anchor: "middle" }) +
    rect(x + w * 0.2, y + h * 0.58, w * 0.6, 4, ink, 'rx="2"')
  );
}

function pack(p, k, v) {
  const word = p.mark;
  const ground = k.light;
  if (v === 1) {
    const cans = [k.a1, k.dark, k.a2]
      .map((c, i) => can(150 + i * 180, 170, 130, 280, c, k.light, k.ink(k.light), word))
      .join("");
    return svg(cans + rect(0, 470, W, 130, mix(ground, "#000000", 0.05)), ground);
  }
  if (v === 2) {
    // the label, flat
    const g = k.a1;
    const ink = k.ink(g);
    return svg(
      rect(80, 90, 640, 420, k.light, 'rx="18"') +
        rect(110, 120, 580, 360, g, 'rx="10"') +
        circle(400, 250, 70, k.a2) +
        text(400, 380, word.toUpperCase(), { size: fit(word, 480, 64), weight: 800, fill: ink, anchor: "middle", spacing: 4 }) +
        text(400, 430, "SMALL BATCH  ·  NET 330 ML", { size: 15, weight: 600, fill: ink, anchor: "middle", spacing: 3 }),
      mix(k.light, k.dark, 0.12),
    );
  }
  if (v === 3) {
    // the dieline
    const line = mix(k.dark, ground, 0.2);
    const st = `fill="none" stroke="${line}" stroke-width="2"`;
    const dash = `fill="none" stroke="${k.a1}" stroke-width="2" stroke-dasharray="8 6"`;
    return svg(
      `<path d="M160 200H640V420H160Z" ${st}/>` +
        `<path d="M280 200V420M400 200V420M520 200V420" ${dash}/>` +
        `<path d="M280 200L300 120H380L400 200M280 420L300 500H380L400 420" ${st}/>` +
        `<path d="M640 230L680 240V380L640 390" ${st}/>` +
        text(340, 320, word, { size: 26, weight: 700, fill: k.dark, anchor: "middle" }) +
        text(160, 560, "DIELINE  ·  1:4", { size: 14, weight: 600, fill: line, family: MONO, spacing: 2 }),
      ground,
    );
  }
  return svg(
    can(170, 170, 150, 300, k.a1, k.light, k.ink(k.light), word) +
      box(400, 230, 200, 240, 60, k.dark, mix(k.dark, "#000000", 0.25), mix(k.dark, "#ffffff", 0.2), k.light, word) +
      circle(690, 110, 40, k.a2) +
      rect(0, 480, W, 120, mix(ground, "#000000", 0.05)),
    ground,
  );
}

function type(p, k, v) {
  const family = p.font === "serif" ? SERIF : p.font === "mono" ? MONO : SANS;
  const word = p.mark;
  if (v === 1) {
    // a waterfall of weights
    const ground = k.dark;
    const ink = k.light;
    const rows = [
      [120, 300],
      [92, 500],
      [68, 700],
      [50, 900],
    ];
    let y = 150;
    const out = rows
      .map(([size, weight], i) => {
        const t = text(50, y, word + (i % 2 ? " Medium" : " Display"), { size, weight, fill: i === 3 ? k.a1 : ink, family });
        y += size + 22;
        return t;
      })
      .join("");
    return svg(out, ground);
  }
  if (v === 2) {
    // a glyph grid
    const ground = k.light;
    const ink = k.ink(ground);
    const glyphs = "AaBbGgRr&?37";
    let out = "";
    for (let i = 0; i < 12; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 60 + col * 175;
      const y = 60 + row * 165;
      const hl = i === 5;
      out +=
        rect(x, y, 160, 150, hl ? k.a1 : mix(ground, ink, 0.05), 'rx="10"') +
        text(x + 80, y + 108, glyphs[i], { size: 92, weight: 600, fill: hl ? k.ink(k.a1) : ink, family, anchor: "middle" });
    }
    return svg(out, ground);
  }
  if (v === 3) {
    const ground = k.a1;
    const ink = k.ink(ground);
    return svg(
      text(400, 330, word, { size: fit(word, 700, 210, 0.58), weight: 800, fill: ink, family, anchor: "middle", spacing: -4 }) +
        text(400, 420, "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG", { size: 18, weight: 600, fill: ink, family, anchor: "middle", spacing: 3 }),
      ground,
    );
  }
  const ground = k.light;
  const ink = k.ink(ground);
  const guide = mix(ink, ground, 0.8);
  return svg(
    `<path d="M40 410H760M40 250H760M40 175H760" stroke="${guide}" stroke-width="1.5"/>` +
      text(50, 410, "Aa", { size: 320, weight: 700, fill: ink, family, spacing: -10 }) +
      text(470, 210, "ABCDEFGHIJ", { size: 34, weight: 600, fill: ink, family }) +
      text(470, 260, "abcdefghij", { size: 34, weight: 400, fill: ink, family }) +
      text(470, 310, "0123456789", { size: 34, weight: 500, fill: k.a1, family }) +
      text(470, 360, "&?!@(*)", { size: 34, weight: 600, fill: ink, family }) +
      text(50, 540, word, { size: 22, weight: 700, fill: ink, family }) +
      text(750, 540, "Specimen  01", { size: 16, weight: 600, fill: mix(ink, ground, 0.4), anchor: "end", spacing: 2 }),
    ground,
  );
}

function phone(x, y, k, word, mode) {
  const scr = mode === "dark" ? k.dark : "#ffffff";
  const ink = mode === "dark" ? k.light : "#14171c";
  const soft = mix(ink, scr, 0.88);
  let chart = "";
  const pts = [0, 30, 18, 52, 40, 70, 58].map((v2, i) => `${x + 26 + i * 28} ${y + 230 - v2}`).join(" L");
  chart += `<path d="M${pts}" fill="none" stroke="${k.a1}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return (
    rect(x - 10, y - 10, 240, 460, "#101114", 'rx="38"') +
    rect(x, y, 220, 440, scr, 'rx="30"') +
    rect(x + 80, y + 12, 60, 8, "#101114", 'rx="4"') +
    text(x + 22, y + 66, word, { size: 15, weight: 600, fill: mix(ink, scr, 0.35) }) +
    text(x + 22, y + 108, mode === "dark" ? "72%" : "$2,480", { size: 38, weight: 700, fill: ink }) +
    chart +
    rect(x + 20, y + 270, 180, 52, soft, 'rx="14"') +
    circle(x + 44, y + 296, 12, k.a2) +
    rect(x + 66, y + 288, 80, 7, mix(ink, scr, 0.5), 'rx="3.5"') +
    rect(x + 66, y + 300, 50, 6, mix(ink, scr, 0.75), 'rx="3"') +
    rect(x + 20, y + 334, 180, 52, soft, 'rx="14"') +
    circle(x + 44, y + 360, 12, k.a1) +
    rect(x + 66, y + 352, 90, 7, mix(ink, scr, 0.5), 'rx="3.5"') +
    rect(x + 66, y + 364, 40, 6, mix(ink, scr, 0.75), 'rx="3"') +
    rect(x + 20, y + 400, 180, 26, k.a1, 'rx="13"')
  );
}

function ui(p, k, v) {
  const word = p.mark;
  if (v === 1) {
    // desktop dashboard
    const ground = mix(k.m2, k.light, 0.5);
    const ink = "#14171c";
    let bars = "";
    [80, 120, 95, 150, 130, 175, 160].forEach((h, i) => {
      bars += rect(410 + i * 40, 470 - h, 24, h, i === 5 ? k.a1 : mix(k.a1, "#ffffff", 0.6), 'rx="6"');
    });
    return svg(
      rect(60, 60, 680, 480, "#ffffff", 'rx="16"') +
        rect(60, 60, 150, 480, k.dark, 'rx="16"') +
        rect(194, 60, 16, 480, k.dark) +
        text(84, 108, word, { size: 20, weight: 700, fill: k.light }) +
        [0, 1, 2, 3, 4].map((i) => rect(84, 150 + i * 40, i === 0 ? 100 : 80, 10, mix(k.light, k.dark, i === 0 ? 0 : 0.5), 'rx="5"')).join("") +
        text(240, 112, "Overview", { size: 24, weight: 700, fill: ink }) +
        [0, 1, 2].map((i) => rect(240 + i * 160, 140, 145, 90, "#f3f4f7", 'rx="12"') + rect(256 + i * 160, 160, 60, 8, "#c5cad3", 'rx="4"') + text(256 + i * 160, 208, ["12.4k", "3.8%", "+18"][i], { size: 26, weight: 700, fill: i === 1 ? k.a1 : ink })).join("") +
        rect(240, 250, 145, 230, "#f3f4f7", 'rx="12"') +
        circle(312, 340, 46, "none", `stroke="${k.a1}" stroke-width="16" stroke-dasharray="200 90"`) +
        rect(400, 250, 305, 230, "#f3f4f7", 'rx="12"') +
        bars,
      ground,
    );
  }
  if (v === 2) {
    // a component sheet
    const ground = "#ffffff";
    const ink = "#14171c";
    return svg(
      rect(0, 0, W, H, mix(k.light, "#ffffff", 0.5)) +
        text(60, 90, "Components", { size: 28, weight: 700, fill: ink }) +
        rect(60, 130, 180, 52, k.a1, 'rx="26"') +
        text(150, 163, "Continue", { size: 18, weight: 600, fill: k.ink(k.a1), anchor: "middle" }) +
        rect(260, 130, 180, 52, "#ffffff", `rx="26" stroke="${mix(ink, "#ffffff", 0.75)}" stroke-width="2"`) +
        text(350, 163, "Cancel", { size: 18, weight: 600, fill: ink, anchor: "middle" }) +
        rect(470, 140, 64, 34, k.a1, 'rx="17"') +
        circle(517, 157, 13, "#ffffff") +
        rect(560, 140, 64, 34, mix(ink, "#ffffff", 0.82), 'rx="17"') +
        circle(577, 157, 13, "#ffffff") +
        rect(60, 220, 380, 56, "#ffffff", `rx="12" stroke="${mix(ink, "#ffffff", 0.75)}" stroke-width="2"`) +
        text(80, 255, "Email address", { size: 17, weight: 500, fill: mix(ink, "#ffffff", 0.5) }) +
        rect(60, 300, 380, 56, "#ffffff", `rx="12" stroke="${k.a1}" stroke-width="3"`) +
        text(80, 335, word.toLowerCase() + "@studio", { size: 17, weight: 500, fill: ink }) +
        rect(470, 220, 270, 190, "#ffffff", 'rx="18"') +
        circle(510, 262, 20, k.a2) +
        rect(542, 252, 120, 9, mix(ink, "#ffffff", 0.4), 'rx="4.5"') +
        rect(542, 268, 80, 7, mix(ink, "#ffffff", 0.7), 'rx="3.5"') +
        lines(492, 310, 226, 3, 18, mix(ink, "#ffffff", 0.85), 7, true) +
        [0, 1, 2, 3, 4].map((i) => circle(80 + i * 46, 420, 16, k.all[i % 4])).join("") +
        rect(60, 470, 680, 70, k.dark, 'rx="16"') +
        text(90, 513, "Saved to your library", { size: 18, weight: 600, fill: k.light }),
      ground,
    );
  }
  if (v === 3) {
    // a three-step flow
    const ground = k.dark;
    let out = "";
    [0, 1, 2].forEach((i) => {
      const x = 70 + i * 240;
      out +=
        rect(x, 120, 180, 340, "#ffffff", 'rx="22"') +
        text(x + 18, 168, ["Sign up", "Choose", "Done"][i], { size: 18, weight: 700, fill: "#14171c" }) +
        rect(x + 18, 192, 144, i === 2 ? 110 : 36, i === 2 ? mix(k.a1, "#ffffff", 0.7) : "#eef0f4", 'rx="10"') +
        (i < 2 ? rect(x + 18, 240, 144, 36, "#eef0f4", 'rx="10"') : circle(x + 90, 247, 28, k.a1)) +
        rect(x + 18, 400, 144, 40, k.a1, 'rx="20"');
      if (i < 2) out += `<path d="M${x + 192} 290H${x + 228}M${x + 218} 280L${x + 228} 290L${x + 218} 300" fill="none" stroke="${k.light}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    return svg(out, ground);
  }
  const ground = mix(k.a1, k.dark, 0.15);
  return svg(
    circle(140, 120, 180, mix(ground, "#ffffff", 0.12)) +
      `<g transform="rotate(-8 300 320)">` + phone(190, 110, k, word, "dark") + `</g>` +
      phone(420, 80, k, word, "light"),
    ground,
  );
}

function illustration(p, k, v) {
  const night = v === 1;
  const sky = night ? k.dark : v === 2 ? mix(k.a2, "#ffffff", 0.55) : k.light;
  const far = night ? mix(k.dark, k.light, 0.18) : mix(k.m1, sky, 0.45);
  const mid = night ? mix(k.dark, k.a1, 0.4) : k.a2;
  const near = night ? mix(k.dark, "#000000", 0.2) : k.a1;
  if (v === 3) {
    // a leaf pattern
    let out = "";
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 9; x++) {
        const cx = x * 100 + (y % 2) * 50;
        const cy = y * 100;
        const fill = k.all[(x + y) % 4];
        out += `<path transform="translate(${cx} ${cy}) rotate(${(x * 37 + y * 53) % 360})" d="M0 -38C24 -20 24 20 0 38C-24 20 -24 -20 0 -38Z" fill="${fill}"/>`;
        out += `<path transform="translate(${cx} ${cy}) rotate(${(x * 37 + y * 53) % 360})" d="M0 -30V30" stroke="${k.light}" stroke-width="2" opacity="0.6"/>`;
      }
    }
    return svg(out, k.dark);
  }
  let stars = "";
  if (night) {
    [[90, 80], [180, 140], [300, 60], [420, 120], [520, 70], [650, 150], [730, 60], [250, 200]].forEach(([x, y]) => {
      stars += circle(x, y, 2.5, k.light);
    });
  }
  const sun = night ? circle(620, 130, 50, k.light) + circle(640, 115, 50, sky) : circle(560, 170, 70, k.a2 === mid ? k.m2 : mix(k.a2, "#ffffff", 0.2));
  const trees = [120, 165, 640, 690]
    .map((x, i) => `<path d="M${x} ${470 - i * 6}L${x + 22} ${400 - i * 6}L${x + 44} ${470 - i * 6}Z" fill="${night ? mix(near, "#000000", 0.2) : mix(near, k.dark, 0.35)}"/>`)
    .join("");
  const water =
    v === 2
      ? rect(0, 470, W, 130, mix(sky, k.a1, 0.5)) +
        [0, 1, 2, 3].map((i) => rect(120 + i * 150, 500 + (i % 2) * 30, 90, 4, mix(sky, "#ffffff", 0.5), 'rx="2"')).join("")
      : "";
  const birds = night
    ? ""
    : `<path d="M180 150q10 -10 20 0q10 -10 20 0M240 120q8 -8 16 0q8 -8 16 0" fill="none" stroke="${k.dark}" stroke-width="3" stroke-linecap="round"/>`;
  return svg(
    stars +
      sun +
      birds +
      `<path d="M0 360C120 300 220 330 320 300S540 230 800 310V600H0Z" fill="${far}"/>` +
      `<path d="M0 430C140 380 260 420 400 380S640 350 800 400V600H0Z" fill="${mid}"/>` +
      `<path d="M0 500C160 460 300 500 460 470S700 450 800 480V600H0Z" fill="${near}"/>` +
      trees +
      water,
    sky,
  );
}

function editorial(p, k, v) {
  const word = p.mark;
  if (v === 1) {
    // the cover of an issue
    const ground = mix(k.light, k.dark, 0.08);
    const g = k.a1;
    const ink = k.ink(g);
    return svg(
      rect(256, 46, 300, 420, "rgba(0,0,0,0.12)") +
        rect(250, 40, 300, 420, g) +
        text(270, 100, word.toUpperCase(), { size: fit(word, 260, 44, 0.66), weight: 800, fill: ink, spacing: 2 }) +
        text(270, 124, "ISSUE 08  ·  AUTUMN 2026", { size: 12, weight: 600, fill: ink, spacing: 2 }) +
        circle(400, 280, 90, k.a2) +
        rect(270, 400, 200, 8, ink, 'rx="4"') +
        rect(270, 418, 140, 8, ink, 'rx="4"') +
        rect(0, 500, W, 100, mix(ground, "#000000", 0.05)),
      ground,
    );
  }
  if (v === 2) {
    // an inside grid with a pull quote
    const ground = "#ffffff";
    const ink = "#14171c";
    const soft = "#d9dce2";
    return svg(
      rect(0, 0, W, H, mix(k.light, "#ffffff", 0.6)) +
        rect(60, 50, 680, 500, ground) +
        text(90, 110, word, { size: 34, weight: 800, fill: ink }) +
        lines(90, 140, 180, 14, 22, soft, 7) +
        lines(300, 140, 180, 6, 22, soft, 7) +
        text(300, 300, "“Good layout", { size: 26, weight: 700, fill: k.a1 }) +
        text(300, 334, "is invisible.”", { size: 26, weight: 700, fill: k.a1 }) +
        lines(300, 370, 180, 6, 22, soft, 7) +
        rect(510, 140, 200, 250, k.a2) +
        lines(510, 410, 200, 5, 22, soft, 7),
      ground,
    );
  }
  if (v === 3) {
    // a fan of issues
    const ground = k.dark;
    return svg(
      [k.a2, k.light, k.a1]
        .map((c, i) => {
          const ink = k.ink(c);
          return (
            `<g transform="rotate(${-12 + i * 12} 400 520)">` +
            rect(280, 100, 240, 340, c) +
            text(300, 150, word.toUpperCase(), { size: fit(word, 200, 32, 0.66), weight: 800, fill: ink }) +
            circle(400, 300, 60, i === 1 ? k.a1 : k.dark) +
            `</g>`
          );
        })
        .join(""),
      ground,
    );
  }
  const ground = mix(k.light, k.dark, 0.1);
  const ink = "#16181d";
  const soft = "#d6d9df";
  return svg(
    rect(72, 92, 656, 436, "rgba(0,0,0,0.1)") +
      rect(70, 84, 330, 436, "#ffffff") +
      rect(400, 84, 330, 436, "#fbfbfa") +
      `<path d="M400 84V520" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>` +
      rect(96, 110, 278, 300, k.a1) +
      circle(290, 230, 70, k.a2) +
      lines(96, 432, 278, 3, 20, soft, 7, false) +
      text(426, 150, word, { size: fit(word, 280, 44, 0.6), weight: 800, fill: ink }) +
      rect(426, 172, 120, 6, k.a1, 'rx="3"') +
      lines(426, 206, 130, 12, 20, soft, 7) +
      lines(574, 206, 130, 12, 20, soft, 7) +
      text(96, 506, "24", { size: 13, weight: 600, fill: "#8a8f99" }) +
      text(704, 506, "25", { size: 13, weight: 600, fill: "#8a8f99", anchor: "end" }),
    ground,
  );
}

const KINDS = { brand, poster, pack, type, ui, illustration, editorial };

/**
 * The art for `project` (one demo project record) in `colors` (its
 * palette's four HEX values). `variant` 0 is the cover.
 */
function art(project, colors, variant = 0, { label = "" } = {}) {
  const draw = KINDS[project.kind];
  if (!draw) throw new Error(`showcase-art: unknown kind "${project.kind}"`);
  // A project may lead with another of its compositions (`cover`), so two
  // projects of one discipline don't open on the same layout. The cover
  // and composition 0 swap places; the other two stay where they are.
  const cover = project.cover || 0;
  const v = variant === 0 ? cover : variant === cover ? 0 : variant;
  const out = draw(Object.assign({ colors }, project), roles(colors), v);
  // Decorative by default (a card's link names it). With a label, the art
  // is an image in its own right, as on the project page.
  return label
    ? out.replace('aria-hidden="true" focusable="false"', `role="img" aria-label="${escapeHtml(label)}" focusable="false"`)
    : out;
}

/** A soft avatar colour pair for a designer, from their palette. */
function avatarColors(colors) {
  const k = roles(colors);
  const bg = k.a1;
  return { bg, fg: k.ink(bg) };
}

module.exports = { art, avatarColors, KINDS, luminance, contrast, mix };
