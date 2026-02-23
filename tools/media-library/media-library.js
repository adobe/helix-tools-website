/* eslint-disable no-restricted-globals, no-alert */

import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { decorateIcons } from '../../scripts/aem.js';
import {
  getMetadata,
  saveMetadata,
  getMedialogEntries,
  getAuditlogEntries,
  saveMedialogEntries,
  saveAuditlogEntries,
  timestampToDuration,
  clearCache,
} from './storage.js';
import { fetchAllAuditLog, processAuditLog } from './audit-log.js';

const CONFIG = {
  API_URL: 'https://admin.hlx.page/medialog',
  DEFAULT_LIMIT: 1000,
};

const state = {
  org: null,
  site: null,
  timeframe: null,
  allEntries: [],
  library: [],
  filteredLibrary: [],
  displayedCount: 0,
  nextToken: null,
  isLoading: false,
  searchQuery: '',
  typeFilter: 'all',
  usageFilter: 'all',
};

const RENDER_BATCH_SIZE = 200;

const domCache = {
  form: null,
  orgInput: null,
  siteInput: null,
  timeframeSelect: null,
  filtersSection: null,
  searchInput: null,
  typeFilter: null,
  usageFilter: null,
  exportBtn: null,
  mediaCountText: null,
  mediaGrid: null,
  noResults: null,
  loadingState: null,
  errorState: null,
  errorMessage: null,
  modal: null,
  modalBody: null,

  init() {
    this.form = document.getElementById('media-library-form');
    this.orgInput = document.getElementById('org');
    this.siteInput = document.getElementById('site');
    this.timeframeSelect = document.getElementById('timeframe');
    this.filtersSection = document.querySelector('.filters-section');
    this.searchInput = document.getElementById('media-search');
    this.typeFilter = document.getElementById('type-filter');
    this.usageFilter = document.getElementById('usage-filter');
    this.exportBtn = document.getElementById('export-unreferenced');
    this.mediaCountText = document.getElementById('media-count-text');
    this.mediaGrid = document.getElementById('media-grid');
    this.noResults = document.querySelector('.no-results');
    this.loadingState = document.querySelector('.loading-state');
    this.errorState = document.querySelector('.error-state');
    this.errorMessage = document.getElementById('error-message');
    this.modal = document.getElementById('media-modal');
    this.modalBody = document.querySelector('.modal-body');
  },
};

function updateState(updates) {
  Object.assign(state, updates);
  
  const url = new URL(window.location.href);
  url.search = '';
  Object.entries(state).forEach(([key, value]) => {
    if (value && typeof value === 'string') {
      url.searchParams.set(key, value);
    }
  });
  window.history.replaceState({}, '', url.href);
}

function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  return {
    org: params.get('org'),
    site: params.get('site'),
    timeframe: params.get('timeframe'),
  };
}

function showState(stateName) {
  domCache.noResults.setAttribute('aria-hidden', stateName !== 'no-results');
  domCache.loadingState.setAttribute('aria-hidden', stateName !== 'loading');
  domCache.errorState.setAttribute('aria-hidden', stateName !== 'error');
  domCache.filtersSection.setAttribute('aria-hidden', stateName !== 'results');
  document.querySelector('.results-container').setAttribute('aria-hidden', stateName !== 'results');
}

function showError(message) {
  domCache.errorMessage.textContent = message;
  showState('error');
}

