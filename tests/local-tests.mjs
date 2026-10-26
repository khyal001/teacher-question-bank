import { runLibraryExamTests } from './library-exam-tests.mjs';
import { runAdminTests } from './admin-tests.mjs';
import { runHardeningTests } from './hardening-tests.mjs';
import { runPrepublishTests } from './prepublish-tests.mjs';
import { runQuestionPageTests } from './question-page-tests.mjs';
// ============================================================
// اختبارات محلية سريعة (Node 20+)
// التشغيل: node tests/local-tests.mjs
//
// لا تتصل بـ Supabase ولا تحتاج شبكة. تفحص:
//   * منطق توزيع الدرجات والتخطيط والأقسام.
//   * سلامة صياغة ملفات JavaScript.
//   * تطابق معرّفات DOM الثابتة مع صفحاتها.
//   * وجود جداول/دوال/سياسات الأمان المطلوبة في SQL.
//   * غياب الحقول القديمة من واجهات الأسئلة والاختبار.
//   * نصوص الطباعة المطلوبة.
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`✗ ${name}`);
    console.error(`  ${String(error?.message || error).slice(0, 1200)}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`✗ ${name}`);
    console.error(`  ${String(error?.message || error).slice(0, 1200)}`);
  }
}

// ------------------------------------------------------------
// 1) أدوات نقية: توزيع الدرجات، التخطيط، الأقسام
// ------------------------------------------------------------
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tqb-tests-'));
const utilsMjs = path.join(tempRoot, 'exam-utils.mjs');
fs.copyFileSync(path.join(root, 'js', 'exam-utils.js'), utilsMjs);
const utils = await import(pathToFileURL(utilsMjs).href);

await testAsync('توزيع 10 درجات على 7 أسئلة يساوي 10.00 بالضبط', () => {
  const points = utils.distributePoints(10, 7);
  assert.equal(points.length, 7);
  assert.equal(utils.sumPoints(points), 10);
  assert.equal(utils.pointsMatch(10, points), true);
  assert.equal(utils.remainingPoints(10, points), 0);
  assert.deepEqual(points, [2, 2, 2, 1, 1, 1, 1]);
});

await testAsync('توزيع 0.05 على 5 أسئلة يعطي 0.01 لكل سؤال', () => {
  const points = utils.distributePoints(0.05, 5);
  assert.deepEqual(points, [0.01, 0.01, 0.01, 0.01, 0.01]);
  assert.equal(utils.pointsMatch(0.05, points), true);
});

await testAsync('رفض إجمالي أصغر من عدد الأسئلة', () => {
  assert.throws(() => utils.distributePoints(0.04, 5));
  assert.throws(() => utils.distributePoints(0, 1));
  assert.throws(() => utils.distributePoints(1, 0));
});

await testAsync('رفض أكثر من منزلتين عشريتين والقيم غير الصالحة', () => {
  assert.equal(utils.toCents('1.234'), null);
  assert.equal(utils.toCents('abc'), null);
  assert.equal(utils.toCents(''), null);
  assert.equal(utils.isPositivePoints('-1'), false);
  assert.equal(utils.isPositivePoints('0'), false);
  assert.equal(utils.toCents('0.10'), 10);
});

await testAsync('حساب المجموع بالسنتات يتجنب أخطاء الفاصلة العائمة', () => {
  assert.equal(utils.pointsTotalCents([0.1, 0.2]), 30);
  assert.equal(utils.sumPoints([0.1, 0.2]), 0.3);
  assert.equal(utils.remainingPoints(1, [0.4]), 0.6);
  assert.equal(utils.pointsMatch(0.3, [0.1, 0.2]), true);
  assert.equal(utils.pointsMatch(0.3, [0.1, 0.19]), false);
});

await testAsync('اختيار تخطيط MCQ تلقائياً مع إمكانية تجاوزه', () => {
  assert.equal(utils.chooseMcqLayout(['أ', 'ب', 'ج', 'د']), 'half');
  assert.equal(utils.chooseMcqLayout(['أ'.repeat(40), 'ب']), 'full');
  assert.equal(utils.chooseMcqLayout(['1', '2', '3', '4', '5']), 'full');
  assert.equal(utils.chooseMcqLayout(['أ'.repeat(40), 'ب'], 'half'), 'half');
  assert.equal(utils.chooseMcqLayout(['أ', 'ب'], 'full'), 'full');
});

await testAsync('كل نوع يظهر مرة واحدة مع ترقيم متسلسل وترتيب داخلي ثابت', () => {
  const sections = utils.buildExamSections([
    { id: 'a', position: 2, snapshot: { type: 'true_false', points: '1' } },
    { id: 'b', position: 1, snapshot: { type: 'mcq', points: '2' } },
    { id: 'c', position: 3, snapshot: { type: 'short', points: '3' } },
  ]);

  assert.deepEqual(
    sections.map((section) => section.type),
    ['true_false', 'mcq', 'short'],
  );
  assert.deepEqual(
    sections.flatMap((section) => section.items.map((item) => item.displayNumber)),
    [1, 2, 3],
  );
});

await testAsync('أدوات snapshot تحسب الدرجات القديمة بأمان', () => {
  assert.equal(utils.snapshotPoints({ snapshot: { points: '1.25' } }), 1.25);
  assert.equal(utils.snapshotPoints({ snapshot: { points: '0' } }), 0);
  assert.equal(utils.snapshotPoints({ snapshot: {} }), 0);
  assert.equal(
    utils.totalFromRows([
      { snapshot: { points: '1.1' } },
      { snapshot: { points: '2.2' } },
      { snapshot: { points: 'غير صالح' } },
    ]),
    3.3,
  );
});

// ------------------------------------------------------------
// 2) صياغة JavaScript
// ------------------------------------------------------------
test('ملفات JavaScript تُحلَّل دون أخطاء صياغة', () => {
  const syntaxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tqb-syntax-'));

  try {
    for (const file of fs.readdirSync(path.join(root, 'js')).filter((name) => name.endsWith('.js'))) {
      const source = path.join(root, 'js', file);
      const destination = path.join(syntaxDir, file.replace(/\.js$/, '.mjs'));
      fs.copyFileSync(source, destination);
      execFileSync(process.execPath, ['--check', destination], { stdio: 'pipe' });
    }
  } finally {
    fs.rmSync(syntaxDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------
// 3) تطابق معرّفات DOM
// ------------------------------------------------------------
const pageScripts = new Map([
  ['index.html', 'index.js'],
  ['admin.html', 'admin.js'],
  ['profile.html', 'profile.js'],
  ['dashboard.html', 'dashboard.js'],
  ['subjects.html', 'subjects.js'],
  ['groups.html', 'groups.js'],
  ['questions.html', 'questions.js'],
  ['exam-builder.html', 'exam-builder.js'],
  ['exam-view.html', 'exam-view.js'],
  ['letterheads.html', 'letterheads.js'],
  ['share-import.html', 'share-import.js'],
]);

const dynamicIds = new Set([
  // تُنشأ داخل المعاينة في exam-builder.js
  'distributed-points',
  'remaining-points',
  'points-status',
  'points-total',
  'preview-total-value',
]);

test('كل getElementById ثابت له عنصر في صفحته', () => {
  const missing = [];

  for (const [page, script] of pageScripts) {
    const html = read(page);
    const js = read(path.join('js', script));
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const refs = new Set(
      [...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]),
    );

    for (const ref of refs) {
      if (dynamicIds.has(ref)) continue;
      if (!ids.has(ref)) missing.push(`${page} ← ${script}: #${ref}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('عناصر المصادقة المشتركة موجودة في كل صفحة محمية', () => {
  const authPages = [
    'dashboard.html',
    'admin.html',
    'profile.html',
    'subjects.html',
    'groups.html',
    'questions.html',
    'exam-builder.html',
    'exam-view.html',
    'letterheads.html',
    'share-import.html',
  ];
  const authJs = read(path.join('js', 'auth.js'));
  const authRefs = [
    ...authJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g),
  ].map((match) => match[1]);
  const missing = [];

  for (const page of authPages) {
    const ids = new Set(
      [...read(page).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
    );
    for (const ref of authRefs) {
      if (!ids.has(ref)) missing.push(`${page}: #${ref}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('لا معرّفات مكررة داخل أي صفحة', () => {
  const duplicates = [];

  for (const page of pageScripts.keys()) {
    const ids = [...read(page).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(`${page}: #${id}`);
      seen.add(id);
    }
  }

  assert.deepEqual(duplicates, []);
});

