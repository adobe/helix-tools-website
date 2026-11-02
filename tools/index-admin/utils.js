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

const OG_META_PROPERTIES = new Set(['title', 'description', 'image']);
const META_SELECTOR_PATTERN = /^meta\[(?:property|name)="[^"]*"]$/;

/** Value expression for properties extracted from a meta element. */
export const META_VALUE = 'attribute(el, "content")';

/** Configuration for the `lastModified` property, taken from the response header. */
export const LAST_MODIFIED_CONFIG = {
  select: 'none',
  value: 'parseTimestamp(headers["last-modified"], "ddd, DD MMM YYYY hh:mm:ss GMT")',
};

/**
 * Whether a selector looks like one this tool suggested, and can be replaced
 * when the property is renamed.
 * @param {string} value - Selector to check
 * @returns {boolean} True if the selector was auto-generated
 */
export function isAutoMetaSelector(value) {
  return META_SELECTOR_PATTERN.test(value.trim());
}

/**
 * Build the meta selector suggested for a property name.
 * @param {string} propName - Property name
 * @returns {string} A meta selector, or '' for an empty name
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
 * Suggest the select/value configuration for a property name. Most properties
 * come from a meta element, `lastModified` comes from the response header.
 * @param {string} propName - Property name
 * @returns {Object} Suggested `{ select, selectFirst, value }`
 */
export function suggestPropertyConfig(propName) {
  const name = propName.trim();
  if (name.toLowerCase() === 'lastmodified') {
    return { select: LAST_MODIFIED_CONFIG.select, selectFirst: '', value: LAST_MODIFIED_CONFIG.value };
  }
  return { select: '', selectFirst: metaSelectFirstForProperty(name), value: META_VALUE };
}

/**
 * Decides how a name-field rename should affect select/selectFirst/value.
 * Only replaces a field if it still holds exactly what we'd have generated
 * for the property's *previous* name — a custom value, or one that came from
 * an unrelated auto-generated pattern, is left alone.
 * @param {object} params
 * @param {string} params.oldName - name field value before the edit
 * @param {string} params.newName - name field value after the edit
 * @param {string} params.selectVal - current select field value
 * @param {string} params.selectFirstVal - current selectFirst field value
 * @param {string} params.valueVal - current value field value
 * @returns {{select?: string, selectFirst?: string, value?: string}} fields to update, if any
 */
export function deriveAutoPropertyUpdate({
  oldName, newName, selectVal, selectFirstVal, valueVal,
}) {
  const name = newName.trim();
  if (!name || name === oldName.trim()) return {};

  const suggestion = suggestPropertyConfig(name);
  const priorCandidate = metaSelectFirstForProperty(oldName);
  const wasLastModified = oldName.trim().toLowerCase() === 'lastmodified';
  const update = {};

  if (suggestion.select) {
    // header-based property: a selector would only get in the way
    if (!selectVal || selectVal === priorCandidate) update.select = suggestion.select;
    if (selectFirstVal === priorCandidate) update.selectFirst = '';
  } else if (!selectVal && !selectFirstVal) {
    update.selectFirst = suggestion.selectFirst;
  } else if (selectVal && selectVal === priorCandidate) {
    update.select = suggestion.selectFirst;
  } else if (selectFirstVal && selectFirstVal === priorCandidate) {
    update.selectFirst = suggestion.selectFirst;
  } else if (wasLastModified && selectVal === LAST_MODIFIED_CONFIG.select) {
    // no longer the header-based property
    update.select = '';
    update.selectFirst = suggestion.selectFirst;
  }

  // keep the value expression in sync as long as it is a suggested one
  const suggestedValues = [META_VALUE, LAST_MODIFIED_CONFIG.value];
  if (!valueVal || suggestedValues.includes(valueVal)) update.value = suggestion.value;

  return update;
}
