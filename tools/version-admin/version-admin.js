import { ensureLogin } from '../../blocks/profile/profile.js';
import { diffJson } from './diff.js';
import { logResponse } from '../../blocks/console/console.js';

const adminForm = document.getElementById('admin-form');
const typeSelect = document.getElementById('type');
const org = document.getElementById('org');
const profile = document.getElementById('profile');
const site = document.getElementById('site');
const profileField = document.querySelector('.profile-field');
const siteField = document.querySelector('.site-field');
const consoleBlock = document.querySelector('.console');
const versions = document.getElementById('versions');
const versionsTitle = document.getElementById('versions-title');
const currentVersionInfo = document.getElementById('current-version-info');
const currentVersionNumber = document.getElementById('current-version-number');
const fetchButton = document.getElementById('fetch');

const currentConfig = { type: '', versions: [], currentVersion: null };

/**
 * Build the API URL based on the current configuration
 * @param {string} endpoint - The endpoint path (e.g., 'versions.json', 'versions/1.json')
 * @returns {string} The complete API URL
 */
function buildApiUrl(endpoint) {
  let url = `https://admin.hlx.page/config/${org.value}`;

  if (currentConfig.type === 'profile') {
    url += `/profiles/${profile.value}`;
  } else if (currentConfig.type === 'site') {
    url += `/sites/${site.value}`;
  }

  return `${url}/${endpoint}`;
}

/**
 * Format date for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

/**
 * Fetch versions list from the API
 */
async function fetchVersions() {
  const url = buildApiUrl('versions.json');
  const resp = await fetch(url);
  logResponse(consoleBlock, [resp.status, 'GET', url, resp.headers.get('x-error') || '']);

  if (resp.status === 200) {
    const data = await resp.json();
    currentConfig.versions = data.versions || [];
    currentConfig.currentVersion = data.current;
    return data;
  }
  return null;
}

/**
 * Fetch specific version data
 * @param {number} versionId - Version ID to fetch
 */
async function fetchVersionData(versionId) {
  const url = buildApiUrl(`versions/${versionId}.json`);
  const resp = await fetch(url);
  logResponse(consoleBlock, [resp.status, 'GET', url, resp.headers.get('x-error') || '']);

  if (resp.status === 200) {
    return resp.json();
  }
  return null;
}

/**
 * Update version name
 * @param {number} versionId - Version ID to update
 * @param {string} newName - New name for the version
 */
async function updateVersionName(versionId, newName) {
  const url = buildApiUrl(`versions/${versionId}.json?name=${encodeURIComponent(newName)}`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newName }),
  });
  logResponse(consoleBlock, [resp.status, 'POST', url, resp.headers.get('x-error') || '']);

  return resp.status === 200;
}

/**
 * Restore a version
 * @param {number} versionId - Version ID to restore
 */
async function restoreVersion(versionId) {
  let url;
  if (currentConfig.type === 'org') {
    url = `https://admin.hlx.page/config/${org.value}.json?version=${versionId}`;
  } else if (currentConfig.type === 'profile') {
    url = `https://admin.hlx.page/config/${org.value}/profiles/${profile.value}.json?restoreVersion=${versionId}`;
  } else if (currentConfig.type === 'site') {
    url = `https://admin.hlx.page/config/${org.value}/sites/${site.value}.json?restoreVersion=${versionId}`;
  }

  const resp = await fetch(url, {
    method: 'PUT',
  });
  logResponse(consoleBlock, [resp.status, 'PUT', url, resp.headers.get('x-error') || '']);

  return resp.status === 200;
}

/**
 * Delete a version
 * @param {number} versionId - Version ID to delete
 */
async function deleteVersion(versionId) {
  const url = buildApiUrl(`versions/${versionId}.json`);
  const resp = await fetch(url, {
    method: 'DELETE',
  });
  logResponse(consoleBlock, [resp.status, 'DELETE', url, resp.headers.get('x-error') || '']);

  return resp.status === 200;
}

/**
 * Show version details
 * @param {HTMLElement} li - List item element
 * @param {Object} version - Version object
 */
