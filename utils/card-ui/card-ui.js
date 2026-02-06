/**
 * Shared Card UI utilities for admin tools
 */

const ICONS = {};

/**
 * Load an icon SVG by name
 * @param {string} name - Icon name
 * @returns {Promise<string>} SVG content
 */
export const loadIcon = async (name) => {
  if (ICONS[name]) return ICONS[name];
  try {
    const resp = await fetch(`${window.hlx.codeBasePath}/icons/${name}.svg`);
    if (resp.ok) {
      ICONS[name] = await resp.text();
      return ICONS[name];
    }
  } catch (e) {
    // nada
  }
  return '';
};

/**
 * Get icon SVG content
 * @param {string} name - Icon name
 * @returns {string} SVG content or empty string
 */
export const icon = (name) => ICONS[name] || '';

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success' or 'error'
 */
export const showToast = (message, type = 'success') => {
  const existingToast = document.querySelector('.card-ui-toast.toast-notification');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.classList.add('card-ui-toast', 'toast-notification', type);
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

/**
 * Create a card grid container with header (search, view toggle, count)
 * @param {Object} options - Configuration options
 * @param {number} options.count - Number of items
 * @param {string} options.itemLabel - Label for items (singular)
 * @param {string} options.storageKey - localStorage key for view preference
 * @param {Function} options.onSearch - Search callback (query) => void
 * @param {Function} options.onAddClick - Add button callback
 * @param {string} options.addButtonLabel - Label for add button
 * @returns {Object} { container, grid, updateCount }
 */
export function createCardContainer(options) {
  const {
    count = 0,
    itemLabel = 'item',
    storageKey = 'card-view',
    onSearch,
    onAddClick,
    addButtonLabel = '+ Add',
  } = options;

  const savedView = localStorage.getItem(storageKey) || 'grid';

  const container = document.createElement('div');
  container.className = 'card-container';

  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `
    <span class="card-count">${count} ${itemLabel}${count !== 1 ? 's' : ''}</span>
    <div class="card-actions">
      <div class="card-search">
        <input type="text" placeholder="Search..." class="search-input" />
      </div>
      <div class="view-toggle">
        <button type="button" class="view-btn ${savedView === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
          ${icon('grid')}
        </button>
        <button type="button" class="view-btn ${savedView === 'list' ? 'active' : ''}" data-view="list" title="List view">
          ${icon('list')}
        </button>
      </div>
      <button class="button add-btn">${addButtonLabel}</button>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = `card-grid ${savedView === 'list' ? 'list-view' : ''}`;

  // Search functionality
  const searchInput = header.querySelector('.search-input');
  if (onSearch) {
    searchInput.addEventListener('input', (e) => {
      onSearch(e.target.value.toLowerCase().trim());
    });
  }

  // View toggle
  header.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { view } = btn.dataset;
      header.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      grid.classList.toggle('list-view', view === 'list');
      localStorage.setItem(storageKey, view);
    });
  });

  // Add button
  const addBtn = header.querySelector('.add-btn');
  if (onAddClick) {
    addBtn.addEventListener('click', onAddClick);
  } else {
    addBtn.style.display = 'none';
  }

  container.appendChild(header);
  container.appendChild(grid);

  // Helper to update count
  const updateCount = (newCount) => {
    const countEl = header.querySelector('.card-count');
    countEl.textContent = `${newCount} ${itemLabel}${newCount !== 1 ? 's' : ''}`;
  };

  return {
    container, grid, header, updateCount,
  };
}

/**
 * Create a modal dialog
 * @param {Object} options - Configuration options
 * @param {string} options.title - Modal title
 * @param {string} options.className - Additional class name
 * @param {string} options.content - HTML content
 * @returns {HTMLDialogElement} The dialog element
 */
export function createModal(options) {
  const { title = '', className = '', content = '' } = options;

  const dialog = document.createElement('dialog');
  dialog.className = `card-modal ${className}`;
  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${title}</h3>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        ${content}
      </div>
    </div>
  `;

  const closeModal = () => {
    dialog.close();
    dialog.remove();
  };

  // Clean up dialog when closed via Escape key (cancel event fires before close)
  dialog.addEventListener('cancel', closeModal);

  // Close button handler
  dialog.querySelector('.modal-close').addEventListener('click', closeModal);

  // Close on click outside
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX > rect.right
        || clientY < rect.top || clientY > rect.bottom) {
      closeModal();
    }
  });

  return dialog;
}

export default {
  loadIcon,
  icon,
  showToast,
  createCardContainer,
  createModal,
};
