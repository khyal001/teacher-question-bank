# Repository Guidelines

## Project Structure & Module Organization
This Arabic, right-to-left question bank is a static HTML/CSS/JavaScript application backed by Supabase Auth, Postgres, and Storage.
- Root `*.html` files are entry pages; page controllers live in matching `js/*.js` files, such as `subjects.html` and `js/subjects.js`.
- Shared modules include `auth.js`, `supabase.js`, `ui.js`, and the `*-utils.js` helpers. Shared screen and print styles live in `css/style.css`.
- `supabase/schema.sql` defines fresh installations; `supabase/migrations/` contains upgrades. Logo assets are uploaded to private Supabase Storage.
- `tests/` contains local checks and the separate service integration test plan.

## Build, Test, and Development Commands
Run commands from the repository root:
- `python -m http.server 8000`: serve locally; open `http://localhost:8000`. There is no build step or npm dependency installation. Browser modules load directly, including a pinned Supabase CDN dependency.
- `node tests/local-tests.mjs`: run the offline suite with Node.js 20+, including admin and hardening checks, JavaScript syntax, DOM references, and static SQL contracts.
- `python tests/sql-parse.py`: parse SQL/PLpgSQL and compare schema/migration contracts without database execution; requires Python and `pglast`.

## Coding Style & Naming Conventions
Use two-space indentation in HTML, CSS, and JavaScript. Follow existing ES module imports, single-quoted strings, semicolons, camelCase variables/functions, and descriptive kebab-case filenames and DOM IDs. Keep shared logic in utility modules. No formatter or linter configuration is present. Preserve Arabic interface text, `dir="rtl"`, accessibility attributes, and A4 print behavior.

## Testing Guidelines
Local tests use Node's strict assertions and custom runners; no numeric coverage threshold is configured. Add descriptive behavioral cases to the relevant `tests/*-tests.mjs` module. Verify changed flows in the browser, including print preview for layout changes. Static checks do not prove RLS, Storage, or concurrency behavior; follow `tests/SUPABASE_TEST_PLAN.md` in an approved, separate Supabase test project.

## Commit & Pull Request Guidelines
Existing commits use short, imperative English subjects, such as `Harden exam snapshots and database rules`; follow that style. Describe behavior changes, validation results, related issues when applicable, and migration requirements in pull requests. Include screenshots for interface or print changes.

## Security & Data Integrity
Keep only public client configuration in `js/config.js`; never commit administrative keys or passwords. Preserve ownership checks, RLS, private logo storage, and saved exam snapshots. Use migrations for existing databases; never run the fresh-install schema over live data. Obtain approval before executing service-side changes.

## Agent-Specific Instructions

### اللغة وتجربة المعلم

- المشروع عربي وواجهة المستخدم RTL؛ استخدم مصطلحات عربية واضحة عند الكتابة للمستخدم.
- يمكن استخدام `teaching_groups` داخليًا. في واجهة المعلم استخدم «الصف / الفصل / القسم» أو «الصفوف والفصول والأقسام» بحسب السياق، ولا تجعل «المجموعة الدراسية» المصطلح الأساسي.
- إذا ارتبطت المادة بخيار واحد فقط من الصف/الفصل/القسم، اختره تلقائيًا في المواضع المناسبة وأظهره بوضوح. عند تعدد الخيارات، اعرض الاختيار للمستخدم. عند غياب الخيارات، امنع إنشاء الاختبار برسالة واضحة.

### الأمان والتنفيذ

- لا تستخدم `service_role` أو Secret API keys أو Database Password أو GitHub Token داخل كود الواجهة أو المستودع.
- حافظ على RLS وعزل بيانات المستخدمين. إخفاء صفحة أو رابط ليس حماية؛ يجب أن تعتمد أي صفحة Admin على صلاحيات حقيقية في قاعدة البيانات.
- لا تنفذ SQL على Supabase، ولا تغيّر إعدادات Supabase أو GitHub Pages، إلا بطلب صريح من المستخدم.
- لا تنفذ `git commit` أو `git push` أو نشرًا إلا بطلب صريح من المستخدم.
- قبل تعديل قاعدة البيانات، راجع Migration و`supabase/schema.sql` والتوافق مع البيانات التاريخية.
- لا تستخدم أوامر Git المدمرة مثل `reset --hard` أو `clean`، ولا تسترجع ملفات بطريقة قد تفقد تغييرات غير محفوظة، إلا بطلب صريح.

### الحفاظ على سلوك المشروع

- لا تعِد تصميم أجزاء مستقرة بلا حاجة.
- حافظ على Snapshots للاختبارات التاريخية وثبات شعاراتها؛ يجب ألا يفسد تعديل السؤال أو المادة أو حذفهما لاحقًا اختبارًا محفوظًا.
- تُحدد درجة السؤال داخل الاختبار، وليست درجة ثابتة في بنك الأسئلة. `position` هو المرجع النهائي لترتيب أسئلة الاختبار.
- مشاركة الأسئلة تنسخها إلى حساب المستلم، ولا تمنحه وصولًا مباشرًا إلى بيانات المرسل.
- في الطباعة، رقم الطالب/رقم الجلوس فراغ واحد قصير، وليس مربعات منفصلة. لا تعرض مدة الاختبار في التصميم الحالي.
- العبارة الختامية الافتراضية «انتهت الأسئلة»، ويمكن للمعلم تعديلها.

### إدارة السياق

- قبل أي مهمة كبيرة، اقرأ `PROJECT_STATE.md` إذا كان موجودًا؛ فهو مرجع الحالة الحالية والقرارات المعتمدة. لا تعِد اكتشاف المشروع كاملًا عندما تكون المعلومة موثقة فيه.
- بعد أي مهمة كبيرة، حدّث `PROJECT_STATE.md` فقط بطلب المستخدم أو إذا كان تحديثه جزءًا صريحًا من المهمة.
- عند تعارض معلومة قديمة في المحادثة مع الحالة الفعلية على القرص أو `PROJECT_STATE.md` المحدث، اعتمد الحالة الأحدث الموثقة.

### Graphify Knowledge Graph

- لفهم بنية المشروع والعلاقات بين الملفات أو الدوال أو الجداول أو الاعتماديات، استخدم Graphify أولًا بدل إعادة قراءة المشروع كاملًا.
- فضّل استعلامات Graphify المحددة قبل البحث الواسع أو قراءة عدد كبير من الملفات.
- اقرأ الملفات الأصلية للتحقق من الكود الفعلي أو تعديل سطر محدد؛ Graphify مساعد للفهم وليس بديلًا عن المصدر.
- استخدم `PROJECT_STATE.md` لمعرفة حالة المشروع والقرارات المعتمدة، وGraphify لفهم العلاقات التقنية داخل الكود.
- لا تعِد بناء خريطة Graphify دون حاجة إذا كانت الخريطة الحالية محدثة.
