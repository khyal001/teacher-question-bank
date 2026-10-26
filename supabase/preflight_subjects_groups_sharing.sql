-- DIAGNOSTIC ONLY. SELECT statements; no writes or configuration changes.
-- Review outputs before approving the migration. This file has NOT been run.

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where (schemaname = 'public' and tablename in (
  'subjects','questions','exams','exam_questions','teaching_groups','subject_groups',
  'question_groups','letterheads','question_share_packages'))
  or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select p.oid::regprocedure as signature, pg_catalog.pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer, p.proconfig, p.proacl,
  pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','teacher_bank_private') and (p.prosecdef or p.proname in (
  'save_subject','save_question','save_exam','create_question_share',
  'get_question_share_preview','accept_question_share','revoke_question_share',
  'exams_prepare_insert','exams_protect_snapshots','exam_questions_validate_snapshot',
  'exam_questions_protect_snapshot','exam_questions_guard_delete','check_exam_integrity',
  'subjects_validate_name','revoke_subject_shares_on_delete','require_admin','create_user_profile','get_my_role','get_admin_stats','get_admin_teachers'))
order by p.proname, p.oid::regprocedure::text;

select n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) as owner, n.nspacl
from pg_catalog.pg_namespace n where n.nspname in ('public', 'extensions');

select e.extname, n.nspname as extension_schema
from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';

select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','storage') and c.relkind in ('r','p')
order by n.nspname, c.relname;

select * from information_schema.column_privileges
where table_schema = 'public' and table_name in ('exams','exam_questions','question_share_packages')
order by table_name, grantee, column_name, privilege_type;

select conrelid::regclass as table_name, conname, convalidated,
  pg_catalog.pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

select user_id, lower(btrim(name)) as normalized_name, count(*) as copies, array_agg(id) as ids
from public.subjects group by user_id, lower(btrim(name)) having count(*) > 1;

select id, name from public.subjects where btrim(name) = '' or length(btrim(name)) > 120;
select id, title, grade_level_snapshot from public.exams order by created_at;

select id, exam_id, snapshot ->> 'points' as historical_points
from public.exam_questions
where coalesce(snapshot ->> 'points', '') !~ '^[0-9]+([.][0-9]{1,2})?$';

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'letterhead-logos';

-- Membership can confer unexpected privileges independently of direct grants.
select member::regrole as member_role, roleid::regrole as granted_role, admin_option
from pg_catalog.pg_auth_members
where member in ('anon'::regrole, 'authenticated'::regrole);

select schemaname, tablename, indexname, indexdef from pg_catalog.pg_indexes
where schemaname = 'public' order by tablename, indexname;

select t.tgrelid::regclass as table_name, t.tgname, pg_catalog.pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','storage') and not t.tgisinternal
order by t.tgrelid::regclass::text, t.tgname;

-- Catalog-only inspection works before the optional roles table exists.
select n.nspname, c.relname, c.relowner::regrole as owner, c.relrowsecurity, c.relacl
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'teacher_bank_private';

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies where schemaname = 'teacher_bank_private';
