#!/usr/bin/env node
/**
 * scripts/icons/render-3d.js — renders the 3D Essentials pack.
 *
 *     node scripts/icons/render-3d.js            render missing PNGs
 *     node scripts/icons/render-3d.js --force    re-render every PNG
 *
 * AUTHORING TOOL, NOT A BUILD STEP, for the same reasons as render-png.js:
 * its output is committed under public/icons/3d-essentials/png/ and published
 * verbatim.
 *
 * The icons are genuinely rendered 3D objects, not flat art with a drop
 * shadow: each is a signed-distance-field scene (extruded, edge-rounded 2D
 * shapes plus a few primitives) raymarched through a perspective camera with a
 * key light, sky ambient, soft shadows, ambient occlusion, a specular highlight
 * and a fresnel rim. Anti-aliasing is adaptive: 4 samples per pixel, and 16
 * where those 4 disagree (silhouettes and material edges). The background is
 * transparent.
 *
 * That is also why this pack is raster-only: there is no vector source, so the
 * data offers PNG and nothing else (site.config.js icons.styles[3d].vector).
 *
 * Signed distance functions after Inigo Quilez (iquilezles.org, MIT-licensed
 * shader snippets): sdHeart, sdStar5, sdCappedTorus, opExtrusion.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const config = require("../../site.config.js");
const png = require("./png.js");

const PACK = "3d-essentials";
const SIZE = 512;
const FORCE = process.argv.includes("--force");

// ---------------------------------------------------------------------
// math
// ---------------------------------------------------------------------

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const len2 = (x, y) => Math.sqrt(x * x + y * y);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const srgbToLinear = (c) => Math.pow(c / 255, 2.2);
const hex = (h) => [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16)));

function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

// ---------------------------------------------------------------------
// 2D distance functions
// ---------------------------------------------------------------------

function sdHeart(x, y) {
  x = Math.abs(x);
  if (y + x > 1) return len2(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  const m = Math.max(x + y, 0) * 0.5;
  const a = (x - 0) * (x - 0) + (y - 1) * (y - 1);
  const b = (x - m) * (x - m) + (y - m) * (y - m);
  return Math.sqrt(Math.min(a, b)) * Math.sign(x - y);
}

function sdStar5(x, y, r, rf) {
  const k1x = 0.809016994375;
  const k1y = -0.587785252292;
  const k2x = -k1x;
  const k2y = k1y;
  x = Math.abs(x);
  let d = 2 * Math.max(k1x * x + k1y * y, 0);
  x -= d * k1x;
  y -= d * k1y;
  d = 2 * Math.max(k2x * x + k2y * y, 0);
  x -= d * k2x;
  y -= d * k2y;
  x = Math.abs(x);
  y -= r;
  const bax = rf * -k1y - 0;
  const bay = rf * k1x - 1;
  const h = clamp((x * bax + y * bay) / (bax * bax + bay * bay), 0, r);
  return len2(x - bax * h, y - bay * h) * Math.sign(y * bax - x * bay);
}

function sdRoundBox2(x, y, bx, by, r) {
  const qx = Math.abs(x) - bx + r;
  const qy = Math.abs(y) - by + r;
  return len2(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment2(x, y, ax, ay, bx, by) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return len2(pax - bax * h, pay - bay * h);
}

// ---------------------------------------------------------------------
// 3D helpers
// ---------------------------------------------------------------------

/** A 2D shape extruded to half-depth h along z, every edge rounded by r. */
function extrudeRound(d2, z, h, r) {
  const wx = d2 + r;
  const wy = Math.abs(z) - (h - r);
  return Math.min(Math.max(wx, wy), 0) + len2(Math.max(wx, 0), Math.max(wy, 0)) - r;
}

function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

function sdCappedTorus(x, y, z, scx, scy, ra, rb) {
  x = Math.abs(x);
  const k = scy * x > scx * y ? x * scx + y * scy : len2(x, y);
  return Math.sqrt(x * x + y * y + z * z + ra * ra - 2 * ra * k) - rb;
}

// ---------------------------------------------------------------------
// scenes: map(x, y, z) -> distance, and the material of the nearest surface
// ---------------------------------------------------------------------

const WHITE = hex("#F4F6FA");

