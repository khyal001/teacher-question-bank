-- ============================================================
-- بنك أسئلة المعلم — مخطط قاعدة البيانات الكامل (نسخة 2026-10-26)
-- شغّل هذا الملف كاملاً من SQL Editor داخل مشروع Supabase جديد.
--
-- للمشاريع القائمة التي تحتوي بيانات: لا تشغّل هذا الملف.
-- شغّل بدلاً منه:
--   supabase/migrations/20261026_subjects_groups_sharing.sql
--   supabase/migrations/20261027_admin_roles.sql (then assign the first admin manually)
--   supabase/migrations/20261028_profile_letterhead_layout.sql
--   supabase/migrations/20261029_questions_page.sql
--
-- المبادئ:
--   * كل صف مرتبط بالمعلم الحالي عبر user_id + RLS.
--   * المادة كيان واحد، والصفوف والفصول والأقسام كيان مستقل مرتبط بها Many-to-Many.
--   * السؤال يتبع مادة واحدة، ونطاقه: جميع صفوف وفصول وأقسام المادة أو صفوف وفصول وأقسام محددة.
--   * درجة السؤال لم تعد جزءاً من بنك الأسئلة؛ تُحفظ داخل snapshot الاختبار.
--   * الأعمدة القديمة grade_level وpoints وduration_minutes باقية للتوافق
--     مع البيانات التاريخية، لكنها غير مستخدمة في منطق المرحلة الجديدة.
-- ============================================================

begin;

-- Read supabase/preflight_subjects_groups_sharing.sql before applying this file.
-- Unknown policies/overloads are never dropped automatically.
do $$
declare v_unknown text;
begin
  select string_agg(schemaname || '.' || tablename || ':' || policyname, ', ')
  into v_unknown from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = any(array[
    'subjects','questions','exams','exam_questions','teaching_groups','subject_groups',
    'question_groups','letterheads','question_share_packages'])
    and not (policyname = any(array[
      tablename || '_select_own', tablename || '_insert_own',
      tablename || '_update_own', tablename || '_delete_own']));
  if v_unknown is not null then
    raise exception 'Unknown policies require manual review before migration: %', v_unknown;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_unknown
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'save_subject','save_question','save_exam','create_question_share',
    'get_question_share_preview','accept_question_share','revoke_question_share',
    'get_my_role','get_admin_stats','get_admin_teachers')
  and not ((p.proname = 'save_subject' and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, text, uuid[]')
    or (p.proname = 'save_question' and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, uuid, text, text, text, jsonb, text, text, text, uuid[]')
    or (p.proname = 'save_exam' and pg_catalog.oidvectortypes(p.proargtypes) in ('text, uuid, numeric, text[], uuid, text, jsonb','text, uuid, numeric, uuid[], uuid, text, jsonb'))
    or (p.proname = 'create_question_share' and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, integer')
    or (p.proname = 'get_question_share_preview' and pg_catalog.oidvectortypes(p.proargtypes) = 'text')
    or (p.proname = 'accept_question_share' and pg_catalog.oidvectortypes(p.proargtypes) = 'text, text, jsonb')
    or (p.proname = 'revoke_question_share' and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid')
    or (p.proname in ('get_my_role','get_admin_stats') and p.pronargs = 0)
    or (p.proname = 'get_admin_teachers' and pg_catalog.oidvectortypes(p.proargtypes) = 'text, text, integer, integer'));
  if v_unknown is not null then raise exception 'Unknown RPC overloads require manual review: %', v_unknown; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_unknown
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname not in ('save_subject','save_question','save_exam','create_question_share',
      'get_question_share_preview','accept_question_share','revoke_question_share',
      'get_my_role','get_admin_stats','get_admin_teachers')
    and not (p.proname in ('revoke_subject_shares_on_delete','exam_questions_guard_delete','check_exam_integrity')
      and p.pronargs = 0 and p.prorettype = 'trigger'::regtype)
    -- Exact platform-function exception; never allow a name-only match.
    -- IS TRUE makes missing/NULL settings fail closed under SQL three-valued logic.
    and not (
      -- BEGIN RLS_AUTO_ENABLE_EXCEPTION
      (n.nspname = 'public' and p.proname = 'rls_auto_enable'
        and p.prokind = 'f' and p.pronargs = 0
        and p.proallargtypes is null and p.provariadic = 0
        and not p.proretset and p.prosecdef
        and p.prorettype = 'pg_catalog.event_trigger'::pg_catalog.regtype
        and p.proowner = 'postgres'::pg_catalog.regrole
        and p.proconfig = array['search_path=pg_catalog']::pg_catalog.text[]) is true
      -- END RLS_AUTO_ENABLE_EXCEPTION
    )
    and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  if v_unknown is not null then
    raise exception 'Unknown SECURITY DEFINER functions require manual review: %', v_unknown;
  end if;
  if exists (select 1 from pg_catalog.pg_auth_members
             where member in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception 'Client role memberships require manual privilege review.';
  end if;
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
             where n.nspname in ('public','storage') and c.relkind in ('r','p')
             and c.relowner in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception 'Client roles must not own application or Storage tables.';
  end if;
  if exists (select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pgcrypto' and n.nspname <> 'extensions') then
    raise exception 'pgcrypto must be reviewed: it is installed outside extensions.';
  end if;
  if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity) then
    raise exception 'Supabase storage.objects must already have RLS enabled.';
  end if;
end;
$$;
revoke create on schema public from public, anon, authenticated;
create schema if not exists extensions;
revoke create on schema extensions from public, anon, authenticated;


create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1) المواد
--    grade_level عمود قديم اختياري فقط. لا يُشترط ولا يُفعّل.
-- ------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  grade_level text,
  created_at timestamptz not null default now(),
  constraint subjects_name_not_blank check (length(btrim(name)) > 0),
  constraint subjects_grade_level_not_blank
    check (grade_level is null or length(btrim(grade_level)) > 0)
);

create index if not exists subjects_user_id_idx on public.subjects (user_id);

-- ------------------------------------------------------------
-- 2) الصفوف والفصول والأقسام المستقلة
-- ------------------------------------------------------------
create table if not exists public.teaching_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint teaching_groups_name_not_blank check (length(btrim(name)) > 0),
  constraint teaching_groups_user_name_unique unique (user_id, name)
);

create index if not exists teaching_groups_user_id_idx on public.teaching_groups (user_id);

-- ------------------------------------------------------------
-- 3) ربط المواد بالصفوف والفصول والأقسام (Many-to-Many)
-- ------------------------------------------------------------
create table if not exists public.subject_groups (
  subject_id uuid not null references public.subjects (id) on delete cascade,
  group_id uuid not null references public.teaching_groups (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subject_id, group_id)
);

create index if not exists subject_groups_group_id_idx on public.subject_groups (group_id);
create index if not exists subject_groups_user_id_idx on public.subject_groups (user_id);

-- ------------------------------------------------------------
-- 4) الأسئلة
--    points عمود قديم فقط، ويُسمح بأن يكون NULL.
--    group_scope: all = جميع صفوف وفصول وأقسام المادة، selected = صفوف وفصول وأقسام محددة.
-- ------------------------------------------------------------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  unit text,
  type text not null,
  question_text text not null,
  options jsonb,
  correct_answer text not null,
  difficulty text not null,
  points numeric,
  group_scope text not null default 'all',
  created_at timestamptz not null default now(),
  constraint questions_type_check check (type in ('mcq', 'true_false', 'short')),
  constraint questions_difficulty_check check (difficulty in ('easy', 'medium', 'hard')),
  constraint questions_group_scope_check check (group_scope in ('all', 'selected')),
  constraint questions_points_positive check (points is null or points > 0),
  constraint questions_text_not_blank check (length(btrim(question_text)) > 0)
);

create index if not exists questions_user_id_idx on public.questions (user_id);
create index if not exists questions_subject_id_idx on public.questions (subject_id);
create index if not exists questions_created_at_idx on public.questions (created_at desc);

-- ------------------------------------------------------------
-- 5) ربط السؤال بصفوف وفصول وأقسام محددة
--    لا تُستخدم الصفوف هنا عندما يكون group_scope = all.
-- ------------------------------------------------------------
create table if not exists public.question_groups (
  question_id uuid not null references public.questions (id) on delete cascade,
  subject_id uuid not null,
  group_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_id, group_id),
  constraint question_groups_subject_group_fk
    foreign key (subject_id, group_id)
    references public.subject_groups (subject_id, group_id)
    on delete cascade
);

