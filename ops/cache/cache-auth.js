import { getImsToken } from '../../utils/ims.js';

// keyed by status and x-error, as returned by the cache worker (helix-cache-debug src/auth.js)
const AUTH_ERRORS = new Map([
  ['403 invalid authorization', 'Your Adobe sign-in is missing or has expired. Please sign in with Adobe again.'],
  ['403 not authorized', 'Your Adobe account is not authorized to use this tool (ops role required).'],
  ['503 ims unavailable', 'Adobe sign-in could not be verified (IMS unavailable). Please try again later.'],
]);

/**
 * Returns the request headers for the cache worker, including the IMS access token.
 * @param {Object} [extra] Additional headers
 * @returns {Object} The headers
 */
export function authHeaders(extra = {}) {
  return { ...extra, authorization: `Bearer ${getImsToken()}` };
}

/**
 * Returns the user message for an authorization error response of the cache worker.
 * @param {Response} resp The response
 * @returns {string|null} The message, or null if the response is not an authorization error
 */
export function getAuthError(resp) {
  return AUTH_ERRORS.get(`${resp.status} ${resp.headers.get('x-error')}`) ?? null;
}
