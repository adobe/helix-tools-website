import { PSI_STORAGE_KEY, FAVORITES_STORAGE_KEY } from './constants.js';

const ICONS = {};

export const loadIcon = async (name) => {
  if (ICONS[name]) return ICONS[name];
  try {
    const resp = await fetch(`${window.hlx.codeBasePath}/icons/${name}.svg`);
    if (resp.ok) {
      ICONS[name] = await resp.text();
      return ICONS[name];
    }
  } catch (e) {
    // nada.
  }
  return '';
};

export const icon = (name) => ICONS[name] || '';

export const getFavorites = (orgValue) => {
  const stored = localStorage.getItem(`${FAVORITES_STORAGE_KEY}-${orgValue}`);
  return stored ? JSON.parse(stored) : [];
};

export const setFavorites = (orgValue, favorites) => {
  localStorage.setItem(`${FAVORITES_STORAGE_KEY}-${orgValue}`, JSON.stringify(favorites));
};

export const isFavorite = (orgValue, siteName) => getFavorites(orgValue).includes(siteName);

export const toggleFavorite = (orgValue, siteName) => {
  const favorites = getFavorites(orgValue);
  const index = favorites.indexOf(siteName);

  if (index === -1) {
    favorites.push(siteName);
  } else {
    favorites.splice(index, 1);
  }

  setFavorites(orgValue, favorites);
  return index === -1;
};

export const showToast = (message, type = 'success') => {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.classList.add('toast-notification', type);
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

export const getContentSourceType = (contentUrl, contentSourceType, isLoading = false) => {
  if (isLoading) return { type: 'loading', label: '...' };
  if (!contentSourceType && !contentUrl) return { type: 'unknown', label: '?' };

  const sourceTypeLookup = {
    google: { type: 'google', label: 'Google Drive' },
    onedrive: { type: 'sharepoint', label: 'Sharepoint' },
  };

  if (sourceTypeLookup[contentSourceType]) {
    return sourceTypeLookup[contentSourceType];
  }

  if (contentSourceType === 'markup') {
    if (contentUrl?.startsWith('https://content.da.live')) {
      return { type: 'da', label: 'DA' };
    }

    if (contentUrl?.includes('adobeaemcloud')) {
      return { type: 'aem', label: 'AEM' };
    }

    return { type: 'byom', label: 'BYOM' };
  }

  return { type: 'unknown', label: '?' };
};

export const getPsiScores = () => {
  try {
    return JSON.parse(localStorage.getItem(PSI_STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
};

export const savePsiScores = (scores) => {
  localStorage.setItem(PSI_STORAGE_KEY, JSON.stringify(scores));
};

export const formatDate = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const formatTimestamp = (ts) => {
  const date = new Date(ts);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const getScoreClass = (score) => {
  if (score >= 90) return 'good';
  if (score >= 50) return 'average';
  return 'poor';
};

export const isExpired = (expirationDate) => {
  if (!expirationDate) return false;
  return new Date(expirationDate) < new Date();
};

// DA Editor URL helper
export const getDAEditorURL = (contentUrl) => {
  if (!contentUrl) return null;

  if (contentUrl.startsWith('https://content.da.live/') || contentUrl.startsWith('https://stage-content.da.live/')) {
    const path = contentUrl.replace('https://content.da.live/', '');
    return `https://da.live/#/${path}`;
  }

  return contentUrl;
};
