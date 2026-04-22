let deferredPrompt;

async function displayVersion() {
    try {
        const response = await fetch('./manifest.json');
        const manifest = await response.json();
        const versionDisplay = document.getElementById('app-version-display');
        if (versionDisplay && manifest.version) {
            versionDisplay.innerText = `v${manifest.version}`;
        }
    } catch (err) {
        console.log("Manifest version fetch failed.");
    }
}

// Call it when the page loads
displayVersion();

/**
 * The 60-Second Database Heartbeat
 * Refreshes data and checks if any deadlines have expired.
 */
function startHeartbeat() {
    setInterval(async () => {
        console.log("💓 Heartbeat: Checking for updates...");
        
        if (typeof fetchTasks === 'function') {
            await fetchTasks();
        }

        // Check for expired deadlines to trigger alarm
        document.querySelectorAll('.time-column').forEach(cell => {
            const deadlineStr = cell.getAttribute('data-deadline');
            if (!deadlineStr) return;

            const diff = new Date(deadlineStr) - new Date();
            if (diff <= 0 && !isAlarmSnoozed) {
                triggerAlarm();
            }
        });
    }, 60000);
}

// Initialize Lifecycle
document.addEventListener('DOMContentLoaded', () => {
    displayVersion();
    startHeartbeat();
});

/**
 * 2. THE PWA INSTALLER
 */
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installBtn');
    if (installBtn) installBtn.style.display = 'block';
});

async function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const installBtn = document.getElementById('installBtn');
        if (installBtn) installBtn.style.display = 'none';
    }
    deferredPrompt = null;
}

/**
 * 3. VERSION & HEARTBEAT
 */
function updateAppVersionUI() {
    const version = "1.0.5"; 
    const versionTag = document.getElementById('version-tag');
    if (versionTag) versionTag.innerText = `v${version}`;
}

function startHeartbeat() {
    setInterval(async () => {
        if (typeof fetchTasks === 'function') await fetchTasks();
        checkDeadlinesForAlarm();
    }, 60000);
}

function checkDeadlinesForAlarm() {
    document.querySelectorAll('.time-column').forEach(cell => {
        const timeText = cell.innerText;
        if (timeText.includes("DUE NOW") && !isAlarmSnoozed) {
            triggerAlarm();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updateAppVersionUI();
    startHeartbeat();
});