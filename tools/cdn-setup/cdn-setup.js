/* eslint-disable no-alert */
import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const cdnForm = document.getElementById('cdn-form');
const cdnFields = document.getElementById('cdn-fields');
const cdnTypeRadios = document.querySelectorAll('input[name="cdn-type"]');
const cdnTypeItems = document.querySelectorAll('.cdn-type-list li');
const validationResults = document.getElementById('validation-results');
const validateBtn = document.getElementById('validate');
const saveBtn = document.getElementById('save');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');
const host = document.getElementById('host');

let originalConfig;
let validationPassed = false;

const VALIDATION_URL = 'https://helix-pages.anywhere.run/helix-services/byocdn-push-invalidation/v1';

const CDN_FIELDS = {
  fastly: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'serviceId', type: 'text', required: true, label: 'Service ID',
    },
    {
      name: 'authToken', type: 'password', required: true, label: 'Auth Token',
    },
  ],
  cloudflare: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'plan', type: 'text', required: true, label: 'Plan',
    },
    {
      name: 'zoneId', type: 'text', required: true, label: 'Zone ID',
    },
    {
      name: 'apiToken', type: 'password', required: true, label: 'API Token',
    },
  ],
  akamai: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'endpoint', type: 'text', required: true, label: 'Endpoint',
    },
    {
      name: 'clientSecret', type: 'password', required: true, label: 'Client Secret',
    },
    {
      name: 'clientToken', type: 'password', required: true, label: 'Client Token',
    },
    {
      name: 'accessToken', type: 'password', required: true, label: 'Access Token',
    },
  ],
  managed: [
    {
      name: 'envId', type: 'text', required: false, label: 'Environment ID (optional)',
    },
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
  ],
  cloudfront: [
    {
      name: 'route', type: 'text', required: false, label: 'Routes (comma-separated)',
    },
    {
      name: 'distributionId', type: 'text', required: true, label: 'Distribution ID',
    },
    {
      name: 'accessKeyId', type: 'text', required: true, label: 'Access Key ID',
    },
    {
      name: 'secretAccessKey', type: 'password', required: true, label: 'Secret Access Key',
    },
  ],
};

const ERROR_MESSAGES = {
  ENOTFOUND: 'Could not connect to CDN endpoint. Please verify the hostname is correct.',
  ECONNREFUSED: 'Connection refused by CDN server. Please check your endpoint configuration.',
  ETIMEDOUT: 'Request timed out. The CDN server may be unreachable.',
  ECONNRESET: 'Connection was reset. Please try again.',
  400: 'Bad request. Please check your configuration.',
  401: 'Authentication failed. Please verify your credentials.',
  403: 'Access denied. Your credentials may not have the required permissions.',
  404: 'Resource not found. Please verify your configuration.',
  500: 'CDN server error. Please try again later.',
};

function parseBody(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return null;

  try {
    return JSON.parse(body);
  } catch {
    return { rawMessage: body };
  }
}

function getErrorMessage(result) {
  if (result.status === 'ok' || result.status === 'succeeded') {
    return 'Validation successful';
  }

  if (result.status === 'unsupported') {
    return typeof result.body === 'string' ? result.body : 'This operation is not supported';
  }

  if (result.statusCode) {
    const statusKey = String(result.statusCode);
    if (ERROR_MESSAGES[statusKey]) {
      return ERROR_MESSAGES[statusKey];
    }
  }

  const body = parseBody(result.body);
  if (!body) {
    return 'Validation failed';
  }

  if (body.code) {
    const codeKey = String(body.code);
    if (ERROR_MESSAGES[codeKey]) {
      return ERROR_MESSAGES[codeKey];
    }
  }

  if (body.msg) {
    return `Validation failed: ${body.msg}`;
  }

  if (body.errors && Array.isArray(body.errors) && body.errors.length > 0) {
    const firstError = body.errors[0];
    if (firstError.message) {
      return `Validation failed: ${firstError.message}`;
    }
  }

  if (body.message) {
    return `Validation failed: ${body.message}`;
  }

  if (body.error) {
    return `Validation failed: ${body.error}`;
  }

  if (body.rawMessage && result.statusCode && ERROR_MESSAGES[String(result.statusCode)]) {
    return ERROR_MESSAGES[String(result.statusCode)];
  }

  return 'Validation failed. Check details for more information.';
}

function getSelectedCdnType() {
  const selected = document.querySelector('input[name="cdn-type"]:checked');
  return selected ? selected.value : '';
}

function requiresValidation(type) {
  return type && type !== 'managed';
}

