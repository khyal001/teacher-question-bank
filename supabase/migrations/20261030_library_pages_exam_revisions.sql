-- Apply only after 20261029. Prepared locally; not executed against Supabase.
-- No data rewrite, policy replacement, Storage change or historical row update.
begin;
-- BEGIN LIBRARY PAGES AND EXAM REVISIONS V1
do $$
begin
  if to_regprocedure('public.get_questions_page(uuid,text,text,text,text,integer,integer,boolean)') is null
    or to_regprocedure('public.exams_capture_letterhead_layout()') is null then
    raise exception 'Apply migrations through 20261029 first.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('get_subjects_page','get_exams_page','get_letterheads_page','get_exam_source','save_exam_revision')) then
    raise exception 'Page/revision RPCs already exist. Review before retrying.';
  end if;
end;
$$;

-- No FK: provenance is immutable, but deleting an old exam must not delete or
-- modify its independent revisions. This value is never an authorization grant.
alter table public.exams add column source_exam_id uuid;
create index if not exists subjects_user_created_id_idx on public.subjects (user_id, created_at desc, id desc);
create index if not exists exams_user_created_id_idx on public.exams (user_id, created_at desc, id desc);
create index if not exists letterheads_user_created_id_idx on public.letterheads (user_id, created_at desc, id desc);

