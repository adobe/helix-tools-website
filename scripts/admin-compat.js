const H6_FLAG = 'use-h6-api';

// Per-site Helix 6 detection is cached (by org/site/ref) for the page lifetime.
// Values are the in-flight/settled promises so concurrent callers dedupe.
const detectionCache = new Map();

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
 * Get an admin client appropriate for the active API version.
 *
 * Selection is global, driven by the `use-h6-api` localStorage override. For
 * per-site selection based on the actual backend, use
 * {@link getAdminClientForSite}.
 *
 * @returns {Promise<object|null>}
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
 * @param {{org: string, site: string, ref?: string}} coords
 * @returns {Promise<boolean>}
 */
async function isHelix6({ org, site, ref = 'main' }) {
  if (window.localStorage.getItem(H6_FLAG) !== null) return true;
  if (!org || !site) return false;
  const key = `${org}/${site}/${ref}`;
  if (!detectionCache.has(key)) {
    const probe = (async () => {
      try {
        const url = `https://admin.hlx.page/sidekick/${org}/${site}/${ref}/config.json`;
        const resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        return resp.headers.get('x-api-upgrade-available') === 'true';
      } catch {
        return false;
      }
    })();
    detectionCache.set(key, probe);
  }
  return detectionCache.get(key);
}

/**
 * Get the admin client for a specific site, selecting H5 or H6 based on the
 * backend the site actually runs on.
 *
 * @param {{org: string, site: string, ref?: string}} coords
 * @returns {Promise<object|null>}
 */
export async function getAdminClientForSite(coords) {
  return loadAdminModule(await isHelix6(coords));
}
