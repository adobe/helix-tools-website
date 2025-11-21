import {
  fetchSnapshots,
  // fetchManifest,
  // saveManifest,
  setOrgSite,
  // updatePaths,
  // reviewSnapshot,
} from './utils.js';

const params = new URLSearchParams(window.location.search);
const referrer = new URL(params.get('referrer'));
const OWNER = params.get('owner');
const REPO = params.get('repo');
const CUSTOM_REVIEW_HOST = params.get('reviewHost');
const CUSTOM_LIVE_HOST = params.get('liveHost');
const PATHNAME = referrer.pathname;

// UI Elements
const SNAPSHOT_SELECT = document.getElementById('snapshot-select');
const ADD = document.getElementById('add-page');
const REMOVE = document.getElementById('remove-page');
const UPDATE = document.getElementById('update');
const PAGE_STATUS = document.getElementById('page-status');
const REVIEWS_LINK = document.getElementById('go-to-review');
const ADMIN_LINK = document.getElementById('go-to-admin');
const SPINNER = document.getElementById('spinner');
const REVIEW_STATUS_WRAPPER = document.getElementById('review-status-wrapper');
const REVIEW_STATUS = document.getElementById('review-status');
const REVIEW_REQUEST = document.getElementById('request');
const REVIEW_REJECT = document.getElementById('reject');
const REVIEW_APPROVE = document.getElementById('approve');
const PAGE_STATUS_WRAPPER = document.getElementById('page-status-wrapper');

let currentSnapshot = null;
let availableSnapshots = [];

// Utility functions for snapshot operations
async function addToSnapshot(owner, repo, snapshot, paths) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const url = `${adminURL}/*`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      paths,
    }),
  });
  return resp;
}

async function deleteFromSnapshot(owner, repo, snapshot, path) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const url = `${adminURL}${path}`;
  const resp = await fetch(url, { method: 'DELETE' });
  return resp;
}

async function fetchSnapshotManifest(owner, repo, snapshot) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const resp = await fetch(adminURL);
  if (resp.status === 200) {
    const { manifest } = await resp.json();
    return manifest;
  }
  return null;
}

async function fetchStatus(owner, repo, snapshot, path) {
  const status = {};
  const adminSnapshotURL = `https://admin.hlx.page/status/${owner}/${repo}/main/.snapshots/${snapshot}${path}`;
  const respSnapshot = await fetch(adminSnapshotURL);
  if (respSnapshot.status === 200) {
    status.snapshot = await respSnapshot.json();
  }
  const adminPageURL = `https://admin.hlx.page/status/${owner}/${repo}/main${path}`;
  const resp = await fetch(adminPageURL);
  if (resp.status === 200) {
    status.preview = await resp.json();
  }
  return status;
}

async function updateReviewStatus(owner, repo, snapshot, status) {
  const adminURL = `https://admin.hlx.page/snapshot/${owner}/${repo}/main/${snapshot}`;
  const resp = await fetch(`${adminURL}?review=${status}`, {
    method: 'POST',
  });
  return resp;
}

function resetUI() {
  PAGE_STATUS.textContent = 'Select a snapshot to view status...';
  REVIEW_STATUS.textContent = 'Select a snapshot to view review status...';

  ADD.disabled = true;
  REMOVE.disabled = true;
  UPDATE.disabled = true;
  REVIEW_REQUEST.disabled = true;
  REVIEW_REJECT.disabled = true;
  REVIEW_APPROVE.disabled = true;

  document.getElementById('page-list').innerHTML = '';
}

