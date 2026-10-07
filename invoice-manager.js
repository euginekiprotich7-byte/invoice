/* =========================================================
   INVOICE-MANAGER.JS
   Persistent invoice lifecycle:
   - saves advances, refunds, deductions and previous balance
   - archives included orders under a unique invoice number
   - keeps invoice status independent from task status
   - provides Word/Excel exports from the saved invoice
   ========================================================= */

let invoiceHistoryCache = [];

function money(value) {
    return (Number(value) || 0).toLocaleString('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[ch]));
}

function invoiceAdjustments() {
    return {
        advances: Math.max(0, Number(document.getElementById('adjPlus')?.value) || 0),
        refunds: Math.max(0, Number(document.getElementById('adjRefund')?.value) || 0),
        deductibles: Math.max(0, Number(document.getElementById('adjMinus')?.value) || 0),
        previousBalance: Math.max(0, Number(document.getElementById('adjPrevious')?.value) || 0)
    };
}

async function getDoneTasksForInvoice() {
    if (!currentEmployerId) return [];
    const { data, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('employer_id', currentEmployerId)
        .eq('status', 'Done')
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function getPreviousOutstandingBalance() {
    if (!currentEmployerId) return 0;

    let data = null;
    if (navigator.onLine) {
        const { data: onlineData, error } = await supabaseClient
            .from('invoices')
            .select('balance_due,status')
            .eq('employer_id', currentEmployerId)
            .eq('status', 'Unpaid');
        if (!error) data = onlineData || [];
    }
    if (!data && window.__offline) {
        const cached = await window.__offline.idbGetAll('invoices');
        data = cached.filter(i => String(i.employer_id) === String(currentEmployerId) && i.status === 'Unpaid');
    }
    return (data || []).reduce((sum, row) => sum + Math.max(0, Number(row.balance_due) || 0), 0);
}

async function loadInvoiceAdjustmentDefaults() {
    if (!currentEmployerId) return;

    const previous = await getPreviousOutstandingBalance();
    const input = document.getElementById('adjPrevious');
    const hint = document.getElementById('previousBalanceHint');

    if (input && document.activeElement !== input) input.value = previous.toFixed(2);
    if (hint) hint.textContent = `Previous outstanding: KES ${money(previous)}`;

    calculateFinalPayable();
}

function calculateFinalPayable() {
    const tasks = (window.allTasks || []).filter(t =>
        t.employer_id === currentEmployerId && t.status === 'Done'
    );
    const subtotal = tasks.reduce((sum, t) => sum + (Number(t.payable) || 0), 0);
    const adj = invoiceAdjustments();
    const deductionsTotal = adj.advances + adj.refunds + adj.deductibles;
    const final = Math.max(0, subtotal + adj.previousBalance - deductionsTotal);

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = `KES ${money(value)}`;
    };

    set('invoiceSubtotalDisplay', subtotal);
    set('invoicePreviousDisplay', adj.previousBalance);
    set('invoiceAdjustmentsDisplay', -deductionsTotal);
    set('finalTotalDisplay', final);

    return { subtotal, ...adj, deductionsTotal, final };
}

async function createInvoiceRecord() {
    if (!currentEmployerId) {
        alert('Please select an employer first.');
        return null;
    }

    const tasks = await getDoneTasksForInvoice();
    if (!tasks.length) {
        alert('There are no completed orders ready for invoicing.');
        return null;
    }

    const calc = calculateFinalPayable();
    const employer = (allEmployers || []).find(e => e.id === currentEmployerId);
    const invoiceNo = `INV-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`;

    const { data: invoice, error: invoiceError } = await supabaseClient
        .from('invoices')
        .insert([{
            invoice_no: invoiceNo,
            employer_id: String(currentEmployerId),
            employer_name: employer?.employer_name || 'Employer',
            subtotal: calc.subtotal,
            previous_balance: calc.previousBalance,
            advances: calc.advances,
            refunds: calc.refunds,
            deductibles: calc.deductibles,
            balance_due: calc.final,
            status: 'Unpaid'
        }])
        .select()
        .single();

    if (invoiceError) {
        alert(`Invoice could not be saved: ${invoiceError.message}\n\nRun the included supabase_invoice_migration.sql first if you have not already done so.`);
        return null;
    }

    const taskIds = tasks.map(t => t.id);
    const { error: archiveError } = await supabaseClient
        .from('tasks')
        .update({ status: 'Invoiced', invoice_no: invoiceNo })
        .in('id', taskIds);

    if (archiveError) {
        await supabaseClient.from('invoices').delete().eq('id', invoice.id);
        alert(`Invoice was not archived because the orders could not be moved to invoice ${invoiceNo}: ${archiveError.message}`);
        return null;
    }

    return { invoice, tasks, calc, employer };
}

function resetInvoiceAdjustments() {
    ['adjPlus','adjRefund','adjMinus','adjPrevious'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '0';
    });
    const hint = document.getElementById('previousBalanceHint');
    if (hint) hint.textContent = 'Previous outstanding: KES 0.00';
    calculateFinalPayable();
}

async function generateAndSaveInvoice(format = 'word') {
    try {
        const result = await createInvoiceRecord();
        if (!result) return;

        if (format === 'excel') {
            await exportSavedInvoiceExcel(result.invoice, result.tasks, result.calc, result.employer);
        } else {
            await exportSavedInvoiceWord(result.invoice, result.tasks, result.calc, result.employer);
        }

        resetInvoiceAdjustments();
        await fetchTasks();
        await renderInvoiceHistory();
        alert(`Invoice ${result.invoice.invoice_no} was generated and the completed orders were moved to History as Unpaid.`);
    } catch (err) {
        console.error('Invoice generation failed:', err);
        alert(`Invoice generation failed: ${err.message || err}`);
    }
}

function invoiceStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'paid') return 'status-paid';
    if (normalized === 'refunded') return 'status-refunded';
    if (normalized === 'canceled' || normalized === 'cancelled') return 'status-canceled';
    return 'status-unpaid';
}

