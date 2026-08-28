/* =========================================================
   REALTIME.JS
   Keeps every device in sync instantly: as soon as one phone/
   laptop adds, edits, or completes an order, every other device
   with the app open refreshes automatically (no manual refresh,
   no polling delay).

   Uses Supabase Realtime (Postgres change feed), which is already
   part of the project you're on - nothing extra to install.
   ========================================================= */

function initRealtimeSync() {
    if (!window.supabaseClient || typeof supabaseClient.channel !== 'function') return;

    let refreshTimer = null;
    function scheduleRefresh() {
        // Debounce: several changes arriving in a burst only trigger one UI refresh.
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            if (window.__offline) await window.__offline.cacheFullSnapshot();
            if (typeof loadEmployers === 'function') await loadEmployers();
            if (typeof fetchTasks === 'function') await fetchTasks();
        }, 400);
    }

    supabaseClient
        .channel('invoice-manager-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employers' }, scheduleRefresh)
        .subscribe((status) => {
            console.log('Realtime sync channel:', status);
        });
}

document.addEventListener('DOMContentLoaded', () => {
    // Give the inline script a tick to create supabaseClient first.
    setTimeout(initRealtimeSync, 0);
});
