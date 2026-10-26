// إدارة المواد: إضافة، تعديل، حذف، وعرض عدد الأسئلة.
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

const subjectsList = document.getElementById('subjects-list');
const subjectsCount = document.getElementById('subjects-count');
const dialog = document.getElementById('subject-dialog');
const form = document.getElementById('subject-form');
const nameInput = document.getElementById('subject-name');
const gradeInput = document.getElementById('subject-grade');
const idInput = document.getElementById('subject-id');
const errorBox = document.getElementById('subject-error');
const dialogTitle = document.getElementById('subject-dialog-title');
const saveButton = document.getElementById('save-subject-btn');

let currentUser = null;
let questionCounts = new Map();

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('subjects', currentUser);
  bindEvents();
  await loadSubjects();
}

function bindEvents() {
  document.getElementById('add-subject-btn').addEventListener('click', () => openDialog());
  form.addEventListener('submit', handleSubmit);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  // إغلاق عند النقر على الخلفية المعتمة.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function loadSubjects() {
  const [subjectsResult, questionsResult] = await Promise.all([
    supabase
      .from('subjects')
      .select('id, name, grade_level, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('questions')
      .select('subject_id')
      .eq('user_id', currentUser.id),
  ]);

  if (subjectsResult.error) {
    subjectsCount.textContent = '—';
    renderInlineError(subjectsList, friendlyError(subjectsResult.error));
    return;
  }

  if (questionsResult.error) {
    subjectsCount.textContent = '—';
    renderInlineError(subjectsList, friendlyError(questionsResult.error));
    return;
  }

  questionCounts = new Map();
  for (const row of questionsResult.data || []) {
    questionCounts.set(row.subject_id, (questionCounts.get(row.subject_id) || 0) + 1);
  }

  renderSubjects(subjectsResult.data || []);
}

function renderSubjects(subjects) {
  subjectsCount.textContent = `${subjects.length} مادة`;
  subjectsList.replaceChildren();

  if (subjects.length === 0) {
    renderEmptyState(subjectsList, {
      title: 'لا توجد مواد حتى الآن',
      hint: 'ابدأ بإضافة المادة التي تدرّسها، ثم أضف أسئلتها.',
      action: h(
        'button',
        { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openDialog() },
        'إضافة أول مادة',
      ),
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
        h('th', { scope: 'col', text: 'المادة' }),
        h('th', { scope: 'col', text: 'الصف / المستوى' }),
        h('th', { scope: 'col', text: 'عدد الأسئلة' }),
        h('th', { scope: 'col', text: 'تاريخ الإضافة' }),
        h('th', { scope: 'col', class: 'actions-col', text: 'الإجراءات' }),
      ),
    ),
  );

  const tbody = h('tbody', {});

  for (const subject of subjects) {
    const count = questionCounts.get(subject.id) || 0;

    tbody.appendChild(
      h(
        'tr',
        {},
        h(
          'td',
          { dataset: { label: 'المادة' } },
          h('strong', { class: 'cell-title', text: subject.name }),
        ),
        h('td', { dataset: { label: 'الصف / المستوى' }, text: subject.grade_level || '—' }),
        h(
          'td',
          { dataset: { label: 'عدد الأسئلة' } },
          h(
            'a',
            {
              class: 'count-link',
              href: `./questions.html?subject=${encodeURIComponent(subject.id)}`,
              title: 'عرض أسئلة هذه المادة',
            },
            `${count} سؤال`,
          ),
        ),
        h('td', { dataset: { label: 'تاريخ الإضافة' }, text: formatDate(subject.created_at, true) }),
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
                onclick: () => openDialog(subject),
              },
              'تعديل',
            ),
            h(
              'button',
              {
                class: 'btn btn-danger-ghost btn-sm',
                type: 'button',
                onclick: () => confirmDelete(subject, count),
              },
              'حذف',
            ),
          ),
        ),
      ),
    );
  }

  table.appendChild(tbody);
  subjectsList.appendChild(h('div', { class: 'table-wrap' }, table));
}

function openDialog(subject = null) {
  const isEdit = Boolean(subject);

  idInput.value = subject?.id || '';
  nameInput.value = subject?.name || '';
  gradeInput.value = subject?.grade_level || '';
  dialogTitle.textContent = isEdit ? 'تعديل المادة' : 'إضافة مادة';
  saveButton.textContent = isEdit ? 'حفظ التعديلات' : 'حفظ المادة';
  showFormError(errorBox, '');

  dialog.showModal();
  nameInput.focus();
}

async function handleSubmit(event) {
  event.preventDefault();
  showFormError(errorBox, '');

  const name = nameInput.value.trim();
  const grade = gradeInput.value.trim();
  const editingId = idInput.value;

  if (!name) {
    showFormError(errorBox, 'اسم المادة مطلوب.');
    nameInput.focus();
    return;
  }

  if (!grade) {
    showFormError(errorBox, 'الصف الدراسي مطلوب. أدخل الصف أو المستوى قبل حفظ المادة.');
    gradeInput.focus();
    return;
  }

  setButtonBusy(saveButton, true, editingId ? 'جارٍ حفظ التعديلات...' : 'جارٍ حفظ المادة...');

  try {
    // لا نرسل user_id إطلاقاً؛ قاعدة البيانات تضبطه من الجلسة.
    const payload = { name, grade_level: grade };

    const result = editingId
      ? await supabase.from('subjects').update(payload).eq('id', editingId).select('id')
      : await supabase.from('subjects').insert(payload).select('id');

    if (result.error) throw result.error;

    if (editingId && (!result.data || result.data.length === 0)) {
      throw new Error('لم يتم العثور على المادة أو لا تملك صلاحية تعديلها.');
    }

    dialog.close();
    toast(editingId ? 'تم حفظ تعديلات المادة.' : 'تمت إضافة المادة بنجاح.');
    await loadSubjects();
  } catch (error) {
    showFormError(errorBox, friendlyError(error));
  } finally {
    setButtonBusy(saveButton, false);
    saveButton.textContent = idInput.value ? 'حفظ التعديلات' : 'حفظ المادة';
  }
}

async function confirmDelete(subject, count) {
  const message = [
    `هل تريد حذف مادة «${subject.name}»؟`,
    '',
    `سيتم حذف ${count} سؤالاً تابعة لها من بنك الأسئلة.`,
    'الاختبارات المحفوظة سابقاً لن تتأثر وستبقى كما هي.',
    '',
    'لا يمكن التراجع عن هذا الإجراء.',
  ].join('\n');

  if (!window.confirm(message)) return;

  try {
    const { error } = await supabase.from('subjects').delete().eq('id', subject.id);
    if (error) throw error;

    toast('تم حذف المادة وأسئلتها من بنك الأسئلة.');
    await loadSubjects();
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}
