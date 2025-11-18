/* eslint-disable no-await-in-loop */
/* eslint-disable no-alert */
/* eslint-disable no-console */

const CONFIG = {
  CORS_PROXY_URL: 'https://little-forest-58aa.david8603.workers.dev/',
  DEFAULT_STORAGE: 'indexeddb',
  DEFAULT_MODE: 'site-url',
  MEDIA_LIBRARY_READY_EVENT: 'media-library-ready',
  STORAGE_TYPES: {
    INDEXED_DB: 'indexeddb',
    NONE: 'none',
  },
  MODES: {
    SITE_URL: 'site-url',
    SITEMAP_URL: 'sitemap-url',
  },
};

const SELECTORS = {
  MEDIA_LIBRARY: '#media-library',
  SITE_URL_INPUT: '#site-url',
  SITEMAP_INPUT: '#sitemap-url',
  START_SCAN_BUTTON: '#start-new-scan',
  SAVED_SITES_SELECT: '#saved-sites',
  CLEAR_SITE_BUTTON: '#clear-site-data',
  MEDIA_CONFIG_FORM: '#media-config-form',
};

const domCache = {
  mediaLibrary: null,
  siteUrlInput: null,
  sitemapInput: null,
  startScanButton: null,
  savedSitesSelect: null,
  clearSiteButton: null,
  form: null,

  init() {
    this.mediaLibrary = document.querySelector(SELECTORS.MEDIA_LIBRARY);
    this.siteUrlInput = document.querySelector(SELECTORS.SITE_URL_INPUT);
    this.sitemapInput = document.querySelector(SELECTORS.SITEMAP_INPUT);
    this.startScanButton = document.querySelector(SELECTORS.START_SCAN_BUTTON);
    this.savedSitesSelect = document.querySelector(SELECTORS.SAVED_SITES_SELECT);
    this.clearSiteButton = document.querySelector(SELECTORS.CLEAR_SITE_BUTTON);
    this.form = document.querySelector(SELECTORS.MEDIA_CONFIG_FORM);
  },
};

function getFormData() {
  const siteUrl = domCache.siteUrlInput?.value?.trim() || '';
  const sitemapUrl = domCache.sitemapInput?.value?.trim() || '';

  let mode = CONFIG.DEFAULT_MODE;
  if (sitemapUrl) {
    mode = CONFIG.MODES.SITEMAP_URL;
  } else if (siteUrl) {
    mode = CONFIG.MODES.SITE_URL;
  }

  return {
    mode,
    siteUrl,
    sitemapUrl,
  };
}

function validateRequiredFields(data) {
  if (!data.siteUrl && !data.sitemapUrl) {
    throw new Error('Please enter either a Website URL or Sitemap URL');
  }
}

function createSiteKey(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return url.replace(/[^a-zA-Z0-9-]/g, '_');
  }
}

function getStorageType() {
  return CONFIG.DEFAULT_STORAGE;
}

function handleError(error) {
  const message = error.message || 'Unknown error occurred';
  alert(`Error: ${message}`);
}

function setupStorageManager(mediaLibrary, siteKey) {
  if (mediaLibrary.storageManager) {
    mediaLibrary.storageManager.siteKey = siteKey;
    mediaLibrary.storageManager.dbName = siteKey ? `media_${mediaLibrary.storageManager.normalizeSiteKey(siteKey)}` : 'MediaLibrary';
  }
}

function updateClearButtonVisibility(show) {
  if (show) {
    domCache.clearSiteButton.style.display = 'inline-flex';
  } else {
    domCache.clearSiteButton.style.display = 'none';
  }
}

function setMediaLibraryAttributes(mediaLibrary, siteKey, storageType) {
  mediaLibrary.siteKey = siteKey;
  mediaLibrary.setAttribute('site-key', siteKey);
  mediaLibrary.setAttribute('data-site-key', siteKey);

  if (mediaLibrary.storage !== storageType) {
    mediaLibrary.storage = storageType;
    mediaLibrary.setAttribute('storage', storageType);
  }
}

async function initializeMediaLibrary(mediaLibrary) {
  try {
    await mediaLibrary.initialize();
  } catch (error) {
    handleError(error);
    throw error;
  }
}

