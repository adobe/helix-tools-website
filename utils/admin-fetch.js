const ADMIN_API_BASE = 'https://admin.hlx.page';

/**
 * Creates an admin API fetch function bound to an optional response logger.
 * @param {Function} [logFn] - Optional (status, [method, url, error]) => void
 * @returns {Function} adminFetch(pathTemplate, params, options)
 *   pathTemplate: path with {org}, {site}, etc. placeholders
 *   params: object of placeholder values
 *   options: standard fetch options
 */
export default function createAdminFetch(logFn) {
  return async function adminFetch(pathTemplate, params = {}, options = {}) {
    const path = pathTemplate.replace(
      /\{(\w+)\}/g,
      (_, key) => encodeURIComponent(params[key] ?? ''),
    );
    const url = `${ADMIN_API_BASE}${path}`;
    const method = options.method || 'GET';
    const resp = await fetch(url, options);
    if (logFn) {
      logFn(resp.status, [method, url, resp.headers.get('x-error') || '']);
    }
    return resp;
  };
}
