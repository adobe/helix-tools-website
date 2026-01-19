import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { createModal } from '../../blocks/modal/modal.js';

/* eslint-disable no-alert, no-restricted-globals */

const ICONS = {};

const loadIcon = async (name) => {
  if (ICONS[name]) return ICONS[name];
  try {
    const resp = await fetch(`${window.hlx.codeBasePath}/icons/${name}.svg`);
    if (resp.ok) {
      ICONS[name] = await resp.text();
      return ICONS[name];
    }
  } catch (e) {
    // nada.
  }
  return '';
};

const icon = (name) => ICONS[name] || '';

const ADMIN_API_BASE = 'https://admin.hlx.page';
const PSI_API_KEY = 'AIzaSyCobti5NiDCDIPwN0w1Qb2hu7ScERi8VPc';
const PSI_STORAGE_KEY = 'site-admin-psi-scores';
const FAVORITES_STORAGE_KEY = 'site-admin-favorites';

const getFavorites = (orgValue) => {
  const stored = localStorage.getItem(`${FAVORITES_STORAGE_KEY}-${orgValue}`);
  return stored ? JSON.parse(stored) : [];
};

const setFavorites = (orgValue, favorites) => {
  localStorage.setItem(`${FAVORITES_STORAGE_KEY}-${orgValue}`, JSON.stringify(favorites));
};

const isFavorite = (orgValue, siteName) => getFavorites(orgValue).includes(siteName);

const toggleFavorite = (orgValue, siteName) => {
  const favorites = getFavorites(orgValue);
  const index = favorites.indexOf(siteName);

  if (index === -1) {
    favorites.push(siteName);
  } else {
    favorites.splice(index, 1);
  }

  setFavorites(orgValue, favorites);
  return index === -1;
};

const AUTH_STATUS_MAP = {
  none: {
    status: 'public', label: 'Public', description: 'Anyone can access this site', color: 'green',
  },
  site: {
    status: 'protected', label: 'Authenticated', description: 'Preview and Live require authentication', color: 'blue',
  },
  preview: {
    status: 'preview-only', label: 'Preview Authenticated', description: 'Only Preview requires authentication', color: 'orange',
  },
  live: {
    status: 'live-only', label: 'Live Authenticated', description: 'Only Live requires authentication', color: 'orange',
  },
};

