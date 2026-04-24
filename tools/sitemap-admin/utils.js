/**
 * Escapes special XML characters in a string.
 * @param {string} value - Raw string value
 * @returns {string} XML-safe string
 */
export function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}

/**
 * Parses a comma-separated hreflang input string into either a single string
 * or an array of strings, depending on how many non-empty values are present.
 * Returns null when the input is empty or contains no non-empty tokens.
 *
 * @param {string} hreflangInput - Raw comma-separated hreflang value from the form
 * @returns {string|string[]|null} Single string, array, or null
 */
export function parseHreflang(hreflangInput) {
  const trimmed = (hreflangInput || '').trim();
  if (!trimmed) return null;

  const values = trimmed.split(',').map((h) => h.trim()).filter((h) => h);
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return values;
}

/**
 * Collects all sitemap destination entries from a sitemaps configuration object.
 * Returns a flat array of { destination, origin } pairs for use when building
 * a sitemap index.
 *
 * @param {object} sitemaps - The sitemaps map from the loaded YAML (loadedSitemaps.sitemaps)
 * @returns {{ destination: string, origin: string }[]}
 */
export function collectSitemapEntries(sitemaps) {
  const entries = [];
  if (!sitemaps) return entries;

  Object.values(sitemaps).forEach((sitemapDef) => {
    const origin = sitemapDef.origin || '';
    if (sitemapDef?.languages !== undefined) {
      // Multi-language sitemap: collect each language's destination
      Object.values(sitemapDef.languages).forEach((langDef) => {
        if (langDef.destination) entries.push({ destination: langDef.destination, origin });
      });
    } else if (sitemapDef.destination) {
      entries.push({ destination: sitemapDef.destination, origin });
    }
  });

  return entries;
}
