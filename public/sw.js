// Offline shell + fast repeat visits. Video streams are never cached.
const VERSION = 'lumen-v1';
const SHELL = ['/', '/styles.css', '/js/app.js', '/js/api.js', '/js/store.js', '/js/ui.js', '/js/views.js', '/js/player.js', '/js/search.js', '/data/catalog.json', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // SPA navigations: network first, fall back to cached shell.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  // Same-origin assets: network first so deploys show up immediately, cache as offline fallback.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(VERSION).then((cache) =>
        fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cache.match(request))
      )
    );
    return;
  }

  // Posters: cache-first (they never change).
  if (/upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.tvmaze\.com/.test(url.hostname) && request.destination === 'image') {
    e.respondWith(
      caches.open(VERSION + '-img').then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
        return res;
      })
    );
  }
});