const showToast = (message, type = 'success') => {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.classList.add('toast-notification', type);
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

const getContentSourceType = (contentUrl, isLoading = false) => {
  if (isLoading) return { type: 'loading', label: '...' };
  if (!contentUrl) return { type: 'unknown', label: '?' };

  const isDA = contentUrl.startsWith('https://content.da.live') || contentUrl.startsWith('https://stage-content.da.live');
  const isGoogle = contentUrl.includes('drive.google.com') || contentUrl.includes('docs.google.com');
  const isSharepoint = contentUrl.includes('.sharepoint.com') || contentUrl.includes('onedrive');
  const isAEM = contentUrl.includes('adobeaemcloud');
  const isBYOM = !isDA && !isGoogle && !isSharepoint && !isAEM;

  const lookupTable = [
    { url: isDA, type: 'da', label: 'DA' },
    { url: isGoogle, type: 'google', label: 'Google Drive' },
    { url: isSharepoint, type: 'sharepoint', label: 'Sharepoint' },
    { url: isAEM, type: 'aem', label: 'AEM' },
    { url: isBYOM, type: 'byom', label: 'BYOM' },
  ];

  const type = lookupTable.find((t) => t.url);

  if (type) {
    return { type: type.type, label: type.label };
  }

  return { type: 'unknown', label: '?' };
};

const getPsiScores = () => {
  try {
    return JSON.parse(localStorage.getItem(PSI_STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
};

const savePsiScores = (scores) => {
  localStorage.setItem(PSI_STORAGE_KEY, JSON.stringify(scores));
};

const fetchPsiScores = async (url) => {
  const lhsCategories = 'category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES';
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${PSI_API_KEY}&${lhsCategories}`;
  const resp = await fetch(apiUrl);
  if (!resp.ok) return null;
  const data = await resp.json();
  const categories = data.lighthouseResult?.categories || {};
  return {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    timestamp: Date.now(),
  };
};

const formatTimestamp = (ts) => {
  const date = new Date(ts);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getScoreClass = (score) => {
  if (score >= 90) return 'good';
  if (score >= 50) return 'average';
  return 'poor';
};

const isExpired = (expirationDate) => {
  if (!expirationDate) return false;
  return new Date(expirationDate) < new Date();
};

const getDAEditorURL = (contentUrl) => {
  if (!contentUrl) return null;

  if (contentUrl.startsWith('https://content.da.live/') || contentUrl.startsWith('https://stage-content.da.live/')) {
    const path = contentUrl.replace('https://content.da.live/', '');
    return `https://da.live/#/${path}`;
  }

  return contentUrl;
};

const org = document.getElementById('org');
const consoleBlock = document.querySelector('.console');
const sitesElem = document.querySelector('div#sites');

const adminFetch = async (path, options = {}) => {
  const url = `${ADMIN_API_BASE}${path}`;
  const method = options.method || 'GET';
  const resp = await fetch(url, options);
  logResponse(consoleBlock, resp.status, [method, url, resp.headers.get('x-error') || '']);
  return resp;
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

const fetchSecrets = async (orgValue, siteName) => {
  const resp = await adminFetch(`/config/${orgValue}/sites/${siteName}/secrets.json`);
  if (resp.ok) return Object.values(await resp.json());
  if (resp.status === 404) return [];
  return null;
};

const createSecret = async (orgValue, siteName) => {
  const resp = await adminFetch(`/config/${orgValue}/sites/${siteName}/secrets.json`, { method: 'POST' });
  return resp.ok ? resp.json() : null;
};

const deleteSecret = async (orgValue, siteName, secretId) => {
  const resp = await adminFetch(
    `/config/${orgValue}/sites/${siteName}/secrets/${encodeURIComponent(secretId)}.json`,
    { method: 'DELETE' },
  );
  return resp.ok;
};

const fetchApiKeys = async (orgValue, siteName) => {
  const resp = await adminFetch(`/config/${orgValue}/sites/${siteName}/apiKeys.json`);
  if (resp.ok) {
    const data = await resp.json();
    return Object.entries(data).map(([id, val]) => ({ id, ...val }));
  }
  if (resp.status === 404) return [];
  return null;
};

const createApiKey = async (orgValue, siteName) => {
  const resp = await adminFetch(`/config/${orgValue}/sites/${siteName}/apiKeys.json`, { method: 'POST' });
  return resp.ok ? resp.json() : null;
};

const deleteApiKey = async (orgValue, siteName, keyId) => {
  const resp = await adminFetch(
    `/config/${orgValue}/sites/${siteName}/apiKeys/${encodeURIComponent(keyId)}.json`,
    { method: 'DELETE' },
  );
  return resp.ok;
};

const formatDate = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const checkSiteHealth = async (orgValue, siteName) => {
  const liveUrl = `https://main--${siteName}--${orgValue}.aem.live/`;
  try {
    const resp = await fetch(liveUrl, { method: 'HEAD', mode: 'no-cors' });
    return resp.type === 'opaque' || resp.ok;
  } catch {
    return false;
  }
};

const fetchSiteAccess = async (orgValue, siteName) => {
  const resp = await adminFetch(`/config/${orgValue}/sites/${siteName}.json`);
  if (resp.ok) {
    const config = await resp.json();
    return config.access || {};
  }
  return {};
};

const updateSiteAccess = async (orgValue, siteName, accessConfig) => {
  const path = `/config/${orgValue}/sites/${siteName}.json`;
  const currentResp = await adminFetch(path);
  const currentConfig = currentResp.ok ? await currentResp.json() : {};
  currentConfig.access = accessConfig;

  const resp = await adminFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(currentConfig),
  });
  return resp.ok;
};

const saveSiteConfig = async (path, site, codeSrc, contentSrc, dialogCloseCallback) => {
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

  site.content = content;
  site.code = code;
  const resp = await adminFetch(path, {
    method: 'POST',
    body: JSON.stringify(site),
    headers: { 'content-type': 'application/json' },
  });
  await resp.text();

  if (resp.ok && dialogCloseCallback) {
    dialogCloseCallback();
    // eslint-disable-next-line no-use-before-define
    displaySitesForOrg(org.value);
  }
  return resp.ok;
};

const deleteSiteConfig = async (path, dialogCloseCallback) => {
  const resp = await adminFetch(path, { method: 'DELETE' });
  await resp.text();

  if (resp.ok && dialogCloseCallback) {
    dialogCloseCallback();
    // eslint-disable-next-line no-use-before-define
    displaySitesForOrg(org.value);
  }
};

const openEditSourceModal = async (siteName, codeUrl, contentUrl, path) => {
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

    const resp = await fetch(`${ADMIN_API_BASE}${path}`);
    const siteDetails = resp.ok ? await resp.json() : {};

    const closeDialog = () => dialog.close();
    const success = await saveSiteConfig(path, siteDetails, newCodeUrl, newContentUrl, closeDialog);

    if (!success) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });

  showModal();
};

