-- LVDesign Web: always-on metering helper.
-- The user starts get-metering-helper.cmd once inside Citrix. It keeps running, asks Supabase every few seconds for
-- metering requests from the same user's LVDesign Web pages (in Citrix or on the desktop), runs each one on DNAT and
-- writes the rows into the shared store public.lvd_admd. Citrix blocks the browser from reaching the script directly,
-- so everything goes through these functions.
-- The script holds a random helper token (only its hash is stored). Starting a new helper replaces the old token.
-- Tokens last 7 days. Requests are kept for a day.

create table if not exists public.lvd_admd_helper (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz,
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.lvd_admd_helper enable row level security;   -- no policies: only the functions below

create table if not exists public.lvd_admd_job (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{6}$'),
  meter_ids text[] not null check (cardinality(meter_ids) between 1 and 20000),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  message text,
  rows_loaded integer,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists lvd_admd_job_user on public.lvd_admd_job(user_id, status, id);
alter table public.lvd_admd_job enable row level security;      -- no policies: only the functions below

-- Page: start a helper. Returns the token to put in the script (shown once).
create or replace function public.lvd_helper_start() returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  insert into public.lvd_admd_helper(user_id, token_hash) values (auth.uid(), encode(extensions.digest(t, 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_seen = null, expires_at = now() + interval '7 days';
  update public.lvd_admd_job set status = 'error', message = 'A new helper was started.', done_at = now() where user_id = auth.uid() and status = 'running';
  return t;
end $$;

-- Page: is my helper running? (seconds since it last checked in, null if never / none)
create or replace function public.lvd_helper_status() returns json language sql stable security definer set search_path = public as $$
  select json_build_object('seen', h.last_seen, 'age', extract(epoch from now() - h.last_seen)::int, 'expires', h.expires_at,
    'busy', exists (select 1 from public.lvd_admd_job j where j.user_id = h.user_id and j.status = 'running' and j.created_at > now() - interval '20 minutes'))
  from public.lvd_admd_helper h where h.user_id = auth.uid() and h.expires_at > now() and lvd_private.has_access(); $$;

-- Page: ask my helper for the ADMD of these meters for this month. Returns the request id.
create or replace function public.lvd_admd_request(p_month text, p_ids text[]) returns bigint language plpgsql volatile security definer set search_path = public as $$
declare ids text[]; jid bigint;
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  select array_agg(distinct x) into ids from unnest(p_ids) x where x ~ '^[0-9A-Za-z]{1,20}$';
  if ids is null then raise exception 'No meter IDs to look up.'; end if;
  delete from public.lvd_admd_job where created_at < now() - interval '1 day';
  insert into public.lvd_admd_job(user_id, month, meter_ids) values (auth.uid(), p_month, ids) returning id into jid;
  return jid;
end $$;

-- Page: how is my request going?
create or replace function public.lvd_admd_job_status(p_id bigint) returns json language sql stable security definer set search_path = public as $$
  select json_build_object('status', j.status, 'message', j.message, 'rows', j.rows_loaded)
  from public.lvd_admd_job j where j.id = p_id and j.user_id = auth.uid(); $$;

-- Helper script (no sign-in, token only): check in and take the oldest waiting request.
create or replace function public.lvd_helper_poll(p_token text) returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare h public.lvd_admd_helper; j public.lvd_admd_job;
begin
  select * into h from public.lvd_admd_helper where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now();
  if not found then return json_build_object('stop', 'This helper has been replaced or has expired. Download a new one from LVDesign Web.'); end if;
  if not exists (select 1 from public.lvd_access a where a.user_id = h.user_id and a.active and a.status = 'approved')
     and not exists (select 1 from public.profiles p where p.id = h.user_id and lower(p.role) = 'admin') then
    return json_build_object('stop', 'This account no longer has access to LVDesign Web.');
  end if;
  update public.lvd_admd_helper set last_seen = now() where user_id = h.user_id;
  update public.lvd_admd_job set status = 'error', message = 'The helper stopped before it finished.', done_at = now()
    where user_id = h.user_id and status = 'running' and created_at < now() - interval '20 minutes';
  select * into j from public.lvd_admd_job where user_id = h.user_id and status = 'pending' order by id limit 1 for update skip locked;
  if not found then return json_build_object('job', null); end if;
  update public.lvd_admd_job set status = 'running' where id = j.id;
  return json_build_object('job', j.id, 'month', j.month, 'ids', j.meter_ids);
end $$;

-- Helper script: hand back the rows ([{meter_id, admd}]) or an error for a request.
create or replace function public.lvd_helper_done(p_token text, p_job bigint, p_rows jsonb, p_error text) returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare h public.lvd_admd_helper; j public.lvd_admd_job; n integer := 0;
begin
  select * into h from public.lvd_admd_helper where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now();
  if not found then raise exception 'Unknown helper.'; end if;
  select * into j from public.lvd_admd_job where id = p_job and user_id = h.user_id and status = 'running';
  if not found then return; end if;
  if p_error is not null and p_error <> '' then
    update public.lvd_admd_job set status = 'error', message = left(p_error, 1000), done_at = now() where id = j.id; return;
  end if;
  insert into public.lvd_admd(meter_id, month, admd, loaded_by, loaded_at)
  select r->>'meter_id', j.month, (r->>'admd')::double precision, h.user_id, now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where (r->>'meter_id') = any(j.meter_ids) and (r->>'admd') ~ '^-?[0-9.]+([eE][-+]?[0-9]+)?$'
  on conflict (meter_id, month) do update set admd = excluded.admd, loaded_by = excluded.loaded_by, loaded_at = excluded.loaded_at;
  get diagnostics n = row_count;
  update public.lvd_admd_job set status = 'done', rows_loaded = n, done_at = now() where id = j.id;
end $$;

revoke all on function public.lvd_helper_start(), public.lvd_helper_status(), public.lvd_admd_request(text, text[]), public.lvd_admd_job_status(bigint),
  public.lvd_helper_poll(text), public.lvd_helper_done(text, bigint, jsonb, text) from public;
grant execute on function public.lvd_helper_start(), public.lvd_helper_status(), public.lvd_admd_request(text, text[]), public.lvd_admd_job_status(bigint) to authenticated;
grant execute on function public.lvd_helper_poll(text), public.lvd_helper_done(text, bigint, jsonb, text) to anon, authenticated;
