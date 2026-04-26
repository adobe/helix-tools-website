import { initConfigField } from '../../utils/config/config.js';

const API_BASE = 'https://json2html.adobeaem.workers.dev';

const TYPE_LABELS = {
  cf: 'AEM Content Fragment',
  custom: 'Custom JSON Endpoint',
  array: 'JSON Array → Pages',
};

let configs = [];
let editingIndex = -1;

const connectForm = document.getElementById('connect-form');
const orgInput = document.getElementById('org');
const siteInput = document.getElementById('site');
const branchInput = document.getElementById('branch');
const loadBtn = document.getElementById('load-btn');
const configSection = document.getElementById('config-section');
const configHeading = document.getElementById('config-heading');
const configList = document.getElementById('config-list');
const addConfigBtn = document.getElementById('add-config-btn');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const configFormWrap = document.getElementById('config-form-wrap');
const formTitle = document.getElementById('form-title');
const formCancelBtn = document.getElementById('form-cancel-btn');
const configEntryForm = document.getElementById('config-entry-form');
const formSaveBtn = document.getElementById('form-save-btn');
const typeRadios = document.querySelectorAll('input[name="config-type"]');

function setDirty(dirty) {
  saveBtn.disabled = !dirty;
}

function showStatus(msg, isError = false) {
  saveStatus.textContent = msg;
  saveStatus.className = `save-status ${isError ? 'status-error' : 'status-ok'}`;
  setTimeout(() => {
    saveStatus.textContent = '';
    saveStatus.className = 'save-status';
  }, 4000);
}

function inferType(cfg) {
  if (cfg.arrayKey !== undefined || cfg.pathKey !== undefined) return 'array';
  const ep = cfg.endpoint || '';
  if (ep.includes('adobeaemcloud.com/api/assets/') || ep.includes('adobeaemcloud.com/graphql/')) return 'cf';
  return 'custom';
}

function renderTypeTag(type) {
  const tag = document.createElement('span');
  tag.className = `type-tag type-tag-${type}`;
  tag.textContent = TYPE_LABELS[type] || type;
  return tag;
}

function deleteConfig(index) {
  configs.splice(index, 1);
  renderConfigList(); // eslint-disable-line no-use-before-define
  setDirty(true);
}

function closeForm() {
  configFormWrap.hidden = true;
  configSection.hidden = false;
}

function createHeaderRow(key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'header-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'Header name';
  keyInput.value = key;
  keyInput.className = 'header-key';

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.placeholder = 'Header value';
  valInput.value = value;
  valInput.className = 'header-value';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-icon';
  removeBtn.setAttribute('aria-label', 'Remove header');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(keyInput, valInput, removeBtn);
  return row;
}

function setActiveType(type) {
  document.querySelectorAll('.type-fields').forEach((el) => {
    el.hidden = !el.classList.contains(`${type}-fields`);
  });
}

function clearForm() {
  configEntryForm.reset();
  document.getElementById('custom-headers-list').innerHTML = '';
  setActiveType('cf');
  document.querySelector('input[name="config-type"][value="cf"]').checked = true;
}

function populateFormFromConfig(cfg) {
  const type = inferType(cfg);
  document.querySelector(`input[name="config-type"][value="${type}"]`).checked = true;
  setActiveType(type);

  document.getElementById('cfg-path').value = cfg.path || '';
  document.getElementById('cfg-template').value = cfg.template || '';
  document.getElementById('cfg-relative-prefix').value = cfg.relativeURLPrefix || '';
  document.getElementById('cfg-template-api-key').value = cfg.templateApiKey || '';

  if (type === 'cf') {
    const ep = cfg.endpoint || '';
    const match = ep.match(/^https:\/\/([^/]+)(\/.*?){{id}}/);
    if (match) {
      const [, author, cfPath] = match;
      document.getElementById('cfg-cf-author').value = author;
      document.getElementById('cfg-cf-path').value = cfPath;
    }
    document.getElementById('cfg-cf-publish').value = cfg.relativeURLPrefix || '';
  } else if (type === 'custom') {
    document.getElementById('cfg-endpoint').value = cfg.endpoint || '';
    document.getElementById('cfg-regex').value = cfg.regex || '/[^/]+$/';
    document.getElementById('cfg-forward-headers').value = (cfg.forwardHeaders || []).join(', ');
    const headerList = document.getElementById('custom-headers-list');
    headerList.innerHTML = '';
    Object.entries(cfg.headers || {}).forEach(([k, v]) => {
      if (k !== 'Accept') headerList.append(createHeaderRow(k, v));
    });
  } else if (type === 'array') {
    document.getElementById('cfg-array-endpoint').value = cfg.endpoint || '';
    document.getElementById('cfg-array-key').value = cfg.arrayKey || '';
    document.getElementById('cfg-path-key').value = cfg.pathKey || '';
  }
}

