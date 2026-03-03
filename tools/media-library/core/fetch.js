import { CORS_PROXY_URL } from './constants.js';

/**
 * Fetch URL, falling back to CORS proxy on direct fetch failure (e.g. CORS).
 * @param {string} url - Target URL
 * @param {RequestInit} [options] - Fetch options (method, signal, etc.)
 * @returns {Promise<Response>}
 */
export default async function fetchWithCorsProxy(url, options = {}) {
  const { proxyOnly = false, ...fetchOpts } = options;

  const doProxyFetch = () => {
    const proxyUrl = `${CORS_PROXY_URL}?url=${encodeURIComponent(url)}`;
    return fetch(proxyUrl, fetchOpts);
  };

  if (proxyOnly) {
    return doProxyFetch();
  }

  try {
    const response = await fetch(url, fetchOpts);
    if (!response.ok) {
      return doProxyFetch();
    }
    return response;
  } catch (directError) {
    if (directError.name === 'TypeError'
      && (directError.message.includes('CORS')
        || directError.message.includes('blocked')
        || directError.message.includes('Access-Control-Allow-Origin')
        || directError.message.includes('Failed to fetch'))) {
      return doProxyFetch();
    }
    throw directError;
  }
}
