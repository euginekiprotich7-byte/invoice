/* =========================================================
   OFFLINE.JS
   Local IndexedDB cache + write queue so the app keeps working
   with zero internet connection, and syncs everything back up
   the moment the connection returns.

   Loaded AFTER index.html's inline <script>, so it can wrap the
   existing saveTask / saveEmployer / markAsDone / deleteTask /
   fetchTasks / loadEmployers functions without changing them.
   ========================================================= */

const DB_NAME = 'invoice-manager-db';
const DB_VERSION = 1;

function openAppDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('employers')) db.createObjectStore('employers', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('pending_writes')) db.createObjectStore('pending_writes', { keyPath: 'localId', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPutAll(storeName, rows) {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        (rows || []).forEach(row => store.put(row));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGetAll(storeName) {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function idbQueueWrite(entry) {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pending_writes', 'readwrite');
        const req = tx.objectStore('pending_writes').add({ ...entry, queuedAt: Date.now() });
        req.onsuccess = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGetQueue() { return idbGetAll('pending_writes'); }

async function idbClearQueueItem(localId) {
    const db = await openAppDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pending_writes', 'readwrite');
        tx.objectStore('pending_writes').delete(localId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function setSyncStatus(text, cls) {
    const el = document.getElementById('statusIndicator');
    if (!el) return;
    el.innerText = text;
    el.className = cls || (navigator.onLine ? 'online' : 'offline');
}

/* Pull every row down (not just the active employer's) so the
   whole app - and the notification engine / service worker - has
   real data to work from offline. */
async function cacheFullSnapshot() {
    if (!navigator.onLine) return;
    try {
        const [tasksRes, empRes] = await Promise.all([
            supabaseClient.from('tasks').select('*'),
            supabaseClient.from('employers').select('*')
        ]);
        if (!tasksRes.error && tasksRes.data) await idbPutAll('tasks', tasksRes.data);
        if (!empRes.error && empRes.data) await idbPutAll('employers', empRes.data);
    } catch (err) {
        console.warn('Snapshot cache skipped:', err.message);
    }
}

async function flushPendingWrites() {
    if (!navigator.onLine) return;
    const queue = await idbGetQueue();
    if (!queue.length) return;

    setSyncStatus(`Syncing ${queue.length} offline change(s)...`, 'online');

    for (const item of queue) {
        try {
            const q = supabaseClient.from(item.table);
            if (item.method === 'insert') await q.insert([item.payload]);
            else if (item.method === 'update') await q.update(item.payload).eq('id', item.match.id);
            else if (item.method === 'delete') await q.delete().eq('id', item.match.id);
            await idbClearQueueItem(item.localId);
        } catch (err) {
            console.error('Failed to replay a queued write, will retry later:', err);
            break; // preserve order: stop and retry the rest next time
        }
    }

    await cacheFullSnapshot();
    if (typeof loadEmployers === 'function') await loadEmployers();
    if (typeof fetchTasks === 'function') await fetchTasks();
    setSyncStatus('ONLINE', 'online');
}

/* Minimal offline CPP table - mirrors the one inside index.html's
   saveTask(), used only when we can't reach the real function. */
const OFFLINE_CPP_TABLE = {
    'Pages': 300, 'Pages-urgent': 350, 'Quiz': 1000, 'Quiz-tech': 1500,
    'Midterm': 1500, 'PPT': 150, 'PPT-standard': 200,
    'Technical-2000': 2000, 'Technical-2500': 2500,
    'Infographic-1000': 1000, 'Infographic-1500': 1500
};

async function offlineSaveTask() {
    const client = document.getElementById('clientInput')?.value.trim();
    const detail = document.getElementById('detailInput')?.value.trim();
    const type = document.getElementById('typeInput')?.value;
    const units = parseFloat(document.getElementById('unitsInput')?.value) || 0;
    const deadline = document.getElementById('deadlineInput')?.value;
    const customCpp = parseFloat(document.getElementById('customCppInput')?.value);
    const alertLead = parseFloat(document.getElementById('alertLeadInput')?.value) || 1;

    if (!client || units <= 0 || !window.currentEmployerId) {
        alert("Please fill in Client, Units, and select an Employer!");
        return;
    }

    let cpp = OFFLINE_CPP_TABLE[type] ?? window.currentEmployerRate ?? 0;
    if (!isNaN(customCpp) && customCpp > 0) cpp = customCpp;

    const tempId = 'offline-' + Date.now();
    const payload = {
        id: tempId, client_name: client, task_detail: detail, task_type: type,
        units, cpp, payable: units * cpp, deadline, employer_id: window.currentEmployerId,
        alert_lead_hours: alertLead, status: 'Pending', notified: false
    };

    await idbQueueWrite({ table: 'tasks', method: 'insert', payload: withoutId(payload) });
    await appendToCache('tasks', payload);

    document.getElementById('clientInput').value = '';
    document.getElementById('detailInput').value = '';
    document.getElementById('customCppInput').value = '';
    document.getElementById('unitsInput').value = '1';

    setSyncStatus('OFFLINE - Order saved locally', 'offline');
    if (typeof fetchTasks === 'function') await fetchTasks();
}

async function offlineSaveEmployer() {
    const name = document.getElementById('newEmployerName')?.value.trim();
    const rate = parseFloat(document.getElementById('employerRate')?.value) || 300;
    if (!name) return alert('Enter employer name');

    const tempId = 'offline-emp-' + Date.now();
    const payload = { id: tempId, employer_name: name, rate_per_unit: rate };

    await idbQueueWrite({ table: 'employers', method: 'insert', payload: withoutId(payload) });
    await appendToCache('employers', payload);

    window.currentEmployerId = tempId;
    window.currentEmployerRate = rate;
    setSyncStatus('OFFLINE - Employer saved locally', 'offline');
    if (typeof loadEmployers === 'function') await loadEmployers();
}

async function offlineMarkAsDone(id) {
    await idbQueueWrite({ table: 'tasks', method: 'update', match: { id }, payload: { status: 'Done' } });
    await patchCache('tasks', id, { status: 'Done' });
    setSyncStatus('OFFLINE - Change saved locally', 'offline');
    if (typeof fetchTasks === 'function') await fetchTasks();
}

async function offlineDeleteTask(id) {
    await idbQueueWrite({ table: 'tasks', method: 'delete', match: { id } });
    await removeFromCache('tasks', id);
    setSyncStatus('OFFLINE - Change saved locally', 'offline');
    if (typeof fetchTasks === 'function') await fetchTasks();
}

function withoutId(obj) { const { id, ...rest } = obj; return rest; } // real inserts let Supabase generate the id
async function appendToCache(store, row) { const rows = await idbGetAll(store); rows.push(row); await idbPutAll(store, rows); }
async function patchCache(store, id, patch) {
    const rows = await idbGetAll(store);
    const idx = rows.findIndex(r => r.id === id);
    if (idx > -1) rows[idx] = { ...rows[idx], ...patch };
    await idbPutAll(store, rows);
}
async function removeFromCache(store, id) { const rows = await idbGetAll(store); await idbPutAll(store, rows.filter(r => r.id !== id)); }

/* Wrap the page's existing functions. Online calls behave exactly
   as before; only actual failures fall back to the offline path. */
function wrapOnlineFirst(name, offlineHandler) {
    const original = window[name];
    window[name] = async function (...args) {
        if (navigator.onLine && typeof original === 'function') {
            try { return await original.apply(this, args); }
            catch (err) { console.warn(`${name} failed online, falling back offline:`, err.message); }
        }
        return offlineHandler(...args);
    };
}

function wrapFetchTasksForOffline() {
    const original = window.fetchTasks;
    window.fetchTasks = async function (...args) {
        if (navigator.onLine) {
            try { return await original.apply(this, args); }
            catch (err) { console.warn('fetchTasks failed online, showing cached data:', err.message); }
        }
        const all = await idbGetAll('tasks');
        const data = window.currentEmployerId ? all.filter(t => t.employer_id === window.currentEmployerId) : all;
        window.allTasks = data;
        if (typeof renderActive === 'function') renderActive(data.filter(t => t.status === 'Pending'));
        if (typeof renderDoneTable === 'function') renderDoneTable(data.filter(t => t.status === 'Done'));
        if (typeof renderHistory === 'function') renderHistory(data.filter(t => t.status === 'Paid' || t.status === 'Cancelled'));
        if (typeof updateDashboardTotals === 'function') updateDashboardTotals(data);
    };
}

function wrapLoadEmployersForOffline() {
    const original = window.loadEmployers;
    window.loadEmployers = async function (...args) {
        if (navigator.onLine) {
            try { return await original.apply(this, args); }
            catch (err) { console.warn('loadEmployers failed online, showing cached data:', err.message); }
        }
        const employers = await idbGetAll('employers');
        const allTasks = await idbGetAll('tasks');
        const container = document.getElementById('employer-tabs');
        if (!container) return;
        container.innerHTML = '';
        employers.forEach(emp => {
            const tasks = allTasks.filter(t => t.employer_id === emp.id);
            const pending = tasks.filter(t => t.status === 'Pending').reduce((s, t) => s + (parseFloat(t.payable) || 0), 0);
            const done = tasks.filter(t => t.status === 'Done').reduce((s, t) => s + (parseFloat(t.payable) || 0), 0);
            const card = document.createElement('div');
            card.className = 'employer-card';
            card.innerHTML = `<div class="emp-name">${emp.employer_name}</div>
                <div class="emp-rate">KES ${emp.rate_per_unit}/unit</div>
                <div class="emp-stats"><span class="pending">P: ${pending.toLocaleString()}</span><span class="done">D: ${done.toLocaleString()}</span></div>`;
            card.onclick = () => {
                window.currentEmployerId = emp.id;
                window.currentEmployerRate = emp.rate_per_unit;
                document.querySelectorAll('.employer-card').forEach(el => el.classList.remove('active'));
                card.classList.add('active');
                fetchTasks();
            };
            container.appendChild(card);
        });
    };
}

async function initOfflineLayer() {
    wrapFetchTasksForOffline();
    wrapLoadEmployersForOffline();
    wrapOnlineFirst('saveTask', offlineSaveTask);
    wrapOnlineFirst('saveEmployer', offlineSaveEmployer);
    wrapOnlineFirst('markAsDone', offlineMarkAsDone);
    wrapOnlineFirst('deleteTask', offlineDeleteTask);

    await cacheFullSnapshot();
    if (!navigator.onLine) setSyncStatus('OFFLINE - Saving Locally', 'offline');
    else await flushPendingWrites();

    window.addEventListener('online', async () => {
        setSyncStatus('ONLINE - Syncing...', 'online');
        await flushPendingWrites();
    });
    window.addEventListener('offline', () => setSyncStatus('OFFLINE - Saving Locally', 'offline'));
}

document.addEventListener('DOMContentLoaded', initOfflineLayer);

window.__offline = { openAppDB, idbGetAll, idbPutAll, cacheFullSnapshot, flushPendingWrites };
