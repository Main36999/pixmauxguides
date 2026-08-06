(function () {
  "use strict";

  var CATEGORIES = {
    "color-theory": { label: "Color Theory", code: "COLOR_THEORY" },
    typography: { label: "Typography", code: "TYPOGRAPHY" },
    spacing: { label: "Spacing & Layout", code: "SPACING_LAYOUT" },
    figma: { label: "Figma Workflow", code: "FIGMA" },
    "adobe-xd": { label: "Adobe XD Workflow", code: "ADOBE_XD" },
    mobile: { label: "Mobile App Design", code: "MOBILE_APP" },
    web: { label: "Web Layout", code: "WEB_LAYOUT" },
    systems: { label: "Design Systems", code: "DESIGN_SYSTEMS" },
    accessibility: { label: "Accessibility", code: "ACCESSIBILITY" },
    motion: { label: "Prototyping & Motion", code: "PROTOTYPING" },
  };

  var ICONS = {
    "color-theory":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><circle cx="15" cy="9" r="6"/><circle cx="12" cy="15" r="6"/></svg>',
    typography:
      '<svg viewBox="0 0 24 24"><text x="1" y="17" font-family="Georgia, serif" font-size="15" fill="currentColor">Aa</text></svg>',
    spacing:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="1.4"/></svg>',
    figma:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="4" width="12" height="12" rx="2"/><rect x="8" y="8" width="12" height="12" rx="2"/></svg>',
    "adobe-xd":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 L10 6 L14 14 L20 4"/><circle cx="10" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="14" cy="14" r="1.3" fill="currentColor" stroke="none"/></svg>',
    mobile:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="10" y1="19" x2="14" y2="19"/></svg>',
    web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="6" cy="7" r=".6" fill="currentColor" stroke="none"/><circle cx="8.6" cy="7" r=".6" fill="currentColor" stroke="none"/></svg>',
    systems:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    accessibility:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4 A8 8 0 0 1 12 20 Z" fill="currentColor" stroke="none"/></svg>',
    motion:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 A8 8 0 0 1 18 6"/><polygon points="16,3 21,6 16,9" fill="currentColor" stroke="none"/></svg>',
  };

  // Larger, more detailed blueprint-style motifs used on each guide
  // card's thumbnail plate. Each one is an inner SVG fragment (no
  // <svg> wrapper — that's added by thumbHtml) drawn in a shared
  // 240x120 coordinate space so the dimension line stays aligned.
  var THUMBS = {
    "color-theory": `
      <circle cx="102" cy="38" r="20"/>
      <circle cx="138" cy="38" r="20"/>
      <circle cx="120" cy="64" r="20"/>
    `,
    typography: `
      <line x1="60" y1="20" x2="180" y2="20" class="thumb-guide"/>
      <line x1="60" y1="78" x2="180" y2="78" class="thumb-guide"/>
      <text x="78" y="76" class="thumb-glyph">Aa</text>
    `,
    spacing: `
      <circle class="thumb-fill" cx="90" cy="24" r="3.4"/><circle class="thumb-fill" cx="120" cy="24" r="3.4"/><circle class="thumb-fill" cx="150" cy="24" r="3.4"/>
      <circle class="thumb-fill" cx="90" cy="44" r="3.4"/><circle class="thumb-fill" cx="120" cy="44" r="3.4"/><circle class="thumb-fill" cx="150" cy="44" r="3.4"/>
      <circle class="thumb-fill" cx="90" cy="64" r="3.4"/><circle class="thumb-fill" cx="120" cy="64" r="3.4"/><circle class="thumb-fill" cx="150" cy="64" r="3.4"/>
    `,
    figma: `
      <rect x="82" y="16" width="50" height="50" rx="6"/>
      <rect x="110" y="40" width="50" height="50" rx="6"/>
      <rect class="thumb-fill" x="107.5" y="37.5" width="5" height="5"/>
      <rect class="thumb-fill" x="157.5" y="37.5" width="5" height="5"/>
      <rect class="thumb-fill" x="107.5" y="87.5" width="5" height="5"/>
      <rect class="thumb-fill" x="157.5" y="87.5" width="5" height="5"/>
    `,
    "adobe-xd": `
      <path d="M70,86 L100,20 L130,60 L170,16"/>
      <circle class="thumb-fill" cx="100" cy="20" r="3.2"/>
      <circle class="thumb-fill" cx="130" cy="60" r="3.2"/>
      <circle class="thumb-handle-dot" cx="70" cy="86" r="3"/>
      <circle class="thumb-handle-dot" cx="170" cy="16" r="3"/>
      <line x1="100" y1="20" x2="85" y2="6" class="thumb-handle"/>
      <circle class="thumb-handle-dot" cx="85" cy="6" r="2.4"/>
    `,
    mobile: `
      <rect x="99" y="12" width="42" height="78" rx="7"/>
      <line x1="107" y1="24" x2="133" y2="24" stroke-width="1.2"/>
      <rect x="107" y="32" width="26" height="12" rx="2" stroke-width="1.2"/>
      <line x1="107" y1="50" x2="133" y2="50" stroke-width="1.2"/>
      <line x1="107" y1="56" x2="133" y2="56" stroke-width="1.2"/>
      <line x1="113" y1="84" x2="127" y2="84" stroke-width="2.2" stroke-linecap="round"/>
    `,
    web: `
      <rect x="50" y="18" width="140" height="70" rx="4"/>
      <line x1="50" y1="32" x2="190" y2="32" stroke-width="1.2"/>
      <circle class="thumb-fill" cx="60" cy="25" r="2"/>
      <circle class="thumb-fill" cx="68" cy="25" r="2"/>
      <circle class="thumb-fill" cx="76" cy="25" r="2"/>
      <rect x="58" y="40" width="26" height="40" stroke-width="1.2"/>
      <rect x="94" y="40" width="88" height="16" rx="1" stroke-width="1.2"/>
      <rect x="94" y="62" width="60" height="16" rx="1" stroke-width="1.2"/>
    `,
    systems: `
      <rect x="75" y="18" width="44" height="18" rx="4"/>
      <line x1="85" y1="27" x2="109" y2="27" stroke-width="1.2"/>
      <rect x="130" y="18" width="50" height="18" rx="2"/>
      <line x1="140" y1="23" x2="140" y2="31" stroke-width="1.2"/>
      <rect x="75" y="50" width="16" height="16" rx="3"/>
      <path d="M78,58 L82,62 L88,52" stroke-width="1.8"/>
      <line x1="98" y1="58" x2="150" y2="58" stroke-width="1.2"/>
    `,
    accessibility: `
      <path d="M65,44 Q100,18 135,44 Q100,70 65,44 Z"/>
      <circle cx="100" cy="44" r="10"/>
      <circle class="thumb-fill" cx="100" cy="44" r="3"/>
      <rect class="thumb-fill" x="152" y="60" width="9" height="14" style="opacity:.35"/>
      <rect class="thumb-fill" x="166" y="52" width="9" height="22" style="opacity:.65"/>
      <rect class="thumb-fill" x="180" y="44" width="9" height="30"/>
    `,
    motion: `
      <line x1="70" y1="18" x2="70" y2="88" stroke-width="1.2"/>
      <line x1="70" y1="88" x2="185" y2="88" stroke-width="1.2"/>
      <path d="M70,88 C110,80 145,28 185,20" stroke-width="1.8"/>
      <line x1="70" y1="88" x2="110" y2="80" class="thumb-handle"/>
      <line x1="185" y1="20" x2="145" y2="28" class="thumb-handle"/>
      <circle class="thumb-handle-dot" cx="110" cy="80" r="2.6"/>
      <circle class="thumb-handle-dot" cx="145" cy="28" r="2.6"/>
      <circle class="thumb-fill" cx="70" cy="88" r="3"/>
      <circle class="thumb-fill" cx="185" cy="20" r="3"/>
    `,
  };

  // The little dimension-style callout printed under each thumbnail
  // motif — a nod to the "documented like blueprints" framing.
  var THUMB_DIM_LABEL = {
    "color-theory": "4.5:1",
    typography: "16 / 24",
    spacing: "8 · 16 · 24",
    figma: "AUTO LAYOUT",
    "adobe-xd": "PEN TOOL",
    mobile: "375 × 812",
    web: "1440 × 900",
    systems: "DESIGN TOKENS",
    accessibility: "WCAG AA",
    motion: "EASE-OUT",
  };

  // Each guide's `thumbnail` points to a local image file (any web
  // image format) that sits in a "thumbnail_image" folder next to
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
      title: "About PIXMA UX Guides",
      updated: null,
      render: function () {
        return `
          <p>PIXMA UX Guides is a small, independent library of practical interface-design tutorials, written the way an engineering spec is written: precise, testable, and stripped of filler. Every guide exists because it answers a question we've had to answer ourselves while building real interfaces.</p>
          <h3>What "documented like blueprints" means</h3>
          <p>Most design writing either stays abstract — principles with no numbers attached — or turns into a listicle of loosely related tips. We aim for something closer to a spec sheet: concrete ratios, concrete pixel values, and a stated reason for each one, so a guide can be applied directly instead of just admired.</p>
          <h3>No affiliate links, no sponsored placement</h3>
          <p>Every guide on this site is written first and monetized second. We don't accept payment to feature a tool, and guide content itself is never sponsored. Where the site does carry advertising, it's kept clearly separate from the tutorials themselves and labeled as an advertisement — see our <a href="privacy.html">Privacy Policy</a> for the specifics of how that works.</p>
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
          <p>This Privacy Policy explains what information PIXMA UX Guides ("PIXMA," "we," "us") collects, how it's used, and the choices available to you. By using this site, you agree to the practices described here.</p>
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
          <p>These Terms of Service govern your use of PIXMA UX Guides. By accessing or using this site, you agree to be bound by these terms. If you don't agree, please don't use the site.</p>
          <h3>Use of the site</h3>
          <p>You're welcome to browse and read guides for personal or internal professional reference. You may not scrape, republish, or redistribute substantial portions of our guide content without prior written permission.</p>
          <h3>Content ownership</h3>
          <p>All original guide text, structure, and illustrations on this site are the property of PIXMA UX Guides unless otherwise noted. References to third-party tools, such as Figma or Adobe XD, are used descriptively and belong to their respective owners; PIXMA is not affiliated with or endorsed by those companies.</p>
          <h3>Advertising and third-party content</h3>
          <p>This site displays advertising, including ads served through Google AdSense. Ads are clearly labeled as advertising and are not editorial content. We do not control, and are not responsible for, the content of third-party advertisements, or the products and services they promote.</p>
          <h3>No professional advice</h3>
          <p>Guides are educational in nature and reflect general practices at the time of writing. They are not a substitute for professional judgment on any specific project, and we make no guarantee that following a guide will produce a particular result.</p>
          <h3>Disclaimer of warranties</h3>
          <p>This site and its content are provided "as is," without warranties of any kind, express or implied, including but not limited to accuracy, completeness, or fitness for a particular purpose.</p>
          <h3>Limitation of liability</h3>
          <p>To the fullest extent permitted by law, PIXMA UX Guides is not liable for any indirect, incidental, or consequential damages arising from your use of, or inability to use, this site.</p>
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
                <label for="contact-name">Name <span class="req">*</span></label>
                <input type="text" id="contact-name" name="name" autocomplete="name" required />
              </div>
              <div class="form-row">
                <label for="contact-email">Email <span class="req">*</span></label>
                <input type="email" id="contact-email" name="email" autocomplete="email" required />
              </div>
              <div class="form-row">
                <label for="contact-topic">Topic</label>
                <select id="contact-topic" name="topic">
                  <option value="general">General question</option>
                  <option value="correction">Report a correction</option>
                  <option value="suggestion">Suggest a guide topic</option>
                  <option value="advertising">Advertising inquiry</option>
                  <option value="privacy">Privacy / data request</option>
                </select>
              </div>
              <div class="form-row">
                <label for="contact-message">Message <span class="req">*</span></label>
                <textarea id="contact-message" name="message" required></textarea>
              </div>
              <div class="form-error" id="contact-form-error" role="alert"></div>
              <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" style="position: absolute; left: -9999px" aria-hidden="true" />
              <button type="submit" class="btn btn-primary" style="align-self: flex-start;">Send message</button>
            </form>
            <p class="contact-alt">You can also reach us directly at <a href="mailto:hello@pixmauxguides.com">hello@pixmauxguides.com</a>. We typically respond within two business days.</p>
          </div>
        `;
      },
    },
  };

  var LEVEL_ABBR = {
    beginner: "BEG",
    intermediate: "INT",
    advanced: "ADV",
  };

  var state = { search: "", category: "all", level: "all" };

  var gridRoot = document.getElementById("grid-root");
  var resultsCount = document.getElementById("results-count");
  var emptyState = document.getElementById("empty-state");
  var emptyQuery = document.getElementById("empty-query");
  var categorySelect = document.getElementById("category-select");
  var levelSelect = document.getElementById("level-select");
  var searchInput = document.getElementById("search-input");
  var toast = document.getElementById("toast");
  var toastTimer = null;
  var homeView = document.getElementById("home-view");
  var pageView = document.getElementById("page-view");
  var pageViewBody = document.getElementById("page-view-body");
  var DEFAULT_TITLE = document.title;

  // Only index.html has the guide grid + filter toolbar. Guide pages
  // (/guide/*.html) and the standalone about/contact/privacy/terms
  // pages load this same app.js for the shared header search + mobile
  // menu behavior, but don't have grid-root, category-select, etc.
  // Every home-only code path below checks this flag (or guards
  // itself internally) instead of assuming those elements exist.
  var isHomePage = !!gridRoot;

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

  function populateSelects() {
    if (categorySelect) {
      Object.keys(CATEGORIES).forEach(function (key) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = CATEGORIES[key].label;
        categorySelect.appendChild(opt);
      });
    }

    var statCount = document.getElementById("stat-count");
    if (statCount) statCount.textContent = GUIDES.length;

    // footer-categories exists on every page that uses the newer
    // shared footer (home + guide pages), so this part always runs.
    // From the home page the links jump-filter in place; from a guide
    // page they're plain links back to the toolbar on index.html.
    var footerList = document.getElementById("footer-categories");
    if (footerList) {
      Object.keys(CATEGORIES)
        .slice(0, 6)
        .forEach(function (key) {
          var li = document.createElement("li");
          var a = document.createElement("a");
          if (isHomePage) {
            a.href = "#toolbar";
            a.setAttribute("data-jump-category", key);
          } else {
            a.href = "../index.html#toolbar";
          }
          a.textContent = CATEGORIES[key].label;
          li.appendChild(a);
          footerList.appendChild(li);
        });
    }
  }

  function getFiltered() {
    var q = state.search.trim().toLowerCase();
    return GUIDES.filter(function (g) {
      if (state.category !== "all" && g.category !== state.category)
        return false;
      if (state.level !== "all" && g.level !== state.level) return false;
      if (q) {
        var hay = (
          g.title +
          " " +
          g.description +
          " " +
          CATEGORIES[g.category].label
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function dimLine(label) {
    var x1 = 64,
      x2 = 176,
      y = 99;
    return (
      '<line x1="' +
      x1 +
      '" y1="' +
      y +
      '" x2="' +
      x2 +
      '" y2="' +
      y +
      '" class="thumb-dim-line"/>' +
      '<line x1="' +
      x1 +
      '" y1="' +
      (y - 4) +
      '" x2="' +
      x1 +
      '" y2="' +
      (y + 4) +
      '" class="thumb-dim-tick"/>' +
      '<line x1="' +
      x2 +
      '" y1="' +
      (y - 4) +
      '" x2="' +
      x2 +
      '" y2="' +
      (y + 4) +
      '" class="thumb-dim-tick"/>' +
      '<text x="' +
      (x1 + x2) / 2 +
      '" y="' +
      (y + 13) +
      '" text-anchor="middle" class="thumb-dim-label">' +
      escapeHtml(label) +
      "</text>"
    );
  }

  // Shared media layer for both the guide-card thumbnail and the
  // article hero image. The blueprint-style SVG icon is always
  // rendered first as a base layer; if a `thumbnail` image is set,
  // it's layered on top and covers the icon once it loads. If that
  // image file hasn't been added yet (or fails to load for any
  // reason), its onerror handler hides it, so the SVG icon shows
  // through underneath instead of a broken-image glyph.
  function thumbMediaHtml(g) {
    var svg =
      '<svg viewBox="0 0 240 120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      THUMBS[g.category] +
      dimLine(THUMB_DIM_LABEL[g.category]) +
      "</svg>";
    if (!g.thumbnail) return svg;
    var img =
      '<img src="' +
      escapeHtml(g.thumbnail) +
      '" alt="' +
      escapeHtml(g.title) +
      '" loading="lazy" onerror="this.style.display=\'none\'">';
    return svg + img;
  }

  function thumbHtml(g) {
    var cat = CATEGORIES[g.category];
    return (
      '<div class="card-thumb">' +
      thumbMediaHtml(g) +
      '<span class="badge">' +
      cat.code +
      "</span>" +
      "</div>"
    );
  }

  function cardHtml(g) {
    return (
      '<article class="guide-card bracketed">' +
      thumbHtml(g) +
      '<div class="card-body">' +
      '<h3 class="card-title">' +
      escapeHtml(g.title) +
      "</h3>" +
      '<p class="card-desc">' +
      escapeHtml(g.description) +
      "</p>" +
      '<div class="card-footer">' +
      '<span class="card-meta mono">' +
      LEVEL_ABBR[g.level] +
      " · " +
      g.readTime +
      " MIN</span>" +
      '<a class="btn btn-card" href="/guide/' +
      g.id +
      '.html">Read guide <span aria-hidden="true">→</span></a>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function render() {
    if (!isHomePage) return;
    var filtered = getFiltered();
    var cards = filtered.map(cardHtml);
    gridRoot.innerHTML = cards.join("");
    resultsCount.textContent =
      "Showing " + filtered.length + " of " + GUIDES.length + " guides";
    if (filtered.length === 0) {
      emptyState.setAttribute("data-visible", "true");
      emptyQuery.textContent = state.search
        ? '"' + state.search + '"'
        : "your current filters";
    } else {
      emptyState.removeAttribute("data-visible");
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.setAttribute("data-visible", "true");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.removeAttribute("data-visible");
    }, 2600);
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

  // Same endpoint used by the standalone contact.html page — keep both
  // in sync if you change it. Sign up free at https://formspree.io,
  // create a form, and paste your own endpoint below.
  var CONTACT_FORM_ENDPOINT = "https://formspree.io/f/xljrealj";

  function initContactForm() {
    var form = document.getElementById("contact-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nameEl = document.getElementById("contact-name");
      var errorEl = document.getElementById("contact-form-error");
      var submitBtn = form.querySelector('button[type="submit"]');

      if (!form.checkValidity()) {
        errorEl.textContent =
          "Please fill in your name, a valid email, and a message before sending.";
        form.reportValidity();
        return;
      }

      if (CONTACT_FORM_ENDPOINT.indexOf("YOUR_FORM_ID") !== -1) {
        errorEl.textContent =
          "This form isn't connected yet — add your Formspree endpoint in app.js before it can send messages.";
        return;
      }

      errorEl.textContent = "";
      submitBtn.disabled = true;
      var originalBtnText = submitBtn.textContent;
      submitBtn.textContent = "Sending…";

      fetch(CONTACT_FORM_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      })
        .then(function (response) {
          if (response.ok) {
            var firstName =
              (nameEl.value || "").trim().split(" ")[0] || "there";
            var wrap = document.getElementById("contact-form-wrap");
            wrap.innerHTML =
              '<div class="form-success">' +
              "<strong>Message received.</strong>" +
              "<p>Thanks, " +
              escapeHtml(firstName) +
              " — we've got your message and will get back to you within two business days.</p>" +
              "</div>";
            return;
          }
          return response.json().then(function (data) {
            var message =
              data && data.errors && data.errors.length
                ? data.errors
                    .map(function (err) {
                      return err.message;
                    })
                    .join(", ")
                : "Something went wrong while sending your message. Please try again or email us directly.";
            throw new Error(message);
          });
        })
        .catch(function (err) {
          errorEl.textContent =
            (err && err.message) ||
            "Something went wrong while sending your message. Please try again or email us directly.";
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        });
    });
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
  // each have their own real, crawlable page at /guide/<id>.html, so
  // an old bookmarked or shared #/guide/<id> link is redirected there
  // instead of being rendered inside the SPA. Unrecognized ids (e.g.
  // a link to one of the guides retired from GUIDES/guides.json) fall
  // back to the guide list rather than redirecting to a 404.
  function handleRoute() {
    if (!isHomePage) return;
    var hash = location.hash;
    var guideMatch = hash.match(/^#\/guide\/([\w-]+)$/);
    if (guideMatch) {
      var id = LEGACY_GUIDE_IDS[guideMatch[1]] || guideMatch[1];
      var exists = GUIDES.some(function (g) {
        return g.id === id;
      });
      location.replace(
        exists ? "/guide/" + id + ".html" : "/index.html#guides",
      );
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

  // The filter toolbar (#search-input, #category-select, #level-select,
  // #reset-filters) only exists on index.html — this whole block is
  // skipped on guide/legal pages instead of throwing on the missing
  // elements.
  if (isHomePage) {
    searchInput.addEventListener("input", function (e) {
      state.search = e.target.value;
      render();
    });
    categorySelect.addEventListener("change", function (e) {
      state.category = e.target.value;
      render();
    });
    levelSelect.addEventListener("change", function (e) {
      state.level = e.target.value;
      render();
    });
    document
      .getElementById("reset-filters")
      .addEventListener("click", function () {
        state = { search: "", category: "all", level: "all" };
        searchInput.value = "";
        categorySelect.value = "all";
        levelSelect.value = "all";
        render();
        showToast("Filters reset.");
      });
  }

  // Footer "jump to category" links only carry data-jump-category (and
  // only need in-place filtering) on the home page — see populateSelects().
  // On other pages they're plain links to ../index.html#toolbar, so this
  // delegate simply never matches there.
  document.addEventListener("click", function (e) {
    var jumpLink = e.target.closest("[data-jump-category]");
    if (jumpLink && categorySelect) {
      e.preventDefault();
      categorySelect.value = jumpLink.getAttribute("data-jump-category");
      state.category = categorySelect.value;
      render();
      var toolbarEl = document.getElementById("toolbar");
      if (toolbarEl) {
        toolbarEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
  });

  // --- Header quick search ---
  // Both the desktop header form and the mobile menu form share the
  // ".header-search" class, so this works for either without duplicating
  // logic. Each form works with no JS at all too: its native GET to
  // index.html?q=... is a real navigation that lands here from any page.
  // This handler just upgrades that same action to filter in place when
  // we're already on index.html, instead of doing a full page reload.
  var headerSearchForms = document.querySelectorAll(".header-search");

  function runHeaderSearch(query) {
    if (!isHomePage) return;
    state.search = query;
    searchInput.value = query;
    headerSearchForms.forEach(function (form) {
      var input = form.querySelector("input[type='search']");
      if (input) input.value = query;
    });
    categorySelect.value = "all";
    levelSelect.value = "all";
    state.category = "all";
    state.level = "all";
    render();
    showHome();
    if (location.hash !== "#guides") {
      history.replaceState(null, "", "#guides");
    }
    document
      .getElementById("guides")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  }

  headerSearchForms.forEach(function (form) {
    form.addEventListener("submit", function (e) {
      // Off the home page there's nothing to filter in place, so let
      // the browser do its normal GET submit to ../index.html?q=...
      if (!isHomePage) return;
      e.preventDefault();
      var input = form.querySelector("input[type='search']");
      runHeaderSearch(((input && input.value) || "").trim());
    });
  });

  // --- Mobile menu toggle ---
  // Below 640px the header's nav links and search collapse behind this
  // hamburger button into the #mobile-menu panel (see styles.css).
  var menuToggle = document.getElementById("menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");

  function closeMobileMenu() {
    if (!mobileMenu || mobileMenu.hidden) return;
    mobileMenu.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
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
    if (!isHomePage) return;
    gridRoot.innerHTML = "";
    resultsCount.textContent = "Couldn't load guides.";
    emptyState.setAttribute("data-visible", "true");
    emptyQuery.textContent =
      "a problem loading guides.json — check the console and try refreshing";
  }

  async function init() {
    // Guide/legal pages load this same app.js for the shared header
    // search + mobile menu behavior but have no grid/results UI to
    // report loading progress on, so this (and every home-only step
    // below) is skipped there — see the isHomePage checks inside
    // render(), handleRoute(), renderLoadError(), and runHeaderSearch().
    if (isHomePage) resultsCount.textContent = "Loading guides…";
    try {
      GUIDES = await loadGuides();
    } catch (err) {
      console.error(err);
      populateSelects();
      renderLoadError();
      handleRoute();
      return;
    }

    populateSelects();
    render();
    handleRoute();

    // Arriving from another page's header search (e.g. a guide page's
    // search form -> index.html?q=spacing#guides): pick the term back
    // up and filter. Only meaningful on the home page itself.
    if (isHomePage) {
      var initialQuery = new URLSearchParams(location.search).get("q");
      if (initialQuery) {
        runHeaderSearch(initialQuery);
      }
    }
  }

  init();
})();
