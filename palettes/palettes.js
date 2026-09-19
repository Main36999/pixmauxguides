/**
 * palettes.js
 * -----------------------------------------------------------------------
 * Page-specific script for /palettes. Deliberately standalone — does not
 * touch tokens-shared.js/tokens-gallery.js (those back the richer /tokens
 * feature) so this page can stay a small, fast Color Hunt clone instead
 * of inheriting that system's filters, export formats, and a11y scoring.
 *
 * Data flow:
 *   1. Fetch ./palettes-data.json (id, 4 hex colors, a seed "likes"
 *      count, createdAt) and render the grid immediately from that —
 *      the page works with zero backend, showing the seed counts.
 *   2. If firebaseConfig below has been filled in with a real project,
 *      wireFirebase() loads the Firebase SDK from a CDN, seeds
 *      Realtime Database's /likes/<id> node from the JSON the first
 *      time it's ever read (so counts start where the JSON says, not
 *      at 0), then keeps every card's count live via onValue — every
 *      visitor sees the same number update in real time, and likes
 *      persist across reloads and browsers.
 *   3. Until firebaseConfig is filled in, the heart button still works
 *      (increments/decrements a number held only in this page's memory
 *      + localStorage for "did I like this" state) so the page is
 *      fully demoable before any backend setup — see the "preview"
 *      tag rendered on each card's like button in that mode.
 *
 * See SETUP-FIREBASE.md in this folder for exactly what to paste below
 * and the Realtime Database security rules this page needs.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  // ---- Firebase config ---------------------------------------------------
  // Paste your own project's values here (Firebase Console > Project
  // settings > General > Your apps > SDK setup and configuration).
  // Realtime Database must exist first (Console > Build > Realtime
  // Database > Create Database) — see SETUP-FIREBASE.md.
  var firebaseConfig = {
    apiKey: "AIzaSyAo01G39aWQC1tKG7iEJRsMVvphxcq0dBs",
    authDomain: "bpozz-palettes.firebaseapp.com",
    databaseURL:
      "https://bpozz-palettes-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "bpozz-palettes",
    storageBucket: "bpozz-palettes.firebasestorage.app",
    messagingSenderId: "104954285974",
    appId: "1:104954285974:web:d9b661beb1c740868f97b7",
  };
  var FIREBASE_CONFIGURED = firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY";

  var LIKED_KEY = "bpozz-palette-likes"; // localStorage: palette ids this browser has liked

  var gridRoot = document.getElementById("palettes-grid-root");
  var emptyState = document.getElementById("palettes-empty-state");
  var tabs = document.querySelectorAll(".palettes-tab");
  if (!gridRoot) return;

  // ---- small helpers -------------------------------------------------------
  function getLikedSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(LIKED_KEY) || "[]"));
    } catch (e) {
      return new Set();
    }
  }
  function setLikedSet(set) {
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {
      // localStorage unavailable (private mode, etc.) — liked state just
      // won't persist across reloads; nothing else depends on it.
    }
  }

  function toast(message) {
    if (typeof window.bpozzShowToast === "function") {
      window.bpozzShowToast(message);
    }
  }

  // ---- shared screen-reader announcement ---------------------------------
  // One region for the whole page, not one per swatch. The visual "Copied"
  // overlay is aria-hidden, so this is what carries the confirmation to
  // assistive tech now that the success toast is gone.
  var srStatus = null;
  var srTimer = null;

  function getSrStatus() {
    if (srStatus && srStatus.isConnected) return srStatus;
    srStatus = document.getElementById("palettes-copy-status");
    if (!srStatus) {
      srStatus = document.createElement("div");
      srStatus.id = "palettes-copy-status";
      srStatus.setAttribute("role", "status");
      srStatus.setAttribute("aria-live", "polite");
      srStatus.setAttribute("aria-atomic", "true");
      // Hidden visually, not from assistive tech. Inline rather than a CSS
      // class so it can never flash visible if palettes.css is slow or a
      // utility class gets renamed. Lives on body, outside the grid, so
      // render() replacing gridRoot.innerHTML never removes it.
      srStatus.style.cssText =
        "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
        "overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);" +
        "white-space:nowrap;border:0;";
      document.body.appendChild(srStatus);
    }
    return srStatus;
  }

  function announceCopied(hex) {
    var region = getSrStatus();
    if (srTimer) clearTimeout(srTimer);
    // Blank it first: copying the same swatch twice would otherwise write an
    // identical string, which is not a text change and so announces nothing.
    region.textContent = "";
    srTimer = setTimeout(function () {
      srTimer = null;
      region.textContent = "Copied " + hex;
    }, 60);
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  // Copy feedback lives inside the clicked swatch (see markCopied below)
  // rather than in the shared bottom toast — the toast is still used for the
  // failure case, where there's nothing to confirm inside the swatch.
  function copyHex(hex, swatch) {
    function ok() {
      markCopied(swatch);
      announceCopied(hex);
    }
    function failed() {
      toast("Couldn't copy — select and copy manually");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(hex).then(ok, function () {
        if (legacyCopy(hex)) ok();
        else failed();
      });
    } else {
      if (legacyCopy(hex)) ok();
      else failed();
    }
  }

  // Matches the light/dark label-color split already used on /tokens
  // swatches, so a hover hex label stays legible on any background.
  function labelColorFor(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.85)";
  }

  // Scrim behind the "Copied" state, using the same light/dark split as
  // labelColorFor so the two always agree: a light swatch gets a white
  // veil under dark text, a dark swatch a black veil under light text.
  function veilColorFor(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "rgba(255,255,255,0.58)" : "rgba(0,0,0,0.34)";
  }

  // ---- per-swatch "Copied" state ----------------------------------------
  // Exactly one swatch can be in the copied state at a time; clicking a
  // second swatch moves it. render() clears it because innerHTML is
  // replaced wholesale and the held element would otherwise go stale.
  var COPIED_MS = 1200;
  var copiedSwatch = null;
  var copiedTimer = null;

  function clearCopiedState() {
    if (copiedTimer) {
      clearTimeout(copiedTimer);
      copiedTimer = null;
    }
    if (copiedSwatch) {
      copiedSwatch.removeAttribute("data-copied");
      copiedSwatch = null;
    }
  }

  function markCopied(swatch) {
    if (!swatch) return;
    clearCopiedState();
    copiedSwatch = swatch;
    swatch.setAttribute("data-copied", "true");
    copiedTimer = setTimeout(function () {
      copiedTimer = null;
      if (copiedSwatch) copiedSwatch.removeAttribute("data-copied");
      copiedSwatch = null;
    }, COPIED_MS);
  }

  // ---- state -----------------------------------------------------------
  var palettes = []; // as loaded from palettes-data.json
  var liveLikes = {}; // id -> current like count
  var currentSort = "new";
  var randomOrder = null; // stable until re-shuffled
  var resortPending = false;

  function sortedList() {
    var list = palettes.slice();
    if (currentSort === "new") {
      list.sort(function (a, b) {
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });
    } else if (currentSort === "popular") {
      list.sort(function (a, b) {
        return (liveLikes[b.id] || 0) - (liveLikes[a.id] || 0);
      });
    } else if (currentSort === "random") {
      if (!randomOrder) {
        randomOrder = list.map(function (p) {
          return p.id;
        });
        for (var i = randomOrder.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = randomOrder[i];
          randomOrder[i] = randomOrder[j];
          randomOrder[j] = t;
        }
      }
      var order = randomOrder;
      list.sort(function (a, b) {
        return order.indexOf(a.id) - order.indexOf(b.id);
      });
    }
    return list;
  }

  // Escapes the one piece of palettes-data.json that reaches the DOM as
  // markup rather than as an attribute value. The names we ship are plain
  // words, but this file builds HTML by concatenation, so anything from
  // the data file gets escaped on the way in rather than trusted.
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

  // names[] is positional against colors[] (see palettes-data.json).
  // Falls back to an empty label if a record predates the field, so a
  // partially-migrated data file still renders a working row instead of
  // printing "undefined" for a missing name. Moved off the swatches and
  // into the card foot as plain, non-interactive text.
  function namesHtml(p) {
    return p.colors
      .map(function (hex, i) {
        return p.names && typeof p.names[i] === "string" ? p.names[i] : "";
      })
      .map(escapeHtml)
      .join(" · ");
  }

  function cardHtml(p) {
    var bars = p.colors
      .map(function (hex) {
        return (
          '<button type="button" class="palette-swatch" data-hex="' +
          hex +
          '" style="--sw-hex:' +
          hex +
          ";--sw-label:" +
          labelColorFor(hex) +
          ";--sw-veil:" +
          veilColorFor(hex) +
          '" aria-label="Copy ' +
          hex +
          '"><span class="palette-swatch__hex">' +
          hex +
          '</span><span class="palette-swatch__copied" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>' +
          "Copied</span></button>"
        );
      })
      .join("");
    var liked = getLikedSet().has(p.id);
    return (
      '<article class="palette-card" data-id="' +
      p.id +
      '"><div class="palette-card__bars">' +
      bars +
      '</div><div class="palette-card__foot"><button type="button" class="palette-like-btn" data-action="like" data-id="' +
      p.id +
      '" aria-pressed="' +
      (liked ? "true" : "false") +
      '" aria-label="Like this palette"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg><span class="palette-like-count">' +
      (liveLikes[p.id] != null ? liveLikes[p.id] : p.likes) +
      "</span></button>" +
      '<span class="palette-card__names">' +
      namesHtml(p) +
      "</span>" +
      (FIREBASE_CONFIGURED
        ? ""
        : '<span class="palette-card__note">preview</span>') +
      "</div></article>"
    );
  }

  function render() {
    // innerHTML is replaced below, so drop any held swatch reference first.
    clearCopiedState();
    var list = sortedList();
    if (!list.length) {
      gridRoot.innerHTML = "";
      if (emptyState) emptyState.setAttribute("data-visible", "true");
      return;
    }
    if (emptyState) emptyState.removeAttribute("data-visible");
    gridRoot.innerHTML = list.map(cardHtml).join("");
  }

  function scheduleResort() {
    if (resortPending) return;
    resortPending = true;
    requestAnimationFrame(function () {
      resortPending = false;
      if (currentSort === "popular") render();
    });
  }

  function updateCount(id, count) {
    liveLikes[id] = count;
    var btn = gridRoot.querySelector(
      '.palette-like-btn[data-id="' + id + '"] .palette-like-count',
    );
    if (btn) btn.textContent = count;
    if (currentSort === "popular") scheduleResort();
  }

  // ---- sort tabs ---------------------------------------------------------
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var sort = tab.getAttribute("data-sort");
      if (sort === currentSort) {
        if (sort === "random") {
          randomOrder = null;
          render();
        }
        return;
      }
      currentSort = sort;
      tabs.forEach(function (t) {
        t.setAttribute("aria-pressed", t === tab ? "true" : "false");
      });
      render();
    });
  });

  // ---- copy + like click delegation --------------------------------------
  gridRoot.addEventListener("click", function (e) {
    var swatch = e.target.closest(".palette-swatch");
    if (swatch) {
      copyHex(swatch.getAttribute("data-hex"), swatch);
      return;
    }
    var likeBtn = e.target.closest(".palette-like-btn");
    if (likeBtn) {
      var id = likeBtn.getAttribute("data-id");
      var liked = getLikedSet();
      var nowLiked = !liked.has(id);
      if (nowLiked) liked.add(id);
      else liked.delete(id);
      setLikedSet(liked);
      likeBtn.setAttribute("aria-pressed", nowLiked ? "true" : "false");
      applyLikeDelta(id, nowLiked ? 1 : -1);
    }
  });

  function applyLikeDelta(id, delta) {
    if (FIREBASE_CONFIGURED && window.__bpozzLikeDelta) {
      // The onValue listener wired up in wireFirebase() will push the
      // committed count back into updateCount() — no local mutation
      // needed, and this stays correct even with several tabs/visitors
      // liking at once since the transaction is atomic server-side.
      window.__bpozzLikeDelta(id, delta);
    } else {
      updateCount(id, Math.max(0, (liveLikes[id] || 0) + delta));
    }
  }

  // ---- deep-link focus (/palettes#<id>) -----------------------------------
  // content-index.json (see /build-content-index.js) points every Palette
  // search result at /palettes#<id> — there's no separate per-palette page
  // to send it to, so this is what makes that link actually land on the
  // right card instead of just opening the gallery at the top. Runs once,
  // right after the first render, not on every re-sort.
  function focusPaletteFromHash() {
    var id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (!id) return;
    var known = palettes.some(function (p) {
      return p.id === id;
    });
    if (!known) return;
    var card = gridRoot.querySelector('.palette-card[data-id="' + id + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("palette-card--highlight");
    setTimeout(function () {
      card.classList.remove("palette-card--highlight");
    }, 2400);
  }

  // ---- load seed data, then render ---------------------------------------
  fetch("./palettes-data.json")
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      palettes = data;
      data.forEach(function (p) {
        liveLikes[p.id] = p.likes;
      });
      render();
      focusPaletteFromHash();
      if (FIREBASE_CONFIGURED) wireFirebase(data);
    })
    .catch(function (err) {
      console.error("Couldn't load palettes-data.json", err);
      if (emptyState) emptyState.setAttribute("data-visible", "true");
    });

  // ---- Firebase real-time likes -------------------------------------------
  // Only runs once firebaseConfig above has real values. Dynamic import()
  // works fine in a plain (non-module) script, so this file doesn't need
  // type="module" on its <script> tag.
  function wireFirebase(data) {
    Promise.all([
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js"),
    ])
      .then(function (mods) {
        var appMod = mods[0];
        var dbMod = mods[1];
        var app = appMod.initializeApp(firebaseConfig);
        var db = dbMod.getDatabase(app);

        data.forEach(function (p) {
          var ref = dbMod.ref(db, "likes/" + p.id);
          // Seed the node from the JSON the first time it's ever read
          // (current === null means it doesn't exist yet); leaves it
          // untouched on every subsequent load.
          dbMod.runTransaction(ref, function (current) {
            return current === null ? p.likes : current;
          });
          dbMod.onValue(ref, function (snap) {
            var val = snap.val();
            if (typeof val === "number") updateCount(p.id, val);
          });
        });

        window.__bpozzLikeDelta = function (id, delta) {
          dbMod.runTransaction(
            dbMod.ref(db, "likes/" + id),
            function (current) {
              return (typeof current === "number" ? current : 0) + delta;
            },
          );
        };
      })
      .catch(function (err) {
        console.error(
          "Firebase failed to load — likes are running in local preview mode instead.",
          err,
        );
      });
  }
})();
