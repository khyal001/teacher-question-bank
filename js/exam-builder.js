// مولّد الاختبار: اختيار عشوائي، معاينة ثابتة، استبدال، ثم حفظ snapshot كامل.
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

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const form = document.getElementById('exam-form');
const subjectSelect = document.getElementById('exam-subject');
const titleInput = document.getElementById('exam-title');
const durationInput = document.getElementById('exam-duration');
const shuffleInput = document.getElementById('shuffle-options');
const errorBox = document.getElementById('builder-error');
const availabilityNote = document.getElementById('availability-note');
const generateButton = document.getElementById('generate-btn');

const previewArea = document.getElementById('preview-area');
const previewCount = document.getElementById('preview-count');
const previewActions = document.getElementById('preview-actions');
const saveButton = document.getElementById('save-exam-btn');

let currentUser = null;
let subjects = [];
let subjectQuestions = [];
let previewState = null;
let questionsToken = 0;
let isSaving = false;

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('builder', currentUser);
  bindEvents();
  await loadSubjects();
}

function bindEvents() {
  subjectSelect.addEventListener('change', async () => {
    clearPreview();
    await loadSubjectQuestions();
  });

  form.addEventListener('submit', handleGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', () => form.requestSubmit());
  document.getElementById('cancel-preview-btn').addEventListener('click', clearPreview);
  saveButton.addEventListener('click', saveExam);
}

// ------------------------------------------------------------
// المواد والأسئلة المتاحة
// ------------------------------------------------------------
async function loadSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, grade_level')
    .eq('user_id', currentUser.id)
    .order('name', { ascending: true });

  if (error) {
    showFormError(errorBox, friendlyError(error));
    availabilityNote.textContent = 'تعذر تحميل المواد.';
    return;
  }

  subjects = data || [];

  const options = [h('option', { value: '' }, 'اختر المادة')];
  for (const subject of subjects) {
    options.push(
      h(
        'option',
        { value: subject.id },
        `${subject.name}${subject.grade_level ? ` — ${subject.grade_level}` : ''}`,
      ),
    );
  }
  subjectSelect.replaceChildren(...options);

  const subjectParam = new URLSearchParams(window.location.search).get('subject');
  if (subjectParam && subjects.some((subject) => subject.id === subjectParam)) {
    subjectSelect.value = subjectParam;
    await loadSubjectQuestions();
    return;
  }

  if (subjects.length === 0) {
    availabilityNote.textContent = 'لا توجد مواد بعد. أضف مادة وأسئلتها أولاً.';
  }
}

async function loadSubjectQuestions() {
  const token = ++questionsToken;
  const subjectId = subjectSelect.value;

  subjectQuestions = [];
  updateAvailability();

  if (!subjectId) return;

  availabilityNote.textContent = 'جارٍ تحميل الأسئلة المتاحة...';

  const { data, error } = await supabase
    .from('questions')
    .select('id, subject_id, unit, type, question_text, options, correct_answer, difficulty, points')
    .eq('user_id', currentUser.id)
    .eq('subject_id', subjectId);

  if (token !== questionsToken) return;

  if (error) {
    availabilityNote.textContent = 'تعذر تحميل الأسئلة.';
    showFormError(errorBox, friendlyError(error));
    return;
  }

  subjectQuestions = data || [];
  updateAvailability();
}