// ------------------------------------------------------------
// 4) الشروط الأمنية والتصميمية في الواجهة
// ------------------------------------------------------------
test('لا service_role أو مفاتيح خدمة في ملفات الواجهة', () => {
  const files = fs.readdirSync(path.join(root, 'js')).filter((name) => name.endsWith('.js'));
  const offenders = [];

  for (const file of files) {
    const text = read(path.join('js', file));
    if (/service_role|SUPABASE_SERVICE|DATABASE_PASSWORD/i.test(text)) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});

test('بنك الأسئلة لا يقرأ أو يكتب الدرجات أو الصف الدراسي', () => {
  const questions = read(path.join('js', 'questions.js'));
  assert.doesNotMatch(questions, /\bpoints\b/i);
  assert.doesNotMatch(questions, /grade_level|gradeLevel/);
  assert.doesNotMatch(questions, /duration_minutes|durationMinutes/);

  const dashboard = read(path.join('js', 'dashboard.js'));
  assert.doesNotMatch(dashboard, /grade_level|gradeLevel|duration_minutes/);

  const indexPage = read('index.html');
  assert.ok(indexPage.includes('المادة والصف / الفصل / القسم'));
  assert.doesNotMatch(indexPage, /grade_level/);
});

test('منشئ الاختبار لا يستخدم المدة ولا الصف الدراسي', () => {
  const builder = read(path.join('js', 'exam-builder.js'));
  assert.doesNotMatch(builder, /duration_minutes|durationMinutes|المدة/);
  assert.doesNotMatch(builder, /grade_level(?!_snapshot)|gradeLevel/); // read-only historical fallback is intentional
  assert.match(builder, /p_total_points/);
  assert.match(builder, /p_questions/);
});

test('صفحة الاختبار المطبوع تستخدم الدرجة الكلية ولا تعرض المدة', () => {
  const view = read(path.join('js', 'exam-view.js'));
  assert.doesNotMatch(view, /duration_minutes|durationMinutes|المدة/);
  assert.match(view, /درجة الاختبار/);
  assert.match(view, /رقم الطالب\/رقم الجلوس/);
  assert.match(view, /EXAM_FOOTER_TEXT/);
  assert.match(view, /ASSET_BUCKET/);
  assert.doesNotMatch(view, /الدرجة الكلية/);
});

test('نصوص التعليمات والطباعة مطابقة للمطلوب', () => {
  assert.equal(
    utils.TF_INSTRUCTION,
    'ضع علامة (✓) أمام العبارة الصحيحة، وعلامة (✗) أمام العبارة الخاطئة.',
  );
  assert.equal(utils.MCQ_INSTRUCTION, 'اختر الإجابة الصحيحة.');
  assert.equal(
    utils.EXAM_FOOTER_TEXT,
    'تم إنشاء هذا الاختبار بواسطة بنك أسئلة المعلم',
  );
  assert.match(read('exam-view.html'), /الرؤوس والتذييلات/);
  assert.match(read('exam-view.html'), /no-print/);
});

test('واجهة المشاركة لا تضع المفتاح في الاستعلام ولا تعرض هوية المرسل', () => {
  const subjects = read(path.join('js', 'subjects.js'));
  assert.match(subjects, /url\.hash = `token=\$\{data\.token\}`/);
  assert.match(subjects, /create_question_share/);
  assert.match(subjects, /revoke_question_share/);

  // طلب إنشاء المشاركة نفسه لا يرسل هوية المرسل؛ الخادم يأخذها من الجلسة.
  const shareCallStart = subjects.indexOf("rpc('create_question_share'");
  assert.notEqual(shareCallStart, -1);
  const shareCall = subjects.slice(shareCallStart, shareCallStart + 320);
  assert.doesNotMatch(shareCall, /user_id|email/i);

  const shareImport = read(path.join('js', 'share-import.js'));
  assert.match(shareImport, /get_question_share_preview/);
  assert.match(shareImport, /accept_question_share/);
  assert.match(shareImport, /window\.location\.replace/);
  assert.doesNotMatch(shareImport, /searchParams\.get\(['"]token/);

  // مسار المصادقة لا ينقل hash (مفتاح المشاركة) إلى استعلام صفحة الدخول أو البريد.
  const auth = read(path.join('js', 'auth.js'));
  const requireBlock = auth.slice(
    auth.indexOf('export async function requireAuth'),
    auth.indexOf('let watchingAuthState'),
  );
  assert.match(requireBlock, /safe\.includes\('#'\)/);
  assert.match(requireBlock, /'\.\/index\.html'/);

  const emailRedirectBlock = auth.slice(
    auth.indexOf('export function getEmailRedirectTo'),
    auth.indexOf('export async function getSessionUser'),
  );
  assert.match(emailRedirectBlock, /split\('#'\)\[0\]/);
  assert.doesNotMatch(emailRedirectBlock, /searchParams\.set\('next', next\)/);
});

test('الكليشة تستخدم Storage خاصاً وليست Base64', () => {
  const letterheads = read(path.join('js', 'letterheads.js'));
  assert.match(letterheads, /ASSET_BUCKET/);
  assert.match(letterheads, /\.upload\(/);
  assert.match(letterheads, /createSignedUrl/);
  assert.doesNotMatch(letterheads, /base64|data:image/i);
});

// ------------------------------------------------------------
// 5) SQL: الجداول، الدوال، الأمان، والترقية الآمنة
// ------------------------------------------------------------
const fullSchema = read(path.join('supabase', 'schema.sql'));
const schema = fullSchema.split('-- BEGIN ADMIN ROLES V1')[0];
const migration = read(path.join('supabase', 'migrations', '20261026_subjects_groups_sharing.sql'));

test('حذف ترقية الصف الدراسي القديمة', () => {
  assert.equal(exists(path.join('supabase', 'migrations', '20261026_require_subject_grade.sql')), false);
});

test('المخطط يحتوي الجداول والعلاقات الجديدة', () => {
  for (const token of [
    'public.teaching_groups',
    'public.subject_groups',
    'public.question_groups',
    'public.letterheads',
    'public.question_share_packages',
  ]) {
    assert.match(schema, new RegExp(token.replace('.', '\\.')));
  }
});

test('المخطط يحتوي دوال الحفظ والمشاركة', () => {
  for (const fn of [
    'save_subject',
    'save_question',
    'save_exam',
    'create_question_share',
    'get_question_share_preview',
    'accept_question_share',
    'revoke_question_share',
    'revoke_subject_shares_on_delete',
  ]) {
    assert.match(schema, new RegExp(`function public\\.${fn}`, 'i'));
    assert.match(migration, new RegExp(`function public\\.${fn}`, 'i'));
  }
});

test('المشاركة تستخدم hash وتاريخ صلاحية واستهلاكاً واحداً وإلغاء', () => {
  assert.match(schema, /token_hash text not null unique/);
  assert.match(schema, /gen_random_bytes\(32\)/);
  assert.match(schema, /digest\(v_token, 'sha256'\)/);
  assert.match(schema, /expires_at/);
  assert.match(schema, /used_at/);
  assert.match(schema, /revoked_at/);
  assert.match(schema, /for update/);
});

test('RLS مفعّل، ولمنح جداول المشاركة لا يشمل package أو token_hash', () => {
  assert.match(schema, /alter table public\.question_share_packages enable row level security/);
  assert.match(schema, /revoke all on public\.question_share_packages from public, authenticated/);
  assert.match(
    schema,
    /grant select \(\s*id, user_id, subject_id, subject_name_snapshot, question_count,/,
  );
  assert.doesNotMatch(
    schema,
    /grant select \([^)]*\bpackage\b[^)]*\) on public\.question_share_packages/,
  );
  assert.doesNotMatch(
    schema,
    /grant select \([^)]*\btoken_hash\b[^)]*\) on public\.question_share_packages/,
  );
  assert.doesNotMatch(
    schema,
    /grant select \([^)]*\bused_by\b[^)]*\) on public\.question_share_packages/,
  );
});