async function fetchMediaLog(org, site, since, nextToken = null) {
  console.log('fetchMediaLog called with:', { org, site, since, nextToken });
  
  console.log('Checking authentication...');
  const isAuthenticated = await ensureLogin(org, site);
  console.log('Authentication result:', isAuthenticated);
  
  if (!isAuthenticated) {
    throw new Error('Please sign in to view media logs.');
  }

  const params = new URLSearchParams({
    since,
    limit: CONFIG.DEFAULT_LIMIT,
  });

  if (nextToken) {
    params.set('nextToken', nextToken);
  }

  const url = `${CONFIG.API_URL}/${org}/${site}/main?${params}`;
  console.log('Fetching from URL:', url);
  
  const response = await fetch(url);
  console.log('Response status:', response.status);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication required. Please sign in to the project in Sidekick.');
    }
    if (response.status === 404) {
      throw new Error('Media log not found for this site.');
    }
    const errorText = await response.text();
    throw new Error(`Failed to fetch media log: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('Response data:', {
    entriesCount: data.entries?.length || 0,
    hasNextToken: !!data.nextToken,
    from: data.from,
    to: data.to,
  });
  
  return data;
}

function getMediaKey(path) {
  return path.split('#')[0].split('?')[0];
}

function detectMediaType(path, contentType) {
  if (contentType) {
    if (contentType.startsWith('image/')) {
      if (contentType === 'image/svg+xml') {
        return path.includes('/icons/') ? 'icon' : 'svg';
      }
      return 'image';
    }
    if (contentType.startsWith('video/')) {
      return 'video';
    }
    if (contentType === 'application/pdf') {
      return 'pdf';
    }
  }
  
  if (path.includes('/fragments/')) {
    return 'fragment';
  }
  
  const ext = getExtension(path).toLowerCase();
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico'].includes(ext)) {
    return 'image';
  }
  if (ext === 'svg') {
    return path.includes('/icons/') ? 'icon' : 'svg';
  }
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
    return 'video';
  }
  if (ext === 'pdf') {
    return 'pdf';
  }
  
  return 'unknown';
}

function getExtension(path) {
  return path.split('.').pop().split('#')[0].split('?')[0];
}

function extractFileName(path) {
  return path.split('/').pop().split('#')[0].split('?')[0];
}

function buildLibrary(entries) {
  const libraryMap = new Map();

  entries.forEach(entry => {
    const mediaKey = getMediaKey(entry.path);
    
    if (!libraryMap.has(mediaKey)) {
      libraryMap.set(mediaKey, {
        url: entry.path,
        mediaKey,
        mediaHash: entry.mediaHash,
        fileName: extractFileName(entry.path),
        originalFilename: entry.originalFilename || null,
        extension: getExtension(entry.path),
        mediaType: detectMediaType(entry.path, entry.contentType),
        contentType: entry.contentType,
        width: entry.width,
        height: entry.height,
        usageCount: 0,
        uniqueSources: new Set(),
        uniqueUsers: new Set(),
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
        auditLog: [],
      });
    }

    const media = libraryMap.get(mediaKey);
    
    if (entry.originalFilename && !media.originalFilename) {
      media.originalFilename = entry.originalFilename;
    }
    
    media.auditLog.push({
      operation: entry.operation,
      timestamp: entry.timestamp,
      user: entry.user,
      resourcePath: entry.resourcePath,
      originalFilename: entry.originalFilename,
      contentSourceType: entry.contentSourceType,
    });

    media.usageCount++;
    
    if (entry.resourcePath) {
      media.uniqueSources.add(entry.resourcePath);
    }
    
    if (entry.user) {
      media.uniqueUsers.add(entry.user);
    }
    
    media.firstSeen = Math.min(media.firstSeen, entry.timestamp);
    media.lastSeen = Math.max(media.lastSeen, entry.timestamp);
  });

  libraryMap.forEach(media => {
    media.auditLog.sort((a, b) => b.timestamp - a.timestamp);
  });

  return Array.from(libraryMap.values());
}

function applyFilters(library) {
  return library.filter(media => {
    if (state.typeFilter !== 'all' && media.mediaType !== state.typeFilter) {
      return false;
    }

    if (state.usageFilter === 'referenced' && media.uniqueSources.size === 0) {
      return false;
    }

    if (state.usageFilter === 'unreferenced' && media.uniqueSources.size > 0) {
      return false;
    }

    if (state.searchQuery) {
      const searchLower = state.searchQuery.toLowerCase();
      return (
        media.fileName.toLowerCase().includes(searchLower) ||
        media.url.toLowerCase().includes(searchLower) ||
        media.auditLog.some(entry => entry.user?.toLowerCase().includes(searchLower))
      );
    }

    return true;
  });
}

function formatRelativeDate(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function formatFullDate(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

function buildMediaUrl(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  if (state.org && state.site) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `https://main--${state.site}--${state.org}.aem.page${cleanPath}`;
  }
  
  return path;
}

