export function escapeHtml(str) {
  if (str == null || str === '') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function escapeAttr(str) {
  if (str == null || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Returns a string safe for use in HTML attribute (e.g. src/href): validates scheme and escapes.
 */
export function safeUrlForAttr(url) {
  if (!url || typeof url !== 'string') return '';
  const t = url.trim();
  if (t.startsWith('https://') || t.startsWith('http://') || (t.startsWith('/') && !t.startsWith('//'))) {
    return escapeAttr(t);
  }
  return '';
}

export function formatDateTime(isoString) {
  if (!isoString) return 'Unknown';

  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch (error) {
    return 'Invalid Date';
  }
}

export function pluralize(singular, plural, count) {
  return count === 1 ? singular : plural;
}

/**
 * Sorts media items for display: newest first by timestamp, then by doc path depth, then by name, then by URL for stability.
 */
export function sortMediaData(mediaData) {
  if (!mediaData || mediaData.length === 0) return mediaData ?? [];
  return [...mediaData].sort((a, b) => {
    const tsA = a.timestamp ?? 0;
    const tsB = b.timestamp ?? 0;
    const timeDiff = tsB - tsA;
    if (timeDiff !== 0) return timeDiff;

    const docPathA = a.doc || '';
    const docPathB = b.doc || '';
    const depthA = docPathA ? docPathA.split('/').filter((p) => p).length : 999;
    const depthB = docPathB ? docPathB.split('/').filter((p) => p).length : 999;
    const depthDiff = depthA - depthB;
    if (depthDiff !== 0) return depthDiff;

    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    const nameDiff = nameA.localeCompare(nameB);
    if (nameDiff !== 0) return nameDiff;

    // Final tiebreaker: URL/hash for absolute stability
    const urlA = (a.url || a.hash || '').toLowerCase();
    const urlB = (b.url || b.hash || '').toLowerCase();
    return urlA.localeCompare(urlB);
  });
}
