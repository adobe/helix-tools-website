/**
 * Media Library Topbar view - search with folder/doc suggestions.
 */
import {
  getAppState,
  updateAppState,
  onStateChange,
  showNotification,
} from '../../core/state.js';
import {
  parseColonSyntax,
  getSearchSuggestions,
  createSearchSuggestion,
  initializeProcessedData,
} from '../../features/filters.js';
import { getMediaLibraryContext } from '../../core/context.js';
import { clearCache } from '../../core/storage.js';

function escapeAttribute(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applySearch(query) {
  const colonResult = parseColonSyntax(query);
  if (colonResult) {
    const { field, value } = colonResult;
    if (field === 'doc') {
      updateAppState({ selectedDocument: value, selectedFolder: null, searchQuery: '' });
    } else if (field === 'folder') {
      updateAppState({ selectedFolder: value, selectedDocument: null, searchQuery: '' });
    } else {
      updateAppState({ searchQuery: query, selectedDocument: null, selectedFolder: null });
    }
  } else {
    updateAppState({ searchQuery: query, selectedDocument: null, selectedFolder: null });
  }
}

function getDisplaySearchTerm(state) {
  if (state.selectedDocument) return `doc:${state.selectedDocument}`;
  if (state.selectedFolder) return `folder:${state.selectedFolder}`;
  return state.searchQuery || '';
}

function createInitialMarkup(state) {
  const displayTerm = getDisplaySearchTerm(state);
  const hasSearch = !!(displayTerm || state.selectedDocument || state.selectedFolder);
  const clearBtnAttrs = hasSearch ? '' : 'hidden';
  const clearCacheLabel = state.isClearingCache ? 'Clearing...' : 'Clear data';
  return `
    <div class="top-bar">
      <div class="topbar-spacer"></div>
      <div class="topbar-center">
        <div class="search-container">
          <div class="search-wrapper">
            <input type="text" id="media-search-input" role="combobox" aria-autocomplete="list" placeholder="Enter search term or / to filter by hierarchy" value="${escapeAttribute(displayTerm)}" autocomplete="off">
            <button type="button" class="clear-search-btn" title="Clear search" ${clearBtnAttrs}>✕</button>
            <div class="suggestions-dropdown hidden" role="listbox" id="suggestions-listbox"></div>
          </div>
        </div>
        <div class="result-count"></div>
      </div>
      <div class="topbar-actions">
        <button type="button" class="topbar-action-btn clear-cache-btn" title="Clear existing data" ${state.isClearingCache ? 'disabled' : ''}>${clearCacheLabel}</button>
        <button type="button" class="topbar-action-btn change-site-btn" title="Change organization, site, or path">Change site</button>
      </div>
    </div>`;
}

function getSuggestionQuery(suggestion) {
  if (suggestion.type === 'doc') return `doc:${suggestion.value}`;
  if (suggestion.type === 'folder') return `folder:${suggestion.value}`;
  if (suggestion.type === 'media') return suggestion.value?.name || suggestion.value?.url || '';
  return '';
}

function updateSuggestionsDropdown(block, suggestions, activeIndex) {
  const dropdown = block.querySelector('.suggestions-dropdown');
  if (!dropdown) return;

  if (!suggestions.length) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  dropdown.classList.remove('hidden');
  const folderSvg = '<svg class="suggestion-icon folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const docSvg = '<svg class="suggestion-icon doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
  const mediaSvg = '<svg class="suggestion-icon media-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

  dropdown.innerHTML = suggestions.map((suggestion, index) => {
    const isActive = index === activeIndex;
    const display = escapeHtml(suggestion.display || '');
    let icon = mediaSvg;
    if (suggestion.type === 'folder') icon = folderSvg;
    else if (suggestion.type === 'doc') icon = docSvg;
    return `<div class="suggestion-item ${isActive ? 'active' : ''}" role="option" data-index="${index}" tabindex="-1">
      <div class="suggestion-main">${icon}<span class="suggestion-text">${display}</span></div>
    </div>`;
  }).join('');
}

function updateResultCount(block, state) {
  const countEl = block.querySelector('.result-count');
  if (!countEl) return;
  countEl.hidden = !state.org || !state.site;
  if (state.org && state.site) {
    if (state.isValidating || state.isIndexing) {
      countEl.innerHTML = '<span class="result-count-spinner"></span>';
    } else {
      countEl.textContent = state.resultSummary || '';
    }
  }
}

function updateClearCacheButton(block, state) {
  const btn = block.querySelector('.clear-cache-btn');
  if (!btn) return;
  btn.disabled = !!state.isClearingCache;
  btn.textContent = state.isClearingCache ? 'Clearing...' : 'Clear data';
}

function updateClearButton(block, state, skipInputSync = false) {
  const input = block.querySelector('#media-search-input');
  const clearBtn = block.querySelector('.clear-search-btn');
  if (!input || !clearBtn) return;

  const expectedDisplay = getDisplaySearchTerm(state);
  const hasActiveSearch = !!(expectedDisplay || (input.value && input.value.trim()));

  const inputHasFocus = document.activeElement === input;
  if (!skipInputSync && !inputHasFocus) {
    if (!state.selectedDocument && !state.selectedFolder) {
      if (!expectedDisplay && input.value.trim() !== '') {
        input.value = '';
      }
    } else if (input.value.trim() !== '' && input.value !== expectedDisplay) {
      input.value = expectedDisplay;
    }
  }

  clearBtn.hidden = !hasActiveSearch;
  clearBtn.setAttribute('aria-hidden', hasActiveSearch ? 'false' : 'true');
}

export default async function decorate(block) {
  block.classList.add('top-bar');

  const state = getAppState();
  block.innerHTML = createInitialMarkup(state);

  const input = block.querySelector('#media-search-input');
  const clearBtn = block.querySelector('.clear-search-btn');
  const dropdown = block.querySelector('.suggestions-dropdown');

  let debounceTimer;
  let suggestionsTimer;
  let suggestions = [];
  let activeIndex = -1;
  let programmaticInput = false;

  function clearSuggestions() {
    suggestions = [];
    activeIndex = -1;
    updateSuggestionsDropdown(block, suggestions, activeIndex);
    dropdown?.classList.add('hidden');
  }

  function selectSuggestion(suggestion) {
    const query = getSuggestionQuery(suggestion);
    if (query) {
      programmaticInput = true;
      input.value = query;
      applySearch(query);
    }
    clearSuggestions();
  }

  input?.addEventListener('input', () => {
    if (programmaticInput) {
      programmaticInput = false;
      return;
    }

    const query = input.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (suggestionsTimer) clearTimeout(suggestionsTimer);

    if (!query.trim()) {
      applySearch('');
    } else {
      debounceTimer = setTimeout(() => applySearch(query), 150);
    }

    if (!query?.trim()) {
      clearSuggestions();
    } else {
      const s = getAppState();
      const displayTerm = getDisplaySearchTerm(s);
      const isBackspacing = displayTerm
        && query.length < displayTerm.length
        && displayTerm.startsWith(query);
      if (!isBackspacing) {
        const fetchAndShow = () => {
          const currentState = getAppState();
          const data = currentState.rawMediaData || currentState.mediaData
            || currentState.progressiveMediaData || [];
          suggestions = getSearchSuggestions(
            data,
            query,
            createSearchSuggestion,
            currentState.folderPathsCache,
          );
          activeIndex = -1;
          updateSuggestionsDropdown(block, suggestions, activeIndex);
        };
        if (query === '/' || query.startsWith('/')) {
          fetchAndShow();
        } else {
          suggestionsTimer = setTimeout(fetchAndShow, 100);
        }
      } else {
        clearSuggestions();
      }
    }
    updateClearButton(block, getAppState(), true);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSuggestions();
      return;
    }

    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % suggestions.length;
        programmaticInput = true;
        input.value = getSuggestionQuery(suggestions[activeIndex]);
        updateSuggestionsDropdown(block, suggestions, activeIndex);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
        programmaticInput = true;
        input.value = getSuggestionQuery(suggestions[activeIndex]);
        updateSuggestionsDropdown(block, suggestions, activeIndex);
        return;
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      applySearch(input.value);
    }
  });

  dropdown?.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (item) {
      const index = parseInt(item.dataset.index, 10);
      if (!Number.isNaN(index) && suggestions[index]) {
        selectSuggestion(suggestions[index]);
      }
    }
  });

  document.addEventListener('click', (e) => {
    const wrapper = block.querySelector('.search-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      clearSuggestions();
    }
  });

  clearBtn?.addEventListener('click', () => {
    programmaticInput = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    if (suggestionsTimer) clearTimeout(suggestionsTimer);
    suggestionsTimer = null;
    input.value = '';
    updateAppState({ searchQuery: '', selectedDocument: null, selectedFolder: null });
    clearSuggestions();
    input.focus();
  });

  block.querySelector('.change-site-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('media-library:change-site'));
  });

  block.querySelector('.clear-cache-btn')?.addEventListener('click', async () => {
    const ctx = getMediaLibraryContext();
    const org = ctx.getOrg?.();
    const site = ctx.getSite?.();
    const path = ctx.getPath?.() ?? '';
    if (!org || !site) {
      showNotification('Error', 'Select an organization and site first', 'error');
      return;
    }
    updateAppState({ isClearingCache: true });
    try {
      await clearCache(org, site, path);
      updateAppState({
        rawMediaData: [],
        mediaData: [],
        usageIndex: new Map(),
        folderPathsCache: new Set(),
        processedData: initializeProcessedData(),
        indexProgress: { stage: 'complete', hasChanges: false, mediaReferences: 0 },
        validationError: null,
        isClearingCache: false,
      });
      showNotification('Data cleared', 'Reload the page to re-discover media');
    } catch (err) {
      showNotification('Error', err?.message || 'Failed to clear data', 'error');
      updateAppState({ isClearingCache: false });
    }
  });

  updateResultCount(block, state);
  updateClearCacheButton(block, state);
  updateClearButton(block, state);

  onStateChange((newState) => {
    updateResultCount(block, newState);
    updateClearButton(block, newState);
    updateClearCacheButton(block, newState);
  });
}
