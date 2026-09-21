(function () {
  "use strict";

  /* --------------------------------------------------------
   * Connection-status indicator (unchanged)
   * -------------------------------------------------------- */
  function addConnectionStatus() {
    var status = document.createElement("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "padding:6px 10px;border-radius:999px;font:12px Arial,sans-serif;" +
      "background:#14213d;color:#fff;box-shadow:0 2px 8px rgba(20,33,61,.18);" +
      "opacity:0;pointer-events:none;transition:opacity .2s ease";
    document.body.appendChild(status);

    function update() {
      var offline = !navigator.onLine;
      status.textContent = offline ? "Offline" : "Online";
      status.style.background = offline ? "#53657a" : "#14213d";
      status.style.opacity = offline ? "1" : "0";
    }

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  /* --------------------------------------------------------
   * Service-worker registration (unchanged)
   * -------------------------------------------------------- */
  function register() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("./sw.js").catch(function (error) {
      console.error("ExamPilot service worker registration failed.", error);
    });
  }

  /* --------------------------------------------------------
   * PWA Install button
   * -------------------------------------------------------- */

  // Saved deferred prompt from the browser.
  var _deferredPrompt = null;

  /**
   * Return true if the app is running in standalone / installed mode.
   * Works for Android (display-mode) and iOS (navigator.standalone).
   */
  function isInstalledPWA() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true
    );
  }

  /**
   * Return true when we are almost certainly on iOS Safari (which does not
   * fire beforeinstallprompt but supports Add-to-Home-Screen manually).
   */
  function isIosSafari() {
    var ua = navigator.userAgent;
    var isIos = /iphone|ipad|ipod/i.test(ua);
    // Safari on iOS does NOT have "Chrome" or "CriOS" or "FxiOS" in the UA
    var isSafari = isIos && !/(CriOS|FxiOS|OPiOS|mercury)/i.test(ua);
    return isSafari;
  }

  /**
   * Wire up the install UI on the login page (student.html).
   * If the elements are not present (other pages) we do nothing.
   */
  function initInstallUI() {
    var section = document.getElementById("pwaInstallSection");
    var btn     = document.getElementById("pwaInstallBtn");
    var hint    = document.getElementById("pwaInstallHint");
    var iosNote = document.getElementById("pwaIosNote");

    // Elements only exist on student.html — skip all other pages.
    if (!section) {
      return;
    }

    // --- Already installed: hide everything and stop ---
    if (isInstalledPWA()) {
      return;
    }

    // --- iOS Safari: show manual instructions instead of a button ---
    if (isIosSafari()) {
      section.classList.remove("hidden");
      iosNote.classList.remove("hidden");
      return;
    }

    // --- Supported browsers: listen for beforeinstallprompt ---
    window.addEventListener("beforeinstallprompt", function (e) {
      // Prevent the mini-infobar from appearing automatically.
      e.preventDefault();

      // Stash the event so we can trigger it later.
      _deferredPrompt = e;

      // Reveal the install section and button.
      section.classList.remove("hidden");
      btn.classList.remove("hidden");
      hint.classList.remove("hidden");
    });

    // Button click: trigger the native install prompt.
    btn.addEventListener("click", function () {
      if (!_deferredPrompt) {
        return;
      }

      btn.disabled = true;

      _deferredPrompt.prompt();

      _deferredPrompt.userChoice.then(function (choiceResult) {
        // Clear the saved prompt regardless of outcome.
        _deferredPrompt = null;

        if (choiceResult.outcome === "accepted") {
          // Hide the section now that the app is being installed.
          section.classList.add("hidden");
        } else {
          // User dismissed — re-enable the button so they can try again.
          btn.disabled = false;
        }
      });
    });

    // If the app gets installed via another path (e.g. browser menu),
    // hide the button automatically.
    window.addEventListener("appinstalled", function () {
      _deferredPrompt = null;
      section.classList.add("hidden");
    });
  }

  /* --------------------------------------------------------
   * Initialise
   * -------------------------------------------------------- */
  function init() {
    addConnectionStatus();
    register();
    initInstallUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());
