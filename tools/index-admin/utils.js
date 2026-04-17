/**
 * Determine the paths to use for reindexing based on include patterns.
 * For each pattern, builds path up to the first wildcard segment, then stops.
 * Static paths (no wildcards) are used as-is.
 * If any path is /*, just returns that alone since it covers everything.
 * Results are deduped.
 * @param {string[]} includes - Array of include patterns from index definition
 * @returns {string[]} Array of API paths to reindex
 */
export default function deriveReindexPaths(includes) {
  if (!includes || includes.length === 0) {
    return ['/*'];
  }

  const paths = includes.map((pattern) => {
    // If pattern has no wildcards, use it as-is
    if (!pattern.includes('*')) {
      return pattern;
    }

    // Split into segments
    const segments = pattern.split('/');
    const pathSegments = [];

    // Build path up to first segment containing a wildcard
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].includes('*')) {
        break;
      }
      pathSegments.push(segments[i]);
    }

    // Join segments back, ensure we have at least root
    const basePath = pathSegments.join('/') || '/';
    return basePath === '/' ? '/*' : `${basePath}/*`;
  });

  // If any path is /*, just return that (covers everything)
  if (paths.includes('/*')) {
    return ['/*'];
  }

  // Dedupe paths
  return [...new Set(paths)];
}
