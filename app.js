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
  // index.html. It's used both for the card thumbnail on the guide
  // list and as the hero image at the top of the guide's own article
  // page. If the file at that path doesn't exist yet, both places
  // automatically fall back to this category's blueprint-style SVG
  // icon (see THUMBS above) — so the site never shows a broken image.
  //
  // The guide data itself now lives in guides.json (fetched below by
  // loadGuides()) instead of being hardcoded here. GUIDES starts empty
  // and is populated once that fetch resolves.
  var GUIDES = [];

  // Full long-form article content for each guide. Each guide gets its
  // own real URL (#/guide/<id>) and is rendered as its own page when
  // that "Read guide" link is followed. Two flagship guides ship today;
  // the other 13 have been retired for now and can be re-added to this
  // object + the GUIDES array above later.
  var ARTICLES = {
    g6: {
      dek: `Whitespace is the fastest way to learn to see UI/UX design at all — once you notice how space carries meaning, every other decision on the page starts making sense too.`,
      sections: [
        {
          h: "Why whitespace is the right place to start",
          body: [
            `Most introductions to UI/UX start with color or typography, because they're the easiest things to point at. But color and type only work because of something more fundamental sitting underneath them: the space around and between elements. Get the spacing wrong and a perfect color palette and a beautifully paired typeface still won't rescue the layout.`,
            `Whitespace is also the one design decision every interface has, whether anyone made it on purpose or not. A button has padding whether or not a designer chose it deliberately; a list has gaps between items whether or not those gaps were sized on purpose. That makes it the most honest place to learn UI/UX, because there's no default to hide behind — every gap on a screen is a decision, made well or made by accident.`,
          ],
        },
        {
          h: "The blank page isn't empty",
          body: [
            `Call it whitespace, negative space, or just "the gaps" — the term doesn't have to mean white, or even blank. It means any area of a layout without content: the margin around a card, the gutter between two columns, the padding inside a button. Treat it as a design element with its own scale and rules, not whatever space happens to remain after every other decision has already been made.`,
            `The instinct to treat space as a leftover is understandable — it's the one part of a screen with nothing to click, read, or look at. But that absence of content is exactly what makes it powerful: space is the only tool in an interface that can create separation and hierarchy without adding a single new color, border, or line of text.`,
          ],
        },
        {
          h: "Two kinds of space: macro and micro",
          body: [
            `Macro whitespace separates major regions of a page: the gap between a header and the content beneath it, the distance between two independent sections, the margin around the page itself. These are the largest values in a spacing system, typically 32px, 48px, or 64px and up, because they need to read as a clear break even at a glance.`,
            `Micro whitespace lives inside a single component: the padding inside a button, the gap between a form label and its input, the space between an icon and the text next to it. These values are small — usually 4px to 16px — and need to stay identical across every instance of that component, because any inconsistency here reads as a bug rather than a style choice.`,
            `Confusing the two is a common beginner mistake. A macro-sized gap used inside a component makes it feel like it's falling apart into unrelated pieces; a micro-sized gap used between unrelated sections makes the whole page feel cramped and undifferentiated. The two scales solve different problems and shouldn't borrow each other's values.`,
          ],
        },
        {
          h: "Grouping is communication",
          body: [
            `Human perception groups things automatically, and this isn't a design metaphor — it's a documented set of principles from Gestalt psychology, developed for general visual perception long before screens existed, and interface design leans on it constantly. Two of the most useful for UI/UX are proximity (things placed close together are perceived as related) and common region (things enclosed by a shared boundary are perceived as one group).`,
            `Take a settings screen with a name field, an email field, and a "Save changes" button. If all three sit at identical spacing from each other, a person has to read the labels to work out that "Save changes" applies to both fields, not just the one directly above it. Add a slightly larger gap before the button, and that relationship becomes obvious without reading a single word — the spacing itself has communicated the structure.`,
            `This is the real reason inconsistent spacing feels "off" even to people who couldn't explain why. A label sitting exactly as far from its own input as from an unrelated element above it sends two contradictory signals about what belongs together, and the eye notices the contradiction even when the conscious mind never puts a name to it.`,
          ],
        },
        {
          h: "Hierarchy without new colors or fonts",
          body: [
            `A beginner's instinct for adding emphasis is usually to add something — a bolder weight, a brighter color, a border, a background tint. Every one of those additions is a real design decision with a real cost: another value to maintain, another rule to remember, one more thing competing for attention on the screen.`,
            `Space can create the same hierarchy for free. A section with more room around it reads as more important than a section crammed next to its neighbors, even set in identical type and color. Increasing the whitespace around a page's single most important action — a primary call-to-action, a hero heading — is often a stronger signal than making it bigger or brighter, because it doesn't just draw the eye, it gives the eye somewhere to land without competing for attention.`,
            `This is why experienced designers often "fix" a cluttered, hard-to-scan screen by removing elements and adding space, rather than by re-coloring or re-labeling everything on it. The content doesn't need to shout louder if it has room to be heard.`,
          ],
        },
        {
          h: "Density is a deliberate choice, not an accident",
          body: [
            `There's no single correct amount of whitespace — the right density depends entirely on what the interface is for. A financial dashboard or an admin table intentionally uses a tighter spacing scale, because the person using it wants to see as many rows and numbers as possible without scrolling, and every extra pixel of padding is a real cost measured in less visible data.`,
            `A marketing homepage or an onboarding flow intentionally goes the other way, using a loose spacing scale, because breathing room signals confidence and lets each idea land on its own before the next one arrives. Applying dashboard-level density to a landing page makes it feel like a spreadsheet; applying landing-page looseness to a data table makes it unusable for anyone trying to actually work in it.`,
            `Many mature products now expose this as a real, user-facing setting — "comfortable," "cozy," and "compact" density modes in tools like spreadsheets or admin panels are, functionally, a whitespace scale the user gets to choose for themselves. That's a useful mental model even for products that don't offer the toggle: ask which end of that spectrum actually serves the person using this specific screen, right now.`,
          ],
        },
        {
          h: "Building a spacing scale you can actually use",
          body: [
            `Random spacing values — one gap at 14px, the next at 22px, another at 18px — force every future decision to be a fresh guess. A spacing scale replaces guessing with a small, fixed set of numbers everyone on a team reuses: something like 4, 8, 12, 16, 24, 32, 48, and 64 pixels covers the vast majority of real interface needs.`,
            `Base the scale on a small unit — 4px or 8px are the most common choices — so every value stays predictable and divides cleanly across the pixel densities real screens actually use. Reserve the smallest steps (4–8px) for micro whitespace inside components, and the largest (32px and up) for macro whitespace between sections, with the middle of the scale handling everything in between.`,
            `Name the steps instead of typing raw numbers into code or design files — space-xs, space-sm, space-md, and so on, each mapped to a pixel value. That turns "how much space goes here" from an open-ended question into a choice from a short, known list, which is what actually makes a scale usable under deadline pressure rather than just a nice idea sitting in a style guide nobody opens.`,
          ],
        },
        {
          h: "Whitespace mistakes worth watching for",
          body: [
            `Uniform spacing everywhere is the most common mistake: giving every element on a screen the same gap regardless of its relationship to its neighbors. It feels safe and consistent, but it actually erases the grouping information spacing is supposed to provide — everything ends up looking equally related, which is functionally the same as looking equally unrelated.`,
            `Cramming a form or a dense list to "fit more on the screen" is a close second. Reducing padding below a comfortable minimum doesn't just look tight, it actively increases error rates and slows people down, because targets become harder to distinguish and misclicks become more likely — this matters most on touchscreens, where a finger is far less precise than a mouse cursor.`,
            `A subtler mistake is decorative inconsistency: padding that changes slightly from one card to the next, or one modal to the next, for no functional reason — usually because it was eyeballed rather than pulled from a defined scale. No single instance looks wrong in isolation, but the product as a whole starts to feel unpolished in a way that's hard to pin down without comparing screens side by side.`,
          ],
        },
        {
          h: "Auditing whitespace on a screen you didn't design",
          body: [
            `Whitespace is also one of the fastest things to audit on an existing product. Pick any screen and ask, for every gap you can see: does this value appear anywhere on the defined scale? An answer of "no" almost always means the gap was adjusted by eye during a rushed handoff, not chosen deliberately — and it's usually the first thing worth fixing.`,
            `Next, check whether related items sit closer together than unrelated ones. Group a label with its input, a heading with the paragraph it introduces, a button with the field it submits — if any of these relationships aren't visible from spacing alone, with all color and text imagined away, the hierarchy isn't actually being communicated by the layout, no matter how correct the content itself is.`,
            `Finally, pick a few reference relationships — inside a button, between a form's fields, between a page's major sections — and check that identical relationships use identical values everywhere the pattern repeats. A design system audit that starts with spacing tends to surface far more inconsistency, far faster, than one that starts with color or type, precisely because space is invisible enough that nobody double-checks it by default.`,
          ],
        },
        {
          h: "Where this leads next",
          body: [
            `Space is a genuinely good place to start learning UI/UX because getting it right doesn't depend on taste, a design degree, or a trained eye for color — it depends on noticing relationships and applying a consistent scale, which is a skill anyone can build with practice. Once grouping and hierarchy through space start to feel intuitive, the same underlying question carries directly over into every other layer of interface design: what is this decision communicating, and is it communicating it on purpose?`,
            `That question — asked of color, of type, of every border and shadow and animation — is really what UI/UX design is. Whitespace just happens to be the clearest, lowest-stakes place to start practicing the habit of asking it.`,
          ],
        },
      ],
      takeaways: [
        "Whitespace isn't empty — it's the one design tool that creates separation and hierarchy without adding a single new color or line of text.",
        "Separate macro spacing (between sections, 32px+) from micro spacing (inside components, 4–16px) — they solve different problems and shouldn't share values.",
        "Smaller gaps signal grouping, larger gaps signal separation — this is Gestalt proximity at work, and it does more communicative work than color or borders.",
        "Match density to purpose: tighter scales for data-dense tools, looser scales for storytelling and marketing pages.",
        "Build a small, named spacing scale (e.g. 4/8/12/16/24/32/48/64px) instead of typing one-off pixel values — consistency beats precision.",
        "Audit any screen by checking whether every visible gap maps to a defined scale value, and whether related items sit visibly closer together than unrelated ones.",
      ],
    },

    "color-contrast-systems": {
      dek: `Contrast is the only part of color theory with a pass/fail number attached to it — learn the ratios first, and every other palette decision gets easier to defend.`,
      sections: [
        {
          h: "Why contrast is the right place to start",
          body: [
            `Most introductions to color theory start with the color wheel: complementary pairs, split-complementary triads, warm versus cool. That's a real subject and it matters for mood and brand — but almost none of it is testable. Two designers can disagree forever about whether a palette "feels right," and both can be correct, because taste isn't a spec.`,
            `Contrast is different. It's the one part of color theory with an actual number attached, defined by an open standard, calculated the same way every time from the two colors involved. A palette either meets 4.5:1 for its body text or it doesn't — that's not a design opinion, it's arithmetic. That makes contrast the most defensible place to start learning color for interfaces, for the same reason whitespace is the most defensible place to start learning layout: there's no taste to hide behind.`,
          ],
        },
        {
          h: "What a contrast ratio actually is",
          body: [
            `A contrast ratio compares the relative luminance — perceived brightness, not just hue — of two colors, expressed as a ratio from 1:1 (identical colors, no contrast at all) up to 21:1 (pure black on pure white, the maximum possible). It's calculated from each color's RGB values, weighted toward green because the human eye is more sensitive to green light than to red or blue.`,
            `The formula itself is deliberately boring to compute by hand and easy to check with a tool: a browser's built-in accessibility inspector, a Figma or Adobe XD contrast plugin, or any free online contrast checker will take two hex codes and return a single number. The formula matters less than the habit of actually running it, on every text-and-background pairing before shipping, instead of estimating it by eye.`,
          ],
        },
        {
          h: "The numbers that actually matter",
          body: [
            `WCAG's Level AA contrast requirement — the bar most teams should treat as non-negotiable — is 4.5:1 for normal body text against its background. Large text gets a lower bar of 3:1, where "large" specifically means 18pt (24px) regular weight or 14pt (about 18.5px) bold and up; text that size stays legible even with less contrast behind it.`,
            `A second, newer rule — non-text contrast, added in WCAG 2.1 — requires 3:1 for the visual elements that let someone identify a UI component or its state: button borders, form field outlines, checkbox and radio button edges, focus indicators. Icons and infographic elements carrying real meaning fall under this too. It's the rule teams miss most often, because it's easy to obsess over text contrast and still ship a form with a border so faint it's nearly invisible.`,
            `A stricter tier — Level AAA — exists above that: 7:1 for normal text, 4.5:1 for large text. It's worth targeting for body copy on content-heavy products, but treat AA as the floor to clear on everything, not the goal to aim for on the easy cases.`,
          ],
        },
        {
          h: "What gets a pass, and why",
          body: [
            `WCAG explicitly exempts a few things from these minimums: disabled controls, purely decorative elements, logos and brand marks, and text that's baked into an image with no other way to present it. That exemption exists because a disabled button communicates its state through more than color alone — it's also unclickable, typically paired with a "not-allowed" cursor and a consistent reduced-opacity treatment — not because low contrast is fine whenever it's inconvenient to fix.`,
            `The practical takeaway: check every functional element a person actually needs to read or operate — labels, inputs, buttons, links, error text, chart lines, status badges — and treat "it's decorative" as a narrow exception that needs a real justification, not a default excuse for skipping the check.`,
          ],
        },
        {
          h: "Color alone is never enough",
          body: [
            `Roughly 1 in 12 men and 1 in 200 women have some form of color vision deficiency, most commonly reduced sensitivity to red or green. A palette can pass every contrast check and still fail these users if the interface's only signal for meaning is hue — a red-versus-green status dot at identical lightness and saturation, for instance, can look nearly identical to a meaningful share of a real audience.`,
            `The relevant rule is simple to state and easy to forget in the middle of a busy screen: never use color as the only visual means of conveying information. A form error needs a colored border and an icon and a text message, not just a color change. A chart needs distinct line styles or direct labels, not just distinct hues. This is a cheap fix when it's designed in from the start and an expensive one to retrofit across a shipped product.`,
          ],
        },
        {
          h: "Building a scale instead of picking colors one at a time",
          body: [
            `Choosing individual colors ad hoc — this blue for the button, a slightly different blue for the link, another for the focus ring — produces the same problem one-off spacing values do: nothing is reusable, and nothing gets checked systematically. The fix is the same too: build a numbered scale instead of a pile of loose hex codes.`,
            `A typical approach generates nine or ten steps per hue, often labeled 50 through 900, running from a near-white tint to a near-black shade at consistent lightness intervals rather than eyeballed jumps. One brand hue run through that scale produces every tint and shade a product actually needs — hover states, backgrounds, borders, disabled states — without anyone picking a fresh color for each new situation.`,
            `Grayscale gets the exact same treatment: a numbered neutral scale for text, borders, and surfaces, instead of a slightly different gray chosen for every component that happens to need one. Most of an interface's contrast work is actually gray-on-gray or gray-on-white, so the neutral scale tends to matter more day-to-day than the brand hue does.`,
          ],
        },
        {
          h: "Naming colors by role, not by hue",
          body: [
            `A hex code tells you nothing about what a color is for. The fix, borrowed from design systems work, is semantic naming: instead of styling a button with #1D5FD6 directly, define a token — action, or action-primary — that currently resolves to that hex value, and reference the token everywhere a "primary action color" is needed.`,
            `That does two things a raw hex code can't. First, it documents intent: a developer reading action-danger in code knows what the color means without opening a design file. Second, it makes the color swappable in exactly one place — adjust an accent hue once, and every button, link, and focus ring built on that token updates together, still passing whatever contrast check was run against that role originally.`,
            `A reasonably complete role set covers text (primary, muted, inverse), surface (background, card, overlay), border, and status (action, success, warning, danger) — each with a light-mode value and, where relevant, a separate dark-mode value, each pre-checked against the surfaces it's actually meant to sit on.`,
          ],
        },
        {
          h: "Dark mode is a second palette, not an inverted one",
          body: [
            `Simply inverting or dimming a light palette for dark mode breaks contrast math that was calculated for a specific pair of colors. A light gray that hit 4.5:1 against white can fail badly against a near-black background, and a saturated brand blue that looked crisp on white frequently reads as harsh, or seems to vibrate, against a dark surface.`,
            `Treat dark mode as its own set of token values, checked against its own set of surfaces, not a filter applied to the light set. In practice this usually means desaturating and lightening brand hues slightly for dark backgrounds, and choosing a near-black rather than a pure-black base surface — pure black behind bright text can itself feel harsh and, counterintuitively, can hurt readability compared to a very dark gray.`,
            `Every semantic token from the previous section needs a dark-mode value defined and contrast-checked the same way its light-mode counterpart was — never assumed to inherit acceptable contrast just because the light version happened to pass.`,
          ],
        },
        {
          h: "Auditing a palette you didn't build",
          body: [
            `Given any existing product, list every distinct text-and-background pairing that actually appears on screen — body copy, muted captions, placeholder text, button labels, link text — and run each one through a contrast checker. Anything under 4.5:1 (or 3:1 for genuinely large text) goes on a fix list, sorted by how often that pairing shows up across the product.`,
            `Next, check every interactive element's border and focus indicator against its background at 3:1. Focus indicators deserve extra attention here: they're the pairing most likely to have been styled once, early, and never revisited, even as the surrounding palette kept changing around them.`,
            `Finally, find anywhere meaning is carried by color alone — status dots, chart lines, form validation states — and confirm each one has a second, non-color signal. A spacing audit tends to surface accidental inconsistency; a contrast audit tends to surface accidental exclusion, which is a different kind of bug, but just as real.`,
          ],
        },
        {
          h: "Where this leads next",
          body: [
            `Contrast is a useful entry point into color for the same reason whitespace is a useful entry point into layout: it replaces a purely aesthetic judgment with a number anyone can check, which makes it possible to actually get better at the skill instead of just developing more confident taste.`,
            `Once contrast ratios and semantic tokens feel automatic, the rest of color theory — hue relationships, saturation, the emotional weight of a palette — becomes something layered on top of a system that already passes its basic checks, rather than a replacement for checking at all. The wheel is still worth learning. It's just not where the guarantees come from.`,
          ],
        },
      ],
      takeaways: [
        "Contrast ratio is a calculable number derived from relative luminance, not a subjective read — WCAG defines exactly how to compute it.",
        "Meet at least 4.5:1 for normal text and 3:1 for large text (18px/24px+ regular, or 14pt/~18.5px+ bold) at Level AA.",
        "UI components and borders — inputs, buttons, focus indicators — need 3:1 too, under WCAG's separate non-text contrast rule.",
        "Never let color alone carry meaning: roughly 1 in 12 men has some color vision deficiency, so every color-coded state needs a second signal — icon, label, or pattern.",
        "Build a numbered shade scale (e.g. 50–900) per hue, plus a separate neutral/gray scale, instead of picking colors one at a time.",
        "Name colors by role (action, danger, text-muted) instead of by hex value, and give dark mode its own contrast-checked token values rather than inverting the light palette.",
      ],
    },

    "type-scale-systems": {
      dek: `Font size is usually the last thing anyone actually systemizes — a modular scale, paired with the line-height and measure rules that govern real readability, turns picking a size into a lookup instead of a guess.`,
      sections: [
        {
          h: "Why a type scale is the right place to start",
          body: [
            `Most people treat font size as a series of independent decisions — this heading looks about right at 28px, that caption feels fine at 12px — chosen one at a time by eye, the same way ad-hoc spacing values get chosen one at a time by eye. The result is the same problem too: a page full of sizes that don't relate to each other in any way a person, or a stylesheet, can predict.`,
            `A type scale replaces that guessing with a formula: pick one base size and one ratio, and every other size on the page is derived from those two numbers instead of invented separately. Two designers working from the same base and ratio produce identical scales without ever comparing notes — the same property that made whitespace and contrast worth learning first. The answer is checkable, not just defensible.`,
          ],
        },
        {
          h: "What a modular scale actually is",
          body: [
            `A modular scale multiplies a base size by a fixed ratio, once per step: size = base × ratio^n. Starting from a 16px base and a 1.25 ratio, the next step up is 16 × 1.25 = 20px, then 20 × 1.25 = 25px, then roughly 31px, and so on in both directions — down toward small caption sizes as well as up toward display headings.`,
            `The ratios most type-scale tools ship with by default are small, named intervals borrowed from music theory: 1.125 ("major second"), 1.25 ("major third"), 1.333 ("perfect fourth"), and 1.618 (the golden ratio) are the four worth knowing. A smaller ratio produces a tighter, more subtle scale suited to dense interfaces; a larger ratio produces more dramatic jumps suited to editorial or marketing pages where a heading needs to command real visual weight.`,
          ],
        },
        {
          h: "Picking a base size and a ratio",
          body: [
            `16px is the de facto standard base size for body text on the web — it's the default a browser applies with no CSS at all, and dropping below it on any real block of reading text makes a page measurably harder to read for most people, not just those with low vision. Treat 16px as a floor for body copy, not a starting point to shrink from when a layout feels crowded.`,
            `On mobile specifically, 16px isn't just a readability preference: iOS Safari automatically zooms the viewport when a tapped input's font size is smaller than 16px, an easy bug to introduce by accident on a form field and one worth checking for directly, since the zoom itself often gets blamed on something else during QA.`,
            `Ratio choice should track content density the same way a spacing scale's density tracks its interface: a tight ratio like 1.125 or 1.2 suits data-dense dashboards and admin tools, where too many competing sizes on one screen creates noise; a looser ratio like 1.5 or 1.618 suits marketing pages and long-form articles, where a heading is meant to dominate the page it sits on.`,
          ],
        },
        {
          h: "Line-height belongs to the scale, not to taste",
          body: [
            `Line-height needs its own rule, and it moves in the opposite direction from font size: as text gets larger, it needs proportionally less line-height, not more. Body copy at 16px typically wants a line-height around 1.5–1.6 times its font size; a 48px display heading at that same 1.5 ratio would leave enormous, awkward gaps between lines that a reader never asked for.`,
            `A practical rule holds across most scales: tighten line-height as size increases — roughly 1.1–1.3 for large display headings, 1.3–1.4 for subheadings, and 1.5–1.6 for body text and captions. Treat line-height as a second column on the same scale table as font size, not a value chosen separately for each new component that happens to need text.`,
            `This isn't only an aesthetic default. WCAG's text-spacing criterion specifically expects line-height to reach at least 1.5 times the font size for body text without breaking the layout, on the reasoning that many users with low vision or reading disabilities rely on browser or assistive-technology settings to force exactly that spacing.`,
          ],
        },
        {
          h: "Measure: the line length nobody sets on purpose",
          body: [
            `Measure is the line length of a paragraph, and it's one of the most consistently under-designed properties on the web, because unlike font size or color, nothing renders visibly wrong when it's ignored — a paragraph that stretches the full width of a wide browser window doesn't throw an error, it just becomes measurably harder to track from the end of one line to the start of the next.`,
            `The commonly cited comfortable range is 45 to 75 characters per line, with roughly 66 characters treated as the sweet spot for sustained reading — a range that traces back to classic print typography and holds up consistently in web-readability research. In practical CSS terms this usually lands around a max-width of 60–75ch on a body-copy container, not a fixed pixel width that stops working the moment the font size or the viewport changes.`,
            `Below that range, eyes bounce line to line too often and reading feels choppy; above it, especially past 90–100 characters, a reader's eye can lose its place finding the start of the next line — a problem that gets measurably worse at wide desktop widths, where a single unconstrained paragraph can run past 120 characters per line.`,
          ],
        },
        {
          h: "Fluid type: scaling without breakpoints",
          body: [
            `A traditional responsive approach sets a handful of fixed sizes and swaps between them at breakpoints, which means a heading is 32px right up until a 768px breakpoint and instantly 24px one pixel below it. Fluid type replaces those hard jumps with a formula that scales continuously between a minimum and a maximum, using CSS's clamp() function: clamp(minimum, preferred, maximum).`,
            `A typical fluid heading declaration looks like font-size: clamp(1.5rem, 1.2rem + 2vw, 3rem) — never smaller than 1.5rem, never larger than 3rem, and smoothly interpolated between those bounds based on viewport width in between. The result is a heading that resizes at exactly the same rate the browser window does, with no visible jump at any particular width and no breakpoint to maintain as new screen sizes show up.`,
            `Apply clamp() to a handful of key sizes — the largest headings and hero text see the most benefit — rather than to every step of the scale; body text at 16px rarely needs to grow much across viewports, and forcing it to flex adds complexity without a real readability gain.`,
          ],
        },
        {
          h: "Naming the scale and pairing typefaces",
          body: [
            `Give each step a name instead of writing raw rem or pixel values into code: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl, and so on, each mapped to one value from the scale. That turns "what size is this" into a lookup from a short list — the same discipline a named spacing scale brings to gaps and padding.`,
            `One well-made typeface is enough for most interfaces; two is the practical ceiling for almost everyone else — a body typeface and a distinct display or heading typeface, chosen for contrast rather than similarity. Pairing a serif display face with a sans body face, or a geometric sans with a humanist one, reads as an intentional choice; pairing two similar-but-not-identical sans faces usually just reads as a mistake.`,
            `If code or data needs its own treatment, a monospace typeface is worth adding as a third, clearly scoped exception — never as a stylistic alternative to the body face, only for the specific job, like code or tabular numbers, that a fixed-width face is actually good at.`,
          ],
        },
        {
          h: "Accessibility minimums text needs to clear",
          body: [
            `WCAG's resize-text criterion requires that text can be scaled up to 200% by a user, using nothing but standard browser zoom, without losing content or breaking functionality — a requirement that quietly rules out fixed-height containers with overflow hidden wrapped around anything that holds real text.`,
            `A separate text-spacing criterion sets minimums a user must be able to apply on top of a site's own styles without anything breaking: line-height at least 1.5 times the font size, space after paragraphs at least 2 times the font size, letter spacing at least 0.12 times the font size, and word spacing at least 0.16 times the font size. Designing to these ratios as defaults, rather than treating them as an edge case a user might force later, means a site already passes before anyone overrides anything.`,
            `A few more minimums round this out: never disable pinch-to-zoom with user-scalable=no in a viewport meta tag, avoid justified text on the web (variable-width justification produces uneven word gaps that particularly hurt readers with dyslexia), and use all-caps sparingly on anything longer than a short label — long stretches of capital letters remove the word-shape cues a reader normally relies on and measurably slow reading speed.`,
          ],
        },
        {
          h: "Auditing type on a screen you didn't design",
          body: [
            `Pick any existing screen and list every distinct font size actually in use. If that list has no relationship to a consistent ratio — 13px next to 15px next to 22px, none of them derived from the others — the sizes were picked by eye during a rushed handoff, the same way an unaudited spacing scale usually was.`,
            `Check line-height next: does it get tighter as size increases, or is one value applied everywhere regardless of size? A uniform line-height across headings and body text is one of the fastest tells that leading was never actually designed, just left at a framework's default.`,
            `Finally, measure actual line length on the widest body-text container on the page. Anything reliably running past 90–100 characters per line on a standard desktop viewport is a real readability bug, not a stylistic choice, and usually the cheapest fix on the entire list — a single max-width change on one container, rather than a full pass through the type scale.`,
          ],
        },
        {
          h: "Where this leads next",
          body: [
            `A type scale is worth learning early for the same reason whitespace and contrast are: it replaces a size-by-size guess with a formula that produces every other value on the page automatically, and that formula is exactly as checkable as a contrast ratio or a spacing token — a size either belongs to the scale or it doesn't.`,
            `Once base, ratio, line-height, and measure feel automatic, the remaining craft of typography — voice, texture, the specific character of a typeface — sits on top of a system that already gets the mechanics right, rather than trying to compensate for a page where nothing was actually decided on purpose.`,
          ],
        },
      ],
      takeaways: [
        "A modular scale derives every size from one formula — size = base × ratio^n — instead of picking each size independently.",
        "Keep 16px as the floor for body text; smaller triggers real readability problems and, on iOS, an unwanted zoom on tap.",
        "Line-height moves opposite to size: roughly 1.1–1.3 for large headings, 1.5–1.6 for body text, following WCAG's text-spacing minimums.",
        "Keep body-text measure in the 45–75 character range (around 66 is ideal) — usually a 60–75ch max-width, not a fixed pixel value.",
        "Use CSS clamp() for fluid type on key headings so size interpolates smoothly across viewport widths instead of jumping at breakpoints.",
        "Name scale steps as tokens (text-xs…text-3xl) and limit a UI to two typefaces chosen for contrast, plus an optional monospace for code.",
      ],
    },
  };

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
    Object.keys(CATEGORIES).forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = CATEGORIES[key].label;
      categorySelect.appendChild(opt);
    });
    document.getElementById("stat-count").textContent = GUIDES.length;

    var footerList = document.getElementById("footer-categories");
    Object.keys(CATEGORIES)
      .slice(0, 6)
      .forEach(function (key) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = "#toolbar";
        a.textContent = CATEGORIES[key].label;
        a.setAttribute("data-jump-category", key);
        li.appendChild(a);
        footerList.appendChild(li);
      });
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

  function heroHtml(g) {
    var cat = CATEGORIES[g.category];
    return (
      '<div class="article-hero">' +
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
      '<a class="btn btn-card" href="#/guide/' +
      g.id +
      '">Read guide <span aria-hidden="true">→</span></a>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function render() {
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
    if (pageView.hidden) return;
    pageView.hidden = true;
    pageViewBody.innerHTML = "";
    homeView.hidden = false;
    document.title = DEFAULT_TITLE;
  }

  function articleHtml(guide, article) {
    var cat = CATEGORIES[guide.category];
    var sectionsHtml = article.sections
      .map(function (s) {
        var paras = s.body
          .map(function (p) {
            return "<p>" + escapeHtml(p) + "</p>";
          })
          .join("");
        return "<h3>" + escapeHtml(s.h) + "</h3>" + paras;
      })
      .join("");
    var takeawaysHtml = article.takeaways
      .map(function (t) {
        return "<li>" + escapeHtml(t) + "</li>";
      })
      .join("");
    return (
      '<div class="article-eyebrow">' +
      '<span class="badge">' +
      cat.code +
      "</span>" +
      '<span class="card-meta mono">' +
      LEVEL_ABBR[guide.level] +
      " · " +
      guide.readTime +
      " MIN READ</span>" +
      "</div>" +
      '<h2 class="article-title">' +
      escapeHtml(guide.title) +
      "</h2>" +
      heroHtml(guide) +
      '<p class="article-dek">' +
      escapeHtml(article.dek) +
      "</p>" +
      '<div class="article-body">' +
      sectionsHtml +
      "</div>" +
      '<div class="takeaways">' +
      '<span class="section-label mono">// key_takeaways</span>' +
      "<ul>" +
      takeawaysHtml +
      "</ul>" +
      "</div>" +
      '<a href="#" class="btn btn-primary back-to-guides">← Back to guides</a>'
    );
  }

  function legalHtml(page) {
    var updatedHtml = page.updated
      ? '<p class="legal-updated mono">' +
        escapeHtml(page.updated) +
        "</p>"
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

  function initContactForm() {
    var form = document.getElementById("contact-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nameEl = document.getElementById("contact-name");
      var errorEl = document.getElementById("contact-form-error");
      if (!form.checkValidity()) {
        errorEl.textContent =
          "Please fill in your name, a valid email, and a message before sending.";
        form.reportValidity();
        return;
      }
      errorEl.textContent = "";
      var firstName =
        (nameEl.value || "").trim().split(" ")[0] || "there";
      var wrap = document.getElementById("contact-form-wrap");
      wrap.innerHTML =
        '<div class="form-success">' +
        "<strong>Message received.</strong>" +
        "<p>Thanks, " +
        escapeHtml(firstName) +
        " — this confirmation is part of the front-end template. Connect this form's submit handler to your own backend, or a service like Formspree, to actually deliver messages to your inbox.</p>" +
        "</div>";
    });
  }

  function renderGuideRoute(id) {
    var guide = null;
    for (var i = 0; i < GUIDES.length; i++) {
      if (GUIDES[i].id === id) {
        guide = GUIDES[i];
        break;
      }
    }
    var article = ARTICLES[id];
    if (!guide || !article) {
      showHome();
      return;
    }
    document.title = guide.title + " — " + DEFAULT_TITLE;
    showPage(articleHtml(guide, article));
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

  function handleRoute() {
    var hash = location.hash;
    var guideMatch = hash.match(/^#\/guide\/([\w-]+)$/);
    if (guideMatch) {
      renderGuideRoute(guideMatch[1]);
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
  document.addEventListener("click", function (e) {
    var jumpLink = e.target.closest("[data-jump-category]");
    if (jumpLink) {
      e.preventDefault();
      categorySelect.value = jumpLink.getAttribute("data-jump-category");
      state.category = categorySelect.value;
      render();
      document
        .getElementById("toolbar")
        .scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  });

  // --- Header quick search ---
  // The form works with no JS at all: its native GET to index.html?q=...
  // is a real navigation that lands here from any page. This handler
  // just upgrades that same action to filter in place when we're
  // already on index.html, instead of doing a full page reload.
  var headerSearchForm = document.querySelector(".header-search");
  var headerSearchInput = document.getElementById("header-search-input");

  function runHeaderSearch(query) {
    state.search = query;
    searchInput.value = query;
    if (headerSearchInput) headerSearchInput.value = query;
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

  if (headerSearchForm) {
    headerSearchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      runHeaderSearch((headerSearchInput.value || "").trim());
    });
  }

  // ---------- data loading ----------
  // Guide data lives in guides.json, fetched here with async/await
  // instead of being hardcoded in this file. Everything that depends
  // on GUIDES (rendering, search, filtering, routing) waits for this
  // fetch to resolve before it runs for the first time.
  async function loadGuides() {
    const response = await fetch("guides.json");
    if (!response.ok) {
      throw new Error(
        "Failed to load guides.json (HTTP " + response.status + ")"
      );
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("guides.json did not contain an array");
    }
    return data;
  }

  function renderLoadError() {
    gridRoot.innerHTML = "";
    resultsCount.textContent = "Couldn't load guides.";
    emptyState.setAttribute("data-visible", "true");
    emptyQuery.textContent =
      "a problem loading guides.json — check the console and try refreshing";
  }

  async function init() {
    resultsCount.textContent = "Loading guides…";
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

    // Arriving from another page's header search (e.g. contact.html ->
    // index.html?q=spacing#guides): pick the term back up and filter.
    var initialQuery = new URLSearchParams(location.search).get("q");
    if (initialQuery) {
      runHeaderSearch(initialQuery);
    }
  }

  init();
})();
