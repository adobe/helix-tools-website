import { getImsToken } from '../../utils/ims.js';

// drop the retired superuser key
window.localStorage.removeItem('cache-debug-key');

// keyed by the cache worker's status and x-error
const AUTH_ERRORS = new Map([
  ['403 invalid authorization', 'Your Adobe sign-in is missing or has expired. Please sign in with Adobe again.'],
  ['403 not authorized', 'Your Adobe account is not authorized to use this tool (ops role required).'],
  ['503 ims unavailable', 'Adobe sign-in could not be verified (IMS unavailable). Please try again later.'],
]);

/** Headers for the cache worker: `extra` plus the IMS bearer token. */
export function authHeaders(extra = {}) {
  return { ...extra, authorization: `Bearer ${getImsToken()}` };
}

/**
 * @param {Response} resp
 * @returns {string|null} the user message for a cache worker auth error, else null
 */
export function getAuthError(resp) {
  return AUTH_ERRORS.get(`${resp.status} ${resp.headers.get('x-error')}`) ?? null;
}
