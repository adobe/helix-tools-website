/**
 * Media Library Grid view - card grid and media actions.
 * Uses virtualization for large datasets to avoid DOM bloat.
 */
import {
  getAppState,
  onStateChange,
  showNotification,
} from '../../core/state.js';
import { getMediaLibraryContext, setMediaLibraryContext } from '../../core/context.js';
import { sortMediaData, escapeAttr, safeUrlForAttr } from '../../core/utils.js';
import { filterMedia } from '../../features/filters.js';
import { copyMediaToClipboard } from '../../core/export.js';
import {
  createMediaEventHandlers,
  createUnknownPlaceholder,
  getMediaName,
} from '../../features/templates.js';
import {
  getVideoThumbnail,
  isExternalVideoUrl,
  isPdfUrl,
  isFragmentMedia,
  isSvgFile,
  getSubtype,
  isImage,
  isVideo,
} from '../../core/media.js';
import { isExternalUrl, getDedupeKey, resolveMediaUrl } from '../../core/urls.js';
import { optimizeImageUrls, CARD_IMAGE_SIZES } from '../../core/files.js';
import { MediaType } from '../../core/constants.js';

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const virtualCleanupMap = new WeakMap();
const virtualRangeMap = new WeakMap();
let renderGridRef;

const VIRTUAL_THRESHOLD = 100;
const CARD_MIN_WIDTH = 240;
const CARD_MAX_WIDTH = 350;
const GAP = 24;
const PADDING = 24;
const PREVIEW_HEIGHT = 300;
const ROW_HEIGHT = PREVIEW_HEIGHT + GAP;
const ROW_BUFFER = 2;

