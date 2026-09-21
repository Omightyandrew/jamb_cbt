const CACHE_VERSION = "exampilot-shell-v9";
const SHELL_CACHE = CACHE_VERSION;
const OFFLINE_URL = "./offline.html";
const SUPABASE_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const PRECACHE_URLS = [
  "./offline.html",
  "./index.html",
  "./student.html",
  "./brand.css",
  "./pwa-register.js",
  "./offline-store.js",
  "./offline-auth.js",
  "./push-config.js",
  "./push-notifications.js",
  "./supabase.js",
  "./questions.js",
  "./exam.js",
  "./assets/logo/app-icon-512.png",
  "./assets/logo/logo-primary.svg",
  "./assets/logo/logo-compact.svg",
  "./assets/logo/logo-symbol.svg",
  "./assets/logo/logo-mono-light.svg",
  "./assets/logo/favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS.concat(SUPABASE_LIBRARY_URL)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("exampilot-") && cacheName !== SHELL_CACHE)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

function isSensitiveRequest(request) {
  const url = new URL(request.url);
  if (url.href === SUPABASE_LIBRARY_URL) {
    return false;
  }
  return url.origin !== self.location.origin ||
    url.hostname.includes("supabase") ||
    url.hostname.includes("paystack") ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("/rest/") ||
    url.pathname.includes("/storage/");
}

function isStaticAsset(request) {
  const pathname = new URL(request.url).pathname;
  return pathname.endsWith("/pwa-register.js") ||
    pathname.endsWith("/offline-store.js") ||
    pathname.endsWith("/offline-auth.js") ||
    /\.(?:css|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(pathname);
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.warn("ExamPilot push payload was not valid JSON.", error);
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = String(payload.title || "ExamPilot").slice(0, 120);
  const body = String(payload.body || payload.message || "").slice(0, 1000);
  const destination = typeof payload.url === "string" ? payload.url : "./dashboard.html";
  const icon = "./assets/logo/app-icon-512.png";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag: String(payload.id || "exampilot-notification"),
      data: { url: destination }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data && event.notification.data.url;
  let targetUrl = new URL("./dashboard.html", self.location.origin);

  if (typeof requestedUrl === "string") {
    try {
      const candidate = new URL(requestedUrl, self.location.origin);
      if (candidate.origin === self.location.origin) {
        targetUrl = candidate;
      }
    } catch (error) {
      console.warn("ExamPilot notification destination was invalid.", error);
    }
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          return client.navigate(targetUrl.href).then(() => client.focus());
        }
      }
      return self.clients.openWindow(targetUrl.href);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || isSensitiveRequest(request)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request)
        .then((cached) => cached || fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }))
    );
  }
});
