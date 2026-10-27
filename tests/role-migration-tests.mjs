// Execute real PostgreSQL locally in memory. Never connects to Supabase.
// Optional test engine only; the application has no npm dependencies.
// Legacy fixtures are read from the exact Git version deployed before this rewrite.
// Requires that historical commit in the local clone and PGlite 0.5.12.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = process.env.TQB_PGLITE_ROOT || path.join(root, '.tmp/role-sql-runtime/node_modules/@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(path.join(engineRoot, 'dist/index.js')).href);
const { pgcrypto } = await import(pathToFileURL(path.join(engineRoot, 'dist/contrib/pgcrypto.js')).href);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const originalRevision = 'cf7d069ebb2139e7b09264366a248eb5206dd98f';
const original = (file) => execFileSync('git', ['show', `${originalRevision}:${file}`], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
const baseFile = 'supabase/migrations/20261026_subjects_groups_sharing.sql';
const adminFile = 'supabase/migrations/20261027_admin_roles.sql';
const upgradeFile = 'supabase/migrations/20261031_separate_user_roles.sql';
const laterFiles = ['20261028_profile_letterhead_layout', '20261029_questions_page', '20261030_library_pages_exam_revisions'].map((name) => `supabase/migrations/${name}.sql`);
const teacherId = '10000000-0000-4000-8000-000000000001';
const adminId = '10000000-0000-4000-8000-000000000002';
const newId = '10000000-0000-4000-8000-000000000003';
let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  // Only the platform surfaces needed by the real project SQL are simulated.
  // Auth API, email delivery, Storage HTTP and concurrent sessions are not simulated.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create schema storage;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth, storage to anon, authenticated;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1];
    $$;
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${teacherId}','teacher@example.invalid','{"full_name":"المعلم"}'),
      ('${adminId}','admin@example.invalid','{"full_name":"المدير"}');
  `);
  return db;
}

async function rejected(db, sql, pattern) {
  try {
    await assert.rejects(db.exec(sql), pattern);
    checks++;
  } finally {
    await db.exec('rollback;');
  }
}

async function asRole(db, role, id, action) {
  await db.exec('begin;');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id || '']);
    await db.exec(`set local role ${role};`);
    await action();
  } finally {
    await db.exec('rollback;');
  }
}

async function authorization(db) {
  const rows = (sql) => db.query(sql).then((result) => result.rows);
  const denied = async (sql) => {
    // PostgreSQL errors abort a transaction; a savepoint isolates each negative check.
    await db.exec('savepoint denied_check;');
    await assert.rejects(db.exec(sql), (error) => error.code === '42501');
    checks++;
    await db.exec('rollback to savepoint denied_check; release savepoint denied_check;');
  };
  for (const [id, expectedRole] of [[teacherId, 'teacher'], [adminId, 'admin']]) {
    await asRole(db, 'authenticated', id, async () => {
      equal(await rows('select public.get_my_role() as role'), [{ role: expectedRole }]);
      for (const sql of [
        'select * from teacher_bank_private.user_roles',
        "update teacher_bank_private.user_roles set role='admin'",
        `insert into teacher_bank_private.user_roles values('${newId}','admin')`,
        'delete from teacher_bank_private.user_roles',
        "select teacher_bank_private.has_role('admin')",
      ]) await denied(sql);
      if (expectedRole === 'teacher') {
        await denied('select public.get_admin_stats()');
        await denied('select public.get_admin_teachers()');
      } else {
        equal(await rows("select (public.get_admin_stats()->>'teacher_count')::integer as count"), [{ count: 1 }]);
        equal(await rows("select (public.get_admin_teachers()->>'total')::integer as count"), [{ count: 1 }]);
      }
      for (const name of ['get_subjects_page', 'get_exams_page', 'get_letterheads_page']) {
        const result = await db.query(`select public.${name}() as page`);
        equal(result.rows[0].page.metadata.role, expectedRole);
      }
    });
  }
  await asRole(db, 'anon', null, async () => {
    for (const sql of ['select public.get_my_role()', 'select public.get_admin_stats()', 'select public.get_admin_teachers()']) await denied(sql);
  });
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||$1::jsonb where id=$2", [JSON.stringify({ role: 'admin', is_admin: true, display_name: 'اسم محدث' }), teacherId]);
  equal(await rows(`select role from teacher_bank_private.user_roles where user_id='${teacherId}'`), [{ role: 'teacher' }]);
  equal(await rows(`select display_name from teacher_bank_private.profiles where id='${teacherId}'`), [{ display_name: 'اسم محدث' }]);
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [newId, 'signup@example.invalid', { role: 'admin', full_name: 'جديد' }]);
  equal(await rows(`select role from teacher_bank_private.user_roles where user_id='${newId}'`), [{ role: 'teacher' }]);
  await db.query('delete from auth.users where id=$1', [newId]);
  equal(await rows(`select count(*)::integer as count from teacher_bank_private.user_roles where user_id='${newId}'`), [{ count: 0 }]);
  equal(await rows(`select column_name from information_schema.columns where table_schema='teacher_bank_private' and table_name='profiles' and column_name in ('role','is_admin')`), []);
}

async function fingerprint(db) {
  // Compare authorization contracts and role constraints. Older content upgrades
  // intentionally retain some NOT VALID checks, unlike a brand-new installation.
  const queries = [
    `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,pg_get_functiondef(p.oid) as definition,p.proacl::text as acl
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','teacher_bank_private') order by 1,2,3`,
    `select table_schema,table_name,column_name,data_type,is_nullable,column_default
     from information_schema.columns where table_schema in ('public','teacher_bank_private') order by 1,2,ordinal_position`,
    `select n.nspname,c.relname,c.relrowsecurity,c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname in ('public','teacher_bank_private') and c.relkind='r' order by 1,2`,
    `select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','teacher_bank_private','storage') order by 1,2,3`,
    `select n.nspname,c.relname,k.contype,pg_get_constraintdef(k.oid) as definition from pg_constraint k
     join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='teacher_bank_private' order by 1,2,3,4`,
  ];
  return Promise.all(queries.map((sql) => db.query(sql).then((result) => result.rows)));
}

