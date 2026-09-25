#!/usr/bin/env node
/**
 * scripts/icons/render-png.js — renders the PNG of every VECTOR icon from its
 * own SVG, using headless Chrome as the rasterizer.
 *
 *     node scripts/icons/render-png.js            render missing PNGs
 *     node scripts/icons/render-png.js --force    re-render every PNG
 *
 * AUTHORING TOOL, NOT A BUILD STEP. Like scripts/fonts/import-google-fonts.js
 * it runs once when icons are added, and its output is committed under
 * public/icons/<pack>/png/. The build publishes those files verbatim and never
 * runs a browser, so a deploy host needs no Chrome and the output gate never
 * depends on one machine's rasterizer.
 *
 * What it produces: a 512×512 transparent PNG of the SVG exactly as published,
 * with currentColor resolved to black (#000, the site's --text). Only icons
 * whose record names a `png` AND an `svg` are rendered here; raster-only
 * styles (3D) come from scripts/icons/render-3d.js instead.
 *
 * Chrome is found at CHROME_PATH, or the usual install locations.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const config = require("../../site.config.js");
const png = require("./png.js");

const SIZE = 512;
const FORCE = process.argv.includes("--force");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

function findChrome() {
  const found = CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chrome/Edge found. Set CHROME_PATH.");
  return found;
}

function main() {
  const chrome = findChrome();
  const iconDir = config.paths.content.iconFiles;
  const icons = JSON.parse(fs.readFileSync(config.paths.content.icons, "utf8"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bpozz-icons-"));

  let rendered = 0;
  let skipped = 0;
  try {
    for (const icon of icons) {
      if (!icon.svg || !icon.png) continue;
      const svgPath = path.join(iconDir, icon.pack, icon.svg);
      const pngPath = path.join(iconDir, icon.pack, icon.png);
      if (!FORCE && fs.existsSync(pngPath)) {
        skipped += 1;
        continue;
      }

      const svg = fs.readFileSync(svgPath, "utf8");
      const page = path.join(tmp, "icon.html");
      fs.writeFileSync(
        page,
        `<!doctype html><html><head><style>html,body{margin:0;background:transparent;color:#000}` +
          `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body>${svg}</body></html>`,
      );
      const shot = path.join(tmp, "shot.png");
      execFileSync(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          "--default-background-color=00000000",
          `--window-size=${SIZE},${SIZE}`,
          `--screenshot=${shot}`,
          pathToFileURL(page).href,
        ],
        { stdio: "ignore" },
      );

      const out = fs.readFileSync(shot);
      const head = png.readHeader(out);
      if (head.width !== SIZE || head.height !== SIZE) {
        throw new Error(`${icon.pack}/${icon.id}: Chrome produced ${head.width}×${head.height}, expected ${SIZE}×${SIZE}`);
      }
      fs.mkdirSync(path.dirname(pngPath), { recursive: true });
      fs.writeFileSync(pngPath, out);
      rendered += 1;
      console.log(`  ✓ ${icon.pack}/${icon.png}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${rendered} rendered, ${skipped} already present`);
}

main();
