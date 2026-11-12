// @ts-check
import fetchWithRetry from '../utils/fetch-retry.js';

const H6_FLAG = 'use-h6-api';

// Cache the whole creation promise so detection and binding are shared.
/** @type {Map<string, Promise<import('./admin-types.js').BoundAdminClient>>} */
const clientCache = new Map();

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
 * @param {import('./admin-types.js').UnboundAdminClient} admin
 * @param {import('./admin-types.js').BoundCoordinates} coords
 * @returns {import('./admin-types.js').BoundAdminClient}
 */
function bindAdminClient(admin, coords) {
  /**
   * @template T
   * @param {(coords: import('./admin-types.js').BoundCoordinates) => T} resource
   * @returns {() => T}
   */
  function bind(resource) {
    return (...args) => {
      if (args.length) {
        throw new TypeError(`Bound admin ${resource.name}() does not accept arguments`);
      }
      return resource(coords);
    };
  }

  return Object.freeze({
    coords,
    config: bind(admin.config),
    status: bind(admin.status),
    preview: bind(admin.preview),
    live: bind(admin.live),
    code: bind(admin.code),
    log: bind(admin.log),
    index: bind(admin.index),
    sitemap: bind(admin.sitemap),
    job: bind(admin.job),
    psi: bind(admin.psi),
    snapshot: bind(admin.snapshot),
    sidekick: bind(admin.sidekick),
    medialog: bind(admin.medialog),
    raw: admin.raw,
    coordsFromURL: admin.coordsFromURL,
    suggestions: bind(admin.suggestions),
    withRequestInit: (extra) => bindAdminClient(admin.withRequestInit(extra), coords),
    pinVersion: (version) => bindAdminClient(admin.pinVersion(version), coords),
  });
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
 * Resource accessors take no arguments; raw URLs remain explicitly unscoped.
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
  const key = JSON.stringify([org, site, ref, forceH6]);
  const cached = clientCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const admin = await loadAdminModule(await isHelix6(scope, forceH6));
    if (!admin) throw new Error(`Failed to load admin client for ${org}/${site}`);
    return bindAdminClient(admin, scope);
  })().catch((error) => {
    clientCache.delete(key);
    throw error;
  });
  clientCache.set(key, pending);
  return pending;
}
