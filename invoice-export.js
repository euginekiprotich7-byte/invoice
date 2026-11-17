/* =========================================================
   INVOICE-EXPORT.JS - builds the Word and Excel invoice files.
   Works from one "view model" so Word, Excel and the on-screen
   History detail always show the same numbers.

   model = {
     invoice_no, status, employer, date, orders:[task...],
     subtotal, previous, advances, refunds, deductibles, final,
     advanceItems:[{label,amount}], deductibleItems:[...], creditItems:[...], previousItems:[...]
   }
   ========================================================= */
(function (root) {
    'use strict';
    const num = (v) => Number(v) || 0;
    const fmt = (v) => num(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qty = (v) => { const n = num(v); return Number.isInteger(n) ? String(n) : n.toFixed(2); };
    const dShort = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB'); };
    const dTime = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
    const isCancelled = (t) => /^cancel/i.test(t.status || '');

    /* Only live orders count; cancelled ones are listed separately for the record. */
    function split(orders) {
        const list = (orders || []).filter((t) => t.task_type !== 'Adjustment');
        return { live: list.filter((t) => !isCancelled(t)), cancelled: list.filter(isCancelled) };
    }
    function totals(model) {
        const { live } = split(model.orders);
        const units = live.reduce((s, t) => s + num(t.units), 0);
        return { count: live.length, units };
    }

    /* ---------------- Excel ---------------- */
    function buildExcelRows(m) {
        const { live, cancelled } = split(m.orders);
        const tot = totals(m);
        const rows = [
            ['INVOICE', m.invoice_no], ['Billed to', m.employer], ['Invoice date', dShort(m.date)],
            ['Status', m.status], ['Orders', tot.count], ['Total pages / units', tot.units], [],
            ['#', 'Client', 'Order detail', 'Type', 'Date done', 'Pages / units', 'CPP (rate)', 'Payable (KES)']
        ];
        live.forEach((t, i) => rows.push([i + 1, t.client_name || '-', t.task_detail || '-', t.task_type || '-',
            dShort(t.completed_at), num(t.units), num(t.cpp), num(t.payable)]));
        rows.push(['', '', '', '', 'TOTAL', tot.units, '', num(m.subtotal)], []);
        rows.push(['Current orders', '', '', '', '', '', '', num(m.subtotal)]);
        rows.push(['Previous balance brought forward', '', '', '', '', '', '', num(m.previous)]);
        (m.previousItems || []).forEach((x) => rows.push(['   ' + x.label, '', '', '', '', '', '', num(x.amount)]));
        rows.push(['Less advances / payments', '', '', '', '', '', '', -num(m.advances)]);
        (m.advanceItems || []).forEach((x) => rows.push(['   ' + x.label, '', '', '', '', '', '', -num(x.amount)]));
        rows.push(['Less refund / cancellation credits', '', '', '', '', '', '', -num(m.refunds)]);
        (m.creditItems || []).forEach((x) => rows.push(['   ' + x.label, '', '', '', '', '', '', -num(x.amount)]));
        rows.push(['Less deductibles', '', '', '', '', '', '', -num(m.deductibles)]);
        (m.deductibleItems || []).forEach((x) => rows.push(['   ' + x.label, '', '', '', '', '', '', -num(x.amount)]));
        rows.push(['FINAL BALANCE DUE', '', '', '', '', '', '', num(m.final)]);
        if (num(m.paid) > 0) rows.push(['Paid so far', '', '', '', '', '', '', num(m.paid)], ['Still owing', '', '', '', '', '', '', Math.max(0, num(m.final) - num(m.paid))]);
        if (cancelled.length) {
            rows.push([], ['CANCELLED ORDERS (not billed)']);
            cancelled.forEach((t) => rows.push(['', t.client_name || '-', t.task_detail || '-', t.task_type || '-', dShort(t.completed_at), num(t.units), num(t.cpp), 0]));
        }
        return rows;
    }
    function exportExcel(m) {
        const ws = root.XLSX.utils.aoa_to_sheet(buildExcelRows(m));
        ws['!cols'] = [{ wch: 34 }, { wch: 20 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 16 }];
        const wb = root.XLSX.utils.book_new();
        root.XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
        root.XLSX.writeFile(wb, `Invoice_${m.invoice_no}.xlsx`);
    }

    /* ---------------- Word ---------------- */
    function buildWordDocument(m, docx) {
        const { Document, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, ShadingType, BorderStyle } = docx;
        const { live, cancelled } = split(m.orders);
        const tot = totals(m);
        const NAVY = '1F3A5F', LIGHT = 'EAF0F8', GREY = '666666';
        const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9D3E0' };
        const borders = { top: border, bottom: border, left: border, right: border };
        const widths = [450, 1450, 2800, 1050, 1150, 800, 900, 1450];   // sums to 10050 (A4 with 0.6" margins)
        const total = widths.reduce((a, b) => a + b, 0);

        const run = (text, o) => new TextRun(Object.assign({ text: String(text), font: 'Calibri', size: 19 }, o || {}));
        const cell = (text, i, o) => {
            o = o || {};
            return new TableCell({
                width: { size: o.span ? widths.slice(i, i + o.span).reduce((a, b) => a + b, 0) : widths[i], type: WidthType.DXA },
                columnSpan: o.span, borders,
                shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
                margins: { top: 50, bottom: 50, left: 80, right: 80 },
                children: [new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [run(text, { bold: o.bold, color: o.color, size: o.size })] })]
            });
        };
        const R = AlignmentType.RIGHT, C = AlignmentType.CENTER;

        const headRow = new TableRow({
            tableHeader: true,
            children: ['#', 'Client', 'Order detail', 'Type', 'Date done', 'Pages', 'CPP', 'Amount (KES)']
                .map((h, i) => cell(h, i, { bold: true, color: 'FFFFFF', fill: NAVY, align: i >= 5 ? R : (i === 0 ? C : AlignmentType.LEFT) }))
        });
        const body = live.map((t, i) => new TableRow({
            cantSplit: true,
            children: [
                cell(i + 1, 0, { align: C }), cell(t.client_name || '-', 1), cell(t.task_detail || '-', 2), cell(t.task_type || '-', 3),
                cell(dShort(t.completed_at), 4), cell(qty(t.units), 5, { align: R }), cell(fmt(t.cpp), 6, { align: R }), cell(fmt(t.payable), 7, { align: R })
            ]
        }));
        const totalRow = new TableRow({
            children: [cell('TOTAL — ' + tot.count + ' order' + (tot.count === 1 ? '' : 's'), 0, { span: 5, bold: true, fill: LIGHT }),
                cell(qty(tot.units), 5, { bold: true, fill: LIGHT, align: R }), cell('', 6, { fill: LIGHT }),
                cell(fmt(m.subtotal), 7, { bold: true, fill: LIGHT, align: R })]
        });
        const ordersTable = new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [headRow].concat(body, [totalRow]) });

        /* Summary block (right-aligned two-column table) */
        const sw = [7000, 3050];
        const sRow = (label, value, o) => {
            o = o || {};
            const c = (t, i, al) => new TableCell({
                width: { size: sw[i], type: WidthType.DXA }, borders,
                shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
                margins: { top: 45, bottom: 45, left: 80, right: 80 },
                children: [new Paragraph({ alignment: al, children: [run(t, { bold: o.bold, size: o.size || 19, color: o.color })] })]
            });
            return new TableRow({ children: [c(label, 0, R), c(value, 1, R)] });
        };
        const sum = [sRow('Current orders', 'KES ' + fmt(m.subtotal))];
        sum.push(sRow('Previous balance brought forward', '+ KES ' + fmt(m.previous)));
        (m.previousItems || []).forEach((x) => sum.push(sRow('   ' + x.label, '+ KES ' + fmt(x.amount), { color: GREY })));
        sum.push(sRow('Less advances / payments received', '− KES ' + fmt(m.advances)));
        (m.advanceItems || []).forEach((x) => sum.push(sRow('   ' + x.label, '− KES ' + fmt(x.amount), { color: GREY })));
        sum.push(sRow('Less refund / cancellation credits', '− KES ' + fmt(m.refunds)));
        (m.creditItems || []).forEach((x) => sum.push(sRow('   ' + x.label, '− KES ' + fmt(x.amount), { color: GREY })));
        sum.push(sRow('Less deductibles', '− KES ' + fmt(m.deductibles)));
        (m.deductibleItems || []).forEach((x) => sum.push(sRow('   ' + x.label, '− KES ' + fmt(x.amount), { color: GREY })));
        sum.push(sRow('FINAL BALANCE DUE', 'KES ' + fmt(m.final), { bold: true, fill: LIGHT, size: 24 }));
        if (num(m.paid) > 0) {
            sum.push(sRow('Paid so far', 'KES ' + fmt(m.paid)));
            sum.push(sRow('Still owing', 'KES ' + fmt(Math.max(0, num(m.final) - num(m.paid))), { bold: true }));
        }
        const summaryTable = new Table({ width: { size: sw[0] + sw[1], type: WidthType.DXA }, columnWidths: sw, alignment: AlignmentType.RIGHT, rows: sum });

        /* Header block */
        const meta = (label, value) => new Paragraph({ spacing: { after: 40 }, children: [run(label + '  ', { bold: true, color: GREY }), run(value)] });
        const children = [
            new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 60 }, children: [run('INVOICE', { bold: true, size: 48, color: NAVY })] }),
            meta('Invoice no:', m.invoice_no),
            meta('Invoice date:', dShort(m.date)),
            meta('Billed to:', m.employer),
            meta('Status:', m.status),
            meta('Summary:', `${tot.count} order${tot.count === 1 ? '' : 's'} · ${qty(tot.units)} pages/units in total`),
            new Paragraph({ spacing: { after: 120 }, children: [] }),
            ordersTable,
            new Paragraph({ spacing: { after: 200 }, children: [] }),
            summaryTable
        ];
        if (cancelled.length) {
            children.push(new Paragraph({ spacing: { before: 240, after: 80 }, children: [run('Cancelled orders (not billed)', { bold: true, color: GREY })] }));
            cancelled.forEach((t) => children.push(new Paragraph({ children: [run(`${t.client_name || '-'} — ${t.task_detail || '-'} (${qty(t.units)} × ${fmt(t.cpp)}, done ${dShort(t.completed_at)})`, { color: GREY, size: 17 })] })));
        }
        children.push(new Paragraph({ spacing: { before: 300 }, children: [run('Generated ' + dTime(new Date().toISOString()) + '. Thank you for your business.', { color: GREY, size: 17 })] }));

        const sectionProps = { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 925, right: 925 } } };
        const section = { properties: sectionProps, children };
        try {   // page numbers in the footer - guarded because docx versions differ
            if (docx.Footer && docx.PageNumber) {
                section.footers = { default: new docx.Footer({ children: [new Paragraph({ alignment: C, children: [
                    run(m.invoice_no + '  ·  Page ', { color: GREY, size: 16 }),
                    new TextRun({ children: [docx.PageNumber.CURRENT], font: 'Calibri', color: GREY, size: 16 }),
                    run(' of ', { color: GREY, size: 16 }),
                    new TextRun({ children: [docx.PageNumber.TOTAL_PAGES], font: 'Calibri', color: GREY, size: 16 })
                ] })] }) };
            }
        } catch (_) { /* footer is optional */ }
        return new Document({ creator: 'Order System Manager', title: 'Invoice ' + m.invoice_no, sections: [section] });
    }
    async function exportWord(m) {
        const doc = buildWordDocument(m, root.docx);
        root.saveAs(await root.docx.Packer.toBlob(doc), `Invoice_${m.invoice_no}.docx`);
    }

    const api = { buildExcelRows, buildWordDocument, exportExcel, exportWord, split, totals, fmt, qty, dShort };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.OMInvoiceExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
