/**
 * Filters a list of string items by a query, matching case-insensitively on substring.
 * @param {string} query - The search query. Empty or whitespace-only returns a copy of all items.
 * @param {string[]} items - The candidate items.
 * @returns {string[]} A new array of the matching items. Never mutates the input.
 */
// eslint-disable-next-line import/prefer-default-export
export function filterItems(query, items) {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => String(item).toLowerCase().includes(normalized));
}