function getFilteredMedia(state) {
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

function getDisplayData(state) {
  const hasProgressive = state.isIndexing && state.progressiveMediaData?.length > 0;
  if (hasProgressive) {
    // Use order as-is during indexing (already sorted by URL in coordinator).
    // Re-sorting by timestamp/doc/name would move cards as data is updated.
    return state.progressiveMediaData;
  }
  return sortMediaData(getFilteredMedia(state));
}

function renderMediaPreview(media, org, site) {
  const resolvedUrl = (org && site) ? resolveMediaUrl(media?.url, org, site) : media?.url;

  if (isExternalVideoUrl(media?.url)) {
    const thumbnailUrl = getVideoThumbnail(resolvedUrl || media.url);
    const div = document.createElement('div');
    div.className = 'video-preview-container';
    const safeThumb = safeUrlForAttr(thumbnailUrl);
    div.innerHTML = thumbnailUrl && safeThumb
      ? `<img src="${safeThumb}" alt="Video thumbnail" class="video-thumbnail" loading="lazy">
         <div class="video-overlay">
           <img src="/icons/S2_Icon_Play_20_N.svg" class="play-icon" width="32" height="32" alt="" role="presentation">
         </div>`
      : `<div class="placeholder-full video-placeholder">
          <img src="/icons/S2_Icon_Play_20_N.svg" class="placeholder-icon" width="48" height="48" alt="" role="presentation">
          <span class="placeholder-label">Video</span>
        </div>`;
    return div;
  }

  if (isFragmentMedia(media)) {
    const div = document.createElement('div');
    div.className = 'placeholder-full fragment-placeholder';
    div.innerHTML = `
      <img src="/icons/C_Icon_Fragment.svg" class="placeholder-icon fragment-icon" width="40" height="40" alt="" role="presentation">
      <span class="placeholder-label">${escapeHtml(getMediaName(media))}</span>`;
    return div;
  }

  if (isImage(media.url) || (media.type === MediaType.IMAGE && isExternalUrl(media.url))) {
    const imgUrl = resolvedUrl || media.url;
    const optimized = !isExternalUrl(imgUrl) ? optimizeImageUrls(imgUrl) : null;
    if (optimized) {
      const picture = document.createElement('picture');
      picture.innerHTML = `
        <source type="image/webp" srcset="${safeUrlForAttr(optimized.webpSrcset)}" sizes="${CARD_IMAGE_SIZES}">
        <img src="${safeUrlForAttr(optimized.fallbackUrl)}" srcset="${safeUrlForAttr(optimized.fallbackSrcset)}" sizes="${CARD_IMAGE_SIZES}" alt="${escapeAttr(media.alt || '')}" loading="lazy">`;
      return picture;
    }
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = media.alt || '';
    img.loading = 'lazy';
    return img;
  }

  if (isVideo(media.url)) {
    const videoUrl = resolvedUrl || media.url;
    const safeVideoUrl = safeUrlForAttr(videoUrl);
    const div = document.createElement('div');
    div.className = 'video-preview-container';
    div.innerHTML = `
      <video src="${safeVideoUrl}" muted playsinline preload="metadata" loading="lazy" class="video-thumbnail"><source src="${safeVideoUrl}" type="video/mp4"></video>
      <div class="video-overlay">
        <img src="/icons/S2_Icon_Play_20_N.svg" class="play-icon" width="32" height="32" alt="" role="presentation">
      </div>`;
    return div;
  }

  if (isPdfUrl(media.url)) {
    const div = document.createElement('div');
    div.className = 'placeholder-full pdf-placeholder';
    const label = escapeHtml(getMediaName(media) || 'PDF');
    div.innerHTML = `
      <img src="/icons/S2_Icon_PDF_20_N.svg" class="placeholder-icon pdf-icon" width="40" height="40" alt="" role="presentation">
      <span class="placeholder-label">${label}</span>`;
    return div;
  }

  return createUnknownPlaceholder(media);
}

function createMediaCard(media, handlers, org, site) {
  const card = document.createElement('div');
  card.className = 'media-card';

  const preview = document.createElement('div');
  preview.className = 'media-preview clickable';
  preview.appendChild(renderMediaPreview(media, org, site));
  preview.addEventListener('click', () => handlers.handleMediaClick(media));

  const altHtml = media.type === MediaType.IMAGE && !isSvgFile(media) && media.alt
    ? '<div class="filled-alt-indicator" title="Has alt text">✓</div>'
    : '';

  const info = document.createElement('div');
  info.className = 'media-info clickable';
  info.innerHTML = `
    <div class="media-meta">
      <span class="media-label media-used">${media.usageCount ?? '-'}</span>
      <span class="media-label media-type" title="${getSubtype(media)}">${getSubtype(media)}</span>
    </div>
    <div class="media-actions">
      ${altHtml}
      <button type="button" class="icon-button share-button" title="Copy to clipboard" aria-label="Copy media URL">
        <img src="/icons/S2_Icon_Share_20_N.svg" class="icon" width="20" height="20" alt="" role="presentation">
      </button>
    </div>`;
  info.addEventListener('click', () => handlers.handleMediaClick(media));

  const copyBtn = info.querySelector('.share-button');
  copyBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.handleMediaCopy(media);
  });

  card.appendChild(preview);
  card.appendChild(info);
  return card;
}

function cleanupVirtual(block) {
  const cleanup = virtualCleanupMap.get(block);
  if (cleanup) {
    cleanup.scrollCleanup?.();
    cleanup.resizeObserver?.disconnect();
    virtualCleanupMap.delete(block);
  }
  virtualRangeMap.delete(block);
}

function getScrollContainer(block) {
  let el = block;
  while (el) {
    const style = getComputedStyle(el);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto') {
      return el;
    }
    el = el.parentElement;
  }
  return block.parentElement;
}

