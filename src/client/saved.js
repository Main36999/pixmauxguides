/**
 * saved.js — the browser half of account Saved (docs/SAVED.md).
 * -----------------------------------------------------------------------
 * A SELF-CONTAINED MODULE, NOT A FRAGMENT, shipped the way auth.js is:
 *
 *   - inside /app.js, as one of APP_BUNDLE's `modules`, right after auth.js
 *     (src/build/build.js), whose window.BpozzAuth it relies on;
 *   - on its own at /saved.js, for /account, which loads /auth.js but not
 *     /app.js.
 *
 * The window.BpozzSaved guard makes a second copy on the same page a no-op.
 *
 * DORMANT UNTIL LAUNCH
 *
 * LAUNCHED (below) is false. While it is, this file publishes only
 * window.BpozzSaved = { active: false, kinds, limits, isValidItem,
 * imagePaletteId } and stops: no listener, no request, no storage access,
 * nothing drawn, so every page behaves exactly as it did before Saved.
 * Launching is changing that one line — see "Browser module" in
 * docs/SAVED.md.
 *
 * ONCE ACTIVE
 *
 *   session   the answer auth.js already fetched (BpozzAuth.getSession()),
 *             then the `bpozz:session` event auth.js fires after every real
 *             answer. The only other session call is one shared
 *             BpozzAuth.refreshSession() after the API answers 401.
 *   state     page memory only, per kind, from GET /api/saved?kind=<kind>
 *             for the kinds the page has controls for. A list answer never
 *             undoes a change confirmed after it was requested. Nothing
 *             about the account is ever written to browser storage.
 *   controls  every button[data-save-kind][data-save-id], and any added
 *             later through BpozzSaved.sync(root). Signed out, a click opens
 *             the existing sign-in dialog, and nothing is remembered for
 *             after it.
 *   changes   shown at once, one request at a time per item; a change that
 *             fails is undone and said once.
 *   tabs      a BroadcastChannel where the browser has one, closed while
 *             the page is hidden so the page can still enter the
 *             back/forward cache.
 *   old saves this browser's font favorites and palette likes, from before
 *             accounts, are read on request (legacy) and sent only when the
 *             visitor chooses (importLegacy).
 *
 * WHAT IT NEVER DOES
 *
 *   - call anything but this site's /api/saved and /api/saved/import;
 *   - store, log or send a token, user id or email address;
 *   - read Learning Roadmap progress (point-roadmap-progress);
 *   - write bpozz-palette-likes, or touch the Firebase like counter;
 *   - insert text from the server or from browser storage as HTML.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  if (window.BpozzSaved || typeof document === "undefined") return;

  // The launch switch. See DORMANT UNTIL LAUNCH above.
  var LAUNCHED = false;

  var API = "/api/saved";
  var TIMEOUT_MS = 10000;
  var STALE_MS = 5 * 60 * 1000;
  var CHANNEL = "bpozz-saved";
  var MAX_IMPORT_ITEMS = 1000;
  var SELECTOR = "[data-save-kind][data-save-id]";

  // The Saved API's kinds, id rules and limits (docs/SAVED.md), repeated
  // here so a malformed id never leaves the browser. A test on the server
  // side loads this file and checks the two agree.
  var KINDS = ["color", "palette", "font", "icon", "guide", "image_palette"];
  var LIMITS = { total: 1000, image_palette: 200 };

  var SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var ICON_KEY = /^[a-z0-9]+(-[a-z0-9]+)*--[a-z0-9]+(-[a-z0-9]+)*$/;
  var ID_RULES = {
    color: function (id) {
      return /^c[0-9]{3,4}$/.test(id);
    },
    palette: function (id) {
      return /^p[0-9]{3,4}$/.test(id);
    },
    font: function (id) {
      return id.length <= 64 && SLUG.test(id);
    },
    icon: function (id) {
      return id.length <= 120 && ICON_KEY.test(id);
    },
    guide: function (id) {
      return id.length <= 100 && SLUG.test(id);
    },
    image_palette: function (id) {
      return /^[0-9a-f]{6}(-[0-9a-f]{6}){2,7}$/.test(id);
    },
  };

  // The only browser storage this file touches, and only once active.
  var FONT_FAVORITES = "bpozz:font-favorites"; // read; imported ids removed after an import
  var PALETTE_LIKES = "bpozz-palette-likes"; // read only: it drives the Like button
  var IMPORT_MARKER = "bpozz:saved-import"; // {"v":1,"dismissed":true}, nothing more

  var MESSAGES = {
    saveFailed: "Couldn’t save that. Please try again.",
    removeFailed: "Couldn’t remove that. Please try again.",
    tooMany: "Too many changes at once. Try again in a minute.",
    importTooMany: "Too many attempts. Try again in a minute.",
    unavailable: "Saving isn’t available right now. Please try again later.",
    loadFailed: "Couldn’t load your Saved items right now.",
    signedOut: "You’ve been signed out. Sign in to save.",
  };

  // ---------- pure helpers (published even while dormant) ----------

  function isValidItem(kind, id) {
    return (
      typeof kind === "string" &&
      Object.prototype.hasOwnProperty.call(ID_RULES, kind) &&
      typeof id === "string" &&
      ID_RULES[kind](id)
    );
  }

  // The Image Picker's on-screen palette as its saved id: 3 to 8 colours
  // like "#1E193B" become "1e193b-322a57-5438e6". Anything else is null.
  // Only this id is ever sent — never the image, a pixel or a position.
  function imagePaletteId(hexes) {
    if (!Array.isArray(hexes) || hexes.length < 3 || hexes.length > 8) return null;
    var parts = [];
    for (var i = 0; i < hexes.length; i++) {
      var match = typeof hexes[i] === "string" ? /^#?([0-9a-fA-F]{6})$/.exec(hexes[i]) : null;
      if (!match) return null;
      parts.push(match[1].toLowerCase());
    }
    return parts.join("-");
  }

  var ACTIVE = LAUNCHED;
  var kinds = Object.freeze(KINDS.slice());
  var limits = Object.freeze({ total: LIMITS.total, image_palette: LIMITS.image_palette });

  if (!ACTIVE) {
    window.BpozzSaved = Object.freeze({
      active: false,
      kinds: kinds,
      limits: limits,
      isValidItem: isValidItem,
      imagePaletteId: imagePaletteId,
    });
    return;
  }

  // ---------- state ----------

  var session = "pending"; // "pending" | "signed-in" | "signed-out"
  var markKnown = null;
  var known = new Promise(function (resolve) {
    markKnown = resolve;
  });
  // Bumped by every sign-out. An answer to a request sent before it is
  // dropped: it belongs to a session that is gone.
  var generation = 0;
  // Counts every change this page confirms — its own, another tab's, an
  // import's — so a list answer can tell which changes are newer than the
  // request that fetched it (see fill).
  var changeSeq = 0;
  var registered = {}; // kinds the page has controls for
  var stores = {}; // kind -> { state, ids, changed, at, promise }
  var desired = {}; // "kind:id" -> the state last asked for, until it settles
  var inflight = {}; // "kind:id" -> true while its request runs
  var origins = {}; // "kind:id" -> the control last clicked for it
  var waiters = {}; // "kind:id" -> [resolve] for callers waiting on it
  var listeners = [];
  var refreshing = null;
  var importing = null;
  var toldLoadFailed = false;
  var statusRegion = null;
  var toastTimer = null;
  var channel = null;

  // ---------- session ----------

  function signedInFrom(data) {
    return !!(data && data.authenticated === true && data.user);
  }

  function applySession(signedIn) {
    markKnown();
    var next = signedIn ? "signed-in" : "signed-out";
    if (next === session) return;
    var was = session;
    session = next;
    if (signedIn) {
      loadRegistered();
    } else {
      reset();
      // Another tab may still think it is signed in. It asks the server
      // rather than trusting this message.
      if (was === "signed-in") post({ type: "session" });
    }
    notify();
  }

  function reset() {
    generation += 1;
    stores = {};
    desired = {};
    inflight = {};
    var pending = waiters;
    waiters = {};
    Object.keys(pending).forEach(function (key) {
      pending[key].forEach(function (resolve) {
        resolve({ ok: false, reason: "signed-out" });
      });
    });
    paintAll();
  }

  // One session refresh at a time, however many requests met a 401 at once.
  // auth.js redraws the header from the answer and fires bpozz:session,
  // which normally reaches applySession first; the call here covers a page
  // where it can't.
  function refreshOnce() {
    if (!refreshing) {
      var auth = window.BpozzAuth;
      var asked =
        auth && typeof auth.refreshSession === "function" ? auth.refreshSession() : Promise.resolve(null);
      refreshing = Promise.resolve(asked)
        .then(signedInFrom, function () {
          return false;
        })
        .then(function (signedIn) {
          refreshing = null;
          applySession(signedIn);
          return signedIn;
        });
    }
    return refreshing;
  }

  // ---------- requests ----------

  function timeoutSignal(ms) {
    return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  }

  // One call to the Saved API. Resolves — never rejects — to { status, data }.
  // Status 0 is no usable answer: a network failure, a timeout, or a 2xx
  // that isn't JSON. A 429 is Netlify's rate limit, not this API's JSON, so
  // its body is never read.
  function send(method, url, body) {
    var init = {
      method: method,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var signal = timeoutSignal(TIMEOUT_MS);
    if (signal) init.signal = signal;
    var answer;
    try {
      answer = fetch(url, init);
    } catch (err) {
      return Promise.resolve({ status: 0, data: null });
    }
    return Promise.resolve(answer)
      .then(function (res) {
        if (res.status === 429) return { status: 429, data: null };
        var type = (res.headers && res.headers.get("content-type")) || "";
        if (type.indexOf("application/json") === -1) {
          return { status: res.ok ? 0 : res.status, data: null };
        }
        return res.json().then(
          function (data) {
            return { status: res.status, data: data };
          },
          function () {
            return { status: res.ok ? 0 : res.status, data: null };
          },
        );
      })
      .catch(function () {
        return { status: 0, data: null };
      });
  }

  // Sends; on a 401 refreshes the session (shared) and sends once more.
  // Anything else — a 429 above all — comes back as it came. `gen` is the
  // generation the request belongs to: after a sign-out, a 401 is expected
  // and is not a reason to refresh.
  function withSession(attempt, gen) {
    return attempt().then(function (r) {
      if (r.status !== 401 || gen !== generation) return r;
      return refreshOnce().then(function (signedIn) {
        if (!signedIn) return { status: 401, data: null, signedOut: true };
        return gen === generation ? attempt() : r;
      });
    });
  }

  // ---------- saved state ----------

  function keyOf(kind, id) {
    return kind + ":" + id;
  }

  function storeFor(kind) {
    if (!stores[kind]) {
      stores[kind] = {
        state: "idle",
        ids: Object.create(null),
        changed: Object.create(null), // id -> { saved, seq }: its last confirmed change
        at: 0,
        promise: null,
      };
    }
    return stores[kind];
  }

  function isSaved(kind, id) {
    var store = stores[kind];
    return !!(store && store.ids[id] === true);
  }

  // Records a change the server confirmed (or another tab reported).
  function markSaved(kind, id, saved) {
    var store = storeFor(kind);
    if (saved) store.ids[id] = true;
    else delete store.ids[id];
    changeSeq += 1;
    store.changed[id] = { saved: saved, seq: changeSeq };
  }

  // What a control shows: the state last asked for while a change is on
  // its way, otherwise what the server last confirmed.
  function displayed(kind, id) {
    var key = keyOf(kind, id);
    return Object.prototype.hasOwnProperty.call(desired, key) ? desired[key] : isSaved(kind, id);
  }

  // A list answer's items, or null when it isn't one. An item that isn't a
  // known kind with a well-formed id is dropped, never drawn.
  function itemsOf(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) return null;
    var items = [];
    data.items.forEach(function (item) {
      if (!item || typeof item !== "object" || !isValidItem(item.kind, item.id)) return;
      items.push({
        kind: item.kind,
        id: item.id,
        saved_at: typeof item.saved_at === "string" ? item.saved_at : "",
      });
    });
    return items;
  }

  // Replaces a kind's saved state with a list answer. `since` is changeSeq
  // when that list was requested: a change confirmed after it is newer than
  // anything the answer can know about, so it is applied again on top. An
  // older answer never undoes it.
  function fill(kind, items, since) {
    var store = storeFor(kind);
    var ids = Object.create(null);
    items.forEach(function (item) {
      if (item.kind === kind) ids[item.id] = true;
    });
    Object.keys(store.changed).forEach(function (id) {
      var latest = store.changed[id];
      if (latest.seq <= since) return;
      if (latest.saved) ids[id] = true;
      else delete ids[id];
    });
    store.ids = ids;
    store.state = "ready";
    store.at = Date.now();
    paintKind(kind);
  }

  // A list answer's items as they stand once the changes confirmed after
  // `since` are applied (fill has already done so for the saved state):
  // newer removals are left out, and newer saves come first — newest first,
  // like the API — with their time unknown here.
  function withNewer(items, covered, since) {
    var seen = Object.create(null);
    var kept = items.filter(function (item) {
      seen[keyOf(item.kind, item.id)] = true;
      return isSaved(item.kind, item.id);
    });
    var added = [];
    covered.forEach(function (kind) {
      var changed = storeFor(kind).changed;
      Object.keys(changed).forEach(function (id) {
        var latest = changed[id];
        if (latest.seq > since && latest.saved && !seen[keyOf(kind, id)]) {
          added.push({ kind: kind, id: id, seq: latest.seq });
        }
      });
    });
    added.sort(function (a, b) {
      return b.seq - a.seq;
    });
    return added
      .map(function (item) {
        return { kind: item.kind, id: item.id, saved_at: "" };
      })
      .concat(kept);
  }

  function loadRegistered() {
    Object.keys(registered).forEach(function (kind) {
      if (storeFor(kind).state === "idle") loadKind(kind);
    });
  }

  function loadKind(kind, force) {
    var store = storeFor(kind);
    if (store.promise) return store.promise;
    if (session !== "signed-in" || (store.state === "ready" && !force)) {
      return Promise.resolve(store.state === "ready");
    }
    var gen = generation;
    var since;
    if (store.state !== "ready") store.state = "loading";
    store.promise = withSession(function () {
      since = changeSeq;
      return send("GET", API + "?kind=" + encodeURIComponent(kind));
    }, gen).then(function (r) {
      store.promise = null;
      if (gen !== generation) return false;
      var items = r.status === 200 ? itemsOf(r.data) : null;
      if (items) {
        fill(kind, items, since);
        notify();
        return true;
      }
      if (r.status === 401) {
        // Still refused after a refresh that said signed in.
        applySession(false);
        return false;
      }
      if (store.state !== "ready") store.state = "failed";
      tellLoadFailed();
      return false;
    });
    return store.promise;
  }

  // Shown data older than `olderThan` ms (and any list that failed) is
  // read again.
  function refetch(olderThan) {
    if (session !== "signed-in") return;
    var now = Date.now();
    Object.keys(stores).forEach(function (kind) {
      var store = stores[kind];
      if (store.state === "failed" || (store.state === "ready" && now - store.at >= olderThan)) {
        loadKind(kind, true);
      }
    });
  }

  // ---------- controls ----------

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  // Both values have passed the id rules (a–z, 0–9, "-" and "_" only), so
  // they can't break out of the attribute selector.
  function controlsFor(kind, id) {
    return document.querySelectorAll('[data-save-kind="' + kind + '"][data-save-id="' + id + '"]');
  }

  function paint(button, saved, busy) {
    button.setAttribute("aria-pressed", saved ? "true" : "false");
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
    var label = button.querySelector("[data-save-label]");
    if (label) {
      // data-save-label="Save palette|Saved" names the pair; empty is Save / Saved.
      var pair = (label.getAttribute("data-save-label") || "").split("|");
      label.textContent = saved ? pair[1] || "Saved" : pair[0] || "Save";
    }
  }

  function paintControl(button) {
    var kind = button.getAttribute("data-save-kind");
    var id = button.getAttribute("data-save-id");
    if (isValidItem(kind, id)) paint(button, displayed(kind, id), inflight[keyOf(kind, id)] === true);
  }

  function paintItem(kind, id) {
    each(controlsFor(kind, id), paintControl);
  }

  function paintKind(kind) {
    each(document.querySelectorAll('[data-save-kind="' + kind + '"][data-save-id]'), paintControl);
  }

  function paintAll() {
    each(document.querySelectorAll(SELECTOR), paintControl);
  }

  // Takes charge of the controls under `root` (the whole page by default).
  // Page scripts call it after drawing new ones; the lists their kinds need
  // are loaded once the session is known.
  function sync(root) {
    var scope = root && typeof root.querySelectorAll === "function" ? root : document;
    var found = Array.prototype.slice.call(scope.querySelectorAll(SELECTOR));
    if (scope !== document && typeof scope.matches === "function" && scope.matches(SELECTOR)) {
      found.push(scope);
    }
    found.forEach(function (button) {
      var kind = button.getAttribute("data-save-kind");
      if (!isValidItem(kind, button.getAttribute("data-save-id"))) return;
      registered[kind] = true;
      paintControl(button);
    });
    if (session === "signed-in") loadRegistered();
  }

  function onClick(e) {
    var target = e.target;
    var button = target && typeof target.closest === "function" ? target.closest(SELECTOR) : null;
    if (!button) return;
    var kind = button.getAttribute("data-save-kind");
    var id = button.getAttribute("data-save-id");
    if (!isValidItem(kind, id)) return;
    e.preventDefault();
    if (button.disabled || button.getAttribute("aria-disabled") === "true") return;
    known.then(function () {
      if (session !== "signed-in") {
        openSignIn(button);
        return;
      }
      origins[keyOf(kind, id)] = button;
      change(kind, id, !displayed(kind, id));
    });
  }

  function openSignIn(button) {
    var auth = window.BpozzAuth;
    if (auth && typeof auth.open === "function") auth.open("signin", button);
  }

  function askToSignIn(button) {
    announce(MESSAGES.signedOut);
    openSignIn(button);
  }

  // ---------- changes ----------

  // Asks for one item to be saved (want = true) or not. Resolves when it
  // settles, with { ok: true, saved } or { ok: false, reason, message }.
  function change(kind, id, want) {
    var key = keyOf(kind, id);
    desired[key] = want;
    paintItem(kind, id);
    return new Promise(function (resolve) {
      (waiters[key] || (waiters[key] = [])).push(resolve);
      pump(kind, id);
    });
  }

  function settle(key, outcome) {
    var list = waiters[key] || [];
    delete waiters[key];
    list.forEach(function (resolve) {
      resolve(outcome);
    });
  }

  // Sends the next request for one item, if it needs one and none is out.
  // A click while a request runs only moves `desired`; the answer then
  // decides whether another request is needed.
  function pump(kind, id) {
    var key = keyOf(kind, id);
    if (inflight[key] || !Object.prototype.hasOwnProperty.call(desired, key)) return;
    var want = desired[key];
    if (want === isSaved(kind, id)) {
      delete desired[key];
      delete origins[key];
      paintItem(kind, id);
      settle(key, { ok: true, saved: want });
      return;
    }
    inflight[key] = true;
    paintItem(kind, id);
    var gen = generation;
    withSession(function () {
      return want
        ? send("POST", API, { kind: kind, id: id })
        : send("DELETE", API + "?" + new URLSearchParams({ kind: kind, id: id }).toString());
    }, gen).then(function (r) {
      var clicked = origins[key];
      if (gen !== generation) {
        // Signed out while this ran: reset() has already settled and
        // repainted everything. If it was this request that found out,
        // offer sign-in to whoever clicked.
        delete origins[key];
        if (r.signedOut && clicked) askToSignIn(clicked);
        return;
      }
      delete inflight[key];
      var outcome = outcomeOf(r, want);
      if (outcome.ok) {
        markSaved(kind, id, want);
        post({ type: "item", kind: kind, id: id, saved: want });
        if (desired[key] !== want) {
          pump(kind, id); // clicked again meanwhile: send that next
          return;
        }
        delete desired[key];
        delete origins[key];
        paintItem(kind, id);
        announce(want ? savedText(kind, id) : removedText(kind, id));
        settle(key, outcome);
        notify();
        return;
      }
      delete desired[key];
      delete origins[key];
      paintItem(kind, id);
      if (outcome.reason === "signed-out") {
        // Still refused after a refresh that said signed in.
        applySession(false);
        if (clicked) askToSignIn(clicked);
      } else {
        say(outcome.message);
      }
      settle(key, outcome);
      notify();
    });
  }

  function countOr(value, fallback) {
    return typeof value === "number" && value > 0 && Math.floor(value) === value ? value : fallback;
  }

  function thousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function outcomeOf(r, want) {
    var data = r.data && typeof r.data === "object" ? r.data : {};
    if ((r.status === 200 || r.status === 201) && data.saved === want) return { ok: true, saved: want };
    if (r.status === 401) return { ok: false, reason: "signed-out" };
    if (r.status === 409 && data.error === "limit_reached") {
      if (data.kind === "image_palette") {
        return {
          ok: false,
          reason: "limit",
          kind: "image_palette",
          message:
            "You’ve saved " +
            thousands(countOr(data.limit, LIMITS.image_palette)) +
            " Image Picker palettes, the most allowed.",
        };
      }
      return {
        ok: false,
        reason: "limit",
        message:
          "Your Saved list is full (" +
          thousands(countOr(data.limit, LIMITS.total)) +
          " items). Remove something in Your Account → Saved to save more.",
      };
    }
    if (r.status === 429) return { ok: false, reason: "rate-limited", message: MESSAGES.tooMany };
    if (r.status === 0 || r.status === 503) {
      return { ok: false, reason: "unavailable", message: MESSAGES.unavailable };
    }
    return { ok: false, reason: "failed", message: want ? MESSAGES.saveFailed : MESSAGES.removeFailed };
  }

  // ---------- telling the visitor ----------

  function nameOf(kind, id) {
    var name = "";
    each(controlsFor(kind, id), function (button) {
      if (!name) name = button.getAttribute("data-save-name") || "";
    });
    return name;
  }

  function savedText(kind, id) {
    var name = nameOf(kind, id);
    return name ? name + " saved to your account" : "Saved to your account";
  }

  function removedText(kind, id) {
    var name = nameOf(kind, id);
    return name ? name + " removed from your Saved" : "Removed from your Saved";
  }

  // Success is only announced: the control itself already shows it. One
  // polite region for the page, hidden visually but not from assistive tech.
  function announce(text) {
    if (!statusRegion || !statusRegion.isConnected) {
      statusRegion = document.createElement("div");
      statusRegion.setAttribute("role", "status");
      statusRegion.setAttribute("aria-live", "polite");
      statusRegion.setAttribute("aria-atomic", "true");
      statusRegion.setAttribute("data-saved-status", "");
      statusRegion.style.cssText =
        "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
        "overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);" +
        "white-space:nowrap;border:0;";
      document.body.appendChild(statusRegion);
    }
    var region = statusRegion;
    // Blank first, so the same message twice is still a change to announce.
    region.textContent = "";
    setTimeout(function () {
      region.textContent = text;
    }, 60);
  }

  // Problems are said in the site's shared toast where the page has one
  // (core.js), otherwise in a toast of the same style made on the spot —
  // the same arrangement auth.js uses.
  function say(text) {
    if (typeof window.bpozzShowToast === "function") {
      window.bpozzShowToast(text);
      return;
    }
    var toast = document.getElementById("saved-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      toast.id = "saved-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.setAttribute("data-visible", "true");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.removeAttribute("data-visible");
    }, 4000);
  }

  function tellLoadFailed() {
    if (toldLoadFailed) return;
    toldLoadFailed = true;
    say(MESSAGES.loadFailed);
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (other) {
        return other !== fn;
      });
    };
  }

  function notify() {
    listeners.slice().forEach(function (fn) {
      try {
        fn();
      } catch (err) {
        // One page script's mistake must not stop the others hearing.
        if (window.console) window.console.error(err);
      }
    });
  }

  // ---------- other tabs ----------

  function openChannel() {
    if (typeof window.BroadcastChannel !== "function") return null;
    try {
      var opened = new window.BroadcastChannel(CHANNEL);
      opened.onmessage = function (e) {
        receive(e && e.data);
      };
      return opened;
    } catch (err) {
      return null;
    }
  }

  function closeChannel() {
    if (!channel) return;
    try {
      channel.close();
    } catch (err) {
      // Already closed.
    }
    channel = null;
  }

  // Only a kind, an id and a state, or a nudge — never anything about who.
  function post(message) {
    if (!channel) return;
    try {
      channel.postMessage(message);
    } catch (err) {
      // A closed channel: other tabs catch up when they next load a list.
    }
  }

  function receive(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "session") {
      if (session === "signed-in") refreshOnce();
      return;
    }
    if (message.type !== "item" || session !== "signed-in") return;
    if (typeof message.saved !== "boolean" || !isValidItem(message.kind, message.id)) return;
    markSaved(message.kind, message.id, message.saved);
    paintItem(message.kind, message.id);
    notify();
  }

  // ---------- this browser's saves from before accounts ----------

  // { ok: false } when storage can't be read at all; `value` is the parsed
  // JSON, or undefined when the key is missing or unreadable.
  function readStored(key) {
    var raw;
    try {
      raw = window.localStorage.getItem(key);
    } catch (err) {
      return { ok: false, value: undefined };
    }
    if (typeof raw !== "string") return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      return { ok: true, value: undefined };
    }
  }

  function cleanIds(value, kind) {
    var ids = [];
    var seen = Object.create(null);
    if (!Array.isArray(value)) return ids;
    value.forEach(function (id) {
      if (isValidItem(kind, id) && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
    return ids;
  }

  // Reading these changes nothing.
  function legacy() {
    return {
      fonts: cleanIds(readStored(FONT_FAVORITES).value, "font"),
      paletteLikes: cleanIds(readStored(PALETTE_LIKES).value, "palette"),
    };
  }

  function importDismissed() {
    var stored = readStored(IMPORT_MARKER);
    return !!(stored.value && stored.value.v === 1 && stored.value.dismissed === true);
  }

  function dismissImport() {
    try {
      window.localStorage.setItem(IMPORT_MARKER, JSON.stringify({ v: 1, dismissed: true }));
      return true;
    } catch (err) {
      return false;
    }
  }

  // After an import: takes out of the old font list exactly the ids the
  // account now holds (answered created or exists), re-reading the list
  // first in case another tab changed it, and deletes the key once it is
  // empty. Everything else in it stays as it was. False when the browser
  // wouldn't let it write.
  function dropImportedFonts(imported) {
    if (!Object.keys(imported).length) return true;
    var stored = readStored(FONT_FAVORITES);
    if (!stored.ok) return false;
    if (!Array.isArray(stored.value)) return true;
    var rest = stored.value.filter(function (entry) {
      return !(typeof entry === "string" && imported[entry] === true);
    });
    if (rest.length === stored.value.length) return true;
    try {
      if (rest.length) window.localStorage.setItem(FONT_FAVORITES, JSON.stringify(rest));
      else window.localStorage.removeItem(FONT_FAVORITES);
      return true;
    } catch (err) {
      return false;
    }
  }

  var RESULT_STATUSES = ["created", "exists", "invalid", "limit"];

  function resultsOf(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.results)) return null;
    var results = [];
    for (var i = 0; i < data.results.length; i++) {
      var result = data.results[i];
      if (
        !result ||
        typeof result !== "object" ||
        typeof result.kind !== "string" ||
        typeof result.id !== "string" ||
        RESULT_STATUSES.indexOf(result.status) === -1
      ) {
        return null;
      }
      results.push({ kind: result.kind, id: result.id, status: result.status });
    }
    return results;
  }

  function wanted(options, kind, id) {
    var check = options.known && options.known[kind];
    return typeof check !== "function" || check(id) === true;
  }

  function importFailure(r) {
    if (r.status === 401) {
      applySession(false);
      return { ok: false, reason: "signed-out" };
    }
    if (r.status === 429) return { ok: false, reason: "rate-limited", message: MESSAGES.importTooMany };
    if (r.status === 0 || r.status === 503) {
      return { ok: false, reason: "unavailable", message: MESSAGES.unavailable };
    }
    return { ok: false, reason: "failed", message: MESSAGES.saveFailed };
  }

  // options: fonts (default true), palettes (default false: likes are only
  // sent when the visitor asks), known: { font, palette } — functions that
  // say whether an id is still in the catalogue.
  function runImport(options) {
    if (session !== "signed-in") return { ok: false, reason: "signed-out" };
    var old = legacy();
    var items = [];
    if (options.fonts !== false) {
      old.fonts.forEach(function (id) {
        if (wanted(options, "font", id)) items.push({ kind: "font", id: id });
      });
    }
    if (options.palettes === true) {
      old.paletteLikes.forEach(function (id) {
        if (wanted(options, "palette", id)) items.push({ kind: "palette", id: id });
      });
    }
    items = items.slice(0, MAX_IMPORT_ITEMS);
    if (!items.length) {
      return { ok: true, created: 0, existing: 0, invalid: 0, limited: 0, results: [], storageUpdated: true };
    }
    var gen = generation;
    return withSession(function () {
      return send("POST", API + "/import", { items: items });
    }, gen).then(function (r) {
      if (gen !== generation) return { ok: false, reason: "signed-out" };
      var results = r.status === 200 ? resultsOf(r.data) : null;
      if (!results) return importFailure(r);
      var imported = Object.create(null);
      var counts = { created: 0, exists: 0, invalid: 0, limit: 0 };
      results.forEach(function (result) {
        counts[result.status] += 1;
        if (result.status !== "created" && result.status !== "exists") return;
        if (!isValidItem(result.kind, result.id)) return;
        markSaved(result.kind, result.id, true);
        if (result.kind === "font") imported[result.id] = true;
      });
      var storageUpdated = dropImportedFonts(imported);
      dismissImport();
      paintAll();
      notify();
      return {
        ok: true,
        created: counts.created,
        existing: counts.exists,
        invalid: counts.invalid,
        limited: counts.limit,
        results: results,
        storageUpdated: storageUpdated,
      };
    });
  }

  function importLegacy(options) {
    if (importing) return importing;
    importing = known
      .then(function () {
        return runImport(options || {});
      })
      .then(
        function (result) {
          importing = null;
          return result;
        },
        function () {
          importing = null;
          return { ok: false, reason: "failed", message: MESSAGES.saveFailed };
        },
      );
    return importing;
  }

  // ---------- the rest of the public API ----------

  function signedIn() {
    return session === "pending" ? null : session === "signed-in";
  }

  // true or false once the kind's list has loaded, null until then (and
  // whenever signed out).
  function has(kind, id) {
    if (session !== "signed-in" || !isValidItem(kind, id)) return null;
    var store = stores[kind];
    if (!store || store.state !== "ready") return null;
    return displayed(kind, id);
  }

  // The whole list (or one kind of it), newest first, for the account page.
  function list(kind) {
    if (kind !== undefined && KINDS.indexOf(kind) === -1) {
      return Promise.resolve({ ok: false, reason: "failed", message: MESSAGES.loadFailed });
    }
    return known.then(function () {
      if (session !== "signed-in") return { ok: false, reason: "signed-out" };
      var gen = generation;
      var since;
      var url = kind ? API + "?kind=" + encodeURIComponent(kind) : API;
      return withSession(function () {
        since = changeSeq;
        return send("GET", url);
      }, gen).then(function (r) {
        if (gen !== generation) return { ok: false, reason: "signed-out" };
        var items = r.status === 200 ? itemsOf(r.data) : null;
        if (!items) {
          if (r.status === 401) {
            applySession(false);
            return { ok: false, reason: "signed-out" };
          }
          if (r.status === 429) return { ok: false, reason: "rate-limited", message: MESSAGES.tooMany };
          return { ok: false, reason: "unavailable", message: MESSAGES.loadFailed };
        }
        var covered = kind ? [kind] : KINDS;
        covered.forEach(function (k) {
          fill(k, items, since);
        });
        notify();
        var current = withNewer(items, covered, since);
        var sent = r.data.limits && typeof r.data.limits === "object" ? r.data.limits : {};
        return {
          ok: true,
          items: current,
          count: current.length,
          limits: {
            total: countOr(sent.total, LIMITS.total),
            image_palette: countOr(sent.image_palette, LIMITS.image_palette),
          },
        };
      });
    });
  }

  function setItem(kind, id, want) {
    if (!isValidItem(kind, id)) {
      return Promise.resolve({
        ok: false,
        reason: "failed",
        message: want ? MESSAGES.saveFailed : MESSAGES.removeFailed,
      });
    }
    return known.then(function () {
      if (session !== "signed-in") return { ok: false, reason: "signed-out" };
      return change(kind, id, want);
    });
  }

  // ---------- start ----------

  window.BpozzSaved = Object.freeze({
    active: true,
    kinds: kinds,
    limits: limits,
    isValidItem: isValidItem,
    imagePaletteId: imagePaletteId,
    signedIn: signedIn,
    sync: sync,
    has: has,
    list: list,
    save: function (kind, id) {
      return setItem(kind, id, true);
    },
    remove: function (kind, id) {
      return setItem(kind, id, false);
    },
    onChange: onChange,
    legacy: legacy,
    importLegacy: importLegacy,
    importDismissed: importDismissed,
    dismissImport: dismissImport,
  });

  channel = openChannel();
  document.documentElement.setAttribute("data-saved-ui", "on");
  document.addEventListener("click", onClick);
  document.addEventListener("bpozz:session", function (e) {
    applySession(!!(e && e.detail && e.detail.authenticated === true));
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refetch(STALE_MS);
  });
  // An open BroadcastChannel can keep a page out of the back/forward cache,
  // so it is closed when the page is hidden for navigation (pagehide) and
  // opened again when the page is shown (pageshow). A page restored from
  // the cache refetches its lists, which covers whatever other tabs changed
  // meanwhile. Switching tabs fires neither, so a background tab keeps
  // hearing the others.
  window.addEventListener("pagehide", closeChannel);
  window.addEventListener("pageshow", function (e) {
    if (!channel) channel = openChannel();
    if (e && e.persisted) refetch(0);
  });
  sync(document);

  var auth = window.BpozzAuth;
  if (!auth || typeof auth.getSession !== "function") {
    applySession(false);
  } else {
    auth.getSession().then(
      function (data) {
        applySession(signedInFrom(data));
      },
      function () {
        applySession(false);
      },
    );
  }
})();