test('الشعارات في bucket خاص مع سياسات ملكية', () => {
  assert.match(schema, /'letterhead-logos'/);
  assert.match(schema, /letterhead logos select own/);
  assert.match(schema, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.doesNotMatch(schema, /public\s*=\s*true/);
});

test('الترقية لا تحذف جداول أو صفوفاً أساسية', () => {
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdrop\s+column\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.(subjects|questions|exams|teaching_groups|letterheads)\b/i);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
});

test('الترقية لا تفرض الصف الدراسي ولا تجعل points إلزامية', () => {
  assert.doesNotMatch(migration, /grade_level\s+set\s+not\s+null/i);
  assert.doesNotMatch(migration, /points\s+set\s+not\s+null/i);
  assert.match(migration, /alter column grade_level drop not null/i);
  assert.match(migration, /alter column points drop not null/i);
});

test('الترقية تعالج الصف الفارغ دون اختراع قيمة', () => {
  assert.match(migration, /set grade_level = null[\s\S]*btrim\(grade_level\) = ''/);
  assert.match(migration, /set grade_level = btrim\(grade_level\)/);
});

test('الترقية تُبقي الأعمدة القديمة وتنشئ الجديدة', () => {
  assert.match(migration, /add column if not exists total_points/);
  assert.match(migration, /add column if not exists group_names_snapshot/);
  assert.match(migration, /add column if not exists letterhead_snapshot/);
  assert.match(migration, /add column if not exists closing_phrase/);
  assert.doesNotMatch(migration, /drop constraint if exists questions_type_check/);
  assert.doesNotMatch(migration, /drop constraint if exists questions_difficulty_check/);
});

