import { createLibraryPage } from './library-page.js';
import { fetchAll } from './data-utils.js';
import { createRequestGate } from './data-utils.js';
// إدارة المواد وربطها بصفوف وفصول وأقسام دراسية متعددة، ومشاركة أسئلتها بأمان.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  copyText,
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
const idInput = document.getElementById('subject-id');
const nameInput = document.getElementById('subject-name');
const groupsList = document.getElementById('subject-groups-list');
const newGroupInput = document.getElementById('new-group-name');
const addGroupButton = document.getElementById('add-group-inline-btn');
const groupInlineError = document.getElementById('group-inline-error');
const errorBox = document.getElementById('subject-error');
const dialogTitle = document.getElementById('subject-dialog-title');
const saveButton = document.getElementById('save-subject-btn');

const shareDialog = document.getElementById('share-dialog');
const shareSubjectName = document.getElementById('share-subject-name');
const shareExpiry = document.getElementById('share-expiry');
const createShareButton = document.getElementById('create-share-btn');
const shareLinkArea = document.getElementById('share-link-area');
const shareLinkInput = document.getElementById('share-link-input');
const copyShareButton = document.getElementById('copy-share-btn');
const shareLinkMeta = document.getElementById('share-link-meta');
const shareError = document.getElementById('share-error');
const sharesList = document.getElementById('shares-list');
const sharesCount = document.getElementById('shares-count');

const page = createLibraryPage('subjects', subjectsList, () => loadSubjects());
let dialogVersion = 0;
let currentUser = null;
let subjects = [];
let allGroups = [];
let subjectGroups = new Map();
let questionCounts = new Map();
let currentShareSubject = null;
const shareRequests = createRequestGate();
let shareDialogVersion = 0;

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  bindEvents();
  const bootstrap = loadSubjects(true);
  initNav('subjects', currentUser, { rolePromise: bootstrap.then((data) => data?.metadata?.role || 'teacher') });
  await bootstrap;
}

function bindEvents() {
  document.getElementById('add-subject-btn').addEventListener('click', () => openDialog());
  dialog.addEventListener('close', () => { dialogVersion++; });
  form.addEventListener('submit', handleSubmit);
  addGroupButton.addEventListener('click', handleInlineGroupAdd);
  newGroupInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleInlineGroupAdd();
    }
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.querySelectorAll('[data-close-share]').forEach((button) => {
    button.addEventListener('click', () => shareDialog.close());
  });

  shareDialog.addEventListener('click', (event) => {
    if (event.target === shareDialog) shareDialog.close();
  });

  shareDialog.addEventListener('close', () => { shareDialogVersion++; shareRequests.next(); });
  createShareButton.addEventListener('click', createShare);
  copyShareButton.addEventListener('click', async () => {
    if (!shareLinkInput.value) return;
    const copied = await copyText(shareLinkInput.value);
    toast(copied ? 'تم نسخ رابط المشاركة.' : 'تعذر النسخ تلقائياً. حدّد الرابط وانسخه يدوياً.', copied ? 'success' : 'error');
  });
}

// ------------------------------------------------------------
// تحميل البيانات
// ------------------------------------------------------------
async function loadSubjects(includeMetadata = false) {
  try {
    const data = await page.load(includeMetadata);
    if (!data) return null;
    subjects = data.items;
    subjectGroups = new Map(subjects.map((subject) => [subject.id, subject.groups.map((g) => g.id)]));
    questionCounts = new Map(subjects.map((subject) => [subject.id, subject.question_count]));
    renderSubjects();
    page.rendered();
    return data;
  } catch (error) {
    subjectsCount.textContent = '—';
    renderInlineError(subjectsList, friendlyError(error));
    return null;
  }
}

async function loadAllGroups() {
  const { data, error } = await fetchAll(supabase
    .from('teaching_groups')
    .select('id, name', { count: 'exact' })
    .eq('user_id', currentUser.id)
    .order('name', { ascending: true }), ['id']);

  if (error) throw error;
  allGroups = data || [];
}

function groupsOfSubject(subjectId) {
  return subjects.find((subject) => subject.id === subjectId)?.groups || [];
}