const getAuthStatusInfo = (scope) => AUTH_STATUS_MAP[scope] || {
  status: 'unknown', label: 'Unknown', description: '', color: 'gray',
};

const openAuthModal = async (siteName, orgValue) => {
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

  const [secrets, access] = await Promise.all([
    fetchSecrets(orgValue, siteName),
    fetchSiteAccess(orgValue, siteName),
  ]);

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
      const result = await createSecret(orgValue, siteName);
      if (result) tokenId = result.id;
    }

    if (scope !== 'none') {
      const entry = {};
      if (patterns.length) entry.allow = patterns;
      if (tokenId) entry.secretId = [tokenId];
      newAccess[scope] = entry;
    }

    if (access.admin) newAccess.admin = access.admin;

    const success = await updateSiteAccess(orgValue, siteName, newAccess);
    btn.disabled = false;
    btn.textContent = success ? 'Saved!' : 'Save';
    if (success) {
      setTimeout(() => {
        dialog.close();
        // eslint-disable-next-line no-use-before-define
        displaySitesForOrg(orgValue);
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
          <input type="text" class="item-value" readonly />
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

const openSecretModal = (siteName, orgValue) => openManageItemsModal(siteName, orgValue, {
  title: 'Manage Secrets',
  itemName: 'Secret',
  itemNamePlural: 'Secrets',
  iconName: 'lock',
  fetchFn: fetchSecrets,
  createFn: createSecret,
  deleteFn: deleteSecret,
  showExpiration: false,
});

const openApiKeyModal = (siteName, orgValue) => openManageItemsModal(siteName, orgValue, {
  title: 'Manage API Keys',
  itemName: 'API Key',
  itemNamePlural: 'API Keys',
  iconName: 'key',
  fetchFn: fetchApiKeys,
  createFn: createApiKey,
  deleteFn: deleteApiKey,
  showExpiration: true,
});

const openAddSiteModal = async (defaultCode = '', defaultContent = '') => {
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

    const path = `/config/${org.value}/sites/${siteName}.json`;
    const success = await saveSiteConfig(path, {}, codeUrl, contentUrl, () => dialog.close());

    if (!success) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Site';
    }
  });

  showModal();
};

const renderPsiScores = (card, siteName, orgValue) => {
  const scores = getPsiScores();
  const siteKey = `${orgValue}/${siteName}`;
  const siteScores = scores[siteKey];
  const psiContainer = card.querySelector('.psi-scores');
  if (!psiContainer) return;

  if (siteScores) {
    const bp = siteScores.bestPractices ?? '--';
    psiContainer.innerHTML = `
      <div class="psi-scores-row">
        <div class="psi-score">
          <div class="psi-score-circle ${getScoreClass(siteScores.performance)}">${siteScores.performance}</div>
          <span class="psi-score-label">Perf</span>
        </div>
        <div class="psi-score">
          <div class="psi-score-circle ${getScoreClass(siteScores.accessibility)}">${siteScores.accessibility}</div>
          <span class="psi-score-label">A11y</span>
        </div>
        <div class="psi-score">
          <div class="psi-score-circle ${getScoreClass(bp)}">${bp}</div>
          <span class="psi-score-label">BP</span>
        </div>
      </div>
      <span class="psi-timestamp">As of ${formatTimestamp(siteScores.timestamp)}</span>
    `;
  } else {
    psiContainer.innerHTML = '';
  }
};

const runPsiForCard = async (card, siteName, orgValue) => {
  const liveUrl = `https://main--${siteName}--${orgValue}.aem.live/`;
  const psiContainer = card.querySelector('.psi-scores');
  if (!psiContainer) return;

  psiContainer.innerHTML = `
    <div class="psi-loading">
      <div class="psi-spinner"></div>
      <span>Running</span>
    </div>
  `;

  const result = await fetchPsiScores(liveUrl);
  if (result) {
    const scores = getPsiScores();
    scores[`${orgValue}/${siteName}`] = result;
    savePsiScores(scores);
    renderPsiScores(card, siteName, orgValue);
    showToast('PSI scores updated', 'success');
  } else {
    psiContainer.innerHTML = '<span class="psi-error">PSI failed</span>';
    showToast('Failed to fetch PSI scores', 'error');
  }
};

