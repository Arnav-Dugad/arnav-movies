// Offline shell + fast repeat visits. Video streams and API calls are never cached here.
const VERSION = 'lumen-v3';
const SHELL = [
  '/', '/styles.css', '/data/catalog.json?v=2', '/icon.svg', '/manifest.webmanifest',
  ...['app', 'api', 'store', 'ui', 'views', 'tv', 'people', 'status', 'player', 'search', 'recs', 'gestures', 'cast', 'subs', 'hovercard', 'shorts', 'seasons'].map((m) => `/js/${m}.js`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
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

  // Same-origin assets (not the API): network first so deploys show up immediately, cache as offline fallback.
  if (url.origin === location.origin && !url.pathname.startsWith('/api/')) {
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

  // Posters and stills: cache-first (they never change).
  if (/image\.tmdb\.org|upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.tvmaze\.com|s4\.anilist\.co/.test(url.hostname) && request.destination === 'image') {
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
