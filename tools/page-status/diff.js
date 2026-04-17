import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';

// Lazy-load Dark Alley converter module
const CONVERTERS_URL = 'https://main--da-nx--adobe.aem.live/nx/utils/converters.js';
let mdToDocDom;

async function loadConverter() {
  if (!mdToDocDom) {
    // eslint-disable-next-line import/no-unresolved
    const converters = await import(CONVERTERS_URL);
    mdToDocDom = converters.mdToDocDom;
  }
}

// DOM elements
const DIFF_INFO = document.querySelector('.diff-info');
const DIFF_SITE = document.querySelector('.diff-site');
const DIFF_COUNT = document.querySelector('.diff-count');
const DIFF_LOADING = document.querySelector('.diff-loading');
const DIFF_NO_RESULTS = document.querySelector('.diff-no-results');
const DIFF_ERROR = document.querySelector('.diff-error');
const DIFF_RESULTS = document.querySelector('.diff-results');
const DIFF_PAGE_LIST = document.querySelector('.diff-page-list');
const DIFF_CONTENT = document.querySelector('.diff-content');
const HIDE_DRAFTS = document.getElementById('hide-drafts');
const DIFF_NAV = document.querySelector('.diff-nav');

// State
let currentOrg = '';
let currentSite = '';
let currentJob = '';
let currentPath = '';
let isEmbedMode = false;
let isSinglePageMode = false;
let previewHost = '';
let liveHost = '';
let pendingPages = [];

// Cache for diff results - keyed by page path
const diffCache = new Map();

// Current change index for navigation
let currentChangeIndex = -1;

/**
 * Updates the display state of the diff container.
 * @param {string} state - One of: 'loading', 'no-results', 'error', 'results'
 */
function updateDisplayState(state) {
  DIFF_LOADING.setAttribute('aria-hidden', state !== 'loading');
  DIFF_NO_RESULTS.setAttribute('aria-hidden', state !== 'no-results');
  DIFF_ERROR.setAttribute('aria-hidden', state !== 'error');
  DIFF_RESULTS.setAttribute('aria-hidden', state !== 'results');
}

/**
 * Updates the error message.
 * @param {string} message - Error message to display
 */
function showError(message) {
  const errorMsg = DIFF_ERROR.querySelector('p:last-of-type');
  errorMsg.textContent = message;
  updateDisplayState('error');
}

/**
 * Fetches the live and preview host URLs for org/site.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 * @returns {Promise<Object>} Object with live and preview hostnames.
 */
async function fetchHosts(org, site) {
  const url = `https://admin.hlx.page/status/${org}/${site}/main`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch hosts: ${res.status}`);
  const json = await res.json();
  return {
    live: new URL(json.live.url).host,
    preview: new URL(json.preview.url).host,
  };
}

/**
 * Fetches job details from an existing job ID.
 * @param {string} org - Organization name.
 * @param {string} site - Site name.
 * @param {string} jobId - Job ID from page-status.
 * @returns {Promise<Array>} Array of resources
 */
async function fetchJobDetails(org, site, jobId) {
  const jobUrl = `https://admin.hlx.page/job/${org}/${site}/main/status/${jobId}`;

  // First check job status
  const jobRes = await fetch(jobUrl, { mode: 'cors' });
  if (!jobRes.ok) throw new Error(`Job fetch failed: ${jobRes.status}`);

  const { state } = await jobRes.json();
  if (state !== 'completed' && state !== 'stopped') {
    throw new Error('Job is still running. Please wait for it to complete.');
  }

  // Fetch details
  const detailsRes = await fetch(`${jobUrl}/details`, { mode: 'cors' });
  if (!detailsRes.ok) throw new Error('Failed to fetch job details');

  const { data } = await detailsRes.json();
  return data?.resources || [];
}

/**
 * Filters resources to find pages with pending changes (preview newer than publish).
 * @param {Array} resources - Array of resource objects
 * @returns {Array} Filtered array of pages with pending changes
 */
