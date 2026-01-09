import DataLoader from './loader.js';
import { updateChart } from './chart.js';
import { formatRelativeDate, formatNumber } from './utils.js';
import { decorateIcons } from '../../scripts/aem.js';

const dataLoader = new DataLoader();
dataLoader.apiEndpoint = 'https://bundles.aem.page';

const state = {
  domain: null,
  domainKey: null,
  dateRange: null,
  pathPrefixFilter: null,
  sourceFilter: null,
  targetFilter: null,
  showAllErrors: false,
};

const data = {
  cached: [],
  filtered: [],
};

// Toast notification
function showToast(message, type = 'success') {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.classList.add('toast-notification', type);
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

function updateState() {
  // update ui elements and url params from the state object
  const url = new URL(window.location.href);
  url.search = '';
  Object.entries(state).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  });
  window.history.replaceState({}, document.title, url.href);

  // update ui elements from the state object
  if (state.domain) {
    document.querySelector('.domain-name').textContent = state.domain;
    const favicon = document.querySelector('.favicon img');
    favicon.src = `https://www.google.com/s2/favicons?domain=${state.domain}&sz=64`;
    favicon.alt = `favicon for ${state.domain}`;
    favicon.style.display = null;

    document.getElementById('modal-domain').value = state.domain;
  }

  const explorerTrigger = document.querySelector('.explorer-trigger');
  if (state.domain && state.domainKey) {
    const explorerUrl = new URL(explorerTrigger.href);
    explorerUrl.search = '';
    explorerUrl.searchParams.set('domain', state.domain);
    explorerUrl.searchParams.set('domainkey', state.domainKey);
    explorerUrl.searchParams.set('view', state.dateRange || 'month');
    if (state.pathPrefixFilter) {
      explorerUrl.searchParams.set('filter', state.pathPrefixFilter);
    }
    if (state.sourceFilter) {
      explorerUrl.searchParams.set('source', state.sourceFilter);
    }
    if (state.targetFilter) {
      explorerUrl.searchParams.set('target', state.targetFilter);
    }
    explorerUrl.searchParams.set('checkpoint', 'error');
    explorerTrigger.href = explorerUrl.href;
    explorerTrigger.style.display = 'block';
  } else {
    explorerTrigger.style.display = 'none';
  }

  if (state.dateRange) {
    document.getElementById('date-range').value = state.dateRange;
  }

  // Sync filter panel inputs if they exist
  const filterPath = document.getElementById('filter-path');
  const filterSource = document.getElementById('filter-source');
  const filterTarget = document.getElementById('filter-target');
  const filterTriggerBtn = document.querySelector('.filter-panel-trigger');

  if (filterPath) filterPath.value = state.pathPrefixFilter || '';
  if (filterSource) filterSource.value = state.sourceFilter || '';
  if (filterTarget) filterTarget.value = state.targetFilter || '';

  if (filterTriggerBtn) {
    const hasActiveFilters = state.pathPrefixFilter
      || state.sourceFilter || state.targetFilter;
    filterTriggerBtn.classList.toggle('has-filters', hasActiveFilters);
  }
}

function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const domainKey = params.get('domainKey');
  const domain = params.get('domain');
  const dateRange = params.get('dateRange');
  const pathPrefixFilter = params.get('pathPrefixFilter');
  const sourceFilter = params.get('sourceFilter');
  const targetFilter = params.get('targetFilter');
  return {
    domain, domainKey, dateRange, pathPrefixFilter, sourceFilter, targetFilter,
  };
}

function formatUrls(urlsObject) {
  // Convert object to array and sort by occurrence count (descending)
  const urlEntries = Object.entries(urlsObject).sort((a, b) => b[1] - a[1]);

  if (urlEntries.length === 0) {
    return '-';
  }

  // Show up to 3 URLs
  const urlsToShow = urlEntries.slice(0, 3);
  const remainingCount = urlEntries.length - urlsToShow.length;

  let result = '<ul class="url-list">';
  urlsToShow.forEach(([url, count]) => {
    result += `<li>
      <div class="url-row">
        <a href="${url}" class="url-text" target="_blank" rel="noopener noreferrer">${url}</a>
        <span class="url-count">(${formatNumber(count)})</span>
      </div>
    </li>`;
  });
  result += '</ul>';

  if (remainingCount > 0) {
    result += `<small class="more-urls">${remainingCount} more URL${remainingCount === 1 ? '' : 's'}</small>`;
  }

  return result;
}

