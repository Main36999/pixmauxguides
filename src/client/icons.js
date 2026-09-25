/**
 * src/client/icons.js — published as /icons/icons.js.
 *
 * Runs on /icons/ and every /icons/<pack>.html, after /app.js. Every card,
 * chip and download link is already in the page (src/build/icons.js renders
 * them at build time), so with JS off the pages still list and download.
 * This script adds:
 *
 *   filtering   style + category chips and search, with URL state
 *   Copy SVG    fetches the icon's own .svg file and puts its exact text on
 *               the clipboard; the button reads "✓ Copied", then resets
 *   downloads   one open disclosure at a time; Escape / outside click close
 *   detail      the <dialog>, filled from the card that opened it
 *
 * The SVG text is fetched on demand (and warmed when a pointer or keyboard
 * reaches a Copy button), so the page never carries every icon's markup.
 */
(function () {
  "use strict";

  var status = document.getElementById("icons-status");
  var COPY_LABEL = "Copy SVG";
  var COPIED_LABEL = "✓ Copied";
  var FAILED_LABEL = "Copy failed";

  function announce(message) {
    if (!status) return;
    status.textContent = "";
    // A fresh text node after clearing makes repeat messages re-announce.
    window.setTimeout(function () {
      status.textContent = message;
    }, 30);
  }

  function toast(message) {
    if (typeof window.bpozzShowToast === "function") window.bpozzShowToast(message);
  }

  function toArray(list) {
    return Array.prototype.slice.call(list);
  }

  // -------------------------------------------------------------------
  // SVG text, fetched on demand and cached
  // -------------------------------------------------------------------

  var pending = {};
  var loaded = {};

  function fetchSvg(url) {
    if (!pending[url]) {
      pending[url] = window
        .fetch(url, { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (text) {
          text = text.replace(/\s+$/, "");
          if (text.indexOf("<svg") !== 0) throw new Error("not an SVG file");
          loaded[url] = text;
          return text;
        })
        .catch(function (err) {
          delete pending[url];
          throw err;
        });
    }
    return pending[url];
  }

  // -------------------------------------------------------------------
  // clipboard
  // -------------------------------------------------------------------

  /** execCommand fallback for insecure contexts and older browsers. */
  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    if (!ok) throw new Error("copy failed");
  }

  /**
   * WebKit (Safari, and every iOS browser) drops the user gesture across an
   * await, so writeText() after a fetch is refused there; handing
   * ClipboardItem the fetch as a promise is the documented way round it.
   * Chromium does NOT need that, and was measured resolving such a write
   * successfully while leaving the clipboard untouched — a false "Copied".
   * So the promise form is used on WebKit only; everywhere else the fetch
   * completes first and writeText() does the write.
   */
  var WEBKIT_CLIPBOARD =
    typeof window.ClipboardItem === "function" &&
    !window.chrome &&
    /AppleWebKit/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Edg\//.test(navigator.userAgent);

  /**
   * Copies the SVG at `url`. When the text is already cached (warmed when a
   * pointer or keyboard reaches the button) it is written straight away,
   * inside the click. Otherwise it is fetched first — see WEBKIT_CLIPBOARD.
   */
  function copySvg(url) {
    var clip = navigator.clipboard;
    var secure = window.isSecureContext && clip;

    if (loaded[url] !== undefined) {
      var text = loaded[url];
      if (secure && clip.writeText) return clip.writeText(text);
      return new Promise(function (resolve) {
        legacyCopy(text);
        resolve();
      });
    }

    if (WEBKIT_CLIPBOARD && secure && clip.write) {
      try {
        var blob = fetchSvg(url).then(function (t) {
          return new Blob([t], { type: "text/plain" });
        });
        var item = new window.ClipboardItem({ "text/plain": blob });
        return clip.write([item]).catch(function () {
          return fetchSvg(url).then(function (t) {
            return clip.writeText(t);
          });
        });
      } catch (e) {
        /* fall through */
      }
    }
    return fetchSvg(url).then(function (t) {
      if (secure && clip.writeText) return clip.writeText(t);
      legacyCopy(t);
    });
  }

  function setCopyState(btn, state) {
    var label = btn.querySelector("[data-copy-label]");
    window.clearTimeout(btn._iconsTimer);
    if (state) btn.setAttribute("data-state", state);
    else btn.removeAttribute("data-state");
    if (label) label.textContent = state === "copied" ? COPIED_LABEL : state === "failed" ? FAILED_LABEL : COPY_LABEL;
    if (state) {
      btn._iconsTimer = window.setTimeout(function () {
        setCopyState(btn, null);
      }, state === "copied" ? 2000 : 2600);
    }
  }

  // -------------------------------------------------------------------
  // the detail dialog
  // -------------------------------------------------------------------

  var dialog = document.getElementById("icon-dialog");
  var current = null;
  var opener = null;

  function iconFromCard(card) {
    var d = card.dataset;
    return {
      name: d.name,
      styleLabel: d.styleLabel,
      categoryLabel: d.categoryLabel,
      tags: d.tags ? d.tags.split(" ") : [],
      packName: d.packName,
      packUrl: d.packUrl,
      svg: d.svg || "",
      svgFile: d.svgFile || "",
      png: d.png || "",
      pngFile: d.pngFile || "",
      pngSize: d.pngSize || "",
    };
  }

  function field(name) {
    return dialog.querySelector('[data-field="' + name + '"]');
  }

  function action(name) {
    return dialog.querySelector('[data-dialog-action="' + name + '"]');
  }

  function openDialog(card, trigger) {
    if (!dialog || typeof dialog.showModal !== "function") return;
    var icon = iconFromCard(card);
    current = icon;
    opener = trigger;

    dialog.querySelector("#icon-dialog-title").textContent = icon.name;
    // The preview <img> is created here rather than shipped with a
    // placeholder src, so the page never carries an empty image.
    var preview = dialog.querySelector("#icon-dialog-preview");
    var img = preview.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.alt = "";
      img.width = 96;
      img.height = 96;
      preview.appendChild(img);
    }
    img.src = icon.svg || icon.png;
    preview.classList.toggle("icon-dialog__preview--raster", !icon.svg);

    field("style").textContent = icon.styleLabel;
    field("category").textContent = icon.categoryLabel;
    var pack = field("pack");
    pack.textContent = icon.packName;
    pack.href = icon.packUrl;

    var formats = [];
    if (icon.svg) formats.push("SVG");
    if (icon.png) formats.push("PNG " + icon.pngSize + " × " + icon.pngSize);
    field("formats").textContent = formats.join(", ");

    var tags = field("tags");
    tags.textContent = "";
    icon.tags.forEach(function (tag) {
      var li = document.createElement("li");
      li.textContent = tag;
      tags.appendChild(li);
    });
    tags.closest(".icon-dialog__tags").hidden = !icon.tags.length;

    var copy = action("copy");
    copy.hidden = !icon.svg;
    setCopyState(copy, null);
    var svgLink = action("svg");
    svgLink.hidden = !icon.svg;
    if (icon.svg) {
      svgLink.href = icon.svg;
      svgLink.setAttribute("download", icon.svgFile);
    }
    var pngLink = action("png");
    pngLink.hidden = !icon.png;
    if (icon.png) {
      pngLink.href = icon.png;
      pngLink.setAttribute("download", icon.pngFile);
    }

    var code = dialog.querySelector("#icon-dialog-code");
    code.hidden = !icon.svg;
    code.open = false;
    dialog.querySelector("#icon-dialog-code-text").textContent = "";

    dialog.showModal();
    if (icon.svg) fetchSvg(icon.svg).catch(function () {});
  }

  if (dialog) {
    dialog.addEventListener("close", function () {
      if (opener && document.contains(opener)) opener.focus();
      opener = null;
    });
    // A click on the <dialog> element itself is a click on the backdrop:
    // its padding is 0 and the inner wrapper fills it.
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) dialog.close();
    });
    var code = dialog.querySelector("#icon-dialog-code");
    code.addEventListener("toggle", function () {
      if (!code.open || !current || !current.svg) return;
      var out = dialog.querySelector("#icon-dialog-code-text");
      var url = current.svg;
      fetchSvg(url).then(
        function (text) {
          if (current && current.svg === url) out.textContent = text;
        },
        function () {
          out.textContent = "Couldn't load the SVG code. Use Download SVG instead.";
        },
      );
    });
  }

  // -------------------------------------------------------------------
  // download disclosures
  // -------------------------------------------------------------------

  function openDownloads() {
    return toArray(document.querySelectorAll(".icon-download[open]"));
  }

  // `toggle` does not bubble; a capturing listener still sees it.
  document.addEventListener(
    "toggle",
    function (e) {
      var d = e.target;
      if (!d.classList || !d.classList.contains("icon-download") || !d.open) return;
      openDownloads().forEach(function (other) {
        if (other !== d) other.open = false;
      });
      // The menu hangs from the tile's right corner. In the first column of a
      // narrow grid that would run off the left edge, so anchor it left.
      var list = d.querySelector(".icon-download__list");
      if (list) {
        list.classList.remove("icon-download__list--start");
        if (list.getBoundingClientRect().left < 8) list.classList.add("icon-download__list--start");
      }
    },
    true,
  );

  // -------------------------------------------------------------------
  // clicks and keys
  // -------------------------------------------------------------------

  document.addEventListener("click", function (e) {
    var openBtn = e.target.closest("[data-icon-open]");
    if (openBtn) {
      openDownloads().forEach(function (d) {
        d.open = false;
      });
      openDialog(openBtn.closest(".icon-card"), openBtn);
      return;
    }

    if (e.target.closest("[data-icon-close]")) {
      if (dialog) dialog.close();
      return;
    }

    var copyBtn = e.target.closest("[data-icon-copy]");
    if (copyBtn) {
      var inDialog = !!copyBtn.closest("#icon-dialog");
      var card = inDialog ? null : copyBtn.closest(".icon-card");
      var url = inDialog ? current && current.svg : card && card.dataset.svg;
      var name = inDialog
        ? current && current.name + " — " + current.styleLabel
        : card && card.dataset.name + " — " + card.dataset.styleLabel;
      if (!url) return;
      copySvg(url).then(
        function () {
          setCopyState(copyBtn, "copied");
          announce(name + " SVG code copied to clipboard");
        },
        function () {
          setCopyState(copyBtn, "failed");
          announce("Couldn't copy " + name + ". Your browser blocked clipboard access.");
          toast("Couldn't copy — your browser blocked clipboard access. Download the SVG instead.");
        },
      );
      return;
    }

    // Choosing a format closes its disclosure; the download itself proceeds.
    var item = e.target.closest(".icon-download__item");
    if (item) {
      var owner = item.closest(".icon-download");
      window.setTimeout(function () {
        owner.open = false;
      }, 0);
      return;
    }

    if (!e.target.closest(".icon-download")) {
      openDownloads().forEach(function (d) {
        d.open = false;
      });
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var within = document.activeElement && document.activeElement.closest(".icon-download[open]");
    if (within) {
      e.preventDefault();
      within.open = false;
      within.querySelector("summary").focus();
    }
  });

  // Warm the cache when a Copy button is about to be used, so the click can
  // write synchronously.
  function warm(e) {
    var btn = e.target.closest && e.target.closest(".icon-card [data-icon-copy]");
    if (!btn) return;
    var url = btn.closest(".icon-card").dataset.svg;
    if (url && loaded[url] === undefined) fetchSvg(url).catch(function () {});
  }
  document.addEventListener("pointerover", warm);
  document.addEventListener("focusin", warm);

  // -------------------------------------------------------------------
  // filtering: style, category, search
  // -------------------------------------------------------------------

  var grid = document.getElementById("icon-grid");
  if (grid) initFilters();

  function initFilters() {
    var cards = toArray(grid.children);
    var total = cards.length;
    var chips = toArray(document.querySelectorAll(".icons-chip"));
    var search = document.getElementById("icons-search");
    var countLine = document.getElementById("icons-count");
    var empty = document.getElementById("icons-empty");

    function valuesOf(filter) {
      return chips
        .filter(function (c) {
          return c.getAttribute("data-filter") === filter;
        })
        .map(function (c) {
          return c.getAttribute("data-value");
        });
    }
    var allowed = { style: valuesOf("style"), category: valuesOf("category") };
    var labels = {};
    chips.forEach(function (c) {
      labels[c.getAttribute("data-filter") + ":" + c.getAttribute("data-value")] = c.textContent.trim();
    });

    var params = new URLSearchParams(window.location.search);
    function fromUrl(filter) {
      var v = params.get(filter);
      return v && allowed[filter].indexOf(v) !== -1 ? v : "";
    }
    var state = { style: fromUrl("style"), category: fromUrl("category"), query: params.get("q") || "" };
    search.value = state.query;

    function normalize(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[-,]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function writeUrl() {
      var next = new URLSearchParams();
      if (state.style) next.set("style", state.style);
      if (state.category) next.set("category", state.category);
      if (state.query) next.set("q", state.query);
      var qs = next.toString();
      try {
        window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
      } catch (e) {
        /* file:// or a sandboxed frame — filtering still works */
      }
    }

    var announceTimer = null;

    var categoryChips = chips.filter(function (c) {
      return c.getAttribute("data-filter") === "category" && c.getAttribute("data-value");
    });

    /**
     * Category chips follow the active style: a category with no icon in
     * that style is hidden rather than offered as a filter that can only
     * return nothing, and a selected category the new style does not have
     * falls back to All. (Filtering itself always ANDs style and category,
     * so no excluded style can ever show through.)
     */
    function syncCategoryChips() {
      var available = {};
      cards.forEach(function (card) {
        if (!state.style || card.getAttribute("data-style") === state.style) {
          available[card.getAttribute("data-category")] = true;
        }
      });
      categoryChips.forEach(function (c) {
        c.hidden = !available[c.getAttribute("data-value")];
      });
      if (state.category && !available[state.category]) state.category = "";
    }

    function apply(options) {
      syncCategoryChips();
      var terms = normalize(state.query).split(" ").filter(Boolean);
      var shown = 0;
      cards.forEach(function (card) {
        var ok =
          (!state.style || card.getAttribute("data-style") === state.style) &&
          (!state.category || card.getAttribute("data-category") === state.category);
        if (ok && terms.length) {
          var hay = card.getAttribute("data-search");
          ok = terms.every(function (t) {
            return hay.indexOf(t) !== -1;
          });
        }
        card.hidden = !ok;
        if (ok) shown += 1;
      });

      chips.forEach(function (c) {
        var f = c.getAttribute("data-filter");
        c.setAttribute("aria-pressed", String(c.getAttribute("data-value") === state[f]));
      });

      countLine.textContent =
        shown === total ? total + (total === 1 ? " icon" : " icons") : "Showing " + shown + " of " + total + " icons";
      empty.hidden = shown > 0;
      writeUrl();

      if (options && options.announce) {
        window.clearTimeout(announceTimer);
        announceTimer = window.setTimeout(function () {
          var where = [];
          if (state.style) where.push(labels["style:" + state.style]);
          if (state.category) where.push(labels["category:" + state.category]);
          announce(shown + (shown === 1 ? " icon" : " icons") + " shown" + (where.length ? " in " + where.join(", ") : ""));
        }, 400);
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        state[chip.getAttribute("data-filter")] = chip.getAttribute("data-value");
        apply({ announce: true });
      });
    });

    search.addEventListener("input", function () {
      state.query = search.value;
      apply({ announce: true });
    });

    var reset = document.querySelector("[data-icons-reset]");
    if (reset) {
      reset.addEventListener("click", function () {
        state = { style: "", category: "", query: "" };
        search.value = "";
        apply({ announce: true });
        search.focus();
      });
    }

    apply();
  }
})();
