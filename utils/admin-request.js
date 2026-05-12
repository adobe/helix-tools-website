import { ensureLogin } from '../blocks/profile/profile.js';
import { updateStorage } from './config/config.js';

/**
 * Auth-handling policy for {@link executeAdminRequest}.
 *
 * @readonly
 * @enum {string}
 */
export const AuthMode = Object.freeze({
  NONE: 'none',
  RETRY_ON_401: 'retryOn401',
  PREFLIGHT_AND_RETRY: 'preflightAndRetry',
});

function waitForLogin(org) {
  return new Promise((resolve) => {
    const handlers = {};
    const finish = (value) => {
      window.removeEventListener('profile-update', handlers.onUpdate);
      window.removeEventListener('profile-cancelled', handlers.onCancel);
      resolve(value);
    };
    handlers.onUpdate = ({ detail }) => finish(Array.isArray(detail) && detail.includes(org));
    handlers.onCancel = () => finish(false);
    window.addEventListener('profile-update', handlers.onUpdate);
    window.addEventListener('profile-cancelled', handlers.onCancel);
  });
}

/**
 * Execute an admin API request with optional auth pre-check and 401 retry.
 * Returns `null` if the user fails to complete login.
 *
 * Persistence to localStorage only fires on 2xx — a 4xx/5xx may not actually
 * validate the org/site combo (e.g. 404 could mean the org doesn't exist).
 *
 * @template {{ status: number }} T
 * @param {() => Promise<T>} requestFn       must be safe to invoke twice
 * @param {object} authConfig
 * @param {string} authConfig.org
 * @param {string} [authConfig.site]
 * @param {AuthMode} [authConfig.policy]     default: `retryOn401`
 * @returns {Promise<T | null>}
 */
export async function executeAdminRequest(requestFn, authConfig) {
  const { org, site, policy = AuthMode.RETRY_ON_401 } = authConfig;

  if (policy === AuthMode.PREFLIGHT_AND_RETRY) {
    const signedIn = await ensureLogin(org, site) || await waitForLogin(org);
    if (!signedIn) return null;
  }

  let result = await requestFn();

  const retry = policy === AuthMode.RETRY_ON_401 || policy === AuthMode.PREFLIGHT_AND_RETRY;
  if (retry && result?.status === 401) {
    const signedIn = await ensureLogin(org, site) || await waitForLogin(org);
    if (!signedIn) return null;
    result = await requestFn();
  }

  if (result?.ok) updateStorage(org, site);
  return result;
}
