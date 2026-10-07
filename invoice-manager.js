/* =========================================================
   INVOICE MANAGER
   Invoice generation is separate from payment status.
   History controls Paid / Unpaid / Refunded / Canceled.
   Refunds become negative completed-order credits on the next invoice.
   Canceled invoices remove their order value from future invoices.
   ========================================================= */
let invoiceHistoryCache = [];

function money(value) {
    return (Number(value) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
function n(value) { return Math.max(0, Number(value) || 0); }

function invoiceInputs() {
    return {
        advances: n(document.getElementById('adjPlus')?.value),
        deductibles: n(document.getElementById('adjMinus')?.value)
    };
}

async function getDoneTasksForInvoice() {
    if (!currentEmployerId) return [];
    const { data, error } = await supabaseClient.from('tasks').select('*')
        .eq('employer_id', currentEmployerId).eq('status', 'Done').order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function getOpenPreviousInvoices() {
    if (!currentEmployerId) return [];
    const { data, error } = await supabaseClient.from('invoices').select('*')
        .eq('employer_id', String(currentEmployerId))
        .eq('status', 'Unpaid')
        .eq('carried_forward', false)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function getRefundCredits() {
    if (!currentEmployerId) return [];
    const { data, error } = await supabaseClient.from('tasks').select('*')
        .eq('employer_id', currentEmployerId)
        .eq('status', 'Refunded')
        .is('invoice_no', null)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function getInvoiceCalculation() {
    const tasks = await getDoneTasksForInvoice();
    const previousInvoices = await getOpenPreviousInvoices();
    const refundCredits = await getRefundCredits();
    const input = invoiceInputs();

    const subtotal = tasks.reduce((sum, t) => sum + Number(t.payable || 0), 0);
    const previousBalance = previousInvoices.reduce((sum, i) => sum + n(i.balance_due), 0);
    const refundCredit = refundCredits.reduce((sum, t) => sum + Math.abs(Number(t.payable || 0)), 0);
    const grossBeforeDeductions = subtotal + previousBalance;
    const final = Math.max(0, grossBeforeDeductions - input.advances - input.deductibles - refundCredit);
    const unusedCredit = Math.max(0, input.advances + input.deductibles + refundCredit - grossBeforeDeductions);

    return { tasks, previousInvoices, refundCredits, subtotal, previousBalance,
        advances: input.advances, deductibles: input.deductibles, refundCredit, final, unusedCredit };
}

async function calculateFinalPayable() {
    try {
        const calc = await getInvoiceCalculation();
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = `KES ${money(value)}`; };
        set('invoiceSubtotalDisplay', calc.subtotal);
        set('invoicePreviousDisplay', calc.previousBalance);
        set('invoiceRefundDisplay', -calc.refundCredit);
        set('invoiceAdjustmentsDisplay', -(calc.advances + calc.deductibles + calc.refundCredit));
        set('finalTotalDisplay', calc.final);
        const prev = document.getElementById('previousBalanceHint');
        if (prev) prev.textContent = `Previous unpaid invoices: KES ${money(calc.previousBalance)}`;
        return calc;
    } catch (e) {
        console.error('Invoice calculation failed:', e);
        return { tasks: [], previousInvoices: [], refundCredits: [], subtotal: 0, previousBalance: 0, advances: 0, deductibles: 0, refundCredit: 0, final: 0 };
    }
}

async function loadInvoiceAdjustmentDefaults() { return calculateFinalPayable(); }

async function createInvoiceRecord() {
    if (!currentEmployerId) { alert('Please select an employer first.'); return null; }
    const calc = await getInvoiceCalculation();
    if (!calc.tasks.length) { alert('There are no completed orders ready for invoicing.'); return null; }

    const employer = (allEmployers || []).find(e => String(e.id) === String(currentEmployerId));
    const invoiceNo = `INV-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
    const { data: invoice, error } = await supabaseClient.from('invoices').insert([{
        invoice_no: invoiceNo,
        employer_id: String(currentEmployerId),
        employer_name: employer?.employer_name || 'Employer',
        subtotal: calc.subtotal,
        previous_balance: calc.previousBalance,
        advances: calc.advances,
        refunds: calc.refundCredit,
        deductibles: calc.deductibles,
        balance_due: calc.final,
        status: 'Unpaid',
        carried_forward: false,
        refund_recorded: false
    }]).select().single();
    if (error) { alert(`Invoice could not be saved: ${error.message}\n\nRun the updated supabase_invoice_migration.sql first.`); return null; }

    const taskIds = calc.tasks.map(t => t.id);
    const { error: archiveError } = await supabaseClient.from('tasks')
        .update({ status: 'Invoiced', invoice_no: invoiceNo }).in('id', taskIds);
    if (archiveError) {
        await supabaseClient.from('invoices').delete().eq('id', invoice.id);
        alert(`Invoice was not archived: ${archiveError.message}`);
        return null;
    }

    // Consume refund-credit orders exactly once.
    if (calc.refundCredits.length) {
        const ids = calc.refundCredits.map(t => t.id);
        await supabaseClient.from('tasks').update({ invoice_no: invoiceNo }).in('id', ids);
    }

    // Roll the old unpaid invoices into this invoice so they cannot be counted twice later.
    if (calc.previousInvoices.length) {
        await supabaseClient.from('invoices').update({ carried_forward: true }).in('id', calc.previousInvoices.map(i => i.id));
    }

    return { invoice, tasks: calc.tasks, calc, employer };
}

function resetInvoiceAdjustments() {
    ['adjPlus','adjMinus'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '0'; });
    calculateFinalPayable();
}

async function generateAndSaveInvoice(format = 'word') {
    try {
        const result = await createInvoiceRecord();
        if (!result) return;
        if (format === 'excel') await exportSavedInvoiceExcel(result.invoice, result.tasks, result.calc, result.employer);
        else await exportSavedInvoiceWord(result.invoice, result.tasks, result.calc, result.employer);
        resetInvoiceAdjustments();
        await fetchTasks();
        await renderInvoiceHistory();
        alert(`Invoice ${result.invoice.invoice_no} was generated. It is UNPAID until you mark it Paid in History.`);
    } catch (err) { console.error(err); alert('Invoice generation failed: ' + err.message); }
}

function invoiceStatusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'paid') return 'status-paid';
    if (s === 'refunded') return 'status-refunded';
    if (s === 'canceled' || s === 'cancelled') return 'status-canceled';
    return 'status-unpaid';
}

async function updateInvoiceStatus(id, status) {
    if (!id) return;
    const { data: invoice, error: readError } = await supabaseClient.from('invoices').select('*').eq('id', id).single();
    if (readError || !invoice) { alert('Invoice could not be found.'); return; }
    if (invoice.status === status) return;

    const questions = {
        Paid: `Mark ${invoice.invoice_no} as PAID? This only records payment; it does not create a new invoice.`,
        Unpaid: `Mark ${invoice.invoice_no} as UNPAID?`,
        Refunded: `Refund ${invoice.invoice_no}? Its refund will automatically appear as a credit in the next invoice and in Completed Orders.`,
        Canceled: `Cancel ${invoice.invoice_no}? Its order money will be removed from future invoice totals.`
    };
    if (!confirm(questions[status])) return;

    if (status === 'Refunded') {
        if (invoice.refund_recorded) { alert('This invoice has already been recorded as refunded.'); return; }
        const refundAmount = n(invoice.balance_due);
        if (refundAmount > 0) {
            const { error: refundError } = await supabaseClient.from('tasks').insert([{
                employer_id: String(invoice.employer_id),
                client_name: invoice.employer_name || 'Refund Credit',
                task_detail: `Refund credit from ${invoice.invoice_no}`,
                task_type: 'Adjustment',
                units: 1,
                cpp: -refundAmount,
                payable: -refundAmount,
                status: 'Refunded',
                notified: true,
                invoice_no: null
            }]);
            if (refundError) { alert('Refund could not be recorded: ' + refundError.message); return; }
        }
        const { error } = await supabaseClient.from('invoices').update({ status: 'Refunded', refund_recorded: true }).eq('id', id);
        if (error) { alert('Could not mark invoice refunded: ' + error.message); return; }
    } else if (status === 'Canceled') {
        const { error: taskError } = await supabaseClient.from('tasks').update({ status: 'Canceled' }).eq('invoice_no', invoice.invoice_no);
        if (taskError) { alert('Could not cancel the linked orders: ' + taskError.message); return; }
        // If this invoice was already carried into a later invoice, create a negative
        // correction so cancellation removes that amount from the next invoice too.
        if (invoice.carried_forward && n(invoice.balance_due) > 0) {
            const { error: creditError } = await supabaseClient.from('tasks').insert([{
                employer_id: String(invoice.employer_id), client_name: invoice.employer_name || 'Cancellation Credit',
                task_detail: `Cancellation credit from ${invoice.invoice_no}`, task_type: 'Adjustment',
                units: 1, cpp: -n(invoice.balance_due), payable: -n(invoice.balance_due),
                status: 'Refunded', notified: true, invoice_no: null
            }]);
            if (creditError) { alert('Invoice was not canceled because the correction could not be recorded: ' + creditError.message); return; }
        }
        const { error } = await supabaseClient.from('invoices').update({ status: 'Canceled' }).eq('id', id);
        if (error) { alert('Could not cancel invoice: ' + error.message); return; }
    } else {
        // A late payment of an invoice that was already carried forward must also
        // create a credit, otherwise the same money would remain on the next invoice.
        if (status === 'Paid' && invoice.carried_forward && n(invoice.balance_due) > 0) {
            const { error: creditError } = await supabaseClient.from('tasks').insert([{
                employer_id: String(invoice.employer_id), client_name: invoice.employer_name || 'Payment Credit',
                task_detail: `Payment credit from ${invoice.invoice_no}`, task_type: 'Adjustment',
                units: 1, cpp: -n(invoice.balance_due), payable: -n(invoice.balance_due),
                status: 'Refunded', notified: true, invoice_no: null
            }]);
            if (creditError) { alert('Payment status was not changed because the carry-forward correction failed: ' + creditError.message); return; }
        }
        const { error } = await supabaseClient.from('invoices').update({ status }).eq('id', id);
        if (error) { alert('Could not update invoice: ' + error.message); return; }
    }

    await fetchTasks();
    await renderInvoiceHistory();
}

async function renderInvoiceHistory() {
    const body = document.getElementById('historyBody');
    if (!body || !currentEmployerId) return;
    const { data, error } = await supabaseClient.from('invoices').select('*')
        .eq('employer_id', String(currentEmployerId)).order('created_at', { ascending: false });
    if (error) { body.innerHTML = `<tr><td colspan="8">Unable to load invoices: ${esc(error.message)}</td></tr>`; return; }
    invoiceHistoryCache = data || [];

    const search = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
    const status = document.getElementById('historyStatusFilter')?.value || 'ALL';
    const filtered = invoiceHistoryCache.filter(inv => {
        const text = `${inv.invoice_no || ''} ${inv.employer_name || ''}`.toLowerCase();
        return (!search || text.includes(search)) && (status === 'ALL' || inv.status === status || (status === 'Canceled' && inv.status === 'Cancelled'));
    });

    body.innerHTML = filtered.length ? filtered.map(inv => `
        <tr>
            <td><strong>${esc(inv.invoice_no)}</strong></td>
            <td>${inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-GB') : '-'}</td>
            <td>KES ${money(inv.subtotal)}</td>
            <td>KES ${money(inv.previous_balance)}</td>
            <td>-KES ${money(n(inv.advances) + n(inv.refunds) + n(inv.deductibles))}</td>
            <td><strong>KES ${money(inv.balance_due)}</strong></td>
            <td><span class="status-pill ${invoiceStatusClass(inv.status)}">${esc(inv.status)}</span></td>
            <td><div class="invoice-action-group">
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Paid')" style="background:#27ae60;color:#fff;">Paid</button>
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Unpaid')" style="background:#f39c12;color:#fff;">Unpaid</button>
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Refunded')" style="background:#8e44ad;color:#fff;">Refund</button>
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Canceled')" style="background:#e74c3c;color:#fff;">Cancel</button>
            </div></td>
        </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;padding:20px;">No invoices match this filter.</td></tr>';

    const unpaid = invoiceHistoryCache.filter(i => i.status === 'Unpaid').reduce((s,i) => s+n(i.balance_due),0);
    const paid = invoiceHistoryCache.filter(i => i.status === 'Paid').reduce((s,i) => s+n(i.balance_due),0);
    const refunded = invoiceHistoryCache.filter(i => i.status === 'Refunded').reduce((s,i) => s+n(i.balance_due),0);
    const canceled = invoiceHistoryCache.filter(i => ['Canceled','Cancelled'].includes(i.status)).reduce((s,i) => s+n(i.balance_due),0);
    const summary = document.getElementById('historySummary');
    if (summary) summary.innerHTML = `Unpaid <b>KES ${money(unpaid)}</b> &nbsp;|&nbsp; Paid <b>KES ${money(paid)}</b> &nbsp;|&nbsp; Refunded <b>KES ${money(refunded)}</b> &nbsp;|&nbsp; Canceled <b>KES ${money(canceled)}</b>`;
    await calculateFinalPayable();
}

/* Compatibility names used by older buttons/code. */
async function exportToWord(){return generateAndSaveInvoice('word');}
async function exportToExcel(){return generateAndSaveInvoice('excel');}
async function generateExcelInvoice(){return generateAndSaveInvoice('excel');}
async function moveTasksToHistory(){return generateAndSaveInvoice('word');}

const originalRenderDoneTableForInvoiceManager = window.renderDoneTable;
window.renderDoneTable = function(tasks) {
    if (typeof originalRenderDoneTableForInvoiceManager === 'function') originalRenderDoneTableForInvoiceManager(tasks);
    setTimeout(() => calculateFinalPayable(), 50);
};

document.addEventListener('DOMContentLoaded', () => setTimeout(loadInvoiceAdjustmentDefaults, 500));

async function exportSavedInvoiceExcel(invoice, tasks, calc, employer) {
    const rows = [
        ['INVOICE', invoice.invoice_no],
        ['Employer', employer?.employer_name || invoice.employer_name || 'Employer'],
        ['Date', new Date(invoice.created_at || Date.now()).toLocaleDateString('en-GB')],
        ['STATUS', invoice.status],
        [],
        ['Client', 'Detail', 'Units', 'CPP', 'Payable']
    ];
    tasks.forEach(t => rows.push([t.client_name || '-', t.task_detail || '-', t.units || '-', Number(t.cpp) || 0, Number(t.payable) || 0]));
    rows.push(
        [],
        ['Current Work Subtotal', '', '', '', calc.subtotal],
        ['Previous Unpaid Balance', '', '', '', calc.previousBalance],
        ['Less Advances', '', '', '', -calc.advances],
        ['Less Refund Credits', '', '', '', -calc.refundCredit],
        ['Less Deductibles', '', '', '', -calc.deductibles],
        ['FINAL BALANCE DUE', '', '', '', calc.final]
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
    XLSX.writeFile(wb, `Invoice_${invoice.invoice_no}.xlsx`);
}

async function exportSavedInvoiceWord(invoice, tasks, calc, employer) {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType } = docx;
    const grouped = {};
    tasks.forEach(t => { const c = t.client_name || 'Client'; if (!grouped[c]) grouped[c] = []; grouped[c].push(t); });
    const children = [
        new Paragraph({ text: 'INVOICE', heading: 'Heading1', alignment: AlignmentType.CENTER }),
        new Paragraph({ children: [new TextRun({text:'Invoice #: ',bold:true}), new TextRun(invoice.invoice_no), new TextRun({text:`    Date: ${new Date(invoice.created_at || Date.now()).toLocaleDateString('en-GB')}`})] }),
        new Paragraph({ children: [new TextRun({text:'Billed To: ',bold:true}), new TextRun(employer?.employer_name || invoice.employer_name || 'Employer')] }),
        new Paragraph({ children: [new TextRun({text:`STATUS: ${invoice.status}`,bold:true})] })
    ];
    for (const [client, clientTasks] of Object.entries(grouped)) {
        children.push(new Paragraph({ children:[new TextRun({text:client,bold:true,underline:{}})] }));
        children.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows:clientTasks.map(t => new TableRow({children:[
            new TableCell({children:[new Paragraph(t.task_detail || '-')],width:{size:70,type:WidthType.PERCENTAGE}}),
            new TableCell({children:[new Paragraph({text:`KES ${money(t.payable)}`,alignment:AlignmentType.RIGHT})],width:{size:30,type:WidthType.PERCENTAGE}})
        ]}))}));
    }
    children.push(new Paragraph({text:''}));
    children.push(new Paragraph({alignment:AlignmentType.RIGHT,children:[
        new TextRun({text:`Current Work Subtotal: KES ${money(calc.subtotal)}`,break:1}),
        new TextRun({text:`Previous Unpaid Balance: +KES ${money(calc.previousBalance)}`,break:1}),
        new TextRun({text:`Less Advances: -KES ${money(calc.advances)}`,break:1}),
        new TextRun({text:`Less Refund Credits: -KES ${money(calc.refundCredit)}`,break:1}),
        new TextRun({text:`Less Deductibles: -KES ${money(calc.deductibles)}`,break:1}),
        new TextRun({text:`FINAL BALANCE DUE: KES ${money(calc.final)}`,bold:true,size:28,break:1})
    ]}));
    const doc = new Document({sections:[{children}]});
    saveAs(await Packer.toBlob(doc), `Invoice_${invoice.invoice_no}.docx`);
}
