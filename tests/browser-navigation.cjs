// اختبارات واجهة محلية بالكامل، مع منع اتصالات الخدمات واستبدال Supabase ببيانات وهمية.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installMock } = require('./offline-supabase-fixture.cjs');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.tmp', 'navigation-review');
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TQB_BROWSER_CHANNEL || 'msedge' });
  const errors = [];
  let checks = 0;
  async function context(setup = '') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript({ content: `(${installMock.toString()})(); ${setup}` });
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://teacher-bank.test') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.pathname === '/js/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const isSupabaseConfigured = true; export const supabase = window.__mockSupabase;' });
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    return ctx;
  }
  async function open(ctx, file) {
    const page = await ctx.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://teacher-bank.test/${file}`);
    await page.waitForSelector('.navigation-ready');
    return page;
  }
  try {
    const ctx = await context();
    const page = await open(ctx, 'questions.html');
    await page.waitForSelector('.question-card');
    assert.equal(await page.locator('#navigation-content-heading').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#main-nav [aria-current="page"]').getAttribute('data-nav'), 'questions');
    assert.equal(await page.locator('[data-admin-navigation]').count(), 0);
    assert.deepEqual(await page.evaluate(() => __calls.map((call) => call.rpc || call.table)), ['get_questions_page']);
    checks += 4;
    const paths = await page.locator('#main-nav .navigation-icon').evaluateAll((nodes) => nodes.map((node) => node.innerHTML));
    assert.equal(new Set(paths).size, paths.length);
    checks++;
    await page.locator('#navigation-assessment-heading').click();
    await page.locator('#navigation-home-heading').click();
    await page.reload();
    await page.waitForSelector('.navigation-ready');
    assert.equal(await page.locator('#navigation-assessment-heading').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#navigation-home-heading').getAttribute('aria-expanded'), 'true');
    checks += 2;
    await page.locator('#navigation-assessment-heading').click();
    await page.goto('http://teacher-bank.test/subjects.html');
    await page.waitForSelector('.navigation-ready');
    assert.equal(await page.locator('#navigation-assessment-heading').getAttribute('aria-expanded'), 'false');
    checks++;
    await page.goto('http://teacher-bank.test/exam-view.html');
    await page.waitForSelector('.navigation-ready');
    assert.equal(await page.locator('#navigation-assessment-heading').getAttribute('aria-expanded'), 'true');
    checks++;
    await page.locator('#nav-toggle').click();
    assert.equal(await page.locator('#navigation-panel').getAttribute('aria-hidden'), 'true');
    await page.locator('#nav-toggle').click();
    checks++;
    await page.locator('.account-toggle').click();
    assert.equal(await page.locator('#account-options').isVisible(), true);
    await page.locator('.account-toggle').press('Escape');
    assert.equal(await page.locator('#account-options').isVisible(), false);
    assert.equal(await page.locator('.account-toggle').evaluate((node) => node === document.activeElement), true);
    checks += 3;

    await page.goto('http://teacher-bank.test/questions.html');
    await page.waitForSelector('.question-card');
    for (const id of ['home', 'content', 'assessment', 'print', 'account']) {
      if (await page.locator(`#navigation-${id}-heading`).getAttribute('aria-expanded') === 'false') await page.locator(`#navigation-${id}-heading`).click();
    }
    for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 480 }, { width: 980, height: 640 }, { width: 375, height: 812 }, { width: 320, height: 480 }]) {
      await page.setViewportSize(size);
      if (size.width <= 980) await page.locator('#nav-toggle').click();
      await page.locator('#navigation-panel').waitFor({ state: 'visible' });
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      const fit = await page.evaluate(() => {
        const panel = document.getElementById('navigation-panel');
        const p = panel.getBoundingClientRect();
        const main = document.getElementById('main-content').getBoundingClientRect();
        const scroll = document.querySelector('.navigation-scroll');
        return { fits: p.top >= 0 && p.bottom <= innerHeight && p.left >= 0 && p.right <= innerWidth,
          independent: getComputedStyle(scroll).overflowY === 'auto', noOverflow: document.documentElement.scrollWidth <= innerWidth,
          separated: innerWidth <= 980 || main.right <= p.left, locked: innerWidth > 980 || getComputedStyle(document.body).overflow === 'hidden' };
      });
      assert.ok(Object.values(fit).every(Boolean), `${JSON.stringify(size)} ${JSON.stringify(fit)}`);
      checks++;
      if (size.width === 1440 || size.width === 375) await page.screenshot({ path: path.join(artifacts, `navigation-${size.width}.png`), animations: 'disabled' });
      if (size.width <= 980) {
        assert.equal(await page.locator('#main-content').evaluate((node) => node.inert), true);
        await page.locator('.navigation-close').focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('.navigation-panel-footer a').evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.navigation-close').evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#nav-toggle').evaluate((node) => node === document.activeElement), true);
        assert.equal(await page.locator('#main-content').evaluate((node) => node.inert), false);
        checks += 5;
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('#nav-toggle').click();
    await page.locator('.navigation-backdrop').click({ position: { x: 10, y: 200 } });
    assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
    checks++;
    await page.locator('#nav-toggle').click();
    await page.locator('#main-nav [data-nav="subjects"]').click();
    await page.waitForURL('**/subjects.html');
    await page.waitForSelector('.navigation-ready');
    assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
    checks++;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://teacher-bank.test/exam-view.html?id=exam-1');
    await page.waitForSelector('.exam-closing');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#navigation-panel').isVisible(), false);
    assert.equal(await page.locator('main').evaluate((node) => getComputedStyle(node).marginInlineStart), '0px');
    await page.pdf({ path: path.join(artifacts, 'exam-print.pdf'), format: 'A4', printBackground: true });
    checks += 2;
    const printMetrics = () => {
      const paper = document.querySelector('.exam-paper');
      return [paper, ...paper.querySelectorAll('*')].map((node) => {
        const s = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        return [node.tagName, node.className, s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight,
          s.display, s.margin, s.padding, s.border, r.x, r.y, r.width, r.height];
      });
    };
    const currentPrint = await page.evaluate(printMetrics);
    const baselineCss = execFileSync('git', ['show', 'HEAD:css/style.css'], { cwd: root, encoding: 'utf8' });
    await page.route('**/css/style.css', (route) => route.fulfill({ contentType: 'text/css', body: baselineCss }));
    await page.reload();
    await page.waitForSelector('.exam-closing');
    assert.deepEqual(await page.evaluate(printMetrics), currentPrint, 'printed exam geometry and typography remain identical');
    checks++;
    await ctx.close();

    const blocked = await context(`Object.defineProperty(window, 'localStorage', {get(){throw new Error('blocked');}});`);
    const blockedPage = await open(blocked, 'subjects.html');
    await blockedPage.locator('#navigation-home-heading').click();
    assert.equal(await blockedPage.locator('#navigation-home-heading').getAttribute('aria-expanded'), 'true');
    checks++;
    await blocked.close();
    const admin = await context(`
      __role = 'admin';
      const originalRpc = __mockSupabase.rpc;
      __mockSupabase.rpc = async (name, params) => {
        if (name === 'get_admin_stats') return {data: {teacher_count: 1, subject_count: 2, group_count: 2, question_count: 53, exam_count: 1, letterhead_count: 1}, error: null};
        if (name === 'get_admin_teachers') return {data: {teachers: [], total: 0}, error: null};
        return originalRpc(name, params);
      };
    `);
    const adminPage = await open(admin, 'subjects.html');
    await adminPage.waitForSelector('#navigation-account-links [data-admin-navigation]', { state: 'attached' });
    assert.equal(await adminPage.locator('[data-admin-navigation]').count(), 1);
    checks++;
    await adminPage.goto('http://teacher-bank.test/admin.html');
    await adminPage.waitForSelector('#admin-content', { state: 'visible' });
    assert.equal(await adminPage.locator('[data-admin-navigation][aria-current="page"]').count(), 1);
    checks++;
    await adminPage.evaluate(() => { __role = 'teacher'; });
    await adminPage.locator('#admin-refresh').click();
    await adminPage.waitForSelector('#admin-denied', { state: 'visible' });
    assert.equal(await adminPage.locator('[data-admin-navigation]').count(), 0);
    assert.equal(await adminPage.locator('#admin-content').isVisible(), false);
    checks += 2;
    await admin.close();
    assert.deepEqual(errors, []);
    checks++;
    console.log(`PASS ${checks} navigation checks. Artifacts: ${artifacts}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
