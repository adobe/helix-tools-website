/**
 * Media Library Sidebar view - filters and export.
 */
import {
  getAppState,
  updateAppState,
  onStateChange,
  showNotification,
} from '../../core/state.js';
import { filterMedia } from '../../features/filters.js';
import { exportToCsv } from '../../core/export.js';
import { getMediaLibraryContext } from '../../core/context.js';

const FILTER_STRUCTURE = [
  { key: 'all', label: 'All Media' },
  { key: 'documents', label: 'PDFs' },
  { key: 'fragments', label: 'Fragments' },
  { key: 'images', label: 'Images' },
  { key: 'icons', label: 'SVGs' },
  { key: 'links', label: 'Links' },
  { key: 'videos', label: 'Videos' },
  { key: 'noReferences', label: 'No References' },
];

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

function render(block, state) {
  const filterListHtml = FILTER_STRUCTURE.map(
    (f) => `<li><button type="button" data-filter="${f.key}" class="${state.selectedFilterType === f.key ? 'active' : ''}">${f.label}</button></li>`,
  ).join('');

  const isCollapsed = state.sidebarCollapsed ?? true;
  const expandedPanel = state.sidebarExpandedPanel;
  const filtersActive = expandedPanel === 'filters';
  const dataActive = expandedPanel === 'data';
  block.innerHTML = `
    <aside class="media-sidebar ${isCollapsed ? 'collapsed' : 'expanded'} ${filtersActive ? 'panel-filters' : ''} ${dataActive ? 'panel-data' : ''}">
      <div class="sidebar-icons">
        <button type="button" class="icon-btn filters-toggle ${filtersActive ? 'active' : ''}" title="Filters" aria-label="Filters" aria-expanded="${filtersActive}">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 4h18v2.4c0 .5-.2 1-.6 1.4l-6.4 6.4c-.4.4-.6.9-.6 1.4v6.4l-4-2v-4.4c0-.5-.2-1-.6-1.4L2.6 7.8c-.4-.4-.6-.9-.6-1.4V4z"/>
          </svg>
          <span class="button-text">Filters</span>
        </button>
      </div>
      <div class="filter-panel">
        <div class="filter-section">
          <h3>Types</h3>
          <ul class="filter-list">${filterListHtml}</ul>
        </div>
      </div>
      <div class="sidebar-icons secondary">
        <button type="button" class="icon-btn data-toggle ${dataActive ? 'active' : ''}" title="Data" aria-label="Data" aria-expanded="${dataActive}">
          <svg class="icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M13,1.5V15h3V1.5a.5.5,0,0,0-.5-.5h-2A.5.5,0,0,0,13,1.5Z"/>
            <path d="M9,6.5V15h3V6.5a.5.5,0,0,0-.5-.5h-2A.5.5,0,0,0,9,6.5Z"/>
            <path d="M5,10.5V15H8V10.5a.5.5,0,0,0-.5-.5h-2A.5.5,0,0,0,5,10.5Z"/>
            <path d="M1,12.5V15H4V12.5a.5.5,0,0,0-.5-.5h-2A.5.5,0,0,0,1,12.5Z"/>
          </svg>
          <span class="button-text">Data</span>
        </button>
      </div>
      <div class="data-panel">
        <button type="button" class="export-btn" title="Export as CSV" ${!state.mediaData?.length ? 'disabled' : ''}>Export</button>
      </div>
    </aside>`;

  block.querySelector('.filters-toggle')?.addEventListener('click', () => {
    const s = getAppState();
    if (s.sidebarExpandedPanel === 'filters') {
      updateAppState({ sidebarCollapsed: true, sidebarExpandedPanel: null });
    } else {
      updateAppState({ sidebarCollapsed: false, sidebarExpandedPanel: 'filters' });
    }
  });
  block.querySelector('.data-toggle')?.addEventListener('click', () => {
    const s = getAppState();
    if (s.sidebarExpandedPanel === 'data') {
      updateAppState({ sidebarCollapsed: true, sidebarExpandedPanel: null });
    } else {
      updateAppState({ sidebarCollapsed: false, sidebarExpandedPanel: 'data' });
    }
  });

  block.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => updateAppState({ selectedFilterType: btn.dataset.filter }));
  });

  const ctx = getMediaLibraryContext();
  block.querySelector('.export-btn')?.addEventListener('click', () => {
    const filtered = getFilteredMedia(getAppState());
    const unreferenced = filtered.filter((item) => item.usageCount === 0);
    exportToCsv(unreferenced, { org: ctx.getOrg?.(), repo: ctx.getSite?.(), filterName: 'unreferenced' });
    showNotification('Export complete', `Exported ${unreferenced.length} unreferenced media items`);
  });
}

export default async function decorate(block) {
  block.classList.add('sidebar');
  render(block, getAppState());
  onStateChange(() => render(block, getAppState()));
}