async function loadAvailableSites() {
  try {
    if (!domCache.mediaLibrary?.storageManager) {
      return;
    }

    const allSites = await domCache.mediaLibrary.storageManager.getAllSites();

    // Filter out sites with 0 references
    const sites = allSites.filter((site) => site.itemCount > 0);

    domCache.savedSitesSelect.innerHTML = '<option value="">Select a site...</option>';

    if (sites.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved sites';
      option.disabled = true;
      domCache.savedSitesSelect.appendChild(option);
      return;
    }

    sites.forEach((site) => {
      const option = document.createElement('option');
      option.value = site.siteKey;
      option.textContent = `${site.siteKey} (${site.itemCount} refs)`;
      domCache.savedSitesSelect.appendChild(option);
    });

    domCache.savedSitesSelect.value = '';
    updateClearButtonVisibility(false);
  } catch (error) {
    console.error('Failed to load available sites:', error);
  }
}

async function fetchSitemap(sitemapURL) {
  const fetchUrl = `${CONFIG.CORS_PROXY_URL}?url=${encodeURIComponent(sitemapURL)}`;

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Not found: ${sitemapURL}`);
    throw new Error('Failed on initial fetch of sitemap.', res.status);
  }

  const xml = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const urls = [];

  const sitemapLocs = doc.querySelectorAll('sitemap > loc');
  const sitemapPromises = Array.from(sitemapLocs).map(async (loc) => {
    const liveUrl = new URL(loc.textContent);
    return fetchSitemap(liveUrl);
  });
  const sitemapResults = await Promise.all(sitemapPromises);
  sitemapResults.forEach((result) => {
    urls.push(...result);
  });

  const urlLocs = doc.querySelectorAll('url > loc');
  for (let i = 0; i < urlLocs.length; i += 1) {
    const loc = urlLocs[i];
    const url = new URL(loc.textContent);
    urls.push(url);
  }

  return urls;
}

function normalizeUrl(url) {
  if (!url) return url;
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  return normalizedUrl;
}

async function waitForMediaLibraryReady(mediaLibrary) {
  return new Promise((resolve) => {
    if (mediaLibrary.ready) {
      resolve();
      return;
    }

    const handleReady = () => {
      mediaLibrary.removeEventListener(CONFIG.MEDIA_LIBRARY_READY_EVENT, handleReady);
      resolve();
    };

    mediaLibrary.addEventListener(CONFIG.MEDIA_LIBRARY_READY_EVENT, handleReady);
  });
}

export async function setupMediaLibrary() {
  await customElements.whenDefined('media-library');

  if (domCache.mediaLibrary) {
    domCache.mediaLibrary.corsProxy = CONFIG.CORS_PROXY_URL;
  }
}

async function discoverContent(inputUrl, mode) {
  try {
    const normalizedUrl = normalizeUrl(inputUrl);
    let sitemapUrl;

    if (mode === CONFIG.MODES.SITEMAP_URL) {
      sitemapUrl = normalizedUrl;
    } else {
      const baseUrl = normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;
      sitemapUrl = `${baseUrl}/sitemap.xml`;
    }

    const fetchedUrls = await fetchSitemap(sitemapUrl);
    return fetchedUrls.map((url) => ({
      loc: url.href,
      lastmod: new Date().toISOString(),
    }));
  } catch (error) {
    throw new Error(`Failed to fetch sitemap: ${error.message}`);
  }
}

async function validateAndPrepareScan() {
  const formData = getFormData();
  validateRequiredFields(formData);
  return formData;
}

async function configureMediaLibrary(formData) {
  const url = formData.mode === CONFIG.MODES.SITE_URL ? formData.siteUrl : formData.sitemapUrl;
  const siteKey = createSiteKey(url);
  const storageType = getStorageType();

  domCache.mediaLibrary.mode = formData.mode;
  setMediaLibraryAttributes(domCache.mediaLibrary, siteKey, storageType);

  setupStorageManager(domCache.mediaLibrary, siteKey);
  await waitForMediaLibraryReady(domCache.mediaLibrary);
  await initializeMediaLibrary(domCache.mediaLibrary);
}

async function performScan(formData) {
  const url = formData.mode === CONFIG.MODES.SITE_URL ? formData.siteUrl : formData.sitemapUrl;
  const pageList = await discoverContent(url, formData.mode);

  if (!pageList || pageList.length === 0) {
    throw new Error('No pages found to scan');
  }

  const siteKey = createSiteKey(url);
  const mediaData = await domCache.mediaLibrary.loadFromPageList(
    pageList,
    null,
    siteKey,
    false, // Don't save inside loadFromPageList, we save explicitly in saveResults()
    null,
    pageList,
    [],
  );

  return mediaData;
}

async function saveResults(mediaData) {
  if (mediaData.length > 0) {
    try {
      if (domCache.mediaLibrary.storageManager) {
        await domCache.mediaLibrary.storageManager.save(mediaData);
      } else {
        throw new Error('Storage manager not available. Data will not be saved.');
      }
    } catch (error) {
      handleError(error);
    }
  }

  await loadAvailableSites();
}

export async function startScan() {
  try {
    const formData = await validateAndPrepareScan();
    if (!formData) return;

    await configureMediaLibrary(formData);
    const mediaData = await performScan(formData);
    await saveResults(mediaData);
  } catch (error) {
    handleError(error);
  }
}

async function loadSelectedSite() {
  try {
    const siteKey = domCache.savedSitesSelect.value;

    if (!siteKey) {
      updateClearButtonVisibility(false);
      await domCache.mediaLibrary.clearData();
      return;
    }

    const storageType = getStorageType();

    setMediaLibraryAttributes(domCache.mediaLibrary, siteKey, storageType);

    try {
      await domCache.mediaLibrary.initialize();
    } catch (error) {
      handleError(error);
      return;
    }

    setupStorageManager(domCache.mediaLibrary, siteKey);

    if (!domCache.mediaLibrary.storageManager) {
      throw new Error('Storage manager not available. Cannot load previous scan data.');
    }

    try {
      const existingData = await domCache.mediaLibrary.storageManager.load();
      if (existingData && existingData.length > 0) {
        await domCache.mediaLibrary.loadMediaData(existingData, siteKey, false, null);
        updateClearButtonVisibility(true);
      } else {
        handleError(new Error('No previous scan data found'));
        updateClearButtonVisibility(false);
      }
    } catch (error) {
      handleError(error);
      updateClearButtonVisibility(false);
    }
  } catch (error) {
    handleError(error);
    updateClearButtonVisibility(false);
  }
}

async function clearSelectedSiteData() {
  const siteKey = domCache.savedSitesSelect.value;

  if (!siteKey) {
    alert('Please select a site to clear.');
    return;
  }

  // eslint-disable-next-line no-restricted-globals -- User confirmation needed
  if (!confirm(`Are you sure you want to clear data for "${siteKey}"? This action cannot be undone.`)) {
    return;
  }

  if (!domCache.mediaLibrary?.storageManager) {
    alert('Storage manager not available.');
    return;
  }

  try {
    setupStorageManager(domCache.mediaLibrary, siteKey);

    await domCache.mediaLibrary.clearData();

    if (domCache.mediaLibrary.storageManager.type === CONFIG.STORAGE_TYPES.INDEXED_DB) {
      await domCache.mediaLibrary.storageManager.deleteSite(siteKey);
    }

    domCache.savedSitesSelect.value = '';
    updateClearButtonVisibility(false);

    await loadAvailableSites();
  } catch (error) {
    const isBlockedError = error.message.includes('Database deletion blocked')
      || error.message.includes('blocked')
      || error.name === 'TransactionInactiveError';

    if (isBlockedError) {
      console.error('Database deletion blocked:', error);
      alert('Unable to clear data right now. Please wait 10-15 seconds and try again, or refresh the page.');
    } else {
      handleError(error);
    }
  }
}

function setupEventDelegation() {
  document.addEventListener('click', (event) => {
    const { target } = event;

    if (target.matches(SELECTORS.START_SCAN_BUTTON)) {
      startScan();
    } else if (target.matches(SELECTORS.CLEAR_SITE_BUTTON)) {
      clearSelectedSiteData();
    }
  });

  document.addEventListener('change', (event) => {
    const { target } = event;

    if (target.matches(SELECTORS.SAVED_SITES_SELECT)) {
      loadSelectedSite();
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.matches(SELECTORS.MEDIA_CONFIG_FORM)) {
      event.preventDefault();
    }
  });
}

export async function initializeEventListeners() {
  setupEventDelegation();

  const params = new URLSearchParams(window.location.search);
  const siteUrlParam = params.get('site-url');
  const sitemapParam = params.get('sitemap-url');

  if (siteUrlParam && domCache.siteUrlInput) {
    domCache.siteUrlInput.value = siteUrlParam;
  }

  if (sitemapParam && domCache.sitemapInput) {
    domCache.sitemapInput.value = sitemapParam;
  }

  await loadAvailableSites();
}

export async function initialize() {
  try {
    domCache.init();
    await setupMediaLibrary();
    await initializeEventListeners();
  } catch (error) {
    handleError(error);
  }
}