function updateSaveButtonState() {
  const type = getSelectedCdnType();
  saveBtn.disabled = requiresValidation(type) && !validationPassed;
}

function updateCdnTypeSelection(selectedType) {
  cdnTypeItems.forEach((item) => {
    const cdnType = item.dataset.cdn;
    if (selectedType) {
      item.setAttribute('aria-selected', cdnType === selectedType ? 'true' : 'false');
    } else {
      item.removeAttribute('aria-selected');
    }
  });

  validateBtn.style.display = requiresValidation(selectedType) ? '' : 'none';
  updateSaveButtonState();
}

function createField(field) {
  const div = document.createElement('div');
  div.className = 'form-field';

  const label = document.createElement('label');
  label.htmlFor = field.name;
  label.textContent = field.label;

  const input = document.createElement('input');
  input.type = field.type;
  input.id = field.name;
  input.name = field.name;
  input.required = field.required;

  div.append(label, input);
  if (field.type === 'password') {
    input.addEventListener('focus', () => {
      input.type = 'text';
    });
    input.addEventListener('blur', () => {
      input.type = 'password';
    });
  }

  input.addEventListener('input', () => {
    validationPassed = false;
    validationResults.setAttribute('aria-hidden', 'true');
    updateSaveButtonState();
  });

  return div;
}

function updateFields() {
  cdnFields.innerHTML = '';
  const type = getSelectedCdnType();
  if (type && CDN_FIELDS[type]) {
    CDN_FIELDS[type].forEach((field) => {
      cdnFields.append(createField(field));
    });
  }
  validationPassed = false;
  updateSaveButtonState();
  validationResults.setAttribute('aria-hidden', 'true');
}

function getFormData() {
  const formData = new FormData(cdnForm);
  const type = getSelectedCdnType();
  const data = {};

  if (type && CDN_FIELDS[type]) {
    const isInherited = document.querySelector('input[name="cdn-type"]:disabled:checked');

    if (!isInherited) {
      data.type = type;
    }

    CDN_FIELDS[type].forEach((field) => {
      const value = formData.get(field.name);
      if (field.name === 'route' && value) {
        data[field.name] = value.split(',').map((r) => r.trim());
      } else if (value) {
        data[field.name] = value;
      }
    });
  }

  if (host.value) {
    data.host = host.value;
  }

  return data;
}

function getValidationFormData() {
  const type = getSelectedCdnType();
  const data = { type, host: host.value };

  if (type && CDN_FIELDS[type]) {
    CDN_FIELDS[type].forEach((field) => {
      if (field.name !== 'route') {
        const input = document.getElementById(field.name);
        if (input && input.value) {
          data[field.name] = input.value;
        }
      }
    });
  }

  return data;
}

function updateValidationItem(testName, status, message, details) {
  const item = validationResults.querySelector(`[data-test="${testName}"]`);
  if (!item) return;

  item.className = `validation-item ${status}`;

  const messageEl = item.querySelector('.validation-message');
  if (messageEl) {
    messageEl.textContent = message;
  }

  const codeEl = item.querySelector('code');
  if (codeEl && details) {
    codeEl.textContent = JSON.stringify(details, null, 2);
  }

  const detailsEl = item.querySelector('.validation-details');
  if (detailsEl) {
    detailsEl.style.display = (status === 'error') ? 'block' : 'none';
  }
}

async function runValidation() {
  const type = getSelectedCdnType();

  if (!type || type === 'managed') {
    validationPassed = true;
    return true;
  }

  if (!cdnForm.checkValidity()) {
    cdnForm.reportValidity();
    return false;
  }

  validationResults.setAttribute('aria-hidden', 'false');
  updateValidationItem('urlPurge', 'loading', 'Validating...', null);
  updateValidationItem('keyPurge', 'loading', 'Validating...', null);

  validateBtn.disabled = true;
  saveBtn.disabled = true;

  try {
    const formData = getValidationFormData();
    const urlParams = new URLSearchParams(formData);

    const resp = await fetch(VALIDATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: urlParams.toString(),
    });

    const results = await resp.json();

    const urlPurgeResult = results.urlPurge || {};
    const urlPurgeOk = ['ok', 'succeeded', 'unsupported'].includes(urlPurgeResult.status);
    updateValidationItem(
      'urlPurge',
      urlPurgeOk ? 'success' : 'error',
      getErrorMessage(urlPurgeResult),
      urlPurgeResult,
    );

    const keyPurgeResult = results.keyPurge || {};
    const keyPurgeOk = ['ok', 'succeeded', 'unsupported'].includes(keyPurgeResult.status);
    updateValidationItem(
      'keyPurge',
      keyPurgeOk ? 'success' : 'error',
      getErrorMessage(keyPurgeResult),
      keyPurgeResult,
    );

    validationPassed = urlPurgeOk && keyPurgeOk;
    updateSaveButtonState();

    return validationPassed;
  } catch (error) {
    updateValidationItem('urlPurge', 'error', `Request failed: ${error.message}`, { error: error.message });
    updateValidationItem('keyPurge', 'error', `Request failed: ${error.message}`, { error: error.message });
    validationPassed = false;
    return false;
  } finally {
    validateBtn.disabled = false;
    updateSaveButtonState();
  }
}

