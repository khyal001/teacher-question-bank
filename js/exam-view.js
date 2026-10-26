import { createLibraryPage } from './library-page.js';
import { renderLetterhead } from './letterhead-utils.js';
import { fetchAll } from './data-utils.js';
import { createSignedUrlCache, waitForPrintAssets } from './data-utils.js';
// عرض الاختبار المحفوظ من snapshot، أو عرض قائمة الاختبارات عند غياب id.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  ASSET_BUCKET,
  PRINT_NOTICE_STORAGE_KEY,
  answerDisplay,
  formatDate,
  formatPoints,
  friendlyError,
  h,
  readLocalFlag,
  renderEmptyState,
  renderInlineError,
  shorten,
  toast,
  writeLocalFlag,
} from './ui.js';
import {
  historicalGrade,
  EXAM_FOOTER_TEXT,
  MCQ_INSTRUCTION,
  SHORT_INSTRUCTION,
  TF_INSTRUCTION,
  buildExamSections,
  chooseMcqLayout,
  snapshotPoints,
  totalFromRows,
} from './exam-utils.js';

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const params = new URLSearchParams(window.location.search);
const examId = (params.get('id') || '').trim();

const examSection = document.getElementById('exam-section');
const examPaper = document.getElementById('exam-paper');
const examError = document.getElementById('exam-error');
const examLoading = document.getElementById('exam-loading');
const examPageTitle = document.getElementById('exam-page-title');
const examsListSection = document.getElementById('exams-list-section');
const examsList = document.getElementById('exams-list');
const examsCount = document.getElementById('exams-count');
const printButton = document.getElementById('print-btn');
const printAnswerKeyButton = document.getElementById('print-answer-key-btn');
const toggleAnswerKeyButton = document.getElementById('toggle-answer-key');
const printHelpButton = document.getElementById('print-help-btn');

const printNoticeDialog = document.getElementById('print-notice-dialog');
const printNoticeDismiss = document.getElementById('print-notice-dismiss');
const printNoticeContinue = document.getElementById('print-notice-continue');
const printNoticeClose = document.getElementById('print-notice-close');
const printNoticeCloseX = document.getElementById('print-notice-close-x');

const page = createLibraryPage('exams', examsList, () => loadExamList());
let currentUser = null;
let currentExam = null;
let currentRows = [];
let answerKeyVisible = false;
let logoUrl = null;
const signedLogos = createSignedUrlCache(async (path, ttl) => {
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).createSignedUrl(path, ttl);
  if (error) throw error;
  return data.signedUrl;
});
let pendingPrintCallback = null;

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  bindEvents();

  if (examId) {
    initNav('exams', currentUser);
    await loadExam();
  } else {
    examSection.hidden = true;
    examsListSection.hidden = false;
    const bootstrap = loadExamList(true);
    initNav('exams', currentUser, { rolePromise: bootstrap.then((data) => data?.metadata?.role || 'teacher') });
    await bootstrap;
  }

  try {
    const flash = window.sessionStorage.getItem('examFlash');
    if (flash) {
      window.sessionStorage.removeItem('examFlash');
      toast(flash);
    }
  } catch {
    // التخزين المؤقت غير متاح؛ لا يؤثر في عرض الاختبار.
  }
}

function bindEvents() {
  printButton.addEventListener('click', () => printWithNotice('exam'));
  printAnswerKeyButton.addEventListener('click', () => printWithNotice('answers'));
  printHelpButton.addEventListener('click', () => openPrintNotice(null));
  toggleAnswerKeyButton.addEventListener('click', toggleAnswerKey);

  printNoticeContinue.addEventListener('click', () => {
    if (printNoticeDismiss.checked) {
      writeLocalFlag(PRINT_NOTICE_STORAGE_KEY, true);
    }

    const callback = pendingPrintCallback;
    pendingPrintCallback = null;
    printNoticeDialog.close();

    if (callback) callback();
  });

  printNoticeClose.addEventListener('click', closePrintNotice);
  printNoticeCloseX.addEventListener('click', closePrintNotice);

  printNoticeDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePrintNotice();
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-answers');
  });
}

function closePrintNotice() {
  pendingPrintCallback = null;
  printNoticeDialog.close();
}

