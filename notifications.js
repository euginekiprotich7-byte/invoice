let titleInterval = null;

function triggerAlarm(taskName) {
    const alarm = document.getElementById('dueAlarm');
    const banner = document.getElementById('alarmBanner');

    const displayName = taskName || "An Assignment";

    // 1. Visual Alert with Pulsing Effect
    if (banner) {
        banner.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>🚨 <b>${displayName}</b> IS DUE!</span>
                <button onclick="stopAlarm()" style="background:white; color:red; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">DISMISS</button>
            </div>`;
        banner.style.display = 'block';
        banner.classList.add('pulse-animation'); // Assuming you have a CSS pulse keyframe
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
                icon: "https://cdn-icons-png.flaticon.com/512/1827/1827347.png",
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
    stopAlarm(); // Hide banner and stop audio
    
    window.isSnoozed = true;
    let secondsLeft = 15 * 60; // 15 minutes in seconds
    const display = document.getElementById('snoozeCountdown');
    
    display.innerText = `Snoozed: 15:00`;
    
    snoozeTimer = setInterval(() => {
        secondsLeft--;
        let mins = Math.floor(secondsLeft / 60);
        let secs = secondsLeft % 60;
        display.innerText = `Snoozed: ${mins}:${secs < 10 ? '0'+secs : secs}`;
        
        if (secondsLeft <= 0) {
            clearInterval(snoozeTimer);
            window.isSnoozed = false;
            display.innerText = "";
            console.log("Snooze ended, alarm re-enabled.");
        }
    }, 1000);
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
    if (typeof titleInterval !== 'undefined') {
        clearInterval(titleInterval);
        titleInterval = null;
    }
}	