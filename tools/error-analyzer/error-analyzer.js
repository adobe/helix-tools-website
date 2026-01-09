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
  urlFilter: null,
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
    if (state.urlFilter) {
      explorerUrl.searchParams.set('url', state.urlFilter);
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

  // Sync path prefix input with state
  const pathPrefixInput = document.getElementById('path-prefix');
  if (pathPrefixInput && state.pathPrefixFilter !== pathPrefixInput.value) {
    pathPrefixInput.value = state.pathPrefixFilter || '';
  }

  const filterIndicator = document.querySelector('.filter-indicator');
  const hasFilters = state.urlFilter || state.sourceFilter || state.targetFilter;

  if (hasFilters) {
    const filters = [];

    if (state.urlFilter) {
      filters.push(`<div class="filter-item"><strong>URL:</strong> <a href="${state.urlFilter}" target="_blank" rel="noopener noreferrer">${state.urlFilter}</a></div>`);
    }

    if (state.sourceFilter) {
      filters.push(`<div class="filter-item"><strong>Source:</strong> <code class="filter-text">${state.sourceFilter}</code></div>`);
    }

    if (state.targetFilter) {
      filters.push(`<div class="filter-item"><strong>Target:</strong> <code class="filter-text">${state.targetFilter}</code></div>`);
    }

    filterIndicator.innerHTML = `
      <div class="filter-content">
        ${filters.join('')}
      </div>
      <button class="clear-filter">Clear Filters</button>
    `;

    filterIndicator.querySelector('.clear-filter').addEventListener('click', () => {
      state.urlFilter = null;
      state.sourceFilter = null;
      state.targetFilter = null;
      updateState();
      // eslint-disable-next-line no-use-before-define
      refreshResults(false);
    });

    filterIndicator.classList.add('active');
  } else {
    filterIndicator.innerHTML = '';
    filterIndicator.classList.remove('active');
  }
}

function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const domainKey = params.get('domainKey');
  const domain = params.get('domain');
  const dateRange = params.get('dateRange');
  const pathPrefixFilter = params.get('pathPrefixFilter');
  const urlFilter = params.get('urlFilter');
  const sourceFilter = params.get('sourceFilter');
  const targetFilter = params.get('targetFilter');
  return {
    domain, domainKey, dateRange, pathPrefixFilter, urlFilter, sourceFilter, targetFilter,
  };
}