const createSiteCard = (site) => {
  const card = document.createElement('div');
  card.className = 'site-card';
  card.dataset.site = site.name;

  const previewUrl = `https://main--${site.name}--${org.value}.aem.page/`;
  const liveUrl = `https://main--${site.name}--${org.value}.aem.live/`;
  const sourceType = getContentSourceType(null, true);
  const favorited = isFavorite(org.value, site.name);
  if (favorited) card.classList.add('favorited');

  card.innerHTML = `
    <div class="site-card-top">
      <div class="site-card-badges">
        <span class="source-badge source-${sourceType.type}" title="Loading...">${sourceType.label}</span>
        <span class="health-badge loading" title="Checking...">●</span>
      </div>
      <div class="card-actions">
        <button type="button" class="favorite-btn ${favorited ? 'active' : ''}" aria-label="Favorite" title="${favorited ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
        <button type="button" class="menu-trigger" aria-label="Site actions">${icon('more-vertical')}</button>
        <div class="menu-dropdown">
          <button type="button" class="menu-item" data-action="clone">${icon('copy')}<span>Clone Site Config</span></button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item" data-action="lighthouse">${icon('activity')}<span>Run Lighthouse</span></button>
          <button type="button" class="menu-item" data-action="sitemap">${icon('document')}<span>Manage Sitemaps</span></button>
          <button type="button" class="menu-item" data-action="index">${icon('search')}<span>Manage Indexes</span></button>
          <button type="button" class="menu-item" data-action="robots">${icon('document')}<span>Manage robots.txt</span></button>
          <button type="button" class="menu-item" data-action="headers">${icon('code')}<span>HTTP Headers</span></button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item" data-action="users">${icon('user')}<span>Manage Users</span></button>
          <button type="button" class="menu-item" data-action="auth">${icon('shield')}<span>Authentication</span></button>
          <button type="button" class="menu-item" data-action="secret">${icon('lock')}<span>Manage Secrets</span></button>
          <button type="button" class="menu-item" data-action="apikey">${icon('key')}<span>Manage API Keys</span></button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item danger" data-action="delete">${icon('trash')}<span>Delete Site</span></button>
        </div>
      </div>
    </div>
    <div class="site-card-body">
      <div class="site-card-info">
        <h3 class="site-card-name">${site.name}</h3>
        <div class="site-card-sources">
          <a href="#" class="site-card-source" data-type="code" title="Loading..." target="_blank">
            ${icon('code')}
          </a>
          <a href="#" class="site-card-source" data-type="content" title="Loading..." target="_blank">
            ${icon('document')}
          </a>
        </div>
        <div class="site-card-links">
          <a href="${previewUrl}" target="_blank" class="site-card-link">Preview ${icon('external')}</a>
          <a href="${liveUrl}" target="_blank" class="site-card-link">Live ${icon('external')}</a>
        </div>
        <a href="#" class="site-card-cdn" target="_blank"><span></span>${icon('external')}</a>
        <div class="site-card-quick-actions">
          <button type="button" class="quick-action-btn" data-action="edit">${icon('edit')} Edit Config</button>
          <button type="button" class="quick-action-btn" data-action="logs">${icon('search')} View Logs</button>
        </div>
      </div>
      <div class="site-card-right">
        <div class="psi-scores"></div>
      </div>
    </div>
    <span class="auth-status" aria-hidden="true"></span>
  `;

  const menuTrigger = card.querySelector('.menu-trigger');
  const menuDropdown = card.querySelector('.menu-dropdown');
  const favoriteBtn = card.querySelector('.favorite-btn');

  favoriteBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const isNowFavorite = toggleFavorite(org.value, site.name);
    favoriteBtn.classList.toggle('active', isNowFavorite);
    favoriteBtn.title = isNowFavorite ? 'Remove from favorites' : 'Add to favorites';
    card.classList.toggle('favorited', isNowFavorite);

    const grid = card.closest('.sites-grid');
    if (grid) {
      const cards = [...grid.querySelectorAll('.site-card')];
      const favorites = getFavorites(org.value);

      cards.sort((a, b) => {
        const aFav = favorites.includes(a.dataset.site);
        const bFav = favorites.includes(b.dataset.site);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return a.dataset.site.localeCompare(b.dataset.site);
      });

      cards.forEach((c) => grid.appendChild(c));
    }
  });

  menuTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menuDropdown.classList.contains('open');
    document.querySelectorAll('.menu-dropdown.open').forEach((m) => m.classList.remove('open'));
    if (!wasOpen) menuDropdown.classList.add('open');
  });

  document.addEventListener('click', () => menuDropdown.classList.remove('open'));

  const cardActions = card.querySelector('.card-actions');

  cardActions.addEventListener('focusout', (e) => {
    if (!cardActions.contains(e.relatedTarget)) {
      menuDropdown.classList.remove('open');
    }
  });

  const openEditConfig = () => openEditSourceModal(site.name, card.dataset.codeUrl || '', card.dataset.contentUrl || '', `/config/${org.value}/sites/${site.name}.json`);
  const openLogs = () => {
    const url = `/tools/log-viewer/index.html?org=${encodeURIComponent(org.value)}&site=${encodeURIComponent(site.name)}`;
    window.open(url, '_blank');
  };

  const menuActions = {
    clone: () => openAddSiteModal(card.dataset.codeUrl || '', card.dataset.contentUrl || ''),
    sitemap: () => {
      const url = `/tools/sitemap-admin/index.html?org=${encodeURIComponent(org.value)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    index: () => {
      const url = `/tools/index-admin/index.html?org=${encodeURIComponent(org.value)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    robots: () => {
      const url = `/tools/robots-edit/index.html?org=${encodeURIComponent(org.value)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    headers: () => {
      const url = `/tools/headers-edit/index.html?org=${encodeURIComponent(org.value)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    lighthouse: () => {
      if (!card.dataset.hasAuth) {
        runPsiForCard(card, site.name, org.value);
      }
    },
    users: () => {
      const url = `/tools/user-admin/index.html?org=${encodeURIComponent(org.value)}&site=${encodeURIComponent(site.name)}`;
      window.open(url, '_blank');
    },
    auth: () => openAuthModal(site.name, org.value),
    secret: () => openSecretModal(site.name, org.value),
    apikey: () => openApiKeyModal(site.name, org.value),
    delete: async () => {
      if (confirm(`Delete site "${site.name}"? This cannot be undone.`)) {
        await deleteSiteConfig(`/config/${org.value}/sites/${site.name}.json`, null);

        // eslint-disable-next-line no-use-before-define
        displaySitesForOrg(org.value);
      }
    },
  };

  card.querySelectorAll('.quick-action-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.action === 'edit') openEditConfig();
      if (btn.dataset.action === 'logs') openLogs();
    });
  });

  card.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      menuDropdown.classList.remove('open');
      const handler = menuActions[item.dataset.action];
      if (handler) await handler(item);
    });
  });

  checkSiteHealth(org.value, site.name).then((isHealthy) => {
    const healthBadge = card.querySelector('.health-badge');
    healthBadge.classList.remove('loading');
    healthBadge.classList.add(isHealthy ? 'healthy' : 'unhealthy');
    healthBadge.title = isHealthy ? 'Site is live' : 'Site may be down';
  });

  renderPsiScores(card, site.name, org.value);

  return card;
};

