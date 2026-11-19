// @ts-check
import fetchWithRetry from '../utils/fetch-retry.js';

const H6_FLAG = 'use-h6-api';

/**
 * @typedef {import('./admin-types.js').BoundAdminClient |
 *   import('./admin-types.js').OrgBoundAdminClient} ScopedAdminClient
 */

// Cache the whole creation promise so detection and binding are shared.
/** @type {Map<string, Promise<ScopedAdminClient>>} */
const clientCache = new Map();

/**
 * @typedef {Exclude<keyof import('./admin-types.js').UnboundAdminClient,
 *   'raw'|'isInScope'|'withRequestInit'|'pinVersion'>} AdminResourceName
 */

/** @type {readonly AdminResourceName[]} */
const SITE_RESOURCES = [
  'config', 'aggregated', 'status', 'preview', 'live', 'code', 'log', 'index',
  'sitemap', 'job', 'psi', 'snapshot', 'sidekick', 'medialog', 'suggestions',
];

/**
 * @template {ScopedAdminClient} T
 * @param {readonly ['site', string, string, string|null, boolean] |
 *   readonly ['org', string]} parts
 * @param {() => Promise<T>} create
 * @returns {Promise<T>}
 */
function getCachedClient(parts, create) {
  const key = JSON.stringify(parts);
  // Scope-prefixed keys keep each cached promise paired with its factory's client type.
  const cached = /** @type {Promise<T>|undefined} */ (clientCache.get(key));
  if (cached) return cached;
  const pending = create().catch((error) => {
    clientCache.delete(key);
    throw error;
  });
  clientCache.set(key, pending);
  return pending;
}

/**
 * @param {boolean} useH6
 * @returns {Promise<import('./admin-types.js').UnboundAdminClient|null>}
 */
async function loadAdminModule(useH6) {
  const adminMod = await import(`../scripts/${useH6 ? 'aem' : 'helix'}-admin.js`);
  if (!adminMod?.default) {
    // eslint-disable-next-line no-console
    console.error('Failed to load admin client module');
    return null;
  }
  return adminMod.default;
}

/**
 * @param {import('./admin-types.js').UnboundAdminClient} source
 * @param {import('./admin-types.js').BoundCoordinates} coords
 * @returns {import('./admin-types.js').AdminRawRequest}
 */
function bindRawRequest(source, coords) {
  const { origin } = new URL(source.config(coords).url);
  return (method, urlOrPath, body, opts) => {
    const url = new URL(urlOrPath, origin);
    const decoded = new URL(url);
    // Server routing can interpret encoded separators as coordinate boundaries.
    decoded.pathname = url.pathname.replace(/%2f/gi, '/').replace(/%5c/gi, '/');
    // Adapters own backend-specific URL boundaries; the binder only enforces them.
    if (url.username || url.password || url.href.includes('#')
      || !source.isInScope(url, coords) || !source.isInScope(decoded, coords)) {
      throw new TypeError('Bound admin raw() URL must remain within its backend and coordinates');
    }
    return source.raw(method, url.href, body, opts);
  };
}

/**
 * @overload
 * @param {import('./admin-types.js').UnboundAdminClient} admin
 * @param {import('./admin-types.js').BoundCoordinates} coords
 * @param {readonly AdminResourceName[]} resources
 * @returns {import('./admin-types.js').BoundAdminClient}
 */
/**
 * @overload
 * @param {import('./admin-types.js').UnboundAdminClient} admin
 * @param {import('./admin-types.js').OrgBoundCoordinates} coords
 * @param {readonly ['config']} resources
 * @returns {import('./admin-types.js').OrgBoundAdminClient}
 */
/**
 * @param {import('./admin-types.js').UnboundAdminClient} admin
 * @param {import('./admin-types.js').BoundCoordinates |
 *   import('./admin-types.js').OrgBoundCoordinates} coords
 * @param {readonly AdminResourceName[]} resources
 * @returns {ScopedAdminClient}
 */
function bindAdminClient(admin, coords, resources) {
  /**
   * @param {import('./admin-types.js').UnboundAdminClient} source
   * @returns {ScopedAdminClient}
   */
  const bind = (source) => {
    const bound = Object.fromEntries(resources.map((name) => [
      name,
      /** @param {...unknown} args */
      (...args) => {
        if (args.length) {
          throw new TypeError(`Bound admin ${source[name].name}() does not accept arguments`);
        }
        if (name === 'config') return source.config(coords);
        if (!('site' in coords)) {
          throw new TypeError(`Bound admin ${name}() requires site coordinates`);
        }
        return source[name](coords);
      },
    ]));
    const helpers = 'site' in coords
      ? { raw: bindRawRequest(source, coords) }
      : {};
    // The resource lists supply the required accessors for each public client contract.
    return /** @type {ScopedAdminClient} */ (Object.freeze({
      coords,
      ...bound,
      ...helpers,
      withRequestInit: (/** @type {import('./admin-types.js').AdminRequestDefaults} */ extra) => (
        bind(source.withRequestInit(extra))
      ),
      pinVersion: (/** @type {string|undefined} */ version = undefined) => (
        bind(source.pinVersion(version))
      ),
    }));
  };
  return bind(admin);
}

/** @param {string | undefined} s */
const stripJson = (s) => (s ? s.replace(/\.json$/, '') : null);