create index if not exists question_groups_group_id_idx on public.question_groups (group_id);
create index if not exists question_groups_subject_group_idx
  on public.question_groups (subject_id, group_id);
create index if not exists question_groups_user_id_idx on public.question_groups (user_id);

-- ------------------------------------------------------------
-- 6) قوالب الكليشة
--    logo_path يشير إلى مسار داخل bucket خاص: letterhead-logos
-- ------------------------------------------------------------
create table if not exists public.letterheads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  entity_name text,
  school_name text,
  university_name text,
  college_name text,
  department_name text,
  extra_text text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letterheads_name_not_blank check (length(btrim(name)) > 0),
  constraint letterheads_logo_path_owned
    check (logo_path is null or logo_path like (user_id::text || '/%'))
);

create index if not exists letterheads_user_id_idx on public.letterheads (user_id);

-- ------------------------------------------------------------
-- 7) الاختبارات المحفوظة
--    snapshot كامل وقت الحفظ. الأعمدة القديمة باقية للتاريخ فقط.
-- ------------------------------------------------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  subject_name_snapshot text not null,
  grade_level_snapshot text,
  title text not null,
  duration_minutes integer,
  sealed boolean not null default true,
  integrity_version integer not null default 1,
  group_ids_snapshot uuid[] not null default '{}'::uuid[],
  total_points numeric not null default 0,
  group_names_snapshot text[] not null default '{}'::text[],
  letterhead_id uuid references public.letterheads (id) on delete set null,
  letterhead_snapshot jsonb,
  closing_phrase text,
  created_at timestamptz not null default now(),
  constraint exams_title_not_blank check (length(btrim(title)) > 0),
  constraint exams_total_points_nonnegative
    check (total_points >= 0 and total_points::text not in ('NaN', 'Infinity', '-Infinity')
    and (integrity_version < 2 or total_points = round(total_points, 2))),
  constraint exams_duration_positive
    check (duration_minutes is null or duration_minutes > 0)
);

create index if not exists exams_user_id_idx on public.exams (user_id);
create index if not exists exams_subject_id_idx on public.exams (subject_id);
create index if not exists exams_created_at_idx on public.exams (created_at desc);

-- ------------------------------------------------------------
-- 8) أسئلة الاختبار المحفوظ
--    snapshot يحتوي: type, question_text, options, correct_answer,
--    difficulty, points, layout, unit.
-- ------------------------------------------------------------
create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  position integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint exam_questions_position_positive check (position > 0),
  constraint exam_questions_exam_position_unique unique (exam_id, position),
  constraint exam_questions_exam_question_unique unique (exam_id, question_id)
);

create index if not exists exam_questions_user_id_idx on public.exam_questions (user_id);
create index if not exists exam_questions_question_id_idx on public.exam_questions (question_id);

-- ------------------------------------------------------------
-- 9) حزم المشاركة الآمنة
--    token_hash فقط. لا يُخزّن المفتاح الخام أبداً.
--    package لا يحتوي user_id ولا بريد المرسل ولا معرّفات الصفوف والفصول والأقسام الأصلية.
-- ------------------------------------------------------------
create table if not exists public.question_share_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  subject_name_snapshot text not null,
  question_count integer not null default 0,
  package jsonb not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  constraint question_share_question_count_nonnegative check (question_count >= 0),
  constraint question_share_token_hash_length check (length(token_hash) = 64),
  constraint question_share_expiry_after_creation check (expires_at > created_at)
);

create index if not exists question_share_packages_user_id_idx
  on public.question_share_packages (user_id);
create index if not exists question_share_packages_subject_id_idx
  on public.question_share_packages (subject_id);
create index if not exists question_share_packages_expires_at_idx
  on public.question_share_packages (expires_at desc);

-- ============================================================
-- دوال التحقق وال触发器
-- ============================================================

-- تحديث updated_at لقوالب الكليشة.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists letterheads_set_updated_at on public.letterheads;
create trigger letterheads_set_updated_at
  before update on public.letterheads
  for each row execute function public.set_updated_at();

-- حذف المادة يلغي روابط مشاركتها النشطة قبل أن يصبح subject_id = null.
create or replace function public.revoke_subject_shares_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.question_share_packages
  set revoked_at = now()
  where subject_id = old.id
    and used_at is null
    and revoked_at is null;

  return old;
end;
$$;

drop trigger if exists subjects_revoke_shares_on_delete on public.subjects;
create trigger subjects_revoke_shares_on_delete
  before delete on public.subjects
  for each row execute function public.revoke_subject_shares_on_delete();

-- تنظيف اسم الصف / الفصل / القسم قبل القيد الفريد.
create or replace function public.teaching_groups_validate_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(coalesce(new.name, ''));

  if new.name = '' then
    raise exception 'اسم الصف / الفصل / القسم مطلوب.' using errcode = '23514';
  end if;

  if length(new.name) > 120 then
    raise exception 'اسم الصف / الفصل / القسم طويل جداً.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists teaching_groups_validate_before_write on public.teaching_groups;
create trigger teaching_groups_validate_before_write
  before insert or update on public.teaching_groups
  for each row execute function public.teaching_groups_validate_row();

-- التحقق من ملكية طرفي ربط المادة بالصف / الفصل / القسم.
create or replace function public.subject_groups_validate_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_subject_user uuid;
  v_group_user uuid;
begin
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  select s.user_id into v_subject_user
  from public.subjects s
  where s.id = new.subject_id;

  select g.user_id into v_group_user
  from public.teaching_groups g
  where g.id = new.group_id;

  if v_subject_user is null or v_group_user is null then
    raise exception 'المادة أو الصف / الفصل / القسم غير موجود.' using errcode = '23503';
  end if;

  if v_subject_user <> new.user_id or v_group_user <> new.user_id then
    raise exception 'لا يمكن ربط مادة أو صف / فصل / قسم لا تملكها.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists subject_groups_validate_before_write on public.subject_groups;
create trigger subject_groups_validate_before_write
  before insert or update on public.subject_groups
  for each row execute function public.subject_groups_validate_row();

-- التحقق من صحة السؤال، مع السماح بـ points القديمة أو NULL.
create or replace function public.questions_validate_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  new.question_text := btrim(coalesce(new.question_text, ''));

  if new.question_text = '' then
    raise exception 'نص السؤال مطلوب.' using errcode = '23514';
  end if;

  if new.type is null or new.type not in ('mcq', 'true_false', 'short') then
    raise exception 'نوع السؤال غير صحيح.' using errcode = '23514';
  end if;

  if new.difficulty is null or new.difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صحيح.' using errcode = '23514';
  end if;

  new.group_scope := coalesce(nullif(btrim(new.group_scope), ''), 'all');

  if new.group_scope not in ('all', 'selected') then
    raise exception 'نطاق صفوف وفصول وأقسام السؤال غير صحيح.' using errcode = '23514';
  end if;

  if new.points is not null and new.points <= 0 then
    raise exception 'درجة السؤال القديمة يجب أن تكون أكبر من صفر أو NULL.' using errcode = '23514';
  end if;

  -- عند نقل السؤال إلى مادة أخرى أو تحويله إلى «جميع الصفوف والفصول والأقسام»
  -- نحذف ارتباطاته القديمة، حتى لا تبقى بيانات يتيمة.
  if tg_op = 'UPDATE'
     and (new.subject_id is distinct from old.subject_id or new.group_scope = 'all') then
    delete from public.question_groups qg where qg.question_id = new.id;
  end if;

  if new.type = 'mcq' then
    if new.options is null or jsonb_typeof(new.options) <> 'array' then
      raise exception 'خيارات سؤال الاختيار من متعدد مطلوبة.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(new.options) as item(value)
      where jsonb_typeof(value) <> 'string'
    ) then
      raise exception 'جميع الخيارات يجب أن تكون نصوصاً.' using errcode = '23514';
    end if;

    select count(*), count(distinct btrim(value))
      into v_count, v_distinct
    from jsonb_array_elements_text(new.options);

    if v_count < 2 or v_count > 6 then
      raise exception 'عدد الخيارات يجب أن يكون بين 2 و6.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(new.options) as item(value)
      where btrim(value) = ''
    ) then
      raise exception 'لا يسمح بخيار فارغ.' using errcode = '23514';
    end if;

    if v_distinct <> v_count then
      raise exception 'لا يسمح بتكرار الخيارات.' using errcode = '23514';
    end if;

    select jsonb_agg(btrim(value) order by ord)
      into new.options
    from jsonb_array_elements_text(new.options) with ordinality as item(value, ord);

    new.correct_answer := btrim(coalesce(new.correct_answer, ''));

    if new.correct_answer = '' then
      raise exception 'حدد الإجابة الصحيحة.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements_text(new.options) as item(value)
      where value = new.correct_answer
    ) then
      raise exception 'الإجابة الصحيحة يجب أن تكون أحد الخيارات.' using errcode = '23514';
    end if;
  elsif new.type = 'true_false' then
    new.options := null;
    new.correct_answer := lower(btrim(coalesce(new.correct_answer, '')));

    if new.correct_answer not in ('true', 'false') then
      raise exception 'إجابة صح/خطأ يجب أن تكون true أو false.' using errcode = '23514';
    end if;
  else
    new.options := null;
    new.correct_answer := btrim(coalesce(new.correct_answer, ''));

    if new.correct_answer = '' then
      raise exception 'الإجابة النموذجية مطلوبة.' using errcode = '23514';
    end if;
  end if;

  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  return new;
