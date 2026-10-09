(function () {
  "use strict";

  var PREFERENCE_KEY = "exampilotNotificationsPreference";
  var DEFAULT_ENABLED_TEXT = "Receive Daily Challenge reminders and important exam alerts.";
  var DEFAULT_DISABLED_TEXT = "Notifications are turned off.";

  function base64ToUint8Array(value) {
    var padding = "=".repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    return Uint8Array.from(raw, function (character) {
      return character.charCodeAt(0);
    });
  }

  function getButtons() {
    return Array.from(document.querySelectorAll("#enableNotificationsButton, .enable-notifications-btn"));
  }

  function setButtonState(state, detail) {
    var buttons = getButtons();
    var labels = Array.from(document.querySelectorAll("#notificationSettingLabel, .notification-setting-label"));
    var descriptions = Array.from(document.querySelectorAll("#notificationSettingDescription, .notification-setting-description"));
    var isOn = state === "on";
    var isBusy = state === "loading";

    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", isOn ? "true" : "false");
      button.disabled = isBusy;
    });

    labels.forEach(function (label) {
      label.textContent = "Notifications — " + (isOn ? "ON" : "OFF");
    });

    descriptions.forEach(function (description) {
      description.textContent = detail || (isOn ? DEFAULT_ENABLED_TEXT : DEFAULT_DISABLED_TEXT);
    });
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
      setButtonState("off", "Permission blocked. Enable notifications in your browser or site settings to turn them on.");
      if (options.interactive) {
        alert("Notifications are blocked by your browser. Please enable notifications in your browser site settings to turn them on.");
      }
      return false;
    }

    setButtonState("loading", "Enabling notifications...");
    try {
      var sessionResult = await window.supabaseClient.auth.getSession();
      if (sessionResult.error || !sessionResult.data.session) {
        throw new Error("Please sign in again before enabling notifications.");
      }

      if (Notification.permission === "default") {
        if (!options.interactive) {
          setButtonState("off", "Tap Toggle Notifications to enable alerts on this device.");
          return false;
        }
        var permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setButtonState("off", permission === "denied"
            ? "Permission blocked. Enable notifications in your browser or site settings to turn them on."
            : "Tap Toggle Notifications to enable alerts on this device.");
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
      setButtonState("on", DEFAULT_ENABLED_TEXT);
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
    var buttons = getButtons();
    buttons.forEach(function (button) { button.disabled = true; });

    var unsubscribedLocally = false;
    try {
      if (supportsWebPush()) {
        var current = await getCurrentSubscription();
        if (current.subscription) {
          var endpoint = current.subscription.endpoint;
          var unsubscribed = await current.subscription.unsubscribe();
          if (!unsubscribed) {
            throw new Error("Browser PushManager could not unsubscribe.");
          }
          unsubscribedLocally = true;

          var result = await window.supabaseClient
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", endpoint);
          if (result.error) {
            localStorage.setItem(PREFERENCE_KEY, "off");
            setButtonState("off", DEFAULT_DISABLED_TEXT);
            alert("Notifications are disabled on this device, but removing the server record could not be confirmed: " + (result.error.message || "Network error") + ".");
            return;
          }
        }
      }
      localStorage.setItem(PREFERENCE_KEY, "off");
      setButtonState("off", DEFAULT_DISABLED_TEXT);
    } catch (error) {
      console.error("ExamPilot notification opt-out failed.", error);
      if (unsubscribedLocally) {
        localStorage.setItem(PREFERENCE_KEY, "off");
        setButtonState("off", DEFAULT_DISABLED_TEXT);
        alert("Notifications are disabled on this device, but removing the server record could not be confirmed: " + (error.message || "Network error") + ".");
      } else {
        localStorage.setItem(PREFERENCE_KEY, "on");
        setButtonState("on", "Could not turn notifications off. Tap to try again.");
        alert("Notifications could not be turned off in your browser: " + (error.message || "Please try again."));
      }
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
      setButtonState("off", DEFAULT_DISABLED_TEXT);
      return;
    }
    if (!supportsWebPush()) {
      setButtonState("off", "Web Push is unavailable in this browser or context.");
      return;
    }
    if (Notification.permission === "denied") {
      setButtonState("off", "Permission blocked. Enable notifications in your browser or site settings to turn them on.");
      return;
    }
    if (Notification.permission === "default") {
      setButtonState("off", "Tap Toggle Notifications to enable alerts on this device.");
      return;
    }
    // Existing permission granted: automatically register or restore subscription
    await enableNotifications({ interactive: false });
  }

  window.enableExamPilotNotifications = toggleNotifications;

  function init() {
    var buttons = getButtons();
    if (!buttons.length) return;
    buttons.forEach(function (button) {
      button.addEventListener("click", toggleNotifications);
    });
    initializeNotifications().catch(function (error) {
      console.error("ExamPilot notification initialization failed.", error);
      setButtonState("off", "Tap Toggle Notifications to enable alerts on this device.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());
