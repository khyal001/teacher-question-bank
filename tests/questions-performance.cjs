// Offline request/timing probe. No real Auth/SQL/Supabase calls are made.
// Optional TQB_BASELINE_DIR contains the original js/questions.js and js/auth.js.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installMock } = require('./offline-supabase-fixture.cjs');
const root = path.resolve(__dirname, '..');
const rtt = Number(process.env.TQB_RTT_MS || 250);
if (!Number.isFinite(rtt) || rtt < 0) throw new Error('Invalid simulated RTT');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.TQB_BROWSER_CHANNEL ? { channel: process.env.TQB_BROWSER_CHANNEL } : {}) });
  const reports = [];
  try {
    for (const baseline of process.env.TQB_BASELINE_DIR ? [process.env.TQB_BASELINE_DIR, null] : [null]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript({ content: `(${installMock.toString()})();
        window.__delayMs = ${rtt};
        window.__tables.questions.splice(3);
        new MutationObserver(() => {
          if (!window.__firstQuestionAt && document.querySelector('.question-card')) window.__firstQuestionAt = performance.now();
        }).observe(document, { childList: true, subtree: true });` });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://teacher-bank.test') return route.fulfill({ body: '', contentType: 'text/css' });
        if (url.pathname === '/js/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const isSupabaseConfigured = true; export const supabase = window.__mockSupabase;' });
        let file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 404, body: '' });
        if (baseline && ['/js/questions.js', '/js/auth.js'].includes(url.pathname)) file = path.join(baseline, url.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)], body: fs.readFileSync(file) });
      });
      await page.goto('http://teacher-bank.test/questions.html');
      await page.waitForFunction(() => document.querySelectorAll('.question-card').length === 3);
      const metrics = await page.evaluate(() => ({ firstQuestionMs: Math.round(__firstQuestionAt),
        calls: __calls.map((call) => ({ request: call.rpc || call.table, startMs: Math.round(call.at || 0) })) }));
      assert.deepEqual(errors, []);
      assert.equal(metrics.calls.length, baseline ? 6 : 1);
      assert.equal(await page.locator('.question-card').count(), 3);
      metrics.dataPhaseMs = metrics.firstQuestionMs - Math.min(...metrics.calls.map((call) => call.startMs));
      reports.push({ mode: baseline ? 'before' : 'after', simulatedRequestMs: rtt, ...metrics });
      await page.close();
    }
    console.log(JSON.stringify(reports, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
