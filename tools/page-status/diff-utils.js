const IGNORE_PATHS = ['/helix-env.json', '/sitemap.json'];

/**
 * Filters resources to pages that have pending changes (preview newer than publish).
 * @param {Array} resources
 * @returns {Array} resources where preview is newer than publish
 */
export default function filterPendingPages(resources) {
  return resources.filter(({ path, previewLastModified, publishLastModified }) => {
    if (!path || IGNORE_PATHS.includes(path)) return false;
    if (!previewLastModified || !publishLastModified) return false;
    return new Date(previewLastModified) > new Date(publishLastModified);
  });
}
