import { createModal } from '../../../blocks/modal/modal.js';
import { AUTH_STATUS_MAP } from './constants.js';
import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest } from '../../../utils/admin-request.js';
import escapeHtml from '../../../utils/html.js';
import {
  icon, showToast, formatDate, isExpired, buildSiteConfig,
} from './utils.js';

/* eslint-disable no-alert, no-restricted-globals */

const refreshSites = (orgValue, action, siteName) => {
  window.dispatchEvent(new CustomEvent('sites-refresh', { detail: { orgValue, action, siteName } }));
};

const logResult = (logFn, result) => {
  if (logFn && result) {
    const { method, url } = result.request;
    logFn(result.status, [method, url, result.error]);
  }
};

const setupModal = async (className, headerHtml) => {
  const { block, showModal } = await createModal([]);
  const dialog = block.querySelector('dialog');
  const modalContent = dialog.querySelector('.modal-content');

  const container = document.createElement('div');
  container.className = `site-modal ${className}`;
  container.innerHTML = headerHtml;
  modalContent.appendChild(container);

  return { dialog, container, showModal };
};

export const saveSiteAndRefresh = async (
  orgValue,
  siteName,
  codeSrc,
  contentSrc,
  existingConfig,
  dialogCloseCallback,
  logFn = null,
  action = 'update',
  byogit = null,
) => {
  const siteConfig = buildSiteConfig(existingConfig, codeSrc, contentSrc, byogit);
  const saveResult = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).update(JSON.stringify(siteConfig)),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, saveResult);
  let success = saveResult?.ok ?? false;

  if (success && byogit) {
    const codeConfig = {
      source: {
        type: 'byogit',
        url: 'https://cm-repo.adobe.io/api',
        raw_url: 'https://cm-repo.adobe.io/api/raw',
        owner: byogit.owner,
        repo: byogit.repo,
        secretId: 'cm-byog',
      },
    };
    const codeResult = await executeAdminRequest(
      () => admin.config({ org: orgValue, site: siteName }).select('code.json').update(JSON.stringify(codeConfig)),
      { org: orgValue, site: siteName },
    );
    logResult(logFn, codeResult);
    success = codeResult?.ok ?? false;
  }

  if (success && dialogCloseCallback) {
    dialogCloseCallback();
    refreshSites(orgValue, action, siteName);
  }
  return success;
};

export const deleteSiteAndRefresh = async (
  orgValue,
  siteName,
  dialogCloseCallback,
  logFn = null,
) => {
  const result = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).remove(),
    { org: orgValue, site: siteName },
  );
  logResult(logFn, result);
  const success = result?.ok ?? false;

  if (success) {
    if (dialogCloseCallback) dialogCloseCallback();
    refreshSites(orgValue, 'delete', siteName);
  }
  return success;
};

export const getAuthStatusInfo = (scope) => AUTH_STATUS_MAP[scope] || {
  status: 'unknown', label: 'Unknown', description: '', color: 'gray',
};

export const openDeleteSiteModal = async (orgValue, siteName, card = null, logFn = null) => {
  const safeName = escapeHtml(siteName);
  const { dialog, container, showModal } = await setupModal('delete-modal', `
    <div class="site-modal-header">
      <h2>Delete Site</h2>
    </div>
    <form class="delete-site-form">
      <div class="form-field">
        <label for="delete-confirm-input">Type <code>${safeName}</code> to confirm</label>
        <input type="text" id="delete-confirm-input" autocomplete="off" autocapitalize="off"
               spellcheck="false" required />
        <p class="field-hint">This permanently removes the site config, secrets, API keys, and access
          settings. The content and code repository are not affected. This cannot be undone.</p>
      </div>
      <div class="form-actions">
        <button type="button" class="button outline cancel-btn">Cancel</button>
        <button type="submit" class="button danger delete-btn" disabled>Delete Site</button>
      </div>
    </form>
  `);

  const input = container.querySelector('#delete-confirm-input');
  const deleteBtn = container.querySelector('.delete-btn');
  const cancelBtn = container.querySelector('.cancel-btn');

  input.addEventListener('input', () => {
    deleteBtn.disabled = input.value !== siteName;
  });

  cancelBtn.addEventListener('click', () => dialog.close());

  container.querySelector('.delete-site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value !== siteName) return;
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    if (card) card.classList.add('deleting');

    const success = await deleteSiteAndRefresh(orgValue, siteName, () => dialog.close(), logFn);
    if (success) {
      showToast(`Site "${siteName}" deleted`, 'error');
    } else {
      if (card) card.classList.remove('deleting');
      deleteBtn.disabled = false;
      cancelBtn.disabled = false;
      deleteBtn.textContent = 'Delete Site';
      showToast('Failed to delete site', 'error');
    }
  });

  showModal();
  setTimeout(() => input.focus(), 50);
};

