import { fetchAll } from './data-utils.js';
import { requestQuestionPage } from './question-page-data.js';
// إدارة الأسئلة: إضافة، تعديل، نسخ، حذف، وفلترة مع نطاق صفوف وفصول وأقسام.
import { supabase } from './supabase.js';
import { applyNavigationRole, initNav, requireAuth } from './auth.js';
import {
  DIFFICULTY_LABELS,
  GROUP_SCOPE_LABELS,
  TYPE_LABELS,
  answerDisplay,
  formatDate,
  friendlyError,
  h,
  renderEmptyState,
  renderInlineError,
  setButtonBusy,
  showFormError,
  toast,
} from './ui.js';

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const questionsList = document.getElementById('questions-list');
const questionsCount = document.getElementById('questions-count');
const questionsSummary = document.getElementById('questions-summary');
const filtersForm = document.getElementById('filters-form');
const filterSubject = document.getElementById('filter-subject');
const filterDifficulty = document.getElementById('filter-difficulty');
const filterType = document.getElementById('filter-type');
const filterUnit = document.getElementById('filter-unit');
const filterSearch = document.getElementById('filter-search');

const dialog = document.getElementById('question-dialog');
const form = document.getElementById('question-form');
const dialogTitle = document.getElementById('question-dialog-title');
const idInput = document.getElementById('question-id');
const subjectSelect = document.getElementById('question-subject');
const unitInput = document.getElementById('question-unit');
const typeSelect = document.getElementById('question-type');
const difficultySelect = document.getElementById('question-difficulty');
const textInput = document.getElementById('question-text');
const errorBox = document.getElementById('question-error');
const saveButton = document.getElementById('save-question-btn');

const questionGroupsList = document.getElementById('question-groups');
const questionGroupsHint = document.getElementById('question-groups-hint');

const mcqFields = document.getElementById('mcq-fields');
const trueFalseFields = document.getElementById('true-false-fields');
const shortFields = document.getElementById('short-fields');
const optionsList = document.getElementById('options-list');
const addOptionButton = document.getElementById('add-option-btn');
const shortAnswerInput = document.getElementById('short-answer');

let currentUser = null;
let subjects = [];
const groupsById = new Map();
const editorGroups = new Map();
const editorRequests = new Map();
let editorVersion = 0;
let editorLoading = false;
let metadataLoaded = false;
let questionGroups = new Map();
let allQuestions = [];
let editingId = null;
let loadToken = 0;
let searchTimer = null;
const pageSize = 25;
let offset = 0;
const previousPage = document.getElementById('questions-prev');
const nextPage = document.getElementById('questions-next');
const pageLabel = document.getElementById('questions-page');

const filters = {
  subject: '',
  difficulty: '',
  type: '',
  unit: '',
  search: '',
};

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  applyUrlFilters();
  const firstPage = requestQuestionPage(supabase, filters, { limit: pageSize, metadata: true });
  initNav('questions', currentUser, { rolePromise: firstPage.then((page) => page.metadata.role) });
  bindEvents();
  if (await loadQuestions(false, firstPage)) await handleUrlActions();

  try {
    const flash = window.sessionStorage.getItem('questionsFlash');
    if (flash) {
      window.sessionStorage.removeItem('questionsFlash');
      toast(flash);
    }
  } catch {
    // التخزين المؤقت غير متاح؛ لا يؤثر في تحميل الصفحة.
  }
}

