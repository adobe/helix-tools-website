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
    method, url, body, contentType, params,
  }) {
    let finalUrl = url;
    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => qs.set(k, v));
      finalUrl = `${url}${url.includes('?') ? '&' : '?'}${qs.toString()}`;
    }
    const init = { method, ...defaults };
    if (body !== undefined && body !== null) {
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
    const resp = await fetch(finalUrl, init);
    return {
      ok: resp.ok,
      status: resp.status,
      text: () => resp.text(),
      json: () => resp.json(),
      error: resp.headers.get('x-error') || '',
      request: { method, url: finalUrl },
    };
  }

  /**
   * Bind a config-API node to a URL. Recursive: `.select(subpath)` returns
   * the same shape, descending the path. `.read()`, `.update(body)`,
   * `.create(body)`, `.remove()` operate on the bound URL.
   *
   * Body must be a string. `undefined` or `null` mean "no body" (POST/PUT
   * is sent without one and content-type derivation is skipped) — used for
   * action-style writes carrying state via `opts.params`. Empty string `''`
   * is a valid body and still triggers content-type derivation.
   *
   * Content-type for write ops with a body is derived from the URL's leaf
   * extension; an extensionless leaf throws on write-with-body but reads
   * and deletes fine. Reads and deletes also accept `opts`.
   *
   * `opts.params` is `Record<string, string|number>` and is appended as a
   * query string via `URLSearchParams` (handles encoding).
   *
   * `.select` strips the leaf extension before descending — the AEM admin
   * convention is that a config file (e.g. `cdn.json`) and the directory of
   * subconfigs at the same name (`cdn/`) are two views of the same node.
   * So `select('cdn.json').select('prod.json')` resolves to `cdn/prod.json`.
   *
   * @param {string} url
   */
  function bindConfig(url) {
    const write = (method, body, opts) => {
      const init = { method, url, params: opts?.params };
      if (body !== undefined && body !== null) {
        init.body = body;
        init.contentType = deriveContentType(url);
      }
      return request(init);
    };
    return {
      select(subpath) {
        // Treat current node as a directory — strip its file-view extension.
        const dirUrl = url.replace(/\.[^./]+$/, '');
        const clean = String(subpath).replace(/^\/+|\/+$/g, '');
        return bindConfig(`${dirUrl}/${clean}`);
      },
      read: (opts) => request({ method: 'GET', url, params: opts?.params }),
      update: (body, opts) => write('POST', body, opts),
      create: (body, opts) => write('PUT', body, opts),
      remove: (opts) => request({ method: 'DELETE', url, params: opts?.params }),
    };
  }

  /**
   * Bind a config-API context. Coords accept org-only, `{org, site}`, or
   * `{org, profile}` — site and profile are mutually exclusive (throws).
   * Returns a recursive node — `.select(...)` to descend, `.read/update/
   * create/remove` to operate on the bound URL.
   *
   * @param {{org: string, site?: string, profile?: string}} coords
   */
  function config({ org, site, profile }) {
    if (site && profile) {
      throw new Error('helix-admin: config coords cannot include both site and profile');
    }
    let base = `${ADMIN_BASE}/config/${org}`;
    if (site) base += `/sites/${site}`;
    else if (profile) base += `/profiles/${profile}`;
    return bindConfig(`${base}.json`);
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
