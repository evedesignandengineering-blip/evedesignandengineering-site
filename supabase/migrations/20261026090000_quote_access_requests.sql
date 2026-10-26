-- Create Quote: outside users sign up and request access; an Admin approves, denies or removes access
-- in the tool's Access panel or on /quote-access.html.
alter table public.qfd_access
  add column if not exists status text not null default 'approved' check (status in ('pending', 'approved', 'denied', 'removed')),
  add column if not exists email text not null default '',
  add column if not exists name text not null default '',
  add column if not exists company text not null default '',
  add column if not exists reason text not null default '',
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users(id) on delete set null;

create or replace function qfd_private.has_access() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.qfd_access a where a.user_id = auth.uid() and a.active and a.status = 'approved') or lvd_private.is_admin()); $$;

-- Signed-in user files (or re-reads) their own request. A denied or removed account stays that way until an Admin restores it.
create or replace function public.qfd_request(p_name text, p_company text, p_reason text) returns text language plpgsql volatile security definer set search_path = public as $$
declare s text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.qfd_access(user_id, active, status, email, name, company, reason, granted_at)
  values (auth.uid(), false, 'pending', coalesce(auth.jwt()->>'email', ''), left(coalesce(p_name, ''), 120), left(coalesce(p_company, ''), 120), left(coalesce(p_reason, ''), 600), now())
  on conflict (user_id) do nothing;
  select status into s from public.qfd_access where user_id = auth.uid();
  return s;
end $$;
revoke all on function public.qfd_request(text, text, text) from public, anon;
grant execute on function public.qfd_request(text, text, text) to authenticated;

-- Self sign-up is open, so the drawing library is limited to staff roles instead of every signed-in account.
drop policy if exists "Team can manage drawing AI documents" on public.drawing_ai_documents;
drop policy if exists "Team can read drawing AI documents" on public.drawing_ai_documents;
drop policy if exists "Team can manage drawing AI chunks" on public.drawing_ai_chunks;
drop policy if exists "Team can read drawing AI chunks" on public.drawing_ai_chunks;
create policy "Staff manage drawing AI documents" on public.drawing_ai_documents for all to authenticated
  using ((select private.current_user_role()) = any (array['Admin', 'Manager', 'Engineer', 'Drafter']))
  with check ((select private.current_user_role()) = any (array['Admin', 'Manager', 'Engineer', 'Drafter']));
create policy "Staff manage drawing AI chunks" on public.drawing_ai_chunks for all to authenticated
  using ((select private.current_user_role()) = any (array['Admin', 'Manager', 'Engineer', 'Drafter']))
  with check ((select private.current_user_role()) = any (array['Admin', 'Manager', 'Engineer', 'Drafter']));
