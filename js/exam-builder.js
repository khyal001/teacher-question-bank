import { teachingTargetSelection, NO_TEACHING_TARGET } from './teaching-targets.js';
import { fetchAll } from './data-utils.js';
// مولّد الاختبار: صفوف وفصول وأقسام، درجات إجمالية، توزيع دقيق، معاينة، ثم حفظ ذري عبر RPC.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  DIFFICULTY_LABELS,
  TYPE_LABELS,
  answerDisplay,
  formatPoints,
  friendlyError,
  h,
  renderEmptyState,
  setButtonBusy,
  showFormError,
  toast,
} from './ui.js';
import {
  questionAppliesToGroups,
  replacementCandidates,
  QUESTION_LAYOUT_LABELS,
  QUESTION_LAYOUTS,
  distributePoints,
  isPositivePoints,
  pointsMatch,
  pointsToNumber,
  pointsTotalCents,
  remainingPoints,
  sumPoints,
  toCents,
} from './exam-utils.js';

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const form = document.getElementById('exam-form');
const subjectSelect = document.getElementById('exam-subject');
const titleInput = document.getElementById('exam-title');
const letterheadSelect = document.getElementById('exam-letterhead');
const totalPointsInput = document.getElementById('exam-total-points');
const closingInput = document.getElementById('exam-closing');
const shuffleInput = document.getElementById('shuffle-options');
const examGroups = document.getElementById('exam-groups');
const examGroupsNote = document.getElementById('exam-groups-note');
const errorBox = document.getElementById('builder-error');
const availabilityNote = document.getElementById('availability-note');

const previewArea = document.getElementById('preview-area');
const previewCount = document.getElementById('preview-count');
const previewActions = document.getElementById('preview-actions');
const saveButton = document.getElementById('save-exam-btn');
const redistributeButton = document.getElementById('redistribute-btn');

let currentUser = null;
let subjects = [];
let allGroups = [];
let subjectGroups = new Map();
let letterheads = [];
let subjectQuestions = [];
let questionGroupLinks = new Map();
let eligibleQuestions = [];
let previewState = null;
let questionsToken = 0;
let isSaving = false;

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('builder', currentUser);
  bindEvents();
  await Promise.all([loadReferenceData(), loadLetterheads()]);
}

