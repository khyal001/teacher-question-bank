// Offline browser integration checks. Requires local Playwright + Chromium.
// All HTTP requests are fulfilled from disk or blocked; no Supabase connection.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'tqb-browser-'));

const { installMock } = require('./offline-supabase-fixture.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.TQB_BROWSER_CHANNEL ? { channel: process.env.TQB_BROWSER_CHANNEL } : {}) });
  let checks = 0;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installMock);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://teacher-bank.test') return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
    if (url.pathname === '/js/supabase.js') {
      return route.fulfill({ contentType: 'text/javascript', body: 'export const isSupabaseConfigured = true; export const supabase = window.__mockSupabase;' });
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  try {
    await page.goto('http://teacher-bank.test/questions.html');
    await page.waitForFunction(() => document.querySelectorAll('.question-card').length === 25);
    assert.equal(await page.locator('[data-admin-navigation]').count(), 0);
    assert.deepEqual(await page.evaluate(() => __calls.map((call) => call.rpc || call.table)), ['get_questions_page']);
    checks += 2;
    await page.evaluate(() => { window.__editorDelays = { 'subject-1': 250, 'subject-2': 10 }; });
    await page.locator('.question-card .row-actions button').first().click();
    await page.locator('#question-subject').selectOption('subject-2');
    await page.waitForFunction(() => !document.querySelector('#save-question-btn').disabled);
    await page.waitForFunction(() => __calls.some((call) => call.table === 'subject_groups'
      && call.predicates.some(([key, value]) => key === 'subject_id' && value === 'subject-1') && call.finishedAt));
    assert.ok((await page.locator('#question-groups-hint').textContent()).includes('الثاني الثانوي'));
    assert.equal(await page.locator('input[name="group-scope"][value="selected"]').isChecked(), true);
    checks++;
    await page.locator('#question-dialog [data-close]').first().click();
    const callsBeforeReopen = await page.evaluate(() => __calls.length);
    await page.locator('.question-card .row-actions button').first().click();
    await page.waitForFunction(() => !document.querySelector('#save-question-btn').disabled);
    assert.equal(await page.evaluate(() => __calls.length), callsBeforeReopen);
    assert.equal(await page.locator('input[name="group-scope"][value="selected"]').isChecked(), true);
    assert.equal(await page.locator('input[name="question-group"]').isChecked(), true);
    checks++;
    await page.locator('#question-dialog [data-close]').first().click();
    await page.locator('#questions-next').click();
    await page.waitForFunction(() => document.querySelector('.question-text')?.textContent === 'سؤال تجريبي 26');
    assert.equal(await page.locator('.question-card').count(), 25);
    assert.equal(await page.evaluate(() => __calls.filter((call) => call.rpc === 'get_questions_page').at(-1).params.p_include_metadata), false);
    checks++;
    await page.locator('#filter-unit').selectOption('باب الجبر');
    await page.waitForFunction(() => document.querySelector('#questions-count').textContent === '26 سؤال');
    assert.match(await page.locator('#questions-page').textContent(), /1/);
    checks++;
    await page.locator('#reset-filters').click();
    await page.locator('#filter-search').fill('Chapter 2');
    await page.waitForFunction(() => document.querySelector('#questions-count').textContent === '27 سؤال');
    checks++;
    await page.locator('.profile-link').click();
    await page.waitForSelector('#profile-name');
    await page.locator('#profile-name').fill('اسم جديد');
    await page.locator('#profile-save').click();
    await page.waitForFunction(() => document.querySelector('#nav-user-name').textContent === 'اسم جديد');
    assert.deepEqual(await page.evaluate(() => __updatedMetadata), { display_name: 'اسم جديد', full_name: 'اسم جديد' });
    assert.equal(await page.locator('#profile-email').getAttribute('readonly'), '');
    checks++;

    await page.goto('http://teacher-bank.test/letterheads.html');
    await page.waitForSelector('.letterhead-card');
    await page.locator('.letterhead-card .row-actions button').first().click();
    await page.waitForSelector('#letterhead-dialog[open]');
    await page.locator('#letterhead-entity').fill('جهة جديدة <img src=x onerror=alert(1)>');
    assert.ok((await page.locator('#letterhead-live-preview').textContent()).includes('<img src=x'));
    assert.equal(await page.locator('#letterhead-live-preview img').count(), 0);
    checks++;
    await page.locator('#letterhead-education-position').selectOption('right');
    assert.equal(await page.locator('#save-letterhead-btn').isDisabled(), true);
    assert.ok((await page.locator('#letterhead-live-preview').textContent()).includes('اختر موضعًا آخر'));
    await page.locator('#letterhead-education-position').selectOption('left');
    assert.equal(await page.locator('#save-letterhead-btn').isDisabled(), false);
    checks++;
    await page.locator('#letterhead-entity').fill('وزارة التعليم');
    await page.screenshot({ path: path.join(artifacts, 'letterhead-desktop.png'), animations: 'disabled' });
    for (const size of [{ width: 1280, height: 720 }, { width: 1024, height: 480 }, { width: 360, height: 640 }]) {
      await page.setViewportSize(size);
      const metrics = await page.evaluate(() => {
        const dialog = document.querySelector('#letterhead-dialog');
        const box = dialog.getBoundingClientRect();
        const foot = dialog.querySelector('.modal-foot').getBoundingClientRect();
        const preview = dialog.querySelector('.letterhead-live-panel').getBoundingClientRect();
        const fields = dialog.querySelector('.letterhead-editor-fields').getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, scroll: document.documentElement.scrollWidth, footBottom: foot.bottom,
          arranged: innerWidth > 760 ? preview.left < fields.left : preview.top >= fields.bottom };
      });
      assert.ok(metrics.top >= 0 && metrics.bottom <= size.height && metrics.footBottom <= size.height && metrics.left >= 0 && metrics.right <= size.width && metrics.arranged && metrics.scroll <= size.width,
        `letterhead dialog ${size.width}x${size.height}: ${JSON.stringify(metrics)}`);
      checks++;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(artifacts, 'letterhead-mobile.png'), animations: 'disabled' });
    await page.locator('#letterhead-dialog [data-close]').first().click();

    await page.goto('http://teacher-bank.test/exam-view.html?id=exam-1');
    await page.waitForSelector('.exam-closing');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => {
      const link = document.querySelector('.skip-link').getBoundingClientRect();
      const header = document.querySelector('.site-header').getBoundingClientRect();
      return link.top >= 0 && link.bottom <= header.top && link.right <= innerWidth;
    }), true);
    checks++;
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.skip-link').evaluate((node) => getComputedStyle(node).display), 'none');
    checks++;
    await page.emulateMedia({ media: 'screen' });
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    assert.equal(await page.locator('.skip-link').evaluate((node) => node.getBoundingClientRect().bottom <= 0), true);
    checks++;
    const ending = await page.evaluate(() => {
      const questions = document.querySelector('.exam-questions').getBoundingClientRect();
      const closing = document.querySelector('.exam-closing').getBoundingClientRect();
      const footer = document.querySelector('.exam-generated-footer').getBoundingClientRect();
      return questions.bottom <= closing.top && closing.bottom <= footer.top && getComputedStyle(document.querySelector('.exam-ending')).position === 'static';
    });
    assert.equal(ending, true);
    checks++;
    await page.locator('#print-btn').click();
    for (const size of [{ width: 1280, height: 720 }, { width: 1024, height: 320 }, { width: 360, height: 480 }]) {
      await page.setViewportSize(size);
      const fit = await page.evaluate(() => {
        const dialog = document.querySelector('#print-notice-dialog');
        const box = dialog.getBoundingClientRect();
        const buttons = [...dialog.querySelectorAll('.modal-foot button')].map((node) => node.getBoundingClientRect());
        return box.top >= 0 && box.bottom <= innerHeight && buttons.every((button) => button.top >= 0 && button.bottom <= innerHeight && button.left >= 0 && button.right <= innerWidth)
          && getComputedStyle(document.body).overflow === 'hidden' && getComputedStyle(dialog.querySelector('.modal-body')).overflowY === 'auto';
      });
      assert.equal(fit, true, `print dialog ${size.width}x${size.height}`);
      checks++;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(artifacts, 'print-mobile.png'), animations: 'disabled' });
    await page.locator('#print-notice-dialog .modal-body').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await page.locator('#print-notice-dismiss').check();
    await page.locator('#print-notice-continue').click();
    await page.waitForFunction(() => window.__printed === true);
    assert.equal(await page.evaluate(() => localStorage.getItem('teacher-question-bank:print-notice-dismissed')), '1');
    checks++;
    await page.addInitScript(() => { window.__role = 'admin'; });
    await page.goto('http://teacher-bank.test/profile.html');
    await page.waitForSelector('[data-admin-navigation]');
    assert.equal(await page.locator('[data-admin-navigation]').getAttribute('href'), './admin.html');
    checks++;
    assert.deepEqual(errors, []);
    console.log(`Offline browser checks: ${checks} passed; no page errors; all network requests intercepted.`);
    console.log(`Screenshots: ${artifacts}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
