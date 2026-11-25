/* eslint-disable no-restricted-globals, no-alert, no-await-in-loop */

import {
  getSidekickId,
  messageSidekick,
  NO_SIDEKICK,
} from '../../utils/sidekick.js';
import { createImsLogin } from '../../utils/ims.js';

// created with the block rather than the dialog, so imslib loads with the page
let imsLogin;

async function getLoginInfo() {
  return messageSidekick({ action: 'getAuthInfo' });
}

function dispatchProfileEvent(event, detail = {}) {
  window.dispatchEvent(
    new CustomEvent(`profile-${event}`, { detail }),
  );
}

function confirmInstallSidekick(resp) {
  if (resp === NO_SIDEKICK && confirm('AEM Sidekick is required to manage projects. Install now?')) {
    window.open('https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml', '_blank');
  }
}

function isOpsMode(target) {
  return window.localStorage.getItem('aem-ops-mode') === 'true'
    || !!target?.classList.contains('ops');
}

async function waitForSiteAdded(org, site) {
  for (let i = 0; i < 5; i += 1) {
    const sites = await messageSidekick({ action: 'getSites' });
    if (!Array.isArray(sites)) {
      confirmInstallSidekick(sites);
      return false;
    }
    if (sites.find((s) => s.org === org && s.site === site)) {
      return true;
    }
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  return false;
}

async function addSite(org, site, opsMode = false) {
  if (!org || !site) {
    return false;
  }

  const sites = await messageSidekick({ action: 'getSites' });
  if (!Array.isArray(sites)) {
    confirmInstallSidekick(sites);
    return false;
  }
  if (sites.find((s) => s.org === org && s.site === site)) {
    alert(`${site} already exists in ${org}.`);
    return false;
  }

  await messageSidekick({
    action: 'addSite',
    config: { org, site },
    idp: opsMode ? 'microsoft' : undefined,
    tenant: opsMode ? 'common' : undefined,
  }, null, 10000);

  if (await waitForSiteAdded(org, site)) {
    return true;
  }

  alert('Failed to add project. Please try again.');
  return false;
}

async function removeSite(org, site) {
  if (!org || !site) {
    return false;
  }

  const sites = await messageSidekick({ action: 'getSites' });
  if (!Array.isArray(sites)) {
    confirmInstallSidekick();
    return false;
  }
  if (!sites.find((s) => s.org === org && s.site === site)) {
    alert(`${site} does not exist in ${org}.`);
    return false;
  }

  return messageSidekick({
    action: 'removeSite',
    config: { org, site },
  });
}

async function fetchUserInfo(userInfoElem, org, site, loginInfo) {
  let userInfo = '';
  if (Array.isArray(loginInfo) && loginInfo.includes(org)) {
    const resp = await fetch(`https://admin.hlx.page/profile/${org}/${site}`);
    if (resp.ok) {
      const { profile } = await resp.json();
      if (profile) {
        userInfo = `(${profile.email})`;
      }
    }
  }
  userInfoElem.textContent = userInfo;
}

function createLoginButton(org, loginInfo) {
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
    if (!Array.isArray(loginInfo)) {
      confirmInstallSidekick(loginInfo);
      return;
    }

    loginButton.disabled = true;

    // check and remove ops mode
    const opsMode = isOpsMode(target);
    document.querySelectorAll('#profile-modal button').forEach((button) => button.classList.remove('ops'));

    const selectedSite = target.closest('li').querySelector(`input[name="profile-${org}-site"]:checked`)?.value;

    const loginUrl = new URL(`https://admin.hlx.page/${action}/${org}/${selectedSite}/main`);
    if (!loggedIn) {
      if (opsMode) {
        loginUrl.searchParams.append('idp', 'microsoft');
        loginUrl.searchParams.append('tenantId', 'common');
        loginUrl.searchParams.append('selectAccount', true);
      }
    }
    loginUrl.searchParams.append('extensionId', getSidekickId());
    const loginWindow = window.open(loginUrl.toString(), '_blank');

    // 60s safety net: fire `profile-cancelled` if the login window is left open.
    let giveUpTimer;

    // wait for login window to be closed, then dispatch event
    const checkLoginWindow = setInterval(async () => {
      if (loginWindow.closed) {
        clearInterval(checkLoginWindow);
        clearTimeout(giveUpTimer);
        loginButton.disabled = false;
        setTimeout(async () => {
          const newLoginInfo = await getLoginInfo();
          const orgTitle = loginButton.parentElement.parentElement;
          loginButton.replaceWith(createLoginButton(org, newLoginInfo));
          fetchUserInfo(orgTitle.querySelector('.user-info'), org, selectedSite, newLoginInfo);
          dispatchProfileEvent('update', newLoginInfo);
        }, 200);
      }
    }, 500);

    giveUpTimer = setTimeout(() => {
      clearInterval(checkLoginWindow);
      loginButton.disabled = false;
      dispatchProfileEvent('cancelled');
    }, 60000);
  });

  return loginButton;
}

