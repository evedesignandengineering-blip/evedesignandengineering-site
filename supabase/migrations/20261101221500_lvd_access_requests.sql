-- LVDesign Web: people can request access from the sign-in page; an admin approves or denies in the app
-- (notification after sign-in) or on /lvdesign/access.html. Same pattern as Create Quote (qfd_access).
-- Existing rows default to 'approved', so current users keep their access.
alter table public.lvd_access
  add column if not exists status text not null default 'approved' check (status in ('pending', 'approved', 'denied', 'removed')),
  add column if not exists email text not null default '',
  add column if not exists name text not null default '',
  add column if not exists company text not null default '',
  add column if not exists reason text not null default '',
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users(id) on delete set null;

create or replace function lvd_private.has_access() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.lvd_access a where a.user_id = auth.uid() and a.active and a.status = 'approved')
    or lvd_private.is_admin()); $$;

-- The signed-in user files (or re-reads) their own request. A denied or removed account stays that way until an admin restores it.
create or replace function public.lvd_request(p_name text, p_company text, p_reason text) returns text language plpgsql volatile security definer set search_path = public as $$
declare s text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.lvd_access(user_id, active, status, email, name, company, reason, granted_at)
  values (auth.uid(), false, 'pending', coalesce(auth.jwt()->>'email', ''), left(coalesce(p_name, ''), 120), left(coalesce(p_company, ''), 120), left(coalesce(p_reason, ''), 600), now())
  on conflict (user_id) do nothing;
  select status into s from public.lvd_access where user_id = auth.uid();
  return s;
end $$;
revoke all on function public.lvd_request(text, text, text) from public, anon;
grant execute on function public.lvd_request(text, text, text) to authenticated;

-- Admin approves / denies / removes. Returns nothing; raises for non-admins.
create or replace function public.lvd_decide(p_user uuid, p_action text) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not lvd_private.is_admin() then raise exception 'Only an administrator can approve or deny access.'; end if;
  if p_action not in ('approve', 'deny', 'remove') then raise exception 'Unknown action %', p_action; end if;
  insert into public.lvd_access(user_id, active, status, decided_at, decided_by)
  values (p_user, p_action = 'approve', case p_action when 'approve' then 'approved' when 'deny' then 'denied' else 'removed' end, now(), auth.uid())
  on conflict (user_id) do update set active = excluded.active, status = excluded.status, decided_at = now(), decided_by = auth.uid(),
    granted_at = case when excluded.active then now() else public.lvd_access.granted_at end;
end $$;
revoke all on function public.lvd_decide(uuid, text) from public, anon;
grant execute on function public.lvd_decide(uuid, text) to authenticated;
