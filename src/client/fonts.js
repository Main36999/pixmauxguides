/**
 * src/client/fonts.js — published as /fonts/fonts.js.
 *
 * Runs on /fonts/ and every /fonts/<id>.html, after /app.js. Everything it
 * works on is already in the page: src/build/fonts.js renders every card,
 * every specimen row and every control at build time, so with JS off the
 * pages still list, link and download. This script adds:
 *
 *   both pages   lazy font application for cards, favorites (localStorage,
 *                or account Saved once it is launched — see handToSaved),
 *                the "…" menus, copy-to-clipboard
 *   /fonts/      search, category filter, sort, preview text, URL state
 *   detail page  preview presets, custom text, display size
 *
 * Page-specific rather than part of /app.js for the same reason colors.js
 * and palettes.js are: only these pages run it.
 */
(function () {
  "use strict";

  var STORE_KEY = "bpozz:font-favorites";
  var status = document.getElementById("fonts-status");

  // Account Saved (docs/SAVED.md), once it is launched: saved.js, inside
  // /app.js, which runs first, then publishes an active window.BpozzSaved.
  // While Saved is dormant this is null, and everything here works exactly
  // as it always has, on this browser's favorites.
  var account = window.BpozzSaved && window.BpozzSaved.active === true ? window.BpozzSaved : null;

  function announce(message) {
    if (!status) return;
    status.textContent = "";
    // A fresh text node after clearing makes repeat messages re-announce.
    window.setTimeout(function () {
      status.textContent = message;
    }, 30);
  }

  function toast(message) {
    if (typeof window.bpozzShowToast === "function") {
      window.bpozzShowToast(message);
    } else {
      announce(message);
    }
  }

  function toArray(list) {
    return Array.prototype.slice.call(list);
  }

  // -------------------------------------------------------------------
  // lazy font application
  // -------------------------------------------------------------------

  /**
   * A card's family is applied (via .is-visible, see fonts.css) only when the
   * card comes near the viewport. @font-face alone downloads nothing, so this
   * is what limits the listing to the fonts actually on screen. Hidden cards
   * (filtered out) never intersect and so never load.
   */
  var cards = toArray(document.querySelectorAll(".font-card"));
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "300px 0px" },
    );
    cards.forEach(function (card) {
      io.observe(card);
    });
  } else {
    cards.forEach(function (card) {
      card.classList.add("is-visible");
    });
  }

  // -------------------------------------------------------------------
  // favorites
  // -------------------------------------------------------------------

  /**
   * Stored as a JSON array of font ids. Storage can be missing or throw
   * (private windows, blocked site data); favorites then still work for the
   * visit, and the visitor is told once that they will not be kept.
   */
  function readFavorites() {
    try {
      var value = JSON.parse(window.localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(value)
        ? value.filter(function (id) {
            return typeof id === "string";
          })
        : [];
    } catch (e) {
      return [];
    }
  }

  function writeFavorites(list) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  var favorites = account ? [] : readFavorites();
  var warnedStorage = false;
  var onFavoritesChange = function () {};

  // Once Saved is launched: saved in the account, as far as it is known
  // (has() answers null until the list has loaded, and while signed out).
  function isFavorite(id) {
    if (account) return account.has("font", id) === true;
    return favorites.indexOf(id) !== -1;
  }

  function syncFavoriteButtons() {
    toArray(document.querySelectorAll("[data-font-fav]")).forEach(function (btn) {
      var on = isFavorite(btn.getAttribute("data-font-fav"));
      btn.setAttribute("aria-pressed", String(on));
      if (btn.hasAttribute("data-font-fav-label")) {
        var label = btn.querySelector("span");
        if (label) label.textContent = on ? "Saved" : "Save";
      }
    });
  }

  function fontNameFor(btn) {
    var card = btn.closest(".font-card");
    if (card) return card.getAttribute("data-name");
    var title = document.querySelector(".font-detail__title");
    return title ? title.textContent : "Font";
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-font-fav]");
    // Once Saved is launched the buttons are saved.js's (handToSaved).
    if (!btn || account) return;
    var id = btn.getAttribute("data-font-fav");
    var name = fontNameFor(btn);
    if (isFavorite(id)) {
      favorites = favorites.filter(function (x) {
        return x !== id;
      });
      announce(name + " removed from saved fonts");
    } else {
      favorites = favorites.concat([id]);
      announce(name + " saved");
    }
    if (!writeFavorites(favorites) && !warnedStorage) {
      warnedStorage = true;
      toast("Saved fonts can't be kept in this browser after you leave");
    }
    syncFavoriteButtons();
    onFavoritesChange();
  });

  // Another tab changed the list.
  window.addEventListener("storage", function (e) {
    if (account || e.key !== STORE_KEY) return;
    favorites = readFavorites();
    syncFavoriteButtons();
    onFavoritesChange();
  });

  /**
   * Once Saved is launched, every Save button becomes one of saved.js's
   * controls (docs/SAVED.md): it gains data-save-kind, -id and -name, and
   * the detail page's text gains data-save-label. saved.js then paints it,
   * saves or removes on click, opens sign-in when signed out and announces
   * the outcome, and the favorites code above leaves it alone, so each
   * click is handled once and nothing is written to this browser. The
   * buttons keep data-font-fav, which fonts.css styles them by.
   */
  function handToSaved() {
    toArray(document.querySelectorAll("[data-font-fav]")).forEach(function (btn) {
      btn.setAttribute("data-save-kind", "font");
      btn.setAttribute("data-save-id", btn.getAttribute("data-font-fav"));
      btn.setAttribute("data-save-name", fontNameFor(btn));
      if (btn.hasAttribute("data-font-fav-label")) {
        var label = btn.querySelector("span");
        if (label) label.setAttribute("data-save-label", "");
      }
    });
    account.sync(document);
    account.onChange(function () {
      onFavoritesChange();
    });
  }

  if (account) handToSaved();
  else syncFavoriteButtons();

  // -------------------------------------------------------------------
  // copy
  // -------------------------------------------------------------------

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        ok = false;
      }
      document.body.removeChild(area);
      if (ok) resolve();
      else reject(new Error("copy failed"));
    });
  }

  // -------------------------------------------------------------------
  // "…" menus
  // -------------------------------------------------------------------

  var openButton = null;

  function menuFor(btn) {
    return document.getElementById(btn.getAttribute("aria-controls"));
  }

  function menuItems(menu) {
    return toArray(menu.querySelectorAll('[role="menuitem"]'));
  }

  function closeMenu(returnFocus) {
    if (!openButton) return;
    var btn = openButton;
    menuFor(btn).hidden = true;
    btn.setAttribute("aria-expanded", "false");
    openButton = null;
    if (returnFocus) btn.focus();
  }

  function openMenu(btn, focusIndex) {
    closeMenu(false);
    var menu = menuFor(btn);
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    openButton = btn;
    var items = menuItems(menu);
    var index = focusIndex < 0 ? items.length - 1 : focusIndex;
    if (items[index]) items[index].focus();
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-font-menu]");
    if (btn) {
      if (openButton === btn) closeMenu(true);
      else openMenu(btn, 0);
      return;
    }
    var copy = e.target.closest("[data-font-copy]");
    if (copy) {
      var text = copy.getAttribute("data-font-copy");
      var done = copy.getAttribute("data-font-copy-label") || "Copied “" + text + "”";
      copyText(text).then(
        function () {
          toast(done);
        },
        function () {
          toast("Couldn't copy — your browser blocked clipboard access");
        },
      );
      closeMenu(true);
      return;
    }
    if (openButton && !e.target.closest(".font-menu__list")) closeMenu(false);
  });

  document.addEventListener("keydown", function (e) {
    var trigger = e.target.closest && e.target.closest("[data-font-menu]");
    if (trigger && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      openMenu(trigger, e.key === "ArrowDown" ? 0 : -1);
      return;
    }
    if (!openButton) return;
    var menu = menuFor(openButton);
    if (!menu.contains(document.activeElement)) {
      if (e.key === "Escape") closeMenu(true);
      return;
    }
    var items = menuItems(menu);
    var at = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(at + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(at - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  });

  // -------------------------------------------------------------------
  // listing: search, filter, sort, preview text
  // -------------------------------------------------------------------

  var grid = document.getElementById("font-grid");
  if (grid) initListing();

  function initListing() {
    var gridCards = toArray(grid.children);
    var total = gridCards.length;
    var chips = toArray(document.querySelectorAll(".fonts-filter"));
    var search = document.getElementById("fonts-search");
    var sort = document.getElementById("fonts-sort");
    var preview = document.getElementById("fonts-preview-text");
    var countLine = document.getElementById("fonts-count");
    var empty = document.getElementById("fonts-empty");
    var emptyTitle = empty.querySelector("strong");
    var emptyHint = empty.querySelector("p + p");

    var categories = chips.map(function (chip) {
      return chip.getAttribute("data-category");
    });
    var labels = {};
    chips.forEach(function (chip) {
      labels[chip.getAttribute("data-category")] = chip.textContent.trim();
    });

    var params = new URLSearchParams(window.location.search);
    var state = {
      category: categories.indexOf(params.get("category")) !== -1 ? params.get("category") : "",
      query: params.get("q") || "",
      sort: ["az", "newest", "featured"].indexOf(params.get("sort")) !== -1 ? params.get("sort") : "az",
    };
    search.value = state.query;
    sort.value = state.sort;

    function normalize(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[-,]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    var comparators = {
      az: function (a, b) {
        return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"), "en");
      },
      newest: function (a, b) {
        var da = a.getAttribute("data-added");
        var db = b.getAttribute("data-added");
        return da < db ? 1 : da > db ? -1 : comparators.az(a, b);
      },
      featured: function (a, b) {
        return Number(a.getAttribute("data-featured")) - Number(b.getAttribute("data-featured"));
      },
    };

    function writeUrl() {
      var next = new URLSearchParams();
      if (state.category) next.set("category", state.category);
      if (state.query) next.set("q", state.query);
      if (state.sort !== "az") next.set("sort", state.sort);
      var qs = next.toString();
      try {
        window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
      } catch (e) {
        /* file:// or a sandboxed frame — the filter still works */
      }
    }

    var announceTimer = null;

    // Once Saved is launched: whether the account's saved fonts are known —
    // signed in, and the list loaded. Until then has() answers null for
    // every font.
    function savedKnown() {
      return (
        account.signedIn() === true &&
        gridCards.length > 0 &&
        account.has("font", gridCards[0].getAttribute("data-font-id")) !== null
      );
    }

    // This browser's favorites from before accounts are never shown or sent
    // from here. When some are waiting to be added, the empty Saved view
    // points to Your Account, where they can be.
    function pointToImport() {
      if (account.importDismissed() || !account.legacy().fonts.length) return;
      emptyHint.textContent = "";
      emptyHint.appendChild(
        document.createTextNode(
          "Select Save on a font to keep it here. Fonts saved in this browser before accounts can be added from ",
        ),
      );
      var link = document.createElement("a");
      link.setAttribute("href", "/account#saved");
      link.textContent = "Your Account";
      emptyHint.appendChild(link);
      emptyHint.appendChild(document.createTextNode("."));
    }

    function apply(options) {
      var terms = normalize(state.query).split(" ").filter(Boolean);
      var shown = 0;

      gridCards.forEach(function (card) {
        var inCategory =
          state.category === ""
            ? true
            : state.category === "saved"
              ? isFavorite(card.getAttribute("data-font-id"))
              : card.getAttribute("data-category") === state.category;
        var haystack = card.getAttribute("data-search");
        var matches = terms.every(function (t) {
          return haystack.indexOf(t) !== -1;
        });
        card.hidden = !(inCategory && matches);
        if (!card.hidden) shown += 1;
      });

      gridCards
        .slice()
        .sort(comparators[state.sort])
        .forEach(function (card) {
          grid.appendChild(card);
        });

      chips.forEach(function (chip) {
        chip.setAttribute(
          "aria-pressed",
          String(chip.getAttribute("data-category") === state.category),
        );
      });

      var noun = shown === 1 ? "font" : "fonts";
      countLine.textContent =
        shown === total ? total + " fonts" : "Showing " + shown + " of " + total + " " + (total === 1 ? "font" : "fonts");

      empty.hidden = shown > 0;
      if (state.category === "saved" && account && !savedKnown()) {
        // Launched, and the account's saved fonts aren't known: signed
        // out, or the list hasn't loaded (saved.js says so if it failed).
        var signedOut = account.signedIn() === false;
        emptyTitle.textContent = signedOut ? "Sign in to see your saved fonts." : "Your saved fonts haven't loaded yet.";
        emptyHint.textContent = signedOut
          ? "Fonts you save are kept in your account, wherever you sign in."
          : "They'll appear here as soon as they do.";
      } else if (state.category === "saved" && !terms.length) {
        emptyTitle.textContent = "You haven't saved any fonts yet.";
        emptyHint.textContent = "Select Save on a font to keep it here.";
        if (account) pointToImport();
      } else {
        emptyTitle.textContent = "No fonts match your search.";
        emptyHint.textContent = "Try another name, designer or category.";
      }

      writeUrl();

      if (options && options.announce) {
        window.clearTimeout(announceTimer);
        announceTimer = window.setTimeout(function () {
          var where = state.category ? " in " + labels[state.category] : "";
          announce(shown + " " + noun + " shown" + where);
        }, 400);
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.category = chip.getAttribute("data-category");
        apply({ announce: true });
      });
    });

    search.addEventListener("input", function () {
      state.query = search.value;
      apply({ announce: true });
    });

    sort.addEventListener("change", function () {
      state.sort = sort.value;
      apply({ announce: true });
    });

    preview.addEventListener("input", function () {
      var text = preview.value.trim();
      gridCards.forEach(function (card) {
        var sample = card.querySelector("[data-font-sample]");
        if (text) {
          sample.textContent = text;
          sample.setAttribute("data-custom", "");
        } else {
          sample.textContent = card.getAttribute("data-name");
          sample.removeAttribute("data-custom");
        }
      });
    });

    onFavoritesChange = function () {
      if (state.category === "saved") apply();
    };

    apply();
  }

  // -------------------------------------------------------------------
  // detail page: preview text and size
  // -------------------------------------------------------------------

  var specimens = toArray(document.querySelectorAll("[data-specimen]"));
  if (specimens.length) initTester();

  function initTester() {
    var presets = toArray(document.querySelectorAll(".font-preset"));
    var custom = document.getElementById("font-custom-text");
    var size = document.getElementById("font-size");
    var sizeValue = document.getElementById("font-size-value");
    var displayRows = toArray(document.querySelectorAll("[data-specimen-display]"));
    var sizeLabels = toArray(document.querySelectorAll("[data-display-size]"));
    var presetText = presets.length ? presets[0].getAttribute("data-preset") : "";

    function setText(text) {
      specimens.forEach(function (el) {
        el.textContent = text;
      });
    }

    presets.forEach(function (btn) {
      btn.addEventListener("click", function () {
        presetText = btn.getAttribute("data-preset");
        presets.forEach(function (other) {
          other.setAttribute("aria-pressed", String(other === btn));
        });
        custom.value = "";
        setText(presetText);
      });
    });

    custom.addEventListener("input", function () {
      var text = custom.value.trim();
      presets.forEach(function (btn) {
        btn.setAttribute(
          "aria-pressed",
          String(!text && btn.getAttribute("data-preset") === presetText),
        );
      });
      setText(text || presetText);
    });

    function setSize() {
      var px = Number(size.value);
      displayRows.forEach(function (el) {
        el.style.fontSize = px + "px";
      });
      sizeLabels.forEach(function (el) {
        el.textContent = String(px);
      });
      sizeValue.textContent = px + "px";
    }
    size.addEventListener("input", setSize);
  }
})();
