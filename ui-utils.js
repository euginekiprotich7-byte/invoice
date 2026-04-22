// Global helper to show/hide specific forms (like Adjustment or Setup)
function toggleAddForm(id) {
    const f = document.getElementById(id); 
    if (!f) {
        console.warn(`Element with ID "${id}" not found.`);
        return;
    }

    // Get the actual computed style to avoid the "first click does nothing" bug
    const isHidden = window.getComputedStyle(f).display === 'none';
    
    if (isHidden) {
        f.style.display = 'block';
        // Optional: focus the first input inside the form for better UX
        const firstInput = f.querySelector('input');
        if (firstInput) firstInput.focus();
    } else {
        f.style.display = 'none';
    }
}

// 1. Update volume in real-time
		function updateVolume(val) {
			const alarm = document.getElementById('dueAlarm');
			alarm.volume = val;
		}
/** * 3. CONNECTION & SYNC MONITOR
 * Detects when you're back in range of a stable signal.
 */
window.addEventListener('online', async () => {
    const el = document.getElementById('statusIndicator');
    if (el) {
        el.className = 'online';
        el.innerText = 'ONLINE - Syncing...';
    }

    // Trigger your background sync function
    if (typeof forceSync === 'function') {
        await forceSync();
        el.innerText = 'ONLINE';
    }
});

window.addEventListener('offline', () => {
    const el = document.getElementById('statusIndicator');
    if (el) {
        el.innerText = "OFFLINE - Saving Locally";
        el.className = "offline";
    }
});

// 4. The 1-Second UI Ticker (Countdown Logic)
setInterval(() => {
    document.querySelectorAll('.time-column').forEach(cell => {
        const deadlineStr = cell.getAttribute('data-deadline');
        if (!deadlineStr || deadlineStr === "undefined") {
            cell.innerText = "—";
            return;
        }

        const diff = new Date(deadlineStr) - new Date();

        if (diff <= 0) {
            cell.innerText = "DUE NOW";
            cell.style.cssText = "color: #e74c3c; font-weight: bold; animation: blink 1s infinite;";
        } else {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            cell.innerText = `${h}h ${m}m ${s}s`;
            cell.style.color = (h < 1) ? "#f39c12" : "inherit";
        }
    });
}, 1000);