function filterPendingPages(resources) {
  const ignore = ['/helix-env.json', '/sitemap.json'];

  return resources.filter((resource) => {
    const { path, previewLastModified, publishLastModified } = resource;

    // Skip ignored paths
    if (!path || ignore.includes(path)) return false;

    // Must have both preview and publish dates
    if (!previewLastModified || !publishLastModified) return false;

    const previewDate = new Date(previewLastModified);
    const publishDate = new Date(publishLastModified);

    // Preview must be newer than publish
    return previewDate > publishDate;
  });
}

/**
 * Fetches content from a URL.
 * @param {string} url - URL to fetch
 * @returns {Promise<{content: string|null, status: number}>} Content and status
 */
async function fetchContent(url) {
  const res = await fetch(url);
  if (!res.ok) {
    return { content: null, status: res.status };
  }
  const content = await res.text();
  return { content, status: res.status };
}

/**
 * Escapes HTML entities for safe display.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Marks a page as having no differences in the nav list.
 * @param {string} pagePath - The page path to mark
 */
function markPageAsNoDiff(pagePath) {
  const buttons = DIFF_PAGE_LIST.querySelectorAll('button');
  buttons.forEach((button) => {
    // Check if this button's text content starts with the path
    if (button.textContent.startsWith(pagePath)) {
      button.classList.add('no-diff');
      const indicator = button.querySelector('.page-status-indicator');
      if (indicator) {
        indicator.textContent = '✓ No changes';
        indicator.classList.add('no-diff');
      }
    }
  });
}

/**
 * Marks a page as having pending changes in the nav list.
 * @param {string} pagePath - The page path to mark
 */
function markPageAsPending(pagePath) {
  const buttons = DIFF_PAGE_LIST.querySelectorAll('button');
  buttons.forEach((button) => {
    // Check if this button's text content starts with the path
    if (button.textContent.startsWith(pagePath)) {
      button.classList.add('has-changes');
      const indicator = button.querySelector('.page-status-indicator');
      if (indicator) {
        indicator.textContent = 'Pending changes';
        indicator.classList.add('has-changes');
      }
    }
  });
}

/**
 * Creates the panel HTML structure for displaying a diff.
 * @param {string} path - The page path
 * @param {string} previewPageUrl - Preview URL for the link
 * @param {string} livePageUrl - Live URL for the link
 * @param {string} bodyContent - HTML content for the panel body
 * @param {Object} stats - Optional stats object with addedCount and removedCount
 * @returns {string} Complete panel HTML
 */
function createDiffPanelHtml(path, previewPageUrl, livePageUrl, bodyContent, stats = null) {
  const totalChanges = stats ? stats.addedCount + stats.removedCount : 0;
  const hasChanges = totalChanges > 0;

  const toolbarHtml = hasChanges ? `
    <div class="diff-toolbar">
      <div class="diff-toolbar-stats">
        <span class="diff-stat diff-stat-added">+${stats.addedCount} addition${stats.addedCount !== 1 ? 's' : ''}</span>
        <span class="diff-stat diff-stat-removed">−${stats.removedCount} removal${stats.removedCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="diff-toolbar-nav">
        <span class="diff-nav-position"><span class="diff-nav-current">0</span> / ${totalChanges}</span>
        <button type="button" class="diff-nav-btn diff-nav-prev" aria-label="Previous change" title="Previous change (↑)">
          <span class="icon icon-chevron-up">↑</span> Prev
        </button>
        <button type="button" class="diff-nav-btn diff-nav-next" aria-label="Next change" title="Next change (↓)">
          Next <span class="icon icon-chevron-down">↓</span>
        </button>
      </div>
      <div class="diff-toolbar-toggle">
        <label class="diff-toggle-label">
          <input type="checkbox" class="diff-toggle-changes-only">
          <span>Show changes only</span>
        </label>
      </div>
    </div>
  ` : '';

  return `
    <div class="diff-panel" data-path="${escapeHtml(path)}" data-total-changes="${totalChanges}">
      <div class="diff-panel-header">
        <h3>${escapeHtml(path)}</h3>
        <div class="diff-panel-links">
          <a href="${previewPageUrl}" target="_blank">Preview</a>
          <a href="${livePageUrl}" target="_blank">Live</a>
        </div>
      </div>
      ${toolbarHtml}
      <div class="diff-panel-body">
        ${bodyContent}
      </div>
    </div>
  `;
}

