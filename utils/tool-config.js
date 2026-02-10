import { messageSidekick, NO_SIDEKICK } from './sidekick.js';
import { logResponse } from '../blocks/console/console.js';

const LOGIN_TIMEOUT = 120000;

// Debounce login attempts per org
const pendingLogins = new Map();

/**
 * Ensures the user is authenticated for a given org.
 * Uses sidekick messaging directly — no profile block dependency.
 * @param {string} org - Organization name
 * @param {string} [site] - Site name (defaults to 'default')
 * @returns {Promise<boolean>} True if authenticated after call completes
 */
async function ensureAuth(org, site) {
  const authInfo = await messageSidekick({ action: 'getAuthInfo' });

  if (authInfo === NO_SIDEKICK) {
    // eslint-disable-next-line no-alert
    if (window.confirm('AEM Sidekick is required to sign in. Install now?')) {
      window.open(
        'https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml',
        '_blank',
      );
    }
    return false;
  }

  if (Array.isArray(authInfo) && authInfo.includes(org)) {
    return true;
  }

  // Debounce: if a login is already in progress for this org, wait for it
  if (pendingLogins.has(org)) {
    return pendingLogins.get(org);
  }

  const loginPromise = (async () => {
    try {
      const success = await messageSidekick({
        action: 'login',
        org,
        site: site || 'default',
      }, null, LOGIN_TIMEOUT);

      if (success) {
        window.dispatchEvent(new CustomEvent('auth-update', { detail: { org } }));
        return true;
      }
      return false;
    } finally {
      pendingLogins.delete(org);
    }
  })();

  pendingLogins.set(org, loginPromise);
  return loginPromise;
}

/**
 * Reads current org/site from URL params.
 * @returns {{ org: string, site: string }}
 */
export function getCurrentConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    org: params.get('org') || '',
    site: params.get('site') || '',
  };
}

/**
 * Registers a callback for config readiness.
 * Fires immediately if URL params contain an org, then listens for config-update events.
 * When authRequired is true, awaits ensureAuth before firing the callback.
 * Dedup (orgOnly) only skips when the previous call was authenticated,
 * so a failed auth allows retry on the next config-update for the same org.
 * @param {Function} callback - Called with { org, site, authenticated }
 * @param {Object} [options]
 * @param {boolean} [options.orgOnly] - Dedup by org value
 * @param {boolean} [options.authRequired] - Check auth before firing callback
 */
export function onConfigReady(callback, { orgOnly, authRequired } = {}) {
  let lastOrg = null;
  let lastAuthenticated = false;

  const fire = async ({ org, site }) => {
    if (orgOnly && org === lastOrg && lastAuthenticated) return;
    lastOrg = org;

    let authenticated = true;
    if (authRequired) {
      authenticated = await ensureAuth(org, site);
    }
    lastAuthenticated = authenticated;

    callback({ org, site, authenticated });
  };

  // Check URL params immediately for direct links
  const { org, site } = getCurrentConfig();
  if (org) {
    fire({ org, site });
  }

  // Listen for config-update events (header init + user changes + post-login)
  window.addEventListener('config-update', (e) => {
    fire(e.detail);
  });
}

/**
 * Returns a logging function that lazily resolves the console block.
 * Prefers the header console, falls back to a console in main.
 * @returns {Function} logFn(status, details)
 */
export function getConsoleLogger() {
  return (status, details) => {
    const block = document.querySelector('header .console')
      || document.querySelector('main .console');
    logResponse(block, status, details);
  };
}