function setLoading(isLoading) {
  const errorListContainer = document.querySelector('.error-list-container');
  const errorGraphContainer = document.querySelector('.error-graph-container');
  const dateRange = document.getElementById('date-range');

  if (errorListContainer) {
    if (isLoading) {
      errorListContainer.classList.add('loading');
    } else {
      errorListContainer.classList.remove('loading');
    }
  }

  if (errorGraphContainer) {
    if (isLoading) {
      errorGraphContainer.classList.remove('visible');
    }
  }

  if (dateRange) {
    dateRange.disabled = isLoading;
  }
}

function renderFilteredData() {
  if (!data.filtered || data.filtered.length === 0) {
    return;
  }

  const errorList = document.getElementById('error-list');
  errorList.replaceChildren();

  // Calculate max weight for relative sizing
  const maxWeight = Math.max(...data.filtered.map((item) => item.weight));

  // Determine how many items to show
  const itemsToShow = state.showAllErrors ? data.filtered : data.filtered.slice(0, 10);
  const hasMore = data.filtered.length > 10;

  // Render error items
  itemsToShow.forEach((item) => {
    const li = document.createElement('li');
    li.classList.add('error-item');

    // Calculate relative percentage for progress bar
    const percentage = (item.weight / maxWeight) * 100;

    // Determine severity level based on weight
    let severity = 'low';
    if (percentage >= 70) {
      severity = 'critical';
    } else if (percentage >= 40) {
      severity = 'high';
    } else if (percentage >= 20) {
      severity = 'medium';
    }

    li.setAttribute('data-severity', severity);

    // Extract URL from source if it exists
    // Handles two formats:
    // 1. @https://url:line:column
    // 2. @text (https://url:line:column)
    const sourceUrlMatch = item.source.match(/\(?(https?:\/\/[^\s)]+?)(?::\d+:\d+)?\)?$/);
    const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : null;

    li.innerHTML = `
      <div class="error-source">
        <code tabindex="0" data-value="${item.source.replace(/"/g, '&quot;')}">${item.source}</code>
        <div class="action-buttons">
          <button class="copy-btn" data-value="${item.source.replace(/"/g, '&quot;')}" title="Copy to clipboard">
            <span class="icon icon-copy"></span>
          </button>
          ${sourceUrl ? `<a href="${sourceUrl}" class="view-source-btn" target="_blank" rel="noopener noreferrer" title="Open source URL">
            <span class="icon icon-code"></span>
          </a>` : ''}
        </div>
      </div>
      <div class="error-target">
        <code tabindex="0" data-value="${item.target.replace(/"/g, '&quot;')}">${item.target}</code>
        <div class="action-buttons">
          <button class="copy-btn" data-value="${item.target.replace(/"/g, '&quot;')}" title="Copy to clipboard">
            <span class="icon icon-copy"></span>
          </button>
        </div>
      </div>
      <div class="error-urls">${formatUrls(item.urls)}</div>
      <div class="error-last-seen">${item.timestamp ? formatRelativeDate(item.timestamp) : '-'}</div>
      <div class="error-count">
        <div class="count-bar">
          <div class="count-bar-fill ${severity}" style="width: ${percentage}%"></div>
        </div>
        <span class="count-badge ${severity}">${formatNumber(item.weight)}</span>
      </div>
    `;
    errorList.append(li);
  });

  // Decorate icons in the newly added items
  decorateIcons(errorList);

  // Add show more/less button if needed
  const existingShowMoreBtn = document.querySelector('.show-more-errors-btn');
  if (existingShowMoreBtn) {
    existingShowMoreBtn.remove();
  }

  if (hasMore) {
    const showMoreBtn = document.createElement('button');
    showMoreBtn.classList.add('show-more-errors-btn', 'button', 'outline');
    showMoreBtn.textContent = state.showAllErrors
      ? `Show Less (showing ${data.filtered.length} of ${data.filtered.length})`
      : `Show ${data.filtered.length - 10} More (showing 10 of ${data.filtered.length})`;

    showMoreBtn.addEventListener('click', () => {
      state.showAllErrors = !state.showAllErrors;
      renderFilteredData();

      if (!state.showAllErrors) {
        // Scroll to top of error list when collapsing
        document.querySelector('.error-list-container').scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    });

    errorList.after(showMoreBtn);
  }

  // Update graph heading with count and period
  const totalCount = data.filtered.reduce((sum, item) => sum + item.weight, 0);
  const periodMap = {
    week: 'week',
    month: 'month',
    year: 'year',
  };
  const period = periodMap[state.dateRange] || 'month';
  const graphHeading = document.querySelector('.error-graph-container h2');
  if (graphHeading) {
    graphHeading.textContent = `Error Trends: ~${formatNumber(totalCount)} errors in the last ${period}`;
  }

  updateChart(data.filtered, state.dateRange);

  // Handle copy buttons
  errorList.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const value = btn.getAttribute('data-value');
      try {
        await navigator.clipboard.writeText(value);
        btn.classList.add('copied');
        showToast('Copied to clipboard!');
        setTimeout(() => {
          btn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        showToast('Failed to copy', 'error');
        // eslint-disable-next-line no-console
        console.error('Failed to copy:', err);
      }
    });
  });
}

