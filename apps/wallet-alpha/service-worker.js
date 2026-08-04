const CACHE_NAME = "wetdrool-wokenet-alpha-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/profile.css",
  "/config.js",
  "/app.js",
  "/protocol.js",
  "/vault.js",
  "/assets/wetdrool-mark.svg",
  "/assets/wetdrool-wordmark.png",
  "/assets/kingofqueens6ix-pfp.jpg",
  "/kingofqueens6ix/",
  "/site.webmanifest",
  "/.well-known/wokenet-alpha.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});
