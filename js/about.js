const copyButton = document.getElementById('copy-email');
const emailLink = document.getElementById('contact-email');
const copyStatus = document.getElementById('copy-status');

if (copyButton && emailLink && copyStatus) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    copyStatus.textContent = '';
    try {
      await navigator.clipboard.writeText(emailLink.textContent.trim());
      copyStatus.textContent = 'تم نسخ البريد الإلكتروني.';
    } catch {
      copyStatus.textContent = 'تعذّر النسخ التلقائي. يمكنك تحديد البريد ونسخه يدويًا.';
    }
  });
}