export const openEditSourceModal = async (
  orgValue,
  siteName,
  codeUrl,
  contentUrl,
  logFn = null,
  byogitDefaults = null,
) => {
  const isByogit = !!byogitDefaults;
  const byogitOwner = escapeHtml(byogitDefaults?.owner || '');
  const byogitRepo = escapeHtml(byogitDefaults?.repo || '');

  const { dialog, container, showModal } = await setupModal('', `
    <div class="site-modal-header">
      <h2>Edit Source Config</h2>
      <p class="site-name">${siteName}</p>
    </div>
    <form class="edit-source-form">
      <div class="form-field code-url-field"${isByogit ? ' aria-hidden="true"' : ''}>
        <label for="edit-code">Git Repository URL</label>
        <input type="url" id="edit-code" ${isByogit ? '' : 'required '}value="${codeUrl}" placeholder="https://github.com/owner/repo" />
      </div>
      <div class="form-field byogit-toggle">
        <label class="checkbox-label">
          <input type="checkbox" id="edit-byogit"${isByogit ? ' checked' : ''} />
          Bring Your Own Git
        </label>
        <p class="field-hint">Use an external repository via Cloud Manager.
          <a href="https://www.aem.live/developer/byo-git" target="_blank" rel="noopener noreferrer">Learn more</a></p>
      </div>
      <div class="byogit-fields"${isByogit ? '' : ' aria-hidden="true"'}>
        <div class="form-field">
          <label for="edit-byogit-owner">Owner</label>
          <input type="text" id="edit-byogit-owner" placeholder="program ID"
                 ${isByogit ? 'required ' : ''}value="${byogitOwner}" />
        </div>
        <div class="form-field">
          <label for="edit-byogit-repo">Repo</label>
          <input type="text" id="edit-byogit-repo" placeholder="repository-id"
                 ${isByogit ? 'required ' : ''}value="${byogitRepo}" />
        </div>
      </div>
      <div class="form-field">
        <label for="edit-content">Content Source URL</label>
        <input type="url" id="edit-content" required value="${contentUrl}" placeholder="DA, SharePoint or Google Drive URL" />
      </div>
      <div class="form-actions">
        <button type="button" class="button outline cancel-btn">Cancel</button>
        <button type="submit" class="button save-btn">Save Changes</button>
      </div>
    </form>
  `);

  container.querySelector('.cancel-btn').addEventListener('click', () => dialog.close());

  const byogitCheckbox = container.querySelector('#edit-byogit');
  const codeUrlField = container.querySelector('.code-url-field');
  const byogitFieldsEl = container.querySelector('.byogit-fields');
  const codeInput = container.querySelector('#edit-code');
  const byogitOwnerInput = container.querySelector('#edit-byogit-owner');
  const byogitRepoInput = container.querySelector('#edit-byogit-repo');

  byogitCheckbox.addEventListener('change', () => {
    const { checked } = byogitCheckbox;
    if (checked) {
      codeUrlField.setAttribute('aria-hidden', 'true');
      byogitFieldsEl.removeAttribute('aria-hidden');
      codeInput.removeAttribute('required');
      byogitOwnerInput.setAttribute('required', '');
      byogitRepoInput.setAttribute('required', '');
    } else {
      codeUrlField.removeAttribute('aria-hidden');
      byogitFieldsEl.setAttribute('aria-hidden', 'true');
      codeInput.setAttribute('required', '');
      byogitOwnerInput.removeAttribute('required');
      byogitRepoInput.removeAttribute('required');
    }
  });

  container.querySelector('.edit-source-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = container.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const newCodeUrl = codeInput.value.trim();
    const newContentUrl = container.querySelector('#edit-content').value.trim();

    let byogit = null;
    if (byogitCheckbox.checked) {
      byogit = {
        owner: byogitOwnerInput.value.trim(),
        repo: byogitRepoInput.value.trim(),
      };
    }

    const detailsResult = await executeAdminRequest(
      () => admin.config({ org: orgValue, site: siteName }).read(),
      { org: orgValue, site: siteName },
    );
    const siteDetails = (detailsResult?.ok ? await detailsResult.json() : null) || {};
    const closeDialog = () => dialog.close();
    const success = await saveSiteAndRefresh(
      orgValue,
      siteName,
      newCodeUrl,
      newContentUrl,
      siteDetails,
      closeDialog,
      logFn,
      'update',
      byogit,
    );

    if (!success) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });

  showModal();
};

