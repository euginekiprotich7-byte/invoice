-- Order System v7 compatibility repair migration
-- Review against your existing schema, then run once in Supabase SQL Editor.
-- This is additive: it does not drop or rename existing tables/columns.

-- Task fields used by the UI, alarm engine, and invoice manager.
alter table public.tasks add column if not exists alert_lead_hours numeric not null default 1;
alter table public.tasks add column if not exists notified boolean not null default false;
alter table public.tasks add column if not exists invoice_no text;

-- Invoice fields read/written by invoice-manager.js.
alter table public.invoices add column if not exists manual_previous_balance numeric(14,2) not null default 0;
alter table public.invoices add column if not exists paid_amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists carried_forward boolean not null default false;
alter table public.invoices add column if not exists refund_recorded boolean not null default false;
alter table public.invoices add column if not exists carried_into_invoice_no text;

-- Push subscription store used by alarm-engine.js and the check-deadlines Edge Function.
create table if not exists public.user_subscriptions (
    id uuid primary key default gen_random_uuid(),
    endpoint text not null unique,
    subscription_json text not null,
    created_at timestamptz not null default now()
);

alter table public.user_subscriptions enable row level security;
-- Anonymous app mode currently registers subscriptions without Supabase Auth.
-- Keep this limited to writing subscription rows; do not add public SELECT policies.
drop policy if exists user_subscriptions_insert_anon on public.user_subscriptions;
create policy user_subscriptions_insert_anon on public.user_subscriptions
    for insert to anon, authenticated with check (true);
drop policy if exists user_subscriptions_update_anon on public.user_subscriptions;
create policy user_subscriptions_update_anon on public.user_subscriptions
    for update to anon, authenticated using (true) with check (true);
grant insert, update on public.user_subscriptions to anon, authenticated;

create index if not exists tasks_employer_status_idx on public.tasks(employer_id, status);
create index if not exists invoices_employer_created_idx on public.invoices(employer_id, created_at desc);
