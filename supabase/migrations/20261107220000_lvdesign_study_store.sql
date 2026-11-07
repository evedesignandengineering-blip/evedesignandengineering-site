-- LVDesign Web: studies saved to each user's account (File > Save to my account). Same SQL as lvdesign-web/db/lvd_study_store.sql.
-- NOT yet applied: run it in the Supabase SQL editor.

create table if not exists public.lvd_study (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  nets text not null default '',
  data text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lvd_study_user_idx on public.lvd_study(user_id, updated_at desc);
alter table public.lvd_study enable row level security;
revoke all on public.lvd_study from anon, authenticated;

create or replace function public.lvd_study_list()
returns table(id uuid, name text, nets text, size_bytes integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  return query select s.id, s.name, s.nets, s.size_bytes, s.updated_at from public.lvd_study s
    where s.user_id = auth.uid() order by s.updated_at desc limit 500;
end $$;

create or replace function public.lvd_study_get(p_id uuid)
returns table(id uuid, name text, data text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  return query select s.id, s.name, s.data, s.updated_at from public.lvd_study s where s.id = p_id and s.user_id = auth.uid();
end $$;

create or replace function public.lvd_study_save(p_id uuid, p_name text, p_data text, p_nets text default '', p_expect timestamptz default null)
returns table(id uuid, updated_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_at timestamptz; cur timestamptz;
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'The study needs a name.'; end if;
  if length(p_data) > 25000000 then raise exception 'The study is over 25 MB.'; end if;
  if p_id is not null then
    select s.updated_at into cur from public.lvd_study s where s.id = p_id and s.user_id = auth.uid() for update;
    if found then
      if p_expect is not null and cur > p_expect + interval '1 millisecond' then raise exception 'CONFLICT: saved from another session since you opened it'; end if;
      update public.lvd_study s set name = left(trim(p_name), 200), nets = left(coalesce(p_nets, ''), 500), data = p_data,
        size_bytes = length(p_data), updated_at = now() where s.id = p_id returning s.id, s.updated_at into v_id, v_at;
      return query select v_id, v_at; return;
    end if;
  end if;
  if (select count(*) from public.lvd_study s where s.user_id = auth.uid()) >= 300 then
    raise exception 'You have 300 saved studies. Delete some before saving more.';
  end if;
  insert into public.lvd_study(user_id, name, nets, data, size_bytes)
    values (auth.uid(), left(trim(p_name), 200), left(coalesce(p_nets, ''), 500), p_data, length(p_data))
    returning lvd_study.id, lvd_study.updated_at into v_id, v_at;
  return query select v_id, v_at;
end $$;

create or replace function public.lvd_study_rename(p_id uuid, p_name text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'The study needs a name.'; end if;
  update public.lvd_study s set name = left(trim(p_name), 200) where s.id = p_id and s.user_id = auth.uid();
end $$;

create or replace function public.lvd_study_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not lvd_private.has_access() then raise exception 'This account does not have access to LVDesign Web.'; end if;
  delete from public.lvd_study s where s.id = p_id and s.user_id = auth.uid();
end $$;

revoke all on function public.lvd_study_list(), public.lvd_study_get(uuid), public.lvd_study_save(uuid, text, text, text, timestamptz),
  public.lvd_study_rename(uuid, text), public.lvd_study_delete(uuid) from public, anon;
grant execute on function public.lvd_study_list(), public.lvd_study_get(uuid), public.lvd_study_save(uuid, text, text, text, timestamptz),
  public.lvd_study_rename(uuid, text), public.lvd_study_delete(uuid) to authenticated;
