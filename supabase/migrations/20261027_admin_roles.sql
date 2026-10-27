-- Apply AFTER 20261026_subjects_groups_sharing.sql, on a separate test project first.
-- Canonical bootstrap: roles are separate from identity data from the start.
-- Revised source; never replay an already-applied migration. No admin is assigned automatically.
begin;

-- BEGIN ADMIN ROLES V1
do $$
declare v_unknown text;
begin
  if to_regclass('public.teaching_groups') is null or to_regclass('public.letterheads') is null
     or to_regprocedure('public.save_exam(text,uuid,numeric,uuid[],uuid,text,jsonb)') is null then
    raise exception 'Apply the subjects/groups migration before admin roles.';
  end if;
  if to_regclass('teacher_bank_private.profiles') is not null
     and coalesce(obj_description(to_regclass('teacher_bank_private.profiles'), 'pg_class'), '')
       <> 'teacher-question-bank.profiles.v1' then
    raise exception 'Existing profiles table requires manual review; nothing is overwritten.';
  end if;
  -- Bootstrap only: never replay this file over an installed role system.
  if exists (select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('teacher_bank_private.profiles')
        and attname = 'role' and attnum > 0 and not attisdropped) then
    raise exception 'Legacy installation: apply the separate-user-roles upgrade instead of replaying bootstrap.';
  end if;
  if to_regclass('teacher_bank_private.user_roles') is not null
     or to_regprocedure('teacher_bank_private.has_role(text)') is not null then
    raise exception 'Role system already exists; do not replay bootstrap.';
  end if;
  if exists (select 1 from pg_catalog.pg_auth_members
      where member in ('anon'::regrole, 'authenticated'::regrole))
     or exists (select 1 from pg_catalog.pg_namespace where nspname = 'teacher_bank_private'
       and nspowner in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception 'Client role/schema privileges require manual review.';
  end if;
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'teacher_bank_private' and c.relowner in ('anon'::regrole, 'authenticated'::regrole))
    or exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','teacher_bank_private')
        and p.proname in ('get_my_role','get_admin_stats','get_admin_teachers','require_admin','create_user_profile')
        and p.proowner in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception 'Client roles must not own profile objects or admin functions.';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_unknown
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('get_my_role','get_admin_stats','get_admin_teachers')
    and not ((p.proname in ('get_my_role','get_admin_stats') and p.pronargs = 0)
      or (p.proname = 'get_admin_teachers' and pg_catalog.oidvectortypes(p.proargtypes) = 'text, text, integer, integer'));
  if v_unknown is not null then raise exception 'Unknown admin RPC overloads require review: %', v_unknown; end if;
  if exists (select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'auth.users'::regclass and t.tgname = 'tqb_create_profile_after_signup'
        and t.tgfoid is distinct from to_regprocedure('teacher_bank_private.create_user_profile()')) then
    raise exception 'Existing signup trigger requires review; it will not be replaced blindly.';
  end if;
  if exists (select 1 from pg_catalog.pg_policies
      where schemaname = 'teacher_bank_private' and tablename = 'profiles') then
    raise exception 'Profiles must have no client policies. Review existing policies before migration.';
  end if;
end;
$$;

create schema if not exists teacher_bank_private;
revoke all on schema teacher_bank_private from public, anon, authenticated;

-- Minimal extensible identity record. Billing/entitlements belong in a future
-- migration; role is never used as a subscription tier or copied from metadata.
create table if not exists teacher_bank_private.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'المعلم' check (length(display_name) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table teacher_bank_private.profiles is 'teacher-question-bank.profiles.v1';
alter table teacher_bank_private.profiles enable row level security;
revoke all on teacher_bank_private.profiles from public, anon, authenticated;
revoke all (id, display_name, created_at, updated_at)
  on teacher_bank_private.profiles from public, anon, authenticated;
create table teacher_bank_private.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('teacher', 'admin'))
);
comment on table teacher_bank_private.user_roles is 'teacher-question-bank.user_roles.v1';
alter table teacher_bank_private.user_roles enable row level security;
revoke all on teacher_bank_private.user_roles from public, anon, authenticated;
revoke all (user_id, role) on teacher_bank_private.user_roles from public, anon, authenticated;
create index user_roles_role_idx on teacher_bank_private.user_roles (role, user_id);

create or replace function teacher_bank_private.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from teacher_bank_private.user_roles r
    where r.user_id = auth.uid() and r.role = p_role
  );
