import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../../utils/admin-request.js';

const logResult = (logFn, result) => {
  if (logFn && result) {
    const { method, url } = result.request;
    logFn(result.status, [method, url, result.error]);
  }
};

/**
 * Fetch list of sites for an org. Uses PREFLIGHT_AND_RETRY — entry-point fetch.
 */
export const fetchSites = async (orgValue, logFn = null) => {
  const handle = admin.config({ org: orgValue }).select('sites.json');
  const result = await executeAdminRequest(
    () => handle.read(),
    { org: orgValue, policy: AuthMode.PREFLIGHT_AND_RETRY },
  );
  logResult(logFn, result);
  if (result?.ok) {
    const data = await result.json();
    return { sites: data.sites, status: result.status };
  }
  return { sites: null, status: result?.status ?? 0 };
};

/**
 * Fetch site details/config.
 */
export const fetchSiteDetails = async (orgValue, siteName) => {
  const result = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).read(),
    { org: orgValue, site: siteName },
  );
  return result?.ok ? result.json() : null;
};

/**
 * Fetch site access config.
 */
export const fetchSiteAccess = async (orgValue, siteName, logFn = null) => {
  const result = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).read(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  if (result?.ok) {
    const config = await result.json();
    return config.access || {};
  }
  return {};
};

/**
 * Update site access config — reads current config first, then writes back with updated access.
 */
export const updateSiteAccess = async (orgValue, siteName, accessConfig, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName });
  const readResult = await executeAdminRequest(
    () => handle.read(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, readResult);
  if (!readResult?.ok) return false;
  const currentConfig = await readResult.json();
  currentConfig.access = accessConfig;
  const writeResult = await executeAdminRequest(
    () => handle.update(JSON.stringify(currentConfig)),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, writeResult);
  return writeResult?.ok ?? false;
};

/**
 * Save site config (create or update).
 */
export const saveSiteConfig = async (orgValue, siteName, siteConfig, logFn = null) => {
  const result = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).update(JSON.stringify(siteConfig)),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ?? false;
};

/**
 * Save site code config separately (required for BYO Git).
 */
export const saveSiteCodeConfig = async (orgValue, siteName, codeConfig, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName }).select('code.json');
  const result = await executeAdminRequest(
    () => handle.update(JSON.stringify(codeConfig)),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ?? false;
};

/**
 * Delete site config.
 */
export const deleteSiteConfig = async (orgValue, siteName, logFn = null) => {
  const result = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).remove(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ?? false;
};

/**
 * Fetch secrets for a site.
 */
export const fetchSecrets = async (orgValue, siteName, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName }).select('secrets.json');
  const result = await executeAdminRequest(
    () => handle.read(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  if (result?.ok) return Object.values(await result.json());
  if (result?.status === 404) return [];
  return null;
};

/**
 * Create a new (unnamed) secret.
 */
export const createSecret = async (orgValue, siteName, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName }).select('secrets.json');
  const result = await executeAdminRequest(
    () => handle.update(null),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ? result.json() : null;
};

/**
 * Create a named secret with an optional value.
 */
export const createNamedSecret = async (
  orgValue,
  siteName,
  secretName,
  secretValue = null,
  logFn = null,
) => {
  const handle = admin.config({ org: orgValue, site: siteName })
    .select(`secrets/${encodeURIComponent(secretName)}.json`);
  const body = secretValue ? JSON.stringify({ value: secretValue }) : null;
  const result = await executeAdminRequest(
    () => handle.update(body),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  if (!result?.ok) return null;
  try {
    return await result.json();
  } catch {
    return { id: secretName };
  }
};

/**
 * Delete a secret.
 */
export const deleteSecret = async (orgValue, siteName, secretId, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName })
    .select(`secrets/${encodeURIComponent(secretId)}.json`);
  const result = await executeAdminRequest(
    () => handle.remove(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ?? false;
};

/**
 * Fetch API keys for a site.
 */
export const fetchApiKeys = async (orgValue, siteName, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName }).select('apiKeys.json');
  const result = await executeAdminRequest(
    () => handle.read(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  if (result?.ok) {
    const data = await result.json();
    return Object.entries(data).map(([id, val]) => ({ id, ...val }));
  }
  if (result?.status === 404) return [];
  return null;
};

/**
 * Create a new API key.
 * @param {string} orgValue
 * @param {string} siteName
 * @param {object} [body] - Optional body with roles and description
 * @param {Function} [logFn]
 */
export const createApiKey = async (orgValue, siteName, body = null, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName }).select('apiKeys.json');
  const result = await executeAdminRequest(
    () => handle.update(body ? JSON.stringify(body) : null),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ? result.json() : null;
};

/**
 * Delete an API key.
 */
export const deleteApiKey = async (orgValue, siteName, keyId, logFn = null) => {
  const handle = admin.config({ org: orgValue, site: siteName })
    .select(`apiKeys/${encodeURIComponent(keyId)}.json`);
  const result = await executeAdminRequest(
    () => handle.remove(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  return result?.ok ?? false;
};

/**
 * Fetch PSI scores for a site.
 */
export const fetchPsiScores = async (orgValue, siteName) => {
  const liveUrl = `https://main--${siteName}--${orgValue}.aem.live/`;
  const result = await admin.psi({ org: orgValue, site: siteName })
    .get('', { params: { url: liveUrl } });
  if (!result.ok) return null;
  const data = await result.json();
  const categories = data.lighthouseResult?.categories || {};
  return {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    timestamp: Date.now(),
  };
};
