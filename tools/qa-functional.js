/**
 * qa-functional.js — drives the REAL generated /tokens/ pages in jsdom.
 * Not a mock: it loads tokens/index.html and tokens/<slug>.html off disk,
 * executes the shipped scripts, and asserts on the resulting DOM.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const SITE = "/home/claude/work/bpozz web active";
const TOKENS = JSON.parse(fs.readFileSync(path.join(SITE, "tokens.json"), "utf8"));

let pass = 0,
  fail = 0;
const failures = [];
function ok(cond, desc, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(desc + (extra ? "  → " + extra : ""));
    console.log("  ✗ " + desc + (extra ? "  → " + extra : ""));
  }
}
function section(t) {
  console.log("\n" + t);
}

/** Build a DOM for a generated page with the shipped scripts executed. */
async function load(file, scripts, url) {
  const html = fs.readFileSync(path.join(SITE, file), "utf8");
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(html, {
    url: url || "https://bpozz.com/tokens",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  // Stubs the shipped code expects from the browser/app.js.
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  w.bpozzShowToast = (m) => {
    w.__toasts = w.__toasts || [];
    w.__toasts.push(m);
  };
  const store = {};
  Object.defineProperty(w, "localStorage", {
    value: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    configurable: true,
  });
  w.__store = store;
  // fetch for tokens.json
  w.fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(TOKENS), status: 200 });
  w.navigator.clipboard = {
    writeText: (t) => {
      w.__copied = t;
      return Promise.resolve();
    },
  };

  for (const s of scripts) {
    const code = fs.readFileSync(path.join(SITE, s), "utf8");
    try {
      w.eval(code);
    } catch (e) {
      console.log("  ! script error in " + s + ": " + e.message);
    }
  }
  await new Promise((r) => setTimeout(r, 60)); // let fetch().then settle
  return w;
}

const GALLERY_SCRIPTS = [
  "tokens-color.js",
  "tokens-a11y.js",
  "tokens-export.js",
  "tokens-shared.js",
  "tokens-gallery.js",
];
const DETAIL_SCRIPTS = [
  "tokens-color.js",
  "tokens-a11y.js",
  "tokens-export.js",
  "tokens-shared.js",
  "tokens-tabs.js",
  "tokens-detail.js",
];

function cards(w) {
  return w.document.querySelectorAll("#tokens-grid-root .token-card[data-slug]");
}
function fire(el, type, init) {
  const w = el.ownerDocument.defaultView;
  const Ev = type.startsWith("key") ? w.KeyboardEvent : w.MouseEvent;
  el.dispatchEvent(new Ev(type, Object.assign({ bubbles: true, cancelable: true }, init || {})));
}
async function tick(ms) {
  await new Promise((r) => setTimeout(r, ms || 220));
}

