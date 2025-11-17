import createLoginButton from '../../utils/login.js';
import { messageSidekick, NO_SIDEKICK } from '../../utils/sidekick.js';

/* eslint-disable no-alert */
const projectsElem = document.querySelector('div#projects');

function externalLink(url, text, iconOnly = false) {
  return `<a target="_blank" href="${url}" title="${text || ''}">
    ${iconOnly ? '<span class="project-admin-oinw"></span>' : text}</a>`;
}

function displayProjectForm(elem, config) {
  const { org, site, project } = config;
  const name = `${org}--${site}`;
  elem.innerHTML = `<form id=${name}>
      <fieldset>
        <div class="form-field url-field">
          <label for="${name}-project">Project name</label>
          <input value="${project || ''}" name="project" id="${name}-project" type="text"/>
          <div class="field-help-text">
            <p>
              The optional name for this project.
            </p>
          </div>
        </div>
        <p class="button-wrapper">
          <button id="${name}-save" class="button">Save</button>
          <button id="${name}-remove" class="button outline">Remove</button>
          <button id="${name}-cancel" class="button outline">Cancel</button>
        </p>
      </fieldset>
    </form>`;

  const fs = elem.querySelector('fieldset');
  const save = elem.querySelector(`#${name}-save`);
  save.addEventListener('click', async (e) => {
    fs.disabled = 'disabled';
    save.innerHTML += ' <i class="symbol symbol-loading"></i>';
    e.preventDefault();
    const success = await messageSidekick({
      action: 'updateSite',
      config: {
        org,
        site,
        project: elem.querySelector(`input[id="${name}-project"]`).value,
      },
    });
    if (success) {
      // eslint-disable-next-line no-use-before-define
      init();
    } else {
      // todo: error handling
    }
  });

  const remove = elem.querySelector(`#${name}-remove`);
  remove.addEventListener('click', async (e) => {
    e.preventDefault();
    fs.disabled = 'disabled';
    remove.innerHTML += ' <i class="symbol symbol-loading"></i>';
    const success = await messageSidekick({
      action: 'removeSite',
      config,
    });
    if (success) {
      // eslint-disable-next-line no-use-before-define
      init();
    } else {
      // todo: error handling
    }
  });

  const cancel = elem.querySelector(`#${name}-cancel`);
  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    // eslint-disable-next-line no-use-before-define
    elem.replaceWith(displayProject(config));
  });

  // focus and select first text field
  const input = elem.querySelector('input[type="text"]');
  input.focus();
  input.select();

  // cancel edit on escape
  const escHandler = ({ key }) => {
    if (key === 'Escape') {
      cancel.click();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function displayProject(config, editMode = false) {
  const {
    org, site, project, mountpoints, previewHost, host,
  } = config;
  const name = project || site;
  const previewUrl = `https://${previewHost || `main--${site}--${org}.aem.page`}/`;

  const li = document.createElement('li');
  li.innerHTML = `<div class="projects-project-title">
      <h4>${name} ${externalLink(previewUrl, 'Preview', true)}</h4>
      <button class="button outline" aria-hidden="${editMode}" title="Edit">Edit</button>
    </div>
    <div class="projects-project-details" aria-hidden="${editMode}">
      ${Array.isArray(mountpoints) && mountpoints.length >= 1 ? `<div>
        <div>Content:</div><div>${externalLink(mountpoints[0], new URL(mountpoints[0]).host)}</div>
      </div>` : ''}
      <div>
        <div>Preview:</div><div>${externalLink(previewUrl, new URL(previewUrl).host)}</div>
      </div>
      ${host ? `<div><div>Production: </div><div>${externalLink(host, host)}</div></div>` : ''}
    </div>`;

  const details = li.querySelector('.projects-project-details');
  const edit = li.querySelector('.projects-project-title > button');

  edit.addEventListener('click', async () => {
    displayProjectForm(li, config);
    edit.ariaHidden = true;
    details.ariaHidden = false;
  });

  return li;
}

function displayProjects(projects) {
  let message;
  if (projects === NO_SIDEKICK) {
    message = `No sidekick found. Make sure the ${externalLink('https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml?authuser=0&hl=en', 'AEM Sidekick')} extension is installed and enabled.`;
  } else if (!projects || projects.length === 0) {
    message = `No projects found. See the ${externalLink('https://www.aem.live/docs/sidekick#adding-your-project', 'sidekick documentation')} to find out how to add projects to your sidekick.`;
  } else {
    message = 'Manage the projects in your sidekick.';
  }
  projectsElem.ariaHidden = false;
  projectsElem.innerHTML = `<div class="default-content-wrapper"><p>${message}</p></div>`;

  if (projects === NO_SIDEKICK) {
    return;
  }

  const buttonBar = document.createElement('div');
  buttonBar.classList.add('projects-list-button-bar');
  // const addNew = document.createElement('button');
  // addNew.className = 'button';
  // addNew.textContent = 'Add new project ...';
  // addNew.addEventListener('click', () => {
  //   // todo: add new project
  // });
  // div.append(addNew);
  projectsElem.append(buttonBar);

  // sort projects by org
  const projectsByOrg = {};
  projects.forEach((project) => {
    const { org } = project;
    if (!projectsByOrg[org]) {
      projectsByOrg[org] = [];
    }
    projectsByOrg[org].push(project);
  });

  const sortedOrgs = Object.keys(projectsByOrg).sort((a, b) => a.localeCompare(b));
  sortedOrgs.forEach(async (org) => {
    const orgContainer = document.createElement('div');
    orgContainer.classList.add('projects-org');

    const titleBar = document.createElement('div');
    titleBar.classList.add('projects-title-bar');
    titleBar.innerHTML = `<h3>${org}</h3>`;
    const loginButton = await createLoginButton({
      org,
      site: projectsByOrg[org][0].site, // default to first site
      // eslint-disable-next-line no-use-before-define
      callback: () => setTimeout(() => init(), 1000), // refresh UI after login
    });
    loginButton.classList.add('outline');
    titleBar.append(loginButton);
    orgContainer.append(titleBar);

    // list sites for org
    const sitesList = document.createElement('ol');
    sitesList.classList.add('projects-list');
    sitesList.id = `projects-list-${org}`;
    projectsByOrg[org]
      .sort((a, b) => a.site.localeCompare(b.site))
      .forEach((project) => {
        sitesList.append(displayProject(project));
      });

    orgContainer.append(sitesList);
    projectsElem.append(orgContainer);
  });
}

async function init() {
  const projects = await messageSidekick({ action: 'getSites' }) || [];
  displayProjects(projects);

  // recheck authInfo every 10s and update login buttons
  setInterval(async () => {
    const updatedAuthInfo = await messageSidekick({ action: 'getAuthInfo' }) || [];
    document.querySelectorAll('input[id^="login-button-"]').forEach((loginPicker) => {
      const org = loginPicker.id.replace('login-button-', '');
      if (updatedAuthInfo.includes(org)) {
        loginPicker.value = 'Signed in';
        loginPicker.disabled = true;
        loginPicker.nextElementSibling.ariaHidden = true;
      } else {
        loginPicker.value = 'Sign in';
        loginPicker.disabled = false;
        loginPicker.nextElementSibling.ariaHidden = false;
      }
    });
  }, 10000);
}

init();
