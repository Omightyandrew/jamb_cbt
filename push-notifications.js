(function () {
  "use strict";

  var PREFERENCE_KEY = "exampilotNotificationsPreference";
  var PROMPT_ATTEMPTED_KEY = "exampilotNotificationsPermissionPrompted";

  function base64ToUint8Array(value) {
    var padding = "=".repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    return Uint8Array.from(raw, function (character) {
      return character.charCodeAt(0);
    });
  }

  function getButton() {
    return document.getElementById("enableNotificationsButton");
  }

  function setButtonState(state, detail) {
    var button = getButton();
    var label = document.getElementById("notificationSettingLabel");
    var description = document.getElementById("notificationSettingDescription");
    var isOn = state === "on";
    var isBusy = state === "loading";

    if (button) {
      button.setAttribute("aria-pressed", isOn ? "true" : "false");
      button.disabled = isBusy;
    }
    if (label) {
      label.textContent = "Notifications — " + (isOn ? "ON" : "OFF");
    }
    if (description) {
      description.textContent = detail || (isOn
        ? "Receive important ExamPilot updates and alerts."
        : "Notifications are turned off.");
    }
  }

  function supportsWebPush() {
    return Boolean(
      window.isSecureContext &&
      "Notification" in window &&
      "PushManager" in window &&
      "serviceWorker" in navigator &&
      "ServiceWorkerRegistration" in window &&
      "pushManager" in ServiceWorkerRegistration.prototype
    );
  }

  async function getCurrentSubscription() {
    var registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) {
      throw new Error("This browser does not expose push support on its service worker.");
    }
    return {
      registration: registration,
      subscription: await registration.pushManager.getSubscription()
    };
  }

  async function saveSubscription(subscription, userId) {
    var json = subscription.toJSON();
    var result = await window.supabaseClient.from("push_subscriptions").upsert({
      endpoint: subscription.endpoint,
      user_id: userId,
      p256dh: json.keys && json.keys.p256dh,
      auth: json.keys && json.keys.auth,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (result.error) throw result.error;
  }

  async function enableNotifications(options) {
    options = options || {};
    var publicKey = String(window.EXAMPILOT_VAPID_PUBLIC_KEY || "").trim();

    if (!publicKey) {
      setButtonState("off", "Notifications are not configured yet.");
      return false;
    }
    if (!supportsWebPush()) {
      setButtonState("off", "Web Push is unavailable in this browser or context.");
      return false;
    }
    if (Notification.permission === "denied") {
      setButtonState("off", "Permission blocked. Enable notifications in Chrome site settings to turn them on.");
      return false;
    }

    setButtonState("loading", "Enabling notifications...");
    try {
      var sessionResult = await window.supabaseClient.auth.getSession();
      if (sessionResult.error || !sessionResult.data.session) {
        throw new Error("Please sign in again before enabling notifications.");
      }

      if (Notification.permission === "default") {
        if (!options.interactive && localStorage.getItem(PROMPT_ATTEMPTED_KEY) === "true") {
          setButtonState("off", "Tap to turn notifications on.");
          return false;
        }
        localStorage.setItem(PROMPT_ATTEMPTED_KEY, "true");
        var permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setButtonState("off", permission === "denied"
            ? "Permission blocked. Enable notifications in Chrome site settings to turn them on."
            : "Tap to turn notifications on.");
          return false;
        }
      }

      var current = await getCurrentSubscription();
      var subscription = current.subscription;
      if (!subscription) {
        subscription = await current.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        });
      }

      await saveSubscription(subscription, sessionResult.data.session.user.id);
      localStorage.setItem(PREFERENCE_KEY, "on");
      setButtonState("on", "Receive important ExamPilot updates and alerts.");
      return true;
    } catch (error) {
      console.error("ExamPilot notification opt-in failed.", error);
      setButtonState("off", "Notifications could not be enabled. Tap to try again.");
      if (options.interactive) {
        alert("Notifications could not be enabled: " + (error.message || "Please try again."));
      }
      return false;
    }
  }

  async function disableNotifications() {
    var button = getButton();
    if (button) button.disabled = true;
    localStorage.setItem(PREFERENCE_KEY, "off");

    try {
      if (supportsWebPush()) {
        var current = await getCurrentSubscription();
        if (current.subscription) {
          var endpoint = current.subscription.endpoint;
          await current.subscription.unsubscribe();
          var result = await window.supabaseClient
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", endpoint);
          if (result.error) throw result.error;
        }
      }
      setButtonState("off", "Notifications are turned off.");
    } catch (error) {
      console.error("ExamPilot notification opt-out failed.", error);
      setButtonState("on", "Could not turn notifications off. Try again.");
      alert("Notifications could not be turned off: " + (error.message || "Please try again."));
    }
  }

  async function toggleNotifications() {
    if (localStorage.getItem(PREFERENCE_KEY) === "on") {
      await disableNotifications();
    } else {
      await enableNotifications({ interactive: true });
    }
  }

  async function initializeNotifications() {
    if (localStorage.getItem(PREFERENCE_KEY) === "off") {
      setButtonState("off", "Notifications are turned off.");
      return;
    }
    if (!supportsWebPush()) {
      setButtonState("off", "Web Push is unavailable in this browser or context.");
      return;
    }
    if (Notification.permission === "denied") {
      setButtonState("off", "Permission blocked. Enable notifications in Chrome site settings to turn them on.");
      return;
    }
    await enableNotifications({ interactive: false });
  }

  window.enableExamPilotNotifications = toggleNotifications;

  function init() {
    var button = getButton();
    if (!button) return;
    button.addEventListener("click", toggleNotifications);
    initializeNotifications().catch(function (error) {
      console.error("ExamPilot notification initialization failed.", error);
      setButtonState("off", "Tap to turn notifications on.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());
