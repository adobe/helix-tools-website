const CONFIG_PATH = './portal-config.json';
const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isLocalhost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
}

/**
 * Validates the public API base URL before it can influence browser requests.
 * Production endpoints must use HTTPS; loopback HTTP is accepted for local development.
 * @param {unknown} value
 * @returns {string}
 */
export function validateApiBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('portal-config.json must define apiBaseUrl.');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('apiBaseUrl must be an absolute URL.');
  }

  const localHttp = url.protocol === 'http:' && isLocalhost(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('apiBaseUrl must use HTTPS (localhost HTTP is allowed for development).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('apiBaseUrl must not contain credentials, a query, or a fragment.');
  }

  return url.href.replace(/\/+$/, '');
}

function optionalString(value, field, maxLength = 120) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${field} must be a string no longer than ${maxLength} characters.`);
  }
  return value.trim() || undefined;
}

function requiredString(value, field, maxLength = 200) {
  const result = optionalString(value, field, maxLength);
  if (!result) {
    throw new Error(`portal-config.json must define ${field} for this customer deployment.`);
  }
  return result;
}

function validateHostSuffixes(value) {
  if (value === undefined) return ['.adobeaemcloud.com', '.blob.core.windows.net'];
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw new Error('uploadHostSuffixes must be a non-empty array.');
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !/^\.[a-z0-9.-]+$/i.test(entry)) {
      throw new Error('Each uploadHostSuffixes entry must be a DNS suffix beginning with a dot.');
    }
    return entry.toLowerCase();
  });
}

/**
 * Validates public runtime configuration loaded from the repository.
 * @param {unknown} value
 * @returns {{
 *   apiBaseUrl: string,
 *   imsOrgId: string,
 *   tenantSlug?: string,
 *   uploadHostSuffixes: string[],
 *   branding: { title: string, logoSrc: string }
 * }}
 */
export function validatePortalConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('portal-config.json must contain an object.');
  }
  const input = value;
  const tenantSlug = optionalString(input.tenantSlug, 'tenantSlug', 63);
  if (tenantSlug && !TENANT_SLUG.test(tenantSlug)) {
    throw new Error('tenantSlug must contain lowercase letters, numbers, and hyphens only.');
  }

  const branding = input.branding && typeof input.branding === 'object'
    && !Array.isArray(input.branding) ? input.branding : {};
  const title = optionalString(branding.title, 'branding.title') || 'AEM Assets Upload Portal';
  const logoSrc = optionalString(branding.logoSrc, 'branding.logoSrc', 240) || '/icons/adobe.svg';
  const logoUrl = new URL(logoSrc, window.location.origin);
  if (logoUrl.origin !== window.location.origin || !logoUrl.pathname.startsWith('/')) {
    throw new Error('branding.logoSrc must be a same-origin path.');
  }

  return {
    apiBaseUrl: validateApiBaseUrl(input.apiBaseUrl),
    imsOrgId: requiredString(input.imsOrgId, 'imsOrgId'),
    tenantSlug,
    uploadHostSuffixes: validateHostSuffixes(input.uploadHostSuffixes),
    branding: { title, logoSrc: logoUrl.pathname },
  };
}

/**
 * Loads and validates the customer-fork runtime configuration.
 * @param {typeof fetch} fetchImpl
 */
export async function loadPortalConfig(fetchImpl = fetch) {
  const response = await fetchImpl(CONFIG_PATH, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not load portal configuration.');
  return validatePortalConfig(await response.json());
}
