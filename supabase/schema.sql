-- ============================================================
-- بنك أسئلة المعلم — مخطط قاعدة البيانات الكامل لـ Supabase
-- شغّل هذا الملف كاملاً من SQL Editor داخل مشروع Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) جدول المواد
-- ------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  grade_level text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 2) جدول الأسئلة
-- ------------------------------------------------------------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  unit text,
  type text not null check (type in ('mcq', 'true_false', 'short')),
  question_text text not null,
  options jsonb,
  correct_answer text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  points numeric not null default 1 check (points > 0),
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 3) جدول الاختبارات المحفوظة
--    snapshots لاسم المادة والصف تحفظ الوضع التاريخي وقت الإنشاء.
-- ------------------------------------------------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  subject_name_snapshot text not null,
  grade_level_snapshot text,
  title text not null,
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 4) جدول أسئلة الاختبارات
--    question_id قابل لـ NULL عمداً: حذف السؤال الأصلي لا يحذف
--    نسخته التاريخية داخل الاختبار.
-- ------------------------------------------------------------
create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  position int not null check (position > 0),
  snapshot jsonb not null,
  created_at timestamptz default now(),
  constraint exam_questions_exam_position_unique unique (exam_id, position),
  constraint exam_questions_exam_question_unique unique (exam_id, question_id)
);

-- ------------------------------------------------------------
-- الفهارس
-- ملاحظة: لا نضيف فهرساً منفصلاً على exam_questions(exam_id)
-- لأن UNIQUE(exam_id, position) يغطي البحث بادئاً بـ exam_id.
-- ------------------------------------------------------------
create index if not exists subjects_user_id_idx on public.subjects (user_id);

create index if not exists questions_user_id_idx on public.questions (user_id);
create index if not exists questions_subject_id_idx on public.questions (subject_id);

create index if not exists exams_user_id_idx on public.exams (user_id);
create index if not exists exams_subject_id_idx on public.exams (subject_id);

create index if not exists exam_questions_user_id_idx on public.exam_questions (user_id);
create index if not exists exam_questions_question_id_idx on public.exam_questions (question_id);

-- ============================================================
-- التحقق من قواعد تخزين الأسئلة
-- CHECK لا يسمح باستعلامات فرعية، لذلك نستخدم Trigger.
-- ============================================================
create or replace function public.questions_validate_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  new.question_text := btrim(coalesce(new.question_text, ''));
  if new.question_text = '' then
    raise exception 'نص السؤال مطلوب' using errcode = '23514';
  end if;

  if new.points is null or new.points <= 0 then
    raise exception 'درجة السؤال يجب أن تكون أكبر من صفر' using errcode = '23514';
  end if;

  if new.type = 'mcq' then
    if new.options is null or jsonb_typeof(new.options) <> 'array' then
      raise exception 'خيارات سؤال الاختيار من متعدد مطلوبة' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(new.options) as item(value)
      where jsonb_typeof(value) <> 'string'
    ) then
      raise exception 'جميع الخيارات يجب أن تكون نصوصاً' using errcode = '23514';
    end if;

    select count(*), count(distinct btrim(value))
      into v_count, v_distinct
    from jsonb_array_elements_text(new.options);

    if v_count < 2 or v_count > 6 then
      raise exception 'عدد الخيارات يجب أن يكون بين 2 و6' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(new.options) as item(value)
      where btrim(value) = ''
    ) then
      raise exception 'لا يسمح بخيار فارغ' using errcode = '23514';
    end if;

    if v_distinct <> v_count then
      raise exception 'لا يسمح بتكرار الخيارات' using errcode = '23514';
    end if;

    -- توحيد الخيارات بإزالة المسافات الطرفية مع الحفاظ على ترتيبها.
    select jsonb_agg(btrim(value) order by ord)
      into new.options
    from jsonb_array_elements_text(new.options) with ordinality as item(value, ord);

    new.correct_answer := btrim(coalesce(new.correct_answer, ''));
    if new.correct_answer = '' then
      raise exception 'حدد الإجابة الصحيحة' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements_text(new.options) as item(value)
      where value = new.correct_answer
    ) then
      raise exception 'الإجابة الصحيحة يجب أن تكون أحد الخيارات' using errcode = '23514';
    end if;

  elsif new.type = 'true_false' then
    new.correct_answer := lower(btrim(coalesce(new.correct_answer, '')));
    if new.correct_answer not in ('true', 'false') then
      raise exception 'إجابة صح/خطأ يجب أن تكون true أو false' using errcode = '23514';
    end if;
    new.options := null;

  else
    -- short
    new.correct_answer := btrim(coalesce(new.correct_answer, ''));
    if new.correct_answer = '' then
      raise exception 'الإجابة النموذجية مطلوبة' using errcode = '23514';
    end if;
    new.options := null;
  end if;

  return new;
end;
$$;

drop trigger if exists questions_validate_before_write on public.questions;
create trigger questions_validate_before_write
  before insert or update on public.questions
  for each row execute function public.questions_validate_row();

-- ============================================================
-- حماية snapshot داخل exam_questions من التعديل بعد الحفظ.
-- الحذف المتسلسل للاختبار، وتحويل question_id إلى NULL عند حذف
-- السؤال الأصلي، لا يغيّران snapshot ولذلك يمرّان بأمان.
-- ============================================================
create or replace function public.exam_questions_protect_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.snapshot is distinct from old.snapshot then
    raise exception 'لا يمكن تعديل النسخة التاريخية للسؤال بعد حفظ الاختبار'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists exam_questions_protect_snapshot on public.exam_questions;
