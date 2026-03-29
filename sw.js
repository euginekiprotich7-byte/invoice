const CACHE_NAME = 'inv-mgr-v1';
const ASSETS = [
'./',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install: Cache the basic UI
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Listen for background push events or scheduled alerts
self.addEventListener('show-notification', (event) => {
    const options = {
        body: event.data.body,
        icon: './https://cdn-icons-png.flaticon.com/512/1827/1827347.png',
        badge: './https://cdn-icons-png.flaticon.com/512/1827/1827347.png',
        vibrate: [200, 100, 200],
        tag: 'deadline-alert',
        renotify: true,
        data: { url: self.registration.scope }
    };

    event.waitUntil(
        self.registration.showNotification('ORDER DUE! 🚨', options)
    );
});

// Open the app when you tap the notification
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});

// This listener runs even if the app is closed
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : { title: 'Order Due!', body: 'Check your tasks now.' };
    
    const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827347.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/1827/1827347.png',
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40],
        tag: 'urgent-deadline',
        requireInteraction: true, // Keeps the notification on screen until you dismiss it
        data: { url: '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// When you tap the notification, it re-opens your app
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});