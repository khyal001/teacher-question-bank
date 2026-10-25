// المصادقة وحماية الصفحات وقائمة التنقل المشتركة.
import { supabase, isSupabaseConfigured } from './supabase.js';

export function displayName(user) {
  const metadata = user?.user_metadata || {};
  return (
    metadata.full_name ||
    metadata.name ||
    user?.email?.split('@')[0] ||
    'المعلم'
  );
}

/**
 * رابط العودة بعد تأكيد البريد، محسوب من رابط الصفحة الحالي
 * ليعمل محلياً وعلى GitHub Pages داخل مسار فرعي.
 */
export function getEmailRedirectTo() {
  const url = new URL('./index.html', window.location.href);
  url.search = '';
  url.hash = '';
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
      'لم يتم إعداد Supabase بعد. أضف SUPABASE_URL و SUPABASE_ANON_KEY داخل js/config.js ثم أعد تحميل الصفحة.',
    );
    return null;
  }

  try {
    const user = await getSessionUser();

    if (!user) {
      window.location.replace('./index.html');
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
  try {
    await supabase.auth.signOut();
  } catch {
    // حتى لو فشل طلب الخروج، نمسح الجلسة المحلية بالتحويل.
  }
  window.location.replace('./index.html');
}

/**
 * تفعيل روابط التنقل، اسم المعلم، وزر تسجيل الخروج.
 */
export function initNav(activePage, user) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isActive = link.dataset.nav === activePage;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
  });

  const nameElement = document.getElementById('nav-user-name');
  if (nameElement && user) {
    nameElement.textContent = displayName(user);
  }

  const logoutButton = document.getElementById('logout-btn');
  if (logoutButton && !logoutButton.dataset.bound) {
    logoutButton.dataset.bound = 'true';
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      logoutButton.textContent = 'جارٍ الخروج...';
      await signOut();
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
