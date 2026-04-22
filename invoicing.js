async function renderDoneTable(tasks) {
    const container = document.getElementById('doneTableBody');
    const doneDashboardDisplay = document.getElementById('doneTotal'); // This targets the green box
    
    if (!container) return;

    // Reset total if no tasks
    if (!tasks || tasks.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px; color:#95a5a6;">
                <h3>✅ Completed Orders</h3>
                <p>No tasks are currently marked as 'Done'.</p>
            </div>`;
        if (doneDashboardDisplay) doneDashboardDisplay.innerText = "0.00";
        return;
    }

    const { data: employersList } = await supabaseClient.from('employers').select('id, employer_name');

    // FIXED GROUPING LOGIC
    const grouped = tasks.reduce((acc, t) => {
        const empId = t.employer_id || 'unassigned';
        if (!acc[empId]) acc[empId] = []; // Fixed the syntax error here
        acc[empId].push(t);
        return acc;
    }, {});
    
    let html = '<h3 style="margin-bottom:20px; color:#2c3e50;">✅ Completed Orders (Ready for Invoice)</h3>';
    let globalDoneTotal = 0; 
    
    for (const empId in grouped) {
        const eTasks = grouped[empId];
        const empMatch = (employersList || []).find(e => e.id === empId);
        const employerName = empMatch ? empMatch.employer_name : "Direct/Unassigned";

        const subtotal = eTasks.reduce((sum, t) => sum + (parseFloat(t.payable) || 0), 0);
        globalDoneTotal += subtotal; 

        html += `
            <div class="card" style="margin-bottom: 25px; border-left: 5px solid #27ae60; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 15px; background:#f9fdfa;">
                    <h4 style="margin:0; color:#27ae60;">🏢 ${employerName.toUpperCase()}</h4>
                    <span style="font-weight:bold; color:#2c3e50;">Subtotal: KES ${subtotal.toLocaleString()}</span>
                </div>
                
                <table style="width:100%; border-collapse:collapse; margin:10px 0;">
                    <thead style="background:#f1f2f6; font-size:12px;">
                        <tr>
                            <th style="padding:8px; text-align:left;">Client / Detail</th>
                            <th style="padding:8px; text-align:center;">Units</th>
                            <th style="padding:8px; text-align:right;">Payable</th>
                            <th style="padding:8px; text-align:center;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${eTasks.map(t => `
                            <tr style="border-bottom:1px solid #eee; font-size:13px;">
                                <td style="padding:8px;">
                                    <small style="color:#7f8c8d; display:block;">${t.client_name}</small>
                                    ${t.task_detail}
                                </td>
                                <td style="padding:8px; text-align:center;">${t.units || '-'}</td>
                                <td style="padding:8px; text-align:right; font-weight:600;">${parseFloat(t.payable).toLocaleString()}</td>
                                <td style="padding:8px; text-align:center;">
                                    <button class="btn-small" onclick="updateStatus('${t.id}', 'Pending')" 
                                        style="background:#bdc3c7; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer;">
                                        Undo
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div style="display:flex; gap:10px; padding:10px 15px; background:#f8f9fa;">
                    <button class="btn" style="background:#2980b9; flex:1;" onclick="generateWordInvoice('${empId}', '${employerName}')">
                        📄 Word Invoice
                    </button>
                    <button class="btn" style="background:#27ae60; flex:1;" onclick="generateExcelInvoice('${empId}', '${employerName}')">
                        📊 Excel Invoice
                    </button>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;

    // UPDATES THE GREEN BOX
    if (doneDashboardDisplay) {
        doneDashboardDisplay.innerText = globalDoneTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 });
    }
}

function renderHistoryTable(tasks) {
    const body = document.getElementById('historyTableBody');
    if (!body) return;

    body.innerHTML = tasks.map(t => `
        <tr>
            <td>${t.invoice_no || 'N/A'}</td>
            <td>${t.task_detail}</td>
            <td>${t.payable.toLocaleString()}</td>
            <td><span class="status-paid">${t.status}</span></td>
        </tr>
    `).join('');
}