async function saveConfig() {
  if (!org.value || !site.value) {
    alert('Please select an organization and site first');
    return;
  }

  const hostPattern = /^www\.[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+$/;
  if (!host.value || !hostPattern.test(host.value)) {
    alert('Please enter a valid production host (e.g. www.example.com)');
    host.focus();
    return;
  }

  if (!await ensureLogin(org.value, site.value)) {
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      if (loginInfo.includes(org.value)) {
        saveConfig();
      }
    }, { once: true });
    return;
  }

  const cdnUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/cdn/prod.json`;
  const cdnConfig = getFormData();

  saveBtn.disabled = true;

  try {
    const resp = await fetch(cdnUrl, {
      method: 'POST',
      body: JSON.stringify(cdnConfig),
      headers: {
        'content-type': 'application/json',
      },
    });

    await resp.text();
    logResponse(consoleBlock, resp.status, ['POST', cdnUrl, resp.headers.get('x-error') || '']);
  } finally {
    saveBtn.disabled = false;
  }
}

async function init() {
  await initConfigField();

  cdnTypeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      updateCdnTypeSelection(radio.value);
      updateFields();
    });
  });

  validateBtn.addEventListener('click', async () => {
    await runValidation();
  });

  cdnForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveConfig();
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      alert('Please select an organization and site first');
      return;
    }

    if (!await ensureLogin(org.value, site.value)) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (loginInfo.includes(org.value)) {
          e.target.querySelector('button[type="submit"]').click();
        }
      }, { once: true });
      return;
    }

    const aggregateConfig = await fetch(`https://admin.hlx.page/config/${org.value}/aggregated/${site.value}.json`);
    let aggConfig = {};
    if (aggregateConfig.ok) {
      const aggregate = await aggregateConfig.json();
      aggConfig = aggregate.cdn?.prod || {};
    }

    const cdnUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}.json`;
    const resp = await fetch(cdnUrl);

    if (resp.status === 200) {
      const siteConfig = await resp.json();
      if (siteConfig.cdn && siteConfig.cdn.prod) {
        originalConfig = siteConfig.cdn.prod;
        host.value = originalConfig.host || '';
      } else {
        originalConfig = {};
        host.value = '';
      }

      const effectiveType = originalConfig.type || aggConfig.type || '';
      if (effectiveType) {
        const radio = document.getElementById(`cdn-${effectiveType}`);
        if (radio) {
          radio.checked = true;
          updateCdnTypeSelection(effectiveType);

          if (aggConfig.type && !originalConfig.type) {
            cdnTypeRadios.forEach((r) => {
              r.disabled = true;
            });
          }

          updateFields();

          CDN_FIELDS[effectiveType].forEach((field) => {
            const input = document.getElementById(field.name);
            if (input) {
              if (field.name === 'route' && Array.isArray(originalConfig[field.name])) {
                input.value = originalConfig[field.name].join(', ');
              } else {
                input.value = originalConfig[field.name] || aggConfig[field.name] || '';
                if (aggConfig[field.name] && !originalConfig[field.name]) {
                  input.disabled = true;
                }
              }
            }
          });
        }
      }

      cdnForm.setAttribute('aria-hidden', 'false');
      cdnForm.removeAttribute('disabled');

      validationPassed = false;
      validationResults.setAttribute('aria-hidden', 'true');
      updateSaveButtonState();
    } else if (resp.status === 404) {
      originalConfig = {};
      cdnForm.setAttribute('aria-hidden', 'false');
      cdnForm.removeAttribute('disabled');

      cdnTypeRadios.forEach((r) => {
        r.checked = false;
        r.disabled = false;
      });
      updateCdnTypeSelection('');
      cdnFields.innerHTML = '';
      host.value = '';
    }

    logResponse(consoleBlock, resp.status, ['GET', cdnUrl, resp.headers.get('x-error') || '']);
  });

  host.addEventListener('input', () => {
    validationPassed = false;
    validationResults.setAttribute('aria-hidden', 'true');
    updateSaveButtonState();
  });
}

registerToolReady(init());
