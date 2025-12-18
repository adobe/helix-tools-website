import { ensureLogin } from '../../blocks/profile/profile.js';
import { messageSidekick, NO_SIDEKICK } from '../../utils/sidekick.js';

const AEM_ADMIN_ORIGIN = 'https://admin.hlx.page';
const SCHEDULER_ORIGIN = 'https://helix-snapshot-scheduler-prod.adobeaem.workers.dev';

/**
 * Gets the ID token from the sidekick for the given org
 * @param {string} org - Organization name
 * @returns {Promise<string|null>} - The ID token or null if not available
 */
async function getIdToken(org) {
  const token = await messageSidekick({ action: 'getIdToken', org }, null, 1000);
  if (token === NO_SIDEKICK || !token) {
    return null;
  }
  return token;
}

// DOM Elements
const registerForm = document.getElementById('register-form');
const orgInput = document.getElementById('org');
const siteInput = document.getElementById('site');
const registerBtn = document.getElementById('register-btn');
const statusContainer = document.getElementById('status-container');
const statusMessage = document.getElementById('status-message');
const logTable = document.querySelector('table tbody');

// Modal Elements
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalClose = document.querySelector('.modal-close');
const modalOk = document.querySelector('.modal-ok');
const modalOverlay = document.querySelector('.modal-overlay');

/**
 * Shows a modal dialog
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @returns {Promise<boolean>} - Promise that resolves when dialog is closed
 */
function showModal(title, message) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modal.removeAttribute('aria-hidden');

    const closeModal = () => {
      modal.setAttribute('aria-hidden', 'true');
      modalClose.removeEventListener('click', closeModal);
      modalOk.removeEventListener('click', closeModal);
      modalOverlay.removeEventListener('click', closeModal);
      resolve(true);
    };

    modalClose.addEventListener('click', closeModal);
    modalOk.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);

    modalOk.focus();
  });
}

/**
 * Logs the response information to the log table.
 * @param {Array} cols - Array containing response information [status, method, endpoint, message].
 */
function logResponse(cols) {
  const hidden = logTable.closest('[aria-hidden]');
  if (hidden) hidden.removeAttribute('aria-hidden');
  const row = document.createElement('tr');
  const now = new Date();
  const pad = (num) => num.toString().padStart(2, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  [...cols, time].forEach((col, i) => {
    const cell = document.createElement('td');
    if (!i) {
      const code = `<span class="status-light http${Math.floor(col / 100) % 10}">${col}</span>`;
      cell.innerHTML = code;
    } else {
      cell.textContent = col;
    }
    row.append(cell);
  });
  logTable.prepend(row);
}

/**
 * Displays a status message
 * @param {string} message - The message to display (can contain HTML)
 * @param {string} type - Message type: 'success', 'error', or 'info'
 */
function showStatus(message, type) {
  statusContainer.removeAttribute('aria-hidden');
  statusMessage.innerHTML = message;
  statusMessage.className = `status-${type}`;
}

/**
 * Hides the status message
 */
function hideStatus() {
  statusContainer.setAttribute('aria-hidden', 'true');
  statusMessage.innerHTML = '';
  statusMessage.className = '';
}

/**
 * Checks if the site is already registered for the scheduler
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @returns {Promise<Object>} - Result with registered boolean and status
 */
async function checkRegistrationStatus(org, site) {
  try {
    const resp = await fetch(`${SCHEDULER_ORIGIN}/register/${org}/${site}`);
    const registered = resp.status === 200;
    logResponse([resp.status, 'GET', `register/${org}/${site}`, registered ? 'Already registered' : 'Not registered']);
    return { registered, status: resp.status };
  } catch (error) {
    logResponse([500, 'GET', `register/${org}/${site}`, error.message]);
    return { registered: false, status: 500, error: error.message };
  }
}

/**
 * Creates an API key with publish permissions for the scheduler
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @returns {Promise<Object>} - Result object with apiKey value or error
 */
async function createApiKey(org, site) {
  const url = `${AEM_ADMIN_ORIGIN}/config/${org}/sites/${site}/apiKeys.json`;
  const body = {
    description: 'Key used for Publishing Scheduled Snapshots',
    roles: ['publish'],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  logResponse([resp.status, 'POST', 'apiKeys', resp.ok ? 'API key created' : resp.headers.get('x-error') || 'Failed to create API key']);

  if (!resp.ok) {
    if (resp.status === 401) {
      return { error: 'Unauthorized. Please make sure you are logged in to the sidekick for the correct organization and site.' };
    }
    if (resp.status === 403) {
      return { error: 'Forbidden. Please make sure your user has the correct permissions to create API keys.' };
    }
    return { error: `Failed to create API key: ${resp.headers.get('x-error') || resp.status}` };
  }

  const data = await resp.json();
  return { apiKey: data.value };
}

/**
 * Registers the site with the snapshot scheduler service
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {string} apiKey - API key with publish permissions
 * @returns {Promise<Object>} - Result object with success or error
 */
async function registerWithScheduler(org, site, apiKey) {
  // Get the ID token for authorization
  const idToken = await getIdToken(org);
  if (!idToken) {
    return { error: 'Failed to get authorization token. Please make sure you are logged in.' };
  }

  const body = {
    org,
    site,
    apiKey,
  };

  try {
    const resp = await fetch(`${SCHEDULER_ORIGIN}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${idToken}`,
      },
      body: JSON.stringify(body),
    });

    logResponse([resp.status, 'POST', 'register', resp.ok ? 'Registration successful' : resp.headers.get('x-error') || 'Registration failed']);

    if (!resp.ok) {
      const errorText = resp.headers.get('x-error') || `Registration failed with status ${resp.status}`;
      return { error: errorText };
    }

    return { success: true };
  } catch (error) {
    logResponse([500, 'POST', 'register', error.message]);
    return { error: error.message };
  }
}

