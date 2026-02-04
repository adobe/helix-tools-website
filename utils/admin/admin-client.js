/**
 * Admin API Client
 * Base fetch utilities and path builders for AEM Admin API.
 */

export const ADMIN_API_BASE = 'https://admin.hlx.page';

/**
 * @typedef {Object} AdminClientOptions
 * @property {Function} [logFn] - Logging callback (status, details)
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 */

/**
 * Path builders for common Admin API endpoints.
 */
export const paths = {
  // Organization config
  config: (org) => `/config/${org}`,

  // Sites listing
  sites: (org) => `/config/${org}/sites`,
  sitesJson: (org) => `/config/${org}/sites.json`,

  // Individual site config
  site: (org, site) => `/config/${org}/sites/${site}.json`,

  // Site secrets
  secrets: (org, site) => `/config/${org}/sites/${site}/secrets.json`,
  secret: (org, site, secretId) => `/config/${org}/sites/${site}/secrets/${encodeURIComponent(secretId)}.json`,

  // Site API keys
  apiKeys: (org, site) => `/config/${org}/sites/${site}/apiKeys.json`,
  apiKey: (org, site, keyId) => `/config/${org}/sites/${site}/apiKeys/${encodeURIComponent(keyId)}.json`,

  // Status endpoints
  status: (org, site, ref, path) => `/status/${org}/${site}/${ref}${path}`,

  // Preview/publish operations
  preview: (org, site, ref, path) => `/preview/${org}/${site}/${ref}${path}`,
  live: (org, site, ref, path) => `/live/${org}/${site}/${ref}${path}`,
  code: (org, site, ref, path) => `/code/${org}/${site}/${ref}${path}`,

  // Index operations
  index: (org, site, ref) => `/index/${org}/${site}/${ref}`,

  // Cache operations
  cache: (org, site, ref, path) => `/cache/${org}/${site}/${ref}${path}`,

  // PSI scores
  psi: (org, site, ref, url) => `/psi/${org}/${site}/${ref}?url=${encodeURIComponent(url)}`,

  // Job operations
  job: (org, site, ref, topic, name) => `/job/${org}/${site}/${ref}/${topic}/${name}`,
  jobDetails: (org, site, ref, topic, name, id) => `/job/${org}/${site}/${ref}/${topic}/${name}/${id}`,

  // Log operations
  log: (org, site, ref) => `/log/${org}/${site}/${ref}`,
};

/**
 * Base admin API fetch with standardized error handling and logging.
 * @param {string} path - API path (appended to ADMIN_API_BASE)
 * @param {RequestInit} [options] - Fetch options
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Response>}
 */
export async function adminFetch(path, options = {}, clientOptions = {}) {
  const { logFn, signal } = clientOptions;
  const url = `${ADMIN_API_BASE}${path}`;
  const method = options.method || 'GET';

  const fetchOptions = { ...options };
  if (signal) {
    fetchOptions.signal = signal;
  }

  const resp = await fetch(url, fetchOptions);

  if (logFn) {
    logFn(resp.status, [method, url, resp.headers.get('x-error') || '']);
  }

  return resp;
}

/**
 * Admin API fetch that returns JSON on success.
 * @param {string} path - API path
 * @param {RequestInit} [options] - Fetch options
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<{data: any, status: number}|{error: string, status: number}>}
 */
export async function adminFetchJson(path, options = {}, clientOptions = {}) {
  const resp = await adminFetch(path, options, clientOptions);
  if (resp.ok) {
    const data = await resp.json();
    return { data, status: resp.status };
  }
  const error = resp.headers.get('x-error') || resp.statusText;
  return { error, status: resp.status };
}

/**
 * Fetch list of sites for an organization.
 * @param {string} org - Organization name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<{sites: string[]|null, status: number}>}
 */
export async function fetchSites(org, clientOptions = {}) {
  const result = await adminFetchJson(paths.sitesJson(org), {}, clientOptions);
  if (result.data) {
    return { sites: result.data.sites || [], status: result.status };
  }
  return { sites: null, status: result.status };
}

/**
 * Fetch site configuration.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Object|null>}
 */
export async function fetchSiteConfig(org, site, clientOptions = {}) {
  const result = await adminFetchJson(paths.site(org, site), {}, clientOptions);
  return result.data || null;
}

/**
 * Update site configuration.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {Object} config - Configuration to save
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<boolean>}
 */
export async function updateSiteConfig(org, site, config, clientOptions = {}) {
  const resp = await adminFetch(paths.site(org, site), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  }, clientOptions);
  return resp.ok;
}

/**
 * Delete site configuration.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<boolean>}
 */
