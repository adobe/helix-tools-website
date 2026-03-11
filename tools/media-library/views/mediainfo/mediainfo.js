/**
 * Media Info Modal - Vanilla JS implementation
 */

import {
  getSubtype,
  isImage,
  isVideo,
  isPdfUrl,
  isExternalVideoUrl,
  getVideoEmbedUrl,
  getImageOrientation,
} from '../../core/media.js';
import { getFileName, optimizeImageUrls, formatFileSize } from '../../core/files.js';
import {
  resolveMediaUrl, isExternalUrl, parseMediaUrl, normalizeUrl,
} from '../../core/urls.js';
import {
  formatDateTime, escapeHtml, escapeAttr, safeUrlForAttr,
} from '../../core/utils.js';
import { MediaType } from '../../core/constants.js';
import fetchWithCorsProxy from '../../core/fetch.js';
import { getMediaName } from '../../features/templates.js';

function formatDocPath(doc) {
  return (doc || '').replace(/\.(md|html)$/, '');
}

const getViewUrl = (org, repo, path) => `https://main--${repo}--${org}.aem.page${formatDocPath(path) || ''}`;
const getLiveUrl = (org, repo, path) => `https://main--${repo}--${org}.aem.live${formatDocPath(path) || ''}`;

function iconImg(name, className = 'icon') {
  return `<img src="/icons/${name}.svg" class="${escapeAttr(className)}" width="20" height="20" alt="" role="presentation">`;
}

