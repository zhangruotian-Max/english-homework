create extension if not exists pgcrypto;

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('level1', 'level2', 'level3')),
  display_name text
    check (display_name is null or char_length(trim(display_name)) between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.class_viewers (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.login_usernames (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$'),
  username_normalized text generated always as (lower(username)) stored
);

alter table public.login_usernames
  drop constraint if exists login_usernames_username_check;
alter table public.login_usernames
  add constraint login_usernames_username_check
  check (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$');
alter table public.login_usernames
  add column if not exists username_normalized text
  generated always as (lower(username)) stored;

create unique index if not exists login_usernames_normalized_unique
  on public.login_usernames (username_normalized);

alter table public.admin_roles
  add column if not exists display_name text
  check (display_name is null or char_length(trim(display_name)) between 1 and 30);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 20),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists students_active_name_unique
  on public.students (lower(name))
  where archived_at is null;

create table if not exists public.homework_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  action text not null check (action in ('record', 'undo')),
  target_record_id uuid references public.homework_records (id),
  actor_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint homework_record_action_target check (
    (action = 'record' and target_record_id is null)
    or (action = 'undo' and target_record_id is not null)
  )
);

create unique index if not exists homework_records_undo_once
  on public.homework_records (target_record_id)
  where action = 'undo';

create or replace function public.can_view_class()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      exists (select 1 from public.admin_roles where user_id = auth.uid())
      or exists (select 1 from public.class_viewers where user_id = auth.uid())
    )
$$;

alter table public.admin_roles enable row level security;
alter table public.login_usernames enable row level security;
alter table public.students enable row level security;
alter table public.homework_records enable row level security;

drop policy if exists "Anyone can view active students" on public.students;
drop policy if exists "Approved users can view active students" on public.students;
create policy "Approved users can view active students"
  on public.students for select to authenticated
  using (archived_at is null and public.can_view_class());

drop policy if exists "Anyone can view homework records" on public.homework_records;
drop policy if exists "Approved users can view homework records" on public.homework_records;
create policy "Approved users can view homework records"
  on public.homework_records for select to authenticated
  using (
    public.can_view_class()
    and exists (select 1 from public.students s where s.id = homework_records.student_id)
  );

alter table public.class_viewers enable row level security;
revoke all on public.admin_roles from anon, authenticated;
revoke all on public.login_usernames from public, anon, authenticated;
revoke all on public.class_viewers from anon, authenticated;
revoke all on public.students from anon, authenticated;
revoke all on public.homework_records from anon, authenticated;
grant select on public.login_usernames to service_role;
grant select (id, name, created_at) on public.students to authenticated;
grant select (id, student_id, action, target_record_id, created_at)
  on public.homework_records to authenticated;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.admin_roles where user_id = auth.uid()
$$;

create or replace function public.get_my_display_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select nullif(trim(r.display_name), '')
      from public.admin_roles r
      where r.user_id = auth.uid()
    ),
    (
      select nullif(trim(u.raw_user_meta_data ->> 'display_name'), '')
      from auth.users u
      where u.id = auth.uid()
    )
  )
$$;

