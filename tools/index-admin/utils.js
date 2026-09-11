const OG_META_PROPERTIES = new Set(['title', 'description', 'image']);

/**
 * Derives the meta selector we'd auto-generate for a given property name.
 * @param {string} propName
 * @returns {string} CSS selector, or '' if propName is blank
 */
export function metaSelectFirstForProperty(propName) {
  const name = propName.trim();
  if (!name) return '';

  const lower = name.toLowerCase();
  if (OG_META_PROPERTIES.has(lower)) {
    return `meta[property="og:${lower}"]`;
  }
  if (lower === 'date') {
    return 'meta[name="publication-date"]';
  }

  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `meta[name="${kebab}"]`;
}

/**
 * Decides how a name-field rename should affect the select/selectFirst fields.
 * Only touches a field if it still holds exactly the selector we generated
 * for the previous name — a custom value, or one that came from elsewhere, is left alone.
 * @param {object} params
 * @param {string} params.oldName - name field value before the edit
 * @param {string} params.newName - name field value after the edit
 * @param {string} params.selectVal - current select field value
 * @param {string} params.selectFirstVal - current selectFirst field value
 * @returns {{select?: string, selectFirst?: string}} fields to update, if any
 */
export function deriveAutoMetaUpdate({
  oldName, newName, selectVal, selectFirstVal,
}) {
  const name = newName.trim();
  if (!name || name === oldName.trim()) return {};

  const candidate = metaSelectFirstForProperty(name);
  const priorCandidate = metaSelectFirstForProperty(oldName);

  if (!selectVal && !selectFirstVal) {
    return { selectFirst: candidate };
  }
  if (selectVal && selectVal.trim() === priorCandidate) {
    return { select: candidate };
  }
  if (selectFirstVal && selectFirstVal.trim() === priorCandidate) {
    return { selectFirst: candidate };
  }
  return {};
}

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