async function refreshResults(refreshCached = true) {
  const {
    domain, domainKey, dateRange, pathPrefixFilter, sourceFilter, targetFilter,
  } = state;
  if (!domain || !domainKey) {
    return;
  }

  // Reset show all state when refreshing
  state.showAllErrors = false;

  setLoading(true);

  try {
    const errorList = document.getElementById('error-list');
    errorList.replaceChildren();

    if (refreshCached) {
      data.cached = [];
      dataLoader.domainKey = domainKey;
      dataLoader.domain = domain;
      let chunks;
      switch (dateRange) {
        case 'week':
          chunks = await dataLoader.fetchLastWeek();
          break;
        case 'year':
          chunks = await dataLoader.fetchPrevious12Months();
          break;
        case 'month':
        default:
          chunks = await dataLoader.fetchPrevious31Days();
          break;
      }

      chunks.forEach((chunk) => {
        chunk.rumBundles.forEach((bundle) => {
          bundle.events.forEach((event) => {
            if (event.checkpoint === 'error') {
              if (!event.target) {
                event.target = '-';
              } else if (typeof event.target !== 'string') {
                event.target = event.target.toString();
              }
              if (!event.source) {
                event.source = '-';
              } else if (typeof event.source !== 'string') {
                event.source = event.source.toString();
              }

              const groupInto = data.cached.find((item) => (
                item.source.toLowerCase() === event.source.toLowerCase()
                && item.target.toLowerCase() === event.target.toLowerCase()
              ));

              if (groupInto) {
                groupInto.urls[bundle.url] = (groupInto.urls[bundle.url] || 0)
                  + (bundle.weight || 1);
                groupInto.weight += bundle.weight || 1;

                const ts = new Date(bundle.timeSlot || event.time);
                if (ts > groupInto.timestamp) {
                  groupInto.timestamp = ts;
                }

                // Track all time slots for chart data
                groupInto.timeSlots.push({
                  time: ts,
                  weight: bundle.weight || 1,
                  url: bundle.url,
                });
              } else {
                const ts = new Date(bundle.timeSlot || event.time);
                data.cached.push({
                  source: event.source,
                  target: event.target,
                  urls: { [bundle.url]: bundle.weight || 1 },
                  timestamp: ts,
                  weight: bundle.weight || 1,
                  timeSlots: [{
                    time: ts,
                    weight: bundle.weight || 1,
                    url: bundle.url,
                  }],
                });
              }
            }
          });
        });
      });

      data.cached.sort((a, b) => b.weight - a.weight);
    }

    // Helper to check if a URL matches the active URL filters
    const urlMatchesFilters = (url) => {
      // Check path prefix filter
      if (pathPrefixFilter) {
        try {
          const urlPath = new URL(url).pathname;
          if (!urlPath.startsWith(pathPrefixFilter)) return false;
        } catch {
          return false;
        }
      }

      return true;
    };

    const hasPathFilter = !!pathPrefixFilter;

    data.filtered = data.cached
      .map((item) => {
        // First check source/target filters (these filter entire groups)
        if (sourceFilter && item.source.toLowerCase() !== sourceFilter.toLowerCase()) {
          return null;
        }
        if (targetFilter && item.target.toLowerCase() !== targetFilter.toLowerCase()) {
          return null;
        }

        // If path filter is active, recalculate weights based on matching URLs
        if (hasPathFilter) {
          const filteredUrls = {};
          let filteredWeight = 0;

          Object.entries(item.urls).forEach(([url, count]) => {
            if (urlMatchesFilters(url)) {
              filteredUrls[url] = count;
              filteredWeight += count;
            }
          });

          // Skip items with no matching URLs
          if (filteredWeight === 0) return null;

          const filteredTimeSlots = item.timeSlots.filter((slot) => urlMatchesFilters(slot.url));

          // Find max timestamp without spreading (avoids stack overflow with large arrays)
          const maxTime = filteredTimeSlots.reduce(
            (max, s) => Math.max(max, s.time.getTime()),
            0,
          );

          return {
            ...item,
            urls: filteredUrls,
            weight: filteredWeight,
            timeSlots: filteredTimeSlots,
            timestamp: maxTime > 0 ? new Date(maxTime) : item.timestamp,
          };
        }

        return item;
      })
      .filter((item) => item !== null);

    // Re-sort by weight after filtering
    data.filtered.sort((a, b) => b.weight - a.weight);

    renderFilteredData();
  } finally {
    setLoading(false);
  }
}

