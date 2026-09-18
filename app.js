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
      title: "About BPOZZ",
      updated: null,
      render: function () {
        return `
          <p>BPOZZ is a small, independent design intelligence library — guides, design tokens, and color palettes, written the way an engineering spec is written: precise, testable, and stripped of filler. Every guide exists because it answers a question we've had to answer ourselves while building real interfaces.</p>
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

  // Full-word level labels for the guide-card meta line (e.g. "Spacing &
  // Layout · Beginner · 11 min read"), shared by the homepage grid and
  // the related-guides row below each article — both render with the
  // exact same cardHtml().
  var LEVEL_LABEL = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
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
  // Guide pages (/guide/*.html), search, tokens, palettes, roadmap and the
  // standalone about/contact/privacy/terms pages load this same app.js
  // for the shared header search + mobile menu behavior and have neither.
  var hasGuideGrid = !!gridRoot;
  var isHomePage = !!homeView;

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
    var statCount = document.getElementById("stat-count");
    if (statCount) statCount.textContent = GUIDES.length;
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
    return '<div class="card-thumb">' + thumbMediaHtml(g) + "</div>";
  }

  // Minimal, resourceboy.com-style card: plain thumbnail, a title, and
  // one small muted meta line ("category · level · read time") — no
  // badge overlay, no description paragraph, no separate button. The
  // title's .card-link stretches over the whole .guide-card (see
  // styles.css), so the entire tile is one click target.
  function cardHtml(g) {
    var cat = CATEGORIES[g.category];
    var meta =
      cat.label +
      " · " +
      LEVEL_LABEL[g.level] +
      " · " +
      g.readTime +
      " min read";
    return (
      '<article class="guide-card">' +
      thumbHtml(g) +
      '<div class="card-body">' +
      '<h3 class="card-title"><a class="card-link" href="/guide/' +
      g.id +
      '">' +
      escapeHtml(g.title) +
      "</a></h3>" +
      '<p class="card-meta">' +
      escapeHtml(meta) +
      "</p>" +
      "</div>" +
      "</article>"
    );
  }

  // ---------- related-guides rail (every /guide/ page) ----------
  // Every guide page ships a static, empty <aside id="guide-rail"> (see
  // the .guide-layout / .guide-primary wrapper added around the
  // article) plus a <body data-guide-id="..."> attribute identifying
  // which guide it is. initRelatedGuides() below fills that aside in
  // once GUIDES has loaded, so "related guides" is driven entirely by
  // guides.json — add/remove/recategorize a guide there and every
  // rail across the site picks it up automatically, with no per-page
  // related-guides list to hand-maintain (that's what used to live
  // directly in each guide's markup, and drifted between pages).

  // Same-category guides are the most relevant match (mirrors the
  // site's own category grouping); same-level is a lighter,
  // secondary signal. Ties keep guides.json's own order (Array#sort is
  // stable), which is also roughly the order guides were added in.
  function relatedGuides(current, count) {
    return GUIDES.filter(function (g) {
      return g.id !== current.id;
    })
      .map(function (g) {
        var score = 0;
        if (g.category === current.category) score += 2;
        if (g.level === current.level) score += 1;
        return { g: g, score: score };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, count)
      .map(function (x) {
        return x.g;
      });
  }

  function initRelatedGuides() {
    var rail = document.getElementById("guide-rail");
    if (!rail) return; // not a guide page (or an older page without one)

    var currentId = document.body.getAttribute("data-guide-id");
    var current = GUIDES.filter(function (g) {
      return g.id === currentId;
    })[0];

    // No match means either GUIDES failed to load or this guide was
    // retired from guides.json — either way there's nothing relevant
    // to show, so drop the empty section rather than leave a blank box.
    // Shows up to 10, laid out as a full-width row below the article —
    // reusing cardHtml() (the exact homepage guide-card markup) instead
    // of a bespoke bordered/bracketed rail card, so "related guides"
    // reads as the same minimal card used everywhere else on the site.
    var related = current ? relatedGuides(current, 10) : [];
    if (!related.length) {
      rail.remove();
      return;
    }

    rail.innerHTML =
      '<span class="section-label mono guide-rail__label">/ related_guides</span>' +
      '<div class="grid guide-rail__list">' +
      related.map(cardHtml).join("") +
      "</div>";
  }

  function render() {
    if (!hasGuideGrid) return;
    var filtered = getFiltered();
    var cards = filtered.map(cardHtml);
    gridRoot.innerHTML = cards.join("");

    var q = state.search.trim();
    if (q) {
      // Once a search term is active there's no fixed "total" to show
      // it against (unlike browsing a category), so report a plain
      // count-for-query instead — e.g. `12 Results for "grid"`, or
      // `0 Results for "asdf"` when nothing matches.
      resultsCount.textContent =
        filtered.length +
        " Result" +
        (filtered.length === 1 ? "" : "s") +
        ' for "' +
        q +
        '"';
    } else {
      resultsCount.textContent =
        "Showing " + filtered.length + " of " + GUIDES.length + " guides";
    }

    if (filtered.length === 0) {
      emptyState.setAttribute("data-visible", "true");
      emptyQuery.textContent = q ? '"' + q + '"' : "your current filters";
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

  // Exposed globally so other page-specific scripts (tokens-*.js, which
  // handle the /tokens/* pages) can reuse this exact toast element and
  // timing instead of re-implementing their own. Guarded on `toast`
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
          "Please fill in your name, a valid email, a subject, and a message before sending.";
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

  // Shared by the empty-state's "reset filters" button. Also clears any
  // query left in the header search inputs so a stale search term can't
  // silently keep filtering the grid after a reset.
  function resetFilters() {
    state = { search: "", category: "all", level: "all" };
    if (levelSelect) levelSelect.value = "all";
    headerSearchForms.forEach(function (form) {
      var input = form.querySelector("input[type='search']");
      if (input) input.value = "";
    });
    render();
  }

  // The level filter (#level-select) and the empty-state's #reset-filters
  // button only exist on the guide-grid page (guides/index.html) — this
  // whole block is skipped everywhere else instead of throwing on the
  // missing elements.
  if (hasGuideGrid) {
    levelSelect.addEventListener("change", function (e) {
      state.level = e.target.value;
      render();
    });
    document
      .getElementById("reset-filters")
      .addEventListener("click", function () {
        resetFilters();
        showToast("Filters reset.");
      });
  }

  // Category links (trending cards, header nav, footer) carry
  // data-jump-category. On the guide-grid page this filters the grid in
  // place and scrolls to it; on any page without the grid hasGuideGrid is
  // false, so this delegate does nothing and the link's own href does a
  // real navigation instead.
  document.addEventListener("click", function (e) {
    var jumpLink = e.target.closest("[data-jump-category]");
    if (jumpLink && hasGuideGrid) {
      e.preventDefault();
      state.category = jumpLink.getAttribute("data-jump-category");
      render();
      var guidesEl = document.getElementById("guides");
      if (guidesEl) {
        guidesEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
  });

  // --- Header quick search ---
  // Both the desktop header form and the homepage's hero search form
  // share the ".header-search" class, so this covers either without
  // duplicating logic. Each one is plain HTML (action="search.html",
  // method="get", input name="query") and needs no JS to work:
  // submitting it (Enter or the button) is a normal browser GET to
  // search.html?query=... from any page, including this one — that
  // page reads the query param itself, fetches guides.json, and
  // renders matching results (or a "no results" message) there.
  // Nothing here intercepts the submit or filters this page's grid
  // in place anymore. headerSearchForms is kept only so
  // resetFilters() (above) can blank a stale value left in the input.
  var headerSearchForms = document.querySelectorAll(".header-search");

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

  // ---------- roadmap progress ----------
  // The roadmap itself (stage/step markup) lives on its own page,
  // roadmap.html, and is fully pre-rendered at build time — see
  // build-home.js's ROADMAP_STAGES/buildRoadmap(). Nothing here builds
  // or filters that markup, or waits on loadGuides(); it only layers
  // "mark as read" checkboxes + a progress bar on top of the static
  // HTML that's already in the DOM, persisting state to localStorage
  // per browser (no accounts, matching how the rest of the site
  // works). This looks for .roadmap-track wherever it is in the page
  // rather than checking isHomePage, since the roadmap now lives on a
  // non-home page — it simply no-ops on every other page, which has
  // no .roadmap-track at all.
  (function initRoadmapProgress() {
    var track = document.querySelector(".roadmap-track");
    if (!track) return;

    var STORAGE_KEY = "point-roadmap-progress";
    var checkboxes = Array.prototype.slice.call(
      track.querySelectorAll(".roadmap-step-checkbox"),
    );
    var progressFill = document.getElementById("roadmap-progress-fill");
    var progressLabel = document.getElementById("roadmap-progress-label");
    var resetBtn = document.getElementById("roadmap-reset");

    function loadDone() {
      try {
        var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }

    function saveDone(ids) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      } catch (err) {
        // Private browsing / storage disabled: the checkboxes still
        // work for this session, they just won't persist on reload.
      }
    }

    var done = loadDone();

    function updateStageState(stageEl) {
      var boxes = stageEl.querySelectorAll(".roadmap-step-checkbox");
      var allDone =
        boxes.length > 0 &&
        Array.prototype.every.call(boxes, function (cb) {
          return cb.checked;
        });
      stageEl.classList.toggle("is-complete", allDone);
    }

    function updateSummary() {
      var total = checkboxes.length;
      var completed = checkboxes.filter(function (cb) {
        return cb.checked;
      }).length;
      if (progressFill) {
        progressFill.style.width =
          (total ? (completed / total) * 100 : 0) + "%";
      }
      if (progressLabel) {
        progressLabel.textContent =
          completed === 0
            ? "Check off a guide once you've read it — progress is saved in this browser."
            : completed === total
              ? "All " + total + " guides marked complete. Nice work."
              : completed + " of " + total + " guides marked complete.";
      }
      if (resetBtn) resetBtn.hidden = completed === 0;
    }

    checkboxes.forEach(function (cb) {
      var id = cb.getAttribute("data-roadmap-id");
      var checked = done.indexOf(id) !== -1;
      cb.checked = checked;
      var stepEl = cb.closest(".roadmap-step");
      if (stepEl) stepEl.classList.toggle("is-complete", checked);
    });
    track.querySelectorAll(".roadmap-stage").forEach(updateStageState);
    updateSummary();

    track.addEventListener("change", function (e) {
      var cb = e.target;
      if (!cb.classList || !cb.classList.contains("roadmap-step-checkbox"))
        return;
      var id = cb.getAttribute("data-roadmap-id");
      var stepEl = cb.closest(".roadmap-step");
      if (stepEl) stepEl.classList.toggle("is-complete", cb.checked);

      var idx = done.indexOf(id);
      if (cb.checked && idx === -1) {
        done.push(id);
      } else if (!cb.checked && idx !== -1) {
        done.splice(idx, 1);
      }
      saveDone(done);

      var stageEl = cb.closest(".roadmap-stage");
      if (stageEl) updateStageState(stageEl);
      updateSummary();
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        done = [];
        saveDone(done);
        checkboxes.forEach(function (cb) {
          cb.checked = false;
          var stepEl = cb.closest(".roadmap-step");
          if (stepEl) stepEl.classList.remove("is-complete");
        });
        track.querySelectorAll(".roadmap-stage").forEach(function (stageEl) {
          stageEl.classList.remove("is-complete");
        });
        updateSummary();
        showToast("Roadmap progress reset.");
      });
    }
  })();

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

  init();
})();
