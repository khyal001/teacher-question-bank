export const DEFAULT_LETTERHEAD_LAYOUT = Object.freeze({ logo: 'center', entity: 'right', education: 'left' });
const POSITIONS = ['right', 'center', 'left'];
const LABELS = { logo: 'الشعار', entity: 'الجهة العليا', education: 'الجهة التعليمية والقسم / البرنامج' };

export function educationLines(value) {
  return [value.school_name, value.university_name, value.college_name, value.department_name, value.extra_text]
    .map((line) => String(line || '').trim()).filter(Boolean);
}

export function layoutError(value, hasLogo = Boolean(value.logo_path)) {
  const layout = value.layout;
  if (!layout) return '';
  if (Object.keys(layout).length !== 3 || Object.keys(LABELS).some((key) => !POSITIONS.includes(layout[key]))) {
    return 'اختر موضعًا صالحًا لكل كتلة في الكليشة.';
  }
  const active = [hasLogo && 'logo', String(value.entity_name || '').trim() && 'entity', educationLines(value).length && 'education'].filter(Boolean);
  const occupied = new Map();
  for (const key of active) {
    const previous = occupied.get(layout[key]);
    if (previous) return `موضع ${layout[key] === 'right' ? 'اليمين' : layout[key] === 'left' ? 'اليسار' : 'الوسط'} مستخدم بواسطة ${LABELS[previous]}. اختر موضعًا آخر لـ${LABELS[key]}.`;
    occupied.set(layout[key], key);
  }
  return '';
}

// Same safe DOM renderer for the editor preview, template cards and saved exams.
// NULL layout preserves the exact legacy text grouping and logo placement.
export function renderLetterhead(value, logoUrl, h) {
  const lines = (items) => items.filter(Boolean).map((text, index) => h('span', {
    class: index === 0 ? 'exam-letterhead-line is-strong' : 'exam-letterhead-line', text,
  }));
  const logo = () => logoUrl ? h('img', { class: 'exam-letterhead-logo', src: logoUrl, alt: 'شعار الجهة' }) : null;
  if (!value.layout) {
    return h('div', { class: 'exam-letterhead' }, logo(), h('div', { class: 'exam-letterhead-lines' }, ...lines([value.entity_name, ...educationLines(value)])));
  }
  const error = layoutError(value, Boolean(logoUrl || value.logo_path));
  if (error) return h('p', { class: 'form-error', role: 'status', text: error });
  const root = h('div', { class: 'exam-letterhead positioned-letterhead' });
  const blocks = {
    logo: logo(),
    entity: value.entity_name ? h('div', { class: 'exam-letterhead-lines' }, ...lines([value.entity_name])) : null,
    education: educationLines(value).length ? h('div', { class: 'exam-letterhead-lines' }, ...lines(educationLines(value))) : null,
  };
  for (const key of ['entity', 'logo', 'education']) {
    if (blocks[key]) root.appendChild(h('div', { class: `letterhead-slot slot-${value.layout[key]}` }, blocks[key]));
  }
  return root;
}
