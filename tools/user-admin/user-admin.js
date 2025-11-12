import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import { logResponse } from '../../blocks/console/console.js';

let initPromise;

// eslint-disable-next-line import/prefer-default-export
export function ready() {
  return initPromise;
}

const adminForm = document.getElementById('admin-form');
const site = document.getElementById('site');
const org = document.getElementById('org');
const consoleBlock = document.querySelector('.console');
const users = document.getElementById('users');
const addUserButton = document.getElementById('add-user');
const accessConfig = { type: 'org', users: [], originalSiteAccess: {} };
const addUserDetails = document.getElementById('add-user-details');
const addUserForm = document.getElementById('add-user-form');
const addUserEmail = document.getElementById('add-user-email');
const addUserRoles = document.getElementById('add-user-roles');
const addUserSave = document.getElementById('add-user-save');
const addUserCancel = document.getElementById('add-user-cancel');

const ROLES = ['admin', 'author', 'publish', 'develop', 'basic_author', 'basic_publish', 'config', 'config_admin'];

function isValidRoles(roles) {
  if (!roles.value) {
    return false;
  }

  const userRoles = roles.value.split(',').map((role) => role.trim());
  return userRoles.every((role) => ROLES.includes(role));
}

async function getOrgConfig() {
  const adminURL = `https://admin.hlx.page/config/${org.value}.json`;
  const resp = await fetch(adminURL);
  logResponse(consoleBlock, [resp.status, 'GET', adminURL, resp.headers.get('x-error') || '']);
  if (resp.status === 200) {
    const json = await resp.json();
    return json;
  }
  return null;
}

function displayAddUserDetails() {
  addUserDetails.removeAttribute('aria-hidden');
  addUserDetails.querySelector('input[name="add-user-email"]').focus();
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
    headers: {
      'Content-Type': 'application/json',
    },
  });
  logResponse(consoleBlock, [resp.status, 'POST', adminURL, resp.headers.get('x-error') || '']);
}

async function addUserToSite(user) {
  accessConfig.users.push(user);
  await updateSiteAccess();
}

async function updateOrgUserRoles(user) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users/${user.id}.json`;
  const resp = await fetch(adminURL, {
    method: 'POST',
    body: JSON.stringify(user),
    headers: {
      'Content-Type': 'application/json',
    },
  });
  logResponse(consoleBlock, [resp.status, 'POST', adminURL, resp.headers.get('x-error') || '']);
}

async function deleteUserFromSite(user) {
  accessConfig.users = accessConfig.users.filter((u) => u.email !== user.email);
  await updateSiteAccess();
}

async function deleteUserFromOrg(user) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users/${user.id}.json`;
  const resp = await fetch(adminURL, {
    method: 'DELETE',
  });
  logResponse(consoleBlock, [resp.status, 'DELETE', adminURL, resp.headers.get('x-error') || '']);
}

async function addUserToOrg(user) {
  const adminURL = `https://admin.hlx.page/config/${org.value}/users.json`;
  const resp = await fetch(adminURL, {
    method: 'POST',
    body: JSON.stringify(user),
    headers: {
      'Content-Type': 'application/json',
    },
  });
  logResponse(consoleBlock, [resp.status, 'POST', adminURL, resp.headers.get('x-error') || '']);
}

async function updateSiteUserRoles(user) {
  accessConfig.users.find((u) => u.email === user.email).roles = user.roles;
  await updateSiteAccess();
}

function displayUserDetails(elem, user) {
  const email = user.email.replace('@', '-at-');
  elem.innerHTML = `<form id=${email}>
        <fieldset>
        <div class="form-field roles-field">
          <label for="${email}-roles">${user.email} roles</label>
          <input value="${user.roles.join(', ')}" name="${email}-roles" id="${email}-roles" required/>
          <div class="field-help-text">
            <p>
              Enter comma separated list of roles for the user
            </p>
          </div>
        </div>
        <p class="button-wrapper">
          <button type="submit" id="${email}-save" class="button">Save</button>
          <button id="${email}-delete" class="button outline">Delete ...</button>
        </p>
        </fieldset>
    </form>`;
  const fs = elem.querySelector('fieldset');

  const roles = document.getElementById(`${email}-roles`);
  roles.addEventListener('input', () => {
    if (!isValidRoles(roles)) {
      // eslint-disable-next-line no-use-before-define
      save.disabled = true;
      roles.setCustomValidity('Invalid roles');
    } else {
      // eslint-disable-next-line no-use-before-define
      save.disabled = false;
      roles.setCustomValidity('');
    }
  });

  const save = document.getElementById(`${email}-save`);
  save.addEventListener('click', async (e) => {
    fs.disabled = 'disabled';
    save.innerHTML += ' <i class="symbol symbol-loading"></i>';
    e.preventDefault();
    user.roles = roles.value.split(',').map((role) => role.trim());
    if (accessConfig.type === 'site') {
      await updateSiteUserRoles(user);
    } else {
      await updateOrgUserRoles(user);
    }
    adminForm.dispatchEvent(new Event('submit'));
  });

  const remove = document.getElementById(`${email}-delete`);
  remove.addEventListener('click', async (e) => {
    e.preventDefault();
    // eslint-disable-next-line no-alert
    const emailCheck = prompt(`For safety enter email address of the user you are about to delete (${user.email})`);

    if (user.email === emailCheck) {
      fs.disabled = 'disabled';
      remove.innerHTML += ' <i class="symbol symbol-loading"></i>';
      if (accessConfig.type === 'site') {
        await deleteUserFromSite(user);
      } else {
        await deleteUserFromOrg(user);
      }
      adminForm.dispatchEvent(new Event('submit'));
    }
  });
}

