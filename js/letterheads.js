import { DEFAULT_LETTERHEAD_LAYOUT, layoutError, renderLetterhead } from './letterhead-utils.js';
import { fetchAll } from './data-utils.js';
import { createSignedUrlCache } from './data-utils.js';
// إدارة قوالب الكليشة والشعارات الخاصة في Supabase Storage.
import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import {
  ASSET_BUCKET,
  formatDate,
  friendlyError,
  h,
  renderEmptyState,
  renderInlineError,
  setButtonBusy,
  showFormError,
  toast,
} from './ui.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

const letterheadsList = document.getElementById('letterheads-list');
const letterheadsCount = document.getElementById('letterheads-count');
const dialog = document.getElementById('letterhead-dialog');
const form = document.getElementById('letterhead-form');
const dialogTitle = document.getElementById('letterhead-dialog-title');
const idInput = document.getElementById('letterhead-id');
const nameInput = document.getElementById('letterhead-name');
const entityInput = document.getElementById('letterhead-entity');
const schoolInput = document.getElementById('letterhead-school');
const logoPosition = document.getElementById('letterhead-logo-position');
const entityPosition = document.getElementById('letterhead-entity-position');
const educationPosition = document.getElementById('letterhead-education-position');
const livePreview = document.getElementById('letterhead-live-preview');
const departmentInput = document.getElementById('letterhead-department');
const extraInput = document.getElementById('letterhead-extra');
const fileInput = document.getElementById('letterhead-logo');
const logoImage = document.getElementById('logo-image');
const logoPlaceholder = document.getElementById('logo-placeholder');
const logoStatus = document.getElementById('logo-status');
const removeLogoButton = document.getElementById('remove-logo-btn');
const errorBox = document.getElementById('letterhead-error');
const saveButton = document.getElementById('save-letterhead-btn');

let currentUser = null;
let letterheads = [];
let editing = null;
let pendingFile = null;
let removeCurrentLogo = false;
let objectPreviewUrl = null;
let dialogVersion = 0;
let saving = false;
const signedUrlCache = createSignedUrlCache(async (path, ttl) => {
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).createSignedUrl(path, ttl);
  if (error) throw error;
  return data.signedUrl;
});

init();

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initNav('letterheads', currentUser);
  bindEvents();
  await loadLetterheads();
  window.addEventListener('focus', () => {
    Promise.all(letterheads.filter((row) => row.logo_path).map((row) => getSignedLogoUrl(row.logo_path)))
      .then(renderLetterheads);
  });
}

function bindEvents() {
  document.getElementById('add-letterhead-btn').addEventListener('click', () => openDialog());
  form.addEventListener('submit', handleSubmit);
  form.addEventListener('input', updateLivePreview);
  form.addEventListener('change', updateLivePreview);
  dialog.addEventListener('cancel', () => { dialogVersion++; cleanupObjectUrl(); });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', closeDialog);
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  fileInput.addEventListener('change', handleFileSelection);
  removeLogoButton.addEventListener('click', handleRemoveLogo);
}

async function loadLetterheads() {
  const { data, error } = await fetchAll(supabase
    .from('letterheads')
    .select(
      'id, name, entity_name, school_name, university_name, college_name, department_name, extra_text, logo_path, layout, created_at',
    )
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false }), ['id']);

  if (error) {
    letterheadsCount.textContent = '—';
    renderInlineError(letterheadsList, friendlyError(error));
    return;
  }

  letterheads = data || [];

  await Promise.all(
    letterheads
      .filter((row) => row.logo_path)
      .map((row) => getSignedLogoUrl(row.logo_path)),
  );

  renderLetterheads();
}

async function getSignedLogoUrl(path) {
  try {
    return await signedUrlCache.get(path);
  } catch (error) {
    console.warn('تعذر إنشاء رابط الشعار:', error.message);
    return null;
  }
}

function renderLetterheads() {
  letterheadsCount.textContent = `${letterheads.length} قالب`;
  letterheadsList.replaceChildren();

  if (letterheads.length === 0) {
    renderEmptyState(letterheadsList, {
      title: 'لا توجد قوالب كليشة بعد',
      hint: 'أضف قالباً واحداً على الأقل لاستخدامه في ترويسة اختباراتك.',
      action: h(
        'button',
        { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openDialog() },
        'إضافة أول قالب',
      ),
    });
    return;
  }

  const grid = h('div', { class: 'letterhead-grid' });
  for (const letterhead of letterheads) {
    grid.appendChild(renderLetterheadCard(letterhead));
  }
  letterheadsList.appendChild(grid);
}

