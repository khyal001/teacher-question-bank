// أدوات واجهة مشتركة: إنشاء عناصر آمنة، Toast، أخطاء عربية، تنسيق.

export const TYPE_LABELS = Object.freeze({
  mcq: 'اختيار من متعدد',
  true_false: 'صح / خطأ',
  short: 'إجابة قصيرة',
});

export const DIFFICULTY_LABELS = Object.freeze({
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
});

export const DIFFICULTY_ORDER = Object.freeze(['easy', 'medium', 'hard']);

export const GROUP_SCOPE_LABELS = Object.freeze({
  all: 'جميع الصفوف والفصول والأقسام',
  selected: 'صفوف وفصول وأقسام محددة',
});

export const PRINT_NOTICE_STORAGE_KEY = 'teacher-question-bank:print-notice-dismissed';

export const ASSET_BUCKET = 'letterhead-logos';

/**
 * إنشاء عنصر DOM بأمان. النصوص تُضاف عبر textContent دائماً.
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
}

// ------------------------------------------------------------
// Toast
// ------------------------------------------------------------
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = h('div', {
      class: 'toast-container',
      id: 'toast-container',
      'aria-live': 'polite',
      'aria-atomic': 'false',
    });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function toast(message, type = 'success', duration = 4200) {
  const container = getToastContainer();
  const icon = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';

  const item = h(
    'div',
    { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-icon', 'aria-hidden': 'true', text: icon }),
    h('span', { class: 'toast-message', text: message }),
  );

  container.appendChild(item);
  requestAnimationFrame(() => item.classList.add('toast-visible'));

  window.setTimeout(() => {
    item.classList.remove('toast-visible');
    window.setTimeout(() => item.remove(), 240);
  }, duration);
}

// ------------------------------------------------------------
// الأخطاء
// ------------------------------------------------------------
export function friendlyError(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (lower.includes('email not confirmed')) {
    return 'لم يتم تأكيد بريدك الإلكتروني بعد. تحقق من بريدك الوارد.';
  }
  if (lower.includes('user already registered')) {
    return 'هذا البريد الإلكتروني مسجل مسبقاً. جرّب تسجيل الدخول.';
  }
  if (lower.includes('password should be at least')) {
    return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مجدداً.';
  }
  if (lower.includes('email address') && lower.includes('invalid')) {
    return 'صيغة البريد الإلكتروني غير صحيحة.';
  }
  if (hasArabic(message)) {
    return message;
  }
  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'ليس لديك صلاحية للوصول إلى هذه البيانات أو تعديلها.';
  }
  if (code === '23505' || lower.includes('duplicate key')) {
    return 'توجد بيانات مكررة تمنع إتمام العملية.';
  }
  if (code === '23503' || lower.includes('foreign key')) {
    return 'لا يمكن إتمام العملية بسبب ارتباط السجل ببيانات أخرى.';
  }
  if (code === 'PGRST116' || lower.includes('0 rows') || lower.includes('no rows')) {
    return 'لم يتم العثور على السجل المطلوب.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed')
  ) {
    return 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ومن إعدادات Supabase.';
  }
  if (code === '23514') {
    return 'البيانات المدخلة لا تحقق قواعد التحقق المطلوبة.';
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}

// ------------------------------------------------------------
// حالات الأزرار والتنسيق
// ------------------------------------------------------------
export function setButtonBusy(button, busy, busyLabel = 'جارٍ الحفظ...') {
  if (!button) return;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('ar-EG', {
      calendar: 'gregory',
      numberingSystem: 'latn',
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {}),
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatPoints(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return String(num);
}

export function answerDisplay(type, answer) {
  if (type === 'true_false') {
    if (answer === 'true') return 'صح';
    if (answer === 'false') return 'خطأ';
    return '—';
  }
  return answer ?? '—';
}

export function renderEmptyState(container, { title, hint = '', action = null } = {}) {
  container.replaceChildren();
  container.appendChild(
    h(
      'div',
      { class: 'empty-state' },
      h('div', { class: 'empty-icon', 'aria-hidden': 'true', text: '✦' }),
      h('h3', { text: title || 'لا توجد بيانات حتى الآن' }),
      hint ? h('p', { text: hint }) : null,
      action ? h('div', { class: 'empty-action' }, action) : null,
    ),
  );
}

export function renderInlineError(container, message) {
  container.replaceChildren();
  container.appendChild(
    h(
      'div',
      { class: 'inline-error', role: 'alert' },
      h('strong', { text: 'تعذر تحميل البيانات' }),
      h('p', { text: message }),
    ),
  );
}

export function showFormError(element, message) {
  if (!element) return;
  if (!message) {
    element.textContent = '';
    element.hidden = true;
    return;
  }
  element.textContent = message;
  element.hidden = false;
}

export function scrollToList(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function copyText(text) {
  const value = String(text ?? '');

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // نكمل إلى البديل المحلي.
  }

  try {
    const area = h('textarea', {
      class: 'clipboard-fallback',
      readonly: true,
      'aria-hidden': 'true',
    });
    area.value = value;
    area.style.position = 'fixed';
    area.style.insetInlineStart = '-9999px';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export function readLocalFlag(key) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeLocalFlag(key, enabled) {
  try {
    if (enabled) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // التخزين المحلي قد يكون معطلاً؛ نتابع دون حفظ التفضيل.
  }
}

export function shorten(text, max = 90) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
