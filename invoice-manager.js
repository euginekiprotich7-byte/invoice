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
function round2(value) { return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100; }
/* What is still owed on an invoice after any part payments. This - not the full balance_due -
   is what carries forward into the next invoice as "previous balance". */
function invoiceOutstanding(inv) {
    return Math.max(0, round2(amount(inv && inv.balance_due) - amount(inv && inv.paid_amount)));
}
const isOpenStatus = (s) => String(s || '').toLowerCase() === 'unpaid';
/* True once this invoice's balance has been added into a newer invoice. */
const isAbsorbed = (inv) => !!(inv && (String(inv.carried_into_invoice_no || '').trim() || inv.carried_forward));

let pendingAdjustmentCache = [];

async function getPendingAdjustments() {
    if (!currentEmployerId) return [];
    const {data,error}=await supabaseClient.from('invoice_adjustments').select('*')
        .eq('employer_id',String(currentEmployerId)).is('applied_invoice_no',null)
        .in('type',['advance','payment','deductible']).order('created_at',{ascending:true});
    if(error){
        console.error('Adjustment ledger unavailable:',error.message);
        throw new Error('Could not load invoice adjustments. Check the Supabase invoice migration and permissions: ' + error.message);
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
        <button class="btn btn-sm btn-ghost-danger" onclick="removePendingTransaction('${x.id}')">Remove</button>
    </div>`;
    adv.innerHTML=advances.length?advances.map(row).join(''):'<div class="txn-empty">No advances or payments waiting to be applied.</div>';
    ded.innerHTML=deductibles.length?deductibles.map(x=>`<div class="txn-row">
        <div><strong>Deductible</strong><small>${x.created_at?new Date(x.created_at).toLocaleString('en-GB'):'Today'}${x.note?' · '+esc(x.note):''}</small></div>
        <div class="txn-amount">KES ${money(x.amount)}</div>
        <span class="status-pill status-canceled">Saved</span>
        <button class="btn btn-sm btn-ghost-danger" onclick="removePendingTransaction('${x.id}')">Remove</button>
    </div>`).join(''):'<div class="txn-empty">No deductibles waiting to be applied.</div>';
}

async function getDoneTasksForInvoice() {
    if (!currentEmployerId) return [];
    const {data,error} = await supabaseClient.from('tasks').select('*')
        .eq('employer_id',currentEmployerId).eq('status','Done').neq('task_type','Adjustment').order('created_at',{ascending:true});
    if(error) throw error; return data || [];
}

async function getOpenPreviousInvoices() {
    if (!currentEmployerId) return [];
    // The authoritative balance is the latest open invoice in each carry-forward chain.
    // An invoice whose balance was already carried into a newer invoice is history:
    // it must never be counted a second time (the newer invoice already contains it).
    const {data,error} = await supabaseClient.from('invoices').select('*')
        .eq('employer_id',String(currentEmployerId))
        .order('created_at',{ascending:true});
    if(error) throw error;
    const invoices = data || [];
    return invoices.filter(i =>
        isOpenStatus(i.status) &&
        invoiceOutstanding(i) > 0 &&
        !isAbsorbed(i)
    );
}

async function getRefundCredits() {
    if (!currentEmployerId) return [];
    const {data,error} = await supabaseClient.from('tasks').select('*')
        .eq('employer_id',currentEmployerId).eq('task_type','Adjustment').lt('payable',0).is('invoice_no',null)
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
    const autoPrevious=previousInvoices.reduce((sum,i)=>sum+invoiceOutstanding(i),0);
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
    }catch(e){console.error('Invoice calculation failed:',e);const hint=document.getElementById('previousBalanceHint');if(hint)hint.textContent='Calculation failed: '+e.message;return null;}
}
async function loadInvoiceAdjustmentDefaults(){return calculateFinalPayable();}

async function createInvoiceRecord() {
    if(!currentEmployerId){alert('Please select an employer first.');return null;}

    let calc;
    try { calc=await getInvoiceCalculation(); } catch (err) { alert('Invoice calculation failed: '+err.message); return null; }
    if (!calc) { alert('Invoice calculation failed. Check the console and Supabase configuration.'); return null; }

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
        const model=buildInvoiceModel(result.invoice,{
            orders:result.tasks,credits:result.calc.refundCredits,adjustments:result.calc.pendingAdjustments
        },result.employer?.employer_name||result.invoice.employer_name,result.calc.previousInvoices);
        try{
            if(format==='excel')OMInvoiceExport.exportExcel(model);
            else await OMInvoiceExport.exportWord(model);
        }catch(exportErr){
            console.error(exportErr);
            alert('The invoice was saved, but the file could not be created: '+exportErr.message+'\n\nOpen History and use the download buttons to try again.');
        }
        resetInvoiceAdjustments();
        await fetchTasks();
        await renderInvoiceHistory();
        alert(`Invoice ${result.invoice.invoice_no} generated successfully.\n\nSTATUS: UNPAID\n\nOpen History to see its orders, change or cancel an order, or record a payment.`);
    }catch(err){console.error(err);alert('Invoice generation failed: '+err.message);}
}

/* ---------- one description of an invoice, used by Word, Excel and the History detail ---------- */
const isCancelledStatus=(s)=>/^cancel/i.test(String(s||''));
const dateLabel=(v)=>v?new Date(v).toLocaleDateString('en-GB'):'today';

function buildInvoiceModel(inv,detail,employerName,absorbedInvoices){
    const d=detail||{orders:[],credits:[],adjustments:[]};
    const orders=(d.orders||[]).slice().sort((a,b)=>String(a.completed_at||a.created_at||'').localeCompare(String(b.completed_at||b.created_at||'')));
    const adv=(d.adjustments||[]).filter(x=>['advance','payment'].includes(x.type));
    const ded=(d.adjustments||[]).filter(x=>x.type==='deductible');
    const live=orders.filter(t=>!isCancelledStatus(t.status)&&t.task_type!=='Adjustment');
    const subtotal=round2(live.reduce((n,t)=>n+amount(t.payable),0));
    const absorbed=(absorbedInvoices||invoiceHistoryCache.filter(i=>i.carried_into_invoice_no===inv.invoice_no))
        .map(i=>({label:`Balance of ${i.invoice_no}`,amount:invoiceOutstanding(i)}));
    const manual=amount(inv.manual_previous_balance);
    let previousItems=absorbed.slice();
    if(manual>0)previousItems.push({label:'Manual previous balance',amount:manual});
    /* Only itemise when the lines really add up to the stored previous balance. */
    if(Math.abs(previousItems.reduce((n,x)=>n+x.amount,0)-amount(inv.previous_balance))>0.01)previousItems=[];
    return {
        invoice_no:inv.invoice_no,status:inv.status==='Cancelled'?'Canceled':inv.status,
        employer:employerName||inv.employer_name||'Employer',date:inv.created_at||new Date().toISOString(),
        orders,subtotal,previous:amount(inv.previous_balance),advances:amount(inv.advances),
        refunds:amount(inv.refunds),deductibles:amount(inv.deductibles),final:amount(inv.balance_due),
        paid:amount(inv.paid_amount),previousItems,
        advanceItems:adv.map(x=>({label:(x.type==='payment'?'Payment received ':'Advance received ')+dateLabel(x.created_at),amount:amount(x.amount)})),
        deductibleItems:ded.map(x=>({label:'Deductible '+dateLabel(x.created_at),amount:amount(x.amount)})),
        creditItems:(d.credits||[]).map(t=>({label:t.task_detail||'Credit',amount:Math.abs(Number(t.payable)||0)}))
    };
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

    const labels={Refunded:'Refund credit',Canceled:'Cancellation credit',Paid:'Payment credit',Adjusted:'Invoice correction credit'};
    const {data:creditRow,error}=await supabaseClient.from('tasks').insert([{
        employer_id:String(invoice.employer_id),
        client_name:invoice.employer_name||labels[type],
        task_detail:`${labels[type]} from ${invoice.invoice_no}`,
        task_type:'Adjustment',
        units:1,
        cpp:-value,
        payable:-value,
        // Use the known-valid task status. Credit identity is carried by task_type + negative payable,
        // so this insert does not depend on a database-specific 'Refunded' task status.
        status:'Done',
        notified:true,
        invoice_no:null
    }]).select('id').single();
    if(error){alert(`${labels[type]} could not be recorded: ${error.message}`);return false;}
    return (creditRow && creditRow.id) || true;
}
async function undoCredit(creditId){
    if(creditId && creditId!==true) await supabaseClient.from('tasks').delete().eq('id',creditId);
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
    if(status!=='Paid' && !confirm(questions[status]))return;

    const alreadyCarried=!!invoice.carried_into_invoice_no || !!invoice.carried_forward;
    const value=invoiceOutstanding(invoice);   // only the part still owed is carried / credited

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

        /* Earlier unpaid invoices that were carried into this one are owed again. */
        if(!alreadyCarried){
            const {error:restoreError}=await supabaseClient.from('invoices')
                .update({carried_forward:false,carried_into_invoice_no:null})
                .eq('carried_into_invoice_no',invoice.invoice_no);
            if(restoreError)alert('The invoice was canceled, but earlier unpaid balances could not be restored: '+restoreError.message);
        }
    }else if(status==='Paid'){
        const outstanding=value;
        if(outstanding<=0){alert('This invoice has no balance left to pay.');return;}
        const already=amount(invoice.paid_amount);
        const raw=prompt(
            `Amount received for ${invoice.invoice_no}\n`+
            `Balance due: KES ${money(outstanding)}`+(already>0?` (KES ${money(already)} already paid)`:'')+`\n\n`+
            `Enter less than the balance for a PART payment - the remainder stays unpaid and is added to your next invoice as previous balance.`,
            outstanding.toFixed(2));
        if(raw===null)return;
        const paidNow=amount(String(raw).replace(/,/g,''));
        if(paidNow<=0){alert('Enter the payment amount received.');return;}

        const applied=Math.min(paidNow,outstanding);          // goes against THIS invoice
        const excess=round2(paidNow-applied);                 // anything above the balance
        const remaining=round2(outstanding-applied);          // still owed after this payment

        const summary=remaining>0
            ? `Record KES ${money(applied)} received?\n\nKES ${money(remaining)} will stay UNPAID and be carried forward to the next invoice.`
            : excess>0
                ? `Record KES ${money(paidNow)} received?\n\nThe invoice will be fully PAID, and the extra KES ${money(excess)} will be saved as an advance on your next invoice.`
                : `Mark ${invoice.invoice_no} as fully PAID (KES ${money(applied)})?`;
        if(!confirm(summary))return;

        /* 1) If this invoice's balance was already included in a later invoice, credit only what was just paid. */
        let creditId=true;
        if(alreadyCarried){
            creditId=await createCredit(invoice,'Paid',applied);
            if(!creditId)return;
        }

        /* 2) Update the invoice itself: fully paid, or still unpaid with the part payment remembered. */
        const {error}=await supabaseClient.from('invoices').update({
            status:remaining>0?'Unpaid':'Paid',
            paid_amount:round2(already+applied),
            paid_at:new Date().toISOString()
        }).eq('id',id);
        if(error){
            await undoCredit(creditId);
            alert('Could not record the payment: '+error.message);return;
        }

        /* 3) Payment log (for your records). The invoice row above is what drives the balance. */
        const {error:payError}=await supabaseClient.from('invoice_adjustments').insert([{
            employer_id:String(invoice.employer_id), invoice_id:id, type:'payment',
            amount:applied, applied_invoice_no:invoice.invoice_no,
            note:remaining>0?`Part payment for ${invoice.invoice_no}`:`Payment received for ${invoice.invoice_no}`
        }]);
        if(payError)console.error('Payment log entry failed (balance is still correct):',payError.message);

        /* 4) Overpayment becomes an advance that the next invoice will deduct. */
        if(excess>0){
            const {error:exError}=await supabaseClient.from('invoice_adjustments').insert([{
                employer_id:String(invoice.employer_id), type:'advance', amount:excess,
                note:`Overpayment on ${invoice.invoice_no}`, applied_invoice_no:null
            }]);
            if(exError)alert(`The invoice is paid, but the extra KES ${money(excess)} could not be saved as an advance: ${exError.message}\nAdd it manually as an advance.`);
        }
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

/* Invoices closed as "Paid" by the old code even though less than the full amount was received.
   Re-open them so the unpaid remainder shows up and carries forward. */
async function reopenShortPaid(id){
    const {data:invoice,error:readError}=await supabaseClient.from('invoices').select('*').eq('id',id).single();
    if(readError||!invoice){alert('Invoice could not be found.');return;}
    const owed=invoiceOutstanding(invoice);
    if(String(invoice.status)!=='Paid'||owed<=0){alert('This invoice has no unpaid balance.');return;}
    const carried=!!invoice.carried_into_invoice_no||!!invoice.carried_forward;
    const note=carried
        ?`\n\nNote: this invoice was already carried into ${invoice.carried_into_invoice_no||'a later invoice'} when it was closed, so the later invoice may be short by KES ${money(owed)}. Add that amount as "Previous balance (manual)" on your next invoice.`
        :'\n\nIt will be added to your next invoice as previous balance.';
    if(!confirm(`${invoice.invoice_no} was marked Paid but only KES ${money(invoice.paid_amount)} of KES ${money(invoice.balance_due)} was received.\n\nRe-open the unpaid KES ${money(owed)}?${note}`))return;
    const {error}=await supabaseClient.from('invoices').update({status:'Unpaid'}).eq('id',id);
    if(error){alert('Could not re-open the invoice: '+error.message);return;}
    await fetchTasks(); await renderInvoiceHistory(); await calculateFinalPayable();
}

function setHistoryFilter(status,button){
    const select=document.getElementById('historyStatusFilter');
    if(select)select.value=status;
    document.querySelectorAll('.history-filter-btn').forEach(b=>b.classList.remove('active'));
    if(button)button.classList.add('active');
    renderInvoiceHistory();
}

/* ---------------- History: open an invoice to see / change its orders ---------------- */
const expandedInvoices=new Set();
let editingOrder=null;        // {taskId}
let editDraft={};
let detailCache={};           // invoice_no -> {orders, credits, adjustments}

async function loadInvoiceDetails(nos){
    detailCache={};
    if(!nos.length)return;
    const [t,a]=await Promise.all([
        supabaseClient.from('tasks').select('*').in('invoice_no',nos).order('created_at',{ascending:true}),
        supabaseClient.from('invoice_adjustments').select('*').in('applied_invoice_no',nos).is('invoice_id',null)
    ]);
    nos.forEach(n=>{detailCache[n]={orders:[],credits:[],adjustments:[]};});
    (t.data||[]).forEach(x=>{const d=detailCache[x.invoice_no];if(!d)return;(x.task_type==='Adjustment'?d.credits:d.orders).push(x);});
    (a.data||[]).forEach(x=>{const d=detailCache[x.applied_invoice_no];if(d)d.adjustments.push(x);});
}

function toggleInvoiceDetail(id){
    if(expandedInvoices.has(id)){expandedInvoices.delete(id);if(editingOrder)editingOrder=null;}
    else expandedInvoices.add(id);
    renderInvoiceHistory();
}

const invoiceIsLocked=(inv)=>['Refunded','Canceled','Cancelled'].includes(inv.status);

function renderInvoiceDetail(inv){
    const d=detailCache[inv.invoice_no]||{orders:[],credits:[],adjustments:[]};
    const locked=invoiceIsLocked(inv);
    const orders=d.orders.slice().sort((a,b)=>String(a.completed_at||a.created_at||'').localeCompare(String(b.completed_at||b.created_at||'')));
    const live=orders.filter(t=>!isCancelledStatus(t.status));
    const subtotal=round2(live.reduce((n,t)=>n+amount(t.payable),0));
    const units=live.reduce((n,t)=>n+(Number(t.units)||0),0);
    const rows=orders.length?orders.map((t,i)=>{
        const cancelled=isCancelledStatus(t.status);
        if(editingOrder&&editingOrder.taskId===t.id){
            const dr=editDraft;
            return `<tr class="editing">
                <td>${i+1}</td>
                <td>${esc(t.client_name||'-')}</td>
                <td><input id="eoDetail" value="${esc(dr.detail)}" oninput="editDraft.detail=this.value"></td>
                <td><span class="chip">${esc(t.task_type||'-')}</span></td>
                <td>${t.completed_at?new Date(t.completed_at).toLocaleDateString('en-GB'):'—'}</td>
                <td><input id="eoUnits" type="number" min="0" step="any" value="${esc(dr.units)}" oninput="editDraft.units=this.value"></td>
                <td><input id="eoCpp" type="number" min="0" step="any" value="${esc(dr.cpp)}" oninput="editDraft.cpp=this.value"></td>
                <td class="num">${money((Number(dr.units)||0)*(Number(dr.cpp)||0))}</td>
                <td><div class="btn-row"><button class="btn btn-sm btn-success" onclick="saveOrderEdit('${inv.id}','${t.id}')">Save</button>
                <button class="btn btn-sm btn-ghost" onclick="cancelOrderEdit()">Discard</button></div></td></tr>`;
        }
        const actions=locked?'<span class="muted small">Read only</span>':cancelled
            ?`<div class="btn-row"><button class="btn btn-sm btn-success" onclick="restoreInvoiceOrder('${inv.id}','${t.id}')">Restore</button></div>`
            :`<div class="btn-row">
                <button class="btn btn-sm btn-warn" onclick="startOrderEdit('${t.id}')">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="cancelInvoiceOrder('${inv.id}','${t.id}')">Cancel</button>
                <button class="btn btn-sm btn-ghost" title="Take it off this invoice and send it back to Completed" onclick="removeOrderFromInvoice('${inv.id}','${t.id}')">Remove</button></div>`;
        return `<tr class="${cancelled?'is-cancelled':''}">
            <td>${i+1}</td><td>${esc(t.client_name||'-')}</td><td>${esc(t.task_detail||'-')}</td>
            <td><span class="chip">${esc(t.task_type||'-')}</span></td>
            <td>${t.completed_at?new Date(t.completed_at).toLocaleDateString('en-GB'):'—'}</td>
            <td class="num">${esc(t.units)}</td><td class="num">${money(t.cpp)}</td><td class="num">${money(t.payable)}</td>
            <td>${cancelled?'<span class="status-pill status-canceled">Cancelled</span> ':''}${actions}</td></tr>`;
    }).join(''):'<tr><td colspan="9" class="history-empty">No orders are linked to this invoice (it may only carry a previous balance).</td></tr>';
    const note=locked?`<div class="detail-note">This invoice is ${esc(inv.status==='Cancelled'?'Canceled':inv.status)}, so its orders can no longer be changed.</div>`
        :isAbsorbed(inv)?`<div class="detail-note">This invoice's balance was already carried into <b>${esc(inv.carried_into_invoice_no||'a later invoice')}</b>. If you change an order, the difference is applied to your next invoice as a credit automatically.</div>`:'';
    return `<tr class="invoice-detail"><td colspan="8"><div class="detail-box">
        <div class="detail-head"><div><h4>Orders in ${esc(inv.invoice_no)}</h4><small>${live.length} billed · ${orders.length-live.length} cancelled</small></div>
            <div class="btn-row"><button class="btn btn-sm btn-dark" onclick="downloadInvoice('${inv.id}','word')">📄 Word</button>
            <button class="btn btn-sm btn-success" onclick="downloadInvoice('${inv.id}','excel')">📊 Excel</button></div></div>
        ${note}
        <div style="overflow-x:auto"><table class="detail-table"><thead><tr><th>#</th><th>Client</th><th>Detail</th><th>Type</th><th>Date done</th><th class="num">Pages</th><th class="num">CPP</th><th class="num">Payable</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="detail-foot"><div class="detail-sums"><span>Orders: <b>KES ${money(subtotal)}</b></span><span>Pages: <b>${units}</b></span>
            <span>Previous: <b>KES ${money(inv.previous_balance)}</b></span><span>Adjustments: <b>−KES ${money(amount(inv.advances)+amount(inv.refunds)+amount(inv.deductibles))}</b></span></div>
            <div><b>Balance due: KES ${money(inv.balance_due)}</b></div></div>
    </div></td></tr>`;
}

async function renderInvoiceHistory(){
    const body=document.getElementById('historyBody');
    if(!body)return;
    if(!currentEmployerId){
        body.innerHTML='<tr><td colspan="8" class="history-empty">Pick an employer to see their invoices.</td></tr>';
        return;
    }

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

    const open=filtered.filter(i=>expandedInvoices.has(i.id));
    try{await loadInvoiceDetails(open.map(i=>i.invoice_no));}catch(e){console.error('Invoice detail load failed',e);}

    body.innerHTML=filtered.length?filtered.map(inv=>{
        const adjustments=amount(inv.advances)+amount(inv.refunds)+amount(inv.deductibles);
        const locked=invoiceIsLocked(inv);
        const paidSoFar=amount(inv.paid_amount), owed=invoiceOutstanding(inv);
        const partPaid=isOpenStatus(inv.status)&&paidSoFar>0&&owed>0;
        const shortPaid=inv.status==='Paid'&&paidSoFar>0&&owed>0;
        const isOpen=expandedInvoices.has(inv.id);
        const row=`<tr class="invoice-row ${isOpen?'open':''}" onclick="toggleInvoiceDetail('${inv.id}')">
            <td><span class="chev">▶</span><strong>${esc(inv.invoice_no)}</strong>
                <div class="view-hint">${isOpen?'Hide orders':'View orders'}</div>
                ${inv.carried_into_invoice_no?`<div class="muted small">Carried into ${esc(inv.carried_into_invoice_no)}</div>`:''}</td>
            <td>${inv.created_at?new Date(inv.created_at).toLocaleDateString('en-GB'):'-'}</td>
            <td class="num">KES ${money(inv.subtotal)}</td>
            <td class="num">KES ${money(inv.previous_balance)}</td>
            <td class="num">−KES ${money(adjustments)}</td>
            <td class="num"><strong>KES ${money(inv.balance_due)}</strong>${partPaid||shortPaid?`<div class="small" style="color:#9a5b00">Paid ${money(paidSoFar)} · Owing ${money(owed)}</div>`:''}</td>
            <td><span class="status-pill ${invoiceStatusClass(inv.status)}">${isOpenStatus(inv.status)&&isAbsorbed(inv)?'Carried forward':partPaid?'Part paid':esc(inv.status==='Cancelled'?'Canceled':inv.status)}</span>
                ${shortPaid?`<div class="small" style="color:#a82a2b;margin-top:4px">Short paid by KES ${money(owed)}</div>
                <button class="btn btn-sm btn-warn" onclick="event.stopPropagation();reopenShortPaid('${inv.id}')" style="margin-top:4px">Re-open balance</button>`:''}</td>
            <td onclick="event.stopPropagation()"><div class="invoice-action-group">
                <button class="btn btn-sm btn-success" onclick="updateInvoiceStatus('${inv.id}','Paid')" ${locked?'disabled':''}>✓ Paid</button>
                <button class="btn btn-sm btn-warn" onclick="updateInvoiceStatus('${inv.id}','Unpaid')" ${inv.status==='Unpaid'?'disabled':''}>↺ Unpaid</button>
                <button class="btn btn-sm btn-purple" onclick="updateInvoiceStatus('${inv.id}','Refunded')" ${locked?'disabled':''}>↩ Refund</button>
                <button class="btn btn-sm btn-danger" onclick="updateInvoiceStatus('${inv.id}','Canceled')" ${locked?'disabled':''}>✕ Cancel</button>
            </div></td>
        </tr>`;
        return row+(isOpen?renderInvoiceDetail(inv):'');
    }).join(''):'<tr><td colspan="8" class="history-empty">No invoices match this filter.</td></tr>';

    const sum=(filter)=>invoiceHistoryCache.filter(filter).reduce((s,i)=>s+amount(i.balance_due),0);
    const unpaidList=invoiceHistoryCache.filter(i=>i.status==='Unpaid'&&!isAbsorbed(i));
    const unpaidTotal=unpaidList.reduce((t,i)=>t+invoiceOutstanding(i),0);
    const summary=document.getElementById('historySummary');
    if(summary)summary.innerHTML=`
        <div class="history-summary-card unpaid"><small>Unpaid</small><b>KES ${money(unpaidTotal)}</b></div>
        <div class="history-summary-card paid"><small>Paid</small><b>KES ${money(sum(i=>i.status==='Paid'))}</b></div>
        <div class="history-summary-card refunded"><small>Refunded</small><b>KES ${money(sum(i=>i.status==='Refunded'))}</b></div>
        <div class="history-summary-card canceled"><small>Canceled</small><b>KES ${money(sum(i=>['Canceled','Cancelled'].includes(i.status)))}</b></div>`;
    const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    setText('unpaidTotal',money(unpaidTotal));
    setText('unpaidCountNote',`KES · ${unpaidList.length} invoice${unpaidList.length===1?'':'s'}`);
    setText('countHistory',invoiceHistoryCache.length);
    await calculateFinalPayable();
}

/* ---------------- changing orders after an invoice was made ---------------- */
function startOrderEdit(taskId){
    const t=Object.values(detailCache).flatMap(d=>d.orders).find(x=>x.id===taskId);
    if(!t)return;
    editingOrder={taskId};
    editDraft={detail:t.task_detail||'',units:t.units,cpp:t.cpp};
    renderInvoiceHistory();
}
function cancelOrderEdit(){editingOrder=null;editDraft={};renderInvoiceHistory();}

async function setTaskStatus(id,status){
    let r=await supabaseClient.from('tasks').update({status}).eq('id',id);
    if(r.error&&status==='Canceled'){ r=await supabaseClient.from('tasks').update({status:'Cancelled'}).eq('id',id); }
    return r;
}

async function saveOrderEdit(invoiceId,taskId){
    const units=Number(editDraft.units), cpp=Number(editDraft.cpp), detail=String(editDraft.detail||'').trim();
    if(!detail){alert('The order detail cannot be empty.');return;}
    if(!(units>0)){alert('Pages / units must be more than zero. To drop the order, use Cancel.');return;}
    if(!(cpp>=0)){alert('Enter a valid CPP (rate).');return;}
    const {error}=await supabaseClient.from('tasks').update({task_detail:detail,units,cpp,payable:round2(units*cpp)}).eq('id',taskId);
    if(error){alert('Could not save the order: '+error.message);return;}
    editingOrder=null;editDraft={};
    await afterOrderChange(invoiceId,'Order updated.');
}
async function cancelInvoiceOrder(invoiceId,taskId){
    if(!confirm('Cancel this order? It is kept on the invoice for your records but no longer billed, and the invoice total goes down.'))return;
    const {error}=await setTaskStatus(taskId,'Canceled');
    if(error){alert('Could not cancel the order: '+error.message);return;}
    await afterOrderChange(invoiceId,'Order cancelled.');
}
async function restoreInvoiceOrder(invoiceId,taskId){
    const {error}=await supabaseClient.from('tasks').update({status:'Invoiced'}).eq('id',taskId);
    if(error){alert('Could not restore the order: '+error.message);return;}
    await afterOrderChange(invoiceId,'Order restored.');
}
async function removeOrderFromInvoice(invoiceId,taskId){
    if(!confirm('Take this order off the invoice and send it back to Completed? It will be billed on your next invoice instead.'))return;
    const {error}=await supabaseClient.from('tasks').update({status:'Done',invoice_no:null}).eq('id',taskId);
    if(error){alert('Could not remove the order: '+error.message);return;}
    await afterOrderChange(invoiceId,'Order moved back to Completed.');
}

async function afterOrderChange(invoiceId){
    const msg=await recalcInvoice(invoiceId);
    await fetchTasks();
    await renderInvoiceHistory();
    if(msg)alert(msg);
}

/* Re-adds up the invoice from its live orders, keeps the money records consistent,
   and returns a message when something else had to be adjusted. */
async function recalcInvoice(invoiceId){
    const {data:inv,error}=await supabaseClient.from('invoices').select('*').eq('id',invoiceId).single();
    if(error||!inv)return 'Invoice could not be reloaded.';
    const {data:orders,error:oe}=await supabaseClient.from('tasks').select('*').eq('invoice_no',inv.invoice_no).neq('task_type','Adjustment');
    if(oe)return 'Could not read the invoice orders: '+oe.message;

    const subtotal=round2((orders||[]).filter(t=>!isCancelledStatus(t.status)).reduce((n,t)=>n+amount(t.payable),0));
    const oldDue=amount(inv.balance_due);
    const newDue=Math.max(0,round2(subtotal+amount(inv.previous_balance)-amount(inv.advances)-amount(inv.refunds)-amount(inv.deductibles)));
    const rawPaid=amount(inv.paid_amount);
    const paid=(inv.status==='Paid'&&rawPaid===0)?oldDue:rawPaid;       // very old "Paid" rows stored no amount
    const oldOutstanding=Math.max(0,round2(oldDue-paid));

    const patch={subtotal,balance_due:newDue};
    const notes=[];
    let excess=0, newPaid=paid;
    if(newDue<paid){ excess=round2(paid-newDue); newPaid=newDue; patch.paid_amount=newDue; if(inv.status==='Unpaid')patch.status='Paid'; }
    else if(inv.status==='Paid'&&newDue>paid+0.004){ patch.status='Unpaid'; patch.paid_amount=paid; notes.push(`The invoice now has KES ${money(round2(newDue-paid))} unpaid, so it was re-opened as Unpaid.`); }
    const newOutstanding=Math.max(0,round2(newDue-newPaid));

    const {error:ue}=await supabaseClient.from('invoices').update(patch).eq('id',invoiceId);
    if(ue)return 'The order was changed but the invoice total could not be updated: '+ue.message;

    if(excess>0){
        const {error:ae}=await supabaseClient.from('invoice_adjustments').insert([{
            employer_id:String(inv.employer_id),type:'advance',amount:excess,applied_invoice_no:null,
            note:`Overpayment after changing ${inv.invoice_no}`}]);
        notes.push(ae?`KES ${money(excess)} was paid above the new total - add it manually as an advance (${ae.message}).`
            :`KES ${money(excess)} was already paid above the new total and has been saved as an advance for your next invoice.`);
    }
    if(isAbsorbed(inv)){
        const diff=round2(oldOutstanding-newOutstanding);
        if(diff>0){
            const ok=await createCredit(inv,'Adjusted',diff);
            notes.push(ok?`This invoice's balance was already carried into a later invoice, so a credit of KES ${money(diff)} will be taken off your next invoice.`
                :`Add KES ${money(diff)} as a deductible on your next invoice.`);
        }else if(diff<0){
            notes.push(`This invoice's balance was already carried into a later invoice and is now KES ${money(-diff)} higher. Add that amount as "Previous balance (manual)" on your next invoice.`);
        }
    }
    return notes.join('\n\n');
}

async function downloadInvoice(id,format){
    try{
        const inv=invoiceHistoryCache.find(i=>i.id===id);
        if(!inv)return;
        await loadInvoiceDetails([inv.invoice_no]);
        const model=buildInvoiceModel(inv,detailCache[inv.invoice_no],inv.employer_name);
        if(format==='excel')OMInvoiceExport.exportExcel(model);else await OMInvoiceExport.exportWord(model);
    }catch(e){console.error(e);alert('Could not create the file: '+e.message);}
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