function renderVirtualGrid(block, filtered, state, handlers) {
  const scrollContainer = getScrollContainer(block);
  const containerWidth = scrollContainer.clientWidth || block.offsetWidth || 800;
  const containerHeight = scrollContainer.clientHeight || 400;
  const contentWidth = containerWidth - (PADDING * 2);
  const colsMin = Math.ceil((contentWidth + GAP) / (CARD_MAX_WIDTH + GAP));
  const colsMax = Math.floor((contentWidth + GAP) / (CARD_MIN_WIDTH + GAP));
  const cols = Math.max(1, Math.min(colsMin, colsMax));
  const totalRows = Math.ceil(filtered.length / cols);
  const totalHeight = totalRows * ROW_HEIGHT + (PADDING * 2);
  const visibleRows = Math.ceil((containerHeight + ROW_HEIGHT) / ROW_HEIGHT);
  const scrollTop = scrollContainer.scrollTop || 0;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_BUFFER);
  const endRow = Math.min(totalRows, startRow + visibleRows + (ROW_BUFFER * 2));

  const startIdx = startRow * cols;
  const endIdx = Math.min(filtered.length, endRow * cols);
  const slice = filtered.slice(startIdx, endIdx);
  const offsetY = startRow * ROW_HEIGHT + PADDING;

  const sliceContentKey = slice.length === 0
    ? '0'
    : `${slice.length}-${slice[0]?.hash ?? slice[0]?.url ?? ''}-${slice[slice.length - 1]?.hash ?? slice[slice.length - 1]?.url ?? ''}`;

  const existing = block.querySelector('.virtual-grid-root');
  if (existing) {
    const viewport = existing.querySelector('.virtual-viewport');
    const grid = existing.querySelector('.media-grid');
    const spacer = existing.querySelector('.virtual-spacer');
    if (viewport && grid && spacer) {
      const lastRange = virtualRangeMap.get(block);
      const rangeKey = `${startIdx}-${endIdx}`;
      const sameData = lastRange?.filteredLength === filtered.length
        && lastRange?.sliceContentKey === sliceContentKey;
      if (lastRange?.rangeKey === rangeKey && lastRange?.cols === cols && sameData) {
        viewport.style.transform = `translateY(${offsetY}px)`;
        return;
      }
      virtualRangeMap.set(block, {
        rangeKey,
        cols,
        filteredLength: filtered.length,
        sliceContentKey,
      });
      const newTotalHeight = totalRows * ROW_HEIGHT + (PADDING * 2);
      if (spacer.style.height !== `${newTotalHeight}px`) spacer.style.height = `${newTotalHeight}px`;
      viewport.style.transform = `translateY(${offsetY}px)`;
      viewport.style.width = '100%';
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      grid.innerHTML = '';
      slice.forEach((media) => grid.appendChild(
        createMediaCard(media, handlers, state.org, state.site),
      ));
      return;
    }
  }

  block.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'virtual-grid-root';
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.minHeight = `${totalHeight}px`;

  const spacer = document.createElement('div');
  spacer.className = 'virtual-spacer';
  spacer.style.height = `${totalHeight}px`;
  spacer.style.width = '1px';
  spacer.style.pointerEvents = 'none';
  root.appendChild(spacer);

  const viewport = document.createElement('div');
  viewport.className = 'virtual-viewport';
  viewport.style.position = 'absolute';
  viewport.style.top = '0';
  viewport.style.left = '0';
  viewport.style.right = '0';
  viewport.style.padding = `0 ${PADDING}px`;
  viewport.style.transform = `translateY(${offsetY}px)`;
  viewport.style.pointerEvents = 'auto';

  const grid = document.createElement('div');
  grid.className = 'media-grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  slice.forEach((media) => grid.appendChild(
    createMediaCard(media, handlers, state.org, state.site),
  ));
  viewport.appendChild(grid);
  root.appendChild(viewport);

  block.appendChild(root);

  let scrollRaf = null;
  let lastThrottle = 0;
  const throttleMs = 32;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      const now = Date.now();
      if (now - lastThrottle < throttleMs) return;
      lastThrottle = now;
      renderGridRef(block, getAppState());
    });
  };
  const onResize = () => renderGridRef(block, getAppState());

  scrollContainer.addEventListener('scroll', onScroll, { passive: true });

  const ro = new ResizeObserver(onResize);
  ro.observe(scrollContainer);
  const scrollCleanup = () => {
    scrollContainer.removeEventListener('scroll', onScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    ro.disconnect();
  };
  virtualCleanupMap.set(block, { scrollCleanup, resizeObserver: ro });
}

