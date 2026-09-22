/**
 * core.js — shared scaffolding for /app.js.
 * -----------------------------------------------------------------------
 * PHASE 3 (deduplication). app.js was one 1058-line IIFE holding five
 * unrelated concerns. It is now five files under src/client/, concatenated
 * back into a single /app.js by the build — the public URL, the load order
 * and the executed program are unchanged (see APP_BUNDLE in src/build.js).
 *
 * THIS FILE IS A BUNDLE FRAGMENT, NOT A MODULE. It is one slice of an IIFE
 * body: the opening `(function () {` and the closing `})();` are emitted by
 * the bundler, and the five fragments share one function scope exactly as
 * they did when they were one file. That is deliberate — it is what makes
 * the split provably behaviour-preserving rather than a rewrite. Fragments
 * are never published individually and are never loaded by a <script> tag.
 *
 * BOOT ORDER. app.js called init() as its final statement; it is now the
 * final statement of this fragment instead, ahead of guides.js and the
 * rest. The two are equivalent: init()'s only synchronous work is setting
 * the "Loading guides…" label and starting fetch("/guides.json"), and
 * everything after its first await is queued as a microtask, which cannot
 * run until the whole assembled bundle — every later fragment's listener
 * registration included — has finished executing. Function declarations
 * in later fragments (render, populateSelects, initRelatedGuides,
 * initContactForm) are hoisted to the shared IIFE scope, so they are
 * callable from here.
 *
 * SHARED RENDERERS. escapeHtml() and the Guide card used to be defined in
 * this file, as one of three byte-identical copies (app.js, build-home.js,
 * build-categories.js). They now come from src/shared/html.js and
 * src/shared/card.js, which the build emits ahead of these fragments. The
 * category thumbnails, icons, motifs and dimension labels moved with them;
 * CATEGORIES did not, because it is a label map and a runtime fetch of
 * categories.json was rejected (D1 A) — so the browser hands its literal
 * to the renderer.
 *
 * WHAT LIVES HERE
 *   category labels, the shared-renderer wiring, GUIDES, PAGES, filter
 *   state, DOM handles, the toast, hash routing, the mobile menu, and the
 *   guides.json load + boot.
 *
 * WHAT MOVED OUT
 *   guides.js    grid rendering, filtering, the related-guides rail
 *   search.js    the header quick-search forms
 *   contact.js   the in-app contact form
 *   roadmap.js   roadmap progress checkboxes
 *   html.js      escapeHtml            (src/shared/, deduplicated)
 *   card.js      the Guide card + category metadata (src/shared/, ditto)
 * -----------------------------------------------------------------------
 */

  var CATEGORIES = {
    "color-theory": { label: "Color Theory" },
    typography: { label: "Typography" },
    spacing: { label: "Spacing & Layout" },
    figma: { label: "Figma Workflow" },
    "adobe-xd": { label: "Adobe XD Workflow" },
    mobile: { label: "Mobile App Design" },
    web: { label: "Web Layout" },
    systems: { label: "Design Systems" },
    accessibility: { label: "Accessibility" },
    motion: { label: "Prototyping & Motion" },
  };

  // Shared renderers — src/shared/html.js + card.js (see file header).
  var escapeHtml = BpozzHtml.escapeHtml;
  var cardRenderer = BpozzCard.createRenderer({ categories: CATEGORIES });
  var cardHtml = cardRenderer.cardHtml;
  var thumbHtml = cardRenderer.thumbHtml;
  var thumbMediaHtml = cardRenderer.thumbMediaHtml;

  // Each guide's `thumbnail` points to a local image file (any web
  // image format) that sits in a "thumbnail_image_webp" folder next to
  // index.html. It's used for the card thumbnail on the guide list
  // below. If the file at that path doesn't exist yet, the card
  // automatically falls back to this category's blueprint-style SVG
  // icon (see THUMBS above) — so the site never shows a broken image.
  // (The same fallback pattern is used for each guide's own hero
  // image too, but that markup now lives directly in each guide's
  // static page under /guide/ rather than being rendered here.)
  //
  // The guide data itself now lives in guides.json (fetched below by
  // loadGuides()) instead of being hardcoded here. GUIDES starts empty
  // and is populated once that fetch resolves.
  var GUIDES = [];

  // Static site pages. These now also exist as standalone, crawlable
  // files (about.html, contact.html, privacy.html, terms.html) that
  // are the canonical, linked-to versions for SEO purposes. This
  // in-app copy is kept only so old #/about, #/contact, #/privacy,
  // #/terms hash links still resolve to something inside the SPA.
  var PAGES = {
    about: {
      title: "About BPOZZ",
      updated: null,
      render: function () {
        return `
          <p>BPOZZ is a small, independent design intelligence library — guides and color palettes, written the way an engineering spec is written: precise, testable, and stripped of filler. Every guide exists because it answers a question we've had to answer ourselves while building real interfaces.</p>
          <h3>What "documented like blueprints" means</h3>
          <p>Most design writing either stays abstract — principles with no numbers attached — or turns into a listicle of loosely related tips. We aim for something closer to a spec sheet: concrete ratios, concrete pixel values, and a stated reason for each one, so a guide can be applied directly instead of just admired.</p>
          <h3>No affiliate links, no sponsored placement</h3>
          <p>Every guide on this site is written first and monetized second. We don't accept payment to feature a tool, and guide content itself is never sponsored. Where the site does carry advertising, it's kept clearly separate from the guides themselves and labeled as an advertisement — see our <a href="privacy.html">Privacy Policy</a> for the specifics of how that works.</p>
          <h3>Who this is for</h3>
          <p>Designers moving from visual intuition toward a more systematic practice, and developers who need to understand the reasoning behind a spec, not just the pixel values in it. Guides are labeled beginner, intermediate, or advanced so you can find your level quickly.</p>
          <h3>Get in touch</h3>
          <p>Found an error, have a topic you'd like covered, or just want to say hello? Visit our <a href="contact.html">Contact page</a> — we read every message.</p>
        `;
      },
    },
    privacy: {
      title: "Privacy Policy",
      updated: "Effective date: August 4, 2026",
      render: function () {
        return `
          <p>This Privacy Policy explains what information BPOZZ ("BPOZZ," "we," "us") collects, how it's used, and the choices available to you. By using this site, you agree to the practices described here.</p>
          <h3>Information we collect</h3>
          <p>We collect two kinds of information. First, information you provide directly — for example, your name, email address, and message when you use the <a href="contact.html">contact form</a>. Second, information collected automatically as you browse, such as approximate location derived from IP address, browser and device type, pages viewed, and referring site, typically gathered through standard analytics and advertising cookies.</p>
          <h3>Cookies and advertising (Google AdSense)</h3>
          <p>This site uses, or may use, Google AdSense to serve advertising. Google and its advertising partners use cookies — including the DoubleClick DART cookie — to serve ads based on a visitor's prior visits to this website and other websites across the internet. This allows Google and its partners to serve ads that are more relevant to you based on your browsing activity.</p>
          <ul>
            <li>You can opt out of personalized advertising by visiting Google's Ads Settings.</li>
            <li>You can opt out of some third-party vendors' use of cookies for personalized advertising by visiting the Digital Advertising Alliance's consumer opt-out page at aboutads.info.</li>
            <li>Third-party vendors, including Google, may show our ads on sites across the internet using cookies previously set on your browser.</li>
          </ul>
          <p>We also use functional cookies to remember basic preferences, such as filter or search state during a session. These do not personally identify you.</p>
          <h3>How we use information</h3>
          <p>We use collected information to respond to inquiries submitted through the contact form, to understand which guides are useful so we can prioritize future writing, to maintain site security, and to serve advertising, including personalized advertising where cookies allow it.</p>
          <h3>Third-party links</h3>
          <p>Guides may link to third-party tools, articles, or resources. We are not responsible for the privacy practices or content of external sites, and linking to a resource is not an endorsement of its privacy practices.</p>
          <h3>Children's privacy</h3>
          <p>This site is not directed at children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, please contact us and we will remove it.</p>
          <h3>Your choices and rights</h3>
          <p>Depending on your location, you may have the right to request access to, correction of, or deletion of personal information we hold about you, submitted for example through our contact form. To make such a request, use the <a href="contact.html">contact form</a> and describe your request; we will respond within a reasonable time.</p>
          <h3>Changes to this policy</h3>
          <p>We may update this Privacy Policy from time to time. Material changes will be reflected by updating the effective date at the top of this page.</p>
          <h3>Contact</h3>
          <p>Questions about this policy can be sent through our <a href="contact.html">Contact page</a>.</p>
        `;
      },
    },
    terms: {
      title: "Terms of Service",
      updated: "Effective date: August 4, 2026",
      render: function () {
        return `
          <p>These Terms of Service govern your use of BPOZZ. By accessing or using this site, you agree to be bound by these terms. If you don't agree, please don't use the site.</p>
          <h3>Use of the site</h3>
          <p>You're welcome to browse and read guides for personal or internal professional reference. You may not scrape, republish, or redistribute substantial portions of our guide content without prior written permission.</p>
          <h3>Content ownership</h3>
          <p>All original guide text, structure, and illustrations on this site are the property of BPOZZ unless otherwise noted. References to third-party tools, such as Figma or Adobe XD, are used descriptively and belong to their respective owners; BPOZZ is not affiliated with or endorsed by those companies.</p>
          <h3>Advertising and third-party content</h3>
          <p>This site displays advertising, including ads served through Google AdSense. Ads are clearly labeled as advertising and are not editorial content. We do not control, and are not responsible for, the content of third-party advertisements, or the products and services they promote.</p>
          <h3>No professional advice</h3>
          <p>Guides are educational in nature and reflect general practices at the time of writing. They are not a substitute for professional judgment on any specific project, and we make no guarantee that following a guide will produce a particular result.</p>
          <h3>Disclaimer of warranties</h3>
          <p>This site and its content are provided "as is," without warranties of any kind, express or implied, including but not limited to accuracy, completeness, or fitness for a particular purpose.</p>
          <h3>Limitation of liability</h3>
          <p>To the fullest extent permitted by law, BPOZZ is not liable for any indirect, incidental, or consequential damages arising from your use of, or inability to use, this site.</p>
          <h3>Changes to these terms</h3>
          <p>We may revise these terms from time to time. Continued use of the site after a revision constitutes acceptance of the updated terms.</p>
          <h3>Contact</h3>
          <p>Questions about these terms can be sent through our <a href="contact.html">Contact page</a>.</p>
        `;
      },
    },
    contact: {
      title: "Contact us",
      updated: null,
      render: function () {
        return `
          <p>Have a question about a guide, spotted an error, or want to suggest a topic? Send us a message and we'll get back to you.</p>
          <div id="contact-form-wrap">
            <form id="contact-form" class="contact-form" novalidate>
              <div class="form-row">
                <label for="contact-name" class="sr-only">Name</label>
                <input type="text" id="contact-name" name="name" autocomplete="name" placeholder="Your name" required />
              </div>
              <div class="form-row">
                <label for="contact-email" class="sr-only">Email</label>
                <input type="email" id="contact-email" name="email" autocomplete="email" placeholder="Your email" required />
              </div>
              <div class="form-row">
                <label for="contact-subject" class="sr-only">Subject</label>
                <input type="text" id="contact-subject" name="subject" autocomplete="off" placeholder="Subject" required />
              </div>
              <div class="form-row">
                <label for="contact-topic" class="sr-only">Topic</label>
                <select id="contact-topic" name="topic">
                  <option value="general">General question</option>
                  <option value="correction">Report a correction</option>
                  <option value="suggestion">Suggest a guide topic</option>
                  <option value="advertising">Advertising inquiry</option>
                  <option value="privacy">Privacy / data request</option>
                </select>
              </div>
              <div class="form-row">
                <label for="contact-message" class="sr-only">Message</label>
                <textarea id="contact-message" name="message" placeholder="Your message" required></textarea>
              </div>
              <div class="form-error" id="contact-form-error" role="alert"></div>
              <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" style="position: absolute; left: -9999px" aria-hidden="true" />
              <button type="submit" class="btn btn-primary" style="align-self: flex-start;">Send message</button>
            </form>
            <p class="contact-alt">You can also reach us directly at <a href="mailto:hello@bpozz.com">hello@bpozz.com</a>. We typically respond within two business days.</p>
          </div>
        `;
      },
    },
  };

  var state = { search: "", category: "all", level: "all" };

  var gridRoot = document.getElementById("grid-root");
  var resultsCount = document.getElementById("results-count");
  var emptyState = document.getElementById("empty-state");
  var emptyQuery = document.getElementById("empty-query");
  var levelSelect = document.getElementById("level-select");
  var toast = document.getElementById("toast");
  var toastTimer = null;
  var homeView = document.getElementById("home-view");
  var pageView = document.getElementById("page-view");
  var pageViewBody = document.getElementById("page-view-body");
  var DEFAULT_TITLE = document.title;

  // Two separate questions, two flags (Phase 6):
  //   hasGuideGrid — does this page carry the guide grid + filters
  //     (#grid-root, #level-select, #results-count, #empty-state,
  //     #reset-filters)? Since Phase 6 that is the Guides collection,
  //     guides/index.html. Grid rendering, the Level filter, the
  //     loading/empty/error states and reset all check this.
  //   isHomePage — is this the homepage (index.html, the only page with
  //     #home-view)? Only the homepage's legacy hash routes
  //     (#/guide/<id>, #/about|contact|privacy|terms, #roadmap) check
  //     this, so they keep working now that the homepage has no grid,
  //     and never fire on /guides.
  // Guide pages (/guide/*.html), search, palettes, roadmap and the
  // standalone about/contact/privacy/terms pages load this same app.js
  // for the shared header search + mobile menu behavior and have neither.
  var hasGuideGrid = !!gridRoot;
  var isHomePage = !!homeView;

  // --- Shared card-thumbnail renderer export ---------------------------
  // search.html renders Guide result cards client-side and needs the very
  // same category thumbnail the build-time grids draw (src/shared/card.js).
  // Name and shape unchanged: search.html reads this global.
  //
  // This assignment runs while the IIFE body executes, before init()
  // at the bottom of this file, so the global is in place regardless of
  // what init() finds (or doesn't find) on the page.
  //
  // Callers pass a guides.json-shaped object: { category, title,
  // thumbnail? }. With no `thumbnail` the renderer returns the category
  // SVG on its own, which is exactly the base layer it already draws
  // under guide images elsewhere.
  window.BpozzCards = {
    thumbMediaHtml: thumbMediaHtml,
    thumbHtml: thumbHtml,
  };

  function showToast(message) {
    toast.textContent = message;
    toast.setAttribute("data-visible", "true");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.removeAttribute("data-visible");
    }, 2600);
  }

  // Exposed globally so other page-specific scripts can reuse this exact
  // toast element and timing instead of re-implementing their own. The
  // /tokens/* scripts that used it are gone. Guarded on `toast`
  // existing at all, since every page that loads app.js also ships the
  // shared <div class="toast" id="toast">.
  if (toast) {
    window.bpozzShowToast = showToast;
  }

  /* ---------- page routing ----------
     Each guide and static page lives at its own URL and is
     rendered as a real page here, replacing the guide list —
     there is no shared modal that every article is stuffed into. */

  function showPage(html) {
    if (!homeView || !pageView || !pageViewBody) return;
    pageViewBody.innerHTML = html;
    homeView.hidden = true;
    pageView.hidden = false;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    var heading = pageViewBody.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    } else {
      pageView.focus();
    }
  }

  function showHome() {
    if (!homeView || !pageView) return;
    if (pageView.hidden) return;
    pageView.hidden = true;
    pageViewBody.innerHTML = "";
    homeView.hidden = false;
    document.title = DEFAULT_TITLE;
  }

  function legalHtml(page) {
    var updatedHtml = page.updated
      ? '<p class="legal-updated mono">' + escapeHtml(page.updated) + "</p>"
      : "";
    return (
      '<div class="legal-content">' +
      "<h2>" +
      escapeHtml(page.title) +
      "</h2>" +
      updatedHtml +
      page.render() +
      "</div>"
    );
  }

  function renderLegalRoute(key) {
    var page = PAGES[key];
    if (!page) {
      showHome();
      return;
    }
    document.title = page.title + " — " + DEFAULT_TITLE;
    showPage(legalHtml(page));
    if (key === "contact") {
      initContactForm();
    }
  }

  // Guide ids that have since been renamed to a more descriptive slug
  // (e.g. "g6" -> "whitespace-as-ui-component"). Kept so an old
  // #/guide/<old-id> bookmark or shared link still resolves to
  // today's file instead of silently falling back to the guide list.
  // /guide/g6.html itself (the old crawlable URL, as opposed to this
  // in-app hash route) redirects separately — see g6.html itself,
  // plus _redirects/.htaccess for a real HTTP 301 where supported.
  var LEGACY_GUIDE_IDS = {
    g6: "whitespace-as-ui-component",
  };

  // Guides used to be rendered in place at #/guide/<id>. They now
  // each have their own real, crawlable page at /guide/<id> (the
  // underlying file is still <id>.html on disk; the host rewrites the
  // extensionless URL to it), so an old bookmarked or shared
  // #/guide/<id> link is redirected there instead of being rendered
  // inside the SPA. Unrecognized ids (e.g.
  // a link to one of the guides retired from GUIDES/guides.json) fall
  // back to the guide list (/guides) rather than redirecting to a 404.
  function handleRoute() {
    if (!isHomePage) return;
    var hash = location.hash;
    // The learning roadmap used to be a section of this page (#roadmap)
    // and is now its own real, crawlable file — send an old bookmarked
    // or shared index.html#roadmap link there instead of landing on a
    // dead fragment now that the section itself is gone.
    if (hash === "#roadmap") {
      location.replace("roadmap.html");
      return;
    }
    var guideMatch = hash.match(/^#\/guide\/([\w-]+)$/);
    if (guideMatch) {
      var id = LEGACY_GUIDE_IDS[guideMatch[1]] || guideMatch[1];
      var exists = GUIDES.some(function (g) {
        return g.id === id;
      });
      location.replace(exists ? "/guide/" + id : "/guides");
      return;
    }
    var pageMatch = hash.match(/^#\/(about|contact|privacy|terms)$/);
    if (pageMatch) {
      renderLegalRoute(pageMatch[1]);
      return;
    }
    showHome();
  }

  window.addEventListener("hashchange", handleRoute);

  // --- Mobile menu toggle ---
  // Below 640px the header's nav links and search collapse behind this
  // hamburger button into the #mobile-menu panel (see styles.css).
  var menuToggle = document.getElementById("menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");

  // PHASE 4 STEP 9 (accessibility) — where focus goes when the panel shuts.
  //
  // Every caller below hides the panel while the user may be standing
  // inside it. Measured with a real keyboard: open the menu, Tab to a link
  // in it, press Escape — the panel goes `hidden` with focus still on that
  // link, so focus collapses to <body> and the next Tab restarts from the
  // top of the document. That is a WCAG 2.4.3 failure and the one thing
  // Escape is supposed to get right.
  //
  // The fix is the disclosure pattern's: send focus back to the control
  // that opened the panel. Deliberately guarded on focus actually being
  // inside the panel, so the other three callers — a page-wide Escape with
  // focus elsewhere, a hashchange, a resize past 640px — keep behaving
  // exactly as they do now and never pull focus to the header.
  // The link-click caller is covered by the same guard: activating a link
  // in the panel navigates away, and focus is inside the panel then, but
  // restoring it is harmless (the toggle is the header of the page being
  // left) and keeps a same-page #hash link from dropping focus.
  function closeMobileMenu() {
    if (!mobileMenu || mobileMenu.hidden) return;
    var focusWasInside =
      document.activeElement && mobileMenu.contains(document.activeElement);
    mobileMenu.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    if (focusWasInside) menuToggle.focus();
  }

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener("click", function () {
      var willOpen = mobileMenu.hidden;
      mobileMenu.hidden = !willOpen;
      menuToggle.setAttribute("aria-expanded", String(willOpen));
    });
    mobileMenu.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeMobileMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMobileMenu();
    });
    window.addEventListener("hashchange", closeMobileMenu);
    window.addEventListener("resize", function () {
      if (window.innerWidth > 640) closeMobileMenu();
    });
  }

  // ---------- data loading ----------
  // Guide data lives in guides.json, fetched here with async/await
  // instead of being hardcoded in this file. Everything that depends
  // on GUIDES (rendering, search, filtering, routing) waits for this
  // fetch to resolve before it runs for the first time.
  async function loadGuides() {
    // Absolute path: this file is now loaded from nested pages too
    // (e.g. /guide/whitespace-as-ui-component.html), where a relative
    // "guides.json" would
    // resolve to /guide/guides.json and 404.
    const response = await fetch("/guides.json");
    if (!response.ok) {
      throw new Error(
        "Failed to load guides.json (HTTP " + response.status + ")",
      );
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("guides.json did not contain an array");
    }
    return data;
  }

  function renderLoadError() {
    if (!hasGuideGrid) return;
    // guides/index.html ships with the guide grid pre-rendered at build
    // time (see build-home.js) as a static fallback for crawlers, no-
    // JS visitors, and this exact case. If that pre-rendered markup
    // is already sitting in the DOM, keep it visible instead of
    // wiping a working page just because the *live* refresh failed —
    // search/filtering won't work against fresh data, but the guides
    // themselves are still right there.
    if (gridRoot.children.length > 0) {
      resultsCount.textContent =
        "Showing guides (couldn't refresh — search & filtering unavailable).";
      return;
    }
    gridRoot.innerHTML = "";
    resultsCount.textContent = "Couldn't load guides.";
    emptyState.setAttribute("data-visible", "true");
    emptyQuery.textContent =
      "a problem loading guides.json — check the console and try refreshing";
  }

  async function init() {
    // Pages without the guide grid load this same app.js for the shared
    // header search + mobile menu behavior but have no grid/results UI to
    // report loading progress on, so this is skipped there — see the
    // hasGuideGrid checks inside render() and renderLoadError(), and the
    // isHomePage check inside handleRoute(). guides.json itself is still
    // fetched on every page: guide pages' related-guides rail and the
    // homepage's #/guide/<id> redirect both need it.
    if (hasGuideGrid) resultsCount.textContent = "Loading guides…";
    try {
      GUIDES = await loadGuides();
    } catch (err) {
      console.error(err);
      populateSelects();
      renderLoadError();
      handleRoute();
      initRelatedGuides();
      return;
    }

    populateSelects();
    render();
    handleRoute();
    initRelatedGuides();
  }

  // Boot. Safe ahead of the later fragments — see BOOT ORDER in the header.
  init();
