-- LVDesign Web: invite-only access, encrypted release keys, access log.
-- Applied to project hszkloepnewfkzdegfhl on 24 Oct 2026. Release keys are inserted separately at publish time.
create table if not exists public.lvd_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  note text not null default '',
  granted_at timestamptz not null default now()
);
create table if not exists public.lvd_release (
  version text primary key,
  key_b64 text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.lvd_access_log (
  id bigint generated always as identity primary key,
  user_id uuid, version text, origin text,
  ok boolean not null, reason text not null default '',
  at timestamptz not null default now()
);
alter table public.lvd_access enable row level security;
alter table public.lvd_release enable row level security;   -- no policies: readable only through lvd_get_key
alter table public.lvd_access_log enable row level security;
revoke all on public.lvd_release from anon, authenticated;

create schema if not exists lvd_private;
grant usage on schema lvd_private to authenticated;
create or replace function lvd_private.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin'); $$;
create or replace function lvd_private.has_access() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.lvd_access a where a.user_id = auth.uid() and a.active) or lvd_private.is_admin()); $$;
create or replace function lvd_private.origin_ok() returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('request.headers', true)::json->>'origin', '') in ('https://evedesignandengineering.com', 'https://www.evedesignandengineering.com'); $$;
revoke all on function lvd_private.is_admin(), lvd_private.has_access(), lvd_private.origin_ok() from public, anon;
grant execute on function lvd_private.is_admin(), lvd_private.has_access(), lvd_private.origin_ok() to authenticated;

create policy lvd_access_admin_all on public.lvd_access for all to authenticated using (lvd_private.is_admin()) with check (lvd_private.is_admin());
create policy lvd_access_self_read on public.lvd_access for select to authenticated using (user_id = (select auth.uid()));
create policy lvd_log_admin_read on public.lvd_access_log for select to authenticated using (lvd_private.is_admin());

create or replace function public.lvd_get_key(p_version text) returns text language plpgsql volatile security definer set search_path = public as $$
declare k text; o text := coalesce(current_setting('request.headers', true)::json->>'origin', '');
begin
  if auth.uid() is null then raise exception 'Sign in to use LVDesign Web.'; end if;
  if not lvd_private.origin_ok() then
    insert into public.lvd_access_log(user_id, version, origin, ok, reason) values (auth.uid(), p_version, o, false, 'origin');
    raise exception 'LVDesign Web only runs on evedesignandengineering.com.';
  end if;
  if not lvd_private.has_access() then
    insert into public.lvd_access_log(user_id, version, origin, ok, reason) values (auth.uid(), p_version, o, false, 'no access');
    raise exception 'This account does not have access to LVDesign Web. Contact EVE Design & Engineering.';
  end if;
  select key_b64 into k from public.lvd_release where version = p_version;
  if k is null then raise exception 'This version of LVDesign Web is no longer available. Reload the page.'; end if;
  insert into public.lvd_access_log(user_id, version, origin, ok) values (auth.uid(), p_version, o, true);
  return k;
end $$;
create or replace function public.lvd_check() returns boolean language sql stable security definer set search_path = public as $$
  select lvd_private.has_access() and lvd_private.origin_ok(); $$;
revoke all on function public.lvd_get_key(text), public.lvd_check() from public, anon;
grant execute on function public.lvd_get_key(text), public.lvd_check() to authenticated;
