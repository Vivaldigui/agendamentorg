const CACHE_NAME = 'cin-v15-robustez';

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
  // Return immediately so the browser handles all requests natively.
  // Intercepting Firebase/Firestore requests can break them.
  return;
});
