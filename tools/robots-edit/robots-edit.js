import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { adminFetch, paths } from '../../utils/admin/admin-client.js';

const adminForm = document.getElementById('admin-form');
const bodyForm = document.getElementById('body-form');
const body = document.getElementById('body');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');

const logFn = (status, details) => logResponse(consoleBlock, status, details);

async function init() {
  await initConfigField();

  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const resp = await adminFetch(paths.robots(org.value, site.value), {
      method: 'POST',
      body: body.value,
      headers: { 'content-type': 'text/plain' },
    }, { logFn });

    await resp.text();
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const resp = await adminFetch(paths.robots(org.value, site.value), {}, { logFn });
    const text = await resp.text();
    body.value = text;
  });
}

registerToolReady(init());
