(function () {
  "use strict";

  function base64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  function setButtonState(button, text, disabled) {
    if (!button) return;
    button.textContent = text;
    button.disabled = Boolean(disabled);
  }

  async function enableNotifications() {
    const button = document.getElementById("enableNotificationsButton");
    const publicKey = String(window.EXAMPILOT_VAPID_PUBLIC_KEY || "").trim();

    if (!publicKey) {
      alert("Notifications are not configured yet. Please contact ExamPilot support.");
      return;
    }
    if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
      alert("This browser does not support Web Push notifications.");
      return;
    }

    setButtonState(button, "Enabling notifications...", true);
    try {
      const { data, error } = await window.supabaseClient.auth.getSession();
      if (error || !data.session) throw new Error("Please sign in again before enabling notifications.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setButtonState(button, permission === "denied" ? "Notifications blocked" : "🔔 Enable Notifications", false);
        alert(permission === "denied"
          ? "Notifications are blocked for ExamPilot. Allow them in your browser settings, then try again."
          : "Notification permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        });
      }

      const json = subscription.toJSON();
      const { error: saveError } = await window.supabaseClient.from("push_subscriptions").upsert({
        endpoint: subscription.endpoint,
        user_id: data.session.user.id,
        p256dh: json.keys && json.keys.p256dh,
        auth: json.keys && json.keys.auth,
        user_agent: navigator.userAgent,
        last_seen_at: new Date().toISOString()
      }, { onConflict: "endpoint" });
      if (saveError) throw saveError;

      setButtonState(button, "✅ Notifications enabled", true);
    } catch (error) {
      console.error("ExamPilot notification opt-in failed.", error);
      setButtonState(button, "🔔 Enable Notifications", false);
      alert("Notifications could not be enabled: " + (error.message || "Please try again."));
    }
  }

  window.enableExamPilotNotifications = enableNotifications;

  function init() {
    const button = document.getElementById("enableNotificationsButton");
    if (!button) return;
    navigator.serviceWorker && navigator.serviceWorker.ready.then(async (registration) => {
      const current = await registration.pushManager.getSubscription();
      if (current) setButtonState(button, "✅ Notifications enabled", true);
    }).catch((error) => console.warn("Could not inspect notification subscription.", error));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());