function buildPreviewUrl(resourcePath) {
  if (!resourcePath || !state.org || !state.site) {
    return resourcePath;
  }
  
  let cleanPath = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  cleanPath = cleanPath.replace(/\.md$/i, '');
  
  return `https://main--${state.site}--${state.org}.aem.page${cleanPath}`;
}

function createMediaPreview(media) {
  const mediaUrl = buildMediaUrl(media.url);
  
  switch (media.mediaType) {
    case 'image':
    case 'svg':
    case 'icon':
      return `<img src="${mediaUrl}" alt="${media.fileName}" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=&quot;file-placeholder&quot;><span class=&quot;icon icon-document&quot;></span></div>';" />`;
    
    case 'video':
      return `<video src="${mediaUrl}" controls preload="metadata" title="${media.fileName}"></video>`;
    
    case 'pdf':
      return `
        <div class="file-placeholder pdf-placeholder">
          <span class="icon icon-document"></span>
        </div>
      `;
    
    case 'fragment':
      return `
        <div class="file-placeholder fragment-placeholder">
          <span class="icon icon-fragment"></span>
          <span class="fragment-name">${media.fileName}</span>
        </div>
      `;
    
    default:
      return `
        <div class="file-placeholder">
          <span class="icon icon-document"></span>
        </div>
      `;
  }
}

function getTypeBadgeLabel(media) {
  if (media.mediaType === 'fragment') return 'FRAGMENT';
  if (media.mediaType === 'pdf') return 'PDF';
  if (media.mediaType === 'video') return 'VIDEO';
  return media.extension?.toUpperCase() || 'FILE';
}

function createMediaCard(media) {
  const card = document.createElement('div');
  card.className = 'media-card';
  card.dataset.mediaType = media.mediaType;
  
  const showUsageBadge = media.mediaType !== 'fragment';
  
  card.innerHTML = `
    <div class="media-preview">
      ${createMediaPreview(media)}
      <div class="media-badges">
        <span class="media-type-badge">${getTypeBadgeLabel(media)}</span>
        ${showUsageBadge ? `<span class="media-usage-badge">${media.uniqueSources.size}</span>` : ''}
      </div>
    </div>
  `;
  
  const img = card.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      console.warn('Failed to load image:', media.url, '(resolved to:', img.src, ')');
    });
  }
  
  card.addEventListener('click', () => openMediaModal(media));
  
  return card;
}

function renderGrid(reset = false) {
  if (reset) {
    domCache.mediaGrid.innerHTML = '';
    updateState({ displayedCount: 0 });
  }
  
  if (state.filteredLibrary.length === 0) {
    domCache.mediaGrid.innerHTML = '';
    if (state.library.length === 0) {
      const noResultsDiv = document.querySelector('.no-results div div');
      noResultsDiv.innerHTML = `
        <span class="icon icon-search"></span>
        <div>
          <p><strong>No media loaded</strong></p>
          <p>Submit the form above to load media logs.</p>
        </div>
      `;
      showState('no-results');
    } else {
      const noResultsDiv = document.querySelector('.no-results div div');
      noResultsDiv.innerHTML = `
        <span class="icon icon-filter"></span>
        <div>
          <p><strong>No media matches your filters</strong></p>
          <p>Try changing your search or filter settings.</p>
        </div>
      `;
      domCache.filtersSection.setAttribute('aria-hidden', false);
      document.querySelector('.results-container').setAttribute('aria-hidden', true);
      domCache.noResults.setAttribute('aria-hidden', false);
      domCache.mediaCountText.textContent = '0 items';
    }
    return;
  }

  const startIdx = state.displayedCount;
  const endIdx = Math.min(startIdx + RENDER_BATCH_SIZE, state.filteredLibrary.length);
  const batch = state.filteredLibrary.slice(startIdx, endIdx);
  
  batch.forEach(media => {
    const card = createMediaCard(media);
    domCache.mediaGrid.appendChild(card);
  });

  updateState({ displayedCount: endIdx });

  decorateIcons(domCache.mediaGrid);
  decorateIcons(document.querySelector('.no-results'));
  
  const mediaCount = document.querySelector('.filters-section .media-count');
  if (mediaCount) {
    const showing = `Showing ${endIdx} of ${state.filteredLibrary.length}`;
    const allLoaded = endIdx >= state.filteredLibrary.length;
    mediaCount.innerHTML = `<span id="media-count-text">${allLoaded ? `${state.filteredLibrary.length} items` : showing}</span>`;
    domCache.mediaCountText = document.getElementById('media-count-text');
  }
  
  showState('results');
  
  if (endIdx < state.filteredLibrary.length) {
    setupLoadMoreObserver();
  }
}

