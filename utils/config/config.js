import { loadCSS } from '../../scripts/aem.js';

/**
 * Validates the existence and type of config elements.
 * @returns {Object|boolean} - Object containing config elements, or `false` if any are invalid.
 */
function validDOM() {
  const config = document.querySelector('.config-field');
  if (!config) return false;

  const params = {
    org: { id: 'org', tag: 'INPUT' },
    orgList: { id: 'org-list', tag: 'DATALIST' },
    site: { id: 'site', tag: 'INPUT' },
    siteList: { id: 'site-list', tag: 'DATALIST' },
  };

  const els = {};
  Object.keys(params).forEach((key) => {
    const { id, tag } = params[key];
    const el = config.querySelector(`#${id}`);
    if (el && el.nodeName === tag) {
      els[key] = el;
    }
  });

  return Object.keys(els).length === Object.keys(params).length ? els : false;
}

/**
 * Sets field value and marks as autofilled (if it hasn't been autofilled already).
 * @param {HTMLElement} field - Input field.
 * @param {string} value - Value to set.
 * @returns {string} the fields new value
 */
function setFieldValue(field, value, type) {
  if (!field.dataset.autofill) {
    field.value = value;
    field.dataset.autofill = type;
    field.dispatchEvent(new Event('input'));
  }

  return field.value;
}

/**
 * Populates datalist with options (if options aren't already in datalist).
 * @param {HTMLElement} list - Datalist element.
 * @param {string[]} values - Array of values to populate as options.
 */
