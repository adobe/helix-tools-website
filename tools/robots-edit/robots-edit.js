import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { createAdminClient } from '../../utils/admin-fetch.js';

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

    const admin = createAdminClient({ org: org.value, site: site.value, logFn });
    await admin.site().robots().update(body.value);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const admin = createAdminClient({ org: org.value, site: site.value, logFn });
    const resp = await admin.site().robots().read();
    const text = await resp.text();
    body.value = text;
  });
}

registerToolReady(init());
