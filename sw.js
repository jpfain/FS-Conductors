const CACHE_NAME = 'fs-conductors-v50-cache-2';
const CACHE_PREFIX = 'fs-conductors-';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manual.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    if (event.request.mode === 'navigate') {
      const cachedNavigation = await caches.match(event.request, { ignoreSearch: true });
      if (cachedNavigation) return cachedNavigation;
    }

    return fetch(event.request);
  })());
});
