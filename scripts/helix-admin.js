const ADMIN_BASE = 'https://admin.hlx.page';

/**
 * Normalized response envelope returned by every admin API call.
 *
 * Methods do not throw on non-2xx — `ok`/`status` carry the outcome and
 * `error` carries the `x-error` response header. `text()` and `json()` are
 * thin pass-throughs to the underlying Response, which is single-use; call
 * one of them, not both, and only once.
 *
 * Tools can reference this typedef from other modules:
 *   import('./helix-admin.js').AdminResponse
 *
 * @typedef {object} AdminResponse
 * @property {boolean} ok                              `resp.ok`
 * @property {number} status                           HTTP status code
 * @property {() => Promise<string>} text              read response body as text
 * @property {() => Promise<any>} json                 read response body as JSON
 * @property {string} error                            `x-error` response header, '' if absent
 * @property {{method: string, url: string}} request   method+url echo for logging
 */

/**
 * Issue an admin API request and return a normalized envelope.
 *
 * Resource methods on the exported `admin` object are thin wrappers around
 * this; tools shouldn't call it directly.
 *
 * @param {object} args
 * @param {string} args.method            HTTP method
 * @param {string} args.url               fully-qualified admin API URL
 * @param {string|FormData} [args.body]   request body, omit for GET
 * @param {string} [args.contentType]     value for the content-type header
 * @returns {Promise<AdminResponse>}
 */
async function request({
  method, url, body, contentType,
}) {
  const init = { method };
  if (body !== undefined) {
    init.body = body;
    if (contentType) init.headers = { 'content-type': contentType };
  }
  const resp = await fetch(url, init);
  return {
    ok: resp.ok,
    status: resp.status,
    text: () => resp.text(),
    json: () => resp.json(),
    error: resp.headers.get('x-error') || '',
    request: { method, url },
  };
}

/**
 * Bind a config-API context to a site (or just an org).
 *
 * The returned object exposes `url` (the URL prefix of this context) and
 * resource methods. Site-scoped resources are only present when `site` is
 * provided — calling them on an org-only context yields a TypeError at the
 * call site, which is the intended failure mode.
 *
 * Each resource method is a callable that also exposes `.url` (the canonical
 * URL of that resource) for test assertions and debugging.
 *
 * @param {{org: string, site?: string}} coords
 */
function config({ org, site }) {
  const orgUrl = `${ADMIN_BASE}/config/${org}`;

  // Org-scoped context — site-only resources are deliberately absent.
  if (!site) {
    return { url: orgUrl };
  }

  const siteUrl = `${orgUrl}/sites/${site}`;

  const robotsUrl = `${siteUrl}/robots.txt`;
  /**
   * Get or replace the site's robots.txt.
   *
   * Also exposes a `.url` property (the canonical URL of this resource) for
   * test assertions and debugging.
   *
   * @param {string} [body] omit to GET; pass text to POST as `text/plain`
   * @returns {Promise<AdminResponse>}
   */
  function robots(body) {
    return body === undefined
      ? request({ method: 'GET', url: robotsUrl })
      : request({
        method: 'POST', url: robotsUrl, body, contentType: 'text/plain',
      });
  }
  robots.url = robotsUrl;

  return {
    url: siteUrl,
    robots,
  };
}

const admin = { config };

export default admin;
