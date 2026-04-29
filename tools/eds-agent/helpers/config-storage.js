import { STORAGE_KEYS } from './constants.js';

export function getConfig() {
  return {
    authToken: localStorage.getItem(STORAGE_KEYS.TOKEN) || '',
    org: localStorage.getItem(STORAGE_KEYS.ORG) || '',
    site: localStorage.getItem(STORAGE_KEYS.SITE) || '',
    domainkey: localStorage.getItem(STORAGE_KEYS.DOMAINKEY) || '',
  };
}

export function saveConfig(token, org, site, domainkey = '') {
  localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  localStorage.setItem(STORAGE_KEYS.ORG, org);
  localStorage.setItem(STORAGE_KEYS.SITE, site);
  if (domainkey) {
    localStorage.setItem(STORAGE_KEYS.DOMAINKEY, domainkey);
  } else {
    localStorage.removeItem(STORAGE_KEYS.DOMAINKEY);
  }
}

export function getSidebarCollapsed() {
  return localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === '1';
}

export function setSidebarCollapsed(collapsed) {
  if (collapsed) {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, '1');
    document.body.classList.add('eds-sidebar-collapsed');
  } else {
    localStorage.removeItem(STORAGE_KEYS.SIDEBAR_COLLAPSED);
    document.body.classList.remove('eds-sidebar-collapsed');
  }
}