$$;
revoke all on function teacher_bank_private.has_role(text) from public, anon, authenticated;

create or replace function teacher_bank_private.create_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into teacher_bank_private.profiles (id, display_name, created_at)
  values (new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'المعلم'), 160),
    coalesce(new.created_at, now()))
  on conflict (id) do nothing;
  insert into teacher_bank_private.user_roles (user_id, role)
  values (new.id, 'teacher') on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function teacher_bank_private.create_user_profile() from public, anon, authenticated;
drop trigger if exists tqb_create_profile_after_signup on auth.users;
create trigger tqb_create_profile_after_signup after insert on auth.users
for each row execute function teacher_bank_private.create_user_profile();

-- Backfill existing identities as teacher; preserve any previously assigned role.
insert into teacher_bank_private.profiles (id, display_name, created_at)
select u.id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), 'المعلم'), 160), coalesce(u.created_at, now())
from auth.users u on conflict (id) do nothing;
insert into teacher_bank_private.user_roles (user_id, role)
select u.id, 'teacher' from auth.users u on conflict (user_id) do nothing;

create or replace function teacher_bank_private.require_admin()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not teacher_bank_private.has_role('admin') then
    raise exception 'غير مصرح لك بالدخول إلى الإدارة.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function teacher_bank_private.require_admin() from public, anon, authenticated;

create or replace function public.get_my_role()
returns text language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;
  select r.role into v_role from teacher_bank_private.user_roles r where r.user_id = auth.uid();
  return coalesce(v_role, 'teacher');
end;
$$;

create or replace function public.get_admin_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform teacher_bank_private.require_admin();
  return jsonb_build_object(
    'teacher_count', (select count(*) from teacher_bank_private.user_roles where role = 'teacher'),
    'subject_count', (select count(*) from public.subjects),
    'group_count', (select count(*) from public.teaching_groups),
    'question_count', (select count(*) from public.questions),
    'exam_count', (select count(*) from public.exams),
    'letterhead_count', (select count(*) from public.letterheads)
  );
end;
$$;

create or replace function public.get_admin_teachers(
  p_search text default '', p_sort text default 'newest',
  p_offset integer default 0, p_limit integer default 25
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_search text := lower(btrim(coalesce(p_search, ''))); v_result jsonb;
begin
  perform teacher_bank_private.require_admin();
  if length(v_search) > 200 or p_sort is null or p_sort not in ('newest','questions','exams')
     or p_offset is null or p_offset < 0 or p_offset > 1000000
     or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'خيارات البحث أو الترتيب أو الصفحة غير صالحة.' using errcode = '22023';
  end if;
  with filtered as (
    select u.id, p.display_name, u.email, u.created_at,
      (u.email_confirmed_at is not null) as email_confirmed, u.last_sign_in_at
    from auth.users u join teacher_bank_private.profiles p on p.id = u.id
    join teacher_bank_private.user_roles r on r.user_id = p.id
    where r.role = 'teacher' and (v_search = ''
      or strpos(lower(p.display_name), v_search) > 0
      or strpos(lower(coalesce(u.email, '')), v_search) > 0)
  ), tallies as (
    select f.*,
      (select count(*) from public.subjects s where s.user_id = f.id) as subject_count,
      (select count(*) from public.teaching_groups g where g.user_id = f.id) as group_count,
      (select count(*) from public.questions q where q.user_id = f.id) as question_count,
      (select count(*) from public.exams e where e.user_id = f.id) as exam_count,
      (select count(*) from public.letterheads l where l.user_id = f.id) as letterhead_count
    from filtered f
  ), ranked as (
    select t.*, row_number() over (order by
      case when p_sort = 'questions' then t.question_count end desc nulls last,
      case when p_sort = 'exams' then t.exam_count end desc nulls last,
      t.created_at desc, t.id) as display_order
    from tallies t
  ), page as (
    select * from ranked order by display_order limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'teachers', coalesce((select jsonb_agg(to_jsonb(page) - 'display_order' order by display_order) from page), '[]'::jsonb),
    'total', (select count(*) from filtered), 'offset', p_offset, 'limit', p_limit
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_my_role() from public, anon, authenticated;
revoke all on function public.get_admin_stats() from public, anon, authenticated;
revoke all on function public.get_admin_teachers(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_role() to authenticated;
grant execute on function public.get_admin_stats() to authenticated;
grant execute on function public.get_admin_teachers(text, text, integer, integer) to authenticated;
-- END ADMIN ROLES V1

commit;
