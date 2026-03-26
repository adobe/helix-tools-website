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

async function addUsersToSite(users) {
  const snapshot = [...accessConfig.users];
  users.forEach((u) => accessConfig.users.push(u));
  try {
    const ok = await updateSiteAccess();
    if (!ok) accessConfig.users = snapshot;
    return ok ? users.length : 0;
  } catch (err) {
    accessConfig.users = snapshot;
    throw err;
  }
}

async function addUsersToOrg(users) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users.json`;
  let added = 0;
  try {
    await users.reduce(async (prevPromise, user) => {
      await prevPromise;
      const resp = await fetch(adminURL, {
        method: 'POST',
        body: JSON.stringify(user),
        headers: { 'Content-Type': 'application/json' },
      });
      logResponse(consoleBlock, resp.status, ['POST', adminURL, resp.headers.get('x-error') || '']);
      if (resp.ok) {
        added += 1;
        accessConfig.users.push(user);
      } else {
        throw new Error(`Failed to add ${user.email}`);
      }
    }, Promise.resolve());
  } catch (err) {
    err.addedCount = added;
    throw err;
  }
  return added;
}

async function updateSiteUserRoles(user) {
  const existingUser = accessConfig.users.find((u) => u.email === user.email);
  if (existingUser) {
    existingUser.roles = user.roles;
  }
  return updateSiteAccess();
}

function createDetailedRoleCheckboxes(selectedRoles = []) {
  const grid = document.createElement('div');
  grid.className = 'roles-grid';
  ROLES.forEach((role) => {
    const roleInfo = ROLE_DESCRIPTIONS[role];
    const label = document.createElement('label');
    label.className = 'role-option';
    label.title = roleInfo.permissions;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'role';
    checkbox.value = role;
    if (selectedRoles.includes(role)) checkbox.checked = true;
    const infoSpan = document.createElement('span');
    infoSpan.className = 'role-info';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'role-name';
    nameSpan.textContent = roleInfo.label;
    const descSpan = document.createElement('span');
    descSpan.className = 'role-desc';
    descSpan.textContent = roleInfo.description;
    infoSpan.appendChild(nameSpan);
    infoSpan.appendChild(descSpan);
    label.appendChild(checkbox);
    label.appendChild(infoSpan);
    grid.appendChild(label);
  });
  return grid;
}

function createCompactRoleCheckboxes(selectedRoles = []) {
  const container = document.createElement('div');
  container.className = 'compact-roles';
  ROLES.forEach((role) => {
    const roleInfo = ROLE_DESCRIPTIONS[role];
    const label = document.createElement('label');
    label.className = 'role-pill';
    label.title = roleInfo.description;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = role;
    if (selectedRoles.includes(role)) checkbox.checked = true;
    const span = document.createElement('span');
    span.textContent = roleInfo.label;
    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  });
  return container;
}

function createRolesReference() {
  const details = document.createElement('details');
  details.className = 'roles-reference';
  const summary = document.createElement('summary');
  summary.textContent = 'What do these roles mean?';
  details.appendChild(summary);
  const list = document.createElement('dl');
  list.className = 'roles-reference-list';
  ROLES.forEach((role) => {
    const roleInfo = ROLE_DESCRIPTIONS[role];
    const dt = document.createElement('dt');
    dt.textContent = roleInfo.label;
    const dd = document.createElement('dd');
    dd.textContent = roleInfo.description;
    list.appendChild(dt);
    list.appendChild(dd);
  });
  const link = document.createElement('a');
  link.href = 'https://www.aem.live/docs/authentication-setup-authoring#admin-roles';
  link.target = '_blank';
  link.className = 'roles-reference-link';
  link.textContent = 'Learn more about roles';
  details.appendChild(list);
  details.appendChild(link);
  return details;
}

let entryIdCounter = 0;

function createUserEntry(entriesContainer, updateSaveLabel) {
  entryIdCounter += 1;
  const entryId = entryIdCounter;
  const entry = document.createElement('div');
  entry.className = 'user-entry';

  const header = document.createElement('div');
  header.className = 'user-entry-header';
  const label = document.createElement('span');
  label.className = 'user-entry-label';
  const num = entriesContainer.querySelectorAll('.user-entry').length + 1;
  label.textContent = `User ${num}`;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'user-entry-remove';
  removeBtn.textContent = 'Remove';
  header.appendChild(label);
  header.appendChild(removeBtn);

  const emailField = document.createElement('div');
  emailField.className = 'form-field';
  const emailLabel = document.createElement('label');
  emailLabel.htmlFor = `user-email-${entryId}`;
  emailLabel.textContent = 'Email';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.id = `user-email-${entryId}`;
  emailInput.required = true;
  emailInput.placeholder = 'user@example.com';
  emailField.appendChild(emailLabel);
  emailField.appendChild(emailInput);

  const rolesFieldId = `user-roles-${entryId}`;
  const rolesField = document.createElement('div');
  rolesField.className = 'form-field';
  const rolesLabel = document.createElement('label');
  rolesLabel.id = rolesFieldId;
  rolesLabel.textContent = 'Roles';
  const rolesContainer = createCompactRoleCheckboxes();
  rolesContainer.setAttribute('role', 'group');
  rolesContainer.setAttribute('aria-labelledby', rolesFieldId);
  rolesField.appendChild(rolesLabel);
  rolesField.appendChild(rolesContainer);

  entry.appendChild(header);
  entry.appendChild(emailField);
  entry.appendChild(rolesField);

  const renumber = () => {
    entriesContainer.querySelectorAll('.user-entry').forEach((e, i) => {
      e.querySelector('.user-entry-label').textContent = `User ${i + 1}`;
    });
  };

  removeBtn.addEventListener('click', () => {
    entry.remove();
    renumber();
    updateSaveLabel();
  });

  entriesContainer.appendChild(entry);
  updateSaveLabel();
  return entry;
}

function showModalError(dialog, message) {
  let banner = dialog.querySelector('.modal-error');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'modal-error';
    banner.setAttribute('role', 'alert');
    const footer = dialog.querySelector('.modal-footer');
    footer.parentNode.insertBefore(banner, footer);
  }
  banner.textContent = message;
  banner.hidden = false;
}

function clearModalError(dialog) {
  const banner = dialog.querySelector('.modal-error');
  if (banner) banner.hidden = true;
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'user-admin-modal';
    dlg.style.maxWidth = '400px';
    const body = document.createElement('div');
    body.className = 'modal-body';
    const msg = document.createElement('p');
    msg.textContent = message;
    body.appendChild(msg);
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button outline';
    cancelBtn.textContent = 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'button';
    confirmBtn.textContent = 'Discard';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    dlg.appendChild(body);
    dlg.appendChild(footer);
    document.body.appendChild(dlg);
    dlg.showModal();
    const close = (result) => { dlg.close(); dlg.remove(); resolve(result); };
    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    dlg.addEventListener('cancel', () => close(false));
  });
}

function createModal(titleText, saveText = 'Save') {
  const dialog = document.createElement('dialog');
  dialog.className = 'user-admin-modal';
  const content = document.createElement('div');
  content.className = 'modal-content';
  const headerDiv = document.createElement('div');
  headerDiv.className = 'modal-header';
  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = titleText;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00D7';
  headerDiv.appendChild(title);
  headerDiv.appendChild(closeBtn);
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'modal-body';
  const footerDiv = document.createElement('div');
  footerDiv.className = 'modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'button outline cancel-btn';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.setAttribute('form', 'user-admin-modal-form');
  saveBtn.className = 'button save-btn';
  saveBtn.textContent = saveText;
  footerDiv.appendChild(cancelBtn);
  footerDiv.appendChild(saveBtn);
  content.appendChild(headerDiv);
  content.appendChild(bodyDiv);
  content.appendChild(footerDiv);
  dialog.appendChild(content);

  let confirmClose = null;
  let closing = false;
  const closeModal = async () => {
    if (closing) return;
    if (confirmClose) {
      closing = true;
      const allowed = await confirmClose();
      closing = false;
      if (!allowed) return;
    }
    dialog.close();
    dialog.remove();
  };

  dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX > rect.right
        || clientY < rect.top || clientY > rect.bottom) {
      closeModal();
    }
  });

  document.body.appendChild(dialog);
  dialog.showModal();

  return {
    dialog,
    content,
    bodyDiv,
    footerDiv,
    saveBtn,
    closeModal,
    setConfirmClose: (fn) => { confirmClose = fn; },
  };
}

function openAddUsersModal(onSave) {
  const entriesContainer = document.createElement('div');
  entriesContainer.className = 'user-entries';

  const presetsDiv = document.createElement('div');
  presetsDiv.className = 'modal-toolbar';
  const presetsLabel = document.createElement('span');
  presetsLabel.className = 'presets-label';
  presetsLabel.textContent = 'Roles (Apply to all)';
  presetsDiv.appendChild(presetsLabel);
  const presetsBtnRow = document.createElement('div');
  presetsBtnRow.className = 'presets-btn-row';
  ROLES.forEach((role) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'role-preset-btn';
    btn.textContent = ROLE_DESCRIPTIONS[role].label;
    btn.addEventListener('click', () => {
      const cbs = entriesContainer.querySelectorAll(`input[type="checkbox"][value="${role}"]`);
      const allChecked = cbs.length > 0 && [...cbs].every((cb) => cb.checked);
      cbs.forEach((cb) => { cb.checked = !allChecked; });
      entriesContainer.querySelectorAll('.user-entry.has-error').forEach((entry) => {
        entry.classList.remove('has-error');
      });
    });
    presetsBtnRow.appendChild(btn);
  });
  presetsDiv.appendChild(presetsBtnRow);
  presetsDiv.appendChild(createRolesReference());

  const {
    dialog, content, bodyDiv, saveBtn, closeModal, setConfirmClose,
  } = createModal('Add Users', 'Add 2 Users');

  content.insertBefore(presetsDiv, bodyDiv);

  setConfirmClose(async () => {
    const emails = dialog.querySelectorAll('input[type="email"]');
    const hasData = [...emails].some((input) => input.value.trim() !== '');
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
    const hasRoles = [...checkboxes].some((cb) => cb.checked);
    if (!hasData && !hasRoles) return true;
    return showConfirmDialog('You have unsaved changes. Discard?');
  });

  const form = document.createElement('form');
  form.id = 'user-admin-modal-form';
  form.noValidate = true;
  const addAnotherBtn = document.createElement('button');
  addAnotherBtn.type = 'button';
  addAnotherBtn.className = 'button outline add-another-btn';
  addAnotherBtn.textContent = '+ Add Another User';
  form.appendChild(entriesContainer);
  form.appendChild(addAnotherBtn);
  bodyDiv.appendChild(form);

  const updateSaveLabel = () => {
    const count = entriesContainer.querySelectorAll('.user-entry').length;
    saveBtn.textContent = `Add ${count} User${count !== 1 ? 's' : ''}`;
  };

  const firstEntry = createUserEntry(entriesContainer, updateSaveLabel);
  createUserEntry(entriesContainer, updateSaveLabel);
  firstEntry.querySelector('input[type="email"]').focus();

  addAnotherBtn.addEventListener('click', () => {
    const entry = createUserEntry(entriesContainer, updateSaveLabel);
    entry.querySelector('input[type="email"]').focus();
    entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearModalError(dialog);

    const entries = entriesContainer.querySelectorAll('.user-entry');
    const users = [];
    let hasError = false;

    const flagError = (entry, message, focusEl) => {
      entry.classList.add('has-error');
      entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (focusEl) focusEl.focus();
      showModalError(dialog, message);
      hasError = true;
    };

    entries.forEach((entry) => entry.classList.remove('has-error'));

    entries.forEach((entry) => {
      if (hasError) return;
      const emailInput = entry.querySelector('input[type="email"]');
      const email = emailInput.value.trim();
      const roles = [...entry.querySelectorAll('input[type="checkbox"]:checked')]
        .map((cb) => cb.value);

      if (!email) { flagError(entry, 'Please enter an email for each user', emailInput); return; }
      if (!emailInput.validity.valid) { flagError(entry, `Invalid email: ${email}`, emailInput); return; }
      if (roles.length === 0) { flagError(entry, 'Please select at least one role for each user'); return; }

      const emailLower = email.toLowerCase();
      if (users.some((u) => u.email.toLowerCase() === emailLower)) {
        flagError(entry, `Duplicate email in batch: ${email}`);
        return;
      }
      if (accessConfig.users.some((u) => u.email.toLowerCase() === emailLower)) {
        flagError(entry, `User already exists: ${email}`);
        return;
      }

      users.push({ email, roles });
    });

    if (hasError || users.length === 0) return;

    const validEntries = [...entriesContainer.querySelectorAll('.user-entry')]
      .filter((entry) => entry.querySelector('input[type="email"]').value.trim());

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const added = await onSave(users);
      if (added === users.length) {
        const msg = users.length === 1
          ? 'User added successfully'
          : `${users.length} users added successfully`;
        setConfirmClose(null);
        closeModal();
        showToast(msg);
        adminForm.dispatchEvent(new Event('submit'));
      } else {
        showModalError(dialog, 'Failed to add users');
        saveBtn.disabled = false;
        updateSaveLabel();
        adminForm.dispatchEvent(new Event('submit'));
      }
    } catch (err) {
      const added = err.addedCount || 0;
      if (added > 0) {
        validEntries.slice(0, added).forEach((entry) => entry.remove());
        entriesContainer.querySelectorAll('.user-entry').forEach((el, i) => {
          el.querySelector('.user-entry-label').textContent = `User ${i + 1}`;
        });
        const failed = users.length - added;
        showModalError(dialog, `${added} user(s) added, ${failed} failed: ${err.message}`);
      } else {
        showModalError(dialog, `Error: ${err.message || 'Failed to add users'}`);
      }
      saveBtn.disabled = false;
      updateSaveLabel();
      adminForm.dispatchEvent(new Event('submit'));
    }
  });
}

function openEditUserModal(user, onSave) {
  const {
    dialog, bodyDiv, footerDiv, saveBtn, closeModal,
  } = createModal(`Edit User: ${user.email}`);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'button danger outline delete-btn';
  deleteBtn.textContent = 'Delete User';
  footerDiv.prepend(deleteBtn);

  const form = document.createElement('form');
  form.id = 'user-admin-modal-form';
  const rolesField = document.createElement('div');
  rolesField.className = 'form-field';
  const rolesLabel = document.createElement('label');
  rolesLabel.textContent = 'Roles';
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  const hintLink = document.createElement('a');
  hintLink.href = 'https://www.aem.live/docs/authentication-setup-authoring#admin-roles';
  hintLink.target = '_blank';
  hintLink.textContent = 'Learn more about roles';
  hint.append('Select one or more roles. ', hintLink);
  rolesField.appendChild(rolesLabel);
  rolesField.appendChild(hint);
  rolesField.appendChild(createDetailedRoleCheckboxes(user.roles || []));
  form.appendChild(rolesField);
  bodyDiv.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearModalError(dialog);
    const roles = [...form.querySelectorAll('input[type="checkbox"]:checked')]
      .map((cb) => cb.value);

    if (roles.length === 0) {
      showModalError(dialog, 'Please select at least one role');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const updatedUser = { email: user.email, roles, id: user.id };

    try {
      const success = await onSave(updatedUser);
      if (success) {
        closeModal();
        showToast('User updated successfully');
        adminForm.dispatchEvent(new Event('submit'));
      } else {
        showModalError(dialog, 'Failed to save user');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    } catch (err) {
      showModalError(dialog, `Error: ${err.message || 'Failed to save user'}`);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  deleteBtn.addEventListener('click', async () => {
    clearModalError(dialog);
    // eslint-disable-next-line no-alert
    const emailCheck = prompt(`To confirm deletion, enter the email: ${user.email}`);
    if (emailCheck !== user.email) {
      if (emailCheck !== null) showModalError(dialog, 'Email did not match');
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
        closeModal();
        showToast('User deleted');
        adminForm.dispatchEvent(new Event('submit'));
      } else {
        showModalError(dialog, 'Failed to delete user');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete User';
      }
    } catch (err) {
      showModalError(dialog, `Error: ${err.message || 'Failed to delete user'}`);
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete User';
    }
  });
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
    openEditUserModal(user, async (updatedUser) => {
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
      <button class="button add-user-btn">+ Add User(s)</button>
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
    openAddUsersModal(async (newUsers) => {
      if (accessConfig.type === 'site') {
        return addUsersToSite(newUsers);
      }
      return addUsersToOrg(newUsers);
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