async function updateSnapshotUI() {
  if (!currentSnapshot) return;

  const state = referrer.hostname.includes('reviews') ? 'review' : 'page';

  // Update links
  REVIEWS_LINK.href = (CUSTOM_REVIEW_HOST && !CUSTOM_REVIEW_HOST.endsWith('.aem.reviews'))
    ? `https://${CUSTOM_REVIEW_HOST}${PATHNAME}`
    : `https://${currentSnapshot}--main--${REPO}--${OWNER}.aem.reviews${PATHNAME}`;

  ADMIN_LINK.href = `/tools/snapshot-admin/snapshot-details.html?snapshot=https://main--${REPO}--${OWNER}.aem.page/.snapshots/${currentSnapshot}/.manifest.json`;

  // Show/hide appropriate sections
  if (state === 'page') {
    PAGE_STATUS_WRAPPER.setAttribute('aria-hidden', 'false');
    REVIEW_STATUS_WRAPPER.setAttribute('aria-hidden', 'true');
  } else if (state === 'review') {
    PAGE_STATUS_WRAPPER.setAttribute('aria-hidden', 'true');
    REVIEW_STATUS_WRAPPER.setAttribute('aria-hidden', 'false');
  }

  try {
    const status = await fetchStatus(OWNER, REPO, currentSnapshot, PATHNAME);
    const manifest = await fetchSnapshotManifest(OWNER, REPO, currentSnapshot);

    if (!manifest) {
      PAGE_STATUS.textContent = 'Snapshot not found';
      REVIEW_STATUS.textContent = 'Snapshot not found';
      return;
    }

    const { locked } = manifest;

    // Update page list
    const pageList = document.getElementById('page-list');
    pageList.innerHTML = manifest.resources.map((e) => `<li><span>${e.path}</span><span class="page-list-remove" role="button" aria-label="Remove">&#x274C;</span></li>`).join('');

    // Remove existing event listener if it exists
    if (pageList.clickHandler) {
      pageList.removeEventListener('click', pageList.clickHandler);
    }

    // Store reference to the handler
    pageList.clickHandler = async (e) => {
      if (e.target.classList.contains('page-list-remove')) {
        const path = e.target.parentElement.firstElementChild.textContent.trim();
        // eslint-disable-next-line no-alert
        const confirmed = window.confirm(`Are you sure you want to remove ${path} from this snapshot?`);
        if (confirmed) {
          SPINNER.setAttribute('aria-hidden', 'false');
          await deleteFromSnapshot(OWNER, REPO, currentSnapshot, path);
          updateSnapshotUI();
        }
      }
    };

    // Add new event listener
    pageList.addEventListener('click', pageList.clickHandler);

    if (state === 'page') {
      const previewDate = status.preview.preview.lastModified;
      if (locked) {
        ADD.disabled = true;
        REMOVE.disabled = true;
        UPDATE.disabled = true;
        PAGE_STATUS.textContent = 'Snapshot is locked';
      } else if (status.snapshot) {
        const snapshotDate = status.snapshot.preview.lastModified;
        if (!snapshotDate) {
          ADD.disabled = false;
          REMOVE.disabled = true;
          UPDATE.disabled = true;
          PAGE_STATUS.textContent = 'Page is not in snapshot';
        } else if (new Date(previewDate) > new Date(snapshotDate)) {
          ADD.disabled = true;
          REMOVE.disabled = false;
          UPDATE.disabled = false;
          PAGE_STATUS.textContent = 'Page is in snapshot, pending changes';
        } else {
          ADD.disabled = true;
          REMOVE.disabled = false;
          UPDATE.disabled = true;
          PAGE_STATUS.textContent = 'Page is in snapshot';
        }
      }
    } else if (state === 'review') {
      if (manifest.review === 'requested') {
        REVIEW_STATUS.textContent = 'Review submitted';
        REVIEW_REQUEST.disabled = true;
        REVIEW_REJECT.disabled = false;
        REVIEW_APPROVE.disabled = false;
      } else if (manifest.resources.length > 0) {
        REVIEW_STATUS.textContent = 'Preparing for review';
        REVIEW_REQUEST.disabled = false;
        REVIEW_REJECT.disabled = true;
        REVIEW_APPROVE.disabled = true;
      } else {
        REVIEW_STATUS.textContent = 'No pages to review';
        REVIEW_REQUEST.disabled = true;
        REVIEW_REJECT.disabled = true;
        REVIEW_APPROVE.disabled = true;
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error updating snapshot UI:', error);
    PAGE_STATUS.textContent = 'Error loading snapshot data';
    REVIEW_STATUS.textContent = 'Error loading snapshot data';
  } finally {
    SPINNER.setAttribute('aria-hidden', 'true');
  }
}

async function onSnapshotChange() {
  const selectedSnapshotName = SNAPSHOT_SELECT.value;

  if (!selectedSnapshotName) {
    currentSnapshot = null;
    resetUI();
    return;
  }

  currentSnapshot = selectedSnapshotName;
  await updateSnapshotUI();
}

async function loadSnapshots() {
  try {
    setOrgSite(OWNER, REPO);
    const result = await fetchSnapshots();

    if (result.error) {
      SNAPSHOT_SELECT.innerHTML = '<option value="">Error loading snapshots</option>';
      return;
    }

    availableSnapshots = result.snapshots;

    if (availableSnapshots.length === 0) {
      SNAPSHOT_SELECT.innerHTML = '<option value="">No snapshots available</option>';
      return;
    }

    // Populate dropdown
    SNAPSHOT_SELECT.innerHTML = '<option value="">Select a snapshot...</option>';
    availableSnapshots.forEach((snapshot) => {
      const option = document.createElement('option');
      option.value = snapshot.name;
      option.textContent = snapshot.name;
      SNAPSHOT_SELECT.appendChild(option);
    });

    SNAPSHOT_SELECT.disabled = false;

    // Auto-select 'default' if it exists
    const defaultSnapshot = availableSnapshots.find((s) => s.name === 'default');
    if (defaultSnapshot) {
      SNAPSHOT_SELECT.value = 'default';
      onSnapshotChange();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error loading snapshots:', error);
    SNAPSHOT_SELECT.innerHTML = '<option value="">Error loading snapshots</option>';
  }
}

// Event Listeners
SNAPSHOT_SELECT.addEventListener('change', onSnapshotChange);

ADD.addEventListener('click', async () => {
  if (!currentSnapshot) return;
  SPINNER.setAttribute('aria-hidden', 'false');
  await addToSnapshot(OWNER, REPO, currentSnapshot, [PATHNAME]);
  updateSnapshotUI();
});

REMOVE.addEventListener('click', async () => {
  if (!currentSnapshot) return;
  SPINNER.setAttribute('aria-hidden', 'false');
  await deleteFromSnapshot(OWNER, REPO, currentSnapshot, PATHNAME);
  updateSnapshotUI();
});

UPDATE.addEventListener('click', async () => {
  if (!currentSnapshot) return;
  SPINNER.setAttribute('aria-hidden', 'false');
  await addToSnapshot(OWNER, REPO, currentSnapshot, [PATHNAME]);
  updateSnapshotUI();
});

REVIEW_REQUEST.addEventListener('click', async () => {
  if (!currentSnapshot) return;
  SPINNER.setAttribute('aria-hidden', 'false');
  await updateReviewStatus(OWNER, REPO, currentSnapshot, 'request');
  updateSnapshotUI();
});

REVIEW_REJECT.addEventListener('click', async () => {
  if (!currentSnapshot) return;
  SPINNER.setAttribute('aria-hidden', 'false');
  await updateReviewStatus(OWNER, REPO, currentSnapshot, 'reject');
  updateSnapshotUI();
});

REVIEW_APPROVE.addEventListener('click', async () => {
  if (!currentSnapshot) return;
  SPINNER.setAttribute('aria-hidden', 'false');
  await updateReviewStatus(OWNER, REPO, currentSnapshot, 'approve');
  window.parent.location.href = CUSTOM_LIVE_HOST
    ? `https://${CUSTOM_LIVE_HOST}${PATHNAME}`
    : `https://main--${REPO}--${OWNER}.aem.live${PATHNAME}`;
});

// Initialize
async function init() {
  SPINNER.setAttribute('aria-hidden', 'false');
  await loadSnapshots();
  SPINNER.setAttribute('aria-hidden', 'true');
}

init();
