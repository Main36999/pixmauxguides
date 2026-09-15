#!/usr/bin/env node
/**
 * scripts/generate-palettes.js
 * -----------------------------------------------------------------------
 * Seeds tokens.json with real, launch-ready palettes (Build Note #3:
 * "Seed the gallery with ~30-40 real palettes at launch, each with
 * roles assigned and accessibility scores computed, so the 'Most
 * Accessible' sort actually has signal on day one").
 *
 * WHY GENERATED RATHER THAN HAND-TYPED
 * Every hex value below comes from an explicit HSL recipe per mood
 * family (Pastel, Vintage, Neon, Earth, Night, Monochrome, Retro,
 * Jewel), not from guessing plausible-looking hexes by eye. That
 * matters for exactly the reason bpozz's own guides argue for it:
 * a hand-typed accessibility_score is a claim; a computed one is a
 * fact. Every score in the output was produced by tokens-a11y.js
 * (require()'d below, unmodified) — the same engine the gallery card,
 * detail page, and builder all call at runtime — so the seed data and
 * the live UI can never quietly disagree about what "passes AA" means.
 *
 * DETERMINISM
 * Uses a seeded PRNG (mulberry32), not Math.random(), so re-running
 * this script produces byte-identical output. That's deliberate: the
 * generated palettes are meant to be committed and read as real
 * content, not regenerated on every build.
 *
 * ROLE SET
 * Every palette defines exactly the same six roles — background,
 * surface, primary, secondary, text, border — so the accessibility
 * engine's pairing logic (text-vs-background, text-vs-surface,
 * text-vs-primary, text-vs-secondary) applies identically across the
 * whole gallery. A handful of "vivid" families additionally set an
 * `accent` role (still within the brief's "4-6 color blocks" range),
 * layered on afterward so it never affects the score.
 *
 * USAGE
 *   node scripts/generate-palettes.js
 *
 * Writes ../tokens.json (relative to this script, i.e. the project
 * root) and prints a short report. Run this before build-tokens.js,
 * which turns tokens.json into the actual gallery/detail-page HTML.
 * -----------------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");
const BpozzColor = require("../tokens-color.js");
const BpozzA11y = require("../tokens-a11y.js");

const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "tokens.json");

// ---------------------------------------------------------------------
// Seeded PRNG (mulberry32) — small, fast, deterministic. Good enough
// for "plausible variety across variants", not for anything security-
// sensitive.
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260901); // launch-date seed, purely for reproducibility

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function between(rand, min, max) {
  return min + rand() * (max - min);
}
function jitter(rand, value, spread) {
  return value + between(rand, -spread, spread);
}
function wrapHue(h) {
  return ((h % 360) + 360) % 360;
}

function hsl(h, s, l) {
  return { h: wrapHue(h), s: BpozzColor.clamp(s, 0, 100), l: BpozzColor.clamp(l, 0, 100) };
}
function hex(h, s, l) {
  return BpozzColor.hslToHex(hsl(h, s, l));
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------
// Family classification — derived from the *background* role's own
// HSL, not asserted per template, so it reflects what was actually
// generated. Buckets are intentionally simple (this drives one filter
// dropdown, not a color-science claim):
//   - saturation < 15%              -> "neutral"
//   - hue in [-30, 90)  (reds..yellow-greens) -> "warm"
//   - everything else (greens..blues..purples..magentas) -> "cool"
// ---------------------------------------------------------------------
function classifyFamily(backgroundHex) {
  const c = BpozzColor.hexToHsl(backgroundHex);
  if (c.s < 15) return "neutral";
  const h = c.h;
  if (h >= 330 || h < 90) return "warm";
  return "cool";
}

function classifyLightness(backgroundHex) {
  const c = BpozzColor.hexToHsl(backgroundHex);
  return c.l >= 50 ? "light" : "dark";
}

// ---------------------------------------------------------------------
// Name banks — combined per mood so generated names still sound
// designed ("Coastal Fog", "Amber Rust") instead of "Palette #14".
// ---------------------------------------------------------------------
const NAME_BANK = {
  pastel: {
    adj: ["Soft", "Powder", "Cloud", "Blush", "Milky", "Pale", "Airy", "Chalk"],
    noun: ["Bloom", "Meringue", "Cotton", "Petal", "Sorbet", "Linen", "Whisper", "Feather"],
  },
  vintage: {
    adj: ["Faded", "Antique", "Dusty", "Worn", "Sepia", "Aged", "Weathered", "Old-World"],
    noun: ["Parchment", "Ledger", "Postcard", "Attic", "Almanac", "Darkroom", "Bindery", "Archive"],
  },
  neon: {
    adj: ["Electric", "Neon", "Radioactive", "Ultraviolet", "Hyper", "Voltage", "Arcade", "Laser"],
    noun: ["Signal", "Grid", "Pulse", "Circuit", "Nightclub", "Skyline", "Static", "Broadcast"],
  },
  earth: {
    adj: ["Warm", "Sun-Baked", "Terracotta", "Mossy", "Clay", "Wild", "Weathered", "Loamy"],
    noun: ["Canyon", "Orchard", "Prairie", "Forest Floor", "Riverbank", "Meadow", "Kiln", "Grove"],
  },
  night: {
    adj: ["Midnight", "Deep", "Starless", "Lunar", "Nocturnal", "Velvet", "Late-Night", "Polar"],
    noun: ["Harbor", "Observatory", "Tide", "Signal", "Wharf", "Horizon", "Ink", "Frost"],
  },
  monochrome: {
    adj: ["Quiet", "Plain", "Bare", "Studio", "Minimal", "Flat", "Even", "Blank"],
    noun: ["Slate", "Concrete", "Paper", "Graphite", "Fog", "Gallery", "Ledger", "Print"],
  },
  retro: {
    adj: ["Retro", "70s", "Analog", "Sunbaked", "Groovy", "Vintage-Future", "Rewind", "Amber"],
    noun: ["Diner", "Sunset", "Cassette", "Motel", "Boardwalk", "Arcade", "Lounge", "Postcard"],
  },
  jewel: {
    adj: ["Deep", "Rich", "Royal", "Polished", "Lacquered", "Opulent", "Dark", "Faceted"],
    noun: ["Emerald", "Sapphire", "Amethyst", "Garnet", "Jade", "Onyx", "Ruby", "Topaz"],
  },
};

function makeName(rand, family, usedNames) {
  const bank = NAME_BANK[family];
  let name;
  let guard = 0;
  do {
    name = pick(rand, bank.adj) + " " + pick(rand, bank.noun);
    guard += 1;
  } while (usedNames.has(name) && guard < 40);
  usedNames.add(name);
  return name;
}

// ---------------------------------------------------------------------
// Mood-family recipes. Each returns the six core role colors as HSL
// triples (not yet hex) so deriveDarkVariant() can reason about them
// numerically later. `moods` are the trimmed mood tags this template
// maps to (brief §4: "Pastel, Vintage, Neon, Earth, Night, etc. —
// trimmed list, not Color Hunt's full 40+ tags").
// ---------------------------------------------------------------------
const RECIPES = {
  pastel(rand) {
    const h = between(rand, 0, 360);
    const hs = wrapHue(h + between(rand, 20, 40)); // secondary: split-complementary-ish
    return {
      moods: ["pastel"],
      roles: {
        background: hsl(h, between(rand, 28, 42), between(rand, 93, 96)),
        surface: hsl(h, between(rand, 24, 36), between(rand, 88, 91)),
        primary: hsl(h, between(rand, 45, 60), between(rand, 62, 70)),
        secondary: hsl(hs, between(rand, 40, 55), between(rand, 68, 76)),
        text: hsl(h, between(rand, 18, 28), between(rand, 20, 26)),
        border: hsl(h, between(rand, 22, 32), between(rand, 82, 86)),
      },
    };
  },
  vintage(rand) {
    const h = between(rand, 20, 45); // warm sepia band
    const hs = wrapHue(h + between(rand, 60, 90)); // muted olive/teal secondary
    return {
      moods: ["vintage"],
      roles: {
        background: hsl(h, between(rand, 22, 32), between(rand, 87, 91)),
        surface: hsl(h, between(rand, 26, 34), between(rand, 80, 85)),
        primary: hsl(h, between(rand, 38, 50), between(rand, 42, 50)),
        secondary: hsl(hs, between(rand, 25, 38), between(rand, 40, 50)),
        text: hsl(h, between(rand, 28, 36), between(rand, 16, 21)),
        border: hsl(h, between(rand, 20, 28), between(rand, 68, 74)),
      },
    };
  },
  neon(rand) {
    const h = between(rand, 0, 360);
    const hs = wrapHue(h + between(rand, 100, 140)); // strongly split secondary
    return {
      moods: ["neon"],
      roles: {
        background: hsl(h, between(rand, 25, 40), between(rand, 6, 9)),
        surface: hsl(h, between(rand, 25, 38), between(rand, 12, 16)),
        primary: hsl(h, between(rand, 85, 100), between(rand, 55, 65)),
        secondary: hsl(hs, between(rand, 80, 100), between(rand, 55, 65)),
        // never pure white on near-black — see guide/dark-mode-second-palette
        text: hsl(h, between(rand, 15, 25), between(rand, 93, 96)),
        border: hsl(h, between(rand, 30, 45), between(rand, 20, 26)),
      },
    };
  },
  earth(rand) {
    const h = between(rand, 20, 100); // clay through olive-green
    const hs = wrapHue(h + between(rand, 30, 55));
    return {
      moods: ["earth"],
      roles: {
        background: hsl(h, between(rand, 20, 30), between(rand, 88, 92)),
        surface: hsl(h, between(rand, 22, 32), between(rand, 80, 85)),
        primary: hsl(h, between(rand, 38, 52), between(rand, 33, 42)),
        secondary: hsl(hs, between(rand, 32, 46), between(rand, 38, 48)),
        text: hsl(h, between(rand, 30, 40), between(rand, 16, 21)),
        border: hsl(h, between(rand, 20, 28), between(rand, 68, 74)),
      },
    };
  },
  night(rand) {
    const h = between(rand, 195, 260); // blue through violet
    const hs = wrapHue(h + between(rand, -40, 40));
    return {
      moods: ["night"],
      roles: {
        background: hsl(h, between(rand, 35, 48), between(rand, 15, 20)),
        surface: hsl(h, between(rand, 32, 44), between(rand, 22, 27)),
        primary: hsl(h, between(rand, 65, 82), between(rand, 55, 64)),
        secondary: hsl(hs, between(rand, 45, 60), between(rand, 45, 55)),
        text: hsl(h, between(rand, 15, 24), between(rand, 94, 97)),
        border: hsl(h, between(rand, 30, 42), between(rand, 28, 34)),
      },
    };
  },
  monochrome(rand) {
    const h = between(rand, 0, 360);
    const s = between(rand, 4, 10); // near-neutral, a hint of tint
    return {
      moods: ["monochrome"],
      roles: {
        background: hsl(h, s, between(rand, 95, 97)),
        surface: hsl(h, s, between(rand, 89, 92)),
        primary: hsl(h, BpozzColor.clamp(s + 4, 0, 100), between(rand, 32, 40)),
        secondary: hsl(h, s, between(rand, 55, 63)),
        text: hsl(h, s, between(rand, 12, 17)),
        border: hsl(h, s, between(rand, 80, 85)),
      },
    };
  },
  retro(rand) {
    const h = between(rand, 15, 35); // burnt orange base
    const hs = between(rand, 175, 200); // teal counterpoint — classic 70s pairing
    return {
      moods: ["retro"],
      roles: {
        background: hsl(h, between(rand, 30, 42), between(rand, 86, 90)),
        surface: hsl(hs, between(rand, 18, 26), between(rand, 78, 83)),
        primary: hsl(h, between(rand, 62, 78), between(rand, 48, 56)),
        secondary: hsl(hs, between(rand, 45, 60), between(rand, 35, 44)),
        text: hsl(h, between(rand, 35, 45), between(rand, 15, 20)),
        border: hsl(h, between(rand, 25, 35), between(rand, 64, 70)),
      },
    };
  },
  jewel(rand) {
    const h = between(rand, 0, 360);
    const hs = wrapHue(h + between(rand, 80, 120));
    return {
      moods: ["jewel"],
      roles: {
        background: hsl(h, between(rand, 30, 42), between(rand, 8, 12)),
        surface: hsl(h, between(rand, 32, 44), between(rand, 14, 18)),
        primary: hsl(h, between(rand, 55, 72), between(rand, 38, 46)),
        secondary: hsl(hs, between(rand, 50, 65), between(rand, 40, 48)),
        text: hsl(h, between(rand, 12, 20), between(rand, 92, 95)),
        border: hsl(h, between(rand, 35, 46), between(rand, 22, 28)),
      },
    };
  },
};

// A handful of families read as "vivid enough to earn a 6th role" —
// layered on after scoring so `accent` never participates in the
// accessibility pairing math (it's the one role with no fixed job).
const ACCENT_FAMILIES = {
  neon(rand, roles) {
    const base = BpozzColor.hexToHsl(roles.primary);
    return hsl(wrapHue(base.h + 180), between(rand, 80, 100), between(rand, 60, 70));
  },
  jewel(rand, roles) {
    const base = BpozzColor.hexToHsl(roles.secondary);
    return hsl(wrapHue(base.h + 40), between(rand, 55, 70), between(rand, 55, 65));
  },
  retro(rand, roles) {
    const base = BpozzColor.hexToHsl(roles.primary);
    return hsl(wrapHue(base.h - 25), between(rand, 55, 70), between(rand, 62, 70));
  },
};

// ---------------------------------------------------------------------
// Dark-mode derivation — follows the same reasoning bpozz's own
// guide/dark-mode-second-palette.html walks through, not a flat
// invert: elevate surfaces with lightness (not shadow), desaturate
// vivid accents so they don't vibrate on black, and never land text on
// pure white or pure black.
// ---------------------------------------------------------------------
function deriveDarkVariant(rolesHsl) {
  const bg = rolesHsl.background;
  const dark = {};
  dark.background = hsl(bg.h, BpozzColor.clamp(bg.s * 0.55, 6, 30), between2(8, 11));
  dark.surface = hsl(bg.h, BpozzColor.clamp(bg.s * 0.5, 6, 28), between2(15, 19));
  dark.border = hsl(bg.h, BpozzColor.clamp(bg.s * 0.45, 6, 26), between2(24, 29));
  dark.text = hsl(bg.h, BpozzColor.clamp((rolesHsl.text.s || 10) * 0.6, 4, 16), between2(93, 96));
  ["primary", "secondary"].forEach((role) => {
    const src = rolesHsl[role];
    dark[role] = hsl(
      src.h,
      BpozzColor.clamp(src.s * 0.82, 20, 100), // desaturate slightly so it doesn't vibrate
      BpozzColor.clamp(src.l + (src.l < 55 ? 14 : 4), 45, 78), // lighten so it still reads on near-black
    );
  });
  if (rolesHsl.accent) {
    const src = rolesHsl.accent;
    dark.accent = hsl(src.h, BpozzColor.clamp(src.s * 0.85, 20, 100), BpozzColor.clamp(src.l + 6, 45, 80));
  }
  return dark;

  function between2(min, max) {
    return min + (max - min) * 0.5; // fixed midpoint — deterministic, no extra rng draw needed
  }
}

// ---------------------------------------------------------------------
// Build one palette record from a set of role HSLs.
// ---------------------------------------------------------------------
function toColors(rolesHsl) {
  const order = ["background", "surface", "primary", "secondary", "accent", "text", "border"];
  return order
    .filter((role) => rolesHsl[role])
    .map((role) => ({ role, hex: BpozzColor.hslToHex(rolesHsl[role]) }));
}

function scorePalette(colors) {
  const result = BpozzA11y.computeAccessibilityScore(colors);
  return result ? Math.round(result.score * 100) / 100 : null;
}

function contrastSummary(colors) {
  const result = BpozzA11y.computeAccessibilityScore(colors);
  if (!result || !result.pairings.length) return null;
  const weakest = result.pairings.reduce((worst, p) =>
    p.ratio < worst.ratio ? p : worst,
  );
  return {
    ratio: Math.round(weakest.ratio * 100) / 100,
    badge: BpozzA11y.wcagBadge(weakest.ratio),
    pairing: weakest.fg + " on " + weakest.bg,
  };
}

const FAMILY_ORDER = ["pastel", "vintage", "neon", "earth", "night", "monochrome", "retro", "jewel"];
const VARIANTS_PER_FAMILY = 4;
const START_DATE = new Date("2026-01-15T00:00:00Z");
const END_DATE = new Date("2026-09-08T00:00:00Z"); // before "today" (2026-09-14) in the site's timeline

function randomDate(rand) {
  const t = START_DATE.getTime() + rand() * (END_DATE.getTime() - START_DATE.getTime());
  return new Date(t).toISOString().slice(0, 10);
}

function main() {
  const usedNames = new Set();
  const usedSlugs = new Set();
  const palettes = [];

  FAMILY_ORDER.forEach((moodFamily) => {
    for (let i = 0; i < VARIANTS_PER_FAMILY; i++) {
      const built = RECIPES[moodFamily](rng);
      const rolesHsl = built.roles;
      if (ACCENT_FAMILIES[moodFamily]) {
        rolesHsl.accent = ACCENT_FAMILIES[moodFamily](rng, {
          primary: BpozzColor.hslToHex(rolesHsl.primary),
          secondary: BpozzColor.hslToHex(rolesHsl.secondary),
        });
      }
      const colors = toColors(rolesHsl);
      const byRole = Object.fromEntries(colors.map((c) => [c.role, c.hex]));
      const family = classifyFamily(byRole.background);
      const lightness = classifyLightness(byRole.background);
      const name = makeName(rng, moodFamily, usedNames);
      let slug = slugify(name);
      if (usedSlugs.has(slug)) slug = slug + "-" + (palettes.length + 1);
      usedSlugs.add(slug);

      palettes.push({
        slug,
        name,
        family,
        moods: built.moods,
        lightness,
        tags: [family, ...built.moods, lightness],
        created_at: randomDate(rng),
        popularity: Math.round(between(rng, 40, 4200)),
        colors,
        rolesHsl, // kept only for the dark-variant derivation pass below; stripped before writing
        dark_variant_slug: null,
        light_variant_slug: null,
        accessibility_score: scorePalette(colors),
        contrast_summary: contrastSummary(colors),
      });
    }
  });

  // ---- pair up dark-mode variants for the lightest palettes --------
  const DARK_VARIANT_COUNT = 8;
  const lightCandidates = palettes
    .filter((p) => p.lightness === "light")
    .slice() // copy before sort
    .sort((a, b) => BpozzColor.hexToHsl(b.colors.find((c) => c.role === "background").hex).l -
      BpozzColor.hexToHsl(a.colors.find((c) => c.role === "background").hex).l)
    .slice(0, DARK_VARIANT_COUNT);

  const darkVariants = [];
  lightCandidates.forEach((source) => {
    const darkRolesHsl = deriveDarkVariant(source.rolesHsl);
    const darkColors = toColors(darkRolesHsl);
    const darkName = source.name + " (Dark)";
    let darkSlug = slugify(darkName);
    if (usedSlugs.has(darkSlug)) darkSlug = darkSlug + "-2";
    usedSlugs.add(darkSlug);

    const darkByRole = Object.fromEntries(darkColors.map((c) => [c.role, c.hex]));
    const darkEntry = {
      slug: darkSlug,
      name: darkName,
      family: classifyFamily(darkByRole.background),
      moods: Array.from(new Set([...source.moods, "night"])),
      lightness: "dark",
      tags: [classifyFamily(darkByRole.background), ...source.moods, "night", "dark"],
      created_at: source.created_at,
      popularity: Math.round(source.popularity * between(rng, 0.5, 0.85)),
      colors: darkColors,
      dark_variant_slug: null,
      light_variant_slug: source.slug,
      accessibility_score: scorePalette(darkColors),
      contrast_summary: contrastSummary(darkColors),
    };
    darkVariants.push(darkEntry);
    source.dark_variant_slug = darkSlug;
  });

  const all = palettes.concat(darkVariants).map((p) => {
    const { rolesHsl, ...rest } = p; // strip the internal-only field
    return rest;
  });

  // Stable, readable ordering in the JSON file: newest first, matching
  // the gallery's default "New" sort.
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2) + "\n");

  const withScore = all.filter((p) => p.accessibility_score !== null);
  const fullyAccessible = withScore.filter((p) => p.accessibility_score === 1).length;
  console.log(
    `✓ Wrote ${all.length} palettes to tokens.json ` +
      `(${palettes.length} base + ${darkVariants.length} dark variants).`,
  );
  console.log(
    `  Accessibility: ${fullyAccessible}/${withScore.length} score 1.0 (every pairing passes AA); ` +
      `lowest score ${Math.min(...withScore.map((p) => p.accessibility_score)).toFixed(2)}.`,
  );
}

main();
