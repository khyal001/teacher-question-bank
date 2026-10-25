// ============================================================
// إعدادات Supabase
// استبدل القيمتين بقيم مشروعك من:
// Supabase Dashboard > Project Settings > API
//
// ملاحظة: anon key مفتاح عام مخصص للواجهة، وليس secret.
// لا تضع service_role key هنا إطلاقاً.
// ============================================================

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';

const PLACEHOLDER_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const PLACEHOLDER_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';

export const isSupabaseConfigured =
  SUPABASE_URL !== PLACEHOLDER_URL &&
  SUPABASE_ANON_KEY !== PLACEHOLDER_KEY &&
  SUPABASE_URL.startsWith('https://') &&
  SUPABASE_ANON_KEY.length > 20;
