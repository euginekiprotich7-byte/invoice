const CACHE_NAME = 'erp-v1';
const ASSETS = ['index.html', 'manifest.json'];

// Install: Cache the basic UI
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

// Fetch: Serve from cache if offline
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});