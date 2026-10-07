/* Legacy invoice UI entry point.
   Invoice rendering/history is now handled by invoice-manager.js. */
function renderHistoryTable(tasks) {
    if (typeof renderInvoiceHistory === 'function') return renderInvoiceHistory();
}
