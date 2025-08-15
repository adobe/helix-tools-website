/* eslint-disable no-restricted-globals, no-alert */

import {
  getSidekickId,
  messageSidekick,
  NO_SIDEKICK,
} from '../../utils/sidekick.js';

async function getLoginInfo() {
  return messageSidekick({ action: 'getAuthInfo' });
}

function dispatchProfileUpdateEvent(loginInfo) {
  window.dispatchEvent(
    new CustomEvent('profile-update', { detail: loginInfo }),
  );
}

function addSite(org, site) {
  if (!org || !site) {
    return false;
  }

  const profileInfo = JSON.parse(localStorage.getItem('aem-profile-info') || '{}');
  if (!profileInfo[org]) {
    profileInfo[org] = { sites: [] };
  }
  if (profileInfo[org].sites.includes(site)) {
    alert(`${site} already exists in ${org}.`);
    return false;
  }
  profileInfo[org].sites.push(site);
  localStorage.setItem('aem-profile-info', JSON.stringify(profileInfo));
  return true;
}

function deleteSite(org, site) {
  const profileInfo = JSON.parse(localStorage.getItem('aem-profile-info') || '{}');
  const deletable = profileInfo[org].sites.includes(site);
  if (!deletable) {
    alert('This project can only be removed from your sidekick. Click "Manage projects" in the sidekick menu or the extension\'s context menu to do so.');
    return false;
  }
  profileInfo[org].sites = profileInfo[org].sites.filter((s) => s !== site);
  if (profileInfo[org].sites.length === 0) {
    delete profileInfo[org];
  }
  localStorage.setItem('aem-profile-info', JSON.stringify(profileInfo));
  return true;
}

function createLoginButton(org, loginInfo, closeModal) {
  const loggedIn = Array.isArray(loginInfo) && loginInfo.includes(org);
  const action = loggedIn ? 'logout' : 'login';

  const loginButton = document.createElement('button');
  loginButton.id = `profile-login-${org}`;
  loginButton.classList.add('button', action);
  loginButton.textContent = loggedIn ? 'Sign out' : 'Sign in';
  loginButton.title = loggedIn ? `Sign out of ${org}` : `Sign in to ${org}`;
  if (loggedIn) {
    loginButton.className = 'button logout outline';
  } else {
    loginButton.className = 'button login';
  }

  loginButton.addEventListener('click', async ({ target }) => {
    if (loginInfo === NO_SIDEKICK) {
      if (confirm('AEM Sidekick is required to sign in. Install now?')) {
        window.open('https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml', '_blank');
      }
      return;
    }

    loginButton.disabled = true;

    // check and remove ops mode
    const opsMode = target.classList.contains('ops');
    document.querySelectorAll('#profile-modal button').forEach((button) => button.classList.remove('ops'));

    const selectedSite = target.closest('li').querySelector(`input[name="profile-${org}-site"]:checked`)?.value;

    const loginUrl = new URL(`https://admin.hlx.page/${action}/${org}/${selectedSite}/main`);
    if (!loggedIn) {
      if (opsMode) {
        loginUrl.searchParams.append('idp', 'microsoft');
        loginUrl.searchParams.append('tenant', 'common');
        loginUrl.searchParams.append('selectAccount', true);
      }
    }
    loginUrl.searchParams.append('extensionId', getSidekickId());
    const loginWindow = window.open(loginUrl.toString(), '_blank');

    // wait for login window to be closed, then dispatch event
    const checkLoginWindow = setInterval(async () => {
      if (loginWindow.closed) {
        clearInterval(checkLoginWindow);
        loginButton.disabled = false;
        setTimeout(async () => {
          const newLoginInfo = await getLoginInfo();
          loginButton.replaceWith(createLoginButton(org, newLoginInfo));
          dispatchProfileUpdateEvent(newLoginInfo, org, selectedSite, action);
        }, 200);
        if (closeModal) {
          // close modal after login
          document.querySelector('#profile-modal').close();
        }
      }
    }, 500);
    // stop waiting after 60 seconds
    setTimeout(() => clearInterval(checkLoginWindow), 60000);
  });

  // enter ops mode if alt key is pressed
  window.addEventListener('keydown', ({ altKey }) => {
    if (altKey) {
      document.querySelectorAll('#profile-modal button').forEach((button) => button.classList.add('ops'));
    }
  });
  window.addEventListener('keyup', ({ altKey }) => {
    if (!altKey) {
      document.querySelectorAll('#profile-modal button').forEach((button) => button.classList.remove('ops'));
    }
  });

  return loginButton;
}