export async function deleteSiteConfig(org, site, clientOptions = {}) {
  const resp = await adminFetch(paths.site(org, site), { method: 'DELETE' }, clientOptions);
  return resp.ok;
}

/**
 * Fetch site status for a specific path.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} ref - Git reference (branch)
 * @param {string} path - Content path
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Object|null>}
 */
export async function fetchStatus(org, site, ref, path, clientOptions = {}) {
  const result = await adminFetchJson(paths.status(org, site, ref, path), {}, clientOptions);
  return result.data || null;
}

/**
 * Preview a content path.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} ref - Git reference (branch)
 * @param {string} path - Content path
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<{success: boolean, status: number}>}
 */
export async function previewPath(org, site, ref, path, clientOptions = {}) {
  const resp = await adminFetch(paths.preview(org, site, ref, path), { method: 'POST' }, clientOptions);
  return { success: resp.ok, status: resp.status };
}

/**
 * Publish a content path to live.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} ref - Git reference (branch)
 * @param {string} path - Content path
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<{success: boolean, status: number}>}
 */
export async function publishPath(org, site, ref, path, clientOptions = {}) {
  const resp = await adminFetch(paths.live(org, site, ref, path), { method: 'POST' }, clientOptions);
  return { success: resp.ok, status: resp.status };
}

/**
 * Unpublish a content path from live.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} ref - Git reference (branch)
 * @param {string} path - Content path
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<{success: boolean, status: number}>}
 */
export async function unpublishPath(org, site, ref, path, clientOptions = {}) {
  const resp = await adminFetch(paths.live(org, site, ref, path), { method: 'DELETE' }, clientOptions);
  return { success: resp.ok, status: resp.status };
}

/**
 * Purge cache for a content path.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} ref - Git reference (branch)
 * @param {string} path - Content path
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<{success: boolean, status: number}>}
 */
export async function purgeCache(org, site, ref, path, clientOptions = {}) {
  const resp = await adminFetch(paths.cache(org, site, ref, path), { method: 'POST' }, clientOptions);
  return { success: resp.ok, status: resp.status };
}

/**
 * Fetch PSI scores for a site.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} [ref='main'] - Git reference
 * @returns {Promise<{performance: number, accessibility: number, bestPractices: number}|null>}
 */
export async function fetchPsiScores(org, site, ref = 'main') {
  const liveUrl = `https://${ref}--${site}--${org}.aem.live/`;
  const resp = await fetch(`${ADMIN_API_BASE}${paths.psi(org, site, ref, liveUrl)}`);
  if (!resp.ok) return null;

  const data = await resp.json();
  const categories = data.lighthouseResult?.categories || {};
  return {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    timestamp: Date.now(),
  };
}

/**
 * Fetch secrets for a site.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Array|null>}
 */
export async function fetchSecrets(org, site, clientOptions = {}) {
  const result = await adminFetchJson(paths.secrets(org, site), {}, clientOptions);
  if (result.data) {
    return Object.values(result.data);
  }
  if (result.status === 404) return [];
  return null;
}

/**
 * Create a new secret for a site.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Object|null>}
 */
export async function createSecret(org, site, clientOptions = {}) {
  const result = await adminFetchJson(paths.secrets(org, site), { method: 'POST' }, clientOptions);
  return result.data || null;
}

/**
 * Delete a secret.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} secretId - Secret ID
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<boolean>}
 */
export async function deleteSecret(org, site, secretId, clientOptions = {}) {
  const resp = await adminFetch(paths.secret(org, site, secretId), { method: 'DELETE' }, clientOptions);
  return resp.ok;
}

/**
 * Fetch API keys for a site.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Array|null>}
 */
export async function fetchApiKeys(org, site, clientOptions = {}) {
  const result = await adminFetchJson(paths.apiKeys(org, site), {}, clientOptions);
  if (result.data) {
    return Object.entries(result.data).map(([id, val]) => ({ id, ...val }));
  }
  if (result.status === 404) return [];
  return null;
}

/**
 * Create a new API key for a site.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<Object|null>}
 */
export async function createApiKey(org, site, clientOptions = {}) {
  const result = await adminFetchJson(paths.apiKeys(org, site), { method: 'POST' }, clientOptions);
  return result.data || null;
}

/**
 * Delete an API key.
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} keyId - API key ID
 * @param {AdminClientOptions} [clientOptions] - Client options
 * @returns {Promise<boolean>}
 */
export async function deleteApiKey(org, site, keyId, clientOptions = {}) {
  const resp = await adminFetch(paths.apiKey(org, site, keyId), { method: 'DELETE' }, clientOptions);
  return resp.ok;
}