function updateButtons(dialog, orgs) {
  const wrapper = dialog.querySelector('.button-wrapper');

  let addButton = dialog.querySelector('#profile-add-project');
  if (!addButton) {
    // button to add new project
    addButton = document.createElement('button');
    addButton.id = 'profile-add-project';
    addButton.classList.add('button', 'outline');
    addButton.textContent = 'Add project';
    addButton.addEventListener('click', ({ target }) => {
      target.closest('dialog').querySelectorAll('button, input').forEach((control) => {
        control.disabled = true;
      });

      // form to add new project
      const form = document.createElement('form');
      form.classList.add('profile-add-form');
      form.action = '#';
      form.innerHTML = `
        <p>Add a new project:</p>
        <input type="text" id="profile-add-org" placeholder="org" required value="${orgs[0] || ''}">
        <input type="text" id="profile-add-site" placeholder="site" required>
        <div class="button-wrapper">
          <button class="button " type="submit" id="profile-add-save">Save</button>
          <button class="button outline" type="reset" id="profile-add-cancel">Cancel</button>
        </div>
      `;
      dialog.append(form);
      form.querySelectorAll('input').forEach((input) => {
        input.addEventListener('change', () => {
          input.value = input.value.toLowerCase();
        });
      });

      const resetForm = () => {
        form.querySelector('button').disabled = false;
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
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const org = form.querySelector('#profile-add-org').value.trim().toLowerCase();
        const site = form.querySelector('#profile-add-site').value.trim().toLowerCase();
        const opsMode = isOpsMode(target);

        if (!org || !site) {
          alert('Please provide an org and site.');
          return;
        }

        form.querySelectorAll('button, input').forEach((control) => {
          control.disabled = true;
        });

        if (await addSite(org, site, opsMode)) {
          setTimeout(async () => {
            resetForm();
            // eslint-disable-next-line no-use-before-define
            await updateProjects(dialog);
            // select new site and focus login button
            dialog.querySelector(`#profile-projects .profile-sites > li[data-name="${site}"] input`).checked = true;
            dialog.querySelector(`#profile-projects .profile-orgs > li[data-name="${org}"] .button`).focus();
          }, 600);
        } else {
          resetForm();
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

/**
 * Lists the projects the tools used successfully in this browser (utils/config/config.js),
 * most recent first, laid out like the sidekick's projects.
 * @returns {HTMLUListElement|null} The list, or null if there are none
 */
function createRecentProjectList() {
  const recent = JSON.parse(window.localStorage.getItem('aem-projects'));
  // an org used without a site isn't a project
  const orgs = (recent?.orgs || []).filter((org) => recent.sites?.[org]?.length > 0);
  if (orgs.length === 0) return null;

  const orgList = document.createElement('ul');
  orgList.classList.add('profile-orgs');
  orgs.forEach((org) => {
    const orgItem = document.createElement('li');
    orgItem.dataset.name = org;
    const orgTitle = document.createElement('h3');
    orgTitle.textContent = org;
    const sitesList = document.createElement('ul');
    sitesList.classList.add('profile-sites');
    recent.sites[org].forEach((site) => {
      const siteItem = document.createElement('li');
      siteItem.dataset.name = site;
      const name = document.createElement('span');
      name.textContent = site;
      const link = document.createElement('a');
      link.target = '_blank';
      link.href = `https://main--${site}--${org}.aem.page/`;
      link.title = `Open ${site}`;
      link.innerHTML = '<span class="external-link"></span>';
      siteItem.append(name, link);
      sitesList.append(siteItem);
    });
    orgItem.append(orgTitle, sitesList);
    orgList.append(orgItem);
  });
  return orgList;
}

async function updateProjects(dialog) {
  let updatedProjects = await messageSidekick({ action: 'getSites' });
  // no install prompt: the Adobe sign-in in this dialog works without the sidekick
  if (!Array.isArray(updatedProjects)) {
    updatedProjects = [];
  }

  // sort projects by org
  const profileInfo = {};
  updatedProjects.forEach((project) => {
    const { org } = project;
    if (!profileInfo[org]) {
      profileInfo[org] = { sites: [] };
    }
    profileInfo[org].sites.push({
      site: project.repo,
      title: project.project || '',
    });
  });

  const loginInfo = await getLoginInfo();

  // list orgs
  const orgList = document.createElement('ul');
  orgList.classList.add('profile-orgs');
  const orgs = Object.keys(profileInfo)
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
    const userInfo = document.createElement('span');
    userInfo.classList.add('user-info');
    orgTitle.append(userInfo);
    orgTitle.append(createLoginButton(org, loginInfo));

    // list sites within org
    const sitesList = document.createElement('ul');
    sitesList.classList.add('profile-sites');
    const { sites = [] } = profileInfo[org];
    sites.sort().forEach(({ site, title }, i) => {
      if (!site) {
        return;
      }
      if (i === 0) {
        fetchUserInfo(userInfo, org, site, loginInfo);
      }
      const siteItem = document.createElement('li');
      siteItem.dataset.name = site;
      siteItem.innerHTML = `
        <input type="radio" id="profile-${org}-site-${i}" name="profile-${org}-site" value="${site}">
        <label for="profile-${org}-site-${i}">${title || site}</label>
        <a
          target="_blank"
          href="https://main--${site}--${org}.aem.page/"
          title="Open ${site}"
        ><span class="external-link"></span><span class="user-info"></span></a>
      `;

      if (i === 0) {
        siteItem.querySelector('input').checked = true;
      }
      const deleteButton = document.createElement('button');
      deleteButton.classList.add('cross');
      deleteButton.title = `Delete ${site} from ${org}`;
      deleteButton.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete ${site} from ${org}?`)) {
          if (await removeSite(org, site)) {
            setTimeout(async () => {
              await updateProjects(dialog);
            }, 500);
          }
        }
      });
      siteItem.append(deleteButton);
      sitesList.append(siteItem);
    });
    orgItem.append(sitesList);
    orgList.append(orgItem);
  });

  // without sidekick projects, list those used in this browser instead. Never both: the tools
  // copy the sidekick's projects into theirs (utils/config/config.js)
  const recentList = orgs.length > 0 ? null : createRecentProjectList();
  let intro = 'Projects you use in the tools appear here.';
  if (orgs.length > 0) {
    intro = 'Sign in to a project below with the AEM Sidekick. Note: You may need to allow pop-ups from this site.';
  } else if (recentList) {
    intro = "Projects you've used in this browser.";
  }
  const projects = dialog.querySelector('#profile-projects');
  projects.innerHTML = `<p>${intro}</p>`;
  projects.append(recentList || orgList);

  updateButtons(dialog, orgs);

  return profileInfo;
}

async function showModal(block) {
  let dialog = block.querySelector('dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.classList.add('profile-modal');
    dialog.id = 'profile-modal';
    dialog.closedBy = 'any';
    // enter ops mode if alt key is held — registered once here so it covers
    // all buttons including dynamically added ones (e.g. Add project form)
    window.addEventListener('keydown', ({ altKey }) => {
      if (altKey) {
        dialog.querySelectorAll('button').forEach((button) => button.classList.add('ops'));
      }
    });
    window.addEventListener('keyup', ({ altKey }) => {
      if (!altKey) {
        dialog.querySelectorAll('button').forEach((button) => button.classList.remove('ops'));
      }
    });
    // Bind once — the dialog is reused; rebinding stacks duplicate emissions.
    dialog.addEventListener('close', () => {
      dialog.classList.remove('edit-mode');
      // Fires on every close, including post-login. Listeners that care about
      // the login outcome should observe `profile-update` (dispatched first)
      // and remove themselves before this fires.
      dispatchProfileEvent('cancelled');
    });
    block.append(dialog);
  }

  dialog.innerHTML = `
    <h2>Adobe account</h2>
    <div id="profile-ims"></div>
    <h2>Projects</h2>
    <div id="profile-projects"></div>
    <div class="button-wrapper"></div>
  `;
  dialog.querySelector('#profile-ims').append(imsLogin);

  await updateProjects(dialog);

  const closeButton = document.createElement('button');
  closeButton.id = 'profile-close';
  closeButton.classList.add('cross');
  closeButton.textContent = 'Close';
  closeButton.title = closeButton.textContent;
  closeButton.addEventListener('click', () => dialog.close());
  dialog.append(closeButton);

  dialog.showModal();
}

export default async function decorate(block) {
  imsLogin = createImsLogin();
  const avatar = document.createElement('button');
  avatar.innerHTML = `
    <span class="icon">
      <img src="/blocks/profile/profile.svg" alt="User">
    </span>
  `;
  avatar.id = 'profile';
  avatar.setAttribute('type', 'button');
  avatar.setAttribute('title', 'Manage projects and sign in');
  avatar.href = window.location.href;
  avatar.addEventListener('click', (e) => {
    e.preventDefault();
    showModal(block);
  });
  block.append(avatar);
  dispatchProfileEvent('loaded');
}
