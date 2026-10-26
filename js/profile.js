import { supabase } from './supabase.js';
import { initNav, requireAuth } from './auth.js';
import { profileName, updateDisplayName } from './profile-utils.js';
import { friendlyError, setButtonBusy, showFormError, toast } from './ui.js';

const form = document.getElementById('profile-form');
const nameInput = document.getElementById('profile-name');
const emailInput = document.getElementById('profile-email');
const saveButton = document.getElementById('profile-save');
const errorBox = document.getElementById('profile-error');

init();

async function init() {
  const user = await requireAuth();
  if (!user) return;
  initNav('profile', user);
  nameInput.value = profileName(user);
  emailInput.value = user.email || '';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError(errorBox, '');
    setButtonBusy(saveButton, true, 'جارٍ الحفظ...');
    try {
      const updated = await updateDisplayName(supabase, nameInput.value);
      document.getElementById('nav-user-name').textContent = profileName(updated);
      nameInput.value = profileName(updated);
      toast('تم حفظ الاسم.');
    } catch (error) {
      showFormError(errorBox, friendlyError(error));
    } finally {
      setButtonBusy(saveButton, false);
    }
  });
}
