import { CORS_PROXY_URL } from './constants.js';

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
    return await fetch(url, fetchOpts);
  } catch (directError) {
    if (directError?.name === 'TypeError') {
      return doProxyFetch();
    }
    throw directError;
  }
}
