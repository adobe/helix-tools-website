import { registerToolReady } from '../../scripts/scripts.js';
import { getAdminClientForSite } from '../../scripts/admin-compat.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { readHeaders, writeHeaders, removeHeaders } from './api.js';

const adminForm = document.getElementById('admin-form');
const headersForm = document.getElementById('headers-form');
const headersList = document.getElementById('headers-list');
const addHeaderBtn = document.getElementById('add-header');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');
const pathSelect = document.getElementById('path-select');
const addPathBtn = document.getElementById('add-path');
const removePathBtn = document.getElementById('remove-path');

let originalHeaders;
let currentPath = null;
// `client` is pinned until the next Fetch: edits to the org/site inputs don't retarget a Save,
// which writes the headers loaded from the fetched site.
let client = null;

const log = (res) => logResponse(
  consoleBlock,
  res.status,
  [res.request.method, res.request.url, res.error],
);

function createHeaderItem(header = '', value = '') {
  const div = document.createElement('div');
  div.className = 'header-item';

  const headerInput = document.createElement('input');
  headerInput.type = 'text';
  headerInput.placeholder = 'Header name';
  headerInput.value = header;
  headerInput.required = true;
  headerInput.classList.add('header-key');

  headerInput.setAttribute('list', 'header-keys');
  const valueInput = header.toLowerCase() === 'content-security-policy'
    ? document.createElement('textarea')
    : document.createElement('input');
  valueInput.placeholder = 'Header value';
  valueInput.value = value;
  valueInput.required = true;
  valueInput.classList.add('header-value');

  headerInput.addEventListener('change', (e) => {
    e.target.value = e.target.value.trim();
    if (e.target.value.toLowerCase() === 'content-security-policy' && valueInput.value === '') {
      const textarea = document.createElement('textarea');
      textarea.placeholder = 'Header value';
      textarea.value = '';
      textarea.required = true;
      textarea.classList.add('header-value');
      valueInput.replaceWith(textarea);
    }
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-header';
  removeBtn.textContent = '\u00D7';
  removeBtn.onclick = () => div.remove();

  div.append(headerInput, valueInput, removeBtn);
  return div;
}

function getHeadersData() {
  const headers = [];
  headersList.querySelectorAll('.header-item').forEach((item) => {
    const header = item.querySelector('.header-key').value.trim();
    const value = item.querySelector('.header-value').value.trim();
    if (header && value) {
      headers.push({
        key: header,
        value,
      });
    }
  });
  return headers;
}

function populatePathSelect() {
  pathSelect.innerHTML = '';
  const paths = Object.keys(originalHeaders);
  if (!paths.includes('/**')) {
    paths.unshift('/**');
  }
  paths.forEach((path) => {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path;
    pathSelect.appendChild(option);
  });
}

function updateRemoveButtonState() {
  removePathBtn.disabled = currentPath === '/**';
}

function saveCurrentPathHeaders() {
  if (currentPath && originalHeaders) {
    originalHeaders[currentPath] = getHeadersData();
  }
}

function loadHeadersForPath(path) {
  saveCurrentPathHeaders();
  headersList.innerHTML = '';
  currentPath = path;
  pathSelect.value = path;
  const headers = originalHeaders[path];
  if (headers) {
    headers.forEach(({ key, value }) => {
      headersList.append(createHeaderItem(key, value));
    });
  }
  updateRemoveButtonState();
}

function addNewPath() {
  // eslint-disable-next-line no-alert
  const newPath = prompt('Enter new path pattern (e.g., /tools/**, /fragments/**):', '/**');
  if (newPath && newPath.trim()) {
    const trimmedPath = newPath.trim();
    if (!trimmedPath.startsWith('/')) {
      // eslint-disable-next-line no-alert
      alert('Path must start with /');
      return;
    }

    if (originalHeaders[trimmedPath]) {
      // eslint-disable-next-line no-alert
      alert(`Path "${trimmedPath}" already exists.`);
    } else {
      originalHeaders[trimmedPath] = [];
      populatePathSelect();
    }
    pathSelect.value = trimmedPath;
    loadHeadersForPath(trimmedPath);
  }
}

function removePath() {
  if (currentPath === '/**') return;

  // eslint-disable-next-line no-alert, no-restricted-globals
  if (!confirm(`Remove path "${currentPath}" and all its headers? You will need to hit save to apply the changes to the site configuration.`)) return;

  delete originalHeaders[currentPath];
  currentPath = '/**';
  populatePathSelect();
  loadHeadersForPath(currentPath);
}

/**
 * Detects H5 or H6 for the selected site and logs a detection failure to the console.
 * @returns {Promise<import('../../scripts/admin-types.js').BoundAdminClient|null>}
 */
async function loadClient() {
  try {
    return await getAdminClientForSite({ org: org.value, site: site.value });
  } catch (error) {
    logResponse(consoleBlock, 500, ['GET', `${org.value}/${site.value}`, error.message]);
    return null;
  }
}

async function init() {
  await initConfigField();

  addHeaderBtn.addEventListener('click', () => {
    headersList.append(createHeaderItem());
  });

  addPathBtn.addEventListener('click', addNewPath);
  removePathBtn.addEventListener('click', removePath);

  pathSelect.addEventListener('change', (e) => {
    loadHeadersForPath(e.target.value);
  });

  headersForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    // The editor is hidden until a Fetch has pinned a client.
    if (!client) return;

    saveCurrentPathHeaders();

    const patchedHeaders = JSON.parse(JSON.stringify(originalHeaders));
    Object.keys(patchedHeaders).forEach((path) => {
      if (patchedHeaders[path].length === 0) {
        delete patchedHeaders[path];
      }
    });

    if (Object.keys(patchedHeaders).length === 0) {
      await removeHeaders(client, log);
    } else {
      await writeHeaders(client, log, patchedHeaders);
    }
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const loaded = await loadClient();
    if (!loaded) return;
    const headers = await readHeaders(loaded, log);
    if (!headers) return;
    // Pin only with the headers it loaded, so a Save never writes them to another site.
    client = loaded;
    headersList.innerHTML = '';
    // An empty object means no headers are configured yet (404).
    originalHeaders = headers;
    currentPath = null;
    populatePathSelect();
    loadHeadersForPath('/**');
    document.querySelector('.path-selector').setAttribute('aria-hidden', 'false');
    document.querySelector('.button-bar').setAttribute('aria-hidden', 'false');
  });
}

registerToolReady(init());