end;
$$;

drop trigger if exists questions_validate_before_write on public.questions;
create trigger questions_validate_before_write
  before insert or update on public.questions
  for each row execute function public.questions_validate_row();

-- التحقق من أن صف / فصل / قسم السؤال تابعة للمادة نفسها وأن النطاق selected.
create or replace function public.question_groups_validate_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_question record;
begin
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  select q.subject_id, q.user_id, q.group_scope
    into v_question
  from public.questions q
  where q.id = new.question_id;

  if not found then
    raise exception 'السؤال غير موجود.' using errcode = '23503';
  end if;

  if v_question.user_id <> new.user_id then
    raise exception 'لا يمكن ربط صف / فصل / قسم بسؤال لا تملكه.' using errcode = '42501';
  end if;

  if v_question.subject_id <> new.subject_id then
    raise exception 'الصف / الفصل / القسم المختار لا يتبع مادة السؤال.' using errcode = '23514';
  end if;

  if v_question.group_scope <> 'selected' then
    raise exception 'لا يمكن ربط صفوف وفصول وأقسام بسؤال نطاقه «جميع الصفوف والفصول والأقسام».' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.subject_groups sg
    where sg.subject_id = new.subject_id
      and sg.group_id = new.group_id
      and sg.user_id = new.user_id
  ) then
    raise exception 'الصف / الفصل / القسم غير مرتبط بهذه المادة.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists question_groups_validate_before_write on public.question_groups;
create trigger question_groups_validate_before_write
  before insert or update on public.question_groups
  for each row execute function public.question_groups_validate_row();

-- تحضير الاختبار الجديد: يحفظ snapshots، ويمنع الاختبار بلا مادة/درجات.
-- لا يفرض أي صف دراسي.
create or replace function public.exams_prepare_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.integrity_version <> 2 or new.sealed then
    raise exception 'إنشاء الاختبارات متاح عبر save_exam فقط.' using errcode = '42501';
  end if;
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if new.subject_id is null then
    raise exception 'المادة مطلوبة لإنشاء الاختبار.' using errcode = '23514';
  end if;

  if not exists (
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

  new.group_names_snapshot := coalesce(
    (
      select array_agg(distinct btrim(g) order by btrim(g))
      from unnest(coalesce(new.group_names_snapshot, '{}'::text[])) as g
      where btrim(g) <> ''
    ),
    '{}'::text[]
  );

  new.closing_phrase := nullif(btrim(coalesce(new.closing_phrase, '')), '');

  if new.closing_phrase is not null and length(new.closing_phrase) > 1000 then
    raise exception 'العبارة الختامية طويلة جداً.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists exams_prepare_insert on public.exams;
create trigger exams_prepare_insert
  before insert on public.exams
  for each row execute function public.exams_prepare_insert();

-- حماية snapshot الاختبار بعد الحفظ.
create or replace function public.exams_protect_snapshots()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
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

drop trigger if exists exams_protect_snapshots on public.exams;
create trigger exams_protect_snapshots
  before update on public.exams
  for each row execute function public.exams_protect_snapshots();

-- التحقق من snapshot سؤال الاختبار عند الإدراج.
create or replace function public.exam_questions_validate_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_points text;
  v_layout text;
  v_type text;
begin
  if not exists (select 1 from public.exams e where e.id = new.exam_id
                 and e.user_id = new.user_id and not e.sealed and e.integrity_version = 2) then
    raise exception 'لا يمكن إضافة سؤال إلى اختبار محفوظ.' using errcode = '42501';
  end if;
  if new.snapshot is null or jsonb_typeof(new.snapshot) <> 'object' then
    raise exception 'نسخة السؤال مطلوبة.' using errcode = '23514';
  end if;

  v_type := new.snapshot ->> 'type';

  if v_type is null or v_type not in ('mcq', 'true_false', 'short') then
    raise exception 'نوع السؤال في النسخة غير صحيح.' using errcode = '23514';
  end if;

  v_points := new.snapshot ->> 'points';

  if v_points is null or v_points !~ '^[0-9]+([.][0-9]{1,2})?$' then
    raise exception 'درجة السؤال يجب أن تكون بمنزلتين عشريتين كحد أقصى.' using errcode = '23514';
  end if;

  if v_points::numeric <= 0 then
    raise exception 'درجة السؤال يجب أن تكون أكبر من صفر.' using errcode = '23514';
  end if;

  v_layout := coalesce(new.snapshot ->> 'layout', 'auto');

  if v_layout not in ('auto', 'full', 'half') then
    raise exception 'تخطيط السؤال غير صحيح.' using errcode = '23514';
  end if;

  if new.question_id is not null and not exists (
    select 1
    from public.questions q
    join public.exams e on e.id = new.exam_id
    where q.id = new.question_id
      and q.user_id = new.user_id
      and e.user_id = new.user_id
      and (e.subject_id is null or q.subject_id = e.subject_id)
  ) then
    raise exception 'السؤال لا يتبع مادة الاختبار أو لا تملكه.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists exam_questions_validate_snapshot on public.exam_questions;
create trigger exam_questions_validate_snapshot
  before insert on public.exam_questions
  for each row execute function public.exam_questions_validate_snapshot();

-- حماية snapshot سؤال الاختبار بعد الحفظ.
create or replace function public.exam_questions_protect_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'لا يمكن تغيير هوية السؤال المحفوظ.' using errcode = '42501';
  end if;
  if new.snapshot is distinct from old.snapshot then
    raise exception 'لا يمكن تعديل النسخة التاريخية للسؤال بعد حفظ الاختبار.' using errcode = '42501';
  end if;

  if new.position is distinct from old.position then
    raise exception 'لا يمكن تغيير ترتيب السؤال داخل الاختبار المحفوظ.' using errcode = '42501';
  end if;

  if new.exam_id is distinct from old.exam_id then
    raise exception 'لا يمكن نقل السؤال المحفوظ إلى اختبار آخر.' using errcode = '42501';
  end if;

  if new.question_id is distinct from old.question_id and new.question_id is not null then
    raise exception 'لا يمكن استبدال السؤال الأصلي المرتبط بالنسخة المحفوظة.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists exam_questions_protect_snapshot on public.exam_questions;
create trigger exam_questions_protect_snapshot
  before update on public.exam_questions
  for each row execute function public.exam_questions_protect_snapshot();

-- ============================================================
-- RLS
-- ============================================================
alter table public.subjects enable row level security;
alter table public.teaching_groups enable row level security;
alter table public.subject_groups enable row level security;
alter table public.questions enable row level security;
alter table public.question_groups enable row level security;
alter table public.letterheads enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.question_share_packages enable row level security;

-- subjects
drop policy if exists subjects_select_own on public.subjects;
create policy subjects_select_own on public.subjects
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists subjects_insert_own on public.subjects;
create policy subjects_insert_own on public.subjects
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists subjects_update_own on public.subjects;
create policy subjects_update_own on public.subjects
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists subjects_delete_own on public.subjects;
create policy subjects_delete_own on public.subjects
  for delete to authenticated
  using (auth.uid() = user_id);

-- teaching_groups
drop policy if exists teaching_groups_select_own on public.teaching_groups;
create policy teaching_groups_select_own on public.teaching_groups
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists teaching_groups_insert_own on public.teaching_groups;
create policy teaching_groups_insert_own on public.teaching_groups
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists teaching_groups_update_own on public.teaching_groups;
create policy teaching_groups_update_own on public.teaching_groups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists teaching_groups_delete_own on public.teaching_groups;
create policy teaching_groups_delete_own on public.teaching_groups
  for delete to authenticated
  using (auth.uid() = user_id);

-- subject_groups
drop policy if exists subject_groups_select_own on public.subject_groups;
create policy subject_groups_select_own on public.subject_groups
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists subject_groups_insert_own on public.subject_groups;
create policy subject_groups_insert_own on public.subject_groups
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = subject_groups.subject_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.teaching_groups g
      where g.id = subject_groups.group_id
        and g.user_id = auth.uid()
    )
  );

