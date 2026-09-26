/**
 * auth.js — the header's Sign in / Sign up actions and the full-screen
 * authentication dialog they open.
 * -----------------------------------------------------------------------
 * A SELF-CONTAINED MODULE, NOT A FRAGMENT. Unlike core.js and friends it
 * shares no scope with the rest of /app.js, because it ships twice:
 *
 *   - inside /app.js, as one of APP_BUNDLE's `modules` (src/build/build.js);
 *   - on its own at /auth.js, for the five hand-authored pages (about,
 *     contact, privacy, terms, hoysomrach) that deliberately do not load
 *     app.js but still carry the shared header.
 *
 * The window.BpozzAuth guard makes a second copy on the same page a no-op.
 *
 * WHY AN OVERLAY, NOT /signin + /signup PAGES
 *
 * The site has no router — every URL is a pre-rendered file — and the header
 * already works this way (the mobile menu is an in-page panel). A native
 * <dialog> opened with showModal() sits in the top layer above the sticky
 * header, makes the page behind it inert, and gives ESC for free. The dialog
 * markup is built on first open, so no page carries it until it is used.
 *
 * WHAT THIS FILE DOES NOT DO: AUTHENTICATE ANYONE
 *
 * bpozz is a static site. Nothing in a browser can verify a Google identity
 * or an email address securely, so this file never tries. It is the UI and
 * one side of a contract with a same-origin backend at /api/auth/* (spelled
 * out in docs/AUTH.md):
 *
 *   GET  /api/auth/session          probe: is auth deployed, and which
 *                                   providers are switched on?
 *   GET  /api/auth/google/start     full-page redirect into Google OAuth,
 *                                   handled entirely server-side
 *   POST /api/auth/email/start      ask the backend to email a sign-in link
 *
 * No client ID, secret or token ever passes through this file. Until the
 * backend exists the probe finds nothing, and the dialog says plainly that
 * sign-in is not available yet — it never pretends a sign-in succeeded.
 * The probe runs only when someone actually chooses a provider, so ordinary
 * page views never request a missing endpoint.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  if (window.BpozzAuth || typeof document === "undefined") return;

  var API = "/api/auth";
  var CLOSE_MS = 220;

  var COPY = {
    signin: {
      title: "Hello!",
      lede: "Sign in to continue with BPOZZ.",
      emailTitle: "Welcome back",
      emailLede: "Enter your email to continue.",
      switchText: "New to BPOZZ?",
      switchAction: "Create an account",
      switchTo: "signup",
    },
    signup: {
      title: "Create your account",
      lede: "Join BPOZZ to save your work and preferences.",
      emailTitle: "Create your account",
      emailLede: "Enter your email to get started.",
      switchText: "Already have an account?",
      switchAction: "Sign in",
      switchTo: "signin",
    },
  };

  var UNAVAILABLE =
    "Sign-in isn’t available yet — accounts are coming soon. Everything on BPOZZ still works without one.";

  var GOOGLE_ICON =
    '<svg class="auth__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    "</svg>";

  var MAIL_ICON =
    '<svg class="auth__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>';

  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

  var BACK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 18 5 12 11 6"/></svg>';

  // The right-hand visual: an original gradient field under a faint
  // blueprint grid and one set of construction lines — the "documented like
  // blueprints" idea, drawn rather than said. Purely decorative.
  var VISUAL =
    '<div class="auth__visual" aria-hidden="true">' +
    '<div class="auth__field"></div>' +
    '<div class="auth__grid"></div>' +
    '<svg class="auth__guides" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor">' +
    '<circle cx="200" cy="200" r="128"/>' +
    '<circle cx="200" cy="200" r="79" stroke-dasharray="2 5"/>' +
    '<line x1="40" y1="200" x2="360" y2="200"/>' +
    '<line x1="200" y1="40" x2="200" y2="360"/>' +
    '<circle cx="328" cy="200" r="3" fill="currentColor"/>' +
    '<circle cx="200" cy="72" r="3" fill="currentColor"/>' +
    "</svg>" +
    '<p class="auth__caption"><span>BPOZZ</span>Colors, type and systems — documented like blueprints.</p>' +
    "</div>";

  var MARKUP =
    '<div class="auth__panel">' +
    '<div class="auth__bar">' +
    '<button type="button" class="auth__close" data-auth-close aria-label="Close">' +
    CLOSE_ICON +
    "</button>" +
    "</div>" +
    '<div class="auth__body">' +
    '<button type="button" class="auth__back" data-auth-back hidden>' +
    BACK_ICON +
    "<span>All sign-in options</span></button>" +
    '<h2 class="auth__title" id="auth-title" tabindex="-1"></h2>' +
    '<p class="auth__lede" id="auth-lede"></p>' +
    '<p class="auth__notice" data-auth-notice role="status"></p>' +
    '<div class="auth__step" data-step="choose">' +
    '<button type="button" class="auth__btn" data-auth-google>' +
    GOOGLE_ICON +
    "<span>Continue with Google</span></button>" +
    '<div class="auth__or"><span>or</span></div>' +
    '<button type="button" class="auth__btn" data-auth-email>' +
    MAIL_ICON +
    "<span>Continue with email</span></button>" +
    "</div>" +
    '<form class="auth__step auth__form" data-step="email" novalidate hidden>' +
    '<label class="auth__label" for="auth-email">Email address</label>' +
    '<input class="auth__input" id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required aria-describedby="auth-email-error" />' +
    '<p class="auth__error" id="auth-email-error" hidden></p>' +
    '<button type="submit" class="btn btn-primary auth__submit">Continue</button>' +
    "</form>" +
    '<div class="auth__step" data-step="sent" hidden>' +
    '<button type="button" class="auth__btn" data-auth-retry>Use a different email</button>' +
    "</div>" +
    '<p class="auth__switch"><span data-auth-switch-text></span> ' +
    '<button type="button" class="auth__link" data-auth-switch></button></p>' +
    '<p class="auth__legal">By continuing, you agree to our ' +
    '<a href="/terms.html">Terms of Service</a> and ' +
    '<a href="/privacy.html">Privacy Policy</a>.</p>' +
    "</div>" +
    "</div>" +
    VISUAL;

  var dialog = null;
  var els = {};
  var mode = "signin";
  var step = "choose";
  var opener = null;
  var closeTimer = null;
  var session = null; // Promise, cached per page load once probed

  function $(selector) {
    return dialog.querySelector(selector);
  }

  function build() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "auth";
    dialog.id = "auth-dialog";
    dialog.setAttribute("aria-labelledby", "auth-title");
    dialog.setAttribute("aria-describedby", "auth-lede");
    dialog.innerHTML = MARKUP;
    document.body.appendChild(dialog);

    els.title = $("#auth-title");
    els.lede = $("#auth-lede");
    els.notice = $("[data-auth-notice]");
    els.back = $(".auth__back");
    els.google = $("[data-auth-google]");
    els.emailBtn = $("[data-auth-email]");
    els.form = $("form[data-step='email']");
    els.input = $("#auth-email");
    els.error = $("#auth-email-error");
    els.submit = $(".auth__submit");
    els.switchText = $("[data-auth-switch-text]");
    els.switchBtn = $("[data-auth-switch]");

    dialog.addEventListener("click", function (e) {
      if (e.target.closest("[data-auth-close]")) close();
      else if (e.target.closest("[data-auth-back]")) showStep("choose");
      else if (e.target.closest("[data-auth-retry]")) {
        showStep("email");
        els.input.select();
      } else if (e.target.closest("[data-auth-email]")) showStep("email");
      else if (e.target.closest("[data-auth-google]")) startGoogle();
      else if (e.target.closest("[data-auth-switch]")) {
        setMode(COPY[mode].switchTo);
        showStep(step === "sent" ? "choose" : step);
      }
    });
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      startEmail();
    });
    els.input.addEventListener("input", function () {
      if (!els.error.hidden) setError("");
    });
    // ESC. Handled here rather than left to the browser so it runs the same
    // closing transition as the × button.
    dialog.addEventListener("cancel", function (e) {
      e.preventDefault();
      close();
    });
    // The browser can still close the dialog without a cancel event (Chrome
    // does on a second ESC with no user activation in between). Whatever
    // closed it, the page underneath must get its scroll back.
    dialog.addEventListener("close", finishClose);
  }

  function setMode(next) {
    mode = COPY[next] ? next : "signin";
    render();
  }

  function render() {
    var copy = COPY[mode];
    if (step === "sent") {
      els.title.textContent = "Check your email";
    } else {
      els.title.textContent = step === "email" ? copy.emailTitle : copy.title;
    }
    if (step !== "sent") {
      els.lede.textContent = step === "email" ? copy.emailLede : copy.lede;
    }
    els.switchText.textContent = copy.switchText;
    els.switchBtn.textContent = copy.switchAction;
  }

  function showStep(next) {
    var from = step;
    step = next;
    Array.prototype.forEach.call(
      dialog.querySelectorAll("[data-step]"),
      function (node) {
        node.hidden = node.getAttribute("data-step") !== next;
      },
    );
    els.back.hidden = next !== "email";
    setNotice("");
    setError("");
    render();
    // Every step change hides the control that triggered it, so focus is
    // always placed explicitly; left alone it would fall to <body>.
    if (next === "email") els.input.focus();
    else if (next === "sent") els.title.focus();
    else if (from !== "choose") els.emailBtn.focus();
  }

  function setNotice(text) {
    els.notice.textContent = text;
    els.notice.classList.toggle("is-visible", !!text);
  }

  function setError(text) {
    els.error.textContent = text;
    els.error.hidden = !text;
    if (text) els.input.setAttribute("aria-invalid", "true");
    else els.input.removeAttribute("aria-invalid");
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  // --- backend boundary (see docs/AUTH.md) ----------------------------

  // Resolves to the backend's session document, or null when no auth
  // backend answers — a 404, an HTML error page or a network failure all
  // mean the same thing to a visitor: sign-in is not available.
  function probe() {
    if (!session) {
      session = fetch(API + "/session", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(function (res) {
          var type = res.headers.get("content-type") || "";
          if (!res.ok || type.indexOf("application/json") === -1) return null;
          return res.json();
        })
        .then(function (data) {
          return data && data.providers ? data : null;
        })
        .catch(function () {
          return null;
        });
    }
    return session;
  }

  function returnTo() {
    return location.pathname + location.search;
  }

  function startGoogle() {
    setBusy(els.google, true);
    setNotice("");
    probe().then(function (data) {
      if (!data || !data.providers.google) {
        setBusy(els.google, false);
        setNotice(UNAVAILABLE);
        return;
      }
      // A full-page navigation: the backend runs the OAuth authorization
      // code flow (state + PKCE) and sets an HttpOnly session cookie. The
      // browser never holds a Google token.
      location.assign(
        API +
          "/google/start?intent=" +
          encodeURIComponent(mode) +
          "&return_to=" +
          encodeURIComponent(returnTo()),
      );
    });
  }

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function startEmail() {
    var email = els.input.value.trim();
    if (!email) {
      setError("Enter your email address.");
      els.input.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError("Enter a valid email address, like name@example.com.");
      els.input.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(els.submit, true);

    probe()
      .then(function (data) {
        if (!data || !data.providers.email) return "unavailable";
        return fetch(API + "/email/start", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            email: email,
            intent: mode,
            returnTo: returnTo(),
          }),
        }).then(function (res) {
          if (res.ok) return "sent";
          if (res.status === 400 || res.status === 422) return "invalid";
          if (res.status === 429) return "limited";
          return "failed";
        });
      })
      .catch(function () {
        return "failed";
      })
      .then(function (outcome) {
        setBusy(els.submit, false);
        if (outcome === "sent") {
          showStep("sent");
          els.lede.textContent = "";
          els.lede.appendChild(document.createTextNode("We sent a link to "));
          var strong = document.createElement("strong");
          strong.textContent = email;
          els.lede.appendChild(strong);
          els.lede.appendChild(
            document.createTextNode(". Open it on this device to continue."),
          );
        } else if (outcome === "unavailable") {
          setNotice(UNAVAILABLE);
        } else if (outcome === "invalid") {
          setError("That email address wasn’t accepted. Check it and try again.");
          els.input.focus();
        } else if (outcome === "limited") {
          setError("Too many attempts. Wait a few minutes, then try again.");
        } else {
          setError("Something went wrong. Please try again.");
        }
      });
  }

  // --- open / close ----------------------------------------------------

  function isVisible(node) {
    return !!(node && node.isConnected && node.getClientRects().length);
  }

  // The mobile panel's own close logic lives in core.js on most pages and in
  // an inline script on the five that skip app.js; both keep the same three
  // attributes, so this mirrors them rather than reaching into either.
  function closeMobileMenu() {
    var menu = document.getElementById("mobile-menu");
    var toggle = document.getElementById("menu-toggle");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    }
  }

  function lockScroll() {
    // Hiding the scrollbar would otherwise widen the page by its width and
    // shift the header under the fading dialog.
    var gap = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.classList.add("auth-open");
    if (gap > 0) document.body.style.paddingRight = gap + "px";
  }

  function unlockScroll() {
    document.documentElement.classList.remove("auth-open");
    document.body.style.paddingRight = "";
  }

  function open(nextMode, trigger) {
    build();
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    opener = trigger || document.activeElement;
    closeMobileMenu();
    mode = COPY[nextMode] ? nextMode : "signin";
    showStep("choose");
    if (!dialog.open) {
      lockScroll();
      dialog.showModal();
      // Commit the closed styles before adding the open class, so the
      // opening transition runs instead of snapping.
      void dialog.offsetWidth;
    }
    dialog.classList.add("is-open");
    els.google.focus();
  }

  function close() {
    if (!dialog || !dialog.open || closeTimer) return;
    dialog.classList.remove("is-open");
    var reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    closeTimer = setTimeout(
      function () {
        closeTimer = null;
        if (dialog.open) dialog.close();
      },
      reduced ? 0 : CLOSE_MS,
    );
  }

  function finishClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    dialog.classList.remove("is-open");
    unlockScroll();
    // Back to whatever opened the dialog. A trigger inside the mobile panel
    // was hidden when the dialog opened, so fall back to the menu button.
    var target = isVisible(opener)
      ? opener
      : document.getElementById("menu-toggle");
    if (isVisible(target)) target.focus();
    opener = null;
  }

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest && e.target.closest("[data-auth-open]");
    if (!trigger) return;
    e.preventDefault();
    open(trigger.getAttribute("data-auth-open"), trigger);
  });

  window.BpozzAuth = { open: open, close: close };
})();