async function showVersionDetails(li, version) {
  const detailsContainer = li.querySelector('.version-details');

  if (detailsContainer.style.display === 'none') {
    detailsContainer.innerHTML = '<p>Loading...</p>';
    detailsContainer.style.display = 'block';

    const versionData = await fetchVersionData(version.version);
    const previousVersionData = await fetchVersionData(`${+version.version - 1}`);
    if (previousVersionData && previousVersionData.data) {
      const diff = diffJson(previousVersionData.data, versionData.data);
      const diffHtml = diff.map((part) => {
        if (part.added) {
          return `<span class="diff-added">${part.value}</span>`;
        }
        if (part.removed) {
          return `<span class="diff-removed">${part.value}</span>`;
        }
        return part.value;
      }).join('');
      detailsContainer.innerHTML = `
        <h4>Version ${version.version} Data</h4>
        <div class="version-data">
          <pre>${diffHtml}</pre>
        </div>
      `;
    } else if (versionData && versionData.data) {
      detailsContainer.innerHTML = `
        <h4>Version ${version.version} Data</h4>
        <div class="version-data">
          <pre>${JSON.stringify(versionData.data, null, 2)}</pre>
        </div>
      `;
    } else {
      detailsContainer.innerHTML = '<p>Failed to load version data</p>';
    }
  } else {
    detailsContainer.style.display = 'none';
  }
}

/**
 * Show edit name form
 * @param {HTMLElement} li - List item element
 * @param {Object} version - Version object
 */
function showEditNameForm(li, version) {
  const detailsContainer = li.querySelector('.version-details');

  detailsContainer.innerHTML = `
    <h4>Edit Version Name</h4>
    <form class="edit-name-form">
      <input type="text" value="${version.name || ''}" placeholder="Enter version name" />
      <button type="submit" class="button">Save</button>
      <button type="button" class="button outline">Cancel</button>
    </form>
  `;
  detailsContainer.style.display = 'block';

  const form = detailsContainer.querySelector('form');
  const input = detailsContainer.querySelector('input');
  const saveButton = detailsContainer.querySelector('button[type="submit"]');
  const cancelButton = detailsContainer.querySelector('button[type="button"]');

  input.focus();
  input.select();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = input.value.trim();
    if (newName) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';
      const success = await updateVersionName(version.version, newName);
      if (success) {
        // Refresh the versions list
        adminForm.dispatchEvent(new Event('submit'));
      } else {
        saveButton.disabled = false;
        saveButton.textContent = 'Save';
      }
    }
  });

  cancelButton.addEventListener('click', () => {
    detailsContainer.style.display = 'none';
  });
}

/**
 * Create version item for display
 * @param {Object} version - Version object
 */
function createVersionItem(version) {
  const li = document.createElement('li');
  const isCurrentVersion = version.version === currentConfig.currentVersion;

  if (isCurrentVersion) {
    li.classList.add('version-current');
  }

  const versionInfo = document.createElement('div');
  versionInfo.classList.add('version-info');

  const versionName = document.createElement('div');
  versionName.classList.add('version-name');
  versionName.textContent = version.name || `Version ${version.version}`;
  if (isCurrentVersion) {
    versionName.textContent += ' (Current)';
  }

  const versionMeta = document.createElement('div');
  const by = version.user ? `by ${version.user}` : '';
  versionMeta.classList.add('version-meta');
  versionMeta.textContent = `Version ${version.version} • Created: ${formatDate(version.created)} ${by}`;

  versionInfo.append(versionName, versionMeta);
  li.append(versionInfo);

  // Button container
  const buttonContainer = document.createElement('div');
  buttonContainer.classList.add('version-actions');

  // View button
  const viewButton = document.createElement('button');
  viewButton.classList.add('button', 'outline');
  viewButton.textContent = 'View';
  viewButton.addEventListener('click', async () => {
    await showVersionDetails(li, version);
  });
  buttonContainer.append(viewButton);

  // Edit name button
  const editButton = document.createElement('button');
  editButton.classList.add('button', 'outline');
  editButton.textContent = 'Edit Name';
  editButton.addEventListener('click', () => {
    showEditNameForm(li, version);
  });
  buttonContainer.append(editButton);

  // Restore button (disabled for current version)
  if (!isCurrentVersion) {
    const restoreButton = document.createElement('button');
    restoreButton.classList.add('button');
    restoreButton.textContent = 'Restore';
    restoreButton.addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Are you sure you want to restore version ${version.version}? This will make it the current version.`)) {
        restoreButton.disabled = true;
        restoreButton.textContent = 'Restoring...';
        const success = await restoreVersion(version.version);
        if (success) {
          // Refresh the versions list
          adminForm.dispatchEvent(new Event('submit'));
        } else {
          restoreButton.disabled = false;
          restoreButton.textContent = 'Restore';
        }
      }
    });
    buttonContainer.append(restoreButton);
  }

  // Delete button (disabled for current version)
  if (!isCurrentVersion) {
    const deleteButton = document.createElement('button');
    deleteButton.classList.add('button', 'outline');
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Are you sure you want to delete version ${version.version}? This action cannot be undone.`)) {
        deleteButton.disabled = true;
        deleteButton.textContent = 'Deleting...';
        const success = await deleteVersion(version.version);
        if (success) {
          // Refresh the versions list
          adminForm.dispatchEvent(new Event('submit'));
        } else {
          deleteButton.disabled = false;
          deleteButton.textContent = 'Delete';
        }
      }
    });
    buttonContainer.append(deleteButton);
  }

  li.append(buttonContainer);

  // Details container
  const detailsContainer = document.createElement('div');
  detailsContainer.classList.add('version-details');
  detailsContainer.style.display = 'none';
  li.append(detailsContainer);

  return li;
}