const fetchSiteDetails = async (orgValue, siteName) => {
  const resp = await fetch(`${ADMIN_API_BASE}/config/${orgValue}/sites/${siteName}.json`);
  return resp.ok ? resp.json() : null;
};

const displaySites = (sites) => {
  sitesElem.ariaHidden = false;
  sitesElem.textContent = '';

  const savedView = localStorage.getItem('site-admin-view') || 'grid';

  const header = document.createElement('div');
  header.className = 'sites-header';
  header.innerHTML = `
    <span class="sites-count">${sites.length} site${sites.length !== 1 ? 's' : ''}</span>
    <div class="sites-actions">
      <div class="sites-search">
        <input type="text" placeholder="Search sites..." class="search-input" />
      </div>
      <div class="view-toggle">
        <button type="button" class="view-btn ${savedView === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
          ${icon('grid')}
        </button>
        <button type="button" class="view-btn ${savedView === 'list' ? 'active' : ''}" data-view="list" title="List view">
          ${icon('list')}
        </button>
      </div>
      <button class="button add-site-btn">+ Add Site</button>
    </div>
  `;

  header.querySelector('.add-site-btn').addEventListener('click', () => openAddSiteModal());

  sitesElem.appendChild(header);

  const grid = document.createElement('div');
  grid.className = `sites-grid ${savedView === 'list' ? 'list-view' : ''}`;

  const searchInput = header.querySelector('.search-input');
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    grid.querySelectorAll('.site-card').forEach((card) => {
      const siteName = card.dataset.site.toLowerCase();
      card.setAttribute('aria-hidden', !siteName.includes(query));
    });
  });

  header.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { view } = btn.dataset;
      header.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      grid.classList.toggle('list-view', view === 'list');
      localStorage.setItem('site-admin-view', view);
    });
  });

  const favorites = getFavorites(org.value);
  const sortedSites = [...sites].sort((a, b) => {
    const aFav = favorites.includes(a.name);
    const bFav = favorites.includes(b.name);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.name.localeCompare(b.name);
  });

  sortedSites.forEach((site) => {
    const card = createSiteCard(site);
    grid.appendChild(card);

    fetchSiteDetails(org.value, site.name).then((details) => {
      if (details) {
        const contentUrl = details.content?.source?.url || '';
        const codeUrl = details.code?.source?.url || '';
        const sourceType = getContentSourceType(contentUrl);

        const badge = card.querySelector('.source-badge');
        if (badge) {
          badge.textContent = sourceType.label;
          badge.className = `source-badge source-${sourceType.type}`;
          badge.title = sourceType.type.toUpperCase();
        }

        const codeSource = card.querySelector('.site-card-source[data-type="code"]');
        const contentSource = card.querySelector('.site-card-source[data-type="content"]');
        const contentEditorUrl = getDAEditorURL(contentUrl);

        if (codeSource) {
          codeSource.title = codeUrl || 'Not configured';
          if (codeUrl) codeSource.href = codeUrl;
          else codeSource.removeAttribute('href');
        }
        if (contentSource) {
          contentSource.title = contentUrl || 'Not configured';
          if (contentEditorUrl) contentSource.href = contentEditorUrl;
          else contentSource.removeAttribute('href');
        }

        card.dataset.codeUrl = codeUrl;
        card.dataset.contentUrl = contentUrl;

        let authScope = 'none';
        if (details.access?.site) authScope = 'site';
        else if (details.access?.preview) authScope = 'preview';
        else if (details.access?.live) authScope = 'live';

        if (authScope !== 'none') {
          card.dataset.hasAuth = 'true';
          const lighthouseBtn = card.querySelector('.menu-item[data-action="lighthouse"]');
          lighthouseBtn.disabled = true;
          lighthouseBtn.title = 'Lighthouse unavailable for authenticated sites';

          const statusInfo = getAuthStatusInfo(authScope);
          const authStatusEl = card.querySelector('.auth-status');
          authStatusEl.className = `auth-status auth-${statusInfo.color}`;
          authStatusEl.innerHTML = `${icon('shield')} ${statusInfo.label}`;
          authStatusEl.title = statusInfo.description;
          authStatusEl.removeAttribute('aria-hidden');
        }

        const cdnHost = details.cdn?.prod?.host || details.cdn?.host;
        if (cdnHost) {
          const cdnEl = card.querySelector('.site-card-cdn');
          cdnEl.querySelector('span').textContent = cdnHost;
          cdnEl.href = `https://${cdnHost}`;
          cdnEl.classList.add('visible');
        }
      }
    });
  });

  sitesElem.appendChild(grid);
};

const displaySitesForOrg = async (orgValue) => {
  sitesElem.setAttribute('aria-hidden', 'true');
  sitesElem.replaceChildren();

  const resp = await adminFetch(`/config/${orgValue}/sites.json`);

  if (resp.status === 200) {
    const { sites } = await resp.json();
    displaySites(sites);
  } else if (resp.status === 401) {
    const loggedIn = await ensureLogin(orgValue);
    if (loggedIn) {
      return displaySitesForOrg(orgValue);
    }
  }
  return null;
};

const initSiteAdmin = async () => {
  const neededIcons = [
    'code', 'document', 'edit', 'copy', 'external', 'trash', 'key',
    'check', 'more-vertical', 'shield', 'lock', 'activity',
    'user', 'search', 'grid', 'list', 'star',
  ];
  await Promise.all(neededIcons.map(loadIcon));
  await initConfigField();
  if (!org.value) org.value = localStorage.getItem('org') || 'adobe';
  if (org.value) {
    const loggedIn = await ensureLogin(org.value);
    if (loggedIn) {
      displaySitesForOrg(org.value);
    }
  }
};

const initPromise = initSiteAdmin();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
