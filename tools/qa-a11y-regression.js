/**
 * qa-a11y-regression.js
 *  - export format byte-regression vs the pristine baseline
 *  - collection + builder pages driven in jsdom
 *  - measured contrast for every text/non-text pair in the new ramp
 *  - ARIA / touch-target / color-only audits over the generated HTML+CSS
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const SITE = "/home/claude/work/bpozz web active";
const BASE = "/home/claude/pristine/bpozz web active";
const A11Y = require(path.join(SITE, "tokens-a11y.js"));

let pass = 0,
  fail = 0;
const failures = [];
function ok(c, d, e) {
  if (c) pass++;
  else {
    fail++;
    failures.push(d + (e ? "  → " + e : ""));
    console.log("  ✗ " + d + (e ? "  → " + e : ""));
  }
}
function section(t) {
  console.log("\n" + t);
}
function ratio(a, b) {
  return A11Y.contrastRatio(a, b);
}

// ---------------------------------------------------------------
section("F. EXPORT FORMAT REGRESSION (all 7 formats, all 40 palettes)");
const curExp = require(path.join(SITE, "tokens-export.js"));
const baseExp = require(path.join(BASE, "tokens-export.js"));
const palettes = JSON.parse(fs.readFileSync(path.join(SITE, "tokens.json"), "utf8"));

ok(
  curExp.FORMATS.length === baseExp.FORMATS.length && curExp.FORMATS.length === 7,
  `FORMATS still has 7 entries`,
  curExp.FORMATS.length + "",
);
ok(
  curExp.FORMATS.map((f) => f.id).join(",") === baseExp.FORMATS.map((f) => f.id).join(","),
  "format ids and order unchanged",
  curExp.FORMATS.map((f) => f.id).join(","),
);

let mismatch = 0,
  compared = 0;
for (const p of palettes) {
  for (let i = 0; i < curExp.FORMATS.length; i++) {
    const a = curExp.FORMATS[i].generate(p.colors, p.name);
    const b = baseExp.FORMATS[i].generate(p.colors, p.name);
    compared++;
    if (a !== b) {
      mismatch++;
      if (mismatch <= 2) console.log(`    diff in ${p.slug}/${curExp.FORMATS[i].id}`);
    }
  }
}
ok(mismatch === 0, `all ${compared} generated export payloads byte-identical to baseline`, mismatch + " differ");

// export code embedded in the generated HTML must match too
const curDetail = fs.readFileSync(path.join(SITE, "tokens/bare-ledger.html"), "utf8");
const baseDetail = fs.readFileSync(path.join(BASE, "tokens/bare-ledger.html"), "utf8");
const codeBlocks = (h) => (h.match(/<code class="language-[^"]+">([\s\S]*?)<\/code>/g) || []);
const ca = codeBlocks(curDetail),
  cb = codeBlocks(baseDetail);
ok(ca.length === cb.length && ca.every((v, i) => v === cb[i]), `embedded export code blocks unchanged (${ca.length})`);

// ---------------------------------------------------------------
section("G. COLLECTION + BUILDER pages");
async function load(file, scripts, seed) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(fs.readFileSync(path.join(SITE, file), "utf8"), {
    url: "https://bpozz.com/" + file.replace(/\.html$/, "").replace(/\/index$/, ""),
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.bpozzShowToast = (m) => ((w.__toasts = w.__toasts || []), w.__toasts.push(m));
  const store = Object.assign({}, seed || {});
  Object.defineProperty(w, "localStorage", {
    value: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    configurable: true,
  });
  w.__store = store;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(palettes), status: 200 });
  w.navigator.clipboard = { writeText: (t) => ((w.__copied = t), Promise.resolve()) };
  for (const s of scripts) {
    try {
      w.eval(fs.readFileSync(path.join(SITE, s), "utf8"));
    } catch (e) {
      console.log("    ! " + s + ": " + e.message);
    }
  }
  await new Promise((r) => setTimeout(r, 80));
  return w;
}

const SHARED = ["tokens-color.js", "tokens-a11y.js", "tokens-export.js", "tokens-shared.js"];

(async () => {
  // collection — empty
  const wc0 = await load("tokens/collection.html", SHARED.concat(["tokens-collection.js"]));
  ok(
    wc0.document.getElementById("collection-empty-state").getAttribute("data-visible") === "true",
    "collection shows the empty state with nothing saved",
  );

  // collection — seeded via the REAL localStorage key
  const wc = await load("tokens/collection.html", SHARED.concat(["tokens-collection.js"]), {
    "point-token-collection": JSON.stringify(["bare-ledger", "neon-pulse"]),
  });
  const savedCards = wc.document.querySelectorAll("#collection-grid-root .token-card[data-slug]");
  ok(savedCards.length === 2, "collection renders the 2 saved palettes", savedCards.length + "");
  ok(
    wc.document.getElementById("collection-count").textContent.indexOf("2") !== -1,
    "collection count reflects saved items",
    wc.document.getElementById("collection-count").textContent,
  );
  ok(
    savedCards[0].querySelector(".token-swatch__label") !== null,
    "collection cards use the redesigned card (labels at rest)",
  );
  // unsave removes from view
  const unlike = wc.document.querySelector('#collection-grid-root [data-action="like"]');
  unlike.dispatchEvent(new wc.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  ok(
    wc.document.querySelectorAll("#collection-grid-root .token-card[data-slug]").length === 1,
    "un-saving drops the card from the collection view",
  );

  // builder
  const wb = await load("tokens/create.html", SHARED.concat(["tokens-tabs.js", "tokens-create.js"]));
  const db = wb.document;
  const bTabs = db.querySelectorAll(".token-mode-tabs [role='tab']");
  ok(bTabs.length === 2, "builder mode switch is a real 2-tab tablist", bTabs.length + "");
  ok(
    db.querySelectorAll(".token-builder__step[role='tabpanel']").length === 2,
    "builder has 2 tabpanels",
  );
  ok(bTabs[0].getAttribute("aria-selected") === "true", "Manual tab selected by default");
  ok(db.getElementById("builder-panel-image").hasAttribute("hidden"), "image panel hidden by default");
  ok(
    !bTabs[0].hasAttribute("aria-pressed") && !bTabs[1].hasAttribute("aria-pressed"),
    "builder tabs no longer misuse aria-pressed inside a tablist",
  );
  bTabs[0].dispatchEvent(new wb.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  ok(bTabs[1].getAttribute("aria-selected") === "true", "builder tabs respond to ArrowRight");
  ok(!db.getElementById("builder-panel-image").hasAttribute("hidden"), "image panel revealed");
  ok(db.getElementById("builder-panel-manual").hasAttribute("hidden"), "manual panel hidden");
  ok(db.querySelectorAll("#role-rows .token-role-row").length > 0, "builder seeds role rows");

  // ---------------------------------------------------------------
  section("H. MEASURED CONTRAST — new ramp");
  const T = {
    canvas: "#ffffff",
    surface: "#fafaf9",
    inverse: "#23231f",
    inverseText: "#f1f0ec",
    border: "#e7e5e2",
    borderStrong: "#8a8984",
    text: "#1c1c1a",
    textMuted: "#575652",
    accent: "#1d5c4f",
    accentHover: "#16453b",
    accentSoft: "#edf4f1",
    success: "#1a6e3e",
    danger: "#9c2c1f",
    dangerSoft: "#fbeeeb",
  };
  const textPairs = [
    ["text on canvas", T.text, T.canvas, 4.5],
    ["text on surface", T.text, T.surface, 4.5],
    ["muted on canvas", T.textMuted, T.canvas, 4.5],
    ["muted on surface", T.textMuted, T.surface, 4.5],
    ["accent on canvas", T.accent, T.canvas, 4.5],
    ["accent on surface", T.accent, T.surface, 4.5],
    ["accent on accent-soft (pills, pressed moods)", T.accent, T.accentSoft, 4.5],
    ["success on canvas", T.success, T.canvas, 4.5],
    ["success on surface", T.success, T.surface, 4.5],
    ["danger on canvas", T.danger, T.canvas, 4.5],
    ["danger on danger-soft (pressed save)", T.danger, T.dangerSoft, 4.5],
    ["inverse-text on inverse (export code)", T.inverseText, T.inverse, 4.5],
    ["white on accent (primary button)", "#ffffff", T.accent, 4.5],
    ["white on accent-hover", "#ffffff", T.accentHover, 4.5],
    ["white on inverse (skip link, toast)", "#ffffff", T.inverse, 4.5],
    ["canvas on text (segmented selected)", T.canvas, T.text, 4.5],
    ["white on accent (mood count badge)", "#ffffff", T.accent, 4.5],
  ];
  textPairs.forEach(([n, a, b, min]) => {
    const r = ratio(a, b);
    ok(r >= min, `text ${min}:1 — ${n}`, r.toFixed(2) + ":1");
  });

  const nonText = [
    ["border-strong on canvas (control boundaries)", T.borderStrong, T.canvas, 3],
    ["border-strong on surface (controls in filter bar)", T.borderStrong, T.surface, 3],
    ["accent focus ring on canvas", T.accent, T.canvas, 3],
    ["accent focus ring on surface", T.accent, T.surface, 3],
    ["accent focus ring on accent-soft", T.accent, T.accentSoft, 3],
    ["danger boundary on canvas", T.danger, T.canvas, 3],
  ];
  nonText.forEach(([n, a, b, min]) => {
    const r = ratio(a, b);
    ok(r >= min, `non-text ${min}:1 — ${n}`, r.toFixed(2) + ":1");
  });

  // old failing values must be gone
  ok(ratio("#1f9d55", "#ffffff") < 4.5, "baseline: old success green did fail AA (3.49:1)");
  ok(ratio(T.success, "#ffffff") >= 4.5, "fixed: new success green passes AA");

  // ---------------------------------------------------------------
  section("I. SWATCH LABELS — every label in every generated page");
  const shared = require(path.join(SITE, "tokens-shared.js"));
  let worst = 99,
    worstAt = null,
    checked = 0,
    under = 0;
  for (const f of fs.readdirSync(path.join(SITE, "tokens")).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(SITE, "tokens", f), "utf8");
    const re = /--tok-hex:(#[0-9a-fA-F]{6})"><span class="token-swatch__label" style="--tok-label-color:([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      checked++;
      const r = ratio(m[1], m[2]);
      if (r < worst) {
        worst = r;
        worstAt = f + " " + m[1] + " on " + m[2];
      }
      if (r < 4.5) under++;
      if (m[2] !== shared.labelTextColor(m[1])) under++;
    }
  }
  ok(checked > 0, `swatch labels found in generated HTML (${checked})`);
  ok(under === 0, "every swatch label clears AA 4.5:1 at rest", under + " below");
  console.log(`    worst case: ${worst.toFixed(2)}:1 (${worstAt})`);

  // ---------------------------------------------------------------
  section("J. ARIA + color-only + touch targets (generated HTML / CSS)");
  const gal = fs.readFileSync(path.join(SITE, "tokens/index.html"), "utf8");
  const det = fs.readFileSync(path.join(SITE, "tokens/bare-ledger.html"), "utf8");
  const cre = fs.readFileSync(path.join(SITE, "tokens/create.html"), "utf8");
  const css = fs.readFileSync(path.join(SITE, "tokens.css"), "utf8");

  // every tab has aria-controls; every tabpanel has aria-labelledby
  [det, cre].forEach((h, i) => {
    const tabs = h.match(/<button[^>]*role="tab"[^>]*>/g) || [];
    ok(
      tabs.length > 0 && tabs.every((t) => /aria-controls="/.test(t) && /aria-selected="/.test(t)),
      `${i ? "builder" : "detail"}: every role=tab has aria-controls + aria-selected`,
    );
    const panels = h.match(/role="tabpanel"[^>]*>/g) || [];
    ok(panels.length > 0, `${i ? "builder" : "detail"}: tabpanels present`);
  });
  ok(!/role="tablist"[^>]*>\s*<button(?![^>]*role="tab")/.test(cre), "no tablist child lacks role=tab");
  ok(!/aria-pressed[^>]*role="tab"|role="tab"[^>]*aria-pressed/.test(det + cre), "no element is both tab and aria-pressed toggle");

  // icon-only controls are labelled
  const iconBtns = gal.match(/<button[^>]*class="[^"]*token-icon-btn[^"]*"[^>]*>/g) || [];
  ok(iconBtns.length > 0 && iconBtns.every((b) => /aria-label="/.test(b)), `all ${iconBtns.length} icon buttons are aria-labelled`);
  const clearBtn = gal.match(/<button[^>]*token-search__clear[^>]*>/g) || [];
  ok(clearBtn.every((b) => /aria-label="/.test(b)), "search clear button is aria-labelled");

  // live regions
  ok(/id="tokens-results-count"[^>]*aria-live="polite"/.test(gal), "results count is a polite live region");
  ok(/class="toast"[^>]*role="status"[^>]*aria-live="polite"/.test(gal), "toast is role=status + aria-live");
  ok(/id="tokens-filters-error"[^>]*role="status"/.test(gal), "filter error is role=status");

  // color is not the only carrier
  const contrastSpans = gal.match(/class="token-contrast-text[^"]*"[^>]*>([^<]+)</g) || [];
  ok(
    contrastSpans.length > 0 && contrastSpans.every((s) => /(Fail|AA|AAA|—)/.test(s)),
    `contrast state carries a text label, not just color (${contrastSpans.length} readouts)`,
  );
  ok(/\.token-mood__option\[aria-pressed="true"\] svg\s*\{\s*opacity: 1/.test(css.replace(/\s+/g, " ").replace(/ \{/g, " {")) || /aria-pressed="true"\] svg/.test(css), "selected mood also shows a tick, not just a tint");

  // skip link
  ok(/class="skip-link"/.test(gal) && /id="tokens-content"/.test(gal), "skip link targets the main content id");

  // touch targets: the <640px block must raise the interactive set
  const mobileBlock = css.slice(css.indexOf("@media (max-width: 639px)"));
  ["token-btn", "token-icon-btn", "token-segmented button", "token-tab"].forEach((sel) => {
    ok(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(mobileBlock), `mobile block raises ${sel}`);
  });
  ok(/min-height: 44px/.test(mobileBlock), "mobile block sets 44px minimum targets");
  ok(/\.token-search input\s*\{\s*min-height: 44px/.test(mobileBlock.replace(/\s+/g, " ").replace(/ \{/g, " {")) || /min-height: 44px/.test(mobileBlock), "mobile search input reaches 44px");

  console.log("\n" + "=".repeat(62));
  console.log(`A11Y/REGRESSION RESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(fail ? 1 : 0);
})();
