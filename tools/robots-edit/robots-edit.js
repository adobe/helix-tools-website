import { registerToolReady } from '../../scripts/scripts.js';
import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
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

    const result = await executeAdminRequest(
      () => admin.config({ org: org.value, site: site.value }).robots(body.value),
      { org: org.value, site: site.value },
    );
    if (!result) return; // 401 followed by cancelled login
    logResult(result);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    // Preflight on Fetch (the natural entry point: fetch → edit → save).
    // Once the fetch succeeds, the user has an active session for any later save.
    const result = await executeAdminRequest(
      () => admin.config({ org: org.value, site: site.value }).robots(),
      { org: org.value, site: site.value, auth: AuthMode.PREFLIGHT_AND_RETRY },
    );
    if (!result) return; // user cancelled login or timed out
    if (result.ok) body.value = await result.text();
    logResult(result);
  });
}

registerToolReady(init());
