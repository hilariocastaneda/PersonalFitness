const CACHE_NAME = 'fromesco-v2';
const STATIC_ASSETS = ['/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Never cache API calls — data must always be fresh
  if (url.includes('/accounts') || url.includes('/login') || url.includes('/change-pin') ||
      url.includes('/users') || url.includes('/profile') || url.includes('/settings') ||
      url.includes('/exercises') || url.includes('/fitness') || url.includes('/fashion')) {
    return;
  }

  // App shell (HTML) — always try the network first so deploys show up
  // immediately; fall back to the last cached copy only when offline.
  // respondWith() must always resolve to a real Response — resolving to
  // undefined (e.g. a cache miss on the fallback path) throws in Safari.
  const isAppShell = e.request.mode === 'navigate' || url.endsWith('/') || url.endsWith('/index.html');
  if (isAppShell) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return res;
      }).catch(async () => {
        const cached = await caches.match(e.request) || await caches.match('/index.html');
        return cached || new Response('<h1>Offline</h1><p>Fromesco is unreachable right now.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } });
      })
    );
    return;
  }

  // Everything else (icons, css, js, images) — cache-first is fine, they're
  // versioned by filename or change rarely.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => new Response('', { status: 504 })))
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