function populateList(list, values) {
  values.forEach((value) => {
    if (value && ![...list.options].some((o) => o.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      list.append(option);
    }
  });
}

/**
 * Resets site datalist based on the selected org.
 * @param {string} org - Organization name.
 * @param {HTMLInputElement} site - Site input element.
 * @param {HTMLDatalistElement} list - Site datalist element to populate with options.
 */
function resetSiteListForOrg(org, site, list) {
  // clear site list
  while (list.firstChild) list.removeChild(list.firstChild);
  // repopulate site and site list from storage
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (projects && projects.sites && projects.sites[org]) {
    site.value = projects.sites[org][0] || '';
    populateList(list, projects.sites[org]);
  }
}

/**
 * Updates URL params based on org/site data.
 * @param {Array.<HTMLInputElement>} fields - Array of input fields.
 */
function updateParams(fields) {
  const url = new URL(window.location.href);
  url.search = ''; // clear existing params
  fields.forEach((field) => {
    if (field.value) {
      url.searchParams.set(field.id, field.value);
    }
  });
  window.history.replaceState({}, document.title, url.href);
}

/**
 * Updates local storage with most recently used org and site.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 */
function updateStorage(org, site) {
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (projects) {
    // ensure org is most recent in orgs array
    if (projects.orgs.includes(org)) {
      projects.orgs = projects.orgs.filter((o) => o !== org);
    }
    projects.orgs.unshift(org);
    // ensure site is most recent in site array
    if (projects.sites[org]) {
      if (projects.sites[org].includes(site)) {
        projects.sites[org] = projects.sites[org].filter((s) => s !== site);
      }
      projects.sites[org].unshift(site);
    } else {
      projects.sites[org] = [site];
    }
    localStorage.setItem('aem-projects', JSON.stringify(projects));
  } else {
    // init project org and site storage
    const project = {
      orgs: [org],
      sites: { [org]: [site] },
    };
    localStorage.setItem('aem-projects', JSON.stringify(project));
  }
}

/**
 * Adds all sidekick projects to storage data
 * Since no order guarantee is made for sidekick projects, just add them at end of lists.
 */
function updateStorageFromSidekick(projects) {
  let aemProjects = JSON.parse(localStorage.getItem('aem-projects'));
  if (!aemProjects) {
    aemProjects = { orgs: [], sites: {} };
  }

  projects.forEach(({ org, site }) => {
    if (!aemProjects.orgs.includes(org)) {
      aemProjects.orgs.push(org);
    }

    if (!aemProjects.sites[org]) {
      aemProjects.sites[org] = [];
    }

    if (!aemProjects.sites[org].includes(site)) {
      aemProjects.sites[org].push(site);
    }
  });

  localStorage.setItem('aem-projects', JSON.stringify(aemProjects));
}

/**
 * Updates URL parameters, local storage, and datalists based on org/site values.
 */
export function updateConfig() {
  const cfg = validDOM();
  if (cfg) {
    updateParams([cfg.org, cfg.site]);
    updateStorage(cfg.org.value, cfg.site.value);
    populateList(cfg.orgList, [cfg.org.value]);
    populateList(cfg.siteList, [cfg.site.value]);
  }
}

/**
 * Populates org/site fields with values from URL params.
 * @param {Array.<HTMLInputElement>} fields - Array of input elements.
 * @param {string} search - URL search string.
 */
function populateFromParams(fields, search) {
  const params = new URLSearchParams(search);
  if (params && params.size > 0) {
    fields.forEach((field) => {
      const param = params.get(field.id);
      if (param) {
        setFieldValue(field, param, 'params');
      }
    });
  }
}

/**
 * Populates org and site fields from local storage.
 */
function populateFromStorage(org, orgList, site, siteList) {
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (projects) {
    if (projects.orgs && projects.orgs[0]) {
      // populate org list
      const { orgs } = projects;
      populateList(orgList, orgs);
      // populate org field
      const selectedOrg = setFieldValue(org, projects.orgs[0], 'storage');
      if (projects.sites && projects.sites[selectedOrg]) {
        // populate site list
        const sites = projects.sites[selectedOrg];
        populateList(siteList, sites);
        // populate site field
        const lastSite = sites[0];
        if (lastSite) setFieldValue(site, lastSite, 'storage');
      }
    }
  }
}

/**
 * Populates org field from sidekick.
 */
async function populateFromSidekick(org, orgList, site, siteList) {
  return new Promise((resolve) => {
    const { chrome } = window;
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      let messageResolved = false;
      const id = 'igkmdomcgoebiipaifhmpfjhbjccggml';
      chrome.runtime.sendMessage(id, { action: 'getSites' }, (projects) => {
        if (projects && projects.length > 0) {
          updateStorageFromSidekick(projects);

          const { orgs, sites } = projects.reduce((acc, part) => {
            if (!acc.orgs.includes(part.org)) acc.orgs.push(part.org);
            if (!acc.sites[part.org]) acc.sites[part.org] = [];
            if (!acc.sites[part.org].includes(part.site)) acc.sites[part.org].push(part.site);

            return acc;
          }, { orgs: [], sites: {} });

          // populate org list
          populateList(orgList, orgs);

          // populate org & site field
          const lastProject = projects[0];
          const selectedOrg = setFieldValue(org, lastProject.org, 'sidekick');

          populateList(siteList, sites[selectedOrg] || []);
          setFieldValue(site, sites[selectedOrg][0], 'sidekick');
        }

        messageResolved = true;
        resolve();
      });

      setTimeout(() => {
        if (!messageResolved) {
          // eslint-disable-next-line no-console
          console.warn('Sidekick message not resolved in time');
          resolve();
        }
      }, 500);
    } else {
      resolve();
    }
  });
}

async function populateConfig(config) {
  const {
    org, orgList, site, siteList,
  } = config;
  populateFromParams([org, site], window.location.search);
  populateFromStorage(org, orgList, site, siteList);
  await populateFromSidekick(org, orgList, site, siteList);
}

/**
 * Loads org/site config CSS and initializes config field datalists/values.
 */
export async function initConfigField() {
  const cfg = validDOM();

  if (cfg) {
    // enable site when org has value
    cfg.org.addEventListener('input', () => {
      cfg.site.disabled = !cfg.org.value;
    }, { once: true });

    // refresh site datalist to match org
    cfg.org.addEventListener('change', (e) => {
      resetSiteListForOrg(e.target.value, cfg.site, cfg.siteList);
    });

    await Promise.all([loadCSS('../../utils/config/config.css'), populateConfig(cfg)]);
  }
}
