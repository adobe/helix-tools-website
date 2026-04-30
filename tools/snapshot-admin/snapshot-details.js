import { registerToolReady } from '../../scripts/scripts.js';
import {
  fetchManifest,
  saveManifest,
  setOrgSite,
  deleteSnapshotUrls,
  deleteSnapshot,
  reviewSnapshot,
  updatePaths,
  addPasswordFieldListeners,
} from './utils.js';
import { updateScheduledPublish, isRegisteredForSnapshotScheduler } from './snapshot-utils.js';

// DOM Elements
const snapshotDetailsContainer = document.getElementById('snapshot-details-container');
const snapshotDetails = document.getElementById('snapshot-details');
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
let currentSnapshot = '';
let currentManifest = null;

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
 * Create snapshot details HTML
 */
async function createSnapshotDetailsHTML(snapshot, manifest) {
  const getCustomReviewHost = async () => {
    try {
      const resp = await fetch(`https://admin.hlx.page/sidekick/${currentOrg}/${currentSite}/main/config.json`);
      const json = await resp.json();
      return json.reviewHost;
    } catch (error) {
      return null;
    }
  };

  const { name } = snapshot;
  const isLocked = !!manifest.locked;
  const lockStatus = isLocked ? 'Locked' : 'Unlocked';
  const lockDate = manifest.locked ? new Date(manifest.locked).toLocaleString() : '';
  const customReviewHost = await getCustomReviewHost();
  const reviewHost = customReviewHost || `${name}--main--${currentSite}--${currentOrg}.aem.reviews`;

  return `
    <div class="snapshot-card" data-snapshot="${name}">
      <div class="snapshot-header">
        <h3>${name}</h3>
        <div class="snapshot-status-badge ${isLocked ? 'locked' : 'unlocked'}">
          ${lockStatus}
          ${lockDate ? `<br><small>${lockDate}</small>` : ''}
        </div>
      </div>
      <div class="snapshot-details">
        <form class="snapshot-edit-form" id="form-${name}">
          <div class="form-field">
            <label for="title-${name}">Title</label>
            <input type="text" id="title-${name}" name="title" placeholder="Snapshot title" autocomplete="on" value="${manifest.title || ''}">
          </div>
          <div class="form-field">
            <label for="description-${name}">Description</label>
            <textarea id="description-${name}" name="description" placeholder="Snapshot description" autocomplete="on">${manifest.description || ''}</textarea>
          </div>
          <div class="form-field">
            <label for="password-${name}">Password (for reviews)</label>
            <input type="password" id="password-${name}" name="password" placeholder="Review password" autocomplete="current-password" value="${manifest.metadata?.reviewPassword || ''}" class="password-field">
          </div>
          <div class="form-field">
            <label for="urls-${name}">URLs (one per line)</label>
            <textarea id="urls-${name}" name="urls" rows="10" placeholder="Enter URLs, one per line" autocomplete="on">${manifest.resources ? manifest.resources.map((resource) => `https://main--${currentSite}--${currentOrg}.aem.page${resource.path}`).join('\n') : ''}</textarea>
          </div>
          <div class="snapshot-actions">
            <button type="button" class="button" data-action="save" data-snapshot="${name}">Save</button>
            <button type="button" class="button" data-action="lock" data-snapshot="${name}" ${isLocked ? 'disabled' : ''}>Lock</button>
            <button type="button" class="button" data-action="unlock" data-snapshot="${name}" ${!isLocked ? 'disabled' : ''}>Unlock</button>
          </div>
          <div class="review-actions">
            <h4>Review Actions</h4>
            <button type="button" class="button" data-action="request-review" data-snapshot="${name}" title="Locks the snapshot for review" ${isLocked ? 'disabled' : ''}>Request Review</button>
            <button type="button" class="button" data-action="approve-review" data-snapshot="${name}" title="Bulk publishes the snapshot" ${!isLocked ? 'disabled' : ''}>Approve Review</button>
            <button type="button" class="button" data-action="reject-review" data-snapshot="${name}" title="Unlocks the snapshot from review mode" ${!isLocked ? 'disabled' : ''}>Reject Review</button>
            <a class="button" href="https://${reviewHost}/" target="_blank">Open Review</a>
          </div>
          <div class="danger-actions">
            <h4>Danger Zone</h4>
            <button type="button" class="button danger" data-action="delete" data-snapshot="${name}">Delete Snapshot</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/**
 * Add scheduler field to the form if the org/site is registered for snapshot scheduler
 * @param {string} snapshotName - Name of the snapshot
 * @param {Object} manifest - The manifest object
 */
async function addSchedulerFieldIfRegistered(snapshotName, manifest) {
  // Check if org/site is registered for snapshot scheduler
  const canSchedulePublish = await isRegisteredForSnapshotScheduler(currentOrg, currentSite);

  if (!canSchedulePublish) {
    return;
  }

  // Convert UTC date to local datetime-local format
  const formatLocalDate = (utcDate) => {
    if (!utcDate) return '';
    const d = new Date(utcDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Create scheduler field HTML
  const schedulerFieldHTML = `
    <div class="form-field">
      <label for="scheduler-${snapshotName}">Schedule Publish (Local Time)</label>
      <input type="datetime-local" id="scheduler-${snapshotName}" name="scheduler" value="${formatLocalDate(manifest.metadata?.scheduledPublish)}">
    </div>`;

  // Find the password field and insert the scheduler field after it
  const passwordField = document.getElementById(`password-${snapshotName}`)?.closest('.form-field');

  if (passwordField) {
    // Create a temporary container to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = schedulerFieldHTML;
    const schedulerField = tempDiv.firstElementChild;

    // Insert after the password field
    passwordField.insertAdjacentElement('afterend', schedulerField);
  }
}

/**
 * Load snapshot details
 */
async function loadSnapshotDetails() {
  try {
    const result = await fetchManifest(currentSnapshot);

    if (result.error) {
      logResponse([result.status, 'GET', `snapshot/${currentSnapshot}`, result.error]);
      await showModal('Error', `Error loading snapshot details: ${result.error}`);
      return;
    }

    currentManifest = result.manifest;

    // Display the snapshot details
    snapshotDetails.innerHTML = await createSnapshotDetailsHTML(
      {
        name: currentSnapshot,
      },
      currentManifest,
    );

    // Add password field event listeners after rendering
    addPasswordFieldListeners();

    // Check and add scheduler field if registered
    await addSchedulerFieldIfRegistered(currentSnapshot, currentManifest);

    snapshotDetailsContainer.setAttribute('aria-hidden', 'false');

    logResponse([200, 'GET', `snapshot/${currentSnapshot}`, 'Details loaded']);
  } catch (error) {
    logResponse([500, 'GET', `snapshot/${currentSnapshot}`, error.message]);
    await showModal('Error', `Error loading snapshot details: ${error.message}`);
  }
}

/**
 * Save snapshot changes
 */
async function saveSnapshot(snapshotName) {
  try {
    const titleInput = document.getElementById(`title-${snapshotName}`);
    const descInput = document.getElementById(`description-${snapshotName}`);
    const passwordInput = document.getElementById(`password-${snapshotName}`);
    const schedulerInput = document.getElementById(`scheduler-${snapshotName}`);
    const urlsTextarea = document.getElementById(`urls-${snapshotName}`);
    const updatedPaths = urlsTextarea.value.split('\n').map((url) => ({ path: url.trim() }));

    const newManifest = {
      title: titleInput.value,
      description: descInput.value,
      metadata: {
        reviewPassword: passwordInput.value,
        ...(schedulerInput && schedulerInput.value && {
          scheduledPublish: new Date(schedulerInput.value).toISOString(),
        }),
      },
    };

    // Check if scheduled Publish date is at least 5 minutes from now before continuing
    if (schedulerInput && schedulerInput.value
        && new Date(schedulerInput.value) < new Date(Date.now() + 5 * 60 * 1000)) {
      await showModal('Error', 'Scheduled publish date must be at least 5 minutes from now');
      return;
    }

    // Save the manifest first
    const saveResult = await saveManifest(snapshotName, newManifest);

    if (saveResult.error) {
      logResponse([saveResult.status, 'POST', `snapshot/${snapshotName}`, saveResult.error]);
      await showModal('Error', `Error saving snapshot: ${saveResult.error}`);
      return;
    }
    logResponse([saveResult.status, 'POST', `snapshot/${snapshotName}`, 'Manifest saved successfully']);

    // Update paths if they've changed
    const currentPaths = currentManifest.resources.map((resource) => resource.path);
    const newPaths = updatedPaths.map((path) => path.path);
    const updateResult = await updatePaths(snapshotName, currentPaths, newPaths);
    if (updateResult.error) {
      logResponse([updateResult.status, 'POST', `snapshot/${snapshotName}`, updateResult.error]);
      await showModal('Error', `Error updating paths: ${updateResult.error}`);
      return;
    }
    logResponse([200, 'POST', `snapshot/${currentSnapshot}`, 'Paths updated successfully']);

    // Update scheduled publish date
    if (schedulerInput && schedulerInput.value) {
      const scheduleResult = await updateScheduledPublish(
        currentOrg,
        currentSite,
        snapshotName,
      );
      if (scheduleResult.status !== 200) {
        logResponse([scheduleResult.status, 'POST', `snapshot/${snapshotName}`, scheduleResult.text || '']);
        await showModal('Error', `Error updating scheduled publish: ${scheduleResult.text || 'Unknown error'}`);
        return;
      }
      logResponse([scheduleResult.status, 'POST', `snapshot/${snapshotName}`, 'Scheduled publish updated successfully']);
    }
    // Reload the snapshot details to reflect changes
    await loadSnapshotDetails();
    await showModal('Success', 'Snapshot saved successfully!');
  } catch (error) {
    logResponse([500, 'POST', `snapshot/${snapshotName}`, error.message]);
    await showModal('Error', `Error saving snapshot: ${error.message}`);
  }
}

/**
 * Delete a snapshot
 */
async function deleteSnapshotAction(snapshotName) {
  const confirmed = await showModal('Confirm Delete', `Are you sure you want to delete the snapshot "${snapshotName}"? This action cannot be undone.`, true);
  if (!confirmed) return;

  try {
    const result = await deleteSnapshotUrls(snapshotName);

    if (result.error) {
      logResponse([result.status, 'DELETE', `snapshot/${snapshotName}`, result.error]);
      await showModal('Error', `Error deleting snapshot: ${result.error}`);
      return;
    }

    logResponse([200, 'DELETE', `snapshot/${snapshotName}/*`, 'Snapshot URLs deleted successfully']);

    // Now delete the snapshot
    const deleteResult = await deleteSnapshot(snapshotName);
    if (deleteResult.error) {
      logResponse([deleteResult.status, 'DELETE', `snapshot/${snapshotName}`, deleteResult.error]);
      await showModal('Error', `Error deleting snapshot: ${deleteResult.error}`);
      return;
    }
    logResponse([deleteResult.status, 'DELETE', `snapshot/${snapshotName}`, 'Snapshot deleted successfully']);
    await showModal('Success', 'Snapshot deleted successfully!');
    // Redirect back to the main snapshot admin page
    window.location.href = 'index.html';
  } catch (error) {
    logResponse([500, 'DELETE', `snapshot/${snapshotName}`, error.message]);
    await showModal('Error', `Error deleting snapshot: ${error.message}`);
  }
}

/**
 * Handle review actions (lock, unlock, request-review, approve-review, reject-review)
 * @param {string} snapshotName - Name of the snapshot
 * @param {string} action - The action to perform
 */
async function handleReviewAction(snapshotName, action) {
  try {
    // Handle lock/unlock actions by updating the manifest
    if (action === 'lock' || action === 'unlock') {
      const isLocked = action === 'lock';
      // Update manifest with locked state
      const updatedManifest = {
        title: currentManifest.title,
        description: currentManifest.description,
        metadata: currentManifest.metadata,
        locked: isLocked,
      };

      const result = await saveManifest(snapshotName, updatedManifest);

      if (result.error) {
        logResponse([result.status, 'POST', `snapshot/${snapshotName}/manifest`, result.error]);
        await showModal('Error', `Error ${action}: ${result.error}`);
        return;
      }

      logResponse([result.status, 'POST', `snapshot/${snapshotName}/manifest`, `${action} successful`]);
      await showModal('Success', `${action} successful!`);
    } else {
      // Handle review state actions
      let reviewState;

      // Map actions to review states
      switch (action) {
        case 'request-review':
          reviewState = 'request';
          break;
        case 'approve-review':
          reviewState = 'approve';
          break;
        case 'reject-review':
          reviewState = 'reject';
          break;
        default:
          await showModal('Error', `Unknown action: ${action}`);
          return;
      }

      const result = await reviewSnapshot(snapshotName, reviewState);

      if (result.error) {
        logResponse([result.status, 'POST', `snapshot/${snapshotName}/review`, result.error]);
        await showModal('Error', `Error ${action}: ${result.error}`);
        return;
      }

      logResponse([result.status, 'POST', `snapshot/${snapshotName}/review`, `${action} successful`]);
      await showModal('Success', `${action} successful!`);
    }

    // Reload snapshot details to reflect the new state
    await loadSnapshotDetails();
  } catch (error) {
    logResponse([500, 'POST', `snapshot/${snapshotName}/manifest`, error.message]);
    await showModal('Error', `Error ${action}: ${error.message}`);
  }
}

// Event Listeners
/**
 * Handle clicks on snapshot actions using event delegation
 */
snapshotDetails.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const { action, snapshot: snapshotName } = target.dataset;

  switch (action) {
    case 'save':
      await saveSnapshot(snapshotName);
      break;

    case 'delete':
      await deleteSnapshotAction(snapshotName);
      break;

    case 'lock':
    case 'unlock':
    case 'request-review':
    case 'approve-review':
    case 'reject-review':
      await handleReviewAction(snapshotName, action);
      break;
    default:
      break;
  }
});

// Initialize the page
async function init() {
  // Get snapshot parameter from URL
  const params = new URLSearchParams(window.location.search);
  const snapshotParam = params.get('snapshot');

  if (!snapshotParam) {
    await showModal('Error', 'No snapshot specified. Please provide a snapshot URL parameter.');
    window.location.href = 'index.html';
    return;
  }

  // Parse the snapshot URL to get org, site, and snapshot name
  const parsed = parseSnapshotUrl(snapshotParam);
  if (!parsed) {
    await showModal('Error', 'Invalid snapshot URL format. Please check the URL and try again.');
    window.location.href = 'index.html';
    return;
  }

  const { org, site, snapshotName } = parsed;

  // Set the current org, site, and snapshot
  currentOrg = org;
  currentSite = site;
  currentSnapshot = snapshotName;

  // Set the org and site in the utils
  setOrgSite(currentOrg, currentSite);

  // Load the snapshot details
  await loadSnapshotDetails();
}

registerToolReady(init());
