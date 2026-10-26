import { fetchAll } from './data-utils.js';
// إدارة الصفوف والفصول والأقسام المستقلة عن المواد.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  formatDate,
  friendlyError,
  h,
  renderEmptyState,
  renderInlineError,
  setButtonBusy,
  showFormError,
  toast,
} from './ui.js';

const addForm = document.getElementById('add-group-form');
const nameInput = document.getElementById('group-name');
const addButton = document.getElementById('add-group-btn');
const addError = document.getElementById('group-error');
const groupsList = document.getElementById('groups-list');
const groupsCount = document.getElementById('groups-count');

const editDialog = document.getElementById('edit-group-dialog');
const editForm = document.getElementById('edit-group-form');
const editId = document.getElementById('edit-group-id');
const editName = document.getElementById('edit-group-name');
const editError = document.getElementById('edit-group-error');
const editButton = document.getElementById('save-group-btn');

let currentUser = null;
let groups = [];
let subjectCounts = new Map();
let questionCounts = new Map();

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('groups', currentUser);
  bindEvents();
  await loadGroups();
}

function bindEvents() {
  addForm.addEventListener('submit', handleAdd);

  editForm.addEventListener('submit', handleEdit);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => editDialog.close());
  });

  editDialog.addEventListener('click', (event) => {
    if (event.target === editDialog) editDialog.close();
  });
}

async function loadGroups() {
  const [groupsResult, subjectLinksResult, questionLinksResult] = await Promise.all([
    fetchAll(supabase
      .from('teaching_groups')
      .select('id, name, created_at')
      .eq('user_id', currentUser.id)
      .order('name', { ascending: true }), ['id']),
    fetchAll(supabase
      .from('subject_groups')
      .select('group_id')
      .eq('user_id', currentUser.id), ['subject_id', 'group_id']),
    fetchAll(supabase
      .from('question_groups')
      .select('group_id')
      .eq('user_id', currentUser.id), ['question_id', 'group_id']),
  ]);

  const firstError = [groupsResult, subjectLinksResult, questionLinksResult]
    .find((result) => result.error)?.error;

  if (firstError) {
    groupsCount.textContent = '—';
    renderInlineError(groupsList, friendlyError(firstError));
    return;
  }

  groups = groupsResult.data || [];

  subjectCounts = new Map();
  for (const row of subjectLinksResult.data || []) {
    subjectCounts.set(row.group_id, (subjectCounts.get(row.group_id) || 0) + 1);
  }

  questionCounts = new Map();
  for (const row of questionLinksResult.data || []) {
    questionCounts.set(row.group_id, (questionCounts.get(row.group_id) || 0) + 1);
  }

  renderGroups();
}

function renderGroups() {
  groupsCount.textContent = `${groups.length} خيار`;
  groupsList.replaceChildren();

  if (groups.length === 0) {
    renderEmptyState(groupsList, {
      title: 'لا توجد صفوف وفصول وأقسام بعد',
      hint: 'أضف صفًا أو فصلًا أو قسمًا، مثل «الأول الثانوي - أ» أو «قسم الشريعة - المستوى الأول»، ثم اربطه بموادك.',
    });
    return;
  }

  const table = h(
    'table',
    { class: 'data-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col', text: 'الصف / الفصل / القسم' }),
        h('th', { scope: 'col', text: 'المواد المرتبطة' }),
        h('th', { scope: 'col', text: 'الأسئلة المحددة' }),
        h('th', { scope: 'col', text: 'تاريخ الإضافة' }),
        h('th', { scope: 'col', class: 'actions-col', text: 'الإجراءات' }),
      ),
    ),
  );

  const tbody = h('tbody', {});

  for (const group of groups) {
    const subjects = subjectCounts.get(group.id) || 0;
    const questions = questionCounts.get(group.id) || 0;

    tbody.appendChild(
      h(
        'tr',
        {},
        h(
          'td',
          { dataset: { label: 'الصف / الفصل / القسم' } },
          h('strong', { class: 'cell-title', text: group.name }),
        ),
        h('td', { dataset: { label: 'المواد المرتبطة' }, text: `${subjects} مادة` }),
        h('td', { dataset: { label: 'الأسئلة المحددة' }, text: `${questions} سؤال` }),
        h('td', { dataset: { label: 'تاريخ الإضافة' }, text: formatDate(group.created_at, true) }),
        h(
          'td',
          { dataset: { label: 'الإجراءات' } },
          h(
            'div',
            { class: 'row-actions' },
            h(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onclick: () => openEdit(group),
              },
              'تعديل',
            ),
            h(
              'button',
              {
                class: 'btn btn-danger-ghost btn-sm',
                type: 'button',
                onclick: () => confirmDelete(group, subjects, questions),
              },
              'حذف',
            ),
          ),
        ),
      ),
    );
  }

  table.appendChild(tbody);
  groupsList.appendChild(h('div', { class: 'table-wrap' }, table));
}

