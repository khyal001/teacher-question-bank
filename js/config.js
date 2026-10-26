// ============================================================
// إعدادات Supabase
// القيم من: Supabase Dashboard > Project Settings > API
//
// ملاحظة: Publishable key مفتاح عام مخصص للواجهة، وليس secret.
// لا تضع أي مفتاح إداري سري أو Secret key هنا إطلاقاً.
// ============================================================

export const SUPABASE_URL = 'https://gjkuyecnyhlbvaftuwel.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_qrz46ilM_OFhYynW-aBiEg_lvGDExEZ';

const PLACEHOLDER_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const PLACEHOLDER_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';

export const isSupabaseConfigured =
  SUPABASE_URL !== PLACEHOLDER_URL &&
  SUPABASE_ANON_KEY !== PLACEHOLDER_KEY &&
  SUPABASE_URL.startsWith('https://') &&
  SUPABASE_ANON_KEY.length > 20;
