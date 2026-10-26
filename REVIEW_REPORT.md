# تقرير مراجعة إعادة تصميم مشروع `teacher-question-bank`

- **التاريخ:** 2026-10-26
- **الفرع:** `main`
- **آخر Commit موجود:** `b2490db` — `Require grade level for subjects and new exams`
- **حالة التسليم:** جاهز للمراجعة فقط. لم يُنفّذ SQL على Supabase، ولم يُنفّذ Commit أو Push أو نشر.
- **ملاحظة:** هذا الملف هو تقرير المراجعة الكامل، ويحتوي في نهايته على نسخة كاملة من ملف الـ Migration للقراءة فقط. الملف نفسه ليس جزءاً من كود التطبيق.

---

## 1) الملخص التنفيذي

تمت إعادة تصميم التطبيق من نموذج «مادة + صف دراسي ثابت + درجة سؤال ثابتة» إلى نموذج:

- مادة واحدة مستقلة، ترتبط بعدة مجموعات دراسية عبر علاقة Many-to-Many.
- مجموعات دراسية مستقلة قابلة للإدارة دون تكرار المادة.
- سؤال تابع لمادة واحدة، ويطبق على جميع مجموعات المادة أو على مجموعات محددة.
- إزالة الدرجة الثابتة من بنك الأسئلة؛ الدرجات تُحدد وتُوزع عند إنشاء الاختبار.
- حفظ الاختبار ودرجاته وترتيب أسئلته داخل `snapshot` تاريخي، مع تحقق خادمي من أن مجموع الدرجات يساوي إجمالي الاختبار.
- كليشة قابلة للتخصيص مع شعار في Storage خاص وسياسات RLS لكل مستخدم.
- مشاركة آمنة لحزمة أسئلة المادة عبر مفتاح عشوائي، مع تخزين hash فقط، واستيراد إلى حساب المستقبل دون وصول مباشر لبيانات المرسل.
- طباعة A4 محسّنة: خانة درجة جديدة، اسم الطالب، سطر واحد قصير لرقم الطالب/الجلوس، أقسام حسب نوع السؤال، وتعليمات صح/خطأ واختيار من متعدد مطابقة للمواصفات.
- Migration واحدة آمنة للقاعدة الحالية، مع الإبقاء على الأعمدة القديمة دون حذف بيانات.

الحالة الفنية الحالية: جميع الملفات الجديدة والمعدلة موجودة على القرص، والاختبارات المحلية ناجحة (31/31)، وملفات SQL تجتاز تحليل parser، لكن **لم تُنفّذ قاعدة البيانات فعلياً** ولم تُختبر عمليات Supabase الحية.

---

## 2) الملفات

### 2.1 ملفات معدّلة

| الملف | طبيعة التغيير |
|---|---|
| `README.md` | إعادة كتابة لتوثيق النموذج الجديد، الأمان، الترقية، الخطوات اليدوية، والقيود. |
| `css/style.css` | تنسيقات الصفحات الجديدة، الكليشة، أقسام الأسئلة، الطباعة A4، خانة الدرجة، سطر رقم الطالب/الجلوس، وتنبيه الطباعة. |
| `dashboard.html` | إضافة روابط «المجموعات» و«الكليشة» إلى التنقل. |
| `exam-builder.html` | حقول الكليشة، إجمالي الدرجات، العبارة الختامية، المجموعات، معاينة الدرجات والتخطيط. |
| `exam-view.html` | واجهة الاختبار المحفوظ، تنبيه الرؤوس/التذييلات، خانة الدرجة، بيانات الطالب، الطباعة. |
| `index.html` | تحديث نص الواجهة لإزالة «الصف» وإضافة «المجموعة». |
| `js/auth.js` | عودة آمنة بعد الدخول/التأكيد، منع تسريب token المشاركة في query string، إدارة جلسة/تنقل. |
| `js/config.js` | تحديث تعليق الأمان فقط؛ لم تُضف أي مفاتيح سرية. |
| `js/dashboard.js` | إزالة قراءة `points` و`grade_level` من لوحة التحكم. |
| `js/exam-builder.js` | إعادة بناء منشئ الاختبار: المجموعات، التوزيع، التحقق، الاستبدال، المعاينة، الحفظ عبر RPC. |
| `js/exam-view.js` | إعادة بناء عرض/طباعة الاختبار، الكليشة، الأقسام، خانة الدرجة، سطر الرقم، نموذج الإجابة. |
| `js/index.js` | استهلاك `next` الآمن بعد تسجيل الدخول أو تأكيد البريد. |
| `js/questions.js` | نطاق المجموعات، إزالة الدرجة الثابتة، الحفظ عبر `save_question`، معالجة السؤال المحدد بلا مجموعات. |
| `js/subjects.js` | بطاقات المواد، شرائح المجموعات، إنشاء/تعديل عبر `save_subject`، مشاركة/إلغاء مشاركة. |
| `js/ui.js` | مساعدات العرض، تسميات النطاق، تنبيه الطباعة، bucket الأصول، الحافظة. |
| `questions.html` | إزالة حقول الصف/الدرجة الثابتة وإضافة واجهة نطاق المجموعات. |
| `subjects.html` | واجهة المواد/المجموعات والمشاركة والاستيراد. |
| `supabase/schema.sql` | مخطط كامل جديد للمشروع الجديد، مع الأعمدة القديمة للتوافق. |

### 2.2 ملفات جديدة

| الملف | الغرض |
|---|---|
| `groups.html` | صفحة إدارة المجموعات الدراسية المستقلة. |
| `letterheads.html` | صفحة إدارة قوالب الكليشة والشعارات. |
| `share-import.html` | صفحة استيراد حزمة أسئلة من رابط مشاركة. |
| `js/groups.js` | CRUD المجموعات، عدّ الارتباطات، تحذير الحذف. |
| `js/letterheads.js` | CRUD الكليشة، رفع الشعار الخاص، signed URLs، تنظيف الأصول. |
| `js/share-import.js` | التحقق من المفتاح، معاينة الحزمة، ربط المجموعات، الاستيراد. |
| `js/exam-utils.js` | دوال نقية للدرجات (سنتات)، التوزيع الدقيق، تخطيط MCQ، بناء الأقسام. |
| `supabase/migrations/20261026_subjects_groups_sharing.sql` | الترقية الآمنة الوحيدة للقاعدة الحالية. |
| `tests/local-tests.mjs` | 31 اختباراً محلياً ثابتاً/وظيفياً. |
| `REVIEW_REPORT.md` | تقرير المراجعة هذا (ليس ملف تشغيل). |

### 2.3 ملفات محذوفة

| الملف | سبب الحذف |
|---|---|
| `supabase/migrations/20261026_require_subject_grade.sql` | ترقية قديمة تفرض الصف الدراسي وتتعارض مع النموذج الجديد؛ استُبدلت بالترقية الآمنة الجديدة. |

---

## 3) تصميم قاعدة البيانات الجديد

### 3.1 الجداول الموجودة والمعدّلة

| الجدول | التغيير |
|---|---|
| `subjects` | `grade_level` أصبح اختيارياً، ويُحوّل الفراغ/المسافات إلى `NULL`. الاسم يبقى إلزامياً. |
| `questions` | إضافة `group_scope` (`all` أو `selected`). `points` أصبح اختيارياً وبدون Default، ويُحفظ للتاريخ فقط. |
| `exams` | إضافة `total_points`، `group_names_snapshot`، `letterhead_id`، `letterhead_snapshot`، `closing_phrase`. الإبقاء على `grade_level_snapshot` و`duration_minutes` كأعمدة قديمة غير مستخدمة. |
| `exam_questions` | استخدام `snapshot` لحفظ النص والخيارات والإجابة والصعوبة والدرجة والتخطيط والوحدة. `question_id` يصبح `NULL` عند حذف السؤال الأصلي. |

### 3.2 الجداول الجديدة

| الجدول | الغرض |
|---|---|
| `teaching_groups` | مجموعة دراسية مستقلة يملكها المعلم، باسم فريد لكل مستخدم. |
| `subject_groups` | ربط Many-to-Many بين المواد والمجموعات. |
| `question_groups` | ربط السؤال بمجموعات محددة، مع ضمان أن المجموعة مرتبطة بالمادة نفسها. |
| `letterheads` | قالب كليشة: الجهة/المدرسة/الجامعة/الكلية/القسم/نص إضافي/مسار الشعار. |
| `question_share_packages` | حزمة مشاركة أسئلة مع hash المفتاح وتاريخ الانتهاء والاستخدام والإلغاء. |

### 3.3 العلاقات

- `auth.users` ← `subjects` / `teaching_groups` / `questions` / `letterheads` / `exams` / `question_share_packages` عبر `user_id` مع `on delete cascade`.
- `subjects` ↔ `teaching_groups` عبر `subject_groups` (Many-to-Many).
- `subjects` ← `questions` (One-to-Many، حذف المادة يحذف أسئلتها).
- `questions` ↔ `teaching_groups` عبر `question_groups` (Many-to-Many).
- `question_groups(subject_id, group_id)` مرتبط مركباً بـ `subject_groups(subject_id, group_id)`، ما يمنع ربط سؤال بمجموعة لا تتبع مادته.
- `questions` ← `exam_questions` (One-to-Many؛ `question_id` يصبح `NULL` عند حذف السؤال).
- `exams` ← `exam_questions` (One-to-Many، حذف الاختبار يحذف صفوفه).
- `letterheads` ← `exams.letterhead_id` (`on delete set null` مع الاحتفاظ بـ `letterhead_snapshot`).
- `subjects` ← `exams.subject_id` (`on delete set null` مع الاحتفاظ باسم المادة في snapshot).
- `subjects` ← `question_share_packages.subject_id` (`on delete set null`).
- `auth.users` ← `question_share_packages.used_by` (`on delete set null`).

---

## 4) التعامل مع `grade_level` القديم

- لم يُحذف العمود ولم تُحذف قيمه.
- أصبح `NULL` مسموحاً.
- القيم الفارغة أو المكوّنة من مسافات فقط تُحوّل إلى `NULL`، ولا تُخترع قيمة بديلة.
- لا تُنشئ الترقية مجموعات أو صفوفاً تلقائياً.
- المادة الحالية `الرياضيات` تبقى كما هي، ولو كانت بلا صف أو بلا مجموعات.
- واجهات المواد/الأسئلة/منشئ الاختبار/الطباعة لا تقرأ `grade_level` ولا تعرضه.
- `exams.grade_level_snapshot` باقٍ للاختبارات القديمة فقط، ولا يُفرض على الاختبارات الجديدة.

---

## 5) التعامل مع `questions.points`

- لم يُحذف العمود ولم تُحذف القيم القديمة.
- أُزيل `NOT NULL` و`DEFAULT`، وأصبح `NULL` مسموحاً.
- لم يعد بنك الأسئلة يقرأ أو يكتب `points`.
- درجات الأسئلة الجديدة تُحدد في منشئ الاختبار وتُحفظ في `exam_questions.snapshot.points`.
- لا تُستخدم درجة ثابتة للسؤال في أي منطق جديد.
- الأسئلة القديمة تحتفظ بقيمها التاريخية، والاختبارات القديمة تُقرأ من snapshot عند العرض.

---

## 6) تصميم درجات الاختبار

