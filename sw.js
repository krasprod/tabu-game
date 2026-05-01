// Service Worker — кеширует ассеты для оффлайн работы
const CACHE = "tabu-v3";
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Не кешируем API-запросы
  if (url.hostname === "api.anthropic.com" || url.hostname === "openrouter.ai") return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => caches.match("index.html")))
  );
});
