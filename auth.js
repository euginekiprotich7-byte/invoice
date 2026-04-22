async function checkPass() {
    // 1. Prompt for password
    const pass = prompt("Enter System Password:");
    
    if (pass === "E") { 
        // Show the app container
        document.getElementById('mainBody').style.display = 'block'; 
        
        // 2. Load Employers FIRST (Essential so currentEmployerId exists)
        await loadEmployers(); 
        
        // 3. Priming the Alarm Audio
        // Browsers block sound unless the user interacts. This "wakes it up".
        const alarm = document.getElementById('dueAlarm');
        if (alarm) {
            alarm.play().then(() => {
                alarm.pause(); 
                alarm.currentTime = 0;
            }).catch(() => console.log("Audio primed and waiting for first interaction."));
        }

        // 4. Request Push Notification Permissions
        if ("Notification" in window) {
            if (Notification.permission !== "granted" && Notification.permission !== "denied") {
                await Notification.requestPermission();
            }
        }

        // 5. Initial Data Fetch (Populates tables and calculates totals)
        if (typeof fetchTasks === 'function') {
            await fetchTasks();
        }

    } else { 
        // Lock out unauthorized users
        document.body.innerHTML = `
            <div style="height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; font-family:sans-serif;">
                <h1 style="color:#e74c3c;">⚠️ Unauthorized Access</h1>
                <p>Please refresh and enter the correct credentials.</p>
                <button onclick="location.reload()" style="padding:10px 20px; cursor:pointer;">Retry</button>
            </div>
        `; 
    }
}

// Initializing the app display
document.addEventListener('DOMContentLoaded', () => {
	window.onload = checkPass;
    document.getElementById('mainBody').style.display = 'block';
    updateUIStatus(); // Updated name
    loadEmployers();
});