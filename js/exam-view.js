// عرض الاختبار المحفوظ من snapshot، أو عرض قائمة الاختبارات عند غياب id.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  TYPE_LABELS,
  answerDisplay,
  formatDate,
  formatPoints,
  friendlyError,
  h,
  renderEmptyState,
  renderInlineError,
  toast,
} from './ui.js';

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const params = new URLSearchParams(window.location.search);
const examId = (params.get('id') || '').trim();

const examSection = document.getElementById('exam-section');
const examPaper = document.getElementById('exam-paper');
const examError = document.getElementById('exam-error');
const examLoading = document.getElementById('exam-loading');
const examsListSection = document.getElementById('exams-list-section');
const examsList = document.getElementById('exams-list');
const examsCount = document.getElementById('exams-count');

let currentUser = null;
let answerKeyVisible = false;
let printCleanup = null;

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('exams', currentUser);
  bindToolbar();
  showFlashMessage();

  if (examId) {
    await loadExam(examId);
  } else {
    await loadExamList();
  }
}

function bindToolbar() {
  document.getElementById('toggle-answers-btn').addEventListener('click', () => {
    setAnswerKeyVisible(!answerKeyVisible);
  });

  document.getElementById('print-exam-btn').addEventListener('click', () => {
    document.body.classList.remove('print-answers');
    window.print();
  });

  document.getElementById('print-answers-btn').addEventListener('click', printAnswerKey);
}

// ------------------------------------------------------------
// الاختبار المفرد
// ------------------------------------------------------------
async function loadExam(id) {
  if (!isUuid(id)) {
    showExamError('معرّف الاختبار غير صالح. تأكد من الرابط ثم حاول مجدداً.');
    return;
  }

  setInlineLoading(true);
  updateHead({
    eyebrow: 'الاختبار المحفوظ',
    title: 'جارٍ تحميل الاختبار...',
    subtitle: 'يتم جلب النسخة المحفوظة من الاختبار.',
  });

  try {
    const { data: exam, error: examQueryError } = await supabase
      .from('exams')
      .select('id, title, subject_name_snapshot, grade_level_snapshot, duration_minutes, created_at')
      .eq('id', id)
      .maybeSingle();

    if (examQueryError) throw examQueryError;

    if (!exam) {
      showExamError('الاختبار غير موجود أو لا تملك صلاحية الوصول إليه.');
      return;
    }

    const { data: rows, error: rowsError } = await supabase
      .from('exam_questions')
      .select('id, position, snapshot')
      .eq('exam_id', id)
      .order('position', { ascending: true });

    if (rowsError) throw rowsError;

    renderExam(exam, rows || []);

    updateHead({
      eyebrow: 'الاختبار المحفوظ',
      title: exam.title,
      subtitle: `${exam.subject_name_snapshot}${exam.grade_level_snapshot ? ` — ${exam.grade_level_snapshot}` : ''} · ${(rows || []).length} سؤال`,
    });

    document.title = `${exam.title} | بنك أسئلة المعلم`;
    examSection.hidden = false;
    examLoading.hidden = true;
  } catch (error) {
    showExamError(friendlyError(error));
  } finally {
    setInlineLoading(false);
  }
}