test('دوال المشاركة SECURITY DEFINER مع search_path آمن', () => {
  for (const fn of [
    'create_question_share',
    'get_question_share_preview',
    'accept_question_share',
    'revoke_question_share',
  ]) {
    const start = schema.indexOf(`function public.${fn}`);
    assert.notEqual(start, -1, fn);
    const chunk = schema.slice(start, start + 900);
    assert.match(chunk, /security definer/);
    assert.match(chunk, /set search_path = ''/);
  }
});

// ------------------------------------------------------------
// 6) الوثائق
// ------------------------------------------------------------
test('README يوثّق النموذج الجديد والأمان والترقية', () => {
  const readme = read('README.md');
  for (const phrase of [
    'الصفوف والفصول والأقسام',
    'الكليشة',
    'المشاركة',
    'الترقية',
    'RLS',
    'Supabase',
  ]) {
    assert.match(readme, new RegExp(phrase), `README missing: ${phrase}`);
  }
});

// ------------------------------------------------------------
// النتيجة
// ------------------------------------------------------------
await runHardeningTests({ test, testAsync, read, utils, schema, migration });
await runAdminTests({ test, testAsync, read, fullSchema, migration });
await runPrepublishTests({ test, testAsync, read, fullSchema });
await runQuestionPageTests({ test, testAsync, read, fullSchema });
await runLibraryExamTests({ test, testAsync, read, utils, fullSchema });

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('');
console.log(`النتيجة: ${passed} ناجح، ${failed} فاشل`);

if (failed > 0) {
  console.error('فشل الاختبارات التالية:');
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${String(failure.error?.message || failure.error).slice(0, 1200)}`);
  }
  process.exitCode = 1;
}
