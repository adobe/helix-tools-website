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
 * multi-operation resources are objects with named methods.
 *
 * @param {RequestInit} [defaults] merged into every request's init
 */
function createAdmin(defaults = {}) {
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
    if (!site) {
      return {};
    }

    const siteUrl = `${ADMIN_BASE}/config/${org}/sites/${site}`;

    const robotsUrl = `${siteUrl}/robots.txt`;
    function robots(body) {
      return body === undefined
        ? request({ method: 'GET', url: robotsUrl })
        : request({
          method: 'POST', url: robotsUrl, body, contentType: 'text/plain',
        });
    }

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
    headers.remove = () => request({ method: 'DELETE', url: headersUrl });

    const indexConfigUrl = `${siteUrl}/content/query.yaml`;
    function indexConfig(body) {
      return body === undefined
        ? request({ method: 'GET', url: indexConfigUrl })
        : request({
          method: 'POST', url: indexConfigUrl, body, contentType: 'text/yaml',
        });
    }

    return {
      robots,
      headers,
      index: indexConfig,
    };
  }

  function index({ org, site }) {
    const url = `${ADMIN_BASE}/index/${org}/${site}/main/*`;
    return {
      bulk: (payload) => request({
        method: 'POST', url, body: JSON.stringify(payload), contentType: 'application/json',
      }),
    };
  }

  function job({ org, site }) {
    const base = `${ADMIN_BASE}/job/${org}/${site}/main`;
    return {
      list: (topic) => request({ method: 'GET', url: `${base}/${topic}` }),
      get: (topic, name) => request({ method: 'GET', url: `${base}/${topic}/${name}` }),
      details: (topic, name) => request({ method: 'GET', url: `${base}/${topic}/${name}/details` }),
      stop: (topic, name) => request({ method: 'DELETE', url: `${base}/${topic}/${name}` }),
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

  return {
    config, index, job, withRequestInit,
  };
}

const admin = createAdmin();

export default admin;
