/* Legacy export entry points are retained for compatibility.
   The live invoice workflow is centralized in invoice-manager.js. */
async function generateWordInvoice() {
    return generateAndSaveInvoice('word');
}
async function generateExcelInvoice() {
    return generateAndSaveInvoice('excel');
}
