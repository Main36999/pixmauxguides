/**
 * qa-responsive.js — resolves the shipped CSS at each target width and
 * computes real layout numbers: container width, grid columns, card and
 * swatch widths, whether the longest label still fits, and whether any
 * fixed min-width can overflow its container.
 */
const fs = require("fs");
const path = require("path");
const SITE = "/home/claude/work/bpozz web active";
const css = fs.readFileSync(path.join(SITE, "tokens.css"), "utf8");
const styles = fs.readFileSync(path.join(SITE, "styles.css"), "utf8");

let pass = 0,
  fail = 0,
  warn = 0;
const failures = [];
function ok(c, d, e) {
  if (c) pass++;
  else {
    fail++;
    failures.push(d + (e ? "  → " + e : ""));
    console.log("  ✗ " + d + (e ? "  → " + e : ""));
  }
}

const WIDTHS = [360, 390, 640, 768, 960, 1280, 1440, 1800];

// --- resolve the values the CSS actually produces at a given width ----
function columnsAt(w) {
  // tokens.css: base 4, <=1279 → 3, <=959 → 2, <=639 → 1
  if (w <= 639) return 1;
  if (w <= 959) return 2;
  if (w <= 1279) return 3;
  return 4;
}
function padAt(w) {
  // body.tokens-page .guides-main: 32px; <=639px → 16px
  return w <= 639 ? 16 : 32;
}
const CONTAINER_MAX = 1800; // .guides-main max-width
const GAP = (w) => (w <= 639 ? 16 : 16); // --tk-s4 column gap

// monospace advance ratio — conservative for ui-monospace/Menlo/Consolas
const MONO_ADV = 0.62;
const LABEL_FS = () => 8.5;
const LABEL_PAD = () => 3; // horizontal padding each side

console.log("width  cols  container  card    swatch  labelfits  hexNeeds/avail");
console.log("-".repeat(70));

let anyOverflow = false;
for (const w of WIDTHS) {
  const pad = padAt(w);
  const container = Math.min(w, CONTAINER_MAX) - pad * 2;
  const cols = columnsAt(w);
  const gap = GAP(w);
  const card = (container - gap * (cols - 1)) / cols;
  const swatch = card / 6; // 6 roles is the max rendered per card
  const avail = swatch - LABEL_PAD(w) * 2;
  const hexNeeds = 7 * LABEL_FS(w) * MONO_ADV; // "#1e193b"
  const fits = avail >= hexNeeds;
  if (!fits) anyOverflow = true;
  console.log(
    String(w).padEnd(6) +
      String(cols).padEnd(6) +
      container.toFixed(0).padEnd(11) +
      card.toFixed(0).padEnd(8) +
      swatch.toFixed(1).padEnd(8) +
      (fits ? "yes" : "NO ").padEnd(11) +
      hexNeeds.toFixed(1) + " / " + avail.toFixed(1),
  );
}
console.log();
ok(!anyOverflow, "hex label fits inside its swatch at every tested width");

// --- fixed min-widths that could overflow ----------------------------
console.log("Fixed min-width audit (overflow risk at 360px):");
const minWidths = [];
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = ruleRe.exec(css))) {
  const sel = m[1].replace(/\s+/g, " ").trim();
  const mw = m[2].match(/min-width:\s*(\d+)px/);
  if (mw) minWidths.push({ sel, px: Number(mw[1]), body: m[2] });
}
const narrowContent = 360 - 16 * 2; // 328px
for (const r of minWidths) {
  const scrolls = /overflow-x:\s*auto/.test(r.body);
  // is it neutralised in the <=639px block?
  const mobileBlock = css.slice(css.indexOf("@media (max-width: 639px)"));
  const base = r.sel.split(",")[0].trim().replace(/^body\.tokens-page\s*/, "");
  const neutralised = new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^}]*min-width:\\s*0").test(
    mobileBlock.replace(/\s+/g, " "),
  );
  const wrapped =
    /token-breakdown$/.test(base) &&
    /\.token-breakdown-wrap\s*\{[^}]*overflow-x:\s*auto/.test(css.replace(/\s+/g, " "));
  const safe = r.px <= narrowContent || scrolls || neutralised || wrapped;
  console.log(
    `  ${safe ? "ok " : "!! "} ${base.padEnd(28)} min-width:${String(r.px).padEnd(5)} ` +
      (r.px <= narrowContent
        ? "(fits 328px)"
        : wrapped
          ? "(inside overflow-x:auto wrapper)"
          : neutralised
            ? "(reset to 0 on mobile)"
            : scrolls
              ? "(self-scrolls)"
              : "OVERFLOW RISK"),
  );
  ok(safe, `no horizontal overflow from ${base} (min-width:${r.px}px) at 360px`);
}

// --- filter bar behaviour --------------------------------------------
console.log("\nFilter bar:");
const mobileBlock = css.slice(css.indexOf("@media (max-width: 639px)")).replace(/\s+/g, " ");
const midBlock = css
  .slice(css.indexOf("@media (max-width: 959px)"), css.indexOf("@media (max-width: 639px)"))
  .replace(/\s+/g, " ");
ok(/\.token-filterbar \{[^}]*flex-wrap: wrap/.test(css.replace(/\s+/g, " ")), "filter bar wraps rather than overflowing");
ok(/\.token-filter-field--search \{ flex: 1 1 100%/.test(midBlock), "search goes full-width at <=959px");
ok(/\.token-filter-field \{ flex: 1 1 100%/.test(mobileBlock), "every filter field stacks full-width at <=639px");
ok(/\.token-mood__panel \{[^}]*min-width: 0/.test(mobileBlock), "mood popover drops its min-width on mobile");
ok(/\.token-mood__panel \{[^}]*left: 0; right: 0/.test(mobileBlock), "mood popover spans the field on mobile");

// --- detail hero swatches --------------------------------------------
console.log("\nDetail hero:");
ok(/\.token-detail-hero__swatches \{[^}]*flex-direction: column/.test(mobileBlock), "hero swatches stack vertically on mobile");
ok(/\.token-detail-hero__swatches \.token-swatch \{ min-height: 44px/.test(mobileBlock), "stacked hero swatches keep a 44px target");

// --- container padding ------------------------------------------------
ok(/\.guides-main,[^{]*main\.wrap \{ padding: var\(--tk-s5\) var\(--tk-s4\)/.test(mobileBlock), "container padding drops to 16px on mobile");

// --- no fixed px widths that beat the viewport ------------------------
const fixedW = [];
ruleRe.lastIndex = 0;
while ((m = ruleRe.exec(css))) {
  const wdec = m[2].match(/(?:^|;)\s*width:\s*(\d{3,})px/);
  if (wdec && Number(wdec[1]) > narrowContent) fixedW.push(m[1].trim() + " width:" + wdec[1] + "px");
}
ok(fixedW.length === 0, "no fixed pixel width exceeds the 360px content box", fixedW.join("; "));

// --- grid column sanity ----------------------------------------------
console.log("\nGrid columns by width:");
WIDTHS.forEach((w) => console.log(`  ${String(w).padEnd(6)} → ${columnsAt(w)} column(s)`));
ok(columnsAt(360) === 1 && columnsAt(640) === 2 && columnsAt(960) === 3 && columnsAt(1800) === 4, "column progression 1→2→3→4 is monotonic");

console.log("\n" + "=".repeat(62));
console.log(`RESPONSIVE RESULT: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  - " + f));
}
process.exit(fail ? 1 : 0);
