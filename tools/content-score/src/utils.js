/**
 * Escapes HTML special characters for safe insertion into markup.
 * @param {string} str - Value to escape (nullable)
 * @returns {string} Escaped string, or empty if input is null/empty
 */
export function escapeHtml(str) {
  if (str == null || str === '') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Converts category id (hyphenated) to details property name (camelCase + "Issues").
 * @param {string} id - Category id from config (e.g. "nested-blocks")
 * @returns {string} Property name (e.g. "nestedBlocksIssues")
 */
export function categoryIdToDetailsKey(id) {
  const camel = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return `${camel}Issues`;
}

/**
 * Score display labels.
 * @returns {{ good: string, 'needs-improvement': string, poor: string }}
 */
export function getScoreLabels() {
  return { good: 'Good', 'needs-improvement': 'Needs improvement', poor: 'Poor' };
}

/**
 * Badge copy per score (message + optional action CTA).
 * @returns {Object} Map of score to { message, action? }
 */
export function getBadgeCopy() {
  return {
    poor: {
      message: 'Content issues found',
      action: 'Review errors',
    },
    'needs-improvement': {
      message: 'Content could be improved',
      action: 'Review suggestions',
    },
    good: { message: 'No content issues found' },
  };
}

/**
 * Errors/warnings summary text (e.g. "2 errors · 1 warning").
 * @param {number} errors - Error count
 * @param {number} warnings - Warning count
 * @returns {string}
 */
export function getCountText(errors, warnings) {
  const errorLabel = errors === 1 ? 'error' : 'errors';
  const warningLabel = warnings === 1 ? 'warning' : 'warnings';
  return `${errors} ${errorLabel} · ${warnings} ${warningLabel}`;
}

/**
 * Empty state text when a section has no issues.
 * @returns {string}
 */
export function getNoIssuesText() {
  return 'No issues found';
}

/**
 * Sort rank for issue outcome (error first, then warning, then info).
 * @param {string} outcome - 'error' | 'warning' | 'info' | null/undefined
 * @returns {number} 0 = error, 1 = warning, 2 = info; unknown defaults to 1
 */
export function outcomeRank(outcome) {
  return ({ error: 0, warning: 1, info: 2 }[outcome] ?? 1);
}

/**
 * Base URL for content-score assets (resolves to src/ directory).
 * @returns {string} Trailing-slash base URL
 */
export function getBase() {
  return new URL('./', import.meta.url).href;
}

/**
 * Loads the close icon SVG (cached).
 * @returns {Promise<string>} SVG markup for the close icon
 */
export async function loadCloseSvg() {
  if (!loadCloseSvg.cache) {
    const resp = await fetch(new URL('close.svg', getBase()));
    loadCloseSvg.cache = await resp.text();
  }
  return loadCloseSvg.cache;
}