/**
 * Creates a signature for an element to use for comparison.
 * Uses a normalized version of the content for fuzzy matching.
 * @param {Element} el - DOM element
 * @returns {string} Normalized signature
 */
function getElementSignature(el) {
  // Normalize whitespace and get text content for comparison
  return el.outerHTML.replace(/\s+/g, ' ').trim();
}

/**
 * Annotates DOM elements with diff classes (added/removed).
 * Compares elements at the section level and marks differences.
 * @param {Document} previewDom - Preview DOM
 * @param {Document} liveDom - Live DOM
 * @returns {Object} Object with addedCount and removedCount
 */
function annotateChanges(previewDom, liveDom) {
  const previewBody = previewDom.querySelector('body');
  const liveBody = liveDom.querySelector('body');

  const previewElements = [...previewBody.children];
  const liveElements = [...liveBody.children];

  // Create signature maps for comparison
  const liveSignatures = new Map();
  liveElements.forEach((el) => {
    const sig = getElementSignature(el);
    liveSignatures.set(sig, el);
  });

  const previewSignatures = new Map();
  previewElements.forEach((el) => {
    const sig = getElementSignature(el);
    previewSignatures.set(sig, el);
  });

  let addedCount = 0;
  let removedCount = 0;

  // Mark preview elements: added if not in live
  previewElements.forEach((el) => {
    const sig = getElementSignature(el);
    if (!liveSignatures.has(sig)) {
      el.classList.add('diff-added');
      addedCount += 1;
    }
  });

  // Mark live elements: removed if not in preview
  liveElements.forEach((el) => {
    const sig = getElementSignature(el);
    if (!previewSignatures.has(sig)) {
      el.classList.add('diff-removed');
      removedCount += 1;
    }
  });

  return { addedCount, removedCount };
}

/**
 * Computes a side-by-side DOM comparison between two markdown content strings.
 * Shows both rendered versions side by side with additions/deletions highlighted.
 * @param {string} liveContent - Live markdown content
 * @param {string} previewContent - Preview markdown content
 * @returns {Promise<Object>} Object with bodyHtml, noDiff flag, and change counts
 */
async function computeDomDiff(liveContent, previewContent) {
  await loadConverter();

  // Convert markdown to DOM
  const liveDom = mdToDocDom(liveContent);
  const previewDom = mdToDocDom(previewContent);

  // Check if the bodies are identical
  const liveBodyHtml = liveDom.querySelector('body').innerHTML;
  const previewBodyHtml = previewDom.querySelector('body').innerHTML;

  if (liveBodyHtml === previewBodyHtml) {
    return {
      bodyHtml: '<div class="diff-identical">No differences found in content.</div>',
      noDiff: true,
      addedCount: 0,
      removedCount: 0,
    };
  }

  // Annotate changes in both DOMs
  const { addedCount, removedCount } = annotateChanges(previewDom, liveDom);

  // Get the annotated HTML
  const annotatedPreviewHtml = previewDom.querySelector('body').innerHTML;
  const annotatedLiveHtml = liveDom.querySelector('body').innerHTML;

  // Create a side-by-side comparison view (preview on left, live on right)
  const bodyHtml = `
    <div class="doc-diff-compare">
      <div class="doc-diff-side doc-diff-preview">
        <div class="doc-diff-side-header">
          <span class="doc-diff-side-label">Preview Version</span>
        </div>
        <div class="doc-preview-content">
          ${annotatedPreviewHtml}
        </div>
      </div>
      <div class="doc-diff-side doc-diff-live">
        <div class="doc-diff-side-header">
          <span class="doc-diff-side-label">Live Version</span>
        </div>
        <div class="doc-preview-content">
          ${annotatedLiveHtml}
        </div>
      </div>
    </div>
  `;

  return {
    bodyHtml, noDiff: false, addedCount, removedCount,
  };
}

/**
 * Gets all change elements in the current diff view.
 * @returns {NodeList} List of change elements
 */
function getChangeElements() {
  return DIFF_CONTENT.querySelectorAll('.diff-added, .diff-removed');
}

/**
 * Updates the navigation position display.
 * @param {number} index - Current index (0-based)
 * @param {number} total - Total number of changes
 */
