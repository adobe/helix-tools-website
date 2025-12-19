import { diffLines } from '../version-admin/diff.js';
import { initConfigField } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';

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

// State
let currentOrg = '';
let currentSite = '';
let currentJob = '';
let previewHost = '';
let liveHost = '';
let pendingPages = [];

// Cache for diff results - keyed by page path
const diffCache = new Map();

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
 * @returns {Promise<string>} Content
 */
async function fetchContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
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
 * Renders a GitHub-style diff view.
 * @param {Array} diff - Diff result from diffLines
 * @returns {string} HTML string for the diff view
 */
function renderDiff(diff) {
  let oldLineNum = 1;
  let newLineNum = 1;
  let html = '<div class="diff-view">';

  // Count additions and removals
  let additions = 0;
  let removals = 0;

  diff.forEach((part) => {
    const lines = part.value.split('\n');
    // Remove last empty element if present (from trailing newline)
    if (lines[lines.length - 1] === '') lines.pop();

    lines.forEach((line) => {
      if (part.added) {
        additions += 1;
        html += `<div class="diff-line diff-add">
          <span class="diff-line-number">+${newLineNum}</span>
          <span class="diff-line-content">+${escapeHtml(line)}</span>
        </div>`;
        newLineNum += 1;
      } else if (part.removed) {
        removals += 1;
        html += `<div class="diff-line diff-remove">
          <span class="diff-line-number">-${oldLineNum}</span>
          <span class="diff-line-content">-${escapeHtml(line)}</span>
        </div>`;
        oldLineNum += 1;
      } else {
        html += `<div class="diff-line diff-context">
          <span class="diff-line-number">${oldLineNum}</span>
          <span class="diff-line-content"> ${escapeHtml(line)}</span>
        </div>`;
        oldLineNum += 1;
        newLineNum += 1;
      }
    });
  });

  html += '</div>';

  // Prepend stats
  const stats = `<div class="diff-stats">
    <span class="diff-stats-added">+${additions} additions</span>
    <span class="diff-stats-removed">-${removals} deletions</span>
  </div>`;

  return stats + html;
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
        indicator.textContent = '✓ No diff';
        indicator.classList.add('no-diff');
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
 * @returns {string} Complete panel HTML
 */
function createDiffPanelHtml(path, previewPageUrl, livePageUrl, bodyContent) {
  return `
    <div class="diff-panel" data-path="${escapeHtml(path)}">
      <div class="diff-panel-header">
        <h3>${escapeHtml(path)}</h3>
        <div class="diff-panel-links">
          <a href="${previewPageUrl}" target="_blank">Preview</a>
          <a href="${livePageUrl}" target="_blank">Live</a>
        </div>
      </div>
      <div class="diff-panel-body">
        ${bodyContent}
      </div>
    </div>
  `;
}

/**
 * Computes a diff between two content strings.
 * @param {string} liveContent - Live content
 * @param {string} previewContent - Preview content
 * @returns {Object} Object with bodyHtml and noDiff flag
 */
function computeDiff(liveContent, previewContent) {
  // Compute diff
  const diff = diffLines(liveContent, previewContent);

  // Check if there are actual differences
  const hasDifferences = diff.some((part) => part.added || part.removed);

  let bodyHtml;
  if (!hasDifferences) {
    bodyHtml = '<div class="diff-identical">No differences found in content.</div>';
  } else {
    bodyHtml = renderDiff(diff);
  }

  return { bodyHtml, noDiff: !hasDifferences };
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

    // For JSON or error entries, use cached HTML directly
    if (cached.isJson || cached.error) {
      DIFF_CONTENT.innerHTML = createDiffPanelHtml(
        path,
        previewPageUrl,
        livePageUrl,
        cached.bodyHtml,
      );
      return;
    }

    // For markdown content, compute and render the diff
    if (cached.previewContent && cached.liveContent) {
      const { bodyHtml } = computeDiff(cached.liveContent, cached.previewContent);
      DIFF_CONTENT.innerHTML = createDiffPanelHtml(path, previewPageUrl, livePageUrl, bodyHtml);
      return;
    }
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
      <span>Loading diff...</span>
    </div>`,
  );

  try {
    // Fetch both versions from admin API
    const [previewContent, liveContent] = await Promise.all([
      fetchContent(previewUrl),
      fetchContent(liveUrl),
    ]);

    // Compute diff
    const { bodyHtml, noDiff } = computeDiff(liveContent, previewContent);

    // Cache the content and result
    diffCache.set(path, {
      previewContent,
      liveContent,
      bodyHtml,
      noDiff,
    });

    // Render the diff
    DIFF_CONTENT.innerHTML = createDiffPanelHtml(path, previewPageUrl, livePageUrl, bodyHtml);

    // Mark as no-diff if applicable
    if (noDiff) {
      markPageAsNoDiff(path);
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
      indicator.textContent = '✓ No diff';
      indicator.classList.add('no-diff');
    } else {
      indicator.textContent = 'Pending changes';
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
 * Main initialization function.
 */
async function init() {
  await initConfigField();

  // Get org/site/job from URL params
  const params = new URLSearchParams(window.location.search);
  currentOrg = params.get('org');
  currentSite = params.get('site');
  currentJob = params.get('job');

  if (!currentOrg || !currentSite) {
    showError('Missing org or site parameters. Please go back to Page Status and try again.');
    return;
  }

  if (!currentJob) {
    showError('Missing job ID. Please run Page Status first, then click Diff Mode.');
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

    // Fetch job details from existing job (reuse from page-status)
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

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
