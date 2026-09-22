/**
 * html.js — the site's one HTML-escaping helper.
 * -----------------------------------------------------------------------
 * PHASE 3 (deduplication). Before this file, escapeHtml() existed as six
 * byte-for-byte copies: app.js, build-home.js, build-categories.js,
 * build-header.js, build-footer.js and the token builder. All six were
 * verified to produce identical output for the same input; this is that
 * one implementation, transcribed from app.js unchanged.
 *
 * One further copy is deliberately NOT folded in here:
 *
 *   palettes.js   published and loaded by every /palettes page via its
 *                 own <script> tag.
 *
 * It is a published browser module with its own load contract. Making it
 * depend on this file would need a new public URL (forbidden — the URL
 * surface is frozen) or an undeclared load-order dependency on /app.js.
 *
 * UMD shape, so the site keeps one module idiom rather than gaining a
 * second:
 *
 *   Browser: concatenated into /app.js by the build -> window.BpozzHtml
 *   Node:    const { escapeHtml } = require("./html.js");
 *
 * This file is a BUILD INPUT ONLY. It is never published on its own — see
 * APP_BUNDLE in src/build.js.
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BpozzHtml = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }

  return { escapeHtml: escapeHtml };
});