/**
 * Update field visibility based on selected type
 */
function updateFieldVisibility() {
  const selectedType = typeSelect.value;

  profileField.style.display = selectedType === 'profile' ? 'block' : 'none';
  siteField.style.display = selectedType === 'site' ? 'block' : 'none';

  // Clear dependent fields when type changes
  if (selectedType !== 'profile') {
    profile.value = '';
  }
  if (selectedType !== 'site') {
    site.value = '';
  }

  // Update required attributes
  profile.required = selectedType === 'profile';
  site.required = selectedType === 'site';
}

/**
 * Validate form inputs
 */
function validateForm() {
  if (!typeSelect.value || !org.value) {
    return false;
  }

  if (typeSelect.value === 'profile' && !profile.value) {
    return false;
  }

  if (typeSelect.value === 'site' && !site.value) {
    return false;
  }

  return true;
}

// Event listeners
typeSelect.addEventListener('change', updateFieldVisibility);

adminForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!await ensureLogin(org.value, site.value)) {
    // not logged in yet, listen for profile-update event
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      // check if user is logged in now
      if (loginInfo.includes(org.value)) {
        // logged in, restart action (e.g. resubmit form)
        e.target.querySelector('button[type="submit"]').click();
      }
    }, { once: true });
    // abort action
    return;
  }

  if (!validateForm()) {
    // eslint-disable-next-line no-alert
    alert('Please fill in all required fields.');
    return;
  }

  fetchButton.disabled = true;

  currentConfig.type = typeSelect.value;
  versions.innerHTML = '';
  currentVersionInfo.style.display = 'none';

  // Update URL
  const params = new URLSearchParams();
  params.set('type', typeSelect.value);
  params.set('org', org.value);
  if (typeSelect.value === 'profile') {
    params.set('profile', profile.value);
  } else if (typeSelect.value === 'site') {
    params.set('site', site.value);
  }
  window.history.pushState(null, '', `?${params.toString()}`);

  // Update title
  let titleText = `${org.value}`;
  if (typeSelect.value === 'profile') {
    titleText += ` / ${profile.value} (Profile)`;
  } else if (typeSelect.value === 'site') {
    titleText += ` / ${site.value} (Site)`;
  } else {
    titleText += ' (Organization)';
  }
  titleText += ' Versions';
  versionsTitle.textContent = titleText;

  // Fetch and display versions
  const data = await fetchVersions();
  if (data) {
    // Show current version info
    if (data.current) {
      currentVersionNumber.textContent = data.current;
      currentVersionInfo.style.display = 'block';
    }

    // Sort versions by version number (descending)
    const sortedVersions = data.versions.sort((a, b) => b.version - a.version);

    sortedVersions.forEach((version) => {
      const li = createVersionItem(version);
      versions.append(li);
    });

    if (sortedVersions.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No versions found.';
      li.style.textAlign = 'center';
      li.style.color = 'var(--gray-600)';
      versions.append(li);
    }
  }
  fetchButton.disabled = false;
});

// Initialize from URL parameters
const params = new URLSearchParams(window.location.search);
const typeParam = params.get('type');
const orgParam = params.get('org');
const profileParam = params.get('profile');
const siteParam = params.get('site');

if (typeParam) {
  typeSelect.value = typeParam;
  updateFieldVisibility();
}
if (orgParam) {
  org.value = orgParam;
}
if (profileParam) {
  profile.value = profileParam;
}
if (siteParam) {
  site.value = siteParam;
}

// Auto-submit if we have the required parameters
if (typeParam && orgParam
    && ((typeParam === 'org')
     || (typeParam === 'profile' && profileParam)
     || (typeParam === 'site' && siteParam))) {
  adminForm.dispatchEvent(new Event('submit'));
}

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return Promise.resolve();
}
