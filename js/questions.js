// إدارة الأسئلة: إضافة، تعديل، نسخ، حذف، وفلترة.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  DIFFICULTY_LABELS,
  TYPE_LABELS,
  answerDisplay,
  formatDate,
  formatPoints,
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
const gradeDisplay = document.getElementById('question-grade');
const unitInput = document.getElementById('question-unit');
const typeSelect = document.getElementById('question-type');
const difficultySelect = document.getElementById('question-difficulty');
const pointsInput = document.getElementById('question-points');
const textInput = document.getElementById('question-text');
const errorBox = document.getElementById('question-error');
const saveButton = document.getElementById('save-question-btn');

const mcqFields = document.getElementById('mcq-fields');
const trueFalseFields = document.getElementById('true-false-fields');
const shortFields = document.getElementById('short-fields');
const optionsList = document.getElementById('options-list');
const addOptionButton = document.getElementById('add-option-btn');
const shortAnswerInput = document.getElementById('short-answer');

let currentUser = null;
let subjects = [];
let allQuestions = [];
let editingId = null;
let loadToken = 0;
let searchTimer = null;

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

  initNav('questions', currentUser);
  bindEvents();

  await loadSubjects();
  applyUrlFilters();
  await loadUnits();
  await loadQuestions();
  await handleUrlActions();
}

// ------------------------------------------------------------
// البيانات
// ------------------------------------------------------------
async function loadSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, grade_level')
    .eq('user_id', currentUser.id)
    .order('name', { ascending: true });

  if (error) {
    toast(friendlyError(error), 'error');
    return;
  }

  subjects = data || [];

  fillSubjectSelect(filterSubject, true);
  fillSubjectSelect(subjectSelect, false);
  filterSubject.value = filters.subject;
}

function fillSubjectSelect(select, includeAll) {
  const currentValue = select.value;
  const options = [];

  if (includeAll) {
    options.push(h('option', { value: '' }, 'كل المواد'));
  }

  for (const subject of subjects) {
    options.push(
      h(
        'option',
        { value: subject.id },
        `${subject.name}${subject.grade_level ? ` — ${subject.grade_level}` : ''}`,
      ),
    );
  }

  select.replaceChildren(...options);

  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

async function loadUnits() {
  const { data, error } = await supabase
    .from('questions')
    .select('unit')
    .eq('user_id', currentUser.id);

  if (error) {
    toast(friendlyError(error), 'error');
    return;
  }

  const units = Array.from(
    new Set((data || []).map((row) => (row.unit || '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'ar'));

  if (filters.unit && !units.includes(filters.unit)) {
    filters.unit = '';
  }

  const options = [h('option', { value: '' }, 'كل الوحدات')];
  for (const unit of units) {
    options.push(h('option', { value: unit }, unit));
  }

  filterUnit.replaceChildren(...options);
  filterUnit.value = filters.unit;
}

async function loadQuestions() {
  const token = ++loadToken;

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

  let query = supabase
    .from('questions')
    .select(
      'id, subject_id, unit, type, question_text, options, correct_answer, difficulty, points, created_at, subjects(name, grade_level)',
    )
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (filters.subject) query = query.eq('subject_id', filters.subject);
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.unit) query = query.eq('unit', filters.unit);
  if (filters.search) query = query.ilike('question_text', `%${filters.search}%`);

  const { data, error } = await query;

  // تجاهل استجابة قديمة إذا تغيرت الفلاتر أثناء التحميل.
  if (token !== loadToken) return;

  if (error) {
    questionsCount.textContent = '—';
    questionsSummary.textContent = 'تعذر تحميل الأسئلة.';
    renderInlineError(questionsList, friendlyError(error));
    return;
  }

  allQuestions = data || [];
  renderQuestions(allQuestions);

  const hasFilters = isFilterActive();
  const countText = `${allQuestions.length} سؤال`;
  questionsCount.textContent = countText;
  questionsSummary.textContent = hasFilters
    ? 'نتائج مطابقة للفلاتر الحالية.'
    : 'جميع أسئلتك في بنك الأسئلة.';
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
  const subject = Array.isArray(question.subjects) ? question.subjects[0] : question.subjects;
  const subjectLabel = subject
    ? `${subject.name}${subject.grade_level ? ` — ${subject.grade_level}` : ''}`
    : 'مادة محذوفة';

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
        h('span', { class: 'badge badge-points', text: `${formatPoints(question.points)} درجة` }),
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
        h('span', { text: `الوحدة: ${question.unit || 'غير محددة'}` }),
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
  updateGradeDisplay();

  unitInput.value = question?.unit || '';
  typeSelect.value = question?.type || 'mcq';
  difficultySelect.value = question?.difficulty || 'medium';
  pointsInput.value = String(Number(question?.points ?? 1));
  textInput.value = question?.question_text || '';
  shortAnswerInput.value = question?.type === 'short' ? question.correct_answer || '' : '';

  form.querySelectorAll('input[name="true-false-answer"]').forEach((radio) => {
    radio.checked = question?.type === 'true_false' && radio.value === question.correct_answer;
  });

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
}

function updateGradeDisplay() {
  const subject = subjects.find((item) => item.id === subjectSelect.value);
  gradeDisplay.textContent = subject?.grade_level || 'غير محدد';
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
  showFormError(errorBox, '');

  const subjectId = subjectSelect.value;
  const type = typeSelect.value;
  const questionText = textInput.value.trim();
  const unit = unitInput.value.trim();
  const difficulty = difficultySelect.value;
  const points = Number(pointsInput.value);

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

  if (!Number.isFinite(points) || points <= 0) {
    showFormError(errorBox, 'الدرجة يجب أن تكون رقماً أكبر من صفر.');
    pointsInput.focus();
    return;
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
    // لا نرسل user_id إطلاقاً؛ Supabase يضبطه من الجلسة وRLS يتحقق منه.
    const payload = {
      subject_id: subjectId,
      unit: unit || null,
      type,
      question_text: questionText,
      options,
      correct_answer: correctAnswer,
      difficulty,
      points,
    };

    const result = editingId
      ? await supabase.from('questions').update(payload).eq('id', editingId).select('id')
      : await supabase.from('questions').insert(payload).select('id');

    if (result.error) throw result.error;

    if (editingId && (!result.data || result.data.length === 0)) {
      throw new Error('لم يتم العثور على السؤال أو لا تملك صلاحية تعديله.');
    }

    dialog.close();
    toast(editingId ? 'تم حفظ تعديلات السؤال.' : 'تمت إضافة السؤال بنجاح.');
    await loadUnits();
    await loadQuestions();
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
    await loadUnits();
    await loadQuestions();
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

// ------------------------------------------------------------
// الفلاتر والروابط
// ------------------------------------------------------------
function bindEvents() {
  // منع إعادة تحميل الصفحة عند الضغط على Enter داخل حقل البحث.
  filtersForm.addEventListener('submit', (event) => event.preventDefault());

  document.getElementById('add-question-btn').addEventListener('click', () => openQuestionDialog());
  addOptionButton.addEventListener('click', () => addOptionRow());
  typeSelect.addEventListener('change', updateTypeFields);
  subjectSelect.addEventListener('change', updateGradeDisplay);
  form.addEventListener('submit', handleSubmit);

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
      filters.search = filterSearch.value.trim();
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
  if (subjectParam && subjects.some((subject) => subject.id === subjectParam)) {
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

  const { data, error } = await supabase
    .from('questions')
    .select('id, subject_id, unit, type, question_text, options, correct_answer, difficulty, points')
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

  openQuestionDialog({ question: data });
}
