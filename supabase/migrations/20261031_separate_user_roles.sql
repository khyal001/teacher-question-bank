begin;

-- BEGIN SEPARATE USER ROLES V1
-- Apply after 20261030. A single transaction preserves all existing roles.
-- Lock profiles while copying roles so no assignment can be lost mid-migration.
do $$
begin
  if to_regprocedure('teacher_bank_private.has_role(text)') is not null then
    raise exception 'Existing has_role function requires manual review; nothing is overwritten.';
  end if;
end;
$$;
lock table teacher_bank_private.profiles in access exclusive mode;
create table teacher_bank_private.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('teacher', 'admin'))
);
alter table teacher_bank_private.user_roles enable row level security;
revoke all on teacher_bank_private.user_roles from public, anon, authenticated;
revoke all (user_id, role) on teacher_bank_private.user_roles from public, anon, authenticated;
create index user_roles_role_idx on teacher_bank_private.user_roles (role, user_id);
insert into teacher_bank_private.user_roles (user_id, role)
select id, role from teacher_bank_private.profiles;

-- Self-only check: no arbitrary user ID and no user-editable metadata.
-- Private helper: only trusted database functions may execute it.
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

create or replace function teacher_bank_private.require_admin()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not teacher_bank_private.has_role('admin') then
    raise exception 'غير مصرح لك بالدخول إلى الإدارة.' using errcode = '42501';
  end if;
end;
$$;

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

-- CREATE OR REPLACE preserves existing ACLs; explicitly restate the boundary.
revoke all on function teacher_bank_private.create_user_profile() from public, anon, authenticated;
revoke all on function teacher_bank_private.require_admin() from public, anon, authenticated;
revoke all on function public.get_my_role() from public, anon, authenticated;
revoke all on function public.get_admin_stats() from public, anon, authenticated;
revoke all on function public.get_admin_teachers(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_my_role() to authenticated;
grant execute on function public.get_admin_stats() to authenticated;
grant execute on function public.get_admin_teachers(text,text,integer,integer) to authenticated;
-- No CASCADE: unknown dependent objects abort the transaction for review.
alter table teacher_bank_private.profiles drop column role;
-- END SEPARATE USER ROLES V1

commit;
