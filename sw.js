// Area Match — service worker
// Scope: makes the app installable (required for the Android TWA/APK) and speeds up
// repeat loads. Deliberately does NOT cache Supabase/API calls — scores, chat, and
// live match data must always come from the network, never from a stale cache.

const CACHE_NAME = "area-match-shell-v1";

// Only the app "shell" — things that rarely change and are safe to cache.
// Vite's hashed JS/CSS bundle files are intentionally left alone; the browser's
// normal HTTP cache already handles those efficiently and correctly.
const SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.json",
  "/site.webmanifest",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll fails hard if even one file 404s — guard so a missing icon
      // doesn't break install; each file is cached best-effort instead.
      Promise.allSettled(SHELL_FILES.map((f) => cache.add(f)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle simple GETs — never touch POST/PATCH/etc (auth, score updates, etc.)
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache Supabase or any cross-origin API traffic — always go live to the network.
  if (url.origin !== self.location.origin) return;

  // For a page navigation (e.g. opening the app from the home screen icon):
  // try the network first for the freshest version, fall back to the cached
  // shell only if the device is offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // For the known shell files only: serve from cache first (fast), refresh
  // in the background so the next load stays current.
  if (SHELL_FILES.some((f) => url.pathname === f)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((res) => {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
  // Everything else (JS/CSS bundles, fonts, images) — let the browser handle
  // it normally. No custom caching, no risk of serving stale app code.
});