function renderExam(exam, rows) {
  examPaper.replaceChildren();

  const totalPoints = rows.reduce((sum, row) => {
    return sum + Number(row.snapshot?.points || 0);
  }, 0);

  const grade = exam.grade_level_snapshot || 'غير محدد';

  const header = h(
    'header',
    { class: 'exam-paper-head' },
    h(
      'div',
      { class: 'exam-paper-top' },
      h('span', { class: 'exam-brand', text: 'بنك أسئلة المعلم' }),
      h('span', { class: 'exam-date', text: `تاريخ الإنشاء: ${formatDate(exam.created_at)}` }),
    ),
    h('h1', { class: 'exam-title', text: exam.title }),
    h(
      'div',
      { class: 'exam-meta' },
      metaItem('المادة', exam.subject_name_snapshot),
      metaItem('الصف / المستوى', grade),
      metaItem('المدة', exam.duration_minutes ? `${exam.duration_minutes} دقيقة` : 'غير محددة'),
      metaItem('الدرجة الكلية', `${formatPoints(totalPoints)} درجة`),
    ),
    h(
      'div',
      { class: 'exam-student-line' },
      h(
        'span',
        { class: 'student-field' },
        h('span', { text: 'اسم الطالب: ' }),
        h('span', { class: 'fill-line', 'aria-hidden': 'true' }),
      ),
      h(
        'span',
        { class: 'student-field student-grade' },
        h('span', { text: 'الدرجة: ' }),
        h('span', { class: 'fill-line fill-line-short', 'aria-hidden': 'true' }),
      ),
    ),
  );

  examPaper.appendChild(header);

  const questionsSection = h('section', {
    class: 'exam-questions',
    'aria-label': 'أسئلة الاختبار',
  });

  if (rows.length === 0) {
    questionsSection.appendChild(
      h('p', { class: 'exam-empty', text: 'لا توجد أسئلة محفوظة في هذا الاختبار.' }),
    );
  } else {
    for (const row of rows) {
      questionsSection.appendChild(renderExamQuestion(row));
    }
  }

  examPaper.appendChild(questionsSection);

  const answerKey = renderAnswerKey(exam, rows);
  examPaper.appendChild(answerKey);

  examPaper.appendChild(h('p', { class: 'exam-end', text: 'انتهت الأسئلة' }));

  answerKeyVisible = false;
  setAnswerKeyVisible(false);
}

function renderExamQuestion(row) {
  const snapshot = row.snapshot || {};
  const type = snapshot.type;
  const points = Number(snapshot.points || 0);

  const question = h(
    'section',
    { class: 'exam-question' },
    h(
      'div',
      { class: 'exam-q-head' },
      h('span', { class: 'exam-q-number', text: String(row.position) }),
      h(
        'div',
        { class: 'exam-q-badges' },
        h('span', { class: 'exam-q-type', text: TYPE_LABELS[type] || 'سؤال' }),
        h('span', { class: 'exam-q-points', text: `(${formatPoints(points)} درجة)` }),
      ),
    ),
    h('p', { class: 'exam-q-text', text: snapshot.question_text || '' }),
  );

  if (type === 'mcq') {
    const options = Array.isArray(snapshot.options) ? snapshot.options : [];
    const list = h('ol', { class: 'exam-options' });

    options.forEach((option, index) => {
      list.appendChild(
        h(
          'li',
          { class: 'exam-option' },
          h('span', { class: 'exam-option-letter', text: OPTION_LETTERS[index] || String(index + 1) }),
          h('span', { class: 'exam-option-text', text: option }),
        ),
      );
    });

    question.appendChild(list);
  } else if (type === 'true_false') {
    question.appendChild(
      h(
        'div',
        { class: 'exam-tf-options' },
        tfOption('صح'),
        tfOption('خطأ'),
      ),
    );
  } else {
    const lines = Math.min(6, Math.max(2, Math.ceil(points / 2)));
    const space = h('div', { class: 'exam-answer-space', 'aria-hidden': 'true' });
    for (let index = 0; index < lines; index += 1) {
      space.appendChild(h('span', { class: 'answer-line' }));
    }
    question.appendChild(space);
  }

  return question;
}

function tfOption(label) {
  return h(
    'span',
    { class: 'exam-tf-option' },
    h('span', { class: 'exam-checkbox', 'aria-hidden': 'true' }),
    h('span', { text: label }),
  );
}

