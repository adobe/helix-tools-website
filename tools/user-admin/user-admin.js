import { registerToolReady } from '../../scripts/scripts.js';
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';
import { loadIcon, icon, showToast } from '../../utils/card-ui/card-ui.js';

const VIEW_STORAGE_KEY = 'user-admin-view';

const adminForm = document.getElementById('admin-form');
const site = document.getElementById('site');
const org = document.getElementById('org');
const consoleBlock = document.querySelector('.console');
const usersContainer = document.getElementById('users-container');
const accessConfig = { type: 'org', users: [], originalSiteAccess: {} };

const ROLES = ['admin', 'author', 'publish', 'develop', 'basic_author', 'basic_publish', 'config', 'config_admin'];

// Role descriptions from https://www.aem.live/docs/authentication-setup-authoring#admin-roles
const ROLE_DESCRIPTIONS = {
  admin: {
    label: 'Admin',
    description: 'Full access to all permissions',
    permissions: 'All permissions',
  },
  basic_author: {
    label: 'Basic Author',
    description: 'Basic authoring capabilities without publishing',
    permissions: 'cache:write, code:read, code:write, code:delete, index:read, index:write, preview:read, preview:write, preview:delete, edit:read, live:read, cron:read, cron:write, snapshot:read, job:read',
  },
  basic_publish: {
    label: 'Basic Publish',
    description: 'Basic author permissions plus publishing',
    permissions: 'basic_author + live:write, live:delete',
  },
  author: {
    label: 'Author',
    description: 'Full authoring capabilities',
    permissions: 'basic_author + edit:list, job:list, log:read, preview:list, preview:delete-forced, snapshot:delete, snapshot:write, job:write',
  },
  publish: {
    label: 'Publish',
    description: 'Full authoring and publishing capabilities',
    permissions: 'author + live:write, live:delete, live:delete-forced, live:list',
  },
  develop: {
    label: 'Develop',
    description: 'Author permissions plus code management',
    permissions: 'author + code:write, code:delete, code:delete-forced',
  },
  config: {
    label: 'Config',
    description: 'Read-only access to redacted configuration',
    permissions: 'config:read-redacted',
  },
  config_admin: {
    label: 'Config Admin',
    description: 'Full publishing and configuration management',
    permissions: 'publish + config:read, config:write',
  },
};

async function getOrgConfig() {
  const adminURL = `https://admin.hlx.page/config/${org.value}.json`;
  const resp = await fetch(adminURL);
  logResponse(consoleBlock, resp.status, ['GET', adminURL, resp.headers.get('x-error') || '']);
  if (resp.status === 200) {
    return resp.json();
  }
  return null;
}

async function getSiteAccessConfig() {
  const adminURL = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/access.json`;
  const resp = await fetch(adminURL);
  logResponse(consoleBlock, resp.status, ['GET', adminURL, resp.headers.get('x-error') || '']);
  if (resp.status === 200) {
    return resp.json();
  }
  if (resp.status === 404) {
    return { admin: { role: {} } };
  }
  return null;
}

async function updateSiteAccess() {
  const toAccess = () => {
    const access = accessConfig.originalSiteAccess;
    access.admin.role = {};
    accessConfig.users.forEach((user) => {
      user.roles.forEach((role) => {
        if (!access.admin.role[role]) {
          access.admin.role[role] = [user.email];
        } else {
          access.admin.role[role].push(user.email);
        }
      });
    });
    return access;
  };
  const access = toAccess();
  const adminURL = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/access.json`;
  const resp = await fetch(adminURL, {
    method: 'POST',
    body: JSON.stringify(access),
    headers: { 'Content-Type': 'application/json' },
  });
  logResponse(consoleBlock, resp.status, ['POST', adminURL, resp.headers.get('x-error') || '']);
  return resp.ok;
}

async function updateOrgUserRoles(user) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users/${user.id}.json`;
  const resp = await fetch(adminURL, {
    method: 'POST',
    body: JSON.stringify(user),
    headers: { 'Content-Type': 'application/json' },
  });
  logResponse(consoleBlock, resp.status, ['POST', adminURL, resp.headers.get('x-error') || '']);
  return resp.ok;
}

async function deleteUserFromSite(user) {
  accessConfig.users = accessConfig.users.filter((u) => u.email !== user.email);
  return updateSiteAccess();
}

async function deleteUserFromOrg(user) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users/${user.id}.json`;
  const resp = await fetch(adminURL, { method: 'DELETE' });
  logResponse(consoleBlock, resp.status, ['DELETE', adminURL, resp.headers.get('x-error') || '']);
  return resp.ok;
}

async function addUserToSite(user) {
  accessConfig.users.push(user);
  return updateSiteAccess();
}

