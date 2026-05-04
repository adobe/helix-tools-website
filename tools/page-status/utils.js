/**
 * Validates and normalizes a path string for status API queries.
 * @param {string} path
 * @returns {string} normalized path ending in / followed by *
 */
export function validatePath(path) {
  if (!path) return '/*';
  let str = path;
  if (str.includes('://')) {
    [str] = path.split('://');
  }
  if (str.includes('/')) {
    str = str.substring(str.indexOf('/'));
  } else {
    str = '/';
  }
  str = str.startsWith('/') ? str : `/${str}`;
  if (!str.endsWith('/')) {
    str += '/';
  }
  str += '*';
  return str;
}

/**
 * Classifies the edit/preview/publish sequence into a human-readable label
 * and a CSS modifier ('positive' or 'negative').
 *
 * @param {string} edit - edit last-modified date string
 * @param {string} preview - preview last-modified date string
 * @param {string} publish - publish last-modified date string
 * @returns {{label: string, modifier: 'positive'|'negative'}}
 */
export function classifySequenceStatus(edit, preview, publish) {
  const valid = (d) => !Number.isNaN(d.getTime());
  const editDate = new Date(edit);
  const previewDate = new Date(preview);
  const publishDate = new Date(publish);
  const inSequence = editDate <= previewDate && previewDate <= publishDate;

  if (!valid(editDate)) {
    return { label: 'No source', modifier: 'negative' };
  }
  if (!valid(previewDate) && !valid(publishDate)) {
    return { label: 'Not previewed', modifier: 'positive' };
  }
  if (valid(editDate) && valid(previewDate) && !valid(publishDate) && editDate <= previewDate) {
    return { label: 'Not published', modifier: 'positive' };
  }
  return { label: inSequence ? 'Current' : 'Pending changes', modifier: 'positive' };
}
