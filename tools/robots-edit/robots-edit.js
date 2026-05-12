import { registerToolReady } from '../../scripts/scripts.js';
import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import { getProjectFromUrl } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const bodyForm = document.getElementById('body-form');
const body = document.getElementById('body');
const consoleBlock = document.querySelector('.console');
const fetchBtn = document.getElementById('fetch');

function logResult(result) {
  const { method, url } = result.request;
  logResponse(consoleBlock, result.status, [method, url, result.error]);
}

function syncSubmitEnabled() {
  const { org, site } = getProjectFromUrl();
  const ready = !!(org && site);
  if (fetchBtn) fetchBtn.disabled = !ready;
}

async function init() {
  syncSubmitEnabled();
  window.addEventListener('tools:project-change', syncSubmitEnabled);

  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { org, site } = getProjectFromUrl();
    if (!org || !site) {
      // eslint-disable-next-line no-alert
      alert('Select an org/site in the header to continue.');
      return;
    }

    const result = await executeAdminRequest(
      () => admin.config({ org, site }).select('robots.txt').update(body.value),
      { org, site },
    );
    if (!result) return; // 401 followed by cancelled login
    logResult(result);
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { org, site } = getProjectFromUrl();
    if (!org || !site) {
      // eslint-disable-next-line no-alert
      alert('Select an org/site in the header to continue.');
      return;
    }

    // Preflight on Fetch (the natural entry point: fetch → edit → save).
    // Once the fetch succeeds, the user has an active session for any later save.
    const result = await executeAdminRequest(
      () => admin.config({ org, site }).select('robots.txt').read(),
      { org, site, policy: AuthMode.PREFLIGHT_AND_RETRY },
    );
    if (!result) return; // user cancelled login or timed out
    if (result.ok) body.value = await result.text();
    logResult(result);
  });
}

registerToolReady(init());
