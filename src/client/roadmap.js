/**
 * roadmap.js — Learning Roadmap progress: the states on roadmap.html and
 * "Mark as read" on the guides that are on the roadmap.
 * -----------------------------------------------------------------------
 * PHASE 3 bundle fragment — see the header of core.js for what that means.
 * Runs in core.js's scope and depends on it for showToast (roadmap.html's
 * Reset only: three roadmap guides ship without the toast container, so
 * nothing here calls it on a guide page).
 *
 * Self-contained apart from that: it is a named IIFE that no-ops on every
 * page with neither a .roadmap-track nor a .guide-roadmap strip, and it
 * never waits on guides.json.
 * -----------------------------------------------------------------------
 */

  // ---------- roadmap progress ----------
  // The roadmap itself (stage/step markup) lives on its own page,
  // roadmap.html, and is fully pre-rendered at build time — see
  // src/build/home.js's buildRoadmap(). Nothing here builds or filters
  // that markup, or waits on loadGuides(); it only layers progress on top
  // of the static HTML that's already in the DOM, persisting it to
  // localStorage per browser (no accounts: this is not account Saved, see
  // docs/SAVED.md).
  //
  // WHAT IS STORED: one array of guide ids, the guides marked as read.
  // Everything shown is worked out from it on each paint:
  //   Read        the guide's id is in the array
  //   Next up     the first guide, in the page's own order, that isn't read
  //   Upcoming    every other unread guide
  //   a stage     complete once all of its guides are read
  // An id that is on no step (a guide since taken off the roadmap) stays
  // in storage and counts for nothing.
  //
  // THE ORDER is the order roadmap.html lists the guides in, read off its
  // markup. Nothing here sorts guides or keeps a list of its own. A guide
  // page needs no order at all: its previous and next links are in its
  // HTML, and its id is its own <body data-guide-id>.
  //
  // TWO SURFACES, found by their markup rather than by URL:
  //   .roadmap-track   roadmap.html — the checkboxes, the stage counts,
  //                    the Continue link and the progress summary
  //   .guide-roadmap   a guide that is on the roadmap (the build writes
  //                    that strip on those pages only) — the completion
  //                    block drawn above its previous/next links
  // Every other page has neither and nothing below runs.
  (function initRoadmapProgress() {
    var track = document.querySelector(".roadmap-track");
    var guideStrip = document.querySelector(".guide-roadmap");
    if (!track && !guideStrip) return;

    var STORAGE_KEY = "point-roadmap-progress";

    // What storage holds now: the ids, [] when there is nothing usable
    // (no value yet, or one that isn't a JSON array), or null when storage
    // can't be read at all (private browsing, site data blocked).
    function readStored() {
      var raw;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (err) {
        return null;
      }
      var parsed;
      try {
        parsed = JSON.parse(raw || "[]");
      } catch (err) {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (id) {
        return typeof id === "string";
      });
    }

    function writeStored(ids) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      } catch (err) {
        // Private browsing / storage disabled: the controls still work
        // for this page view, they just won't persist on reload.
      }
    }

    var done = readStored() || [];

    function isRead(id) {
      return done.indexOf(id) !== -1;
    }

    // Every write starts from what storage holds at that moment, not from
    // what this page read when it loaded, so a tab left open can't undo
    // what another tab has marked since. With storage unreadable, the
    // page's own copy is all there is.
    function change(apply) {
      var current = readStored();
      done = apply(current === null ? done.slice() : current);
      writeStored(done);
    }

    function setRead(id, read) {
      change(function (ids) {
        if (read) {
          if (ids.indexOf(id) === -1) ids.push(id);
          return ids;
        }
        return ids.filter(function (other) {
          return other !== id;
        });
      });
    }

    // Hiding the element that holds keyboard focus would drop focus to the
    // top of the page. It is left as it is until focus has moved on; its
    // blur handler then paints again.
    function setHidden(el, hide) {
      if (hide && document.activeElement === el) return;
      el.hidden = hide;
    }

    // ---------- roadmap.html ----------
    function initRoadmap() {
      var checkboxes = Array.prototype.slice.call(
        track.querySelectorAll(".roadmap-step-checkbox"),
      );
      var stages = Array.prototype.slice.call(
        track.querySelectorAll(".roadmap-stage"),
      );
      var progressFill = document.getElementById("roadmap-progress-fill");
      var progressLabel = document.getElementById("roadmap-progress-label");
      var continueLink = document.getElementById("roadmap-continue");
      var status = document.getElementById("roadmap-status");
      var resetBtn = document.getElementById("roadmap-reset");
      var total = checkboxes.length;

      // Returns how many guides are read.
      function paint() {
        var completed = 0;
        var next = null;

        checkboxes.forEach(function (cb) {
          var read = isRead(cb.getAttribute("data-roadmap-id"));
          cb.checked = read;
          if (read) completed++;

          var step = cb.closest(".roadmap-step");
          if (!step) return;
          var isNext = !read && !next;
          if (isNext) next = step;
          step.classList.toggle("is-complete", read);
          step.classList.toggle("is-next", isNext);

          var link = step.querySelector(".roadmap-step-link");
          if (link) {
            if (isNext) link.setAttribute("aria-current", "step");
            else link.removeAttribute("aria-current");
          }
          var state = step.querySelector(".roadmap-step-state");
          if (state) {
            state.textContent = read ? "Read" : isNext ? "Next up" : "";
          }
        });

        stages.forEach(function (stageEl) {
          var boxes = stageEl.querySelectorAll(".roadmap-step-checkbox");
          var read = Array.prototype.filter.call(boxes, function (cb) {
            return cb.checked;
          }).length;
          var complete = boxes.length > 0 && read === boxes.length;
          stageEl.classList.toggle("is-complete", complete);
          var count = stageEl.querySelector(".roadmap-stage-count");
          if (count) {
            count.textContent =
              read +
              " of " +
              boxes.length +
              " read" +
              (complete ? " · Complete" : "");
          }
        });

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

        // Continue: the Next up guide, by its own link and title.
        if (continueLink) {
          var nextLink = next && next.querySelector(".roadmap-step-link");
          var nextTitle = next && next.querySelector(".roadmap-step-title");
          if (nextLink && nextTitle) {
            continueLink.setAttribute("href", nextLink.getAttribute("href"));
            continueLink.textContent =
              "Continue: " + nextTitle.textContent.replace(/\s+/g, " ").trim();
            continueLink.hidden = false;
          } else {
            setHidden(continueLink, true);
          }
        }
        if (resetBtn) setHidden(resetBtn, completed === 0);

        return completed;
      }

      track.addEventListener("change", function (e) {
        var cb = e.target;
        if (!cb.classList || !cb.classList.contains("roadmap-step-checkbox"))
          return;
        var read = cb.checked;
        setRead(cb.getAttribute("data-roadmap-id"), read);
        var completed = paint();
        // Said once, here only: a paint that follows another tab's change
        // says nothing.
        if (status) {
          status.textContent =
            (read ? "Marked as read. " : "Marked as unread. ") +
            completed +
            " of " +
            total +
            " guides read.";
        }
      });

      if (continueLink) continueLink.addEventListener("blur", paint);

      if (resetBtn) {
        resetBtn.addEventListener("blur", paint);
        resetBtn.addEventListener("click", function () {
          change(function () {
            return [];
          });
          paint();
          resetBtn.hidden = true;
          // The toast is the announcement; the status line would say it twice.
          if (status) status.textContent = "";
          showToast("Roadmap progress reset.");
        });
      }

      return paint;
    }

    // ---------- a guide that is on the roadmap ----------
    // The completion block is drawn here rather than shipped in the page's
    // HTML: without this script it could do nothing, and the page's
    // previous and next links work either way. "Read" is also shown in the
    // roadmap strip under the hero, for a reader coming back to the guide.
    function initGuide() {
      var id = document.body.getAttribute("data-guide-id");
      var footerNav = document.querySelector(".guide-footer-nav");
      if (!id || !footerNav) return null;

      var check =
        '<svg viewBox="0 0 12 10" aria-hidden="true" focusable="false"><path d="M1 5.2L4.4 8.6L11 1.4"/></svg>';
      guideStrip.insertAdjacentHTML(
        "beforeend",
        '<span class="guide-roadmap__state" hidden>' + check + "Read</span>",
      );
      // The button comes first and "Read" after it, so the button is in the
      // same place read or unread: it must not move from under the pointer
      // or the finger that just pressed it.
      footerNav.insertAdjacentHTML(
        "beforebegin",
        '<div class="guide-complete">' +
          '<button type="button" class="btn btn-primary guide-complete__btn">Mark as read</button>' +
          '<p class="guide-complete__state" hidden>' +
          check +
          "Read</p>" +
          '<p class="sr-only guide-complete__status" role="status"></p>' +
          "</div>",
      );

      var stripState = guideStrip.querySelector(".guide-roadmap__state");
      var block = document.querySelector(".guide-complete");
      if (!stripState || !block) return null;
      var blockState = block.querySelector(".guide-complete__state");
      var button = block.querySelector(".guide-complete__btn");
      var status = block.querySelector(".guide-complete__status");

      function paint() {
        var read = isRead(id);
        block.classList.toggle("is-read", read);
        stripState.hidden = !read;
        blockState.hidden = !read;
        // The button says what pressing it does; the state is the "Read"
        // after it. It is the same element throughout, so it keeps focus.
        button.textContent = read ? "Mark as unread" : "Mark as read";
      }

      button.addEventListener("click", function () {
        var read = !isRead(id);
        setRead(id, read);
        paint();
        status.textContent = read ? "Marked as read." : "Marked as unread.";
      });

      return paint;
    }

    var paint = track ? initRoadmap() : initGuide();
    if (!paint) return;
    paint();

    // ---------- other tabs, and coming back to the page ----------
    // Another tab's change arrives as a storage event (key null: the
    // site's storage was cleared). A page restored from the back/forward
    // cache gets none for what changed while it was away — marking a guide
    // read, then going Back to the roadmap — so it reads storage again
    // when shown. Both only repaint: nothing is written back, announced
    // or toasted, and focus stays where it is.
    function repaintFromStorage() {
      var stored = readStored();
      if (stored !== null) done = stored;
      paint();
    }
    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE_KEY || e.key === null) repaintFromStorage();
    });
    window.addEventListener("pageshow", function (e) {
      if (e.persisted) repaintFromStorage();
    });
  })();
