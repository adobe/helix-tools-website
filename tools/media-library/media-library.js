import {
  processMediaData,
  computeResultSummary,
  filterMedia,
  initializeProcessedData,
} from './features/filters.js';
import { sortMediaData } from './core/utils.js';
import {
  getAppState,
  updateAppState,
  onStateChange,
  showNotification,
  dismissNotification,
} from './core/state.js';
import t from './core/messages.js';
import { MediaLibraryError, ErrorCodes, logMediaLibraryError } from './core/errors.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import {
  getMetadata,
  getMediaData,
  saveMediaData,
  saveMetadata,
  isIncrementalEligible,
  incrementalTimeParams,
  createIndexLock,
  checkIndexLock,
  removeIndexLock,
} from './core/storage.js';
import { getDedupeKey } from './core/urls.js';
import { fetchAllMediaLog } from './indexing/medialog-api.js';
import { fetchAllAuditLog } from './indexing/auditlog-api.js';
import {
  buildMediaDataFromEntries,
  fetchAndBuildMediaData,
  validatePathWithStatus,
} from './indexing/build.js';

import createMediaInfoModal from './views/mediainfo/mediainfo.js';
import { setMediaLibraryContext } from './core/context.js';
import { loadView } from './core/views.js';

const PROGRESSIVE_DISPLAY_CAP = 3000;
const PROGRESSIVE_UPDATE_THROTTLE_MS = 100;

const FILTER_KEYS = new Set(['all', 'documents', 'fragments', 'images', 'icons', 'links', 'videos', 'noReferences']);
const URL_FILTER_TO_KEY = { 'no-references': 'noReferences' };
const FILTER_KEY_TO_URL = { noReferences: 'no-references' };

let mediaInfoModal = null;

function getFilteredMediaData() {
  const state = getAppState();
  if (!state.mediaData || state.mediaData.length === 0) return [];
  return filterMedia(state.rawMediaData || state.mediaData, {
    searchQuery: state.searchQuery,
    selectedDocument: state.selectedDocument,
    selectedFolder: state.selectedFolder,
    selectedFilterType: state.selectedFilterType,
    usageIndex: state.usageIndex,
    processedData: state.processedData,
  });
}

function getDisplayDataForSummary(state) {
  if (state.isIndexing && state.progressiveMediaData?.length > 0) {
    return state.progressiveMediaData;
  }
  return getFilteredMediaData();
}

function getPathFromInput() {
  const pathInput = document.getElementById('path');
  const raw = pathInput?.value?.trim() || '';
  if (raw.startsWith('/')) return raw;
  return raw ? `/${raw}` : '';
}

function syncFilterToUrl() {
  const url = new URL(window.location.href);
  const filter = getAppState().selectedFilterType;
  if (filter && filter !== 'all') {
    url.searchParams.set('filter', FILTER_KEY_TO_URL[filter] ?? filter);
  } else {
    url.searchParams.delete('filter');
  }
  window.history.replaceState({}, document.title, url.href);
}

