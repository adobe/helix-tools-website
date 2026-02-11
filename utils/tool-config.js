import { messageSidekick, NO_SIDEKICK } from './sidekick.js';
import { logResponse } from '../blocks/console/console.js';

const LOGIN_TIMEOUT = 120000;

// Brief delay after login to let the sidekick propagate the auth token
const POST_LOGIN_SETTLE = 500;
const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

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
      let loginSite = site;
      if (!loginSite) {
        const sites = await messageSidekick({ action: 'getSites' });
        if (Array.isArray(sites)) {
          const match = sites.find((s) => s.org === org);
          if (match) loginSite = match.site || match.repo || '';
        }
      }

      if (!loginSite) {
        window.dispatchEvent(new CustomEvent('config-add-site', { detail: { org } }));
        return false;
      }

      const success = await messageSidekick({
        action: 'login',
        org,
        site: loginSite,
      }, null, LOGIN_TIMEOUT);

      if (success) {
        await settle(POST_LOGIN_SETTLE);
        window.dispatchEvent(new CustomEvent('auth-update', { detail: { org, authenticated: true } }));
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
 * Also listens for auth-update events (login/logout) and re-fires the callback
 * with the new auth state — without prompting login again.
 * Dedup (orgOnly) only skips when the previous call was authenticated,
 * so a failed auth allows retry on the next config-update for the same org.
 * @param {Function} callback - Called with { org, site, authenticated }
 * @param {Object} [options]
 * @param {boolean} [options.orgOnly] - Dedup by org value
 * @param {boolean} [options.authRequired] - Check auth before firing callback
 */
export function onConfigReady(callback, { orgOnly, authRequired } = {}) {
  let lastOrg = null;
  let lastSite = '';
  let lastAuthenticated = false;

  const fire = async ({ org, site, force }) => {
    if (orgOnly && org === lastOrg && lastAuthenticated && !force) return;
    lastOrg = org;
    lastSite = site;

    let authenticated = true;
    if (authRequired) {
      authenticated = await ensureAuth(org, site);
    }

    // A newer fire() call may have changed the org while we awaited ensureAuth
    if (org !== lastOrg) return;

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

  // Listen for auth-update events (login/logout) and re-fire without prompting login
  if (authRequired) {
    window.addEventListener('auth-update', (e) => {
      const { org: authOrg, authenticated } = e.detail;
      if (authOrg !== lastOrg) return;
      if (authenticated === lastAuthenticated) return;
      lastAuthenticated = authenticated;
      callback({ org: authOrg, site: lastSite, authenticated });
    });
  }
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
