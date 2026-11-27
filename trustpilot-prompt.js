/**
 * ExamPilot — Trustpilot Review Prompt Module
 * File: trustpilot-prompt.js
 *
 * Displays a polite, mobile-friendly Trustpilot review invitation to authenticated
 * students after verified usage, respecting cooldown intervals and active protected
 * student activities.
 */

(function () {
  "use strict";

  // Prevent multiple initializations
  if (window.ExamPilotTrustpilotLoaded) {
    return;
  }
  window.ExamPilotTrustpilotLoaded = true;

  var REVIEW_URL = "https://www.trustpilot.com/evaluate/exampilot.com.ng";
  var STORAGE_PREFIX = "ep_tp_review_";
  var COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours
  var MIN_HISTORY_AGE_MS = 72 * 60 * 60 * 1000; // 3 days since first recorded active session
  var MIN_COMPLETED_SESSIONS = 2; // At least 2 completed practice/CBT tests
  var INITIAL_DELAY_MS = 9000; // ~8–10 seconds after student load
  var RETRY_DELAY_MS = 15000; // Delay to recheck if a protected modal was active

  var activeUserId = null;
  var modalBackdrop = null;
  var currentStep = 1; // 1 = invite, 2 = confirm
  var checkTimer = null;

  /* -------------------------------------------------------------------------
   * Storage helpers (scoped per authenticated student userId)
   * ------------------------------------------------------------------------- */

  function getStorage(userId) {
    try {
      if (typeof window === "undefined" || !window.localStorage || !userId) {
        return null;
      }
      var raw = window.localStorage.getItem(STORAGE_PREFIX + userId);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (error) {
      console.warn("ExamPilot Trustpilot: storage read error", error);
      return null;
    }
  }

  function setStorage(userId, data) {
    try {
      if (typeof window === "undefined" || !window.localStorage || !userId) {
        return false;
      }
      window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(data));
      return true;
    } catch (error) {
      console.warn("ExamPilot Trustpilot: storage write error", error);
      return false;
    }
  }

  /* -------------------------------------------------------------------------
   * Verification of completed sessions from jambResults
   * ------------------------------------------------------------------------- */

  function getCompletedSessions(userId) {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return [];
      }
      var raw = window.localStorage.getItem("jambResults");
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];

      return list.filter(function (item) {
        if (!item || typeof item !== "object") return false;
        // User identity check: strictly matches current authenticated student ID
        var userMatches = Boolean(item.userId) && String(item.userId) === String(userId);
        // Genuinely completed validation
        var hasQuestions = typeof item.total === "number" && item.total > 0;
        var hasScore = typeof item.score === "number" && item.score >= 0;
        var hasTimestamp = Boolean(item.date || item.id);
        return userMatches && hasQuestions && hasScore && hasTimestamp;
      });
    } catch (error) {
      console.warn("ExamPilot Trustpilot: jambResults read error", error);
      return [];
    }
  }

  function getEarliestSessionTimestamp(completedSessions) {
    var earliest = Infinity;
    var now = Date.now();
    for (var i = 0; i < completedSessions.length; i++) {
      var item = completedSessions[i];
      var itemTime = NaN;
      if (item.date) {
        itemTime = Date.parse(item.date);
      }
      if (Number.isNaN(itemTime) && typeof item.id === "number") {
        itemTime = item.id;
      }
      if (Number.isFinite(itemTime) && itemTime > 0 && itemTime <= now && itemTime < earliest) {
        earliest = itemTime;
      }
    }
    return earliest === Infinity ? null : earliest;
  }

  /* -------------------------------------------------------------------------
   * Protected activities detection
   * ------------------------------------------------------------------------- */

  function isProtectedActivityActive() {
    // 1. Path safety: never run on active examination or authentication pages
    var path = (window.location.pathname || "").toLowerCase();
    if (path.indexOf("cbt.html") !== -1 || path.indexOf("student.html") !== -1) {
      return true;
    }

    // 2. Subscription modal is open
    var subModal = document.getElementById("subscriptionModal");
    if (
      subModal &&
      (subModal.classList.contains("show") ||
        subModal.getAttribute("aria-hidden") === "false" ||
        subModal.style.display === "flex")
    ) {
      return true;
    }

    // 3. Notifications modal is open
    var notifModal = document.getElementById("notificationsModal");
    if (
      notifModal &&
      (notifModal.classList.contains("show") ||
        notifModal.getAttribute("aria-hidden") === "false" ||
        notifModal.style.display === "flex")
    ) {
      return true;
    }

    // 4. AI Tutor modal is open
    var aiModal = document.querySelector(".ep-ai-backdrop.is-open");
    if (aiModal) {
      return true;
    }

    // 5. Paystack checkout is in-flight (iframe, overlay, or active loading button)
    var paystackElement = document.querySelector(
      'iframe[src*="paystack"], iframe[name*="paystack"], .paystack-checkout, [class*="paystack-overlay"]'
    );
    if (paystackElement) {
      return true;
    }

    var busyPayButton = document.querySelector(".subscription-pay-button:disabled");
    if (busyPayButton) {
      return true;
    }

    // 6. Active pending Paystack transaction within last 15 minutes
    try {
      var pendingRaw = window.localStorage.getItem("pendingPaystackSubscription");
      if (pendingRaw) {
        var pending = JSON.parse(pendingRaw);
        if (pending && pending.created_at) {
          var age = Date.now() - Date.parse(pending.created_at);
          if (age >= 0 && age < 15 * 60 * 1000) {
            return true;
          }
        }
      }
    } catch (_) {}

    return false;
  }

  /* -------------------------------------------------------------------------
   * Eligibility evaluation
   * ------------------------------------------------------------------------- */

  function evaluateEligibility(userId) {
    if (!userId) return false;

    var record = getStorage(userId);
    var completedSessions = getCompletedSessions(userId);
    var now = Date.now();

    // Initialize record if first time seen
    if (!record) {
      var earliest = getEarliestSessionTimestamp(completedSessions);
      record = {
        firstActiveAt: earliest && earliest < now ? earliest : now,
        lastDismissedAt: null,
        reviewStatus: "pending",
        reviewConfirmedAt: null
      };
      setStorage(userId, record);
    }

    // 1. If student explicitly confirmed submitting a review, permanently stop
    if (record.reviewStatus === "confirmed") {
      return false;
    }

    // 2. Cooldown check: must wait 72 hours after dismissal
    if (typeof record.lastDismissedAt === "number" && Number.isFinite(record.lastDismissedAt)) {
      if (record.lastDismissedAt > now) {
        // Clock skew correction
        record.lastDismissedAt = now;
        setStorage(userId, record);
      }
      var elapsedSinceDismiss = now - record.lastDismissedAt;
      if (elapsedSinceDismiss < COOLDOWN_MS) {
        return false;
      }
    }

    // 3. Must have at least 3 days (72 hours) of usage history
    var firstActive = Number(record.firstActiveAt);
    if (!Number.isFinite(firstActive) || now - firstActive < MIN_HISTORY_AGE_MS) {
      return false;
    }

    // 4. Must have at least 2 genuinely completed practice tests or CBT sessions
    if (completedSessions.length < MIN_COMPLETED_SESSIONS) {
      return false;
    }

    return true;
  }

  /* -------------------------------------------------------------------------
   * UI Style Injection
   * ------------------------------------------------------------------------- */

  function ensureStyles() {
    if (document.getElementById("ep-tp-styles")) {
      return;
    }
    var style = document.createElement("style");
    style.id = "ep-tp-styles";
    style.textContent =
      ".ep-tp-backdrop{" +
      "position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;" +
      "padding:16px;background:rgba(18,48,37,0.48);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
      "opacity:0;pointer-events:none;transition:opacity .25s ease;box-sizing:border-box" +
      "}" +
      ".ep-tp-backdrop.ep-tp-is-open{" +
      "opacity:1;pointer-events:auto" +
      "}" +
      ".ep-tp-card{" +
      "position:relative;width:100%;max-width:440px;background:#ffffff;border:1px solid #d8e5dd;" +
      "border-radius:20px;box-shadow:0 16px 40px rgba(0,73,45,.16);padding:24px 22px 20px;" +
      "box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#123025;" +
      "transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(0.16,1,0.3,1);" +
      "max-height:90vh;overflow-y:auto" +
      "}" +
      ".ep-tp-backdrop.ep-tp-is-open .ep-tp-card{" +
      "transform:translateY(0) scale(1)" +
      "}" +
      ".ep-tp-close{" +
      "position:absolute;top:14px;right:14px;width:44px;height:44px;min-width:44px;min-height:44px;" +
      "display:flex;align-items:center;justify-content:center;background:#f0f5f2;border:0;border-radius:50%;" +
      "color:#5c6d65;font-size:24px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease" +
      "}" +
      ".ep-tp-close:hover{" +
      "background:#e2ebe6;color:#123025" +
      "}" +
      ".ep-tp-badge{" +
      "display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:#edf8f2;" +
      "border:1px solid #c2e2cf;border-radius:999px;color:#006b40;font-size:12px;font-weight:700;margin-bottom:14px" +
      "}" +
      ".ep-tp-badge-star{" +
      "color:#00b67a;font-size:14px" +
      "}" +
      ".ep-tp-title{" +
      "margin:0 0 8px;font-size:19px;line-height:1.3;font-weight:800;color:#004f31;padding-right:36px" +
      "}" +
      ".ep-tp-text{" +
      "margin:0 0 20px;font-size:13.5px;line-height:1.5;color:#5c6d65" +
      "}" +
      ".ep-tp-actions{" +
      "display:flex;flex-direction:column;gap:10px" +
      "}" +
      ".ep-tp-btn{" +
      "width:100%;min-height:48px;padding:12px 18px;border-radius:24px;font-size:14.5px;font-weight:700;" +
      "text-align:center;text-decoration:none;box-sizing:border-box;display:inline-flex;align-items:center;" +
      "justify-content:center;gap:6px;cursor:pointer;border:0;transition:background .15s ease,transform .1s ease" +
      "}" +
      ".ep-tp-btn:focus-visible,.ep-tp-close:focus-visible,.ep-tp-link-btn:focus-visible{" +
      "outline:2px solid #008751;outline-offset:2px" +
      "}" +
      ".ep-tp-btn-primary{" +
      "background:#008751;color:#ffffff;box-shadow:0 4px 14px rgba(0,135,81,.24)" +
      "}" +
      ".ep-tp-btn-primary:hover{" +
      "background:#006b40" +
      "}" +
      ".ep-tp-btn-secondary{" +
      "background:#edf8f2;color:#004f31;border:1px solid #d0e4d7" +
      "}" +
      ".ep-tp-btn-secondary:hover{" +
      "background:#e0f2e7" +
      "}" +
      ".ep-tp-link-btn{" +
      "background:transparent;border:0;color:#64736d;font-size:12.5px;text-decoration:underline;" +
      "cursor:pointer;padding:8px 12px;min-height:44px;display:inline-flex;align-items:center;justify-content:center" +
      "}" +
      ".ep-tp-link-btn:hover{" +
      "color:#004f31" +
      "}" +
      ".ep-tp-subfoot{" +
      "margin-top:10px;text-align:center" +
      "}" +
      "@media(max-width:480px){" +
      ".ep-tp-backdrop{padding:12px;align-items:flex-end}" +
      ".ep-tp-card{max-width:100%;border-radius:20px 20px 16px 16px;padding:22px 16px 16px}" +
      ".ep-tp-title{font-size:18px}" +
      ".ep-tp-text{font-size:13px;margin-bottom:16px}" +
      ".ep-tp-btn{min-height:46px;font-size:14px}" +
      "}";
    document.head.appendChild(style);
  }

  /* -------------------------------------------------------------------------
   * Modal actions and state management
   * ------------------------------------------------------------------------- */

  function postpone72Hours() {
    if (activeUserId) {
      var record = getStorage(activeUserId) || {
        firstActiveAt: Date.now(),
        reviewConfirmedAt: null
      };
      record.reviewStatus = "dismissed";
      record.lastDismissedAt = Date.now();
      setStorage(activeUserId, record);
    }
    closeModal();
  }

  function confirmReviewSubmission() {
    if (activeUserId) {
      var record = getStorage(activeUserId) || {
        firstActiveAt: Date.now(),
        lastDismissedAt: null
      };
      record.reviewStatus = "confirmed";
      record.reviewConfirmedAt = Date.now();
      setStorage(activeUserId, record);
    }
    closeModal();
  }

  function closeModal() {
    if (modalBackdrop) {
      modalBackdrop.classList.remove("ep-tp-is-open");
      modalBackdrop.setAttribute("aria-hidden", "true");
      setTimeout(function () {
        if (modalBackdrop && modalBackdrop.parentNode) {
          modalBackdrop.parentNode.removeChild(modalBackdrop);
          modalBackdrop = null;
        }
      }, 260);
    }
  }

  function renderCardContent(card) {
    if (currentStep === 1) {
      // Step 1: Initial Invitation
      card.innerHTML =
        '<button type="button" class="ep-tp-close" id="epTpCloseBtn" aria-label="Close review invitation">×</button>' +
        '<div class="ep-tp-badge"><span class="ep-tp-badge-star" aria-hidden="true">★</span> <span>Trustpilot Review</span></div>' +
        '<h2 id="epTpTitle" class="ep-tp-title">How is your ExamPilot preparation going?</h2>' +
        '<p id="epTpDesc" class="ep-tp-text">' +
        "Your genuine feedback helps us improve ExamPilot and helps other students preparing for JAMB, WAEC, NECO &amp; NABTEB find the right platform." +
        "</p>" +
        '<div class="ep-tp-actions">' +
        '<a href="' +
        REVIEW_URL +
        '" target="_blank" rel="noopener noreferrer" class="ep-tp-btn ep-tp-btn-primary" id="epTpReviewLink">' +
        '<span>Leave a Review on Trustpilot</span> <span aria-hidden="true">↗</span>' +
        "</a>" +
        '<button type="button" class="ep-tp-btn ep-tp-btn-secondary" id="epTpLaterBtn">Maybe later</button>' +
        "</div>" +
        '<div class="ep-tp-subfoot">' +
        '<button type="button" class="ep-tp-link-btn" id="epTpAlreadyReviewedBtn">Already submitted a review?</button>' +
        "</div>";

      var closeBtn = card.querySelector("#epTpCloseBtn");
      var laterBtn = card.querySelector("#epTpLaterBtn");
      var reviewLink = card.querySelector("#epTpReviewLink");
      var alreadyReviewedBtn = card.querySelector("#epTpAlreadyReviewedBtn");

      if (closeBtn) {
        closeBtn.addEventListener("click", postpone72Hours);
      }
      if (laterBtn) {
        laterBtn.addEventListener("click", postpone72Hours);
      }
      if (alreadyReviewedBtn) {
        alreadyReviewedBtn.addEventListener("click", function () {
          currentStep = 2;
          renderCardContent(card);
        });
      }
      if (reviewLink) {
        // Clicking the link opens Trustpilot in a new tab AND transitions the modal to confirmation step
        reviewLink.addEventListener("click", function () {
          setTimeout(function () {
            currentStep = 2;
            renderCardContent(card);
          }, 400);
        });
      }
    } else {
      // Step 2: Explicit Confirmation
      card.innerHTML =
        '<button type="button" class="ep-tp-close" id="epTpCloseBtn" aria-label="Close confirmation">×</button>' +
        '<div class="ep-tp-badge"><span class="ep-tp-badge-star" aria-hidden="true">✓</span> <span>Review Confirmation</span></div>' +
        '<h2 id="epTpTitle" class="ep-tp-title">Did you submit a review?</h2>' +
        '<p id="epTpDesc" class="ep-tp-text">' +
        "Thank you for taking the time! If you have submitted your review, confirm below and we won't show this reminder again on this browser." +
        "</p>" +
        '<div class="ep-tp-actions">' +
        '<button type="button" class="ep-tp-btn ep-tp-btn-primary" id="epTpConfirmBtn">Yes, I submitted a review</button>' +
        '<button type="button" class="ep-tp-btn ep-tp-btn-secondary" id="epTpNotYetBtn">Not yet / Maybe later</button>' +
        "</div>";

      var closeConfirmBtn = card.querySelector("#epTpCloseBtn");
      var confirmBtn = card.querySelector("#epTpConfirmBtn");
      var notYetBtn = card.querySelector("#epTpNotYetBtn");

      if (closeConfirmBtn) {
        closeConfirmBtn.addEventListener("click", postpone72Hours);
      }
      if (confirmBtn) {
        confirmBtn.addEventListener("click", confirmReviewSubmission);
      }
      if (notYetBtn) {
        notYetBtn.addEventListener("click", postpone72Hours);
      }
    }
  }

  function showPopup() {
    if (modalBackdrop || document.getElementById("epTpModalBackdrop")) {
      return;
    }

    ensureStyles();

    currentStep = 1;
    modalBackdrop = document.createElement("div");
    modalBackdrop.id = "epTpModalBackdrop";
    modalBackdrop.className = "ep-tp-backdrop";
    modalBackdrop.setAttribute("role", "dialog");
    modalBackdrop.setAttribute("aria-modal", "true");
    modalBackdrop.setAttribute("aria-labelledby", "epTpTitle");
    modalBackdrop.setAttribute("aria-describedby", "epTpDesc");

    var card = document.createElement("div");
    card.className = "ep-tp-card";
    renderCardContent(card);

    modalBackdrop.appendChild(card);
    document.body.appendChild(modalBackdrop);

    // Backdrop click dismisses (postpones)
    modalBackdrop.addEventListener("click", function (event) {
      if (event.target === modalBackdrop) {
        postpone72Hours();
      }
    });

    // Escape key dismisses (postpones)
    function onKeyDown(event) {
      if (event.key === "Escape") {
        document.removeEventListener("keydown", onKeyDown);
        postpone72Hours();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    // Trigger opening animation safely
    var scheduleFrame = window.requestAnimationFrame || window.setTimeout;
    scheduleFrame(function () {
      if (modalBackdrop) {
        modalBackdrop.classList.add("ep-tp-is-open");
      }
    }, 16);
  }

  /* -------------------------------------------------------------------------
   * Evaluation and schedule trigger
   * ------------------------------------------------------------------------- */

  function tryTrigger() {
    if (!activeUserId) {
      return;
    }

    // Never interrupt active modals, payments, or CBT
    if (isProtectedActivityActive()) {
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(tryTrigger, RETRY_DELAY_MS);
      return;
    }

    if (evaluateEligibility(activeUserId)) {
      showPopup();
    }
  }

  function resolveAuthenticatedStudent(attemptsLeft) {
    // 1. Try global dashboardCurrentUser
    if (window.dashboardCurrentUser && window.dashboardCurrentUser.id) {
      activeUserId = String(window.dashboardCurrentUser.id);
      setTimeout(tryTrigger, INITIAL_DELAY_MS);
      return;
    }

    // 2. Try offline session
    try {
      var rawOffline = window.localStorage.getItem("examPilotOfflineSession");
      if (rawOffline) {
        var offlineSession = JSON.parse(rawOffline);
        if (offlineSession && offlineSession.userId) {
          activeUserId = String(offlineSession.userId);
          setTimeout(tryTrigger, INITIAL_DELAY_MS);
          return;
        }
      }
    } catch (_) {}

    // 3. Try Supabase client session if available
    if (
      window.supabaseClient &&
      window.supabaseClient.auth &&
      typeof window.supabaseClient.auth.getSession === "function"
    ) {
      window.supabaseClient.auth.getSession().then(function (result) {
        if (result && result.data && result.data.session && result.data.session.user) {
          activeUserId = String(result.data.session.user.id);
          setTimeout(tryTrigger, INITIAL_DELAY_MS);
        } else if (attemptsLeft > 0) {
          setTimeout(function () {
            resolveAuthenticatedStudent(attemptsLeft - 1);
          }, 1000);
        }
      }).catch(function () {
        if (attemptsLeft > 0) {
          setTimeout(function () {
            resolveAuthenticatedStudent(attemptsLeft - 1);
          }, 1000);
        }
      });
      return;
    }

    // Retry if student data is still loading
    if (attemptsLeft > 0) {
      setTimeout(function () {
        resolveAuthenticatedStudent(attemptsLeft - 1);
      }, 1000);
    }
  }

  function start() {
    // Only run on pages where student is active; ignore if explicitly on cbt.html or student.html
    var path = (window.location.pathname || "").toLowerCase();
    if (path.indexOf("cbt.html") !== -1 || path.indexOf("student.html") !== -1) {
      return;
    }

    resolveAuthenticatedStudent(5);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
