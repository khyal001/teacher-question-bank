// Offline fake used only by browser checks; no network or database connection.
function installMock() {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'teacher@example.invalid', user_metadata: { full_name: 'المعلم التجريبي' } };
  const questions = Array.from({ length: 53 }, (_, i) => ({
    id: `q-${String(i).padStart(3, '0')}`, subject_id: 'subject-1', unit: i % 2 ? 'باب الجبر' : 'Chapter 2',
    type: 'short', question_text: `سؤال تجريبي ${i + 1}`, options: null, correct_answer: 'إجابة', difficulty: 'easy',
    group_scope: 'selected', created_at: '2026-10-26T00:00:00Z', question_groups: [{ group_id: 'group-1' }],
  }));
  const letterhead = { id: 'letterhead-1', name: 'اسم داخلي', entity_name: 'وزارة التعليم', school_name: 'جامعة طيبة',
    university_name: null, college_name: null, department_name: 'قسم الهندسة', extra_text: 'اختبار محلي',
    logo_path: null, layout: { logo: 'center', entity: 'right', education: 'left' }, created_at: '2026-10-26T00:00:00Z' };
  const tables = {
    subjects: [{ id: 'subject-1', name: 'الرياضيات' }, { id: 'subject-2', name: 'الفيزياء' }], teaching_groups: [{ id: 'group-1', name: 'الأول الثانوي' }, { id: 'group-2', name: 'الثاني الثانوي' }],
    subject_groups: [{ subject_id: 'subject-1', group_id: 'group-1' }, { subject_id: 'subject-2', group_id: 'group-2' }], questions, letterheads: [letterhead],
    exams: [{ id: 'exam-1', title: 'اختبار تجريبي', subject_name_snapshot: 'الرياضيات', grade_level_snapshot: 'صف قديم',
      subject_id: 'subject-1', sealed: true, group_ids_snapshot: ['group-1'], total_points: 3, group_names_snapshot: ['الأول الثانوي'], letterhead_snapshot: letterhead, closing_phrase: 'انتهت الأسئلة', created_at: '2026-10-26T00:00:00Z' }],
    exam_questions: questions.slice(0, 3).map((q, i) => ({ id: `eq-${i}`, question_id: q.id, position: i + 1, snapshot: { ...q, points: 1, layout: 'auto' } })),
  };
  window.__calls = [];
  window.__tables = tables;
  window.__role = 'teacher';
  window.__mockSupabase = {
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      updateUser: async ({ data }) => { window.__updatedMetadata = data; Object.assign(user.user_metadata, data); return { data: { user }, error: null }; },
      signOut: async () => ({ error: null }),
    },
    rpc: async (name, params) => {
      const call = { rpc: name, params, at: performance.now() };
      window.__calls.push(call);
      try {
      const delay = window.__searchDelays?.[params?.p_search] ?? window.__delayMs ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (name === 'get_questions_page') {
        if (window.__pageFailure) return { error: { message: 'offline' }, data: null };
        const subject = tables.subjects.some((row) => row.id === params.p_subject_id) ? params.p_subject_id : null;
        const rows = tables.questions.filter((q) => (!subject || q.subject_id === subject)
          && (!params.p_difficulty || q.difficulty === params.p_difficulty)
          && (!params.p_type || q.type === params.p_type) && (!params.p_unit || q.unit === params.p_unit)
          && (!params.p_search || `${q.question_text} ${q.unit || ''}`.toLowerCase().includes(params.p_search.toLowerCase())));
        return { error: null, data: { questions: rows.slice(params.p_offset, params.p_offset + params.p_limit).map((q) => ({ ...q,
          question_groups: q.question_groups.map((g) => ({ ...g, name: tables.teaching_groups.find((row) => row.id === g.group_id)?.name })) })),
          total: rows.length, subject_id: subject, metadata: params.p_include_metadata ? { subjects: tables.subjects,
            units: [...new Set(tables.questions.map((q) => q.unit).filter(Boolean))], role: window.__role } : null } };
      }
      if (['get_subjects_page', 'get_exams_page', 'get_letterheads_page'].includes(name)) {
        const table = name.slice(4, -5);
        const all = tables[table];
        const items = all.slice(params.p_offset, params.p_offset + params.p_limit).map((row) => table === 'subjects' ? { ...row,
          groups: tables.subject_groups.filter((link) => link.subject_id === row.id).map((link) => tables.teaching_groups.find((g) => g.id === link.group_id)),
          question_count: tables.questions.filter((q) => q.subject_id === row.id).length,
        } : row);
        return { data: { items, total: all.length, metadata: params.p_include_metadata ? { role: window.__role } : null }, error: null };
      }
      if (name === 'get_exam_source') {
        return { data: { exam: tables.exams.find((row) => row.id === params.p_exam_id), questions: tables.exam_questions }, error: null };
      }
      if (name === 'save_exam' || name === 'save_exam_revision') {
        window.__savedPayload = structuredClone(params);
        return { data: null, error: { message: 'توقف مقصود للاختبار المحلي قبل الانتقال؛ لم يتم الحفظ على أي خادم.' } };
      }
      return { data: name === 'get_my_role' ? window.__role : name === 'get_question_units' ? ['باب الجبر', 'Chapter 2'] : null, error: null };
      } finally { call.finishedAt = performance.now(); }
    },
    storage: { from: () => ({
      createSignedUrl: async (path) => {
        const call = { storage: 'sign', paths: [path], at: performance.now() }; window.__calls.push(call);
        await new Promise((resolve) => setTimeout(resolve, window.__logoDelayMs ?? window.__delayMs ?? 0));
        call.finishedAt = performance.now();
        return { data: { signedUrl: '/favicon.svg' }, error: null };
      },
      createSignedUrls: async (paths) => {
        const call = { storage: 'signMany', paths, at: performance.now() }; window.__calls.push(call);
        await new Promise((resolve) => setTimeout(resolve, window.__logoDelayMs ?? window.__delayMs ?? 0));
        call.finishedAt = performance.now();
        return { data: paths.map((path) => ({ path, signedUrl: '/favicon.svg' })), error: null };
      },
    }) },
    from(table) {
      let predicates = [];
      let counted = false;
      let search = '';
      const rows = () => (tables[table] || []).filter((row) => predicates.every(([key, value]) => key === 'user_id' || key === 'exam_id' || row[key] === value))
        .filter((row) => !search || `${row.question_text} ${row.unit}`.includes(search));
      const query = {
        select(columns, options) { counted = options?.count === 'exact'; return this; },
        eq(key, value) { predicates.push([key, value]); return this; },
        order() { return this; },
        or(value) { search = value.match(/ilike\."%([^%]*)%"/)?.[1] || ''; return this; },
        async range(start, end) {
          const call = { table, start, end, predicates: [...predicates], at: performance.now() };
          window.__calls.push(call);
          const subject = predicates.find(([key]) => key === 'subject_id')?.[1];
          const delay = window.__editorDelays?.[subject] ?? window.__delayMs ?? 0;
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          const all = rows().map((row) => table === 'subject_groups' ? { ...row, teaching_groups: tables.teaching_groups.find((g) => g.id === row.group_id) } : row);
          call.finishedAt = performance.now();
          return { data: all.slice(start, end + 1), count: counted ? all.length : null, error: null };
        },
        async maybeSingle() { window.__calls.push({ table }); return { data: rows()[0] || null, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
  window.print = () => { window.__printed = true; };
}

module.exports = { installMock };
