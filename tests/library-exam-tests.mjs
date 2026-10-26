import assert from 'node:assert/strict';

export async function runLibraryExamTests({ test, testAsync, read, utils, fullSchema }) {
  const sql = read('supabase/migrations/20261030_library_pages_exam_revisions.sql');
  const body = (name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
  const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const library = await load(read('js/library-page.js').replace(/^import .*;\r?\n/gm, ''));

  test('قياسات الأداء اختيارية ولا تسجل بيانات المستخدم أو طلبات إضافية', () => {
    const js = read('js/library-page.js');
    assert.ok(js.includes("get('measure') === '1'"));
    assert.ok(js.includes('if (!measure || renderVersion !== request) return;'));
    assert.ok(js.includes('container.dataset.rpcMs'));
    assert.ok(js.includes('container.dataset.listReadyMs'));
    assert.ok(!js.includes('console.'));
    for (const page of ['subjects', 'exam-view', 'letterheads']) {
      assert.ok(read(`js/${page}.js`).includes('page.rendered()'));
    }
  });
  test('التوزيع الصحيح يعطي الباقي للأسئلة الأولى دون كسور', () => {
    assert.deepEqual(utils.distributePoints(10, 4), [3, 3, 2, 2]);
    assert.deepEqual(utils.distributePoints(11, 5), [3, 2, 2, 2, 2]);
    assert.deepEqual(utils.distributePoints(4, 4), [1, 1, 1, 1]);
  });
  test('التوزيع يحافظ على المجموع والموجب عبر أحجام عديدة', () => {
    for (let total = 1; total <= 70; total++) for (let count = 1; count <= total; count++) {
      const points = utils.distributePoints(total, count);
      assert.ok(points.every((value) => Number.isInteger(value) && value > 0));
      assert.ok(utils.pointsMatch(total, points));
      assert.ok(points.slice(1).every((value, i) => points[i] >= value));
    }
  });
  test('الكسور تظل ممكنة فقط عندما يتعذر توزيع درجات صحيحة موجبة', () => {
    for (const [total, count] of [[2, 3], [10.5, 4], [0.05, 5]]) {
      const points = utils.distributePoints(total, count);
      assert.ok(points.every((p) => p > 0));
      assert.ok(utils.pointsMatch(total, points));
    }
    assert.ok(utils.pointsMatch(1, [0.5, 0.5])); // manual points unchanged
  });
  test('كل نوع قسم واحد وترتيبه الداخلي من position مع مجموع دقيق', () => {
    const rows = [
      { id: 's', position: 1, snapshot: { type: 'short', points: 1.234 } },
      { id: 'm2', position: 5, snapshot: { type: 'mcq', points: 3 } },
      { id: 't1', position: 2, snapshot: { type: 'true_false', points: 2 } },
      { id: 'm1', position: 3, snapshot: { type: 'mcq', points: 2 } },
      { id: 't2', position: 4, snapshot: { type: 'true_false', points: 4 } },
    ];
    const before = structuredClone(rows);
    const sections = utils.buildExamSections(rows);
    assert.deepEqual(sections.map((s) => s.type), ['true_false', 'mcq', 'short']);
    assert.deepEqual(sections.flatMap((s) => s.items.map((e) => e.row.id)), ['t1', 't2', 'm1', 'm2', 's']);
    assert.deepEqual(sections.map((s) => utils.totalFromRows(s.items.map((e) => e.row))), [6, 5, 1.234]);
    assert.equal(utils.totalFromRows(rows), 12.234);
    assert.deepEqual(rows, before);
  });
  test('الدرجة ليست بجانب رقم الفقرة؛ إجمالي القسم ودرجة القصير يسارًا', () => {
    const view = read('js/exam-view.js');
    const prefix = view.slice(view.indexOf('function questionPrefix'), view.indexOf('function renderTrueFalseQuestion'));
    assert.ok(!prefix.includes('points'));
    assert.ok(view.includes("if (section.type !== 'short') sectionHead.appendChild"));
    assert.ok(view.includes("{ class: 'exam-short-grade' }"));
    assert.ok(read('css/style.css').includes('margin-inline-start: auto'));
  });
  test('نسخ المسودة يحتفظ بالنص والخيارات والتخطيط والدرجة التاريخية دون تعديل الأصل', () => {
    const rows = [{ id: 'eq', question_id: null, position: 1,
      snapshot: { type: 'mcq', question_text: 'قديم', options: ['ب', 'أ'], points: 1.234, layout: 'half' } }];
    const before = structuredClone(rows);
    const draft = utils.draftFromExam({ subject_id: null }, rows);
    assert.equal(draft[0].sourceRowId, 'eq');
    assert.equal(draft[0].points, 1.234);
    assert.equal(draft[0].layout, 'half');
    draft[0].options.reverse();
    draft[0].question.question_text = 'جديد';
    assert.deepEqual(rows, before);
  });
  const pool = utils.QUESTION_TYPES.flatMap((type) => ['easy', 'medium', 'hard'].flatMap((difficulty) =>
    Array.from({ length: 3 }, (_, i) => ({ id: `${type}-${difficulty}-${i}`, type, difficulty }))));
  test('مصفوفة النوع والصعوبة تختار الأعداد المطلوبة فقط وتقبل صفرًا', () => {
    const result = utils.selectDistribution(pool, { mcq: { easy: 2, hard: 1 }, short: { medium: 1 } });
    assert.equal(result.length, 4);
    assert.equal(result.filter((q) => q.type === 'mcq' && q.difficulty === 'easy').length, 2);
    assert.equal(result.filter((q) => q.type === 'true_false').length, 0);
    assert.equal(new Set(result.map((q) => q.id)).size, result.length);
  });
  test('نقص نوع وصعوبة محددين يعطي رسالة دقيقة دون تعويض صامت', () => {
    assert.throws(() => utils.selectDistribution(pool, { mcq: { hard: 4 } }), /اختيار من متعدد — صعب: المطلوب 4، المتاح 3/);
    for (const count of [-1, 0.5, NaN, Infinity]) assert.throws(() => utils.selectDistribution(pool, { short: { easy: count } }));
    assert.throws(() => utils.selectDistribution(pool, {}), /واحد/);
  });
  test('السؤال الجديد محدد النطاق وبدون صعوبة؛ تحرير القائم يحفظ قيمته', () => {
    const js = read('js/questions.js');
    const html = read('questions.html');
    assert.ok(js.includes("difficultySelect.value = question?.difficulty || ''"));
    assert.ok(js.includes("setScopeRadio(question?.group_scope || 'selected')"));
    assert.ok(js.includes("?.value || 'selected'"));
    assert.ok(js.includes("if (!['easy', 'medium', 'hard'].includes(difficulty))"));
    assert.match(html, /value="" selected disabled>اختر مستوى الصعوبة/);
    assert.match(html, /name="group-scope" value="selected" checked/);
    assert.doesNotMatch(html, /name="group-scope" value="all" checked/);
  });
  await testAsync('توقيع عدة شعارات يدمج الطلب ويحترم TTL وإعادة المحاولة', async () => {
    const helpers = await load(read('js/data-utils.js'));
    let calls = 0;
    let clock = 0;
    let fail = false;
    const cache = helpers.createSignedUrlCache(library.batchSigner(async (paths) => {
      calls++;
      if (fail) throw new Error('offline');
      return new Map(paths.map((p) => [p, `signed-${calls}-${p}`]));
    }), () => clock);
    assert.deepEqual(await Promise.all([cache.get('a'), cache.get('b'), cache.get('a')]), ['signed-1-a', 'signed-1-b', 'signed-1-a']);
    assert.equal(calls, 1);
    await cache.get('a');
    assert.equal(calls, 1);
    clock = 3540001;
    fail = true;
    await assert.rejects(cache.get('a'), /offline/);
    fail = false;
    assert.equal(await cache.get('a'), 'signed-3-a');
  });
  await testAsync('فشل شعار واحد لا يمنع نجاح بقية دفعة التوقيع', async () => {
    const sign = library.batchSigner(async () => new Map([['ok', 'url']]));
    const results = await Promise.allSettled([sign('ok', 3600), sign('bad', 3600)]);
    assert.equal(results[0].value, 'url');
    assert.equal(results[1].status, 'rejected');
  });
  for (const table of ['subjects', 'exams', 'letterheads']) {
    test(`قائمة ${table}: RLS وحدود الصفحة ودور المستخدم ضمن الاستجابة نفسها`, () => {
      const fn = body(`get_${table}_page`);
      assert.ok(fn.includes("security invoker set search_path = ''"));
      assert.ok(fn.includes('v_user uuid := auth.uid()'));
      assert.ok(fn.includes('s.user_id = v_user'));
      assert.ok(fn.includes('limit p_limit offset p_offset'));
      assert.ok(fn.includes('p_limit > 100'));
      assert.ok(fn.includes('public.get_my_role()'));
      assert.ok(!fn.includes('p_user_id'));
      assert.ok(sql.includes(`revoke all on function public.get_${table}_page(integer,integer,boolean) from public, anon, authenticated`));
    });
  }
  test('قائمة المواد تجمع العلاقات والأعداد للصفحة فقط دون إرسال الأسئلة', () => {
    const fn = body('get_subjects_page');
    assert.ok(fn.includes('join page p on p.id = sg.subject_id'));
    assert.ok(fn.includes('join page p on p.id = q.subject_id'));
    assert.ok(!fn.includes('question_text'));
    const js = read('js/subjects.js');
    assert.ok(js.slice(js.indexOf('async function openDialog')).includes('await loadAllGroups()'));
    assert.ok(!js.slice(js.indexOf('async function loadSubjects'), js.indexOf('async function loadAllGroups')).includes('fetchAll'));
  });
  test('قائمة الاختبارات لا تطلب أسئلة أو snapshots كاملة', () => {
    const fn = body('get_exams_page');
    assert.ok(!fn.includes('exam_questions'));
    assert.ok(!fn.includes('letterhead_snapshot'));
    assert.ok(!fn.includes('select s.*'));
  });
  test('قائمة الكليشة تظهر قبل روابط الصور والتجديد لا يمس بطاقات أخرى', () => {
    const js = read('js/letterheads.js');
    const loader = js.slice(js.indexOf('async function loadLetterheads'), js.indexOf('async function getSignedLogoUrl'));
    assert.ok(!loader.includes('SignedLogo'));
    assert.ok(js.includes('IntersectionObserver'));
    assert.ok(js.includes('createSignedUrls(paths, ttl)'));
    assert.ok(!js.includes('signedUrlCache.clear()'));
    assert.ok(js.includes('if (!slot.isConnected || logoSlots.get(slot) !== row) return;'));
  });
  test('حفظ النسخة RPC محكومة لا تغيّر الأصل وتتحقق من مصدر كل سؤال تاريخي', () => {
    const fn = body('save_exam_revision');
    assert.ok(fn.includes("security definer set search_path = ''"));
    assert.ok(fn.includes('e.id = p_source_exam_id and e.user_id = v_user and e.sealed for share'));
    assert.ok(fn.includes('q.exam_id = v_source.id and q.user_id = v_user for share'));
    assert.ok(fn.includes('v_snapshot := v_old.snapshot'));
    assert.ok(!fn.includes('set snapshot'));
    assert.ok(fn.includes('where id = v_exam_id'));
    assert.ok(fn.includes('if v_sum is distinct from p_total_points'));
    assert.ok(fn.includes('false, 2'));
    assert.ok(sql.includes('new.source_exam_id is distinct from old.source_exam_id'));
  });
  test('النسخة تحتفظ بسياقها وتتحقق من صلاحية الأسئلة الجديدة لكل الخيارات', () => {
    const fn = body('save_exam_revision');
    assert.ok(fn.includes('q.subject_id = v_source.subject_id for share'));
    assert.ok(fn.includes('unnest(v_source.group_ids_snapshot) target(id)'));
    assert.ok(fn.includes('qg.user_id = v_user'));
    assert.ok(fn.includes('pg_catalog.to_jsonb(v_letterhead)'));
    assert.ok(fn.includes('v_letterhead_snapshot := v_source.letterhead_snapshot'));
    assert.ok(!fn.includes('p_user_id'));
    assert.ok(!/\bdelete\b/i.test(fn));
  });
  test('تعديل ونسخ يفتحان المصدر ولا يكتبان إلى الاختبار التاريخي', () => {
    const js = read('js/exam-builder.js');
    assert.ok(js.includes("supabase.rpc('save_exam_revision'"));
    assert.ok(js.includes("p_keep_letterhead: letterheadSelect.value === '_historical'"));
    assert.ok(js.includes('source_row_id: item.sourceRowId || null'));
    assert.ok(!js.includes(".from('exams').update("));
    assert.ok(read('js/exam-view.js').includes('&mode=edit'));
    assert.ok(read('js/exam-view.js').includes('&mode=copy'));
  });
  test('الترقية اللاحقة والمخطط متطابقان ولا تغيير لسياسات RLS أو Storage', () => {
    const block = (s) => s.split('-- BEGIN LIBRARY PAGES AND EXAM REVISIONS V1')[1].split('-- END LIBRARY PAGES AND EXAM REVISIONS V1')[0];
    assert.equal(block(sql), block(fullSchema));
    assert.ok(!/\b(?:create|drop|alter) policy\b|disable row level|grant.*on public\.exams\b/i.test(sql));
    assert.ok(!/\b(?:update|delete from) storage\./i.test(sql));
    assert.ok(sql.trim().startsWith('-- Apply only after 20261029.'));
    assert.ok(sql.trim().endsWith('commit;'));
  });
}
