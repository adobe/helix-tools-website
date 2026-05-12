const ADMIN_BASE = 'https://api.aem.live';

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
    throw new Error(`aem-admin: cannot derive content-type for "${url}"`);
  }
  return ct;
}

/**
 * Normalized response envelope returned by every admin API call.
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
 * Parse org and site coords from an H6 admin API URL.
 * /{org}/sites/{site}/... → {org, site}; all other paths → {org, site: null}.
 *
 * @param {string} url - Full H6 admin URL
 * @returns {{org: string|null, site: string|null}}
 */
function coordsFromURL(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const org = parts[0] ?? null;
    if (!org) return { org: null, site: null };
    if (parts[1] === 'sites' && parts[2]) {
      return { org, site: parts[2].replace(/\.json$/, '') };
    }
    return { org, site: null };
  } catch {
    return { org: null, site: null };
  }
}

/**
 * Create the admin client with optional default request init values.
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
        const clean = String(subpath).replace(/^\/+|\/+$/g, '');
        const dirUrl = url.replace(/\.[^./]+$/, '');
        return bindConfig(`${dirUrl}/${clean}`);
      },
      read: (opts) => request({ method: 'GET', url, params: opts?.params }),
      update: (body, opts) => write('POST', body, opts),
      create: (body, opts) => write('PUT', body, opts),
      remove: (opts) => request({ method: 'DELETE', url, params: opts?.params }),
    };
  }

  /**
   * H6 config URL pattern:
   *   org:     /{org}/config.json
   *   site:    /{org}/sites/{site}/config.json
   *   profile: /{org}/profiles/{profile}/config.json
   *
   * @param {{org: string, site?: string, profile?: string}} coords
   */
  function config({ org, site, profile }) {
    if (site && profile) {
      throw new Error('aem-admin: config coords cannot include both site and profile');
    }
    let base;
    if (site) base = `${ADMIN_BASE}/${org}/sites/${site}/config.json`;
    else if (profile) base = `${ADMIN_BASE}/${org}/profiles/${profile}/config.json`;
    else base = `${ADMIN_BASE}/${org}/config.json`;
    return bindConfig(base);
  }

  // H6 URL pattern: /{org}/sites/{site}/{op} — ref segment is gone
  function opBase(op, { org, site }) {
    return `${ADMIN_BASE}/${org}/sites/${site}/${op}`;
  }

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
    return Object.fromEntries(caps.map((c) => [c, all[c]]));
  }

  function status(coords) { return bindOperation(opBase('status', coords), ['get', 'update']); }
  function preview(coords) { return bindOperation(opBase('preview', coords), ['get', 'update', 'remove']); }
  function live(coords) { return bindOperation(opBase('live', coords), ['get', 'update', 'remove']); }
  function code(coords) { return bindOperation(opBase('code', coords), ['get', 'update', 'remove']); }
  function log(coords) { return bindOperation(opBase('log', coords), ['get', 'update']); }
  function index(coords) { return bindOperation(opBase('index', coords), ['get', 'update', 'remove']); }
  function sitemap(coords) { return bindOperation(opBase('sitemap', coords), ['update']); }
  function job(coords) { return bindOperation(opBase('job', coords), ['get', 'remove']); }

  /**
   * Return well-known admin URL suggestions for the given coords, suitable
   * for populating a datalist. Callers receive H6 URLs so no URL knowledge
   * is needed in the tool itself.
   *
   * @param {{org: string, site?: string}} coords
   * @returns {Array<{url: string, label: string}>}
   */
  function suggestions({ org, site }) {
    if (site) {
      return [
        { url: opBase('status', { org, site }), label: 'Status' },
        { url: opBase('preview', { org, site }), label: 'Preview' },
        { url: opBase('live', { org, site }), label: 'Live' },
        { url: `${ADMIN_BASE}/${org}/sites/${site}/config.json`, label: 'Site Config' },
        { url: `${ADMIN_BASE}/${org}/config.json`, label: 'Org Config' },
        { url: `${ADMIN_BASE}/${org}/profiles.json`, label: 'Profiles' },
        { url: `${ADMIN_BASE}/${org}/sites.json`, label: 'Sites' },
      ];
    }
    return [
      { url: `${ADMIN_BASE}/${org}/config.json`, label: 'Org Config' },
      { url: `${ADMIN_BASE}/${org}/profiles.json`, label: 'Profiles' },
      { url: `${ADMIN_BASE}/${org}/sites.json`, label: 'Sites' },
    ];
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

  function withRequestInit(extra) {
    return createAdmin({ ...defaults, ...extra });
  }

  return {
    isH6: true,
    config,
    status,
    preview,
    live,
    code,
    log,
    index,
    sitemap,
    job,
    raw,
    suggestions,
    coordsFromURL,
    withRequestInit,
  };
}

const admin = createAdmin();

export default admin;
