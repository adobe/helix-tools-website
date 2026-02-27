import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { messageSidekick, NO_SIDEKICK } from '../../utils/sidekick.js';

const SCHEDULER_BASE = 'https://helix-snapshot-scheduler-prod.adobeaem.workers.dev';
const ADMIN_API_BASE = 'https://admin.hlx.page';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Gets an auth token from the Sidekick for the given org/site.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<string|null>} Token string or null if unavailable.
 */
async function getAuthToken(org, site) {
  const resp = await messageSidekick({ action: 'getAuthToken', org, site });
  if (resp === NO_SIDEKICK || !resp || !resp.token) return null;
  return resp.token;
}

/**
 * Gets the current user's identity from the Sidekick.
 * @returns {Promise<string|null>}
 */
async function getUserId() {
  const resp = await messageSidekick({ action: 'getAuthInfo' });
  if (resp === NO_SIDEKICK || !resp) return null;
  return resp.email || resp.userId || null;
}

/**
 * Formats an ISO date string as a human-readable relative time phrase.
 * @param {string} isoDate
 * @returns {string}
 */
function formatRelativeTime(isoDate) {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const absMs = Math.abs(diffMs);

  const minutes = Math.round(absMs / 60000);
  const hours = Math.round(absMs / 3600000);
  const days = Math.round(absMs / 86400000);

  let amount;
  if (minutes < 60) {
    amount = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (hours < 24) {
    amount = `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    amount = `${days} day${days !== 1 ? 's' : ''}`;
  }

  return diffMs > 0 ? `publishes in ${amount}` : `published ${amount} ago`;
}

/**
 * Builds a URL for a scheduled item.
 * @param {string} org
 * @param {string} site
 * @param {string} id - Page path or snapshot name.
 * @param {string} type - 'page' or 'snapshot'.
 * @returns {string}
 */
function buildItemLink(org, site, id, type) {
  if (type === 'page') {
    return `https://main--${site}--${org}.aem.live${id}`;
  }
  // snapshot: link to snapshot-details
  const manifestUrl = `https://main--${site}--${org}.aem.page/.snapshots/${id}/.manifest.json`;
  return `/tools/snapshot-admin/snapshot-details.html?snapshot=${encodeURIComponent(manifestUrl)}`;
}

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Creates an API key for the given org/site with the publish role.
 * @param {string} org
 * @param {string} site
 * @param {HTMLElement} consoleBlock
 * @returns {Promise<{id: string, value: string}|null>}
 */
async function createApiKey(org, site, consoleBlock) {
  const url = `${ADMIN_API_BASE}/config/${org}/sites/${site}/apiKeys.json`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Scheduler registration', roles: ['publish'] }),
  });
  logResponse(consoleBlock, resp.status, ['POST', url, resp.headers.get('x-error') || '']);
  if (!resp.ok) return null;
  return resp.json();
}

/**
 * Registers the site with the snapshot scheduler.
 * @param {string} org
 * @param {string} site
 * @param {string} apiKey - The API key value from createApiKey.
 * @param {HTMLElement} consoleBlock
 * @returns {Promise<boolean>}
 */
async function registerSite(org, site, apiKey, consoleBlock) {
  const url = `${SCHEDULER_BASE}/register`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ org, site, apiKey }),
  });
  logResponse(consoleBlock, resp.status, ['POST', url, resp.headers.get('x-error') || '']);
  return resp.ok;
}

/**
 * Fetches the schedule for an org/site.
 * @param {string} org
 * @param {string} site
 * @param {string} authToken
 * @param {HTMLElement} consoleBlock
 * @returns {Promise<Object|null>}
 */
async function fetchSchedule(org, site, authToken, consoleBlock) {
  const url = `${SCHEDULER_BASE}/schedule/${org}/${site}`;
  const resp = await fetch(url, {
    headers: { Authorization: authToken },
  });
  logResponse(consoleBlock, resp.status, ['GET', url, resp.headers.get('x-error') || '']);
  if (!resp.ok) return null;
  return resp.json();
}

/**
 * Reschedules a page.
 * @param {string} org
 * @param {string} site
 * @param {string} path
 * @param {string} scheduledPublish - ISO datetime string
 * @param {string} userId
 * @param {string} authToken
 * @param {HTMLElement} consoleBlock
 * @returns {Promise<boolean>}
 */
async function reschedulePage(org, site, path, scheduledPublish, userId, authToken, consoleBlock) {
  const url = `${SCHEDULER_BASE}/schedule/page`;
  const body = {
    org, site, path, scheduledPublish, userId,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  logResponse(consoleBlock, resp.status, ['POST', url, resp.headers.get('x-error') || '']);
  return resp.ok;
}

/**
 * Re-adds a snapshot to the schedule.
 * @param {string} org
 * @param {string} site
 * @param {string} snapshotId
 * @param {string} authToken
 * @param {HTMLElement} consoleBlock
 * @returns {Promise<boolean>}
 */
async function readmitSnapshot(org, site, snapshotId, authToken, consoleBlock) {
  const url = `${SCHEDULER_BASE}/schedule`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      org, site, snapshotId, approved: false,
    }),
  });
  logResponse(consoleBlock, resp.status, ['POST', url, resp.headers.get('x-error') || '']);
  return resp.ok;
}

