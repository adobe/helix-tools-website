import { registerToolReady } from '../../scripts/scripts.js';
import admin from '../../scripts/helix-admin.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const bodyForm = document.getElementById('body-form');
const body = document.getElementById('body');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');

function logResult(result) {
  const { method, url } = result.request;
  logResponse(consoleBlock, result.status, [method, url, result.error]);
}

async function init() {
  await initConfigField();

  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    const result = await admin.config({ org: org.value, site: site.value }).robots(body.value);
    logResult(result);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    // Login is checked here (the natural entry point: fetch → edit → save).
    // Once the fetch succeeds, the user has an active session for any later save.
    if (!await ensureLogin(org.value, site.value)) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (Array.isArray(loginInfo) && loginInfo.includes(org.value)) {
          e.target.querySelector('button[type="submit"]').click();
        }
      }, { once: true });
      return;
    }

    const result = await admin.config({ org: org.value, site: site.value }).robots();
    if (result.ok) body.value = await result.text();
    logResult(result);
  });
}

registerToolReady(init());
