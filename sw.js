// Service Worker — оффлайн-кеш с network-first для кода (избегаем устаревший JS)
const CACHE = "tabu-v4";
const ASSETS = [
  ".",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.json",
  "data/cards.json",
  "assets/app-icon.png",
  "assets/tabu-bg.png",
  "assets/tabu-splash.png",
  "assets/card-back.png",
  "assets/icon-task.png",
  "assets/icon-truth.png",
  "assets/icon-swap.png",
  "assets/icon-bold.png",
  "assets/icon-skip.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Код (HTML/JS/CSS/JSON) — network-first, чтобы не залипал старый билд.
// Картинки — cache-first (быстро + оффлайн).
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname === "api.anthropic.com" || url.hostname === "openrouter.ai") return;
  if (e.request.method !== "GET") return;

  const isCode = /\.(html|js|css|json)$/i.test(url.pathname) || url.pathname.endsWith("/");

  if (isCode) {
    // network-first
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match("index.html")))
    );
  } else {
    // cache-first
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
          return res;
        })
      )
    );
  }
});