// ------------------------------------------------------------
// البيانات
// ------------------------------------------------------------
function applyPageMetadata(metadata) {
  subjects = metadata.subjects;
  fillSubjectSelect(filterSubject, true);
  fillSubjectSelect(subjectSelect, false);
  filterSubject.value = filters.subject;
  const units = [...new Set(metadata.units.map((unit) => String(unit).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ar'));
  filterUnit.replaceChildren(h('option', { value: '' }, 'كل الوحدات والأبواب والفصول'),
    ...units.map((unit) => h('option', { value: unit }, unit)));
  filterUnit.value = filters.unit;
  applyNavigationRole(metadata.role);
  metadataLoaded = true;
}

async function ensureEditorGroups(subjectId) {
  if (editorGroups.has(subjectId)) return editorGroups.get(subjectId);
  if (!editorRequests.has(subjectId)) {
    editorRequests.set(subjectId, fetchAll(supabase.from('subject_groups')
      .select('group_id, teaching_groups(id, name)', { count: 'exact' })
      .eq('subject_id', subjectId).eq('user_id', currentUser.id), ['group_id'])
      .then(({ data, error }) => {
        if (error) throw error;
        const groups = (data || []).flatMap((row) => row.teaching_groups ? [row.teaching_groups] : []);
        editorGroups.set(subjectId, groups);
        for (const group of groups) groupsById.set(group.id, group);
        return groups;
      }).finally(() => editorRequests.delete(subjectId)));
  }
  return editorRequests.get(subjectId);
}

async function loadDialogGroups(question = null) {
  const version = ++editorVersion;
  const subjectId = subjectSelect.value;
  editorLoading = true;
  saveButton.disabled = true;
  form.querySelectorAll('input[name="group-scope"]').forEach((radio) => { radio.disabled = true; });
  questionGroupsList.replaceChildren();
  questionGroupsHint.textContent = 'جارٍ تحميل الصفوف والفصول والأقسام للمادة...';
  try {
    await ensureEditorGroups(subjectId);
    if (version !== editorVersion || !dialog.open || subjectId !== subjectSelect.value) return;
    renderGroupScope(question);
    saveButton.disabled = false;
  } catch (error) {
    if (version !== editorVersion || !dialog.open) return;
    showFormError(errorBox, friendlyError(error));
    questionGroupsHint.textContent = 'تعذر تحميل الخيارات. أعد فتح النموذج للمحاولة مجددًا.';
  } finally {
    if (version === editorVersion) editorLoading = false;
  }
}

function fillSubjectSelect(select, includeAll) {
  const currentValue = select.value;
  const options = [];

  if (includeAll) {
    options.push(h('option', { value: '' }, 'كل المواد'));
  }

  for (const subject of subjects) {
    options.push(h('option', { value: subject.id }, subject.name));
  }

  select.replaceChildren(...options);

  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function groupsOfSubject(subjectId) {
  return editorGroups.get(subjectId) || [];
}

function groupNamesOfQuestion(questionId) {
  return (questionGroups.get(questionId) || []).map((id) => groupsById.get(id)?.name).filter(Boolean);
}

async function loadQuestions(keepPage = false, pendingPage = null, refreshMetadata = false) {
  if (!keepPage) offset = 0;
  const token = ++loadToken;
  previousPage.disabled = true;
  nextPage.disabled = true;

  questionsSummary.textContent = 'جارٍ تحميل الأسئلة...';
  questionsList.replaceChildren(
    h(
      'div',
      { class: 'skeleton-list', 'aria-hidden': 'true' },
      h('span', { class: 'skeleton-line' }),
      h('span', { class: 'skeleton-line' }),
      h('span', { class: 'skeleton-line' }),
    ),
  );

  let page;
  try {
    page = await (pendingPage || requestQuestionPage(supabase, filters, {
      offset, limit: pageSize, metadata: refreshMetadata || !metadataLoaded,
    }));
  } catch (error) {
    if (token !== loadToken) return false;
    questionsCount.textContent = '—';
    questionsSummary.textContent = 'تعذر تحميل الأسئلة.';
    renderInlineError(questionsList, friendlyError(error));
    return false;
  }

  // A slower earlier filter request must never overwrite a newer page.
  if (token !== loadToken) return false;
  const data = page.questions;
  const count = page.total;
  filters.subject = page.subject_id || '';
  if (page.metadata) applyPageMetadata(page.metadata);
  filterSubject.value = filters.subject;
  if (!data.length && offset > 0 && count <= offset) {
    offset = Math.max(0, (Math.ceil(count / pageSize) - 1) * pageSize);
    return loadQuestions(true);
  }
  for (const row of data) for (const group of row.question_groups || []) {
    groupsById.set(group.group_id, { id: group.group_id, name: group.name });
  }

  allQuestions = data || [];
  questionGroups = new Map(allQuestions.map((row) => [row.id, (row.question_groups || []).map((link) => link.group_id)]));
  renderQuestions(allQuestions);
  previousPage.disabled = offset === 0;
  nextPage.disabled = offset + pageSize >= count;
  pageLabel.textContent = `صفحة ${Math.floor(offset / pageSize) + 1}`;

  const hasFilters = isFilterActive();
  const countText = `${count} سؤال`;
  questionsCount.textContent = countText;
  questionsSummary.textContent = hasFilters
    ? 'نتائج مطابقة للفلاتر الحالية.'
    : 'جميع أسئلتك في بنك الأسئلة.';
  return true;
}

function isFilterActive() {
  return Boolean(filters.subject || filters.difficulty || filters.type || filters.unit || filters.search);
}

// ------------------------------------------------------------
// العرض
// ------------------------------------------------------------
function renderQuestions(questions) {
  questionsList.replaceChildren();

  if (questions.length === 0) {
    const filtered = isFilterActive();

    renderEmptyState(questionsList, {
      title: filtered ? 'لا توجد نتائج مطابقة' : 'لا توجد أسئلة حتى الآن',
      hint: filtered
        ? 'جرّب تعديل الفلاتر أو مسحها لعرض جميع الأسئلة.'
        : 'أضف أول سؤال إلى بنك أسئلتك، ثم ولّد منه اختبارات.',
      action: filtered
        ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: resetFilters }, 'مسح الفلاتر')
        : h(
            'button',
            {
              class: 'btn btn-primary btn-sm',
              type: 'button',
              onclick: () => openQuestionDialog(),
            },
            'إضافة سؤال',
          ),
    });
    return;
  }

  for (const question of questions) {
    questionsList.appendChild(renderQuestionCard(question));
  }
}

function renderQuestionCard(question) {
  const subject = subjects.find((row) => row.id === question.subject_id);
  const subjectLabel = subject?.name || 'مادة محذوفة';
  const selectedGroups = groupNamesOfQuestion(question.id);

  const scopeLabel = question.group_scope === 'selected'
    ? selectedGroups.length > 0
      ? selectedGroups.join('، ')
      : 'بدون صفوف وفصول وأقسام محددة'
    : GROUP_SCOPE_LABELS.all;

  const card = h(
    'article',
    { class: 'question-card' },
    h(
      'div',
      { class: 'question-top' },
      h(
        'div',
        { class: 'badges' },
        h('span', { class: `badge badge-${question.difficulty}`, text: DIFFICULTY_LABELS[question.difficulty] || question.difficulty }),
        h('span', { class: 'badge badge-type', text: TYPE_LABELS[question.type] || question.type }),
        h('span', { class: 'badge badge-subject', text: scopeLabel }),
      ),
      h('span', { class: 'question-subject', text: subjectLabel }),
    ),
    h('p', { class: 'question-text', text: question.question_text }),
  );

  if (question.type === 'mcq') {
    const options = Array.isArray(question.options) ? question.options : [];
    const list = h('ol', { class: 'option-preview' });

    options.forEach((option, index) => {
      const isCorrect = option === question.correct_answer;
      list.appendChild(
        h(
          'li',
          { class: isCorrect ? 'is-correct' : null },
          h('span', { class: 'option-letter', text: OPTION_LETTERS[index] || String(index + 1) }),
          h('span', { class: 'option-value', text: option }),
          isCorrect ? h('span', { class: 'correct-mark', 'aria-label': 'الإجابة الصحيحة', text: '✓' }) : null,
        ),
      );
    });

    card.appendChild(list);
  }

  card.appendChild(
    h(
      'div',
      { class: 'answer-preview' },
      h('span', { class: 'answer-label', text: 'الإجابة الصحيحة:' }),
      h('strong', { text: answerDisplay(question.type, question.correct_answer) }),
    ),
  );

  card.appendChild(
    h(
      'div',
      { class: 'question-foot' },
      h(
        'div',
        { class: 'question-meta' },
        h('span', { text: `الوحدة / الباب / الفصل: ${question.unit || 'غير محدد'}` }),
        h('span', { class: 'dot', 'aria-hidden': 'true', text: '•' }),
        h('span', { text: formatDate(question.created_at, true) }),
      ),
      h(
        'div',
        { class: 'row-actions' },
        h(
          'button',
          { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openQuestionDialog({ question }) },
          'تعديل',
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: () => openQuestionDialog({ question, duplicate: true }),
          },
          'نسخ',
        ),
        h(
          'button',
          { class: 'btn btn-danger-ghost btn-sm', type: 'button', onclick: () => confirmDelete(question) },
          'حذف',
        ),
      ),
    ),
  );

  return card;
}

// ------------------------------------------------------------
// النموذج
// ------------------------------------------------------------
function openQuestionDialog({ question = null, duplicate = false } = {}) {
  if (!metadataLoaded) { toast('انتظر اكتمال تحميل بيانات الصفحة.'); return; }
  if (subjects.length === 0) {
    toast('أضف مادة أولاً من صفحة المواد قبل إضافة الأسئلة.', 'error');
    return;
  }

  editingId = question && !duplicate ? question.id : null;
  form.reset();
  optionsList.replaceChildren();
  showFormError(errorBox, '');

  idInput.value = editingId || '';
  dialogTitle.textContent = editingId
    ? 'تعديل السؤال'
    : duplicate
      ? 'نسخ سؤال'
      : 'إضافة سؤال';
  saveButton.textContent = editingId ? 'حفظ التعديلات' : 'حفظ السؤال';

  const defaultSubject = question?.subject_id || filters.subject || subjects[0].id;
  subjectSelect.value = defaultSubject;

  unitInput.value = question?.unit || '';
  typeSelect.value = question?.type || 'mcq';
  difficultySelect.value = question?.difficulty || '';
  textInput.value = question?.question_text || '';
  shortAnswerInput.value = question?.type === 'short' ? question.correct_answer || '' : '';

  form.querySelectorAll('input[name="true-false-answer"]').forEach((radio) => {
    radio.checked = question?.type === 'true_false' && radio.value === question.correct_answer;
  });

  setScopeRadio(question?.group_scope || 'selected');

  if (question?.type === 'mcq' && Array.isArray(question.options)) {
    question.options.forEach((option) => {
      optionsList.appendChild(createOptionRow(option, option === question.correct_answer));
    });
  }

  if (optionsList.children.length === 0) {
    for (let index = 0; index < 4; index += 1) {
      optionsList.appendChild(createOptionRow());
    }
  }

  updateTypeFields();
  updateOptionState();

  dialog.showModal();
  textInput.focus();
  loadDialogGroups(question);
}

function renderGroupScope(question = null) {
  const subjectId = subjectSelect.value;
  const groups = groupsOfSubject(subjectId);
  const selectedIds = new Set(question ? questionGroups.get(question.id) || [] : []);
  const desiredScope = question?.group_scope || 'selected';

  questionGroupsList.replaceChildren();

  if (groups.length === 0) {
    questionGroupsList.hidden = true;

    if (desiredScope === 'selected') {
      // لا نحوّل سؤالاً محدد الصفوف والفصول والأقسام إلى "all" بصمت عند غياب الصفوف والفصول والأقسام.
      setScopeRadioDisabled(false);
      setScopeRadio('selected');
      questionGroupsHint.textContent =
        'هذه المادة بلا صفوف وفصول وأقسام حالياً. السؤال محدد بصفوف وفصول وأقسام غير متاحة؛ أضف صفوف وفصول وأقسام للمادة، أو اختر «جميع الصفوف والفصول والأقسام» صراحةً.';
    } else {
      setScopeRadio('all');
      setScopeRadioDisabled(true);
      questionGroupsHint.textContent =
        'هذه المادة بلا صفوف وفصول وأقسام حالياً. سيُطبق السؤال على جميع صفوفها وفصولها وأقسامها، وأي صف / فصل / قسم يضاف لاحقاً.';
    }
    return;
  }

  setScopeRadioDisabled(false);

  for (const group of groups) {
    const checkbox = h('input', {
      type: 'checkbox',
      value: group.id,
      name: 'question-group',
    });
    checkbox.checked = selectedIds.has(group.id) || groups.length === 1;
    checkbox.disabled = groups.length === 1;

    questionGroupsList.appendChild(
      h(
        'label',
        { class: 'group-check' },
        checkbox,
        h('span', { class: 'group-check-name', text: group.name }),
      ),
    );
  }

  const scope = desiredScope === 'selected' ? 'selected' : 'all';
  setScopeRadio(scope);
  updateScopeUI();

  // عند النسخ أو التعديل، لا نفرض "all" إن كانت الصفوف والفصول والأقسام المختارة لم تعد مرتبطة.
  if (question?.group_scope === 'selected') {
    setScopeRadio('selected');
    updateScopeUI();
  }
}

function setScopeRadio(value) {
  form.querySelectorAll('input[name="group-scope"]').forEach((radio) => {
    radio.checked = radio.value === value;
  });
}

function setScopeRadioDisabled(disabled) {
  form.querySelectorAll('input[name="group-scope"]').forEach((radio) => {
    radio.disabled = disabled;
    if (disabled && radio.value === 'selected') radio.checked = false;
  });
}

function currentScope() {
  return form.querySelector('input[name="group-scope"]:checked')?.value || 'selected';
}

function checkedQuestionGroupIds() {
  return Array.from(
    questionGroupsList.querySelectorAll('input[name="question-group"]:checked'),
  ).map((input) => input.value);
}

function updateScopeUI() {
  const hasGroups = groupsOfSubject(subjectSelect.value).length > 0;
  const scope = currentScope();
  const showGroups = hasGroups && scope === 'selected';

  questionGroupsList.hidden = !showGroups;

  if (!hasGroups) {
    questionGroupsHint.textContent = scope === 'selected'
      ? 'هذه المادة بلا صفوف وفصول وأقسام حالياً. السؤال محدد بصفوف وفصول وأقسام غير متاحة؛ أضف صفوف وفصول وأقسام للمادة، أو اختر «جميع الصفوف والفصول والأقسام» صراحةً.'
      : 'هذه المادة بلا صفوف وفصول وأقسام حالياً. سيُطبق السؤال على جميع صفوفها وفصولها وأقسامها، وأي صف / فصل / قسم يضاف لاحقاً.';
    return;
  }

  const choices = groupsOfSubject(subjectSelect.value);
  if (choices.length === 1) {
    questionGroupsHint.textContent = scope === 'selected'
      ? `تم اختيار «${choices[0].name}» تلقائيًا لهذا السؤال.`
      : `الخيار الحالي: «${choices[0].name}». هذا النطاق يشمل أيضًا أي صف / فصل / قسم يضاف للمادة مستقبلًا.`;
    return;
  }

  questionGroupsHint.textContent = showGroups
    ? 'اختر صف / فصل / قسم واحد على الأقل. الدرجات تُحدد لاحقاً عند إنشاء الاختبار.'
    : 'يشمل هذا الخيار أي صف / فصل / قسم يضاف إلى المادة لاحقاً دون تعديل السؤال.';
}

function updateTypeFields() {
  const type = typeSelect.value;
  mcqFields.hidden = type !== 'mcq';
  trueFalseFields.hidden = type !== 'true_false';
  shortFields.hidden = type !== 'short';

  if (type === 'mcq' && optionsList.children.length === 0) {
    optionsList.appendChild(createOptionRow());
    optionsList.appendChild(createOptionRow());
    updateOptionState();
  }
}

function createOptionRow(value = '', checked = false) {
  const radio = h('input', {
    type: 'radio',
    name: 'correct-option',
    class: 'option-radio',
    'aria-label': 'تحديد كإجابة صحيحة',
  });
  radio.checked = checked;

  const input = h('input', {
    type: 'text',
    class: 'option-input',
    maxlength: '500',
    placeholder: 'الخيار',
    autocomplete: 'off',
  });
  input.value = value;

  const removeButton = h('button', {
    type: 'button',
    class: 'icon-btn remove-option',
    'aria-label': 'حذف الخيار',
  }, '×');

  const row = h('div', { class: 'option-row' }, radio, input, removeButton);

  removeButton.addEventListener('click', () => {
    if (optionsList.querySelectorAll('.option-row').length <= 2) {
      toast('يجب أن يبقى خياران على الأقل.', 'error');
      return;
    }
    row.remove();
    updateOptionState();
  });

  input.addEventListener('input', updateOptionState);
  return row;
}

function addOptionRow(value = '') {
  if (optionsList.querySelectorAll('.option-row').length >= 6) {
    toast('الحد الأقصى هو 6 خيارات.', 'error');
    return;
  }

  const row = createOptionRow(value);
  optionsList.appendChild(row);
  updateOptionState();
  row.querySelector('.option-input').focus();
}

function updateOptionState() {
  const rows = Array.from(optionsList.querySelectorAll('.option-row'));

  rows.forEach((row, index) => {
    const input = row.querySelector('.option-input');
    const radio = row.querySelector('.option-radio');
    const removeButton = row.querySelector('.remove-option');

    input.placeholder = `الخيار ${index + 1}`;
    radio.setAttribute('aria-label', `تعيين الخيار ${index + 1} كإجابة صحيحة`);
    removeButton.disabled = rows.length <= 2;
  });

  addOptionButton.disabled = rows.length >= 6;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (editorLoading || !editorGroups.has(subjectSelect.value)) {
    showFormError(errorBox, 'انتظر تحميل خيارات المادة قبل الحفظ.');
    return;
  }
  showFormError(errorBox, '');

  const subjectId = subjectSelect.value;
  const type = typeSelect.value;
  const questionText = textInput.value.trim();
  const unit = unitInput.value.trim();
  const difficulty = difficultySelect.value;
  const scope = currentScope();
  const subjectGroupList = groupsOfSubject(subjectId);
  const groupIds = scope === 'selected' ? checkedQuestionGroupIds() : [];

  if (!subjectId || !subjects.some((subject) => subject.id === subjectId)) {
    showFormError(errorBox, 'اختر مادة صحيحة.');
    subjectSelect.focus();
    return;
  }

  if (!questionText) {
    showFormError(errorBox, 'نص السؤال مطلوب.');
    textInput.focus();
    return;
  }

  if (scope === 'selected') {
    if (subjectGroupList.length === 0) {
      showFormError(errorBox, 'هذه المادة بلا صفوف وفصول وأقسام. أضف صفوف وفصول وأقسام للمادة أولاً أو اختر «جميع صفوف وفصول وأقسام المادة».');
      return;
    }

    if (groupIds.length === 0) {
      showFormError(errorBox, 'اختر صف / فصل / قسم واحد على الأقل عند تحديد نطاق «صفوف وفصول وأقسام محددة».');
      return;
    }
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    showFormError(errorBox, 'اختر مستوى صعوبة صحيحاً.');
    return;
  }

  let options = null;
  let correctAnswer = '';

  if (type === 'mcq') {
    const rows = Array.from(optionsList.querySelectorAll('.option-row'));
    const values = rows.map((row) => row.querySelector('.option-input').value.trim());

    if (values.length < 2 || values.length > 6) {
      showFormError(errorBox, 'عدد الخيارات يجب أن يكون بين 2 و6.');
      return;
    }

    const emptyIndex = values.findIndex((value) => value === '');
    if (emptyIndex !== -1) {
      showFormError(errorBox, `الخيار رقم ${emptyIndex + 1} فارغ. املأ جميع الخيارات أو احذف الخيار الفارغ.`);
      rows[emptyIndex].querySelector('.option-input').focus();
      return;
    }

    const uniqueValues = new Set(values);
    if (uniqueValues.size !== values.length) {
      showFormError(errorBox, 'لا يسمح بتكرار الخيارات بالنص نفسه.');
      return;
    }

    const selectedIndex = rows.findIndex((row) => row.querySelector('.option-radio').checked);
    if (selectedIndex === -1) {
      showFormError(errorBox, 'حدّد الإجابة الصحيحة من بين الخيارات.');
      return;
    }

    options = values;
    correctAnswer = values[selectedIndex];
  } else if (type === 'true_false') {
    const selected = form.querySelector('input[name="true-false-answer"]:checked');
    if (!selected) {
      showFormError(errorBox, 'حدّد الإجابة الصحيحة: صح أو خطأ.');
      return;
    }
    correctAnswer = selected.value;
  } else if (type === 'short') {
    correctAnswer = shortAnswerInput.value.trim();
    if (!correctAnswer) {
      showFormError(errorBox, 'الإجابة النموذجية مطلوبة.');
      shortAnswerInput.focus();
      return;
    }
  } else {
    showFormError(errorBox, 'نوع السؤال غير صحيح.');
    return;
  }

  setButtonBusy(saveButton, true, editingId ? 'جارٍ حفظ التعديلات...' : 'جارٍ حفظ السؤال...');

  try {
    const { error } = await supabase.rpc('save_question', {
      p_id: editingId,
      p_subject_id: subjectId,
      p_unit: unit || null,
      p_type: type,
      p_question_text: questionText,
      p_options: options,
      p_correct_answer: correctAnswer,
      p_difficulty: difficulty,
      p_group_scope: scope,
      p_group_ids: groupIds,
    });

    if (error) throw error;

    dialog.close();
    toast(editingId ? 'تم حفظ تعديلات السؤال.' : 'تمت إضافة السؤال بنجاح.');
    await loadQuestions(false, null, true);
  } catch (error) {
    showFormError(errorBox, friendlyError(error));
  } finally {
    setButtonBusy(saveButton, false);
    saveButton.textContent = idInput.value ? 'حفظ التعديلات' : 'حفظ السؤال';
  }
}

async function confirmDelete(question) {
  const preview = question.question_text.length > 80
    ? `${question.question_text.slice(0, 80)}…`
    : question.question_text;

  const message = [
    'هل تريد حذف هذا السؤال؟',
    '',
    `«${preview}»`,
    '',
    'سيبقى السؤال داخل الاختبارات المحفوظة سابقاً بالاعتماد على نسخته التاريخية.',
    'لا يمكن التراجع عن حذفه من بنك الأسئلة.',
  ].join('\n');

  if (!window.confirm(message)) return;

  try {
    const { error } = await supabase.from('questions').delete().eq('id', question.id);
    if (error) throw error;

    toast('تم حذف السؤال من بنك الأسئلة.');
    await loadQuestions(false, null, true);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

// ------------------------------------------------------------
// الفلاتر والروابط
// ------------------------------------------------------------
function bindEvents() {
  previousPage.addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadQuestions(true); });
  nextPage.addEventListener('click', () => { offset += pageSize; loadQuestions(true); });
  // منع إعادة تحميل الصفحة عند الضغط على Enter داخل حقل البحث.
  filtersForm.addEventListener('submit', (event) => event.preventDefault());

  document.getElementById('add-question-btn').addEventListener('click', () => openQuestionDialog());
  addOptionButton.addEventListener('click', () => addOptionRow());
  typeSelect.addEventListener('change', updateTypeFields);
  form.addEventListener('submit', handleSubmit);

  subjectSelect.addEventListener('change', () => { loadDialogGroups(null); });
  dialog.addEventListener('close', () => { editorVersion++; editorLoading = false; });

  form.querySelectorAll('input[name="group-scope"]').forEach((radio) => {
    radio.addEventListener('change', updateScopeUI);
  });

  filterSubject.addEventListener('change', () => {
    filters.subject = filterSubject.value;
    loadQuestions();
  });

  filterDifficulty.addEventListener('change', () => {
    filters.difficulty = filterDifficulty.value;
    loadQuestions();
  });

  filterType.addEventListener('change', () => {
    filters.type = filterType.value;
    loadQuestions();
  });

  filterUnit.addEventListener('change', () => {
    filters.unit = filterUnit.value;
    loadQuestions();
  });

  filterSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const nextSearch = filterSearch.value.trim();
      if (nextSearch === filters.search) return;
      filters.search = nextSearch;
      loadQuestions();
    }, 350);
  });

  document.getElementById('reset-filters').addEventListener('click', resetFilters);

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });


}

