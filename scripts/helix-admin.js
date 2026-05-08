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
/**
 * Parse org and site coords from an admin API URL. Handles both config URLs
 * (`/config/{org}/sites/{site}.json`) and operation URLs
 * (`/{op}/{org}/{site}/{ref}/...`).
 *
 * @param {string} url - Full admin URL
 * @returns {{org: string|null, site: string|null}}
 */
function coordsFromURL(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'config') {
      const org = parts[1] ? parts[1].replace(/\.json$/, '') : null;
      if (!org) return { org: null, site: null };
      // parts[2] must be the literal 'sites' directory, not 'sites.json' (the list)
      const site = (parts[2] === 'sites' && parts[3])
        ? parts[3].replace(/\.json$/, '')
        : null;
      return { org, site };
    }
    // operation URL: /{op}/{org}/{site}/{ref}/...
    return { org: parts[1] ?? null, site: parts[2] ?? null };
  } catch {
    return { org: null, site: null };
  }
}

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
      url,
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

  // ref defaults to 'main'; pass null to omit the segment (Helix 6 compat).
  function opBase(op, { org, site, ref = 'main' }) {
    const refSegment = ref ? `/${ref}` : '';
    return `${ADMIN_BASE}/${op}/${org}/${site}${refSegment}`;
  }

  /**
   * Bind an operational API resource to a base URL. Returns only the methods
   * listed in `caps` — callers get `undefined` (not a 405) for unsupported ops.
   *
   * Path arguments strip a leading `/` then join with one, so `/path` and
   * `path` are equivalent. Empty string addresses the base URL itself.
   *
   * `update` body is optional (bodyless POSTs are action-style triggers).
   * When a body is provided, content-type defaults to `application/json`;
   * override via `opts.contentType`.
   *
   * @param {string} baseUrl
   * @param {Array<'get'|'update'|'remove'>} caps
   * @returns object with the requested caps as methods, plus `.url` always set to `baseUrl`
   */
  function bindOperation(baseUrl, caps) {
    function join(path = '') {
      const p = String(path).replace(/^\//, '');
      return p ? `${baseUrl}/${p}` : baseUrl;
    }
    const all = {
      get: (path, opts) => request({ method: 'GET', url: join(path), params: opts?.params }),
      update: (path, body, opts) => {
        const init = { method: 'POST', url: join(path), params: opts?.params };
        if (body !== undefined && body !== null) {
          init.body = body;
          init.contentType = opts?.contentType ?? 'application/json';
        }
        return request(init);
      },
      remove: (path, opts) => request({ method: 'DELETE', url: join(path), params: opts?.params }),
    };
    return { ...Object.fromEntries(caps.map((c) => [c, all[c]])), url: baseUrl };
  }

  /**
   * Return well-known admin URL suggestions for the given coords, suitable
   * for populating a datalist. Callers receive H5 or H6 URLs depending on
   * which client is active — no URL knowledge needed in the tool itself.
   *
   * @param {{org: string, site?: string}} coords
   * @returns {Array<{url: string, label: string}>}
   */
  function suggestions({ org, site }) {
    const result = [
      { url: `${ADMIN_BASE}/config/${org}.json`, label: 'Org Config' },
      { url: `${ADMIN_BASE}/config/${org}/profiles.json`, label: 'Profiles' },
      { url: `${ADMIN_BASE}/config/${org}/sites.json`, label: 'Sites' },
    ];
    if (site) {
      result.push(
        { url: `${ADMIN_BASE}/config/${org}/sites/${site}.json`, label: 'Site Config' },
        { url: opBase('status', { org, site }), label: 'Status' },
        { url: opBase('preview', { org, site }), label: 'Preview' },
        { url: opBase('live', { org, site }), label: 'Live' },
      );
    }
    return result;
  }

  function raw(method, urlOrPath, body, opts) {
    const url = urlOrPath.startsWith('/') ? `${ADMIN_BASE}${urlOrPath}` : urlOrPath;
    const init = { method, url, params: opts?.params };
    if (body !== undefined && body !== null) {
      init.body = body;
      init.contentType = opts?.contentType ?? 'application/json';
    }
    return request(init);
  }

  function status(coords) { return bindOperation(opBase('status', coords), ['get', 'update']); }
  function preview(coords) { return bindOperation(opBase('preview', coords), ['get', 'update', 'remove']); }
  function live(coords) { return bindOperation(opBase('live', coords), ['get', 'update', 'remove']); }
  function code(coords) { return bindOperation(opBase('code', coords), ['get', 'update', 'remove']); }
  function log(coords) { return bindOperation(opBase('log', coords), ['get', 'update']); }
  function index(coords) { return bindOperation(opBase('index', coords), ['get', 'update', 'remove']); }
  function sitemap(coords) { return bindOperation(opBase('sitemap', coords), ['update']); }
  function job(coords) { return bindOperation(opBase('job', coords), ['get', 'remove']); }
  function snapshot(coords) { return bindOperation(opBase('snapshot', coords), ['get', 'update', 'remove']); }
  function sidekick(coords) { return bindOperation(opBase('sidekick', coords), ['get']); }

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
    config,
    status,
    preview,
    live,
    code,
    log,
    index,
    sitemap,
    job,
    snapshot,
    sidekick,
    raw,
    suggestions,
    coordsFromURL,
    withRequestInit,
  };
}

const admin = createAdmin();

export default admin;
