function normalize(path) {
  if (!path) return '';
  return path.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');
}

export function matchesCategory(path, slug, map) {
  if (!slug || slug === 'all') return true;
  const bucket = map?.[slug];
  if (!bucket?.tools) return false;
  const npath = normalize(path);
  return bucket.tools.some((tool) => normalize(tool.url) === npath);
}

/**
 * Case-insensitive substring match used by the catalog search box.
 * An empty/whitespace query matches everything.
 * @param {string} text The card's text content.
 * @param {string} query The raw search input value.
 * @returns {boolean}
 */
export function matchesSearch(text, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return (text || '').toLowerCase().includes(q);
}

export function parseCategoryFromUrl(href) {
  try {
    const url = new URL(href);
    return url.searchParams.get('category');
  } catch {
    return null;
  }
}