create trigger exam_questions_protect_snapshot
  before update on public.exam_questions
  for each row execute function public.exam_questions_protect_snapshot();

-- ============================================================
-- تفعيل Row Level Security على الجداول الأربعة
-- ============================================================
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;

-- ============================================================
-- سياسات جدول subjects
-- ============================================================

-- قراءة مواد المعلم الحالي فقط.
drop policy if exists subjects_select_own on public.subjects;
create policy subjects_select_own on public.subjects
  for select to authenticated
  using (auth.uid() = user_id);

-- إضافة مادة مرتبطة بالمعلم الحالي فقط.
drop policy if exists subjects_insert_own on public.subjects;
create policy subjects_insert_own on public.subjects
  for insert to authenticated
  with check (auth.uid() = user_id);

-- تعديل مواد المعلم مع منع نقل الملكية لمستخدم آخر.
drop policy if exists subjects_update_own on public.subjects;
create policy subjects_update_own on public.subjects
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- حذف مواد المعلم فقط.
drop policy if exists subjects_delete_own on public.subjects;
create policy subjects_delete_own on public.subjects
  for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- سياسات جدول questions
-- ============================================================

-- قراءة أسئلة المعلم الحالي فقط.
drop policy if exists questions_select_own on public.questions;
create policy questions_select_own on public.questions
  for select to authenticated
  using (auth.uid() = user_id);

-- إضافة سؤال بشرط ملكية السؤال والمادة التابعة له.
drop policy if exists questions_insert_own on public.questions;
create policy questions_insert_own on public.questions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.subjects s
      where s.id = questions.subject_id
        and s.user_id = auth.uid()
    )
  );

-- تعديل سؤال بشرط بقاء الملكية وملكية المادة الجديدة.
drop policy if exists questions_update_own on public.questions;
create policy questions_update_own on public.questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.subjects s
      where s.id = questions.subject_id
        and s.user_id = auth.uid()
    )
  );

-- حذف أسئلة المعلم فقط.
drop policy if exists questions_delete_own on public.questions;
create policy questions_delete_own on public.questions
  for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- سياسات جدول exams
-- ============================================================

-- قراءة اختبارات المعلم الحالي فقط.
drop policy if exists exams_select_own on public.exams;
create policy exams_select_own on public.exams
  for select to authenticated
  using (auth.uid() = user_id);

-- إضافة اختبار بشرط ملكية المادة، وأن تكون snapshots الاسم والصف
-- مأخوذة فعلياً من المادة المملوكة للمستخدم وقت الإنشاء.
drop policy if exists exams_insert_own on public.exams;
create policy exams_insert_own on public.exams
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      subject_id is null
      or exists (
        select 1
        from public.subjects s
        where s.id = exams.subject_id
          and s.user_id = auth.uid()
          and s.name = exams.subject_name_snapshot
          and coalesce(s.grade_level, '') = coalesce(exams.grade_level_snapshot, '')
      )
    )
  );

-- تعديل اختبار بشرط بقاء الملكية وعدم ربطه بمادة مستخدم آخر.
drop policy if exists exams_update_own on public.exams;
create policy exams_update_own on public.exams
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      subject_id is null
      or exists (
        select 1
        from public.subjects s
        where s.id = exams.subject_id
          and s.user_id = auth.uid()
          and s.name = exams.subject_name_snapshot
          and coalesce(s.grade_level, '') = coalesce(exams.grade_level_snapshot, '')
      )
    )
  );

-- حذف اختبارات المعلم فقط.
drop policy if exists exams_delete_own on public.exams;
create policy exams_delete_own on public.exams
  for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- سياسات جدول exam_questions
-- ============================================================

-- قراءة أسئلة اختبارات المعلم الحالي فقط.
drop policy if exists exam_questions_select_own on public.exam_questions;
create policy exam_questions_select_own on public.exam_questions
  for select to authenticated
  using (auth.uid() = user_id);

-- إضافة سؤال لاختبار بشرط ملكية الاختبار والسؤال الأصلي.
drop policy if exists exam_questions_insert_own on public.exam_questions;
create policy exam_questions_insert_own on public.exam_questions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.exams e
      where e.id = exam_questions.exam_id
        and e.user_id = auth.uid()
    )
    and (
      question_id is null
      or exists (
        select 1
        from public.questions q
        where q.id = exam_questions.question_id
          and q.user_id = auth.uid()
      )
    )
  );

-- تعديل سؤال داخل اختبار بشرط بقاء ملكية الاختبار والسؤال.
drop policy if exists exam_questions_update_own on public.exam_questions;
create policy exam_questions_update_own on public.exam_questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.exams e
      where e.id = exam_questions.exam_id
        and e.user_id = auth.uid()
    )
    and (
      question_id is null
      or exists (
        select 1
        from public.questions q
        where q.id = exam_questions.question_id
          and q.user_id = auth.uid()
      )
    )
  );

-- حذف أسئلة اختبارات المعلم فقط.
drop policy if exists exam_questions_delete_own on public.exam_questions;
create policy exam_questions_delete_own on public.exam_questions
  for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- الصلاحيات على مستوى الجداول
-- RLS هو خط الحماية الفعلي، وهذه الصلاحيات لا تمنح وصولاً متجاوزاً.
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.exams to authenticated;
grant select, insert, update, delete on public.exam_questions to authenticated;

revoke all on public.subjects from anon;
revoke all on public.questions from anon;
revoke all on public.exams from anon;
revoke all on public.exam_questions from anon;
