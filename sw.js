const CACHE_NAME = 'fs-conductors-v55-cache-1';
const CACHE_PREFIX = 'fs-conductors-';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './js/storage.js',
  './js/app-core.js',
  './js/ui-modals.js',
  './js/cloud-sync.js',
  './js/schedule.js',
  './js/sharing.js',
  './js/app-init.js',
  './manual.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
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
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone()).catch((error) => {
            console.warn('Navigation cache update failed:', request.url, error);
          });
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
        throw error;
      }
    })());
    return;
  }

  if (request.destination === 'style' || request.destination === 'script' ||
      /\.(?:css|js|png|svg|ico|json|webmanifest)$/.test(new URL(request.url).pathname)) {
    const cachePromise = caches.open(CACHE_NAME);
    const update = cachePromise.then((cache) => fetch(request).then(async (response) => {
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }));
    event.waitUntil(update.catch((error) => {
      console.warn('Static asset refresh failed:', request.url, error);
    }));
    event.respondWith(cachePromise.then(async (cache) => {
      const cached = await cache.match(request);
      return cached || update;
    }));
  }
});