/** @param {string[]} parts */
function h5Coords(parts) {
  if (parts[0] === 'config') {
    const org = stripJson(parts[1]);
    if (!org) return { org: null, site: null };
    return { org, site: parts[2] === 'sites' ? stripJson(parts[3]) : null };
  }
  return { org: parts[1] ?? null, site: parts[2] ?? null };
}

/** @param {string[]} parts */
function h6Coords(parts) {
  const org = parts[0];
  if (!org) return { org: null, site: null };
  return { org, site: parts[1] === 'sites' ? stripJson(parts[2]) : null };
}

/**
 * Parse org/site from an admin API URL. The host selects the URL grammar
 * only; it says nothing about which backend the site actually uses.
 * @param {string} url
 * @returns {import('./admin-types.js').ParsedCoordinates}
 */
export function coordsFromURL(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    return hostname === 'admin.hlx.page' ? h5Coords(parts) : h6Coords(parts);
  } catch {
    return { org: null, site: null };
  }
}

/**
 * Get an admin client appropriate for the active API version.
 *
 * Selection is global, driven by the `use-h6-api` localStorage override. For
 * per-site selection based on the actual backend, use
 * {@link getAdminClientForSite}.
 *
 * @returns {Promise<import('./admin-types.js').UnboundAdminClient|null>}
 */
export default async function getAdminClient() {
  const useH6 = window.localStorage.getItem(H6_FLAG) !== null;
  return loadAdminModule(useH6);
}

/**
 * Determine whether a site is served by the Helix 6 backend (api.aem.live).
 *
 * Detection mirrors the sidekick: the legacy admin service advertises the
 * upgrade via the `x-api-upgrade-available` response header on the site's
 * sidekick config, present even on unauthenticated (401) responses. The
 * `use-h6-api` localStorage override forces H6 without a network call.
 *
 * Not exported — {@link getAdminClientForSite} is the public entry point for
 * per-site selection.
 *
 * @param {import('./admin-types.js').BoundCoordinates} coords
 * @param {boolean} forceH6
 * @returns {Promise<boolean>}
 */
async function isHelix6({ org, site, ref = 'main' }, forceH6) {
  if (forceH6) return true;
  // Null omits an operation ref, but detection still needs a concrete config URL.
  const url = `https://admin.hlx.page/sidekick/${org}/${site}/${ref ?? 'main'}/config.json`;
  const resp = await fetchWithRetry(url, { credentials: 'omit', cache: 'no-store' });
  if (!resp.ok && resp.status !== 401) {
    throw new Error(`Admin backend detection failed for ${org}/${site}/${ref}: HTTP ${resp.status}`);
  }
  return resp.headers.get('x-api-upgrade-available') === 'true';
}

/**
 * Get a cached, immutable site-bound client, selecting H5 or H6 by detection.
 * Resource accessors take no arguments; raw URLs must stay within the bound target.
 * Request-default and version derivation preserve binding without changing this cache.
 * Transient detection failures use the shared GET retry policy. Permanent HTTP errors
 * and exhausted retries reject; failures are not cached as legacy-backend results.
 *
 * @param {import('./admin-types.js').SiteCoordinates} coords
 * @returns {Promise<import('./admin-types.js').BoundAdminClient>}
 */
export async function getAdminClientForSite(coords) {
  if (!coords || typeof coords.org !== 'string' || !coords.org.trim()
    || typeof coords.site !== 'string' || !coords.site.trim()) {
    throw new TypeError('Admin client org and site must be non-empty strings');
  }
  const { org, site, ref = 'main' } = coords;
  if (ref !== null && (typeof ref !== 'string' || !ref.trim())) {
    throw new TypeError('Admin client ref must be a non-empty string or null');
  }
  const scope = Object.freeze({ org, site, ref });
  const forceH6 = window.localStorage.getItem(H6_FLAG) !== null;
  // Keep forced selection separate from automatic detection while the override exists.
  return getCachedClient(['site', org, site, ref, forceH6], async () => {
    const admin = await loadAdminModule(await isHelix6(scope, forceH6));
    if (!admin) throw new Error(`Failed to load admin client for ${org}/${site}`);
    return bindAdminClient(admin, scope, SITE_RESOURCES);
  });
}

/**
 * Get a cached, immutable org-bound client. Org-level operations exist only on the
 * Helix 6 backend, so there is no detection and the `use-h6-api` override is irrelevant.
 * Only operations an org-level tool uses are bound; add others when a tool needs them.
 *
 * @param {import('./admin-types.js').OrgCoordinates} coords
 * @returns {Promise<import('./admin-types.js').OrgBoundAdminClient>}
 */
export async function getAdminClientForOrg(coords) {
  if (!coords || typeof coords.org !== 'string' || !coords.org.trim()) {
    throw new TypeError('Admin client org must be a non-empty string');
  }
  if ('site' in coords) {
    throw new TypeError('Admin client for org is org-only; use getAdminClientForSite for a site');
  }
  const scope = Object.freeze({ org: coords.org });
  return getCachedClient(['org', scope.org], async () => {
    const admin = await loadAdminModule(true);
    if (!admin) throw new Error(`Failed to load admin client for ${scope.org}`);
    return bindAdminClient(admin, scope, ['config']);
  });
}
