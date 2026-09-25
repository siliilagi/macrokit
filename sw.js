/*
 * Caches the full app shell on install so MacroKit works completely offline
 * after the first visit — recipes, planner, shopping list, gap finder, and
 * custom recipes all run from cached files. Only the Healthify feature
 * (a cross-origin POST to the Claude API) needs real connectivity, and this
 * worker deliberately never touches cross-origin or non-GET requests.
 */
const CACHE_VERSION = "macrokit-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/util.js",
  "./js/store.js",
  "./js/shopping.js",
  "./js/gapfinder.js",
  "./js/healthify.js",
  "./js/app.js",
  "./data/ingredients.json",
  "./data/recipes.json",
  "./data/shared-config.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept the Healthify POST to Anthropic
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin requests

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") return caches.match("./index.html");
          return new Response("", { status: 504, statusText: "Offline" });
        });
    })
  );
});
