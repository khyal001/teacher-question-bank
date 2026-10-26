// Only user-editable identity metadata; application roles stay in private profiles.
export function profileName(user) {
  const metadata = user?.user_metadata || {};
  return metadata.display_name || metadata.full_name || metadata.name || user?.email?.split('@')[0] || 'المعلم';
}

export async function updateDisplayName(client, value) {
  const name = String(value || '').trim();
  if (!name || name.length > 160) throw new Error('اكتب اسمًا من حرف واحد إلى 160 حرفًا.');
  const { data, error } = await client.auth.updateUser({ data: { display_name: name, full_name: name } });
  if (error) throw error;
  if (!data?.user) throw new Error('تعذر تأكيد حفظ الاسم. أعد المحاولة.');
  return data.user;
}

export async function navigationRole(client) {
  const { data, error } = await client.rpc('get_my_role');
  return !error && data === 'admin' ? 'admin' : 'teacher';
}