- إجمالي الاختبار رقم موجب بحد أقصى منزلتين عشريتين.
- درجة كل سؤال رقم موجب بحد أقصى منزلتين عشريتين.
- التوزيع التلقائي يستخدم السنتات لتجنب أخطاء الفاصلة العائمة.
- الباقي يوزع على أول الأسئلة بحيث يكون المجموع مساوياً تماماً للإجمالي.
- المعاينة تعرض: الإجمالي، الموزّع، المتبقي.
- لا يمكن الحفظ إذا كان المجموع لا يساوي الإجمالي، أو إذا كانت أي درجة غير موجبة/غير صالحة.
- `save_exam` يتحقق من الإجمالي ومن مجموع snapshot الدرجات داخل قاعدة البيانات، ثم يحفظ الاختبار وأسئلته في معاملة واحدة.
- درجات الأسئلة القديمة تُستخرج من snapshot عند عرض اختبار قديم، مع fallback آمن للإجمالي القديم عند غياب `total_points` الصالح.

---

## 7) تصميم المجموعات الدراسية

- المجموعة كيان مستقل في `teaching_groups`، وليست نصاً داخل المادة.
- لكل معلم مجموعاته، والاسم فريد لكل مستخدم.
- المادة ترتبط بأي عدد من المجموعات عبر `subject_groups`.
- المادة تظهر مرة واحدة في الواجهة، وتحتها شرائح/بطاقات مجموعاتها.
- تعديل مجموعات مادة قائمة يعدّل صفوف الربط فقط، ولا ينشئ مادة جديدة.
- إنشاء/تعديل مادة يتطلب مجموعة واحدة على الأقل.
- المادة القديمة بلا مجموعات تبقى قابلة للعرض والاستخدام في الأسئلة والاختبارات، ولا تُمنح مجموعة مخترعة.
- حذف مجموعة يحذف ارتباطاتها؛ وتظهر تحذيرات عند وجود مواد/أسئلة مرتبطة.

---

## 8) تصميم ربط الأسئلة بالمجموعات

- `questions.group_scope = 'all'`: السؤال يطبق على جميع مجموعات المادة، بما فيها المجموعات التي تُضاف مستقبلاً.
- `questions.group_scope = 'selected'`: السؤال يطبق فقط على الصفوف الموجودة في `question_groups`.
- لا تُستخدم صفوف `question_groups` عندما يكون النطاق `all`.
- إضافة مجموعة جديدة للمادة لا تغيّر معنى السؤال القديم `all`، ولا تحوّله إلى `selected`.
- الأسئلة المحددة بلا مجموعات (مثلاً بعد حذف مجموعة) تظهر في الواجهة مع تنبيه لعدم وجود مجموعات محددة، ولا تُحوّل تلقائياً إلى `all`.
- منشئ الاختبار يرشح الأسئلة حسب المجموعات المختارة والمادة.
- الاختبار المحفوظ يحفظ أسماء المجموعات في `group_names_snapshot`، فلا تتغير الاختبارات القديمة عند تعديل المجموعات لاحقاً.

---

## 9) تصميم الكليشة والشعارات

- القالب يحتوي: الاسم، الجهة، المدرسة، الجامعة، الكلية، القسم، نصاً إضافياً، ومسار الشعار.
- الشعار يُرفع إلى Supabase Storage في bucket خاص `letterhead-logos`.
- الحد الأقصى 2MB، والأنواع: PNG/JPEG/WebP.
- مسار الملف يبدأ بـ `auth.uid()/...`، وسياسات Storage تمنع قراءة/كتابة شعار مستخدم آخر.
- العرض يستخدم signed URL مؤقتاً، وليس bucket عاماً ولا Base64.
- عند حفظ الاختبار تُحفظ نسخة كاملة من الكليشة في `letterhead_snapshot`، بما فيها `logo_path`.
- حذف قالب الكليشة يحوّل `exams.letterhead_id` إلى `NULL`، لكن snapshot يبقى للعرض التاريخي.
- تنظيف الشعار يتم بحذر: لا يُحذف إذا كان ما زال مذكوراً في snapshot اختبار محفوظ.

---

## 10) تصميم الطباعة

- الورق A4، مع هوامش طباعة مناسبة.
- لا تُطبع المدة، ولا الصف الدراسي، ولا إجمالي الدرجات في رأس الصفحة.
- خانة الدرجة:
  - إطار واضح.
  - النصف العلوي فارغ.
  - النصف السفلي يعرض الرقم فقط، دون كلمة «درجة» بجانبه.
  - التسمية أعلى الخانة: `درجة الاختبار`.
- بيانات الطالب:
  - يبقى سطر `اسم الطالب`.
  - يضاف سطر واحد قصير `رقم الطالب/رقم الجلوس` في موضع خانة الدرجة القديمة، بطول يقارب أربعة أرقام، وليس خانات منفصلة.
- الأسئلة تُجمع في أقسام حسب النوع: صح/خطأ، اختيار من متعدد، إجابة قصيرة.
- الترقيم تسلسلي على مستوى الاختبار.
- لا تظهر درجة بجانب رقم السؤال في الاختبار المطبوع؛ تظهر داخل قوس صغير `(1)` فقط.
- العبارة الختامية تظهر منفصلة عن سطر التذييل:
  `تم إنشاء هذا الاختبار بواسطة بنك أسئلة المعلم`
- تنبيه الطباعة يشرح تعطيل الرؤوس والتذييلات، ويُخفي نفسه من الطباعة، ويُحفظ اختيار عدم الإظهار محلياً.
- نموذج الإجابة يظهر عند الطلب فقط، ولا يُطبع مع ورقة الاختبار الافتراضية.

---

## 11) تصميم الصح والخطأ

- عنوان القسم ثابت:
  `ضع علامة (✓) أمام العبارة الصحيحة، وعلامة (✗) أمام العبارة الخاطئة.`
- كل عبارة تظهر في سطر/كتلة قابلة للالتفاف.
- يوجد فراغ ثابت `(     )` في أقصى اليسار، أسفل الكتلة، محاذٍ لآخر سطر نصي.
- لا توجد خانات منفصلة لكل عبارة.
- التصميم يحافظ على `break-inside: avoid` عند الطباعة.

---

## 12) تصميم الاختيار من متعدد

- عنوان القسم: `اختر الإجابة الصحيحة.`
- أوضاع العرض:
  - `auto`: يختار تلقائياً بين كامل/نصف حسب المحتوى.
  - `full`: عمود واحد.
  - `half`: عمودان.
- الاختيار التلقائي يعتمد على عدد الخيارات، ووجود نص طويل/متعدد الأسطر، وإجمالي طول النص.
- يمكن للمعلم تجاوز التخطيط لكل سؤال من منشئ الاختبار.
- التخطيط يُحفظ داخل `exam_questions.snapshot.layout` ويُستخدم عند الطباعة.
- الخيارات تظهر بحروف/أرقام واضحة، مع الحفاظ على ترتيبها داخل snapshot.

---

## 13) تصميم العبارة الختامية

- حقل نصي اختياري في منشئ الاختبار.
- تُحفظ في `exams.closing_phrase` وتُعرض في نهاية ورقة الاختبار قبل التذييل.
- لا تختلط بالتذييل التلقائي؛ لكلٍ منهما تنسيق منفصل.
- لا تُطبع إذا كانت فارغة.
- لا تُعدل بعد حفظ الاختبار (حماية snapshot).

---

## 14) تصميم مشاركة الأسئلة بين المعلمين

- المشاركة على مستوى **مادة**، وليس سؤالاً منفرداً.
- `create_question_share` ينشئ:
  - مفتاحاً خاماً عشوائياً 32 بايت (hex).
  - hash SHA-256 فقط في `question_share_packages.token_hash`.
  - تاريخ انتهاء افتراضي 7 أيام (قابل للاختيار).
- المفتاح الخام يُعاد مرة واحدة فقط لإنشاء الرابط، ولا يُخزّن في قاعدة البيانات.
- الرابط يستخدم fragment `#token=...`، لا query string؛ حتى لا يتسرب إلى سجلات الخادم/Referrer.
- لا توجد هوية للمرسل ولا بريده ولا معرّفات مجموعاته الأصلية داخل الحزمة؛ تُستخدم مفاتيح مشتقة `sha256(token + ':' + group_id)` للمجموعات.
- الاستهلاك أحادي: `used_at` يمنع إعادة الاستخدام، مع قفل الصف أثناء الاستيراد.
- يمكن إلغاء الرابط قبل استخدامه عبر `revoke_question_share`.
- المشاركة تتطلب تسجيل دخول، ولا تمنح المستقبل وصولاً مباشراً إلى جداول المرسل.
- لا تُستخدم `service_role` في أي مكان.
- حذف المادة يلغي روابط مشاركتها النشطة غير المستخدمة عبر trigger قبل أن يصبح `subject_id = NULL`.

---

## 15) تصميم استيراد الحزمة

- المستلم يفتح `share-import.html#token=...`.
- إذا لم يكن مسجلاً، يُحفظ المسار الآمن (بما فيه fragment) في `sessionStorage` ويعود إليه بعد الدخول/التأكيد.
- `get_question_share_preview` يعيد معاينة الحزمة (اسم المادة، عدد الأسئلة، المجموعات) دون كشف token hash أو بيانات المرسل.
- المستلم يستطيع:
  - تعديل اسم المادة المستوردة.
  - ربط كل مجموعة مصدر بمجموعة موجودة لديه.
  - إنشاء مجموعة جديدة.
  - تأجيل الربط (skip) وترك الأسئلة بلا مجموعات.
- `accept_question_share` ينشئ مادة/مجموعات/أسئلة جديدة داخل حساب المستلم، ثم يعلّم الحزمة مستخدمة.
- لا تُنسخ درجات ثابتة؛ الأسئلة المستوردة تدخل بنك الأسئلة بلا `points`.
- لا يتم منح المستقبل أي صلاحية على جداول المرسل؛ كل الكتابة تتم في حساب المستقبل عبر RPC محمي.

---

## 16) تصميم RLS

- RLS مفعّل على كل الجداول التسعة.
- القاعدة الأساسية: `auth.uid() = user_id`.
- تحققات إضافية:
  - `subject_groups`: المادة والمجموعة مملوكتان للمستخدم.
  - `questions`: المادة مملوكة للمستخدم.
  - `question_groups`: السؤال والمادة والمجموعة مملوكة، والسؤال `selected`.
  - `letterheads`: مسار الشعار يبدأ بـ `auth.uid()`.
  - `exams`: المادة والكليشة مملوكتان، والمادة مطلوبة عند الإنشاء.
  - `exam_questions`: الاختبار والسؤال مملوكان، والسؤال يتبع مادة الاختبار إن وُجدت.
- `question_share_packages`:
  - RLS للقراءة الذاتية فقط.
  - لا يوجد INSERT/UPDATE/DELETE مباشر للعميل.
  - صلاحية الأعمدة لا تتضمن `package` ولا `token_hash` ولا `used_by`.
  - المعاينة/الاستيراد/الإلغاء عبر RPCs من نوع `security definer` مع `search_path` مقيد.
- `anon` لا يملك أي صلاحية على جداول التطبيق.
- `authenticated` يملك DML على جداول التطبيق العادية، مع RLS.
- Storage policies تتحقق من bucket `letterhead-logos` ومن أن أول مجلد في المسار يساوي `auth.uid()`.

---

## 17) Functions وTriggers وRPCs

### 17.1 Triggers