export const openAuthModal = async (siteName, orgValue) => {
  const { dialog, container, showModal } = await setupModal('auth-modal', `
    <div class="site-modal-header">
      <h2>Authentication</h2>
      <p class="site-name">${siteName}</p>
    </div>
    <div class="auth-loading">Loading...</div>
    <div class="auth-content">
      <div class="auth-status-card"></div>
      <div class="auth-form"></div>
    </div>
  `);

  const accessResult = await executeAdminRequest(
    () => admin.config({ org: orgValue, site: siteName }).read(),
    { org: orgValue, site: siteName },
  );
  const access = accessResult?.ok ? ((await accessResult.json()).access || {}) : {};

  let currentScope = 'none';
  if (access.site) currentScope = 'site';
  else if (access.preview) currentScope = 'preview';
  else if (access.live) currentScope = 'live';

  const currentAccess = access.site || access.preview || access.live || {};
  const allowPatterns = currentAccess.allow || [];
  const statusInfo = getAuthStatusInfo(currentScope);

  const authStatusCard = container.querySelector('.auth-status-card');
  authStatusCard.innerHTML = `
    <div class="status-header">
      <span class="status-icon status-${statusInfo.color}">${icon('shield')}</span>
      <div class="status-info">
        <span class="status-label">${statusInfo.label}</span>
        <span class="status-desc">${statusInfo.description}</span>
      </div>
    </div>
    ${allowPatterns.length ? `
      <div class="status-details">
        <span class="detail-label">Allowed users:</span>
        <span class="detail-value">${allowPatterns.join(', ')}</span>
      </div>
    ` : ''}
  `;

  const authForm = container.querySelector('.auth-form');
  const isProtected = currentScope !== 'none';
  authForm.innerHTML = `
    <h4>Update Settings</h4>
    <div class="form-field">
      <label for="auth-scope">Protection Level</label>
      <select id="auth-scope">
        <option value="none" ${currentScope === 'none' ? 'selected' : ''}>Public (no auth)</option>
        <option value="site" ${currentScope === 'site' ? 'selected' : ''}>Protected (preview + live)</option>
        <option value="preview" ${currentScope === 'preview' ? 'selected' : ''}>Preview only</option>
        <option value="live" ${currentScope === 'live' ? 'selected' : ''}>Live only</option>
      </select>
    </div>
    <div class="form-field">
      <label for="auth-users">Allowed Users</label>
      <input type="text" id="auth-users" value="${allowPatterns.join(', ')}" placeholder="*@company.com, user@example.com" ${isProtected ? 'required' : ''} />
      <p class="field-hint">Comma-separated email patterns</p>
      <p class="field-error">Allowed users are required for protected sites</p>
    </div>
    <div class="form-actions">
      <button type="button" class="button outline cancel-btn">Cancel</button>
      <button type="button" class="button save-auth-btn">Save</button>
    </div>
  `;

  const authTokenResult = document.createElement('div');
  authTokenResult.className = 'auth-token-result';
  authTokenResult.setAttribute('aria-hidden', 'true');
  authTokenResult.innerHTML = `
    <h4>Site Token Created</h4>
    <p class="field-hint">Pass this token as an <code>Authorization</code> header from your CDN to access your protected site:<br/>
      <code>authorization: token &lt;value&gt;</code></p>
    <p class="field-hint"><a href="https://www.aem.live/docs/authentication-setup-site#make-your-cdn-pass-the-right-authorization-header" target="_blank" rel="noopener noreferrer">Learn more about CDN authorization setup</a></p>
    <div class="token-copy-row">
      <input type="password" class="auth-token-value" aria-label="Site Token" readonly />
      <button type="button" class="button outline copy-token-btn">${icon('copy')} Copy</button>
    </div>
    <p class="field-hint"><strong>Save this value!</strong> It will not be shown again.</p>
    <div class="form-actions">
      <button type="button" class="button close-auth-btn">Done</button>
    </div>
  `;
  container.querySelector('.auth-content').appendChild(authTokenResult);

  let siteUpdated = false;
  dialog.addEventListener('close', () => {
    if (siteUpdated) refreshSites(orgValue, 'update', siteName);
  });

  const tokenInput = authTokenResult.querySelector('.auth-token-value');

  authTokenResult.querySelector('.copy-token-btn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    try {
      await navigator.clipboard.writeText(tokenInput.value);
      button.innerHTML = `${icon('check')} Copied!`;
    } catch {
      showToast('Failed to copy token. Please copy it manually before closing this dialog.', 'error');
    }
  });

  authTokenResult.querySelector('.close-auth-btn').addEventListener('click', () => dialog.close());

  container.querySelector('.auth-loading').setAttribute('aria-hidden', 'true');
  container.querySelector('.auth-content').classList.add('visible');

  const scopeSelect = authForm.querySelector('#auth-scope');
  const usersInput = authForm.querySelector('#auth-users');
  const fieldError = authForm.querySelector('.field-error');

  const hideError = () => { fieldError.classList.remove('visible'); };
  const showError = () => { fieldError.classList.add('visible'); };

  scopeSelect.addEventListener('change', (e) => {
    hideError();
    if (e.target.value === 'none') {
      usersInput.value = '';
      usersInput.removeAttribute('required');
    } else {
      usersInput.setAttribute('required', '');
    }
  });

  usersInput.addEventListener('input', hideError);

  authForm.querySelector('.cancel-btn').addEventListener('click', () => dialog.close());

  authForm.querySelector('.save-auth-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    const scope = scopeSelect.value;
    const patterns = usersInput.value.split(',').map((p) => p.trim()).filter((p) => p);

    if (scope !== 'none' && patterns.length === 0) {
      usersInput.focus();
      showError();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    const newAccess = {};
    let tokenId = currentAccess.secretId?.[0] || '';
    let newTokenValue = null;

    if (scope !== 'none' && !tokenId) {
      const secretResp = await executeAdminRequest(
        () => admin.config({ org: orgValue, site: siteName }).select('secrets.json').update(null),
        { org: orgValue, site: siteName },
      );
      const newSecret = secretResp?.ok ? await secretResp.json() : null;
      if (newSecret) {
        tokenId = newSecret.id;
        newTokenValue = newSecret.value;
      }
    }

    if (scope !== 'none') {
      const entry = {};
      if (patterns.length) entry.allow = patterns;
      if (tokenId) entry.secretId = [tokenId];
      newAccess[scope] = entry;
    }

    if (access.admin) newAccess.admin = access.admin;

    const siteHandle = admin.config({ org: orgValue, site: siteName });
    const readResult = await executeAdminRequest(
      () => siteHandle.read(),
      { org: orgValue, site: siteName },
    );
    let success = false;
    if (readResult?.ok) {
      const siteConfig = await readResult.json();
      siteConfig.access = newAccess;
      const writeResult = await executeAdminRequest(
        () => siteHandle.update(JSON.stringify(siteConfig)),
        { org: orgValue, site: siteName },
      );
      success = writeResult?.ok ?? false;
    }
    btn.disabled = false;
    btn.textContent = success ? 'Saved!' : 'Save';
    if (success) {
      siteUpdated = true;
      if (newTokenValue) {
        tokenInput.value = newTokenValue;
        authStatusCard.setAttribute('aria-hidden', 'true');
        authForm.setAttribute('aria-hidden', 'true');
        authTokenResult.removeAttribute('aria-hidden');
      } else {
        setTimeout(() => dialog.close(), 1000);
      }
    }
  });

  showModal();
};