// ------------------------------------------------------------
// العرض
// ------------------------------------------------------------
function renderSubjects() {
  subjectsCount.textContent = `${page.total} مادة`;
  subjectsList.replaceChildren();

  if (subjects.length === 0) {
    renderEmptyState(subjectsList, {
      title: 'لا توجد مواد حتى الآن',
      hint: 'ابدأ بإضافة المادة التي تدرّسها، واربطها بصف / فصل / قسم واحد على الأقل.',
      action: h(
        'button',
        { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openDialog() },
        'إضافة أول مادة',
      ),
    });
    return;
  }

  const list = h('div', { class: 'subject-list' });

  for (const subject of subjects) {
    list.appendChild(renderSubjectCard(subject));
  }

  subjectsList.appendChild(list);
}

function renderSubjectCard(subject) {
  const groups = groupsOfSubject(subject.id);
  const count = questionCounts.get(subject.id) || 0;

  const chips = h('div', { class: 'group-chips' });

  if (groups.length === 0) {
    chips.appendChild(
      h('span', { class: 'group-chip is-muted', text: 'بدون صفوف وفصول وأقسام' }),
    );
    chips.appendChild(
      h('span', { class: 'group-chip-hint', text: 'مادة قديمة محفوظة كما هي. أضف صفوف وفصول وأقسام عند تعديلها.' }),
    );
  } else {
    for (const group of groups) {
      chips.appendChild(h('span', { class: 'group-chip', text: group.name }));
    }
  }

  return h(
    'article',
    { class: 'subject-card' },
    h(
      'div',
      { class: 'subject-card-main' },
      h(
        'div',
        { class: 'subject-card-head' },
        h('h3', { class: 'subject-card-title', text: subject.name }),
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
      chips,
      h('p', { class: 'subject-card-date', text: `أُضيفت في ${formatDate(subject.created_at, true)}` }),
    ),
    h(
      'div',
      { class: 'subject-card-actions' },
      h('a', { class: 'btn btn-ghost btn-sm', href: `./questions.html?subject=${encodeURIComponent(subject.id)}` }, 'الأسئلة'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openDialog(subject) }, 'تعديل'),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => openShare(subject) }, 'مشاركة'),
      h('button', { class: 'btn btn-danger-ghost btn-sm', type: 'button', onclick: () => confirmDelete(subject, count) }, 'حذف'),
    ),
  );
}

// ------------------------------------------------------------
// نموذج المادة والصفوف والفصول والأقسام
// ------------------------------------------------------------
async function openDialog(subject = null) {
  const version = ++dialogVersion;
  const isEdit = Boolean(subject);

  idInput.value = subject?.id || '';
  nameInput.value = subject?.name || '';
  newGroupInput.value = '';
  showFormError(errorBox, '');
  showFormError(groupInlineError, '');

  const selected = new Set(subject ? subjectGroups.get(subject.id) || [] : []);
  groupsList.replaceChildren(h('p', { text: 'جارٍ تحميل الصفوف والفصول والأقسام...' }));

  dialogTitle.textContent = isEdit ? 'تعديل المادة' : 'إضافة مادة';
  saveButton.textContent = isEdit ? 'حفظ التعديلات' : 'حفظ المادة';

  dialog.showModal();
  nameInput.focus();
  saveButton.disabled = true;
  try {
    await loadAllGroups();
    if (version === dialogVersion && dialog.open) renderGroupCheckboxes(selected);
  } catch (error) {
    if (version === dialogVersion) showFormError(errorBox, friendlyError(error));
  } finally {
    if (version === dialogVersion) saveButton.disabled = false;
  }
}

function renderGroupCheckboxes(selectedIds = new Set()) {
  groupsList.replaceChildren();

  if (allGroups.length === 0) {
    groupsList.appendChild(
      h('p', { class: 'form-hint', text: 'لا توجد صفوف وفصول وأقسام بعد. أضف صف / فصل / قسم جديد من الأسفل، أو من صفحة الصفوف والفصول والأقسام.' }),
    );
    return;
  }

  if (allGroups.length === 1) {
    groupsList.appendChild(h('p', { class: 'form-hint', text: `تم اختيار «${allGroups[0].name}» تلقائيًا لأنه الخيار الوحيد المتاح.` }));
  }

  for (const group of allGroups) {
    const checkbox = h('input', {
      type: 'checkbox',
      value: group.id,
      name: 'subject-group',
    });
    checkbox.checked = selectedIds.has(group.id) || allGroups.length === 1;
    checkbox.disabled = allGroups.length === 1;

    groupsList.appendChild(
      h(
        'label',
        { class: 'group-check' },
        checkbox,
        h('span', { class: 'group-check-name', text: group.name }),
      ),
    );
  }
}