function updateAvailability() {
  const counts = { easy: 0, medium: 0, hard: 0 };

  for (const question of subjectQuestions) {
    if (question.difficulty in counts) counts[question.difficulty] += 1;
  }

  for (const key of ['easy', 'medium', 'hard']) {
    document.getElementById(`available-${key}`).textContent = `المتاح: ${counts[key]}`;
  }

  const total = counts.easy + counts.medium + counts.hard;
  const subject = subjects.find((item) => item.id === subjectSelect.value);

  if (!subjectSelect.value) {
    availabilityNote.textContent = 'اختر المادة لعرض الأسئلة المتاحة.';
  } else if (total === 0) {
    availabilityNote.textContent = 'لا توجد أسئلة في هذه المادة. أضف أسئلة أولاً من صفحة الأسئلة.';
  } else {
    availabilityNote.textContent =
      `المتاح في «${subject?.name || 'المادة'}»: ${total} سؤال ` +
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

  const durationRaw = durationInput.value.trim();
  let duration = null;

  if (durationRaw) {
    duration = Number(durationRaw);
    if (!Number.isInteger(duration) || duration <= 0) {
      showFormError(errorBox, 'المدة يجب أن تكون عدداً صحيحاً أكبر من صفر، أو اتركها فارغة.');
      durationInput.focus();
      return;
    }
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

  if (subjectQuestions.length === 0) {
    showFormError(errorBox, 'لا توجد أسئلة في هذه المادة. أضف أسئلة أولاً.');
    return;
  }

  const available = { easy: 0, medium: 0, hard: 0 };
  for (const question of subjectQuestions) {
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

  const selected = [];

  for (const key of ['easy', 'medium', 'hard']) {
    const pool = shuffleCopy(subjectQuestions.filter((question) => question.difficulty === key));
    selected.push(...pool.slice(0, requested[key]));
  }

  const ordered = shuffleCopy(selected);
  const items = ordered.map((question) => buildItem(question));

  previewState = {
    subject,
    title,
    duration,
    items,
  };

  renderPreview();
  showFormError(errorBox, '');

  if (window.matchMedia('(max-width: 980px)').matches) {
    previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function buildItem(question) {
  let options = null;

  if (question.type === 'mcq') {
    options = Array.isArray(question.options) ? [...question.options] : [];
    if (shuffleInput.checked) {
      options = shuffleCopy(options);
    }
  }

  return { question, options };
}

// ------------------------------------------------------------
// المعاينة
// ------------------------------------------------------------
function renderPreview() {
  if (!previewState) return;

  const { subject, title, duration, items } = previewState;
  const totalPoints = items.reduce((sum, item) => sum + Number(item.question.points || 0), 0);
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
      h(
        'span',
        { class: 'preview-subject' },
        `${subject.name}${subject.grade_level ? ` — ${subject.grade_level}` : ''}`,
      ),
    ),
    h(
      'div',
      { class: 'preview-stats' },
      h('span', { class: 'preview-stat' }, h('strong', { text: String(items.length) }), ' سؤال'),
      h('span', { class: 'preview-stat' }, h('strong', { text: formatPoints(totalPoints) }), ' درجة'),
      duration ? h('span', { class: 'preview-stat' }, h('strong', { text: String(duration) }), ' دقيقة') : null,
      h(
        'span',
        { class: 'preview-stat preview-stat-difficulty' },
        `سهل ${difficultyCounts.easy} · متوسط ${difficultyCounts.medium} · صعب ${difficultyCounts.hard}`,
      ),
    ),
  );

  const list = h('div', { class: 'preview-list' });

  items.forEach((item, index) => {
    list.appendChild(renderPreviewQuestion(item, index));
  });

  previewArea.replaceChildren(summary, list);
  previewActions.hidden = false;
}

function renderPreviewQuestion(item, index) {
  const question = item.question;

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
        h('span', { class: 'badge badge-points', text: `${formatPoints(question.points)} درجة` }),
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => replaceQuestion(index),
        },
        'استبدال',
      ),
    ),
    h('p', { class: 'preview-q-text', text: question.question_text }),
  );

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

