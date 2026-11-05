-- INVOICE LEDGER V4
-- Run after the V3 migration.
create table if not exists public.invoice_adjustments (
    id uuid primary key default gen_random_uuid(),
    employer_id text not null,
    invoice_id uuid null references public.invoices(id) on delete set null,
    type text not null check (type in ('advance','payment','deductible')),
    amount numeric(14,2) not null default 0 check (amount >= 0),
    note text,
    applied_invoice_no text,
    created_at timestamptz not null default now()
);

alter table public.invoices add column if not exists manual_previous_balance numeric(14,2) not null default 0;
alter table public.invoices add column if not exists paid_amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists carried_forward boolean not null default false;
alter table public.invoices add column if not exists refund_recorded boolean not null default false;
alter table public.invoices add column if not exists carried_into_invoice_no text;

create index if not exists invoice_adjustments_employer_idx on public.invoice_adjustments(employer_id, created_at desc);
create index if not exists invoice_adjustments_pending_idx on public.invoice_adjustments(employer_id, applied_invoice_no);
create index if not exists invoice_adjustments_invoice_idx on public.invoice_adjustments(invoice_id);

alter table public.invoice_adjustments enable row level security;
drop policy if exists invoice_adjustments_select_anon on public.invoice_adjustments;
create policy invoice_adjustments_select_anon on public.invoice_adjustments for select to anon, authenticated using (true);
drop policy if exists invoice_adjustments_insert_anon on public.invoice_adjustments;
create policy invoice_adjustments_insert_anon on public.invoice_adjustments for insert to anon, authenticated with check (true);
drop policy if exists invoice_adjustments_update_anon on public.invoice_adjustments;
create policy invoice_adjustments_update_anon on public.invoice_adjustments for update to anon, authenticated using (true) with check (true);
drop policy if exists invoice_adjustments_delete_anon on public.invoice_adjustments;
create policy invoice_adjustments_delete_anon on public.invoice_adjustments for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.invoice_adjustments to anon, authenticated;

-- Existing V3 invoices retain their automatic previous balance.
-- manual_previous_balance defaults to zero, so no existing invoice total changes.