drop policy if exists subject_groups_update_own on public.subject_groups;
create policy subject_groups_update_own on public.subject_groups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = subject_groups.subject_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.teaching_groups g
      where g.id = subject_groups.group_id
        and g.user_id = auth.uid()
    )
  );

drop policy if exists subject_groups_delete_own on public.subject_groups;
create policy subject_groups_delete_own on public.subject_groups
  for delete to authenticated
  using (auth.uid() = user_id);

-- questions
drop policy if exists questions_select_own on public.questions;
create policy questions_select_own on public.questions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists questions_insert_own on public.questions;
create policy questions_insert_own on public.questions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = questions.subject_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists questions_update_own on public.questions;
create policy questions_update_own on public.questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = questions.subject_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists questions_delete_own on public.questions;
create policy questions_delete_own on public.questions
  for delete to authenticated
  using (auth.uid() = user_id);

-- question_groups
drop policy if exists question_groups_select_own on public.question_groups;
create policy question_groups_select_own on public.question_groups
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists question_groups_insert_own on public.question_groups;
create policy question_groups_insert_own on public.question_groups
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.questions q
      where q.id = question_groups.question_id
        and q.user_id = auth.uid()
        and q.subject_id = question_groups.subject_id
        and q.group_scope = 'selected'
    )
    and exists (
      select 1 from public.subject_groups sg
      where sg.subject_id = question_groups.subject_id
        and sg.group_id = question_groups.group_id
        and sg.user_id = auth.uid()
    )
  );

drop policy if exists question_groups_update_own on public.question_groups;
create policy question_groups_update_own on public.question_groups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.questions q
      where q.id = question_groups.question_id
        and q.user_id = auth.uid()
        and q.subject_id = question_groups.subject_id
        and q.group_scope = 'selected'
    )
    and exists (
      select 1 from public.subject_groups sg
      where sg.subject_id = question_groups.subject_id
        and sg.group_id = question_groups.group_id
        and sg.user_id = auth.uid()
    )
  );

drop policy if exists question_groups_delete_own on public.question_groups;
create policy question_groups_delete_own on public.question_groups
  for delete to authenticated
  using (auth.uid() = user_id);

-- letterheads
drop policy if exists letterheads_select_own on public.letterheads;
create policy letterheads_select_own on public.letterheads
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists letterheads_insert_own on public.letterheads;
create policy letterheads_insert_own on public.letterheads
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (logo_path is null or logo_path like (auth.uid()::text || '/%'))
  );

drop policy if exists letterheads_update_own on public.letterheads;
create policy letterheads_update_own on public.letterheads
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (logo_path is null or logo_path like (auth.uid()::text || '/%'))
  );

drop policy if exists letterheads_delete_own on public.letterheads;
create policy letterheads_delete_own on public.letterheads
  for delete to authenticated
  using (auth.uid() = user_id);

-- exams
drop policy if exists exams_select_own on public.exams;
create policy exams_select_own on public.exams
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists exams_insert_own on public.exams;

drop policy if exists exams_update_own on public.exams;

drop policy if exists exams_delete_own on public.exams;
create policy exams_delete_own on public.exams
  for delete to authenticated
  using (auth.uid() = user_id);

-- exam_questions
drop policy if exists exam_questions_select_own on public.exam_questions;
create policy exam_questions_select_own on public.exam_questions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists exam_questions_insert_own on public.exam_questions;

drop policy if exists exam_questions_update_own on public.exam_questions;

drop policy if exists exam_questions_delete_own on public.exam_questions;

-- question_share_packages: قراءة بيانات الإدارة فقط.
-- لا يوجد insert/update/delete مباشر؛ كلها عبر دوال SECURITY DEFINER.
drop policy if exists question_share_packages_insert_own on public.question_share_packages;
drop policy if exists question_share_packages_update_own on public.question_share_packages;
drop policy if exists question_share_packages_delete_own on public.question_share_packages;
drop policy if exists question_share_packages_select_own on public.question_share_packages;
create policy question_share_packages_select_own on public.question_share_packages
  for select to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- دوال الحفظ الذري
-- ============================================================

-- حفظ/تعديل مادة مع صفوفها وفصولها وأقسامها. security invoker ليبقى RLS فعالاً.
create or replace function public.save_subject(
  p_id uuid,
  p_name text,
  p_group_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'اسم المادة مطلوب.' using errcode = '23514';
  end if;

  if length(btrim(p_name)) > 120 then
    raise exception 'اسم المادة طويل جداً.' using errcode = '23514';
  end if;

  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception 'اختر صف / فصل / قسم واحد على الأقل.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(p_group_ids) as g(group_id)
    where not exists (
      select 1 from public.teaching_groups tg
      where tg.id = g.group_id and tg.user_id = auth.uid()
    )
  ) then
    raise exception 'إحدى الصفوف والفصول والأقسام المختارة غير موجودة أو لا تملكها.' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.subjects (user_id, name)
    values (auth.uid(), btrim(p_name))
    returning id into v_id;
  else
    update public.subjects
    set name = btrim(p_name)
    where id = p_id and user_id = auth.uid()
    returning id into v_id;

    if v_id is null then
      raise exception 'المادة غير موجودة أو لا تملك صلاحية تعديلها.' using errcode = 'P0002';
    end if;

    delete from public.subject_groups sg
    where sg.subject_id = v_id
      and not (sg.group_id = any (p_group_ids));
  end if;

  for v_group_id in
    select distinct g.group_id from unnest(p_group_ids) as g(group_id)
  loop
    insert into public.subject_groups (subject_id, group_id, user_id)
    values (v_id, v_group_id, auth.uid())
    on conflict (subject_id, group_id) do nothing;
  end loop;

  return v_id;
end;
$$;

-- حفظ/تعديل سؤال مع نطاق صفوف وفصول وأقسامه. لا يقرأ ولا يكتب questions.points.
create or replace function public.save_question(
  p_id uuid,
  p_subject_id uuid,
  p_unit text,
  p_type text,
  p_question_text text,
  p_options jsonb,
  p_correct_answer text,
  p_difficulty text,
  p_group_scope text,
  p_group_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_group_id uuid;
  v_scope text := coalesce(nullif(btrim(p_group_scope), ''), 'all');
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and s.user_id = auth.uid()
  ) then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = '42501';
  end if;

  if v_scope not in ('all', 'selected') then
    raise exception 'نطاق صفوف وفصول وأقسام السؤال غير صحيح.' using errcode = '23514';
  end if;

  if v_scope = 'selected' then
    if p_group_ids is null or cardinality(p_group_ids) = 0 then
      raise exception 'اختر صف / فصل / قسم واحد على الأقل.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from unnest(p_group_ids) as g(group_id)
      where not exists (
        select 1 from public.subject_groups sg
        where sg.subject_id = p_subject_id
          and sg.group_id = g.group_id
          and sg.user_id = auth.uid()
      )
    ) then
      raise exception 'إحدى الصفوف والفصول والأقسام المختارة غير مرتبطة بهذه المادة.' using errcode = '23514';
    end if;
  end if;

  if p_id is null then
    insert into public.questions (
      user_id, subject_id, unit, type, question_text, options,
      correct_answer, difficulty, group_scope
    ) values (
      auth.uid(), p_subject_id,
      nullif(btrim(coalesce(p_unit, '')), ''),
      p_type, p_question_text, p_options,
      p_correct_answer, p_difficulty, v_scope
    )
    returning id into v_id;
  else
    update public.questions
    set subject_id = p_subject_id,
        unit = nullif(btrim(coalesce(p_unit, '')), ''),
        type = p_type,
        question_text = p_question_text,
        options = p_options,
        correct_answer = p_correct_answer,
        difficulty = p_difficulty,
        group_scope = v_scope
    where id = p_id and user_id = auth.uid()
    returning id into v_id;

    if v_id is null then
      raise exception 'السؤال غير موجود أو لا تملك صلاحية تعديله.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.question_groups qg where qg.question_id = v_id;

  if v_scope = 'selected' then
    for v_group_id in
      select distinct g.group_id from unnest(p_group_ids) as g(group_id)
    loop
      insert into public.question_groups (question_id, subject_id, group_id, user_id)
      values (v_id, p_subject_id, v_group_id, auth.uid())
      on conflict (question_id, group_id) do nothing;
    end loop;
  end if;

  return v_id;
