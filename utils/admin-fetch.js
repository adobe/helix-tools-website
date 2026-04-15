export const ADMIN_API_BASE = 'https://admin.hlx.page';

/**
 * Base fetch for all Admin API calls.
 * @param {string} path - API path appended to ADMIN_API_BASE
 * @param {RequestInit & { params?: Record<string, string> }} [options] - Fetch options.
 *   `params` is extracted and appended as a query string; not passed to fetch().
 * @param {Function} [logFn] - Optional logging: logFn(status, [method, url, xError])
 * @returns {Promise<Response>}
 */
export async function adminFetch(path, options = {}, logFn = null) {
  const { params, ...fetchOptions } = options;
  let url = `${ADMIN_API_BASE}${path}`;
  if (params) url = `${url}?${new URLSearchParams(params)}`;
  const method = fetchOptions.method || 'GET';
  const resp = await fetch(url, fetchOptions);
  if (logFn) {
    logFn(resp.status, [method, url, resp.headers.get('x-error') || '']);
  }
  return resp;
}

function writeOpts(method, body) {
  if (body == null) return { method };
  return {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
    },
  };
}

// Collection resource (secrets, apiKeys, users, sites list): create=POST, update=POST.
function makeReq(path, logFn) {
  const go = (opts) => adminFetch(path, opts, logFn);
  return {
    url: `${ADMIN_API_BASE}${path}`,
    read: () => go({}),
    create: (body) => go(writeOpts('POST', body)),
    update: (body) => go(writeOpts('POST', body)),
    delete: () => go({ method: 'DELETE' }),
  };
}

// Singleton resource (org/site config, access, cdn, code, etc.): create=PUT, update=POST.
function makeSingletonReq(path, logFn) {
  const go = (opts) => adminFetch(path, opts, logFn);
  return {
    url: `${ADMIN_API_BASE}${path}`,
    read: () => go({}),
    create: (body) => go(writeOpts('PUT', body)),
    update: (body) => go(writeOpts('POST', body)),
    delete: () => go({ method: 'DELETE' }),
  };
}

// Versions sub-resource for a config singleton.
// resourcePath is the full path including extension (e.g. /config/{org}.json).
// versions() lists all versions; versions(id) operates on a specific version.
function makeVersionsReq(resourcePath, logFn) {
  const base = resourcePath.replace(/\.[^./]+$/, '');
  return (id) => {
    if (id !== undefined) {
      const vpath = `${base}/versions/${id}.json`;
      const gv = (opts) => adminFetch(vpath, opts, logFn);
      return {
        read: () => gv({}),
        delete: () => gv({ method: 'DELETE' }),
        rename: (name) => gv({ method: 'POST', params: { name } }),
        restore: () => adminFetch(resourcePath, { method: 'POST', params: { restoreVersion: id } }, logFn),
      };
    }
    return {
      url: `${ADMIN_API_BASE}${base}/versions.json`,
      read: () => adminFetch(`${base}/versions.json`, {}, logFn),
    };
  };
}

/**
 * Creates an Admin API client bound to an org/site context.
 *
 * The client covers the /config/ and /profile/ namespaces. For other routes
 * (preview, live, status, job, etc.) use the escape hatch: admin.fetch(path, options).
 *
 * @param {object} cfg
 * @param {string} cfg.org - Organization name
 * @param {string} [cfg.site] - Default site name (can be overridden per call)
 * @param {Function} [cfg.logFn] - Optional logging function passed to adminFetch
 * @returns {object} Admin client
 *
 * @example
 * const admin = createAdminClient({ org, site, logFn });
 *
 * // Auth profile
 * const resp = await admin.profile().read();
 *
 * // Org-scoped config
 * const resp = await admin.org.read();
 * const resp = await admin.org.sites().read();
 * const resp = await admin.org.users('user@example.com').delete();
 * const resp = await admin.org.profile('myprofile').read();
 * const resp = await admin.org.versions().read();
 * const resp = await admin.org.versions('abc123').restore();
 *
 * // Site-scoped config (uses site from context)
 * const resp = await admin.site().read();
 * const resp = await admin.site().secrets().create(body);
 * const resp = await admin.site().secrets('my-secret').delete();
 * const resp = await admin.site().versions().read();
 * const resp = await admin.site().versions('abc123').rename('new-name');
 * const resp = await admin.site().versions('abc123').restore();
 *
 * // Override site for a single call
 * const resp = await admin.site('other-site').read();
 *
 * // Escape hatch for routes not covered above
 * const resp = await admin.fetch(`/status/${org}/${site}/main`, {});
 */
