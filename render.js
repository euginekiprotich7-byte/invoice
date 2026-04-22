async function renderActive(tasks) {
    const body = document.getElementById('tableBody');
    if (!body) return;

    // 1. Fetch employer names for the headers
    const { data: employersList } = await supabaseClient.from('employers').select('id, employer_name');
    
    let tableHTML = ''; 
    let totalGross = 0;
    let totalAdj = 0;

    // 2. Group tasks by Employer ID
    const employerGroups = tasks.reduce((acc, t) => {
        const empId = t.employer_id || 'unassigned';
        if (!acc[empId]) acc[empId] = [];
        acc[empId].push(t);
        return acc;
    }, {});

    // 3. Loop through Employer Groups
    for (let empId in employerGroups) {
        const empMatch = (employersList || []).find(e => e.id === empId);
        const empName = empMatch ? empMatch.employer_name : 'Unassigned/Direct';
        
        let empGross = 0;
        let empAdj = 0;

        // Add Employer Header
        tableHTML += `
            <tr class="employer-header">
                <td colspan="7" style="background:#2c3e50; color:white; font-weight:bold; padding:12px; font-size: 14px;">
                    🏢 EMPLOYER: ${empName.toUpperCase()}
                </td>
            </tr>`;

        // 4. Sub-group these tasks by CLIENT_NAME
        const clientGroups = employerGroups[empId].reduce((acc, t) => {
            const client = t.client_name || 'No Client';
            if (!acc[client]) acc[client] = [];
            acc[client].push(t);
            return acc;
        }, {});

        for (let clientName in clientGroups) {
            // Add Client Sub-Header
            tableHTML += `
                <tr class="client-header-row">
                    <td colspan="7" class="client-header-cell" style="background: #f1f8ff; color: #0366d6; font-weight: bold; padding: 8px 15px; border-left: 4px solid #0366d6;">
                        👤 Client: ${clientName}
                    </td>
                </tr>`;

            // 5. Render individual tasks
            clientGroups[clientName].forEach(t => {
                const isAdj = t.task_type === 'Adjustment' || t.task_detail.toLowerCase().includes('adjustment');
                const val = parseFloat(t.payable) || 0;

                if (t.status !== 'Cancelled') {
                    if (isAdj) { empAdj += val; totalAdj += val; }
                    else { empGross += val; totalGross += val; }
                }

                tableHTML += `
                    <tr class="${t.status === 'Cancelled' ? 'cancelled-row' : ''}">
                        <td style="${isAdj ? 'color:#e67e22; font-style:italic;' : ''}">${t.task_detail}</td>
                        <td>${isAdj ? '-' : t.units}</td>
                        <td>${t.cpp}</td>
                        <td style="font-weight:bold;">${val.toLocaleString()}</td>
                        <td class="time-column" data-deadline="${t.deadline}">...</td>
                        <td><span class="status-pending">${t.status}</span></td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button onclick="markAsDone('${t.id}')" class="btn-done">Done</button>
                                <button onclick="updateStatus('${t.id}','Cancelled')" class="btn" style="background:#bdc3c7; padding:2px 8px; font-size:10px;">X</button>
                            </div>
                        </td>
                    </tr>`;
            });
        }

        // Add Employer Summary Row
        tableHTML += `
            <tr style="background:#fdfefe; font-weight:bold; border-bottom: 2px solid #2c3e50;">
                <td colspan="3" style="text-align:right; padding:10px;">${empName} Total:</td>
                <td colspan="4" style="color:#2c3e50; padding:10px;">
                    KES ${(empGross + empAdj).toLocaleString()}
                </td>
            </tr>`;
    }

    // 6. Inject all HTML at once (Better Performance)
    body.innerHTML = tableHTML;

    // 7. Update Footer Stats
    if (document.getElementById('subTotal')) document.getElementById('subTotal').innerText = totalGross.toLocaleString();
    if (document.getElementById('adjTotal')) document.getElementById('adjTotal').innerText = totalAdj.toLocaleString();
    if (document.getElementById('grandTotal')) document.getElementById('grandTotal').innerText = (totalGross + totalAdj).toLocaleString();
}