end;
$$;

-- حفظ الاختبار وأسئلته في معاملة واحدة.
-- p_questions = [{question_id, position, snapshot:{...}}]
create or replace function public.save_exam(
  p_title text,
  p_subject_id uuid,
  p_total_points numeric,
  p_group_ids uuid[],
  p_letterhead_id uuid,
  p_closing_phrase text,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_subject public.subjects%rowtype;
  v_letterhead public.letterheads%rowtype;
  v_letterhead_snapshot jsonb;
  v_group_names text[];
  v_sum numeric;
  v_item jsonb;
  v_question public.questions%rowtype;
  v_snapshot jsonb;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'عنوان الاختبار مطلوب.' using errcode = '23514';
  end if;

  if p_total_points is null or p_total_points <= 0 then
    raise exception 'إجمالي درجات الاختبار يجب أن يكون أكبر من صفر.' using errcode = '23514';
  end if;

  if p_total_points <> round(p_total_points, 2) then
    raise exception 'إجمالي درجات الاختبار بمنزلتين عشريتين كحد أقصى.' using errcode = '23514';
  end if;

  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id and s.user_id = auth.uid() for share;

  if not found then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = 'P0002';
  end if;

  if p_questions is null
     or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) = 0 then
    raise exception 'أضف سؤالاً واحداً على الأقل للاختبار.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item
    where item ->> 'question_id' is null
       or (item ->> 'question_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or item -> 'snapshot' is null
       or jsonb_typeof(item -> 'snapshot') <> 'object'
       or (item -> 'snapshot' ->> 'points') is null
       or (item -> 'snapshot' ->> 'points') !~ '^[0-9]+([.][0-9]{1,2})?$'
       or (item -> 'snapshot' ->> 'points')::numeric <= 0
       or (item ->> 'position') is null
       or (item ->> 'position') !~ '^[0-9]+$'
       or (item ->> 'position')::integer < 1
  ) then
    raise exception 'بيانات أسئلة الاختبار غير صالحة.' using errcode = '23514';
  end if;

  if (
    select count(distinct (item ->> 'position')::integer)
    from jsonb_array_elements(p_questions) as item
  ) <> jsonb_array_length(p_questions) then
    raise exception 'ترتيب أسئلة الاختبار غير فريد.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item
    left join public.questions q on q.id = (item ->> 'question_id')::uuid
    where q.id is null
       or q.user_id <> auth.uid()
       or q.subject_id <> p_subject_id
  ) then
    raise exception 'إحدى أسئلة الاختبار لا تتبع المادة أو لا تملكها.' using errcode = '42501';
  end if;

  select sum((item -> 'snapshot' ->> 'points')::numeric)
    into v_sum
  from jsonb_array_elements(p_questions) as item;

  if round(v_sum, 2) <> round(p_total_points, 2) then
    raise exception 'مجموع درجات الأسئلة يجب أن يساوي إجمالي درجات الاختبار.' using errcode = '23514';
  end if;

  -- Hold selected memberships and group names stable until the complete exam commits.
  perform 1 from public.subject_groups sg where sg.subject_id = p_subject_id
    and sg.group_id = any(coalesce(p_group_ids, '{}'::uuid[])) and sg.user_id = auth.uid()
    order by sg.group_id for share;
  perform 1 from public.teaching_groups g where g.id = any(coalesce(p_group_ids, '{}'::uuid[]))
    and g.user_id = auth.uid() order by g.id for share;

  if exists (
    select 1 from unnest(coalesce(p_group_ids, '{}'::uuid[])) as requested(id)
    where not exists (select 1 from public.subject_groups sg
      where sg.subject_id = p_subject_id and sg.group_id = requested.id and sg.user_id = auth.uid())
  ) or coalesce(cardinality(p_group_ids), 0) = 0 then
    raise exception 'اختر صفوف وفصول وأقسام صالحة تملكها وتتبع المادة.' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_questions) item
    join public.questions q on q.id = (item ->> 'question_id')::uuid
    where q.group_scope = 'selected' and (
      coalesce(cardinality(p_group_ids), 0) = 0 or exists (
        select 1 from unnest(p_group_ids) requested(id) where not exists (
          select 1 from public.question_groups qg where qg.question_id = q.id
          and qg.group_id = requested.id and qg.subject_id = p_subject_id and qg.user_id = auth.uid()
        )
      )
    )
  ) then
    raise exception 'السؤال يجب أن ينطبق على جميع صفوف وفصول وأقسام الاختبار.' using errcode = '23514';
  end if;

  select coalesce(array_agg(g.name order by g.name, g.id), '{}'::text[])
  into v_group_names from public.teaching_groups g
  where g.id = any(coalesce(p_group_ids, '{}'::uuid[])) and g.user_id = auth.uid();

  v_letterhead_snapshot := null;

  if p_letterhead_id is not null then
    select l.* into v_letterhead
    from public.letterheads l
    where l.id = p_letterhead_id and l.user_id = auth.uid() for share;

    if not found then
      raise exception 'قالب الكليشة غير موجود أو لا تملكه.' using errcode = 'P0002';
    end if;

    if v_letterhead.logo_path is not null and (
      v_letterhead.logo_path not like (auth.uid()::text || '/%') or not exists (
        select 1 from storage.objects o where o.bucket_id = 'letterhead-logos'
          and o.name = v_letterhead.logo_path
      )
    ) then
      raise exception 'ملف شعار الكليشة غير موجود أو لا تملكه.' using errcode = '23514';
    end if;

    v_letterhead_snapshot := jsonb_build_object(
      'id', v_letterhead.id,
      'name', v_letterhead.name,
      'entity_name', v_letterhead.entity_name,
      'school_name', v_letterhead.school_name,
      'university_name', v_letterhead.university_name,
      'college_name', v_letterhead.college_name,
      'department_name', v_letterhead.department_name,
      'extra_text', v_letterhead.extra_text,
      'logo_path', v_letterhead.logo_path
    );
  end if;

  insert into public.exams (
    sealed, integrity_version, group_ids_snapshot,
    user_id, subject_id, subject_name_snapshot, grade_level_snapshot,
    title, total_points, group_names_snapshot, letterhead_id,
    letterhead_snapshot, closing_phrase
  ) values (
    false, 2, coalesce(p_group_ids, '{}'::uuid[]),
    auth.uid(), p_subject_id, v_subject.name, v_subject.grade_level,
    btrim(p_title), p_total_points, v_group_names, p_letterhead_id,
    v_letterhead_snapshot,
    nullif(btrim(coalesce(p_closing_phrase, '')), '')
  )
  returning id into v_exam_id;

  for v_item in
    select value from jsonb_array_elements(p_questions)
  loop
    select q.* into v_question from public.questions q
      where q.id = (v_item ->> 'question_id')::uuid and q.user_id = auth.uid()
        and q.subject_id = p_subject_id for share;
    if not found then
      raise exception 'السؤال لم يعد متاحاً. أعد توليد المعاينة.' using errcode = '23514';
    end if;
    perform 1 from public.subject_groups sg where sg.subject_id = p_subject_id
      and sg.group_id = any(coalesce(p_group_ids, '{}'::uuid[])) for share;
    perform 1 from public.question_groups qg where qg.question_id = v_question.id
      and qg.group_id = any(coalesce(p_group_ids, '{}'::uuid[])) for share;
    if v_question.group_scope = 'selected' and (
      coalesce(cardinality(p_group_ids), 0) = 0 or exists (
        select 1 from unnest(p_group_ids) requested(id) where not exists (
          select 1 from public.question_groups qg where qg.question_id = v_question.id
            and qg.subject_id = p_subject_id and qg.group_id = requested.id and qg.user_id = auth.uid()
        )
      )
    ) then
      raise exception 'السؤال لم يعد صالحاً لجميع الصفوف والفصول والأقسام. أعد توليد المعاينة.' using errcode = '23514';
    end if;
    if (v_item -> 'snapshot' ->> 'question_text') is distinct from v_question.question_text
       or (v_item -> 'snapshot' ->> 'type') is distinct from v_question.type
       or (v_item -> 'snapshot' ->> 'correct_answer') is distinct from v_question.correct_answer
       or (v_item -> 'snapshot' ->> 'difficulty') is distinct from v_question.difficulty
       or (v_item -> 'snapshot' ->> 'unit') is distinct from v_question.unit then
      raise exception 'تغير سؤال أثناء المعاينة. أعد توليد الاختبار.' using errcode = '23514';
    end if;
    if v_question.type = 'mcq' then
      if jsonb_typeof(v_item -> 'snapshot' -> 'options') is distinct from 'array' then
        raise exception 'خيارات السؤال غير صالحة.' using errcode = '23514';
      end if;
      if (select jsonb_agg(value order by value) from jsonb_array_elements(v_item -> 'snapshot' -> 'options'))
         is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements(v_question.options)) then
        raise exception 'تغيرت خيارات السؤال. أعد توليد المعاينة.' using errcode = '23514';
      end if;
    end if;
    v_snapshot := jsonb_build_object(
      'question_text', v_question.question_text, 'type', v_question.type,
      'correct_answer', v_question.correct_answer, 'difficulty', v_question.difficulty,
      'unit', v_question.unit, 'options', case when v_question.type = 'mcq' then v_item -> 'snapshot' -> 'options' else null end,
      'points', (v_item -> 'snapshot' ->> 'points')::numeric,
      'layout', coalesce(v_item -> 'snapshot' ->> 'layout', 'auto')
    );
    insert into public.exam_questions (
      user_id, exam_id, question_id, position, snapshot
    ) values (
      auth.uid(), v_exam_id, (v_item ->> 'question_id')::uuid,
      (v_item ->> 'position')::integer, v_snapshot
    );
  end loop;

  update public.exams set sealed = true where id = v_exam_id;
  return v_exam_id;
