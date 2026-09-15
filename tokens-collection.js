/**
 * tokens-collection.js
 * -----------------------------------------------------------------------
 * Page-specific script for /tokens/collection.html. A saved palette is
 * one of two things:
 *   - a seed-gallery slug in localStorage's "point-token-collection"
 *     list, whose full data (colors, scores, etc.) is looked up from
 *     the fetched tokens.json — same source of truth as the gallery.
 *   - a fully custom palette built in /tokens/create, stored whole in
 *     "point-custom-palettes" (it has no entry in tokens.json).
 * Both render through the same BpozzTokens.cardHtml(), so a
 * builder-made palette looks and behaves exactly like a library one.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  var gridRoot = document.getElementById("collection-grid-root");
  var emptyState = document.getElementById("collection-empty-state");
  var countEl = document.getElementById("collection-count");
  if (!gridRoot) return;

  function render(seedPalettes) {
    var savedSlugs = BpozzTokens.getCollectionSlugs();
    var customBySlug = {};
    BpozzTokens.getCustomPalettes().forEach(function (p) {
      customBySlug[p.slug] = p;
    });
    var seedBySlug = {};
    (seedPalettes || []).forEach(function (p) {
      seedBySlug[p.slug] = p;
    });

    var resolved = savedSlugs
      .map(function (slug) {
        return customBySlug[slug] || seedBySlug[slug] || null;
      })
      .filter(Boolean);

    gridRoot.innerHTML = resolved.map(BpozzTokens.cardHtml).join("");
    BpozzTokens.syncLikedState(gridRoot);
    countEl.textContent = resolved.length
      ? resolved.length + " palette" + (resolved.length === 1 ? "" : "s") + " saved to this browser"
      : "Nothing saved yet";
    if (resolved.length) emptyState.removeAttribute("data-visible");
    else emptyState.setAttribute("data-visible", "true");
  }

  BpozzTokens.wireCardActions(gridRoot, {
    onUnsave: function (slug) {
      // A custom (builder-made) palette only ever lives in localStorage
      // — once it's un-saved here, there is nowhere else it can be
      // found again, so remove it outright rather than leaving an
      // orphaned entry no page will ever surface.
      var customSlugs = BpozzTokens.getCustomPalettes().map(function (p) {
        return p.slug;
      });
      if (customSlugs.indexOf(slug) !== -1) BpozzTokens.removeCustomPalette(slug);
      var card = gridRoot.querySelector('[data-slug="' + slug + '"]');
      if (card) card.remove();
      var remaining = gridRoot.children.length;
      countEl.textContent = remaining
        ? remaining + " palette" + (remaining === 1 ? "" : "s") + " saved to this browser"
        : "Nothing saved yet";
      if (!remaining) emptyState.setAttribute("data-visible", "true");
    },
  });

  // Render immediately from custom palettes only (no network needed),
  // then again once tokens.json resolves so seed-gallery saves show up
  // too — avoids a blank collection page while the fetch is in flight.
  render([]);
  BpozzTokens.fetchAll()
    .then(function (data) {
      render(data);
    })
    .catch(function (err) {
      console.error(err);
      // Fetch failed — custom (builder-made) palettes still rendered
      // above; only saved *seed-gallery* palettes won't resolve until
      // the page is reloaded with a working connection.
    });
})();