export default function createMediaInfoModal() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal-overlay mediainfo-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  let media = null;
  let usageData = [];
  let org = '';
  let repo = '';
  let isIndexing = false;
  let activeTab = 'usage';
  const metadataCache = new Map();
  const pdfBlobUrls = new Map();
  const pdfLoadFailed = new Set();
  let fetchAbortController = null;
  let updatePreviewOnlyFn = null;
  let updateTabContentOnlyFn = null;

  async function fetchFileSize(fullUrl) {
    const cacheKey = `fileSize_${fullUrl}`;
    if (metadataCache.has(cacheKey)) return metadataCache.get(cacheKey);

    const isExternal = isExternalUrl(fullUrl);
    const fetchUrl = fullUrl.toLowerCase().includes('.svg') ? normalizeUrl(fullUrl) : fullUrl;

    try {
      if (fetchAbortController) fetchAbortController.abort();
      fetchAbortController = new AbortController();

      const response = await fetchWithCorsProxy(fetchUrl, {
        method: 'HEAD',
        signal: fetchAbortController.signal,
      });

      if (response.ok) {
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const result = formatFileSize(parseInt(contentLength, 10));
          metadataCache.set(cacheKey, result);
          return result;
        }
        const getResponse = await fetchWithCorsProxy(fetchUrl, {
          method: 'GET',
          signal: fetchAbortController.signal,
        });
        if (getResponse.ok) {
          const blob = await getResponse.blob();
          const result = formatFileSize(blob.size);
          metadataCache.set(cacheKey, result);
          return result;
        }
        const fallback = isExternal ? 'External resource' : `Unable to fetch (HTTP ${getResponse.status})`;
        metadataCache.set(cacheKey, fallback);
        return fallback;
      }
      const fallback = isExternal ? 'External resource' : `Unable to fetch (HTTP ${response.status})`;
      metadataCache.set(cacheKey, fallback);
      return fallback;
    } catch (error) {
      if (error.name === 'AbortError') return null;
      const fallback = isExternal ? 'External resource' : `Unable to fetch (${error.message})`;
      metadataCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  async function loadPdf() {
    if (!media?.url || !org || !repo) return;
    const fullUrl = resolveMediaUrl(media.url, org, repo);
    if (pdfBlobUrls.has(fullUrl)) return;

    try {
      const response = await fetchWithCorsProxy(fullUrl);
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        pdfBlobUrls.set(fullUrl, blobUrl);
        if (updatePreviewOnlyFn) updatePreviewOnlyFn();
      } else {
        pdfLoadFailed.add(fullUrl);
        if (updatePreviewOnlyFn) updatePreviewOnlyFn();
      }
    } catch (err) {
      pdfLoadFailed.add(fullUrl);
      if (updatePreviewOnlyFn) updatePreviewOnlyFn();
    }
  }

  function getMediaOrigin() {
    if (org && repo) return `${org}/${repo}`;
    if (!media?.url) return 'Unknown';
    try {
      const fullUrl = resolveMediaUrl(media.url, org, repo);
      const url = new URL(fullUrl);
      return url.hostname || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  function renderPreview() {
    if (!media) return '';

    if (isImage(media.url) || media.type === MediaType.IMAGE) {
      const fullUrl = resolveMediaUrl(media.url, org, repo);
      const optimized = !isExternalUrl(fullUrl)
        ? optimizeImageUrls(media.url, [800, 1200, 1600])
        : null;
      if (optimized) {
        return `
          <div class="image-preview-container">
            <picture>
              <source type="image/webp" srcset="${safeUrlForAttr(optimized.webpSrcset)}" sizes="min(50vw, 600px)">
              <img src="${safeUrlForAttr(optimized.fallbackUrl)}" srcset="${safeUrlForAttr(optimized.fallbackSrcset)}" sizes="min(50vw, 600px)" alt="${escapeAttr(media.alt || '')}" class="preview-image">
            </picture>
            <div class="subtype-label">${escapeHtml(getSubtype(media))}</div>
          </div>`;
      }
      return `
        <div class="image-preview-container">
          <img src="${safeUrlForAttr(fullUrl)}" alt="${escapeAttr(media.alt || '')}" class="preview-image">
          <div class="subtype-label">${escapeHtml(getSubtype(media))}</div>
        </div>`;
    }

    if (isVideo(media.url) || isExternalVideoUrl(media.url)) {
      const embedUrl = getVideoEmbedUrl(media.url);
      const videoLabel = escapeHtml(getSubtype(media));
      if (embedUrl && safeUrlForAttr(embedUrl)) {
        return `
          <div class="video-preview-container">
            <div class="subtype-label">${videoLabel}</div>
            <iframe src="${safeUrlForAttr(embedUrl)}" class="preview-video-iframe" allowfullscreen title="Video embed"></iframe>
          </div>`;
      }
      if (isExternalVideoUrl(media.url)) {
        return `
          <div class="video-preview-container">
            <div class="subtype-label">${videoLabel}</div>
            <div class="placeholder-full video-placeholder">
              <img src="/icons/S2_Icon_Play_20_N.svg" class="placeholder-icon" width="20" height="20" alt="">
              <span class="placeholder-label">Video</span>
            </div>
          </div>`;
      }
      return `
        <div class="video-preview-container">
          <div class="subtype-label">${videoLabel}</div>
          <video src="${safeUrlForAttr(media.url)}" controls class="preview-video">Your browser does not support video.</video>
        </div>`;
    }

    if (isPdfUrl(media.url)) {
      const fullUrl = resolveMediaUrl(media.url, org, repo);
      const blobUrl = pdfBlobUrls.get(fullUrl);
      const loadFailed = pdfLoadFailed.has(fullUrl);

      if (loadFailed) {
        return `
        <div class="pdf-preview-container">
          <div class="subtype-label">PDF</div>
          <div class="document-placeholder pdf-load-failed">
            <img src="/icons/S2_Icon_PDF_20_N.svg" class="icon" width="64" height="64" alt="">
            <div class="pdf-info">
              <span class="pdf-name">${escapeHtml(getFileName(media.url))}</span>
              <span class="pdf-type">PDF Document</span>
              <span class="pdf-error-message">Preview unavailable. The file may be restricted or inaccessible.</span>
            </div>
          </div>
        </div>`;
      }

      if (blobUrl) {
        return `
          <div class="pdf-preview-container">
            <div class="subtype-label">PDF</div>
            <iframe src="${escapeAttr(blobUrl)}" class="pdf-preview" title="PDF preview"></iframe>
            <div class="document-placeholder pdf-fallback">
              <img src="/icons/S2_Icon_PDF_20_N.svg" class="icon" width="64" height="64" alt="">
              <div class="pdf-info">
                <span class="pdf-name">${escapeHtml(getFileName(media.url))}</span>
                <span class="pdf-type">PDF Document</span>
              </div>
            </div>
          </div>`;
      }

      return `
        <div class="pdf-preview-container">
          <div class="subtype-label">PDF</div>
          <div class="document-placeholder">
            <img src="/icons/S2_Icon_PDF_20_N.svg" class="icon" width="64" height="64" alt="">
            <div class="pdf-info">
              <span class="pdf-name">${escapeHtml(getFileName(media.url))}</span>
              <span class="pdf-type">PDF Document</span>
              <span class="pdf-loading">Loading...</span>
            </div>
          </div>
        </div>`;
    }

    const typeLabel = escapeHtml(getSubtype(media));
    const mediaName = escapeHtml(getMediaName(media));
    return `
      <div class="preview-placeholder-container">
        <div class="subtype-label">${typeLabel}</div>
        <div class="preview-placeholder">
          <div class="placeholder-center">
            <img src="/icons/C_Icon_Fragment.svg" class="fragment-icon" width="60" height="60" alt="">
            <span class="placeholder-label">${mediaName}</span>
          </div>
        </div>
      </div>`;
  }

  function renderActions(usage) {
    if (!usage?.doc) return '<span class="no-actions">-</span>';
    const viewUrl = getViewUrl(org, repo, usage.doc);
    const liveUrl = getLiveUrl(org, repo, usage.doc);
    const safeView = safeUrlForAttr(viewUrl);
    const safeLive = safeUrlForAttr(liveUrl);
    return `
      <div class="action-items">
        <button type="button" class="icon-button" data-action="preview" data-url="${safeView}" title="View page (preview)">
          ${iconImg('S2_Icon_AdobeExpressSolid_20_N')}
          Preview
        </button>
        <button type="button" class="icon-button" data-action="live" data-url="${safeLive}" title="View page (live)">
          ${iconImg('S2_Icon_AdobeExpressSolid_20_N')}
          Live
        </button>
      </div>`;
  }

  function renderUsageContent() {
    if (isIndexing && (!usageData || usageData.length === 0) && media?.usageCount > 0) {
      return '<div class="loading-state"><div class="spinner"></div><span>Discovering...</span></div>';
    }

    if (usageData?.length > 0) {
      const grouped = usageData.reduce((acc, u) => {
        const doc = u.doc || 'Unknown';
        if (!acc[doc]) acc[doc] = [];
        acc[doc].push(u);
        return acc;
      }, {});

      return `
        <div class="usage-sections">
          ${Object.entries(grouped).map(([doc, usages], idx) => {
    const latest = usages.reduce((a, b) => (b.timestamp > a.timestamp ? b : a), usages[0]);
    const modifiedBy = latest.user?.trim();
    const modifiedDate = latest.timestamp ? formatDateTime(latest.timestamp) : 'Unknown date';
    const modifiedText = (modifiedBy && modifiedBy.toLowerCase() !== 'unknown')
      ? `Last modified by ${escapeHtml(modifiedBy)} on ${escapeHtml(modifiedDate)}`
      : `Last modified on ${escapeHtml(modifiedDate)}`;
    const actionsId = `mediainfo-actions-${idx}`;
    return `
              <div class="usage-section">
                <div class="document-heading">
                  <div class="document-path">
                    <p class="usage-path">${escapeHtml(formatDocPath(doc))}</p>
                    ${org ? `<p class="usage-org">${escapeHtml(org)}</p>` : ''}
                    <button type="button" class="icon-button toggle-actions" aria-expanded="false" aria-controls="${actionsId}" aria-label="Toggle document actions" data-usage-toggle>
                      ${iconImg('S2_Icon_ChevronRight_20_N')}
                    </button>
                  </div>
                  <div class="actions-container" id="${actionsId}">
                    <p class="usage-modified">${modifiedText}</p>
                    <h5 class="usage-title">Open</h5>
                    ${renderActions(usages[0])}
                  </div>
                </div>
              </div>`;
  }).join('')}
        </div>`;
    }

    return '<div class="no-usage"><p>Not Referenced</p></div>';
  }

  function getFileSizeDisplay() {
    if (typeof media.fileSize === 'number') return formatFileSize(media.fileSize);
    if (media.fileSize) return String(media.fileSize);
    const cacheKey = `fileSize_${resolveMediaUrl(media.url, org, repo)}`;
    return metadataCache.get(cacheKey) ?? null;
  }

  function getPreviewNaturalDimensions() {
    const img = dialog.querySelector('.media-preview-section img.preview-image');
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    return { width: img.naturalWidth, height: img.naturalHeight };
  }

  function renderMetadataContent() {
    const fullUrl = resolveMediaUrl(media.url, org, repo);
    const parsed = parseMediaUrl(fullUrl);
    const origin = parsed.origin || '—';
    const path = parsed.path || media.url || '—';
    const rows = [];
    if (media.contentType) rows.push(['MIME Type', media.contentType]);

    const LOADING_PLACEHOLDER = '<span class="metadata-loading">Loading…</span>';
    const fileSizeDisplay = getFileSizeDisplay();
    if (fileSizeDisplay === null) {
      rows.push(['File Size', { trustedHtml: LOADING_PLACEHOLDER }]);
      fetchFileSize(fullUrl).then(() => updateTabContentOnlyFn?.());
    } else {
      rows.push(['File Size', fileSizeDisplay]);
    }
    const natural = isImage(media?.url ?? '') ? getPreviewNaturalDimensions() : null;
    const displayW = natural?.width ?? media.width;
    const displayH = natural?.height ?? media.height;
    if (displayW || displayH) {
      rows.push(['Width', displayW ? `${displayW}px` : '—']);
      rows.push(['Height', displayH ? `${displayH}px` : '—']);
    }
    if (isImage(media?.url ?? '')) {
      const orientation = (displayW && displayH)
        ? getImageOrientation(displayW, displayH)
        : '—';
      rows.push(['Orientation', orientation]);
    }
    rows.push(['Origin', escapeHtml(origin)]);
    rows.push(['Path', escapeHtml(path)]);
    rows.push(['URL', media.url
      ? { trustedHtml: `<a href="${safeUrlForAttr(media.url)}" target="_blank" rel="noopener" class="metadata-link">${escapeHtml(media.url)}</a>` }
      : '—']);

    return `
      <div class="tab-content">
        <div class="metadata-section">
          <div class="metadata-grid-container">
            <div class="metadata-grid">
              <div class="grid-heading">Property</div>
              <div class="grid-heading">Value</div>
              ${rows.map(([label, value]) => {
    const safeLabel = escapeHtml(label);
    const safeValue = value && typeof value === 'object' && value.trustedHtml
      ? value.trustedHtml
      : escapeHtml(value == null ? '' : String(value));
    return `
                <div class="metadata-label">${safeLabel}</div>
                <div class="metadata-value">${safeValue}</div>
              `;
  }).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function attachTabContentListeners() {
    dialog.querySelectorAll('[data-usage-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const heading = btn.closest('.document-heading');
        if (heading) {
          const isOpen = heading.classList.toggle('open');
          btn.setAttribute('aria-expanded', isOpen);
        }
      });
    });
    dialog.querySelectorAll('.action-items button[data-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { url } = btn.dataset;
        if (url) window.open(url, '_blank');
      });
    });
  }

  function updateTabContentOnly() {
    const body = dialog.querySelector('.modal-body');
    if (!body) return;
    body.innerHTML = activeTab === 'usage' ? renderUsageContent() : renderMetadataContent();
    attachTabContentListeners();
  }

  function updatePreviewOnly() {
    const section = dialog.querySelector('.media-preview-section');
    if (!section) return;
    section.innerHTML = renderPreview();
    const pdfIframe = dialog.querySelector('.pdf-preview');
    if (pdfIframe) {
      pdfIframe.addEventListener('load', () => {
        const fallback = pdfIframe.nextElementSibling;
        if (fallback?.classList.contains('pdf-fallback')) fallback.style.display = 'none';
      });
      pdfIframe.addEventListener('error', () => {
        pdfIframe.style.display = 'none';
        const fallback = pdfIframe.nextElementSibling;
        if (fallback?.classList.contains('pdf-fallback')) fallback.style.display = 'flex';
      });
    }
    const previewImg = dialog.querySelector('.media-preview-section img.preview-image');
    if (previewImg) {
      previewImg.addEventListener('load', () => updateTabContentOnlyFn?.());
    }
  }

  function doRender() {
    if (!media) return;

    const displayName = escapeHtml(media.name || getFileName(media.url) || 'Media Details');
    const refCount = usageData?.length ?? 0;
    const refLabel = refCount !== 1 ? 'References' : 'Reference';

    dialog.innerHTML = `
      <div class="modal-content" data-mediainfo-content>
        <div class="media-preview-section">${renderPreview()}</div>
        <div class="modal-details">
          <div class="modal-header">
            <h2>${displayName}</h2>
            <div class="media-origin">${escapeHtml(getMediaOrigin())}</div>
            <button type="button" class="icon-button close-modal-button" title="Close" aria-label="Close modal">
              ${iconImg('S2_Icon_Close_20_N')}
            </button>
          </div>
          <div class="modal-tabs">
            <button type="button" class="tab-button ${activeTab === 'usage' ? 'active' : ''}" data-tab="usage" aria-selected="${activeTab === 'usage'}">
              <img src="/icons/S2_Icon_AIGenReferenceImage_20_N.svg" class="reference-icon icon" width="22" height="20" alt="" role="presentation">
              ${refCount} ${refLabel}
            </button>
            <button type="button" class="tab-button ${activeTab === 'metadata' ? 'active' : ''}" data-tab="metadata" aria-selected="${activeTab === 'metadata'}">
              <img src="/icons/C_Icon_Image_Info.svg" class="image-info-icon icon" width="20" height="20" alt="" role="presentation">
              Metadata
            </button>
          </div>
          <div class="modal-body">
            ${activeTab === 'usage' ? renderUsageContent() : renderMetadataContent()}
          </div>
        </div>
      </div>`;

    dialog.querySelector('.close-modal-button')?.addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        dialog.querySelectorAll('[data-tab]').forEach((b) => {
          b.setAttribute('aria-selected', b.dataset.tab === activeTab);
          b.classList.toggle('active', b.dataset.tab === activeTab);
        });
        updateTabContentOnly();
      });
    });
    attachTabContentListeners();

    const pdfIframe = dialog.querySelector('.pdf-preview');
    if (pdfIframe) {
      pdfIframe.addEventListener('load', () => {
        const fallback = pdfIframe.nextElementSibling;
        if (fallback?.classList.contains('pdf-fallback')) fallback.style.display = 'none';
      });
      pdfIframe.addEventListener('error', () => {
        pdfIframe.style.display = 'none';
        const fallback = pdfIframe.nextElementSibling;
        if (fallback?.classList.contains('pdf-fallback')) fallback.style.display = 'flex';
      });
    }

    const previewImg = dialog.querySelector('.media-preview-section img.preview-image');
    if (previewImg) {
      previewImg.addEventListener('load', () => updateTabContentOnlyFn?.());
    }
  }

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    if (fetchAbortController) {
      fetchAbortController.abort();
      fetchAbortController = null;
    }
    pdfBlobUrls.forEach((url) => URL.revokeObjectURL(url));
    pdfBlobUrls.clear();
    pdfLoadFailed.clear();
  });

  updatePreviewOnlyFn = updatePreviewOnly;
  updateTabContentOnlyFn = updateTabContentOnly;

  return {
    show(data) {
      media = data.media;
      usageData = data.usageData ?? [];
      org = data.org ?? '';
      repo = data.repo ?? '';
      isIndexing = data.isIndexing ?? false;
      activeTab = 'usage';

      doRender();
      if (!dialog.open) {
        document.body.appendChild(dialog);
        dialog.showModal();
      }
      if (media?.url && isPdfUrl(media.url)) {
        loadPdf();
      }
    },
    close() {
      dialog.close();
    },
  };
}