end;
$$;

-- ============================================================
-- دوال المشاركة
-- ============================================================

-- إنشاء حزمة مشاركة. المفتاح الخام يُعاد مرة واحدة فقط.
create or replace function public.create_question_share(
  p_subject_id uuid,
  p_expires_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_subject public.subjects%rowtype;
  v_token text;
  v_hash text;
  v_groups jsonb;
  v_group_keys jsonb;
  v_questions jsonb;
  v_package jsonb;
  v_share_id uuid;
  v_expires_at timestamptz;
  v_count integer;
begin
  if v_user is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if p_expires_days is null or p_expires_days < 1 or p_expires_days > 30 then
    raise exception 'مدة صلاحية الرابط يجب أن تكون بين يوم و30 يوماً.' using errcode = '22023';
  end if;

  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id and s.user_id = v_user;

  if not found then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = 'P0002';
  end if;

  select count(*) into v_count
  from public.questions q
  where q.subject_id = v_subject.id and q.user_id = v_user;

  if v_count = 0 then
    raise exception 'لا يمكن مشاركة مادة بلا أسئلة.' using errcode = '23514';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  -- مفاتيح صفوف وفصول وأقسام داخلية مبهمة: hash(token + group_id).
  -- لا نضع معرّفات الصفوف والفصول والأقسام الأصلية داخل الحزمة.
  select coalesce(
    jsonb_object_agg(
      g.id::text,
      encode(extensions.digest(v_token || ':' || g.id::text, 'sha256'), 'hex')
    ),
    '{}'::jsonb
  )
    into v_group_keys
  from public.subject_groups sg
  join public.teaching_groups g on g.id = sg.group_id
  where sg.subject_id = v_subject.id
    and sg.user_id = v_user;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_id', v_group_keys ->> g.id::text,
        'name', g.name
      )
      order by g.name, g.id
    ),
    '[]'::jsonb
  )
    into v_groups
  from public.subject_groups sg
  join public.teaching_groups g on g.id = sg.group_id
  where sg.subject_id = v_subject.id
    and sg.user_id = v_user;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_text', q.question_text,
        'type', q.type,
        'options', q.options,
        'correct_answer', q.correct_answer,
        'difficulty', q.difficulty,
        'unit', q.unit,
        'group_scope', q.group_scope,
        'source_group_ids', coalesce(
          (
            select jsonb_agg(v_group_keys ->> qg.group_id::text order by g2.name, g2.id)
            from public.question_groups qg
            join public.teaching_groups g2 on g2.id = qg.group_id
            where qg.question_id = q.id
              and qg.user_id = v_user
          ),
          '[]'::jsonb
        )
      )
      order by q.created_at, q.id
    ),
    '[]'::jsonb
  )
    into v_questions
  from public.questions q
  where q.subject_id = v_subject.id and q.user_id = v_user;

  v_package := jsonb_build_object(
    'format', 'teacher-question-bank.share.v1',
    'subject_name', v_subject.name,
    'created_at', now(),
    'groups', v_groups,
    'questions', v_questions
  );

  insert into public.question_share_packages (
    user_id, subject_id, subject_name_snapshot, question_count,
    package, token_hash, expires_at
  ) values (
    v_user, v_subject.id, v_subject.name, v_count,
    v_package, v_hash, now() + make_interval(days => p_expires_days)
  )
  returning id, expires_at into v_share_id, v_expires_at;

  return jsonb_build_object(
    'share_id', v_share_id,
    'token', v_token,
    'expires_at', v_expires_at,
    'question_count', v_count,
    'group_count', jsonb_array_length(v_groups)
  );
end;
$$;

-- معاينة حزمة بمفتاح خام. لا تكشف جداول المرسل.
create or replace function public.get_question_share_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_share public.question_share_packages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول لعرض الحزمة.' using errcode = '42501';
  end if;

  if p_token is null or lower(btrim(p_token)) !~ '^[a-f0-9]{32,128}$' then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  v_hash := encode(extensions.digest(lower(btrim(p_token)), 'sha256'), 'hex');

  select s.* into v_share
  from public.question_share_packages s
  where s.token_hash = v_hash
    and s.used_at is null
    and s.revoked_at is null
    and s.expires_at > now();

  if not found then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'package', v_share.package,
    'expires_at', v_share.expires_at,
    'subject_name', v_share.subject_name_snapshot
  );
end;
$$;

