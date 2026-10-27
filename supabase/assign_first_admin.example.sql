-- MANUAL EXAMPLE ONLY: SQL Editor, after the separate-user-roles migration and identity verification.
-- Never import this file into schema.sql or an automatic migration.
-- Replace the nil UUID with the intended existing user's UUID from Auth.
do $$
declare v_user_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace the example UUID with the verified user UUID first.';
  end if;
  update teacher_bank_private.user_roles
  set role = 'admin'
  where user_id = v_user_id;
  if not found then raise exception 'User role not found; no admin assigned.'; end if;
end;
$$;
