/* =========================================================
   INVOICE MANAGER v3
   Financial rule:
   Current orders + previous outstanding - advances - refund credits - deductibles
   = final balance due.

   Invoice generation NEVER means Paid.
   Paid / Refunded / Canceled are recorded only from History.
   Previous balances are consumed by the next invoice exactly once.
   Later status changes create automatic correction credits when necessary.
   ========================================================= */
let invoiceHistoryCache = [];

function money(value) {
    return (Number(value) || 0).toLocaleString('en-KE', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
function amount(value) { return Math.max(0, Number(value) || 0); }


function amount(value) { return Math.max(0, Number(value) || 0); }
let pendingAdjustmentCache = [];

async function getPendingAdjustments() {
    if (!currentEmployerId) return [];
    const {data,error}=await supabaseClient.from('invoice_adjustments').select('*')
        .eq('employer_id',String(currentEmployerId)).is('applied_invoice_no',null)
        .in('type',['advance','payment','deductible']).order('created_at',{ascending:true});
    if(error){
        console.warn('Adjustment ledger unavailable:',error.message);
        return [];
    }
    pendingAdjustmentCache=data||[];
    return pendingAdjustmentCache;
}

function invoiceInputs() {
    const manualPrevious=amount(document.getElementById('adjPreviousManual')?.value);
    const advances=pendingAdjustmentCache.filter(x=>['advance','payment'].includes(x.type))
        .reduce((s,x)=>s+amount(x.amount),0);
    const deductibles=pendingAdjustmentCache.filter(x=>x.type==='deductible')
        .reduce((s,x)=>s+amount(x.amount),0);
    return {advances,deductibles,manualPrevious};
}

async function addPendingTransaction(type){
    if(!currentEmployerId){alert('Please select an employer first.');return;}
    const id=type==='advance'?'newAdvanceAmount':'newDeductibleAmount';
    const input=document.getElementById(id);
    const value=amount(input?.value);
    if(value<=0){alert('Enter an amount greater than zero.');return;}
    const {data,error}=await supabaseClient.from('invoice_adjustments').insert([{
        employer_id:String(currentEmployerId),
        type,
        amount:value,
        note:type==='advance'?'Advance / payment received':'Deductible',
        applied_invoice_no:null
    }]).select().single();
    if(error){alert('Could not save transaction: '+error.message);return;}
    if(input)input.value='';
    await loadInvoiceAdjustmentDefaults();
}

async function removePendingTransaction(id){
    if(!confirm('Remove this pending transaction?'))return;
    const {error}=await supabaseClient.from('invoice_adjustments').delete().eq('id',id).is('applied_invoice_no',null);
    if(error){alert('Could not remove transaction: '+error.message);return;}
    await loadInvoiceAdjustmentDefaults();
}

function renderAdjustmentLedgers(){
    const adv=document.getElementById('advanceLedger'), ded=document.getElementById('deductibleLedger');
    if(!adv||!ded)return;
    const advances=pendingAdjustmentCache.filter(x=>['advance','payment'].includes(x.type));
    const deductibles=pendingAdjustmentCache.filter(x=>x.type==='deductible');
    const row=(x)=>`<div class="txn-row">
        <div><strong>${x.type==='payment'?'Payment received':'Advance received'}</strong><small>${x.created_at?new Date(x.created_at).toLocaleString('en-GB'):'Today'}${x.note?' · '+esc(x.note):''}</small></div>
        <div class="txn-amount">KES ${money(x.amount)}</div>
        <span class="status-pill status-paid">Saved</span>
        <button class="btn" onclick="removePendingTransaction('${x.id}')" style="background:#fee2e2;color:#991b1b;border:0;border-radius:8px;padding:7px 9px;">Remove</button>
    </div>`;
    adv.innerHTML=advances.length?advances.map(row).join(''):'<div class="txn-empty">No advances or payments waiting to be applied.</div>';
    ded.innerHTML=deductibles.length?deductibles.map(x=>`<div class="txn-row">
        <div><strong>Deductible</strong><small>${x.created_at?new Date(x.created_at).toLocaleString('en-GB'):'Today'}${x.note?' · '+esc(x.note):''}</small></div>
        <div class="txn-amount">KES ${money(x.amount)}</div>
        <span class="status-pill status-canceled">Saved</span>
        <button class="btn" onclick="removePendingTransaction('${x.id}')" style="background:#fee2e2;color:#991b1b;border:0;border-radius:8px;padding:7px 9px;">Remove</button>
    </div>`).join(''):'<div class="txn-empty">No deductibles waiting to be applied.</div>';
}

async function getDoneTasksForInvoice() {
    if (!currentEmployerId) return [];
    const {data,error} = await supabaseClient.from('tasks').select('*')
        .eq('employer_id',currentEmployerId).eq('status','Done').order('created_at',{ascending:true});
    if(error) throw error; return data || [];
}

async function getOpenPreviousInvoices() {
    if (!currentEmployerId) return [];
    // The authoritative balance is the latest open invoice in each carry-forward chain.
    // Older invoices are history and must never be counted a second time.
    const {data,error} = await supabaseClient.from('invoices').select('*')
        .eq('employer_id',String(currentEmployerId))
        .order('created_at',{ascending:true});
    if(error) throw error;
    const invoices = data || [];
    const referenced = new Set(
        invoices.map(i => String(i.carried_into_invoice_no || '').trim()).filter(Boolean)
    );
    return invoices.filter(i =>
        String(i.status || '').toLowerCase() === 'unpaid' &&
        !referenced.has(String(i.invoice_no || '').trim())
    );
}

async function getRefundCredits() {
    if (!currentEmployerId) return [];
    const {data,error} = await supabaseClient.from('tasks').select('*')
        .eq('employer_id',currentEmployerId).eq('status','Refunded').is('invoice_no',null)
        .order('created_at',{ascending:true});
    if(error) throw error; return data || [];
}

async function getInvoiceCalculation() {
    const [tasks, previousInvoices, refundCredits, pending] = await Promise.all([
        getDoneTasksForInvoice(), getOpenPreviousInvoices(), getRefundCredits(), getPendingAdjustments()
    ]);
    pendingAdjustmentCache=pending;
    const input=invoiceInputs();
    const subtotal=tasks.reduce((sum,t)=>sum+amount(t.payable),0);
    const autoPrevious=previousInvoices.reduce((sum,i)=>sum+amount(i.balance_due),0);
    const previousBalance=autoPrevious+input.manualPrevious;
    const refundCredit=refundCredits.reduce((sum,t)=>sum+Math.abs(Number(t.payable)||0),0);
    const gross=subtotal+previousBalance;
    const final=Math.max(0,gross-input.advances-refundCredit-input.deductibles);
    return {tasks,previousInvoices,refundCredits,pendingAdjustments:pending,subtotal,autoPrevious,manualPrevious:input.manualPrevious,previousBalance,
        advances:input.advances,refundCredit,deductibles:input.deductibles,gross,final};
}

async function calculateFinalPayable(){
    try{
        const c=await getInvoiceCalculation();
        const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=`KES ${money(v)}`;};
        set('invoiceSubtotalDisplay',c.subtotal);set('invoicePreviousAutoDisplay',c.autoPrevious);
        set('invoicePreviousManualDisplay',c.manualPrevious);set('invoicePreviousDisplay',c.previousBalance);
        set('invoiceAdvanceDisplay',-c.advances);set('invoiceRefundDisplay',-c.refundCredit);
        set('invoiceDeductibleDisplay',-c.deductibles);set('finalTotalDisplay',c.final);
        const prev=document.getElementById('adjPreviousAuto');if(prev)prev.value=c.autoPrevious.toFixed(2);
        const total=document.getElementById('adjPrevious');if(total)total.value=c.previousBalance.toFixed(2);
        const hint=document.getElementById('previousBalanceHint');if(hint)hint.textContent=`Auto outstanding: KES ${money(c.autoPrevious)}`;
        renderAdjustmentLedgers();
        return c;
    }catch(e){console.error('Invoice calculation failed:',e);return {tasks:[],previousInvoices:[],refundCredits:[],pendingAdjustments:[],subtotal:0,autoPrevious:0,manualPrevious:0,previousBalance:0,advances:0,refundCredit:0,deductibles:0,gross:0,final:0};}
}
async function loadInvoiceAdjustmentDefaults(){return calculateFinalPayable();}

async function createInvoiceRecord() {
    if(!currentEmployerId){alert('Please select an employer first.');return null;}

    const calc=await getInvoiceCalculation();

    /* A credit or previous unpaid balance can itself justify a new invoice. */
    if(!calc.tasks.length && !calc.previousInvoices.length && !calc.refundCredits.length && !calc.pendingAdjustments.length && calc.manualPrevious<=0){
        alert('There are no completed orders, previous unpaid balance, or refund credits ready for invoicing.');
        return null;
    }

    const employer=(allEmployers||[]).find(e=>String(e.id)===String(currentEmployerId));
    const invoiceNo=`INV-${Date.now()}-${Math.floor(Math.random()*900+100)}`;

    const {data:invoice,error}=await supabaseClient.from('invoices').insert([{
        invoice_no:invoiceNo,
        employer_id:String(currentEmployerId),
        employer_name:employer?.employer_name||'Employer',
        subtotal:calc.subtotal,
        previous_balance:calc.previousBalance,
        manual_previous_balance:calc.manualPrevious,
        advances:calc.advances,
        refunds:calc.refundCredit,
        deductibles:calc.deductibles,
        balance_due:calc.final,
        status:'Unpaid',
        carried_forward:false,
        refund_recorded:false,
        carried_into_invoice_no:null
    }]).select().single();

    if(error){alert(`Invoice could not be saved: ${error.message}\n\nRun the updated Supabase migration first.`);return null;}

    /* Archive current orders. */
    if(calc.tasks.length){
        const {error:e}=await supabaseClient.from('tasks').update({status:'Invoiced',invoice_no:invoiceNo})
            .in('id',calc.tasks.map(t=>t.id));
        if(e){
            await supabaseClient.from('invoices').delete().eq('id',invoice.id);
            alert(`Invoice was not archived: ${e.message}`);return null;
        }
    }

    /* Consume each refund/cancellation/payment credit exactly once. */
    if(calc.refundCredits.length){
        const {error:e}=await supabaseClient.from('tasks').update({invoice_no:invoiceNo})
            .in('id',calc.refundCredits.map(t=>t.id));
        if(e){console.error('Credit consumption error',e);}
    }

    /* Mark old unpaid balances as included in THIS invoice, so they cannot be double-counted. */
    if(calc.previousInvoices.length){
        const {error:e}=await supabaseClient.from('invoices').update({
            carried_forward:true,
            carried_into_invoice_no:invoiceNo
        }).in('id',calc.previousInvoices.map(i=>i.id));
        if(e){console.error('Previous-balance linkage error',e);}
    }

    /* Consume saved advances/payments/deductibles exactly once. */
    if(calc.pendingAdjustments.length){
        const {error:e}=await supabaseClient.from('invoice_adjustments').update({
            applied_invoice_no:invoiceNo
        }).in('id',calc.pendingAdjustments.map(x=>x.id));
        if(e){console.error('Adjustment consumption error',e);}
    }

    return {invoice,tasks:calc.tasks,calc,employer};
}

function resetInvoiceAdjustments(){
    const manual=document.getElementById('adjPreviousManual'); if(manual) manual.value='0';
    const a=document.getElementById('newAdvanceAmount'); if(a) a.value='';
    const d=document.getElementById('newDeductibleAmount'); if(d) d.value='';
    calculateFinalPayable();
}

async function generateAndSaveInvoice(format='word'){
    try{
        const result=await createInvoiceRecord();
        if(!result)return;
        if(format==='excel')await exportSavedInvoiceExcel(result.invoice,result.tasks,result.calc,result.employer);
        else await exportSavedInvoiceWord(result.invoice,result.tasks,result.calc,result.employer);
        resetInvoiceAdjustments();
        await fetchTasks();
        await renderInvoiceHistory();
        alert(`Invoice ${result.invoice.invoice_no} generated successfully.\n\nSTATUS: UNPAID\n\nUse History when the customer actually pays, requests a refund, or the invoice is canceled.`);
    }catch(err){console.error(err);alert('Invoice generation failed: '+err.message);}
}

function invoiceStatusClass(status){
    const s=String(status||'').toLowerCase();
    if(s==='paid')return'status-paid';
    if(s==='refunded')return'status-refunded';
    if(s==='canceled'||s==='cancelled')return'status-canceled';
    return'status-unpaid';
}

/* Create a correction credit for an amount that was already included in a later invoice. */
async function createCredit(invoice,type,amountValue){
    const value=amount(amountValue);
    if(value<=0)return true;

    const labels={Refunded:'Refund credit',Canceled:'Cancellation credit',Paid:'Payment credit'};
    const {error}=await supabaseClient.from('tasks').insert([{
        employer_id:String(invoice.employer_id),
        client_name:invoice.employer_name||labels[type],
        task_detail:`${labels[type]} from ${invoice.invoice_no}`,
        task_type:'Adjustment',
        units:1,
        cpp:-value,
        payable:-value,
        status:'Refunded',
        notified:true,
        invoice_no:null
    }]);
    if(error){alert(`${labels[type]} could not be recorded: ${error.message}`);return false;}
    return true;
}

async function updateInvoiceStatus(id,status){
    if(!id)return;
    const {data:invoice,error:readError}=await supabaseClient.from('invoices').select('*').eq('id',id).single();
    if(readError||!invoice){alert('Invoice could not be found.');return;}

    if(invoice.status===status)return;
    if(status==='Unpaid' && invoice.status!=='Unpaid'){
        alert('A completed status cannot be reversed automatically because a payment/refund/cancellation may already have created a credit. Keep the financial record unchanged.');
        return;
    }

    const questions={
        Paid:`Mark ${invoice.invoice_no} as PAID? This records actual payment only.`,
        Unpaid:`Mark ${invoice.invoice_no} as UNPAID?`,
        Refunded:`Record a REFUND for ${invoice.invoice_no}? The refund amount will automatically become a credit on the next invoice.`,
        Canceled:`CANCEL ${invoice.invoice_no}? Its amount will automatically be removed from future billing.`
    };
    if(!confirm(questions[status]))return;

    const alreadyCarried=!!invoice.carried_into_invoice_no || !!invoice.carried_forward;
    const value=amount(invoice.balance_due);

    if(status==='Refunded'){
        if(invoice.refund_recorded){alert('This invoice is already recorded as refunded.');return;}
        if(alreadyCarried && !(await createCredit(invoice,'Refunded',value)))return;

        const {error}=await supabaseClient.from('invoices').update({
            status:'Refunded',refund_recorded:true
        }).eq('id',id);
        if(error){alert('Could not mark invoice refunded: '+error.message);return;}

        /* If it has not been carried yet, its own status removes it from future balance;
           the credit is only needed once the invoice had already been included elsewhere. */
    }else if(status==='Canceled'){
        if(alreadyCarried && !(await createCredit(invoice,'Canceled',value)))return;

        const {error:taskError}=await supabaseClient.from('tasks').update({status:'Canceled'})
            .eq('invoice_no',invoice.invoice_no);
        if(taskError){alert('Could not cancel linked orders: '+taskError.message);return;}

        const {error}=await supabaseClient.from('invoices').update({status:'Canceled'}).eq('id',id);
        if(error){alert('Could not cancel invoice: '+error.message);return;}
    }else if(status==='Paid'){
        const paidAmount=amount(prompt(`Amount actually received for ${invoice.invoice_no}:`, value.toFixed(2)));
        if(paidAmount<=0){alert('Enter the payment amount received.');return;}
        if(paidAmount>value && !confirm(`You entered KES ${money(paidAmount)}, which is more than the invoice balance of KES ${money(value)}. Continue?`))return;
        const {error:payError}=await supabaseClient.from('invoice_adjustments').insert([{
            employer_id:String(invoice.employer_id), invoice_id:id, type:'payment',
            amount:paidAmount, note:`Payment received for ${invoice.invoice_no}`,
            applied_invoice_no:invoice.invoice_no
        }]);
        if(payError){alert('Payment could not be recorded: '+payError.message);return;}
        if(alreadyCarried && !(await createCredit(invoice,'Paid',value)))return;

        const {error}=await supabaseClient.from('invoices').update({status:'Paid',paid_amount:paidAmount,paid_at:new Date().toISOString()}).eq('id',id);
        if(error){alert('Could not mark invoice paid: '+error.message);return;}
    }else{
        /* Re-opening a Paid/Refunded/Canceled invoice is intentionally explicit.
           No automatic deletion of a previously created credit is attempted. */
        const {error}=await supabaseClient.from('invoices').update({status:'Unpaid'}).eq('id',id);
        if(error){alert('Could not mark invoice unpaid: '+error.message);return;}
    }

    await fetchTasks();
    await renderInvoiceHistory();
    await calculateFinalPayable();
}

function setHistoryFilter(status,button){
    const select=document.getElementById('historyStatusFilter');
    if(select)select.value=status;
    document.querySelectorAll('.history-filter-btn').forEach(b=>b.classList.remove('active'));
    if(button)button.classList.add('active');
    renderInvoiceHistory();
}

async function renderInvoiceHistory(){
    const body=document.getElementById('historyBody');
    if(!body||!currentEmployerId)return;

    const {data,error}=await supabaseClient.from('invoices').select('*')
        .eq('employer_id',String(currentEmployerId)).order('created_at',{ascending:false});
    if(error){body.innerHTML=`<tr><td colspan="8" class="history-empty">Unable to load invoices: ${esc(error.message)}</td></tr>`;return;}

    invoiceHistoryCache=data||[];
    const search=(document.getElementById('historySearch')?.value||'').trim().toLowerCase();
    const status=document.getElementById('historyStatusFilter')?.value||'ALL';

    const filtered=invoiceHistoryCache.filter(inv=>{
        const text=`${inv.invoice_no||''} ${inv.employer_name||''}`.toLowerCase();
        return (!search||text.includes(search)) &&
            (status==='ALL'||inv.status===status||(status==='Canceled'&&inv.status==='Cancelled'));
    });

    body.innerHTML=filtered.length?filtered.map(inv=>{
        const adjustments=amount(inv.advances)+amount(inv.refunds)+amount(inv.deductibles);
        const locked=inv.status==='Paid'||inv.status==='Refunded'||inv.status==='Canceled'||inv.status==='Cancelled';
        return `<tr>
            <td><strong>${esc(inv.invoice_no)}</strong>${inv.carried_into_invoice_no?`<div style="font-size:10px;color:#7f8c8d;">Carried into ${esc(inv.carried_into_invoice_no)}</div>`:''}</td>
            <td>${inv.created_at?new Date(inv.created_at).toLocaleDateString('en-GB'):'-'}</td>
            <td>KES ${money(inv.subtotal)}</td>
            <td>KES ${money(inv.previous_balance)}</td>
            <td>-KES ${money(adjustments)}</td>
            <td><strong>KES ${money(inv.balance_due)}</strong></td>
            <td><span class="status-pill ${invoiceStatusClass(inv.status)}">${esc(inv.status==='Cancelled'?'Canceled':inv.status)}</span></td>
            <td><div class="invoice-action-group">
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Paid')" ${locked?'disabled':''} style="background:#198754;color:#fff;">✓ Paid</button>
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Unpaid')" ${inv.status==='Unpaid'?'disabled':''} style="background:#f39c12;color:#fff;">↺ Unpaid</button>
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Refunded')" ${locked?'disabled':''} style="background:#7b3f98;color:#fff;">↩ Refund</button>
                <button class="btn" onclick="updateInvoiceStatus('${inv.id}','Canceled')" ${locked?'disabled':''} style="background:#c0392b;color:#fff;">✕ Cancel</button>
            </div></td>
        </tr>`;
    }).join(''):'<tr><td colspan="8" class="history-empty">No invoices match this filter.</td></tr>';

    const sum=(filter)=>invoiceHistoryCache.filter(filter).reduce((s,i)=>s+amount(i.balance_due),0);
    const summary=document.getElementById('historySummary');
    if(summary)summary.innerHTML=`
        <div class="history-summary-card unpaid"><small>Unpaid</small><b>KES ${money(sum(i=>i.status==='Unpaid'))}</b></div>
        <div class="history-summary-card paid"><small>Paid</small><b>KES ${money(sum(i=>i.status==='Paid'))}</b></div>
        <div class="history-summary-card refunded"><small>Refunded</small><b>KES ${money(sum(i=>i.status==='Refunded'))}</b></div>
        <div class="history-summary-card canceled"><small>Canceled</small><b>KES ${money(sum(i=>['Canceled','Cancelled'].includes(i.status)))}</b></div>`;
    await calculateFinalPayable();
}

/* Compatibility names used by the existing application. */
async function exportToWord(){return generateAndSaveInvoice('word');}
async function exportToExcel(){return generateAndSaveInvoice('excel');}
async function generateExcelInvoice(){return generateAndSaveInvoice('excel');}
async function moveTasksToHistory(){return generateAndSaveInvoice('word');}

const originalRenderDoneTableForInvoiceManager=window.renderDoneTable;
window.renderDoneTable=function(tasks){
    if(typeof originalRenderDoneTableForInvoiceManager==='function')originalRenderDoneTableForInvoiceManager(tasks);
    setTimeout(()=>calculateFinalPayable(),50);
};

document.addEventListener('DOMContentLoaded',()=>setTimeout(loadInvoiceAdjustmentDefaults,500));

async function exportSavedInvoiceExcel(invoice,tasks,calc,employer){
    const rows=[
        ['INVOICE',invoice.invoice_no],
        ['Employer',employer?.employer_name||invoice.employer_name||'Employer'],
        ['Date',new Date(invoice.created_at||Date.now()).toLocaleDateString('en-GB')],
        ['STATUS',invoice.status],[],
        ['Client','Detail','Units','CPP','Payable']
    ];
    tasks.forEach(t=>rows.push([t.client_name||'-',t.task_detail||'-',t.units||'-',Number(t.cpp)||0,Number(t.payable)||0]));
    rows.push([],
        ['Current Orders','','','',calc.subtotal],
        ['Previous Unpaid Balance','','','',calc.previousBalance],
        ['Less Advances','','','',-calc.advances],
        ['Less Refund Credits','','','',-calc.refundCredit],
        ['Less Deductibles','','','',-calc.deductibles],
        ['FINAL BALANCE DUE','','','',calc.final]
    );
    const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Invoice');
    XLSX.writeFile(wb,`Invoice_${invoice.invoice_no}.xlsx`);
}

async function exportSavedInvoiceWord(invoice,tasks,calc,employer){
    const {Document,Packer,Paragraph,Table,TableRow,TableCell,TextRun,WidthType,AlignmentType}=docx;
    const grouped={};
    tasks.forEach(t=>{const c=t.client_name||'Client';if(!grouped[c])grouped[c]=[];grouped[c].push(t);});
    const children=[
        new Paragraph({text:'INVOICE',heading:'Heading1',alignment:AlignmentType.CENTER}),
        new Paragraph({children:[new TextRun({text:'Invoice #: ',bold:true}),new TextRun(invoice.invoice_no),new TextRun({text:`    Date: ${new Date(invoice.created_at||Date.now()).toLocaleDateString('en-GB')}`})]}),
        new Paragraph({children:[new TextRun({text:'Billed To: ',bold:true}),new TextRun(employer?.employer_name||invoice.employer_name||'Employer')]}),
        new Paragraph({children:[new TextRun({text:`STATUS: ${invoice.status}`,bold:true})]})
    ];
    for(const [client,clientTasks] of Object.entries(grouped)){
        children.push(new Paragraph({children:[new TextRun({text:client,bold:true,underline:{}})]}));
        children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:clientTasks.map(t=>new TableRow({children:[
            new TableCell({children:[new Paragraph(t.task_detail||'-')],width:{size:70,type:WidthType.PERCENTAGE}}),
            new TableCell({children:[new Paragraph({text:`KES ${money(t.payable)}`,alignment:AlignmentType.RIGHT})],width:{size:30,type:WidthType.PERCENTAGE}})
        ]}))}));
    }
    children.push(new Paragraph({text:''}));
    children.push(new Paragraph({alignment:AlignmentType.RIGHT,children:[
        new TextRun({text:`Current Orders: KES ${money(calc.subtotal)}`,break:1}),
        new TextRun({text:`Previous Unpaid Balance: +KES ${money(calc.previousBalance)}`,break:1}),
        new TextRun({text:`Less Advances: -KES ${money(calc.advances)}`,break:1}),
        new TextRun({text:`Less Refund Credits: -KES ${money(calc.refundCredit)}`,break:1}),
        new TextRun({text:`Less Deductibles: -KES ${money(calc.deductibles)}`,break:1}),
        new TextRun({text:`FINAL BALANCE DUE: KES ${money(calc.final)}`,bold:true,size:28,break:1})
    ]}));
    const doc=new Document({sections:[{children}]});
    saveAs(await Packer.toBlob(doc),`Invoice_${invoice.invoice_no}.docx`);
}