function setupLoadMoreObserver() {
  const lastCard = domCache.mediaGrid.lastElementChild;
  if (!lastCard) return;
  
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && state.displayedCount < state.filteredLibrary.length) {
          observer.disconnect();
          renderGrid(false);
        }
      });
    },
    {
      root: null,
      rootMargin: '200px',
      threshold: 0.1,
    },
  );
  
  observer.observe(lastCard);
}

function renderAuditLog(auditLog) {
  if (!auditLog || auditLog.length === 0) {
    return '<div class="empty-state"><p>No audit log entries found</p></div>';
  }

  const entries = auditLog.map(entry => {
    const previewUrl = entry.resourcePath ? buildPreviewUrl(entry.resourcePath) : null;
    
    return `
      <li class="audit-entry" data-action="${entry.action}">
        <div class="audit-timeline-marker">
          <span class="icon icon-activity"></span>
        </div>
        
        <div class="audit-content">
          <div class="audit-header">
            <span class="audit-action">${entry.operation}</span>
            <span class="audit-timestamp">${formatFullDate(entry.timestamp)}</span>
          </div>
          
          <div class="audit-details">
            <p class="audit-user">
              <span class="icon icon-user"></span>
              ${entry.user || 'Unknown'}
            </p>
            
            ${previewUrl ? `
              <p class="audit-source">
                <span class="icon icon-document"></span>
                <a href="${previewUrl}" target="_blank" rel="noopener">
                  ${truncate(entry.resourcePath.replace(/\.md$/i, ''), 60)}
                </a>
              </p>
            ` : ''}
            
            ${entry.originalFilename ? `
              <p class="audit-source">
                <span class="icon icon-document"></span>
                Original: ${entry.originalFilename}
              </p>
            ` : ''}
          </div>
        </div>
      </li>
    `;
  }).join('');

  return `
    <div class="audit-log-container">
      <ul class="audit-log-list">${entries}</ul>
    </div>
  `;
}

async function extractImageMetadata(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    
    img.onload = () => {
      const aspectRatio = (img.naturalWidth / img.naturalHeight).toFixed(2);
      let orientation = 'square';
      
      if (aspectRatio > 1.5) orientation = 'landscape';
      else if (aspectRatio < 0.75) orientation = 'portrait';
      
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        orientation,
        aspectRatio,
      });
    };
    
    img.onerror = () => {
      resolve(null);
    };
    
    img.src = imageUrl;
  });
}

function getFileTypeDisplay(media) {
  switch (media.mediaType) {
    case 'fragment':
      return 'Fragment';
    case 'pdf':
      return 'PDF Document';
    case 'video':
      return `Video (${media.extension?.toUpperCase()})`;
    case 'image':
      return `Image (${media.extension?.toUpperCase()})`;
    case 'svg':
      return 'SVG Image';
    case 'icon':
      return 'SVG Icon';
    default:
      return media.extension?.toUpperCase() || 'Unknown';
  }
}

