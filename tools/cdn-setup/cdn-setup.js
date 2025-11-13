/* eslint-disable no-alert */
import { initConfigField } from '../../utils/config/config.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const cdnForm = document.getElementById('cdn-form');
const cdnFields = document.getElementById('cdn-fields');
const cdnType = document.getElementById('cdn-type');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');
const host = document.getElementById('host');
let originalConfig;

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
  return div;
}

function updateFields() {
  cdnFields.innerHTML = '';
  const type = cdnType.value;
  if (type && CDN_FIELDS[type]) {
    CDN_FIELDS[type].forEach((field) => {
      cdnFields.append(createField(field));
    });
  }
}

function getFormData() {
  const formData = new FormData(cdnForm);
  const data = {
    type: cdnType.value,
  };

  if (data.type) {
    CDN_FIELDS[data.type].forEach((field) => {
      const value = formData.get(field.name);
      if (field.name === 'route' && value) {
        data[field.name] = value.split(',').map((r) => r.trim());
      } else if (value) data[field.name] = value;
    });
  } else {
    delete data.type;
  }

  if (host.value) {
    data.host = host.value;
  }

  if (cdnType.disabled) {
    delete data.type;
  }

  return data;
}

async function init() {
  await initConfigField();

  cdnType.addEventListener('change', updateFields);

  cdnForm.addEventListener('submit', async (e) => {
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

    const cdnUrl = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/cdn/prod.json`;
    const cdnConfig = getFormData();

    const resp = await fetch(cdnUrl, {
      method: 'POST',
      body: JSON.stringify(cdnConfig),
      headers: {
        'content-type': 'application/json',
      },
    });

    resp.text().then(() => {
      logResponse(consoleBlock, [resp.status, 'POST', cdnUrl, resp.headers.get('x-error') || '']);
    });
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
        cdnType.value = originalConfig.type || '';
        host.value = originalConfig.host || '';
      } else {
        originalConfig = {};
        cdnType.value = '';
        host.value = '';
      }

      // Populate fields with existing values
      if (originalConfig.type || aggConfig.type) {
        const effectiveType = originalConfig.type || aggConfig.type;
        if (aggConfig.type && !originalConfig.type) {
          cdnType.disabled = true;
          cdnType.value = effectiveType;
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

      cdnForm.setAttribute('aria-hidden', 'false');
      cdnForm.removeAttribute('disabled');
    } else if (resp.status === 404) {
      originalConfig = {};
      cdnForm.setAttribute('aria-hidden', 'true');
      cdnForm.setAttribute('disabled', '');
    }

    logResponse(consoleBlock, [resp.status, 'GET', cdnUrl, resp.headers.get('x-error') || '']);
  });
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
