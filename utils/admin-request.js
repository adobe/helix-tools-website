import { ensureLogin } from '../blocks/profile/profile.js';
import { updateConfig } from './config/config.js';

/**
 * Auth-handling policies for {@link executeAdminRequest}.
 *
 * - `none` — call the request fn; no auth handling.
 * - `retryOn401` — call the request fn; on 401, prompt login and retry once.
 * - `preflightAndRetry` — prompt login first, then call the request fn,
 *   and retry once on 401.
 *
 * In `retryOn401` and `preflightAndRetry`, when the user is not signed in,
 * `ensureLogin` opens the profile modal and the helper awaits the outcome:
 * a `profile-update` event with the org in its detail (login completed) or
 * a `profile-cancelled` event (modal closed, login window closed without
 * completion, or profile.js's 60s give-up timer). The request fn is only
 * re-invoked if login succeeded.
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
 * @typedef {import('../scripts/helix-admin.js').AdminResponse} AdminResponse
 */

/**
 * Race the next `profile-update` and `profile-cancelled`. Resolves true
 * only if `profile-update` fires with `org` in its detail. The give-up
 * timer (60s after a login window is opened) lives in profile.js, which
 * fires `profile-cancelled` when it expires.
 */
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
 * Ensure the user is signed in, awaiting the modal flow if needed.
 * Resolves true if signed in (now or after the user completes the modal),
 * false if the user cancels or times out.
 */
async function ensureSignedIn(org, site) {
  if (await ensureLogin(org, site)) return true;
  return waitForLogin(org);
}

/**
 * Execute an admin API request with optional auth pre-check and 401 retry.
 *
 * The request fn is the unit of retry — it must be safe to invoke up to twice.
 *
 * Returns `null` when auth handling is enabled and the user does not
 * complete login (cancels the modal, closes the login window, or
 * profile.js's give-up timer fires).
 *
 * On any 2xx result, calls `updateConfig()` to persist the org/site combo
 * to URL params and localStorage. Non-2xx results don't trigger persistence
 * — a 4xx/5xx may not actually validate the org/site (404 could mean the
 * org doesn't exist, 403 could mean wrong permissions on a wrong combo).
 * `updateConfig` is a no-op on pages without the org/site fields, so
 * callers don't need to opt in.
 *
 * @template {{ status: number }} T
 * @param {() => Promise<T>} requestFn   returns an AdminResponse-like envelope (`{ status }`)
 * @param {object} policy
 * @param {string} policy.org            org for `ensureLogin`
 * @param {string} [policy.site]         site for `ensureLogin`
 * @param {AuthMode} [policy.auth]       auth handling mode (default: `retryOn401`)
 * @returns {Promise<T | null>}
 */
export async function executeAdminRequest(requestFn, policy) {
  const { org, site, auth = AuthMode.RETRY_ON_401 } = policy;

  if (auth === AuthMode.PREFLIGHT_AND_RETRY) {
    if (!await ensureSignedIn(org, site)) return null;
  }

  let result = await requestFn();

  const retry = auth === AuthMode.RETRY_ON_401 || auth === AuthMode.PREFLIGHT_AND_RETRY;
  if (retry && result?.status === 401) {
    if (await ensureSignedIn(org, site)) {
      result = await requestFn();
    } else {
      return null;
    }
  }

  if (result?.ok) updateConfig();
  return result;
}
