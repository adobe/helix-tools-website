export const ADMIN_API_BASE = 'https://admin.hlx.page';

export const ADMIN_PATHS = {
  sites: '/config/{org}/sites.json',
  site: '/config/{org}/sites/{site}.json',
  secrets: '/config/{org}/sites/{site}/secrets.json',
  secret: '/config/{org}/sites/{site}/secrets/{secretId}.json',
  apiKeys: '/config/{org}/sites/{site}/apiKeys.json',
  apiKey: '/config/{org}/sites/{site}/apiKeys/{keyId}.json',
  psi: '/psi/{org}/{site}/main',
};

function resolvePath(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (params[key] == null) throw new Error(`Missing URL param: ${key}`);
    return params[key];
  });
}

export function createAdminFetch(logger) {
  return async function adminFetch(pathTemplate, params = {}, options = {}) {
    const path = resolvePath(pathTemplate, params);
    const url = `${ADMIN_API_BASE}${path}`;
    const method = options.method || 'GET';
    const resp = await fetch(url, options);
    if (logger) {
      logger(resp.status, [method, url, resp.headers.get('x-error') || '']);
    }
    return resp;
  };
}
