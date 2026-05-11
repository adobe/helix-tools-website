import { PSI_STORAGE_KEY, FAVORITES_STORAGE_KEY } from './constants.js';

// Re-export shared utilities from card-ui
export { loadIcon, icon, showToast } from '../../../utils/card-ui/card-ui.js';

export const getFavorites = (orgValue) => {
  const stored = localStorage.getItem(`${FAVORITES_STORAGE_KEY}-${orgValue}`);
  return stored ? JSON.parse(stored) : [];
};

const setFavorites = (orgValue, favorites) => {
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

export const buildSiteConfig = (site, codeSrc, contentSrc, byogit = null) => {
  let code;
  if (byogit) {
    code = {
      owner: byogit.owner,
      repo: byogit.repo,
      source: {
        type: 'byogit',
        url: 'https://cm-repo.adobe.io/api',
        raw_url: 'https://cm-repo.adobe.io/api/raw',
        owner: byogit.owner,
        repo: byogit.repo,
        secretId: 'cm-byog',
      },
    };
  } else {
    const codeURL = new URL(codeSrc);
    const [, owner, repo] = codeURL.pathname.split('/');
    code = { owner, repo, source: { type: 'github', url: codeSrc } };
  }
  const content = { source: { type: 'markup', url: contentSrc } };

  if (contentSrc.startsWith('https://drive.google.com/drive')) {
    const contentURL = new URL(contentSrc);
    content.source.type = 'google';
    content.source.id = contentURL.pathname.split('/').pop();
  }

  if (contentSrc.includes('sharepoint.com/')) {
    content.source.type = 'onedrive';
  }

  return { ...site, content, code };
};

export const compareSites = (a, b, selectedSite, favorites) => {
  if (selectedSite) {
    if (a.name === selectedSite) return -1;
    if (b.name === selectedSite) return 1;
  }
  const aFav = favorites.includes(a.name);
  const bFav = favorites.includes(b.name);
  if (aFav && !bFav) return -1;
  if (!aFav && bFav) return 1;
  return a.name.localeCompare(b.name);
};

// DA Editor URL helper
export const getDAEditorURL = (contentUrl) => {
  if (!contentUrl) return null;

  if (contentUrl.startsWith('https://content.da.live/') || contentUrl.startsWith('https://stage-content.da.live/')) {
    const path = contentUrl.replace(/^https:\/\/(stage-)?content\.da\.live\//, '');
    return `https://da.live/#/${path}`;
  }

  return contentUrl;
};