const openManageItemsModal = async (siteName, orgValue, config) => {
  const {
    title, itemName, itemNamePlural, iconName, fetchFn, createFn, deleteFn, showExpiration,
    formHtml, onFormInit, getCreateBody,
  } = config;

  const { dialog, container, showModal } = await setupModal('manage-modal', `
    <div class="site-modal-header">
      <h2>${title}</h2>
      <p class="site-name">${siteName}</p>
    </div>
    <div class="existing-items">
      <h4>Existing ${itemNamePlural}</h4>
      <div class="items-list loading">Loading...</div>
    </div>
    <div class="add-new-section">
      <h4>Add New ${itemName}</h4>
      ${formHtml ? `<div class="create-form">${formHtml}</div>` : ''}
      <div class="section-actions">
        <button type="button" class="button outline cancel-btn">Cancel</button>
        <button type="button" class="button create-btn">Create ${itemName}</button>
      </div>
      <div class="new-item-result">
        <label>${itemName} Created - Copy Now!</label>
        <div class="token-copy-row">
          <input type="password" class="item-value" readonly />
          <button type="button" class="button outline copy-btn">${icon('copy')} Copy</button>
        </div>
        <p class="field-hint"><strong>Save this value!</strong> It will not be shown again.</p>
      </div>
    </div>
  `);

  const itemsList = container.querySelector('.items-list');

  const renderItem = (item) => {
    const expired = showExpiration && isExpired(item.expiration);
    const dates = [];
    if (item.created) dates.push(`Created ${formatDate(item.created)}`);
    if (showExpiration && item.expiration) {
      dates.push(`${expired ? 'Expired' : 'Expires'} ${formatDate(item.expiration)}`);
    }
    return `
      <div class="item-row ${expired ? 'expired' : ''}" data-id="${item.id}">
        <div class="item-info">
          <span class="item-icon">${icon(iconName)}</span>
          <span class="item-id">${item.id}</span>
          ${dates.length ? `<span class="item-dates">${dates.join(' · ')}</span>` : ''}
        </div>
        <div class="item-actions">
          ${expired ? '<span class="expired-label">Expired</span>' : ''}
          <button type="button" class="icon-btn delete-btn" title="Delete">${icon('trash')}</button>
        </div>
      </div>
    `;
  };

  const loadItems = async () => {
    itemsList.classList.add('loading');
    itemsList.textContent = 'Loading...';
    const items = await fetchFn(orgValue, siteName) || [];
    itemsList.classList.remove('loading');

    if (items.length === 0) {
      itemsList.innerHTML = `<p class="empty-state">No ${itemNamePlural.toLowerCase()} configured</p>`;
      return;
    }

    itemsList.innerHTML = items.map(renderItem).join('');

    itemsList.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.item-row');
        const itemId = row.dataset.id;
        if (confirm(`Delete ${itemName.toLowerCase()} "${itemId}"?`)) {
          btn.disabled = true;
          const success = await deleteFn(orgValue, siteName, itemId);
          if (success) {
            await loadItems();
            showToast(`${itemName} deleted successfully`, 'success');
          } else {
            btn.disabled = false;
            showToast(`Failed to delete ${itemName.toLowerCase()}`, 'error');
          }
        }
      });
    });
  };

  loadItems();

  container.querySelector('.cancel-btn').addEventListener('click', () => dialog.close());

  if (onFormInit) onFormInit(container);

  const createForm = container.querySelector('.create-form');
  const resetCreateForm = () => {
    if (!createForm) return;
    createForm.querySelectorAll('input').forEach((input) => { input.value = ''; });
  };

  container.querySelector('.create-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const body = getCreateBody ? getCreateBody(container) : undefined;
    if (body === null) {
      btn.disabled = false;
      btn.textContent = `Create ${itemName}`;
      return;
    }
    const result = await createFn(orgValue, siteName, body);
    if (result?.value) {
      container.querySelector('.item-value').value = result.value;
      container.querySelector('.new-item-result').classList.add('visible');
      btn.setAttribute('aria-hidden', 'true');
      loadItems();
    } else if (result) {
      loadItems();
      resetCreateForm();
      btn.disabled = false;
      btn.textContent = `Create ${itemName}`;
      showToast(`${itemName} created successfully`, 'success');
    } else {
      btn.disabled = false;
      btn.textContent = 'Failed - Try Again';
    }
  });

  container.querySelector('.copy-btn').addEventListener('click', (e) => {
    navigator.clipboard.writeText(container.querySelector('.item-value').value);
    e.target.innerHTML = `${icon('check')} Copied!`;
  });

  showModal();
};

