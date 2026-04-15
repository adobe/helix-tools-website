export const ADMIN_API_BASE = 'https://admin.hlx.page';

/**
 * Base fetch for all Admin API calls.
 * @param {string} path - API path appended to ADMIN_API_BASE
 * @param {RequestInit} [options] - Fetch options
 * @param {Function} [logFn] - Optional logging: logFn(status, [method, url, xError])
 * @returns {Promise<Response>}
 */
export async function adminFetch(path, options = {}, logFn = null) {
  const url = `${ADMIN_API_BASE}${path}`;
  const method = options.method || 'GET';
  const resp = await fetch(url, options);
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

// Returns a CRUD request object bound to a path.
// create and update both POST for now; create will use PUT once we need true create semantics.
function makeReq(path, logFn) {
  const go = (opts) => adminFetch(path, opts, logFn);
  return {
    read: () => go({}),
    create: (body) => go(writeOpts('POST', body)),
    update: (body) => go(writeOpts('POST', body)),
    delete: () => go({ method: 'DELETE' }),
  };
}

/**
 * Creates an Admin API client bound to an org/site context.
 *
 * The client covers the /config/ namespace only. For other routes
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
 * // Org-scoped config
 * const resp = await admin.org.read();
 * const resp = await admin.org.sites().read();
 * const resp = await admin.org.users('user@example.com').delete();
 *
 * // Site-scoped config (uses site from context)
 * const resp = await admin.site().read();
 * const resp = await admin.site().secrets().create();
 * const resp = await admin.site().secrets('my-secret').delete();
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
      ...makeReq(`${base}.json`, logFn),
      access: () => makeReq(`${base}/access.json`, logFn),
      cdn: () => makeReq(`${base}/cdn.json`, logFn),
      code: () => makeReq(`${base}/code.json`, logFn),
      content: (filename) => makeReq(`${base}/content/${filename}`, logFn),
      headers: () => makeReq(`${base}/headers.json`, logFn),
      robots: () => makeReq(`${base}/robots.txt`, logFn),
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
     * Org-scoped config: /config/{org}/...
     * .read/update/delete() act on /config/{org}.json
     */
    org: {
      ...makeReq(`${configBase}.json`, logFn),
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
    },

    /**
     * Site-scoped config: /config/{org}/sites/{site}/...
     * Defaults to the site passed to createAdminClient; pass a name to override.
     * .read/create/update/delete() act on /config/{org}/sites/{site}.json
     */
    site: (siteName = defaultSite) => siteReq(siteName),
  };
}
