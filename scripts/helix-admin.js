const ADMIN_BASE = 'https://admin.hlx.page';

/**
 * Normalized response envelope returned by every admin API call.
 *
 * Non-2xx is carried via `ok`/`status`/`error`, never thrown. `text()` and
 * `json()` wrap the underlying Response body, which is single-use — call
 * one, not both, and only once.
 *
 * @typedef {object} AdminResponse
 * @property {boolean} ok
 * @property {number} status
 * @property {() => Promise<string>} text
 * @property {() => Promise<any>} json
 * @property {string} error                            `x-error` header, '' if absent
 * @property {{method: string, url: string}} request   echo for logging
 */

/**
 * Build an admin client. The default export has no init defaults; use
 * `admin.withRequestInit(...)` to derive one with e.g. `credentials: 'include'`
 * or `cache: 'no-cache'`.
 *
 * @param {RequestInit} [defaults] merged into every request's init
 */
function createAdmin(defaults = {}) {
  // Tools shouldn't call this directly — use the resource methods on the
  // returned `admin` object.
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
   * Bind a config-API context to an org (and optionally a site). The returned
   * object exposes `url` and resource methods; each resource method also has
   * a `.url` for test assertions. Site-scoped resources are absent on an
   * org-only context — calling them throws a TypeError, by design.
   *
   * @param {{org: string, site?: string}} coords
   */
  function config({ org, site }) {
    const orgUrl = `${ADMIN_BASE}/config/${org}`;

    if (!site) {
      return { url: orgUrl };
    }

    const siteUrl = `${orgUrl}/sites/${site}`;

    const robotsUrl = `${siteUrl}/robots.txt`;
    /**
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

    const headersUrl = `${siteUrl}/headers.json`;
    /**
     * Get or replace the site's per-path response-headers config.
     *
     * Also exposes:
     *   - `.url` — canonical URL of this resource
     *   - `.remove()` — DELETE the headers config entirely (use when callers
     *     want to clear the resource, not when they want to set it to `{}`)
     *
     * @param {object} [data] omit to GET; pass an object to POST as JSON
     * @returns {Promise<AdminResponse>}
     */
    function headers(data) {
      return data === undefined
        ? request({ method: 'GET', url: headersUrl })
        : request({
          method: 'POST',
          url: headersUrl,
          body: JSON.stringify(data),
          contentType: 'application/json',
        });
    }
    headers.url = headersUrl;
    headers.remove = () => request({ method: 'DELETE', url: headersUrl });

    return {
      url: siteUrl,
      robots,
      headers,
    };
  }

  /**
   * Derive a client whose init defaults are merged with `extra` (later wins).
   * The original client is unaffected; chainable.
   *
   * @param {RequestInit} extra
   */
  function withRequestInit(extra) {
    return createAdmin({ ...defaults, ...extra });
  }

  return { config, withRequestInit };
}

const admin = createAdmin();

export default admin;
