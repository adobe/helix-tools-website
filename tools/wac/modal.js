import { escapeHtml } from './utils.js';

/**
 * Small local modal helper, matching the pattern established by
 * tools/user-admin/user-admin.js (a raw <dialog> appended to <body> and
 * shown imperatively) rather than the CMS-oriented blocks/modal/modal.js.
 */
export function createModal(titleText, { className = '' } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `wac-modal ${className}`.trim();
  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title"></h3>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div>
    </div>
  `;
  dialog.querySelector('.modal-title').textContent = titleText;

  const closeModal = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', closeModal);
  dialog.querySelector('.modal-close').addEventListener('click', closeModal);
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX > rect.right
      || clientY < rect.top || clientY > rect.bottom) {
      closeModal();
    }
  });

  document.body.appendChild(dialog);
  dialog.showModal();

  return {
    dialog,
    body: dialog.querySelector('.modal-body'),
    footer: dialog.querySelector('.modal-footer'),
    closeModal,
  };
}

export function showConfirmDialog(message, { confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const {
      dialog, body, footer, closeModal,
    } = createModal('Confirm', { className: 'confirm-dialog' });
    body.innerHTML = `<p>${escapeHtml(message)}</p>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button outline';
    cancelBtn.textContent = 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = danger ? 'button danger' : 'button';
    confirmBtn.textContent = confirmText;
    footer.append(cancelBtn, confirmBtn);
    const finish = (result) => { closeModal(); resolve(result); };
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
  });
}

/**
 * Prompt for a new folder name. Folders aren't real API entities — they're
 * just derived from container path prefixes — so this only validates the
 * name; nothing is persisted until a container is actually uploaded there.
 * @param {string} parentLabel - e.g. "/org/site/drafts" or "/org/site" for the root
 * @returns {Promise<string|null>} the entered name, or null if cancelled
 */
export function promptForFolderName(parentLabel) {
  return new Promise((resolve) => {
    const {
      dialog, body, footer, closeModal,
    } = createModal('New folder', { className: 'new-folder-modal' });
    body.innerHTML = `
      <form id="wac-folder-form">
        <div class="form-field">
          <label for="wac-folder-name">Folder name</label>
          <input
            id="wac-folder-name"
            required
            pattern="[A-Za-z0-9._\\-]+"
            placeholder="campaigns"
          />
          <p class="field-hint">Created inside <code>${escapeHtml(parentLabel)}</code></p>
        </div>
      </form>
    `;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button outline';
    cancelBtn.textContent = 'Cancel';
    const createBtn = document.createElement('button');
    createBtn.type = 'submit';
    createBtn.setAttribute('form', 'wac-folder-form');
    createBtn.className = 'button';
    createBtn.textContent = 'Create';
    footer.append(cancelBtn, createBtn);

    const form = body.querySelector('#wac-folder-form');
    const input = body.querySelector('#wac-folder-name');
    input.focus();
    const finish = (value) => { closeModal(); resolve(value); };
    cancelBtn.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', () => resolve(null), { once: true });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value.trim());
    });
  });
}

/**
 * Prompt for the WAC worker's shared secret for an org/site. Matches the
 * `promptFn` signature expected by session.js's ensureSecret()/connectSession().
 * @param {string} org
 * @param {string} site
 * @param {string} [errorMessage]
 * @returns {Promise<string|null>} the entered secret, or null if cancelled
 */
export function promptForSecret(org, site, errorMessage) {
  return new Promise((resolve) => {
    const {
      dialog, body, footer, closeModal,
    } = createModal('Shared secret required', { className: 'secret-modal' });
    body.innerHTML = `
      <p>Enter the shared secret for the WAC worker on <strong>${escapeHtml(org)}/${escapeHtml(site)}</strong>.</p>
      ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ''}
      <form id="wac-secret-form">
        <div class="form-field">
          <label for="wac-secret-input">Shared secret</label>
          <input id="wac-secret-input" type="password" autocomplete="current-password" required />
        </div>
      </form>
    `;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button outline';
    cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.setAttribute('form', 'wac-secret-form');
    saveBtn.className = 'button';
    saveBtn.textContent = 'Continue';
    footer.append(cancelBtn, saveBtn);

    const form = body.querySelector('#wac-secret-form');
    const input = body.querySelector('#wac-secret-input');
    input.focus();
    const finish = (value) => { closeModal(); resolve(value); };
    cancelBtn.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', () => resolve(null), { once: true });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value);
    });
  });
}