function renderAnswerKey(exam, rows) {
  const list = h('ol', { class: 'answer-key-list' });

  for (const row of rows) {
    const snapshot = row.snapshot || {};

    list.appendChild(
      h(
        'li',
        { class: 'answer-key-item' },
        h('span', { class: 'key-number', text: String(row.position) }),
        h(
          'div',
          { class: 'key-body' },
          h('p', { class: 'key-question', text: snapshot.question_text || '' }),
          h(
            'p',
            { class: 'key-answer' },
            h('span', { text: 'الإجابة: ' }),
            h('strong', { text: keyAnswer(snapshot) }),
          ),
        ),
      ),
    );
  }

  return h(
    'section',
    { class: 'answer-key', id: 'answer-key' },
    h(
      'div',
      { class: 'answer-key-head' },
      h('span', { class: 'exam-brand', text: 'بنك أسئلة المعلم' }),
      h('h2', { class: 'answer-key-title', text: 'نموذج الإجابة' }),
      h(
        'p',
        { class: 'answer-key-meta' },
        `${exam.title} — ${exam.subject_name_snapshot}${exam.grade_level_snapshot ? ` — ${exam.grade_level_snapshot}` : ''}`,
      ),
    ),
    rows.length === 0
      ? h('p', { class: 'exam-empty', text: 'لا توجد إجابات محفوظة.' })
      : list,
  );
}

function keyAnswer(snapshot) {
  if (snapshot.type === 'mcq') {
    const options = Array.isArray(snapshot.options) ? snapshot.options : [];
    const index = options.indexOf(snapshot.correct_answer);
    const letter = index >= 0 ? OPTION_LETTERS[index] || String(index + 1) : '';
    return `${letter ? `${letter} — ` : ''}${snapshot.correct_answer || '—'}`;
  }

  return answerDisplay(snapshot.type, snapshot.correct_answer);
}

function metaItem(label, value) {
  return h(
    'span',
    { class: 'exam-meta-item' },
    h('span', { class: 'exam-meta-label', text: label }),
    h('strong', { text: value || '—' }),
  );
}

function setAnswerKeyVisible(visible) {
  answerKeyVisible = visible;

  const key = document.getElementById('answer-key');
  if (key) key.hidden = !visible;

  const button = document.getElementById('toggle-answers-btn');
  if (button) {
    button.textContent = visible ? 'إخفاء نموذج الإجابة' : 'إظهار نموذج الإجابة';
    button.setAttribute('aria-expanded', String(visible));
  }
}

function printAnswerKey() {
  const key = document.getElementById('answer-key');
  if (!key) return;

  const wasHidden = key.hidden;
  key.hidden = false;
  document.body.classList.add('print-answers');

  if (printCleanup) {
    window.removeEventListener('afterprint', printCleanup);
    printCleanup = null;
  }

  let cleaned = false;
  printCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('print-answers');
    key.hidden = wasHidden;
    window.removeEventListener('afterprint', printCleanup);
    printCleanup = null;
  };

  window.addEventListener('afterprint', printCleanup);
  window.print();

  // احتياطي للمتصفحات التي لا تطلق afterprint.
  window.setTimeout(() => {
    if (!cleaned) printCleanup?.();
  }, 2500);
}

