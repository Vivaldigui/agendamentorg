const CACHE_NAME = 'cin-v13-bypass';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', e => {
  // Bypass any caching and always fetch from network
  e.respondWith(fetch(e.request).catch(() => new Response("Offline", {status: 503})));
});