async function renderEmployerList() {
    // 1. Identify the container (Matches your id="employer-tabs" in HTML)
    const list = document.getElementById('employer-tabs');
    if (!list) return;

    // 2. Fetch Employers from Supabase
    const { data: employers, error } = await supabaseClient
        .from('employers')
        .select('*')
        .order('employer_name', { ascending: true });

    if (error) {
        console.error("Error loading employers:", error.message);
        return;
    }

    // 3. Clear existing tabs
    list.innerHTML = '';

    // 4. Create a Tab for each Employer
    employers.forEach(emp => {
        const btn = document.createElement('button');
        
        // Apply styling class or inline styles
        btn.className = 'btn';
        btn.style.marginRight = '5px';
        btn.style.padding = '10px 15px';
        btn.style.cursor = 'pointer';
        btn.style.borderRadius = '8px';
        btn.style.border = '1px solid #ddd';
        
        // Check if this is the currently selected employer to highlight it
        if (currentEmployerId === emp.id) {
            btn.style.background = '#3498db';
            btn.style.color = 'white';
        } else {
            btn.style.background = '#fff';
            btn.style.color = '#333';
        }

        btn.innerHTML = `🏢 ${emp.employer_name}`;

        // 5. Handle Click Event
        btn.onclick = async () => {
            currentEmployerId = emp.id;
            currentEmployerRate = emp.rate || 300; // Update global rate for new tasks
            
            // Set the default CPP in the input field based on employer rate
            const cppInput = document.getElementById('cpp');
            if (cppInput) cppInput.value = currentEmployerRate;

            console.log(`Switching to Employer: ${emp.employer_name}`);
            
            // Refresh the list to update tab highlighting
            renderEmployerList();
            
            // Fetch tasks for this specific employer
            await fetchTasks();
        };

        list.appendChild(btn);
    });

    // 6. Handle "No Employers" state
    if (employers.length === 0) {
        list.innerHTML = '<small style="color:#666; padding:10px;">No employers registered. Use the form above to start.</small>';
    }
}
function updateStats(tasks) {
    // 1. Calculate PENDING (Active) Total
    const activeTotal = tasks
        .filter(t => t.status === 'Pending')
        .reduce((sum, t) => sum + (parseFloat(t.payable) || 0), 0);

    // 2. Calculate COMPLETED (Done) Total
    const doneTotal = tasks
        .filter(t => t.status === 'Done')
        .reduce((sum, t) => sum + (parseFloat(t.payable) || 0), 0);
        
    // 3. Calculate Adjustments (if you have specific 'Adjustment' status or detail)
    const adjustmentTotal = tasks
        .filter(t => t.task_detail.toLowerCase().includes('adjustment'))
        .reduce((sum, t) => sum + (parseFloat(t.payable) || 0), 0);

    // 4. Update the Dashboard Stat Boxes (Top of page)
    const activeEl = document.getElementById('activeTotal');
    const doneEl = document.getElementById('doneTotal');
    
    if (activeEl) activeEl.innerText = activeTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 });
    if (doneEl) doneEl.innerText = doneTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 });

    // 5. Update the "Done Subtotal" in the Completed Tab
    const doneTabSubtotal = document.getElementById('done-subtotal-display');
    if (doneTabSubtotal) doneTabSubtotal.innerText = doneTotal.toFixed(2);

    // 6. Update the Table Footers (Active Tab)
    const subTotalEl = document.getElementById('subTotal');
    const adjTotalEl = document.getElementById('adjTotal');
    const grandTotalEl = document.getElementById('grandTotal');

    if (subTotalEl) subTotalEl.innerText = (activeTotal - adjustmentTotal).toFixed(2);
    if (adjTotalEl) adjTotalEl.innerText = adjustmentTotal.toFixed(2);
    if (grandTotalEl) grandTotalEl.innerText = activeTotal.toFixed(2);
}