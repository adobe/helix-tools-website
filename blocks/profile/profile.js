/* eslint-disable no-restricted-globals, no-alert */

import {
  getSidekickId,
  messageSidekick,
} from './sidekick.js';

async function getLoginInfo() {
  return new Promise((resolve) => {
    messageSidekick({ action: 'getAuthInfo' }, (res) => resolve(res));
    setTimeout(() => resolve(null), 500);
  });
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

async function updateLoginButton(loginButton, org, loginInfo) {
  const loggedIn = Array.isArray(loginInfo) && loginInfo.includes(org);
  loginButton.textContent = loggedIn ? 'Sign out' : 'Sign in';
  loginButton.title = loggedIn ? `Sign out of ${org}` : `Sign in to ${org}`;
  if (loggedIn) {
    loginButton.classList.add('outline');
  } else {
    loginButton.classList.remove('outline');
  }
}

function createLoginButton(org, loginInfo, closeModal) {
  const loginButton = document.createElement('button');
  loginButton.id = `profile-login-${org}`;

  updateLoginButton(loginButton, org, loginInfo);

  const loggedIn = Array.isArray(loginInfo) && loginInfo.includes(org);
  const action = loggedIn ? 'logout' : 'login';

  loginButton.classList.add('button', action);
  loginButton.addEventListener('click', async ({ target }) => {
    if (loginInfo === null) {
      if (confirm('AEM Sidekick is required to sign in. Install now?')) {
        window.open('https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml', '_blank');
      }
      return;
    }

    loginButton.disabled = true;

    const selectedSite = target.closest('li').querySelector(`input[name="profile-${org}-site"]:checked`)?.value;

    const loginUrl = new URL(`https://admin.hlx.page/${action}/${org}/${selectedSite}/main`);
    const opsMode = loginButton.classList.contains('ops');
    if (!loggedIn && opsMode) {
      loginUrl.searchParams.append('idp', 'microsoft');
      loginUrl.searchParams.append('tenant', 'common');
      loginUrl.searchParams.append('selectAccount', true);
    }
    loginUrl.searchParams.append('extensionId', getSidekickId());
    const loginWindow = window.open(loginUrl.toString(), '_blank');

    // wait for login window to be closed, then dispatch event
    const checkLoginWindow = setInterval(async () => {
      if (loginWindow.closed) {
        clearInterval(checkLoginWindow);
        loginButton.disabled = false;
        const newLoginInfo = await getLoginInfo();
        updateLoginButton(loginButton, org, newLoginInfo);
        dispatchProfileUpdateEvent(newLoginInfo, org, selectedSite, action);
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

async function updateProjects(dialog, focusedOrg) {
  const profileInfo = JSON.parse(localStorage.getItem('aem-profile-info') || '{}');
  const loginInfo = await getLoginInfo();

  // merge with projects from sidekick if available
  const sidekickProjects = await new Promise((resolve) => {
    messageSidekick({ action: 'getSites' }, (res) => resolve(res));
    setTimeout(() => resolve([]), 500);
  });

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
  const orgs = Object.keys(profileInfo);
  orgs
    .filter((org) => !focusedOrg || org === focusedOrg)
    .sort()
    .forEach((org) => {
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
        sitesList.append(siteItem);
      });
      orgItem.append(sitesList);
      orgList.append(orgItem);
    });

  const projects = dialog.querySelector('#profile-projects');
  projects.innerHTML = `
    <p>${orgs.length > 0 ? 'Sign in below to use this tool:' : 'No projects found'}</p>
  `;
  projects.append(orgList);

  return profileInfo;
}

async function showModal(block, focusedOrg) {
  let dialog = block.querySelector('dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.classList.add('modal');
    dialog.id = 'profile-modal';
    block.append(dialog);
  }

  dialog.innerHTML = `
    <h2>Projects</h2>
    <div id="profile-projects"></div>
  `;

  await updateProjects(dialog, focusedOrg);

  const firstOrg = dialog.querySelector('#profile-projects li')?.dataset.name || '';

  // form to add new project
  const form = document.createElement('form');
  form.classList.add('profile-add-form');
  form.action = '#';
  form.innerHTML = `
    <p>Add a new project:</p>
    <input type="text" id="profile-add-org" placeholder="org" mandatory="true" value="${firstOrg}">
    <input type="text" id="profile-add-site" placeholder="site" mandatory="true">
    <div class="button-wrapper">
      <button class="button " type="submit" id="profile-add-save">Save</button>
      <button class="button outline" type="reset" id="profile-add-cancel">Cancel</button>
    </div>
  `;

  // button to add new project
  const addButton = document.createElement('button');
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
        await updateProjects(dialog, focusedOrg);
        block.querySelector(`#profile-projects .profile-sites > li[data-name="${site}"] input`).checked = true;
        block.querySelector(`#profile-projects .profile-orgs > li[data-name="${org}"] .button.login`).focus();
      }
    });
    form.addEventListener('reset', resetForm);
  });
  dialog.append(addButton);

  const closeButton = document.createElement('button');
  closeButton.classList.add('profile-close');
  closeButton.textContent = 'Close';
  closeButton.title = closeButton.textContent;
  closeButton.addEventListener('click', () => dialog.close());
  dialog.append(closeButton);

  dialog.showModal();
}

export default async function decorate(block) {
  const avatar = document.createElement('a');
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
  const loginInfo = await new Promise((resolve) => {
    messageSidekick({ action: 'getAuthInfo' }, (res) => resolve(res));
    setTimeout(() => resolve(null), 200);
  });
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
    const siteItem = orgItem.querySelector(`li[data-name="${site}"]`);
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
