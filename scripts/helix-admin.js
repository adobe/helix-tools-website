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
 * Build an admin client with optional request-init defaults applied to every
 * call. The default export is built with no defaults — equivalent to plain
 * `fetch(url, {method, body, headers})`. Use `admin.withRequestInit(...)` to
 * derive a client with overridden defaults (e.g. `{credentials: 'include'}`
 * for cookie-bearing cross-origin calls, or `{cache: 'no-cache'}` to bypass
 * the HTTP cache on polling endpoints).
 *
 * @param {RequestInit} [defaults] merged into every request's init
 */
function createAdmin(defaults = {}) {
  /**
   * Issue an admin API request and return a normalized envelope.
   *
   * Resource methods on the returned `admin` object are thin wrappers around
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
    const init = { method, ...defaults };
    if (body !== undefined) {
      init.body = body;
      if (contentType) {
        // Normalize via Headers so a defaults.headers passed as a Headers
        // instance or [k,v] tuples is preserved — a naive object spread
        // would silently drop those entries.
        const headers = new Headers(init.headers);
        headers.set('content-type', contentType);
        init.headers = headers;
      }
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

  /**
   * Derive an admin client whose request init defaults are merged with `extra`
   * (later wins). Use for tools whose calls need non-default fetch options:
   *
   *   const admin2 = admin.withRequestInit({ credentials: 'include' });
   *   await admin2.config({ org, site }).robots();
   *
   * Calls made through the original `admin` are unaffected. Compose by chaining.
   *
   * @param {RequestInit} extra  init fields to merge over current defaults
   */
  function withRequestInit(extra) {
    return createAdmin({ ...defaults, ...extra });
  }

  return { config, withRequestInit };
}

const admin = createAdmin();

export default admin;
