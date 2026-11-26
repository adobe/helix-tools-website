import { registerToolReady } from '../../scripts/scripts.js';
import getAdminClient from '../../scripts/admin-compat.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import { initConfigField } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

let admin;

const adminForm = document.getElementById('admin-form');
const bodyForm = document.getElementById('body-form');
const body = document.getElementById('body');
const consoleBlock = document.querySelector('.console');
const site = document.getElementById('site');
const org = document.getElementById('org');
const fetchError = document.getElementById('fetch-error');
const saveError = document.getElementById('save-error');

function logResult(result) {
  const { method, url } = result.request;
  logResponse(consoleBlock, result.status, [method, url, result.error]);
}

/**
 * Shows the message in el; no message hides el.
 * @param {HTMLElement} el
 * @param {string} [message]
 */
function showError(el, message = '') {
  el.textContent = message;
  el.hidden = !message;
}

/**
 * @param {object|null} result admin response; null if the user didn't sign in
 * @param {string} verb 'view' or 'change'
 * @returns {string} the message for a failed robots.txt request
 */
function getErrorMessage(result, verb) {
  if (!result) return `Sign in to ${verb} this site's robots.txt.`;
  if (result.status === 401) return 'Your Adobe sign-in wasn\'t accepted. Sign out, then sign in with Adobe again.';
  if (result.status === 403) return `Your account isn't allowed to ${verb} this site's robots.txt. Ask a site admin for access.`;
  return `Couldn't ${verb} robots.txt: ${result.error || `HTTP ${result.status}`}`;
}

async function init() {
  admin = await getAdminClient();
  await initConfigField();

  bodyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!org.value || !site.value) {
      // eslint-disable-next-line no-alert
      alert('Please select an organization and site first');
      return;
    }

    showError(saveError);
    const result = await executeAdminRequest(
      () => admin.config({ org: org.value, site: site.value }).select('robots.txt').update(body.value),
      { org: org.value, site: site.value },
    );
    if (!result?.ok) showError(saveError, getErrorMessage(result, 'change'));
    if (!result) return;
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
    showError(fetchError);
    const result = await executeAdminRequest(
      () => admin.config({ org: org.value, site: site.value }).select('robots.txt').read(),
      { org: org.value, site: site.value, policy: AuthMode.PREFLIGHT_AND_RETRY },
    );
    // a 404 only means the site has no robots.txt of its own yet
    if (!result?.ok && result?.status !== 404) {
      showError(fetchError, getErrorMessage(result, 'view'));
    }
    if (!result) return;
    if (result.ok) body.value = await result.text();
    logResult(result);
  });
}

registerToolReady(init());