async function updateInvoiceStatus(id, status) {
    if (!id) return;
    const messages = {
        Paid: 'Mark this invoice as PAID?',
        Unpaid: 'Move this invoice back to UNPAID?',
        Refunded: 'Mark this invoice as REFUNDED?',
        Canceled: 'Mark this invoice as CANCELED?'
    };
    if (!confirm(messages[status] || `Set invoice status to ${status}?`)) return;

    const { error } = await supabaseClient
        .from('invoices')
        .update({ status })
        .eq('id', id);

    if (error) {
        alert(`Could not update invoice: ${error.message}`);
        return;
    }

    await renderInvoiceHistory();
}

async function renderInvoiceHistory() {
    const body = document.getElementById('historyBody');
    if (!body) return;

    if (!currentEmployerId) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;">Select an employer to view invoices.</td></tr>';
        return;
    }

    let data = null;
    let error = null;

    if (navigator.onLine) {
        const response = await supabaseClient
            .from('invoices')
            .select('*')
            .eq('employer_id', currentEmployerId)
            .order('created_at', { ascending: false });
        data = response.data;
        error = response.error;
    } else if (window.__offline) {
        const cached = await window.__offline.idbGetAll('invoices');
        data = cached
            .filter(inv => String(inv.employer_id) === String(currentEmployerId))
            .sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    if (error && !data) {
        const cached = window.__offline ? await window.__offline.idbGetAll('invoices') : [];
        data = cached.filter(inv => String(inv.employer_id) === String(currentEmployerId));
    }

    invoiceHistoryCache = data || [];
    await loadInvoiceAdjustmentDefaults();
    const search = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
    const status = document.getElementById('historyStatusFilter')?.value || 'ALL';

    const filtered = invoiceHistoryCache.filter(inv => {
        const matchesSearch = !search ||
            String(inv.invoice_no || '').toLowerCase().includes(search) ||
            String(inv.employer_name || '').toLowerCase().includes(search);
        const matchesStatus = status === 'ALL' || inv.status === status ||
            (status === 'Canceled' && inv.status === 'Cancelled');
        return matchesSearch && matchesStatus;
    });

    if (!filtered.length) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;">No invoices match the selected filter.</td></tr>';
    } else {
        body.innerHTML = filtered.map(inv => {
            const adjustment = (Number(inv.advances)||0) + (Number(inv.refunds)||0) + (Number(inv.deductibles)||0);
            const date = inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-GB') : '-';
            return `
                <tr>
                    <td><strong>${esc(inv.invoice_no)}</strong></td>
                    <td>${date}</td>
                    <td>KES ${money(inv.subtotal)}</td>
                    <td>KES ${money(inv.previous_balance)}</td>
                    <td>-KES ${money(adjustment)}</td>
                    <td><strong>KES ${money(inv.balance_due)}</strong></td>
                    <td><span class="status-pill ${invoiceStatusClass(inv.status)}">${esc(inv.status)}</span></td>
                    <td>
                        <div class="invoice-action-group">
                            <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Paid')" style="background:#27ae60;color:#fff;">Paid</button>
                            <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Unpaid')" style="background:#f39c12;color:#fff;">Unpaid</button>
                            <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Refunded')" style="background:#8e44ad;color:#fff;">Refunded</button>
                            <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Canceled')" style="background:#e74c3c;color:#fff;">Cancel</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    const outstanding = invoiceHistoryCache
        .filter(i => i.status === 'Unpaid')
        .reduce((sum, i) => sum + Math.max(0, Number(i.balance_due)||0), 0);
    const paid = invoiceHistoryCache
        .filter(i => i.status === 'Paid')
        .reduce((sum, i) => sum + Math.max(0, Number(i.balance_due)||0), 0);

    const summary = document.getElementById('historySummary');
    if (summary) summary.textContent = `Unpaid: KES ${money(outstanding)} • Paid invoices: KES ${money(paid)}`;
}

async function exportSavedInvoiceExcel(invoice, tasks, calc, employer) {
    const rows = [
        ['INVOICE', invoice.invoice_no],
        ['Employer', employer?.employer_name || invoice.employer_name || 'Employer'],
        ['Date', new Date(invoice.created_at || Date.now()).toLocaleDateString('en-GB')],
        [],
        ['Client', 'Detail', 'Units', 'CPP', 'Payable']
    ];

    tasks.forEach(t => rows.push([
        t.client_name || '-',
        t.task_detail || '-',
        t.units || '-',
        Number(t.cpp) || 0,
        Number(t.payable) || 0
    ]));

    rows.push(
        [],
        ['Current Work Subtotal', '', '', '', calc.subtotal],
        ['Balance From Previous Invoices', '', '', '', calc.previousBalance],
        ['Less Advances', '', '', '', -calc.advances],
        ['Less Refunds', '', '', '', -calc.refunds],
        ['Less Deductibles', '', '', '', -calc.deductibles],
        ['FINAL BALANCE DUE', '', '', '', calc.final],
        ['STATUS', '', '', '', invoice.status]
    );

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
    XLSX.writeFile(wb, `Invoice_${invoice.invoice_no}.xlsx`);
}

async function exportSavedInvoiceWord(invoice, tasks, calc, employer) {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType } = docx;
    const grouped = {};
    tasks.forEach(t => {
        const client = t.client_name || 'Client';
        if (!grouped[client]) grouped[client] = [];
        grouped[client].push(t);
    });

    const children = [
        new Paragraph({ text: 'INVOICE', heading: 'Heading1', alignment: AlignmentType.CENTER }),
        new Paragraph({ children: [
            new TextRun({ text: 'Invoice #: ', bold: true }),
            new TextRun(invoice.invoice_no),
            new TextRun({ text: `    Date: ${new Date(invoice.created_at || Date.now()).toLocaleDateString('en-GB')}` })
        ]}),
        new Paragraph({ children: [
            new TextRun({ text: 'Billed To: ', bold: true }),
            new TextRun(employer?.employer_name || invoice.employer_name || 'Employer')
        ]})
    ];

    for (const [client, clientTasks] of Object.entries(grouped)) {
        children.push(new Paragraph({ children: [new TextRun({ text: client, bold: true, underline: {} })] }));
        children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: clientTasks.map(t => new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph(t.task_detail || '-')], width: {size:70,type:WidthType.PERCENTAGE} }),
                    new TableCell({ children: [new Paragraph({text:`KES ${money(t.payable)}`, alignment:AlignmentType.RIGHT})], width: {size:30,type:WidthType.PERCENTAGE} })
                ]
            }))
        }));
    }

    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
            new TextRun({ text: `Current Work Subtotal: KES ${money(calc.subtotal)}`, break: 1 }),
            new TextRun({ text: `Balance From Previous Invoices: +KES ${money(calc.previousBalance)}`, break: 1 }),
            new TextRun({ text: `Less Advances: -KES ${money(calc.advances)}`, break: 1 }),
            new TextRun({ text: `Less Refunds: -KES ${money(calc.refunds)}`, break: 1 }),
            new TextRun({ text: `Less Deductibles: -KES ${money(calc.deductibles)}`, break: 1 }),
            new TextRun({ text: `FINAL BALANCE DUE: KES ${money(calc.final)}`, bold: true, size: 28, break: 1 })
        ]
    }));

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `Invoice_${invoice.invoice_no}.docx`);
}

/* Compatibility names used by older buttons/code. */
async function exportToWord() { return generateAndSaveInvoice('word'); }
async function exportToExcel() { return generateAndSaveInvoice('excel'); }
async function generateExcelInvoice() { return generateAndSaveInvoice('excel'); }
async function moveTasksToHistory() { return generateAndSaveInvoice('word'); }

/* Re-render adjustments whenever completed orders refresh. */
const originalRenderDoneTableForInvoiceManager = window.renderDoneTable;
window.renderDoneTable = function(tasks) {
    if (typeof originalRenderDoneTableForInvoiceManager === 'function') {
        originalRenderDoneTableForInvoiceManager(tasks);
    }
    setTimeout(() => calculateFinalPayable(), 0);
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadInvoiceAdjustmentDefaults, 300);
});