| Trigger | الوظيفة |
|---|---|
| `letterheads_set_updated_at` | تحديث `updated_at` عند تعديل الكليشة. |
| `subjects_revoke_shares_on_delete` | إلغاء روابط المشاركة النشطة قبل حذف المادة. |
| `teaching_groups_validate_before_write` | قص الاسم، منع الفراغ، فحص الطول. |
| `subject_groups_validate_before_write` | التحقق من ملكية المادة/المجموعة وتطابق `user_id`. |
| `questions_validate_before_write` | قص النص/الوحدة، فحص النوع/الصعوبة/الخيارات، ومنع الدرجة السالبة إن وُجدت. |
| `question_groups_validate_before_write` | التحقق من ملكية السؤال/المادة/المجموعة وتطابق النطاق. |
| `exams_prepare_insert` | التحقق من المادة/الكليشة، قص العنوان، وفحص الإجمالي. |
| `exams_protect_snapshots` | منع تغيير snapshots/الإجمالي/العبارة/المجموعات بعد الحفظ، مع السماح بـ `NULL` عند حذف المادة/الكليشة. |
| `exam_questions_validate_snapshot` | التحقق من snapshot، النوع، الدرجة الموجبة، التخطيط، وملكية السؤال/الاختبار. |
| `exam_questions_protect_snapshot` | منع تعديل snapshot/الترتيب بعد الحفظ. |

### 17.2 RPCs

| الدالة | النوع | الغرض |
|---|---|---|
| `save_subject(p_id, p_name, p_group_ids)` | Security Invoker | إنشاء/تعديل مادة وربط مجموعاتها في معاملة واحدة. |
| `save_question(...)` | Security Invoker | إنشاء/تعديل سؤال وروابط مجموعاته في معاملة واحدة. |
| `save_exam(...)` | Security Invoker | حفظ الاختبار وأسئلته مع التحقق من الإجمالي والتوزيع. |
| `create_question_share(p_subject_id, p_expires_days)` | Security Definer | إنشاء حزمة ومفتاح hash. |
| `get_question_share_preview(p_token)` | Security Definer | معاينة الحزمة للمستلم المسجل. |
| `accept_question_share(p_token, p_subject_name, p_group_mapping)` | Security Definer | استيراد الحزمة إلى حساب المستقبل واستهلاكها مرة واحدة. |
| `revoke_question_share(p_share_id)` | Security Definer | إلغاء رابط يملكه المستخدم. |

- أُزيل trigger/function القديم `exams_require_grade_snapshot` إن كان موجوداً.
- دوال المشاركة `SECURITY DEFINER` مع `search_path = public, extensions, pg_temp`.
- لا توجد أي دالة تستخدم `service_role` أو تتجاوز RLS لصالح مستخدم آخر.

---

## 18) Storage bucket وStorage policies

- Bucket: `letterhead-logos`.
- خاص: `public = false`.
- الحد: 2MB.
- الأنواع: `image/png`, `image/jpeg`, `image/webp`.
- السياسات:
  - `letterhead logos select own`
  - `letterhead logos insert own`
  - `letterhead logos update own`
  - `letterhead logos delete own`
- كل سياسة تشترط `bucket_id = 'letterhead-logos'` و`(storage.foldername(name))[1] = auth.uid()::text`.
- لا يتم تخزين الشعار كـ Base64 ولا في bucket عام.

---

## 19) Migration والترقية الآمنة

- الملف الوحيد: `supabase/migrations/20261026_subjects_groups_sharing.sql`.
- ملف الترقية القديم `20261026_require_subject_grade.sql` محذوف.
- الترقية داخل معاملة واحدة `begin; ... commit;`.
- لا تحذف جداول أو صفوفاً أو أعمدة.
- تضيف الجداول/الأعمدة/الدوال/السياسات/bucket.
- تُبقي `الرياضيات` كما هي.
- لا تنشئ مجموعات تلقائياً.
- تُحوّل الصف الفارغ/المسافات فقط إلى `NULL`.
- تُبقي `questions.points` القديمة وتزيل إلزامها/default.
- تُبقي `duration_minutes` و`grade_level_snapshot` للتاريخ.
- تعبئ `exams.total_points` من snapshot للاختبارات القديمة عندما يكون الإجمالي صفراً أو غير موجود.
- تتحقق من وجود عمود `exams.total_points` وتضيفه عند الحاجة.
- تحذف trigger/function الصف القديم إن وُجد.
- تحتوي في نهايتها استعلامات تحقق للقراءة.

---

## 20) الاختبارات المحلية التي نُفّذت

### 20.1 اختبارات Node

`node tests/local-tests.mjs`

النتيجة: **31 ناجح، 0 فاشل**.

تغطي:
- توزيع الدرجات بالسنتات (10 على 7، و0.05 على 5).
- رفض الإجمالي الأصغر من عدد الأسئلة.
- رفض أكثر من منزلتين عشريتين/القيم غير الصالحة.
- تجنب أخطاء الفاصلة العائمة.
- اختيار تخطيط MCQ التلقائي والتجاوز.
- تجميع الأقسام والترقيم.
- snapshot الدرجات القديمة.
- تحليل جميع ملفات JavaScript.
- وجود عناصر `getElementById` الثابتة.
- عناصر المصادقة في الصفحات المحمية.
- عدم وجود IDs مكررة.
- عدم وجود `service_role` أو مفاتيح خدمة.
- خلو بنك الأسئلة من `points`/`grade_level`/`duration_minutes`.
- خلو منشئ الاختبار من المدة/الصف.
- نصوص التعليمات والطباعة.
- مشاركة آمنة وعدم وضع المفتاح في query.
- Storage خاص للشعارات.
- وجود جداول/دوال/سياسات جديدة.
- خصائص hash/الصلاحية/الاستهلاك الواحد/الإلغاء.
- عدم منح `package`/`token_hash`.
- قيود bucket.
- الترقية لا تحذف بيانات/لا تفرض الصف/لا تجعل points إلزامية.
- معالجة الصف الفارغ.
- الإبقاء على الأعمدة القديمة.
- `SECURITY DEFINER` مع search_path آمن.
- README يوثق النموذج/الأمان/الترقية.

### 20.2 تحليل SQL

تم استخدام `pglast` محلياً (بدون قاعدة بيانات):

- `supabase/schema.sql`: **187 statements، 17 PL/pgSQL functions**.
- `supabase/migrations/20261026_subjects_groups_sharing.sql`: **203 statements، 17 PL/pgSQL functions**.

كلاهما اجتاز التحليل النحوي/PLpgSQL. هذا تحقق شكلي وليس تنفيذاً على PostgreSQL.

### 20.3 فحص Git

- `git diff --check`: لا أخطاء مسافات (تظهر فقط تحذيرات CRLF من Git على Windows).
- `git status` موثق في القسم 22.

### 20.4 فحص المتصفح المحلي

- شُغّل سيرفر ثابت محلي مؤقتاً واختُبرت صفحة `index.html`.
- لم تظهر أخطاء JavaScript في console.
- تم التحقق من تحديث نص الواجهة وإزالة «الصف» من العبارة التسويقية.
- تم قياس تخطيط رأس ورقة A4 عبر iframe بعرض 182mm: اسم الطالب وسطر رقم الطالب/الجلوس وخانة الدرجة في صف واحد، بلا تداخل أو overflow.
- تم إيقاف السيرفر المحلي. لا توجد عملية انتظار أو سيرفر عالق.

---

## 21) ما لم يُختبر ولماذا

- **لم تُنفّذ Migration على Supabase**؛ التنفيذ ممنوع في هذه المرحلة.
- **لم تُختبر RLS فعلياً** بحسابين حقيقيين؛ يتطلب قاعدة حية وحسابات.
- **لم تُختبر عمليات CRUD/Storage/Sharing الحية**؛ RequiresSupabase.
- **لم تُختبر الطباعة الفعلية إلى PDF** أو سلوك رؤوس/تذييلات المتصفح؛ يتطلب متصفحاً مفتوحاً/طابعة.
- **لم تُختبر صفحات المصادقة المحمية بعد تسجيل دخول حقيقي**؛ لا توجد جلسة.
- **لم تُختبر Migration على نسخة من القاعدة الحية**؛ لا يوجد PostgreSQL/psql/Docker محلي.
- **لم تُختبر الأحجام الكبيرة/الأداء** أو ضغط الصفحات.

---

## 22) المخاطر والقيود المتبقية

1. **SQL لم يُنفّذ بعد:** كل التحقق من قاعدة البيانات شكلي فقط. يجب تجربة الترقية على نسخة احتياطية/مشروع تجريبي أولاً.
2. **المادة القديمة بلا مجموعات:** لا يمكن تعديل اسمها من واجهة المواد قبل إضافة مجموعة واحدة على الأقل، التزاماً بقاعدة «مادة واحدة على الأقل». يمكن إضافة أسئلة واختبارات لها دون مجموعات.
3. **الاختبارات القديمة ذات snapshot غير صالح:** قد يظهر إجماليها 0 أو fallback من الصفوف. لا يمكن استرجاع درجة لم تُحفظ تاريخياً.
4. **فقدان رابط المشاركة عبر تبويب آخر:** المفتاح يُحفظ في `sessionStorage` للعودة بعد الدخول في نفس التبويب. إذا فُتح رابط تأكيد البريد في تبويب/جهاز آخر، قد يضيع المفتاح؛ يمكن لصق الرابط الأصلي مرة أخرى بعد الدخول.
5. **شعار يتيم محتمل:** إذا حُذف آخر اختبار يستخدم شعاراً ثم لم يُحذف قالب الكليشة، قد يبقى ملف الشعار في Storage. لا يؤثر في البيانات، لكنه استهلاك تخزين.
6. **لا قيد UNIQUE على اسم المادة:** الواجهة تمنع التكرار الشائع، لكن قاعدة البيانات لا تمنع مادتين بنفس الاسم. هذا ليس خطر أمان.
7. **لا توجد اختبارات E2E آلية**؛ الاختبارات المحلية ثابتة/وظيفية ولا تغطي الشبكة أو RLS.
8. **التخطيط المطبوع** تم قياسه عبر محاكاة A4، وليس عبر PDF فعلي. يجب معاينة أول اختبار حقيقي قبل الاعتماد النهائي.

---

## 23) حالة Git الحالية

- الفرع: `main`.
- HEAD: `b2490db` (آخر Commit موجود، لم يُنشأ Commit جديد).
- التعديلات كلها **غير محفوظة في Commit**.
- `git status --short` يظهر:
  - 18 ملفاً معدلاً.
  - ملفاً واحداً محذوفاً: `supabase/migrations/20261026_require_subject_grade.sql`.
  - ملفات جديدة غير متتبعة: `groups.html`, `letterheads.html`, `share-import.html`, `js/exam-utils.js`, `js/groups.js`, `js/letterheads.js`, `js/share-import.js`, `supabase/migrations/20261026_subjects_groups_sharing.sql`, `tests/`, `REVIEW_REPORT.md`.
- `git diff --stat` للملفات المتعقبة: 19 ملفاً، 5246 إضافة، 1330 حذفاً (لا يشمل الملفات الجديدة غير المتتبعة).
- لم يُنفّذ `git reset` أو `git clean` أو `git checkout` لاستعادة/حذف عمل.
- لم يُنفّذ `git add` أو `git commit`.
- لم يُنفّذ `git push`.

---

## 24) تأكيدات صريحة