function openEditForm(index) {
  editingIndex = index;
  clearForm();
  populateFormFromConfig(configs[index]);
  formTitle.textContent = 'Edit Configuration';
  formSaveBtn.textContent = 'Update Config';
  configFormWrap.hidden = false;
  configSection.hidden = true;
  document.getElementById('cfg-path').focus();
}

function renderConfigCard(cfg, index) {
  const card = document.createElement('div');
  card.className = 'config-card';

  const type = inferType(cfg);

  const header = document.createElement('div');
  header.className = 'card-header';
  const pathEl = document.createElement('span');
  pathEl.className = 'card-path';
  pathEl.textContent = cfg.path || '(no path)';
  header.append(renderTypeTag(type), pathEl);

  const body = document.createElement('div');
  body.className = 'card-body';

  const endpointEl = document.createElement('span');
  endpointEl.className = 'card-endpoint';
  endpointEl.textContent = cfg.endpoint || '';
  body.append(endpointEl);

  if (cfg.template) {
    const templateEl = document.createElement('span');
    templateEl.className = 'card-template';
    templateEl.textContent = `Template: ${cfg.template}`;
    body.append(templateEl);
  }

  if (type === 'array') {
    const arrEl = document.createElement('span');
    arrEl.className = 'card-detail';
    arrEl.textContent = `arrayKey: ${cfg.arrayKey || '—'}  pathKey: ${cfg.pathKey || '—'}`;
    body.append(arrEl);
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'button small outline';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openEditForm(index));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'button small outline danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteConfig(index));

  actions.append(editBtn, deleteBtn);
  card.append(header, body, actions);
  return card;
}

function renderConfigList() {
  configList.innerHTML = '';
  if (configs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No configurations yet. Click "+ Add Config" to get started.';
    configList.append(empty);
    return;
  }
  configs.forEach((cfg, i) => configList.append(renderConfigCard(cfg, i)));
}

async function loadConfig() {
  const org = orgInput.value.trim();
  const site = siteInput.value.trim();
  const branch = branchInput.value.trim() || 'main';

  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading…';

  try {
    const resp = await fetch(`${API_BASE}/config/${org}/${site}/${branch}`);

    if (!resp.ok) {
      const errText = resp.headers.get('x-error') || `HTTP ${resp.status}`;
      throw new Error(errText);
    }

    const data = await resp.json();
    configs = Array.isArray(data) ? data : [];
    configHeading.textContent = `Configurations for ${org}/${site}/${branch}`;
    configSection.hidden = false;
    renderConfigList();
    setDirty(false);
  } catch (e) {
    showStatus(`Load failed: ${e.message}`, true);
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = 'Load Config';
  }
}

