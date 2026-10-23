-- EVE website editor storage. Public visitors can read published layout overrides;
-- only an authenticated user whose public.profiles role is Admin can write them.
create table if not exists public.website_page_content (
  page_path text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.website_page_content enable row level security;
drop policy if exists "Published website layouts are readable" on public.website_page_content;
create policy "Published website layouts are readable"
on public.website_page_content for select to anon, authenticated using (true);
drop policy if exists "Only EVE admins can publish website layouts" on public.website_page_content;
create policy "Only EVE admins can publish website layouts"
on public.website_page_content for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin'));
