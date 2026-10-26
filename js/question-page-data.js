// One round trip for a visible page. Identity always comes from auth.uid() in SQL.
export async function requestQuestionPage(client, filters, { offset = 0, limit = 25, metadata = false } = {}) {
  const { data, error } = await client.rpc('get_questions_page', {
    p_subject_id: filters.subject || null,
    p_difficulty: filters.difficulty || null,
    p_type: filters.type || null,
    p_unit: filters.unit || null,
    p_search: filters.search || '',
    p_offset: offset,
    p_limit: limit,
    p_include_metadata: metadata,
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.questions) || data.questions.length > limit
      || !Number.isSafeInteger(data.total) || data.total < data.questions.length
      || (metadata && (!Array.isArray(data.metadata?.subjects) || !Array.isArray(data.metadata?.units)
        || !['teacher', 'admin'].includes(data.metadata?.role)))) {
    throw new Error('تعذر قراءة بيانات صفحة الأسئلة.');
  }
  return data;
}
