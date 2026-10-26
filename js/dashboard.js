import { fetchAll } from './data-utils.js';
// لوحة التحكم: إحصائيات سريعة وآخر الأسئلة.
import { supabase } from './supabase.js';
import { initNav, requireAuth, displayName } from './auth.js';
import {
  DIFFICULTY_LABELS,
  TYPE_LABELS,
  formatDate,
  friendlyError,
  h,
  renderEmptyState,
  renderInlineError,
} from './ui.js';

const latestContainer = document.getElementById('latest-questions');

init();

async function init() {
  const user = await requireAuth();
  if (!user) return;

  initNav('dashboard', user);
  document.getElementById('welcome-name').textContent = displayName(user);

  await Promise.all([loadStats(user), loadLatestQuestions()]);
}

async function loadStats(user) {
  const [subjectsResult, questionsResult, examsResult, difficultyResult] = await Promise.all([
    supabase.from('subjects').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('questions').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('exams').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    fetchAll(supabase.from('questions').select('difficulty').eq('user_id', user.id), ['id']),
  ]);

  const firstError = [subjectsResult, questionsResult, examsResult, difficultyResult]
    .find((result) => result.error)?.error;

  if (firstError) {
    document.getElementById('difficulty-total').textContent = 'تعذر تحميل الإحصائيات.';
    return;
  }

  document.getElementById('stat-subjects').textContent = String(subjectsResult.count ?? 0);
  document.getElementById('stat-questions').textContent = String(questionsResult.count ?? 0);
  document.getElementById('stat-exams').textContent = String(examsResult.count ?? 0);

  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const row of difficultyResult.data || []) {
    if (row.difficulty in counts) counts[row.difficulty] += 1;
  }

  const total = counts.easy + counts.medium + counts.hard;

  for (const key of ['easy', 'medium', 'hard']) {
    document.getElementById(`count-${key}`).textContent = String(counts[key]);
    const percent = total > 0 ? Math.round((counts[key] / total) * 100) : 0;
    document.getElementById(`bar-${key}`).style.width = `${percent}%`;
  }

  document.getElementById('difficulty-total').textContent = `إجمالي الأسئلة: ${total}`;
}

async function loadLatestQuestions() {
  const { data, error } = await supabase
    .from('questions')
    .select('id, question_text, type, difficulty, created_at, subjects(name)')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    renderInlineError(latestContainer, friendlyError(error));
    return;
  }

  if (!data || data.length === 0) {
    renderEmptyState(latestContainer, {
      title: 'لا توجد أسئلة حتى الآن',
      hint: 'أضف أول سؤال إلى بنك أسئلتك لتظهر هنا.',
      action: h('a', { class: 'btn btn-primary btn-sm', href: './questions.html?new=1' }, 'إضافة سؤال'),
    });
    return;
  }

  latestContainer.replaceChildren();

  for (const question of data) {
    const subject = Array.isArray(question.subjects) ? question.subjects[0] : question.subjects;

    latestContainer.appendChild(
      h(
        'article',
        { class: 'latest-item' },
        h(
          'div',
          { class: 'latest-meta' },
          h('span', { class: `badge badge-${question.difficulty}`, text: DIFFICULTY_LABELS[question.difficulty] || question.difficulty }),
          h('span', { class: 'badge badge-type', text: TYPE_LABELS[question.type] || question.type }),
        ),
        h('p', { class: 'latest-text', text: question.question_text }),
        h(
          'div',
          { class: 'latest-foot' },
          h('span', { text: subject ? subject.name : 'مادة محذوفة' }),
          h('span', { text: formatDate(question.created_at, true) }),
        ),
      ),
    );
  }
}
