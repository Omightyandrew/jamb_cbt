(function () {
  "use strict";

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

  function register() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("./sw.js").catch(function (error) {
      console.error("ExamPilot service worker registration failed.", error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      addConnectionStatus();
      register();
    }, { once: true });
  } else {
    addConnectionStatus();
    register();
  }
}());
