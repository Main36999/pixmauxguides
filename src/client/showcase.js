/**
 * src/client/showcase.js — the design-preview interactions of the platform
 * pages (src/build/showcase.js) and the homepage's discovery block.
 *
 * Everything here runs in the browser only and sends nothing anywhere:
 *
 *   - discovery: discipline chips and "Load more" over the rendered cards;
 *     ?discipline= (and an older ?q= link) is read on load and kept in the
 *     URL. The discovery search is the site's search component: it opens
 *     /search with its category (see partials/header.html)
 *   - /search for the Projects and Designers categories: the sample set
 *   - design-preview states: ?state=loading|empty|error, or the floating
 *     "Preview state" control, swaps in the state panels a page carries
 *   - Save on demo projects: remembered in this browser (localStorage)
 *   - Copy link, dialogs, toasts, profile tabs
 *   - studio: status filter, the four-step share flow (images are read
 *     locally with object URLs, never uploaded), live profile preview,
 *     character counters
 *   - report form and the moderation queue
 *
 * Loaded after /app.js. Guards itself, so loading it twice runs it once.
 */
(function () {
  "use strict";

  if (window.__bpozzShowcase) return;
  window.__bpozzShowcase = true;

  var params = new URLSearchParams(location.search);
  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  // ---------- toast ----------
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.setAttribute("data-visible", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.removeAttribute("data-visible");
    }, 2800);
  }

  // ---------- storage (per-browser convenience only) ----------
  var SAVED_KEY = "bpozz-demo-saved";
  function readSaved() {
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function writeSaved(list) {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch (e) {
      /* private mode: the toggle still works for this page view */
    }
  }

  // ---------- discovery ----------
  $$("[data-discover]").forEach(function (section) {
    var kind = section.getAttribute("data-discover");
    var grid = $("[data-shot-grid]", section);
    if (!grid) return;
    var items = $$(kind === "designers" ? "[data-designer]" : "[data-shot]", grid);
    var chips = $$("[data-chip]", section);
    var countEl = $("[data-discover-count]", section);
    var emptyEl = $("[data-discover-empty]", section);
    var moreBtn = $("[data-load-more]", section);
    var endEl = $("[data-discover-end]", section);
    var perPage = Number(section.getAttribute("data-per-page")) || 0;
    var isHome = section.hasAttribute("data-home");
    var page = 1;
    var discipline = params.get("discipline") || "";
    // ?q= is from before revision 04, when this block's search filtered the
    // page in place; such a link still narrows the cards (the reset button
    // clears it). The search box itself now opens /search.
    var query = (params.get("q") || "").trim();
    var noun = kind === "designers" ? ["designer", "designers"] : ["project", "projects"];

    if (discipline && !chips.some(function (c) { return c.getAttribute("data-chip") === discipline; })) {
      discipline = "";
    }

    function matches(item) {
      var d = kind === "designers" ? (item.getAttribute("data-disciplines") || "").split(" ") : [item.getAttribute("data-discipline")];
      if (discipline && d.indexOf(discipline) === -1) return false;
      if (query && item.getAttribute("data-search").indexOf(query.toLowerCase()) === -1) return false;
      return true;
    }

    function apply() {
      var shown = 0;
      var total = 0;
      items.forEach(function (item) {
        var ok = matches(item);
        if (ok) total += 1;
        var visible = ok && (!perPage || total <= page * perPage);
        item.hidden = !visible;
        if (visible) shown += 1;
      });
      chips.forEach(function (c) {
        c.setAttribute("aria-pressed", String(c.getAttribute("data-chip") === discipline));
      });
      if (countEl) {
        var of = countEl.getAttribute("data-count-of");
        var label = of && !discipline && !query
          ? "Latest " + total + " of " + of + " " + noun[1]
          : total + " " + (total === 1 ? noun[0] : noun[1]);
        if (query) label += " for “" + query + "”";
        countEl.textContent = label;
      }
      if (emptyEl) emptyEl.hidden = total > 0;
      grid.hidden = total === 0;
      if (moreBtn) {
        moreBtn.hidden = shown >= total;
        if (endEl) endEl.hidden = !(shown >= total && total > perPage);
      }
    }

    function syncUrl() {
      if (isHome) return;
      var next = new URLSearchParams(location.search);
      if (query) next.set("q", query);
      else next.delete("q");
      if (discipline) next.set("discipline", discipline);
      else next.delete("discipline");
      var qs = next.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        discipline = chip.getAttribute("data-chip");
        page = 1;
        apply();
        syncUrl();
      });
    });
    if (moreBtn) {
      moreBtn.addEventListener("click", function () {
        var firstNew = null;
        page += 1;
        apply();
        items.some(function (item) {
          if (!item.hidden && Number(item.getAttribute("data-page")) === page) {
            firstNew = item;
            return true;
          }
          return false;
        });
        var link = firstNew && $("a", firstNew);
        if (link) link.focus({ preventScroll: false });
      });
    }
    $$("[data-discover-reset]", section).forEach(function (btn) {
      btn.addEventListener("click", function () {
        query = "";
        discipline = "";
        page = 1;
        apply();
        syncUrl();
      });
    });

    apply();
  });

  // ---------- discovery search: focus ring for keyboard users only ----------
  // The header search's rule (see its inline script): a pointer press marks
  // the form data-pointer-focus until focus leaves it, and the ring skips
  // marked forms.
  $$("[data-discover-search]").forEach(function (form) {
    form.addEventListener("pointerdown", function () {
      form.setAttribute("data-pointer-focus", "");
    });
    form.addEventListener("focusout", function (e) {
      if (!form.contains(e.relatedTarget)) form.removeAttribute("data-pointer-focus");
    });
  });

  // ---------- discovery pages: the header search waits for the discovery search ----------
  // On the homepage, /projects/ and /designers/ the page's own (discovery)
  // search is the search until it has scrolled up under the sticky header:
  // <html> .has-header-search says it has. The trigger is the discovery
  // search's own position against the header's real height, which differs
  // by breakpoint. An observer only speaks when the search crosses into or
  // out of view, so a jump straight past it (an anchor link, a page
  // restored scrolled down, the End key) said nothing: the visitor's
  // scrolling re-reads the position too, once a frame (2026-10-20).
  //
  // 641px and wider, platform.css shows the header search itself in the
  // bar while .has-header-search is set; a field that holds focus is never
  // hidden under the visitor and hides once focus leaves it.
  //
  // 640px and narrower (revision 06), .has-header-search shows the header's
  // search button instead, which opens the search as a tray under the bar
  // (the header's script, window.bpozzSearchTray). When the page's own
  // search is back in view, the tray closes and the button hides: a cursor
  // that was in the tray, or on the button, moves to the page's own search,
  // which holds the same query and category.
  //
  // Without a discovery search the header's own search stays; without
  // IntersectionObserver the scroll re-read alone keeps it right.
  (function () {
    var root = document.documentElement;
    if (!/(^|\s)(page-home|sc-projects|sc-designers)(\s|$)/.test(document.body.className)) return;
    var discovery = $(".discover__search");
    var header = $(".site-header");
    var headerSearch = header && $(".header-bar > .header-search", header);
    if (!discovery || !headerSearch) {
      root.classList.add("has-header-search");
      return;
    }
    var field = $('input[type="search"]', discovery);
    var phone = window.matchMedia("(max-width: 640px)");
    var past = false;
    var observer = null;
    var observedHeight = -1;

    function apply() {
      if (!phone.matches) {
        var focused = headerSearch.contains(document.activeElement);
        root.classList.toggle("has-header-search", past || focused);
        return;
      }
      if (!past) {
        var toggle = $(".header-bar > .header-search-toggle", header);
        var held = document.activeElement === toggle || headerSearch.contains(document.activeElement);
        if (window.bpozzSearchTray) window.bpozzSearchTray.close(field);
        // The button is about to hide, and the field only shows in the tray:
        // either would take the cursor with it.
        if (held && field) field.focus({ preventScroll: true });
      }
      root.classList.toggle("has-header-search", past);
    }
    function observe() {
      var height = Math.round(header.getBoundingClientRect().height);
      if (height === observedHeight) return;
      observedHeight = height;
      if (typeof IntersectionObserver !== "function") return;
      if (observer) observer.disconnect();
      var onChange = function (entries) {
        entries.forEach(function (entry) {
          // Out of the area below the header, and above it rather than
          // still further down the page: scrolled past.
          past = !entry.isIntersecting && entry.boundingClientRect.top < height;
        });
        apply();
      };
      var options = { rootMargin: "-" + height + "px 0px 0px 0px", threshold: 0 };
      // The document's own viewport as the root: an implicit root is the
      // top-level viewport, which ignores rootMargin when this page is
      // framed by another origin. Browsers without document roots fall back.
      try {
        observer = new IntersectionObserver(onChange, Object.assign({ root: document }, options));
      } catch (err) {
        observer = new IntersectionObserver(onChange, options);
      }
      observer.observe(discovery);
    }
    // The same rule as the observer's, read from where the search is now:
    // scrolled past once its bottom is above the header's.
    var ticking = false;
    function reread() {
      ticking = false;
      past = discovery.getBoundingClientRect().bottom <= observedHeight;
      apply();
    }
    observe();
    reread();
    window.addEventListener("resize", observe);
    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(reread);
      },
      { passive: true },
    );
    headerSearch.addEventListener("focusout", function () {
      setTimeout(apply, 0);
    });
    // Across 640/641px the bar's search turns into the button and tray, or
    // back: the header's script closes or opens the tray first.
    function onBreakpoint() {
      observe();
      reread();
    }
    if (phone.addEventListener) phone.addEventListener("change", onBreakpoint);
    else if (phone.addListener) phone.addListener(onBreakpoint);
  })();

  // ---------- design-preview states ----------
  // A page offers states when it carries [data-state-panel] elements. The
  // default view is everything that is not a state panel ("ready" panels
  // are part of it).
  var statePanels = $$("[data-state-panel]");
  var hasStates = statePanels.some(function (p) {
    return p.getAttribute("data-state-panel") !== "ready";
  });
  function setState(state) {
    $$(
      "[data-discover] [data-shot-grid], [data-discover] .discover__more, [data-discover] [data-discover-empty], " +
        "[data-home-feed] .feed-panel, [data-home-feed] [data-feed-empty], [data-home-feed] .feed-foot",
    ).forEach(function (el) {
      el.style.display = state === "default" ? "" : "none";
    });
    statePanels.forEach(function (panel) {
      var name = panel.getAttribute("data-state-panel");
      if (name === "ready") panel.hidden = state === "empty";
      else panel.hidden = name !== state;
    });
    $$("[data-state-option]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-state-option") === state));
    });
  }
  if (hasStates) {
    var available = ["default"];
    ["loading", "empty", "error"].forEach(function (s) {
      if (statePanels.some(function (p) { return p.getAttribute("data-state-panel") === s; })) available.push(s);
    });
    var bar = document.createElement("div");
    bar.className = "state-switch";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Design preview: page state");
    bar.innerHTML =
      '<span class="state-switch__label">Preview state</span>' +
      available
        .map(function (s) {
          return '<button type="button" data-state-option="' + s + '" aria-pressed="false">' + s.charAt(0).toUpperCase() + s.slice(1) + "</button>";
        })
        .join("");
    document.body.appendChild(bar);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-state-option]");
      if (b) setState(b.getAttribute("data-state-option"));
    });
    $$("[data-state-reset]").forEach(function (b) {
      b.addEventListener("click", function () {
        setState("default");
      });
    });
    var initial = params.get("state");
    setState(available.indexOf(initial) !== -1 ? initial : "default");
  }

  // ---------- save (demo) ----------
  var saved = readSaved();
  function paintSaves() {
    $$("[data-demo-save]").forEach(function (btn) {
      var on = saved.indexOf(btn.getAttribute("data-demo-save")) !== -1;
      btn.setAttribute("aria-pressed", String(on));
      var label = $("[data-demo-save-label]", btn);
      if (label) label.textContent = on ? "Saved" : "Save";
    });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-demo-save]");
    if (!btn) return;
    e.preventDefault();
    var id = btn.getAttribute("data-demo-save");
    var at = saved.indexOf(id);
    if (at === -1) saved.push(id);
    else saved.splice(at, 1);
    writeSaved(saved);
    paintSaves();
    toast(at === -1 ? "Saved in this browser only (design preview)." : "Removed from saved.");
  });
  paintSaves();

  // ---------- like (demo) ----------
  // The heart on a card and on a project page. A like is kept in this
  // browser only and adds one to the SAMPLE count shown (data-count); it is
  // never sent anywhere and nobody else sees it. Independent of Save. The
  // button sits outside the card's link, so it never opens the project.
  var LIKED_KEY = "bpozz-demo-liked";
  var liked = (function () {
    try {
      return JSON.parse(localStorage.getItem(LIKED_KEY) || "[]");
    } catch (e) {
      return [];
    }
  })();
  function compact(n) {
    if (n < 1000) return String(n);
    var k = n / 1000;
    return (k < 10 ? k.toFixed(1).replace(/\.0$/, "") : String(Math.round(k))) + "k";
  }
  function paintLikes(scope) {
    $$("[data-demo-like]", scope).forEach(function (btn) {
      var on = liked.indexOf(btn.getAttribute("data-demo-like")) !== -1;
      var count = Number(btn.getAttribute("data-count")) + (on ? 1 : 0);
      btn.setAttribute("aria-pressed", String(on));
      var out = $(".like-btn__count", btn);
      if (out) out.textContent = compact(count);
      var name = (btn.getAttribute("aria-label") || "").replace(/^(Like|Unlike) /, "").replace(/ \(sample count.*$/, "");
      btn.setAttribute("aria-label", (on ? "Unlike " : "Like ") + name + " (sample count: " + count + " likes)");
    });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-demo-like]");
    if (!btn) return;
    e.preventDefault();
    var id = btn.getAttribute("data-demo-like");
    var at = liked.indexOf(id);
    if (at === -1) liked.push(id);
    else liked.splice(at, 1);
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify(liked));
    } catch (err) {
      /* private mode: the like still shows for this page view */
    }
    paintLikes(document);
    toast(at === -1 ? "Liked in this browser only. Sample counts aren't shared." : "Like removed.");
  });
  paintLikes(document);

  // Saves and likes on cards added after load (the feeds below).
  function paintMarks() {
    paintSaves();
    paintLikes(document);
  }

  // ---------- homepage: Projects / Designers feed ----------
  // One gallery, two tabs, switched in place (no navigation): the tab links
  // still point at /projects/ and /designers/ for no-JS visitors and for
  // opening in a new tab. Each tab pages through a SOURCE: today an inert
  // <template> holding every sample card, read in batches by a cursor; a
  // real backend replaces createTemplateSource() with one that fetches
  // { items, nextCursor } for the same { tab, cursor, size, discipline }
  // request, and the gallery code stays as it is.
  //
  // The grid appends a batch when its end comes within reach of the
  // viewport (IntersectionObserver on a sentinel, and the visitor's own
  // scrolling), shows a quiet loading line while a batch is on its way,
  // ignores a request while one is pending, never adds a card twice, and
  // says so when the set is used up. The Load more button is the keyboard
  // and no-IntersectionObserver path.
  //
  // A tab or filter change resets the grid to its first batch (revision
  // 04): if it was chosen further down the page, the gallery's top comes
  // back under the header first, and nothing more loads until the visitor
  // scrolls again, so a reset never runs straight on through several
  // batches.
  (function () {
    var feed = $("[data-home-feed]");
    if (!feed) return;
    var batch = Number(feed.getAttribute("data-batch")) || 12;
    var tabs = $$("[data-feed-tabs] [data-tab]", feed);
    var chips = $$("[data-chip]", feed);
    var status = $("[data-feed-status]", feed);
    var empty = $("[data-feed-empty]", feed);
    var emptyTitle = $("[data-feed-empty-title]", feed);
    var loading = $("[data-feed-loading]", feed);
    var more = $("[data-feed-more]", feed);
    var end = $("[data-feed-end]", feed);
    var sentinel = $("[data-feed-sentinel]", feed);
    var order = $("[data-feed-order] span", feed);
    var NOUN = { projects: ["project", "projects"], designers: ["designer", "designers"] };
    var ORDER = { projects: "Newest first", designers: "Ordered by most recent project" };

    function createTemplateSource(name) {
      var template = $('template[data-feed-source="' + name + '"]', feed);
      var items = template ? Array.prototype.slice.call(template.content.children) : [];
      return {
        // request: { cursor, size, discipline } -> Promise<{ items, nextCursor, total }>
        page: function (request) {
          var matching = items.filter(function (item) {
            if (!request.discipline) return true;
            var list = (item.getAttribute("data-discipline") || item.getAttribute("data-disciplines") || "").split(" ");
            return list.indexOf(request.discipline) !== -1;
          });
          var start = request.cursor || 0;
          var slice = matching.slice(start, start + request.size);
          var next = start + slice.length < matching.length ? start + slice.length : null;
          return new Promise(function (resolve) {
            // A short wait so the loading state can be reviewed; a network
            // source has its own.
            setTimeout(function () {
              resolve({
                items: slice.map(function (n) {
                  return n.cloneNode(true);
                }),
                nextCursor: next,
                total: matching.length,
              });
            }, 220);
          });
        },
      };
    }

    var sources = { projects: createTemplateSource("projects"), designers: createTemplateSource("designers") };
    var panels = {};
    $$("[data-feed-panel]", feed).forEach(function (panel) {
      panels[panel.getAttribute("data-feed-panel")] = panel;
    });
    var state = {
      tab: "projects",
      discipline: "",
      cursor: null,
      done: false,
      pending: false,
      generation: 0,
      seen: {},
      total: 0,
      // false from a reset until the visitor scrolls: only then may the
      // feed load on its own again.
      armed: true,
      resetAt: 0,
    };

    function grid() {
      return $("[data-feed-grid]", panels[state.tab]);
    }

    function announce() {
      if (!status) return;
      var shown = grid().children.length;
      var noun = NOUN[state.tab];
      status.textContent = shown + " of " + state.total + " sample " + (state.total === 1 ? noun[0] : noun[1]) + " shown";
    }

    function paintFoot() {
      loading.hidden = !state.pending;
      more.hidden = state.done || state.pending;
      end.hidden = !(state.done && state.total > 0);
      if (!end.hidden) end.textContent = "That's every sample " + NOUN[state.tab][0] + " for now. The design preview has " + state.total + ".";
      empty.hidden = !(state.done && state.total === 0);
      if (!empty.hidden) emptyTitle.textContent = "No sample " + NOUN[state.tab][1] + " in this discipline yet";
    }

    // `chain`: a load the visitor's scrolling asked for keeps going while
    // the grid's end is still in reach (a short batch on a tall screen);
    // the first batch after a reset and a Load more press load one batch.
    function load(chain) {
      if (state.pending || state.done) return;
      state.pending = true;
      paintFoot();
      var generation = state.generation;
      sources[state.tab]
        .page({ cursor: state.cursor || 0, size: batch, discipline: state.discipline })
        .then(function (result) {
          // A tab or filter change while this batch was on its way: drop it.
          if (generation !== state.generation) return;
          var target = grid();
          result.items.forEach(function (item) {
            var id = item.getAttribute("data-id");
            if (state.seen[id]) return;
            state.seen[id] = true;
            target.appendChild(item);
          });
          state.total = result.total;
          state.cursor = result.nextCursor;
          state.done = result.nextCursor === null;
          state.pending = false;
          paintMarks();
          paintFoot();
          announce();
          // Still room on screen after a short batch: keep going.
          if (chain && !state.done && inReach()) load(true);
        });
    }

    function reset() {
      state.generation += 1;
      state.cursor = 0;
      state.done = false;
      state.pending = false;
      state.seen = {};
      state.total = 0;
      state.armed = false;
      state.resetAt = Date.now();
      grid().innerHTML = "";
      // Chosen with the gallery's top above the screen: bring it back under
      // the header (instantly, so no scrolling of ours re-arms the feed).
      if (feed.getBoundingClientRect().top < 0) {
        try {
          feed.scrollIntoView({ block: "start", behavior: "instant" });
        } catch (e) {
          feed.scrollIntoView(true);
        }
      }
      load(false);
    }

    function inReach() {
      // Hidden (a preview state is showing): never in reach.
      if (!sentinel.getClientRects().length) return false;
      var r = sentinel.getBoundingClientRect();
      return r.top < window.innerHeight + 600;
    }

    // The visitor's scrolling re-arms the feed after a reset (any scroll
    // that comes later than the reset's own), and loads when the end is in
    // reach; once a frame at most.
    var ticking = false;
    window.addEventListener(
      "scroll",
      function () {
        if (!state.armed && Date.now() - state.resetAt > 300) state.armed = true;
        if (!state.armed || ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          if (inReach()) load(true);
        });
      },
      { passive: true },
    );

    function selectTab(name, focus) {
      if (!sources[name]) return;
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-tab") === name;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on) t.setAttribute("aria-current", "page");
        else t.removeAttribute("aria-current");
        if (on && focus) t.focus();
      });
      Object.keys(panels).forEach(function (key) {
        panels[key].hidden = key !== name;
      });
      if (order) order.textContent = ORDER[name];
      more.textContent = "Load more " + NOUN[name][1];
      state.tab = name;
      // The search's category follows the tab, unless Guides was chosen.
      var scope = window.bpozzSearchScope;
      if (scope && scope.get() !== "guides") scope.set(name);
      reset();
      try {
        var next = new URLSearchParams(location.search);
        if (name === "projects") next.delete("tab");
        else next.set("tab", name);
        var qs = next.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      } catch (e) {
        /* sandboxed frame: the tab still switches */
      }
    }

    // The tabs become an in-page tablist.
    var tablist = $("[data-feed-tabs]", feed);
    tablist.setAttribute("role", "tablist");
    tabs.forEach(function (tab, i) {
      var panel = panels[tab.getAttribute("data-tab")];
      tab.setAttribute("role", "tab");
      tab.id = "feed-tab-" + tab.getAttribute("data-tab");
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      tab.addEventListener("click", function (e) {
        e.preventDefault();
        if (tab.getAttribute("data-tab") !== state.tab) selectTab(tab.getAttribute("data-tab"), false);
      });
      tab.addEventListener("keydown", function (e) {
        var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        var next = tabs[(i + step + tabs.length) % tabs.length];
        selectTab(next.getAttribute("data-tab"), true);
      });
    });

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.discipline = chip.getAttribute("data-chip");
        chips.forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === chip));
        });
        reset();
      });
    });
    $$("[data-feed-reset]", feed).forEach(function (b) {
      b.addEventListener("click", function () {
        state.discipline = "";
        chips.forEach(function (c) {
          c.setAttribute("aria-pressed", String(c.getAttribute("data-chip") === ""));
        });
        reset();
      });
    });

    // The no-JS link becomes the manual Load more.
    more.addEventListener("click", function (e) {
      e.preventDefault();
      var first = grid().children.length;
      load(false);
      // Move focus to the first new card once it lands.
      var watch = setInterval(function () {
        if (state.pending) return;
        clearInterval(watch);
        var card = grid().children[first];
        var link = card && $("a", card);
        if (link) link.focus();
      }, 60);
    });

    if (typeof IntersectionObserver === "function") {
      var onReach = function (entries) {
        if (state.armed && entries.some(function (en) { return en.isIntersecting; })) load(true);
      };
      var reach;
      try {
        reach = new IntersectionObserver(onReach, { root: document, rootMargin: "0px 0px 600px 0px" });
      } catch (err) {
        reach = new IntersectionObserver(onReach, { rootMargin: "0px 0px 600px 0px" });
      }
      reach.observe(sentinel);
    }

    // Start: the cards already in the page are the first batch of Projects.
    var initialTab = params.get("tab") === "designers" ? "designers" : "projects";
    tabs.forEach(function (t) {
      t.setAttribute("aria-selected", String(t.getAttribute("data-tab") === initialTab));
      t.tabIndex = t.getAttribute("data-tab") === initialTab ? 0 : -1;
    });
    if (initialTab === "designers") {
      selectTab("designers", false);
    } else {
      $$("[data-id]", grid()).forEach(function (card) {
        state.seen[card.getAttribute("data-id")] = true;
      });
      state.cursor = grid().children.length;
      state.total = $('template[data-feed-source="projects"]', feed).content.children.length;
      state.done = state.cursor >= state.total;
      more.textContent = "Load more projects";
      paintFoot();
      announce();
    }
  })();

  // ---------- /search: the Projects and Designers categories (sample data) ----------
  // /search?s=…&scope=projects|designers searches the design preview's
  // sample set: the cards whose text holds every word of the query (a
  // project's title, designer, discipline and tags; a designer's name,
  // headline, city and disciplines). Nothing is invented: no match is
  // said as such. src/client/search.js stands down for these two
  // categories (it answers Guides, and every URL without a category, from
  // the real index), so the page's heading, intro and status line are
  // written here, about the sample set actually shown: never a "0 results"
  // heading over sample matches.
  (function () {
    var section = $("[data-search-sample]");
    if (!section) return;
    var scope = params.get("scope");
    if (scope !== "projects" && scope !== "designers") return;
    var query = (params.get("s") || "").replace(/\s+/g, " ").trim();
    var words = query.toLowerCase().split(" ").filter(Boolean);
    var noun = scope === "projects" ? ["project", "projects"] : ["designer", "designers"];
    var heading = document.getElementById("search-heading");
    var dek = document.getElementById("search-dek");
    var count = document.getElementById("search-results-count");
    if (dek) {
      dek.textContent =
        scope === "projects"
          ? "Projects are sample work for the design preview, not real bpozz content."
          : "Designers are sample profiles for the design preview, not real bpozz members.";
    }
    if (!words.length) return;

    var group = $('[data-sample-group="' + scope + '"]', section);
    var target = $("[data-sample-grid]", group);
    var template = $('template[data-sample-source="' + scope + '"]', section);
    var matches = Array.prototype.filter.call(template.content.children, function (item) {
      var text = item.getAttribute("data-search") || "";
      return words.every(function (w) {
        return text.indexOf(w) !== -1;
      });
    });
    matches.forEach(function (item) {
      target.appendChild(item.cloneNode(true));
    });
    var n = matches.length;
    // Worded and quoted the way src/client/search.js words the Guides page.
    var quoted = '"' + query + '"';
    var summary = n + " sample " + (n === 1 ? noun[0] + " matches " : noun[1] + " match ") + quoted;
    document.title = "Search results for " + quoted + " - bpozz";
    $("[data-sample-title]", section).textContent = "Sample " + noun[1];
    section.hidden = false;
    group.hidden = n === 0;
    if (count) {
      count.textContent = summary;
      count.classList.toggle("sr-only", n === 0);
    }
    if (n) {
      if (heading) heading.textContent = "Search results for " + quoted;
      paintMarks();
      return;
    }
    // Nothing in the sample set: the heading says so, and the panel offers
    // the same query in Guides and the whole sample gallery.
    if (heading) heading.textContent = "No " + noun[1] + " match " + quoted;
    var empty = $("[data-sample-empty]", section);
    $("[data-sample-empty-title]", empty).textContent = "Nothing in the sample " + noun[1] + " matches";
    $("[data-sample-empty-text]", empty).textContent =
      "The design preview has a small sample set, so try a broader word: a discipline, a city or a tag. Guides are searched separately.";
    var guides = $("[data-sample-guides]", empty);
    guides.href = "/search?s=" + encodeURIComponent(query) + "&scope=guides";
    guides.textContent = "Search guides for " + quoted;
    var browse = $("[data-sample-browse]", empty);
    browse.href = scope === "projects" ? "/projects/" : "/designers/";
    browse.textContent = "Browse sample " + noun[1];
    empty.hidden = false;
  })();

  // ---------- project page: view an image larger ----------
  (function () {
    var dialog = $("#sc-lightbox");
    if (!dialog || typeof dialog.showModal !== "function") {
      $$("[data-lightbox-open]").forEach(function (b) {
        b.hidden = true;
      });
      return;
    }
    var stage = $("[data-lightbox-stage]", dialog);
    var opener = null;
    function open(figure, from) {
      var art = $("svg.art", figure);
      if (!art) return;
      stage.innerHTML = "";
      stage.appendChild(art.cloneNode(true));
      dialog.setAttribute("aria-label", (art.getAttribute("aria-label") || "Artwork") + ", larger");
      opener = from || null;
      dialog.showModal();
    }
    $$("[data-lightbox-item]").forEach(function (figure) {
      var button = $("[data-lightbox-open]", figure);
      button.addEventListener("click", function () {
        open(figure, button);
      });
      $("svg.art", figure).addEventListener("click", function () {
        open(figure, button);
      });
    });
    $("[data-lightbox-close]", dialog).addEventListener("click", function () {
      dialog.close();
    });
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog || e.target === stage) dialog.close();
    });
    dialog.addEventListener("close", function () {
      stage.innerHTML = "";
      if (opener) opener.focus();
    });
  })();

  // ---------- copy link ----------
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy-link]");
    if (!btn) return;
    var url = location.origin + location.pathname;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          toast("Link copied.");
        },
        function () {
          toast(url);
        },
      );
    } else {
      toast(url);
    }
  });

  // ---------- dialogs + toasts ----------
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-demo-dialog]");
    if (opener) {
      var dialog = document.getElementById("dialog-" + opener.getAttribute("data-demo-dialog"));
      if (dialog && typeof dialog.showModal === "function") {
        $$("[data-dialog-title]", dialog).forEach(function (el) {
          el.textContent = opener.getAttribute("data-title") || el.textContent;
        });
        dialog.showModal();
      }
      return;
    }
    var t = e.target.closest("[data-demo-toast]");
    if (t) toast(t.getAttribute("data-demo-toast"));
  });
  $$(".sc-dialog").forEach(function (dialog) {
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) dialog.close();
    });
  });

  // ---------- tabs (profile) ----------
  $$("[data-tabs]").forEach(function (root) {
    var tabs = $$('[role="tab"]', root);
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        select(tab);
      });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (next) {
          e.preventDefault();
          select(next);
          next.focus();
        }
      });
    });
  });

  // ---------- counters + live preview ----------
  $$("[data-counter]").forEach(function (field) {
    var out = $("[data-counter-value]", field.closest(".form-field"));
    if (!out) return;
    var update = function () {
      out.textContent = field.value.length;
    };
    field.addEventListener("input", update);
    update();
  });
  $$("[data-live]").forEach(function (field) {
    var outs = $$('[data-live-out="' + field.getAttribute("data-live") + '"]');
    var update = function () {
      outs.forEach(function (o) {
        o.textContent = field.value;
      });
    };
    field.addEventListener("input", update);
    field.addEventListener("change", update);
  });
  $$("[data-profile-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      toast("Profile saved in this preview only. Nothing was stored.");
    });
  });
  $$("[data-avatar-input]").forEach(function (input) {
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      var target = $(".avatar-edit .avatar");
      if (!file || !target) return;
      var img = document.createElement("img");
      img.alt = "";
      img.src = URL.createObjectURL(file);
      img.style.cssText = "width:100%;height:100%;object-fit:cover";
      target.textContent = "";
      target.appendChild(img);
    });
  });

  // ---------- studio: status filter ----------
  var statusChips = $$("[data-status-filter]");
  statusChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var status = chip.getAttribute("data-status-filter");
      statusChips.forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === chip));
      });
      $$("[data-studio-list] [data-status]").forEach(function (row) {
        row.hidden = !!status && row.getAttribute("data-status") !== status;
      });
    });
  });

  // ---------- studio: share flow ----------
  var upload = $("[data-upload]");
  if (upload) {
    var data = {};
    try {
      data = JSON.parse(($("#sc-data") || {}).textContent || "{}");
    } catch (err) {
      data = {};
    }
    var step = 1;
    var files = [];
    var list = $("[data-file-list]", upload);
    var input = $("[data-file-input]", upload);
    var dropzone = $("[data-dropzone]", upload);
    var back = $("[data-step-back]", upload);
    var next = $("[data-step-next]", upload);
    var publish = $("[data-step-publish]", upload);
    var markers = $$("[data-step-marker]");
    var sample = $("[data-sample-art]");

    function sampleFile(name) {
      var svg = sample ? sample.innerHTML.trim() : "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'><rect width='800' height='600' fill='#e9ebef'/></svg>";
      if (svg.indexOf("xmlns") === -1) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      return { name: name, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) };
    }

    function renderFiles() {
      list.innerHTML = "";
      files.forEach(function (f, i) {
        var li = document.createElement("li");
        li.className = "upload-file";
        li.innerHTML =
          '<img alt="" src="' + f.url + '" />' +
          '<span class="upload-file__name"></span>' +
          (i === 0 ? '<span class="badge badge--info">Cover</span>' : '<button type="button" class="btn btn-soft btn-sm" data-cover>Make cover</button>') +
          '<button type="button" class="btn btn-soft btn-sm btn-icon" data-remove aria-label="Remove image">×</button>';
        $(".upload-file__name", li).textContent = f.name;
        $("[data-remove]", li).addEventListener("click", function () {
          files.splice(i, 1);
          renderFiles();
        });
        var cover = $("[data-cover]", li);
        if (cover) {
          cover.addEventListener("click", function () {
            files.unshift(files.splice(i, 1)[0]);
            renderFiles();
          });
        }
        list.appendChild(li);
      });
      if (files.length) $("[data-upload-error]", upload).hidden = true;
    }

    function addFiles(fileList) {
      Array.prototype.slice.call(fileList, 0, 12 - files.length).forEach(function (file) {
        if (!/^image\//.test(file.type)) return;
        files.push({ name: file.name, url: URL.createObjectURL(file) });
      });
      renderFiles();
    }

    input.addEventListener("change", function () {
      addFiles(input.files);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach(function (type) {
      dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        dropzone.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        dropzone.classList.remove("is-over");
      });
    });
    dropzone.addEventListener("drop", function (e) {
      if (e.dataTransfer) addFiles(e.dataTransfer.files);
    });
    $$("[data-use-sample]").forEach(function (b) {
      b.addEventListener("click", function () {
        files.push(sampleFile("sample-cover-" + (files.length + 1) + ".svg"));
        renderFiles();
      });
    });

    function value(name) {
      var el = upload.elements[name];
      return el ? el.value.trim() : "";
    }

    function fillPreview() {
      $$("[data-preview]").forEach(function (el) {
        var key = el.getAttribute("data-preview");
        if (key === "discipline") {
          var sel = upload.elements.discipline;
          el.textContent = sel.options[sel.selectedIndex].text;
        } else {
          el.textContent = value(key) || (key === "title" ? "Untitled project" : "Your description appears here.");
        }
      });
      $$("[data-preview-cover], [data-preview-cover-large]").forEach(function (el) {
        el.innerHTML = files.length ? '<img alt="" src="' + files[0].url + '" />' : el.innerHTML;
      });
    }

    function show(n) {
      step = n;
      $$("[data-step]", upload).forEach(function (s) {
        s.hidden = s.getAttribute("data-step") !== String(n);
      });
      markers.forEach(function (m) {
        var k = Number(m.getAttribute("data-step-marker"));
        m.classList.toggle("is-done", n === "done" || k < n);
        if (k === n) m.setAttribute("aria-current", "step");
        else m.removeAttribute("aria-current");
      });
      var done = n === "done";
      $("[data-upload-nav]", upload).hidden = done;
      back.hidden = n === 1 || done;
      next.hidden = n === 4 || done;
      publish.hidden = n !== 4;
      if (n === 3) fillPreview();
      var heading = $("[data-step='" + n + "'] h2", upload);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }

    next.addEventListener("click", function () {
      if (step === 1 && !files.length) {
        $("[data-upload-error]", upload).hidden = false;
        return;
      }
      if (step === 2 && !value("title")) {
        var t = upload.elements.title;
        t.setAttribute("aria-invalid", "true");
        t.focus();
        return;
      }
      show(step + 1);
    });
    back.addEventListener("click", function () {
      show(step - 1);
    });
    upload.elements.title.addEventListener("input", function () {
      this.removeAttribute("aria-invalid");
    });
    upload.addEventListener("submit", function (e) {
      e.preventDefault();
      var checks = $$("[data-required-check]", upload);
      var ok = checks.every(function (c) {
        return c.checked;
      });
      $("[data-confirm-error]", upload).hidden = ok;
      if (!ok) return;
      var draft = upload.elements.visibility.value === "draft";
      var done = $("[data-step='done']", upload);
      $("h2", done).textContent = draft ? "Saved as a draft" : "Submitted for review";
      show("done");
    });

    // Edit mode: ?edit=<slug> opens an existing project at its details.
    var editSlug = params.get("edit");
    var record = editSlug && (data.editable || []).find(function (p) {
      return p.slug === editSlug;
    });
    if (record) {
      $("[data-upload-title]").textContent = "Edit project";
      $("[data-upload-mode]").textContent = "Edit work";
      upload.elements.title.value = record.title;
      upload.elements.discipline.value = record.discipline;
      upload.elements.summary.value = record.summary;
      upload.elements.tags.value = record.tags;
      upload.elements.tools.value = record.tools;
      upload.elements.summary.dispatchEvent(new Event("input"));
      files.push(sampleFile("cover.svg"));
      renderFiles();
      publish.textContent = "Save changes";
      show(2);
    }
  }

  // ---------- report ----------
  var reportForm = $("[data-report-form]");
  if (reportForm) {
    var reportData = {};
    try {
      reportData = JSON.parse(($("#sc-data") || {}).textContent || "{}");
    } catch (err) {
      reportData = {};
    }
    var slug = params.get("project");
    var projects = reportData.projects || [];
    var target = slug && projects.find(function (p) {
      return p.slug === slug;
    });
    if (target && target !== projects[0]) {
      $("[data-report-title]").textContent = target.title;
      $("[data-report-meta]").textContent = target.designer + " · " + target.discipline;
      var thumb = $("[data-report-thumb]");
      if (thumb) thumb.classList.add("is-generic");
    }
    if (target) $("[data-report-cancel]").setAttribute("href", "/projects/" + target.slug);
    reportForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var chosen = reportForm.querySelector("input[name='reason']:checked");
      $("[data-reason-error]").hidden = !!chosen;
      if (!chosen) return;
      reportForm.hidden = true;
      $("[data-report-target]").hidden = true;
      var done = $("[data-report-done]");
      done.hidden = false;
      $("h2", done).tabIndex = -1;
      $("h2", done).focus();
    });
  }

  // ---------- design preview: ?open-nav=explore|learn|resources ----------
  // Opens one of the header's panels on load, for reviewing it without a
  // pointer (screenshots). It presses the real trigger.
  var openNav = params.get("open-nav");
  if (openNav && /^(explore|learn|resources)$/.test(openNav)) {
    var trigger = $('.site-nav__trigger[aria-controls="nav-menu-' + openNav + '"]');
    if (trigger) {
      setTimeout(function () {
        trigger.click();
      }, 300);
    }
  }

  // ---------- design preview: ?open-menu=1[&expand=explore|learn|resources] ----------
  // Opens the phone menu on load (and one of its groups), for reviewing it
  // without a pointer. It presses the real buttons.
  if (params.get("open-menu")) {
    var menuToggle = document.getElementById("menu-toggle");
    var expand = params.get("expand");
    // The header's scripts ran before this one, so the buttons are wired.
    if (menuToggle) menuToggle.click();
    if (expand && /^(explore|learn|resources)$/.test(expand)) {
      var groupToggle = $('.mobile-menu__toggle[aria-controls="mobile-menu-' + expand + '"]');
      if (groupToggle) groupToggle.click();
    }
  }

  // ---------- design preview: ?fill-search=…, ?open-scope=header|discover ----------
  // For reviewing the search without a keyboard (screenshots):
  // fill-search types a query into the page's first search box (the
  // discovery search where there is one), as an input event, so every box
  // on the page takes it; open-scope opens a search box's category list by
  // pressing its real button, then lets go of focus, as a mouse press would
  // look (no keyboard rings); with &scope-focus=keyboard focus stays on the
  // chosen option, as after opening it from the keyboard. Run once the
  // header's script has made the category menus (on DOMContentLoaded, which
  // it listens for first).
  var fillSearch = params.get("fill-search");
  var openScope = params.get("open-scope");
  if (fillSearch || openScope) {
    document.addEventListener("DOMContentLoaded", function () {
      var box = $(".discover__search[data-usearch]") || $("form[data-usearch]");
      var field = box && $('input[type="search"]', box);
      if (fillSearch && field) {
        field.value = fillSearch;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      var form = openScope === "header" ? $(".header-bar > form[data-usearch]") : openScope === "discover" ? $(".discover__search[data-usearch]") : null;
      var button = form && $(".usearch__trigger", form);
      if (!button) return;
      button.click();
      if (params.get("scope-focus") !== "keyboard" && document.activeElement) document.activeElement.blur();
    });
  }

  // ---------- design preview: ?tray=open|open-then-top (640px and narrower) ----------
  // For reviewing the phone's search tray without a pointer: once the page
  // has settled, press the real search button, if it is showing. On the
  // homepage, /projects/ and /designers/ it shows only once the page has
  // scrolled past its own search (to an anchor such as #feed-projects);
  // there, with open-then-top, scroll back to the top afterwards, which
  // closes the tray and hides the button again, as a visitor scrolling up
  // would.
  var trayPreview = params.get("tray");
  if (trayPreview) {
    window.addEventListener("load", function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var button = $(".header-bar > button.header-search-toggle");
          var style = button && getComputedStyle(button);
          if (!style || style.display === "none" || style.visibility !== "visible") return;
          button.click();
          if (trayPreview === "open-then-top") {
            requestAnimationFrame(function () {
              window.scrollTo(0, 0);
            });
          }
        });
      });
    });
  }

  // ---------- styleguide: ?open=signin|signup opens the real dialog ----------
  if (document.body.classList.contains("sc-styleguide")) {
    var open = params.get("open");
    var opener = open && $('[data-auth-open="' + (open === "signup" ? "signup" : "signin") + '"]', $("#sg-auth"));
    if (opener) {
      setTimeout(function () {
        opener.click();
      }, 400);
    }
  }

  // ---------- moderation ----------
  var modItems = $$("[data-report-item]");
  if (modItems.length) {
    var selectReport = function (btn) {
      modItems.forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      $$("[data-report-detail]").forEach(function (d) {
        d.hidden = d.getAttribute("data-report-detail") !== btn.getAttribute("data-report-item");
      });
    };
    modItems.forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectReport(btn);
      });
    });
    var modFilters = $$("[data-mod-filter]");
    var applyMod = function (status) {
      modFilters.forEach(function (c) {
        c.setAttribute("aria-pressed", String(c.getAttribute("data-mod-filter") === status));
      });
      var first = null;
      modItems.forEach(function (btn) {
        var on = btn.getAttribute("data-status") === status;
        btn.parentNode.hidden = !on;
        if (on && !first) first = btn;
      });
      if (first) selectReport(first);
    };
    modFilters.forEach(function (chip) {
      chip.addEventListener("click", function () {
        applyMod(chip.getAttribute("data-mod-filter"));
      });
    });
    applyMod("open");
  }
})();
