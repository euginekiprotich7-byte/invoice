let titleInterval = null;

function triggerAlarm(taskName) {
    const alarm = document.getElementById('dueAlarm');
    const banner = document.getElementById('alarmBanner');

    const displayName = taskName || "An Assignment";

    // 1. Visual Alert with Pulsing Effect
    if (banner) {
        banner.innerHTML = `
            <div class="alarm-row">
                <span>🚨 <b>${displayName}</b> — DEADLINE ALERT</span>
                <div style="display:flex;gap:8px;">
                    <button class="alarm-btn snooze" onclick="snoozeAlarm()">SNOOZE 15 MIN</button>
                    <button class="alarm-btn stop" onclick="stopAlarm()">DISMISS</button>
                </div>
            </div>`;
        banner.style.display = 'block';
        banner.classList.add('pulse-animation');
        flashTitle();
    }

    // 2. Audio Alert
    if (alarm) {
        alarm.currentTime = 0; // Restart sound if already playing
        alarm.play().catch(e => {
            console.warn("Audio auto-play blocked by browser. Interaction required.");
        });
    }

    // 3. System Service Worker Notification
    // This is the most reliable way to alert you on Android or Desktop
    if (Notification.permission === "granted" && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification('🚨 URGENT: DEADLINE REACHED', {
                body: `The deadline for "${displayName}" has arrived.`,
                icon: "./icon.png",
                badge: "./icon.png",
                tag: 'urgent-alarm',
                renotify: true, // Make it pop up even if one is already there
                requireInteraction: true,
                vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40, 500], // SOS Pattern
                data: { url: window.location.href }
            });
        });
    }
}

function flashTitle() {
			let originalTitle = document.title;
			if (!titleInterval) {
				titleInterval = setInterval(() => {
					document.title = (document.title === "🚨 URGENT!") ? originalTitle : "🚨 URGENT!";
				}, 1000);
			}
		}
		
/** * 1. THE AUDIO UNLOCKER
 * Browsers block sounds until the user clicks something. 
 * This "silently" plays the alarm once to unlock it for later.
 */
window.addEventListener('click', () => {
    const alarm = document.getElementById('dueAlarm');
    if (!alarm) return;
    
    alarm.muted = true;
    alarm.play().then(() => {
        alarm.pause();
        alarm.muted = false;
        console.log("🔊 Audio System Unlocked & Ready");
    });
}, { once: true });

function snoozeAlarm() {
    stopAlarm();
    window.isSnoozed = true;
    isAlarmSnoozed = true;
    alarmSnoozeUntil = Date.now() + 15 * 60 * 1000;

    if (window.snoozeTimer) clearTimeout(window.snoozeTimer);
    window.snoozeTimer = setTimeout(() => {
        Object.keys(sessionStorage).filter(k => k.startsWith('notified-')).forEach(k => sessionStorage.removeItem(k));
        window.isSnoozed = false;
        isAlarmSnoozed = false;
        alarmSnoozeUntil = null;
    }, 15 * 60 * 1000);
}

function stopAlarm() {
    const alarm = document.getElementById('dueAlarm');
    const banner = document.getElementById('alarmBanner');

    if (alarm) {
        alarm.pause();
        alarm.currentTime = 0;
    }

    if (banner) {
        banner.style.display = 'none';
        banner.classList.remove('pulse-animation');
    }

    document.title = "Invoice Manager";
    isAlarmSnoozed = false;
    alarmSnoozeUntil = null;
    if (typeof titleInterval !== 'undefined') {
        clearInterval(titleInterval);
        titleInterval = null;
    }
}	