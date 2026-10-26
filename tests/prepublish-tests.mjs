import assert from 'node:assert/strict';

export async function runPrepublishTests({ test, testAsync, read, fullSchema }) {
  const load = (path) => import(`data:text/javascript;base64,${Buffer.from(read(path)).toString('base64')}`);
  const profile = await load('js/profile-utils.js');
  const data = await load('js/data-utils.js');
  const letterhead = await load('js/letterhead-utils.js');
  const sql = read('supabase/migrations/20261028_profile_letterhead_layout.sql');

  await testAsync('حفظ الاسم يرسل حقول الاسم فقط ولا يقبل حقول الدور', async () => {
    let sent;
    const user = { user_metadata: { display_name: 'اسم جديد' } };
    const client = { auth: { updateUser: async (value) => { sent = value; return { data: { user } }; } } };
    assert.equal(await profile.updateDisplayName(client, '  اسم جديد  '), user);
    assert.deepEqual(sent, { data: { display_name: 'اسم جديد', full_name: 'اسم جديد' } });
    assert.equal(profile.profileName(user), 'اسم جديد');
    assert.equal(profile.profileName({ user_metadata: { full_name: 'اسم قديم' } }), 'اسم قديم');
  });
  await testAsync('رفض الاسم الفارغ والطويل قبل طلب Auth', async () => {
    let calls = 0;
    const client = { auth: { updateUser: () => { calls++; } } };
    await assert.rejects(profile.updateDisplayName(client, '   '));
    await assert.rejects(profile.updateDisplayName(client, 'a'.repeat(161)));
    assert.equal(calls, 0);
  });
  await testAsync('خطأ Auth لا يظهر كنجاح وهمي في حفظ الاسم', async () => {
    await assert.rejects(profile.updateDisplayName({ auth: { updateUser: async () => ({ error: new Error('offline') }) } }, 'اسم'), /offline/);
  });
  for (const [label, result, expected] of [
    ['Teacher', { data: 'teacher' }, 'teacher'], ['Admin', { data: 'admin' }, 'admin'],
    ['خطأ RPC', { error: new Error('denied'), data: 'admin' }, 'teacher'],
    ['دور غير متوقع', { data: { role: 'admin' } }, 'teacher'],
  ]) {
    await testAsync(`رابط الإدارة: ${label}`, async () => {
      const calls = [];
      assert.equal(await profile.navigationRole({ rpc: async (name) => { calls.push(name); return result; } }), expected);
      assert.deepEqual(calls, ['get_my_role']);
    });
  }
  test('البريد للقراءة فقط ورابط الاسم والأيقونة عنصر واحد', () => {
    assert.match(read('profile.html'), /id="profile-email"[^>]*readonly/);
    assert.ok(!/<(?:input|select)[^>]*(?:id|name)="[^"]*role/.test(read('profile.html')));
    for (const name of ['dashboard', 'subjects', 'groups', 'questions', 'exam-builder', 'exam-view', 'letterheads', 'share-import', 'admin', 'profile']) {
      const html = read(`${name}.html`);
      assert.match(html, /<a class="profile-link"[^>]*>[\s\S]*?class="user-icon"[\s\S]*?id="nav-user-name"[\s\S]*?<\/a>/, name);
      assert.match(html, /<img class="brand-mark" src="\.\/favicon.svg/);
    }
  });
  await testAsync('صفحة الأسئلة الصغيرة تحتاج طلب صفحة واحدًا دون طلب فارغ إضافي', async () => {
    const calls = [];
    const result = await data.fetchPage({ range: async (start, end) => { calls.push([start, end]); return { data: [1, 2, 3], count: 3 }; } });
    assert.deepEqual(result.data, [1, 2, 3]);
    assert.deepEqual(calls, [[0, 24]]);
  });
  await testAsync('صفحة الأسئلة تحترم حد خادم أصغر دون إسقاط سجلات', async () => {
    const records = [0, 1, 2, 3, 4, 5, 6];
    const calls = [];
    const result = await data.fetchPage({ range: async (start, end) => {
      calls.push([start, end]); return { data: records.slice(start, Math.min(end + 1, start + 2)), count: records.length };
    } }, 2, 4);
    assert.deepEqual(result.data, [2, 3, 4, 5]);
    assert.deepEqual(calls, [[2, 5], [4, 5]]);
    assert.equal(result.count, 7);
  });
  await testAsync('غياب العدد أو خطأ الصفحة لا يتحول إلى نتائج مكتملة', async () => {
    assert.ok((await data.fetchPage({ range: async () => ({ data: [1] }) })).error);
    const error = new Error('offline');
    assert.equal((await data.fetchPage({ range: async () => ({ error }) })).error, error);
  });
  await testAsync('fetchAll يتوقف بالعدد الصحيح مع الحفاظ على دعم حد الخادم', async () => {
    let calls = 0;
    const rows = [1, 2, 3];
    const result = await data.fetchAll({ order() { return this; }, async range(start) { calls++; return { data: rows.slice(start, start + 2), count: 3 }; } });
    assert.deepEqual(result.data, rows);
    assert.equal(calls, 2);
  });
  test('البحث يشمل السؤال والوحدة ويقتبس الرموز لمنع حقن فلاتر PostgREST', () => {
    assert.equal(data.questionSearchFilter('جبر'), 'question_text.ilike."%جبر%",unit.ilike."%جبر%"');
    const expression = data.questionSearchFilter('a",user_id.eq.other)%_');
    assert.ok(expression.includes('a\\",user\\_id.eq.other)\\%\\_'));
    assert.equal(expression.split('unit.ilike.').length, 2);
  });
  test('مسار الأسئلة لا يجلب كل الأسئلة أو علاقاتها عند كل فلترة', () => {
    const source = read('js/questions.js');
    assert.ok(!source.includes(".from('question_groups')"));
    assert.ok(!source.includes(".select('unit')"));
    assert.ok(source.includes('question_groups(group_id)'));
    assert.ok(source.includes('requestQuestionPage(supabase, filters'));
    assert.ok(source.includes('if (token !== loadToken) return'));
    assert.ok(read('supabase/migrations/20261029_questions_page.sql').includes('order by created_at desc, id limit p_limit offset p_offset'));
  });

  const base = { logo_path: 'owner/logo.png', entity_name: 'وزارة التعليم', school_name: 'جامعة طيبة', department_name: 'الهندسة', layout: { ...letterhead.DEFAULT_LETTERHEAD_LAYOUT } };
  test('الكليشة تقبل جميع تبديلات اليمين والوسط واليسار دون تداخل', () => {
    for (const logo of ['right', 'center', 'left']) for (const entity of ['right', 'center', 'left']) for (const education of ['right', 'center', 'left']) {
      const error = letterhead.layoutError({ ...base, layout: { logo, entity, education } });
      assert.equal(Boolean(error), new Set([logo, entity, education]).size !== 3);
    }
  });
  test('الحقول الفارغة لا تشغل مواضع أو تمنع توزيع العناصر الظاهرة', () => {
    const layout = { logo: 'right', entity: 'right', education: 'left' };
    assert.equal(letterhead.layoutError({ ...base, logo_path: null, layout }), '');
    assert.equal(letterhead.layoutError({ ...base, entity_name: '', layout }), '');
    assert.ok(letterhead.layoutError({ ...base, layout }));
  });
  test('رفض مواضع مجهولة وخصائص إضافية مع حفظ أسطر الكليشة القديمة', () => {
    assert.ok(letterhead.layoutError({ ...base, layout: { ...base.layout, logo: 'overlap' } }));
    assert.ok(letterhead.layoutError({ ...base, layout: { ...base.layout, extra: 'left' } }));
    assert.deepEqual(letterhead.educationLines({ school_name: 'مدرسة', university_name: 'جامعة', college_name: 'كلية', department_name: 'قسم', extra_text: 'سطر' }), ['مدرسة', 'جامعة', 'كلية', 'قسم', 'سطر']);
  });
  test('Renderer مشترك ويحافظ على شكل snapshots القديمة دون layout', () => {
    const h = (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(), appendChild(node) { this.children.push(node); } });
    const legacy = letterhead.renderLetterhead({ ...base, layout: null }, 'logo.png', h);
    assert.equal(legacy.attrs.class, 'exam-letterhead');
    assert.equal(legacy.children[1].children.length, 3);
    const current = letterhead.renderLetterhead(base, 'logo.png', h);
    assert.equal(current.children.length, 3);
    assert.deepEqual(current.children.map((node) => node.attrs.class), ['letterhead-slot slot-right', 'letterhead-slot slot-center', 'letterhead-slot slot-left']);
    for (const name of ['letterheads', 'exam-view']) assert.ok(read(`js/${name}.js`).includes("from './letterhead-utils.js'"));
  });
  test('العبارة الختامية بعد الأسئلة وقبل سطر النظام دون Footer ثابت', () => {
    const source = read('js/exam-view.js');
    assert.ok(source.indexOf('wrapper.appendChild(questionsBlock)') < source.indexOf("class: 'exam-closing'"));
    assert.ok(source.indexOf("class: 'exam-closing'") < source.indexOf("class: 'exam-generated-footer'"));
    assert.match(read('css/style.css'), /\.exam-ending\s*\{\s*position: static;/);
    assert.ok(read('exam-builder.html').includes('تظهر هذه العبارة بعد آخر سؤال في الاختبار'));
    assert.ok(!/id="exam-closing"[^>]*required/.test(read('exam-builder.html')));
  });
  test('الترقية لا توسع RLS أو Storage ولا تمنح أي تعديل مباشر للدور', () => {
    assert.ok(!/create policy|drop policy|alter role|set role|update auth\.users|grant.*on.*profiles/i.test(sql));
    assert.ok(sql.includes('where id = new.id'));
    assert.ok(sql.includes("security definer set search_path = ''"));
    assert.ok(sql.includes('revoke all on function teacher_bank_private.sync_user_display_name() from public, anon, authenticated'));
    assert.ok(!/->>\s*'role'/.test(sql));
    assert.ok(sql.includes('for each row when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)'));
  });
  test('حفظ مواقع الكليشة محكوم بالمالك والقفل ولا يعدل الاختبارات السابقة', () => {
    assert.ok(sql.includes('l.id = new.letterhead_id and l.user_id = auth.uid() for share'));
    assert.ok(sql.includes("pg_catalog.jsonb_build_object('layout', v_layout)"));
    assert.ok(sql.includes('new.sealed or new.integrity_version <> 2'));
    assert.ok(sql.includes('before insert on public.exams'));
    assert.ok(!/update public\.exams/.test(sql));
    assert.ok(sql.includes('letterheads_layout_valid'));
    assert.ok(sql.includes('letterheads_layout_no_overlap'));
  });
  test('قائمة الوحدات محدودة بالمستخدم وRLS دون SECURITY DEFINER', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.get_question_units()'));
    assert.ok(fn.includes("security invoker set search_path = ''"));
    assert.ok(fn.includes('q.user_id = auth.uid()'));
    assert.ok(fn.includes('select distinct q.unit'));
    assert.ok(fn.includes('grant execute on function public.get_question_units() to authenticated'));
  });
  test('المخطط والترقية اللاحقة يحتويان كتلة التغييرات نفسها', () => {
    const block = (text) => text.slice(text.indexOf('-- BEGIN PROFILE LETTERHEAD V1'), text.indexOf('-- END PROFILE LETTERHEAD V1')).replace(/\r\n/g, '\n');
    assert.equal(block(sql), block(fullSchema));
  });
}
