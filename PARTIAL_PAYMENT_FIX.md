# v8 - part payments and balance carry-forward

No database migration is needed (uses the existing `invoices.paid_amount` column).

## What changed (invoice-manager.js)
- **Part payment**: entering less than the balance in "Paid" now records the payment, keeps the
  invoice open ("Part paid") and carries only the REMAINDER into the next invoice as previous balance.
  Paying the rest later closes it as Paid.
- **Overpayment**: the invoice closes as Paid and the extra is saved as an advance for the next invoice.
- **Carry-forward chain fixed**: once an invoice's balance is added into a newer invoice, only the NEWEST
  invoice carries on. (Before, the filter was reversed: the next invoice picked up the old invoice and
  skipped the newer one.) Carried invoices show "Carried forward" and are not counted twice in the Unpaid total.
- **Cancel** now hands earlier balances that the cancelled invoice had absorbed back to the open list.
- **Credits** for invoices already carried forward use the amount actually paid / still owed, not the full balance.
- **Re-open balance** button on invoices that the old version closed as Paid with less than the full amount.
- sw.js cache bumped to v9 so devices pick up the new file.
