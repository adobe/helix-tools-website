/**
 * Classifies a caught error into an HTTP-like status code used to drive
 * error display in the site-query tool.
 *
 * The mapping rules mirror the catch block in the form submit handler:
 *   - err.status === 401, or message starts with "Unauthorized" → 401
 *   - message starts with "Failed on initial fetch"            → 499
 *   - message starts with "Not found"                          → 404
 *   - anything else                                            → 500
 *
 * @param {Error} err
 * @returns {number}
 */
export function getErrorCode(err) {
  if (err.status === 401 || (err.message && err.message.startsWith('Unauthorized'))) return 401;
  if (err.message && err.message.startsWith('Failed on initial fetch')) return 499;
  if (err.message && err.message.startsWith('Not found')) return 404;
  return 500;
}

/**
 * Returns the title and HTML message string for a given error code.
 * This is the pure data layer of `updateTableError` — it does not touch
 * the DOM or call `ensureLogin`.
 *
 * @param {number} errCode
 * @param {string} org
 * @param {string} site
 * @returns {{ title: string, msg: string }}
 */
export function getErrorMessage(errCode, org, site) {
  switch (errCode) {
    case 401:
      return {
        title: '401 Unauthorized Error',
        msg: `Unable to display results. <a target="_blank" href="https://main--${site}--${org}.aem.page">Sign in to the ${site} project sidekick</a> to view the results.`,
      };
    case 404:
      return {
        title: '404 Not Found Error',
        msg: 'Unable to display results. Ensure your sitemap/index path is correct.',
      };
    case 499:
      return {
        title: 'Initial Fetch Failed',
        msg: 'This is likely due to CORS. Either use a CORS allow plugin or add a header <code>Access-Control-Allow-Origin: https://tools.aem.live</code> in your site config.',
      };
    default:
      return {
        title: 'Error',
        msg: 'Unable to display results. Please check the console for more information.',
      };
  }
}
