/**
 * palettes.js
 * -----------------------------------------------------------------------
 * Page-specific script for /palettes. Deliberately standalone and small:
 * a fast Color Hunt clone rather than a system with filters, export
 * formats and a11y scoring.
 *
 * Data flow:
 *   1. Fetch ./palettes-data.json (id, 4 hex colors, names, createdAt)
 *      and render the grid immediately from that — the page works with
 *      zero backend.
 *   2. If firebaseConfig below has been filled in with a real project,
 *      wireFirebase() loads the Firebase SDK from a CDN and every like /
 *      unlike is recorded as an atomic ±1 transaction on Realtime
 *      Database's /likes/<id> node. A node that does not exist yet starts
 *      at 0: nothing is written until a visitor actually likes a palette.
 *   3. The heart button toggles this browser's "I liked this" state
 *      (localStorage) in every mode; until firebaseConfig is filled in,
 *      nothing is recorded remotely — see the "preview" tag rendered on
 *      each card's like button in that mode.
 *   4. Once account Saved is launched (docs/SAVED.md), each card also gets
 *      a Save button beside the heart, handed to saved.js — see saveHtml.
 *      While Saved is dormant there is none. Save and Like are separate:
 *      neither reads nor changes the other.
 *
 * WHY NO COUNTS AND NO "POPULAR" SORT
 *
 * palettes-data.json used to carry a generated "likes" number per palette,
 * and the page seeded each /likes/<id> node from it the first time the node
 * was read, then displayed and ranked by the stored value. Those numbers
 * were invented, not collected, and the seed values changed several times
 * after the database went live — so a stored count is some unknown seed
 * plus whatever real likes followed, and the two cannot be separated from
 * here. Until the stored counts are known to be genuine, the page neither
 * shows a count nor ranks palettes by one. Likes are still recorded.
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

  // Account Saved (docs/SAVED.md), once it is launched: saved.js, inside
  // /app.js, which runs first, then publishes an active window.BpozzSaved.
  // While Saved is dormant this is null, and the page is exactly as it
  // always was.
  var account = window.BpozzSaved && window.BpozzSaved.active === true ? window.BpozzSaved : null;

  var gridRoot = document.getElementById("palettes-grid-root");
  var emptyState = document.getElementById("palettes-empty-state");
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

  // Light/dark label-color split, so a hover hex label stays legible on
  // any background.
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

  // Newest first.
  function sortedList() {
    return palettes.slice().sort(function (a, b) {
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
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

  /**
   * Once Saved is launched, a bookmark beside the heart that saves the
   * palette to the account. It is one of saved.js's controls
   * (data-save-kind, -id and -name): saved.js paints it, saves or removes
   * on click, opens sign-in when signed out and announces the outcome.
   * This file never handles its click — the delegation below knows only
   * swatches and .palette-like-btn — so the Like is untouched by it. A
   * palette whose id Saved wouldn't accept gets no button.
   */
  function saveHtml(p) {
    if (!account || !account.isValidItem("palette", p.id)) return "";
    // Its colour names, as its card shows them, for the announcement.
    var name = p.colors
      .map(function (hex, i) {
        return p.names && typeof p.names[i] === "string" ? p.names[i] : "";
      })
      .filter(Boolean)
      .join(", ");
    return (
      '<button type="button" class="palette-save-btn" data-save-kind="palette" data-save-id="' +
      p.id +
      '"' +
      (name ? ' data-save-name="' + escapeHtml(name) + '"' : "") +
      ' aria-pressed="false" aria-label="Save this palette"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>'
    );
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
      '" aria-label="Like this palette"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg></button>' +
      saveHtml(p) +
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
    // The Save buttons just drawn are saved.js's from here (saveHtml).
    if (account) account.sync(gridRoot);
  }

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
    // Recorded remotely only when Firebase is configured and loaded; the
    // transaction is atomic server-side, so several tabs/visitors liking
    // at once stay correct. In preview mode the liked state above is all
    // there is.
    if (FIREBASE_CONFIGURED && window.__bpozzLikeDelta) {
      window.__bpozzLikeDelta(id, delta);
    }
  }

  // ---- deep-link focus (/palettes#<id>) -----------------------------------
  // content-index.json (generated by the build's `data` stage) points every Palette
  // search result at /palettes#<id> — there's no separate per-palette page
  // to send it to, so this is what makes that link actually land on the
  // right card instead of just opening the gallery at the top. Runs once,
  // right after the first render.
  function focusPaletteFromHash() {
    // A malformed escape (e.g. /palettes#%E0) makes decodeURIComponent
    // throw. Uncaught, that rejected the load promise AFTER render() had
    // drawn the grid, and its .catch then showed the empty state on top.
    var id;
    try {
      id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    } catch (e) {
      return;
    }
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

  // ---- load palette data, then render -------------------------------------
  // Site-root, not "./palettes-data.json": served at /palettes (no trailing
  // slash) the relative form resolves to /palettes-data.json and 404s. It
  // only worked while the host redirected /palettes to /palettes/ — the
  // same trap src/client/colors.js documents (D2 in the Step 10 handoff).
  fetch("/palettes/palettes-data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!Array.isArray(data)) throw new Error("not an array");
      palettes = data;
      render();
      focusPaletteFromHash();
      if (FIREBASE_CONFIGURED) wireFirebase();
    })
    .catch(function (err) {
      console.error("Couldn't load palettes-data.json", err);
      if (emptyState) emptyState.setAttribute("data-visible", "true");
    });

  // ---- Firebase likes -------------------------------------------------------
  // Only runs once firebaseConfig above has real values. Dynamic import()
  // works fine in a plain (non-module) script, so this file doesn't need
  // type="module" on its <script> tag.
  //
  // Write-only: the page no longer reads, seeds or displays /likes/<id>
  // (see "WHY NO COUNTS" at the top of this file). A node that does not
  // exist yet is created by the first real like, starting from 0.
  function wireFirebase() {
    Promise.all([
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js"),
    ])
      .then(function (mods) {
        var appMod = mods[0];
        var dbMod = mods[1];
        var app = appMod.initializeApp(firebaseConfig);
        var db = dbMod.getDatabase(app);

        window.__bpozzLikeDelta = function (id, delta) {
          dbMod.runTransaction(
            dbMod.ref(db, "likes/" + id),
            function (current) {
              // A missing node counts from 0. Never below zero: the database
              // rule rejects negatives, and a rejected write would leave this
              // visitor's liked state out of step with the count.
              return Math.max(
                0,
                (typeof current === "number" ? current : 0) + delta,
              );
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
