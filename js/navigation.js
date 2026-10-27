// واجهة التنقل فقط؛ لا تتصل بالخدمات ولا تقرر صلاحيات المستخدم.
const groups = [
  ['home', 'الرئيسية', ['dashboard']],
  ['content', 'المحتوى التعليمي', ['subjects', 'groups', 'questions']],
  ['assessment', 'الاختبارات', ['builder', 'exams']],
  ['print', 'تجهيز الطباعة', ['letterheads']],
  ['account', 'الحساب', ['profile', 'admin']],
];

const icons = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  subjects: '<path d="M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Zm0 0v16"/>',
  groups: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 5"/>',
  questions: '<path d="M5 3h11l4 4v14H5Z M16 3v5h4M10 12a2 2 0 1 1 3 1.7c-1 .5-1 1-1 1.3"/><path d="M12 18h.01"/>',
  builder: '<path d="M8 4H4v16h16v-4M13 5l6 6M10 17l-4 1 1-4L18 3a2 2 0 0 1 3 3Z"/>',
  exams: '<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M9 4V2h7v2M9 10l2 2 4-4M9 17h7"/>',
  letterheads: '<path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6Z M17 11h1"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
  admin: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z M8 12l3 3 5-6"/>',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function decorateLink(link, page) {
  if (link.querySelector('.navigation-icon')) return;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('navigation-icon');
  // مسارات أيقونات ثابتة محلية فقط؛ لا تدخل بيانات المستخدم في HTML.
  icon.innerHTML = icons[page] || icons.subjects;
  const label = element('span', 'navigation-label', link.textContent);
  link.replaceChildren(icon, label);
}

export function placeAdminNavigation(link) {
  const destination = document.getElementById('navigation-account-links');
  if (!destination || !link) return;
  link.dataset.nav = 'admin';
  decorateLink(link, 'admin');
  destination.append(link);
  if (document.body.dataset.page === 'admin') {
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  }
}