function updateNavPosition(index, total) {
  const currentSpan = DIFF_CONTENT.querySelector('.diff-nav-current');
  if (currentSpan) {
    currentSpan.textContent = total > 0 ? index + 1 : 0;
  }
}

/**
 * Scrolls to a specific change element and highlights it.
 * @param {number} index - Index of the change to navigate to
 */
function navigateToChange(index) {
  const changes = getChangeElements();
  if (changes.length === 0) return;

  // Remove highlight from previous change
  changes.forEach((el) => el.classList.remove('diff-highlight'));

  // Clamp index to valid range
  const newIndex = Math.max(0, Math.min(index, changes.length - 1));
  currentChangeIndex = newIndex;

  // Highlight and scroll to the new change
  const targetChange = changes[newIndex];
  if (targetChange) {
    targetChange.classList.add('diff-highlight');
    targetChange.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  updateNavPosition(newIndex, changes.length);
}

/**
 * Navigates to the next change.
 */
function navigateToNextChange() {
  const changes = getChangeElements();
  if (changes.length === 0) return;

  const nextIndex = currentChangeIndex < changes.length - 1 ? currentChangeIndex + 1 : 0;
  navigateToChange(nextIndex);
}

/**
 * Navigates to the previous change.
 */
function navigateToPrevChange() {
  const changes = getChangeElements();
  if (changes.length === 0) return;

  const prevIndex = currentChangeIndex > 0 ? currentChangeIndex - 1 : changes.length - 1;
  navigateToChange(prevIndex);
}

/**
 * Keyboard navigation for diff changes.
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeydown(e) {
  // Only handle if diff panel is visible
  if (DIFF_CONTENT.querySelector('.diff-panel')?.hasAttribute('data-total-changes')) {
    if (e.key === 'ArrowDown' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      navigateToNextChange();
    } else if (e.key === 'ArrowUp' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      navigateToPrevChange();
    }
  }
}

/**
 * Toggles between showing all content or only changes.
 * @param {boolean} showChangesOnly - Whether to show only changes
 */
function toggleChangesOnlyView(showChangesOnly) {
  const panel = DIFF_CONTENT.querySelector('.diff-panel');
  if (panel) {
    panel.classList.toggle('changes-only', showChangesOnly);
  }
}

/**
 * Sets up event listeners for the diff toolbar.
 */
function setupDiffToolbar() {
  // Reset current change index
  currentChangeIndex = -1;

  // Navigation buttons
  const prevBtn = DIFF_CONTENT.querySelector('.diff-nav-prev');
  const nextBtn = DIFF_CONTENT.querySelector('.diff-nav-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', navigateToPrevChange);
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', navigateToNextChange);
  }

  // Toggle for changes-only view
  const toggleCheckbox = DIFF_CONTENT.querySelector('.diff-toggle-changes-only');
  if (toggleCheckbox) {
    toggleCheckbox.addEventListener('change', (e) => {
      toggleChangesOnlyView(e.target.checked);
    });
  }

  // Remove previous listener if any and add new one
  document.removeEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', handleKeydown);
}

/**
 * Renders the diff view for a page.
 * @param {Object} page - Page resource object
 * @param {Object} cached - Cached content data
 */
async function renderDiffView(page, cached) {
  const { path } = page;
  const previewPageUrl = `https://${previewHost}${path}`;
  const livePageUrl = `https://${liveHost}${path}`;

  // Handle JSON files - always show the notice
  if (cached?.isJson) {
    const html = createDiffPanelHtml(path, previewPageUrl, livePageUrl, cached.bodyHtml);
    DIFF_CONTENT.innerHTML = html;
    return;
  }

  // Handle errors
  if (cached?.error) {
    const html = createDiffPanelHtml(path, previewPageUrl, livePageUrl, cached.bodyHtml);
    DIFF_CONTENT.innerHTML = html;
    return;
  }

  // Handle new pages (preview only, no live version)
  if (cached?.isNewPage) {
    const stats = { addedCount: cached.addedCount ?? 1, removedCount: 0 };
    DIFF_CONTENT.innerHTML = createDiffPanelHtml(
      path,
      previewPageUrl,
      livePageUrl,
      cached.bodyHtml,
      stats,
    );
    setupDiffToolbar();
    return;
  }

  // Render the diff
  let bodyHtml;
  let stats = null;
  if (cached?.previewContent && cached?.liveContent) {
    const result = await computeDomDiff(cached.liveContent, cached.previewContent);
    bodyHtml = result.bodyHtml;
    // Use cached stats if available (to avoid recomputation), or use result stats
    stats = {
      addedCount: cached.addedCount ?? result.addedCount ?? 0,
      removedCount: cached.removedCount ?? result.removedCount ?? 0,
    };
  } else {
    bodyHtml = '<div class="diff-identical">Content not loaded.</div>';
  }

  DIFF_CONTENT.innerHTML = createDiffPanelHtml(path, previewPageUrl, livePageUrl, bodyHtml, stats);

  // Set up toolbar functionality if there are changes
  if (stats && (stats.addedCount > 0 || stats.removedCount > 0)) {
    setupDiffToolbar();
  }
}

