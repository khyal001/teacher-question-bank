import { fetchAll } from './data-utils.js';
// استيراد حزمة مشاركة إلى حساب المعلم الحالي عبر RPC آمن.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  DIFFICULTY_LABELS,
  TYPE_LABELS,
  formatDate,
  friendlyError,
  h,
  setButtonBusy,
  showFormError,
  toast,
} from './ui.js';

const tokenGate = document.getElementById('token-gate');
const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('token-input');
const tokenSubmit = document.getElementById('token-submit');
const tokenError = document.getElementById('token-error');

const previewSection = document.getElementById('preview-section');
const previewSubjectName = document.getElementById('preview-subject-name');
const previewQuestionCount = document.getElementById('preview-question-count');
const previewMeta = document.getElementById('preview-meta');
const importSubjectName = document.getElementById('import-subject-name');
const mappingSection = document.getElementById('mapping-section');
const mappingList = document.getElementById('mapping-list');
const importError = document.getElementById('import-error');
const importButton = document.getElementById('import-btn');
const importEmpty = document.getElementById('import-empty');

let currentUser = null;
let recipientGroups = [];
let previewToken = '';
let previewPackage = null;
let isImporting = false;

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('subjects', currentUser);
  bindEvents();
  await loadRecipientGroups();

  const initialToken = extractTokenFromLocation();
  if (initialToken) {
    tokenInput.value = initialToken;
    await loadPreview(initialToken);
  } else {
    importEmpty.hidden = false;
  }
}

function bindEvents() {
  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = extractToken(tokenInput.value);
    if (!token) {
      showFormError(tokenError, 'الرابط أو المفتاح غير صالح. تأكد من نسخ الرابط كاملاً.');
      tokenInput.focus();
      return;
    }
    loadPreview(token);
  });

  importButton.addEventListener('click', importPackage);
}

async function loadRecipientGroups() {
  const { data, error } = await fetchAll(supabase
    .from('teaching_groups')
    .select('id, name')
    .eq('user_id', currentUser.id)
    .order('name', { ascending: true }), ['id']);

  if (error) {
    toast(friendlyError(error), 'error');
    return;
  }

  recipientGroups = data || [];
}

function extractTokenFromLocation() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  return extractToken(hashParams.get('token') || '');
}

function extractToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (/^[a-f0-9]{32,128}$/i.test(text)) return text;

  try {
    const url = new URL(text, window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const candidate = hashParams.get('token') || '';
    return /^[a-f0-9]{32,128}$/i.test(candidate) ? candidate : '';
  } catch {
    return '';
  }
}

async function loadPreview(token) {
  showFormError(tokenError, '');
  showFormError(importError, '');
  previewSection.hidden = true;
  importEmpty.hidden = true;
  setButtonBusy(tokenSubmit, true, 'جارٍ التحقق...');

  try {
    const { data, error } = await supabase.rpc('get_question_share_preview', {
      p_token: token,
    });

    if (error) throw error;
    if (!data?.package) throw new Error('تعذر قراءة حزمة المشاركة.');

    previewToken = token;
    previewPackage = data.package;

    tokenGate.hidden = true;
    renderPreview(data);
    previewSection.hidden = false;

    // إبقاء المفتاح في الرابط بعد التحقق حتى يمكن إعادة التحميل بأمان.
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = `token=${token}`;
    window.history.replaceState(null, '', url.href);
  } catch (error) {
    tokenGate.hidden = false;
    importEmpty.hidden = false;
    showFormError(tokenError, friendlyError(error));
  } finally {
    setButtonBusy(tokenSubmit, false);
    tokenSubmit.textContent = 'عرض الحزمة';
  }
}

function renderPreview(data) {
  const packageData = data.package;
  const questions = Array.isArray(packageData.questions) ? packageData.questions : [];
  const groups = Array.isArray(packageData.groups) ? packageData.groups : [];

  previewSubjectName.textContent = packageData.subject_name || 'مادة بدون اسم';
  previewQuestionCount.textContent = `${questions.length} سؤال`;

  const typeCounts = new Map();
  const difficultyCounts = new Map();

  for (const question of questions) {
    if (question.type) typeCounts.set(question.type, (typeCounts.get(question.type) || 0) + 1);
    if (question.difficulty) {
      difficultyCounts.set(question.difficulty, (difficultyCounts.get(question.difficulty) || 0) + 1);
    }
  }

  previewMeta.replaceChildren(
    metaChip('المادة', packageData.subject_name || '—'),
    metaChip('عدد الأسئلة', String(questions.length)),
    metaChip('الصفوف والفصول والأقسام', String(groups.length)),
    metaChip('ينتهي الرابط', formatDate(data.expires_at, true)),
    ...Array.from(typeCounts.entries()).map(([type, count]) =>
      metaChip(TYPE_LABELS[type] || type, `${count}`),
    ),
    ...Array.from(difficultyCounts.entries()).map(([difficulty, count]) =>
      metaChip(DIFFICULTY_LABELS[difficulty] || difficulty, `${count}`),
    ),
  );

  importSubjectName.value = packageData.subject_name || '';

  renderMapping(groups);
}

function metaChip(label, value) {
  return h(
    'span',
    { class: 'preview-meta-chip' },
    h('span', { class: 'preview-meta-label', text: label }),
    h('strong', { text: value }),
  );
}

