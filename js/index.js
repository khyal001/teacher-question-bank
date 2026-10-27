// صفحة تسجيل الدخول وإنشاء الحساب.
import { supabase, isSupabaseConfigured } from './supabase.js';
import {
  consumeAuthNext,
  getEmailRedirectTo,
  getSessionUser,
  rememberAuthNext,
} from './auth.js';
import { friendlyError, setButtonBusy, showFormError } from './ui.js';

const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginError = document.getElementById('login-error');
const signupError = document.getElementById('signup-error');
const feedback = document.getElementById('auth-feedback');
const setupNotice = document.getElementById('setup-notice');

init();

async function init() {
  setupTabs();
  bindForms();

  const nextParam = new URLSearchParams(window.location.search).get('next');
  if (nextParam) rememberAuthNext(nextParam);

  if (!isSupabaseConfigured) {
    document.getElementById('auth-title').textContent = 'الدخول والتسجيل غير متاحين حاليًا';
    document.getElementById('auth-intro').textContent = 'تواصل مع مسؤول الموقع للمساعدة، أو حاول لاحقًا.';
    setupNotice.hidden = false;
    disableAuthForms();
    return;
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hashError = hashParams.get('error_description') || hashParams.get('error');

  if (hashError) {
    showFeedback(
      'تعذر إكمال المصادقة عبر الرابط. حاول تسجيل الدخول، أو اطلب رابط تأكيد جديداً.',
      'error',
    );
  }

  try {
    const user = await getSessionUser();
    if (user) {
      window.location.replace(consumeAuthNext(nextParam));
    }
  } catch {
    // نترك النماذج متاحة؛ ستظهر رسالة واضحة عند محاولة الدخول.
  }
}

function setupTabs() {
  const loginTab = document.getElementById('tab-login');
  const signupTab = document.getElementById('tab-signup');
  const loginPanel = document.getElementById('login-panel');
  const signupPanel = document.getElementById('signup-panel');

  const activate = (which) => {
    const isLogin = which === 'login';

    loginTab.classList.toggle('active', isLogin);
    signupTab.classList.toggle('active', !isLogin);
    loginTab.setAttribute('aria-selected', String(isLogin));
    signupTab.setAttribute('aria-selected', String(!isLogin));

    loginPanel.hidden = !isLogin;
    signupPanel.hidden = isLogin;

    showFormError(loginError, '');
    showFormError(signupError, '');
    feedback.hidden = true;
  };

  loginTab.addEventListener('click', () => activate('login'));
  signupTab.addEventListener('click', () => activate('signup'));

  [loginTab, signupTab].forEach((tab, index) => {
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = index === 0 ? signupTab : loginTab;
      next.focus();
      activate(index === 0 ? 'signup' : 'login');
    });
  });
}

function bindForms() {
  loginForm.addEventListener('submit', handleLogin);
  signupForm.addEventListener('submit', handleSignup);
}

async function handleLogin(event) {
  event.preventDefault();
  showFormError(loginError, '');
  feedback.hidden = true;

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitButton = document.getElementById('login-submit');

  if (!email || !password) {
    showFormError(loginError, 'أدخل البريد الإلكتروني وكلمة المرور.');
    return;
  }

  if (!isValidEmail(email)) {
    showFormError(loginError, 'صيغة البريد الإلكتروني غير صحيحة.');
    return;
  }

  setButtonBusy(submitButton, true, 'جارٍ تسجيل الدخول...');

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const nextParam = new URLSearchParams(window.location.search).get('next');
    window.location.replace(consumeAuthNext(nextParam));
  } catch (error) {
    showFormError(loginError, friendlyError(error));
  } finally {
    setButtonBusy(submitButton, false);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  showFormError(signupError, '');
  feedback.hidden = true;

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  const submitButton = document.getElementById('signup-submit');

  if (!name) {
    showFormError(signupError, 'أدخل اسم المعلم.');
    return;
  }

  if (!isValidEmail(email)) {
    showFormError(signupError, 'صيغة البريد الإلكتروني غير صحيحة.');
    return;
  }

  if (password.length < 6) {
    showFormError(signupError, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
    return;
  }

  if (password !== confirm) {
    showFormError(signupError, 'كلمتا المرور غير متطابقتين.');
    return;
  }

  setButtonBusy(submitButton, true, 'جارٍ إنشاء الحساب...');

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: getEmailRedirectTo(),
      },
    });

    if (error) throw error;

    // Supabase يعيد مستخدماً بلا identities عندما يكون البريد مسجلاً مسبقاً.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      showFeedback('هذا البريد الإلكتروني مسجل مسبقاً. جرّب تسجيل الدخول.', 'error');
      return;
    }

    if (data.session) {
      showFeedback('تم إنشاء الحساب وتسجيل دخولك بنجاح. جارٍ التحويل...', 'success');
      const nextParam = new URLSearchParams(window.location.search).get('next');
      window.location.replace(consumeAuthNext(nextParam));
      return;
    }

    showFeedback('تم إنشاء الحساب، تحقق من بريدك الإلكتروني لإكمال التسجيل.', 'success');
    signupForm.reset();
  } catch (error) {
    showFeedback(friendlyError(error), 'error');
  } finally {
    setButtonBusy(submitButton, false);
  }
}

function showFeedback(message, type) {
  feedback.textContent = message;
  feedback.className = `auth-feedback ${type === 'error' ? 'is-error' : 'is-success'}`;
  feedback.hidden = false;
  feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function disableAuthForms() {
  [loginForm, signupForm].forEach((form) => {
    form.querySelectorAll('input, button').forEach((element) => {
      element.disabled = true;
    });
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