function checkedGroupIds() {
  return Array.from(groupsList.querySelectorAll('input[name="subject-group"]:checked')).map(
    (input) => input.value,
  );
}

async function handleInlineGroupAdd() {
  showFormError(groupInlineError, '');

  const name = newGroupInput.value.trim();
  if (!name) {
    showFormError(groupInlineError, 'اكتب اسم الصف / الفصل / القسم الجديد أولاً.');
    newGroupInput.focus();
    return;
  }

  const selected = new Set(checkedGroupIds());
  setButtonBusy(addGroupButton, true, 'جارٍ الإضافة...');

  try {
    const { data, error } = await supabase
      .from('teaching_groups')
      .insert({ name })
      .select('id')
      .single();

    if (error) throw error;

    await loadAllGroups();
    selected.add(data.id);
    renderGroupCheckboxes(selected);
    newGroupInput.value = '';
    toast('تمت الإضافة والتحديد. احفظ المادة لتثبيت الربط.');
  } catch (error) {
    const message = String(error?.code || '') === '23505'
      ? 'يوجد صف / فصل / قسم بالاسم نفسه. اختر اسمًا مختلفاً.'
      : friendlyError(error);
    showFormError(groupInlineError, message);
  } finally {
    setButtonBusy(addGroupButton, false);
    addGroupButton.textContent = 'إضافة صف / فصل / قسم';
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  showFormError(errorBox, '');

  const name = nameInput.value.trim();
  const editingId = idInput.value || null;
  const groupIds = checkedGroupIds();

  if (!name) {
    showFormError(errorBox, 'اسم المادة مطلوب.');
    nameInput.focus();
    return;
  }

  if (groupIds.length === 0) {
    showFormError(errorBox, 'اختر صف / فصل / قسم واحد على الأقل قبل حفظ المادة.');
    return;
  }

  setButtonBusy(saveButton, true, editingId ? 'جارٍ حفظ التعديلات...' : 'جارٍ حفظ المادة...');

  try {
    const { error } = await supabase.rpc('save_subject', {
      p_id: editingId,
      p_name: name,
      p_group_ids: groupIds,
    });

    if (error) throw error;

    dialog.close();
    toast(editingId ? 'تم حفظ تعديلات المادة وصفوفها وفصولها وأقسامها.' : 'تمت إضافة المادة بنجاح.');
    await loadSubjects();
  } catch (error) {
    showFormError(errorBox, friendlyError(error));
  } finally {
    setButtonBusy(saveButton, false);
    saveButton.textContent = idInput.value ? 'حفظ التعديلات' : 'حفظ المادة';
  }
}

async function confirmDelete(subject, count) {
  const groups = groupsOfSubject(subject.id);
  const message = [
    `هل تريد حذف مادة «${subject.name}»؟`,
    '',
    `سيتم حذف ${count} سؤالاً تابعة لها من بنك الأسئلة.`,
    groups.length > 0
      ? `سيُزال ارتباطها بـ ${groups.length} صف / فصل / قسم، دون حذف الصفوف والفصول والأقسام نفسها.`
      : 'هذه المادة غير مرتبطة بأي صف / فصل / قسم.',
    'ستُلغى روابط المشاركة النشطة لهذه المادة تلقائياً.',
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

// ------------------------------------------------------------
// مشاركة آمنة
// ------------------------------------------------------------
async function openShare(subject) {
  shareDialogVersion++;
  setButtonBusy(createShareButton, false);
  currentShareSubject = subject;
  shareSubjectName.textContent = `${subject.name} — ${(questionCounts.get(subject.id) || 0)} سؤال`;
  shareExpiry.value = '7';
  shareLinkArea.hidden = true;
  shareLinkInput.value = '';
  showFormError(shareError, '');
  sharesList.replaceChildren();
  sharesCount.textContent = '—';

  shareDialog.showModal();
  await loadShares(subject.id);
}

async function loadShares(subjectId) {
  const request = shareRequests.next();
  const { data, error } = await fetchAll(supabase
    .from('question_share_packages')
    .select('id, subject_name_snapshot, question_count, created_at, expires_at, revoked_at, used_at')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false }), ['id']);

  if (!shareRequests.isCurrent(request) || currentShareSubject?.id !== subjectId || !shareDialog.open) return;

  if (error) {
    sharesCount.textContent = '—';
    sharesList.replaceChildren(
      h('p', { class: 'form-error', text: friendlyError(error) }),
    );
    return;
  }

  const shares = data || [];
  sharesCount.textContent = `${shares.length} رابط`;
  sharesList.replaceChildren();

  if (shares.length === 0) {
    sharesList.appendChild(
      h('p', { class: 'form-hint', text: 'لا توجد روابط مشاركة لهذه المادة بعد.' }),
    );
    return;
  }

  for (const share of shares) {
    sharesList.appendChild(renderShareRow(share));
  }
}

function shareStatus(share) {
  if (share.used_at) return { label: 'استُخدم', className: 'is-used' };
  if (share.revoked_at) return { label: 'ملغى', className: 'is-revoked' };
  if (new Date(share.expires_at).getTime() <= Date.now()) return { label: 'منتهي', className: 'is-expired' };
  return { label: 'نشط', className: 'is-active' };
}

function renderShareRow(share) {
  const status = shareStatus(share);
  const canRevoke = status.className === 'is-active';

  return h(
    'article',
    { class: 'share-row' },
    h(
      'div',
      { class: 'share-row-main' },
      h(
        'div',
        { class: 'share-row-title' },
        h('span', { class: `status-pill ${status.className}`, text: status.label }),
        h('strong', { text: `${share.question_count} سؤال` }),
      ),
      h(
        'p',
        { class: 'share-row-meta' },
        `أُنشئ في ${formatDate(share.created_at, true)} · ينتهي في ${formatDate(share.expires_at, true)}`,
      ),
    ),
    canRevoke
      ? h(
          'button',
          {
            class: 'btn btn-danger-ghost btn-sm',
            type: 'button',
            onclick: () => revokeShare(share),
          },
          'إلغاء الرابط',
        )
      : null,
  );
}

async function createShare() {
  if (!currentShareSubject) return;

  showFormError(shareError, '');
  shareLinkArea.hidden = true;
  const subjectId = currentShareSubject.id;
  const dialogVersion = shareDialogVersion;
  setButtonBusy(createShareButton, true, 'جارٍ إنشاء الرابط...');

  try {
    const days = Number(shareExpiry.value || 7);
    const { data, error } = await supabase.rpc('create_question_share', {
      p_subject_id: subjectId,
      p_expires_days: days,
    });

    if (dialogVersion !== shareDialogVersion || currentShareSubject?.id !== subjectId || !shareDialog.open) return;
    if (error) throw error;
    if (!data?.token) throw new Error('تعذر إنشاء رابط المشاركة.');

    const url = new URL('./share-import.html', window.location.href);
    url.search = '';
    url.hash = `token=${data.token}`;

    shareLinkInput.value = url.href;
    shareLinkMeta.textContent =
      `${data.question_count} سؤال · ${data.group_count} صف / فصل / قسم · ينتهي في ${formatDate(data.expires_at, true)}`;
    shareLinkArea.hidden = false;
    shareLinkInput.focus();
    shareLinkInput.select();

    toast('تم إنشاء رابط المشاركة. انسخه الآن.');
    await loadShares(currentShareSubject.id);
  } catch (error) {
    if (dialogVersion === shareDialogVersion && currentShareSubject?.id === subjectId && shareDialog.open) showFormError(shareError, friendlyError(error));
  } finally {
    if (dialogVersion === shareDialogVersion) {
      setButtonBusy(createShareButton, false);
      createShareButton.textContent = 'إنشاء رابط مشاركة';
    }
  }
}

async function revokeShare(share) {
  const subjectId = currentShareSubject?.id;
  if (!window.confirm('هل تريد إلغاء رابط المشاركة؟ لن يعمل بعد الآن، ولا يمكن التراجع.')) return;

  try {
    const { data, error } = await supabase.rpc('revoke_question_share', {
      p_share_id: share.id,
    });

    if (error) throw error;
    if (data !== true) {
      throw new Error('تعذر إلغاء الرابط. قد يكون مستخدماً أو ملغى مسبقاً.');
    }

    toast('تم إلغاء رابط المشاركة.');
    if (currentShareSubject?.id === subjectId) await loadShares(subjectId);
  } catch (error) {
    toast(friendlyError(error), 'error');
  }
}