// ─── Register page ────────────────────────────────────────────────────────────

/**
 * Checks whether the org/site is already registered with the scheduler.
 * @param {string} org
 * @param {string} site
 * @param {HTMLElement} consoleBlock
 * @returns {Promise<boolean>} true if already registered.
 */
async function checkRegistration(org, site, consoleBlock) {
  const url = `${SCHEDULER_BASE}/register/${org}/${site}`;
  const resp = await fetch(url);
  logResponse(consoleBlock, resp.status, ['GET', url, resp.headers.get('x-error') || '']);
  return resp.ok;
}

async function initRegisterPage() {
  const registerForm = document.getElementById('register-form');
  if (!registerForm) return;

  const orgInput = document.getElementById('org');
  const siteInput = document.getElementById('site');
  const consoleBlock = document.querySelector('.console');
  const resultSection = document.getElementById('register-result');
  const resultMessage = document.getElementById('register-result-message');
  const apiKeyDisplay = document.getElementById('api-key-display');
  const copyBtn = document.getElementById('copy-api-key');

  await initConfigField();

  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(apiKeyDisplay.textContent).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const org = orgInput.value.trim();
    const site = siteInput.value.trim();
    if (!org || !site) return;

    const loggedIn = await ensureLogin(org, site);
    if (!loggedIn) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (loginInfo.includes(org)) {
          registerForm.querySelector('button[type="submit"]').click();
        }
      }, { once: true });
      return;
    }

    updateConfig();

    const submitBtn = registerForm.querySelector('button[type="submit"]');
    const apiKeyBox = apiKeyDisplay.closest('.api-key-box');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking…';
    resultSection.hidden = true;
    resultSection.className = '';
    apiKeyBox.hidden = true;

    const alreadyRegistered = await checkRegistration(org, site, consoleBlock);
    if (alreadyRegistered) {
      resultSection.hidden = false;
      resultSection.className = 'info';
      resultMessage.textContent = `${org}/${site} is already registered with the scheduler.`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
      // eslint-disable-next-line no-alert
      const proceed = window.confirm(
        `${org}/${site} is already registered with the scheduler.\n\nRegister again? This will create a new API key and the previous one will no longer be used for scheduling.`,
      );
      if (!proceed) return;
      submitBtn.disabled = true;
    }

    submitBtn.textContent = 'Registering…';
    resultSection.hidden = true;
    resultSection.className = '';

    const keyData = await createApiKey(org, site, consoleBlock);
    if (!keyData || !keyData.value) {
      resultSection.hidden = false;
      resultSection.className = 'error';
      resultMessage.textContent = 'Failed to create API key. Check console for details.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
      return;
    }

    const registered = await registerSite(org, site, keyData.value, consoleBlock);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Register';

    resultSection.hidden = false;
    if (registered) {
      resultSection.className = 'success';
      resultMessage.textContent = `${org}/${site} has been registered with the scheduler. Save the API key below — it will not be shown again.`;
      apiKeyDisplay.textContent = keyData.value;
      apiKeyDisplay.closest('.api-key-box').hidden = false;
    } else {
      resultSection.className = 'error';
      resultMessage.textContent = 'API key created but registration with scheduler failed. Check console for details.';
      apiKeyDisplay.textContent = keyData.value;
      apiKeyDisplay.closest('.api-key-box').hidden = false;
    }
  });
}

// ─── Index page ───────────────────────────────────────────────────────────────

/**
 * Builds a single row for the schedule results table.
 * @param {string} org
 * @param {string} site
 * @param {string} id - Page path or snapshot name.
 * @param {Object} item - Schedule item data.
 * @param {string} authToken
 * @param {HTMLElement} consoleBlock
 * @returns {HTMLElement}
 */
