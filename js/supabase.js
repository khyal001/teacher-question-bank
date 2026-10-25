// عميل Supabase واحد مشترك لكل صفحات الموقع.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config.js';

export { isSupabaseConfigured };

// placeholder صالح شكلياً حتى لا ينهار الاستيراد قبل إعداد المشروع.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