function renderLetterheadCard(letterhead) {
  const logoUrl = letterhead.logo_path ? signedUrlCache.peek(letterhead.logo_path) : null;

  return h(
    'article',
    { class: 'letterhead-card' },
    h('div', { class: 'letterhead-card-preview' }, renderLetterhead(letterhead, logoUrl, h)),
    h(
      'div',
      { class: 'letterhead-card-body' },
      h('h3', { class: 'letterhead-card-title', text: letterhead.name }),
      h('p', { class: 'letterhead-card-date', text: `أُضيف في ${formatDate(letterhead.created_at, true)}` }),
      h(
        'div',
        { class: 'row-actions' },
        h(
          'button',
          { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openDialog(letterhead) },
          'تعديل',
        ),
        h(
          'button',
          {
            class: 'btn btn-danger-ghost btn-sm',
            type: 'button',
            onclick: () => confirmDelete(letterhead),
          },
          'حذف',
        ),
      ),
    ),
  );
}

function draftLetterhead() {
  return {
    entity_name: emptyToNull(entityInput.value), school_name: emptyToNull(schoolInput.value),
    department_name: emptyToNull(departmentInput.value), extra_text: emptyToNull(extraInput.value),
    logo_path: pendingFile ? 'pending' : removeCurrentLogo ? null : editing?.logo_path,
    layout: { logo: logoPosition.value, entity: entityPosition.value, education: educationPosition.value },
  };
}

function updateLivePreview() {
  const draft = draftLetterhead();
  const url = logoImage.hidden ? null : logoImage.getAttribute('src');
  livePreview.replaceChildren(renderLetterhead(draft, url, h));
  saveButton.disabled = saving || Boolean(layoutError(draft));
}

async function openDialog(letterhead = null) {
  const version = ++dialogVersion;
  cleanupObjectUrl();
  editing = letterhead;
  pendingFile = null;
  removeCurrentLogo = false;
  fileInput.value = '';
  showFormError(errorBox, '');

  idInput.value = letterhead?.id || '';
  nameInput.value = letterhead?.name || '';
  entityInput.value = letterhead?.entity_name || '';
  schoolInput.value = [letterhead?.school_name, letterhead?.university_name, letterhead?.college_name].map((value) => String(value || '').trim()).filter(Boolean).join(' — ');
  const layout = letterhead?.layout || DEFAULT_LETTERHEAD_LAYOUT;
  logoPosition.value = layout.logo;
  entityPosition.value = layout.entity;
  educationPosition.value = layout.education;
  departmentInput.value = letterhead?.department_name || '';
  extraInput.value = letterhead?.extra_text || '';

  dialogTitle.textContent = letterhead ? 'تعديل قالب الكليشة' : 'إضافة قالب كليشة';
  saveButton.textContent = letterhead ? 'حفظ التعديلات' : 'حفظ القالب';

  showLogoPlaceholder();
  updateLivePreview();
  dialog.showModal();
  nameInput.focus();

  if (letterhead?.logo_path) {
    const url = await getSignedLogoUrl(letterhead.logo_path);
    if (version !== dialogVersion || pendingFile || removeCurrentLogo) return;
    if (url) {
      showLogoImage(url);
      logoStatus.textContent = 'الشعار الحالي محفوظ في مخزنك الخاص.';
      removeLogoButton.hidden = false;
    } else {
      showLogoPlaceholder();
      logoStatus.textContent = 'تعذر عرض الشعار الحالي، لكنه ما زال محفوظاً.';
      removeLogoButton.hidden = false;
    }
  } else {
    showLogoPlaceholder();
    logoStatus.textContent = 'لم يتم اختيار شعار.';
    removeLogoButton.hidden = true;
  }

  if (version === dialogVersion) updateLivePreview();
}

function closeDialog() {
  dialogVersion++;
  cleanupObjectUrl();
  dialog.close();
}

function cleanupObjectUrl() {
  if (objectPreviewUrl) {
    URL.revokeObjectURL(objectPreviewUrl);
    objectPreviewUrl = null;
  }
}

function showLogoImage(url) {
  logoImage.src = url;
  logoImage.hidden = false;
  logoPlaceholder.hidden = true;
}

function showLogoPlaceholder() {
  logoImage.removeAttribute('src');
  logoImage.hidden = true;
  logoPlaceholder.hidden = false;
}

function handleFileSelection() {
  showFormError(errorBox, '');
  const file = fileInput.files?.[0];
  if (!file) return;

  if (!ALLOWED_TYPES.has(file.type)) {
    showFormError(errorBox, 'صيغة الشعار يجب أن تكون PNG أو JPG أو WebP.');
    fileInput.value = '';
    return;
  }

  if (file.size > MAX_LOGO_BYTES) {
    showFormError(errorBox, 'حجم الشعار يجب ألا يتجاوز 2 ميجابايت.');
    fileInput.value = '';
    return;
  }

  pendingFile = file;
  removeCurrentLogo = false;
  cleanupObjectUrl();
  objectPreviewUrl = URL.createObjectURL(file);
  showLogoImage(objectPreviewUrl);
  logoStatus.textContent = `سيُرفع: ${file.name}`;
  removeLogoButton.hidden = false;
  updateLivePreview();
}

