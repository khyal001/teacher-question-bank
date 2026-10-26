// Read-only client helpers. Every admin RPC also authorizes independently in SQL.
export const ADMIN_STAT_FIELDS = Object.freeze([
  ['teacher_count', 'إجمالي المعلمين'],
  ['subject_count', 'إجمالي المواد'],
  ['group_count', 'الصفوف والفصول والأقسام'],
  ['question_count', 'إجمالي الأسئلة'],
  ['exam_count', 'إجمالي الاختبارات'],
  ['letterhead_count', 'قوالب الكليشة'],
]);

export function isAdminRole(role) {
  return role === 'admin';
}

export function adminStatsEntries(stats) {
  return ADMIN_STAT_FIELDS.map(([key, label]) => {
    const value = stats?.[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('تعذر قراءة إحصاءات الإدارة.');
    return { key, label, value };
  });
}

export async function loadAdminData(client, { search = '', sort = 'newest', offset = 0, limit = 25 } = {}) {
  const roleResult = await client.rpc('get_my_role');
  if (roleResult.error) throw roleResult.error;
  if (!isAdminRole(roleResult.data)) {
    const error = new Error('غير مصرح لك بالدخول إلى الإدارة.');
    error.code = '42501';
    throw error;
  }
  const [stats, teachers] = await Promise.all([
    client.rpc('get_admin_stats'),
    client.rpc('get_admin_teachers', { p_search: search, p_sort: sort, p_offset: offset, p_limit: limit }),
  ]);
  if (stats.error) throw stats.error;
  if (teachers.error) throw teachers.error;
  const entries = adminStatsEntries(stats.data);
  if (!Array.isArray(teachers.data?.teachers) || !Number.isSafeInteger(teachers.data?.total)) {
    throw new Error('تعذر قراءة قائمة المعلمين.');
  }
  return { entries, teachers: teachers.data.teachers, total: teachers.data.total };
}
