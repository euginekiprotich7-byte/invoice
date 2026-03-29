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
        icon: './https://cdn-icons-png.flaticon.com/512/2821/2821637.png',
        badge: './https://cdn-icons-png.flaticon.com/512/2821/2821637.png',
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
    const options = {
        body: 'Urgent: A deadline has been reached!',
        icon: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png', // New lighter icon
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40],
        tag: 'deadline-alert',
        renew: true,
        requireInteraction: true, // Keeps it on screen until you act
        actions: [
            { action: 'open', title: 'Open App' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Invoice Manager Alert 🚨', options)
    );
});

// When you tap the notification, it re-opens your app
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});