-- ============================================================
-- ترقية آمنة: جعل الصف الدراسي إلزامياً للمواد
-- شغّل هذا الملف مرة واحدة على مشروع Supabase الحالي.
-- لا يحذف جداول أو صفوفاً، ولا يعيد إنشاء المشروع.
-- ============================================================

-- يمكنك تشغيل هذا الاستعلام أولاً لمعرفة المواد القديمة الناقصة:
-- select id, name, grade_level
-- from public.subjects
-- where grade_level is null or btrim(grade_level) = '';

begin;

-- 1) إزالة المسافات الطرفية من القيم القديمة.
update public.subjects
set grade_level = btrim(grade_level)
where grade_level is not null
  and grade_level is distinct from btrim(grade_level);

-- 2) إيقاف الترقية بأمان إذا كانت هناك مواد بلا صف صالح.
--    لا نخترع قيمة بديلة ولا نحذف أي بيانات.
do $$
declare
  v_missing integer;
begin
  select count(*)
    into v_missing
  from public.subjects
  where grade_level is null
     or btrim(grade_level) = '';

  if v_missing > 0 then
    raise exception 'توجد % مادة بدون صف دراسي صالح. حدّث هذه المواد من صفحة المواد ثم أعد تشغيل الترقية.', v_missing
      using errcode = '23502';
  end if;
end;
$$;

-- 3) فرض NOT NULL ومنع الصف الفارغ أو المسافات فقط.
alter table public.subjects
  alter column grade_level set not null;

alter table public.subjects
  drop constraint if exists subjects_grade_level_not_blank;

alter table public.subjects
  add constraint subjects_grade_level_not_blank
  check (length(btrim(grade_level)) > 0) not valid;

alter table public.subjects
  validate constraint subjects_grade_level_not_blank;

-- 4) منع إنشاء اختبار جديد بدون snapshot للصف.
--    لا نجعل العمود NOT NULL لأن الاختبارات التاريخية قد تحمل NULL،
--    وتحديث subject_id إلى NULL عند حذف المادة يجب أن يظل مسموحاً.
create or replace function public.exams_require_grade_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.grade_level_snapshot := btrim(coalesce(new.grade_level_snapshot, ''));

  if new.grade_level_snapshot = '' then
    raise exception 'الصف الدراسي مطلوب لإنشاء الاختبار'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists exams_require_grade_snapshot_before_insert on public.exams;
create trigger exams_require_grade_snapshot_before_insert
  before insert on public.exams
  for each row execute function public.exams_require_grade_snapshot();

commit;
