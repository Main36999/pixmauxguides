/**
 * tokens-gallery.js
 * -----------------------------------------------------------------------
 * Page-specific script for /tokens/index.html only. Mirrors app.js's own
 * getFiltered()/render() pattern for the homepage guide grid: the grid
 * ships pre-rendered (server-side, via build-tokens.js) for no-JS
 * visitors and crawlers, then this file fetches tokens.json and takes
 * over rendering for live family/mood/sort filtering.
 *
 * Load order (see build-tokens.js's galleryPageHtml): app.js,
 * tokens-color.js, tokens-a11y.js, tokens-export.js, tokens-shared.js,
 * then this file.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  var gridRoot = document.getElementById("tokens-grid-root");
  if (!gridRoot) return; // safety guard, shouldn't happen on this page

  var familySelect = document.getElementById("family-select");
  var sortSelect = document.getElementById("sort-select");
  var moodFilters = document.querySelectorAll(".token-mood-chip");
  var resultsCount = document.getElementById("tokens-results-count");
  var emptyState = document.getElementById("tokens-empty-state");

  var ALL = null; // populated once tokens.json resolves
  var state = { family: "all", moods: [], sort: "new" };

  function getFiltered() {
    return (ALL || []).filter(function (p) {
      if (state.family !== "all" && p.family !== state.family) return false;
      if (state.moods.length) {
        var hasAll = state.moods.every(function (m) {
          return (p.moods || []).indexOf(m) !== -1;
        });
        if (!hasAll) return false;
      }
      return true;
    });
  }

  function getSorted(list) {
    var sorted = list.slice();
    if (state.sort === "popular") {
      sorted.sort(function (a, b) {
        return (b.popularity || 0) - (a.popularity || 0);
      });
    } else if (state.sort === "accessible") {
      sorted.sort(function (a, b) {
        var sa = a.accessibility_score === null ? -1 : a.accessibility_score;
        var sb = b.accessibility_score === null ? -1 : b.accessibility_score;
        if (sb !== sa) return sb - sa;
        return (b.popularity || 0) - (a.popularity || 0); // stable-ish tiebreak
      });
    } else {
      sorted.sort(function (a, b) {
        return a.created_at < b.created_at ? 1 : -1;
      });
    }
    return sorted;
  }

  function render() {
    if (!ALL) return; // still loading — leave the SSR'd grid as-is
    var filtered = getSorted(getFiltered());
    gridRoot.innerHTML = filtered.map(BpozzTokens.cardHtml).join("");
    BpozzTokens.syncLikedState(gridRoot);
    resultsCount.textContent = "Showing " + filtered.length + " of " + ALL.length + " palettes";
    if (filtered.length === 0) {
      emptyState.setAttribute("data-visible", "true");
    } else {
      emptyState.removeAttribute("data-visible");
    }
  }

  familySelect.addEventListener("change", function () {
    state.family = familySelect.value;
    render();
  });
  sortSelect.addEventListener("change", function () {
    state.sort = sortSelect.value;
    render();
  });
  moodFilters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mood = btn.getAttribute("data-mood");
      var idx = state.moods.indexOf(mood);
      if (idx === -1) {
        state.moods.push(mood);
        btn.setAttribute("aria-pressed", "true");
      } else {
        state.moods.splice(idx, 1);
        btn.setAttribute("aria-pressed", "false");
      }
      render();
    });
  });

  BpozzTokens.wireCardActions(gridRoot);
  BpozzTokens.syncLikedState(gridRoot); // sync the SSR'd cards immediately, before fetch resolves

  BpozzTokens.fetchAll()
    .then(function (data) {
      ALL = data;
      render();
    })
    .catch(function (err) {
      console.error(err);
      // Fetch failed (offline, blocked, etc.) — leave the pre-rendered
      // "New"-sorted grid exactly as build-tokens.js shipped it rather
      // than replacing it with an error state; filters/sort just won't
      // respond until the page is reloaded with a working connection.
    });
})();
