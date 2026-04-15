import { messageSidekick, NO_SIDEKICK } from './sidekick.js';
import { logResponse } from '../blocks/console/console.js';

const LOGIN_TIMEOUT = 120000;
// Brief settle delay after login before tools make API calls, to let the
// sidekick propagate the auth token.
const POST_LOGIN_SETTLE = 500;
const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// One pending login per org so concurrent onConfigReady calls share the result.
const pendingLogins = new Map();

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

  if (Array.isArray(authInfo) && authInfo.includes(org)) return true;

  if (pendingLogins.has(org)) return pendingLogins.get(org);

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
      if (!loginSite) return false;

      const success = await messageSidekick(
        { action: 'login', org, site: loginSite },
        null,
        LOGIN_TIMEOUT,
      );
      if (success) await settle(POST_LOGIN_SETTLE);
      return !!success;
    } finally {
      pendingLogins.delete(org);
    }
  })();

  pendingLogins.set(org, loginPromise);
  return loginPromise;
}

/**
 * Returns the current org and site from URL search params.
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
 * Registers a callback that fires when an org/site config is ready.
 *
 * Fires immediately if URL params already contain an org, then again on every
 * config-update event dispatched by the site picker.
 *
 * @param {Function} callback - Called with { org, site, authenticated }
 * @param {Object}  [options]
 * @param {boolean} [options.orgOnly=false]      - Skip re-firing when the org hasn't changed
 * @param {boolean} [options.authRequired=false] - Ensure auth before firing;
 *   callback receives authenticated flag
 */
export function onConfigReady(callback, { orgOnly = false, authRequired = false } = {}) {
  let lastOrg = null;
  let lastAuthenticated = false;

  const fire = async ({ org, site, force = false }) => {
    if (orgOnly && org === lastOrg && lastAuthenticated && !force) return;
    lastOrg = org;

    let authenticated = true;
    if (authRequired) {
      authenticated = await ensureAuth(org, site);
    }

    // A newer fire() call may have changed the org while we awaited auth.
    if (org !== lastOrg) return;

    lastAuthenticated = authenticated;
    callback({ org, site, authenticated });
  };

  const { org, site } = getCurrentConfig();
  if (org) fire({ org, site });

  window.addEventListener('config-update', (e) => fire(e.detail));
}

/**
 * Returns a logging function that writes to the console block.
 * Looks in the header first, then falls back to main.
 * @returns {Function} (status, details) => void
 */
export function getConsoleLogger() {
  return (status, details) => {
    const block = document.querySelector('header .console')
      || document.querySelector('main .console');
    logResponse(block, status, details);
  };
}