async function getSiteAccessConfig() {
  addUserDetails.setAttribute('aria-hidden', 'true');
  const adminURL = `https://admin.hlx.page/config/${org.value}/sites/${site.value}/access.json`;
  const resp = await fetch(adminURL);
  logResponse(consoleBlock, [resp.status, 'GET', adminURL, resp.headers.get('x-error') || '']);
  if (resp.status === 200) {
    const json = await resp.json();
    return json;
  }
  if (resp.status === 404) {
    return { admin: { role: {} } };
  }

  return null;
}

const createUserItem = (user) => {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.classList.add('user-name');
  span.textContent = `${user.email} (${user.roles.join(', ')})`;
  li.append(span);
  const buttonContainer = document.createElement('span');
  buttonContainer.classList.add('button-wrapper');
  const editButton = document.createElement('button');
  editButton.classList.add('button');
  editButton.textContent = 'Edit';
  buttonContainer.append(editButton);
  li.append(buttonContainer);
  const userDetails = document.createElement('div');
  userDetails.classList.add('user-details');
  li.append(userDetails);
  editButton.addEventListener('click', () => {
    displayUserDetails(userDetails, user);
  });
  return li;
};

function isValidNewUser(email, roles) {
  if (!email.checkValidity()) {
    return false;
  }
  if (accessConfig.users.find((user) => user.email === email.value)) {
    return false;
  }
  if (!roles.value) {
    return false;
  }

  const userRoles = roles.value.split(',').map((role) => role.trim());
  return userRoles.every((role) => ROLES.includes(role));
}

/**
 * Handles admin form submission.
 * @param {Event} e - Submit event
 */
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
  users.textContent = '';
  updateConfig();
  if (site.value) {
    accessConfig.type = 'site';

    const configUsers = [];
    const config = await getSiteAccessConfig();
    accessConfig.originalSiteAccess = config;
    const roles = Object.keys(config.admin.role);
    roles.forEach((role) => {
      const emails = config.admin.role[role];
      emails.forEach((email) => {
        const user = configUsers.find((u) => u.email === email);
        if (user) user.roles.push(role);
        else configUsers.push({ email, roles: [role] });
      });
    });
    accessConfig.users = configUsers;
    const sortedUsers = configUsers.sort((a, b) => a.email.localeCompare(b.email));
    sortedUsers.forEach((user) => {
      const li = createUserItem(user);
      users.append(li);
    });
  } else {
    accessConfig.type = 'org';
    const config = await getOrgConfig();
    const sortedUsers = config.users.sort((a, b) => a.email.localeCompare(b.email));
    sortedUsers.forEach((user) => {
      const li = createUserItem(user);
      users.append(li);
    });
    accessConfig.users = config.users;
  }
});

addUserButton.addEventListener('click', () => {
  displayAddUserDetails();
});

addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addUserSave.disabled = true;
  addUserSave.innerHTML += ' <i class="symbol symbol-loading"></i>';
  const user = {
    email: addUserEmail.value,
    roles: addUserRoles.value.split(',').map((role) => role.trim()),
  };
  if (accessConfig.type === 'site') {
    await addUserToSite(user);
  } else {
    await addUserToOrg(user);
  }
  adminForm.dispatchEvent(new Event('submit'));
  addUserDetails.setAttribute('aria-hidden', 'true');
  addUserSave.innerHTML = addUserSave.innerHTML.replace(' <i class="symbol symbol-loading"></i>', '');
  addUserSave.disabled = false;
});

addUserCancel.addEventListener('click', () => {
  addUserDetails.setAttribute('aria-hidden', 'true');
});

addUserEmail.addEventListener('input', () => {
  addUserSave.disabled = !isValidNewUser(addUserEmail, addUserRoles);
});

addUserRoles.addEventListener('input', () => {
  addUserSave.disabled = !isValidNewUser(addUserEmail, addUserRoles);
});

async function init() {
  await initConfigField();

  if (org.value) {
    adminForm.dispatchEvent(new Event('submit'));
  }
}

initPromise = init();
