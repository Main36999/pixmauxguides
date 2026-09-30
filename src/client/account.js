/**
 * account.js — the Saved section of /account (account.html).
 * -----------------------------------------------------------------------
 * Published on its own at /account.js and loaded only by account.html,
 * after /auth.js and /saved.js, whose window.BpozzSaved it draws from. It
 * is not part of /app.js: no other page has this section.
 *
 * DORMANT WITH SAVED
 *
 * Nothing happens unless window.BpozzSaved is active, which it is only once
 * saved.js's LAUNCHED line is switched on (docs/SAVED.md). Until then the
 * section keeps the text it has always had, and this file adds no listener,
 * request or storage access, and changes nothing on the page.
 *
 * ONCE ACTIVE
 *
 * The section's original text ([data-account-saved-fallback]) is hidden and
 * the list is drawn into [data-account-saved]:
 *
 *   list     BpozzSaved.list(): every saved item, newest first, in five
 *            groups — Colors, Palettes, Fonts, Image Picker palettes, UI/UX
 *            Guides. Icons are a valid kind, but nothing can save one yet,
 *            so they are not drawn.
 *   names    from the site's own data files, fetched only for the kinds
 *            the list holds: colors-data.json, palettes-data.json,
 *            guides.json. Fonts have no published names file, so a font is
 *            shown by its id. An Image Picker palette is its own colours.
 *            Without its file, an item is shown by its id.
 *   remove   BpozzSaved.remove(); the row goes once the server confirms,
 *            and focus moves to the next Remove button. A refresh while
 *            the request runs keeps the row, still busy.
 *   status   one short, polite line, never the list itself: loading, the
 *            count once the list arrives, empty, an error, or an update a
 *            refresh found. Removals are announced by saved.js, and the
 *            import outcome by its own line.
 *   current  a removal in another tab disappears at once (onChange); the
 *            list is read again when the page is shown after a minute or
 *            more away, which picks up what other tabs saved.
 *   import   this browser's font favorites and palette likes from before
 *            accounts, offered once and sent only when the visitor asks.
 *
 * Everything is drawn with textContent: nothing from the server, a data
 * file or browser storage is ever inserted as HTML.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  var saved = window.BpozzSaved;
  if (!saved || saved.active !== true || typeof document === "undefined") return;

  var root = document.querySelector("[data-account-saved]");
  if (!root || root.hasAttribute("data-state")) return;
  var fallback = document.querySelector("[data-account-saved-fallback]");

  var TIMEOUT_MS = 10000;
  var RELIST_MS = 60 * 1000;
  var HEX = /^#[0-9a-fA-F]{6}$/;

  var GROUPS = [
    { kind: "color", title: "Colors" },
    { kind: "palette", title: "Palettes" },
    { kind: "font", title: "Fonts" },
    { kind: "image_palette", title: "Image Picker palettes" },
    { kind: "guide", title: "UI/UX Guides" },
  ];

  // The data files names come from, by kind. Fonts have none published.
  var FILES = {
    color: "/colors/colors-data.json",
    palette: "/palettes/palettes-data.json",
    guide: "/guides.json",
  };

  var TEXT = {
    loading: "Loading your saved items…",
    loadFailed: "Couldn’t load your Saved items right now.",
    tooMany: "Too many requests. Try again in a minute.",
    tryAgain: "Try again",
    empty: "You haven’t saved anything yet.",
    emptyHint: "Save colors, palettes, fonts and guides, and they’ll appear here.",
    gone: "No longer available",
    remove: "Remove",
    removing: "Removing…",
    imagePalette: "Image Picker palette",
    importTitle: "Saved in this browser",
    importLede:
      "Before accounts, BPOZZ kept these in this browser only. Add them to your account to have them wherever you sign in.",
    importFontsNote: "Fonts you add move from this browser’s list to your account.",
    importLikesNote: "Your palette likes stay as they are.",
    importAdd: "Add to my account",
    importAdding: "Adding…",
    importSkip: "No thanks",
    importFailed: "Couldn’t add them. Please try again.",
    updated: "Your saved items were updated.",
  };

  // ---------- state ----------

  var state = ""; // "loading" | "error" | "empty" | "ready" | "signed-out"
  var items = []; // the list as last read, less what has been removed since
  var limits = saved.limits;
  var names = {}; // kind -> { id: entry } once its file is read, null if it couldn't be
  var files = {}; // kind -> the promise of names[kind]
  var rows = {}; // "kind:id" -> { row, button, label } for the rows drawn
  var pending = {}; // "kind:id" -> true while its removal runs
  var groups = {}; // kind -> { box, heading, list, note }
  var summary = null;
  var fullNote = null;
  var loading = null;
  var listedAt = 0;
  // Bumped by every sign-out: work started before it is dropped.
  var generation = 0;
  var importOffered = false;

  // The status line: outside the area, which is redrawn, and hidden from
  // sight but not from assistive tech.
  var live = el("p", "sr-only");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  live.setAttribute("data-account-saved-status", "");
  var announceTimer = null;

  var importBox = el("div", "account-saved__import");
  importBox.hidden = true;
  var area = el("div", "account-saved__body");

  // ---------- helpers ----------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(className, text) {
    var node = el("button", className, text);
    node.setAttribute("type", "button");
    return node;
  }

  function keyOf(kind, id) {
    return kind + ":" + id;
  }

  function isHex(value) {
    return typeof value === "string" && HEX.test(value);
  }

  function thousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function count(n, one, many) {
    return n === 1 ? "1 " + one : thousands(n) + " " + many;
  }

  function drawnKind(kind) {
    return GROUPS.some(function (group) {
      return group.kind === kind;
    });
  }

  function setState(next) {
    state = next;
    root.setAttribute("data-state", next);
    if (next === "loading") area.setAttribute("aria-busy", "true");
    else area.removeAttribute("aria-busy");
  }

  // Says one short sentence in the status line. Blank first, so the same
  // sentence twice is still a change to announce.
  function announce(text) {
    live.textContent = "";
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      announceTimer = null;
      live.textContent = text;
    }, 60);
  }

  // Empties the status line: focus has just moved onto an element that
  // reads the same news, or there is nothing left to tell.
  function hush() {
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = null;
    live.textContent = "";
  }

  // The list in one short sentence: how many, or that there are none.
  function listText() {
    return summary ? "You have " + summary.textContent + "." : TEXT.empty;
  }

  function drawnKeys() {
    return Object.keys(rows).sort().join(" ");
  }

  // ---------- names ----------

  // Same-origin JSON, or null for anything else: a failure, a timeout, a
  // non-2xx answer or a body that isn't JSON.
  function fetchJson(url) {
    var init = { credentials: "same-origin", headers: { Accept: "application/json" } };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(TIMEOUT_MS);
    var answer;
    try {
      answer = fetch(url, init);
    } catch (err) {
      return Promise.resolve(null);
    }
    return Promise.resolve(answer)
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  // A data file as { id: { name, colors } }, keeping only well-formed
  // entries; null when it isn't a list at all.
  function indexFile(kind, data) {
    if (!Array.isArray(data)) return null;
    var map = Object.create(null);
    data.forEach(function (entry) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string") return;
      if (kind === "color" && typeof entry.name === "string" && isHex(entry.hex)) {
        map[entry.id] = { name: entry.name, colors: [entry.hex] };
      } else if (kind === "palette" && Array.isArray(entry.colors)) {
        var labels = Array.isArray(entry.names) ? entry.names : [];
        map[entry.id] = {
          // The palette card's own label: its colour names, joined.
          name: entry.colors
            .map(function (hex, i) {
              return typeof labels[i] === "string" ? labels[i] : "";
            })
            .filter(Boolean)
            .join(" · "),
          colors: entry.colors.filter(isHex),
        };
      } else if (kind === "guide" && typeof entry.title === "string") {
        map[entry.id] = { name: entry.title, colors: [] };
      }
    });
    return map;
  }

  // Reads a kind's data file once per page. One that fails is tried again
  // on the next read of the list.
  function readFile(kind) {
    if (!FILES[kind]) return Promise.resolve(null);
    if (!files[kind]) {
      files[kind] = fetchJson(FILES[kind]).then(function (data) {
        var map = indexFile(kind, data);
        names[kind] = map;
        if (!map) delete files[kind];
        return map;
      });
    }
    return files[kind];
  }

  // What a row shows for one item. `gone` is an item its kind's file was
  // read without: it is no longer on the site, so it isn't linked, but it
  // can still be removed.
  function describe(kind, id) {
    var map = names[kind];
    var entry = map ? map[id] : undefined;
    var gone = !!map && !entry;
    if (kind === "color") {
      return {
        name: entry ? entry.name : "Color " + id,
        detail: gone ? TEXT.gone : entry ? entry.colors[0].toUpperCase() : "",
        colors: entry ? entry.colors : [],
        href: gone ? "" : "/colors/",
      };
    }
    if (kind === "palette") {
      return {
        name: entry && entry.name ? entry.name : "Palette " + id,
        detail: gone ? TEXT.gone : "",
        colors: entry ? entry.colors : [],
        href: gone ? "" : "/palettes#" + id,
      };
    }
    if (kind === "font") {
      return { name: id, detail: "", colors: [], href: "/fonts/" + id + ".html" };
    }
    if (kind === "image_palette") {
      var hexes = id.split("-").map(function (part) {
        return "#" + part.toUpperCase();
      });
      return { name: TEXT.imagePalette, detail: hexes.join(" · "), colors: hexes, href: "" };
    }
    return {
      name: entry ? entry.name : id,
      detail: gone ? TEXT.gone : "",
      colors: [],
      href: gone ? "" : "/guide/" + id,
    };
  }

  // ---------- drawing ----------

  // Replaces what the area shows. When focus was inside it, it lands again
  // on the same item's Remove button, or else on the element `build`
  // returns (a message or the summary), so it is never dropped on <body>.
  // Landing there reads that element out, so the status line is emptied
  // rather than saying it too, and this returns true.
  function replace(build) {
    var active = document.activeElement;
    var inside = !!active && area.contains(active);
    var key = null;
    if (inside) {
      Object.keys(rows).forEach(function (k) {
        if (rows[k].row.contains(active)) key = k;
      });
    }
    rows = {};
    groups = {};
    summary = null;
    fullNote = null;
    area.textContent = "";
    var first = build();
    if (!inside) return false;
    if (key && rows[key]) {
      rows[key].button.focus();
      return false;
    }
    if (!first) return false;
    hush();
    first.focus();
    return true;
  }

  function message(text) {
    var node = el("p", "account-saved__message", text);
    node.setAttribute("tabindex", "-1");
    area.appendChild(node);
    return node;
  }

  function showLoading() {
    var moved = replace(function () {
      setState("loading");
      return message(TEXT.loading);
    });
    if (!moved) announce(TEXT.loading);
  }

  function showError(text) {
    var moved = replace(function () {
      setState("error");
      var first = message(text);
      var actions = el("div", "account-page__actions");
      var retry = button("btn account-page__button", TEXT.tryAgain);
      retry.addEventListener("click", function () {
        load("full");
      });
      actions.appendChild(retry);
      area.appendChild(actions);
      return first;
    });
    if (!moved) announce(text);
  }

  function buildEmpty() {
    setState("empty");
    var first = message(TEXT.empty);
    area.appendChild(el("p", "", TEXT.emptyHint));
    return first;
  }

  function buildList() {
    var shown = items.filter(function (item) {
      if (!drawnKind(item.kind)) return false;
      // An item whose removal is still running stays until the server says.
      return pending[keyOf(item.kind, item.id)] || saved.has(item.kind, item.id) !== false;
    });
    if (!shown.length) return buildEmpty();
    setState("ready");
    summary = el("p", "account-saved__summary");
    summary.setAttribute("tabindex", "-1");
    area.appendChild(summary);
    fullNote = el("p", "account-saved__note");
    area.appendChild(fullNote);
    GROUPS.forEach(function (group) {
      var mine = shown.filter(function (item) {
        return item.kind === group.kind;
      });
      if (!mine.length) return;
      var box = el("div", "account-saved__group");
      var heading = el("h3", "account-saved__heading");
      box.appendChild(heading);
      var note = null;
      if (group.kind === "image_palette") {
        note = el("p", "account-saved__note");
        box.appendChild(note);
      }
      var list = el("ul", "account-saved__list");
      box.appendChild(list);
      mine.forEach(function (item) {
        list.appendChild(drawRow(item.kind, item.id));
      });
      groups[group.kind] = { box: box, heading: heading, list: list, note: note, title: group.title };
      area.appendChild(box);
    });
    updateCounts();
    return summary;
  }

  function drawRow(kind, id) {
    var shown = describe(kind, id);
    var row = el("li", "account-saved__item");
    if (shown.colors.length) {
      var preview = el("span", "account-saved__preview");
      preview.setAttribute("aria-hidden", "true");
      shown.colors.forEach(function (hex) {
        var swatch = el("span", "account-saved__swatch");
        swatch.style.backgroundColor = hex;
        preview.appendChild(swatch);
      });
      row.appendChild(preview);
    }
    var text = el("div", "account-saved__text");
    var name = el(shown.href ? "a" : "span", "account-saved__name", shown.name);
    if (shown.href) name.setAttribute("href", shown.href);
    text.appendChild(name);
    if (shown.detail) text.appendChild(el("span", "account-saved__detail", shown.detail));
    row.appendChild(text);

    // Reads "Remove"; its name for assistive tech is "Remove <item>".
    var remove = button("btn account-page__button account-saved__remove");
    remove.setAttribute("data-account-saved-remove", "");
    var label = el("span", "", TEXT.remove);
    remove.appendChild(label);
    var which = kind === "image_palette" ? shown.name + " " + shown.detail : shown.name;
    remove.appendChild(el("span", "sr-only", " " + which));
    remove.addEventListener("click", function () {
      onRemove(kind, id);
    });
    row.appendChild(remove);
    var entry = { row: row, button: remove, label: label };
    rows[keyOf(kind, id)] = entry;
    if (pending[keyOf(kind, id)]) setBusy(entry, true);
    return row;
  }

  function updateCounts() {
    var shownCount = Object.keys(rows).length;
    if (summary) summary.textContent = count(shownCount, "saved item", "saved items");
    if (fullNote) {
      var full = items.length >= limits.total;
      fullNote.hidden = !full;
      fullNote.textContent = full
        ? "Your Saved list is full (" + thousands(limits.total) + " items). Remove something to save more."
        : "";
    }
    Object.keys(groups).forEach(function (kind) {
      var group = groups[kind];
      group.heading.textContent = group.title + " (" + thousands(group.list.children.length) + ")";
      if (group.note) {
        var atLimit = group.list.children.length >= limits.image_palette;
        group.note.hidden = !atLimit;
        group.note.textContent = atLimit
          ? "You’ve saved " + thousands(limits.image_palette) + " Image Picker palettes, the most allowed."
          : "";
      }
    });
  }

  // ---------- removing ----------

  // While an item's removal runs it is pending: its button — even one
  // redrawn by a refresh meanwhile — stays busy and aria-disabled rather
  // than disabled (so focus stays on it), and no second removal starts.
  // The row goes only once the server confirms.
  function onRemove(kind, id) {
    var key = keyOf(kind, id);
    if (pending[key]) return;
    pending[key] = true;
    setBusy(rows[key], true);
    var gen = generation;
    saved.remove(kind, id).then(function (outcome) {
      if (gen !== generation) return;
      delete pending[key];
      if (outcome && outcome.ok) {
        drop(kind, id);
        return;
      }
      // Not removed: saved.js has already said why, once.
      setBusy(rows[key], false);
    });
  }

  function setBusy(entry, busy) {
    if (!entry) return;
    if (busy) {
      entry.button.setAttribute("aria-disabled", "true");
      entry.button.setAttribute("aria-busy", "true");
    } else {
      entry.button.removeAttribute("aria-disabled");
      entry.button.removeAttribute("aria-busy");
    }
    entry.label.textContent = busy ? TEXT.removing : TEXT.remove;
  }

  // Takes one item off the page. Focus on its row moves to the next Remove
  // button, or the one before it; the last item gone leaves the empty
  // message, which takes focus. True when focus moved onto that message.
  function drop(kind, id) {
    var key = keyOf(kind, id);
    items = items.filter(function (item) {
      return keyOf(item.kind, item.id) !== key;
    });
    var entry = rows[key];
    if (!entry) {
      if (state === "ready") updateCounts();
      return false;
    }
    if (Object.keys(rows).length === 1) return replace(buildEmpty);
    var next = null;
    if (entry.row.contains(document.activeElement)) {
      var buttons = Array.prototype.slice.call(area.querySelectorAll("[data-account-saved-remove]"));
      var at = buttons.indexOf(entry.button);
      next = buttons[at + 1] || buttons[at - 1] || null;
    }
    delete rows[key];
    entry.row.parentNode.removeChild(entry.row);
    var group = groups[kind];
    if (group && !group.list.children.length) {
      area.removeChild(group.box);
      delete groups[kind];
    }
    updateCounts();
    if (next) next.focus();
    return false;
  }

  // Items removed since by another tab (or by anything but this page's own
  // Remove buttons, whose answers are waited for), said once, briefly.
  function prune() {
    var removed = false;
    var moved = false;
    items.slice().forEach(function (item) {
      var key = keyOf(item.kind, item.id);
      if (pending[key] || saved.has(item.kind, item.id) !== false) return;
      if (rows[key]) removed = true;
      if (drop(item.kind, item.id)) moved = true;
    });
    if (removed && !moved) announce(TEXT.updated + " " + listText());
  }

  // ---------- loading ----------

  // mode "full" shows Loading… and says what it finds. "refresh" reads a
  // list already shown again, keeps it on failure, and speaks only when
  // something changed. "silent" is a refresh that says nothing (after an
  // import, whose own line has said what happened).
  function load(mode) {
    if (loading) return;
    var full = mode === "full";
    if (full) showLoading();
    var gen = generation;
    var run = (loading = saved
      .list()
      .then(function (result) {
        if (gen !== generation) return null;
        if (!result || result.ok !== true) return failed(result, full);
        var kinds = [];
        result.items.forEach(function (item) {
          if (FILES[item.kind] && kinds.indexOf(item.kind) === -1) kinds.push(item.kind);
        });
        return Promise.all(kinds.map(readFile)).then(function () {
          if (gen !== generation || saved.signedIn() !== true) return;
          items = result.items.slice();
          limits = result.limits;
          listedAt = Date.now();
          var before = drawnKeys();
          if (!replace(buildList)) {
            if (full) announce(listText());
            else if (mode === "refresh" && drawnKeys() !== before) announce(TEXT.updated + " " + listText());
          }
          offerImport();
        });
      })
      .then(null, function (err) {
        if (window.console) window.console.error(err);
      })
      .then(function () {
        if (loading === run) loading = null;
      }));
  }

  function failed(result, full) {
    if (result && result.reason === "signed-out") {
      clear();
      return;
    }
    if (!full) return;
    showError(result && result.reason === "rate-limited" ? TEXT.tooMany : TEXT.loadFailed);
  }

  // Signed out: nothing about the account stays on the page.
  function clear() {
    generation += 1;
    loading = null;
    items = [];
    rows = {};
    pending = {};
    groups = {};
    summary = null;
    fullNote = null;
    area.textContent = "";
    importBox.textContent = "";
    importBox.hidden = true;
    importOffered = false;
    hush();
    setState("signed-out");
  }

  function onSavedChange() {
    var signedIn = saved.signedIn();
    if (signedIn === false) {
      if (state !== "signed-out") clear();
    } else if (signedIn === true) {
      if (state === "signed-out") load("full");
      else if (state === "ready") prune();
    }
  }

  function shownFor(ms) {
    return (state === "ready" || state === "empty") && Date.now() - listedAt >= ms;
  }

  // ---------- this browser's saves from before accounts ----------

  function offerImport() {
    if (importOffered || saved.importDismissed()) return;
    var old = saved.legacy();
    var fonts = old.fonts;
    var likes = old.paletteLikes;
    if (!fonts.length && !likes.length) return;
    importOffered = true;
    var gen = generation;
    (likes.length ? readFile("palette") : Promise.resolve(null)).then(function (map) {
      if (gen !== generation) return;
      // Likes for palettes no longer on the site are left out. Without the
      // file, every well-formed like is offered.
      if (map) {
        likes = likes.filter(function (id) {
          return !!map[id];
        });
      }
      if (fonts.length || likes.length) drawImport(fonts.length, likes.length, map);
    });
  }

  function choice(text, checked) {
    var label = el("label", "account-saved__choice");
    var input = el("input");
    input.setAttribute("type", "checkbox");
    input.checked = checked;
    label.appendChild(input);
    label.appendChild(el("span", "", text));
    importBox.appendChild(label);
    return input;
  }

  function drawImport(fontCount, likeCount, paletteMap) {
    importBox.textContent = "";
    var title = el("h3", "account-saved__heading", TEXT.importTitle);
    title.id = "account-saved-import-title";
    importBox.setAttribute("role", "group");
    importBox.setAttribute("aria-labelledby", title.id);
    importBox.appendChild(title);
    importBox.appendChild(el("p", "", TEXT.importLede));
    // Fonts are offered ticked; palette likes only when the visitor ticks
    // them (docs/SAVED.md).
    var fonts = fontCount ? choice(count(fontCount, "font you saved", "fonts you saved"), true) : null;
    var likes = likeCount ? choice(count(likeCount, "palette you liked", "palettes you liked"), false) : null;
    var notes = [];
    if (fonts) notes.push(TEXT.importFontsNote);
    if (likes) notes.push(TEXT.importLikesNote);
    importBox.appendChild(el("p", "account-saved__note", notes.join(" ")));
    var actions = el("div", "account-page__actions");
    var add = button("btn btn-primary", TEXT.importAdd);
    var skip = button("btn account-page__button", TEXT.importSkip);
    actions.appendChild(add);
    actions.appendChild(skip);
    importBox.appendChild(actions);
    var status = el("p", "account-saved__message");
    status.setAttribute("role", "status");
    status.setAttribute("tabindex", "-1");
    importBox.appendChild(status);

    function ticked() {
      return !!((fonts && fonts.checked) || (likes && likes.checked));
    }
    function onTick() {
      add.disabled = !ticked();
    }
    if (fonts) fonts.addEventListener("change", onTick);
    if (likes) likes.addEventListener("change", onTick);
    onTick();

    var gen = generation;
    add.addEventListener("click", function () {
      if (add.disabled || add.getAttribute("aria-disabled") === "true" || !ticked()) return;
      add.setAttribute("aria-disabled", "true");
      add.setAttribute("aria-busy", "true");
      add.textContent = TEXT.importAdding;
      skip.disabled = true;
      status.textContent = "";
      saved
        .importLegacy({
          fonts: !!(fonts && fonts.checked),
          palettes: !!(likes && likes.checked),
          known: {
            palette: function (id) {
              return !paletteMap || !!paletteMap[id];
            },
          },
        })
        .then(function (result) {
          if (gen !== generation) return;
          if (result && result.ok) {
            imported(result, status);
            return;
          }
          if (result && result.reason === "signed-out") {
            clear();
            return;
          }
          add.removeAttribute("aria-disabled");
          add.removeAttribute("aria-busy");
          add.textContent = TEXT.importAdd;
          skip.disabled = false;
          status.textContent = (result && result.message) || TEXT.importFailed;
        });
    });

    // "No thanks" is remembered (bpozz:saved-import); where the browser
    // won't store it, the offer is only put away for this page view.
    skip.addEventListener("click", function () {
      if (add.getAttribute("aria-disabled") === "true") return;
      saved.dismissImport();
      var had = importBox.contains(document.activeElement);
      importBox.textContent = "";
      importBox.hidden = true;
      if (had) {
        var target = area.querySelector("[tabindex]");
        if (target) target.focus();
      }
    });

    importBox.hidden = false;
  }

  // The offer becomes its outcome, in the status line it already has, and
  // the list is read again, silently, to show what arrived. When focus was
  // in the offer it moves onto the outcome, which is read from there, so
  // the line stops being a live region and isn't announced a second time.
  // saved.js has already recorded the offer as dealt with.
  function imported(result, status) {
    var had = importBox.contains(document.activeElement);
    Array.prototype.slice.call(importBox.children).forEach(function (child) {
      if (child !== status) importBox.removeChild(child);
    });
    importBox.removeAttribute("role");
    importBox.removeAttribute("aria-labelledby");
    if (had) status.removeAttribute("role");
    var parts = ["Added " + count(result.created, "item", "items") + " to your account."];
    if (result.existing) parts.push(result.existing === 1 ? "1 was already saved." : thousands(result.existing) + " were already saved.");
    if (result.limited) parts.push(thousands(result.limited) + " didn’t fit: your Saved list is full.");
    if (result.invalid) parts.push(thousands(result.invalid) + " couldn’t be added.");
    if (!result.storageUpdated) parts.push("This browser’s old font list couldn’t be updated.");
    status.textContent = parts.join(" ");
    if (had) status.focus();
    load("silent");
  }

  // ---------- start ----------

  root.appendChild(live);
  root.appendChild(importBox);
  root.appendChild(area);
  if (fallback) fallback.hidden = true;
  root.hidden = false;

  saved.onChange(onSavedChange);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && shownFor(RELIST_MS)) load("refresh");
  });
  window.addEventListener("pageshow", function (e) {
    if (e && e.persisted && shownFor(0)) load("refresh");
  });
  load("full");
})();
