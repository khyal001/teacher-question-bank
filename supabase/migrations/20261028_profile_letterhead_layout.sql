-- Local preparation only. Apply AFTER both 20261026 and 20261027 migrations.
-- One transaction; a second application deliberately fails rather than replacing
-- unknown objects. No existing snapshots, roles, policies or grants are widened.
begin;

-- BEGIN PROFILE LETTERHEAD V1
do $$
begin
  if to_regclass('teacher_bank_private.profiles') is null
     or to_regprocedure('public.save_exam(text,uuid,numeric,uuid[],uuid,text,jsonb)') is null then
    raise exception 'Apply the subjects/groups and admin migrations first.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'public' and p.proname in ('get_question_units','exams_capture_letterhead_layout'))
         or (n.nspname = 'teacher_bank_private' and p.proname = 'sync_user_display_name')) then
    raise exception 'Profile/layout objects already exist; review before retrying.';
  end if;
end;
$$;

alter table public.letterheads add column layout jsonb;
alter table public.letterheads add constraint letterheads_layout_valid check (
  layout is null or (
    jsonb_typeof(layout) = 'object'
    and layout - array['logo','entity','education'] = '{}'::jsonb
    and layout ->> 'logo' in ('right','center','left')
    and layout ->> 'entity' in ('right','center','left')
    and layout ->> 'education' in ('right','center','left')
  ) is true
);
alter table public.letterheads add constraint letterheads_layout_no_overlap check (
  layout is null or (
    (logo_path is null or btrim(coalesce(entity_name, '')) = '' or layout ->> 'logo' <> layout ->> 'entity')
    and (logo_path is null or btrim(concat_ws('', school_name, university_name, college_name, department_name, extra_text)) = ''
      or layout ->> 'logo' <> layout ->> 'education')
    and (btrim(coalesce(entity_name, '')) = ''
      or btrim(concat_ws('', school_name, university_name, college_name, department_name, extra_text)) = ''
      or layout ->> 'entity' <> layout ->> 'education')
  ) is true
);

-- Invoked inside save_exam's existing transaction and row lock. No new creation
-- path, no updates of sealed exams, no dependency on a mutable template at read time.
create or replace function public.exams_capture_letterhead_layout()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_layout jsonb;
begin
  if new.letterhead_id is not null then
    if new.user_id is distinct from auth.uid() or new.sealed or new.integrity_version <> 2 then
      raise exception 'إنشاء الاختبارات متاح عبر save_exam فقط.' using errcode = '42501';
    end if;
    select l.layout into v_layout from public.letterheads l
      where l.id = new.letterhead_id and l.user_id = auth.uid() for share;
    if not found or new.letterhead_snapshot is null then
      raise exception 'قالب الكليشة غير متاح.' using errcode = '23514';
    end if;
    new.letterhead_snapshot := new.letterhead_snapshot || pg_catalog.jsonb_build_object('layout', v_layout);
  end if;
  return new;
end;
$$;
revoke all on function public.exams_capture_letterhead_layout() from public, anon, authenticated;
create trigger exams_capture_letterhead_layout before insert on public.exams
for each row execute function public.exams_capture_letterhead_layout();

-- Auth API updateUser can change identity metadata only. Sync only the name;
-- never copy role or any entitlement from user-editable metadata.
create or replace function teacher_bank_private.sync_user_display_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update teacher_bank_private.profiles
  set display_name = left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'المعلم'), 160),
      updated_at = pg_catalog.now()
  where id = new.id;
  return new;
end;
$$;
revoke all on function teacher_bank_private.sync_user_display_name() from public, anon, authenticated;
create trigger tqb_sync_display_name after update of raw_user_meta_data on auth.users
for each row when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
execute function teacher_bank_private.sync_user_display_name();

-- A small distinct-value list, not all question records. Invoker/RLS apply.
create or replace function public.get_question_units()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(u.unit order by u.unit), '[]'::jsonb)
  from (select distinct q.unit from public.questions q
    where q.user_id = auth.uid() and q.unit is not null and pg_catalog.btrim(q.unit) <> '') u;
$$;
revoke all on function public.get_question_units() from public, anon, authenticated;
grant execute on function public.get_question_units() to authenticated;
-- END PROFILE LETTERHEAD V1

commit;
