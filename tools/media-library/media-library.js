/**
 * Media Library - Main controller.
 * Config, data loading, context, and view initialization.
 */

import {
  processMediaData,
  computeResultSummary,
  filterMedia,
  initializeProcessedData,
} from './features/filters.js';
import {
  getAppState,
  updateAppState,
  onStateChange,
} from './core/state.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import {
  getMetadata,
  getMediaData,
  saveMediaData,
  saveMetadata,
  isIncrementalEligible,
  getIncrementalTimeBounds,
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
} from './indexing/build.js';

import createMediaInfoModal from './views/mediainfo/mediainfo.js';
import { setMediaLibraryContext } from './core/context.js';
import { loadView } from './core/views.js';

const PROGRESSIVE_DISPLAY_CAP = 3000;

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

async function init() {
  const orgInput = document.getElementById('org');
  const siteInput = document.getElementById('site');
  if (!orgInput || !siteInput) return;

  await initConfigField();
  mediaInfoModal = createMediaInfoModal();

  // Load views
  await Promise.all([
    loadView('sidebar', document.querySelector('.sidebar')),
    loadView('topbar', document.querySelector('.topbar')),
    loadView('grid', document.querySelector('.grid')),
  ]);

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
      toast.className = 'media-notification-status';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `
        <div class="toast-notification ${type === 'error' ? 'danger' : 'success'}">
          <p class="media-notification-status-title">${escape(heading)}</p>
          ${message ? `<p class="media-notification-status-description">${escape(message)}</p>` : ''}
        </div>`;
      toastRoot.appendChild(toast);
    }
  });

  setMediaLibraryContext({
    showMediaInfo: (opts) => mediaInfoModal?.show(opts),
    getOrg: () => orgInput?.value,
    getSite: () => siteInput?.value,
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
    updateAppState({
      rawMediaData: rawData,
      mediaData: rawData,
      usageIndex,
      folderPathsCache: folderPaths,
      processedData,
      indexProgress: { stage: 'complete', hasChanges: true, mediaReferences: rawData.length },
    });
  }

  async function loadFromCache(orgKey, siteKey) {
    const cachedMediaData = await getMediaData(orgKey, siteKey);
    if (!cachedMediaData || cachedMediaData.length === 0) {
      return false;
    }

    updateAppState({
      org: orgKey,
      site: siteKey,
      sitePathValid: true,
      validationError: null,
    });
    await doSetMediaData(cachedMediaData);
    return true;
  }

  async function refreshIncremental(orgKey, siteKey) {
    const metadata = getMetadata(orgKey, siteKey);
    if (!isIncrementalEligible(metadata)) return;

    try {
      if (!(await ensureLogin(orgKey, siteKey))) return;

      const cachedMediaData = await getMediaData(orgKey, siteKey);
      const timeParams = getIncrementalTimeBounds(metadata.lastFetchTime);

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

      const savedData = await saveMediaData(orgKey, siteKey, mergedMediaData);
      await saveMetadata(orgKey, siteKey, {
        lastFetchTime: Date.now(),
        lastBuildMode: 'incremental',
        mediaCount: savedData.length,
      });

      await doSetMediaData(savedData);
    } catch (err) {
      // console.warn('[MEDIA-LIB:refreshIncremental]', err);
    }
  }

  async function loadMediaData(orgKey, siteKey) {
    updateAppState({
      org: orgKey,
      site: siteKey,
      isValidating: true,
      sitePathValid: false,
      validationError: null,
    });

    try {
      if (!(await ensureLogin(orgKey, siteKey))) {
        updateAppState({
          isValidating: false,
          validationError: 'Authentication required. Please sign in via Sidekick.',
          sitePathValid: false,
        });
        return;
      }
      updateAppState({ sitePathValid: true, validationError: null });

      if (checkIndexLock(orgKey, siteKey)) {
        updateAppState({
          isValidating: false,
          validationError: 'Index build in progress. Please try again shortly.',
        });
        return;
      }
      createIndexLock(orgKey, siteKey);

      const metadata = getMetadata(orgKey, siteKey);
      const cachedData = await getMediaData(orgKey, siteKey);
      const hasCache = cachedData && cachedData.length > 0;
      const incremental = isIncrementalEligible(metadata) && hasCache;

      updateAppState({ isValidating: false, isIndexing: true, progressiveMediaData: [] });

      const progressiveMap = new Map();
      const onProgressiveData = (items) => {
        if (!items?.length) return;
        items.forEach((item) => {
          const key = getDedupeKey(item.url);
          const existing = progressiveMap.get(key);
          if (!existing || (item.timestamp ?? 0) >= (existing.timestamp ?? 0)) {
            progressiveMap.set(key, item);
          }
        });
        const toEmit = Array.from(progressiveMap.values());
        const capped = toEmit.length > PROGRESSIVE_DISPLAY_CAP
          ? toEmit.slice(0, PROGRESSIVE_DISPLAY_CAP)
          : toEmit;
        updateAppState({ progressiveMediaData: capped });
      };

      if (hasCache) {
        onProgressiveData(cachedData);
      }

      const { mediaData, buildMode } = await fetchAndBuildMediaData(orgKey, siteKey, {
        incremental,
        metadata,
        onProgress: (p) => updateAppState({ indexProgress: p }),
        onProgressiveData,
      });

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

      const savedData = await saveMediaData(orgKey, siteKey, finalMediaData);
      await saveMetadata(orgKey, siteKey, {
        lastFetchTime: Date.now(),
        lastBuildMode: buildMode,
        mediaCount: savedData.length,
      });
      removeIndexLock(orgKey, siteKey);
      await doSetMediaData(savedData);
      updateAppState({ isIndexing: false, progressiveMediaData: [] });
    } catch (error) {
      removeIndexLock(orgKey, siteKey);
      // eslint-disable-next-line no-console
      console.error('[MEDIA-LIB:loadMediaData]', error);
      const message = error?.message?.includes('Authentication') || error?.message?.includes('401')
        ? 'Session expired or not signed in. Please sign in via Sidekick and try again.'
        : (error?.message || 'Failed to load media data. Please ensure you are signed in.');
      updateAppState({
        isValidating: false,
        validationError: message,
        sitePathValid: false,
        isIndexing: false,
        progressiveMediaData: [],
      });
    }
    updateAppState({ isValidating: false });
  }

  const form = document.getElementById('media-library-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const org = orgInput.value;
    const site = siteInput.value;
    if (!org || !site) return;
    updateConfig();
    loadMediaData(org, site);
  });

  const initialOrg = orgInput.value?.trim();
  const initialSite = siteInput.value?.trim();
  if (initialOrg && initialSite) {
    loadFromCache(initialOrg, initialSite).then((hadCache) => {
      if (hadCache) refreshIncremental(initialOrg, initialSite);
    });
  }

  const unsubscribe = onStateChange((state) => {
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
  });

  registerToolReady(Promise.resolve(unsubscribe));
}

init();