function bindEvents() {
  subjectSelect.addEventListener('change', handleSubjectChange);

  examGroups.addEventListener('change', () => {
    showFormError(errorBox, '');
    clearPreview();
    applyGroupFilter();
    updateAvailability();
  });

  titleInput.addEventListener('change', () => {
    if (!previewState) return;
    previewState.title = titleInput.value.trim();
    renderPreview();
  });

  totalPointsInput.addEventListener('input', () => {
    if (!previewState) return;
    const raw = totalPointsInput.value.trim();
    previewState.totalPoints = isPositivePoints(raw) ? Number(raw) : null;
    updatePointSummary();
  });

  totalPointsInput.addEventListener('change', () => {
    if (!previewState) return;
    const raw = totalPointsInput.value.trim();
    if (!isPositivePoints(raw)) {
      showFormError(errorBox, 'إجمالي الدرجات يجب أن يكون رقماً أكبر من صفر بمنزلتين عشريتين كحد أقصى.');
      return;
    }
    previewState.totalPoints = Number(raw);
    renderPreview();
  });

  letterheadSelect.addEventListener('change', () => {
    if (!previewState) return;
    previewState.letterheadId = letterheadSelect.value || null;
    previewState.letterheadName =
      letterheads.find((item) => item.id === letterheadSelect.value)?.name || '';
    renderPreview();
  });

  closingInput.addEventListener('input', () => {
    if (previewState) previewState.closingPhrase = closingInput.value.trim();
  });

  form.addEventListener('submit', handleGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', () => form.requestSubmit());
  document.getElementById('cancel-preview-btn').addEventListener('click', clearPreview);
  redistributeButton.addEventListener('click', redistributePointsEvenly);
  saveButton.addEventListener('click', saveExam);
}

// ------------------------------------------------------------
// البيانات المرجعية
// ------------------------------------------------------------
async function loadReferenceData() {
  const [subjectsResult, groupsResult, linksResult] = await Promise.all([
    fetchAll(supabase
      .from('subjects')
      .select('id, name')
      .eq('user_id', currentUser.id)
      .order('name', { ascending: true }), ['id']),
    fetchAll(supabase
      .from('teaching_groups')
      .select('id, name')
      .eq('user_id', currentUser.id)
      .order('name', { ascending: true }), ['id']),
    fetchAll(supabase
      .from('subject_groups')
      .select('subject_id, group_id')
      .eq('user_id', currentUser.id), ['subject_id', 'group_id']),
  ]);

  const error = [subjectsResult, groupsResult, linksResult].find((result) => result.error)?.error;

  if (error) {
    showFormError(errorBox, friendlyError(error));
    availabilityNote.textContent = 'تعذر تحميل المواد.';
    return;
  }

  subjects = subjectsResult.data || [];
  allGroups = groupsResult.data || [];

  subjectGroups = new Map();
  for (const link of linksResult.data || []) {
    if (!subjectGroups.has(link.subject_id)) subjectGroups.set(link.subject_id, []);
    subjectGroups.get(link.subject_id).push(link.group_id);
  }

  const options = [h('option', { value: '' }, 'اختر المادة')];
  for (const subject of subjects) {
    options.push(h('option', { value: subject.id }, subject.name));
  }
  subjectSelect.replaceChildren(...options);

  const subjectParam = new URLSearchParams(window.location.search).get('subject');
  if (subjectParam && subjects.some((subject) => subject.id === subjectParam)) {
    subjectSelect.value = subjectParam;
    await handleSubjectChange();
    return;
  }

  if (subjects.length === 0) {
    availabilityNote.textContent = 'لا توجد مواد بعد. أضف مادة وأسئلتها أولاً.';
  }
}

async function loadLetterheads() {
  const { data, error } = await fetchAll(supabase
    .from('letterheads')
    .select('id, name')
    .eq('user_id', currentUser.id)
    .order('name', { ascending: true }), ['id']);

  if (error) {
    showFormError(errorBox, friendlyError(error));
    return;
  }

  letterheads = data || [];

  const currentValue = letterheadSelect.value;
  const options = [h('option', { value: '' }, 'بدون كليشة مخصصة')];

  for (const letterhead of letterheads) {
    options.push(h('option', { value: letterhead.id }, letterhead.name));
  }

  letterheadSelect.replaceChildren(...options);

  if (currentValue && letterheads.some((letterhead) => letterhead.id === currentValue)) {
    letterheadSelect.value = currentValue;
  }
}

function groupsOfSubject(subjectId) {
  return (subjectGroups.get(subjectId) || [])
    .map((groupId) => allGroups.find((group) => group.id === groupId))
    .filter(Boolean);
}

async function handleSubjectChange() {
  showFormError(errorBox, '');
  clearPreview();
  renderExamGroups();
  await loadSubjectQuestions();
}

function renderExamGroups() {
  const subjectId = subjectSelect.value;
  const groups = groupsOfSubject(subjectId);
  const selection = teachingTargetSelection(groups);

  examGroups.replaceChildren();
  document.getElementById('generate-btn').disabled = !subjectId || selection.mode === 'none';

  if (!subjectId) {
    examGroupsNote.textContent = 'اختر المادة أولاً.';
    return;
  }

  if (selection.mode === 'none') {
    examGroupsNote.replaceChildren(
      h('span', { text: NO_TEACHING_TARGET }),
      ' ', h('a', { href: './subjects.html' }, 'فتح صفحة المواد'),
    );
    return;
  }

  for (const group of groups) {
    const checkbox = h('input', {
      type: 'checkbox',
      value: group.id,
      name: 'exam-group',
    });
    checkbox.checked = selection.selectedIds.includes(group.id);
    checkbox.disabled = selection.mode === 'single';

    examGroups.appendChild(
      h(
        'label',
        { class: 'group-check' },
        checkbox,
        h('span', { class: 'group-check-name', text: group.name }),
      ),
    );
  }

  examGroupsNote.textContent = selection.mode === 'single'
    ? `تم اختيار «${groups[0].name}» تلقائيًا لأنه الخيار الوحيد لهذه المادة.`
    : 'اختر صفًا / فصلًا / قسمًا واحدًا أو أكثر. الاختبار المشترك يشمل أسئلة صالحة لجميع الخيارات المحددة.';
}

function selectedGroupIds() {
  return Array.from(examGroups.querySelectorAll('input[name="exam-group"]:checked')).map(
    (input) => input.value,
  );
}

function selectedGroupNames() {
  return selectedGroupIds()
    .map((groupId) => allGroups.find((group) => group.id === groupId)?.name)
    .filter(Boolean);
}

async function loadSubjectQuestions() {
  const token = ++questionsToken;
  const subjectId = subjectSelect.value;

  subjectQuestions = [];
  questionGroupLinks = new Map();
  eligibleQuestions = [];
  updateAvailability();

  if (!subjectId) return;

  availabilityNote.textContent = 'جارٍ تحميل الأسئلة المتاحة...';

  const [questionsResult, linksResult] = await Promise.all([
    fetchAll(supabase
      .from('questions')
      .select(
        'id, subject_id, unit, type, question_text, options, correct_answer, difficulty, group_scope',
      )
      .eq('user_id', currentUser.id)
      .eq('subject_id', subjectId), ['id']),
    fetchAll(supabase
      .from('question_groups')
      .select('question_id, group_id')
      .eq('user_id', currentUser.id), ['question_id', 'group_id']),
  ]);

  if (token !== questionsToken) return;

  const error = questionsResult.error || linksResult.error;
  if (error) {
    availabilityNote.textContent = 'تعذر تحميل الأسئلة.';
    showFormError(errorBox, friendlyError(error));
    return;
  }

  subjectQuestions = questionsResult.data || [];

  for (const link of linksResult.data || []) {
    if (!questionGroupLinks.has(link.question_id)) questionGroupLinks.set(link.question_id, new Set());
    questionGroupLinks.get(link.question_id).add(link.group_id);
  }

  applyGroupFilter();
  updateAvailability();
}

function applyGroupFilter() {
  const groups = selectedGroupIds();
  if (groupsOfSubject(subjectSelect.value).length === 0) { eligibleQuestions = []; return; }
  eligibleQuestions = subjectQuestions.filter((question) =>
    questionAppliesToGroups(question, questionGroupLinks.get(question.id), groups),
  );
}

function updateAvailability() {
  const counts = { easy: 0, medium: 0, hard: 0 };

  for (const question of eligibleQuestions) {
    if (question.difficulty in counts) counts[question.difficulty] += 1;
  }

  for (const key of ['easy', 'medium', 'hard']) {
    document.getElementById(`available-${key}`).textContent = `المتاح: ${counts[key]}`;
  }

  const total = counts.easy + counts.medium + counts.hard;
  const subject = subjects.find((item) => item.id === subjectSelect.value);
  const groupCount = selectedGroupIds().length;
  const subjectHasGroups = groupsOfSubject(subjectSelect.value).length > 0;

  if (!subjectSelect.value) {
    availabilityNote.textContent = 'اختر المادة والصفوف والفصول والأقسام لعرض الأسئلة المتاحة.';
  } else if (!subjectHasGroups) {
    availabilityNote.textContent = NO_TEACHING_TARGET;
  } else if (total === 0) {
    availabilityNote.textContent =
      'لا توجد أسئلة مطابقة للمادة والصفوف والفصول والأقسام المختارة. أضف أسئلة أو عدّل نطاق صفوفها وفصولها وأقسامها.';
  } else {
    const groupLabel = groupCount > 0
      ? `${groupCount} صف / فصل / قسم`
      : subjectHasGroups
        ? 'لم تحدد صفوف وفصول وأقسام'
        : 'جميع الصفوف والفصول والأقسام';
    availabilityNote.textContent =
      `المتاح في «${subject?.name || 'المادة'}» ضمن ${groupLabel}: ${total} سؤال ` +
      `(سهل ${counts.easy}، متوسط ${counts.medium}، صعب ${counts.hard}).`;
  }
}

// ------------------------------------------------------------
// التوليد
// ------------------------------------------------------------
function handleGenerate(event) {
  event.preventDefault();
  showFormError(errorBox, '');

  const subject = subjects.find((item) => item.id === subjectSelect.value);

  if (!subject) {
    showFormError(errorBox, 'اختر المادة أولاً.');
    subjectSelect.focus();
    return;
  }

  const title = titleInput.value.trim();
  if (!title) {
    showFormError(errorBox, 'عنوان الاختبار مطلوب.');
    titleInput.focus();
    return;
  }

  const groupIds = selectedGroupIds();
  if (groupsOfSubject(subject.id).length === 0) {
    showFormError(errorBox, NO_TEACHING_TARGET);
    return;
  }
  if (groupIds.length === 0) {
    showFormError(errorBox, 'اختر صف / فصل / قسم واحد على الأقل من صفوف وفصول وأقسام المادة.');
    examGroups.focus();
    return;
  }

  const totalPoints = totalPointsInput.value.trim();
  if (!isPositivePoints(totalPoints)) {
    showFormError(errorBox, 'إجمالي الدرجات يجب أن يكون رقماً أكبر من صفر بمنزلتين عشريتين كحد أقصى.');
    totalPointsInput.focus();
    return;
  }

  const requested = {
    easy: Number(document.getElementById('count-easy').value || 0),
    medium: Number(document.getElementById('count-medium').value || 0),
    hard: Number(document.getElementById('count-hard').value || 0),
  };

  for (const key of ['easy', 'medium', 'hard']) {
    if (!Number.isInteger(requested[key]) || requested[key] < 0) {
      showFormError(errorBox, 'أعداد الأسئلة يجب أن تكون أعداداً صحيحة غير سالبة.');
      return;
    }
  }

  const totalRequested = requested.easy + requested.medium + requested.hard;
  if (totalRequested < 1) {
    showFormError(errorBox, 'حدّد سؤالاً واحداً على الأقل.');
    return;
  }

  if (eligibleQuestions.length === 0) {
    showFormError(errorBox, 'لا توجد أسئلة مطابقة للمادة والصفوف والفصول والأقسام المختارة.');
    return;
  }

  const available = { easy: 0, medium: 0, hard: 0 };
  for (const question of eligibleQuestions) {
    if (question.difficulty in available) available[question.difficulty] += 1;
  }

  const insufficient = ['easy', 'medium', 'hard'].filter(
    (key) => requested[key] > available[key],
  );

  if (insufficient.length > 0) {
    showFormError(
      errorBox,
      `لا يوجد عدد كافٍ من الأسئلة. المتاح: سهل (${available.easy})، متوسط (${available.medium})، صعب (${available.hard}). ` +
        `المطلوب: سهل (${requested.easy})، متوسط (${requested.medium})، صعب (${requested.hard}). ` +
        'قلّل الأعداد المطلوبة أو أضف أسئلة جديدة.',
    );
    return;
  }

  let points;

  try {
    points = distributePoints(totalPoints, totalRequested);
  } catch (error) {
    showFormError(errorBox, error.message);
    return;
  }

  const selected = [];

  for (const key of ['easy', 'medium', 'hard']) {
    const pool = shuffleCopy(eligibleQuestions.filter((question) => question.difficulty === key));
    selected.push(...pool.slice(0, requested[key]));
  }

  const ordered = shuffleCopy(selected);
  const items = ordered.map((question, index) => buildItem(question, points[index]));

  previewState = {
    subject,
    title,
    groupIds,
    groupNames: selectedGroupNames(),
    totalPoints: Number(totalPoints),
    letterheadId: letterheadSelect.value || null,
    letterheadName: letterheads.find((item) => item.id === letterheadSelect.value)?.name || '',
    closingPhrase: closingInput.value.trim(),
    items,
  };

  renderPreview();
  showFormError(errorBox, '');

  if (window.matchMedia('(max-width: 980px)').matches) {
    previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function buildItem(question, points) {
  let options = null;

  if (question.type === 'mcq') {
    options = Array.isArray(question.options) ? [...question.options] : [];
    if (shuffleInput.checked) {
      options = shuffleCopy(options);
    }
  }

  return { question, options, points, layout: 'auto' };
}

// ------------------------------------------------------------
// المعاينة
// ------------------------------------------------------------
function renderPreview() {
  if (!previewState) return;

  const {
    subject,
    title,
    groupNames,
    totalPoints,
    letterheadName,
    items,
  } = previewState;

  const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
  for (const item of items) {
    if (item.question.difficulty in difficultyCounts) {
      difficultyCounts[item.question.difficulty] += 1;
    }
  }

  previewCount.textContent = `${items.length} سؤال`;

  const summary = h(
    'div',
    { class: 'preview-summary' },
    h(
      'div',
      { class: 'preview-summary-main' },
      h('strong', { class: 'preview-title', text: title }),
      h('span', { class: 'preview-subject', text: subject.name }),
      groupNames.length > 0
        ? h('span', { class: 'preview-groups', text: `الصفوف والفصول والأقسام: ${groupNames.join('، ')}` })
        : null,
      letterheadName
        ? h('span', { class: 'preview-groups', text: `الكليشة: ${letterheadName}` })
        : null,
    ),
    h(
      'div',
      { class: 'preview-stats' },
      h('span', { class: 'preview-stat' }, h('strong', { text: String(items.length) }), ' سؤال'),
      h('span', { class: 'preview-stat' }, h('strong', { text: formatPoints(totalPoints) }), ' درجة إجمالية'),
      h(
        'span',
        { class: 'preview-stat preview-stat-difficulty' },
        `سهل ${difficultyCounts.easy} · متوسط ${difficultyCounts.medium} · صعب ${difficultyCounts.hard}`,
      ),
    ),
  );

  const pointsPanel = h(
    'div',
    { class: 'points-summary', id: 'points-summary' },
    pointsSummaryItem('الإجمالي المطلوب', formatPoints(totalPoints), 'points-total'),
    pointsSummaryItem('الموزّع على الأسئلة', '—', 'distributed-points'),
    pointsSummaryItem('المتبقي', '—', 'remaining-points'),
    h('span', { class: 'points-status', id: 'points-status', text: '—' }),
  );

  const list = h('div', { class: 'preview-list' });
  items.forEach((item, index) => {
    list.appendChild(renderPreviewQuestion(item, index));
  });

  previewArea.replaceChildren(summary, pointsPanel, list);
  previewActions.hidden = false;
  updatePointSummary();
}

function pointsSummaryItem(label, value, id) {
  return h(
    'span',
    { class: 'points-summary-item' },
    h('span', { class: 'points-summary-label', text: label }),
    h('strong', { id, text: value }),
  );
}

function renderPreviewQuestion(item, index) {
  const question = item.question;

  const pointsInput = h('input', {
    type: 'number',
    class: 'preview-point-input',
    min: '0.01',
    step: '0.01',
    inputmode: 'decimal',
    value: String(item.points),
    'aria-label': `درجة السؤال ${index + 1}`,
    dataset: { index: String(index) },
  });

  const layoutSelect = question.type === 'mcq'
    ? h(
        'select',
        {
          class: 'preview-layout-select',
          'aria-label': `تخطيط خيارات السؤال ${index + 1}`,
          dataset: { index: String(index) },
        },
        ...QUESTION_LAYOUTS.map((layout) =>
          h('option', { value: layout, selected: item.layout === layout }, QUESTION_LAYOUT_LABELS[layout]),
        ),
      )
    : null;

  const card = h(
    'article',
    { class: 'preview-question' },
    h(
      'div',
      { class: 'preview-q-head' },
      h('span', { class: 'q-position', text: `سؤال ${index + 1}` }),
      h(
        'div',
        { class: 'badges' },
        h('span', { class: `badge badge-${question.difficulty}`, text: DIFFICULTY_LABELS[question.difficulty] }),
        h('span', { class: 'badge badge-type', text: TYPE_LABELS[question.type] }),
      ),
      h(
        'div',
        { class: 'preview-points-control' },
        h('span', { class: 'preview-points-label', text: 'الدرجة' }),
        pointsInput,
      ),
      layoutSelect,
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm preview-replace-btn',
          type: 'button',
          onclick: () => replaceQuestion(index),
        },
        'استبدال',
      ),
    ),
    h('p', { class: 'preview-q-text', text: question.question_text }),
  );

  pointsInput.addEventListener('input', () => {
    if (!previewState) return;
    previewState.items[index].points = pointsInput.value;
    updatePointSummary();
  });

  if (layoutSelect) {
    layoutSelect.addEventListener('change', () => {
      if (!previewState) return;
      previewState.items[index].layout = layoutSelect.value;
      renderPreview();
    });
  }

  if (question.type === 'mcq') {
    const options = h('ol', { class: 'option-preview' });
    for (const [optionIndex, option] of (item.options || []).entries()) {
      const isCorrect = option === question.correct_answer;
      options.appendChild(
        h(
          'li',
          { class: isCorrect ? 'is-correct' : null },
          h('span', { class: 'option-letter', text: OPTION_LETTERS[optionIndex] || String(optionIndex + 1) }),
          h('span', { class: 'option-value', text: option }),
          isCorrect ? h('span', { class: 'correct-mark', 'aria-label': 'الإجابة الصحيحة', text: '✓' }) : null,
        ),
      );
    }
    card.appendChild(options);
  }

  card.appendChild(
    h(
      'p',
      { class: 'preview-answer' },
      h('span', { text: 'الإجابة: ' }),
      h('strong', { text: answerDisplay(question.type, question.correct_answer) }),
    ),
  );

  return card;
}

function updatePointSummary() {
  if (!previewState) return;

  const items = previewState.items;
  const points = items.map((item) => item.points);
  const sum = sumPoints(points);
  const totalCents = toCents(previewState.totalPoints);
  const sumCents = pointsTotalCents(points);
  const remaining = remainingPoints(previewState.totalPoints, points);

  const distributedElement = document.getElementById('distributed-points');
  const remainingElement = document.getElementById('remaining-points');
  const statusElement = document.getElementById('points-status');
  const totalElement = document.getElementById('points-total');

  if (totalElement) {
    const totalValue = toCents(previewState.totalPoints);
    totalElement.textContent = totalValue === null ? '—' : formatPoints(previewState.totalPoints);
  }
  if (distributedElement) distributedElement.textContent = sum === null ? '—' : formatPoints(sum);
  if (remainingElement) remainingElement.textContent = remaining === null ? '—' : formatPoints(remaining);

  document.querySelectorAll('.preview-point-input').forEach((input) => {
    input.classList.toggle('is-invalid', !isPositivePoints(input.value));
  });

  let status = '';
  let statusClass = '';

  if (sum === null || totalCents === null) {
    status = 'توجد درجة غير صالحة';
    statusClass = 'is-error';
  } else if (sumCents === totalCents) {
    status = 'التوزيع مطابق تماماً';
    statusClass = 'is-ok';
  } else if (sumCents < totalCents) {
    status = `متبقٍ ${formatPoints(remaining)}`;
    statusClass = 'is-warning';
  } else {
    status = `زيادة ${formatPoints(pointsToNumber(Math.abs(totalCents - sumCents)))}`;
    statusClass = 'is-error';
  }

  if (statusElement) {
    statusElement.textContent = status;
    statusElement.className = `points-status ${statusClass}`;
  }

  const ready = pointsMatch(previewState.totalPoints, points);
  saveButton.disabled = !ready || isSaving;
  saveButton.title = ready ? '' : 'يجب أن يساوي مجموع درجات الأسئلة إجمالي درجات الاختبار.';
}

function replaceQuestion(index) {
  if (!previewState) return;

  const current = previewState.items[index];
  const usedIds = new Set(previewState.items.map((item) => item.question.id));

  const pool = replacementCandidates(eligibleQuestions, current.question, usedIds);

  if (pool.length === 0) {
    toast('لا يوجد بديل من النوع والصعوبة نفسيهما ضمن الصفوف والفصول والأقسام المختارة. لم يتغير السؤال.', 'error');
    return;
  }

  const replacement = pool[Math.floor(Math.random() * pool.length)];
  previewState.items[index] = buildItem(replacement, current.points);
  previewState.items[index].layout = current.layout;

  renderPreview();
  toast('تم استبدال السؤال بسؤال آخر.', 'success', 2200);
}

function redistributePointsEvenly() {
  if (!previewState) return;

  try {
    const points = distributePoints(previewState.totalPoints, previewState.items.length);
    previewState.items.forEach((item, index) => {
      item.points = points[index];
    });
    renderPreview();
    showFormError(errorBox, '');
    toast('تم توزيع الدرجات بالتساوي.');
  } catch (error) {
    showFormError(errorBox, error.message);
  }
}

function clearPreview() {
  previewState = null;
  previewCount.textContent = '0 سؤال';
  previewActions.hidden = true;
  renderEmptyState(previewArea, {
    title: 'لم يتم توليد اختبار بعد',
    hint: 'اختر المادة والصفوف والفصول والأقسام وإجمالي الدرجات، ثم اضغط «توليد المعاينة».',
  });
}

// ------------------------------------------------------------
// الحفظ
// ------------------------------------------------------------
async function saveExam() {
  if (!previewState || isSaving) return;

  const title = titleInput.value.trim();
  if (!title) {
    showFormError(errorBox, 'عنوان الاختبار مطلوب.');
    titleInput.focus();
    return;
  }

  const rawTotal = totalPointsInput.value.trim();
  if (!isPositivePoints(rawTotal)) {
    showFormError(errorBox, 'إجمالي الدرجات يجب أن يكون رقماً أكبر من صفر بمنزلتين عشريتين كحد أقصى.');
    totalPointsInput.focus();
    return;
  }

  // المزامنة مع القيم الحالية قبل الحفظ، حتى لا تُحفظ قيم معاينة قديمة.
  previewState.title = title;
  previewState.totalPoints = Number(rawTotal);
  previewState.letterheadId = letterheadSelect.value || null;
  previewState.letterheadName =
    letterheads.find((item) => item.id === letterheadSelect.value)?.name || '';
  previewState.closingPhrase = closingInput.value.trim();
  updatePointSummary();

  const points = previewState.items.map((item) => item.points);

  if (!pointsMatch(previewState.totalPoints, points)) {
    showFormError(errorBox, 'لا يمكن الحفظ: مجموع درجات الأسئلة لا يساوي إجمالي درجات الاختبار.');
    return;
  }

  if (previewState.items.some((item) => !isPositivePoints(item.points))) {
    showFormError(errorBox, 'كل سؤال يحتاج درجة موجبة بمنزلتين عشريتين كحد أقصى.');
    return;
  }

  isSaving = true;
  setButtonBusy(saveButton, true, 'جارٍ حفظ الاختبار...');
  showFormError(errorBox, '');

  try {
    const questionsPayload = previewState.items.map((item, index) => {
      const question = item.question;

      return {
        question_id: question.id,
        position: index + 1,
        snapshot: {
          question_text: question.question_text,
          type: question.type,
          options: question.type === 'mcq' ? item.options : null,
          correct_answer: question.correct_answer,
          difficulty: question.difficulty,
          points: Number(item.points),
          layout: item.layout || 'auto',
          unit: question.unit || null,
        },
      };
    });

    const { data: examId, error } = await supabase.rpc('save_exam', {
      p_title: previewState.title,
      p_subject_id: previewState.subject.id,
      p_total_points: Number(previewState.totalPoints),
      p_group_ids: previewState.groupIds,
      p_letterhead_id: previewState.letterheadId,
      p_closing_phrase: previewState.closingPhrase,
      p_questions: questionsPayload,
    });

    if (error) throw error;
    if (!examId) throw new Error('تعذر إنشاء الاختبار.');

    previewState = null;

    // فشل التخزين المؤقت لا يعني فشل الحفظ؛ لا نُظهر خطأً بعد إنشاء الاختبار.
    try {
      window.sessionStorage.setItem('examFlash', 'تم حفظ الاختبار بنجاح.');
    } catch {
      // تجاهل: الاختبار محفوظ بالفعل.
    }

    window.location.assign(`./exam-view.html?id=${encodeURIComponent(examId)}`);
  } catch (error) {
    showFormError(errorBox, friendlyError(error));
    toast('تعذر حفظ الاختبار. حاول مرة أخرى.', 'error');
  } finally {
    isSaving = false;
    setButtonBusy(saveButton, false);
    saveButton.textContent = 'حفظ الاختبار';
    updatePointSummary();
  }
}

// ------------------------------------------------------------
function shuffleCopy(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}
