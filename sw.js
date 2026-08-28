/* =========================================================
   SW.JS - Service Worker
   1. Makes the app installable and usable offline (caches the
      app shell so it loads with zero connection).
   2. Receives real push notifications from the server when the
      app is fully closed (requires the device to have internet
      at that moment - see README for why that part is unavoidable).
   3. Runs a background deadline check against the on-device cache
      when the browser wakes it up (periodic/background sync) -
      this part needs no internet at all, since it's just comparing
      locally-stored dates.
   ========================================================= */

const CACHE_NAME = 'inv-mgr-v5';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon.png',
    './offline.js',
    './realtime.js',
    './alarm-engine.js',
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll(APP_SHELL).catch((err) => console.error('Precache failed:', err))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((names) =>
                Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
            ),
            self.clients.claim()
        ])
    );
});

// Network-first for navigation/app files (so users get updates when online),
// falling back to cache the instant the network is unavailable.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return; // never intercept writes to Supabase

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clients) => {
            for (const client of clients) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./');
        })
    );
});

/* ---------------------------------------------------------
   PUSH: fired by the Supabase Edge Function (see
   /supabase-edge-function in this project) when an order is
   overdue and the app isn't open. Requires internet on THIS
   device at the moment the push arrives - that part is a
   platform requirement for push, not something any app can
   remove. See README for the full explanation.
   --------------------------------------------------------- */
self.addEventListener('push', (event) => {
    let data = { title: '🚨 Order Alert', body: 'A deadline needs your attention.' };
    try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) { /* keep default */ }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: './icon.png',
            badge: './icon.png',
            tag: data.tag || 'deadline-alarm',
            renotify: true,
            requireInteraction: true,
            vibrate: [400, 100, 400, 100, 400],
            data: { url: './' }
        })
    );
});

/* ---------------------------------------------------------
   BACKGROUND DEADLINE CHECK: works entirely offline. Reads the
   same IndexedDB cache offline.js writes to, and fires a local
   notification purely from on-device data - no server contact
   needed for this part.
   --------------------------------------------------------- */
function openCacheDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('invoice-manager-db', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('employers')) db.createObjectStore('employers', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('pending_writes')) db.createObjectStore('pending_writes', { keyPath: 'localId', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getCachedTasks() {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tasks', 'readonly');
        const req = tx.objectStore('tasks').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function checkDeadlinesInBackground() {
    const tasks = await getCachedTasks();
    const now = Date.now();

    for (const task of tasks) {
        if (!task.deadline || task.status !== 'Pending' || task.notified) continue;
        const deadline = new Date(task.deadline).getTime();
        if (now >= deadline) {
            await self.registration.showNotification('🚨 ORDER OVERDUE', {
                body: `${task.client_name || ''}: ${task.task_detail || 'Task'}`.trim(),
                icon: './icon.png',
                tag: 'order-' + task.id,
                renotify: true,
                requireInteraction: true,
                vibrate: [400, 100, 400, 100, 400],
                data: { url: './' }
            });
        }
    }
}

// Chrome/Android only, best-effort, browser decides the actual cadence.
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-deadlines') event.waitUntil(checkDeadlinesInBackground());
});

// Fires once, next time the browser regains connectivity/wakes the SW.
self.addEventListener('sync', (event) => {
    if (event.tag === 'check-deadlines') event.waitUntil(checkDeadlinesInBackground());
});