// ------------------------------------------------------------
// تحميل الاختبار
// ------------------------------------------------------------
async function loadExam() {
  examSection.hidden = false;
  examsListSection.hidden = true;
  examLoading.hidden = false;
  examPaper.replaceChildren();
  showExamError('');

  try {
    const { data: exam, error } = await supabase
      .from('exams')
      .select(
        'id, title, subject_id, subject_name_snapshot, grade_level_snapshot, total_points, group_names_snapshot, letterhead_snapshot, closing_phrase, created_at',
      )
      .eq('id', examId)
      .maybeSingle();

    if (error) throw error;
    if (!exam) {
      throw new Error('لم يتم العثور على الاختبار المطلوب، أو لا تملك صلاحية الوصول إليه.');
    }

    const { data: rows, error: rowsError } = await fetchAll(supabase
      .from('exam_questions')
      .select('id, question_id, position, snapshot', { count: 'exact' })
      .eq('exam_id', examId)
      .order('position', { ascending: true }), ['id']);

    if (rowsError) throw rowsError;

    currentExam = exam;
    currentRows = rows || [];
    logoUrl = null;

    const logoPath = exam.letterhead_snapshot?.logo_path;
    if (logoPath) {
      logoUrl = await signedLogos.get(logoPath);
    }

    examPageTitle.textContent = exam.title;
    examPaper.appendChild(renderExamPaper(exam, currentRows, logoUrl));
    examLoading.hidden = true;
  } catch (error) {
    examLoading.hidden = true;
    showExamError(friendlyError(error));
  }
}

function showExamError(message) {
  if (!message) {
    examError.textContent = '';
    examError.hidden = true;
    return;
  }
  examError.textContent = message;
  examError.hidden = false;
}

// ------------------------------------------------------------
// بناء ورقة الاختبار
// ------------------------------------------------------------
function renderExamPaper(exam, rows, signedLogoUrl) {
  const wrapper = h('div', { class: 'exam-paper-inner' });
  const sections = buildExamSections(rows);
  const totalPoints = effectiveTotal(exam, rows);

  wrapper.appendChild(renderExamHeader(exam, totalPoints, signedLogoUrl));

  const questionsBlock = h('div', { class: 'exam-questions' });

  for (const section of sections) {
    questionsBlock.appendChild(renderSection(section));
  }

  wrapper.appendChild(questionsBlock);
  const ending = h('div', { class: 'exam-ending' });

  if (exam.closing_phrase) {
    ending.appendChild(
      h(
        'div',
        { class: 'exam-closing' },
        h('p', { text: exam.closing_phrase }),
      ),
    );
  }

  ending.appendChild(
    h(
      'div',
      { class: 'exam-generated-footer' },
      h('span', { text: EXAM_FOOTER_TEXT }),
    ),
  );

  wrapper.appendChild(ending);
  wrapper.appendChild(renderAnswerKey(exam, sections, totalPoints));

  return wrapper;
}

function effectiveTotal(exam, rows) {
  const stored = Number(exam.total_points);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return totalFromRows(rows);
}

function renderExamHeader(exam, totalPoints, signedLogoUrl) {
  const header = h('header', { class: 'exam-paper-head' });
  const letterhead = exam.letterhead_snapshot;

  if (letterhead && hasLetterheadContent(letterhead)) {
    header.appendChild(renderLetterhead(letterhead, signedLogoUrl, h));
  } else {
    header.appendChild(
      h(
        'div',
        { class: 'exam-default-brand' },
        h('img', { class: 'exam-default-mark', src: './favicon.svg?v=teacher-bank-1', alt: '' }),
        h('span', { text: 'بنك أسئلة المعلم' }),
      ),
    );
  }

  header.appendChild(h('h1', { class: 'exam-title', text: exam.title }));

  const meta = h('div', { class: 'exam-meta' });

  if (exam.subject_name_snapshot) {
    meta.appendChild(h('span', { class: 'exam-meta-item', text: `المادة: ${exam.subject_name_snapshot}` }));
  }

  const oldGrade = historicalGrade(exam);
  if (oldGrade) meta.appendChild(h('span', { class: 'exam-meta-item', text: `الصف التاريخي: ${oldGrade}` }));

  const groups = Array.isArray(exam.group_names_snapshot) ? exam.group_names_snapshot.filter(Boolean) : [];
  if (groups.length > 0) {
    meta.appendChild(h('span', { class: 'exam-meta-item', text: `الصفوف والفصول والأقسام: ${groups.join('، ')}` }));
  }

  header.appendChild(meta);

  header.appendChild(
    h(
      'div',
      { class: 'exam-header-bottom' },
      h(
        'div',
        { class: 'exam-student-fields' },
        h(
          'div',
          { class: 'exam-student-line' },
          h('span', { class: 'exam-student-label', text: 'اسم الطالب:' }),
          h('span', { class: 'exam-fill-line', 'aria-hidden': 'true' }),
        ),
        h(
          'div',
          { class: 'exam-student-line is-short' },
          h('span', { class: 'exam-student-label', text: 'رقم الطالب/رقم الجلوس:' }),
          h('span', { class: 'exam-fill-line is-short', 'aria-hidden': 'true' }),
        ),
      ),
      h(
        'div',
        { class: 'score-box-wrap' },
        h('span', { class: 'score-box-label', text: 'درجة الاختبار' }),
        h(
          'div',
          { class: 'score-box', 'aria-label': 'خانة درجة الاختبار' },
          h('div', { class: 'score-box-top', 'aria-hidden': 'true' }),
          h('div', { class: 'score-box-total', text: formatPoints(totalPoints) }),
        ),
      ),
    ),
  );

  return header;
}

