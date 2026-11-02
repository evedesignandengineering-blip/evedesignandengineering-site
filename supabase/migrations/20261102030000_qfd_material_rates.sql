-- Create Quote: material CU unit rates taken from DQM Quote Details reports.
-- Kept in the database (not the public page source) and readable only by users with Create Quote access.
create table if not exists public.qfd_material_rates (
  cu text primary key,
  description text not null default '',
  rate numeric(12,2) not null,
  quote_date date,
  source_wr text not null default '',
  seen integer not null default 1,
  rate_min numeric(12,2),
  rate_max numeric(12,2),
  updated_at timestamptz not null default now()
);
alter table public.qfd_material_rates enable row level security;
create policy qfd_material_rates_read on public.qfd_material_rates for select to authenticated using (qfd_private.has_access());
create policy qfd_material_rates_admin_all on public.qfd_material_rates for all to authenticated using (lvd_private.is_admin()) with check (lvd_private.is_admin());
