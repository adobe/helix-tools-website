import { registerToolReady } from '../../scripts/scripts.js';
import {
  fetchSnapshots,
  saveManifest,
  setOrgSite,
} from './utils.js';

// DOM Elements
const sitePathForm = document.getElementById('site-path-form');
const orgInput = document.getElementById('org');
const siteInput = document.getElementById('site');
const snapshotsContainer = document.getElementById('snapshots-container');
const snapshotsList = document.getElementById('snapshots-list');
const createSnapshotForm = document.getElementById('create-snapshot-form');
const newSnapshotNameInput = document.getElementById('new-snapshot-name');
const logTable = document.querySelector('table tbody');

// Modal Elements
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalClose = document.querySelector('.modal-close');
const modalOk = document.querySelector('.modal-ok');
const modalOverlay = document.querySelector('.modal-overlay');

let currentOrg = '';
let currentSite = '';
let snapshots = [];

/**
 * Shows a modal dialog
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {boolean} isConfirm - Whether this is a confirmation dialog
 * @returns {Promise<boolean>} - Promise that resolves to true if confirmed, false if cancelled
 */
function showModal(title, message, isConfirm = false) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modal.removeAttribute('aria-hidden');

    // Update button text for confirmation dialogs
    if (isConfirm) {
      modalOk.textContent = 'OK';
      // Add Cancel button for confirmations
      if (!document.querySelector('.modal-cancel')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'button outline modal-cancel';
        cancelBtn.textContent = 'Cancel';
        modalOk.parentNode.insertBefore(cancelBtn, modalOk);
      }
    } else {
      modalOk.textContent = 'OK';
      // Remove Cancel button for regular dialogs
      const cancelBtn = document.querySelector('.modal-cancel');
      if (cancelBtn) {
        cancelBtn.remove();
      }
    }

    const closeModal = (confirmed = false) => {
      modal.setAttribute('aria-hidden', 'true');
      modalClose.removeEventListener('click', closeModal);
      modalOk.removeEventListener('click', closeModal);
      modalOverlay.removeEventListener('click', closeModal);
      const cancelBtn = document.querySelector('.modal-cancel');
      if (cancelBtn) {
        cancelBtn.removeEventListener('click', closeModal);
      }
      resolve(confirmed);
    };

    const handleOk = () => closeModal(true);
    const handleCancel = () => closeModal(false);

    modalClose.addEventListener('click', handleCancel);
    modalOk.addEventListener('click', handleOk);
    modalOverlay.addEventListener('click', handleCancel);

    const cancelBtn = document.querySelector('.modal-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }

    // Focus the OK button for accessibility
    modalOk.focus();
  });
}

/**
 * Logs the response information to the log table.
 * @param {Array} cols - Array containing response information.
 */