export const openSecretModal = (siteName, orgValue) => openManageItemsModal(siteName, orgValue, {
  title: 'Manage Secrets',
  itemName: 'Secret',
  itemNamePlural: 'Secrets',
  iconName: 'lock',
  fetchFn: async (org, site) => {
    const resp = await executeAdminRequest(
      () => admin.config({ org, site }).select('secrets.json').read(),
      { org, site },
    );
    if (resp?.ok) return Object.values(await resp.json());
    if (resp?.status === 404) return [];
    return null;
  },
  createFn: async (org, site, body) => {
    if (body?.name) {
      const handle = admin.config({ org, site })
        .select(`secrets/${encodeURIComponent(body.name)}.json`);
      const secretBody = body.value ? JSON.stringify({ value: body.value }) : null;
      const resp = await executeAdminRequest(() => handle.update(secretBody), { org, site });
      if (!resp?.ok) return null;
      let data;
      try { data = await resp.json(); } catch { data = { id: body.name }; }
      if (data && body.value) delete data.value;
      return data;
    }
    const resp = await executeAdminRequest(
      () => admin.config({ org, site }).select('secrets.json').update(null),
      { org, site },
    );
    return resp?.ok ? resp.json() : null;
  },
  deleteFn: async (org, site, secretId) => {
    const handle = admin.config({ org, site })
      .select(`secrets/${encodeURIComponent(secretId)}.json`);
    const resp = await executeAdminRequest(() => handle.remove(), { org, site });
    return resp?.ok ?? false;
  },
  showExpiration: false,
  formHtml: `
    <div class="form-field">
      <label for="secret-name">Name (optional)</label>
      <input type="text" id="secret-name" placeholder="e.g. my-secret-name" pattern="[a-z0-9_\\-]+" />
      <p class="field-hint">Lowercase letters, numbers, hyphens, and underscores only. Required when a value is provided.</p>
      <p class="field-error secret-name-error"></p>
    </div>
    <div class="form-field">
      <label for="secret-value">Secret Value (optional)</label>
      <input type="password" id="secret-value" placeholder="e.g. secret from external service" />
      <p class="field-hint">See <a href="https://www.aem.live/docs/admin.html#tag/siteConfig/operation/createSiteSecret">create site secret docs</a> for more details. Remember this value, it won't be shown again.</p>
    </div>
  `,
  onFormInit: (el) => {
    const nameInput = el.querySelector('#secret-name');
    const nameError = el.querySelector('.secret-name-error');
    nameInput.addEventListener('input', () => nameError.classList.remove('visible'));
  },
  getCreateBody: (el) => {
    const nameInput = el.querySelector('#secret-name');
    const valueInput = el.querySelector('#secret-value');
    const nameError = el.querySelector('.secret-name-error');
    const name = nameInput.value.trim();
    const value = valueInput.value.trim();
    const showNameError = (msg) => {
      nameError.textContent = msg;
      nameError.classList.add('visible');
      nameInput.focus();
    };
    if (value && !name) {
      showNameError('Name is required when a value is provided');
      return null;
    }
    if (name && !/^[a-z0-9_-]+$/.test(name)) {
      showNameError('Name must contain only lowercase letters, numbers, hyphens, and underscores');
      return null;
    }
    nameError.classList.remove('visible');
    const body = {};
    if (name) body.name = name;
    if (value) body.value = value;
    return Object.keys(body).length ? body : undefined;
  },
});