/**
 * Handles the registration form submission
 * @param {Event} e - Submit event
 */
async function handleRegister(e) {
  e.preventDefault();

  const org = orgInput.value.trim();
  const site = siteInput.value.trim();

  if (!org || !site) {
    await showModal('Missing Information', 'Please enter both organization and site');
    return;
  }

  // Check login
  if (!await ensureLogin(org, site)) {
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      if (loginInfo.includes(org)) {
        registerBtn.click();
      }
    }, { once: true });
    return;
  }

  // Disable form while processing
  registerBtn.disabled = true;
  registerBtn.textContent = 'Registering...';
  hideStatus();

  try {
    // Check if already registered
    const registrationStatus = await checkRegistrationStatus(org, site);
    
    // Short-circuit if the check failed
    if (registrationStatus.error) {
      showStatus(`Failed to check registration status: ${registrationStatus.error}`, 'error');
      await showModal('Error', `Failed to check registration status: ${registrationStatus.error}`);
      return;
    }
    
    if (registrationStatus.registered) {
      const snapshotAdminLink = `/tools/snapshot-admin/index.html?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
      showStatus(
        `This site is already registered for snapshot scheduling. <a href="${snapshotAdminLink}">View Snapshots</a>`,
        'info',
      );
      return;
    }

    // Step 1: Create API key
    const apiKeyResult = await createApiKey(org, site);
    if (apiKeyResult.error) {
      showStatus(apiKeyResult.error, 'error');
      await showModal('Error', apiKeyResult.error);
      return;
    }

    // Step 2: Register with scheduler
    const registerResult = await registerWithScheduler(org, site, apiKeyResult.apiKey);
    if (registerResult.error) {
      showStatus(registerResult.error, 'error');
      await showModal('Error', registerResult.error);
      return;
    }

    // Success
    const snapshotAdminLink = `/tools/snapshot-admin/index.html?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
    showStatus(
      `Successfully registered ${org}/${site} for snapshot scheduling! <a href="${snapshotAdminLink}">View Snapshots</a>`,
      'success',
    );
    await showModal('Success', `Successfully registered ${org}/${site} for snapshot scheduling!`);
  } catch (error) {
    logResponse([500, 'ERROR', 'register', error.message]);
    showStatus(`An error occurred: ${error.message}`, 'error');
    await showModal('Error', `An error occurred: ${error.message}`);
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = 'Register';
  }
}

/**
 * Handles form reset
 */
function handleReset() {
  hideStatus();
  siteInput.disabled = true;
}

/**
 * Handles org input changes to enable/disable site field
 */
orgInput.addEventListener('input', () => {
  siteInput.disabled = !orgInput.value.trim();
});

/**
 * Initialize the application
 */
async function init() {
  registerForm.addEventListener('submit', handleRegister);
  registerForm.addEventListener('reset', handleReset);

  // Initialize from URL parameters or config fields
  const params = new URLSearchParams(window.location.search);
  const orgParam = params.get('org');
  const siteParam = params.get('site');

  if (orgParam && siteParam) {
    orgInput.value = orgParam;
    siteInput.value = siteParam;
    siteInput.disabled = false;
  } else {
    // Try to initialize config fields from sidekick
    try {
      const { initConfigField } = await import('../../utils/config/config.js');
      await initConfigField();
      siteInput.disabled = !orgInput.value;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize config fields:', error);
    }
  }
}

const initPromise = init();

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}