function logResponse(cols) {
  const hidden = logTable.closest('[aria-hidden]');
  if (hidden) hidden.removeAttribute('aria-hidden');
  const row = document.createElement('tr');
  // get the current time in hh:mm:ss format
  const now = new Date();
  const pad = (num) => num.toString().padStart(2, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  // add each column (including time) to the row
  [...cols, time].forEach((col, i) => {
    const cell = document.createElement('td');
    if (!i) { // decorate status code
      const code = `<span class="status-light http${Math.floor(col / 100) % 10}">${col}</span>`;
      cell.innerHTML = code;
    } else cell.textContent = col;
    row.append(cell);
  });
  logTable.prepend(row);
}

/**
 * Create snapshot card HTML
 */
function createSnapshotCard(snapshot) {
  const { name } = snapshot;
  return `
    <div class="snapshot-card" data-snapshot="${name}">
      <div class="snapshot-header">
        <h3>${name}</h3>
        <div class="snapshot-actions">
          <a href="snapshot-details.html?snapshot=https://main--${currentSite}--${currentOrg}.aem.page/.snapshots/${name}/.manifest.json" class="button small edit-snapshot">Edit</a>
          <button class="button small danger delete-snapshot" data-action="delete" data-snapshot="${name}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Parse snapshot URL to extract org, site, and snapshot name
 * @param {string} snapshotUrl - URL like https://main--demo--org.aem.page/.snapshots/name/.manifest.json
 * @returns {Object|null} - {org, site, snapshotName} or null if invalid
 */
function parseSnapshotUrl(snapshotUrl) {
  try {
    const { hostname, pathname } = new URL(snapshotUrl);

    // Parse hostname pattern: main--{site}--{org}.aem.page
    const hostParts = hostname.split('--');
    if (hostParts.length !== 3 || !hostname.endsWith('.aem.page')) {
      return null;
    }

    const [, site, orgWithDomain] = hostParts;
    const org = orgWithDomain.replace('.aem.page', '');

    // Parse path pattern: /.snapshots/{snapshotName}/.manifest.json
    const pathMatch = pathname.match(/^\/\.snapshots\/([^/]+)\/\.manifest\.json$/);
    if (!pathMatch) {
      return null;
    }

    const snapshotName = pathMatch[1];

    return { org, site, snapshotName };
  } catch (error) {
    return null;
  }
}

/**
 * Display snapshots in the UI
 */
function displaySnapshots() {
  if (snapshots.length === 0) {
    snapshotsList.innerHTML = '<p>No snapshots found for this site.</p>';
    return;
  }

  // Check if we have a snapshot parameter to filter by
  const params = new URLSearchParams(window.location.search);
  const snapshotParam = params.get('snapshot');

  let snapshotsToDisplay = snapshots;

  if (snapshotParam) {
    // Parse the snapshot URL to get the snapshot name
    const parsed = parseSnapshotUrl(snapshotParam);
    if (parsed) {
      const { snapshotName } = parsed;
      // Filter to show only the specified snapshot
      snapshotsToDisplay = snapshots.filter((snapshot) => snapshot.name === snapshotName);

      if (snapshotsToDisplay.length === 0) {
        snapshotsList.innerHTML = `<p>Snapshot "${snapshotName}" not found for this site.</p>`;
        return;
      }
    }
  }

  snapshotsList.innerHTML = snapshotsToDisplay.map(createSnapshotCard).join('');
}

/**
 * Load snapshots for the current org/site
 */
async function loadSnapshots() {
  try {
    const result = await fetchSnapshots();

    if (result.error) {
      logResponse([result.status, 'GET', 'snapshots', result.error]);
      await showModal('Error', `Error loading snapshots: ${result.error}`);
      return;
    }

    snapshots = result.snapshots || [];
    displaySnapshots();
    snapshotsContainer.setAttribute('aria-hidden', 'false');
    logResponse([result.status, 'GET', 'snapshots', `${snapshots.length} snapshots loaded`]);
  } catch (error) {
    logResponse([500, 'GET', 'snapshots', error.message]);
  }
}

/**
 * Create a new snapshot
 */
async function createSnapshot(snapshotName) {
  try {
    const manifest = {
      title: snapshotName,
      description: '',
      resources: [],
    };

    const result = await saveManifest(snapshotName, manifest);

    if (result.error) {
      logResponse([result.status, 'POST', `snapshot/${snapshotName}`, result.error]);
      await showModal('Error', `Error creating snapshot: ${result.error}`);
      return;
    }

    logResponse([result.status, 'POST', `snapshot/${snapshotName}`, 'Created successfully']);

    // Reload snapshots list
    await loadSnapshots();

    // Clear form
    newSnapshotNameInput.value = '';
  } catch (error) {
    logResponse([500, 'POST', `snapshot/${snapshotName}`, error.message]);
    await showModal('Error', `Error creating snapshot: ${error.message}`);
  }
}

/**
 * Handle org input changes to enable/disable site field
 */
orgInput.addEventListener('input', () => {
  siteInput.disabled = !orgInput.value.trim();
});

/**
 * Handle org and site input changes to update currentOrg and currentSite
 */
siteInput.addEventListener('change', async () => {
  if (orgInput.value.trim() && siteInput.value.trim()) {
    currentOrg = orgInput.value.trim();
    currentSite = siteInput.value.trim();
    setOrgSite(currentOrg, currentSite);
  }
});

/**
 * Handle when config fields are populated programmatically (e.g., from sidekick)
 */
siteInput.addEventListener('input', async () => {
  if (orgInput.value && siteInput.value && !currentOrg && !currentSite) {
    currentOrg = orgInput.value.trim();
    currentSite = siteInput.value.trim();
    siteInput.disabled = false;
    setOrgSite(currentOrg, currentSite);
    await loadSnapshots();
  }
});

/**
 * Handle site path form submission
 */
sitePathForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const org = orgInput.value.trim();
    const site = siteInput.value.trim();

    if (!org || !site) {
      await showModal('Missing Information', 'Please enter both organization and site');
      return;
    }

    currentOrg = org;
    currentSite = site;

    const sitePath = `${org}/${site}`;
    localStorage.setItem('snapshot-admin-site-path', sitePath);

    await loadSnapshots();

    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('org', org);
    url.searchParams.set('site', site);
    // eslint-disable-next-line no-restricted-globals
    window.history.pushState({}, '', url);
  } catch (error) {
    await showModal('Error', `Error loading snapshots: ${error.message}`);
  }
});

/**
 * Handle create snapshot form submission
 */
createSnapshotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const snapshotName = newSnapshotNameInput.value.trim();

  if (!snapshotName) {
    await showModal('Missing Information', 'Please enter a snapshot name');
    return;
  }

  await createSnapshot(snapshotName);
});

async function init() {
  // Initialize from URL parameters or localStorage
  const params = new URLSearchParams(window.location.search);
  const snapshotParam = params.get('snapshot');
  const orgParam = params.get('org');
  const siteParam = params.get('site');

  // Check if we have a snapshot URL parameter and send to snapshot-details.html
  if (snapshotParam) {
    window.location.href = `snapshot-details.html?snapshot=${snapshotParam}`;
  } else if (orgParam && siteParam) {
    // Use org and site parameters
    orgInput.value = orgParam;
    siteInput.value = siteParam;
    currentOrg = orgParam;
    currentSite = siteParam;
    // Enable the site field since we have both org and site values
    siteInput.disabled = false;
    setOrgSite(currentOrg, currentSite);
    await loadSnapshots();
  } else {
    // No snapshot parameter, initialize config fields normally
    try {
      const { initConfigField } = await import('../../utils/config/config.js');
      await initConfigField();
      siteInput.disabled = false;

      // Check if config fields have values and set them up
      if (orgInput.value && siteInput.value) {
        currentOrg = orgInput.value;
        currentSite = siteInput.value;
        setOrgSite(currentOrg, currentSite);
        await loadSnapshots();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize config fields:', error);
      // Continue loading the page even if config initialization fails
    }
  }
}

registerToolReady(init());