// ------------------------------------------------------------
// قائمة الاختبارات
// ------------------------------------------------------------
async function loadExamList() {
  setInlineLoading(false);
  updateHead({
    eyebrow: 'الاختبارات المحفوظة',
    title: 'الاختبارات المحفوظة',
    subtitle: 'افتح أي اختبار لعرضه وطباعته، أو أنشئ اختباراً جديداً.',
  });
  document.title = 'الاختبارات | بنك أسئلة المعلم';

  examsListSection.hidden = false;
  examSection.hidden = true;
  examError.hidden = true;

  const [examsResult, rowsResult] = await Promise.all([
    supabase
      .from('exams')
      .select('id, title, subject_name_snapshot, grade_level_snapshot, duration_minutes, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('exam_questions')
      .select('exam_id')
      .eq('user_id', currentUser.id),
  ]);

  if (examsResult.error) {
    examsCount.textContent = '—';
    renderInlineError(examsList, friendlyError(examsResult.error));
    return;
  }

  if (rowsResult.error) {
    examsCount.textContent = '—';
    renderInlineError(examsList, friendlyError(rowsResult.error));
    return;
  }

  const counts = new Map();
  for (const row of rowsResult.data || []) {
    counts.set(row.exam_id, (counts.get(row.exam_id) || 0) + 1);
  }

  renderExamList(examsResult.data || [], counts);
}

function renderExamList(exams, counts) {
  examsCount.textContent = `${exams.length} اختبار`;
  examsList.replaceChildren();

  if (exams.length === 0) {
    renderEmptyState(examsList, {
      title: 'لا توجد اختبارات محفوظة',
      hint: 'ولّد اختباراً من بنك أسئلتك واحفظه ليظهر هنا.',
      action: h('a', { class: 'btn btn-primary btn-sm', href: './exam-builder.html' }, 'إنشاء اختبار'),
    });
    return;
  }

  for (const exam of exams) {
    const count = counts.get(exam.id) || 0;
    const openUrl = `./exam-view.html?id=${encodeURIComponent(exam.id)}`;

    examsList.appendChild(
      h(
        'article',
        { class: 'exam-list-card' },
        h(
          'div',
          { class: 'exam-list-main' },
          h('h3', { class: 'exam-list-title' }, h('a', { href: openUrl, text: exam.title })),
          h(
            'div',
            { class: 'exam-list-meta' },
            h('span', { text: exam.subject_name_snapshot }),
            exam.grade_level_snapshot ? h('span', { text: exam.grade_level_snapshot }) : null,
            h('span', { text: `${count} سؤال` }),
            exam.duration_minutes ? h('span', { text: `${exam.duration_minutes} دقيقة` }) : null,
            h('span', { text: formatDate(exam.created_at, true) }),
          ),
        ),
        h(
          'div',
          { class: 'row-actions' },
          h('a', { class: 'btn btn-primary btn-sm', href: openUrl }, 'فتح الاختبار'),
          h(
            'button',
            {
              class: 'btn btn-danger-ghost btn-sm',
              type: 'button',
              onclick: () => confirmDeleteExam(exam),
            },
            'حذف',
          ),
        ),
      ),
    );
  }
}

async function confirmDeleteExam(exam) {
  const message = [
    `هل تريد حذف الاختبار «${exam.title}»؟`,
    '',
    'سيتم حذف سجل الاختبار وأسئلته المحفوظة.',
    'بنك أسئلتك الأصلي لن يتأثر.',
    '',
    'لا يمكن التراجع عن هذا الإجراء.',
  ].join('\n');

  if (!window.confirm(message)) return;

  try {
    const { error } = await supabase.from('exams').delete().eq('id', exam.id);
    if (error) throw error;

    toast('تم حذف الاختبار المحفوظ.');
    await loadExamList();
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

// ------------------------------------------------------------
// مساعدات
// ------------------------------------------------------------
function updateHead({ eyebrow, title, subtitle }) {
  document.getElementById('view-eyebrow').textContent = eyebrow;
  document.getElementById('view-title').textContent = title;
  document.getElementById('view-subtitle').textContent = subtitle;
}

function setInlineLoading(show) {
  examLoading.hidden = !show;
}

function showExamError(message) {
  examError.replaceChildren(
    h('strong', { text: 'تعذر عرض الاختبار' }),
    h('p', { text: message }),
    h('a', { class: 'btn btn-outline btn-sm', href: './exam-view.html' }, 'عرض قائمة الاختبارات'),
  );
  examError.hidden = false;
  examSection.hidden = true;
  examLoading.hidden = true;
  examsListSection.hidden = true;
  updateHead({
    eyebrow: 'الاختبار المحفوظ',
    title: 'تعذر عرض الاختبار',
    subtitle: 'لا توجد بيانات لعرضها.',
  });
  document.title = 'تعذر عرض الاختبار | بنك أسئلة المعلم';
}

function showFlashMessage() {
  const message = window.sessionStorage.getItem('examFlash');
  if (!message) return;

  window.sessionStorage.removeItem('examFlash');
  toast(message, 'success');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
