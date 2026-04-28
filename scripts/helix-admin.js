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
 * Resources are bound to coords and return `Promise<AdminResponse>`. Single-
 * purpose resources are arity-overloaded callables (no arg → GET, arg → POST);
 * multi-operation resources are objects with named methods. Both flavors
 * expose a `.url` for test assertions.
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
   * Bind a config-API context to an org (and optionally a site). Site-scoped
   * resources are absent on an org-only context — calling them throws a
   * TypeError, by design.
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
    function robots(body) {
      return body === undefined
        ? request({ method: 'GET', url: robotsUrl })
        : request({
          method: 'POST', url: robotsUrl, body, contentType: 'text/plain',
        });
    }
    robots.url = robotsUrl;

    const headersUrl = `${siteUrl}/headers.json`;
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
   * Bind a status-API context.
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
   * Bind a job-API context. Methods take `topic` since Helix groups jobs by
   * topic (`status`, `publish`, etc.).
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

  // preview and live share a surface — only the URL prefix differs.
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
   * Bind a preview-bus context.
   *
   * @param {{org: string, site: string, ref?: string}} coords ref defaults to 'main'
   */
  const preview = contentBusFactory('preview');

  /**
   * Bind a live-bus context.
   *
   * @param {{org: string, site: string, ref?: string}} coords ref defaults to 'main'
   */
  const live = contentBusFactory('live');

  /**
   * Derive a client whose init defaults are merged with `extra` (later wins).
   * The original client is unaffected; chainable.
   *
   * @param {RequestInit} extra
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