export function createAdminClient({ org, site: defaultSite, logFn = null }) {
  const configBase = `/config/${org}`;

  function siteReq(siteName) {
    if (!siteName) throw new Error('createAdminClient: site name is required');
    const base = `${configBase}/sites/${siteName}`;
    return {
      ...makeSingletonReq(`${base}.json`, logFn),
      versions: makeVersionsReq(`${base}.json`, logFn),
      access: () => makeSingletonReq(`${base}/access.json`, logFn),
      cdn: () => makeSingletonReq(`${base}/cdn.json`, logFn),
      code: () => makeSingletonReq(`${base}/code.json`, logFn),
      content: (filename) => makeSingletonReq(`${base}/content/${filename}`, logFn),
      headers: () => makeSingletonReq(`${base}/headers.json`, logFn),
      robots: () => makeSingletonReq(`${base}/robots.txt`, logFn),
      secrets: (id) => makeReq(
        id !== undefined
          ? `${base}/secrets/${encodeURIComponent(id)}.json`
          : `${base}/secrets.json`,
        logFn,
      ),
      apiKeys: (id) => makeReq(
        id !== undefined
          ? `${base}/apiKeys/${encodeURIComponent(id)}.json`
          : `${base}/apiKeys.json`,
        logFn,
      ),
    };
  }

  return {
    /** Escape hatch for API routes not covered by this client. */
    fetch: (path, options = {}) => adminFetch(path, options, logFn),

    /**
     * Auth profile for org/site: GET /profile/{org}/{site}
     * Read-only; the API only supports GET on this endpoint.
     */
    profile: (siteName = defaultSite) => ({
      url: `${ADMIN_API_BASE}/profile/${org}/${siteName}`,
      read: () => adminFetch(`/profile/${org}/${siteName}`, {}, logFn),
    }),

    /**
     * Org-scoped config: /config/{org}/...
     */
    org: {
      ...makeSingletonReq(`${configBase}.json`, logFn),
      versions: makeVersionsReq(`${configBase}.json`, logFn),
      sites: () => makeReq(`${configBase}/sites.json`, logFn),
      users: (id) => makeReq(
        id !== undefined
          ? `${configBase}/users/${encodeURIComponent(id)}.json`
          : `${configBase}/users.json`,
        logFn,
      ),
      aggregated: (siteName = defaultSite) => makeReq(
        `${configBase}/aggregated/${siteName}.json`,
        logFn,
      ),
      /** Config profiles collection: /config/{org}/profiles.json */
      profiles: () => makeReq(`${configBase}/profiles.json`, logFn),
      /** Config profile: /config/{org}/profiles/{name}.json */
      profile: (name) => makeSingletonReq(`${configBase}/profiles/${name}.json`, logFn),
    },

    /**
     * Site-scoped config: /config/{org}/sites/{site}/...
     * Defaults to the site passed to createAdminClient; pass a name to override.
     */
    site: (siteName = defaultSite) => siteReq(siteName),
  };
}

/**
 * Extracts org and site from an admin API URL.
 * Handles both /config/... and other admin routes (/status/, /job/, etc.).
 * @param {string} url - Full admin API URL
 * @returns {{ org: string|null, site: string|null }}
 */
export function extractOrgSiteFromURL(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'config') {
      const org = parts[1]?.replace(/\.json$/, '') || null;
      // /config/org/sites/siteName[.json|/...]
      const site = (parts[2] === 'sites' && parts[3])
        ? parts[3].replace(/\.json$/, '') : null;
      return { org, site };
    }
    // /status/org/site/ref, /job/org/site/ref, etc.
    return { org: parts[1] || null, site: parts[2] || null };
  } catch (e) {
    return { org: null, site: null };
  }
}