function hasLetterheadContent(letterhead) {
  return Boolean(
    letterhead.logo_path ||
      letterhead.entity_name ||
      letterhead.school_name ||
      letterhead.university_name ||
      letterhead.college_name ||
      letterhead.department_name ||
      letterhead.extra_text,
  );
}

function renderSection(section) {
  const block = h('section', { class: `exam-section exam-section-${section.type}` });

  let heading = SHORT_INSTRUCTION;
  if (section.type === 'true_false') heading = TF_INSTRUCTION;
  if (section.type === 'mcq') heading = MCQ_INSTRUCTION;

  const sectionHead = h('div', { class: 'exam-section-title' }, h('h2', { class: 'exam-section-heading', text: heading }));
  if (section.type !== 'short') sectionHead.appendChild(h('span', { class: 'exam-grade-left', text: `${formatPoints(totalFromRows(section.items.map((entry) => entry.row)))} درجة` }));
  block.appendChild(sectionHead);

  if (section.type === 'mcq') {
    const list = h('div', { class: 'exam-mcq-list' });
    for (const entry of section.items) {
      list.appendChild(renderMcqQuestion(entry));
    }
    block.appendChild(list);
  } else if (section.type === 'true_false') {
    const list = h('div', { class: 'exam-tf-list' });
    for (const entry of section.items) {
      list.appendChild(renderTrueFalseQuestion(entry));
    }
    block.appendChild(list);
  } else {
    const list = h('div', { class: 'exam-short-list' });
    for (const entry of section.items) {
      list.appendChild(renderShortQuestion(entry));
    }
    block.appendChild(list);
  }

  return block;
}

function questionPrefix(entry) {
  return h(
    'span',
    { class: 'exam-q-number' },
    h('strong', { text: `${entry.displayNumber}.` }),
  );
}

function renderTrueFalseQuestion(entry) {
  const text = entry.row.snapshot?.question_text || '';

  return h(
    'div',
    { class: 'exam-tf-item' },
    h(
      'p',
      { class: 'exam-tf-text' },
      questionPrefix(entry),
      h('span', { class: 'exam-q-text', text }),
    ),
    h('span', { class: 'tf-answer-box', 'aria-hidden': 'true', text: '(     )' }),
  );
}

function renderMcqQuestion(entry) {
  const snapshot = entry.row.snapshot || {};
  const options = Array.isArray(snapshot.options) ? snapshot.options : [];
  const layout = chooseMcqLayout(options, snapshot.layout || 'auto');

  const item = h(
    'div',
    { class: 'exam-mcq-item' },
    h(
      'p',
      { class: 'exam-mcq-text' },
      questionPrefix(entry),
      h('span', { class: 'exam-q-text', text: snapshot.question_text || '' }),
    ),
  );

  const list = h('ol', { class: `exam-mcq-options layout-${layout}` });

  options.forEach((option, index) => {
    list.appendChild(
      h(
        'li',
        { class: 'exam-mcq-option' },
        h('span', { class: 'exam-option-letter', text: OPTION_LETTERS[index] || String(index + 1) }),
        h('span', { class: 'exam-option-text', text: option }),
      ),
    );
  });

  item.appendChild(list);
  return item;
}