function renderMapping(groups) {
  mappingList.replaceChildren();

  if (groups.length === 0) {
    mappingSection.hidden = true;
    return;
  }

  mappingSection.hidden = false;

  for (const group of groups) {
    mappingList.appendChild(createMappingRow(group));
  }
}

function createMappingRow(sourceGroup) {
  const sourceName = sourceGroup.name || 'صف / فصل / قسم بدون اسم';
  const modeSelect = h(
    'select',
    { class: 'mapping-mode', 'aria-label': `طريقة ربط ${sourceName}` },
    h('option', { value: 'new' }, 'إنشاء صف / فصل / قسم جديد'),
    h('option', { value: 'existing', disabled: recipientGroups.length === 0 }, 'ربط بصف / فصل / قسم موجود'),
    h('option', { value: 'skip' }, 'تأجيل الربط'),
  );

  const existingSelect = h(
    'select',
    { class: 'mapping-existing', 'aria-label': `الصف / الفصل / القسم الموجود المقابل لـ ${sourceName}` },
    ...(recipientGroups.length > 0
      ? recipientGroups.map((group) => h('option', { value: group.id }, group.name))
      : [h('option', { value: '' }, 'لا توجد صفوف وفصول وأقسام موجودة')]),
  );
  existingSelect.hidden = true;
  existingSelect.disabled = recipientGroups.length === 1;
  if (recipientGroups.length === 1) existingSelect.value = recipientGroups[0].id;
  const existingNote = recipientGroups.length === 1
    ? h('small', { class: 'form-hint', text: `الخيار الموجود الوحيد: «${recipientGroups[0].name}». سيحدد تلقائيًا عند اختيار الربط بخيار موجود.` })
    : null;

  const newNameInput = h('input', {
    type: 'text',
    class: 'mapping-new-name',
    maxlength: '120',
    value: sourceName,
    'aria-label': `اسم الصف / الفصل / القسم الجديد المقابل لـ ${sourceName}`,
  });

  const extra = h(
    'div',
    { class: 'mapping-extra' },
    existingSelect,
    existingNote,
    newNameInput,
  );

  const row = h(
    'div',
    { class: 'mapping-row', dataset: { sourceId: sourceGroup.source_id || '' } },
    h(
      'div',
      { class: 'mapping-source' },
      h('span', { class: 'mapping-source-label', text: 'الصف / الفصل / القسم في الحزمة' }),
      h('strong', { text: sourceName }),
    ),
    modeSelect,
    extra,
  );

  const updateVisibility = () => {
    const mode = modeSelect.value;
    existingSelect.hidden = mode !== 'existing';
    if (existingNote) existingNote.hidden = mode !== 'existing';
    newNameInput.hidden = mode !== 'new';
  };

  modeSelect.addEventListener('change', updateVisibility);
  updateVisibility();

  return row;
}

function collectMapping() {
  const mapping = {};

  for (const row of mappingList.querySelectorAll('.mapping-row')) {
    const sourceId = row.dataset.sourceId;
    if (!sourceId) continue;

    const mode = row.querySelector('.mapping-mode')?.value || 'skip';

    if (mode === 'existing') {
      const groupId = row.querySelector('.mapping-existing')?.value || '';
      if (!groupId) {
        throw new Error('اختر صف / فصل / قسم موجود لكل صف / فصل / قسم اخترت ربطها بصف / فصل / قسم موجود.');
      }
      mapping[sourceId] = { mode: 'existing', group_id: groupId };
    } else if (mode === 'new') {
      const name = row.querySelector('.mapping-new-name')?.value.trim() || '';
      if (!name) {
        throw new Error('اكتب اسماً لكل صف / فصل / قسم جديد، أو اختر «تأجيل الربط».');
      }
      mapping[sourceId] = { mode: 'new', name };
    }
  }

  return mapping;
}

async function importPackage() {
  if (!previewPackage || isImporting) return;

  showFormError(importError, '');

  const subjectName = importSubjectName.value.trim();
  if (!subjectName) {
    showFormError(importError, 'اسم المادة مطلوب.');
    importSubjectName.focus();
    return;
  }

  let mapping = {};
  try {
    mapping = collectMapping();
  } catch (error) {
    showFormError(importError, error.message);
    return;
  }

  isImporting = true;
  setButtonBusy(importButton, true, 'جارٍ استيراد الحزمة...');

  try {
    const { data, error } = await supabase.rpc('accept_question_share', {
      p_token: previewToken,
      p_subject_name: subjectName,
      p_group_mapping: mapping,
    });

    if (error) throw error;
    if (!data?.subject_id) throw new Error('تعذر استيراد الحزمة.');

    try {
      window.sessionStorage.setItem(
        'questionsFlash',
        `تم استيراد ${data.question_count || 0} سؤالاً إلى المادة «${data.subject_name || subjectName}».`,
      );
    } catch {
      // الاستيراد تم بالفعل؛ تعذّر عرض رسالة مؤقتة فقط.
    }

    window.location.replace(
      `./questions.html?subject=${encodeURIComponent(data.subject_id)}`,
    );
  } catch (error) {
    showFormError(importError, friendlyError(error));
  } finally {
    isImporting = false;
    setButtonBusy(importButton, false);
    importButton.textContent = 'استيراد الحزمة إلى حسابي';
  }
}