const SCENES = {
  heart: {
    materials: [hex("#E5484D")],
    map(x, y, z, out) {
      const S = 1.72;
      const d2 = sdHeart(x / S, y / S + 0.56) * S;
      out.m = 0;
      return extrudeRound(d2, z, 0.44, 0.4);
    },
  },

  star: {
    materials: [hex("#F5B301")],
    map(x, y, z, out) {
      const d2 = sdStar5(x, y + 0.06, 1.02, 0.5) - 0.1;
      out.m = 0;
      return extrudeRound(d2, z, 0.3, 0.22);
    },
  },

  message: {
    materials: [hex("#2563EB"), WHITE],
    map(x, y, z, out) {
      const box = sdRoundBox2(x, y - 0.14, 1.12, 0.78, 0.42);
      const tail = sdSegment2(x, y, -0.42, -0.5, -0.74, -1.02) - 0.16;
      const body = extrudeRound(smin(box, tail, 0.2), z, 0.34, 0.3);
      let dots = Infinity;
      for (const dx of [-0.46, 0, 0.46]) {
        dots = Math.min(dots, len3(x - dx, y - 0.14, z - 0.3) - 0.15);
      }
      out.m = dots < body ? 1 : 0;
      return Math.min(body, dots);
    },
  },

  check: {
    materials: [hex("#16A34A"), WHITE],
    map(x, y, z, out) {
      const disk = extrudeRound(len2(x, y) - 1.1, z, 0.26, 0.22);
      const zc = 0.28;
      const mark = Math.min(
        sdCapsule(x, y, z, -0.46, 0.02, zc, -0.12, -0.32, zc, 0.12),
        sdCapsule(x, y, z, -0.12, -0.32, zc, 0.5, 0.36, zc, 0.12),
      );
      out.m = mark < disk ? 1 : 0;
      return Math.min(disk, mark);
    },
  },

  lock: {
    materials: [hex("#334155"), hex("#CBD5E1")],
    map(x, y, z, out) {
      const by = y + 0.4;
      let body = extrudeRound(sdRoundBox2(x, by, 0.9, 0.66, 0.26), z, 0.38, 0.22);
      // keyhole, cut into the front face
      const key2 = Math.min(len2(x, by - 0.08) - 0.15, sdRoundBox2(x, by + 0.14, 0.065, 0.2, 0.05));
      const key = Math.max(key2, Math.abs(z - 0.5) - 0.2);
      body = Math.max(body, -key);
      // shackle: a half torus on top of two legs
      const sy = y - 0.3;
      const arc = sdCappedTorus(x, sy, z, 1, 0, 0.56, 0.14);
      const legs = Math.min(
        sdCapsule(x, y, z, -0.56, 0.3, 0, -0.56, -0.1, 0, 0.14),
        sdCapsule(x, y, z, 0.56, 0.3, 0, 0.56, -0.1, 0, 0.14),
      );
      const shackle = Math.min(arc, legs);
      out.m = shackle < body ? 1 : 0;
      return Math.min(body, shackle);
    },
  },
};

// ---------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------

const YAW = (-24 * Math.PI) / 180;
const PITCH = (14 * Math.PI) / 180;
const CY = Math.cos(YAW);
const SY = Math.sin(YAW);
const CP = Math.cos(PITCH);
const SP = Math.sin(PITCH);

const CAM_Z = 6;
const HALF = 0.235; // tan(fov / 2)
const BOUND = 1.75; // bounding sphere radius

const KEY = (() => {
  const l = len3(-0.5, 0.78, 0.62);
  return [-0.5 / l, 0.78 / l, 0.62 / l];
})();