function renderShortQuestion(entry) {
  const points = snapshotPoints(entry.row);
  const lineCount = Math.min(8, Math.max(2, Math.ceil(points / 2)));

  const item = h(
    'div',
    { class: 'exam-short-item' },
    h('div', { class: 'exam-short-grade' }, h('span', { class: 'exam-grade-left', text: `${formatPoints(points)} درجة` })),
    h(
      'p',
      { class: 'exam-short-text' },
      questionPrefix(entry),
      h('span', { class: 'exam-q-text', text: entry.row.snapshot?.question_text || '' }),
    ),
  );

  const lines = h('div', { class: 'exam-answer-lines' });
  for (let index = 0; index < lineCount; index += 1) {
    lines.appendChild(h('span', { class: 'exam-answer-line', 'aria-hidden': 'true' }));
  }
  item.appendChild(lines);

  return item;
}

// ------------------------------------------------------------
// نموذج الإجابة
// ------------------------------------------------------------
function renderAnswerKey(exam, sections, totalPoints) {
  const block = h('section', { class: 'answer-key', 'aria-label': 'نموذج الإجابة' });

  const groups = Array.isArray(exam.group_names_snapshot)
    ? exam.group_names_snapshot.filter(Boolean)
    : [];

  block.appendChild(
    h(
      'header',
      { class: 'answer-key-head' },
      h('p', { class: 'eyebrow', text: 'نموذج الإجابة' }),
      h('h1', { text: exam.title }),
      h(
        'p',
        { class: 'answer-key-meta' },
        `${exam.subject_name_snapshot || 'مادة'} · ${groups.length ? groups.join('، ') : historicalGrade(exam) || 'بدون صفوف وفصول وأقسام'} · ${formatPoints(totalPoints)} درجة`,
      ),
    ),
  );

  for (const section of sections) {
    const sectionBlock = h('div', { class: `answer-key-section answer-key-section-${section.type}` });
    sectionBlock.appendChild(
      h('h2', {
        text:
          section.type === 'true_false'
            ? 'صح / خطأ'
            : section.type === 'mcq'
              ? 'اختيار من متعدد'
              : 'إجابة قصيرة',
      }),
    );

    for (const entry of section.items) {
      const snapshot = entry.row.snapshot || {};
      sectionBlock.appendChild(
        h(
          'div',
          { class: 'answer-key-item' },
          h('span', { class: 'answer-key-number', text: `${entry.displayNumber}.` }),
          h('span', { class: 'answer-key-question', text: shorten(snapshot.question_text || '', 140) }),
          h('strong', { class: 'answer-key-answer', text: answerKeyText(snapshot) }),
        ),
      );
    }

    block.appendChild(sectionBlock);
  }

  return block;
}

function answerKeyText(snapshot) {
  if (snapshot.type === 'mcq') {
    const options = Array.isArray(snapshot.options) ? snapshot.options : [];
    const index = options.indexOf(snapshot.correct_answer);
    if (index !== -1) {
      return `${OPTION_LETTERS[index] || String(index + 1)}) ${snapshot.correct_answer}`;
    }
    return answerDisplay('mcq', snapshot.correct_answer);
  }

  return answerDisplay(snapshot.type, snapshot.correct_answer);
}

// ------------------------------------------------------------
// قائمة الاختبارات
// ------------------------------------------------------------
async function loadExamList(includeMetadata = false) {
  let data;
  try {
    data = await page.load(includeMetadata);
    if (!data) return null;
  } catch (error) {
    renderInlineError(examsList, friendlyError(error));
    return null;
  }
  const exams = data.items;
  examsCount.textContent = `${page.total} اختبار`;
  examsList.replaceChildren();

  if (exams.length === 0) {
    renderEmptyState(examsList, {
      title: 'لا توجد اختبارات محفوظة',
      hint: 'ولّد اختباراً من بنك أسئلتك، ثم احفظه ليظهر هنا جاهزاً للطباعة.',
      action: h(
        'a',
        { class: 'btn btn-primary btn-sm', href: './exam-builder.html' },
        'إنشاء أول اختبار',
      ),
    });
    page.rendered();
    return data;
  }

  for (const exam of exams) {
    examsList.appendChild(renderExamListItem(exam));
  }
  page.rendered();
  return data;
}

