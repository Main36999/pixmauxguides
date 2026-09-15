/**
 * tokens-shared.js
 * -----------------------------------------------------------------------
 * Shared building blocks for the whole /tokens feature: the palette
 * card's markup (cardHtml), the "on this device" collection (Collections,
 * §3.6), and small clipboard/formatting helpers.
 *
 * COLLECTIONS AND THE SITE'S AUTH SYSTEM
 * Per Build Note #1 ("check whether the site already has an auth/
 * account system before adding one for collections — reuse it"): bpozz
 * has none. The only existing precedent for "a visitor's state that
 * persists" is the roadmap page's progress checklist, which is plain
 * localStorage under the key "point-roadmap-progress" — no login, tied
 * to one browser. Collections follow that exact same precedent rather
 * than introducing accounts for one feature: saved palettes and
 * builder-created palettes live in localStorage ("point-token-
 * collection" / "point-custom-palettes"), scoped to the device. See
 * TOKENS-FEATURE-HANDOFF.md for the tradeoffs and what real accounts
 * would change.
 *
 * ISOMORPHIC BY DESIGN
 * cardHtml() has no DOM or localStorage dependency — it's a pure
 * string template, callable from Node (build-tokens.js, to pre-render
 * the gallery grid at build time) or the browser (tokens-gallery.js /
 * tokens-collection.js, to re-render after a client-side fetch). Same
 * relationship as app.js's cardHtml() to build-home.js. Everything
 * that touches localStorage/clipboard/DOM is guarded and simply isn't
 * called from the Node side.
 *
 * Usage:
 *   Browser: load after tokens-color.js, tokens-a11y.js, tokens-export.js
 *            <script src="/tokens-shared.js"></script> -> window.BpozzTokens
 *   Node:    const BpozzTokens = require("./tokens-shared.js");
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./tokens-color.js"),
      require("./tokens-a11y.js"),
      require("./tokens-export.js"),
    );
  } else {
    root.BpozzTokens = factory(root.BpozzColor, root.BpozzA11y, root.BpozzExport);
  }
})(typeof self !== "undefined" ? self : this, function (BpozzColor, BpozzA11y, BpozzExport) {
  "use strict";

  var hasWindow = typeof window !== "undefined";
  var hasStorage = hasWindow && (function () {
    try {
      var k = "__bpozz_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false; // private-browsing Safari, storage disabled, etc.
    }
  })();

  var COLLECTION_KEY = "point-token-collection";
  var CUSTOM_KEY = "point-custom-palettes";
  var TOKENS_JSON_URL = "/tokens.json";

  var ROLE_LABEL = {
    background: "Background",
    surface: "Surface",
    primary: "Primary",
    secondary: "Secondary",
    accent: "Accent",
    text: "Text",
    border: "Border",
  };

  var MOOD_LABEL = {
    pastel: "Pastel",
    vintage: "Vintage",
    neon: "Neon",
    earth: "Earth",
    night: "Night",
    monochrome: "Monochrome",
    retro: "Retro",
    jewel: "Jewel",
  };

  var FAMILY_LABEL = { warm: "Warm", cool: "Cool", neutral: "Neutral" };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function escapeAttr(obj) {
    return escapeHtml(JSON.stringify(obj));
  }

  function byRole(colors) {
    var map = {};
    (colors || []).forEach(function (c) {
      map[c.role] = c.hex;
    });
    return map;
  }

  function roleLabel(role) {
    return ROLE_LABEL[role] || role.charAt(0).toUpperCase() + role.slice(1);
  }

  // Picks readable label text (near-black or near-white) for text sitting
  // directly on a given swatch color — used for the on-swatch role/hex
  // label and the live preview's button label, not part of the palette's
  // own accessibility score.
  function labelTextColor(hex) {
    var lum = BpozzA11y.relativeLuminance(hex);
    return lum !== null && lum > 0.42 ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.85)";
  }
  function onColor(hex) {
    var lum = BpozzA11y.relativeLuminance(hex);
    return lum !== null && lum > 0.55 ? "#111111" : "#ffffff";
  }

  // Inline CSS custom properties for a live-preview/mini-preview block —
  // see the --tok-* naming note at the top of tokens.css.
  function cssVarsStyle(colors) {
    var map = byRole(colors);
    var parts = [];
    Object.keys(map).forEach(function (role) {
      parts.push("--tok-" + role + ":" + map[role]);
    });
    if (map.primary) parts.push("--tok-on-primary:" + onColor(map.primary));
    return parts.join(";");
  }

  function swatchesHtml(colors, opts) {
    opts = opts || {};
    var max = opts.max || colors.length;
    return colors
      .slice(0, max)
      .map(function (c) {
        var labelColor = labelTextColor(c.hex);
        return (
          '<div class="token-swatch" style="--tok-hex:' +
          c.hex +
          '">' +
          '<span class="token-swatch__label" style="--tok-label-color:' +
          labelColor +
          '">' +
          "<strong>" +
          escapeHtml(roleLabel(c.role)) +
          "</strong> " +
          escapeHtml(c.hex) +
          "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  // Compact badge for a card: the WEAKEST pairing in the palette, not
  // the average — "a palette's contrast is only as strong as its
  // weakest link" reads as more honest (and more useful at a glance)
  // than a flattering mean. Falls back to computing on the fly if
  // contrast_summary wasn't precomputed (e.g. a builder draft).
  function contrastSummaryFor(p) {
    if (p.contrast_summary) return p.contrast_summary;
    var result = BpozzA11y.computeAccessibilityScore(p.colors);
    if (!result || !result.pairings.length) return null;
    var weakest = result.pairings.reduce(function (worst, pr) {
      return pr.ratio < worst.ratio ? pr : worst;
    });
    return {
      ratio: Math.round(weakest.ratio * 100) / 100,
      badge: BpozzA11y.wcagBadge(weakest.ratio),
      pairing: weakest.fg + " on " + weakest.bg,
    };
  }

  // Plain-text contrast readout, meant to sit inline inside a meta line
  // (card-meta / hero meta) rather than as a standalone chip. The site
  // retired the bordered/mono ".badge" look for passive metadata — see
  // guide-article.css's guide-hero__meta comment, which explains why
  // that pairing "read as a different, more 'tech-spec' style than the
  // rest of the site's minimal card meta" — so this renders as colored
  // text only (no border, no background, no forced monospace),
  // matching how the rest of the site conveys state through color and
  // weight rather than a pill.
  function contrastTextHtml(p) {
    var summary = contrastSummaryFor(p);
    if (!summary) return "";
    var pass = summary.badge !== "Fail";
    return (
      '<span class="token-contrast-text ' +
      (pass ? "token-contrast-text--pass" : "token-contrast-text--fail") +
      '" title="' +
      escapeHtml(summary.pairing) +
      '">' +
      summary.ratio.toFixed(2) +
      ":1 " +
      escapeHtml(summary.badge) +
      "</span>"
    );
  }

  var ICONS = {
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
    heartFilled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  };

  // The palette card — used by the gallery grid, the collection grid,
  // and pre-rendered at build time for /tokens/index.html. Sits inside
  // the site's real .grid > .guide-card structure (styles.css) so the
  // rhythm matches the guide grid exactly; only .token-swatches and
  // .token-card-actions are new (see tokens.css §2).
  function cardHtml(p) {
    var colors = p.colors.slice(0, 6);
    var moods = (p.moods || []).map(function (m) {
      return MOOD_LABEL[m] || m;
    });
    var meta = (FAMILY_LABEL[p.family] || p.family) + (moods.length ? " · " + moods.join(", ") : "");
    var contrast = contrastTextHtml(p);
    return (
      '<article class="guide-card token-card" data-slug="' +
      escapeHtml(p.slug) +
      '">' +
      '<div class="token-swatches">' +
      swatchesHtml(colors) +
      "</div>" +
      '<div class="card-body">' +
      '<h3 class="card-title"><a class="card-link" href="/tokens/' +
      escapeHtml(p.slug) +
      '">' +
      escapeHtml(p.name) +
      "</a></h3>" +
      '<p class="card-meta">' +
      escapeHtml(meta) +
      (contrast ? " · " + contrast : "") +
      "</p>" +
      '<div class="token-card-actions">' +
      '<button type="button" class="token-icon-btn token-like-btn" data-action="like" data-slug="' +
      escapeHtml(p.slug) +
      '" aria-pressed="false" aria-label="Save ' +
      escapeHtml(p.name) +
      ' to your collection">' +
      ICONS.heart +
      "</button>" +
      '<button type="button" class="token-icon-btn token-copy-btn" data-action="copy-css" data-colors="' +
      escapeAttr(colors) +
      '" aria-label="Copy ' +
      escapeHtml(p.name) +
      ' as CSS variables">' +
      ICONS.copy +
      "</button>" +
      '<a class="token-icon-btn" href="/tokens/' +
      escapeHtml(p.slug) +
      '#export" aria-label="View export formats for ' +
      escapeHtml(p.name) +
      '">' +
      ICONS.download +
      "</a>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  // ---- data loading (browser) ---------------------------------------
  var tokensPromise = null;
  function fetchAll() {
    if (!hasWindow) {
      return Promise.reject(new Error("fetchAll() is browser-only"));
    }
    if (!tokensPromise) {
      tokensPromise = fetch(TOKENS_JSON_URL)
        .then(function (res) {
          if (!res.ok) throw new Error("tokens.json " + res.status);
          return res.json();
        })
        .catch(function (err) {
          tokensPromise = null; // allow a retry on the next call
          throw err;
        });
    }
    return tokensPromise;
  }

  // ---- collections (localStorage, browser-only) ----------------------
  function readList(key) {
    if (!hasStorage) return [];
    try {
      var raw = window.localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  function writeList(key, list) {
    if (!hasStorage) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(list));
      return true;
    } catch (e) {
      return false; // e.g. storage full or disabled mid-session
    }
  }

  function getCollectionSlugs() {
    return readList(COLLECTION_KEY);
  }
  function isSaved(slug) {
    return getCollectionSlugs().indexOf(slug) !== -1;
  }
  // Returns the new saved state (true/false) so callers can update a
  // button's aria-pressed without a second lookup.
  function toggleSaved(slug) {
    var list = getCollectionSlugs();
    var idx = list.indexOf(slug);
    if (idx === -1) {
      list.push(slug);
      writeList(COLLECTION_KEY, list);
      return true;
    }
    list.splice(idx, 1);
    writeList(COLLECTION_KEY, list);
    return false;
  }

  function getCustomPalettes() {
    return readList(CUSTOM_KEY);
  }
  function saveCustomPalette(palette) {
    var list = getCustomPalettes().filter(function (p) {
      return p.slug !== palette.slug;
    });
    list.unshift(palette);
    writeList(CUSTOM_KEY, list);
    // A palette built locally is saved to the collection too, by
    // definition — otherwise it would vanish from every gallery view.
    var saved = getCollectionSlugs();
    if (saved.indexOf(palette.slug) === -1) {
      saved.push(palette.slug);
      writeList(COLLECTION_KEY, saved);
    }
  }
  function removeCustomPalette(slug) {
    writeList(
      CUSTOM_KEY,
      getCustomPalettes().filter(function (p) {
        return p.slug !== slug;
      }),
    );
  }

  // ---- clipboard + toast (browser-only) ------------------------------
  function toast(message) {
    if (hasWindow && typeof window.bpozzShowToast === "function") {
      window.bpozzShowToast(message);
    }
  }

  function copyText(text, successMessage) {
    if (!hasWindow) return Promise.reject(new Error("copyText() is browser-only"));
    var done = function () {
      toast(successMessage || "Copied to clipboard");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, function () {
        return legacyCopy(text) ? done() : toast("Couldn't copy — select and copy manually");
      });
    }
    return Promise.resolve(legacyCopy(text) ? done() : toast("Couldn't copy — select and copy manually"));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Wires up event delegation for like/copy buttons inside a rendered
  // grid. Call once after inserting cardHtml() markup (or after any
  // re-render, since it's delegated on the container and safe to call
  // repeatedly). `onUnlike` fires when a palette is removed from the
  // collection view specifically (the collection page needs to drop
  // the card from view; the gallery just flips the icon).
  function wireCardActions(container, opts) {
    if (!container || container.__bpozzWired) return;
    container.__bpozzWired = true;
    opts = opts || {};
    container.addEventListener("click", function (evt) {
      var likeBtn = evt.target.closest && evt.target.closest('[data-action="like"]');
      if (likeBtn) {
        var slug = likeBtn.getAttribute("data-slug");
        var nowSaved = toggleSaved(slug);
        likeBtn.setAttribute("aria-pressed", String(nowSaved));
        toast(nowSaved ? "Saved to your collection" : "Removed from your collection");
        if (!nowSaved && typeof opts.onUnsave === "function") opts.onUnsave(slug);
        return;
      }
      var copyBtn = evt.target.closest && evt.target.closest('[data-action="copy-css"]');
      if (copyBtn) {
        var raw = copyBtn.getAttribute("data-colors");
        try {
          var colors = JSON.parse(raw);
          copyText(BpozzExport.toCss(colors), "Copied CSS variables");
        } catch (e) {
          toast("Couldn't read this palette's colors");
        }
      }
    });
  }

  // Syncs every like-button's aria-pressed with localStorage — call
  // after inserting/re-rendering cards, since SSR/first-paint markup
  // has no way to know what's saved on this particular device.
  function syncLikedState(container) {
    if (!container) return;
    var saved = getCollectionSlugs();
    container.querySelectorAll('[data-action="like"]').forEach(function (btn) {
      var slug = btn.getAttribute("data-slug");
      btn.setAttribute("aria-pressed", String(saved.indexOf(slug) !== -1));
    });
  }

  return {
    COLLECTION_KEY: COLLECTION_KEY,
    CUSTOM_KEY: CUSTOM_KEY,
    ROLE_LABEL: ROLE_LABEL,
    MOOD_LABEL: MOOD_LABEL,
    FAMILY_LABEL: FAMILY_LABEL,
    escapeHtml: escapeHtml,
    byRole: byRole,
    roleLabel: roleLabel,
    labelTextColor: labelTextColor,
    onColor: onColor,
    cssVarsStyle: cssVarsStyle,
    swatchesHtml: swatchesHtml,
    contrastSummaryFor: contrastSummaryFor,
    contrastTextHtml: contrastTextHtml,
    cardHtml: cardHtml,
    ICONS: ICONS,
    fetchAll: fetchAll,
    getCollectionSlugs: getCollectionSlugs,
    isSaved: isSaved,
    toggleSaved: toggleSaved,
    getCustomPalettes: getCustomPalettes,
    saveCustomPalette: saveCustomPalette,
    removeCustomPalette: removeCustomPalette,
    copyText: copyText,
    toast: toast,
    wireCardActions: wireCardActions,
    syncLikedState: syncLikedState,
  };
});