async function init() {
  const orgInput = document.getElementById('org');
  const siteInput = document.getElementById('site');
  const pathInput = document.getElementById('path');
  const workspace = document.getElementById('workspace');
  const configEl = document.querySelector('.media-library-config');
  const configBar = document.getElementById('config-bar');
  const configBarChange = document.getElementById('config-bar-change');
  if (!orgInput || !siteInput) return;

  const searchParams = new URLSearchParams(window.location.search);
  const pathParam = searchParams.get('path');
  const filterParam = searchParams.get('filter');
  if (pathParam && pathInput) pathInput.value = pathParam;

  await initConfigField();
  mediaInfoModal = createMediaInfoModal();

  await Promise.all([
    loadView('sidebar', document.querySelector('.sidebar')),
    loadView('topbar', document.querySelector('.topbar')),
    loadView('grid', document.querySelector('.grid')),
  ]);

  const filterKey = filterParam
    ? (URL_FILTER_TO_KEY[filterParam] ?? (FILTER_KEYS.has(filterParam) ? filterParam : null))
    : null;
  if (filterKey) {
    updateAppState({ selectedFilterType: filterKey });
  }

  onStateChange(['selectedFilterType'], syncFilterToUrl);

  onStateChange(['persistentError'], (state) => {
    const banner = document.getElementById('media-persistent-banner');
    if (!banner) return;
    if (state.persistentError) {
      const escape = (s) => String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      banner.innerHTML = `
        <div class="da-persistent-banner danger">
          <div class="da-persistent-banner-header">
            <span class="da-persistent-banner-heading">${escape(t('NOTIFY_ERROR'))}</span>
            <button type="button" class="da-persistent-banner-close" aria-label="${escape(t('UI_DISMISS'))}">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <p class="da-persistent-banner-message">${escape(state.persistentError.message)}</p>
        </div>`;
      banner.hidden = false;
      banner.querySelector('.da-persistent-banner-close')?.addEventListener('click', () => {
        updateAppState({ persistentError: null });
      });
    } else {
      banner.innerHTML = '';
      banner.hidden = true;
    }
  });

  onStateChange(['notification'], (state) => {
    let toastRoot = document.getElementById('media-notification-root');
    if (!toastRoot) {
      toastRoot = document.createElement('div');
      toastRoot.id = 'media-notification-root';
      document.body.appendChild(toastRoot);
    }
    toastRoot.innerHTML = '';
    if (state.notification) {
      const { heading, message, type } = state.notification;
      const escape = (s) => String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const toast = document.createElement('div');
      toast.className = `media-notification-status ${type === 'error' || type === 'danger' ? 'danger' : 'success'}`;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      const danger = type === 'error' || type === 'danger';
      toast.innerHTML = `
        <div class="toast-notification ${danger ? 'danger' : 'success'}">
          <div class="toast-notification-header">
            <p class="media-notification-status-title">${escape(heading)}</p>
            <button type="button" class="toast-notification-close" aria-label="${escape(t('UI_DISMISS'))}">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          ${message ? `<p class="media-notification-status-description">${escape(message)}</p>` : ''}
        </div>`;
      toast.querySelector('.toast-notification-close')?.addEventListener('click', dismissNotification);
      toastRoot.appendChild(toast);
    }
  });

  setMediaLibraryContext({
    showMediaInfo: (opts) => mediaInfoModal?.show(opts),
    getOrg: () => orgInput?.value,
    getSite: () => siteInput?.value,
    getPath: () => getPathFromInput(),
  });

  async function doSetMediaData(rawData) {
    const isEmpty = !rawData || rawData.length === 0;

    if (isEmpty) {
      updateAppState({
        rawMediaData: [],
        mediaData: [],
        usageIndex: new Map(),
        folderPathsCache: new Set(),
        processedData: initializeProcessedData(),
        indexProgress: { stage: 'complete', hasChanges: false, mediaReferences: 0 },
      });
      return;
    }

    const usageIndex = new Map();
    const folderPaths = new Set();
    rawData.forEach((item) => {
      if (item.uniqueSources?.length) {
        const groupingKey = getDedupeKey(item.url);
        item.uniqueSources.forEach((docPath) => {
          if (!usageIndex.has(groupingKey)) usageIndex.set(groupingKey, []);
          usageIndex.get(groupingKey).push({ doc: docPath });
        });
      }
      if (item.folder) folderPaths.add(item.folder);
    });

    const processedData = await processMediaData(rawData);
    const sortedData = sortMediaData(rawData);
    updateAppState({
      rawMediaData: sortedData,
      mediaData: sortedData,
      usageIndex,
      folderPathsCache: folderPaths,
      processedData,
      indexProgress: { stage: 'complete', hasChanges: true, mediaReferences: rawData.length },
    });
  }

  async function loadFromCache(orgKey, siteKey, pathKey = '') {
    const cachedMediaData = await getMediaData(orgKey, siteKey, pathKey);
    if (!cachedMediaData || cachedMediaData.length === 0) {
      return false;
    }

    updateAppState({
      org: orgKey,
      site: siteKey,
      path: pathKey,
      sitePathValid: true,
      validationError: null,
    });
    await doSetMediaData(cachedMediaData);
    return true;
  }

  async function refreshIncremental(orgKey, siteKey, pathKey = '') {
    const metadata = getMetadata(orgKey, siteKey, pathKey);
    if (!isIncrementalEligible(metadata)) return;

    try {
      if (!(await ensureLogin(orgKey, siteKey))) return;

      const cachedMediaData = await getMediaData(orgKey, siteKey, pathKey);
      const timeParams = incrementalTimeParams(metadata.lastFetchTime);

      const [newMedialog, newAuditlog] = await Promise.all([
        fetchAllMediaLog(orgKey, siteKey, timeParams),
        fetchAllAuditLog(orgKey, siteKey, timeParams),
      ]);

      if (newMedialog.length === 0 && newAuditlog.length === 0) return;

      const newMediaData = await buildMediaDataFromEntries(
        newMedialog,
        newAuditlog,
        orgKey,
        siteKey,
        null,
        null,
        pathKey,
      );

      const mergedMap = new Map();
      [...cachedMediaData, ...newMediaData].forEach((item) => {
        const key = getDedupeKey(item.url);
        const existing = mergedMap.get(key);
        if (!existing || (item.timestamp ?? 0) > (existing.timestamp ?? 0)) {
          mergedMap.set(key, item);
        }
      });
      const mergedMediaData = Array.from(mergedMap.values());

      const savedData = await saveMediaData(orgKey, siteKey, mergedMediaData, pathKey);
      await saveMetadata(orgKey, siteKey, {
        lastFetchTime: Date.now(),
        lastBuildMode: 'incremental',
        mediaCount: savedData.length,
      }, pathKey);

      await doSetMediaData(savedData);
    } catch {
      // ignore
    }
  }

  async function loadMediaData(orgKey, siteKey, pathKey = '') {
    updateAppState({
      org: orgKey,
      site: siteKey,
      path: pathKey,
      isValidating: true,
      sitePathValid: false,
      validationError: null,
    });

    let cancelProgressiveThrottle = () => {};
    try {
      const isLoggedIn = await ensureLogin(orgKey, siteKey);
      if (!isLoggedIn) {
        logMediaLibraryError(ErrorCodes.AUTH_REQUIRED, { context: 'build' });
        showNotification(t('NOTIFY_ERROR'), t('AUTH_REQUIRED'), 'danger');
        updateAppState({
          isValidating: false,
          validationError: t('AUTH_REQUIRED'),
          sitePathValid: false,
        });
        const onProfileUpdate = async () => {
          window.removeEventListener('profile-update', onProfileUpdate);
          if (await ensureLogin(orgKey, siteKey)) {
            updateAppState({ validationError: null });
            loadMediaData(orgKey, siteKey, pathKey);
          }
        };
        window.addEventListener('profile-update', onProfileUpdate);
        return;
      }
      updateAppState({ sitePathValid: true, validationError: null });

      if (checkIndexLock(orgKey, siteKey, pathKey)) {
        updateAppState({
          isValidating: false,
          validationError: 'Index build in progress. Please try again shortly.',
        });
        return;
      }
      createIndexLock(orgKey, siteKey, pathKey);

      const metadata = getMetadata(orgKey, siteKey, pathKey);
      const cachedData = await getMediaData(orgKey, siteKey, pathKey);
      const hasCache = cachedData && cachedData.length > 0;
      const incremental = isIncrementalEligible(metadata) && hasCache;

      let statusResourcesForBuild = null;
      if (pathKey && !incremental) {
        statusResourcesForBuild = validatePathWithStatus(
          orgKey,
          siteKey,
          pathKey,
          (p) => updateAppState({ indexProgress: p }),
        ).then((r) => r.statusResources);
      }

      updateAppState({ isValidating: false, isIndexing: true, progressiveMediaData: [] });

      const indexStartTime = Date.now();
      // eslint-disable-next-line no-console -- index lifecycle: start (always logged)
      console.log(`[Media Library] Index started at ${new Date(indexStartTime).toISOString()}`);

      const progressiveMap = new Map();
      let throttleTimer = null;
      let progressiveDirty = false;
      cancelProgressiveThrottle = () => {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
      };
      let lastProgressiveCount = 0;
      const flushProgressive = () => {
        cancelProgressiveThrottle();
        const toEmit = Array.from(progressiveMap.values());

        // Use insertion order during indexing to avoid cards jumping when new items arrive.
        // Final build will apply proper sort.
        if (!progressiveDirty && toEmit.length === lastProgressiveCount && toEmit.length > 0) {
          return;
        }
        lastProgressiveCount = toEmit.length;
        progressiveDirty = false;

        const capped = toEmit.length > PROGRESSIVE_DISPLAY_CAP
          ? toEmit.slice(0, PROGRESSIVE_DISPLAY_CAP)
          : toEmit;
        updateAppState({ progressiveMediaData: capped });
      };
      const onProgressiveData = (items) => {
        if (!items?.length) return;
        items.forEach((item) => {
          const key = getDedupeKey(item?.url || item?.path || '');
          if (!key || key.length < 2) return; // Skip invalid/empty keys (e.g. url='"')
          const existing = progressiveMap.get(key);
          if (!existing || (item.timestamp ?? 0) >= (existing.timestamp ?? 0)) {
            progressiveMap.set(key, item);
            progressiveDirty = true;
          }
        });
        if (throttleTimer) clearTimeout(throttleTimer);
        throttleTimer = setTimeout(flushProgressive, PROGRESSIVE_UPDATE_THROTTLE_MS);
      };

      if (hasCache) {
        onProgressiveData(cachedData);
      }

      const { mediaData, buildMode, perf } = await fetchAndBuildMediaData(orgKey, siteKey, {
        incremental,
        metadata,
        path: pathKey,
        onProgress: (p) => updateAppState({ indexProgress: p }),
        onProgressiveData,
        statusResources: statusResourcesForBuild,
      });

      const indexEndTime = Date.now();
      const indexDurationSec = Math.round((indexEndTime - indexStartTime) / 1000);
      const pagesParsed = perf?.markdownParse?.pages ?? 0;
      // eslint-disable-next-line no-console -- index lifecycle (start/end times, duration, pages)
      console.log(`[Media Library] Index done: ${indexDurationSec}s, ${pagesParsed} pages (started: ${new Date(indexStartTime).toISOString()}, ended: ${new Date(indexEndTime).toISOString()})`);

      const finalMediaData = incremental && hasCache
        ? (() => {
          const mergedMap = new Map();
          [...cachedData, ...mediaData].forEach((item) => {
            const key = getDedupeKey(item.url);
            const existing = mergedMap.get(key);
            if (!existing || (item.timestamp ?? 0) > (existing.timestamp ?? 0)) {
              mergedMap.set(key, item);
            }
          });
          return Array.from(mergedMap.values());
        })()
        : mediaData;

      const sortedData = sortMediaData(finalMediaData);
      const savedData = await saveMediaData(orgKey, siteKey, sortedData, pathKey);
      await saveMetadata(orgKey, siteKey, {
        lastFetchTime: Date.now(),
        lastBuildMode: buildMode,
        mediaCount: savedData.length,
      }, pathKey);
      removeIndexLock(orgKey, siteKey, pathKey);
      cancelProgressiveThrottle();
      await doSetMediaData(sortedData);
      updateAppState({ isIndexing: false, progressiveMediaData: [] });
    } catch (error) {
      removeIndexLock(orgKey, siteKey, pathKey);
      cancelProgressiveThrottle();
      if (error instanceof MediaLibraryError) {
        const toastCodes = [
          ErrorCodes.EDS_AUTH_EXPIRED,
          ErrorCodes.EDS_LOG_DENIED,
          ErrorCodes.AUTH_REQUIRED,
        ];
        const noToastCodes = [ErrorCodes.VALIDATION_PATH_NOT_FOUND];
        if (toastCodes.includes(error.code)) {
          showNotification(t('NOTIFY_ERROR'), error.message, 'danger');
        } else if (!noToastCodes.includes(error.code)) {
          logMediaLibraryError(ErrorCodes.BUILD_FAILED, { error: error?.message });
          showNotification(t('NOTIFY_ERROR'), t('BUILD_FAILED'), 'danger');
        }
      } else {
        logMediaLibraryError(ErrorCodes.BUILD_FAILED, { error: error?.message });
        const isAuth = error?.message?.includes('Authentication') || error?.message?.includes('401');
        const message = isAuth ? t('EDS_AUTH_EXPIRED') : (error?.message || t('BUILD_FAILED'));
        showNotification(t('NOTIFY_ERROR'), message, 'danger');
      }
      updateAppState({
        isValidating: false,
        validationError: error?.message || t('BUILD_FAILED'),
        sitePathValid: false,
        isIndexing: false,
        progressiveMediaData: [],
        persistentError: null,
      });
    }
    updateAppState({ isValidating: false });
  }

  const form = document.getElementById('media-library-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const org = orgInput.value?.trim();
    const site = siteInput.value?.trim();
    const path = getPathFromInput();
    if (!org || !site) return;
    updateConfig();
    const url = new URL(window.location.href);
    if (path) url.searchParams.set('path', path);
    else url.searchParams.delete('path');
    const filter = getAppState().selectedFilterType;
    if (filter && filter !== 'all') url.searchParams.set('filter', FILTER_KEY_TO_URL[filter] ?? filter);
    else url.searchParams.delete('filter');
    window.history.replaceState({}, document.title, url.href);
    loadMediaData(org, site, path);
  });

  function handleChangeSite() {
    configEl?.classList.remove('form-collapsed');
    configBar?.setAttribute('hidden', '');
    workspace?.setAttribute('hidden', '');
    updateAppState({
      rawMediaData: [],
      mediaData: [],
      usageIndex: new Map(),
      folderPathsCache: new Set(),
      processedData: initializeProcessedData(),
      indexProgress: { stage: 'complete', hasChanges: false, mediaReferences: 0 },
      org: null,
      site: null,
      path: null,
      validationError: null,
    });
  }

  form?.addEventListener('reset', () => {
    updateAppState({ validationError: null });
  });

  configBarChange?.addEventListener('click', handleChangeSite);
  window.addEventListener('media-library:change-site', handleChangeSite);

  function updateWorkspaceVisibility(state) {
    const hasData = (state.mediaData?.length ?? 0) > 0;
    const isIndexing = state.isIndexing === true;
    const showWorkspace = hasData || isIndexing;
    if (workspace) {
      if (showWorkspace) workspace.removeAttribute('hidden');
      else workspace.setAttribute('hidden', '');
    }
    document.body.classList.toggle('workspace-active', showWorkspace);
    if (configEl) {
      if (showWorkspace) {
        configEl.classList.add('form-collapsed');
        configEl.setAttribute('hidden', '');
      } else {
        configEl.classList.remove('form-collapsed');
        configEl.removeAttribute('hidden');
        if (configBar) configBar.setAttribute('hidden', '');
      }
    }
  }

  onStateChange(
    ['mediaData', 'isIndexing', 'org', 'site', 'path'],
    updateWorkspaceVisibility,
  );

  onStateChange(['validationError'], (state) => {
    const el = document.getElementById('form-validation-error');
    if (!el) return;
    if (state.validationError) {
      el.textContent = state.validationError;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  });

  const loadBtn = document.getElementById('load-media');
  onStateChange(['isValidating'], (state) => {
    if (!loadBtn) return;
    const loading = state.isValidating === true;
    const textSpan = loadBtn.querySelector('.load-btn-text');
    const loadingSpan = loadBtn.querySelector('.load-btn-loading');
    loadBtn.disabled = loading;
    if (textSpan) textSpan.hidden = loading;
    if (loadingSpan) loadingSpan.hidden = !loading;
  });

  const initialOrg = orgInput.value?.trim();
  const initialSite = siteInput.value?.trim();
  const initialPath = getPathFromInput();
  if (initialOrg && initialSite) {
    loadFromCache(initialOrg, initialSite, initialPath).then((hadCache) => {
      if (hadCache) {
        refreshIncremental(initialOrg, initialSite, initialPath);
      }
    });
  }
  updateWorkspaceVisibility(getAppState());

  const unsubscribe = onStateChange(
    [
      'mediaData',
      'rawMediaData',
      'progressiveMediaData',
      'searchQuery',
      'selectedDocument',
      'selectedFolder',
      'selectedFilterType',
      'usageIndex',
      'processedData',
      'isIndexing',
    ],
    (state) => {
      const displayData = getDisplayDataForSummary(state);
      const summaryOpts = state.isIndexing && state.progressiveMediaData?.length > 0
        ? { displayCount: displayData.length }
        : {};
      const resultSummary = computeResultSummary(
        state.mediaData,
        displayData,
        state.searchQuery,
        state.selectedFilterType,
        summaryOpts,
      );
      if (resultSummary !== state.resultSummary) {
        updateAppState({ resultSummary });
      }
    },
  );

  registerToolReady(Promise.resolve(unsubscribe));

  // Auto-load if org and site are in URL params
  const orgParam = searchParams.get('org');
  const siteParam = searchParams.get('site');
  if (orgParam && siteParam) {
    // Pre-populate form fields
    orgInput.value = orgParam;
    siteInput.value = siteParam;
    if (pathParam && pathInput) {
      pathInput.value = pathParam;
    }

    // Auto-load immediately (DOM is ready since module scripts are deferred)
    const path = getPathFromInput();
    loadMediaData(orgParam, siteParam, path);
  }
}

init();
