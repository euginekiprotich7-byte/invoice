const CACHE_NAME = 'inv-mgr-v1';
const ASSETS = [
'./',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js'
];


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


self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});

self.addEventListener('push', function(event) {
    const options = {
        body: 'Urgent: A deadline has been reached!',
        icon: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png', 
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40],
        tag: 'deadline-alert',
        renew: true,
        requireInteraction: true, 
        actions: [
            { action: 'open', title: 'Open App' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Invoice Manager Alert 🚨', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});

self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-deadlines') {
        event.waitUntil(checkDeadlinesAndNotify());
    }
});

async function checkDeadlinesAndNotify() {
    
    const db = await openDB(); 
    const orders = await getAllOrders(db);
    const now = new Date();

    orders.forEach(order => {
        const deadline = new Date(order.deadline);
        
        if (deadline <= now && !order.notified) {
            self.registration.showNotification("ORDER OVERDUE! 🚨", {
                body: `Order ${order.detail} is due now!`,
                icon: "https://cdn-icons-png.flaticon.com/512/2821/2821637.png",
                vibrate: [200, 100, 200],
                requireInteraction: true 
            });
            markAsNotified(order.id);
        }
    });
}

self.addEventListener('sync', (event) => {
    if (event.tag === 'check-deadlines') {
        event.waitUntil(checkAndNotify());
    }
});

async function checkAndNotify() {
    
    const db = await openDatabase(); 
    const orders = await getAllOrders(db);
    const now = new Date().getTime();

    orders.forEach(order => {
        const deadline = new Date(order.deadline).getTime();
        
        
        if (now >= deadline && !order.notified) {
            self.registration.showNotification("🚨 DEADLINE REACHED", {
                body: `Order: ${order.detail}`,
                icon: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png',
                vibrate: [200, 100, 200, 100, 200],
                tag: 'order-alert-' + order.id
            });
            
        }
    });
}

	self.addEventListener('show-alarm', (event) => {
		const options = {
			body: '🚨 URGENT: An order is due in less than 1 hour!',
			icon: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png',
			badge: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png',
			tag: 'order-alarm',
			renotify: true,
			vibrate: [200, 100, 200],
			actions: [
				{ action: 'open', title: 'Open App' },
				{ action: 'close', title: 'Dismiss' }
			]
		};

		event.waitUntil(
			self.registration.showNotification('Order Deadline Alert', options)
		);
	});
	
	self.addEventListener('push', (event) => {
    const data = event.data.json();
    
    const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png',
        vibrate: [500, 100, 500, 100, 500], // Long vibration for the alarm
        tag: 'deadline-alarm',
        renotify: true,
        data: { url: './index.html' },
        actions: [
            { action: 'open', title: 'View Order' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('🚨 LATE ORDER ALARM', options)
    );
});

// Open the app when the notification is clicked
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});