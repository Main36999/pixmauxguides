/**
 * contact.js — the in-app contact form (#/contact).
 * -----------------------------------------------------------------------
 * PHASE 3 bundle fragment — see the header of core.js for what that means.
 * Runs in core.js's scope and depends on it for escapeHtml.
 *
 * This wires up the form markup that PAGES.contact in core.js renders into
 * the SPA view. The standalone contact.html page carries its own copy of
 * both; Phase 3 does not touch it, since folding the two together is page
 * extraction and explicitly out of scope.
 * -----------------------------------------------------------------------
 */

  // Same endpoint used by the standalone contact.html page — keep both
  // in sync if you change it, along with the action attribute on both
  // forms (the no-JS fallback). Sign up free at https://formspree.io,
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
            // role="status" — Phase 4 Step 9 (accessibility). This replaces
            // the whole form, including the button that was just pressed,
            // so a screen-reader user gets no confirmation that anything
            // happened (WCAG 4.1.3). The role is the announcement; the
            // markup, wording and styling are untouched.
            wrap.innerHTML =
              '<div class="form-success" role="status">' +
              "<strong>Message received.</strong>" +
              "<p>Thanks, " +
              escapeHtml(firstName) +
              " — we've got your message and will get back to you within two business days.</p>" +
              "</div>";
            return;
          }
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (data) {
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
          // A TypeError is fetch() itself failing (offline, blocked) — its
          // message ("Failed to fetch") means nothing to a visitor.
          errorEl.textContent =
            (err && !(err instanceof TypeError) && err.message) ||
            "Something went wrong while sending your message. Please try again or email us directly.";
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        });
    });
  }
