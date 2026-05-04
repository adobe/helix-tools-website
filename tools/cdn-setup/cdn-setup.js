/* eslint-disable no-alert */
import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import { getErrorMessage } from './utils.js';

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

  // DNS: labels 1-63 chars, [a-z0-9-] no leading/trailing hyphen, total ≤253
  const dnsLabel = '[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
  const hostPattern = new RegExp(`^(${dnsLabel})(\\.(${dnsLabel}))*$`);
  if (!host.value || host.value.length > 253 || !hostPattern.test(host.value)) {
    alert('Please enter a valid production host (e.g. www.example.com)');
    host.focus();
    return;
  }

  const cdnConfig = getFormData();
  saveBtn.disabled = true;

  try {
    const result = await executeAdminRequest(
      () => admin.config({ org: org.value, site: site.value })
        .select('cdn/prod.json')
        .update(JSON.stringify(cdnConfig)),
      { org: org.value, site: site.value },
    );
    if (!result) return;
    const { method, url } = result.request;
    logResponse(consoleBlock, result.status, [method, url, result.error]);
  } finally {
    saveBtn.disabled = false;
  }
}

async function init() {
  await initConfigField();

  // Update URL params when org or site changes
  org.addEventListener('change', () => {
    updateConfig();
  });

  site.addEventListener('change', () => {
    updateConfig();
  });

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

    const result = await executeAdminRequest(async () => {
      const [aggRes, siteRes] = await Promise.all([
        admin.config({ org: org.value }).select(`aggregated/${site.value}.json`).read(),
        admin.config({ org: org.value, site: site.value }).read(),
      ]);
      [aggRes, siteRes].forEach((r) => {
        const { method, url } = r.request;
        logResponse(consoleBlock, r.status, [method, url, r.error]);
      });
      const status = aggRes.status === 401 || siteRes.status === 401 ? 401 : siteRes.status;
      return { status, ok: siteRes.ok, parts: { aggRes, siteRes } };
    }, { org: org.value, site: site.value, policy: AuthMode.PREFLIGHT_AND_RETRY });

    if (!result) return;
    const { aggRes, siteRes } = result.parts;

    let aggConfig = {};
    if (aggRes.ok) {
      const aggregate = await aggRes.json();
      aggConfig = aggregate.cdn?.prod || {};
    }

    if (siteRes.status === 200) {
      const siteConfig = await siteRes.json();
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
    } else if (siteRes.status === 404) {
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
  });

  host.addEventListener('input', () => {
    validationPassed = false;
    validationResults.setAttribute('aria-hidden', 'true');
    updateSaveButtonState();
  });
}

registerToolReady(init());