function renderMetadata(media) {
  const hasApiDimensions = media.width && media.height;
  let orientation = 'unknown';
  
  if (hasApiDimensions) {
    const aspectRatio = media.width / media.height;
    if (aspectRatio > 1.5) orientation = 'landscape';
    else if (aspectRatio < 0.67) orientation = 'portrait';
    else orientation = 'square';
  }
  
  return `
    <dl class="metadata-list">
      ${hasApiDimensions ? `
        <dt>Dimensions</dt>
        <dd>${media.width} × ${media.height} px</dd>
        
        <dt>Orientation</dt>
        <dd>${orientation}</dd>
      ` : ''}
      
      ${media.contentType ? `
        <dt>Content Type</dt>
        <dd>${media.contentType}</dd>
      ` : ''}
      
      <dt>File Type</dt>
      <dd>${getFileTypeDisplay(media)}</dd>
      
      ${media.mediaHash ? `
        <dt>Media Hash</dt>
        <dd class="path-value">${media.mediaHash}</dd>
      ` : ''}
      
      <dt>Full Path</dt>
      <dd class="path-value">${media.url}</dd>
    </dl>
  `;
}

function renderReferences(media) {
  if (!media.auditLog || media.auditLog.length === 0) {
    return '<div class="empty-state"><p>No references found</p></div>';
  }
  
  const usageByPage = new Map();
  const standaloneEntries = [];
  
  media.auditLog.forEach(entry => {
    if (entry.resourcePath) {
      if (!usageByPage.has(entry.resourcePath)) {
        usageByPage.set(entry.resourcePath, []);
      }
      usageByPage.get(entry.resourcePath).push({
        timestamp: entry.timestamp,
        user: entry.user,
        operation: entry.operation,
      });
    } else if (entry.originalFilename) {
      standaloneEntries.push(entry);
    }
  });
  
  let html = '';
  
  if (usageByPage.size > 0) {
    const usageEntries = Array.from(usageByPage.entries()).map(([resourcePath, references]) => {
      const refCount = references.length;
      const previewUrl = buildPreviewUrl(resourcePath);
      
      return `
        <div class="usage-entry">
          <div class="usage-page">
            <span class="icon icon-document"></span>
            <a href="${previewUrl}" target="_blank" rel="noopener">
              ${resourcePath.replace(/\.md$/i, '')}
            </a>
            <span class="usage-reference-count">${refCount} ${refCount === 1 ? 'reference' : 'references'}</span>
          </div>
        </div>
      `;
    }).join('');
    
    html += `
      <div class="references-section">
        <h3 class="section-title">Page Usage</h3>
        <div class="usage-list">${usageEntries}</div>
      </div>
    `;
  }
  
  if (standaloneEntries.length > 0) {
    html += `
      <div class="references-section">
        <h3 class="section-title">Standalone Uploads</h3>
        <div class="usage-list">
          ${standaloneEntries.map(entry => `
            <div class="usage-entry">
              <div class="usage-page">
                <span class="icon icon-document"></span>
                ${entry.originalFilename}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  html += `
    <div class="references-section">
      <h3 class="section-title">Activity Timeline</h3>
      ${renderAuditLog(media.auditLog)}
    </div>
  `;
  
  return html;
}

async function openMediaModal(media) {
  domCache.modal.showModal();
  domCache.modalBody.innerHTML = '<div class="modal-loading"><i class="symbol symbol-loading"></i></div>';
  
  const usageCount = media.uniqueSources.size;
  const displayName = media.originalFilename || media.fileName;
  
  domCache.modalBody.innerHTML = `
    <div class="modal-layout">
      <div class="modal-preview">
        ${createMediaPreview(media)}
        <span class="media-type-badge">${getTypeBadgeLabel(media)}</span>
      </div>
      
      <div class="modal-details">
        <h2 class="media-title">${displayName}</h2>
        
        <div class="tabs">
          <button class="tab active" data-tab="references">
            <span class="icon icon-activity"></span>
            References (${usageCount})
          </button>
          <button class="tab" data-tab="metadata">
            <span class="icon icon-info"></span>
            Metadata
          </button>
        </div>
        
        <div class="tab-content active" id="tab-references">
          ${renderReferences(media)}
        </div>
        
        <div class="tab-content" id="tab-metadata">
          ${renderMetadata(media)}
        </div>
      </div>
    </div>
  `;
  
  decorateIcons(domCache.modalBody);
  setupModalTabs();
}

function setupModalTabs() {
  const tabs = domCache.modalBody.querySelectorAll('.tab');
  const contents = domCache.modalBody.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      contents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${targetTab}`);
      });
    });
  });
}

async function fetchAllMediaLog(org, site, timeframe, onPageLoaded) {
  let allEntries = [];
  let nextToken = null;
  let pageCount = 0;
  
  do {
    pageCount++;
    
    const result = await fetchMediaLog(org, site, timeframe, nextToken);
    
    if (!result.entries || result.entries.length === 0) {
      break;
    }
    
    const entriesCount = result.entries.length;
    allEntries = allEntries.concat(result.entries);
    nextToken = result.nextToken;
    
    if (onPageLoaded) {
      onPageLoaded(allEntries, !!nextToken);
    }
    
    if (entriesCount < CONFIG.DEFAULT_LIMIT) {
      break;
    }
  } while (nextToken);
  
  return allEntries;
}

function mergeEntries(existingEntries, newEntries) {
  const entryMap = new Map();
  
  existingEntries.forEach((entry) => {
    const key = `${entry.path}|${entry.timestamp}|${entry.operation}`;
    entryMap.set(key, entry);
  });
  
  newEntries.forEach((entry) => {
    const key = `${entry.path}|${entry.timestamp}|${entry.operation}`;
    entryMap.set(key, entry);
  });
  
  return Array.from(entryMap.values()).sort((a, b) => b.timestamp - a.timestamp);
}

function mergeSources(medialogEntries, auditlogEntries, org, site) {
  const combined = [...medialogEntries, ...auditlogEntries];
  
  const ingestMap = new Map();
  const reuseEntries = [];
  
  combined.forEach((entry) => {
    const key = entry.path.split('#')[0].split('?')[0];
    
    if (entry.operation === 'ingest' && (!entry.resourcePath || entry.resourcePath === '')) {
      if (!ingestMap.has(key) || entry.timestamp > ingestMap.get(key).timestamp) {
        ingestMap.set(key, entry);
      }
    } else {
      reuseEntries.push(entry);
    }
  });
  
  return [...Array.from(ingestMap.values()), ...reuseEntries].sort((a, b) => b.timestamp - a.timestamp);
}

function getUnreferencedMedia() {
  return state.library.filter((media) => media.uniqueSources.size === 0);
}

function exportUnreferencedToCSV() {
  const unreferenced = getUnreferencedMedia();
  
  if (unreferenced.length === 0) {
    alert('No unreferenced media found.');
    return;
  }
  
  const headers = ['Type', 'Filename', 'URL', 'Uploaded By', 'Upload Date', 'File Extension', 'Size (if available)'];
  
  const rows = unreferenced.map((media) => [
    media.mediaType,
    media.fileName,
    media.url,
    media.auditLog[0]?.user || 'Unknown',
    new Date(media.firstSeen).toISOString(),
    media.extension || '',
    media.width && media.height ? `${media.width}x${media.height}` : '',
  ]);
  
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `unreferenced-media-${state.org}-${state.site}-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleSubmit(e) {
  e.preventDefault();
  
  const org = domCache.orgInput.value.trim();
  const site = domCache.siteInput.value.trim();
  const timeframe = domCache.timeframeSelect.value;

  if (!org || !site) {
    showError('Please fill in all required fields.');
    return;
  }

  updateState({ org, site, timeframe });
  updateConfig();

  try {
    showState('loading');
    
    const metadata = await getMetadata(org, site);
    const since = metadata?.lastFetchTime ? timestampToDuration(metadata.lastFetchTime) : timeframe;
    
    const [medialogEntries, auditlogEntries] = await Promise.all([
      fetchAllMediaLog(org, site, since),
      fetchAllAuditLog(org, site, since),
    ]);

    const processedAuditlog = processAuditLog(auditlogEntries, org, site);
    
    let allMedialogEntries = medialogEntries;
    let allAuditlogEntries = processedAuditlog;

    if (metadata?.lastFetchTime) {
      const cachedMedialog = await getMedialogEntries(org, site);
      const cachedAuditlog = await getAuditlogEntries(org, site);
      allMedialogEntries = mergeEntries(cachedMedialog, medialogEntries);
      allAuditlogEntries = mergeEntries(cachedAuditlog, processedAuditlog);
    }

    await Promise.all([
      saveMedialogEntries(org, site, allMedialogEntries),
      saveAuditlogEntries(org, site, allAuditlogEntries),
      saveMetadata(org, site, {
        lastFetchTime: Date.now(),
        medialogCount: allMedialogEntries.length,
        auditlogCount: allAuditlogEntries.length,
      }),
    ]);

    const combinedEntries = mergeSources(allMedialogEntries, allAuditlogEntries, org, site);
    const library = buildLibrary(combinedEntries);
    const filteredLibrary = applyFilters(library);

    updateState({
      allEntries: combinedEntries,
      library,
      filteredLibrary,
      nextToken: null,
    });

    showState('results');
    renderGrid(true);
  } catch (error) {
    console.error('Media library error:', error);
    showError(error.message);
  }
}

function handleReset() {
  updateState({
    org: null,
    site: null,
    timeframe: '90d',
    allEntries: [],
    library: [],
    filteredLibrary: [],
    displayedCount: 0,
    nextToken: null,
    searchQuery: '',
    typeFilter: 'all',
    usageFilter: 'all',
  });
  
  domCache.searchInput.value = '';
  domCache.typeFilter.value = 'all';
  domCache.usageFilter.value = 'all';
  
  showState('no-results');
}

function handleSearch() {
  updateState({ searchQuery: domCache.searchInput.value });
  const filteredLibrary = applyFilters(state.library);
  updateState({ filteredLibrary });
  renderGrid(true);
}

function handleTypeFilter() {
  updateState({ typeFilter: domCache.typeFilter.value });
  const filteredLibrary = applyFilters(state.library);
  updateState({ filteredLibrary });
  renderGrid(true);
}

function handleUsageFilter() {
  updateState({ usageFilter: domCache.usageFilter.value });
  const filteredLibrary = applyFilters(state.library);
  updateState({ filteredLibrary });
  renderGrid(true);
}

function setupModalHandlers() {
  const closeBtn = domCache.modal.querySelector('.close-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => domCache.modal.close());
  }
  
  domCache.modal.addEventListener('click', (e) => {
    if (e.target === domCache.modal) {
      domCache.modal.close();
    }
  });
}

async function initialize() {
  domCache.init();
  
  await initConfigField();
  
  domCache.form.addEventListener('submit', handleSubmit);
  domCache.form.addEventListener('reset', handleReset);
  domCache.searchInput.addEventListener('input', handleSearch);
  domCache.typeFilter.addEventListener('change', handleTypeFilter);
  domCache.usageFilter.addEventListener('change', handleUsageFilter);
  domCache.exportBtn.addEventListener('click', exportUnreferencedToCSV);
  
  setupModalHandlers();
  
  const urlState = getStateFromURL();
  if (urlState.org) {
    domCache.orgInput.value = urlState.org;
  }
  if (urlState.site) {
    domCache.siteInput.value = urlState.site;
  }
  if (urlState.timeframe) {
    domCache.timeframeSelect.value = urlState.timeframe;
  }
}

registerToolReady(initialize());
