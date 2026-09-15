/**
 * tokens-detail.js
 * -----------------------------------------------------------------------
 * Page-specific script for every /tokens/<slug>.html page: the hero's
 * like/copy buttons, the export panel's tab switching + per-format
 * copy, the light/dark mode toggle (when a paired variant exists), and
 * the "more palettes" rail at the bottom of the page.
 *
 * Everything except the rail is already embedded in the page's own
 * markup by build-tokens.js (data-colors / data-self-colors / data-
 * other-colors attributes), so only the rail needs a tokens.json fetch
 * — same as app.js's related-guides rail needing guides.json. Without
 * that fetch (offline, blocked), the page still works; the rail's
 * <aside> just stays empty and hidden (see .guide-rail:empty).
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  var main = document.getElementById("tokens-content");
  if (!main) return;

  // ---- like + hero copy-as-CSS ---------------------------------------
  BpozzTokens.wireCardActions(main);
  BpozzTokens.syncLikedState(main);

  // ---- export panel: tabs + per-format copy --------------------------
  var exportRoot = document.getElementById("export");
  if (exportRoot) {
    var tabs = exportRoot.querySelectorAll(".token-export__tab");
    var panels = exportRoot.querySelectorAll(".token-export__panel");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        tabs.forEach(function (t) {
          t.setAttribute("aria-selected", String(t === tab));
        });
        panels.forEach(function (p) {
          p.setAttribute("data-active", String(p.getAttribute("data-panel") === id));
        });
      });
    });
    exportRoot.querySelectorAll("[data-copy-format]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pre = btn.parentElement.querySelector("pre code");
        if (pre) BpozzTokens.copyText(pre.textContent, "Copied " + btn.getAttribute("data-copy-format").toUpperCase());
      });
    });
  }

  // ---- light/dark mode toggle -----------------------------------------
  var toggle = document.querySelector('[data-toggle="mode"]');
  if (toggle) {
    var previewEl = document.getElementById("preview-self");
    var selfColors, otherColors;
    try {
      selfColors = JSON.parse(toggle.getAttribute("data-self-colors") || "[]");
      otherColors = JSON.parse(toggle.getAttribute("data-other-colors") || "[]");
    } catch (e) {
      selfColors = [];
      otherColors = [];
    }
    var buttons = toggle.querySelectorAll("button");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-mode");
        buttons.forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        if (previewEl) {
          previewEl.setAttribute("style", BpozzTokens.cssVarsStyle(mode === "self" ? selfColors : otherColors));
        }
      });
    });
  }

  // ---- "more palettes" rail --------------------------------------------
  // Ships as a static, empty <aside id="token-rail"> (see build-tokens.js)
  // and gets filled in here once tokens.json resolves — same pattern as
  // app.js's initRelatedGuides() for the /guide/ pages' related rail:
  // reuse cardHtml() so this reads as the identical minimal card used on
  // the gallery, not a bespoke rail treatment, and drop the section
  // entirely (rather than leave an empty box) if there's nothing to show.
  var tokenRail = document.getElementById("token-rail");
  if (tokenRail) {
    var currentSlug = document.body.getAttribute("data-slug");
    BpozzTokens.fetchAll()
      .then(function (all) {
        var current = all.filter(function (p) {
          return p.slug === currentSlug;
        })[0];
        var related = current ? BpozzTokens.relatedPalettes(current, all, 10) : [];
        if (!related.length) {
          tokenRail.remove();
          return;
        }
        tokenRail.innerHTML =
          '<span class="section-label mono guide-rail__label">/ more palettes</span>' +
          '<div class="grid guide-rail__list">' +
          related.map(BpozzTokens.cardHtml).join("") +
          "</div>";
        BpozzTokens.wireCardActions(tokenRail);
        BpozzTokens.syncLikedState(tokenRail);
      })
      .catch(function (err) {
        console.error(err);
        // Leave the <aside> empty rather than remove it — .guide-rail:empty
        // already hides it, and a later retry (e.g. back-forward cache
        // restore) still has a hook to fill in.
      });
  }
})();
