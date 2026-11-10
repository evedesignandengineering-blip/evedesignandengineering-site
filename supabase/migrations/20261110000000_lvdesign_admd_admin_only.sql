-- LVDesign Web: ADMD (metering from DNAT) for admins only. Requested by Ishan 2026-11-09.
-- Run once in the Supabase SQL editor. It replaces the "anyone with access" checks from lvd_admd_store.sql,
-- lvd_dnat_login.sql and lvd_admd_helper.sql with lvd_private.is_admin(). Safe to run more than once.

-- 1. Shared ADMD store: only admins can read or write it.
drop policy if exists lvd_admd_read on public.lvd_admd;
drop policy if exists lvd_admd_insert on public.lvd_admd;
drop policy if exists lvd_admd_update on public.lvd_admd;
create policy lvd_admd_read on public.lvd_admd for select to authenticated using (lvd_private.is_admin());
create policy lvd_admd_insert on public.lvd_admd for insert to authenticated with check (lvd_private.is_admin());
create policy lvd_admd_update on public.lvd_admd for update to authenticated using (lvd_private.is_admin()) with check (lvd_private.is_admin());

-- 2. Company DNAT login: only admins get it.
create or replace function public.lvd_dnat_login() returns json language sql stable security definer set search_path = public as $$
  select case when lvd_private.is_admin() and lvd_private.origin_ok() then
    (select json_build_object('u', max(v) filter (where k = 'dnat_user'), 'p', max(v) filter (where k = 'dnat_pass')) from lvd_private.config where k in ('dnat_user', 'dnat_pass')) end; $$;

-- 3. Metering helper: only admins can start one, see it, or send it requests.
create or replace function public.lvd_helper_start() returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not lvd_private.is_admin() then raise exception 'Only an administrator can load ADMD.'; end if;
  insert into public.lvd_admd_helper(user_id, token_hash) values (auth.uid(), encode(extensions.digest(t, 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_seen = null, expires_at = now() + interval '7 days';
  update public.lvd_admd_job set status = 'error', message = 'A new helper was started.', done_at = now() where user_id = auth.uid() and status = 'running';
  return t;
end $$;

create or replace function public.lvd_helper_status() returns json language sql stable security definer set search_path = public as $$
  select json_build_object('seen', h.last_seen, 'age', extract(epoch from now() - h.last_seen)::int, 'expires', h.expires_at,
    'busy', exists (select 1 from public.lvd_admd_job j where j.user_id = h.user_id and j.status = 'running' and j.created_at > now() - interval '20 minutes'))
  from public.lvd_admd_helper h where h.user_id = auth.uid() and h.expires_at > now() and lvd_private.is_admin(); $$;

create or replace function public.lvd_admd_request(p_month text, p_ids text[]) returns bigint language plpgsql volatile security definer set search_path = public as $$
declare ids text[]; jid bigint;
begin
  if not lvd_private.is_admin() then raise exception 'Only an administrator can load ADMD.'; end if;
  select array_agg(distinct x) into ids from unnest(p_ids) x where x ~ '^[0-9A-Za-z]{1,20}$';
  if ids is null then raise exception 'No meter IDs to look up.'; end if;
  delete from public.lvd_admd_job where created_at < now() - interval '1 day';
  insert into public.lvd_admd_job(user_id, month, meter_ids) values (auth.uid(), p_month, ids) returning id into jid;
  return jid;
end $$;

-- The helper script (token only): stops if its owner is not an admin.
create or replace function public.lvd_helper_poll(p_token text) returns json language plpgsql volatile security definer set search_path = public, extensions as $$
declare h public.lvd_admd_helper; j public.lvd_admd_job;
begin
  select * into h from public.lvd_admd_helper where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now();
  if not found then return json_build_object('stop', 'This helper has been replaced or has expired. Download a new one from LVDesign Web.'); end if;
  if not exists (select 1 from public.profiles p where p.id = h.user_id and lower(p.role) = 'admin') then
    return json_build_object('stop', 'Loading ADMD is for LVDesign Web administrators only.');
  end if;
  update public.lvd_admd_helper set last_seen = now() where user_id = h.user_id;
  update public.lvd_admd_job set status = 'error', message = 'The helper stopped before it finished.', done_at = now()
    where user_id = h.user_id and status = 'running' and created_at < now() - interval '20 minutes';
  select * into j from public.lvd_admd_job where user_id = h.user_id and status = 'pending' order by id limit 1 for update skip locked;
  if not found then return json_build_object('job', null); end if;
  update public.lvd_admd_job set status = 'running' where id = j.id;
  return json_build_object('job', j.id, 'month', j.month, 'ids', j.meter_ids);
end $$;

create or replace function public.lvd_helper_done(p_token text, p_job bigint, p_rows jsonb, p_error text) returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare h public.lvd_admd_helper; j public.lvd_admd_job; n integer := 0;
begin
  select * into h from public.lvd_admd_helper where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now();
  if not found then raise exception 'Unknown helper.'; end if;
  if not exists (select 1 from public.profiles p where p.id = h.user_id and lower(p.role) = 'admin') then raise exception 'Loading ADMD is for administrators only.'; end if;
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

-- 4. Switch off helpers and drop waiting requests that belong to non-admins.
delete from public.lvd_admd_job j where not exists (select 1 from public.profiles p where p.id = j.user_id and lower(p.role) = 'admin');
delete from public.lvd_admd_helper h where not exists (select 1 from public.profiles p where p.id = h.user_id and lower(p.role) = 'admin');