async function init() {
  // Create loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.id = 'loading-indicator';
  loadingIndicator.innerHTML = `
    <div class="spinner"></div>
    <div class="loading-text">Loading error data...</div>
  `;
  document.querySelector('.error-list-container').prepend(loadingIndicator);

  const errorsHeader = document.createElement('div');
  errorsHeader.classList.add('errors-header');
  errorsHeader.innerHTML = `
    <div class="error-source">Source</div>
    <div class="error-target">Target</div>
    <div class="error-urls">URLs</div>
    <div class="error-last-seen">Last Seen</div>
    <div class="error-count">
      <span>Estimated Occurrences</span>
      <button class="filter-panel-trigger" title="Filters" aria-expanded="false" aria-controls="filter-panel">
        <span class="icon icon-filter"></span>
      </button>
    </div>
  `;
  document.getElementById('error-list').before(errorsHeader);
  decorateIcons(errorsHeader);

  // Create filter panel
  const filterPanel = document.createElement('div');
  filterPanel.id = 'filter-panel';
  filterPanel.classList.add('filter-panel');
  filterPanel.innerHTML = `
    <div class="filter-panel-content">
      <div class="filter-field">
        <label for="filter-path">Path Prefix</label>
        <input type="text" id="filter-path" placeholder="/blog/" list="path-suggestions">
        <datalist id="path-suggestions"></datalist>
      </div>
      <div class="filter-field">
        <label for="filter-source">Source</label>
        <input type="text" id="filter-source" placeholder="Error source..." list="source-suggestions">
        <datalist id="source-suggestions"></datalist>
      </div>
      <div class="filter-field">
        <label for="filter-target">Target</label>
        <input type="text" id="filter-target" placeholder="Error message..." list="target-suggestions">
        <datalist id="target-suggestions"></datalist>
      </div>
      <div class="filter-actions">
        <button type="button" class="filter-apply button">Apply Filters</button>
        <button type="button" class="filter-clear button outline">Clear All</button>
      </div>
    </div>
  `;
  errorsHeader.after(filterPanel);

  // Filter panel logic
  const filterTrigger = errorsHeader.querySelector('.filter-panel-trigger');
  const filterPathInput = filterPanel.querySelector('#filter-path');
  const filterSourceInput = filterPanel.querySelector('#filter-source');
  const filterTargetInput = filterPanel.querySelector('#filter-target');
  const filterApplyBtn = filterPanel.querySelector('.filter-apply');
  const filterClearBtn = filterPanel.querySelector('.filter-clear');

  // Datalist elements for autocomplete
  const pathDatalist = filterPanel.querySelector('#path-suggestions');
  const sourceDatalist = filterPanel.querySelector('#source-suggestions');
  const targetDatalist = filterPanel.querySelector('#target-suggestions');

  function updateDatalistOptions() {
    const paths = new Set();
    const sources = new Set();
    const targets = new Set();

    data.cached.forEach((item) => {
      sources.add(item.source);
      targets.add(item.target);
      Object.keys(item.urls).forEach((url) => {
        try {
          const { pathname } = new URL(url);
          paths.add(pathname);
          // Also add parent paths
          const parts = pathname.split('/').filter(Boolean);
          let prefix = '';
          parts.forEach((part) => {
            prefix += `/${part}`;
            paths.add(prefix);
          });
        } catch {
          // Ignore invalid URLs
        }
      });
    });

    // Sort and limit suggestions
    const sortedPaths = Array.from(paths).sort().slice(0, 100);
    const sortedSources = Array.from(sources).slice(0, 50);
    const sortedTargets = Array.from(targets).slice(0, 50);

    pathDatalist.innerHTML = sortedPaths.map((p) => `<option value="${p}">`).join('');
    sourceDatalist.innerHTML = sortedSources.map((s) => `<option value="${s.replace(/"/g, '&quot;')}">`).join('');
    targetDatalist.innerHTML = sortedTargets.map((t) => `<option value="${t.replace(/"/g, '&quot;')}">`).join('');
  }

  function setFilterPanelOpen(isOpen) {
    filterPanel.classList.toggle('open', isOpen);
    filterTrigger.setAttribute('aria-expanded', isOpen);
  }

  filterTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !filterPanel.classList.contains('open');
    setFilterPanelOpen(isOpen);
    if (isOpen) {
      filterPathInput.focus();
      updateDatalistOptions();
    }
  });

  function applyFilters() {
    state.pathPrefixFilter = filterPathInput.value.trim() || null;
    state.sourceFilter = filterSourceInput.value.trim() || null;
    state.targetFilter = filterTargetInput.value.trim() || null;
    updateState();
    refreshResults(false);
    setFilterPanelOpen(false);
  }

  function clearFilters() {
    filterPathInput.value = '';
    filterSourceInput.value = '';
    filterTargetInput.value = '';
    state.pathPrefixFilter = null;
    state.sourceFilter = null;
    state.targetFilter = null;
    updateState();
    refreshResults(false);
    setFilterPanelOpen(false);
  }

  filterApplyBtn.addEventListener('click', applyFilters);
  filterClearBtn.addEventListener('click', clearFilters);

  // Handle Enter key in filter inputs
  [filterPathInput, filterSourceInput, filterTargetInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFilters();
      }
      if (e.key === 'Escape') {
        setFilterPanelOpen(false);
      }
    });
  });

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!filterPanel.contains(e.target) && !filterTrigger.contains(e.target)) {
      setFilterPanelOpen(false);
    }
  });

  const modal = document.getElementById('domain-modal');
  document.getElementById('domain-trigger').addEventListener('click', () => {
    modal.showModal();
  });

  modal.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const domainInput = e.target.domain.value.trim();
    const domainKey = e.target.domainKey.value;

    // Extract just the domain, removing protocol and path
    let domain = domainInput;
    try {
      // Try to parse as URL
      const url = new URL(domainInput.includes('://') ? domainInput : `https://${domainInput}`);
      domain = url.hostname;
    } catch {
      // If URL parsing fails, use the input as-is
      domain = domainInput;
    }

    state.domain = domain;
    state.domainKey = domainKey;
    state.pathPrefixFilter = null;
    state.sourceFilter = null;
    state.targetFilter = null;
    updateState();
    refreshResults();

    modal.close();
  });

  modal.querySelector('#modal-cancel').addEventListener('click', () => {
    modal.close();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.close();
    }
  });

  document.getElementById('date-range').addEventListener('change', () => {
    state.dateRange = document.getElementById('date-range').value;
    updateState();
    refreshResults();
  });

  const {
    domain, domainKey, dateRange, pathPrefixFilter, sourceFilter, targetFilter,
  } = getStateFromURL();

  state.domain = domain;
  state.domainKey = domainKey;
  state.dateRange = dateRange;
  state.pathPrefixFilter = pathPrefixFilter;
  state.sourceFilter = sourceFilter;
  state.targetFilter = targetFilter;
  updateState();

  if (domain && domainKey) {
    setTimeout(refreshResults, 100);
  } else {
    modal.showModal();
  }
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