function resetFilters() {
  window.clearTimeout(searchTimer);
  filters.subject = '';
  filters.difficulty = '';
  filters.type = '';
  filters.unit = '';
  filters.search = '';

  filterSubject.value = '';
  filterDifficulty.value = '';
  filterType.value = '';
  filterUnit.value = '';
  filterSearch.value = '';

  loadQuestions();
}

function applyUrlFilters() {
  const params = new URLSearchParams(window.location.search);

  const subjectParam = params.get('subject');
  if (subjectParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectParam)) {
    filters.subject = subjectParam;
  }

  const difficultyParam = params.get('difficulty');
  if (['easy', 'medium', 'hard'].includes(difficultyParam || '')) {
    filters.difficulty = difficultyParam;
  }

  const typeParam = params.get('type');
  if (['mcq', 'true_false', 'short'].includes(typeParam || '')) {
    filters.type = typeParam;
  }

  const unitParam = params.get('unit');
  if (unitParam) filters.unit = unitParam;

  const searchParam = params.get('q');
  if (searchParam) filters.search = searchParam;

  filterSubject.value = filters.subject;
  filterDifficulty.value = filters.difficulty;
  filterType.value = filters.type;
  filterSearch.value = filters.search;
  filterUnit.value = filters.unit;
}

async function handleUrlActions() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('new') === '1') {
    openQuestionDialog();
    return;
  }

  const editId = params.get('edit');
  if (!editId) return;

  const loaded = allQuestions.find((question) => question.id === editId);
  if (loaded) { openQuestionDialog({ question: loaded }); return; }

  const { data, error } = await supabase
    .from('questions')
    .select('id, subject_id, unit, type, question_text, options, correct_answer, difficulty, group_scope, question_groups(group_id)')
    .eq('id', editId)
    .maybeSingle();

  if (error) {
    toast(friendlyError(error), 'error');
    return;
  }

  if (!data) {
    toast('لم يتم العثور على السؤال المطلوب أو لا تملك صلاحية الوصول إليه.', 'error');
    return;
  }

  questionGroups.set(data.id, (data.question_groups || []).map((link) => link.group_id));
  openQuestionDialog({ question: data });
}
