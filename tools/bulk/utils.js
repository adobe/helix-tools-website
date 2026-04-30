/**
 * Extract org and site name from an AEM URL hostname.
 * AEM URLs follow the pattern: branch--site--org.aem.page
 * @param {string} url - Full URL (e.g. https://main--mysite--myorg.aem.page/path)
 * @returns {{ org: string, site: string }}
 */
export function extractOrgSite(url) {
  const { hostname } = new URL(url);
  const [, site, org] = hostname.split('.')[0].split('--');
  return { org, site };
}

/**
 * Analyze URLs for sanitization issues.
 * @param {string[]} rawUrls - Array of raw URL strings
 * @returns {{
 *   urls: string[],
 *   urlsUnsanitized: string[],
 *   rejected: Array<{original: string, reason: string}>,
 *   modified: Array<{original: string, sanitized: string, changes: string[]}>,
 *   deduplicated: string[]
 * }}
 */
export const analyzeUrls = (rawUrls) => {
  const rejected = [];
  const modified = [];
  const validUrls = [];
  const sanitizedToOriginal = new Map();

  const sanitizeUrl = (urlObj) => {
    urlObj.hash = '';
    urlObj.search = '';
    const decodedPath = decodeURIComponent(urlObj.pathname);
    urlObj.pathname = decodedPath
      .toLowerCase()
      .replace(/\/{2,}/g, '/')
      .split('/')
      .map((segment, i, arr) => {
        const isLast = i === arr.length - 1;
        const jsonSuffix = isLast && segment.endsWith('.json') ? '.json' : '';
        const base = jsonSuffix ? segment.slice(0, -5) : segment;
        return base
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9_]+/g, '-')
          .replace(/^-|-$/g, '') + jsonSuffix;
      })
      .join('/');
    return urlObj.toString();
  };

  rawUrls.forEach((rawUrl) => {
    if (!rawUrl) return;

    try {
      const urlObj = new URL(rawUrl.trim());
      if (urlObj.protocol !== 'https:') {
        rejected.push({
          original: rawUrl,
          reason: `Protocol '${urlObj.protocol}' not allowed (only https)`,
        });
        return;
      }

      const sanitized = sanitizeUrl(urlObj);

      if (sanitized !== rawUrl) {
        const changes = [];
        try {
          const original = new URL(rawUrl);
          const result = new URL(sanitized);
          if (original.hash && !result.hash) changes.push('hash removed');
          if (original.search && !result.search) changes.push('query params removed');
          if (original.pathname !== result.pathname) {
            const decodedOriginalPath = decodeURIComponent(original.pathname);
            const pathChanges = [];
            if (decodedOriginalPath !== decodedOriginalPath.toLowerCase()) {
              pathChanges.push('converted to lowercase');
            }
            if (/[^a-zA-Z0-9/_-]/.test(decodedOriginalPath)) {
              pathChanges.push('special characters replaced');
            }
            if (/\/{2,}/.test(decodedOriginalPath)) {
              pathChanges.push('duplicate slashes removed');
            }
            if (pathChanges.length > 0) {
              changes.push(`path: ${pathChanges.join(', ')}`);
            } else {
              changes.push('path normalized');
            }
          }
        } catch {
          changes.push('normalized');
        }
        modified.push({ original: rawUrl, sanitized, changes });
        validUrls.push(sanitized);
      } else {
        validUrls.push(sanitized);
      }
      if (!sanitizedToOriginal.has(sanitized)) {
        sanitizedToOriginal.set(sanitized, rawUrl.trim());
      }
    } catch {
      rejected.push({ original: rawUrl, reason: 'Invalid URL format' });
    }
  });

  const urlCounts = new Map();
  validUrls.forEach((url) => {
    urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
  });

  const urls = [...urlCounts.keys()];
  const urlsUnsanitized = urls.map((url) => sanitizedToOriginal.get(url));
  const deduplicated = Array.from(urlCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([url]) => url);

  return {
    urls, urlsUnsanitized, rejected, modified, deduplicated,
  };
};
