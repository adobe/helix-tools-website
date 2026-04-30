/**
 * Escapes HTML for safe insertion into text and double-quoted attributes, using the DOM.
 * @param {string|number|boolean|null|undefined} value
 * @returns {string}
 */
export default function escapeHtml(value) {
  if (value == null || value === '') return '';
  const div = document.createElement('div');
  div.textContent = typeof value === 'string' ? value : String(value);
  return div.innerHTML;
}
