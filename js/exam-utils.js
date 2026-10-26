// أدوات نقية لتوزيع الدرجات واختيار تخطيط أسئلة الاختيار من متعدد.
// لا تعتمد على DOM أو Supabase، لذلك يمكن اختبارها محلياً عبر Node.

export const EXAM_FOOTER_TEXT = 'تم إنشاء هذا الاختبار بواسطة بنك أسئلة المعلم';

export const TF_INSTRUCTION =
  'ضع علامة (✓) أمام العبارة الصحيحة، وعلامة (✗) أمام العبارة الخاطئة.';

export const MCQ_INSTRUCTION = 'اختر الإجابة الصحيحة.';

export const SHORT_INSTRUCTION = 'أجب عن الأسئلة التالية.';

export const QUESTION_LAYOUTS = Object.freeze(['auto', 'full', 'half']);

export const QUESTION_LAYOUT_LABELS = Object.freeze({
  auto: 'تلقائي',
  full: 'عرض كامل',
  half: 'نصف عرض',
});

export const QUESTION_TYPES = Object.freeze(['true_false', 'mcq', 'short']);

/**
 * تحويل قيمة نقطية إلى سنتات (عدد صحيح) مع رفض أكثر من منزلتين عشريتين.
 * يعيد null إذا كانت القيمة غير صالحة.
 */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  const cents = Math.round(num * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(num * 100 - cents) > 1e-7) return null;
  return cents;
}

export function isPositivePoints(value) {
  const cents = toCents(value);
  return cents !== null && cents > 0;
}

export function pointsToNumber(cents) {
  return Number((cents / 100).toFixed(2));
}

/**
 * توزيع إجمالي الدرجات على عدد الأسئلة بحيث يساوي المجموع الإجمالي تماماً.
 * يوزع فروق السنتات على الأسئلة الأولى.
 */
export function distributePoints(total, count) {
  const totalCents = toCents(total);

  if (totalCents === null || totalCents <= 0) {
    throw new Error('إجمالي الدرجات يجب أن يكون رقماً أكبر من صفر بمنزلتين عشريتين كحد أقصى.');
  }

  if (!Number.isInteger(count) || count < 1) {
    throw new Error('عدد الأسئلة يجب أن يكون عدداً صحيحاً أكبر من صفر.');
  }

  if (totalCents < count) {
    throw new Error('إجمالي الدرجات صغير جداً لتوزيعه على عدد الأسئلة المطلوبة بدرجة موجبة لكل سؤال.');
  }

  if (Number.isInteger(Number(total)) && Number(total) >= count) {
    const base = Math.floor(Number(total) / count);
    const remainder = Number(total) % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  return Array.from({ length: count }, (_, index) =>
    pointsToNumber(base + (index < remainder ? 1 : 0)),
  );
}

/**
 * مجموع الدرجات بالسنتات. يعيد null إذا وُجدت درجة غير موجبة أو غير صالحة.
 */
export function pointsTotalCents(points) {
  let sum = 0;

  for (const value of points || []) {
    const cents = toCents(value);
    if (cents === null || cents <= 0) return null;
    sum += cents;
    if (!Number.isSafeInteger(sum)) return null;
  }

  return sum;
}

export function sumPoints(points) {
  const cents = pointsTotalCents(points);
  return cents === null ? null : pointsToNumber(cents);
}

export function pointsMatch(total, points) {
  const totalCents = toCents(total);
  const sumCents = pointsTotalCents(points);
  return totalCents !== null && totalCents > 0 && sumCents !== null && totalCents === sumCents;
}

export function remainingPoints(total, points) {
  const totalCents = toCents(total);
  const sumCents = pointsTotalCents(points);
  if (totalCents === null || sumCents === null) return null;
  return pointsToNumber(totalCents - sumCents);
}

/**
 * اختيار تلقائي بين العرض الكامل ونصف العرض بناءً على طول الخيارات وعددها.
 * يمكن للمعلم تجاوز الاختيار عبر full أو half.
 */
export function chooseMcqLayout(options, override = 'auto') {
  if (override === 'full' || override === 'half') return override;

  const values = (options || []).map((option) => String(option ?? '').trim());

  if (values.length === 0) return 'half';
  if (values.length > 4) return 'full';
  if (values.some((value) => value.includes('\n'))) return 'full';

  const maxLength = Math.max(...values.map((value) => value.length));
  const totalLength = values.reduce((sum, value) => sum + value.length, 0);

  return maxLength > 32 || totalLength > 100 ? 'full' : 'half';
}

/** One section per type; position remains authoritative within each type.
 * New drafts are normalized to this same order before assigning positions.
 * Viewing an older exam never rewrites its stored snapshot or positions.
 */
export function buildExamSections(rows) {
  const ordered = (rows || []).slice().sort((a, b) => Number(a.position) - Number(b.position));
  let displayNumber = 0;
  return QUESTION_TYPES.map((type) => ({ type,
    items: ordered.filter((row) => (QUESTION_TYPES.includes(row?.snapshot?.type) ? row.snapshot.type : 'short') === type)
      .map((row) => ({ row, displayNumber: ++displayNumber })),
  })).filter((section) => section.items.length);
}

export function groupDraftItems(items) {
  return QUESTION_TYPES.flatMap((type) => items.filter((item) => item.question.type === type));
}

export function selectDistribution(questions, requested, shuffle = (items) => items) {
  const selected = [];
  for (const type of QUESTION_TYPES) for (const difficulty of ['easy', 'medium', 'hard']) {
    const count = requested[type]?.[difficulty] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('أعداد الأسئلة يجب أن تكون أعداداً صحيحة غير سالبة.');
    const pool = questions.filter((q) => q.type === type && q.difficulty === difficulty);
    if (count > pool.length) {
      const types = { true_false: 'صح / خطأ', mcq: 'اختيار من متعدد', short: 'إجابة قصيرة' };
      const difficulties = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };
      throw new Error(`${types[type]} — ${difficulties[difficulty]}: المطلوب ${count}، المتاح ${pool.length}. قلّل العدد أو أضف أسئلة.`);
    }
    selected.push(...shuffle(pool).slice(0, count));
  }
  if (!selected.length) throw new Error('حدّد سؤالاً واحداً على الأقل.');
  return selected;
}

