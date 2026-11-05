# Invoice / Financial Control V4

## Changes
- Advances and payment/advance transactions are saved in `invoice_adjustments` with automatic `created_at`.
- Multiple advances can be added without changing dates manually.
- Multiple deductibles can be added and are applied exactly once.
- Previous balance has two sources: automatic outstanding unpaid invoices plus an optional manual previous balance.
- The invoice builder displays automatic previous, manual previous, and total previous separately.
- Invoice generation remains UNPAID.
- Paid status records the actual payment amount and timestamp from History.
- Existing invoice calculation workflow is preserved.
- UI redesigned for a cleaner billing dashboard experience.

## Database
Run `supabase_invoice_migration.sql` once in Supabase SQL Editor.
