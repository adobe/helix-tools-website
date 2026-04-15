/**
 * Filters resources to find pages with pending changes (preview newer than publish).
 * @param {Array} resources - Array of resource objects
 * @returns {Array} Filtered array of pages with pending changes
 */
export function filterPendingPages(resources) {
  const ignore = ['/helix-env.json', '/sitemap.json'];

  return resources.filter((resource) => {
    const { path, previewLastModified, publishLastModified } = resource;

    // Skip ignored paths
    if (!path || ignore.includes(path)) return false;

    // Must have both preview and publish dates
    if (!previewLastModified || !publishLastModified) return false;

    const previewDate = new Date(previewLastModified);
    const publishDate = new Date(publishLastModified);

    // Preview must be newer than publish
    return previewDate > publishDate;
  });
}