const API_KEY_ROLES = [
  { id: 'author', label: 'Author', description: 'Read/write content' },
  { id: 'publish', label: 'Publish', description: 'Preview, publish, and unpublish content' },
  { id: 'admin', label: 'Admin', description: 'Full access' },
];

export const openApiKeyModal = (siteName, orgValue) => openManageItemsModal(siteName, orgValue, {
  title: 'Manage API Keys',
  itemName: 'API Key',
  itemNamePlural: 'API Keys',
  iconName: 'key',
  fetchFn: async (org, site) => {
    const resp = await executeAdminRequest(
      () => admin.config({ org, site }).select('apiKeys.json').read(),
      { org, site },
    );
    if (resp?.ok) {
      const data = await resp.json();
      return Object.entries(data).map(([id, val]) => ({ id, ...val }));
    }
    if (resp?.status === 404) return [];
    return null;
  },
  createFn: async (org, site, body) => {
    const resp = await executeAdminRequest(
      () => admin.config({ org, site }).select('apiKeys.json').update(body ? JSON.stringify(body) : null),
      { org, site },
    );
    return resp?.ok ? resp.json() : null;
  },
  deleteFn: async (org, site, keyId) => {
    const handle = admin.config({ org, site })
      .select(`apiKeys/${encodeURIComponent(keyId)}.json`);
    const resp = await executeAdminRequest(() => handle.remove(), { org, site });
    return resp?.ok ?? false;
  },
  showExpiration: true,
  formHtml: `
    <div class="form-field">
      <label for="apikey-description">Description (optional)</label>
      <input type="text" id="apikey-description" placeholder="e.g. CI/CD pipeline key" />
    </div>
    <div class="form-field">
      <label for="apikey-role">Role</label>
      <select id="apikey-role">
        ${API_KEY_ROLES.map((r) => `<option value="${r.id}"${r.id === 'admin' ? ' selected' : ''}>${r.label}</option>`).join('')}
      </select>
      <p class="field-hint role-hint">${API_KEY_ROLES.find((r) => r.id === 'admin').description}</p>
    </div>
  `,
  onFormInit: (el) => {
    const roleSelect = el.querySelector('#apikey-role');
    const roleHint = el.querySelector('.role-hint');
    roleSelect.addEventListener('change', () => {
      const role = API_KEY_ROLES.find((r) => r.id === roleSelect.value);
      roleHint.textContent = role?.description ?? '';
    });
  },
  getCreateBody: (el) => {
    const body = { roles: [el.querySelector('#apikey-role').value] };
    const desc = el.querySelector('#apikey-description').value.trim();
    if (desc) body.description = desc;
    return body;
  },
});

