import { performSignOut } from './data-utils.js';
import { navigationRole, profileName } from './profile-utils.js';
import { friendlyError, toast } from './ui.js';
// المصادقة وحماية الصفحات وقائمة التنقل المشتركة.
import { supabase, isSupabaseConfigured } from './supabase.js';

const AUTH_NEXT_KEY = 'teacher-question-bank:auth-next';

export function displayName(user) {
  return profileName(user);
}

/**
 * يتحقق من مسار عودة محلي وآمن، ويمنع الروابط الخارجية وصفحة الدخول نفسها.
 */
export function safeNextPath(value) {
  if (!value) return './dashboard.html';

  try {
    const url = new URL(value, window.location.href);

    if (url.origin !== window.location.origin) return './dashboard.html';
    if (!/\.html$/i.test(url.pathname)) return './dashboard.html';
    if (/\/index\.html$/i.test(url.pathname)) return './dashboard.html';

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return './dashboard.html';
  }
}

export function rememberAuthNext(value) {
  const safe = safeNextPath(value);

  try {
    const stored = window.sessionStorage.getItem(AUTH_NEXT_KEY);

    // لا تستبدل مساراً محفوظاً كاملاً يحتوي hash (مثل مفتاح مشاركة)
    // بنسخة منزوعة الـ hash قادمة من رابط تأكيد البريد.
    if (
      stored &&
      stored.split('#')[0] === safe.split('#')[0] &&
      stored.includes('#') &&
      !safe.includes('#')
    ) {
      return;
    }

    window.sessionStorage.setItem(AUTH_NEXT_KEY, safe);
  } catch {
    // تجاهل تعذر التخزين؛ سيعود المستخدم إلى لوحة التحكم.
  }
}

export function consumeAuthNext(value = null) {
  let stored = null;

  try {
    stored = window.sessionStorage.getItem(AUTH_NEXT_KEY);
    window.sessionStorage.removeItem(AUTH_NEXT_KEY);
  } catch {
    // تجاهل.
  }

  const safeValue = value ? safeNextPath(value) : null;
  const safeStored = stored ? safeNextPath(stored) : null;

  if (safeStored && safeValue && safeStored.split('#')[0] === safeValue.split('#')[0]) {
    return safeValue.includes('#') ? safeValue : safeStored;
  }

  return safeValue || safeStored || './dashboard.html';
}

/**
 * رابط العودة بعد تأكيد البريد، محسوب من رابط الصفحة الحالي
 * ليعمل محلياً وعلى GitHub Pages داخل مسار فرعي.
 */
export function getEmailRedirectTo() {
  const url = new URL('./index.html', window.location.href);
  url.search = '';
  url.hash = '';

  try {
    const next = window.sessionStorage.getItem(AUTH_NEXT_KEY);
    if (next) {
      // لا نضع أي hash (قد يحتوي مفتاح مشاركة) في استعلام رابط البريد.
      url.searchParams.set('next', safeNextPath(next).split('#')[0]);
    }
  } catch {
    // تجاهل.
  }

  return url.href;
}

export async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

/**
 * تستدعيها كل صفحة محمية. تعيد المستخدم أو null بعد التحويل.
 */
export async function requireAuth() {
  if (!isSupabaseConfigured) {
    showLoaderMessage(
      'لم يتم إعداد Supabase بعد. أضف SUPABASE_URL وSUPABASE_ANON_KEY داخل js/config.js ثم أعد تحميل الصفحة.',
    );
    return null;
  }

  try {
    const user = await getSessionUser();

    if (!user) {
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      rememberAuthNext(next);

      // المسارات ذات hash قد تحمل مفتاح مشاركة؛ لا نضعها في استعلام صفحة الدخول.
      const safe = safeNextPath(next);
      const loginTarget = safe.includes('#')
        ? './index.html'
        : `./index.html?next=${encodeURIComponent(safe)}`;

      window.location.replace(loginTarget);
      return null;
    }

    watchAuthState();
    document.body.classList.remove('auth-pending');
    return user;
  } catch {
    showLoaderMessage('تعذر التحقق من جلسة الدخول. تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.');
    return null;
  }
}

let watchingAuthState = false;

function watchAuthState() {
  if (watchingAuthState) return;
  watchingAuthState = true;

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      window.location.replace('./index.html');
    }
  });
}

function showLoaderMessage(message) {
  const loader = document.getElementById('page-loading');
  const text = document.getElementById('page-loading-text');
  const spinner = loader?.querySelector('.spinner');

  if (spinner) spinner.hidden = true;
  if (text) text.textContent = message;
}

export async function signOut() {
  await performSignOut(supabase, () => window.location.replace('./index.html'));
}

/**
 * تفعيل روابط التنقل، اسم المعلم، وزر تسجيل الخروج.
 */
export function initNav(activePage, user, { rolePromise = null } = {}) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isActive = link.dataset.nav === activePage;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
  });

  const nameElement = document.getElementById('nav-user-name');
  if (nameElement && user) {
    nameElement.textContent = displayName(user);
  }

  // Convenience only: admin.html and every administrative RPC authorize again.
  if (user && activePage !== 'admin' && !document.querySelector('[data-admin-navigation]')) {
    const roleRequest = rolePromise ?? navigationRole(supabase);
    roleRequest.then(applyNavigationRole).catch(() => { /* Optional navigation fails closed; never infer role from metadata. */ });
  }

  const logoutButton = document.getElementById('logout-btn');
  if (logoutButton && !logoutButton.dataset.bound) {
    logoutButton.dataset.bound = 'true';
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      logoutButton.textContent = 'جارٍ الخروج...';
      try {
        await signOut();
      } catch (error) {
        toast(friendlyError(error), 'error');
        logoutButton.disabled = false;
        logoutButton.textContent = 'تسجيل الخروج';
      }
    });
  }

  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('main-nav');

  if (toggle && nav && !toggle.dataset.bound) {
    toggle.dataset.bound = 'true';

    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }
}

// Presentation only. Roles supplied here come from an authenticated server RPC;
// page/RPC authorization remains mandatory regardless of this link's presence.
export function applyNavigationRole(role) {
  const existing = document.querySelector('[data-admin-navigation]');
  if (role !== 'admin') { existing?.remove(); return; }
  if (existing) return;
  const link = document.createElement('a');
  link.href = './admin.html';
  link.className = 'admin-navigation';
  link.dataset.adminNavigation = 'true';
  link.textContent = 'إدارة النظام';
  document.getElementById('nav-user-name')?.closest('.nav-user')?.appendChild(link);
}
