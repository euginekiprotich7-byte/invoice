/* =========================================================
   ALARM-ENGINE.JS
   Fires real system notifications for due/overdue orders -
   using data already cached on the device, so it keeps working
   with zero internet connection. (Read the note at the bottom
   of this file for the one real platform limit on this.)
   ========================================================= */

const ALARM_CHECK_INTERVAL_MS = 20000; // 20s while the app is open/foregrounded

async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

async function fireSystemNotification(title, body, tag) {
    if (Notification.permission !== 'granted') return;
    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title, {
                body, tag, renotify: true, requireInteraction: true,
                icon: './icon.png', badge: './icon.png',
                vibrate: [300, 100, 300], data: { url: self.location?.href || '/' }
            });
            return;
        }
    } catch (err) {
        console.warn('SW notification failed, falling back to page Notification:', err);
    }
    new Notification(title, { body, tag });
}

/* Checks whatever data is on-device right now - the live in-memory
   `allTasks`, or the IndexedDB cache if that's empty - against the
   current time. Pure local computation: no network call, so this
   works exactly the same with wifi on or fully airplane-mode. */
async function checkDueOrdersLocally() {
    let tasks = (window.allTasks && window.allTasks.length) ? window.allTasks : null;
    if (!tasks && window.__offline) tasks = await window.__offline.idbGetAll('tasks');
    if (!tasks) return;

    const now = Date.now();
    for (const task of tasks) {
        if (!task.deadline || task.status !== 'Pending') continue;
        const deadline = new Date(task.deadline).getTime();
        const leadMs = (task.alert_lead_hours || 1) * 3600000;
        const alreadyFlagged = sessionStorage.getItem('notified-' + task.id);

        if (now >= deadline - leadMs && !alreadyFlagged) {
            const overdue = now >= deadline;
            await fireSystemNotification(
                overdue ? '🚨 ORDER OVERDUE' : '⏰ Order due soon',
                `${task.client_name || ''}: ${task.task_detail || 'Task'}`.trim(),
                'order-' + task.id
            );
            sessionStorage.setItem('notified-' + task.id, '1');
        }
    }
}

/* Best-effort background check for when the app is installed but
   not open. Chrome/Android only, and the browser decides how often
   it actually runs (commonly a few times a day, not to-the-minute) -
   see the note below. */
async function registerPeriodicSync() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        if ('periodicSync' in reg) {
            const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
            if (status.state === 'granted') {
                await reg.periodicSync.register('check-deadlines', { minInterval: 15 * 60 * 1000 });
            }
        }
        if ('sync' in reg) {
            await reg.sync.register('check-deadlines');
        }
    } catch (err) {
        console.log('Periodic/background sync not available on this browser:', err.message);
    }
}

/* Registers this device for real push notifications from the server
   (see /supabase-edge-function), which is what alerts you even when
   the app is fully closed - as long as VAPID_PUBLIC_KEY below matches
   the one you set as a secret on the Edge Function, and this device
   has internet at the moment the push arrives. Set VAPID_PUBLIC_KEY
   to the public key you generated (see README) before relying on this. */
const BH6AolgdLMaEptLsE7Mm7DEk9D-7THs_aYgzU0kCYdHeFuMGS_CDYz8Kzb0BzgJf-KcxpQgtgWN-RrAOB4JmFkY = ''; // <-- paste your VAPID public key here

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToServerPush() {
    if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (typeof supabaseClient === 'undefined') return;

    try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }
        await supabaseClient.from('user_subscriptions').upsert(
            { endpoint: sub.endpoint, subscription_json: JSON.stringify(sub) },
            { onConflict: 'endpoint' }
        );
    } catch (err) {
        console.log('Push subscription skipped:', err.message);
    }
}

async function initAlarmEngine() {
    await requestNotificationPermission();
    await registerPeriodicSync();
    if (Notification.permission === 'granted') await subscribeToServerPush();
    checkDueOrdersLocally();
    setInterval(checkDueOrdersLocally, ALARM_CHECK_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', initAlarmEngine);

/* ---------------------------------------------------------------
   THE ONE HONEST LIMIT WORTH KNOWING:
   A notification fired from data already on the device needs zero
   internet - that part is solved, and works with the phone in
   airplane mode as long as the order was synced at least once
   before you went offline. What the web platform (any PWA, on any
   phone) genuinely cannot guarantee is an exact, to-the-second
   alarm while the app is fully closed AND the phone has been
   offline for a long stretch - browsers only wake a closed PWA's
   background sync occasionally, not on a precise schedule. For
   guaranteed exact alarms while the app is closed, only a native
   app using the OS's own alarm system (e.g. Android AlarmManager)
   can promise that; a website/PWA cannot. Keeping the app open (or
   just glanced at) whenever a deadline is close is the reliable
   way to get instant alerts every time.
   --------------------------------------------------------------- */
