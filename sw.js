const CACHE_VERSION = "exampilot-shell-v7";
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
  "./supabase.js",
  "./questions.js",
  "./exam.js",
  "./assets/logo/app-icon-512.png"
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
    /\.(?:css|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(pathname);
}

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