function updateButtons(dialog, orgs, focusedOrg) {
  const wrapper = dialog.querySelector('.button-wrapper');

  let addButton = dialog.querySelector('#profile-add-project');
  if (!addButton) {
    // form to add new project
    const form = document.createElement('form');
    form.classList.add('profile-add-form');
    form.action = '#';
    form.innerHTML = `
      <p>Add a new project:</p>
      <input type="text" id="profile-add-org" placeholder="org" mandatory="true" value="${orgs[0] || ''}">
      <input type="text" id="profile-add-site" placeholder="site" mandatory="true">
      <div class="button-wrapper">
        <button class="button " type="submit" id="profile-add-save">Save</button>
        <button class="button outline" type="reset" id="profile-add-cancel">Cancel</button>
      </div>
    `;

    // button to add new project
    addButton = document.createElement('button');
    addButton.id = 'profile-add-project';
    addButton.classList.add('button', 'outline');
    addButton.textContent = 'Add project';
    addButton.addEventListener('click', ({ target }) => {
      target.closest('dialog').querySelectorAll('button, input').forEach((control) => {
        control.disabled = true;
      });
      dialog.append(form);

      const resetForm = () => {
        form.remove();
        target.closest('dialog').querySelectorAll('button, input').forEach((control) => {
          control.disabled = false;
        });
      };

      const orgField = form.querySelector('#profile-add-org');
      orgField.focus();
      if (orgField.value) {
        orgField.select();
      }
      form.addEventListener('submit', async () => {
        const org = form.querySelector('#profile-add-org').value;
        const site = form.querySelector('#profile-add-site').value;
        if (addSite(org, site)) {
          resetForm();
          // eslint-disable-next-line no-use-before-define
          await updateProjects(dialog, focusedOrg);
          // select new site and focus login button
          dialog.querySelector(`#profile-projects .profile-sites > li[data-name="${site}"] input`).checked = true;
          dialog.querySelector(`#profile-projects .profile-orgs > li[data-name="${org}"] .button.login`).focus();
        }
      });
      form.addEventListener('reset', resetForm);
    });
    wrapper.append(addButton);
  }

  let editButton = dialog.querySelector('#profile-edit-projects');
  if (!editButton && orgs.length > 0) {
    // button to edit projects
    const isEditMode = dialog.classList.contains('edit-mode');
    editButton = document.createElement('button');
    editButton.id = 'profile-edit-projects';
    editButton.classList.add('button', isEditMode ? 'accent' : 'outline');
    editButton.textContent = isEditMode ? 'Done' : 'Edit projects';
    editButton.addEventListener('click', ({ target }) => {
      dialog.classList.toggle('edit-mode');
      target.classList.toggle('outline');
      target.classList.toggle('accent');
      target.textContent = dialog.classList.contains('edit-mode') ? 'Done' : 'Edit projects';
    });
    wrapper.append(editButton);
  } else if (editButton && orgs.length === 0) {
    editButton.remove();
  }
}

