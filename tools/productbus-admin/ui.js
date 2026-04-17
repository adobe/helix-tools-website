/**
 * ProductBus Admin - Shared UI utilities
 * Separated to avoid circular imports between api.js and page modules
 */

/**
 * Return the `.productbus-admin` root so modals and toasts stay scoped to this
 * tool. Falls back to <body> for defensive safety during pre-mount init.
 */
function getRoot() {
  return document.querySelector('.productbus-admin') || document.body;
}

export function showToast(message, type = 'success') {
  const existing = document.querySelector('.productbus-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.classList.add('productbus-toast', type);
  toast.textContent = message;
  getRoot().appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function createModal(title, content, footer) {
  const dialog = document.createElement('dialog');
  dialog.className = 'productbus-modal';

  const titleEl = document.createElement('h2');
  titleEl.textContent = title;

  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        ${titleEl.outerHTML}
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-footer"></div>' : ''}
    </div>
  `;

  const modalBody = dialog.querySelector('.modal-body');
  if (typeof content === 'string') {
    modalBody.innerHTML = content;
  } else {
    modalBody.appendChild(content);
  }

  if (footer) {
    const modalFooter = dialog.querySelector('.modal-footer');
    if (typeof footer === 'string') {
      modalFooter.innerHTML = footer;
    } else {
      modalFooter.appendChild(footer);
    }
  }

  const closeModal = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.addEventListener('cancel', closeModal);
  dialog.querySelector('.modal-close').addEventListener('click', closeModal);
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right
        || e.clientY < rect.top || e.clientY > rect.bottom) {
      closeModal();
    }
  });

  getRoot().appendChild(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * Modal confirmation dialog. Returns a Promise that resolves to true when the
 * user confirms and false on cancel / backdrop-close / Escape.
 * Preferred over native `confirm()` so we remain compliant with Airbnb's
 * `no-alert` / `no-restricted-globals` rules and get styled dialogs on mobile.
 */
export function confirmModal(message, options = {}) {
  const {
    title = 'Confirm',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
  } = options;

  return new Promise((resolve) => {
    const content = document.createElement('p');
    content.className = 'confirm-message';
    content.textContent = message;

    const footer = document.createElement('div');
    footer.innerHTML = `
      <button type="button" class="button outline cancel-btn">${cancelLabel}</button>
      <button type="button" class="button ${destructive ? 'danger' : ''} confirm-btn">${confirmLabel}</button>
    `;

    const dialog = createModal(title, content, footer);

    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    dialog.querySelector('.cancel-btn').addEventListener('click', () => settle(false));
    dialog.querySelector('.confirm-btn').addEventListener('click', () => settle(true));
    dialog.addEventListener('cancel', () => settle(false));
    dialog.addEventListener('close', () => settle(false));
  });
}

/**
 * Read a single query param from window.location.search.
 */
export function getUrlParam(key) {
  return new URLSearchParams(window.location.search).get(key) || '';
}

/**
 * Set or remove a query param via replaceState so the URL reflects
 * current view state without pushing history entries.
 */
export function setUrlParam(key, value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState({}, '', url);
}

export function createFormField(name, label, type = 'text', options = {}) {
  const {
    required = false, placeholder = '', value = '', disabled = false, maxLength = '',
  } = options;

  const field = document.createElement('div');
  field.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.setAttribute('for', name);

  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.id = name;
  input.name = name;
  if (type !== 'textarea') input.type = type;
  if (required) input.required = true;
  if (placeholder) input.placeholder = placeholder;
  if (value) input.value = value;
  if (disabled) input.disabled = true;
  if (maxLength) input.maxLength = maxLength;

  field.appendChild(labelEl);
  field.appendChild(input);
  return field;
}
