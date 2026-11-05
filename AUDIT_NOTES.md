# Order System v7 — audit and repair notes

## Repairs applied
- Fixed offline synchronization so it checks Supabase's returned `error` field before removing a queued write. Failed queue entries remain pending and the status indicator no longer falsely reports a clean sync.
- Exposed the page's lexical employer/task state through window accessors so the offline/realtime scripts can read and update the same state.
- Fixed the order deadline countdown to use `alert_lead_hours` (the field actually saved to Supabase) and removed the duplicate countdown cell.
- Added required-field validation for client, task detail, units, employer, and deadline.
- Changed order editing to update the existing row rather than deleting it before attempting a new insert. This avoids data loss if the replacement save fails.
- Fixed legacy employer UI code that used nonexistent `employers`, `name`, `rate`, and `fetchEmployers` identifiers rather than `allEmployers`, `employer_name`, `rate_per_unit`, and `loadEmployers`.
- Prevented employer deletion from continuing when deleting its tasks fails.
- Removed a duplicate `amount()` declaration and made invoice calculation surface adjustment-ledger errors instead of silently treating a failed query as zero adjustments.
- Added missing invoice fields to the invoice migration scripts and added `supabase_repair_migration.sql` for task fields and the push-subscription table referenced by the app.
- Fixed payment/refund/cancellation credit inserts to use the established `Done` task status and identify credits by `task_type = Adjustment` plus negative payable, avoiding the `tasks_status_check` rejection when `Refunded` is not an allowed task status. Credit rows are excluded from ordinary completed-task invoice totals.

## Local verification
- `node --check` passed for all standalone JavaScript files.
- Extracted inline JavaScript blocks from `index.html`; `node --check` passed for both.
- ZIP archive integrity check passed.

## Important items not verifiable from this ZIP alone
- Live Supabase schema, RLS policies, project availability, realtime publication settings, and actual insert/update/delete permissions were not tested against your project.
- The frontend uses the Supabase `anon` key without a login flow, while the invoice migration grants broad read/write access on `invoice_adjustments`. This means anyone who can access the app and project URL may be able to read or change business data. Add Supabase Auth and employer-scoped RLS before using this for sensitive or production data; simply hiding the key in frontend code will not secure it.
- Invoice creation and status changes consist of multiple database writes rather than a single database transaction. A failure midway can leave partial state (for example, an invoice saved while an adjustment was not consumed). A robust production fix is to move invoice creation/status transitions into PostgreSQL functions (RPC) that run atomically, then call those functions from the UI.
- Offline-created employers use temporary IDs. Queued tasks referencing such an employer can require ID remapping when the employer insert receives its real Supabase ID. Test this scenario before relying on offline creation of both employers and orders.
- Push notifications require deploying `index.ts` as the `check-deadlines` Supabase Edge Function, configuring VAPID secrets, setting the public VAPID key in `alarm-engine.js`, and scheduling the function. Those hosted steps cannot be completed from this source ZIP.
- The PWA references `icon.png`; confirm that file is present at deployment. It is not included in the supplied archive.

## Migration guidance
Review `supabase_repair_migration.sql` against the existing production schema and back up the database before running it. The app's original invoice migration assumes a pre-existing invoices table and earlier schema migration(s).
