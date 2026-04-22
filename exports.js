 async function generateWordInvoice(employerId, empName) {
    // 1. Fetch only 'Done' tasks for this specific employer
    const { data: doneTasks, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('employer_id', employerId)
        .eq('status', 'Done');

    if (error || !doneTasks || doneTasks.length === 0) {
        alert(`No completed tasks found for ${empName}. Mark some tasks as 'Done' first.`);
        return;
    }

    // 2. Generate Invoice Meta
    const invoiceNo = `INV-${Date.now().toString().slice(-4)}`;
    let gross = 0;
    let adjustments = 0;

    // 3. Build the table rows with Client info included
    const tableRows = doneTasks.map(t => {
        const val = parseFloat(t.payable) || 0;
        const isAdj = t.task_type === 'Adjustment' || t.task_detail.toLowerCase().includes('adjustment');
        
        if (isAdj) adjustments += val;
        else gross += val;
        
        return `
            <tr>
                <td style='padding:5px;'>${t.client_name || '-'}</td>
                <td style='padding:5px;'>${t.task_detail}</td>
                <td style='padding:5px; text-align:center;'>${isAdj ? '-' : t.units}</td>
                <td style='padding:5px; text-align:right;'>${t.cpp}</td>
                <td style='padding:5px; text-align:right;'>${val.toFixed(2)}</td>
            </tr>`;
    }).join('');

    // 4. Word-compatible HTML Template
    let content = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset="utf-8"></head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif;">
            <div style='text-align:center; border-bottom: 2px solid #333; margin-bottom: 20px;'>
                <h1 style='margin-bottom:0;'>INVOICE</h1>
                <p style='margin-top:5px;'>Generated via SmartSourcing ERP</p>
            </div>
            
            <table style='width:100%; margin-bottom: 20px;'>
                <tr>
                    <td><strong>Billed To:</strong><br>${empName}</td>
                    <td style='text-align:right;'>
                        <strong>Invoice #:</strong> ${invoiceNo}<br>
                        <strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}
                    </td>
                </tr>
            </table>

            <table border='1' style='width:100%; border-collapse:collapse; margin-bottom:20px;'>
                <tr style='background:#f2f2f2;'>
                    <th style='padding:8px;'>Client</th>
                    <th style='padding:8px;'>Description</th>
                    <th style='padding:8px;'>Units</th>
                    <th style='padding:8px;'>CPP</th>
                    <th style='padding:8px;'>Total (KES)</th>
                </tr>
                ${tableRows}
            </table>

            <div style='text-align:right; font-size: 14px;'>
                <p>Gross Amount: KES ${gross.toLocaleString()}</p>
                <p>Adjustments/Fees: KES ${adjustments.toLocaleString()}</p>
                <h3 style='color:#2c3e50;'>Net Total: KES ${(gross + adjustments).toLocaleString()}</h3>
            </div>
            
            <div style='margin-top:50px; border-top: 1px solid #eee; padding-top:10px; font-size:10px; color:#888;'>
                <p>Please process payment within the agreed timeframe. Thank you!</p>
            </div>
        </body>
        </html>`;

    // 5. Trigger Download
    const blob = new Blob(['\ufeff', content], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Invoice_${empName}_${invoiceNo}.doc`;
    link.click();

    // 6. Update Database State
    // We delay this slightly to ensure the download starts first
    setTimeout(async () => {
        if (confirm("Invoice downloaded! Move these tasks to 'Invoiced' status?")) {
            const { error: updateError } = await supabaseClient
                .from('tasks')
                .update({ 
                    status: 'Invoiced', 
                    invoice_no: invoiceNo 
                })
                .eq('employer_id', employerId)
                .eq('status', 'Done');

            if (updateError) {
                alert("Database update failed, but your file was saved.");
            } else {
                await fetchTasks(); // Refresh UI to move items to Pending Payment tab
            }
        }
    }, 1000);
}

async function generateExcelInvoice(employerId, empName) {
    // 1. Fetch only 'Done' tasks for this specific employer
    const { data: doneTasks, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('employer_id', employerId)
        .eq('status', 'Done');

    if (error || !doneTasks || doneTasks.length === 0) {
        alert(`No completed orders found for ${empName}!`);
        return;
    }

    const invoiceNo = `INV-${Date.now().toString().slice(-4)}`;
    
    // 2. Define the header rows
    const rows = [
        ["INVOICE - " + empName.toUpperCase()],
        ["Invoice #", invoiceNo, "Date", new Date().toLocaleDateString('en-GB')],
        [],
        ["Client", "Detail", "Units", "CPP", "Payable"] // Added Client column
    ];

    let grossTotal = 0;
    let adjustmentTotal = 0;

    // 3. Populate rows and handle math
    doneTasks.forEach(t => {
        const val = parseFloat(t.payable) || 0;
        const isAdj = t.task_type === 'Adjustment' || t.task_detail.toLowerCase().includes('adjustment');
        
        if (isAdj) {
            adjustmentTotal += val;
        } else {
            grossTotal += val;
        }

        rows.push([
            t.client_name || '-', 
            t.task_detail, 
            isAdj ? "-" : (t.units || "-"), 
            t.cpp, 
            val
        ]);
    });

    // 4. Add Summary Footer
    rows.push(
        [],
        ["", "", "", "GROSS TOTAL:", grossTotal],
        ["", "", "", "ADJUSTMENTS:", adjustmentTotal],
        ["", "", "", "NET TOTAL:", (grossTotal + adjustmentTotal)]
    );

    // 5. Generate and Download Excel File
    try {
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice");
        XLSX.writeFile(workbook, `Invoice_${empName}_${invoiceNo}.xlsx`);

        // 6. Update Database State
        setTimeout(async () => {
            if (confirm("Excel downloaded! Move these tasks to 'Invoiced' status?")) {
                const { error: updateError } = await supabaseClient
                    .from('tasks')
                    .update({ 
                        status: 'Invoiced', 
                        invoice_no: invoiceNo 
                    })
                    .eq('employer_id', employerId)
                    .eq('status', 'Done');

                if (updateError) {
                    alert("File saved, but database update failed.");
                } else {
                    await fetchTasks(); // Refresh UI
                }
            }
        }, 1000);

    } catch (err) {
        console.error("Excel Generation Error:", err);
        alert("Could not generate Excel. Ensure the XLSX library is loaded.");
    }
}