- **لم يتم Push** إلى GitHub.
- **لم يتم تنفيذ أي SQL على Supabase**، لا عبر SQL Editor ولا psql ولا Management API.
- **لم يتم تغيير إعدادات Supabase** (Auth/Storage/RLS/Keys).
- **لم يتم تغيير إعدادات GitHub Pages**.
- **لم يتم نشر الموقع**.
- **لم يُنشأ Commit**.
- تحليل SQL تم محلياً عبر `pglast` فقط، وهو لا يتصل بقاعدة البيانات.

---

## 25) خطوات Supabase اليدوية المطلوبة بعد المراجعة

1. **نسخة احتياطية:** خذ نسخة من قاعدة البيانات إن أمكن.
2. **SQL Editor:** لا تشغّل `supabase/schema.sql` على المشروع الحالي. شغّل فقط:
   `supabase/migrations/20261026_subjects_groups_sharing.sql`
3. الملف داخل معاملة واحدة. إذا ظهر خطأ، يجب أن تتراجع المعاملة كاملة؛ لا تصلح الأخطاء يدوياً قبل قراءتها.
4. نفّذ استعلامات التحقق الموجودة في نهاية ملف الترقية، وتأكد من:
   - بقاء المادة `الرياضيات` وبياناتها.
   - عدم وجود مجموعات مخترعة.
   - وجود `teaching_groups`, `subject_groups`, `question_groups`, `letterheads`, `question_share_packages`.
   - وجود `exams.total_points`.
   - وجود bucket `letterhead-logos` خاصاً.
5. **Storage:** تأكد من أن bucket `letterhead-logos`:
   - Private.
   - 2MB.
   - PNG/JPEG/WebP.
   - سياسات select/insert/update/delete موجودة.
6. **Auth URLs:** تأكد أن `Site URL` و`Redirect URLs` في Supabase Auth يسمحان بـ:
   `https://khyal001.github.io/teacher-question-bank/`
   (لا تغيّر إعدادات إن كانت تعمل مسبقاً).
7. **PostgREST:** إذا لم تظهر RPCs/الجداول الجديدة، أعد تحميل schema cache أو انتظر تحديث Supabase.
8. **اختبار حسابين:** بعد الترقية، اختبر:
   - إنشاء مادة + مجموعتين.
   - سؤال `all` وسؤال `selected`.
   - إنشاء اختبار وتوزيع درجات لا يساوي الإجمالي (يجب أن يُرفض).
   - حفظ اختبار صحيح وطباعته.
   - رفع شعار والتأكد من أنه لا يظهر لمستخدم آخر.
   - إنشاء رابط مشاركة، فتحه بحساب آخر، استيراده، والتأكد من أنه لا يعمل مرة ثانية.
9. **لا تستخدم** `service_role` أو Secret key أو Database Password في الواجهة أو المستودع.

---

## تقرير التوقفين

### 1. ماذا كان يحدث عند التوقف الأول؟

لا توجد سجلات تشغيل كاملة أو Stack Trace تثبت سبب التوقف الأول. الحالة التي وجدتها بعد الاستئناف تُظهر أن التنفيذ كان قد وصل إلى مرحلة المراجعة النهائية/التقرير، وليس إلى مرحلة بناء أولية. لا أستطيع أن أجزم تقنياً هل كان التوقف بسبب انقطاع جلسة، أو timeout، أو انقطاع أداة؛ **السبب غير مؤكد**، وما أملكه هو وصف الحالة على القرص.

### 2. آخر ما تم إنجازه قبل التوقف الأول حسب الملفات والسجلات

- كانت جميع ملفات التصميم الأساسية موجودة: الصفحات الجديدة، ملفات JS الجديدة، CSS، `README.md`، `supabase/schema.sql`، وملف الترقية الجديد.
- كان ملف الترقية القديم `20261026_require_subject_grade.sql` قد حُذف.
- كانت الاختبارات المحلية قد وصلت إلى **31 ناجحاً، 0 فاشل**.
- كان هناك تعديل أخير على `js/subjects.js` (إعادة اختيار مدة المشاركة إلى 7 أيام عند فتح النافذة) قد طُبّق بعد آخر تشغيل للاختبارات، لذلك كانت إعادة تشغيل الاختبارات والتحقق النهائي مطلوبة.
- لم يكن تقرير المراجعة النهائي قد كُتب بعد.

### 3. ماذا فعلت بعد استئناف العمل الأول؟

- أعدت فحص الملفات على القرص و`git status` بدلاً من إعادة البناء من الصفر.
- أكملت مراجعة منشئ الاختبار ومسارات التوليد/الاستبدال/الحفظ/التحقق من الدرجات.
- أضفت حماية عند تعذر `sessionStorage` بعد حفظ الاختبار أو استيراد الحزمة، حتى لا يظهر خطأ بعد نجاح العملية.
- أصلحت نص `index.html` الذي كان لا يزال يذكر «الصف».
- أضفت حماية لقراءة رسالة الاستيراد المؤقتة في `js/questions.js`.
- عدلت تخطيط رأس ورقة الاختبار ليصبح سطر رقم الطالب/الجلوس في موضع خانة الدرجة القديمة، بجانب اسم الطالب، بطول قصير يناسب نحو أربعة أرقام.
- أعدت تشغيل الاختبارات المحلية (31/31) وفحص parser لملفات SQL.
- بقيت خطوة إعادة تطبيق ثلاث تعديلات صغيرة في `js/exam-builder.js` ثم كتابة التقرير.

### 4. ماذا كان يحدث عند التوقف الثاني؟

كان التنفيذ يحاول تطبيق ثلاث تعديلات صغيرة غير جوهرية على `js/exam-builder.js`:
1. مسح رسالة الخطأ القديمة عند تغيير المجموعات.
2. مسح رسالة الخطأ القديمة عند تغيير المادة.
3. مسح رسالة الخطأ بعد نجاح إعادة توزيع الدرجات.

التوقف حدث قبل اكتمال هذه التعديلات. **السبب التقني غير مؤكد** أيضاً؛ لا يوجد سجل خطأ يثبت السبب. الدليل المتاح هو أن `js/exam-builder.js` بقي بتوقيت `8:34:29` بينما آخر كتابات ناجحة كانت عند `8:35`، وأن النص لم يكن موجوداً عند فحص الملف بعد الاستئناف.

### 5. آخر ما تم إنجازه قبل التوقف الثاني حسب الملفات

- كانت الاختبارات المحلية ناجحة (31/31).
- كان parser قد أعطى: schema 187 statements/17 functions، migration 203/17.
- كانت مراجعة CSS/رأس الطباعة قد اكتملت، بما فيها قياس A4 عبر iframe.
- كانت التعديلات الثلاثة الصغيرة هي آخر ما تبقّى، ولم تُكتب.
- لم يكن تقرير المراجعة قد كُتب.

### 6. هل تسبب أي من التوقفين في فقد ملفات أو تلف بيانات؟

**لا.** بعد الفحص:
- `git status` ما زال يعرض كل الملفات المعدلة/الجديدة/المحذوفة المتوقعة.
- لم تظهر ملفات نصف مكتوبة أو JSON/JS مقطوع.
- جميع ملفات JavaScript تُحلّل دون أخطاء صياغة.
- ملفا SQL يجتازان parser.
- الاختبارات 31/31.
- لم تُفقد أي تعديلات صحيحة سابقة. التعديلات الثلاثة فقط كانت غير مطبقة، وأعدت تطبيقها بعد الفحص.

### 7. هل توجد ملفات نصف مكتملة بسبب التوقفين؟

لا توجد ملفات تطبيق نصف مكتملة الآن. الملف الوحيد الذي كان «ناقصاً» هو التعديلات الثلاثة في `js/exam-builder.js`، وقد أُكملت. تقرير المراجعة هذا هو الملف الجديد الوحيد الذي أُنشئ بعد التوقف الثاني، وهو مكتمل مع SQL في نهايته.

### 8. كيف تحققت من سلامة الحالة بعد كل توقف؟

- `git status --short` و`git diff --stat`.
- فحص تواريخ تعديل الملفات لتحديد آخر كتابة ناجحة.
- `Select-String` على الأجزاء المشكوك فيها في `js/exam-builder.js`.
- `node tests/local-tests.mjs`.
- `pglast` لملفي SQL.
- `git diff --check`.
- فحص المتصفح المحلي لصفحة الدخول وconsole.
- قياس تخطيط رأس A4 عبر iframe بعرض 182mm.
- التأكد من إيقاف السيرفر المحلي وعدم وجود عملية انتظار.

### 9. هل توجد خطوات كان المفترض تنفيذها ولم تنفذ بسبب التوقفين؟

نعم، وكانت مؤقتة:
- إعادة تشغيل الاختبارات بعد تعديل `js/subjects.js` — أُعيدت.
- تطبيق التعديلات الثلاثة في `js/exam-builder.js` — أُعيدت.
- كتابة التقرير النهائي — أُنجز في هذا الملف.

أما الخطوات التالية فلم تُنفّذ **بقرار صريح** وليست بسبب التوقف:
- تنفيذ SQL على Supabase.
- اختبار RLS/Storage/Sharing حياً.
- Commit/Push/Deploy.

---

## 26) Migration SQL الكاملة (للمراجعة فقط)

> **تحذير:** هذه النسخة للقراءة والمراجعة. لا تُنفّذ على Supabase قبل موافقة صريحة، ويُفضّل تجربتها على نسخة احتياطية/مشروع تجريبي.

