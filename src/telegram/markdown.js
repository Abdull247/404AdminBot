function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function convertWhatsAppMarkup(text) {
  let value = escapeHtml(text);
  value = value.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  value = value.replace(/_([^_\n]+)_/g, '<i>$1</i>');
  value = value.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return value;
}

export function toTelegramHtml(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return convertWhatsAppMarkup(raw);
}
