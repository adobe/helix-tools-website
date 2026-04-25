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
   * Does not throw on non-2xx — `ok`/`status` carry the outcome and `error`
   * carries the `x-error` response header. `text()` and `json()` are
   * pass-throughs to the underlying single-use Response.
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
   * Bind a status-API context to a site/ref.
   *
   * The returned object exposes `url` (the URL prefix) and operations:
   *   - `get(path?)` — GET `/status/{org}/{site}/{ref}{path}`. Without a path,
   *     returns site-level metadata (live/preview hosts, etc).
   *   - `bulk({paths, select})` — POST `/status/{org}/{site}/{ref}/*` to kick
   *     off a bulk-status job. The response includes the new job's `name`;
   *     pass it to `admin.job(...).get('status', name)`.
   *
   * @param {{org: string, site: string, ref?: string}} coords ref defaults to 'main'
   */
  function status({ org, site, ref = 'main' }) {
    const baseUrl = `${ADMIN_BASE}/status/${org}/${site}/${ref}`;
    const bulkUrl = `${baseUrl}/*`;

    const get = (path) => request({
      method: 'GET',
      url: path === undefined ? baseUrl : `${baseUrl}${path}`,
    });

    const bulk = ({ paths, select }) => request({
      method: 'POST',
      url: bulkUrl,
      body: JSON.stringify({ paths, select }),
      contentType: 'application/json',
    });
    bulk.url = bulkUrl;

    return { url: baseUrl, get, bulk };
  }

  /**
   * Bind a job-API context to a site/ref. Helix groups jobs under topics
   * (`status`, `publish`, etc.); methods take `topic` so they're not locked to
   * any one topic.
   *
   *   - `list(topic)`         — GET    `/job/{org}/{site}/{ref}/{topic}`
   *   - `get(topic, name)`    — GET    `/job/{org}/{site}/{ref}/{topic}/{name}`
   *   - `details(topic, name)`— GET    `/job/{org}/{site}/{ref}/{topic}/{name}/details`
   *   - `stop(topic, name)`   — DELETE `/job/{org}/{site}/{ref}/{topic}/{name}`
   *
   * @param {{org: string, site: string, ref?: string}} coords ref defaults to 'main'
   */
  function job({ org, site, ref = 'main' }) {
    const baseUrl = `${ADMIN_BASE}/job/${org}/${site}/${ref}`;
    return {
      url: baseUrl,
      list: (topic) => request({ method: 'GET', url: `${baseUrl}/${topic}` }),
      get: (topic, name) => request({ method: 'GET', url: `${baseUrl}/${topic}/${name}` }),
      details: (topic, name) => request({ method: 'GET', url: `${baseUrl}/${topic}/${name}/details` }),
      stop: (topic, name) => request({ method: 'DELETE', url: `${baseUrl}/${topic}/${name}` }),
    };
  }

  /**
   * Build a content-bus namespace (preview or live). Both bus types share the
   * same surface — the only difference is the URL prefix.
   *
   * @param {string} opName  "preview" or "live"
   */
  function contentBusFactory(opName) {
    return ({ org, site, ref = 'main' }) => {
      const baseUrl = `${ADMIN_BASE}/${opName}/${org}/${site}/${ref}`;
      const bulkUrl = `${baseUrl}/*`;

      const get = (path) => request({ method: 'GET', url: `${baseUrl}${path}` });
      const update = (path) => request({ method: 'POST', url: `${baseUrl}${path}` });
      const remove = (path) => request({ method: 'DELETE', url: `${baseUrl}${path}` });

      const bulk = (body) => request({
        method: 'POST',
        url: bulkUrl,
        body: JSON.stringify(body),
        contentType: 'application/json',
      });
      bulk.url = bulkUrl;

      return {
        url: baseUrl, get, update, remove, bulk,
      };
    };
  }

  /**
   * Bind a preview-bus context. Methods take a path that starts with `/`.
   *   - `get(path)`     — GET    `/preview/{org}/{site}/{ref}{path}`  (preview status / content)
   *   - `update(path)`  — POST   `/preview/{org}/{site}/{ref}{path}`  (refresh preview from source)
   *   - `remove(path)`  — DELETE `/preview/{org}/{site}/{ref}{path}`  (unpublish from preview)
   *   - `bulk(body)`    — POST   `/preview/{org}/{site}/{ref}/*` with `JSON.stringify(body)`
   *     (e.g. `{paths}` to bulk-publish, `{paths, delete: true}` to bulk-unpublish)
   *
   * @param {{org: string, site: string, ref?: string}} coords ref defaults to 'main'
   */
  const preview = contentBusFactory('preview');

  /**
   * Bind a live-bus context. Methods take a path that starts with `/`.
   *   - `get(path)`     — GET    `/live/{org}/{site}/{ref}{path}`  (live status / content)
   *   - `update(path)`  — POST   `/live/{org}/{site}/{ref}{path}`  (publish from preview to live)
   *   - `remove(path)`  — DELETE `/live/{org}/{site}/{ref}{path}`  (unpublish from live)
   *   - `bulk(body)`    — POST   `/live/{org}/{site}/{ref}/*` with `JSON.stringify(body)`
   *     (e.g. `{paths}` to bulk-publish, `{paths, delete: true}` to bulk-unpublish)
   *
   * @param {{org: string, site: string, ref?: string}} coords ref defaults to 'main'
   */
  const live = contentBusFactory('live');

  /**
   * Derive an admin client whose request init defaults are merged with `extra`
   * (later wins). Use for tools whose calls need non-default fetch options:
   *
   *   const admin2 = admin.withRequestInit({ credentials: 'include' });
   *   await admin2.config({ org, site }).headers();
   *
   * Calls made through the original `admin` are unaffected. Compose by chaining.
   *
   * @param {RequestInit} extra  init fields to merge over current defaults
   */
  function withRequestInit(extra) {
    return createAdmin({ ...defaults, ...extra });
  }

  return {
    config, status, job, preview, live, withRequestInit,
  };
}

const admin = createAdmin();

export default admin;