-- استيراد الحزمة لمستخدم مسجل. المفتاح يُستهلك مرة واحدة عند النجاح.
-- p_group_mapping = { "source-key": {mode:"existing",group_id:"..."} }
--                  | { "source-key": {mode:"new",name:"..."} }
--                  | { "source-key": {mode:"skip"} }
create or replace function public.accept_question_share(
  p_token text,
  p_subject_name text default null,
  p_group_mapping jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_share public.question_share_packages%rowtype;
  v_package jsonb;
  v_mapping jsonb;
  v_subject_id uuid;
  v_subject_name text;
  v_group_map jsonb := '{}'::jsonb;
  v_source_group jsonb;
  v_source_id text;
  v_mode text;
  v_target_id uuid;
  v_group_name text;
  v_question jsonb;
  v_question_id uuid;
  v_source_group_id text;
  v_target_group_id text;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'يجب تسجيل الدخول لاستيراد الحزمة.' using errcode = '42501';
  end if;

  if p_token is null or lower(btrim(p_token)) !~ '^[a-f0-9]{32,128}$' then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  v_hash := encode(extensions.digest(lower(btrim(p_token)), 'sha256'), 'hex');

  select s.* into v_share
  from public.question_share_packages s
  where s.token_hash = v_hash
    and s.used_at is null
    and s.revoked_at is null
    and s.expires_at > now()
  for update;

  if not found then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  v_package := v_share.package;

  if coalesce(v_package ->> 'format', '') <> 'teacher-question-bank.share.v1'
     or coalesce(jsonb_typeof(v_package -> 'questions'), '') <> 'array' then
    raise exception 'صيغة حزمة المشاركة غير مدعومة.' using errcode = '22023';
  end if;

  v_mapping := case
    when p_group_mapping is not null and jsonb_typeof(p_group_mapping) = 'object'
      then p_group_mapping
    else '{}'::jsonb
  end;

  v_subject_name := coalesce(
    nullif(btrim(coalesce(p_subject_name, '')), ''),
    v_share.subject_name_snapshot
  );

  if v_subject_name is null or btrim(v_subject_name) = '' then
    raise exception 'اسم المادة مطلوب.' using errcode = '23514';
  end if;

  if length(btrim(v_subject_name)) > 120 then
    raise exception 'اسم المادة طويل جداً.' using errcode = '23514';
  end if;

  insert into public.subjects (user_id, name)
  values (v_user, btrim(v_subject_name))
  returning id into v_subject_id;

  for v_source_group in
    select value from jsonb_array_elements(coalesce(v_package -> 'groups', '[]'::jsonb))
  loop
    v_source_id := v_source_group ->> 'source_id';

    if v_source_id is null or v_source_id = '' then
      continue;
    end if;

    v_mode := coalesce(v_mapping -> v_source_id ->> 'mode', 'skip');
    v_target_id := null;

    if v_mode = 'existing' then
      begin
        v_target_id := (v_mapping -> v_source_id ->> 'group_id')::uuid;
      exception when others then
        v_target_id := null;
      end;

      if v_target_id is null or not exists (
        select 1 from public.teaching_groups g
        where g.id = v_target_id and g.user_id = v_user
      ) then
        raise exception 'إحدى الصفوف والفصول والأقسام المختارة غير موجودة أو لا تملكها.' using errcode = '42501';
      end if;
    elsif v_mode = 'new' then
      v_group_name := btrim(
        coalesce(
          v_mapping -> v_source_id ->> 'name',
          v_source_group ->> 'name'
        )
      );

      if v_group_name = '' then
        raise exception 'اسم الصف / الفصل / القسم الجديد مطلوب.' using errcode = '23514';
      end if;

      if length(v_group_name) > 120 then
        raise exception 'اسم الصف / الفصل / القسم طويل جداً.' using errcode = '23514';
      end if;

      insert into public.teaching_groups (user_id, name)
      values (v_user, v_group_name)
      on conflict (user_id, name) do update set name = excluded.name
      returning id into v_target_id;
    else
      continue;
    end if;

    v_group_map := v_group_map || jsonb_build_object(v_source_id, v_target_id::text);

    insert into public.subject_groups (subject_id, group_id, user_id)
    values (v_subject_id, v_target_id, v_user)
    on conflict (subject_id, group_id) do nothing;
  end loop;

  for v_question in
    select value from jsonb_array_elements(v_package -> 'questions')
  loop
    insert into public.questions (
      user_id, subject_id, unit, type, question_text, options,
      correct_answer, difficulty, group_scope
    ) values (
      v_user,
      v_subject_id,
      nullif(btrim(coalesce(v_question ->> 'unit', '')), ''),
      v_question ->> 'type',
      v_question ->> 'question_text',
      case
        when v_question ? 'options' and v_question -> 'options' <> 'null'::jsonb
          then v_question -> 'options'
        else null
      end,
      v_question ->> 'correct_answer',
      v_question ->> 'difficulty',
      case
        when v_question ->> 'group_scope' = 'selected' then 'selected'
        else 'all'
      end
    )
    returning id into v_question_id;

    if coalesce(v_question ->> 'group_scope', 'all') = 'selected' then
      for v_source_group_id in
        select value from jsonb_array_elements_text(
          coalesce(v_question -> 'source_group_ids', '[]'::jsonb)
        )
      loop
        v_target_group_id := v_group_map ->> v_source_group_id;

        if v_target_group_id is not null then
          insert into public.question_groups (question_id, subject_id, group_id, user_id)
          values (v_question_id, v_subject_id, v_target_group_id::uuid, v_user)
          on conflict (question_id, group_id) do nothing;
        end if;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  update public.question_share_packages
  set used_at = now(), used_by = v_user
  where id = v_share.id;

  return jsonb_build_object(
    'subject_id', v_subject_id,
    'subject_name', btrim(v_subject_name),
    'question_count', v_count,
    'group_count', (
      select count(*) from public.subject_groups sg where sg.subject_id = v_subject_id
    )
  );
end;
$$;

-- إلغاء رابط مشاركة يملكه المستخدم الحالي.
create or replace function public.revoke_question_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean := false;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  update public.question_share_packages
  set revoked_at = now()
  where id = p_share_id
    and user_id = auth.uid()
    and used_at is null
    and revoked_at is null
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

-- ============================================================
-- الصلاحيات
-- ============================================================

-- Saved exams are append-closed. A child DELETE is permitted only as part of
-- deleting the parent exam (the FK cascade sees no parent row).
create or replace function public.exam_questions_guard_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.exams e where e.id = old.exam_id)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'لا يمكن حذف سؤال من اختبار محفوظ؛ يمكن حذف الاختبار كاملاً.' using errcode = '42501';
  end if;
  return old;
end;
$$;
drop trigger if exists exam_questions_guard_delete on public.exam_questions;
create trigger exam_questions_guard_delete before delete on public.exam_questions
for each row execute function public.exam_questions_guard_delete();

-- Deferred verification sees the complete transaction, never an intermediate draft.
create or replace function public.check_exam_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_exam public.exams%rowtype;
  v_count bigint;
  v_sum numeric;
begin
  v_id := new.id;
  select * into v_exam from public.exams where id = v_id;
  if not found or v_exam.integrity_version < 2 then return null; end if;
  select count(*), sum((snapshot ->> 'points')::numeric)
    into v_count, v_sum from public.exam_questions where exam_id = v_id;
  if not v_exam.sealed or v_count = 0 or v_sum is distinct from v_exam.total_points then
    raise exception 'اختبار غير مكتمل أو غير متوازن.' using errcode = '23514';
  end if;
  return null;
end;
$$;
drop trigger if exists exams_check_integrity on public.exams;
create constraint trigger exams_check_integrity after insert or update on public.exams
  deferrable initially deferred for each row execute function public.check_exam_integrity();
drop trigger if exists exam_questions_check_integrity on public.exam_questions;
-- Parent INSERT/seal schedules the full aggregate check once per parent event.
-- Child writes are separately closed by ACL and insert/delete/update guards;
-- do not recalculate the full exam once for every child row.

-- Serialize new names per owner without imposing UNIQUE on unknown legacy duplicates.
create or replace function public.subjects_validate_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name
     and new.user_id is not distinct from old.user_id then return new; end if;
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' or length(new.name) > 120 then
    raise exception 'اسم المادة مطلوب وبحد أقصى 120 حرفاً.' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  if exists (select 1 from public.subjects s where s.user_id = new.user_id
       and lower(btrim(s.name)) = lower(new.name) and s.id <> new.id) then
    raise exception 'توجد مادة بالاسم نفسه. استخدم المادة الموجودة أو اختر اسماً مختلفاً.' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists subjects_validate_name on public.subjects;
create trigger subjects_validate_name before insert or update on public.subjects
for each row execute function public.subjects_validate_name();
create index if not exists subjects_user_normalized_name_idx on public.subjects (user_id, lower(btrim(name)));

do $$
declare v_table text; v_columns text;
begin
  foreach v_table in array array['subjects','questions','teaching_groups','subject_groups','question_groups','letterheads','exams','exam_questions','question_share_packages'] loop
    select string_agg(quote_ident(a.attname), ', ') into v_columns from pg_catalog.pg_attribute a
    where a.attrelid = ('public.' || v_table)::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('revoke all (%s) on table public.%I from public, anon, authenticated', v_columns, v_table);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;

revoke all on public.subjects from public, anon, authenticated;
revoke all on public.teaching_groups from public, anon, authenticated;
revoke all on public.subject_groups from public, anon, authenticated;
revoke all on public.questions from public, anon, authenticated;
revoke all on public.question_groups from public, anon, authenticated;
revoke all on public.letterheads from public, anon, authenticated;
revoke all on public.exams from public, anon, authenticated;
revoke all on public.exam_questions from public, anon, authenticated;
revoke all on public.question_share_packages from public, anon, authenticated;

grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.teaching_groups to authenticated;
grant select, insert, update, delete on public.subject_groups to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.question_groups to authenticated;
grant select, insert, update, delete on public.letterheads to authenticated;
revoke all on public.exams from public, anon, authenticated;
grant select, delete on public.exams to authenticated;
revoke all on public.exam_questions from public, anon, authenticated;
grant select on public.exam_questions to authenticated;

-- لا نمنح package أو token_hash للعميل إطلاقاً.
revoke all on public.question_share_packages from public, authenticated;
grant select (
  id, user_id, subject_id, subject_name_snapshot, question_count,
  created_at, expires_at, revoked_at, used_at
) on public.question_share_packages to authenticated;

revoke all on function public.save_subject(uuid, text, uuid[]) from public, anon;
revoke all on function public.save_question(uuid, uuid, text, text, text, jsonb, text, text, text, uuid[]) from public, anon;
revoke all on function public.save_exam(text, uuid, numeric, uuid[], uuid, text, jsonb) from public, anon;
revoke all on function public.create_question_share(uuid, integer) from public, anon;
revoke all on function public.get_question_share_preview(text) from public, anon;
revoke all on function public.accept_question_share(text, text, jsonb) from public, anon;
revoke all on function public.revoke_question_share(uuid) from public, anon;

