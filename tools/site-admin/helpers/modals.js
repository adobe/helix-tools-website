import { createModal } from '../../../blocks/modal/modal.js';
import { createAdminFetch, ADMIN_PATHS } from '../../../utils/admin-fetch.js';
import { getConsoleLogger } from '../../../utils/tool-config.js';
import { AUTH_STATUS_MAP } from './constants.js';
import {
  icon, showToast, formatDate, isExpired,
} from './utils.js';

const adminFetch = createAdminFetch(getConsoleLogger());

/* eslint-disable no-alert, no-restricted-globals */

const refreshSites = (orgValue) => {
  window.dispatchEvent(new CustomEvent('sites-refresh', { detail: { orgValue } }));
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

const buildSiteConfig = (site, codeSrc, contentSrc) => {
  const codeURL = new URL(codeSrc);
  const [, owner, repo] = codeURL.pathname.split('/');
  const code = { owner, repo, source: { type: 'github', url: codeSrc } };
  const content = { source: { type: 'markup', url: contentSrc } };

  const contentURL = new URL(contentSrc);

  if (contentSrc.startsWith('https://drive.google.com/drive')) {
    content.source.type = 'google';
    content.source.id = contentURL.pathname.split('/').pop();
  }

  if (contentSrc.includes('sharepoint.com/')) {
    content.source.type = 'onedrive';
  }

  return { ...site, content, code };
};

export const saveSiteAndRefresh = async (
  orgValue,
  siteName,
  codeSrc,
  contentSrc,
  existingConfig,
  dialogCloseCallback,
) => {
  const siteConfig = buildSiteConfig(existingConfig, codeSrc, contentSrc);
  const resp = await adminFetch(ADMIN_PATHS.site, { org: orgValue, site: siteName }, {
    method: 'POST',
    body: JSON.stringify(siteConfig),
    headers: { 'content-type': 'application/json' },
  });
  await resp.text();
  const success = resp.ok;

  if (success && dialogCloseCallback) {
    dialogCloseCallback();
    refreshSites(orgValue);
  }
  return success;
};

export const deleteSiteAndRefresh = async (
  orgValue,
  siteName,
  dialogCloseCallback,
) => {
  const resp = await adminFetch(ADMIN_PATHS.site, { org: orgValue, site: siteName }, {
    method: 'DELETE',
  });
  await resp.text();
  const success = resp.ok;

  if (success && dialogCloseCallback) {
    dialogCloseCallback();
    refreshSites(orgValue);
  }
  return success;
};

export const getAuthStatusInfo = (scope) => AUTH_STATUS_MAP[scope] || {
  status: 'unknown', label: 'Unknown', description: '', color: 'gray',
};

export const openEditSourceModal = async (
  orgValue,
  siteName,
  codeUrl,
  contentUrl,
) => {
  const { dialog, container, showModal } = await setupModal('', `
    <div class="site-modal-header">
      <h2>Edit Source Config</h2>
      <p class="site-name">${siteName}</p>
          </div>
    <form class="edit-source-form">
      <div class="form-field">
        <label for="edit-code">GitHub Repository URL</label>
        <input type="url" id="edit-code" required value="${codeUrl}" placeholder="https://github.com/owner/repo" />
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

  container.querySelector('.edit-source-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = container.querySelector('.save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const newCodeUrl = container.querySelector('#edit-code').value.trim();
    const newContentUrl = container.querySelector('#edit-content').value.trim();

    const detailResp = await adminFetch(ADMIN_PATHS.site, { org: orgValue, site: siteName });
    const siteDetails = detailResp.ok ? await detailResp.json() : {};
    const closeDialog = () => dialog.close();
    const success = await saveSiteAndRefresh(
      orgValue,
      siteName,
      newCodeUrl,
      newContentUrl,
      siteDetails,
      closeDialog,
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

  const [secretsResp, accessResp] = await Promise.all([
    adminFetch(ADMIN_PATHS.secrets, { org: orgValue, site: siteName }),
    adminFetch(ADMIN_PATHS.site, { org: orgValue, site: siteName }),
  ]);

  let secrets;
  if (secretsResp.ok) secrets = Object.values(await secretsResp.json());
  else if (secretsResp.status === 404) secrets = [];
  else secrets = null;

  const access = accessResp.ok ? (await accessResp.json()).access || {} : {};

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

    if (scope !== 'none' && !tokenId && (!secrets || secrets.length === 0)) {
      const secretResp = await adminFetch(
        ADMIN_PATHS.secrets,
        { org: orgValue, site: siteName },
        { method: 'POST' },
      );
      const result = secretResp.ok ? await secretResp.json() : null;
      if (result) tokenId = result.id;
    }

    if (scope !== 'none') {
      const entry = {};
      if (patterns.length) entry.allow = patterns;
      if (tokenId) entry.secretId = [tokenId];
      newAccess[scope] = entry;
    }

    if (access.admin) newAccess.admin = access.admin;

    const siteParams = { org: orgValue, site: siteName };
    const currentResp = await adminFetch(ADMIN_PATHS.site, siteParams);
    const currentConfig = currentResp.ok ? await currentResp.json() : {};
    currentConfig.access = newAccess;
    const updateResp = await adminFetch(ADMIN_PATHS.site, siteParams, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(currentConfig),
    });
    const success = updateResp.ok;
    btn.disabled = false;
    btn.textContent = success ? 'Saved!' : 'Save';
    if (success) {
      setTimeout(() => {
        dialog.close();
        refreshSites(orgValue);
      }, 1000);
    }
  });

  showModal();
};

const openManageItemsModal = async (siteName, orgValue, config) => {
  const {
    title, itemName, itemNamePlural, iconName, fetchFn, createFn, deleteFn, showExpiration,
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

  container.querySelector('.create-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const result = await createFn(orgValue, siteName);
    if (result?.value) {
      container.querySelector('.item-value').value = result.value;
      container.querySelector('.new-item-result').classList.add('visible');
      btn.setAttribute('aria-hidden', 'true');
      loadItems();
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
    const resp = await adminFetch(ADMIN_PATHS.secrets, { org, site });
    if (resp.ok) return Object.values(await resp.json());
    if (resp.status === 404) return [];
    return null;
  },
  createFn: async (org, site) => {
    const resp = await adminFetch(ADMIN_PATHS.secrets, { org, site }, { method: 'POST' });
    return resp.ok ? resp.json() : null;
  },
  deleteFn: async (org, site, secretId) => {
    const resp = await adminFetch(
      ADMIN_PATHS.secret,
      { org, site, secretId: encodeURIComponent(secretId) },
      { method: 'DELETE' },
    );
    return resp.ok;
  },
  showExpiration: false,
});

export const openApiKeyModal = (siteName, orgValue) => openManageItemsModal(siteName, orgValue, {
  title: 'Manage API Keys',
  itemName: 'API Key',
  itemNamePlural: 'API Keys',
  iconName: 'key',
  fetchFn: async (org, site) => {
    const resp = await adminFetch(ADMIN_PATHS.apiKeys, { org, site });
    if (resp.ok) {
      const data = await resp.json();
      return Object.entries(data).map(([id, val]) => ({ id, ...val }));
    }
    if (resp.status === 404) return [];
    return null;
  },
  createFn: async (org, site) => {
    const resp = await adminFetch(ADMIN_PATHS.apiKeys, { org, site }, { method: 'POST' });
    return resp.ok ? resp.json() : null;
  },
  deleteFn: async (org, site, keyId) => {
    const resp = await adminFetch(
      ADMIN_PATHS.apiKey,
      { org, site, keyId: encodeURIComponent(keyId) },
      { method: 'DELETE' },
    );
    return resp.ok;
  },
  showExpiration: true,
});

export const openAddSiteModal = async (orgValue, defaultCode = '', defaultContent = '') => {
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
      <div class="form-field">
        <label for="new-site-code">GitHub Repository URL</label>
        <input type="url" id="new-site-code" required value="${defaultCode}"
               placeholder="https://github.com/owner/repo" />
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
  `);

  container.querySelector('.cancel-btn').addEventListener('click', () => dialog.close());

  container.querySelector('.add-site-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const siteName = container.querySelector('#new-site-name').value.trim();
    const codeUrl = container.querySelector('#new-site-code').value.trim();
    const contentUrl = container.querySelector('#new-site-content').value.trim();

    const createBtn = container.querySelector('.create-btn');
    createBtn.disabled = true;
    createBtn.innerHTML = 'Creating... <i class="symbol symbol-loading"></i>';

    const success = await saveSiteAndRefresh(
      orgValue,
      siteName,
      codeUrl,
      contentUrl,
      {},
      () => dialog.close(),
    );

    if (!success) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Site';
    }
  });

  showModal();
};
