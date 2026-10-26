-- Local preparation only. One read-only RPC for the initial questions screen.
-- Apply after the existing application migrations. Never disables/bypasses RLS.
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
