-- Create Quote (quote-from-drawing.html): invite-only access, same model as LVDesign Web.
-- Admins (profiles.role = 'Admin') always have access; other accounts need an active row in qfd_access.
create table if not exists public.qfd_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  note text not null default '',
  granted_at timestamptz not null default now()
);
create table if not exists public.qfd_access_log (
  id bigint generated always as identity primary key,
  user_id uuid, ok boolean not null, reason text not null default '',
  at timestamptz not null default now()
);
alter table public.qfd_access enable row level security;
alter table public.qfd_access_log enable row level security;

create schema if not exists qfd_private;
grant usage on schema qfd_private to authenticated;
create or replace function qfd_private.has_access() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.qfd_access a where a.user_id = auth.uid() and a.active) or lvd_private.is_admin()); $$;
revoke all on function qfd_private.has_access() from public, anon;
grant execute on function qfd_private.has_access() to authenticated;

create policy qfd_access_admin_all on public.qfd_access for all to authenticated using (lvd_private.is_admin()) with check (lvd_private.is_admin());
create policy qfd_access_self_read on public.qfd_access for select to authenticated using (user_id = (select auth.uid()));
create policy qfd_log_admin_read on public.qfd_access_log for select to authenticated using (lvd_private.is_admin());

-- Called by the page after sign-in and by the quote-from-drawing-ai function on every AI request.
create or replace function public.qfd_check(p_log boolean default false) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare ok boolean := qfd_private.has_access();
begin
  if auth.uid() is null then return false; end if;
  if p_log then insert into public.qfd_access_log(user_id, ok, reason) values (auth.uid(), ok, case when ok then '' else 'no access' end); end if;
  return ok;
end $$;
revoke all on function public.qfd_check(boolean) from public, anon;
grant execute on function public.qfd_check(boolean) to authenticated;