export function initNavigation(activePage, user) {
  const nav = document.getElementById('main-nav');
  const toggle = document.getElementById('nav-toggle');
  const header = document.querySelector('.site-header');
  if (!nav || !toggle || !header || document.getElementById('navigation-panel')) return;

  const storageKey = `teacher-question-bank:navigation:${user?.id || 'local'}`;
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch { /* التنقل يعمل أيضًا عند منع التخزين. */ }
  const remember = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* اختياري. */ }
  };

  const links = new Map([...nav.querySelectorAll('a[data-nav]')].map((link) => [link.dataset.nav, link]));
  // ترويسة الإدارة القديمة تحتوي رابط العودة فقط؛ تستخدم نفس روابط المعلم.
  const pages = [
    ['dashboard', 'dashboard.html', 'لوحة التحكم'], ['subjects', 'subjects.html', 'المواد'],
    ['groups', 'groups.html', 'الصفوف والفصول والأقسام'], ['questions', 'questions.html', 'الأسئلة'],
    ['builder', 'exam-builder.html', 'إنشاء اختبار'], ['exams', 'exam-view.html', 'الاختبارات المحفوظة'],
    ['letterheads', 'letterheads.html', 'الكليشة'], ['profile', 'profile.html', 'الملف الشخصي'],
  ];
  for (const [id, path, title] of pages) {
    if (!links.has(id)) {
      const link = element('a', '', title);
      link.href = `./${path}`;
      link.dataset.nav = id;
      links.set(id, link);
    }
  }
  nav.replaceChildren();
  for (const [id, title, pageIds] of groups) {
    const section = element('section', 'navigation-group');
    const button = element('button', 'navigation-group-toggle', title);
    button.type = 'button';
    button.id = `navigation-${id}-heading`;
    const list = element('div', 'navigation-group-links');
    list.id = `navigation-${id}-links`;
    list.setAttribute('aria-labelledby', button.id);
    button.setAttribute('aria-controls', list.id);
    const open = pageIds.includes(activePage) || saved[id] === true;
    saved[id] = open;
    button.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    for (const page of pageIds) {
      const link = links.get(page);
      if (!link) continue;
      const current = page === activePage;
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      decorateLink(link, page);
      list.append(link);
    }
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      list.hidden = !expanded;
      saved[id] = expanded;
      remember();
    });
    section.append(button, list);
    nav.append(section);
  }
  remember();

  const panel = element('aside', 'navigation-panel no-print');
  panel.id = 'navigation-panel';
  panel.setAttribute('aria-label', 'قائمة الصفحات');
  const panelHead = element('div', 'navigation-panel-head');
  const title = element('strong', '', 'قائمة الصفحات');
  title.id = 'navigation-panel-title';
  const close = element('button', 'icon-btn navigation-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'إغلاق قائمة التنقل');
  panelHead.append(title, close);
  const scroll = element('div', 'navigation-scroll');
  scroll.append(nav);
  const panelFooter = element('div', 'navigation-panel-footer');
  const about = element('a', '', 'من نحن');
  about.href = './about.html';
  panelFooter.append(about);
  panel.append(panelHead, scroll, panelFooter);
  const backdrop = element('div', 'navigation-backdrop no-print');
  backdrop.hidden = true;
  document.body.append(backdrop, panel);
  document.body.classList.add('navigation-ready');
  toggle.setAttribute('aria-controls', panel.id);

  const mobile = matchMedia('(max-width: 980px)');
  let mobileOpen = false;
  let collapsed = false;
  const main = document.getElementById('main-content');
  const footer = document.querySelector('.site-footer');
  const update = () => {
    const isOpen = mobile.matches ? mobileOpen : !collapsed;
    panel.inert = !isOpen;
    panel.setAttribute('aria-hidden', String(!isOpen));
    panel.classList.toggle('is-open', isOpen);
    document.body.classList.toggle('navigation-collapsed', !mobile.matches && collapsed);
    document.body.classList.toggle('navigation-modal-open', mobile.matches && mobileOpen);
    backdrop.hidden = !(mobile.matches && mobileOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'طي قائمة التنقل' : 'فتح قائمة التنقل');
    if (mobile.matches && mobileOpen) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
    }
    for (const node of [main, header, footer]) {
      if (node) node.inert = mobile.matches && mobileOpen;
    }
  };
  const dismiss = (restoreFocus = true) => {
    if (mobile.matches) mobileOpen = false;
    else collapsed = true;
    update();
    if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => {
    if (mobile.matches) mobileOpen = !mobileOpen;
    else collapsed = !collapsed;
    update();
    if (mobile.matches && mobileOpen) close.focus();
  });
  close.addEventListener('click', () => dismiss());
  backdrop.addEventListener('click', () => dismiss());
  panel.addEventListener('click', (event) => {
    if (mobile.matches && event.target.closest('a')) dismiss(false);
  });
  document.addEventListener('keydown', (event) => {
    if (!panel.classList.contains('is-open') || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && panel.contains(document.activeElement)) {
      event.preventDefault();
      dismiss();
    }
    if (event.key === 'Tab' && mobile.matches && mobileOpen) {
      const items = [...panel.querySelectorAll('button, a[href]')].filter((node) => node.getClientRects().length);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  mobile.addEventListener('change', () => {
    const hadFocus = panel.contains(document.activeElement);
    mobileOpen = false;
    update();
    if (mobile.matches && hadFocus) toggle.focus();
  });
  update();
  const measureHeader = () => document.documentElement.style.setProperty('--navigation-header-height', `${header.getBoundingClientRect().height}px`);
  new ResizeObserver(measureHeader).observe(header);
  measureHeader();

  initAccountMenu();
  placeAdminNavigation(document.querySelector('[data-admin-navigation]'));
}

function initAccountMenu() {
  const userArea = document.querySelector('.nav-user');
  const logout = document.getElementById('logout-btn');
  if (!userArea || !logout) return;
  const trigger = element('button', 'account-toggle icon-btn', '⌄');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'خيارات الحساب');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'account-options');
  const options = element('div', 'account-options');
  options.id = 'account-options';
  options.hidden = true;
  const profile = element('a', 'account-profile', 'الملف الشخصي');
  profile.href = './profile.html';
  options.append(profile, logout);
  userArea.append(trigger, options);
  const close = (focus = false) => {
    options.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  };
  trigger.addEventListener('click', () => {
    options.hidden = !options.hidden;
    trigger.setAttribute('aria-expanded', String(!options.hidden));
  });
  document.addEventListener('click', (event) => { if (!userArea.contains(event.target)) close(); });
  userArea.addEventListener('focusout', (event) => { if (!userArea.contains(event.relatedTarget)) close(); });
  userArea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !options.hidden) { event.preventDefault(); close(true); }
  });
}
