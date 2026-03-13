/**
 * URL parameter utilities
 */

let perfEnabledCached = null;
let perfLoggedOnce = false;

/**
 * Check if performance logging is enabled via ?debug=perf URL parameter
 */
export function isPerfEnabled() {
  if (typeof window === 'undefined') return false;

  // Cache the result since URL params don't change during page lifetime
  if (perfEnabledCached !== null) {
    return perfEnabledCached;
  }

  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug');
  const enabled = debug === 'perf' || debug === 'true' || debug === '1';
  perfEnabledCached = enabled;

  // Log once for debugging
  if (enabled && !perfLoggedOnce) {
    console.log('[Media Library] Performance logging enabled via ?debug=' + debug);
    perfLoggedOnce = true;
  }

  return enabled;
}
