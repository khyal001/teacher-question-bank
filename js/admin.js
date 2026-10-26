import { supabase } from './supabase.js';
import { applyNavigationRole, initNav, requireAuth } from './auth.js';
import { createRequestGate } from './data-utils.js';
import { loadAdminData } from './admin-utils.js';
import { formatDate, friendlyError, h, renderEmptyState } from './ui.js';

const content = document.getElementById('admin-content');
const denied = document.getElementById('admin-denied');
const status = document.getElementById('admin-status');
const stats = document.getElementById('admin-stats');
const teachers = document.getElementById('admin-teachers');
const search = document.getElementById('admin-search');
const sort = document.getElementById('admin-sort');
const count = document.getElementById('admin-count');
const page = document.getElementById('admin-page');
const prev = document.getElementById('admin-prev');
const next = document.getElementById('admin-next');
const refresh = document.getElementById('admin-refresh');
const gate = createRequestGate();
const pageSize = 25;
let offset = 0;
let searchTimer;

init();

async function init() {
  const user = await requireAuth();
  if (!user) return;
  initNav('admin', user);
  document.getElementById('admin-filters').addEventListener('submit', (event) => event.preventDefault());
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { offset = 0; loadPage(); }, 350);
  });
  sort.addEventListener('change', () => { offset = 0; loadPage(); });
  refresh.addEventListener('click', loadPage);
  prev.addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadPage(); });
  next.addEventListener('click', () => { offset += pageSize; loadPage(); });
  await loadPage();
}

async function loadPage() {
  const request = gate.next();
  status.hidden = false;
  status.textContent = 'جارٍ التحقق وتحميل بيانات الإدارة...';
  prev.disabled = true;
  next.disabled = true;
  refresh.disabled = true;
  try {
    const result = await loadAdminData(supabase, { search: search.value.trim(), sort: sort.value, offset, limit: pageSize });
    if (!gate.isCurrent(request)) return;
    applyNavigationRole('admin');
    // Each refresh authorizes again; never leave old personal data visible on denial.
    stats.replaceChildren(...result.entries.map((entry) => h('article', { class: 'stat-card admin-stat-card' },
      h('span', { class: 'muted', text: entry.label }), h('strong', { text: String(entry.value) }))));
    renderTeachers(result.teachers);
    count.textContent = `${result.total} معلم`;
    page.textContent = `صفحة ${Math.floor(offset / pageSize) + 1}`;
    prev.disabled = offset === 0;
    next.disabled = offset + pageSize >= result.total;
    denied.hidden = true;
    content.hidden = false;
    status.hidden = true;
  } catch (error) {
    if (!gate.isCurrent(request)) return;
    applyNavigationRole('teacher');
    content.hidden = true;
    stats.replaceChildren();
    teachers.replaceChildren();
    denied.hidden = error?.code !== '42501';
    status.hidden = !denied.hidden;
    status.textContent = friendlyError(error);
  } finally {
    if (gate.isCurrent(request)) refresh.disabled = false;
  }
}

function renderTeachers(rows) {
  teachers.replaceChildren();
  if (!rows.length) {
    renderEmptyState(teachers, { title: 'لا توجد نتائج', hint: 'جرّب اسمًا أو بريدًا مختلفًا.' });
    return;
  }
  const columns = [
    ['display_name', 'الاسم'], ['email', 'البريد الإلكتروني'], ['created_at', 'تاريخ التسجيل'],
    ['email_confirmed', 'تأكيد البريد'], ['last_sign_in_at', 'آخر تسجيل دخول'],
    ['subject_count', 'المواد'], ['group_count', 'الصفوف والفصول والأقسام'],
    ['question_count', 'الأسئلة'], ['exam_count', 'الاختبارات'], ['letterhead_count', 'قوالب الكليشة'],
  ];
  const body = h('tbody');
  for (const row of rows) {
    body.appendChild(h('tr', {}, ...columns.map(([key, label]) => {
      let value = row[key] ?? '—';
      if (key === 'created_at' || key === 'last_sign_in_at') value = formatDate(value, true);
      if (key === 'email_confirmed') value = value === true ? 'مؤكد' : 'غير مؤكد';
      return h('td', { dataset: { label }, dir: key === 'email' ? 'ltr' : null, text: String(value) });
    })));
  }
  const table = h('table', { class: 'data-table admin-teachers-table' },
    h('thead', {}, h('tr', {}, ...columns.map(([, label]) => h('th', { scope: 'col', text: label })))), body);
  teachers.appendChild(h('div', { class: 'table-wrap' }, table));
}