function handleRemoveLogo() {
  pendingFile = null;
  removeCurrentLogo = true;
  fileInput.value = '';
  cleanupObjectUrl();
  showLogoPlaceholder();
  logoStatus.textContent = 'سيُزال الشعار عند حفظ القالب.';
  removeLogoButton.hidden = true;
  updateLivePreview();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (saving) return;
  showFormError(errorBox, '');

  const name = nameInput.value.trim();
  if (!name) {
    showFormError(errorBox, 'اسم القالب مطلوب.');
    nameInput.focus();
    return;
  }

  const draft = draftLetterhead();
  const conflict = layoutError(draft);
  if (conflict) { showFormError(errorBox, conflict); return; }
  setButtonBusy(saveButton, true, 'جارٍ حفظ القالب...');
  saving = true;
  const targetId = editing?.id;
  const submitVersion = dialogVersion;
  const fileToUpload = pendingFile;
  const removeLogo = removeCurrentLogo;

  let uploadedPath = null;
  const oldLogoPath = editing?.logo_path || null;

  try {
    let logoPath = oldLogoPath;

    if (fileToUpload) {
      const extension = ALLOWED_TYPES.get(fileToUpload.type);
      uploadedPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(ASSET_BUCKET)
        .upload(uploadedPath, fileToUpload, {
          contentType: fileToUpload.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;
      logoPath = uploadedPath;
    } else if (removeLogo) {
      logoPath = null;
    }

    const payload = {
      name,
      entity_name: draft.entity_name,
      school_name: draft.school_name,
      university_name: null,
      college_name: null,
      layout: draft.layout,
      department_name: draft.department_name,
      extra_text: draft.extra_text,
      logo_path: logoPath,
    };

    const result = targetId
      ? await supabase
          .from('letterheads')
          .update(payload)
          .eq('id', targetId)
          .select('id, logo_path')
          .single()
      : await supabase.from('letterheads').insert(payload).select('id, logo_path').single();

    if (result.error) throw result.error;


    signedUrlCache.clear();
    if (submitVersion === dialogVersion) closeDialog();
    toast(targetId ? 'تم حفظ تعديلات قالب الكليشة.' : 'تمت إضافة قالب الكليشة.');
    await loadLetterheads();
  } catch (error) {
    // Uploaded paths are append-only; keep even an unreferenced upload rather than
    // risk removing a logo retained by a concurrent exam/template save.

    if (submitVersion === dialogVersion) showFormError(errorBox, letterheadError(error));
    else toast(letterheadError(error), 'error');
  } finally {
    saving = false;
    setButtonBusy(saveButton, false);
    saveButton.textContent = editing ? 'حفظ التعديلات' : 'حفظ القالب';
    updateLivePreview();
  }
}

async function confirmDelete(letterhead) {
  const { count } = await supabase
    .from('exams')
    .select('id', { count: 'exact', head: true })
    .eq('letterhead_id', letterhead.id);

  const usedByExams = (count || 0) > 0;

  const message = [
    `هل تريد حذف قالب الكليشة «${letterhead.name}»؟`,
    '',
    usedByExams
      ? `يستخدمه ${count} اختبار محفوظ. ستبقى بيانات الكليشة والشعار داخل نسخ الاختبارات المحفوظة.`
      : 'لا توجد اختبارات محفوظة تستخدم هذا القالب.',
    'لن تتأثر الاختبارات المحفوظة نفسها.',
    '',
    'لا يمكن التراجع عن هذا الإجراء.',
  ].join('\n');

  if (!window.confirm(message)) return;

  try {
    const { error } = await supabase.from('letterheads').delete().eq('id', letterhead.id);
    if (error) throw error;

    // Deleting a template never deletes its immutable uploaded logo.
    signedUrlCache.clear();
    toast('تم حذف قالب الكليشة.');
    await loadLetterheads();
  } catch (error) {
    toast(letterheadError(error), 'error');
  }
}

function emptyToNull(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function letterheadError(error) {
  const message = String(error?.message || '');
  const lower = message.toLowerCase();

  if (lower.includes('bucket not found')) {
    return 'مخزن الشعارات غير موجود. شغّل ترقية قاعدة البيانات التي تنشئ مخزن letterhead-logos، أو أنشئه يدوياً من Supabase Storage.';
  }

  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'لا تملك صلاحية الوصول إلى هذا الشعار أو القالب.';
  }

  return friendlyError(error);
}