let canonical;
try {
  for (const mode of ['fresh-schema', 'fresh-migrations', 'legacy-upgrade', 'original-already-upgraded']) {
    const db = await database();
    try {
      if (mode === 'fresh-schema') {
        await db.exec(read('supabase/schema.sql'));
        await db.query("update teacher_bank_private.user_roles set role='admin' where user_id=$1", [adminId]);
      } else {
        // The first application migration upgrades pre-existing content tables.
        // Seed their current definitions; this suite targets the later role paths.
        const contentSchema = read('supabase/schema.sql').split('-- BEGIN ADMIN ROLES V1')[0];
        const definitions = contentSchema.match(/create table if not exists public\.\w+\s*\([\s\S]*?\n\);|create (?:unique )?index if not exists [\s\S]*?;/g) || [];
        for (const definition of definitions) await db.exec(definition);
        await db.exec(read(baseFile));
        const legacy = mode === 'legacy-upgrade' || mode === 'original-already-upgraded';
        await db.exec(legacy ? original(adminFile) : read(adminFile));
        const roleTable = legacy ? 'profiles' : 'user_roles';
        const key = legacy ? 'id' : 'user_id';
        await db.query(`update teacher_bank_private.${roleTable} set role='admin' where ${key}=$1`, [adminId]);
        for (const file of laterFiles) await db.exec(read(file));
        if (mode === 'legacy-upgrade') {
          await rejected(db, read(adminFile), /Legacy installation/);
          // Mixed data sources must abort without dropping or overwriting either table.
          await db.exec('create table teacher_bank_private.user_roles(user_id uuid primary key, role text);');
          await rejected(db, read(upgradeFile), /Mixed legacy/);
          equal((await db.query('select count(*)::integer as count from teacher_bank_private.profiles')).rows, [{ count: 2 }]);
          await db.exec('drop table teacher_bank_private.user_roles;');
          await db.exec("create function teacher_bank_private.has_role(text) returns boolean language sql as $$select false$$;");
          await rejected(db, read(upgradeFile), /Mixed legacy/);
          await db.exec('drop function teacher_bank_private.has_role(text);');
        }
        if (mode === 'original-already-upgraded') {
          await db.exec(original(upgradeFile));
          // Source cleanup must not require replaying a migration already applied live.
          await rejected(db, read(upgradeFile), /Known separate role table required/);
        } else {
          await db.exec(read(upgradeFile));
        }
      }
      equal((await db.query('select user_id::text,role from teacher_bank_private.user_roles order by user_id')).rows,
        [{ user_id: teacherId, role: 'teacher' }, { user_id: adminId, role: 'admin' }], `${mode}: preserved roles`);
      const actual = await fingerprint(db);
      if (!canonical) canonical = actual;
      else equal(actual, canonical, `${mode}: effective catalog matches fresh schema`);
      await authorization(db);
      await rejected(db, read(adminFile), /Role system already exists/);
      // Unknown objects must be reviewed, even when they have the expected name.
      await db.exec("comment on table teacher_bank_private.user_roles is 'unknown';");
      await rejected(db, read(upgradeFile), /Known separate role table required/);
      await db.exec("comment on table teacher_bank_private.user_roles is 'teacher-question-bank.user_roles.v1';");
      if (mode === 'fresh-migrations') {
        await db.exec('alter table teacher_bank_private.user_roles disable row level security;');
        await rejected(db, read(upgradeFile), /row security requires manual review/);
        await db.exec('alter table teacher_bank_private.user_roles enable row level security;');
        await db.exec('alter table teacher_bank_private.user_roles add column unexpected text;');
        await rejected(db, read(upgradeFile), /Unexpected role table structure/);
        await db.exec('alter table teacher_bank_private.user_roles drop column unexpected;');
        await db.exec('create policy unexpected_role_policy on teacher_bank_private.user_roles for select to authenticated using(true);');
        await rejected(db, read(upgradeFile), /no client policies/);
        await db.exec('drop policy unexpected_role_policy on teacher_bank_private.user_roles;');
        await db.exec("alter function teacher_bank_private.has_role(text) set search_path='public';");
        await rejected(db, read(upgradeFile), /Known private role helper required/);
      }
      console.log(`PASS ${mode}: actual schema execution, roles, permissions and collision checks`);
    } finally {
      await db.close();
    }
  }
  console.log(`${checks} PostgreSQL checks passed locally; no live database connection.`);
} catch (error) {
  console.error(`PostgreSQL verification failed: ${error.message.slice(0, 1800)}`);
  if (error.code) console.error(`SQLSTATE: ${error.code}`);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
}
