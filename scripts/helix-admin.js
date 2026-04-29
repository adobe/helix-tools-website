const ADMIN_BASE = 'https://admin.hlx.page';

const CONTENT_TYPES = {
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  txt: 'text/plain',
  html: 'text/html',
};

function leafExtension(url) {
  return url.match(/\.([^./]+)$/)?.[1];
}

function deriveContentType(url) {
  const ext = leafExtension(url);
  const ct = ext && CONTENT_TYPES[ext];
  if (!ct) {
    throw new Error(`helix-admin: cannot derive content-type for "${url}"`);
  }
  return ct;
}

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
   * Bind a config-API node to a URL. Recursive: `.select(subpath)` returns
   * the same shape, descending the path. `.read()`, `.update(body)`,
   * `.create(body)`, `.remove()` operate on the bound URL.
   *
   * Body must be a string. Content-type for write ops is derived from the
   * URL's leaf extension; an extensionless leaf throws on write but reads
   * and deletes fine.
   *
   * `.select` strips the leaf extension before descending — the AEM admin
   * convention is that a config file (e.g. `cdn.json`) and the directory of
   * subconfigs at the same name (`cdn/`) are two views of the same node.
   * So `select('cdn.json').select('prod.json')` resolves to `cdn/prod.json`.
   *
   * @param {string} url
   */
  function bindConfig(url) {
    return {
      select(subpath) {
        // Treat current node as a directory — strip its file-view extension.
        const dirUrl = url.replace(/\.[^./]+$/, '');
        const clean = String(subpath).replace(/^\/+|\/+$/g, '');
        return bindConfig(`${dirUrl}/${clean}`);
      },
      read: () => request({ method: 'GET', url }),
      update: (body) => request({
        method: 'POST', url, body, contentType: deriveContentType(url),
      }),
      create: (body) => request({
        method: 'PUT', url, body, contentType: deriveContentType(url),
      }),
      remove: () => request({ method: 'DELETE', url }),
    };
  }

  /**
   * Bind a config-API context to an org (and optionally a site). Returns a
   * recursive node — `.select(...)` to descend, `.read/update/create/remove`
   * to operate on the bound URL.
   *
   * @param {{org: string, site?: string}} coords
   */
  function config({ org, site }) {
    const base = site
      ? `${ADMIN_BASE}/config/${org}/sites/${site}.json`
      : `${ADMIN_BASE}/config/${org}.json`;
    return bindConfig(base);
  }

  function index({ org, site }) {
    const url = `${ADMIN_BASE}/index/${org}/${site}/main/*`;
    return {
      bulk: (payload) => request({
        method: 'POST', url, body: JSON.stringify(payload), contentType: 'application/json',
      }),
    };
  }

  function sitemap({ org, site }) {
    const base = `${ADMIN_BASE}/sitemap/${org}/${site}/main`;
    return {
      generate: (p) => request({ method: 'POST', url: `${base}${p}` }),
    };
  }

  function job({ org, site }) {
    const base = `${ADMIN_BASE}/job/${org}/${site}/main`;
    return {
      list: (topic) => request({ method: 'GET', url: `${base}/${topic}` }),
      status: (topic, name) => request({ method: 'GET', url: `${base}/${topic}/${name}` }),
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
    config, index, sitemap, job, withRequestInit,
  };
}

const admin = createAdmin();

export default admin;