export function draftFromExam(exam, rows) {
  return groupDraftItems([...rows].sort((a, b) => a.position - b.position).map((row) => ({
    sourceRowId: row.id,
    question: { ...structuredClone(row.snapshot), id: row.question_id || `historical-${row.id}`, subject_id: exam.subject_id },
    options: row.snapshot.type === 'mcq' ? [...(row.snapshot.options || [])] : null,
    points: row.snapshot.points,
    layout: row.snapshot.layout || 'auto',
  })));
}

export function questionAppliesToGroups(question, linkedGroups, selectedGroups) {
  if (question.group_scope === 'all') return true;
  if (question.group_scope !== 'selected' || !selectedGroups.length) return false;
  const links = new Set(linkedGroups || []);
  return selectedGroups.every((id) => links.has(id));
}

export function replacementCandidates(questions, current, usedIds) {
  return questions.filter((question) => !usedIds.has(question.id) &&
    question.type === current.type && question.difficulty === current.difficulty);
}

export function historicalGrade(exam) {
  return String(exam?.grade_level_snapshot || '').trim();
}

// Legacy snapshots may have more than two decimals. Never apply new-exam rounding here.
export function snapshotPoints(row) {
  const value = Number(row?.snapshot?.points);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function totalFromRows(rows) {
  const parts = (rows || []).map((row) => String(snapshotPoints(row))).map((value) => {
    // Expand scientific notation before doing exact decimal addition with BigInt.
    const [mantissa, exponent = '0'] = value.toLowerCase().split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const digits = whole + fraction;
    const scale = fraction.length - Number(exponent);
    return scale < 0 ? { digits: digits + '0'.repeat(-scale), scale: 0 } : { digits, scale };
  });
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const total = parts.reduce((sum, part) => sum + BigInt(part.digits) * 10n ** BigInt(scale - part.scale), 0n);
  const digits = total.toString().padStart(scale + 1, '0');
  return Number(scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
}
