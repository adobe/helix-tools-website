// @ts-check
import { ensureLogin } from '../blocks/profile/profile.js';
import { updateConfig } from './config/config.js';

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

/**
 * @typedef {import('../scripts/admin-types.js').BoundAdminClient} BoundAdminClient
 * @typedef {typeof AuthMode[keyof typeof AuthMode]} AuthPolicy
 * @typedef {{ policy?: AuthPolicy }} AuthOptions
 * @typedef {AuthOptions & { org: string, site?: string }} AuthConfig
 */

/**
 * @param {string} org
 * @returns {Promise<boolean>}
 */
function waitForLogin(org) {
  return new Promise((resolve) => {
    const handlers = {
      /** @param {boolean} value */
      finish(value) {
        window.removeEventListener('profile-update', handlers.onUpdate);
        window.removeEventListener('profile-cancelled', handlers.onCancel);
        resolve(value);
      },
      /** @param {Event} event */
      onUpdate(event) {
        handlers.finish('detail' in event && Array.isArray(event.detail) && event.detail.includes(org));
      },
      onCancel() {
        handlers.finish(false);
      },
    };
    window.addEventListener('profile-update', handlers.onUpdate);
    window.addEventListener('profile-cancelled', handlers.onCancel);
  });
}

/**
 * @template {{ status: number, ok?: boolean }} T
 * @overload
 * @param {() => Promise<T>} requestFn
 * @param {AuthConfig} authConfig
 * @returns {Promise<T | null>}
 */
/**
 * @template {{ status: number, ok?: boolean }} T
 * @overload
 * @param {() => Promise<T>} requestFn
 * @param {BoundAdminClient} client
 * @param {AuthOptions} [options]
 * @returns {Promise<T | null>}
 */
/**
 * Execute an admin API request with optional auth pre-check and 401 retry.
 * Returns `null` if the user fails to complete login.
 *
 * `updateConfig()` only fires on 2xx — a 4xx/5xx may not actually validate
 * the org/site combo (e.g. 404 could mean the org doesn't exist). It's a
 * no-op on pages without the org/site fields, so callers needn't opt in.
 *
 * Normalize both signatures here so they share the same auth policy flow.
 *
 * @template {{ status: number, ok?: boolean }} T
 * @param {() => Promise<T>} requestFn       must be safe to invoke twice
 * @param {AuthConfig | BoundAdminClient} authConfig
 * @param {AuthOptions} [options]            bound-client policy; default: `retryOn401`
 * @returns {Promise<T | null>}
 */
export async function executeAdminRequest(requestFn, authConfig, options = {}) {
  const config = 'coords' in authConfig
    ? { ...authConfig.coords, policy: options.policy }
    : authConfig;
  const { org, site, policy = AuthMode.RETRY_ON_401 } = config;

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

  if (result?.ok) updateConfig();
  return result;
}
