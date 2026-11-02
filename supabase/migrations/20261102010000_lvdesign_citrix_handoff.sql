-- LVDesign Web: hand .net and .lvd files from a Citrix session to the same user's desktop.
-- Files are kept for 24 hours per user, readable only by that user, then deleted.
create table if not exists public.lvd_handoff (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  ext text not null check (ext in ('net', 'lvd')),
  size_bytes integer not null check (size_bytes between 0 and 26214400),
  content_b64 text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists lvd_handoff_user_idx on public.lvd_handoff(user_id, expires_at);
alter table public.lvd_handoff enable row level security;   -- no policies: reached only through the functions below

-- Replace the caller's stored set with these files. p_files: [{name, ext, size, b64}]
create or replace function public.lvd_handoff_put(p_files jsonb) returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare f jsonb; exp timestamptz := now() + interval '24 hours';
begin
  if auth.uid() is null then raise exception 'Sign in to use LVDesign Web.'; end if;
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 or jsonb_array_length(p_files) > 10 then
    raise exception 'Choose between 1 and 10 .net or .lvd files.';
  end if;
  delete from public.lvd_handoff where user_id = auth.uid() or expires_at <= now();
  for f in select * from jsonb_array_elements(p_files) loop
    insert into public.lvd_handoff(user_id, name, ext, size_bytes, content_b64, expires_at)
    values (auth.uid(), left(f->>'name', 200), lower(f->>'ext'), (f->>'size')::int, f->>'b64', exp);
  end loop;
  return exp;
end $$;

-- List the caller's stored files without content.
create or replace function public.lvd_handoff_list() returns table(id bigint, name text, ext text, size_bytes integer, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.id, h.name, h.ext, h.size_bytes, h.created_at, h.expires_at from public.lvd_handoff h
  where h.user_id = auth.uid() and h.expires_at > now() and lvd_private.has_access() order by h.ext, h.name; $$;

-- Fetch the caller's stored files with content.
create or replace function public.lvd_handoff_get() returns table(name text, ext text, size_bytes integer, content_b64 text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.name, h.ext, h.size_bytes, h.content_b64, h.expires_at from public.lvd_handoff h
  where h.user_id = auth.uid() and h.expires_at > now() and lvd_private.has_access() order by h.ext, h.name; $$;

-- Delete the caller's stored files now.
create or replace function public.lvd_handoff_clear() returns void language sql volatile security definer set search_path = public as $$
  delete from public.lvd_handoff where user_id = auth.uid() or expires_at <= now(); $$;

grant execute on function public.lvd_handoff_put(jsonb), public.lvd_handoff_list(), public.lvd_handoff_get(), public.lvd_handoff_clear() to authenticated;

-- Hourly purge of anything past 24 hours (scheduling the same name again updates the job).
-- No revoke/unschedule statements: RLS with no policies already blocks direct table access, and every function checks auth.uid() and LVDesign access.
create extension if not exists pg_cron;
select cron.schedule('lvd_handoff_purge', '7 * * * *', $$delete from public.lvd_handoff where expires_at <= now()$$);