```sql
-- ============================================================
-- ترقية آمنة للمشروع القائم — 2026-10-26
-- الموضوعات: مجموعات مستقلة، ربط متعدد، كليشة، درجات الاختبار،
--            مشاركة آمنة، وتخزين شعارات خاص.
--
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor.
-- لا يحذف جداول ولا صفوفاً ولا أعمدة.
-- لا يجعل grade_level إلزامياً، ولا يحذف points القديمة.
-- كل التغييرات داخل معاملة واحدة: أي خطأ يعني Rollback كامل.
--
-- قبل التشغيل: خذ نسخة احتياطية من قاعدة البيانات إن أمكن.
-- بعد التشغيل: راجع النتائج في قسم "التحقق" آخر الملف.
-- ============================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1) إصلاح الجداول القديمة دون حذف بيانات
-- ============================================================

-- الصف الدراسي يصبح اختيارياً. المادة الحالية «الرياضيات» تبقى كما هي.
alter table public.subjects
  alter column grade_level drop not null;

-- القيم الفارغة أو المسافات فقط تعني «لا يوجد صف دراسي»، ولا نخترع قيمة.
update public.subjects
set grade_level = null
where grade_level is not null
  and btrim(grade_level) = '';

update public.subjects
set grade_level = btrim(grade_level)
where grade_level is not null
  and grade_level is distinct from btrim(grade_level);

alter table public.subjects
  drop constraint if exists subjects_grade_level_not_blank;

alter table public.subjects
  add constraint subjects_grade_level_not_blank
  check (grade_level is null or length(btrim(grade_level)) > 0) not valid;

alter table public.subjects
  validate constraint subjects_grade_level_not_blank;

-- درجة السؤال القديمة تبقى محفوظة، لكنها تصبح اختيارية وغير مستخدمة.
alter table public.questions
  add column if not exists group_scope text not null default 'all';

alter table public.questions
  alter column group_scope set default 'all';

alter table public.questions
  alter column group_scope set not null;

alter table public.questions
  alter column points drop not null;

alter table public.questions
  alter column points drop default;

alter table public.questions
  drop constraint if exists questions_points_check;

alter table public.questions
  drop constraint if exists questions_points_positive;

alter table public.questions
  add constraint questions_points_positive
  check (points is null or points > 0) not valid;

alter table public.questions
  validate constraint questions_points_positive;

alter table public.questions
  drop constraint if exists questions_group_scope_check;

alter table public.questions
  add constraint questions_group_scope_check
  check (group_scope in ('all', 'selected')) not valid;

alter table public.questions
  validate constraint questions_group_scope_check;

-- إضافة أعمدة الاختبار الجديدة مع قيم افتراضية آمنة للصفوف القديمة.
alter table public.exams
  add column if not exists total_points numeric not null default 0;

-- استعادة الإجمالي للاختبارات القديمة من snapshot أسئلتها إن أمكن.
-- لا يتغير أي صف إذا كان مجموع نسخه غير صالح أو مساوياً لصفر.
update public.exams e
set total_points = coalesce(
  (
    select sum(
      case
        when (eq.snapshot ->> 'points') ~ '^[0-9]+([.][0-9]{1,2})?$'
          then (eq.snapshot ->> 'points')::numeric
        else 0
      end
    )
    from public.exam_questions eq
    where eq.exam_id = e.id
  ),
  0
)
where e.total_points = 0;

alter table public.exams
  add column if not exists group_names_snapshot text[] not null default '{}'::text[];

alter table public.exams
  add column if not exists closing_phrase text;

alter table public.exams
  add column if not exists letterhead_snapshot jsonb;

-- ============================================================
-- 2) جداول جديدة
-- ============================================================

create table if not exists public.teaching_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint teaching_groups_name_not_blank check (length(btrim(name)) > 0),
  constraint teaching_groups_user_name_unique unique (user_id, name)
);

create index if not exists teaching_groups_user_id_idx on public.teaching_groups (user_id);

create table if not exists public.subject_groups (
  subject_id uuid not null references public.subjects (id) on delete cascade,
  group_id uuid not null references public.teaching_groups (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subject_id, group_id)
);

create index if not exists subject_groups_group_id_idx on public.subject_groups (group_id);
create index if not exists subject_groups_user_id_idx on public.subject_groups (user_id);

create table if not exists public.question_groups (
  question_id uuid not null references public.questions (id) on delete cascade,
  subject_id uuid not null,
  group_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_id, group_id),
  constraint question_groups_subject_group_fk
    foreign key (subject_id, group_id)
    references public.subject_groups (subject_id, group_id)
    on delete cascade
);

create index if not exists question_groups_group_id_idx on public.question_groups (group_id);
create index if not exists question_groups_subject_group_idx
  on public.question_groups (subject_id, group_id);
create index if not exists question_groups_user_id_idx on public.question_groups (user_id);

create table if not exists public.letterheads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  entity_name text,
  school_name text,
  university_name text,
  college_name text,
  department_name text,
  extra_text text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letterheads_name_not_blank check (length(btrim(name)) > 0),
  constraint letterheads_logo_path_owned
    check (logo_path is null or logo_path like (user_id::text || '/%'))
);

create index if not exists letterheads_user_id_idx on public.letterheads (user_id);

create table if not exists public.question_share_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  subject_name_snapshot text not null,
  question_count integer not null default 0,
  package jsonb not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  constraint question_share_question_count_nonnegative check (question_count >= 0),
  constraint question_share_token_hash_length check (length(token_hash) = 64),
  constraint question_share_expiry_after_creation check (expires_at > created_at)
);

create index if not exists question_share_packages_user_id_idx
  on public.question_share_packages (user_id);
create index if not exists question_share_packages_subject_id_idx
  on public.question_share_packages (subject_id);
create index if not exists question_share_packages_expires_at_idx
  on public.question_share_packages (expires_at desc);

-- ربط الاختبار بالكليشة بعد إنشاء جدولها.
alter table public.exams
  add column if not exists letterhead_id uuid
  references public.letterheads (id) on delete set null;

alter table public.exams
  drop constraint if exists exams_total_points_nonnegative;

alter table public.exams
  add constraint exams_total_points_nonnegative
  check (total_points >= 0 and total_points = round(total_points, 2)) not valid;

alter table public.exams
  validate constraint exams_total_points_nonnegative;

-- ============================================================
-- 3) دوال التحقق والـ triggers الجديدة
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists letterheads_set_updated_at on public.letterheads;
create trigger letterheads_set_updated_at
  before update on public.letterheads
  for each row execute function public.set_updated_at();

-- حذف المادة يلغي روابط مشاركتها النشطة قبل أن يصبح subject_id = null.
create or replace function public.revoke_subject_shares_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.question_share_packages
  set revoked_at = now()
  where subject_id = old.id
    and used_at is null
    and revoked_at is null;

  return old;
end;
$$;

drop trigger if exists subjects_revoke_shares_on_delete on public.subjects;
create trigger subjects_revoke_shares_on_delete
  before delete on public.subjects
  for each row execute function public.revoke_subject_shares_on_delete();

create or replace function public.teaching_groups_validate_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(coalesce(new.name, ''));

  if new.name = '' then
    raise exception 'اسم المجموعة مطلوب.' using errcode = '23514';
  end if;

  if length(new.name) > 120 then
    raise exception 'اسم المجموعة طويل جداً.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists teaching_groups_validate_before_write on public.teaching_groups;
create trigger teaching_groups_validate_before_write
  before insert or update on public.teaching_groups
  for each row execute function public.teaching_groups_validate_row();

create or replace function public.subject_groups_validate_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_subject_user uuid;
  v_group_user uuid;
begin
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  select s.user_id into v_subject_user
  from public.subjects s
  where s.id = new.subject_id;

  select g.user_id into v_group_user
  from public.teaching_groups g
  where g.id = new.group_id;

  if v_subject_user is null or v_group_user is null then
    raise exception 'المادة أو المجموعة غير موجودة.' using errcode = '23503';
  end if;

  if v_subject_user <> new.user_id or v_group_user <> new.user_id then
    raise exception 'لا يمكن ربط مادة أو مجموعة لا تملكها.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists subject_groups_validate_before_write on public.subject_groups;
create trigger subject_groups_validate_before_write
  before insert or update on public.subject_groups
  for each row execute function public.subject_groups_validate_row();

create or replace function public.questions_validate_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  new.question_text := btrim(coalesce(new.question_text, ''));

  if new.question_text = '' then
    raise exception 'نص السؤال مطلوب.' using errcode = '23514';
  end if;

  if new.type is null or new.type not in ('mcq', 'true_false', 'short') then
    raise exception 'نوع السؤال غير صحيح.' using errcode = '23514';
  end if;

  if new.difficulty is null or new.difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صحيح.' using errcode = '23514';
  end if;

  new.group_scope := coalesce(nullif(btrim(new.group_scope), ''), 'all');

  if new.group_scope not in ('all', 'selected') then
    raise exception 'نطاق مجموعات السؤال غير صحيح.' using errcode = '23514';
  end if;

  if new.points is not null and new.points <= 0 then
    raise exception 'درجة السؤال القديمة يجب أن تكون أكبر من صفر أو NULL.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and (new.subject_id is distinct from old.subject_id or new.group_scope = 'all') then
    delete from public.question_groups qg where qg.question_id = new.id;
  end if;

  if new.type = 'mcq' then
    if new.options is null or jsonb_typeof(new.options) <> 'array' then
      raise exception 'خيارات سؤال الاختيار من متعدد مطلوبة.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(new.options) as item(value)
      where jsonb_typeof(value) <> 'string'
    ) then
      raise exception 'جميع الخيارات يجب أن تكون نصوصاً.' using errcode = '23514';
    end if;

    select count(*), count(distinct btrim(value))
      into v_count, v_distinct
    from jsonb_array_elements_text(new.options);

    if v_count < 2 or v_count > 6 then
      raise exception 'عدد الخيارات يجب أن يكون بين 2 و6.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(new.options) as item(value)
      where btrim(value) = ''
    ) then
      raise exception 'لا يسمح بخيار فارغ.' using errcode = '23514';
    end if;

    if v_distinct <> v_count then
      raise exception 'لا يسمح بتكرار الخيارات.' using errcode = '23514';
    end if;

    select jsonb_agg(btrim(value) order by ord)
      into new.options
    from jsonb_array_elements_text(new.options) with ordinality as item(value, ord);

    new.correct_answer := btrim(coalesce(new.correct_answer, ''));

    if new.correct_answer = '' then
      raise exception 'حدد الإجابة الصحيحة.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements_text(new.options) as item(value)
      where value = new.correct_answer
    ) then
      raise exception 'الإجابة الصحيحة يجب أن تكون أحد الخيارات.' using errcode = '23514';
    end if;
  elsif new.type = 'true_false' then
    new.options := null;
    new.correct_answer := lower(btrim(coalesce(new.correct_answer, '')));

    if new.correct_answer not in ('true', 'false') then
      raise exception 'إجابة صح/خطأ يجب أن تكون true أو false.' using errcode = '23514';
    end if;
  else
    new.options := null;
    new.correct_answer := btrim(coalesce(new.correct_answer, ''));

    if new.correct_answer = '' then
      raise exception 'الإجابة النموذجية مطلوبة.' using errcode = '23514';
    end if;
  end if;

  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  return new;
end;
$$;

drop trigger if exists questions_validate_before_write on public.questions;
create trigger questions_validate_before_write
  before insert or update on public.questions
  for each row execute function public.questions_validate_row();

create or replace function public.question_groups_validate_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_question record;
begin
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  select q.subject_id, q.user_id, q.group_scope
    into v_question
  from public.questions q
  where q.id = new.question_id;

  if not found then
    raise exception 'السؤال غير موجود.' using errcode = '23503';
  end if;

  if v_question.user_id <> new.user_id then
    raise exception 'لا يمكن ربط مجموعة بسؤال لا تملكه.' using errcode = '42501';
  end if;

  if v_question.subject_id <> new.subject_id then
    raise exception 'المجموعة المختارة لا تتبع مادة السؤال.' using errcode = '23514';
  end if;

  if v_question.group_scope <> 'selected' then
    raise exception 'لا يمكن ربط مجموعات بسؤال نطاقه «جميع المجموعات».' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.subject_groups sg
    where sg.subject_id = new.subject_id
      and sg.group_id = new.group_id
      and sg.user_id = new.user_id
  ) then
    raise exception 'المجموعة غير مرتبطة بهذه المادة.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists question_groups_validate_before_write on public.question_groups;
create trigger question_groups_validate_before_write
  before insert or update on public.question_groups
  for each row execute function public.question_groups_validate_row();

-- إزالة فرض الصف الدراسي القديم نهائياً.
drop trigger if exists exams_require_grade_snapshot_before_insert on public.exams;
drop function if exists public.exams_require_grade_snapshot();

create or replace function public.exams_prepare_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if new.subject_id is null then
    raise exception 'المادة مطلوبة لإنشاء الاختبار.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.subjects s
    where s.id = new.subject_id
      and s.user_id = new.user_id
  ) then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = '42501';
  end if;

  if new.letterhead_id is not null and not exists (
    select 1
    from public.letterheads l
    where l.id = new.letterhead_id
      and l.user_id = new.user_id
  ) then
    raise exception 'قالب الكليشة غير موجود أو لا تملكه.' using errcode = '42501';
  end if;

  new.title := btrim(coalesce(new.title, ''));

  if new.title = '' then
    raise exception 'عنوان الاختبار مطلوب.' using errcode = '23514';
  end if;

  if length(new.title) > 200 then
    raise exception 'عنوان الاختبار طويل جداً.' using errcode = '23514';
  end if;

  new.subject_name_snapshot := btrim(coalesce(new.subject_name_snapshot, ''));

  if new.subject_name_snapshot = '' then
    raise exception 'اسم المادة في الاختبار مطلوب.' using errcode = '23514';
  end if;

  if new.total_points is null or new.total_points <= 0 then
    raise exception 'إجمالي درجات الاختبار يجب أن يكون أكبر من صفر.' using errcode = '23514';
  end if;

  if new.total_points <> round(new.total_points, 2) then
    raise exception 'إجمالي درجات الاختبار بمنزلتين عشريتين كحد أقصى.' using errcode = '23514';
  end if;

  new.group_names_snapshot := coalesce(
    (
      select array_agg(distinct btrim(g) order by btrim(g))
      from unnest(coalesce(new.group_names_snapshot, '{}'::text[])) as g
      where btrim(g) <> ''
    ),
    '{}'::text[]
  );

  new.closing_phrase := nullif(btrim(coalesce(new.closing_phrase, '')), '');

  if new.closing_phrase is not null and length(new.closing_phrase) > 1000 then
    raise exception 'العبارة الختامية طويلة جداً.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists exams_prepare_insert on public.exams;
create trigger exams_prepare_insert
  before insert on public.exams
  for each row execute function public.exams_prepare_insert();

create or replace function public.exams_protect_snapshots()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subject_name_snapshot is distinct from old.subject_name_snapshot
     or new.grade_level_snapshot is distinct from old.grade_level_snapshot
     or new.total_points is distinct from old.total_points
     or new.group_names_snapshot is distinct from old.group_names_snapshot
     or new.letterhead_snapshot is distinct from old.letterhead_snapshot
     or new.closing_phrase is distinct from old.closing_phrase then
    raise exception 'لا يمكن تعديل بيانات الاختبار المحفوظة بعد إنشائه.' using errcode = '42501';
  end if;

  if new.subject_id is distinct from old.subject_id and new.subject_id is not null then
    raise exception 'لا يمكن تغيير مادة الاختبار المحفوظ.' using errcode = '42501';
  end if;

  if new.letterhead_id is distinct from old.letterhead_id and new.letterhead_id is not null then
    raise exception 'لا يمكن تغيير كليشة الاختبار المحفوظ.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists exams_protect_snapshots on public.exams;
create trigger exams_protect_snapshots
  before update on public.exams
  for each row execute function public.exams_protect_snapshots();

create or replace function public.exam_questions_validate_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_points text;
  v_layout text;
  v_type text;
begin
  if new.snapshot is null or jsonb_typeof(new.snapshot) <> 'object' then
    raise exception 'نسخة السؤال مطلوبة.' using errcode = '23514';
  end if;

  v_type := new.snapshot ->> 'type';

  if v_type is null or v_type not in ('mcq', 'true_false', 'short') then
    raise exception 'نوع السؤال في النسخة غير صحيح.' using errcode = '23514';
  end if;

  v_points := new.snapshot ->> 'points';

  if v_points is null or v_points !~ '^[0-9]+([.][0-9]{1,2})?$' then
    raise exception 'درجة السؤال يجب أن تكون بمنزلتين عشريتين كحد أقصى.' using errcode = '23514';
  end if;

  if v_points::numeric <= 0 then
    raise exception 'درجة السؤال يجب أن تكون أكبر من صفر.' using errcode = '23514';
  end if;

  v_layout := coalesce(new.snapshot ->> 'layout', 'auto');

  if v_layout not in ('auto', 'full', 'half') then
    raise exception 'تخطيط السؤال غير صحيح.' using errcode = '23514';
  end if;

  if new.question_id is not null and not exists (
    select 1
    from public.questions q
    join public.exams e on e.id = new.exam_id
    where q.id = new.question_id
      and q.user_id = new.user_id
      and e.user_id = new.user_id
      and (e.subject_id is null or q.subject_id = e.subject_id)
  ) then
    raise exception 'السؤال لا يتبع مادة الاختبار أو لا تملكه.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists exam_questions_validate_snapshot on public.exam_questions;
create trigger exam_questions_validate_snapshot
  before insert on public.exam_questions
  for each row execute function public.exam_questions_validate_snapshot();

create or replace function public.exam_questions_protect_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.snapshot is distinct from old.snapshot then
    raise exception 'لا يمكن تعديل النسخة التاريخية للسؤال بعد حفظ الاختبار.' using errcode = '42501';
  end if;

  if new.position is distinct from old.position then
    raise exception 'لا يمكن تغيير ترتيب السؤال داخل الاختبار المحفوظ.' using errcode = '42501';
  end if;

  if new.exam_id is distinct from old.exam_id then
    raise exception 'لا يمكن نقل السؤال المحفوظ إلى اختبار آخر.' using errcode = '42501';
  end if;

  if new.question_id is distinct from old.question_id and new.question_id is not null then
    raise exception 'لا يمكن استبدال السؤال الأصلي المرتبط بالنسخة المحفوظة.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists exam_questions_protect_snapshot on public.exam_questions;
create trigger exam_questions_protect_snapshot
  before update on public.exam_questions
  for each row execute function public.exam_questions_protect_snapshot();

-- ============================================================
-- 4) تفعيل RLS
-- ============================================================
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.teaching_groups enable row level security;
alter table public.subject_groups enable row level security;
alter table public.question_groups enable row level security;
alter table public.letterheads enable row level security;
alter table public.question_share_packages enable row level security;

-- subjects
drop policy if exists subjects_select_own on public.subjects;
create policy subjects_select_own on public.subjects
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists subjects_insert_own on public.subjects;
create policy subjects_insert_own on public.subjects
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists subjects_update_own on public.subjects;
create policy subjects_update_own on public.subjects
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists subjects_delete_own on public.subjects;
create policy subjects_delete_own on public.subjects
  for delete to authenticated
  using (auth.uid() = user_id);

-- teaching_groups
drop policy if exists teaching_groups_select_own on public.teaching_groups;
create policy teaching_groups_select_own on public.teaching_groups
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists teaching_groups_insert_own on public.teaching_groups;
create policy teaching_groups_insert_own on public.teaching_groups
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists teaching_groups_update_own on public.teaching_groups;
create policy teaching_groups_update_own on public.teaching_groups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists teaching_groups_delete_own on public.teaching_groups;
create policy teaching_groups_delete_own on public.teaching_groups
  for delete to authenticated
  using (auth.uid() = user_id);

-- subject_groups
drop policy if exists subject_groups_select_own on public.subject_groups;
create policy subject_groups_select_own on public.subject_groups
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists subject_groups_insert_own on public.subject_groups;
create policy subject_groups_insert_own on public.subject_groups
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = subject_groups.subject_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.teaching_groups g
      where g.id = subject_groups.group_id
        and g.user_id = auth.uid()
    )
  );

drop policy if exists subject_groups_update_own on public.subject_groups;
create policy subject_groups_update_own on public.subject_groups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = subject_groups.subject_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.teaching_groups g
      where g.id = subject_groups.group_id
        and g.user_id = auth.uid()
    )
  );

drop policy if exists subject_groups_delete_own on public.subject_groups;
create policy subject_groups_delete_own on public.subject_groups
  for delete to authenticated
  using (auth.uid() = user_id);

-- questions
drop policy if exists questions_select_own on public.questions;
create policy questions_select_own on public.questions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists questions_insert_own on public.questions;
create policy questions_insert_own on public.questions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = questions.subject_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists questions_update_own on public.questions;
create policy questions_update_own on public.questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = questions.subject_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists questions_delete_own on public.questions;
create policy questions_delete_own on public.questions
  for delete to authenticated
  using (auth.uid() = user_id);

-- question_groups
drop policy if exists question_groups_select_own on public.question_groups;
create policy question_groups_select_own on public.question_groups
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists question_groups_insert_own on public.question_groups;
create policy question_groups_insert_own on public.question_groups
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.questions q
      where q.id = question_groups.question_id
        and q.user_id = auth.uid()
        and q.subject_id = question_groups.subject_id
        and q.group_scope = 'selected'
    )
    and exists (
      select 1 from public.subject_groups sg
      where sg.subject_id = question_groups.subject_id
        and sg.group_id = question_groups.group_id
        and sg.user_id = auth.uid()
    )
  );

drop policy if exists question_groups_update_own on public.question_groups;
create policy question_groups_update_own on public.question_groups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.questions q
      where q.id = question_groups.question_id
        and q.user_id = auth.uid()
        and q.subject_id = question_groups.subject_id
        and q.group_scope = 'selected'
    )
    and exists (
      select 1 from public.subject_groups sg
      where sg.subject_id = question_groups.subject_id
        and sg.group_id = question_groups.group_id
        and sg.user_id = auth.uid()
    )
  );

drop policy if exists question_groups_delete_own on public.question_groups;
create policy question_groups_delete_own on public.question_groups
  for delete to authenticated
  using (auth.uid() = user_id);

-- letterheads
drop policy if exists letterheads_select_own on public.letterheads;
create policy letterheads_select_own on public.letterheads
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists letterheads_insert_own on public.letterheads;
create policy letterheads_insert_own on public.letterheads
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (logo_path is null or logo_path like (auth.uid()::text || '/%'))
  );

drop policy if exists letterheads_update_own on public.letterheads;
create policy letterheads_update_own on public.letterheads
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (logo_path is null or logo_path like (auth.uid()::text || '/%'))
  );

drop policy if exists letterheads_delete_own on public.letterheads;
create policy letterheads_delete_own on public.letterheads
  for delete to authenticated
  using (auth.uid() = user_id);

-- exams
drop policy if exists exams_select_own on public.exams;
create policy exams_select_own on public.exams
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists exams_insert_own on public.exams;
create policy exams_insert_own on public.exams
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and subject_id is not null
    and exists (
      select 1 from public.subjects s
      where s.id = exams.subject_id
        and s.user_id = auth.uid()
    )
    and (
      letterhead_id is null
      or exists (
        select 1 from public.letterheads l
        where l.id = exams.letterhead_id
          and l.user_id = auth.uid()
      )
    )
  );

drop policy if exists exams_update_own on public.exams;
create policy exams_update_own on public.exams
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      subject_id is null
      or exists (
        select 1 from public.subjects s
        where s.id = exams.subject_id
          and s.user_id = auth.uid()
      )
    )
    and (
      letterhead_id is null
      or exists (
        select 1 from public.letterheads l
        where l.id = exams.letterhead_id
          and l.user_id = auth.uid()
      )
    )
  );

drop policy if exists exams_delete_own on public.exams;
create policy exams_delete_own on public.exams
  for delete to authenticated
  using (auth.uid() = user_id);

-- exam_questions
drop policy if exists exam_questions_select_own on public.exam_questions;
create policy exam_questions_select_own on public.exam_questions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists exam_questions_insert_own on public.exam_questions;
create policy exam_questions_insert_own on public.exam_questions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exams e
      where e.id = exam_questions.exam_id
        and e.user_id = auth.uid()
    )
    and (
      question_id is null
      or exists (
        select 1 from public.questions q
        where q.id = exam_questions.question_id
          and q.user_id = auth.uid()
      )
    )
  );

drop policy if exists exam_questions_update_own on public.exam_questions;
create policy exam_questions_update_own on public.exam_questions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exams e
      where e.id = exam_questions.exam_id
        and e.user_id = auth.uid()
    )
    and (
      question_id is null
      or exists (
        select 1 from public.questions q
        where q.id = exam_questions.question_id
          and q.user_id = auth.uid()
      )
    )
  );

drop policy if exists exam_questions_delete_own on public.exam_questions;
create policy exam_questions_delete_own on public.exam_questions
  for delete to authenticated
  using (auth.uid() = user_id);

-- question_share_packages: قراءة الإدارة فقط، بلا package/token_hash.
drop policy if exists question_share_packages_select_own on public.question_share_packages;
create policy question_share_packages_select_own on public.question_share_packages
  for select to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- 5) دوال الحفظ الذري (نفس نسخة schema.sql)
-- ============================================================

create or replace function public.save_subject(
  p_id uuid,
  p_name text,
  p_group_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'اسم المادة مطلوب.' using errcode = '23514';
  end if;

  if length(btrim(p_name)) > 120 then
    raise exception 'اسم المادة طويل جداً.' using errcode = '23514';
  end if;

  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception 'اختر مجموعة واحدة على الأقل.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(p_group_ids) as g(group_id)
    where not exists (
      select 1 from public.teaching_groups tg
      where tg.id = g.group_id and tg.user_id = auth.uid()
    )
  ) then
    raise exception 'إحدى المجموعات المختارة غير موجودة أو لا تملكها.' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.subjects (user_id, name)
    values (auth.uid(), btrim(p_name))
    returning id into v_id;
  else
    update public.subjects
    set name = btrim(p_name)
    where id = p_id and user_id = auth.uid()
    returning id into v_id;

    if v_id is null then
      raise exception 'المادة غير موجودة أو لا تملك صلاحية تعديلها.' using errcode = 'P0002';
    end if;

    delete from public.subject_groups sg
    where sg.subject_id = v_id
      and not (sg.group_id = any (p_group_ids));
  end if;

  for v_group_id in
    select distinct g.group_id from unnest(p_group_ids) as g(group_id)
  loop
    insert into public.subject_groups (subject_id, group_id, user_id)
    values (v_id, v_group_id, auth.uid())
    on conflict (subject_id, group_id) do nothing;
  end loop;

  return v_id;
end;
$$;

create or replace function public.save_question(
  p_id uuid,
  p_subject_id uuid,
  p_unit text,
  p_type text,
  p_question_text text,
  p_options jsonb,
  p_correct_answer text,
  p_difficulty text,
  p_group_scope text,
  p_group_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_group_id uuid;
  v_scope text := coalesce(nullif(btrim(p_group_scope), ''), 'all');
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and s.user_id = auth.uid()
  ) then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = '42501';
  end if;

  if v_scope not in ('all', 'selected') then
    raise exception 'نطاق مجموعات السؤال غير صحيح.' using errcode = '23514';
  end if;

  if v_scope = 'selected' then
    if p_group_ids is null or cardinality(p_group_ids) = 0 then
      raise exception 'اختر مجموعة واحدة على الأقل.' using errcode = '23514';
    end if;

    if exists (
      select 1
      from unnest(p_group_ids) as g(group_id)
      where not exists (
        select 1 from public.subject_groups sg
        where sg.subject_id = p_subject_id
          and sg.group_id = g.group_id
          and sg.user_id = auth.uid()
      )
    ) then
      raise exception 'إحدى المجموعات المختارة غير مرتبطة بهذه المادة.' using errcode = '23514';
    end if;
  end if;

  if p_id is null then
    insert into public.questions (
      user_id, subject_id, unit, type, question_text, options,
      correct_answer, difficulty, group_scope
    ) values (
      auth.uid(), p_subject_id,
      nullif(btrim(coalesce(p_unit, '')), ''),
      p_type, p_question_text, p_options,
      p_correct_answer, p_difficulty, v_scope
    )
    returning id into v_id;
  else
    update public.questions
    set subject_id = p_subject_id,
        unit = nullif(btrim(coalesce(p_unit, '')), ''),
        type = p_type,
        question_text = p_question_text,
        options = p_options,
        correct_answer = p_correct_answer,
        difficulty = p_difficulty,
        group_scope = v_scope
    where id = p_id and user_id = auth.uid()
    returning id into v_id;

    if v_id is null then
      raise exception 'السؤال غير موجود أو لا تملك صلاحية تعديله.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.question_groups qg where qg.question_id = v_id;

  if v_scope = 'selected' then
    for v_group_id in
      select distinct g.group_id from unnest(p_group_ids) as g(group_id)
    loop
      insert into public.question_groups (question_id, subject_id, group_id, user_id)
      values (v_id, p_subject_id, v_group_id, auth.uid())
      on conflict (question_id, group_id) do nothing;
    end loop;
  end if;

  return v_id;
end;
$$;

create or replace function public.save_exam(
  p_title text,
  p_subject_id uuid,
  p_total_points numeric,
  p_group_names text[],
  p_letterhead_id uuid,
  p_closing_phrase text,
  p_questions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_exam_id uuid;
  v_subject public.subjects%rowtype;
  v_letterhead public.letterheads%rowtype;
  v_letterhead_snapshot jsonb;
  v_group_names text[];
  v_sum numeric;
  v_item jsonb;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'عنوان الاختبار مطلوب.' using errcode = '23514';
  end if;

  if p_total_points is null or p_total_points <= 0 then
    raise exception 'إجمالي درجات الاختبار يجب أن يكون أكبر من صفر.' using errcode = '23514';
  end if;

  if p_total_points <> round(p_total_points, 2) then
    raise exception 'إجمالي درجات الاختبار بمنزلتين عشريتين كحد أقصى.' using errcode = '23514';
  end if;

  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id and s.user_id = auth.uid();

  if not found then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = 'P0002';
  end if;

  if p_questions is null
     or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) = 0 then
    raise exception 'أضف سؤالاً واحداً على الأقل للاختبار.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item
    where item ->> 'question_id' is null
       or (item ->> 'question_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or item -> 'snapshot' is null
       or jsonb_typeof(item -> 'snapshot') <> 'object'
       or (item -> 'snapshot' ->> 'points') is null
       or (item -> 'snapshot' ->> 'points') !~ '^[0-9]+([.][0-9]{1,2})?$'
       or (item -> 'snapshot' ->> 'points')::numeric <= 0
       or (item ->> 'position') is null
       or (item ->> 'position') !~ '^[0-9]+$'
       or (item ->> 'position')::integer < 1
  ) then
    raise exception 'بيانات أسئلة الاختبار غير صالحة.' using errcode = '23514';
  end if;

  if (
    select count(distinct (item ->> 'position')::integer)
    from jsonb_array_elements(p_questions) as item
  ) <> jsonb_array_length(p_questions) then
    raise exception 'ترتيب أسئلة الاختبار غير فريد.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item
    left join public.questions q on q.id = (item ->> 'question_id')::uuid
    where q.id is null
       or q.user_id <> auth.uid()
       or q.subject_id <> p_subject_id
  ) then
    raise exception 'إحدى أسئلة الاختبار لا تتبع المادة أو لا تملكها.' using errcode = '42501';
  end if;

  select sum((item -> 'snapshot' ->> 'points')::numeric)
    into v_sum
  from jsonb_array_elements(p_questions) as item;

  if round(v_sum, 2) <> round(p_total_points, 2) then
    raise exception 'مجموع درجات الأسئلة يجب أن يساوي إجمالي درجات الاختبار.' using errcode = '23514';
  end if;

  select coalesce(
    array_agg(distinct btrim(g) order by btrim(g)),
    '{}'::text[]
  )
    into v_group_names
  from unnest(coalesce(p_group_names, '{}'::text[])) as g
  where btrim(g) <> '';

  v_letterhead_snapshot := null;

  if p_letterhead_id is not null then
    select l.* into v_letterhead
    from public.letterheads l
    where l.id = p_letterhead_id and l.user_id = auth.uid();

    if not found then
      raise exception 'قالب الكليشة غير موجود أو لا تملكه.' using errcode = 'P0002';
    end if;

    v_letterhead_snapshot := jsonb_build_object(
      'id', v_letterhead.id,
      'name', v_letterhead.name,
      'entity_name', v_letterhead.entity_name,
      'school_name', v_letterhead.school_name,
      'university_name', v_letterhead.university_name,
      'college_name', v_letterhead.college_name,
      'department_name', v_letterhead.department_name,
      'extra_text', v_letterhead.extra_text,
      'logo_path', v_letterhead.logo_path
    );
  end if;

  insert into public.exams (
    user_id, subject_id, subject_name_snapshot, grade_level_snapshot,
    title, total_points, group_names_snapshot, letterhead_id,
    letterhead_snapshot, closing_phrase
  ) values (
    auth.uid(), p_subject_id, v_subject.name, v_subject.grade_level,
    btrim(p_title), p_total_points, v_group_names, p_letterhead_id,
    v_letterhead_snapshot,
    nullif(btrim(coalesce(p_closing_phrase, '')), '')
  )
  returning id into v_exam_id;

  for v_item in
    select value from jsonb_array_elements(p_questions)
  loop
    insert into public.exam_questions (
      user_id, exam_id, question_id, position, snapshot
    ) values (
      auth.uid(), v_exam_id, (v_item ->> 'question_id')::uuid,
      (v_item ->> 'position')::integer, v_item -> 'snapshot'
    );
  end loop;

  return v_exam_id;
end;
$$;

-- ============================================================
-- 6) دوال المشاركة (نفس نسخة schema.sql)
-- ============================================================

create or replace function public.create_question_share(
  p_subject_id uuid,
  p_expires_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_subject public.subjects%rowtype;
  v_token text;
  v_hash text;
  v_groups jsonb;
  v_group_keys jsonb;
  v_questions jsonb;
  v_package jsonb;
  v_share_id uuid;
  v_expires_at timestamptz;
  v_count integer;
begin
  if v_user is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  if p_expires_days is null or p_expires_days < 1 or p_expires_days > 30 then
    raise exception 'مدة صلاحية الرابط يجب أن تكون بين يوم و30 يوماً.' using errcode = '22023';
  end if;

  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id and s.user_id = v_user;

  if not found then
    raise exception 'المادة غير موجودة أو لا تملكها.' using errcode = 'P0002';
  end if;

  select count(*) into v_count
  from public.questions q
  where q.subject_id = v_subject.id and q.user_id = v_user;

  if v_count = 0 then
    raise exception 'لا يمكن مشاركة مادة بلا أسئلة.' using errcode = '23514';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  select coalesce(
    jsonb_object_agg(
      g.id::text,
      encode(digest(v_token || ':' || g.id::text, 'sha256'), 'hex')
    ),
    '{}'::jsonb
  )
    into v_group_keys
  from public.subject_groups sg
  join public.teaching_groups g on g.id = sg.group_id
  where sg.subject_id = v_subject.id
    and sg.user_id = v_user;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_id', v_group_keys ->> g.id::text,
        'name', g.name
      )
      order by g.name, g.id
    ),
    '[]'::jsonb
  )
    into v_groups
  from public.subject_groups sg
  join public.teaching_groups g on g.id = sg.group_id
  where sg.subject_id = v_subject.id
    and sg.user_id = v_user;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_text', q.question_text,
        'type', q.type,
        'options', q.options,
        'correct_answer', q.correct_answer,
        'difficulty', q.difficulty,
        'unit', q.unit,
        'group_scope', q.group_scope,
        'source_group_ids', coalesce(
          (
            select jsonb_agg(v_group_keys ->> qg.group_id::text order by g2.name, g2.id)
            from public.question_groups qg
            join public.teaching_groups g2 on g2.id = qg.group_id
            where qg.question_id = q.id
              and qg.user_id = v_user
          ),
          '[]'::jsonb
        )
      )
      order by q.created_at, q.id
    ),
    '[]'::jsonb
  )
    into v_questions
  from public.questions q
  where q.subject_id = v_subject.id and q.user_id = v_user;

  v_package := jsonb_build_object(
    'format', 'teacher-question-bank.share.v1',
    'subject_name', v_subject.name,
    'created_at', now(),
    'groups', v_groups,
    'questions', v_questions
  );

  insert into public.question_share_packages (
    user_id, subject_id, subject_name_snapshot, question_count,
    package, token_hash, expires_at
  ) values (
    v_user, v_subject.id, v_subject.name, v_count,
    v_package, v_hash, now() + make_interval(days => p_expires_days)
  )
  returning id, expires_at into v_share_id, v_expires_at;

  return jsonb_build_object(
    'share_id', v_share_id,
    'token', v_token,
    'expires_at', v_expires_at,
    'question_count', v_count,
    'group_count', jsonb_array_length(v_groups)
  );
end;
$$;

create or replace function public.get_question_share_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_share public.question_share_packages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول لعرض الحزمة.' using errcode = '42501';
  end if;

  if p_token is null or lower(btrim(p_token)) !~ '^[a-f0-9]{32,128}$' then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  v_hash := encode(digest(lower(btrim(p_token)), 'sha256'), 'hex');

  select s.* into v_share
  from public.question_share_packages s
  where s.token_hash = v_hash
    and s.used_at is null
    and s.revoked_at is null
    and s.expires_at > now();

  if not found then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'package', v_share.package,
    'expires_at', v_share.expires_at,
    'subject_name', v_share.subject_name_snapshot
  );
end;
$$;

create or replace function public.accept_question_share(
  p_token text,
  p_subject_name text default null,
  p_group_mapping jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_share public.question_share_packages%rowtype;
  v_package jsonb;
  v_mapping jsonb;
  v_subject_id uuid;
  v_subject_name text;
  v_group_map jsonb := '{}'::jsonb;
  v_source_group jsonb;
  v_source_id text;
  v_mode text;
  v_target_id uuid;
  v_group_name text;
  v_question jsonb;
  v_question_id uuid;
  v_source_group_id text;
  v_target_group_id text;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'يجب تسجيل الدخول لاستيراد الحزمة.' using errcode = '42501';
  end if;

  if p_token is null or lower(btrim(p_token)) !~ '^[a-f0-9]{32,128}$' then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  v_hash := encode(digest(lower(btrim(p_token)), 'sha256'), 'hex');

  select s.* into v_share
  from public.question_share_packages s
  where s.token_hash = v_hash
    and s.used_at is null
    and s.revoked_at is null
    and s.expires_at > now()
  for update;

  if not found then
    raise exception 'رابط المشاركة غير صالح أو منتهي أو مستخدم مسبقاً.' using errcode = 'P0002';
  end if;

  v_package := v_share.package;

  if coalesce(v_package ->> 'format', '') <> 'teacher-question-bank.share.v1'
     or coalesce(jsonb_typeof(v_package -> 'questions'), '') <> 'array' then
    raise exception 'صيغة حزمة المشاركة غير مدعومة.' using errcode = '22023';
  end if;

  v_mapping := case
    when p_group_mapping is not null and jsonb_typeof(p_group_mapping) = 'object'
      then p_group_mapping
    else '{}'::jsonb
  end;

  v_subject_name := coalesce(
    nullif(btrim(coalesce(p_subject_name, '')), ''),
    v_share.subject_name_snapshot
  );

  if v_subject_name is null or btrim(v_subject_name) = '' then
    raise exception 'اسم المادة مطلوب.' using errcode = '23514';
  end if;

  if length(btrim(v_subject_name)) > 120 then
    raise exception 'اسم المادة طويل جداً.' using errcode = '23514';
  end if;

  insert into public.subjects (user_id, name)
  values (v_user, btrim(v_subject_name))
  returning id into v_subject_id;

  for v_source_group in
    select value from jsonb_array_elements(coalesce(v_package -> 'groups', '[]'::jsonb))
  loop
    v_source_id := v_source_group ->> 'source_id';

    if v_source_id is null or v_source_id = '' then
      continue;
    end if;

    v_mode := coalesce(v_mapping -> v_source_id ->> 'mode', 'skip');
    v_target_id := null;

    if v_mode = 'existing' then
      begin
        v_target_id := (v_mapping -> v_source_id ->> 'group_id')::uuid;
      exception when others then
        v_target_id := null;
      end;

      if v_target_id is null or not exists (
        select 1 from public.teaching_groups g
        where g.id = v_target_id and g.user_id = v_user
      ) then
        raise exception 'إحدى المجموعات المختارة غير موجودة أو لا تملكها.' using errcode = '42501';
      end if;
    elsif v_mode = 'new' then
      v_group_name := btrim(
        coalesce(
          v_mapping -> v_source_id ->> 'name',
          v_source_group ->> 'name'
        )
      );

      if v_group_name = '' then
        raise exception 'اسم المجموعة الجديدة مطلوب.' using errcode = '23514';
      end if;

      if length(v_group_name) > 120 then
        raise exception 'اسم المجموعة طويل جداً.' using errcode = '23514';
      end if;

      insert into public.teaching_groups (user_id, name)
      values (v_user, v_group_name)
      on conflict (user_id, name) do update set name = excluded.name
      returning id into v_target_id;
    else
      continue;
    end if;

    v_group_map := v_group_map || jsonb_build_object(v_source_id, v_target_id::text);

    insert into public.subject_groups (subject_id, group_id, user_id)
    values (v_subject_id, v_target_id, v_user)
    on conflict (subject_id, group_id) do nothing;
  end loop;

  for v_question in
    select value from jsonb_array_elements(v_package -> 'questions')
  loop
    insert into public.questions (
      user_id, subject_id, unit, type, question_text, options,
      correct_answer, difficulty, group_scope
    ) values (
      v_user,
      v_subject_id,
      nullif(btrim(coalesce(v_question ->> 'unit', '')), ''),
      v_question ->> 'type',
      v_question ->> 'question_text',
      case
        when v_question ? 'options' and v_question -> 'options' <> 'null'::jsonb
          then v_question -> 'options'
        else null
      end,
      v_question ->> 'correct_answer',
      v_question ->> 'difficulty',
      case
        when v_question ->> 'group_scope' = 'selected' then 'selected'
        else 'all'
      end
    )
    returning id into v_question_id;

    if coalesce(v_question ->> 'group_scope', 'all') = 'selected' then
      for v_source_group_id in
        select value from jsonb_array_elements_text(
          coalesce(v_question -> 'source_group_ids', '[]'::jsonb)
        )
      loop
        v_target_group_id := v_group_map ->> v_source_group_id;

        if v_target_group_id is not null then
          insert into public.question_groups (question_id, subject_id, group_id, user_id)
          values (v_question_id, v_subject_id, v_target_group_id::uuid, v_user)
          on conflict (question_id, group_id) do nothing;
        end if;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  update public.question_share_packages
  set used_at = now(), used_by = v_user
  where id = v_share.id;

  return jsonb_build_object(
    'subject_id', v_subject_id,
    'subject_name', btrim(v_subject_name),
    'question_count', v_count,
    'group_count', (
      select count(*) from public.subject_groups sg where sg.subject_id = v_subject_id
    )
  );
end;
$$;

create or replace function public.revoke_question_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated boolean := false;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول.' using errcode = '42501';
  end if;

  update public.question_share_packages
  set revoked_at = now()
  where id = p_share_id
    and user_id = auth.uid()
    and used_at is null
    and revoked_at is null
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

-- ============================================================
-- 7) الصلاحيات
-- ============================================================
grant usage on schema public to anon, authenticated;

revoke all on public.subjects from anon;
revoke all on public.teaching_groups from anon;
revoke all on public.subject_groups from anon;
revoke all on public.questions from anon;
revoke all on public.question_groups from anon;
revoke all on public.letterheads from anon;
revoke all on public.exams from anon;
revoke all on public.exam_questions from anon;
revoke all on public.question_share_packages from anon;

grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.teaching_groups to authenticated;
grant select, insert, update, delete on public.subject_groups to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.question_groups to authenticated;
grant select, insert, update, delete on public.letterheads to authenticated;
grant select, insert, update, delete on public.exams to authenticated;
grant select, insert, update, delete on public.exam_questions to authenticated;

revoke all on public.question_share_packages from authenticated;
grant select (
  id, user_id, subject_id, subject_name_snapshot, question_count,
  created_at, expires_at, revoked_at, used_at
) on public.question_share_packages to authenticated;

revoke all on function public.save_subject(uuid, text, uuid[]) from public, anon;
revoke all on function public.save_question(uuid, uuid, text, text, text, jsonb, text, text, text, uuid[]) from public, anon;
revoke all on function public.save_exam(text, uuid, numeric, text[], uuid, text, jsonb) from public, anon;
revoke all on function public.create_question_share(uuid, integer) from public, anon;
revoke all on function public.get_question_share_preview(text) from public, anon;
revoke all on function public.accept_question_share(text, text, jsonb) from public, anon;
revoke all on function public.revoke_question_share(uuid) from public, anon;

grant execute on function public.save_subject(uuid, text, uuid[]) to authenticated;
grant execute on function public.save_question(uuid, uuid, text, text, text, jsonb, text, text, text, uuid[]) to authenticated;
grant execute on function public.save_exam(text, uuid, numeric, text[], uuid, text, jsonb) to authenticated;
grant execute on function public.create_question_share(uuid, integer) to authenticated;
grant execute on function public.get_question_share_preview(text) to authenticated;
grant execute on function public.accept_question_share(text, text, jsonb) to authenticated;
grant execute on function public.revoke_question_share(uuid) to authenticated;

-- ============================================================
-- 8) تخزين الشعارات الخاص
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'letterhead-logos',
  'letterhead-logos',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "letterhead logos select own" on storage.objects;
create policy "letterhead logos select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "letterhead logos insert own" on storage.objects;
create policy "letterhead logos insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "letterhead logos update own" on storage.objects;
create policy "letterhead logos update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "letterhead logos delete own" on storage.objects;
create policy "letterhead logos delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'letterhead-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- ============================================================
-- التحقق بعد التشغيل (استعلامات قراءة فقط، اختيارية)
-- ============================================================
-- select id, name, grade_level from public.subjects order by created_at;
-- select id, name from public.teaching_groups order by name;
-- select * from public.subject_groups;
-- select column_name, is_nullable, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'questions'
--   order by ordinal_position;
-- select column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'exams'
--   order by ordinal_position;
-- select id, name, public from storage.buckets where id = 'letterhead-logos';

```