function renderExamListItem(exam) {
  const groups = Array.isArray(exam.group_names_snapshot)
    ? exam.group_names_snapshot.filter(Boolean)
    : [];

  return h(
    'article',
    { class: 'exam-list-item' },
    h(
      'div',
      { class: 'exam-list-main' },
      h('h2', { class: 'exam-list-title' }, h('a', { href: `./exam-view.html?id=${encodeURIComponent(exam.id)}` }, exam.title)),
      h(
        'div',
        { class: 'exam-list-meta' },
        h('span', { text: exam.subject_name_snapshot || 'مادة' }),
        h('span', { class: 'dot', 'aria-hidden': 'true', text: '•' }),
        h('span', { text: `${formatPoints(exam.total_points)} درجة` }),
        groups.length > 0
          ? h('span', { class: 'exam-list-groups', text: groups.join('، ') })
          : h('span', { class: 'muted', text: historicalGrade(exam) || 'بدون صفوف وفصول وأقسام' }),
        h('span', { class: 'dot', 'aria-hidden': 'true', text: '•' }),
        h('span', { text: formatDate(exam.created_at, true) }),
      ),
    ),
    h(
      'div',
      { class: 'row-actions' },
      h('a', { class: 'btn btn-primary btn-sm', href: `./exam-view.html?id=${encodeURIComponent(exam.id)}` }, 'فتح'),
      h('a', { class: 'btn btn-secondary btn-sm', href: `./exam-builder.html?source=${encodeURIComponent(exam.id)}&mode=edit` }, 'تعديل'),
      h('a', { class: 'btn btn-secondary btn-sm', href: `./exam-builder.html?source=${encodeURIComponent(exam.id)}&mode=copy` }, 'نسخ'),
      h(
        'button',
        { class: 'btn btn-danger-ghost btn-sm', type: 'button', onclick: () => deleteExam(exam) },
        'حذف',
      ),
    ),
  );
}

async function deleteExam(exam) {
  const message = [
    `هل تريد حذف اختبار «${exam.title}»؟`,
    '',
    'ستُحذف نسخ الأسئلة المحفوظة داخل هذا الاختبار فقط.',
    'لن تتأثر أسئلتك الأصلية في بنك الأسئلة.',
    '',
    'لا يمكن التراجع عن هذا الإجراء.',
  ].join('\n');

  if (!window.confirm(message)) return;

  try {
    const { error } = await supabase.from('exams').delete().eq('id', exam.id);
    if (error) throw error;

    toast('تم حذف الاختبار.');
    await loadExamList();
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}

// ------------------------------------------------------------
// نموذج الإجابة والطباعة
// ------------------------------------------------------------
function toggleAnswerKey() {
  answerKeyVisible = !answerKeyVisible;
  document.body.classList.toggle('show-answer-key', answerKeyVisible);
  toggleAnswerKeyButton.setAttribute('aria-pressed', String(answerKeyVisible));
  toggleAnswerKeyButton.textContent = answerKeyVisible
    ? 'إخفاء نموذج الإجابة'
    : 'إظهار نموذج الإجابة';
  printAnswerKeyButton.hidden = !answerKeyVisible;

  if (answerKeyVisible) {
    document.querySelector('.answer-key')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function printWithNotice(mode) {
  const callback = async () => {
    if (mode === 'answers') {
      document.body.classList.add('print-answers');
    } else {
      document.body.classList.remove('print-answers');
      if (answerKeyVisible) {
        document.body.classList.add('show-answer-key');
      }
    }

    printButton.disabled = true;
    printAnswerKeyButton.disabled = true;
    try {
      if (!currentExam) throw new Error('انتظر اكتمال تحميل الاختبار قبل الطباعة.');
      const path = currentExam.letterhead_snapshot?.logo_path;
      if (path) {
        const image = examPaper.querySelector('.exam-letterhead-logo');
        const freshUrl = await signedLogos.get(path);
        if (image && image.src !== freshUrl) image.src = freshUrl;
      }
      await waitForPrintAssets(examPaper.ownerDocument);
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      window.print();
    } catch (error) {
      document.body.classList.remove('print-answers');
      toast(friendlyError(error), 'error');
    } finally {
      printButton.disabled = false;
      printAnswerKeyButton.disabled = false;
    }
  };

  if (readLocalFlag(PRINT_NOTICE_STORAGE_KEY)) {
    callback();
    return;
  }

  openPrintNotice(callback, mode);
}

function openPrintNotice(callback, mode = 'exam') {
  pendingPrintCallback = callback;
  printNoticeDismiss.checked = false;
  printNoticeContinue.hidden = !callback;
  printNoticeContinue.textContent = mode === 'answers' ? 'متابعة طباعة النموذج' : 'متابعة الطباعة';
  printNoticeClose.textContent = callback ? 'إلغاء' : 'حسناً';
  printNoticeDialog.showModal();
}
