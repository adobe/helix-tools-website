/**
 * ProductBus Admin API client
 * Shared fetch wrapper with auth and error handling
 */

import { showToast } from './ui.js';

const DEFAULT_API_BASE = 'https://api.adobecommerce.live';
const STAGE_API_BASE = 'https://api-stage.adobecommerce.live';

export function getApiBase() {
  const override = localStorage.getItem('productbus-api-url');
  if (override) return override;
  if (sessionStorage.getItem('productbus-stage') === 'true') return STAGE_API_BASE;
  return DEFAULT_API_BASE;
}

export function getAuthState(org, site) {
  try {
    const data = sessionStorage.getItem(`pbus-auth-${org}-${site}`);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

export function setAuthState(org, site, state) {
  sessionStorage.setItem(`pbus-auth-${org}-${site}`, JSON.stringify(state));
}

export function clearAuthState(org, site) {
  sessionStorage.removeItem(`pbus-auth-${org}-${site}`);
}

export async function apiFetch(org, site, path, options = {}) {
  const { skipAuthRedirect, ...fetchOptions } = options;
  const base = getApiBase();
  const url = `${base}/${org}/sites/${site}/${path}`;
  const auth = getAuthState(org, site);

  const headers = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  };

  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && !skipAuthRedirect) {
    clearAuthState(org, site);
    const params = new URLSearchParams(window.location.search);
    params.set('page', 'login');
    params.set('redirect', window.location.href);
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    throw new Error('Unauthorized');
  }

  if (response.status === 403) {
    const errorMsg = response.headers.get('x-error') || 'Forbidden';
    showToast(`${errorMsg} (${response.status})`, 'error');
    throw new Error(errorMsg);
  }

  return response;
}