create or replace function public.update_my_display_name(p_display_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_name text;
begin
  if not public.can_view_class() then
    raise exception 'approved class viewer required';
  end if;

  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 30 then
    raise exception 'display name must contain 1 to 30 characters';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('display_name', trim(p_display_name))
  where id = auth.uid();
  if not found then
    raise exception 'authenticated user required';
  end if;

  update public.admin_roles
  set display_name = trim(p_display_name)
  where user_id = auth.uid()
  returning display_name into updated_name;
  return coalesce(updated_name, trim(p_display_name));
end;
$$;

create or replace function public.add_student(p_name text)
returns public.students
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_student public.students;
begin
  if coalesce(public.get_my_role(), '') not in ('level2', 'level3') then
    raise exception 'permission denied';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 20 then
    raise exception 'student name must contain 1 to 20 characters';
  end if;

  insert into public.students (name) values (trim(p_name))
  returning * into new_student;
  return new_student;
end;
$$;

create or replace function public.record_homework(p_student_id uuid)
returns public.homework_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_student public.students;
  current_count integer;
  new_record public.homework_records;
begin
  if coalesce(public.get_my_role(), '') not in ('level1', 'level2', 'level3') then
    raise exception 'permission denied';
  end if;

  select * into current_student
  from public.students
  where id = p_student_id and archived_at is null
  for update;
  if not found then
    raise exception 'student not found';
  end if;

  select count(*)::integer into current_count
  from public.homework_records r
  where r.student_id = p_student_id
    and r.action = 'record'
    and not exists (
      select 1 from public.homework_records u
      where u.action = 'undo' and u.target_record_id = r.id
    );
  if current_count >= 6 then
    raise exception 'student has reached the six-record limit';
  end if;

  insert into public.homework_records (student_id, action, actor_id)
  values (p_student_id, 'record', auth.uid())
  returning * into new_record;
  return new_record;
end;
$$;

create or replace function public.undo_homework_record(p_student_id uuid)
returns public.homework_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_record public.homework_records;
  latest_record_id uuid;
begin
  if coalesce(public.get_my_role(), '') not in ('level1', 'level2', 'level3') then
    raise exception 'permission denied';
  end if;

  perform 1 from public.students
  where id = p_student_id and archived_at is null
  for update;
  if not found then
    raise exception 'student not found';
  end if;

  select r.id into latest_record_id
  from public.homework_records r
  where r.student_id = p_student_id
    and r.action = 'record'
    and not exists (
      select 1 from public.homework_records u
      where u.action = 'undo' and u.target_record_id = r.id
    )
  order by r.created_at desc, r.id desc
  limit 1;
  if latest_record_id is null then
    raise exception 'no active record to undo';
  end if;

  insert into public.homework_records (student_id, action, target_record_id, actor_id)
  values (p_student_id, 'undo', latest_record_id, auth.uid())
  returning * into new_record;
  return new_record;
end;
$$;

create or replace function public.archive_student(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.get_my_role(), '') <> 'level3' then
    raise exception 'permission denied';
  end if;
  update public.students set archived_at = now()
  where id = p_student_id and archived_at is null;
  if not found then
    raise exception 'student not found';
  end if;
end;
$$;

create or replace function public.rename_student(p_student_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.get_my_role(), '') <> 'level3' then
    raise exception 'permission denied';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 20 then
    raise exception 'student name must contain 1 to 20 characters';
  end if;
  update public.students
  set name = trim(p_name)
  where id = p_student_id and archived_at is null;
  if not found then
    raise exception 'student not found';
  end if;
end;
$$;

create or replace function public.batch_add_students(p_names text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  student_name text;
  added_count integer := 0;
begin
  if coalesce(public.get_my_role(), '') not in ('level2', 'level3') then
    raise exception 'permission denied';
  end if;
  if p_names is null or coalesce(array_length(p_names, 1), 0) not between 1 and 100 then
    raise exception 'batch must contain 1 to 100 student names';
  end if;

  foreach student_name in array p_names loop
    if student_name is null or char_length(trim(student_name)) not between 1 and 20 then
      raise exception 'student name must contain 1 to 20 characters';
    end if;
    insert into public.students (name) values (trim(student_name));
    added_count := added_count + 1;
  end loop;
  return added_count;
end;
$$;

create or replace function public.batch_record_homework(p_student_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  student_id uuid;
  changed_count integer := 0;
begin
  if p_student_ids is null or coalesce(array_length(p_student_ids, 1), 0) not between 1 and 100
    or array_position(p_student_ids, null) is not null
    or cardinality(p_student_ids) <> (
      select count(distinct student_id) from unnest(p_student_ids) as ids(student_id)
    )
  then
    raise exception 'select 1 to 100 unique students';
  end if;
  foreach student_id in array p_student_ids loop
    perform public.record_homework(student_id);
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;

create or replace function public.batch_undo_homework_record(p_student_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  student_id uuid;
  changed_count integer := 0;
begin
  if p_student_ids is null or coalesce(array_length(p_student_ids, 1), 0) not between 1 and 100
    or array_position(p_student_ids, null) is not null
    or cardinality(p_student_ids) <> (
      select count(distinct student_id) from unnest(p_student_ids) as ids(student_id)
    )
  then
    raise exception 'select 1 to 100 unique students';
  end if;
  foreach student_id in array p_student_ids loop
    perform public.undo_homework_record(student_id);
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;

create or replace function public.batch_archive_students(p_student_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  student_id uuid;
  changed_count integer := 0;
begin
  if coalesce(public.get_my_role(), '') <> 'level3' then
    raise exception 'permission denied';
  end if;
  if p_student_ids is null or coalesce(array_length(p_student_ids, 1), 0) not between 1 and 100
    or array_position(p_student_ids, null) is not null
    or cardinality(p_student_ids) <> (
      select count(distinct student_id) from unnest(p_student_ids) as ids(student_id)
    )
  then
    raise exception 'select 1 to 100 unique students';
  end if;
  foreach student_id in array p_student_ids loop
    perform public.archive_student(student_id);
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;

revoke all on function public.get_my_role() from public;
revoke all on function public.can_view_class() from public;
revoke all on function public.get_my_display_name() from public;
revoke all on function public.update_my_display_name(text) from public;
revoke all on function public.add_student(text) from public;
revoke all on function public.record_homework(uuid) from public;
revoke all on function public.undo_homework_record(uuid) from public;
revoke all on function public.archive_student(uuid) from public;
revoke all on function public.rename_student(uuid, text) from public;
revoke all on function public.batch_add_students(text[]) from public;
revoke all on function public.batch_record_homework(uuid[]) from public;
revoke all on function public.batch_undo_homework_record(uuid[]) from public;
revoke all on function public.batch_archive_students(uuid[]) from public;

grant execute on function public.get_my_role() to authenticated;
grant execute on function public.can_view_class() to authenticated;
grant execute on function public.get_my_display_name() to authenticated;
grant execute on function public.update_my_display_name(text) to authenticated;
grant execute on function public.add_student(text) to authenticated;
grant execute on function public.record_homework(uuid) to authenticated;
grant execute on function public.undo_homework_record(uuid) to authenticated;
grant execute on function public.archive_student(uuid) to authenticated;
grant execute on function public.rename_student(uuid, text) to authenticated;
grant execute on function public.batch_add_students(text[]) to authenticated;
grant execute on function public.batch_record_homework(uuid[]) to authenticated;
grant execute on function public.batch_undo_homework_record(uuid[]) to authenticated;
grant execute on function public.batch_archive_students(uuid[]) to authenticated;
