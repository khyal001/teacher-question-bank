import assert from 'node:assert/strict';

export async function runAdminTests({ test, testAsync, read, fullSchema, migration }) {
  const load = (file) => import(`data:text/javascript;base64,${Buffer.from(read(file)).toString('base64')}`);
  const admin = await load('js/admin-utils.js');
  const targets = await load('js/teaching-targets.js');
  const sql = read('supabase/migrations/20261027_admin_roles.sql');
  const fn = (name) => sql.match(new RegExp(`create or replace function (?:public|teacher_bank_private)\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0] || '';
  const stats = { teacher_count: 2, subject_count: 7, group_count: 3, question_count: 19, exam_count: 5, letterhead_count: 4 };

  test('Teacher لا يعتبر Admin، والـmetadata والكائنات لا تمنح دورًا', () => {
    assert.equal(admin.isAdminRole('teacher'), false);
    assert.equal(admin.isAdminRole(null), false);
    assert.equal(admin.isAdminRole({ role: 'admin' }), false);
    assert.equal(admin.isAdminRole('ADMIN'), false);
    assert.equal(admin.isAdminRole('admin'), true);
  });
  await testAsync('Teacher لا يطلب بيانات الإدارة من الواجهة', async () => {
    const calls = [];
    const client = { rpc: async (name) => { calls.push(name); return { data: 'teacher', error: null }; } };
    await assert.rejects(admin.loadAdminData(client), (error) => error.code === '42501');
    assert.deepEqual(calls, ['get_my_role']);
  });
  await testAsync('Admin يستدعي RPCs المحدودة ويحصل على الأعداد دون خلطها', async () => {
    const calls = [];
    const client = { rpc: async (name, params) => {
      calls.push([name, params]);
      return { error: null, data: name === 'get_my_role' ? 'admin' : name === 'get_admin_stats' ? stats : { teachers: [{ display_name: 'معلم', question_count: 19 }], total: 1 } };
    } };
    const result = await admin.loadAdminData(client, { search: 'معلم', sort: 'questions', offset: 25, limit: 25, role: 'admin' });
    assert.deepEqual(result.entries.map((entry) => entry.value), [2, 7, 3, 19, 5, 4]);
    assert.equal(result.teachers.length, 1);
    assert.deepEqual(calls.map(([name]) => name), ['get_my_role', 'get_admin_stats', 'get_admin_teachers']);
    assert.deepEqual(calls[2][1], { p_search: 'معلم', p_sort: 'questions', p_offset: 25, p_limit: 25 });
    assert.ok(!('role' in calls[2][1]));
  });
  await testAsync('فشل التحقق من الدور يمنع تحميل البيانات', async () => {
    let calls = 0;
    await assert.rejects(admin.loadAdminData({ rpc: async () => { calls++; return { error: new Error('offline') }; } }), /offline/);
    assert.equal(calls, 1);
  });
  await testAsync('رفض RPC إداري بعد فحص الدور لا يعرض بيانات جزئية', async () => {
    const client = { rpc: async (name) => name === 'get_my_role' ? { data: 'admin' } : { error: new Error('revoked') } };
    await assert.rejects(admin.loadAdminData(client), /revoked/);
  });
  test('الإحصاءات المفقودة أو غير الصالحة لا تتحول إلى أصفار وهمية', () => {
    assert.throws(() => admin.adminStatsEntries({}));
    assert.throws(() => admin.adminStatsEntries({ ...stats, exam_count: -1 }));
    assert.throws(() => admin.adminStatsEntries({ ...stats, teacher_count: '2' }));
  });
  test('الخيار الوحيد يحدد تلقائيًا دون إخفاء اسمه', () => {
    const groups = [{ id: 'a', name: 'الأول الثانوي - أ' }];
    const selection = targets.teachingTargetSelection(groups);
    assert.equal(selection.mode, 'single');
    assert.deepEqual(selection.selectedIds, ['a']);
    assert.equal(groups[0].name, 'الأول الثانوي - أ');
    const builder = read('js/exam-builder.js');
    assert.ok(builder.includes("checkbox.disabled = selection.mode === 'single'"));
    assert.ok(builder.includes('تم اختيار «${groups[0].name}» تلقائيًا'));
    assert.ok(builder.includes('selection.selectedIds.includes(group.id)'));
  });
  test('تعدد الخيارات يبقي التحكم بالاختيار متاحًا', () => {
    const selection = targets.teachingTargetSelection([{ id: 'a' }, { id: 'b' }]);
    assert.equal(selection.mode, 'multiple');
    assert.deepEqual(selection.selectedIds, ['a', 'b']);
    assert.equal(selection.error, '');
  });
  test('عدم وجود خيارات يمنع إنشاء الاختبار برسالة تطلب الإضافة', () => {
    const selection = targets.teachingTargetSelection([]);
    assert.equal(selection.mode, 'none');
    assert.deepEqual(selection.selectedIds, []);
    assert.ok(selection.error.includes('قبل إنشاء الاختبار'));
    const builder = read('js/exam-builder.js');
    assert.ok(builder.includes('showFormError(errorBox, NO_TEACHING_TARGET)'));
    assert.ok(builder.includes("disabled = !subjectId || selection.mode === 'none'"));
    assert.ok(migration.includes(') or coalesce(cardinality(p_group_ids), 0) = 0 then'));
  });
  test('الاختيار التلقائي لا يبدل نطاق all التاريخي إلى selected', () => {
    const questions = read('js/questions.js');
    assert.ok(questions.includes("const desiredScope = question?.group_scope || 'selected'"));
    assert.ok(questions.includes('checkbox.checked = selectedIds.has(group.id) || groups.length === 1'));
    assert.ok(questions.includes('أي صف / فصل / قسم يضاف للمادة مستقبلًا'));
    assert.ok(read('js/subjects.js').includes('selectedIds.has(group.id) || allGroups.length === 1'));
    assert.ok(read('js/share-import.js').includes('existingSelect.disabled = recipientGroups.length === 1'));
  });
  test('رابط Admin غير ثابت في صفحات المعلمين ويُنشأ بعد تحقق الدور فقط', () => {
    for (const page of ['index', 'dashboard', 'subjects', 'groups', 'questions', 'exam-builder', 'exam-view', 'letterheads', 'share-import']) {
      assert.ok(!/href=["'][^"']*admin\.html/i.test(read(`${page}.html`)), page);
    }
    assert.ok(read('js/auth.js').includes('rolePromise ?? navigationRole(supabase)'));
    assert.ok(read('js/auth.js').includes("if (role !== 'admin') { existing?.remove(); return; }"));
    assert.ok(read('admin.html').includes('id="admin-content" hidden'));
    assert.ok(read('js/admin.js').includes('await requireAuth()'));
    assert.ok(read('js/admin.js').includes('stats.replaceChildren();'));
  });
  test('النصوص الظاهرة تستخدم الصفوف والفصول والأقسام بدل المصطلح الداخلي', () => {
    for (const name of ['index', 'dashboard', 'subjects', 'groups', 'questions', 'exam-builder', 'exam-view', 'letterheads', 'share-import', 'admin']) {
      assert.ok(!/مجموعة|مجموعات|مجموعتك/.test(read(`${name}.html`)), `${name}.html`);
    }
    for (const name of ['subjects', 'groups', 'questions', 'exam-builder', 'exam-view', 'share-import', 'ui', 'teaching-targets', 'admin', 'admin-utils']) {
      assert.ok(!/مجموعة|مجموعات|مجموعتك/.test(read(`js/${name}.js`)), `${name}.js`);
    }
    assert.ok(!/مجموعة|مجموعات|مجموعتك/.test(read('README.md')));
    assert.ok(read('groups.html').includes('قسم الشريعة - المستوى الأول'));
    assert.ok(read('groups.html').includes('قسم اللغة العربية - المستوى الأول'));
    assert.ok(fullSchema.includes('public.teaching_groups'));
  });

  // Static SQL authorization contracts; these are not live RLS tests.
  test('Profiles خاص وRLS بلا سياسات عميل ولا صلاحية تغيير الدور', () => {
    assert.ok(sql.includes('create table if not exists teacher_bank_private.profiles'));
    assert.ok(sql.includes("role text not null default 'teacher' check (role in ('teacher', 'admin'))"));
    assert.ok(sql.includes('alter table teacher_bank_private.profiles enable row level security'));
    assert.ok(sql.includes('revoke all on schema teacher_bank_private from public, anon, authenticated'));
    assert.ok(sql.includes('revoke all on teacher_bank_private.profiles from public, anon, authenticated'));
    assert.ok(!/create policy|grant\s+(?:select|insert|update|delete)[\s\S]*?on teacher_bank_private\.profiles/i.test(sql));
    assert.ok(!/grant[\s\S]*?on auth\.users/i.test(sql));
  });
  test('بيانات التسجيل لا تستطيع تعيين Admin والحسابات القائمة لا تتغير أدوارها', () => {
    const create = fn('create_user_profile');
    assert.ok(create.includes("values (new.id, 'teacher'"));
    assert.ok(!/->>\s*'role'|raw_app_meta_data|'admin'/.test(create));
    assert.ok(create.includes('on conflict (id) do nothing'));
    assert.ok(sql.includes("select u.id, 'teacher'"));
    assert.ok(!/set role\s*=\s*'admin'/i.test(sql));
  });
  test('كل RPC إداري يتحقق من الدور داخل الخادم قبل قراءة البيانات', () => {
    const require = fn('require_admin');
    assert.ok(require.includes('auth.uid() is null'));
    assert.ok(require.includes("p.id = auth.uid() and p.role = 'admin'"));
    assert.ok(require.includes("errcode = '42501'"));
    for (const name of ['get_admin_stats', 'get_admin_teachers']) {
      const body = fn(name);
      assert.ok(body.includes('security definer'));
      assert.ok(body.includes("set search_path = ''"));
      assert.ok(body.indexOf('perform teacher_bank_private.require_admin()') < body.indexOf(name === 'get_admin_stats' ? 'return jsonb_build_object' : 'with filtered'));
    }
    assert.ok(fn('get_my_role').includes('where p.id = auth.uid()'));
    assert.ok(sql.includes('revoke all on function public.get_admin_stats() from public, anon, authenticated'));
    assert.ok(sql.includes('grant execute on function public.get_admin_stats() to authenticated'));
  });
  test('الإحصاءات مستقلة وقائمة المعلمين لا تكشف أسرار Auth', () => {
    const statistics = fn('get_admin_stats');
    for (const table of ['subjects', 'teaching_groups', 'questions', 'exams', 'letterheads']) {
      assert.ok(statistics.includes(`(select count(*) from public.${table})`), table);
    }
    assert.ok(statistics.includes("profiles where role = 'teacher'"));
    const list = fn('get_admin_teachers');
    for (const alias of ['s', 'g', 'q', 'e', 'l']) assert.ok(list.includes(`${alias}.user_id = f.id`));
    assert.ok(list.includes('u.email_confirmed_at'));
    assert.ok(list.includes('u.last_sign_in_at'));
    assert.ok(!/encrypted_password|confirmation_token|recovery_token|raw_user_meta_data|select u\.\*/.test(list));
  });
  test('البحث والترتيب والصفحات مقيدة ولا SQL ديناميكي في الإدارة', () => {
    const list = fn('get_admin_teachers');
    assert.ok(list.includes("p_sort not in ('newest','questions','exams')"));
    assert.ok(list.includes('p_limit > 100'));
    assert.ok(list.includes('p_offset < 0'));
    assert.ok(list.includes('strpos(lower(p.display_name), v_search)'));
    assert.ok(list.includes('t.created_at desc, t.id'));
    assert.ok(!/\bexecute\b/i.test(list));
  });
  test('المخطط الكامل يتضمن نفس كتلة الأدوار في الترقية اللاحقة', () => {
    const block = (text) => text.slice(text.indexOf('-- BEGIN ADMIN ROLES V1'), text.indexOf('-- END ADMIN ROLES V1')).replace(/\r\n/g, '\n');
    assert.equal(block(fullSchema), block(sql));
    assert.ok(sql.includes('Unknown admin RPC overloads require review'));
    assert.ok(sql.includes('Profiles must have no client policies'));
    assert.ok(migration.includes("'get_my_role','get_admin_stats','get_admin_teachers'"));
  });
  test('تعيين أول Admin مثال منفصل بمعرف صريح ولا ينفذ تلقائيًا', () => {
    const example = read('supabase/assign_first_admin.example.sql');
    assert.ok(example.includes('MANUAL EXAMPLE ONLY'));
    assert.ok(example.includes("v_user_id uuid := '00000000-0000-0000-0000-000000000000'"));
    assert.ok(example.includes("set role = 'admin', updated_at = now()"));
    assert.ok(example.includes('where id = v_user_id'));
    assert.ok(!example.includes('@'));
    assert.ok(!fullSchema.includes("set role = 'admin'"));
  });
}
