import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

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
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    saveCurrentPathHeaders();

    const headersUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/headers.json`;
    const patchedHeaders = JSON.parse(JSON.stringify(originalHeaders));

    Object.keys(patchedHeaders).forEach((path) => {
      if (patchedHeaders[path].length === 0) {
        delete patchedHeaders[path];
      }
    });

    const isEmpty = Object.keys(patchedHeaders).length === 0;
    const resp = await fetch(headersUrl, {
      method: isEmpty ? 'DELETE' : 'POST',
      body: isEmpty ? undefined : JSON.stringify(patchedHeaders),
      headers: isEmpty ? undefined : {
        'content-type': 'application/json',
      },
    });

    resp.text().then(() => {
      logResponse(consoleBlock, resp.status, [isEmpty ? 'DELETE' : 'POST', headersUrl, resp.headers.get('x-error') || '']);
    });
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const headersUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/headers.json`;
    const resp = await fetch(headersUrl);
    headersList.innerHTML = '';
    const buttonBar = document.querySelector('.button-bar');
    const pathSelector = document.querySelector('.path-selector');
    if (resp.status === 200) {
      originalHeaders = (await resp.json());
      currentPath = null;
      populatePathSelect();
      loadHeadersForPath('/**');

      pathSelector.setAttribute('aria-hidden', 'false');
      buttonBar.setAttribute('aria-hidden', 'false');
    } else if (resp.status === 404) {
      originalHeaders = {};
      currentPath = null;
      populatePathSelect();
      loadHeadersForPath('/**');
      pathSelector.setAttribute('aria-hidden', 'false');
      buttonBar.setAttribute('aria-hidden', 'false');
    }

    logResponse(consoleBlock, resp.status, ['GET', headersUrl, resp.headers.get('x-error') || '']);
  });
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
