import assert from 'node:assert/strict';

export async function runHardeningTests({ test, testAsync, read, utils, schema, migration }) {
  const source = read('js/data-utils.js');
  const helpers = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const fn = (sql, name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0] || '';
  const clean = (value) => value.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

  test('اختبار أ+ب يستبعد سؤال أ فقط', () => {
    assert.equal(utils.questionAppliesToGroups({ group_scope: 'selected' }, ['a'], ['a', 'b']), false);
    assert.equal(utils.questionAppliesToGroups({ group_scope: 'selected' }, ['b'], ['a', 'b']), false);
  });
  test('اختبار أ+ب يقبل سؤال أ+ب والأسئلة العامة', () => {
    assert.equal(utils.questionAppliesToGroups({ group_scope: 'selected' }, ['b', 'a'], ['a', 'b']), true);
    assert.equal(utils.questionAppliesToGroups({ group_scope: 'all' }, [], ['a', 'b']), true);
    assert.equal(utils.questionAppliesToGroups({ group_scope: 'selected' }, [], ['a']), false);
    assert.equal(utils.questionAppliesToGroups({ group_scope: 'selected' }, ['a'], []), false);
  });
  test('position يحكم ترتيب النوع دون تغيير المصفوفة الأصلية', () => {
    const rows = [
      { id: 'third', position: 3, snapshot: { type: 'mcq', options: ['b', 'a'] } },
      { id: 'first', position: 1, snapshot: { type: 'mcq' } },
      { id: 'second', position: 2, snapshot: { type: 'true_false' } },
    ];
    const before = structuredClone(rows);
    const sections = utils.buildExamSections(rows);
    assert.deepEqual(sections.map((section) => section.type), ['true_false', 'mcq']);
    assert.deepEqual(sections.flatMap((section) => section.items.map((item) => item.row.id)), ['second', 'first', 'third']);
    assert.deepEqual(rows, before);
    assert.deepEqual(sections.at(-1).items[1].row.snapshot.options, ['b', 'a']);
  });
  test('الدرجة التاريخية 1.234 تبقى ظاهرة دون تعديل الأصل', () => {
    const row = { snapshot: { points: '1.234' } };
    assert.equal(utils.snapshotPoints(row), 1.234);
    assert.equal(utils.totalFromRows([row, { snapshot: { points: 0.1 } }, { snapshot: { points: 0.2 } }]), 1.534);
    assert.equal(row.snapshot.points, '1.234');
    assert.equal(utils.isPositivePoints('1.234'), false);
    assert.equal(utils.totalFromRows([{ snapshot: { points: 1e-7 } }]), 1e-7);
  });
  test('عرض الصف التاريخي موصول بتحميل الاختبار والترويسة', () => {
    assert.equal(utils.historicalGrade({ grade_level_snapshot: ' الصف الثالث ' }), 'الصف الثالث');
    assert.equal(utils.historicalGrade({}), '');
    const view = read('js/exam-view.js');
    assert.ok(view.includes('subject_name_snapshot, grade_level_snapshot, total_points'));
    assert.ok(view.includes('const oldGrade = historicalGrade(exam)'));
    assert.ok(view.includes('text: `الصف التاريخي: ${oldGrade}`'));
    assert.ok(!read('js/ui.js').includes('Math.round(num * 100) / 100'));
  });
  test('لا بديل من صعوبة مختلفة ولا إعادة استخدام سؤال موجود', () => {
    const questions = [
      { id: 'used', type: 'mcq', difficulty: 'easy' },
      { id: 'hard', type: 'mcq', difficulty: 'hard' },
      { id: 'short', type: 'short', difficulty: 'easy' },
    ];
    const current = { type: 'mcq', difficulty: 'easy' };
    assert.deepEqual(utils.replacementCandidates(questions, current, new Set(['used'])), []);
    assert.deepEqual(utils.replacementCandidates([...questions, { id: 'new', ...current }], current, new Set(['used'])).map((q) => q.id), ['new']);
    assert.ok(read('js/exam-builder.js').includes('replacementCandidates(eligibleQuestions, current.question, usedIds)'));
  });
  test('حدود الأعداد الصحيحة الآمنة للدرجات الجديدة', () => {
    assert.equal(utils.toCents('90071992547409.92'), null);
    assert.equal(utils.pointsMatch(1, [0.5, 0.5]), true);
    assert.equal(utils.pointsMatch(1, [0.5, 0.4]), false);
  });
  test('الاستيرادات المحلية المسماة تشير إلى exports موجودة', () => {
    for (const file of ['auth', 'dashboard', 'exam-builder', 'exam-view', 'groups', 'letterheads', 'questions', 'share-import', 'subjects', 'supabase', 'index', 'admin', 'admin-utils', 'profile', 'profile-utils', 'letterhead-utils', 'question-page-data']) {
      for (const match of read(`js/${file}.js`).matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"]/g)) {
        const target = read(`js/${match[2]}`);
        for (const name of match[1].split(',').map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
          assert.ok(new RegExp(`export\\s+(?:(?:async\\s+)?function|const|let|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(target), `${file}: ${name}`);
        }
      }
    }
  });

  await testAsync('تحميل الدفعات لا يتوقف عند حد خادم أصغر من حجم الطلب', async () => {
    const records = [1, 2, 3, 4, 5];
    const ranges = [];
    const query = {
      order() { return this; },
      async range(start, end) {
        ranges.push([start, end]);
        return { data: records.slice(start, Math.min(end + 1, start + 2)), error: null };
      },
    };
    assert.deepEqual(await helpers.fetchAll(query, ['id'], 500), { data: records, error: null });
    assert.deepEqual(ranges.map(([start]) => start), [0, 2, 4, 5]);
  });
  await testAsync('خطأ منتصف الدفعات لا يتحول إلى بيانات مكتملة وهمية', async () => {
    const error = { code: '42501' };
    const query = { order() { return this; }, async range(start) { return start ? { error } : { data: [1] }; } };
    assert.deepEqual(await helpers.fetchAll(query), { data: null, error });
  });
  await testAsync('نهاية الدفعات 416 لا تفقد النتائج التي وصلت', async () => {
    const query = { order() { return this; }, async range(start) { return start ? { error: { code: 'PGRST103' } } : { data: ['last'] }; } };
    assert.deepEqual(await helpers.fetchAll(query), { data: ['last'], error: null });
  });
  test('كل قوائم البيانات تستخدم تحميل الدفعات', () => {
    for (const name of ['subjects', 'groups', 'questions', 'exam-builder', 'exam-view', 'letterheads', 'dashboard', 'share-import']) {
      assert.ok(/fetchAll\(|createLibraryPage\(/.test(read(`js/${name}.js`)), name);
    }
    assert.ok(read('js/questions.js').includes('requestQuestionPage(supabase, filters'));
  });
  await testAsync('Signed URL يجدد بعد انتهاء cache ولا يكرر الطلب المتزامن', async () => {
    let now = 0;
    let calls = 0;
    const cache = helpers.createSignedUrlCache(async () => `url-${++calls}`, () => now);
    assert.deepEqual(await Promise.all([cache.get('a'), cache.get('a')]), ['url-1', 'url-1']);
    now = 3539000;
    assert.equal(await cache.get('a'), 'url-1');
    now = 3540000;
    assert.equal(cache.peek('a'), null);
    assert.equal(await cache.get('a'), 'url-2');
    assert.equal(calls, 2);
  });
  await testAsync('فشل توقيع الرابط لا يبقى في cache ويمكن إعادة المحاولة', async () => {
    let calls = 0;
    const cache = helpers.createSignedUrlCache(async () => { if (++calls === 1) throw new Error('offline'); return 'ok'; });
    await assert.rejects(cache.get('a'), /offline/);
    assert.equal(await cache.get('a'), 'ok');
  });
  await testAsync('فشل signOut لا يحول الصفحة ونجاحه فقط يسمح بالتحويل', async () => {
    let redirects = 0;
    const redirect = () => redirects++;
    await assert.rejects(helpers.performSignOut({ auth: { signOut: async () => ({ error: new Error('offline') }) } }, redirect), /offline/);
    assert.equal(redirects, 0);
    await helpers.performSignOut({ auth: { signOut: async () => ({ error: null }) } }, redirect);
    assert.equal(redirects, 1);
    assert.ok(read('js/auth.js').includes('await performSignOut(supabase'));
  });
  test('استجابة الطلب السابق لا تصبح حالية بعد فتح مادة أخرى', () => {
    const gate = helpers.createRequestGate();
    const old = gate.next();
    const current = gate.next();
    assert.equal(gate.isCurrent(old), false);
    assert.equal(gate.isCurrent(current), true);
    assert.ok(read('js/subjects.js').includes('shareRequests.isCurrent(request)'));
  });
  await testAsync('الطباعة تنتظر الخطوط وفك ترميز الصور', async () => {
    let finishFonts;
    let decoded = false;
    let completed = false;
    const doc = {
      fonts: { ready: new Promise((resolve) => { finishFonts = resolve; }) },
      querySelectorAll: () => [{ complete: true, naturalWidth: 100, decode: async () => { decoded = true; } }],
    };
    const pending = helpers.waitForPrintAssets(doc).then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(decoded, false);
    finishFonts();
    await pending;
    assert.equal(decoded, true);
    assert.equal(completed, true);
  });
  await testAsync('الصورة التالفة تمنع الطباعة بدل تجاهل الخطأ', async () => {
    await assert.rejects(helpers.waitForPrintAssets({ querySelectorAll: () => [{ complete: true, naturalWidth: 0 }] }));
  });
  await testAsync('الطباعة تنتظر حدث تحميل صورة غير مكتملة', async () => {
    const listeners = new Map();
    let completed = false;
    const image = { complete: false, naturalWidth: 0,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    };
    const pending = helpers.waitForPrintAssets({ querySelectorAll: () => [image] }).then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(completed, false);
    image.complete = true;
    image.naturalWidth = 100;
    listeners.get('load')();
    await pending;
    assert.equal(completed, true);
    assert.equal(listeners.size, 0);
  });
  test('قواعد العرض الضيق لا تتداخل مع الطباعة ولا انتظار ثابت للطباعة', () => {
    assert.ok(!/@media\s*\(max-width:/.test(read('css/style.css')));
    assert.ok(read('js/exam-view.js').includes('await waitForPrintAssets('));
    assert.ok(!/setTimeout\(\(\) => window\.print/.test(read('js/exam-view.js')));
  });

  // Static SQL contract checks, NOT execution of PostgreSQL/RLS/Storage.
  for (const [label, sql] of [['schema', schema], ['migration', migration]]) {
    test(`${label}: RPC الوحيد للإنشاء وإغلاق الكتابة المباشرة`, () => {
      assert.ok(fn(sql, 'save_exam').includes('security definer'));
      assert.ok(sql.includes('revoke all on public.exams from public, anon, authenticated;'));
      assert.ok(sql.includes('grant select, delete on public.exams to authenticated;'));
      assert.ok(sql.includes('grant select on public.exam_questions to authenticated;'));
      assert.ok(!/grant (?:[^;]*, )?(?:insert|update|delete)[^;]*on public\.exam_questions to authenticated/i.test(sql));
      assert.ok(sql.includes('revoke all (%s) on table public.%I'));
    });
    test(`${label}: منع إضافة أو حذف سؤال بعد الحفظ وحماية snapshot/position`, () => {
      assert.ok(fn(sql, 'exam_questions_validate_snapshot').includes('and not e.sealed'));
      assert.ok(fn(sql, 'exam_questions_guard_delete').includes('where e.id = old.exam_id'));
      const protect = fn(sql, 'exam_questions_protect_snapshot');
      assert.ok(protect.includes('new.snapshot is distinct from old.snapshot'));
      assert.ok(protect.includes('new.position is distinct from old.position'));
      assert.ok(fn(sql, 'exams_protect_snapshots').includes('(old.sealed and not new.sealed)'));
    });
    test(`${label}: رفض الاختبار غير المتوازن وفحص مؤجل عند نهاية المعاملة`, () => {
      assert.ok(fn(sql, 'save_exam').includes('round(v_sum, 2) <> round(p_total_points, 2)'));
      assert.ok(fn(sql, 'save_exam').includes('set sealed = true'));
      assert.ok(fn(sql, 'check_exam_integrity').includes('v_sum is distinct from v_exam.total_points'));
      assert.equal((sql.match(/deferrable initially deferred for each row execute function public\.check_exam_integrity/g) || []).length, 1);
    });
    test(`${label}: الخادم يتحقق من معرفات جميع المجموعات`, () => {
      const save = fn(sql, 'save_exam');
      assert.ok(save.includes('p_group_ids uuid[]'));
      assert.ok(!save.includes('p_group_names'));
      assert.ok(save.includes('from unnest(p_group_ids) requested(id) where not exists'));
      assert.ok(save.includes('qg.group_id = requested.id'));
      assert.ok(save.includes('for share'));
    });
    test(`${label}: الشعار ثابت بسياسات restrictive ومنع تعديل/حذف الملف`, () => {
      assert.ok(sql.includes('as restrictive for update to public'));
      assert.ok(sql.includes('as restrictive for delete to public'));
      assert.ok(sql.includes("using (bucket_id <> 'letterhead-logos');"));
      assert.ok(fn(sql, 'save_exam').includes('where l.id = p_letterhead_id and l.user_id = auth.uid() for share'));
      assert.ok(fn(sql, 'save_exam').includes('from storage.objects o'));
      assert.ok(!/\.remove\(/.test(read('js/letterheads.js')));
    });
    test(`${label}: مسارات SECURITY DEFINER فارغة ولا تشفير غير مؤهل`, () => {
      const functions = [...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/g)];
      for (const match of functions.filter((match) => match[0].includes('security definer'))) {
        assert.ok(match[0].includes("set search_path = ''"), match[1]);
      }
      assert.ok(!/(?<![.\w])(?:digest|gen_random_bytes)\(/.test(sql));
      assert.ok(sql.includes('revoke create on schema public from public, anon, authenticated;'));
      assert.ok(sql.includes('revoke create on schema extensions from public, anon, authenticated;'));
    });
  }
  test('جميع أجسام الدوال والفهارس والسياسات متطابقة بين المخطط والترقية', () => {
    const functions = [...schema.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/g)];
    for (const match of functions) assert.equal(clean(match[0]), clean(fn(migration, match[1])), match[1]);
    const definitions = (sql, regex) => [...sql.matchAll(regex)].map((m) => clean(m[0])).sort();
    assert.deepEqual(definitions(schema, /create index if not exists[\s\S]*?;/g), definitions(migration, /create index if not exists[\s\S]*?;/g));
    assert.deepEqual(definitions(schema, /create policy[\s\S]*?;/g), definitions(migration, /create policy[\s\S]*?;/g));
  });
  test('الترقية تحافظ على الدقة التاريخية وتوقف السياسات والتواقيع المجهولة', () => {
    assert.ok(migration.includes("'^[0-9]+([.][0-9]+)?$'"));
    assert.ok(migration.includes('integrity_version < 2 or total_points = round(total_points, 2)'));
    assert.ok(migration.includes('Unknown policies require manual review'));
    assert.ok(migration.includes('Unknown RPC overloads require manual review'));
    assert.ok(migration.includes('Unknown SECURITY DEFINER functions require manual review'));
    assert.ok(migration.includes('Client role memberships require manual privilege review'));
    assert.ok(migration.includes('public.save_exam(text,uuid,numeric,text[],uuid,text,jsonb) from public, anon, authenticated'));
    assert.ok(!/\bcreate\s+unique\s+index\b/i.test(migration));
    assert.ok(migration.includes('pg_advisory_xact_lock'));
  });
  test('الإصدار الخارجي مثبت وخطة الاختبارات الحية موجودة', () => {
    assert.ok(read('js/supabase.js').includes('@supabase/supabase-js@2.118.0/+esm'));
    assert.ok(read('tests/SUPABASE_TEST_PLAN.md').includes('لم تُنفذ'));
    assert.ok(read('supabase/preflight_subjects_groups_sharing.sql').includes('DIAGNOSTIC ONLY'));
  });
}