function replaceQuestion(index) {
  if (!previewState) return;

  const current = previewState.items[index];
  const usedIds = new Set(previewState.items.map((item) => item.question.id));

  const eligible = subjectQuestions.filter(
    (question) =>
      question.id !== current.question.id &&
      !usedIds.has(question.id),
  );

  // الأفضلية لسؤال من نفس مستوى الصعوبة.
  const sameDifficulty = eligible.filter(
    (question) => question.difficulty === current.question.difficulty,
  );
  const pool = sameDifficulty.length > 0 ? sameDifficulty : eligible;

  if (pool.length === 0) {
    toast('لا يوجد سؤال بديل متاح في هذه المادة. أضف أسئلة جديدة أولاً.', 'error');
    return;
  }

  const replacement = pool[Math.floor(Math.random() * pool.length)];
  previewState.items[index] = buildItem(replacement);

  renderPreview();
  toast('تم استبدال السؤال بسؤال آخر.', 'success', 2200);
}

function clearPreview() {
  previewState = null;
  previewCount.textContent = '0 سؤال';
  previewActions.hidden = true;
  renderEmptyState(previewArea, {
    title: 'لم يتم توليد اختبار بعد',
    hint: 'اختر المادة وعدد الأسئلة، ثم اضغط «توليد المعاينة».',
  });
}

// ------------------------------------------------------------
// الحفظ
// ------------------------------------------------------------
async function saveExam() {
  if (!previewState || isSaving) return;

  isSaving = true;
  setButtonBusy(saveButton, true, 'جارٍ حفظ الاختبار...');
  showFormError(errorBox, '');

  let createdExamId = null;

  try {
    // نقرأ المادة حديثاً لضمان تطابق snapshots مع قيمها الحالية وقت الحفظ.
    const { data: subject, error: subjectError } = await supabase
      .from('subjects')
      .select('id, name, grade_level')
      .eq('id', previewState.subject.id)
      .maybeSingle();

    if (subjectError) throw subjectError;
    if (!subject) throw new Error('لم تعد المادة موجودة. أعد توليد المعاينة.');

    const gradeLevel = (subject.grade_level || '').trim();
    if (!gradeLevel) {
      throw new Error('الصف الدراسي للمادة مطلوب. حدّث المادة وأضف الصف ثم أعد المحاولة.');
    }

    const { data: exam, error: examError } = await supabase
      .from('exams')
      .insert({
        subject_id: subject.id,
        subject_name_snapshot: subject.name,
        grade_level_snapshot: gradeLevel,
        title: previewState.title,
        duration_minutes: previewState.duration,
      })
      .select('id')
      .single();

    if (examError) throw examError;
    if (!exam) throw new Error('تعذر إنشاء الاختبار.');

    createdExamId = exam.id;

    const rows = previewState.items.map((item, index) => {
      const question = item.question;

      return {
        exam_id: exam.id,
        question_id: question.id,
        position: index + 1,
        snapshot: {
          question_text: question.question_text,
          type: question.type,
          options: question.type === 'mcq' ? item.options : null,
          correct_answer: question.correct_answer,
          difficulty: question.difficulty,
          points: Number(question.points),
          unit: question.unit || null,
        },
      };
    });

    const { error: questionsError } = await supabase.from('exam_questions').insert(rows);
    if (questionsError) throw questionsError;

    previewState = null;
    window.sessionStorage.setItem('examFlash', 'تم حفظ الاختبار بنجاح.');
    window.location.assign(`./exam-view.html?id=${encodeURIComponent(exam.id)}`);
  } catch (error) {
    // تنظيف الاختبار إذا فشل حفظ أسئلته، حتى لا يبقى سجل ناقص.
    if (createdExamId) {
      try {
        await supabase.from('exams').delete().eq('id', createdExamId);
      } catch {
        // تجاهل خطأ التنظيف؛ سيعرض للمستخدم خطأ الحفظ الأصلي.
      }
    }

    showFormError(errorBox, friendlyError(error));
    toast('تعذر حفظ الاختبار. حاول مرة أخرى.', 'error');
  } finally {
    isSaving = false;
    setButtonBusy(saveButton, false);
    saveButton.textContent = 'حفظ الاختبار';
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