function render(scene) {
  const out = { m: 0 };

  // world -> object: undo the pitch (about x), then the yaw (about y)
  function map(x, y, z) {
    const y1 = CP * y + SP * z;
    const z1 = -SP * y + CP * z;
    const x2 = CY * x - SY * z1;
    const z2 = SY * x + CY * z1;
    return scene.map(x2, y1, z2, out);
  }

  function normal(x, y, z) {
    const e = 0.0008;
    const nx = map(x + e, y, z) - map(x - e, y, z);
    const ny = map(x, y + e, z) - map(x, y - e, z);
    const nz = map(x, y, z + e) - map(x, y, z - e);
    const l = len3(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  function softShadow(x, y, z) {
    let res = 1;
    let t = 0.02;
    for (let i = 0; i < 48 && t < 4; i++) {
      const h = map(x + KEY[0] * t, y + KEY[1] * t, z + KEY[2] * t);
      if (h < 0.0005) return 0;
      res = Math.min(res, (10 * h) / t);
      t += clamp(h, 0.01, 0.2);
    }
    return clamp(res, 0, 1);
  }

  function ao(x, y, z, n) {
    let occ = 0;
    let sca = 1;
    for (let i = 1; i <= 5; i++) {
      const h = 0.03 + 0.1 * i;
      occ += (h - map(x + n[0] * h, y + n[1] * h, z + n[2] * h)) * sca;
      sca *= 0.8;
    }
    return clamp(1 - 1.6 * occ, 0, 1);
  }

  /** One camera ray through image-plane point (u, v) in [-1, 1]. */
  function trace(u, v) {
    let dx = u * HALF;
    let dy = v * HALF;
    let dz = -1;
    const l = len3(dx, dy, dz);
    dx /= l;
    dy /= l;
    dz /= l;

    // bounding sphere at the origin; the camera sits at (0, 0, CAM_Z)
    const b = CAM_Z * dz;
    const c = CAM_Z * CAM_Z - BOUND * BOUND;
    const disc = b * b - c;
    if (disc < 0) return null;
    let t = -b - Math.sqrt(disc);
    const tMax = -b + Math.sqrt(disc);

    for (let i = 0; i < 160 && t < tMax; i++) {
      const x = dx * t;
      const y = dy * t;
      const z = CAM_Z + dz * t;
      const d = map(x, y, z);
      if (d < 0.0004) return shade(x, y, z, dx, dy, dz);
      t += d * 0.9;
    }
    return null;
  }

  function shade(x, y, z, dx, dy, dz) {
    map(x, y, z);
    const base = scene.materials[out.m];
    const mat = out.m;
    const n = normal(x, y, z);
    const px = x + n[0] * 0.002;
    const py = y + n[1] * 0.002;
    const pz = z + n[2] * 0.002;

    const occ = ao(x, y, z, n);
    const dif = Math.max(n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2], 0);
    const sha = dif > 0 ? softShadow(px, py, pz) : 0;

    const hx = KEY[0] - dx;
    const hy = KEY[1] - dy;
    const hz = KEY[2] - dz;
    const hl = len3(hx, hy, hz);
    const ndh = Math.max((n[0] * hx + n[1] * hy + n[2] * hz) / hl, 0);
    const spec = Math.pow(ndh, 60) * 0.55 * sha + Math.pow(ndh, 8) * 0.05;

    const sky = 0.38 * (0.6 + 0.4 * n[1]);
    const bounce = 0.1 * Math.max(-n[1], 0);
    const fres = Math.pow(clamp(1 + (n[0] * dx + n[1] * dy + n[2] * dz), 0, 1), 4) * 0.22;

    const key = [1.0, 0.97, 0.92];
    const skyCol = [0.9, 0.95, 1.05];
    const rgb = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const light = dif * sha * key[i] * 1.05 + (sky * skyCol[i] + bounce) * occ;
      let v = base[i] * light + spec + fres * skyCol[i] * occ;
      v = v / (1 + v * 0.18); // gentle roll-off instead of a hard clip
      rgb[i] = v;
    }
    return { rgb, mat };
  }

  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const sample = (px, py) => trace((2 * px) / SIZE - 1, 1 - (2 * py) / SIZE);

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // rotated-grid 4x, then 16x where the 4 disagree
      const coarse = [
        sample(px + 0.375, py + 0.125),
        sample(px + 0.875, py + 0.375),
        sample(px + 0.125, py + 0.625),
        sample(px + 0.625, py + 0.875),
      ];
      let samples = coarse;
      const hits = coarse.filter(Boolean);
      const mixed =
        (hits.length > 0 && hits.length < 4) ||
        hits.some((h) => h.mat !== hits[0].mat);
      if (mixed) {
        samples = [];
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) samples.push(sample(px + (sx + 0.5) / 4, py + (sy + 0.5) / 4));
        }
      }
      let r = 0;
      let g = 0;
      let bl = 0;
      let count = 0;
      for (const s of samples) {
        if (!s) continue;
        r += s.rgb[0];
        g += s.rgb[1];
        bl += s.rgb[2];
        count += 1;
      }
      const o = (py * SIZE + px) * 4;
      if (!count) continue;
      const enc = (v) => Math.round(clamp(Math.pow(v / count, 1 / 2.2), 0, 1) * 255);
      rgba[o] = enc(r);
      rgba[o + 1] = enc(g);
      rgba[o + 2] = enc(bl);
      rgba[o + 3] = Math.round((count / samples.length) * 255);
    }
  }
  return png.encode(SIZE, SIZE, rgba);
}

function main() {
  const iconDir = config.paths.content.iconFiles;
  const icons = JSON.parse(fs.readFileSync(config.paths.content.icons, "utf8")).filter(
    (i) => i.pack === PACK,
  );
  let rendered = 0;
  for (const icon of icons) {
    const scene = SCENES[icon.id];
    if (!scene) throw new Error(`render-3d: no scene for "${icon.id}"`);
    const file = path.join(iconDir, PACK, icon.png);
    if (!FORCE && fs.existsSync(file)) continue;
    const started = Date.now();
    const data = render(scene);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    rendered += 1;
    console.log(`  ✓ ${PACK}/${icon.png}  ${(data.length / 1024).toFixed(0)} KB  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  console.log(`\n${rendered} rendered`);
}

main();
