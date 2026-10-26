// Offline only. Intercepts every HTTP request and uses artificial request latency.
// TQB_BASELINE_DIR optionally points to a copy of the pre-change HTML/JS/CSS.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installMock } = require('./offline-supabase-fixture.cjs');
const root = path.resolve(__dirname, '..');
const rtt = Number(process.env.TQB_RTT_MS || 250);
if (!Number.isFinite(rtt) || rtt < 0) throw new Error('Invalid simulated latency');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.TQB_BROWSER_CHANNEL ? { channel: process.env.TQB_BROWSER_CHANNEL } : {}) });
  const reports = [];
  try {
    for (const baseline of process.env.TQB_BASELINE_DIR ? [process.env.TQB_BASELINE_DIR, null] : [null]) {
      for (const [file, selector] of [['subjects.html', '.subject-card'], ['exam-view.html', '.exam-list-item'], ['letterheads.html', '.letterhead-card']]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript({ content: `(${installMock.toString()})();
          window.__delayMs = ${rtt}; window.__tables.questions.splice(3);
          window.__tables.letterheads = Array.from({length:3}, (_,i) => ({...window.__tables.letterheads[0], id:'lh-'+i, logo_path:'owner/logo-'+i+'.png'}));
          new MutationObserver(() => {
            if (!window.__firstCardAt && document.querySelector(${JSON.stringify(selector)})) window.__firstCardAt = performance.now();
          }).observe(document, { childList:true, subtree:true });` });
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== 'http://teacher-bank.test') return route.fulfill({ body: '', contentType: 'text/css' });
          if (url.pathname === '/js/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const isSupabaseConfigured = true; export const supabase = window.__mockSupabase;' });
          const filePath = path.resolve(baseline || root, '.' + url.pathname);
          if (!filePath.startsWith((baseline || root) + path.sep) || !fs.existsSync(filePath)) return route.fulfill({ status: 404, body: '' });
          return route.fulfill({ body: fs.readFileSync(filePath), contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(filePath)] });
        });
        await page.goto(`http://teacher-bank.test/${file}`);
        await page.waitForSelector(selector);
        if (file === 'letterheads.html') await page.waitForFunction(() => document.querySelectorAll('.letterhead-card-preview img').length === 3);
        const metrics = await page.evaluate(() => ({ firstCardMs: Math.round(__firstCardAt),
          calls: __calls.map((call) => ({ request: call.rpc || call.table || call.storage,
            startMs: Math.round(call.at || 0), endMs: Math.round(call.finishedAt || 0), paths: call.paths?.length })) }));
        assert.deepEqual(errors, []);
        assert.equal(metrics.calls.length, baseline ? (file === 'subjects.html' ? 9 : file === 'exam-view.html' ? 3 : 6) : (file === 'letterheads.html' ? 2 : 1));
        metrics.dataPhaseMs = metrics.firstCardMs - Math.min(...metrics.calls.map((call) => call.startMs));
        reports.push({ mode: baseline ? 'before' : 'after', page: file, simulatedRequestMs: rtt, ...metrics });
        await page.close();
      }
    }
    console.log(JSON.stringify(reports, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
