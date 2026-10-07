# Order Manager 1.1.0 – Invoice & Payment Upgrade

## What changed

### 1. Invoice lifecycle
Generating an invoice now creates a permanent invoice record with its own invoice number. The included completed orders are moved from `Done` to `Invoiced` and appear in History through the invoice ledger.

Invoice statuses available from History:
- Unpaid
- Paid
- Refunded
- Canceled

Changing the invoice status no longer changes or deletes the underlying order records.

### 2. Persistent invoice adjustments
Each invoice permanently stores:
- Advances
- Refunds
- Deductibles / fines
- Balance from previous invoices

Calculation:
`Balance Due = Current Work Subtotal + Previous Balance - Advances - Refunds - Deductibles`

The previous balance is automatically calculated from earlier `Unpaid` invoices, but it remains editable before generating the next invoice.

### 3. Better History
History is now an invoice ledger rather than a list of individual task rows. It includes invoice number, date, subtotal, previous balance, adjustments, balance due, status, and status controls.

### 4. Alarm improvements
- One alarm path is used instead of competing inline alarm implementations.
- Browser audio + system notification are supported.
- Alarm banner has Dismiss and 15-minute Snooze controls.
- Notifications use the local app icon.
- Service-worker cache was bumped so new invoice/alarm files are included offline.

### 5. Offline support
Invoice records are cached in IndexedDB for offline viewing. The existing order/offline cache was upgraded to database version 2.

## REQUIRED: Run the database migration once

Open Supabase → SQL Editor and run:

`supabase_invoice_migration.sql`

The migration creates the `invoices` table, indexes, update timestamp trigger, permissions/policies, and an index for `tasks.invoice_no`.

Do this before generating the first new invoice. Existing orders and employers are not deleted.

## Important deployment step

Upload the complete project files together. Do not upload only `index.html`; the new workflow depends on:
- `invoice-manager.js`
- `notifications.js`
- `alarm-engine.js`
- updated `offline.js`
- updated `sw.js`

After deployment, if an old installed PWA continues showing the previous interface, close it completely and reload once so the service worker can install cache `inv-mgr-v6`.
