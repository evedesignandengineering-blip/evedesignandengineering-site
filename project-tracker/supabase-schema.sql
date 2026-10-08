-- EVE Project Control — Supabase database
-- Run this once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'Viewer',
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key,
  name text not null,
  client text not null,
  type text not null default 'Electrical Design',
  status text not null default 'Planning' check (status in ('Planning','Active','On Hold','Completed')),
  priority text not null default 'Medium' check (priority in ('High','Medium','Low')),
  lead_id uuid references public.profiles(id) on delete set null,
  target_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title text not null,
  assignee_id uuid references public.profiles(id) on delete set null,
  priority text not null default 'Medium' check (priority in ('High','Medium','Low')),
  due_date date,
  status text not null default 'Pending' check (status in ('Pending','In Progress','In Review','Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  due_date date,
  status text not null default 'Pending' check (status in ('Pending','In Progress','Completed')),
  progress integer not null default 0 check (progress between 0 and 100),
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title text not null,
  document_number text,
  revision text,
  status text not null default 'For Review',
  file_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  reviewer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Changes Requested')),
  comments text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.milestones enable row level security;
alter table public.documents enable row level security;
alter table public.approvals enable row level security;
alter table public.activities enable row level security;

drop policy if exists "authenticated profiles" on public.profiles;
create policy "authenticated profiles" on public.profiles for all to authenticated using (true) with check (true);
drop policy if exists "authenticated projects" on public.projects;
create policy "authenticated projects" on public.projects for all to authenticated using (true) with check (true);
drop policy if exists "authenticated tasks" on public.tasks;
create policy "authenticated tasks" on public.tasks for all to authenticated using (true) with check (true);
drop policy if exists "authenticated milestones" on public.milestones;
create policy "authenticated milestones" on public.milestones for all to authenticated using (true) with check (true);
drop policy if exists "authenticated documents" on public.documents;
create policy "authenticated documents" on public.documents for all to authenticated using (true) with check (true);
drop policy if exists "authenticated approvals" on public.approvals;
create policy "authenticated approvals" on public.approvals for all to authenticated using (true) with check (true);
drop policy if exists "authenticated activities" on public.activities;
create policy "authenticated activities" on public.activities for all to authenticated using (true) with check (true);

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id,name,role,email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), coalesce(new.raw_user_meta_data->>'role','Viewer'), new.email)
  on conflict (id) do update set email=excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Starter projects from the current EVE prototype.
insert into public.projects (id,name,client,type,status,priority,target_date,progress,description)
values
('EVE-2026-014','Electrical Substation Upgrade','Utility Infrastructure','Substation / HV','Active','High','2026-11-18',68,'Protection, control and electrical design package for an HV substation upgrade.'),
('EVE-2026-011','Industrial Distribution Upgrade','Industrial Client','Industrial','Active','Medium','2026-10-30',52,'LV/MV distribution design and documentation for an industrial facility.'),
('EVE-2026-009','Commercial Solar & HV Connection','Renewable Developer','Renewables','Planning','Medium','2026-12-08',24,'Electrical design and connection documentation for a commercial solar project.'),
('EVE-2026-006','Commercial Building Electrical Design','Property Group','Commercial','Active','Low','2026-10-22',81,'Electrical services design and coordinated construction documentation.')
on conflict (id) do nothing;
