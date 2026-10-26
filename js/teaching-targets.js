// UI terminology only. Database identifiers remain teaching_groups/group_id.
export const NO_TEACHING_TARGET = 'أضف صفًا / فصلًا / قسمًا واربطه بهذه المادة من صفحة المواد قبل إنشاء الاختبار.';

export function teachingTargetSelection(groups) {
  return {
    mode: groups.length === 0 ? 'none' : groups.length === 1 ? 'single' : 'multiple',
    selectedIds: groups.map((group) => group.id),
    error: groups.length === 0 ? NO_TEACHING_TARGET : '',
  };
}