async function handleAdd(event) {
  event.preventDefault();
  showFormError(addError, '');

  const name = nameInput.value.trim();

  if (!name) {
    showFormError(addError, 'اسم الصف / الفصل / القسم مطلوب.');
    nameInput.focus();
    return;
  }

  setButtonBusy(addButton, true, 'جارٍ الإضافة...');

  try {
    // user_id يُضبط من الجلسة في قاعدة البيانات، وRLS يتحقق منه.
    const { error } = await supabase.from('teaching_groups').insert({ name });
    if (error) throw error;

    nameInput.value = '';
    toast('أضيف الصف / الفصل / القسم.');
    await loadGroups();
    nameInput.focus();
  } catch (error) {
    showFormError(addError, groupError(error));
  } finally {
    setButtonBusy(addButton, false);
  }
}

function openEdit(group) {
  editId.value = group.id;
  editName.value = group.name;
  showFormError(editError, '');
  editDialog.showModal();
  editName.focus();
  editName.select();
}

async function handleEdit(event) {
  event.preventDefault();
  showFormError(editError, '');

  const id = editId.value;
  const name = editName.value.trim();

  if (!name) {
    showFormError(editError, 'اسم الصف / الفصل / القسم مطلوب.');
    editName.focus();
    return;
  }

  setButtonBusy(editButton, true, 'جارٍ الحفظ...');

  try {
    const { data, error } = await supabase
      .from('teaching_groups')
      .update({ name })
      .eq('id', id)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('لم يتم العثور على الصف / الفصل / القسم أو لا تملك صلاحية تعديله.');
    }

    editDialog.close();
    toast('تم حفظ تعديلات الصف / الفصل / القسم.');
    await loadGroups();
  } catch (error) {
    showFormError(editError, groupError(error));
  } finally {
    setButtonBusy(editButton, false);
  }
}

async function confirmDelete(group, subjects, questions) {
  const message = [
    `هل تريد حذف صف / فصل / قسم «${group.name}»؟`,
    '',
    `ستُحذف ارتباطاتها بـ ${subjects} مادة، وبـ ${questions} سؤالاً محدداً لها.`,
    'لن تُحذف المواد أو الأسئلة نفسها، لكن الأسئلة المحددة لهذا الخيار فقط ستبقى بلا صف / فصل / قسم.',
    'الاختبارات المحفوظة سابقاً لن تتأثر.',
    '',
    'لا يمكن التراجع عن هذا الإجراء.',
  ].join('\n');

  if (!window.confirm(message)) return;

  try {
    const { error } = await supabase.from('teaching_groups').delete().eq('id', group.id);
    if (error) throw error;

    toast('تم حذف الصف / الفصل / القسم وارتباطاته.');
    await loadGroups();
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

function groupError(error) {
  if (String(error?.code || '') === '23505') {
    return 'يوجد صف / فصل / قسم بالاسم نفسه. اختر اسمًا مختلفاً.';
  }
  return friendlyError(error);
}
