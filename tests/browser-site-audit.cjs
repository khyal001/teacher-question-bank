// Local-only review: all service requests are intercepted, no accounts are created.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TQB_BROWSER_CHANNEL || 'msedge' });
  let checks = 0;
  const errors = [];
  try {
    for (const configured of [true, false]) {
      const context = await browser.newContext();
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://teacher-bank.test') return route.fulfill({ body: '', contentType: 'text/css' });
        if (url.pathname === '/js/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: `
          export const isSupabaseConfigured = ${configured};
          export const supabase = { auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithPassword: async () => { window.authCalls = (window.authCalls || 0) + 1; return { error: { message: 'Invalid login credentials' } }; },
            signUp: async () => { window.signupCalls = (window.signupCalls || 0) + 1; return { data: { user: { identities: [{}] }, session: null }, error: null }; }
          } };` });
        const file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      assert.equal(html.includes('setup-notice'), false);
      assert.equal(html.includes('غير متاحين حاليًا'), false);
      checks += 2;
      await page.goto('http://teacher-bank.test/index.html');
      if (configured) {
        await page.waitForFunction(() => document.querySelector('#tab-signup').getAttribute('aria-selected') === 'false');
        assert.equal(await page.locator('#setup-notice').count(), 0);
        assert.equal(await page.locator('#login-submit').isEnabled(), true);
        await page.locator('#login-email').fill('teacher@example.com');
        await page.locator('#login-password').fill('test-password');
        await page.locator('#login-submit').click();
        await page.waitForFunction(() => window.authCalls === 1);
        await page.locator('#tab-signup').click();
        await page.locator('#signup-name').fill('معلم التحقق');
        await page.locator('#signup-email').fill('teacher@example.com');
        await page.locator('#signup-password').fill('test-password');
        await page.locator('#signup-confirm').fill('test-password');
        await page.locator('#signup-submit').click();
        await page.waitForFunction(() => window.signupCalls === 1);
        assert.match(await page.locator('#auth-feedback').innerText(), /تحقق من بريدك/);
        checks += 4;
      } else {
        await page.locator('#setup-notice').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#setup-notice').count(), 1);
        assert.match(await page.locator('#setup-notice').innerText(), /تسجيل الدخول وإنشاء الحساب غير متاحين/);
        assert.equal(await page.locator('#auth-intro').innerText(), 'تواصل مع مسؤول الموقع للمساعدة، أو حاول لاحقًا.');
        assert.match(await page.locator('#auth-title').innerText(), /غير متاحين/);
        assert.equal(await page.locator('#login-submit').isDisabled(), true);
        await page.locator('#tab-signup').click();
        assert.equal(await page.locator('#signup-submit').isDisabled(), true);
        assert.equal(await page.locator('#setup-notice a').getAttribute('href'), './about.html#contact-title');
        await page.locator('#setup-notice a').click();
        await page.locator('#contact-title').waitFor();
        assert.match(await page.locator('#contact-email').getAttribute('href'), /^mailto:/);
        checks += 8;
      }
      for (const [file, canonical] of [['index.html', 'https://khyal001.github.io/teacher-question-bank/'], ['about.html', 'https://khyal001.github.io/teacher-question-bank/about.html']]) {
        await page.goto('http://teacher-bank.test/' + file);
        assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical);
        assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), canonical);
        assert.ok(await page.locator('meta[property="og:title"]').getAttribute('content'));
        assert.equal(await page.locator('meta[property="og:description"]').getAttribute('content'), await page.locator('meta[name="description"]').getAttribute('content'));
        checks += 5;
        for (const width of [1440, 375, 320]) {
          await page.setViewportSize({ width, height: 900 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          checks++;
        }
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(`${checks} browser checks passed; no page errors; services mocked.`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
