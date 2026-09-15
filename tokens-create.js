/**
 * tokens-create.js
 * -----------------------------------------------------------------------
 * Page-specific script for /tokens/create — the palette builder (§3.4).
 * Two things happen here that don't happen anywhere else in the feature:
 *
 *   1. A LIVE contrast checker. Every edit to a role's color re-runs
 *      tokens-a11y.js's computeAccessibilityScore() and re-renders the
 *      warning list immediately — this is "math, not taste" made
 *      functional rather than just a guide topic (brief §3.4).
 *   2. Local image color extraction. Nothing is uploaded anywhere: the
 *      chosen file is read with FileReader, drawn to an off-screen
 *      <canvas>, and quantized in-browser (coarse RGB binning) to find
 *      the image's most common colors. See extractColorsFromImage().
 *
 * Depends on tokens-color.js, tokens-a11y.js, tokens-export.js and
 * tokens-shared.js being loaded first (see tokens/create.html).
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  var main = document.getElementById("tokens-content");
  if (!main) return;

  var ROLE_OPTIONS = ["background", "surface", "primary", "secondary", "accent", "text", "border"];
  var MAX_ROLES = 6; // matches the brief's "4-6 color blocks" card spec
  var MIN_ROLES = 2;

  // Starting point mirrors bpozz's own theme, so the builder opens on a
  // real, already-valid palette to edit rather than a blank/confusing
  // state — every one of these five pairings already passes AA.
  var state = {
    roles: [
      { role: "background", hex: "#f5f8fc" },
      { role: "surface", hex: "#ffffff" },
      { role: "primary", hex: "#1d5fd6" },
      { role: "text", hex: "#000000" },
      { role: "border", hex: "#dbe6f7" },
    ],
    extracted: [], // [{hex,h,s,l}], populated by extractColorsFromImage
  };

  // ---- DOM refs -------------------------------------------------------
  var roleRowsEl = document.getElementById("role-rows");
  var addRoleBtn = document.getElementById("add-role-btn");
  var previewEl = document.getElementById("builder-preview");
  var scoreEl = document.getElementById("builder-score");
  var warningsEl = document.getElementById("builder-warnings");
  var dropzone = document.getElementById("dropzone");
  var imageInput = document.getElementById("image-input");
  var extractedPreview = document.getElementById("extracted-preview");
  var extractedSwatches = document.getElementById("extracted-swatches");
  var extractedHint = document.getElementById("extracted-hint");
  var nameInput = document.getElementById("palette-name");
  var saveBtn = document.getElementById("save-palette-btn");
  var stepTabs = document.querySelectorAll(".token-mode-tabs button[data-step]");
  var stepPanels = document.querySelectorAll(".token-builder__step[data-step-panel]");

  // ---- small local color-classification helpers ------------------------
  // Deliberately NOT shared with scripts/generate-palettes.js (Node-only,
  // not shipped to the browser) — this is a much smaller, browser-side
  // version used only to fill in a slug/family/lightness when *saving* a
  // builder palette, using the same BpozzColor.hexToHsl the rest of the
  // feature already relies on.
  function classifyFamily(hex) {
    var c = BpozzColor.hexToHsl(hex);
    if (!c) return "neutral";
    if (c.s < 15) return "neutral";
    return c.h >= 330 || c.h < 90 ? "warm" : "cool";
  }
  function classifyLightness(hex) {
    var c = BpozzColor.hexToHsl(hex);
    return c && c.l >= 50 ? "light" : "dark";
  }
  function slugify(name) {
    return (
      String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "custom-palette"
    );
  }

  // ---- role row editor --------------------------------------------------
  function usedRoles(exceptIndex) {
    return state.roles
      .map(function (r, i) {
        return i === exceptIndex ? null : r.role;
      })
      .filter(Boolean);
  }

  function renderRoleRows() {
    roleRowsEl.innerHTML = state.roles
      .map(function (r, i) {
        var taken = usedRoles(i);
        var options = ROLE_OPTIONS.map(function (opt) {
          var disabled = taken.indexOf(opt) !== -1 && opt !== r.role;
          return (
            '<option value="' +
            opt +
            '"' +
            (opt === r.role ? " selected" : "") +
            (disabled ? " disabled" : "") +
            ">" +
            (BpozzTokens.ROLE_LABEL[opt] || opt) +
            "</option>"
          );
        }).join("");
        var canRemove = state.roles.length > MIN_ROLES;
        return (
          '<div class="token-role-row" data-index="' +
          i +
          '">' +
          '<input type="color" value="' +
          r.hex +
          '" data-field="color" aria-label="' +
          (BpozzTokens.ROLE_LABEL[r.role] || r.role) +
          ' color" />' +
          '<select data-field="role" aria-label="Role name">' +
          options +
          "</select>" +
          '<input type="text" data-field="hex" value="' +
          r.hex +
          '" maxlength="7" aria-label="Hex value" />' +
          '<button type="button" class="token-role-row__remove" data-field="remove" ' +
          (canRemove ? "" : "disabled") +
          ' aria-label="Remove this role">×</button>' +
          "</div>"
        );
      })
      .join("");
    addRoleBtn.disabled = state.roles.length >= MAX_ROLES;
  }

  roleRowsEl.addEventListener("input", function (evt) {
    var row = evt.target.closest(".token-role-row");
    if (!row) return;
    var i = Number(row.getAttribute("data-index"));
    var field = evt.target.getAttribute("data-field");
    if (field === "color") {
      state.roles[i].hex = evt.target.value;
      row.querySelector('[data-field="hex"]').value = evt.target.value;
      updateOutputs();
    } else if (field === "hex") {
      var normalized = BpozzColor.normalizeHex(evt.target.value);
      if (normalized) {
        state.roles[i].hex = normalized;
        row.querySelector('[data-field="color"]').value = normalized;
        updateOutputs();
      }
    }
  });
  roleRowsEl.addEventListener("change", function (evt) {
    var row = evt.target.closest(".token-role-row");
    if (!row) return;
    var i = Number(row.getAttribute("data-index"));
    if (evt.target.getAttribute("data-field") === "role") {
      state.roles[i].role = evt.target.value;
      renderRoleRows();
      updateOutputs();
    }
  });
  roleRowsEl.addEventListener("click", function (evt) {
    if (evt.target.getAttribute("data-field") !== "remove") return;
    var row = evt.target.closest(".token-role-row");
    var i = Number(row.getAttribute("data-index"));
    if (state.roles.length <= MIN_ROLES) return;
    state.roles.splice(i, 1);
    renderRoleRows();
    updateOutputs();
  });
  addRoleBtn.addEventListener("click", function () {
    if (state.roles.length >= MAX_ROLES) return;
    var free = ROLE_OPTIONS.filter(function (opt) {
      return usedRoles(-1).indexOf(opt) === -1;
    });
    var role = free[0] || "accent";
    state.roles.push({ role: role, hex: "#888888" });
    renderRoleRows();
    updateOutputs();
  });

  // ---- live preview + contrast checker -----------------------------------
  function ensurePreviewMarkup() {
    if (previewEl.__built) return;
    previewEl.__built = true;
    previewEl.innerHTML =
      '<div style="font-family:var(--sans);font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.65;margin-bottom:10px;">Preview</div>' +
      '<strong style="display:block;font-size:17px;margin-bottom:6px;">Heading text</strong>' +
      '<p style="font-size:13px;line-height:1.55;margin:0 0 16px;opacity:.85;">Body copy, rendered with your text role on your background role.</p>' +
      '<button type="button" style="background:var(--tok-primary);color:var(--tok-on-primary,#fff);border:0;border-radius:4px;padding:9px 16px;font-size:13px;font-weight:600;cursor:default;">Primary action</button>';
  }

  function updateOutputs() {
    ensurePreviewMarkup();
    previewEl.setAttribute("style", BpozzTokens.cssVarsStyle(state.roles));

    var result = BpozzA11y.computeAccessibilityScore(state.roles);
    if (!result) {
      scoreEl.textContent = "—";
      warningsEl.innerHTML =
        '<div class="guide-callout guide-callout--warning">' +
        '<span class="guide-callout__label">No text role yet</span>' +
        "<p>Add a <code>text</code> role so the checker has something to measure against your background and surface colors.</p>" +
        "</div>";
      return;
    }

    scoreEl.textContent = Math.round(result.score * 100) + "%";
    var failing = result.pairings.filter(function (p) {
      return !p.pass;
    });
    if (!failing.length) {
      warningsEl.innerHTML =
        '<div class="guide-callout guide-callout--success">' +
        '<span class="guide-callout__label">Passing</span>' +
        "<p>Every pairing checked clears its WCAG threshold.</p>" +
        "</div>";
      return;
    }
    warningsEl.innerHTML = failing
      .map(function (p) {
        var need = p.threshold.toFixed(1);
        var what = p.kind === "text" ? "text contrast" : "distinguishability from the page";
        return (
          '<div class="guide-callout guide-callout--danger">' +
          '<span class="guide-callout__label">' +
          BpozzTokens.roleLabel(p.fg) +
          " on " +
          BpozzTokens.roleLabel(p.bg) +
          "</span>" +
          "<p>" +
          p.ratio.toFixed(2) +
          ":1 — needs ≥ " +
          need +
          ":1 for " +
          what +
          ".</p>" +
          "</div>"
        );
      })
      .join("");
  }

  // ---- step tabs (manual / from an image) --------------------------------
  stepTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var step = tab.getAttribute("data-step");
      stepTabs.forEach(function (t) {
        t.setAttribute("aria-pressed", String(t === tab));
      });
      stepPanels.forEach(function (p) {
        p.setAttribute("data-active", String(p.getAttribute("data-step-panel") === step));
      });
    });
  });

  // ---- image color extraction ---------------------------------------------
  // Coarse RGB binning (8 levels/channel = 512 buckets): fast, dependency-
  // free, and good enough to surface an image's dominant colors without a
  // real k-means pass. Skips near-transparent pixels; averages the *actual*
  // pixel values in each bucket (not the bucket's center) so the reported
  // hex is a true average, not a rounded-off approximation.
  function extractColorsFromImage(img) {
    var MAX_DIM = 160;
    var scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    var data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return []; // canvas tainted (cross-origin) — shouldn't happen for a local file, but fail soft
    }

    var BUCKET = 32; // 256/32 = 8 levels per channel
    var buckets = {};
    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3];
      if (a < 128) continue;
      var r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      var key =
        Math.floor(r / BUCKET) + "_" + Math.floor(g / BUCKET) + "_" + Math.floor(b / BUCKET);
      var bucket = buckets[key];
      if (!bucket) {
        bucket = buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
      }
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    }

    var list = Object.keys(buckets).map(function (key) {
      var bucket = buckets[key];
      var rgb = {
        r: Math.round(bucket.r / bucket.count),
        g: Math.round(bucket.g / bucket.count),
        b: Math.round(bucket.b / bucket.count),
      };
      var hex = BpozzColor.rgbToHex(rgb);
      var hsl = BpozzColor.rgbToHsl(rgb);
      return { hex: hex, h: hsl.h, s: hsl.s, l: hsl.l, count: bucket.count };
    });
    list.sort(function (x, y) {
      return y.count - x.count;
    });
    return list.slice(0, 8);
  }

  function renderExtractedSwatches() {
    extractedSwatches.innerHTML = state.extracted
      .map(function (c) {
        return (
          '<button type="button" style="background:' +
          c.hex +
          '" data-hex="' +
          c.hex +
          '" title="' +
          c.hex +
          '" aria-pressed="false" aria-label="Extracted color ' +
          c.hex +
          '"></button>'
        );
      })
      .join("");
    if (state.extracted.length >= 2) {
      extractedHint.innerHTML =
        'Found ' + state.extracted.length + ' dominant colors. ' +
        '<button type="button" class="btn btn-primary" id="auto-assign-btn" style="margin-top:10px;">Auto-assign to roles</button>';
      var btn = document.getElementById("auto-assign-btn");
      if (btn) btn.addEventListener("click", autoAssignFromExtracted);
    } else {
      extractedHint.textContent =
        state.extracted.length === 1
          ? "That image is almost entirely one color — try one with more variation."
          : "";
    }
  }

  // Sorts extracted colors by lightness/saturation and drops them into the
  // six standard roles — a starting point, not a final answer: the role
  // rows above stay fully editable afterward. See the file header note on
  // why this heuristic (rather than click-to-assign) was the pragmatic
  // choice here.
  function autoAssignFromExtracted() {
    var pool = state.extracted.slice();
    if (pool.length < 2) return;
    var byLight = pool.slice().sort(function (a, b) {
      return a.l - b.l;
    });
    var bySat = pool.slice().sort(function (a, b) {
      return b.s - a.s;
    });
    var darkest = byLight[0];
    var lightest = byLight[byLight.length - 1];
    var secondDarkest = byLight[1] || darkest;
    var secondLightest = byLight[byLight.length - 2] || lightest;
    var primary = bySat[0];
    var secondary =
      bySat.find(function (c) {
        return c.hex !== primary.hex;
      }) || bySat[1] || primary;

    state.roles = [
      { role: "background", hex: lightest.hex },
      { role: "surface", hex: secondLightest.hex },
      { role: "primary", hex: primary.hex },
      { role: "secondary", hex: secondary.hex },
      { role: "text", hex: darkest.hex },
      { role: "border", hex: secondDarkest.hex },
    ];
    renderRoleRows();
    updateOutputs();
    // Jump back to the Manual tab so the assigned result — and the now
    // fully-editable role rows — is what the user sees next.
    var manualTab = document.querySelector('.token-mode-tabs button[data-step="manual"]');
    if (manualTab) manualTab.click();
    BpozzTokens.toast("Assigned 6 roles from the image — fine-tune below");
  }

  function handleImageFile(file) {
    if (!file || file.type.indexOf("image/") !== 0) {
      BpozzTokens.toast("That doesn't look like an image file");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      extractedPreview.src = reader.result;
      extractedPreview.style.display = "block";
      var img = new Image();
      img.onload = function () {
        state.extracted = extractColorsFromImage(img);
        renderExtractedSwatches();
      };
      img.src = reader.result;
    };
    reader.onerror = function () {
      BpozzTokens.toast("Couldn't read that file");
    };
    reader.readAsDataURL(file);
  }

  imageInput.addEventListener("change", function () {
    if (imageInput.files && imageInput.files[0]) handleImageFile(imageInput.files[0]);
  });
  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.setAttribute("data-active", "true");
    });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.removeAttribute("data-active");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  // ---- save to collection --------------------------------------------------
  saveBtn.addEventListener("click", function () {
    var name = nameInput.value.trim();
    if (!name) {
      BpozzTokens.toast("Give your palette a name first");
      nameInput.focus();
      return;
    }
    var existingSlugs = BpozzTokens.getCustomPalettes().map(function (p) {
      return p.slug;
    });
    var slug = slugify(name);
    if (existingSlugs.indexOf(slug) !== -1) slug = slug + "-" + Date.now().toString(36);

    var background = state.roles.find(function (r) {
      return r.role === "background";
    });
    var family = classifyFamily(background ? background.hex : state.roles[0].hex);
    var lightness = classifyLightness(background ? background.hex : state.roles[0].hex);
    var result = BpozzA11y.computeAccessibilityScore(state.roles);

    var palette = {
      slug: slug,
      name: name,
      family: family,
      moods: ["custom"],
      lightness: lightness,
      tags: [family, "custom", lightness],
      created_at: new Date().toISOString().slice(0, 10),
      popularity: 0,
      colors: state.roles.map(function (r) {
        return { role: r.role, hex: r.hex };
      }),
      dark_variant_slug: null,
      light_variant_slug: null,
      accessibility_score: result ? Math.round(result.score * 100) / 100 : null,
      contrast_summary: BpozzTokens.contrastSummaryFor({ colors: state.roles }),
      custom: true,
    };
    BpozzTokens.saveCustomPalette(palette);
    BpozzTokens.toast("Saved “" + name + "” to your collection");
    setTimeout(function () {
      window.location.href = "/tokens/collection";
    }, 700);
  });

  renderRoleRows();
  updateOutputs();
})();