function renderGrid(block, state) {
  const ctx = getMediaLibraryContext();
  const { showMediaInfo } = ctx;
  const handleMediaCopy = async (media) => {
    const result = await copyMediaToClipboard(media);
    showNotification(result.heading, result.message, result.heading === 'Error' ? 'error' : 'success');
  };
  const handleMediaClick = (media) => {
    const key = getDedupeKey(media.url);
    const entries = state.usageIndex?.get(key) ?? [];
    const usageData = entries.map((entry) => {
      const { doc, user } = entry;
      return {
        doc,
        timestamp: entry.timestamp ?? Date.now(),
        user,
      };
    });
    showMediaInfo?.({
      media,
      usageData,
      org: state.org,
      repo: state.site,
      isIndexing: state.isIndexing,
    });
  };
  const handlers = createMediaEventHandlers({
    onMediaClick: handleMediaClick,
    onMediaCopy: handleMediaCopy,
  });

  if (!state.org || !state.site) {
    cleanupVirtual(block);
    block.innerHTML = '<div class="empty-state">'
      + '<p>Select an organization and site above to view the media library.</p></div>';
    return;
  }

  if (state.isValidating || (state.isIndexing && !state.progressiveMediaData?.length)) {
    cleanupVirtual(block);
    block.innerHTML = `
      <div class="empty-state discovering-state">
        <span class="result-count-spinner inline-spinner"></span>
        <p class="indexing-message">Discovering...</p>
      </div>`;
    return;
  }

  if (!state.sitePathValid && state.validationError) {
    cleanupVirtual(block);
    block.innerHTML = `
      <div class="error-state">
        <h3>Error</h3>
        <p>${escapeHtml(state.validationError)}</p>
      </div>`;
    return;
  }

  const displayData = getDisplayData(state);

  if (!displayData || displayData.length === 0) {
    cleanupVirtual(block);
    block.innerHTML = `
      <div class="empty-state">
        <h3>No results found</h3>
        <p>Try a different search or type selection</p>
      </div>`;
    return;
  }

  if (displayData.length <= VIRTUAL_THRESHOLD) {
    cleanupVirtual(block);
    const grid = document.createElement('div');
    grid.className = 'media-grid';
    displayData.forEach((media) => {
      grid.appendChild(createMediaCard(media, handlers, state.org, state.site));
    });
    block.innerHTML = '';
    block.appendChild(grid);
    return;
  }

  renderVirtualGrid(block, displayData, state, handlers);
}

renderGridRef = renderGrid;

export default async function decorate(block) {
  block.classList.add('content');
  let lastRenderSnapshot = null;

  const doRender = (progressiveDataOverride = null) => {
    const state = getAppState();
    const stateWithProgressive = progressiveDataOverride
      ? { ...state, progressiveMediaData: progressiveDataOverride }
      : state;

    const snapshot = {
      org: state.org,
      site: state.site,
      isValidating: state.isValidating,
      sitePathValid: state.sitePathValid,
      validationError: state.validationError,
      isIndexing: state.isIndexing,
      selectedFilterType: state.selectedFilterType,
      searchQuery: state.searchQuery,
      selectedDocument: state.selectedDocument,
      selectedFolder: state.selectedFolder,
      mediaDataRef: state.mediaData,
      progressiveRef: state.progressiveMediaData,
    };
    const isSameSnapshot = lastRenderSnapshot
      && snapshot.org === lastRenderSnapshot.org
      && snapshot.site === lastRenderSnapshot.site
      && snapshot.isValidating === lastRenderSnapshot.isValidating
      && snapshot.sitePathValid === lastRenderSnapshot.sitePathValid
      && snapshot.validationError === lastRenderSnapshot.validationError
      && snapshot.isIndexing === lastRenderSnapshot.isIndexing
      && snapshot.selectedFilterType === lastRenderSnapshot.selectedFilterType
      && snapshot.searchQuery === lastRenderSnapshot.searchQuery
      && snapshot.selectedDocument === lastRenderSnapshot.selectedDocument
      && snapshot.selectedFolder === lastRenderSnapshot.selectedFolder
      && snapshot.mediaDataRef === lastRenderSnapshot.mediaDataRef
      && snapshot.progressiveRef === lastRenderSnapshot.progressiveRef;
    if (isSameSnapshot && !progressiveDataOverride) {
      return;
    }

    lastRenderSnapshot = snapshot;
    renderGrid(block, stateWithProgressive);
  };

  const ctx = getMediaLibraryContext();
  setMediaLibraryContext({ ...ctx, forceGridRender: doRender });
  doRender();
  onStateChange(() => doRender());
}
