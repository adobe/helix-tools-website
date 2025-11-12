import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const headersForm = document.getElementById('headers-form');
const headersList = document.getElementById('headers-list');
const addHeaderBtn = document.getElementById('add-header');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');

let originalHeaders;

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

async function init() {
  await initConfigField();

  addHeaderBtn.addEventListener('click', () => {
    headersList.append(createHeaderItem());
  });

  headersForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const headersUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/headers.json`;
    const headers = getHeadersData();
    const patchedHeaders = JSON.parse(JSON.stringify(originalHeaders));
    patchedHeaders['/**'] = headers;

    const resp = await fetch(headersUrl, {
      method: 'POST',
      body: JSON.stringify(patchedHeaders),
      headers: {
        'content-type': 'application/json',
      },
    });

    resp.text().then(() => {
      logResponse(consoleBlock, [resp.status, 'POST', headersUrl, resp.headers.get('x-error') || '']);
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
    // Clear existing headers
    headersList.innerHTML = '';
    const buttonBar = document.querySelector('.button-bar');
    if (resp.status === 200) {
      originalHeaders = (await resp.json());

      const nonStandardWarning = document.querySelector('.headers-non-standard-warning');
      nonStandardWarning.setAttribute('aria-hidden', 'true');

      Object.keys(originalHeaders).forEach((key) => {
        if (key !== '/**') {
          nonStandardWarning.removeAttribute('aria-hidden');
        }
      });

      const headers = originalHeaders['/**'];
      if (headers) {
        // Add each header
        headers.forEach(({ key, value }) => {
          headersList.append(createHeaderItem(key, value));
        });
      }

      buttonBar.setAttribute('aria-hidden', 'false');
    } else if (resp.status === 404) {
      originalHeaders = {};
      buttonBar.setAttribute('aria-hidden', 'false');
    }

    logResponse(consoleBlock, [resp.status, 'GET', headersUrl, resp.headers.get('x-error') || '']);
  });
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
