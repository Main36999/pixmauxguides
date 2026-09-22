/**
 * roadmap.js — "mark as read" progress on roadmap.html.
 * -----------------------------------------------------------------------
 * PHASE 3 bundle fragment — see the header of core.js for what that means.
 * Runs in core.js's scope and depends on it for showToast.
 *
 * Self-contained apart from that: it is a named IIFE that no-ops on every
 * page without a .roadmap-track, and it never waits on guides.json.
 * -----------------------------------------------------------------------
 */

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