export const openAddSiteModal = async (
  orgValue,
  defaultCode = '',
  defaultContent = '',
  logFn = null,
  byogitDefaults = null,
) => {
  const isByogit = !!byogitDefaults;
  const byogitOwner = escapeHtml(byogitDefaults?.owner || '');
  const byogitRepo = escapeHtml(byogitDefaults?.repo || '');

  const { dialog, container, showModal } = await setupModal('add-site-modal', `
    <div class="site-modal-header">
      <h2>Add New Site</h2>
    </div>
    <form class="add-site-form">
      <div class="form-field">
        <label for="new-site-name">Site Name</label>
        <input type="text" id="new-site-name" required placeholder="my-site" pattern="[a-z0-9-]+" />
        <p class="field-hint">Lowercase letters, numbers, and hyphens only</p>
      </div>
      <div class="form-field code-url-field"${isByogit ? ' aria-hidden="true"' : ''}>
        <label for="new-site-code">GitHub Repository URL</label>
        <input type="url" id="new-site-code" ${isByogit ? '' : 'required '}value="${defaultCode}"
               placeholder="https://github.com/owner/repo" />
      </div>
      <div class="form-field byogit-toggle">
        <label class="checkbox-label">
          <input type="checkbox" id="new-site-byogit"${isByogit ? ' checked' : ''} />
          Bring Your Own Git
        </label>
        <p class="field-hint">Use an external repository via Cloud Manager.
          <a href="https://www.aem.live/developer/byo-git" target="_blank" rel="noopener noreferrer">Learn more</a></p>
      </div>
      <div class="byogit-fields"${isByogit ? '' : ' aria-hidden="true"'}>
        <div class="form-field">
          <label for="new-site-byogit-owner">Owner</label>
          <input type="text" id="new-site-byogit-owner" placeholder="program ID"
                 ${isByogit ? 'required ' : ''}value="${byogitOwner}" />
        </div>
        <div class="form-field">
          <label for="new-site-byogit-repo">Repo</label>
          <input type="text" id="new-site-byogit-repo" placeholder="repository-id"
                 ${isByogit ? 'required ' : ''}value="${byogitRepo}" />
        </div>
      </div>
      <div class="form-field">
        <label for="new-site-content">Content Source URL</label>
        <input type="url" id="new-site-content" required value="${defaultContent}"
               placeholder="DA, SharePoint or Google Drive URL" />
      </div>
      <div class="form-actions">
        <button type="button" class="button outline cancel-btn">Cancel</button>
        <button type="submit" class="button create-btn">Create Site</button>
      </div>
    </form>
    <div class="byogit-secret-step" aria-hidden="true">
      <div class="site-modal-header">
        <h2>Complete BYO Git Setup</h2>
        <p class="site-name"></p>
      </div>
      <p class="field-hint byogit-secret-hint">Enter the secret provided by Cloud Manager to complete the setup.
        <a href="https://www.aem.live/developer/byo-git#configure-your-aem-site-to-use-cloud-manager" target="_blank" rel="noopener noreferrer">Learn more</a></p>
      <div class="form-field">
        <label for="byogit-secret-value">Cloud Manager Secret (cm-byog)</label>
        <input type="password" id="byogit-secret-value" placeholder="Secret from Cloud Manager" />
      </div>
      <div class="form-actions">
        <button type="button" class="button outline skip-secret-btn">Skip</button>
        <button type="button" class="button save-secret-btn">Save Secret</button>
      </div>
    </div>
  `);

  container.querySelector('.cancel-btn').addEventListener('click', () => dialog.close());

  const byogitCheckbox = container.querySelector('#new-site-byogit');
  const codeUrlField = container.querySelector('.code-url-field');
  const byogitFieldsEl = container.querySelector('.byogit-fields');
  const codeInput = container.querySelector('#new-site-code');
  const byogitOwnerInput = container.querySelector('#new-site-byogit-owner');
  const byogitRepoInput = container.querySelector('#new-site-byogit-repo');

  byogitCheckbox.addEventListener('change', () => {
    const { checked } = byogitCheckbox;
    if (checked) {
      codeUrlField.setAttribute('aria-hidden', 'true');
      byogitFieldsEl.removeAttribute('aria-hidden');
      codeInput.removeAttribute('required');
      byogitOwnerInput.setAttribute('required', '');
      byogitRepoInput.setAttribute('required', '');
    } else {
      codeUrlField.removeAttribute('aria-hidden');
      byogitFieldsEl.setAttribute('aria-hidden', 'true');
      codeInput.setAttribute('required', '');
      byogitOwnerInput.removeAttribute('required');
      byogitRepoInput.removeAttribute('required');
    }
  });

  const secretStep = container.querySelector('.byogit-secret-step');
  let createdSiteName = '';

  secretStep.querySelector('.skip-secret-btn').addEventListener('click', () => dialog.close());
  secretStep.querySelector('.save-secret-btn').addEventListener('click', async () => {
    const secretValue = secretStep.querySelector('#byogit-secret-value').value.trim();
    if (!secretValue) return;
    const btn = secretStep.querySelector('.save-secret-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    const secretHandle = admin.config({ org: orgValue, site: createdSiteName })
      .select('secrets/cm-byog.json');
    const secretResult = await executeAdminRequest(
      () => secretHandle.update(JSON.stringify({ value: secretValue })),
      { org: orgValue, site: createdSiteName },
    );
    logResult(logFn, secretResult);
    let saved = null;
    if (secretResult?.ok) {
      try { saved = await secretResult.json(); } catch { saved = { id: 'cm-byog' }; }
    }
    if (saved) {
      btn.textContent = 'Saved!';
      showToast('Cloud Manager secret saved', 'success');
      setTimeout(() => dialog.close(), 1000);
    } else {
      btn.disabled = false;
      btn.textContent = 'Failed - Try Again';
    }
  });

  container.querySelector('.add-site-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const siteName = container.querySelector('#new-site-name').value.trim();
    const codeUrl = codeInput.value.trim();
    const contentUrl = container.querySelector('#new-site-content').value.trim();

    let byogit = null;
    if (byogitCheckbox.checked) {
      byogit = {
        owner: byogitOwnerInput.value.trim(),
        repo: byogitRepoInput.value.trim(),
      };
    }

    const createBtn = container.querySelector('.create-btn');
    createBtn.disabled = true;
    createBtn.innerHTML = 'Creating... <i class="symbol symbol-loading"></i>';

    const onCreated = byogit ? () => {} : () => dialog.close();
    const success = await saveSiteAndRefresh(
      orgValue,
      siteName,
      codeUrl,
      contentUrl,
      {},
      onCreated,
      logFn,
      'add',
      byogit,
    );

    if (success && byogit) {
      createdSiteName = siteName;
      container.querySelector(':scope > .site-modal-header').setAttribute('aria-hidden', 'true');
      container.querySelector('.add-site-form').setAttribute('aria-hidden', 'true');
      secretStep.querySelector('.site-name').textContent = siteName;
      secretStep.removeAttribute('aria-hidden');
    } else if (!success) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Site';
    }
  });

  showModal();
};
