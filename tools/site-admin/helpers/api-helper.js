import { ADMIN_API_BASE } from './constants.js';

/**
 * Get the sites config path for an org
 * @param {string} orgValue - Organization name
 * @returns {string} Path to sites config
 */
export const getSitesPath = (orgValue) => `/config/${orgValue}/sites`;

/**
 * Get the site config path
 * @param {string} orgValue - Organization name
 * @param {string} siteName - Site name
 * @returns {string} Path to site config
 */
export const getSitePath = (orgValue, siteName) => `${getSitesPath(orgValue)}/${siteName}.json`;

/**
 * Base fetch function for Admin API calls
 * @param {string} path - API path (appended to ADMIN_API_BASE)
 * @param {object} options - Fetch options
 * @param {Function} logFn - Optional logging function (consoleBlock, status, details)
 * @returns {Promise<Response>}
 */
export const adminFetch = async (path, options = {}, logFn = null) => {
  const url = `${ADMIN_API_BASE}${path}`;
  const method = options.method || 'GET';
  const resp = await fetch(url, options);
  if (logFn) {
    logFn(resp.status, [method, url, resp.headers.get('x-error') || '']);
  }
  return resp;
};

/**
 * Fetch list of sites for an org
 */
export const fetchSites = async (orgValue, logFn = null) => {
  const resp = await adminFetch(`${getSitesPath(orgValue)}.json`, {}, logFn);
  if (resp.ok) {
    const data = await resp.json();
    return { sites: data.sites, status: resp.status };
  }
  return { sites: null, status: resp.status };
};

/**
 * Fetch site details/config
 */
export const fetchSiteDetails = async (orgValue, siteName) => {
  const resp = await fetch(`${ADMIN_API_BASE}${getSitePath(orgValue, siteName)}`);
  return resp.ok ? resp.json() : null;
};

/**
 * Fetch site access config
 */
export const fetchSiteAccess = async (orgValue, siteName, logFn = null) => {
  const resp = await adminFetch(getSitePath(orgValue, siteName), {}, logFn);
  if (resp.ok) {
    const config = await resp.json();
    return config.access || {};
  }
  return {};
};

/**
 * Update site access config
 */
export const updateSiteAccess = async (orgValue, siteName, accessConfig, logFn = null) => {
  const path = getSitePath(orgValue, siteName);
  const currentResp = await adminFetch(path, {}, logFn);
  const currentConfig = currentResp.ok ? await currentResp.json() : {};
  currentConfig.access = accessConfig;

  const resp = await adminFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(currentConfig),
  }, logFn);
  return resp.ok;
};

/**
 * Save site config (create or update)
 */
export const saveSiteConfig = async (orgValue, siteName, siteConfig, logFn = null) => {
  const path = getSitePath(orgValue, siteName);
  const resp = await adminFetch(path, {
    method: 'POST',
    body: JSON.stringify(siteConfig),
    headers: { 'content-type': 'application/json' },
  }, logFn);
  await resp.text();
  return resp.ok;
};

/**
 * Delete site config
 */
export const deleteSiteConfig = async (orgValue, siteName, logFn = null) => {
  const path = getSitePath(orgValue, siteName);
  const resp = await adminFetch(path, { method: 'DELETE' }, logFn);
  await resp.text();
  return resp.ok;
};

/**
 * Fetch secrets for a site
 */
export const fetchSecrets = async (orgValue, siteName, logFn = null) => {
  const resp = await adminFetch(`${getSitesPath(orgValue)}/${siteName}/secrets.json`, {}, logFn);
  if (resp.ok) return Object.values(await resp.json());
  if (resp.status === 404) return [];
  return null;
};

/**
 * Create a new secret
 */
export const createSecret = async (orgValue, siteName, logFn = null) => {
  const resp = await adminFetch(
    `${getSitesPath(orgValue)}/${siteName}/secrets.json`,
    { method: 'POST' },
    logFn,
  );
  return resp.ok ? resp.json() : null;
};

/**
 * Delete a secret
 */
export const deleteSecret = async (orgValue, siteName, secretId, logFn = null) => {
  const resp = await adminFetch(
    `${getSitesPath(orgValue)}/${siteName}/secrets/${encodeURIComponent(secretId)}.json`,
    { method: 'DELETE' },
    logFn,
  );
  return resp.ok;
};

/**
 * Fetch API keys for a site
 */
export const fetchApiKeys = async (orgValue, siteName, logFn = null) => {
  const resp = await adminFetch(`${getSitesPath(orgValue)}/${siteName}/apiKeys.json`, {}, logFn);
  if (resp.ok) {
    const data = await resp.json();
    return Object.entries(data).map(([id, val]) => ({ id, ...val }));
  }
  if (resp.status === 404) return [];
  return null;
};

/**
 * Create a new API key
 */
export const createApiKey = async (orgValue, siteName, logFn = null) => {
  const resp = await adminFetch(
    `${getSitesPath(orgValue)}/${siteName}/apiKeys.json`,
    { method: 'POST' },
    logFn,
  );
  return resp.ok ? resp.json() : null;
};

/**
 * Delete an API key
 */
export const deleteApiKey = async (orgValue, siteName, keyId, logFn = null) => {
  const resp = await adminFetch(
    `${getSitesPath(orgValue)}/${siteName}/apiKeys/${encodeURIComponent(keyId)}.json`,
    { method: 'DELETE' },
    logFn,
  );
  return resp.ok;
};

/**
 * Fetch PSI scores for a site
 */
export const fetchPsiScores = async (orgValue, siteName) => {
  const liveUrl = `https://main--${siteName}--${orgValue}.aem.live/`;
  const apiUrl = `${ADMIN_API_BASE}/psi/${orgValue}/${siteName}/main?url=${encodeURIComponent(liveUrl)}`;
  const resp = await fetch(apiUrl);
  if (!resp.ok) return null;
  const data = await resp.json();
  const categories = data.lighthouseResult?.categories || {};
  return {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    timestamp: Date.now(),
  };
};