(async () => {
  // =================================================================
  section("A. FUNCTIONAL — gallery");
  const w = await load("tokens/index.html", GALLERY_SCRIPTS);
  const d = w.document;

  ok(cards(w).length === 40, "server-rendered grid holds all 40 palettes", cards(w).length + " found");
  ok(
    d.getElementById("tokens-results-count").textContent.indexOf("40 of 40") !== -1,
    "results count reads 40 of 40",
  );

  // --- search
  const search = d.getElementById("token-search-input");
  search.value = "sorbet";
  fire(search, "input");
  await tick();
  const sorbet = TOKENS.filter((p) => /sorbet/i.test(p.name)).length;
  ok(cards(w).length === sorbet, `search "sorbet" narrows to ${sorbet}`, cards(w).length + " shown");

  search.value = "#6c5554"; // Bare Ledger primary
  fire(search, "input");
  await tick();
  ok(cards(w).length >= 1, "search by hex value matches", cards(w).length + " shown");
  ok(
    Array.from(cards(w)).some((c) => c.getAttribute("data-slug") === "bare-ledger"),
    "hex search finds the owning palette (bare-ledger)",
  );

  search.value = "primary";
  fire(search, "input");
  await tick();
  ok(cards(w).length === 40, "search by role name matches all palettes with that role", cards(w).length + "");

  // --- clear button
  const clearBtn = d.getElementById("token-search-clear");
  fire(clearBtn, "click");
  await tick();
  ok(cards(w).length === 40, "search clear restores full grid");
  ok(
    d.getElementById("token-search").getAttribute("data-has-value") === "false",
    "clear resets the has-value hook",
  );

  // --- family
  const fam = d.getElementById("family-select");
  fam.value = "warm";
  fire(fam, "change");
  await tick();
  const warm = TOKENS.filter((p) => p.family === "warm").length;
  ok(cards(w).length === warm, `family=warm shows ${warm}`, cards(w).length + "");

  fam.value = "all";
  fire(fam, "change");
  await tick();

  // --- mood
  const trigger = d.getElementById("token-mood-trigger");
  const panel = d.getElementById("token-mood-panel");
  ok(panel.hidden === true, "mood popover starts closed");
  fire(trigger, "click");
  ok(panel.hidden === false, "mood popover opens on click");
  ok(trigger.getAttribute("aria-expanded") === "true", "trigger aria-expanded flips to true");

  const pastel = panel.querySelector('[data-mood="pastel"]');
  fire(pastel, "click");
  await tick();
  const pastelCount = TOKENS.filter((p) => (p.moods || []).indexOf("pastel") !== -1).length;
  ok(cards(w).length === pastelCount, `mood=pastel shows ${pastelCount}`, cards(w).length + "");
  ok(pastel.getAttribute("aria-pressed") === "true", "selected mood reports aria-pressed");
  ok(
    d.getElementById("token-mood-summary").textContent === "1 selected",
    "mood trigger summarises the count",
    d.getElementById("token-mood-summary").textContent,
  );

  // --- AND combination + empty state
  const neon = panel.querySelector('[data-mood="neon"]');
  fire(neon, "click");
  await tick();
  ok(cards(w).length === 0, "pastel AND neon returns nothing (AND semantics)");
  ok(
    d.getElementById("tokens-empty-state").getAttribute("data-visible") === "true",
    "empty state becomes visible",
  );

  // --- pills
  const af = d.getElementById("tokens-active-filters");
  ok(af.hidden === false, "active-filter row is shown");
  ok(af.querySelectorAll(".token-pill").length === 2, "two mood pills rendered", af.querySelectorAll(".token-pill").length + "");
  const neonPill = af.querySelector('[data-clear-value="neon"]');
  ok(!!neonPill, "pill carries its mood value for removal");
  fire(neonPill, "click");
  await tick();
  ok(cards(w).length === pastelCount, "removing the neon pill restores pastel-only results");

  // --- sort
  const sort = d.getElementById("sort-select");
  sort.value = "accessible";
  fire(sort, "change");
  await tick();
  const first = cards(w)[0].getAttribute("data-slug");
  const bestPastel = TOKENS.filter((p) => (p.moods || []).indexOf("pastel") !== -1)
    .slice()
    .sort((a, b) => {
      const sa = a.accessibility_score === null ? -1 : a.accessibility_score;
      const sb = b.accessibility_score === null ? -1 : b.accessibility_score;
      if (sb !== sa) return sb - sa;
      return (b.popularity || 0) - (a.popularity || 0);
    })[0].slug;
  ok(first === bestPastel, "sort=accessible puts the highest-scoring palette first", first + " vs " + bestPastel);

  // --- URL state
  ok(w.location.search.indexOf("mood=pastel") !== -1, "URL carries mood", w.location.search);
  ok(w.location.search.indexOf("sort=accessible") !== -1, "URL carries sort", w.location.search);

  // --- clear all
  const clearAll = d.getElementById("tokens-clear-all");
  ok(!!clearAll, "Clear all control present");
  fire(clearAll, "click");
  await tick();
  ok(cards(w).length === 40, "clear all restores the full grid");
  ok(af.hidden === true, "pill row hides when no filters are active");
  ok(w.location.search === "", "URL returns to clean path", JSON.stringify(w.location.search));

  // --- copy + save
  const copyBtn = d.querySelector('#tokens-grid-root [data-action="copy-css"]');
  fire(copyBtn, "click");
  await tick(40);
  ok(typeof w.__copied === "string" && w.__copied.indexOf("--color-") !== -1, "copy writes CSS variables to clipboard");
  ok((w.__toasts || []).some((t) => /Copied/i.test(t)), "copy raises a toast");

  const likeBtn = d.querySelector('#tokens-grid-root [data-action="like"]');
  const likeSlug = likeBtn.getAttribute("data-slug");
  fire(likeBtn, "click");
  ok(likeBtn.getAttribute("aria-pressed") === "true", "save flips aria-pressed");
  ok(
    (w.__store["point-token-collection"] || "").indexOf(likeSlug) !== -1,
    "save persists to the collection localStorage key (point-token-collection)",
    Object.keys(w.__store).join(","),
  );

  // =================================================================
  section("B. URL restore + back/forward");
  const w2 = await load(
    "tokens/index.html",
    GALLERY_SCRIPTS,
    "https://bpozz.com/tokens?family=cool&mood=night&sort=new",
  );
  await tick();
  const cool = TOKENS.filter((p) => p.family === "cool" && (p.moods || []).indexOf("night") !== -1).length;
  ok(cards(w2).length === cool, `deep link ?family=cool&mood=night restores ${cool} results`, cards(w2).length + "");
  ok(w2.document.getElementById("family-select").value === "cool", "deep link rehydrates the family select");
  ok(
    w2.document.getElementById("token-mood-panel").querySelector('[data-mood="night"]').getAttribute("aria-pressed") === "true",
    "deep link rehydrates the mood option",
  );
  ok(
    w2.document.querySelectorAll("#tokens-active-filters .token-pill").length === 2,
    "deep link renders matching pills",
  );

  // popstate
  w2.history.replaceState(null, "", "?family=warm");
  fire(w2.document.body, "click"); // noop
  w2.dispatchEvent(new w2.PopStateEvent("popstate"));
  await tick();
  const warm2 = TOKENS.filter((p) => p.family === "warm").length;
  ok(cards(w2).length === warm2, "popstate re-reads the URL and re-filters", cards(w2).length + "");

  // =================================================================
  section("C. No-JS / server-rendered grid");
  const rawHtml = fs.readFileSync(path.join(SITE, "tokens/index.html"), "utf8");
  const noJs = new JSDOM(rawHtml).window.document;
  ok(
    noJs.querySelectorAll("#tokens-grid-root .token-card[data-slug]").length === 40,
    "all 40 cards present without any JS",
  );
  ok(
    noJs.querySelectorAll('#tokens-grid-root a.card-link[href^="/tokens/"]').length === 40,
    "every card links out without JS",
  );
  ok(
    noJs.querySelectorAll("#tokens-grid-root .token-swatch__label").length === 240,
    "role+hex labels are in the served HTML (visible at rest)",
    noJs.querySelectorAll("#tokens-grid-root .token-swatch__label").length + "",
  );
  ok(noJs.getElementById("tokens-empty-state") !== null, "empty state ships hidden, not JS-injected");

  // =================================================================
  section("D. Detail page + export tabs (keyboard)");
  const wd = await load("tokens/bare-ledger.html", DETAIL_SCRIPTS, "https://bpozz.com/tokens/bare-ledger");
  const dd = wd.document;
  const tablist = dd.querySelector("#export .token-tabs");
  const tabs = tablist.querySelectorAll('[role="tab"]');
  ok(tabs.length === 7, "7 export format tabs", tabs.length + "");
  ok(
    dd.querySelectorAll("#export [role='tabpanel']").length === 7,
    "7 matching tabpanels",
  );
  let ariaOk = true;
  tabs.forEach((t) => {
    const p = dd.getElementById(t.getAttribute("aria-controls"));
    if (!p || p.getAttribute("aria-labelledby") !== t.id) ariaOk = false;
  });
  ok(ariaOk, "every tab↔panel pair is cross-referenced (aria-controls / aria-labelledby)");

  ok(tabs[0].getAttribute("tabindex") === "0", "selected tab is in the tab sequence");
  ok(tabs[1].getAttribute("tabindex") === "-1", "unselected tabs are removed from the tab sequence (roving)");
  ok(dd.getElementById("export-panel-scss").hasAttribute("hidden"), "inactive panel is hidden");

  fire(tabs[0], "keydown", { key: "ArrowRight" });
  ok(tabs[1].getAttribute("aria-selected") === "true", "ArrowRight moves selection");
  ok(!dd.getElementById("export-panel-scss").hasAttribute("hidden"), "ArrowRight reveals the new panel");
  ok(dd.getElementById("export-panel-css").hasAttribute("hidden"), "previous panel is hidden again");

  fire(tabs[1], "keydown", { key: "End" });
  ok(tabs[6].getAttribute("aria-selected") === "true", "End jumps to the last tab");
  fire(tabs[6], "keydown", { key: "Home" });
  ok(tabs[0].getAttribute("aria-selected") === "true", "Home jumps to the first tab");
  fire(tabs[0], "keydown", { key: "ArrowLeft" });
  ok(tabs[6].getAttribute("aria-selected") === "true", "ArrowLeft wraps to the last tab");

  // export copy
  fire(tabs[0], "keydown", { key: "Home" });
  const copyFmt = dd.querySelector('#export-panel-css [data-copy-format="css"]');
  fire(copyFmt, "click");
  await tick(40);
  ok(
    typeof wd.__copied === "string" && wd.__copied.indexOf("--color-background") !== -1,
    "per-format copy sends that panel's code to the clipboard",
  );

  // light/dark toggle
  const toggle = dd.querySelector('[data-toggle="mode"]');
  ok(!!toggle, "light/dark preview toggle present on a paired palette");
  const other = toggle.querySelector('[data-mode="other"]');
  const preview = dd.getElementById("preview-self");
  const beforeStyle = preview.getAttribute("style");
  fire(other, "click");
  ok(preview.getAttribute("style") !== beforeStyle, "toggling mode re-themes the live preview");
  ok(other.getAttribute("aria-pressed") === "true", "toggle reports pressed state");

  // =================================================================
  section("E. Regression — protected data");
  const pristine = JSON.parse(fs.readFileSync("/home/claude/pristine/bpozz web active/tokens.json", "utf8"));
  ok(
    JSON.stringify(pristine) === JSON.stringify(TOKENS),
    "tokens.json is byte-identical to the baseline",
  );

  // data-colors payload
  const genHtml = fs.readFileSync(path.join(SITE, "tokens/index.html"), "utf8");
  const pristineHtml = fs.readFileSync("/home/claude/pristine/bpozz web active/tokens/index.html", "utf8");
  const grab = (h) => (h.match(/data-colors="([^"]+)"/g) || []).sort();
  const a = grab(genHtml),
    b = grab(pristineHtml);
  ok(a.length === b.length && a.every((v, i) => v === b[i]), `data-colors payloads unchanged (${a.length})`);

  // hex values
  const hexes = (h) => (h.match(/--tok-hex:(#[0-9a-f]{6})/g) || []).sort();
  const ha = hexes(genHtml),
    hb = hexes(pristineHtml);
  ok(ha.length === hb.length && ha.every((v, i) => v === hb[i]), `swatch hex values unchanged (${ha.length})`);

  console.log("\n" + "=".repeat(62));
  console.log(`FUNCTIONAL/KEYBOARD RESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(fail ? 1 : 0);
})();
