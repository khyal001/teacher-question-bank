import assert from 'node:assert/strict';

export async function runQuestionPageTests({ test, testAsync, read, fullSchema }) {
  const page = await import(`data:text/javascript;base64,${Buffer.from(read('js/question-page-data.js')).toString('base64')}`);
  const sql = read('supabase/migrations/20261029_questions_page.sql');
  const source = read('js/questions.js');
  const payload = { questions: [], total: 0, subject_id: null, metadata: { subjects: [], units: [], role: 'teacher' } };
  await testAsync('تحميل الصفحة الأولى يرسل RPC واحدة بلا معرف مستخدم أو دور من المتصفح', async () => {
    const calls = [];
    const client = { rpc: async (...args) => { calls.push(args); return { data: payload }; } };
    assert.equal(await page.requestQuestionPage(client, { search: 'باب الجبر', user_id: 'another', role: 'admin' }, { metadata: true }), payload);
    assert.deepEqual(calls, [['get_questions_page', {
      p_subject_id: null, p_difficulty: null, p_type: null, p_unit: null, p_search: 'باب الجبر',
      p_offset: 0, p_limit: 25, p_include_metadata: true,
    }]]);
  });
  await testAsync('طلبات الفلاتر والصفحات تحافظ على القيم وتستغني عن metadata', async () => {
    let params;
    const client = { rpc: async (name, args) => { params = args; return { data: { ...payload, metadata: null } }; } };
    await page.requestQuestionPage(client, { subject: 'own-subject', difficulty: 'hard', type: 'short', unit: 'Chapter 2', search: 'a%,)_"' }, { offset: 25 });
    assert.deepEqual(params, { p_subject_id: 'own-subject', p_difficulty: 'hard', p_type: 'short', p_unit: 'Chapter 2',
      p_search: 'a%,)_"', p_offset: 25, p_limit: 25, p_include_metadata: false });
  });
  await testAsync('فشل RPC أو نتيجة ناقصة لا يتحول إلى بنك أسئلة فارغ وهمي', async () => {
    await assert.rejects(page.requestQuestionPage({ rpc: async () => ({ error: new Error('offline') }) }, {}), /offline/);
    for (const result of [null, { ...payload, total: -1 }, { ...payload, questions: null }, { ...payload, metadata: null },
      { ...payload, questions: Array(26).fill({}), total: 26 }, { ...payload, metadata: { ...payload.metadata, role: 'owner' } }]) {
      await assert.rejects(page.requestQuestionPage({ rpc: async () => ({ data: result }) }, {}, { metadata: true }));
    }
  });
  test('الطلب الأول مشترك بين العرض والتنقل دون get_my_role منفصلة', () => {
    const init = source.slice(source.indexOf('async function init()'), source.indexOf('// البيانات'));
    assert.ok(init.includes('rolePromise: firstPage.then((page) => page.metadata.role)'));
    assert.ok(init.includes('loadQuestions(false, firstPage)'));
    assert.ok(!init.includes('ensureEditorGroups'));
    assert.ok(!source.includes(".from('teaching_groups')"));
    assert.ok(!source.includes("rpc('get_question_units')"));
    assert.ok(!source.includes('loadSubjects()'));
    assert.ok(read('js/auth.js').includes('rolePromise ?? navigationRole(supabase)'));
  });
  test('خيارات النموذج تخص المادة الحالية فقط ومحمية من السباق وتكرار الطلب', () => {
    assert.ok(source.includes(".eq('subject_id', subjectId).eq('user_id', currentUser.id)"));
    assert.ok(source.includes('editorRequests.has(subjectId)'));
    assert.ok(source.includes('editorGroups.has(subjectId)'));
    assert.ok(source.includes('version !== editorVersion || !dialog.open || subjectId !== subjectSelect.value'));
    assert.ok(source.includes('if (editorLoading || !editorGroups.has(subjectSelect.value))'));
    assert.ok(source.includes("dialog.addEventListener('close'"));
  });
  test('RPC الجديدة SECURITY INVOKER ولا تغيّر RLS أو صلاحيات الجداول', () => {
    assert.ok(sql.includes("stable security invoker set search_path = ''"));
    assert.ok(!/security definer|create policy|drop policy|alter table|grant.*on (?:table|schema)/i.test(sql));
    assert.ok(sql.includes('v_user uuid := auth.uid()'));
    assert.ok(sql.includes('if v_user is null'));
    for (const predicate of ['q.user_id = v_user', 's.user_id = v_user', 'qg.user_id = v_user', 'g.user_id = v_user']) assert.ok(sql.includes(predicate));
    assert.ok(!sql.includes('p_user_id'));
    assert.ok(sql.includes('revoke all on function public.get_questions_page(uuid,text,text,text,text,integer,integer,boolean) from public, anon, authenticated'));
    assert.ok(sql.includes('grant execute on function public.get_questions_page(uuid,text,text,text,text,integer,integer,boolean) to authenticated'));
  });
  test('الحدود الخادمية تمنع جلب جميع الأسئلة ومعاملات pagination الفارغة', () => {
    assert.ok(sql.includes('p_limit is null or p_limit < 1 or p_limit > 100'));
    assert.ok(sql.includes('p_offset is null or p_offset < 0'));
    assert.ok(sql.includes('order by created_at desc, id limit p_limit offset p_offset'));
    assert.ok(sql.includes('filtered as not materialized'));
    assert.ok(sql.includes('page as materialized'));
    assert.ok(sql.includes('(select count(*) from filtered)'));
  });
  test('علاقات الصفوف تُجمع للصفحة فقط في SQL واحد دون استعلامات متصفح لكل سؤال', () => {
    assert.ok(sql.includes('from page p\n      join public.question_groups qg'));
    assert.ok(sql.includes('group by qg.question_id'));
    assert.ok(sql.includes('qg.subject_id = p.subject_id'));
    assert.ok(sql.includes("'group_id', g.id, 'name', g.name"));
    assert.ok(!source.includes(".from('question_groups')"));
  });
  test('الفلاتر والبحث الحرفي لا يستخدمان SQL أو فلاتر ديناميكية', () => {
    for (const condition of ['q.subject_id = v_subject', 'q.difficulty = p_difficulty', 'q.type = p_type', 'q.unit = p_unit',
      'pg_catalog.strpos(pg_catalog.lower(q.question_text), v_search)', 'pg_catalog.strpos(pg_catalog.lower(coalesce(q.unit, \'\')), v_search)']) assert.ok(sql.includes(condition));
    assert.ok(!/\bexecute\b/.test(sql.slice(sql.indexOf('returns jsonb'), sql.indexOf('revoke all'))));
  });
  test('metadata تُطلب أول مرة أو بعد الحفظ فقط والدور من الدالة الحالية الآمنة', () => {
    assert.ok(sql.includes('case when p_include_metadata then'));
    assert.ok(sql.includes("'role', public.get_my_role()"));
    assert.ok(sql.includes(') else null end'));
    assert.ok(source.includes('metadata: refreshMetadata || !metadataLoaded'));
    assert.ok(source.includes('await loadQuestions(false, null, true)'));
  });
  test('تعريف الترقية الجديدة مطابق للمخطط ولا يستبدل دالة أو Overload مجهولًا', () => {
    const block = (text) => text.slice(text.indexOf('-- BEGIN QUESTIONS PAGE V1'), text.indexOf('-- END QUESTIONS PAGE V1')).replace(/\r\n/g, '\n');
    assert.equal(block(fullSchema), block(sql));
    assert.ok(sql.includes("p.proname = 'get_questions_page'"));
    assert.ok(sql.includes('already exists; review before retrying'));
  });
}