async function addUserToOrg(user) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users.json`;
  const resp = await fetch(adminURL, {
    method: 'POST',
    body: JSON.stringify(user),
    headers: { 'Content-Type': 'application/json' },
  });
  logResponse(consoleBlock, resp.status, ['POST', adminURL, resp.headers.get('x-error') || '']);
  return resp.ok;
}

async function updateSiteUserRoles(user) {
  const existingUser = accessConfig.users.find((u) => u.email === user.email);
  if (existingUser) {
    existingUser.roles = user.roles;
  }
  return updateSiteAccess();
}

function createRoleCheckboxes(selectedRoles = []) {
  return ROLES.map((role) => {
    const roleInfo = ROLE_DESCRIPTIONS[role];
    const checked = selectedRoles.includes(role) ? 'checked' : '';
    return `
      <label class="role-option" title="${roleInfo.permissions}">
        <input type="checkbox" name="role" value="${role}" ${checked} />
        <span class="role-info">
          <span class="role-name">${roleInfo.label}</span>
          <span class="role-desc">${roleInfo.description}</span>
        </span>
      </label>
    `;
  }).join('');
}

function openUserModal(user, onSave) {
  const isNew = !user;

  const dialog = document.createElement('dialog');
  dialog.className = 'user-admin-modal';
  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title"></h3>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <form id="user-admin-modal-form">
          ${isNew ? `
            <div class="form-field">
              <label for="user-email">Email</label>
              <input type="email" id="user-email" name="email" required placeholder="user@example.com" />
            </div>
          ` : ''}
          <div class="form-field">
            <label>Roles</label>
            <p class="field-hint">Select one or more roles. <a href="https://www.aem.live/docs/authentication-setup-authoring#admin-roles" target="_blank">Learn more about roles</a></p>
            <div class="roles-grid">
              ${createRoleCheckboxes(user?.roles || [])}
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        ${!isNew ? '<button type="button" class="button danger outline delete-btn">Delete User</button>' : ''}
        <button type="button" class="button outline cancel-btn">Cancel</button>
        <button type="submit" form="user-admin-modal-form" class="button save-btn">Save</button>
      </div>
    </div>
  `;

  // Set title safely using textContent to prevent XSS
  const titleEl = dialog.querySelector('.modal-title');
  titleEl.textContent = isNew ? 'Add User' : `Edit User: ${user.email}`;

  document.body.appendChild(dialog);
  dialog.showModal();

  const closeModal = () => {
    dialog.close();
    dialog.remove();
  };

  // Clean up dialog when closed via Escape key (cancel event fires before close)
  dialog.addEventListener('cancel', closeModal);

  dialog.querySelector('.modal-close').addEventListener('click', closeModal);
  dialog.querySelector('.cancel-btn').addEventListener('click', closeModal);

  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX > rect.right
        || clientY < rect.top || clientY > rect.bottom) {
      closeModal();
    }
  });

  const form = dialog.querySelector('#user-admin-modal-form');
  const saveBtn = dialog.querySelector('.save-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
    const roles = [...checkboxes].map((cb) => cb.value);

    if (roles.length === 0) {
      showToast('Please select at least one role', 'error');
      return;
    }

    const email = isNew ? form.querySelector('#user-email').value : user.email;

    // Check for duplicate users when adding new
    if (isNew) {
      const emailLower = email.toLowerCase();
      const exists = accessConfig.users.some((u) => u.email.toLowerCase() === emailLower);
      if (exists) {
        showToast('A user with this email already exists', 'error');
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const updatedUser = { email, roles, id: user?.id };

    try {
      const success = await onSave(updatedUser, isNew);
      if (success) {
        showToast(isNew ? 'User added successfully' : 'User updated successfully');
        closeModal();
        adminForm.dispatchEvent(new Event('submit'));
      } else {
        showToast('Failed to save user', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    } catch (err) {
      showToast(`Error: ${err.message || 'Failed to save user'}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  const deleteBtn = dialog.querySelector('.delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      const emailCheck = prompt(`To confirm deletion, enter the email: ${user.email}`);
      if (emailCheck !== user.email) {
        if (emailCheck !== null) showToast('Email did not match', 'error');
        return;
      }

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';

      try {
        let success;
        if (accessConfig.type === 'site') {
          success = await deleteUserFromSite(user);
        } else {
          success = await deleteUserFromOrg(user);
        }

        if (success) {
          showToast('User deleted');
          closeModal();
          adminForm.dispatchEvent(new Event('submit'));
        } else {
          showToast('Failed to delete user', 'error');
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Delete User';
        }
      } catch (err) {
        showToast(`Error: ${err.message || 'Failed to delete user'}`, 'error');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete User';
      }
    });
  }

  if (isNew) {
    dialog.querySelector('#user-email').focus();
  }
}

function createUserCard(user) {
  const card = document.createElement('div');
  card.className = 'card-item user-card';
  card.dataset.email = user.email.toLowerCase();

  // Build card structure safely to prevent XSS
  const infoDiv = document.createElement('div');
  infoDiv.className = 'user-card-info';

  const userIcon = document.createElement('span');
  userIcon.className = 'user-icon';
  userIcon.innerHTML = icon('user');

  const nameEl = document.createElement('h3');
  nameEl.className = 'card-item-name';
  nameEl.textContent = user.email;

  infoDiv.appendChild(userIcon);
  infoDiv.appendChild(nameEl);

  const badgesDiv = document.createElement('div');
  badgesDiv.className = 'card-item-badges';
  user.roles.forEach((role) => {
    const badge = document.createElement('span');
    badge.className = 'card-item-badge';
    badge.textContent = role;
    badge.title = ROLE_DESCRIPTIONS[role]?.description || '';
    badgesDiv.appendChild(badge);
  });

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'card-item-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'card-item-btn edit-btn';
  editBtn.innerHTML = `${icon('edit')} Edit`;

  editBtn.addEventListener('click', () => {
    openUserModal(user, async (updatedUser) => {
      if (accessConfig.type === 'site') {
        return updateSiteUserRoles(updatedUser);
      }
      return updateOrgUserRoles(updatedUser);
    });
  });

  actionsDiv.appendChild(editBtn);

  card.appendChild(infoDiv);
  card.appendChild(badgesDiv);
  card.appendChild(actionsDiv);

  return card;
}

function displayUsers(users) {
  usersContainer.innerHTML = '';

  const savedView = localStorage.getItem(VIEW_STORAGE_KEY) || 'grid';

  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `
    <span class="card-count">${users.length} user${users.length !== 1 ? 's' : ''}</span>
    <div class="card-actions">
      <div class="card-search">
        <input type="text" placeholder="Search users..." class="search-input" />
      </div>
      <div class="view-toggle">
        <button type="button" class="view-btn ${savedView === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
          ${icon('grid')}
        </button>
        <button type="button" class="view-btn ${savedView === 'list' ? 'active' : ''}" data-view="list" title="List view">
          ${icon('list')}
        </button>
      </div>
      <button class="button add-user-btn">+ Add User</button>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = `card-grid ${savedView === 'list' ? 'list-view' : ''}`;

  // Search
  const searchInput = header.querySelector('.search-input');
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    grid.querySelectorAll('.user-card').forEach((card) => {
      const { email } = card.dataset;
      const hidden = !email.includes(query);
      if (hidden) {
        card.setAttribute('aria-hidden', 'true');
      } else {
        card.removeAttribute('aria-hidden');
      }
    });
  });

  // View toggle
  header.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { view } = btn.dataset;
      header.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      grid.classList.toggle('list-view', view === 'list');
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    });
  });

  // Add user button
  header.querySelector('.add-user-btn').addEventListener('click', () => {
    openUserModal(null, async (newUser, isNew) => {
      if (isNew) {
        if (accessConfig.type === 'site') {
          return addUserToSite(newUser);
        }
        return addUserToOrg(newUser);
      }
      return false;
    });
  });

  usersContainer.appendChild(header);

  // Sort users alphabetically
  const sortedUsers = [...users].sort((a, b) => a.email.localeCompare(b.email));

  sortedUsers.forEach((user) => {
    const card = createUserCard(user);
    grid.appendChild(card);
  });

  usersContainer.appendChild(grid);
}

adminForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!await ensureLogin(org.value, site.value)) {
    window.addEventListener('profile-update', ({ detail: loginInfo }) => {
      if (loginInfo.includes(org.value)) {
        e.target.querySelector('button[type="submit"]').click();
      }
    }, { once: true });
    return;
  }

  usersContainer.innerHTML = '<p class="loading">Loading users...</p>';
  updateConfig();

  if (site.value) {
    accessConfig.type = 'site';
    const config = await getSiteAccessConfig();
    if (!config) {
      usersContainer.innerHTML = '<p class="error">Failed to load users</p>';
      return;
    }

    accessConfig.originalSiteAccess = config;
    const configUsers = [];
    const adminRoles = config.admin?.role || {};
    const roles = Object.keys(adminRoles);
    roles.forEach((role) => {
      const emails = adminRoles[role];
      emails.forEach((email) => {
        const user = configUsers.find((u) => u.email === email);
        if (user) user.roles.push(role);
        else configUsers.push({ email, roles: [role] });
      });
    });
    accessConfig.users = configUsers;
    displayUsers(configUsers);
  } else {
    accessConfig.type = 'org';
    const config = await getOrgConfig();
    if (!config) {
      usersContainer.innerHTML = '<p class="error">Failed to load users</p>';
      return;
    }

    accessConfig.users = config.users || [];
    displayUsers(accessConfig.users);
  }
});

async function init() {
  // Load required icons
  const neededIcons = ['user', 'edit', 'grid', 'list', 'trash'];
  await Promise.all(neededIcons.map(loadIcon));

  await initConfigField();

  if (org.value) {
    adminForm.dispatchEvent(new Event('submit'));
  }
}

registerToolReady(init());