grant execute on function public.save_subject(uuid, text, uuid[]) to authenticated;
grant execute on function public.save_question(uuid, uuid, text, text, text, jsonb, text, text, text, uuid[]) to authenticated;
grant execute on function public.save_exam(text, uuid, numeric, uuid[], uuid, text, jsonb) to authenticated;
grant execute on function public.create_question_share(uuid, integer) to authenticated;
grant execute on function public.get_question_share_preview(text) to authenticated;
grant execute on function public.accept_question_share(text, text, jsonb) to authenticated;
grant execute on function public.revoke_question_share(uuid) to authenticated;

-- ============================================================
-- تخزين الشعارات: bucket خاص، كل مستخدم داخل مجلد auth.uid()
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'letterhead-logos',
  'letterhead-logos',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "letterhead logos select own" on storage.objects;
create policy "letterhead logos select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "letterhead logos insert own" on storage.objects;
create policy "letterhead logos insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "letterhead logos update own" on storage.objects;

drop policy if exists "letterhead logos delete own" on storage.objects;


-- Append-only logo assets: template changes upload a NEW UUID path. No user can
-- replace/delete any logo, including an unreferenced upload. No Storage triggers
-- or metadata writes: the Storage API remains responsible for object lifecycle.
drop policy if exists "letterhead logos owner fence" on storage.objects;
create policy "letterhead logos owner fence" on storage.objects as restrictive for all to public
using (bucket_id <> 'letterhead-logos' or (auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text))
with check (bucket_id <> 'letterhead-logos' or (auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "letterhead logos immutable update" on storage.objects;
create policy "letterhead logos immutable update" on storage.objects as restrictive for update to public
using (bucket_id <> 'letterhead-logos') with check (bucket_id <> 'letterhead-logos');
drop policy if exists "letterhead logos immutable delete" on storage.objects;
create policy "letterhead logos immutable delete" on storage.objects as restrictive for delete to public
using (bucket_id <> 'letterhead-logos');

-- Known obsolete signature stays inaccessible; unknown overloads are blocked by preflight.
do $$ begin
  if to_regprocedure('public.save_exam(text,uuid,numeric,text[],uuid,text,jsonb)') is not null then
    execute 'revoke all on function public.save_exam(text,uuid,numeric,text[],uuid,text,jsonb) from public, anon, authenticated';
  end if;
end $$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.revoke_subject_shares_on_delete() from public, anon, authenticated;
revoke all on function public.teaching_groups_validate_row() from public, anon, authenticated;
revoke all on function public.subject_groups_validate_row() from public, anon, authenticated;
revoke all on function public.questions_validate_row() from public, anon, authenticated;
revoke all on function public.question_groups_validate_row() from public, anon, authenticated;
revoke all on function public.exams_prepare_insert() from public, anon, authenticated;
revoke all on function public.exams_protect_snapshots() from public, anon, authenticated;
revoke all on function public.exam_questions_validate_snapshot() from public, anon, authenticated;
revoke all on function public.exam_questions_protect_snapshot() from public, anon, authenticated;
revoke all on function public.exam_questions_guard_delete() from public, anon, authenticated;
revoke all on function public.check_exam_integrity() from public, anon, authenticated;
revoke all on function public.subjects_validate_name() from public, anon, authenticated;

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
  role text not null default 'teacher' check (role in ('teacher', 'admin')),
  display_name text not null default 'المعلم' check (length(display_name) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table teacher_bank_private.profiles is 'teacher-question-bank.profiles.v1';
alter table teacher_bank_private.profiles enable row level security;
revoke all on teacher_bank_private.profiles from public, anon, authenticated;
revoke all (id, role, display_name, created_at, updated_at)
  on teacher_bank_private.profiles from public, anon, authenticated;
create index if not exists profiles_role_created_idx
  on teacher_bank_private.profiles (role, created_at desc, id);

create or replace function teacher_bank_private.create_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into teacher_bank_private.profiles (id, role, display_name, created_at)
  values (new.id, 'teacher',
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), 'المعلم'), 160),
    coalesce(new.created_at, now()))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function teacher_bank_private.create_user_profile() from public, anon, authenticated;
drop trigger if exists tqb_create_profile_after_signup on auth.users;
create trigger tqb_create_profile_after_signup after insert on auth.users
for each row execute function teacher_bank_private.create_user_profile();

-- Backfill existing identities as teacher; preserve any previously assigned role.
insert into teacher_bank_private.profiles (id, role, display_name, created_at)
select u.id, 'teacher', left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), 'المعلم'), 160), coalesce(u.created_at, now())
from auth.users u on conflict (id) do nothing;

create or replace function teacher_bank_private.require_admin()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from teacher_bank_private.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
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
  select p.role into v_role from teacher_bank_private.profiles p where p.id = auth.uid();
  return coalesce(v_role, 'teacher');
end;
$$;

create or replace function public.get_admin_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform teacher_bank_private.require_admin();
  return jsonb_build_object(
    'teacher_count', (select count(*) from teacher_bank_private.profiles where role = 'teacher'),
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
    where p.role = 'teacher' and (v_search = ''
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


-- Fresh installations include the same follow-up objects as the upgrade.
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


begin;
-- BEGIN QUESTIONS PAGE V1
do $$
begin
  if to_regprocedure('public.get_my_role()') is null
     or to_regclass('public.question_groups') is null then
    raise exception 'Apply the application and admin migrations first.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_questions_page') then
    raise exception 'get_questions_page already exists; review before retrying.';
  end if;
end;
$$;

create or replace function public.get_questions_page(
  p_subject_id uuid default null,
  p_difficulty text default null,
  p_type text default null,
  p_unit text default null,
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 25,
  p_include_metadata boolean default true
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_subject uuid := p_subject_id;
  v_search text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_search, '')));
begin
  if v_user is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_include_metadata is null then
    raise exception 'حدود الصفحة غير صالحة.' using errcode = '22023';
  end if;
  if (p_difficulty is not null and p_difficulty not in ('easy','medium','hard'))
     or (p_type is not null and p_type not in ('mcq','true_false','short'))
     or pg_catalog.length(coalesce(p_unit, '')) > 120 or pg_catalog.length(v_search) > 500 then
    raise exception 'فلاتر الأسئلة غير صالحة.' using errcode = '22023';
  end if;
  -- Preserve the URL-filter behavior: ignore unavailable subjects without
  -- disclosing whether the UUID belongs to another teacher.
  if v_subject is not null and not exists (
    select 1 from public.subjects s where s.id = v_subject and s.user_id = v_user
  ) then v_subject := null; end if;

  return (
    with filtered as not materialized (
      select q.id, q.subject_id, q.unit, q.type, q.question_text, q.options,
        q.correct_answer, q.difficulty, q.group_scope, q.created_at
      from public.questions q
      where q.user_id = v_user
        and (v_subject is null or q.subject_id = v_subject)
        and (p_difficulty is null or q.difficulty = p_difficulty)
        and (p_type is null or q.type = p_type)
        and (p_unit is null or q.unit = p_unit)
        and (v_search = '' or pg_catalog.strpos(pg_catalog.lower(q.question_text), v_search) > 0
          or pg_catalog.strpos(pg_catalog.lower(coalesce(q.unit, '')), v_search) > 0)
    ), page as materialized (
      select * from filtered order by created_at desc, id limit p_limit offset p_offset
    ), page_groups as (
      select qg.question_id, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'group_id', g.id, 'name', g.name) order by g.name, g.id) as items
      from page p
      join public.question_groups qg on qg.question_id = p.id
        and qg.subject_id = p.subject_id and qg.user_id = v_user
      join public.teaching_groups g on g.id = qg.group_id and g.user_id = v_user
      group by qg.question_id
    ), page_data as (
      select p.*, coalesce(g.items, '[]'::jsonb) as question_groups
      from page p left join page_groups g on g.question_id = p.id
    )
    select pg_catalog.jsonb_build_object(
      'questions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)
        order by r.created_at desc, r.id) from page_data r), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'subject_id', v_subject,
      'metadata', case when p_include_metadata then pg_catalog.jsonb_build_object(
        'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'name', s.name)
          order by s.name, s.id) from public.subjects s where s.user_id = v_user), '[]'::jsonb),
        'units', coalesce((select pg_catalog.jsonb_agg(u.unit order by u.unit)
          from (select distinct q.unit from public.questions q where q.user_id = v_user
            and q.unit is not null and pg_catalog.btrim(q.unit) <> '') u), '[]'::jsonb),
        'role', public.get_my_role()
      ) else null end
    )
  );
end;
$$;
revoke all on function public.get_questions_page(uuid,text,text,text,text,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.get_questions_page(uuid,text,text,text,text,integer,integer,boolean) to authenticated;
-- END QUESTIONS PAGE V1
commit;

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