function buildScheduleRow(org, site, id, item, authToken, consoleBlock) {
  const { type, scheduledPublish, approved } = item;
  const url = buildItemLink(org, site, id, type);
  const absDate = new Date(scheduledPublish).toLocaleString();
  const relDate = formatRelativeTime(scheduledPublish);

  const row = document.createElement('div');
  row.className = 'schedule-row';
  row.dataset.id = id;
  row.dataset.type = type;
  row.dataset.scheduled = scheduledPublish;

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'schedule-item-link';
  link.textContent = id;

  const typeBadge = document.createElement('span');
  typeBadge.className = `badge badge-${type}`;
  typeBadge.textContent = type;

  const dateInfo = document.createElement('span');
  dateInfo.className = 'schedule-date';
  dateInfo.title = absDate;
  dateInfo.textContent = `${absDate} (${relDate})`;

  const actions = document.createElement('div');
  actions.className = 'schedule-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'button outline small';
  editBtn.textContent = 'Edit';

  const editArea = document.createElement('div');
  editArea.className = 'edit-area';
  editArea.hidden = true;

  if (type === 'page') {
    const dtInput = document.createElement('input');
    dtInput.type = 'datetime-local';
    dtInput.className = 'reschedule-input';
    // Pre-fill with current scheduled time (local timezone)
    const localDt = new Date(scheduledPublish);
    const pad = (n) => n.toString().padStart(2, '0');
    dtInput.value = `${localDt.getFullYear()}-${pad(localDt.getMonth() + 1)}-${pad(localDt.getDate())}T${pad(localDt.getHours())}:${pad(localDt.getMinutes())}`;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'button small';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'button outline small';
    cancelBtn.textContent = 'Cancel';

    saveBtn.addEventListener('click', async () => {
      if (!dtInput.value) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const isoDate = new Date(dtInput.value).toISOString();
      const userId = await getUserId();
      // eslint-disable-next-line max-len
      const ok = await reschedulePage(org, site, id, isoDate, userId, authToken, consoleBlock);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if (ok) {
        dateInfo.textContent = `${new Date(isoDate).toLocaleString()} (${formatRelativeTime(isoDate)})`;
        row.dataset.scheduled = isoDate;
        editArea.hidden = true;
        editBtn.hidden = false;
      }
    });

    cancelBtn.addEventListener('click', () => {
      editArea.hidden = true;
      editBtn.hidden = false;
    });

    editArea.append(dtInput, saveBtn, cancelBtn);
  } else {
    // snapshot
    const readmitBtn = document.createElement('button');
    readmitBtn.className = 'button small';
    readmitBtn.textContent = 'Re-add to Schedule';

    readmitBtn.addEventListener('click', async () => {
      readmitBtn.disabled = true;
      readmitBtn.textContent = 'Adding…';
      const ok = await readmitSnapshot(org, site, id, authToken, consoleBlock);
      readmitBtn.disabled = false;
      readmitBtn.textContent = ok ? 'Re-added' : 'Re-add to Schedule';
      if (ok) {
        editArea.hidden = true;
        editBtn.hidden = false;
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'button outline small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      editArea.hidden = true;
      editBtn.hidden = false;
    });

    editArea.append(readmitBtn, cancelBtn);
  }

  editBtn.addEventListener('click', () => {
    editArea.hidden = false;
    editBtn.hidden = true;
  });

  actions.append(editBtn, editArea);

  const meta = document.createElement('div');
  meta.className = 'schedule-meta';

  meta.append(link, typeBadge);
  if (type === 'snapshot' && approved !== undefined) {
    const approvedBadge = document.createElement('span');
    approvedBadge.className = `badge badge-${approved ? 'approved' : 'pending'}`;
    approvedBadge.textContent = approved ? 'approved' : 'pending';
    meta.append(approvedBadge);
  }

  row.append(meta, dateInfo, actions);
  return row;
}

async function initIndexPage() {
  const adminForm = document.getElementById('admin-form');
  if (!adminForm) return;

  const orgInput = document.getElementById('org');
  const siteInput = document.getElementById('site');
  const consoleBlock = document.querySelector('.console');
  const scheduleResults = document.getElementById('schedule-results');
  const resultsTitle = document.getElementById('results-title');
  const emptyMessage = document.getElementById('empty-message');
  const noTokenMessage = document.getElementById('no-token-message');

  await initConfigField();

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const org = orgInput.value.trim();
    const site = siteInput.value.trim();
    if (!org || !site) return;

    updateConfig();

    const fetchBtn = adminForm.querySelector('button[type="submit"]');
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Loading…';
    scheduleResults.hidden = true;
    noTokenMessage.hidden = true;
    emptyMessage.hidden = true;
    if (resultsTitle) resultsTitle.textContent = '';

    const authToken = await getAuthToken(org, site);
    if (!authToken) {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch Schedule';
      noTokenMessage.hidden = false;
      return;
    }

    const data = await fetchSchedule(org, site, authToken, consoleBlock);
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch Schedule';

    if (!data) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'Failed to fetch schedule. Check console for details.';
      return;
    }

    // data shape: { "org--site": { "<id>": { type, scheduledPublish, ... } } }
    const key = `${org}--${site}`;
    const items = data[key] || {};
    const entries = Object.entries(items);

    if (resultsTitle) resultsTitle.textContent = `${org}/${site} — ${entries.length} item${entries.length !== 1 ? 's' : ''}`;

    const container = scheduleResults.querySelector('.schedule-list');
    container.innerHTML = '';

    if (entries.length === 0) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'No scheduled items found for this org/site.';
      scheduleResults.hidden = false;
      return;
    }

    // Sort by scheduledPublish ascending (soonest first)
    entries.sort((a, b) => new Date(a[1].scheduledPublish) - new Date(b[1].scheduledPublish));

    entries.forEach(([id, item]) => {
      const row = buildScheduleRow(org, site, id, item, authToken, consoleBlock);
      container.append(row);
    });

    scheduleResults.hidden = false;
  });

  // Auto-submit if URL params present
  const params = new URLSearchParams(window.location.search);
  if (params.get('org') && params.get('site')) {
    adminForm.dispatchEvent(new Event('submit'));
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function init() {
  if (document.getElementById('register-form')) {
    await initRegisterPage();
  } else {
    await initIndexPage();
  }
}

registerToolReady(init());