async function saveConfig() {
  const org = orgInput.value.trim();
  const site = siteInput.value.trim();
  const branch = branchInput.value.trim() || 'main';

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const resp = await fetch(`${API_BASE}/config/${org}/${site}/${branch}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configs),
    });

    if (!resp.ok) {
      const errText = resp.headers.get('x-error') || `HTTP ${resp.status}`;
      throw new Error(errText);
    }

    setDirty(false);
    showStatus('Config saved successfully.');
  } catch (e) {
    showStatus(`Save failed: ${e.message}`, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

typeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) setActiveType(radio.value);
  });
});

function openAddForm() {
  editingIndex = -1;
  clearForm();
  formTitle.textContent = 'Add Configuration';
  formSaveBtn.textContent = 'Add to Config';
  configFormWrap.hidden = false;
  configSection.hidden = true;
  document.getElementById('cfg-path').focus();
}

document.getElementById('add-custom-header').addEventListener('click', () => {
  document.getElementById('custom-headers-list').append(createHeaderRow());
});

function buildConfigObject() {
  const type = document.querySelector('input[name="config-type"]:checked').value;
  const path = document.getElementById('cfg-path').value.trim();
  const template = document.getElementById('cfg-template').value.trim();
  const relativeURLPrefix = document.getElementById('cfg-relative-prefix').value.trim();
  const templateApiKey = document.getElementById('cfg-template-api-key').value.trim();

  const cfg = { path };

  if (type === 'cf') {
    const author = document.getElementById('cfg-cf-author').value.trim();
    const cfPath = document.getElementById('cfg-cf-path').value.trim();
    const normalizedCfPath = cfPath.endsWith('/') ? cfPath : `${cfPath}/`;
    cfg.endpoint = `https://${author}${normalizedCfPath}{{id}}.json`;
    cfg.regex = '/[^/]+$/';
    cfg.headers = { Accept: 'application/json' };
    cfg.forwardHeaders = ['Authorization'];
    const publish = document.getElementById('cfg-cf-publish').value.trim();
    if (publish) cfg.relativeURLPrefix = publish;
  } else if (type === 'custom') {
    cfg.endpoint = document.getElementById('cfg-endpoint').value.trim();
    const regex = document.getElementById('cfg-regex').value.trim();
    if (regex) cfg.regex = regex;
    const forwardRaw = document.getElementById('cfg-forward-headers').value.trim();
    if (forwardRaw) {
      cfg.forwardHeaders = forwardRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const headers = {};
    document.querySelectorAll('#custom-headers-list .header-row').forEach((row) => {
      const k = row.querySelector('.header-key').value.trim();
      const v = row.querySelector('.header-value').value.trim();
      if (k && v) headers[k] = v;
    });
    if (Object.keys(headers).length > 0) cfg.headers = headers;
  } else if (type === 'array') {
    cfg.endpoint = document.getElementById('cfg-array-endpoint').value.trim();
    cfg.arrayKey = document.getElementById('cfg-array-key').value.trim();
    cfg.pathKey = document.getElementById('cfg-path-key').value.trim();
  }

  if (template) cfg.template = template;
  if (relativeURLPrefix && !cfg.relativeURLPrefix) cfg.relativeURLPrefix = relativeURLPrefix;
  if (templateApiKey) cfg.templateApiKey = templateApiKey;

  return cfg;
}

configEntryForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cfg = buildConfigObject();

  if (!cfg.path) { document.getElementById('cfg-path').focus(); return; }
  if (!cfg.endpoint) {
    const firstEndpoint = document.querySelector('.type-fields:not([hidden]) input[id$="endpoint"]');
    if (firstEndpoint) firstEndpoint.focus();
    return;
  }

  if (editingIndex >= 0) {
    configs[editingIndex] = cfg;
  } else {
    configs.push(cfg);
  }

  renderConfigList();
  setDirty(true);
  closeForm();
});

let simInitialized = false;

async function initSimulatorTab() {
  if (simInitialized) return;
  simInitialized = true;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/tools/json2html-config/simulator.css';
  document.head.appendChild(link);

  const { default: initSimulator } = await import('../json2html-simulator/json2html-simulator.js');
  await initSimulator(document.getElementById('simulator-root'));
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const { tab } = btn.dataset;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const isTarget = panel.id === `tab-${tab}`;
      panel.classList.toggle('active', isTarget);
      panel.hidden = !isTarget;
    });
    if (tab === 'simulate') await initSimulatorTab();
  });
});

connectForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadConfig();
});

addConfigBtn.addEventListener('click', openAddForm);
formCancelBtn.addEventListener('click', closeForm);
saveBtn.addEventListener('click', saveConfig);

async function init() {
  await initConfigField();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
