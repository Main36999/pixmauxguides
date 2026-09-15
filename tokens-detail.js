/**
 * tokens-detail.js
 * -----------------------------------------------------------------------
 * Page-specific script for every /tokens/<slug>.html page: the hero's
 * like/copy buttons, the export panel's tab switching + per-format
 * copy, and the light/dark mode toggle (when a paired variant exists).
 *
 * Everything this file needs — the palette's own colors, and its
 * paired variant's colors — is already embedded in the page's markup
 * by build-tokens.js (data-colors / data-self-colors / data-other-
 * colors attributes), so there's no tokens.json fetch on this page at
 * all: the detail page works fully offline once loaded.
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
})();
