const IGNORE_PATHS = ['/helix-env.json', '/sitemap.json'];

/**
 * Filters resources to pages with pending changes (preview newer than publish).
 * @param {Array} resources
 * @returns {Array}
 */
export default function filterPendingPages(resources) {
  return resources.filter(({ path, previewLastModified, publishLastModified }) => {
    if (!path || IGNORE_PATHS.includes(path)) return false;
    if (!previewLastModified || !publishLastModified) return false;
    return new Date(previewLastModified) > new Date(publishLastModified);
  });
}
