// @ts-check
import { updateConfig } from './config/config.js';
import {
  getImsToken, isImsTokenFresh, loadIms, signIn,
} from './ims.js';

/**
 * Auth-handling policy for {@link executeAdminRequest}. `retryOn401` opens the Adobe
 * sign-in on a 401 and then sends the request again, and `preflightAndRetry` also
 * checks the sign-in before sending.
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
 * @typedef {import('../scripts/admin-types.js').BoundAdminClient
 *   | import('../scripts/admin-types.js').OrgBoundAdminClient} BoundAdminClient
 * @typedef {typeof AuthMode[keyof typeof AuthMode]} AuthPolicy
 * @typedef {{ policy?: AuthPolicy }} AuthOptions
 * @typedef {AuthOptions & { org: string, site?: string }} AuthConfig
 */

/**
 * Waits for imslib, so the admin clients can send the IMS token.
 * @returns {Promise<boolean>} false if imslib is unavailable
 */
async function waitForIms() {
  try {
    await loadIms();
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if admin requests can go out without signing in, as {@link ensureAdminLogin} would.
 * Pages load on their own only then: signing in needs a click.
 * @returns {Promise<boolean>} true if signed in
 */
export async function isAdminSignedIn() {
  return await waitForIms() && isImsTokenFresh();
}

/**
 * Checks for an IMS token that won't expire during the task about to start; otherwise opens
 * the Adobe sign-in.
 * @returns {Promise<boolean>} true if signed in
 */
export async function ensureAdminLogin() {
  const imsReady = await waitForIms();
  if (isImsTokenFresh()) return true;
  if (!imsReady) return false;
  // a token that expires soon still works if the user closes the sign-in
  return await signIn() || !!getImsToken();
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
 * Execute an admin API request with an optional sign-in check, signing in and
 * sending it again on a 401. Returns `null` if the user didn't complete the
 * Adobe sign-in.
 *
 * The admin clients send the IMS token once imslib is ready. Only a 401 sent
 * without an IMS token opens the Adobe sign-in: admin would reject a new token
 * just like the current one.
 *
 * `updateConfig()` only fires on 2xx — a 4xx/5xx may not actually validate
 * the org/site combo (e.g. 404 could mean the org doesn't exist). It's a
 * no-op on pages without the org/site fields, so callers needn't opt in.
 * Bound clients persist only while the form still matches their target;
 * legacy callers retain persistence of the current form values.
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
  const { policy = AuthMode.RETRY_ON_401 } = 'coords' in authConfig ? options : authConfig;
  if (policy === AuthMode.PREFLIGHT_AND_RETRY && !await ensureAdminLogin()) return null;

  const imsReady = await waitForIms();
  let result = await requestFn();
  if (imsReady && policy !== AuthMode.NONE && result?.status === 401 && !getImsToken()) {
    if (!await signIn()) return null;
    result = await requestFn();
  }
  if (result?.ok) updateConfig('coords' in authConfig ? authConfig.coords : undefined);
  return result;
}
