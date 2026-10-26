// UI integration only, with an entirely offline Supabase substitute.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installMock } = require('./offline-supabase-fixture.cjs');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.TQB_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tqb-exams-ui-'));
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.TQB_BROWSER_CHANNEL ? { channel: process.env.TQB_BROWSER_CHANNEL } : {}) });
  let checks = 0;
  const errors = [];
  async function open(file, setup = '') {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript({ content: `(${installMock.toString()})(); ${setup}` });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://teacher-bank.test') return route.fulfill({ body: '', contentType: 'text/css' });
      if (url.pathname === '/js/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const isSupabaseConfigured = true; export const supabase = window.__mockSupabase;' });
      const filePath = path.resolve(root, '.' + url.pathname);
      if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(filePath), contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(filePath)] });
    });
    await page.goto(`http://teacher-bank.test/${file}`);
    return page;
  }
  try {
    let page = await open('subjects.html', `__tables.subjects = Array.from({length:53}, (_,i) => ({...__tables.subjects[0], id:i?'subject-'+(i+1):'subject-1', name:'مادة '+(i+1)})); __role='admin';`);
    await page.waitForFunction(() => document.querySelectorAll('.subject-card').length === 25);
    await page.waitForSelector('[data-admin-navigation]');
    assert.deepEqual(await page.evaluate(() => __calls.map((c) => c.rpc || c.table)), ['get_subjects_page']);
    checks++;
    await page.locator('.library-pagination button').last().click();
    await page.waitForFunction(() => document.querySelector('.subject-card-title').textContent === 'مادة 26');
    assert.equal(await page.evaluate(() => __calls.at(-1).params.p_include_metadata), false);
    checks++;
    await page.locator('#add-subject-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('input[name="subject-group"]').length === 2);
    assert.equal(await page.evaluate(() => __calls.filter((c) => c.table === 'teaching_groups').length), 1);
    checks++;
    assert.equal(await page.locator('[data-rpc-ms]').count(), 0);
    checks++;
    await page.close();
    page = await open('subjects.html?measure=1');
    await page.waitForSelector('[data-list-ready-ms]');
    assert.equal(await page.locator('[data-page-requests]').getAttribute('data-page-requests'), '1');
    assert.ok(Number(await page.locator('[data-rpc-ms]').getAttribute('data-rpc-ms')) >= 0);
    checks++;
    await page.close();

    page = await open('exam-view.html');
    await page.waitForSelector('.exam-list-item');
    assert.deepEqual(await page.evaluate(() => __calls.map((c) => c.rpc || c.table)), ['get_exams_page']);
    assert.equal(await page.locator('a[href*="mode=edit"]').count(), 1);
    assert.equal(await page.locator('a[href*="mode=copy"]').count(), 1);
    checks++;
    await page.close();

    page = await open('letterheads.html', `__logoDelayMs=700; __tables.letterheads = Array.from({length:20},(_,i)=>({...__tables.letterheads[0],id:'lh-'+i,logo_path:'owner/'+i+'.png'}));`);
    await page.waitForSelector('.letterhead-card');
    assert.equal(await page.locator('.letterhead-card').count(), 20);
    assert.equal(await page.locator('.letterhead-card-preview img').count(), 0);
    checks++;
    await page.waitForFunction(() => document.querySelector('.letterhead-card-preview img'));
    const logos = await page.evaluate(() => ({ calls: __calls.filter((c) => c.storage), count: document.querySelectorAll('.letterhead-card-preview img').length }));
    assert.equal(logos.calls.length, 1);
    assert.ok(logos.calls[0].paths.length < 20 && logos.count > 0);
    checks++;
    const callsBeforeFocus = await page.evaluate(() => __calls.length);
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.locator('.letterhead-card .row-actions button').first().click();
    await page.waitForSelector('#letterhead-dialog[open]');
    assert.equal(await page.evaluate(() => __calls.length), callsBeforeFocus);
    checks++;
    await page.close();

    page = await open('questions.html');
    await page.waitForSelector('.question-card');
    await page.locator('#add-question-btn').click();
    await page.waitForFunction(() => !document.querySelector('#save-question-btn').disabled);
    assert.equal(await page.locator('#question-difficulty').inputValue(), '');
    assert.equal(await page.locator('input[name="group-scope"][value="selected"]').isChecked(), true);
    assert.equal(await page.locator('#question-difficulty').evaluate((e) => e.validity.valueMissing), true);
    checks++;
    await page.close();

    page = await open('exam-builder.html', `__tables.questions.forEach((q,i)=>{q.type=['true_false','mcq','short'][i%3];q.difficulty=['easy','medium','hard'][i%3];if(q.type==='mcq'){q.options=['أ','ب'];q.correct_answer='أ';}});`);
    await page.waitForFunction(() => document.querySelector('#exam-subject').options.length === 3);
    await page.locator('#exam-subject').selectOption('subject-1');
    await page.waitForFunction(() => document.querySelector('#available-true_false-easy').textContent !== 'المتاح: 0');
    await page.locator('#exam-title').fill('توزيع محلي');
    await page.locator('#exam-total-points').fill('11');
    await page.locator('#count-true_false-easy').fill('2');
    await page.locator('#count-mcq-medium').fill('1');
    await page.locator('#count-short-hard').fill('1');
    await page.locator('#generate-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.preview-question').length === 4);
    assert.deepEqual(await page.locator('.preview-point-input').evaluateAll((els) => els.map((e) => Number(e.value))), [3, 3, 3, 2]);
    assert.deepEqual(await page.locator('.preview-question .badge-type').allTextContents(), ['صح / خطأ', 'صح / خطأ', 'اختيار من متعدد', 'إجابة قصيرة']);
    checks++;
    await page.locator('#save-exam-btn').click();
    await page.waitForFunction(() => window.__savedPayload);
    assert.deepEqual(await page.evaluate(() => __savedPayload.p_questions.map((q) => q.position)), [1, 2, 3, 4]);
    checks++;
    await page.locator('#count-mcq-medium').fill('99');
    await page.locator('#generate-btn').click();
    assert.match(await page.locator('#builder-error').textContent(), /اختيار من متعدد — متوسط: المطلوب 99/);
    checks++;
    await page.locator('#count-true_false-easy').fill('1');
    await page.locator('#count-mcq-medium').fill('0');
    await page.locator('#count-short-hard').fill('0');
    await page.getByRole('button', { name: 'إضافة التوزيع إلى المعاينة الحالية', exact: true }).click();
    assert.equal(await page.locator('.preview-question').count(), 5);
    assert.equal(await page.locator('#save-exam-btn').isDisabled(), true);
    await page.locator('#redistribute-btn').click();
    assert.deepEqual(await page.locator('.preview-point-input').evaluateAll((els) => els.map((e) => Number(e.value))), [3, 2, 2, 2, 2]);
    await page.getByRole('button', { name: 'إزالة', exact: true }).first().click();
    assert.equal(await page.locator('.preview-question').count(), 4);
    checks++;
    await page.setViewportSize({ width: 360, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'distribution-mobile.png'), fullPage: true });
    checks++;
    await page.close();

    for (const mode of ['edit', 'copy']) {
      page = await open(`exam-builder.html?source=exam-1&mode=${mode}`, `__tables.questions[0].question_text='تغير في البنك';`);
      await page.waitForFunction(() => document.querySelectorAll('.preview-question').length === 3);
      assert.equal(await page.locator('.preview-q-text').first().textContent(), 'سؤال تجريبي 1');
      assert.equal(await page.locator('#exam-letterhead').inputValue(), '_historical');
      assert.equal(await page.locator('#exam-subject').isDisabled(), true);
      assert.equal((await page.locator('#exam-title').inputValue()).endsWith(' — نسخة'), mode === 'copy');
      checks++;
      await page.locator('#exam-total-points').fill('4');
      await page.locator('.preview-point-input').first().fill('2');
      await page.locator('#save-exam-btn').click();
      await page.waitForFunction(() => window.__savedPayload);
      const state = await page.evaluate(() => ({ payload: __savedPayload, rpc: __calls.find((c) => c.rpc === 'save_exam_revision'),
        originalPoints: __tables.exam_questions.map((q) => q.snapshot.points), originalTitle: __tables.exams[0].title }));
      assert.equal(state.rpc.params.p_source_exam_id, 'exam-1');
      assert.equal(state.payload.p_keep_letterhead, true);
      assert.deepEqual(state.payload.p_questions.map((q) => q.source_row_id), ['eq-0', 'eq-1', 'eq-2']);
      assert.deepEqual(state.originalPoints, [1, 1, 1]);
      assert.equal(state.originalTitle, 'اختبار تجريبي');
      checks++;
      await page.close();
    }

    page = await open('exam-builder.html?source=exam-1&mode=copy', `
      __tables.exams[0].subject_id=null; __tables.exams[0].group_ids_snapshot=[]; __tables.exams[0].group_names_snapshot=[];
      __tables.subjects=[]; __tables.letterheads=[]; __tables.exam_questions.forEach(q=>q.question_id=null);
    `);
    await page.waitForFunction(() => document.querySelectorAll('.preview-question').length === 3);
    assert.equal(await page.locator('#save-exam-btn').isEnabled(), true);
    assert.match(await page.locator('#exam-groups').textContent(), /صف قديم/);
    await page.locator('#save-exam-btn').click();
    await page.waitForFunction(() => window.__savedPayload);
    assert.equal(await page.evaluate(() => __calls.some(c=>c.rpc==='save_exam_revision')), true);
    checks++;
    await page.close();

    page = await open('exam-builder.html?source=exam-1&mode=copy', `
      __tables.exam_questions[0].snapshot.points=1.234; __tables.exams[0].total_points=3.234;
    `);
    await page.waitForFunction(() => document.querySelectorAll('.preview-question').length === 3);
    assert.equal(await page.locator('.preview-point-input').first().inputValue(), '1.234');
    assert.equal(await page.locator('#save-exam-btn').isDisabled(), true);
    assert.match(await page.locator('#builder-error').textContent(), /توجد درجات تاريخية/);
    checks++;
    await page.close();

    page = await open('exam-view.html?id=exam-1', `
      const types=['short','mcq','true_false','mcq','true_false'];
      __tables.exam_questions=types.map((type,i)=>({id:'eq-'+i,position:i+1,snapshot:{type,question_text:'فقرة '+i,options:type==='mcq'?['أ','ب']:null,correct_answer:'أ',points:i+1}}));
      __tables.exams[0].total_points=15;
    `);
    await page.waitForSelector('.exam-short-item');
    assert.equal(await page.locator('.exam-section-true_false').count(), 1);
    assert.equal(await page.locator('.exam-section-mcq').count(), 1);
    assert.deepEqual(await page.locator('.exam-section-title > .exam-grade-left').allTextContents(), ['8 درجة', '6 درجة']);
    assert.equal(await page.locator('.exam-short-grade').textContent(), '1 درجة');
    assert.equal(await page.locator('.exam-q-number .exam-q-points').count(), 0);
    checks++;
    await page.emulateMedia({ media: 'print' });
    const left = await page.evaluate(() => [...document.querySelectorAll('.exam-grade-left')].every((grade) => {
      const g = grade.getBoundingClientRect(), parent = grade.parentElement.getBoundingClientRect();
      return g.left < parent.left + parent.width / 2 && g.right <= parent.right;
    }));
    assert.equal(left, true);
    checks++;
    await page.pdf({ path: path.join(artifacts, 'grouped-exam.pdf'), format: 'A4', printBackground: true });
    await page.screenshot({ path: path.join(artifacts, 'grouped-exam.png'), fullPage: true });
    await page.close();
    assert.deepEqual(errors, []);
    console.log(`Offline library/exam browser checks: ${checks} passed. No real service calls or page errors.`);
    console.log(`Print artifacts: ${artifacts}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