function formatUrls(urlsObject, activeFilter = null) {
  // Convert object to array and sort by occurrence count (descending)
  const urlEntries = Object.entries(urlsObject).sort((a, b) => b[1] - a[1]);

  if (urlEntries.length === 0) {
    return '-';
  }

  // If there's an active filter, prioritize showing that URL first
  let displayEntries;
  if (activeFilter && activeFilter in urlsObject) {
    // Put filtered URL first, then others
    const filtered = [activeFilter, urlsObject[activeFilter]];
    const others = urlEntries.filter(([url]) => url !== activeFilter);
    displayEntries = [filtered, ...others];
  } else {
    displayEntries = urlEntries;
  }

  // Show up to 3 URLs
  const urlsToShow = displayEntries.slice(0, 3);
  const remainingCount = displayEntries.length - urlsToShow.length;

  let result = '<ul class="url-list">';
  urlsToShow.forEach(([url, count]) => {
    const isUrlFiltered = activeFilter === url;
    result += `<li>
      <div class="url-row">
        <span class="url-text" tabindex="0">${url}</span>
        <span class="url-count">(${formatNumber(count)})</span>
      </div>
      <div class="action-buttons">
        <button class="filter-url-btn" data-url="${url.replace(/"/g, '&quot;')}" title="Filter by this URL" ${isUrlFiltered ? 'disabled' : ''}>
          <span class="icon icon-filter"></span>
        </button>
        <a href="${url}" class="open-url-btn" target="_blank" rel="noopener noreferrer" title="Open in new tab">
          <span class="icon icon-external"></span>
        </a>
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
  const pathPrefix = document.getElementById('path-prefix');

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

  if (pathPrefix) {
    pathPrefix.disabled = isLoading;
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

    const isSourceFiltered = state.sourceFilter
      && item.source.toLowerCase() === state.sourceFilter.toLowerCase();
    const isTargetFiltered = state.targetFilter
      && item.target.toLowerCase() === state.targetFilter.toLowerCase();

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
          <button class="filter-btn" data-value="${item.source.replace(/"/g, '&quot;')}" data-type="source" title="Filter by this source" ${isSourceFiltered ? 'disabled' : ''}>
            <span class="icon icon-filter"></span>
          </button>
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
          <button class="filter-btn" data-value="${item.target.replace(/"/g, '&quot;')}" data-type="target" title="Filter by this target" ${isTargetFiltered ? 'disabled' : ''}>
            <span class="icon icon-filter"></span>
          </button>
          <button class="copy-btn" data-value="${item.target.replace(/"/g, '&quot;')}" title="Copy to clipboard">
            <span class="icon icon-copy"></span>
          </button>
        </div>
      </div>
      <div class="error-urls">${formatUrls(item.urls, state.urlFilter)}</div>
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

  // Handle filter URL buttons
  errorList.querySelectorAll('.filter-url-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      state.urlFilter = url;
      updateState();
      // eslint-disable-next-line no-use-before-define
      refreshResults(false);

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    });
  });

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

  // Handle filter buttons
  errorList.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const value = btn.getAttribute('data-value');
      const type = btn.getAttribute('data-type');

      if (type === 'source') {
        state.sourceFilter = value;
      } else if (type === 'target') {
        state.targetFilter = value;
      }

      updateState();
      // eslint-disable-next-line no-use-before-define
      refreshResults(false);

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    });
  });
}

async function refreshResults(refreshCached = true) {
  const {
    domain, domainKey, dateRange, pathPrefixFilter, urlFilter, sourceFilter, targetFilter,
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

    // Helper to check if a URL matches the path prefix
    const urlMatchesPathPrefix = (url) => {
      if (!pathPrefixFilter) return true;
      try {
        const urlPath = new URL(url).pathname;
        return urlPath.startsWith(pathPrefixFilter);
      } catch {
        return false;
      }
    };

    data.filtered = data.cached
      .map((item) => {
        // If path prefix filter is active, create a filtered copy of the item
        if (pathPrefixFilter) {
          const filteredUrls = {};
          let filteredWeight = 0;

          Object.entries(item.urls).forEach(([url, count]) => {
            if (urlMatchesPathPrefix(url)) {
              filteredUrls[url] = count;
              filteredWeight += count;
            }
          });

          // Skip items with no matching URLs
          if (filteredWeight === 0) return null;

          const filteredTimeSlots = item.timeSlots.filter((slot) => urlMatchesPathPrefix(slot.url));

          return {
            ...item,
            urls: filteredUrls,
            weight: filteredWeight,
            timeSlots: filteredTimeSlots,
            timestamp: filteredTimeSlots.length > 0
              ? new Date(Math.max(...filteredTimeSlots.map((s) => s.time.getTime())))
              : item.timestamp,
          };
        }
        return item;
      })
      .filter((item) => {
        if (!item) return false;

        let matches = true;

        if (urlFilter) {
          matches = matches && (urlFilter in item.urls);
        }

        if (sourceFilter) {
          matches = matches && (item.source.toLowerCase() === sourceFilter.toLowerCase());
        }

        if (targetFilter) {
          matches = matches && (item.target.toLowerCase() === targetFilter.toLowerCase());
        }

        return matches;
      });

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
    <div class="error-count">Estimated Occurrences</div>
  `;
  document.getElementById('error-list').before(errorsHeader);

  const filterIndicator = document.createElement('div');
  filterIndicator.classList.add('filter-indicator');
  document.getElementById('error-list').before(filterIndicator);

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
    state.urlFilter = null;
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

  // Path prefix filter on blur or Enter
  const pathPrefixInput = document.getElementById('path-prefix');

  function applyPathPrefixFilter() {
    const value = pathPrefixInput.value.trim();
    if (state.pathPrefixFilter !== (value || null)) {
      state.pathPrefixFilter = value || null;
      updateState();
      refreshResults(false);
    }
  }

  pathPrefixInput.addEventListener('blur', applyPathPrefixFilter);
  pathPrefixInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyPathPrefixFilter();
    }
  });

  const {
    domain, domainKey, dateRange, pathPrefixFilter, urlFilter, sourceFilter, targetFilter,
  } = getStateFromURL();

  state.domain = domain;
  state.domainKey = domainKey;
  state.dateRange = dateRange;
  state.pathPrefixFilter = pathPrefixFilter;
  state.urlFilter = urlFilter;
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