-- SECURITY INVOKER: caller ACLs and every underlying RLS policy still apply.
create or replace function public.get_subjects_page(
  p_offset integer default 0, p_limit integer default 25, p_include_metadata boolean default true
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول.' using errcode = '42501'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_limit is null or p_limit < 1 or p_limit > 100 or p_include_metadata is null then
    raise exception 'Invalid page bounds.' using errcode = '22023';
  end if;
  with page as materialized (
    select s.id, s.name, s.created_at from public.subjects s where s.user_id = v_user
    order by s.created_at desc, s.id desc limit p_limit offset p_offset
  ), links as (
      select sg.subject_id, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.id, 'name', g.name) order by g.name, g.id) groups
      from public.subject_groups sg join page p on p.id = sg.subject_id
      join public.teaching_groups g on g.id = sg.group_id and g.user_id = v_user
      where sg.user_id = v_user group by sg.subject_id
    ), counts as (
      select q.subject_id, count(*) n from public.questions q join page p on p.id = q.subject_id
      where q.user_id = v_user group by q.subject_id
    )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object('groups', coalesce(l.groups, '[]'::jsonb), 'question_count', coalesce(c.n, 0)) order by p.created_at desc, p.id desc) from page p left join links l on l.subject_id = p.id left join counts c on c.subject_id = p.id), '[]'::jsonb),
    'total', (select count(*) from public.subjects s where s.user_id = v_user),
    'metadata', case when p_include_metadata then pg_catalog.jsonb_build_object('role', public.get_my_role()) else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_subjects_page(integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.get_subjects_page(integer,integer,boolean) to authenticated;

-- SECURITY INVOKER: caller ACLs and every underlying RLS policy still apply.
create or replace function public.get_exams_page(
  p_offset integer default 0, p_limit integer default 25, p_include_metadata boolean default true
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول.' using errcode = '42501'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_limit is null or p_limit < 1 or p_limit > 100 or p_include_metadata is null then
    raise exception 'Invalid page bounds.' using errcode = '22023';
  end if;
  with page as materialized (
    select s.id, s.title, s.subject_name_snapshot, s.grade_level_snapshot, s.total_points, s.group_names_snapshot, s.created_at from public.exams s where s.user_id = v_user
    order by s.created_at desc, s.id desc limit p_limit offset p_offset
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb),
    'total', (select count(*) from public.exams s where s.user_id = v_user),
    'metadata', case when p_include_metadata then pg_catalog.jsonb_build_object('role', public.get_my_role()) else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_exams_page(integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.get_exams_page(integer,integer,boolean) to authenticated;

-- SECURITY INVOKER: caller ACLs and every underlying RLS policy still apply.
create or replace function public.get_letterheads_page(
  p_offset integer default 0, p_limit integer default 25, p_include_metadata boolean default true
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول.' using errcode = '42501'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_limit is null or p_limit < 1 or p_limit > 100 or p_include_metadata is null then
    raise exception 'Invalid page bounds.' using errcode = '22023';
  end if;
  with page as materialized (
    select s.id, s.name, s.entity_name, s.school_name, s.university_name, s.college_name, s.department_name, s.extra_text, s.logo_path, s.layout, s.created_at from public.letterheads s where s.user_id = v_user
    order by s.created_at desc, s.id desc limit p_limit offset p_offset
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb),
    'total', (select count(*) from public.letterheads s where s.user_id = v_user),
    'metadata', case when p_include_metadata then pg_catalog.jsonb_build_object('role', public.get_my_role()) else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_letterheads_page(integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.get_letterheads_page(integer,integer,boolean) to authenticated;

-- Only an explicit owned exam is expanded; lists never include these snapshots.
create or replace function public.get_exam_source(p_exam_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول.' using errcode = '42501'; end if;
  select pg_catalog.jsonb_build_object('exam', pg_catalog.to_jsonb(e),
    'questions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', q.id, 'question_id', q.question_id, 'position', q.position, 'snapshot', q.snapshot) order by q.position, q.id)
      from public.exam_questions q where q.exam_id = e.id and q.user_id = auth.uid()), '[]'::jsonb))
  into v_result from public.exams e where e.id = p_exam_id and e.user_id = auth.uid() and e.sealed;
  if v_result is null then raise exception 'الاختبار غير موجود أو غير مصرح.' using errcode = '42501'; end if;
  return v_result;
end;
$$;
revoke all on function public.get_exam_source(uuid) from public, anon, authenticated;
grant execute on function public.get_exam_source(uuid) to authenticated;

create or replace function public.exams_prepare_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_source public.exams%rowtype;
begin
  if new.integrity_version <> 2 or new.sealed then
    raise exception 'إنشاء الاختبارات متاح عبر دوال الحفظ المحكومة فقط.' using errcode = '42501';
  end if;
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if new.source_exam_id is not null then
    select * into v_source from public.exams e where e.id = new.source_exam_id
      and e.user_id = auth.uid() and e.user_id = new.user_id and e.sealed for share;
    if not found or new.subject_id is distinct from v_source.subject_id
      or new.subject_name_snapshot is distinct from v_source.subject_name_snapshot
      or new.grade_level_snapshot is distinct from v_source.grade_level_snapshot
      or new.group_ids_snapshot is distinct from v_source.group_ids_snapshot
      or new.group_names_snapshot is distinct from v_source.group_names_snapshot then
      raise exception 'سياق النسخة التاريخية غير صالح.' using errcode = '42501';
    end if;
  end if;

  if new.subject_id is null and new.source_exam_id is null then
    raise exception 'المادة مطلوبة لإنشاء الاختبار.' using errcode = '23514';
  end if;

  if new.source_exam_id is null and not exists (
    select 1
    from public.subjects s
    where s.id = new.subject_id
      and s.user_id = new.user_id
  ) then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = '42501';
  end if;

  if new.letterhead_id is not null and not exists (
    select 1
    from public.letterheads l
    where l.id = new.letterhead_id
      and l.user_id = new.user_id
  ) then
    raise exception 'قالب الكليشة غير موجود أو لا تملكه.' using errcode = '42501';
  end if;

  new.title := btrim(coalesce(new.title, ''));

  if new.title = '' then
    raise exception 'عنوان الاختبار مطلوب.' using errcode = '23514';
  end if;

  if length(new.title) > 200 then
    raise exception 'عنوان الاختبار طويل جداً.' using errcode = '23514';
  end if;

  new.subject_name_snapshot := btrim(coalesce(new.subject_name_snapshot, ''));

  if new.subject_name_snapshot = '' then
    raise exception 'اسم المادة في الاختبار مطلوب.' using errcode = '23514';
  end if;

  if new.total_points is null or new.total_points <= 0 then
    raise exception 'إجمالي درجات الاختبار يجب أن يكون أكبر من صفر.' using errcode = '23514';
  end if;

  if new.total_points <> round(new.total_points, 2) then
    raise exception 'إجمالي درجات الاختبار بمنزلتين عشريتين كحد أقصى.' using errcode = '23514';
  end if;

  if new.source_exam_id is null then
  new.group_names_snapshot := coalesce(
    (
      select array_agg(distinct btrim(g) order by btrim(g))
      from unnest(coalesce(new.group_names_snapshot, '{}'::text[])) as g
      where btrim(g) <> ''
    ),
    '{}'::text[]
  );

  end if;

  new.closing_phrase := nullif(btrim(coalesce(new.closing_phrase, '')), '');

  if new.closing_phrase is not null and length(new.closing_phrase) > 1000 then
    raise exception 'العبارة الختامية طويلة جداً.' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function public.exams_prepare_insert() from public, anon, authenticated;

create or replace function public.exams_protect_snapshots()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_exam_id is distinct from old.source_exam_id
     or new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at or new.title is distinct from old.title
     or new.duration_minutes is distinct from old.duration_minutes
     or new.integrity_version is distinct from old.integrity_version
     or new.group_ids_snapshot is distinct from old.group_ids_snapshot
     or (old.sealed and not new.sealed) then
    raise exception 'لا يمكن تغيير الاختبار التاريخي أو إعادة فتحه.' using errcode = '42501';
  end if;
  if new.subject_name_snapshot is distinct from old.subject_name_snapshot
     or new.grade_level_snapshot is distinct from old.grade_level_snapshot
     or new.total_points is distinct from old.total_points
     or new.group_names_snapshot is distinct from old.group_names_snapshot
     or new.letterhead_snapshot is distinct from old.letterhead_snapshot
     or new.closing_phrase is distinct from old.closing_phrase then
    raise exception 'لا يمكن تعديل بيانات الاختبار المحفوظة بعد إنشائه.' using errcode = '42501';
  end if;

  -- يسمح فقط بفقد الارتباط عند حذف المادة أو قالب الكليشة.
  if new.subject_id is distinct from old.subject_id and new.subject_id is not null then
    raise exception 'لا يمكن تغيير مادة الاختبار المحفوظ.' using errcode = '42501';
  end if;

  if new.letterhead_id is distinct from old.letterhead_id and new.letterhead_id is not null then
    raise exception 'لا يمكن تغيير كليشة الاختبار المحفوظ.' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function public.exams_protect_snapshots() from public, anon, authenticated;

-- This is a second controlled creation RPC, never an UPDATE API. Its source
-- rows are authorized by exam_questions.id, not caller-supplied snapshot text.
-- Source context is frozen; added/replaced bank questions must still cover ALL
-- source target IDs. All existing seal, positive-score and deferred-sum guards run.
create or replace function public.save_exam_revision(
  p_source_exam_id uuid, p_title text, p_total_points numeric,
  p_questions jsonb, p_keep_letterhead boolean default true,
  p_letterhead_id uuid default null, p_closing_phrase text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_source public.exams%rowtype;
  v_old public.exam_questions%rowtype;
  v_question public.questions%rowtype;
  v_letterhead public.letterheads%rowtype;
  v_exam_id uuid;
  v_item jsonb;
  v_snapshot jsonb;
  v_letterhead_snapshot jsonb;
  v_question_id uuid;
  v_points numeric;
  v_position integer := 0;
  v_sum numeric := 0;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول.' using errcode = '42501'; end if;
  select * into v_source from public.exams e where e.id = p_source_exam_id and e.user_id = v_user and e.sealed for share;
  if not found then raise exception 'الاختبار غير موجود أو لا تملكه.' using errcode = '42501'; end if;
  if p_total_points is null or p_total_points <= 0 or p_total_points <> round(p_total_points, 2)
    or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'درجات أو أسئلة الاختبار غير صالحة.' using errcode = '23514';
  end if;
  if jsonb_array_length(p_questions) < 1 or jsonb_array_length(p_questions) > 1000 then
    raise exception 'عدد الأسئلة يجب أن يكون بين 1 و1000.' using errcode = '23514';
  end if;
  if (select count(distinct coalesce(item ->> 'source_row_id', 'bank:' || (item ->> 'question_id')))
      from jsonb_array_elements(p_questions) item) <> jsonb_array_length(p_questions) then
    raise exception 'أسئلة مكررة أو معرفات ناقصة.' using errcode = '23514';
  end if;
  -- Preserve frozen logo and text without consulting a mutable/deleted template.
  if p_keep_letterhead is null then raise exception 'إعداد الكليشة مطلوب.' using errcode = '23514'; end if;
  if p_keep_letterhead then
    if p_letterhead_id is not null then raise exception 'اختر الكليشة التاريخية أو قالبًا جديدًا.' using errcode = '23514'; end if;
    v_letterhead_snapshot := v_source.letterhead_snapshot;
  elsif p_letterhead_id is not null then
    select * into v_letterhead from public.letterheads l where l.id = p_letterhead_id and l.user_id = v_user for share;
    if not found then raise exception 'قالب الكليشة غير موجود أو لا تملكه.' using errcode = '42501'; end if;
    if v_letterhead.logo_path is not null and (
      v_letterhead.logo_path not like (v_user::text || '/%') or not exists (
        select 1 from storage.objects o where o.bucket_id = 'letterhead-logos' and o.name = v_letterhead.logo_path)) then
      raise exception 'ملف الشعار غير متاح.' using errcode = '23514';
    end if;
    v_letterhead_snapshot := pg_catalog.to_jsonb(v_letterhead) - array['user_id','created_at'];
  end if;
  -- Lock surviving bank context before any new questions are validated. Holding
  -- the source row also serializes deletion of its referenced subject/template.
  perform 1 from public.subjects s where s.id = v_source.subject_id and s.user_id = v_user for share;
  perform 1 from public.subject_groups sg where sg.subject_id = v_source.subject_id
    and sg.group_id = any(v_source.group_ids_snapshot) and sg.user_id = v_user order by sg.group_id for share;
  perform 1 from public.teaching_groups g where g.id = any(v_source.group_ids_snapshot)
    and g.user_id = v_user order by g.id for share;
  insert into public.exams (user_id, subject_id, subject_name_snapshot, grade_level_snapshot,
    title, total_points, group_ids_snapshot, group_names_snapshot, letterhead_id,
    letterhead_snapshot, closing_phrase, source_exam_id, sealed, integrity_version)
  values (v_user, v_source.subject_id, v_source.subject_name_snapshot, v_source.grade_level_snapshot,
    p_title, p_total_points, v_source.group_ids_snapshot, v_source.group_names_snapshot,
    case when p_keep_letterhead then null else p_letterhead_id end,
    v_letterhead_snapshot, p_closing_phrase, v_source.id, false, 2) returning id into v_exam_id;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_item -> 'snapshot') is distinct from 'object'
      or (v_item -> 'snapshot' ->> 'points') is null
      or (v_item -> 'snapshot' ->> 'points') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'درجة جديدة غير صالحة؛ حدّد درجة موجبة بمنزلتين كحد أقصى.' using errcode = '23514';
    end if;
    v_points := (v_item -> 'snapshot' ->> 'points')::numeric;
    if v_points <= 0 then raise exception 'درجة السؤال يجب أن تكون موجبة.' using errcode = '23514'; end if;
    if nullif(v_item ->> 'source_row_id', '') is not null then
      select * into v_old from public.exam_questions q where q.id = (v_item ->> 'source_row_id')::uuid
        and q.exam_id = v_source.id and q.user_id = v_user for share;
      if not found then raise exception 'سؤال تاريخي لا يتبع الاختبار الأصلي.' using errcode = '42501'; end if;
      v_snapshot := v_old.snapshot;
      v_question_id := null;
      select q.id into v_question_id from public.questions q where q.id = v_old.question_id
        and q.user_id = v_user and q.subject_id = v_source.subject_id for share;
      -- Copy exact historical content/options, even when the bank question changed
      -- or disappeared. Only the new score/layout are editable by this branch.
    else
      select * into v_question from public.questions q where q.id = (v_item ->> 'question_id')::uuid
        and q.user_id = v_user and q.subject_id = v_source.subject_id for share;
      if not found then raise exception 'السؤال الجديد غير موجود أو لا يتبع المادة.' using errcode = '42501'; end if;
      perform 1 from public.question_groups qg where qg.question_id = v_question.id
        and qg.user_id = v_user order by qg.group_id for share;
      if coalesce(cardinality(v_source.group_ids_snapshot), 0) = 0
        or exists (select 1 from unnest(v_source.group_ids_snapshot) target(id) where not exists (
          select 1 from public.subject_groups sg where sg.subject_id = v_source.subject_id and sg.group_id = target.id and sg.user_id = v_user))
        or (v_question.group_scope = 'selected' and exists (
          select 1 from unnest(v_source.group_ids_snapshot) target(id) where not exists (
            select 1 from public.question_groups qg where qg.question_id = v_question.id and qg.group_id = target.id
              and qg.subject_id = v_source.subject_id and qg.user_id = v_user))) then
        raise exception 'السؤال الجديد لا ينطبق على جميع الصفوف والفصول والأقسام التاريخية.' using errcode = '23514';
      end if;
      if (v_item -> 'snapshot' ->> 'question_text') is distinct from v_question.question_text
        or (v_item -> 'snapshot' ->> 'type') is distinct from v_question.type
        or (v_item -> 'snapshot' ->> 'correct_answer') is distinct from v_question.correct_answer
        or (v_item -> 'snapshot' ->> 'difficulty') is distinct from v_question.difficulty
        or (v_item -> 'snapshot' ->> 'unit') is distinct from v_question.unit then
        raise exception 'تغير سؤال أثناء المعاينة؛ أعد اختياره.' using errcode = '23514';
      end if;
      if v_question.type = 'mcq' then
        if jsonb_typeof(v_item -> 'snapshot' -> 'options') is distinct from 'array' then
          raise exception 'خيارات السؤال غير صالحة.' using errcode = '23514';
        end if;
        if (select jsonb_agg(value order by value) from jsonb_array_elements(v_item -> 'snapshot' -> 'options'))
          is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements(v_question.options)) then
          raise exception 'خيارات السؤال تغيرت.' using errcode = '23514';
        end if;
      end if;
      v_snapshot := pg_catalog.jsonb_build_object('question_text', v_question.question_text, 'type', v_question.type,
        'correct_answer', v_question.correct_answer, 'difficulty', v_question.difficulty, 'unit', v_question.unit,
        'options', case when v_question.type = 'mcq' then v_item -> 'snapshot' -> 'options' else null end);
      v_question_id := v_question.id;
    end if;
    v_snapshot := v_snapshot || pg_catalog.jsonb_build_object('points', v_points,
      'layout', coalesce(v_item -> 'snapshot' ->> 'layout', 'auto'));
    v_position := v_position + 1;
    v_sum := v_sum + v_points;
    insert into public.exam_questions(user_id, exam_id, question_id, position, snapshot)
      values (v_user, v_exam_id, v_question_id, v_position, v_snapshot);
  end loop;
  if v_sum is distinct from p_total_points then
    raise exception 'مجموع الدرجات لا يساوي درجة الاختبار.' using errcode = '23514';
  end if;
  update public.exams set sealed = true where id = v_exam_id;
  return v_exam_id;
end;
$$;
revoke all on function public.save_exam_revision(uuid,text,numeric,jsonb,boolean,uuid,text) from public, anon, authenticated;
grant execute on function public.save_exam_revision(uuid,text,numeric,jsonb,boolean,uuid,text) to authenticated;
-- Table write ACLs, RLS, seal/integrity and append-closed triggers stay in force.
-- No caller may set source_exam_id by direct INSERT or UPDATE.
-- END LIBRARY PAGES AND EXAM REVISIONS V1

commit;
