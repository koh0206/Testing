-- ============================================================
-- My To-do List portal — Supabase schema
-- Run this once in the Supabase SQL Editor for a fresh project.
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Tables ----------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  role          text not null default 'member' check (role in ('manager','member')),
  created_at    timestamptz not null default now()
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  status       text not null default 'To Do',
  priority     text not null default 'Medium',
  duration     text not null default 'Mid',
  date         date,
  scope        text not null default 'team' check (scope in ('mine','team')),
  owner_id     uuid references public.profiles(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create table if not exists public.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  type        text not null,
  from_value  text,
  to_value    text,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tasks_scope    on public.tasks(scope);
create index if not exists idx_tasks_owner    on public.tasks(owner_id);
create index if not exists idx_tasks_status   on public.tasks(status);
create index if not exists idx_events_task    on public.task_events(task_id, created_at);
create index if not exists idx_comments_task  on public.task_comments(task_id, created_at);

-- ---------- Triggers / helpers ----------

-- Auto-create profile on signup. First user becomes manager.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_count int;
begin
  select count(*) into user_count from public.profiles;
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when user_count = 0 then 'manager' else 'member' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_manager(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = uid and role = 'manager');
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------- Row-level security ----------

alter table public.profiles      enable row level security;
alter table public.tasks         enable row level security;
alter table public.task_events   enable row level security;
alter table public.task_comments enable row level security;

-- Profiles: any authed user can read; users update only their own row
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Tasks: team tasks visible to everyone authed; personal tasks visible to owner/creator/manager
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select using (
    auth.role() = 'authenticated' and (
      scope = 'team'
      or owner_id = auth.uid()
      or created_by = auth.uid()
      or public.is_manager(auth.uid())
    )
  );

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update using (
    owner_id = auth.uid() or created_by = auth.uid() or public.is_manager(auth.uid())
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete using (created_by = auth.uid() or public.is_manager(auth.uid()));

-- Events: same visibility as parent task; only insert your own
drop policy if exists "events_select" on public.task_events;
create policy "events_select" on public.task_events
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and (
        t.scope = 'team' or t.owner_id = auth.uid() or t.created_by = auth.uid() or public.is_manager(auth.uid())
      )
    )
  );

drop policy if exists "events_insert" on public.task_events;
create policy "events_insert" on public.task_events
  for insert with check (
    auth.uid() = author_id and exists (select 1 from public.tasks t where t.id = task_id)
  );

-- Comments: same visibility; insert your own; delete your own or any if manager
drop policy if exists "comments_select" on public.task_comments;
create policy "comments_select" on public.task_comments
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and (
        t.scope = 'team' or t.owner_id = auth.uid() or t.created_by = auth.uid() or public.is_manager(auth.uid())
      )
    )
  );

drop policy if exists "comments_insert" on public.task_comments;
create policy "comments_insert" on public.task_comments
  for insert with check (
    auth.uid() = author_id and exists (
      select 1 from public.tasks t
      where t.id = task_id and (
        t.scope = 'team' or t.owner_id = auth.uid() or t.created_by = auth.uid() or public.is_manager(auth.uid())
      )
    )
  );

drop policy if exists "comments_delete" on public.task_comments;
create policy "comments_delete" on public.task_comments
  for delete using (author_id = auth.uid() or public.is_manager(auth.uid()));

-- ---------- Realtime ----------
-- Enable realtime publication for these tables (in Supabase dashboard:
-- Database → Replication → enable for public.tasks, task_events, task_comments).
-- Or via SQL:
-- alter publication supabase_realtime add table public.tasks, public.task_events, public.task_comments;