async function updateProjects(dialog, focusedOrg) {
  const profileInfo = JSON.parse(localStorage.getItem('aem-profile-info') || '{}');
  const loginInfo = await getLoginInfo();

  // merge with projects from sidekick if available
  const sidekickProjects = await messageSidekick({ action: 'getSites' });

  if (Array.isArray(sidekickProjects)) {
    sidekickProjects.forEach(({ org, site }) => {
      if (!profileInfo[org]) {
        profileInfo[org] = { sites: [] };
      }
      profileInfo[org].sites.push(site);
    });
  }

  // list orgs
  const orgList = document.createElement('ul');
  orgList.classList.add('profile-orgs');
  const orgs = Object.keys(profileInfo)
    .filter((org) => !focusedOrg || org === focusedOrg)
    .filter((org) => Array.isArray(profileInfo[org].sites)
      && profileInfo[org].sites.length > 0)
    .sort();

  orgs.forEach((org) => {
    const orgItem = document.createElement('li');
    orgItem.dataset.name = org;
    const orgTitle = document.createElement('h3');
    orgTitle.textContent = org;
    orgItem.append(orgTitle);
    if (Array.isArray(loginInfo) && loginInfo.includes(org)) {
      orgItem.classList.add('signed-in');
    }
    orgTitle.append(createLoginButton(org, loginInfo, !!focusedOrg));

    // list sites within org
    const sitesList = document.createElement('ul');
    sitesList.classList.add('profile-sites');
    const { sites = [] } = profileInfo[org];
    sites.sort().forEach((site, i) => {
      if (!site) {
        return;
      }
      const siteItem = document.createElement('li');
      siteItem.dataset.name = site;
      siteItem.innerHTML = `
        <input type="radio" id="profile-${org}-site-${i}" name="profile-${org}-site" value="${site}">
        <label for="profile-${org}-site-${i}">${site}</label>
        <a
          target="_blank"
          href="https://main--${site}--${org}.aem.page/"
          title="Open ${site}"
        ><span class="external-link"></span></a>
      `;
      if (i === 0) {
        siteItem.querySelector('input').checked = true;
      }
      const deleteButton = document.createElement('button');
      deleteButton.classList.add('cross');
      deleteButton.title = `Delete ${site} from ${org}`;
      deleteButton.addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete ${site} from ${org}?`)) {
          deleteSite(org, site);
          updateProjects(dialog, focusedOrg);
        }
      });
      siteItem.append(deleteButton);
      sitesList.append(siteItem);
    });
    orgItem.append(sitesList);
    orgList.append(orgItem);
  });

  const projects = dialog.querySelector('#profile-projects');
  projects.innerHTML = `
    <p>${orgs.length > 0 ? 'Sign into a project below to use this tool. Note that you may neeed to allow pop-ups from this site.' : 'No projects found'}</p>
  `;
  projects.append(orgList);

  updateButtons(dialog, orgs, focusedOrg);

  return profileInfo;
}

async function showModal(block, focusedOrg) {
  let dialog = block.querySelector('dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.classList.add('modal');
    dialog.id = 'profile-modal';
    dialog.closedBy = 'any';
    block.append(dialog);
  }

  dialog.innerHTML = `
    <h2>Projects</h2>
    <div id="profile-projects"></div>
    <div class="button-wrapper"></div>
  `;

  await updateProjects(dialog, focusedOrg);

  const closeButton = document.createElement('button');
  closeButton.id = 'profile-close';
  closeButton.classList.add('cross');
  closeButton.textContent = 'Close';
  closeButton.title = closeButton.textContent;
  closeButton.addEventListener('click', () => dialog.close());
  dialog.append(closeButton);

  dialog.addEventListener('close', () => {
    dialog.classList.remove('edit-mode');
  });

  dialog.showModal();
}

export default async function decorate(block) {
  const avatar = document.createElement('button');
  avatar.innerHTML = `
    <span class="icon" title="Sign in">
      <img src="/icons/user.svg" alt="User">
    </span>
  `;
  avatar.id = 'profile';
  avatar.href = window.location.href;
  avatar.classList.add('profile');
  avatar.addEventListener('click', (e) => {
    e.preventDefault();
    showModal(block);
  });
  block.append(avatar);
}

/**
 * Ensures the user is logged in to a specified org/site.
 * @param {string} org The login org.
 * @param {string} site The login site.
 * @returns {Promise<boolean>} True if logged in, false otherwise.
 */
export async function ensureLogin(org, site) {
  const loginInfo = await getLoginInfo();
  const loggedIn = Array.isArray(loginInfo) && loginInfo.includes(org);
  if (!loggedIn) {
    // show the profile modal
    const block = document.querySelector('header .profile');
    await showModal(block, org);

    const orgItems = [...block.querySelectorAll('#profile-projects .profile-orgs > li')];
    const orgItem = orgItems.find((li) => li.dataset.name === org);
    if (orgItem) {
      // remove other orgs
      orgItems.forEach((li) => {
        if (li !== orgItem) {
          li.remove();
        }
      });
    }
    const siteItem = orgItem?.querySelector(`li[data-name="${site}"]`);
    if (orgItem && siteItem) {
      // select site and place focus on login button
      siteItem.querySelector('input[type="radio"]').checked = true;
      orgItem.querySelector('.button.login').focus();
    } else {
      // open and prefill add project form
      const addButton = block.querySelector('#profile-add-project');
      addButton.click();
      block.querySelector('#profile-add-org').value = org;
      block.querySelector('#profile-add-site').value = site;
      block.querySelector('#profile-add-save').focus();
    }
    return false;
  }
  return true;
}