/**
 * Loads and displays the diff for a specific page.
 * Uses cache to avoid re-fetching previously viewed pages.
 * @param {Object} page - Page resource object
 */
async function loadPageDiff(page) {
  const { path } = page;

  // Regular URLs for the links
  const previewPageUrl = `https://${previewHost}${path}`;
  const livePageUrl = `https://${liveHost}${path}`;

  // Check cache first - if we have raw content cached, just re-render
  if (diffCache.has(path)) {
    const cached = diffCache.get(path);
    await renderDiffView(page, cached);
    return;
  }

  // Check if this is a JSON resource
  const isJson = path.endsWith('.json');

  // For JSON files, show a link to view on preview instead of diffing
  if (isJson) {
    const jsonBodyHtml = `
      <div class="diff-json-notice">
        <p>JSON files can be compared with the live version by viewing them on preview with your sidekick turned on.</p>
        <p>
          <a href="${previewPageUrl}?diff=only" target="_blank" class="button outline">
            View JSON on Preview
          </a>
        </p>
      </div>
    `;
    DIFF_CONTENT.innerHTML = createDiffPanelHtml(path, previewPageUrl, livePageUrl, jsonBodyHtml);
    diffCache.set(path, { bodyHtml: jsonBodyHtml, noDiff: false, isJson: true });
    return;
  }

  // Build admin API URLs to fetch markdown content
  const fetchPath = path.endsWith('/') ? `${path}index.md` : `${path}.md`;
  const previewUrl = `https://admin.hlx.page/preview/${currentOrg}/${currentSite}/main${fetchPath}`;
  const liveUrl = `https://admin.hlx.page/live/${currentOrg}/${currentSite}/main${fetchPath}`;

  // Show loading state
  DIFF_CONTENT.innerHTML = createDiffPanelHtml(
    path,
    previewPageUrl,
    livePageUrl,
    `<div class="diff-panel-loading">
      <i class="symbol symbol-loading"></i>
      <span>Loading content...</span>
    </div>`,
  );

  try {
    // Fetch both versions from admin API
    const [previewResult, liveResult] = await Promise.all([
      fetchContent(previewUrl),
      fetchContent(liveUrl),
    ]);

    // Check if preview content is available
    if (!previewResult.content) {
      throw new Error(`Preview content not available (status: ${previewResult.status})`);
    }

    const previewContent = previewResult.content;
    const liveContent = liveResult.content;

    // Handle case where live content is not available (new page, never published)
    if (!liveContent) {
      await loadConverter();
      const previewDom = mdToDocDom(previewContent);
      const previewBodyHtml = previewDom.querySelector('body').innerHTML;

      const newPageHtml = `
        <div class="diff-new-page">
          <div class="diff-new-page-notice">
            <span class="icon icon-info">ℹ</span>
            <span>This page has not been published yet. The content below shows the preview version.</span>
          </div>
          <div class="diff-new-page-preview">
            <div class="doc-diff-side-header">
              <span class="doc-diff-side-label">Preview Version (New)</span>
            </div>
            <div class="doc-preview-content diff-added">
              ${previewBodyHtml}
            </div>
          </div>
        </div>
      `;

      // Cache as new page
      const cached = {
        previewContent,
        liveContent: null,
        bodyHtml: newPageHtml,
        noDiff: false,
        isNewPage: true,
        addedCount: 1,
        removedCount: 0,
      };
      diffCache.set(path, cached);

      const stats = { addedCount: 1, removedCount: 0 };
      DIFF_CONTENT.innerHTML = createDiffPanelHtml(
        path,
        previewPageUrl,
        livePageUrl,
        newPageHtml,
        stats,
      );
      setupDiffToolbar();
      markPageAsPending(path);
      return;
    }

    // Compute DOM diff to check if there are differences
    const {
      noDiff, addedCount, removedCount,
    } = await computeDomDiff(liveContent, previewContent);

    // Cache the content
    const cached = {
      previewContent,
      liveContent,
      noDiff,
      addedCount,
      removedCount,
    };
    diffCache.set(path, cached);

    // Render based on current view
    await renderDiffView(page, cached);

    // Update the page status indicator
    if (noDiff) {
      markPageAsNoDiff(path);
    } else {
      markPageAsPending(path);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error loading diff:', error);

    const errorHtml = `<div class="diff-fetch-error">
      <span class="icon icon-notice"></span>
      <span>Failed to load page content: ${escapeHtml(error.message)}</span>
    </div>`;

    // Cache errors too so we don't retry on every click
    diffCache.set(path, { bodyHtml: errorHtml, noDiff: false, error: true });

    const panelBody = DIFF_CONTENT.querySelector('.diff-panel-body');
    panelBody.innerHTML = errorHtml;
  }
}

/**
 * Gets the filtered list of pages based on current filter settings.
 * @returns {Array} Filtered array of pages
 */
function getFilteredPages() {
  const hideDrafts = HIDE_DRAFTS?.checked ?? true;

  return pendingPages.filter((page) => {
    if (hideDrafts && page.path.startsWith('/drafts/')) {
      return false;
    }
    return true;
  });
}

/**
 * Updates the count display based on filtered pages.
 * @param {Array} filteredPages - The filtered list of pages
 */
function updateFilteredCount(filteredPages) {
  const total = pendingPages.length;
  const shown = filteredPages.length;

  if (shown === total) {
    DIFF_COUNT.textContent = `${total} page${total === 1 ? '' : 's'} with pending changes`;
  } else {
    DIFF_COUNT.textContent = `${shown} of ${total} pages shown (${total - shown} filtered)`;
  }
}

/**
 * Renders the page list navigation.
 * @param {boolean} autoSelectFirst - Whether to auto-select and load the first item
 */
function renderPageList(autoSelectFirst = true) {
  DIFF_PAGE_LIST.innerHTML = '';

  const filteredPages = getFilteredPages();
  updateFilteredCount(filteredPages);

  // Check if we have any pages to show after filtering
  if (filteredPages.length === 0) {
    DIFF_CONTENT.innerHTML = `
      <div class="diff-panel">
        <div class="diff-panel-body">
          <div class="diff-identical">No pages to display with current filters.</div>
        </div>
      </div>
    `;
    return;
  }

  filteredPages.forEach((page, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = page.path;

    // Check if this page was previously marked as no-diff
    const cached = diffCache.get(page.path);
    if (cached?.noDiff) {
      button.classList.add('no-diff');
    }

    // Add status indicator
    const indicator = document.createElement('span');
    indicator.className = 'page-status-indicator';
    if (cached?.noDiff) {
      indicator.textContent = '✓ No changes';
      indicator.classList.add('no-diff');
    } else if (cached && !cached.noDiff) {
      // Already computed and has changes
      indicator.textContent = 'Pending changes';
      indicator.classList.add('has-changes');
      button.classList.add('has-changes');
    } else {
      // Not yet computed
      indicator.textContent = 'Click to see changes';
    }
    button.appendChild(indicator);

    button.addEventListener('click', () => {
      // Update active state
      DIFF_PAGE_LIST.querySelectorAll('button').forEach((btn) => {
        btn.classList.remove('active');
      });
      button.classList.add('active');

      // Load the diff
      loadPageDiff(page);
    });

    // Auto-select first item
    if (autoSelectFirst && index === 0) {
      button.classList.add('active');
    }

    li.appendChild(button);
    DIFF_PAGE_LIST.appendChild(li);
  });

  // Load first page diff if auto-selecting
  if (autoSelectFirst && filteredPages.length > 0) {
    loadPageDiff(filteredPages[0]);
  }
}

/**
 * Applies embed mode styling by hiding unnecessary UI elements.
 */
function applyEmbedMode() {
  document.body.classList.add('embed-mode');
  // Hide header and footer
  const header = document.querySelector('header');
  const footer = document.querySelector('footer');
  if (header) header.style.display = 'none';
  if (footer) footer.style.display = 'none';
  // Hide back button and intro text
  const backButton = document.querySelector('a.button.outline');
  if (backButton) backButton.style.display = 'none';
  const introSection = document.querySelector('main > div:first-child');
  if (introSection) introSection.style.display = 'none';
}

/**
 * Applies single page mode styling by hiding the navigation sidebar.
 */
function applySinglePageMode() {
  document.body.classList.add('single-page-mode');
  // Hide the navigation and filters
  if (DIFF_NAV) DIFF_NAV.style.display = 'none';
  // Hide the info section in single page mode (path is shown in the panel header)
  if (DIFF_INFO) DIFF_INFO.style.display = 'none';
  // Adjust results grid to single column
  if (DIFF_RESULTS) DIFF_RESULTS.style.gridTemplateColumns = '1fr';
}

/**
 * Loads and displays the diff for a single page directly (without job).
 * @param {string} path - The page path to diff
 */
async function loadSinglePageDiff(path) {
  const page = { path };

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  page.path = normalizedPath;

  // Load the diff directly
  await loadPageDiff(page);
}

/**
 * Main initialization function.
 */
async function init() {
  // Get params from URL
  const params = new URLSearchParams(window.location.search);
  currentOrg = params.get('org');
  currentSite = params.get('site');
  currentJob = params.get('job');
  currentPath = params.get('path');
  isEmbedMode = params.get('embed') === 'true';
  isSinglePageMode = !!currentPath && !currentJob;

  // Apply embed mode if requested (do this early for visual consistency)
  if (isEmbedMode) {
    applyEmbedMode();
  }

  // Initialize config field only if not in embed mode
  if (!isEmbedMode) {
    await initConfigField();
  }

  if (!currentOrg || !currentSite) {
    showError('Missing org or site parameters. Use ?org=<org>&site=<site>&path=<path> or &job=<jobId>');
    return;
  }

  // Must have either path (single page mode) or job (multi-page mode)
  if (!currentPath && !currentJob) {
    showError('Missing path or job parameter. Provide either path=<pagePath> or job=<jobId>');
    return;
  }

  // Update info section
  DIFF_SITE.textContent = `${currentOrg}/${currentSite}`;
  DIFF_INFO.setAttribute('aria-hidden', 'false');

  // Show loading state
  updateDisplayState('loading');

  try {
    // Ensure login
    if (!await ensureLogin(currentOrg, currentSite)) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (loginInfo.includes(currentOrg)) {
          window.location.reload();
        }
      }, { once: true });
      showError('Please sign in to view page diffs.');
      return;
    }

    // Fetch host configuration
    const hosts = await fetchHosts(currentOrg, currentSite);
    previewHost = hosts.preview;
    liveHost = hosts.live;

    // Single page mode: directly load diff for the specified path
    if (isSinglePageMode) {
      applySinglePageMode();
      updateDisplayState('results');
      await loadSinglePageDiff(currentPath);
      return;
    }

    // Multi-page mode: fetch job details and show page list
    const resources = await fetchJobDetails(currentOrg, currentSite, currentJob);

    // Filter to pending pages only
    pendingPages = filterPendingPages(resources);

    if (pendingPages.length === 0) {
      updateDisplayState('no-results');
      return;
    }

    // Show results
    updateDisplayState('results');

    // Render page list (this also updates count and loads first page)
    renderPageList();

    // Add event listener for the drafts filter checkbox
    HIDE_DRAFTS?.addEventListener('change', () => {
      renderPageList();
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error initializing diff view:', error);
    showError(error.message || 'An error occurred while loading page status.');
  }
}

registerToolReady(init());
