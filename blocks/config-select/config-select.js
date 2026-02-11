import {
  populateList,
  resetSiteListForOrg,
  updateStorage,
  updateStorageFromSidekick,
} from '../../utils/config/config.js';
import {
  getSidekickId,
  messageSidekick,
} from '../../utils/sidekick.js';
import { logMessage, CONSOLE_LEVEL } from '../console/console.js';

function getConsoleBlock() {
  return document.querySelector('.console');
}

let currentOrg = '';
let currentSite = '';

/**
 * Reads aem-projects from localStorage and returns a flat MRU list of {org, site} pairs.
 * Uses the mru key for the top entries, then falls back to org→sites iteration for the rest.
 */
function getRecentSites() {
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (!projects || !projects.orgs) return [];

  const pairs = [];
  const seen = new Set();

  // mru entries first
  if (Array.isArray(projects.mru)) {
    projects.mru.forEach((entry) => {
      const [org, ...rest] = entry.split('/');
      const site = rest.join('/');
      if (org && site) {
        pairs.push({ org, site });
        seen.add(entry);
      }
    });
  }

  // fill remaining from org→sites
  projects.orgs.forEach((org) => {
    const sites = (projects.sites && projects.sites[org]) || [];
    sites.forEach((site) => {
      const key = `${org}/${site}`;
      if (!seen.has(key)) {
        pairs.push({ org, site });
        seen.add(key);
      }
    });
  });

  return pairs;
}

/**
 * Updates URL params to reflect current org/site.
 */
function updateParams(org, site) {
  const url = new URL(window.location.href);
  url.search = '';
  if (org) url.searchParams.set('org', org);
  if (site) url.searchParams.set('site', site);
  window.history.replaceState({}, document.title, url.href);
}

/**
 * Dispatches a config-update event on window.
 */
function dispatchConfigUpdate(org, site) {
  window.dispatchEvent(new CustomEvent('config-update', { detail: { org, site } }));
}

/**
 * Updates the button label to show current org/site.
 */
function updateButtonLabel(button) {
  const label = button.querySelector('.config-select-label');
  if (currentOrg && currentSite) {
    const site = `${currentOrg} / ${currentSite}`;
    label.textContent = site;
    button.title = site;
    button.setAttribute('aria-label', `Switch site (current: ${site})`);
  } else if (currentOrg) {
    label.textContent = currentOrg;
    button.title = currentOrg;
    button.setAttribute('aria-label', `Switch site (current: ${currentOrg})`);
  } else {
    label.textContent = 'Select site\u2026';
    button.title = 'Select site';
    button.setAttribute('aria-label', 'Select a site');
  }
}

/**
 * Fetches auth info from sidekick. Returns array of org names or NO_SIDEKICK.
 */
async function getAuthInfo() {
  return messageSidekick({ action: 'getAuthInfo' });
}

/**
 * Updates the user icon ring on the header button to reflect login state.
 */
async function updateButtonStatus(button) {
  const icon = button.querySelector('.config-select-icon');
  if (!icon || !currentOrg) return;

  const loginInfo = await getAuthInfo();
  const loggedIn = Array.isArray(loginInfo) && loginInfo.includes(currentOrg);

  icon.classList.remove('level-success', 'level-error');
  icon.classList.add('status-light', loggedIn ? 'level-success' : 'level-error');
}

/**
 * Checks if ops mode is active via localStorage or Alt-key.
 */
function isOpsMode(altKey) {
  return window.localStorage.getItem('aem-ops-mode') === 'true' || altKey;
}

const LOGIN_TIMEOUT = 120000;
const POST_LOGIN_SETTLE = 500;

/**
 * Triggers sign-in via the Sidekick extension.
 */
async function sidekickLogin(org, site, onComplete, opsMode = false) {
  const success = await messageSidekick({
    action: 'login',
    org,
    site: site || 'default',
    idp: opsMode ? 'microsoft' : undefined,
    tenant: opsMode ? 'common' : undefined,
  }, null, LOGIN_TIMEOUT);
  // let the sidekick propagate the auth token before proceeding
  if (success) await new Promise((resolve) => { setTimeout(resolve, POST_LOGIN_SETTLE); });
  if (onComplete) await onComplete(success);
}

/**
 * Opens a logout window for the given org/site.
 */
function openLogoutWindow(org, site, onComplete) {
  const logoutUrl = new URL(`https://admin.hlx.page/logout/${org}/${site || 'default'}/main`);
  logoutUrl.searchParams.append('extensionId', getSidekickId());
  const authWindow = window.open(logoutUrl.toString(), '_blank');

  const poll = setInterval(() => {
    if (authWindow.closed) {
      clearInterval(poll);
      if (onComplete) setTimeout(onComplete, 200);
    }
  }, 500);
  setTimeout(() => clearInterval(poll), 60000);
}

/**
 * Closes the popover and resets aria state.
 */
function closePopover(button, popover) {
  // Move focus out before hiding so assistive tech doesn't lose track of the focused element
  if (popover.contains(document.activeElement)) {
    button.focus();
  }
  button.setAttribute('aria-expanded', 'false');
  popover.setAttribute('aria-hidden', 'true');
}

const RECENT_LIMIT = 5;

/**
 * Creates a list item for a recent site entry.
 */
function createRecentItem(org, site, loggedIn, button, popover, recentList) {
  const li = document.createElement('li');
  li.className = 'config-recent-item';
  if (org === currentOrg && site === currentSite) {
    li.classList.add('selected');
  }

  const itemBtn = document.createElement('button');
  itemBtn.className = 'config-recent-button';
  itemBtn.type = 'button';

  const dot = document.createElement('span');
  dot.className = `status-light ${loggedIn ? 'level-success' : 'level-error'}`;
  dot.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'config-recent-text';
  const siteName = site ? `${org} / ${site}` : org;
  text.textContent = siteName;

  const status = loggedIn ? 'signed in' : 'not signed in';
  itemBtn.setAttribute('aria-label', `${siteName} (${status})`);
  itemBtn.append(dot, text);

  if (!loggedIn) {
    const signInLabel = document.createElement('span');
    signInLabel.className = 'config-sign-in-label';
    signInLabel.textContent = 'Sign in';
    itemBtn.append(signInLabel);
  }

  itemBtn.addEventListener('click', (e) => {
    // eslint-disable-next-line no-use-before-define
    selectSite(org, site, button, popover, recentList, e.altKey);
  });

  li.append(itemBtn);

  if (loggedIn) {
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'config-sign-out';
    signOutBtn.type = 'button';
    signOutBtn.setAttribute('aria-label', `Sign out of ${org}`);
    signOutBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    signOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      logMessage(getConsoleBlock(), CONSOLE_LEVEL.INFO, ['AUTH', `Signing out of ${org}\u2026`]);
      openLogoutWindow(org, site, () => {
        logMessage(getConsoleBlock(), CONSOLE_LEVEL.SUCCESS, ['AUTH', `Signed out of ${org}`]);
        window.dispatchEvent(new CustomEvent('auth-update', { detail: { org, authenticated: false } }));
      });
    });
    li.append(signOutBtn);
  }

  return li;
}

/**
 * Builds the recent sites list UI, showing RECENT_LIMIT items by default.
 */
async function buildRecentList(recentList, button, popover) {
  recentList.textContent = '';
  const sites = getRecentSites();

  if (sites.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'config-recent-empty';
    empty.textContent = 'No recent sites';
    recentList.append(empty);
    return;
  }

  const loginInfo = await getAuthInfo();
  const authedOrgs = Array.isArray(loginInfo) ? loginInfo : [];

  const visible = sites.slice(0, RECENT_LIMIT);
  const overflow = sites.slice(RECENT_LIMIT);

  visible.forEach(({ org, site }) => {
    const loggedIn = authedOrgs.includes(org);
    recentList.append(createRecentItem(org, site, loggedIn, button, popover, recentList));
  });

  if (overflow.length > 0) {
    const showAllLi = document.createElement('li');
    showAllLi.className = 'config-recent-show-all';
    const showAllBtn = document.createElement('button');
    showAllBtn.className = 'config-recent-button config-show-all-button';
    showAllBtn.type = 'button';
    showAllBtn.textContent = `Show all (${sites.length})`;
    showAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showAllLi.remove();
      overflow.forEach(({ org, site }) => {
        const loggedIn = authedOrgs.includes(org);
        recentList.append(createRecentItem(org, site, loggedIn, button, popover, recentList));
      });
    });
    showAllLi.append(showAllBtn);
    recentList.append(showAllLi);
  }
}

/**
 * Core selection action: updates state, URL, storage, UI.
 */
async function selectSite(org, site, button, popover, recentList, altKey = false) {
  currentOrg = org;
  currentSite = site;

  updateParams(org, site);
  updateStorage(org, site);
  updateButtonLabel(button);
  closePopover(button, popover);

  logMessage(getConsoleBlock(), CONSOLE_LEVEL.INFO, ['SELECT', `Selected site: ${org} / ${site}`]);

  // auto-login if not signed in, then dispatch config-update once auth is resolved
  // (dispatching before auth would race with tools that call ensureAuth on config-update)
  const loginInfo = await getAuthInfo();
  if (Array.isArray(loginInfo) && !loginInfo.includes(org)) {
    const opsMode = isOpsMode(altKey);
    logMessage(getConsoleBlock(), CONSOLE_LEVEL.INFO, ['AUTH', `Signing in to ${org}${opsMode ? ' (ops mode)' : ''}\u2026`]);
    await sidekickLogin(org, site, async (success) => {
      if (success) {
        logMessage(getConsoleBlock(), CONSOLE_LEVEL.SUCCESS, ['AUTH', `Signed in to ${org}`]);
      } else {
        logMessage(getConsoleBlock(), CONSOLE_LEVEL.ERROR, ['AUTH', `Sign-in to ${org} failed`]);
      }
    }, opsMode);
  }

  dispatchConfigUpdate(org, site);
  await buildRecentList(recentList, button, popover);
  await updateButtonStatus(button);
}

/**
 * Fetches the profile SVG icon and returns it as an element.
 */
async function fetchProfileIcon() {
  try {
    const resp = await fetch('/icons/profile.svg');
    if (resp.ok) {
      const temp = document.createElement('div');
      temp.innerHTML = await resp.text();
      const svg = temp.querySelector('svg');
      if (svg) return svg;
    }
  } catch (e) {
    // icon fetch failed
  }
  return null;
}

/**
 * Creates the collapsed button element.
 */
function createSelectButton() {
  const button = document.createElement('button');
  button.className = 'config-select-button';
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-label', 'Select a site');
  button.title = 'Select site';

  const icon = document.createElement('span');
  icon.className = 'config-select-icon';
  icon.setAttribute('aria-hidden', 'true');
  fetchProfileIcon().then((svg) => {
    if (svg) icon.replaceChildren(svg);
  });

  const label = document.createElement('span');
  label.className = 'config-select-label';
  label.textContent = 'Select site\u2026';

  const chevron = document.createElement('i');
  chevron.className = 'symbol symbol-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  button.append(icon, label, chevron);
  return button;
}

/**
 * Creates the popover panel with recent sites, add-new form, and manage link.
 */
function createPopover(button) {
  const popover = document.createElement('div');
  popover.className = 'config-popover';
  popover.setAttribute('aria-hidden', 'true');

  // Recent sites section
  const recentHeading = document.createElement('h4');
  recentHeading.textContent = 'Recent Sites';
  const recentList = document.createElement('ul');
  recentList.className = 'config-recent';

  // Add new section — collapsed by default
  const addDetails = document.createElement('details');
  addDetails.className = 'config-add-details';
  const addSummary = document.createElement('summary');
  addSummary.textContent = 'Add New';
  const summaryChevron = document.createElement('i');
  summaryChevron.className = 'symbol symbol-chevron';
  summaryChevron.setAttribute('aria-hidden', 'true');
  addSummary.append(summaryChevron);
  addDetails.append(addSummary);
  const addForm = document.createElement('div');
  addForm.className = 'config-add-form';

  const orgField = document.createElement('div');
  orgField.className = 'config-add-field';
  const orgLabel = document.createElement('label');
  orgLabel.setAttribute('for', 'config-select-org');
  orgLabel.textContent = 'Org';
  const orgInput = document.createElement('input');
  orgInput.type = 'text';
  orgInput.id = 'config-select-org';
  orgInput.placeholder = 'org';
  orgInput.setAttribute('list', 'config-org-list');
  const orgDatalist = document.createElement('datalist');
  orgDatalist.id = 'config-org-list';
  orgField.append(orgLabel, orgInput, orgDatalist);

  const siteField = document.createElement('div');
  siteField.className = 'config-add-field';
  const siteLabel = document.createElement('label');
  siteLabel.setAttribute('for', 'config-select-site');
  siteLabel.textContent = 'Site';
  const siteInput = document.createElement('input');
  siteInput.type = 'text';
  siteInput.id = 'config-select-site';
  siteInput.placeholder = 'site';
  siteInput.setAttribute('list', 'config-site-list');
  const siteDatalist = document.createElement('datalist');
  siteDatalist.id = 'config-site-list';
  siteField.append(siteLabel, siteInput, siteDatalist);

  const addBtn = document.createElement('button');
  addBtn.className = 'button config-add-button';
  addBtn.type = 'button';
  addBtn.textContent = 'Add';

  const manageLink = document.createElement('a');
  manageLink.className = 'button outline config-add-button';
  manageLink.href = '/tools/project-admin/index.html';
  manageLink.textContent = 'Manage projects';

  const addActions = document.createElement('div');
  addActions.className = 'config-add-actions';
  addActions.append(addBtn, manageLink);

  addForm.append(orgField, siteField, addActions);

  addDetails.append(addForm);
  popover.append(
    recentHeading,
    recentList,
    addDetails,
  );

  // Org input changes → reset site list
  orgInput.addEventListener('change', () => {
    resetSiteListForOrg(orgInput.value, siteInput, siteDatalist);
  });

  // Add button handler
  addBtn.addEventListener('click', () => {
    const org = orgInput.value.trim();
    const site = siteInput.value.trim();
    if (!org || !site) return;

    selectSite(org, site, button, popover, recentList);
    orgInput.value = '';
    siteInput.value = '';
  });

  // Build initial recent list
  buildRecentList(recentList, button, popover);

  // Populate datalists from storage
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (projects) {
    if (projects.orgs) populateList(orgDatalist, projects.orgs);
    if (currentOrg && projects.sites && projects.sites[currentOrg]) {
      populateList(siteDatalist, projects.sites[currentOrg]);
    }
  }

  return {
    popover, recentList, orgDatalist, siteDatalist,
  };
}

/**
 * Sets up popover toggle, close-on-outside, and Escape key handling.
 */
function initPopoverToggle(button, popover) {
  function toggleOpsIndicator(altKey) {
    popover.querySelectorAll('.config-sign-in-label').forEach((el) => {
      el.classList.toggle('emphasis', altKey);
    });
  }

  function opsKeyDownListener(e) {
    if (e.key === 'Alt') toggleOpsIndicator(true);
  }

  function opsKeyUpListener(e) {
    if (e.key === 'Alt') toggleOpsIndicator(false);
  }

  function removeListeners() {
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('click', clickOutsideListener);
    // eslint-disable-next-line no-use-before-define
    window.removeEventListener('keydown', escapeListener);
    window.removeEventListener('keydown', opsKeyDownListener);
    window.removeEventListener('keyup', opsKeyUpListener);
  }

  function clickOutsideListener(e) {
    if (!e.target.closest('.config-select')) {
      closePopover(button, popover);
      removeListeners();
    }
  }

  function escapeListener(e) {
    if (e.key === 'Escape') {
      closePopover(button, popover);
      button.focus();
      removeListeners();
    }
  }

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      closePopover(button, popover);
      removeListeners();
    } else {
      button.setAttribute('aria-expanded', 'true');
      popover.setAttribute('aria-hidden', 'false');
      document.addEventListener('click', clickOutsideListener);
      window.addEventListener('keydown', escapeListener);
      window.addEventListener('keydown', opsKeyDownListener);
      window.addEventListener('keyup', opsKeyUpListener);
    }
  });
}

/**
 * Populates initial org/site from URL params → localStorage → sidekick.
 */
async function populateInitialConfig(button, popover, recentList, orgDatalist, siteDatalist) {
  // 1. URL params
  const params = new URLSearchParams(window.location.search);
  if (params.get('org')) currentOrg = params.get('org');
  if (params.get('site')) currentSite = params.get('site');

  // 2. localStorage (only if not already set from params)
  if (!currentOrg) {
    const projects = JSON.parse(localStorage.getItem('aem-projects'));
    if (projects && projects.orgs && projects.orgs[0]) {
      [currentOrg] = projects.orgs;
      if (projects.sites && projects.sites[currentOrg] && projects.sites[currentOrg][0]) {
        [currentSite] = projects.sites[currentOrg];
      }
    }
  }

  // 3. Sidekick
  const skProjects = await messageSidekick({ action: 'getSites' });
  if (Array.isArray(skProjects) && skProjects.length > 0) {
    updateStorageFromSidekick(skProjects);

    if (!currentOrg) {
      currentOrg = skProjects[0].org;
      currentSite = skProjects[0].site || '';
    }

    // refresh datalists
    const allProjects = JSON.parse(localStorage.getItem('aem-projects'));
    if (allProjects) {
      if (allProjects.orgs) populateList(orgDatalist, allProjects.orgs);
      if (currentOrg && allProjects.sites && allProjects.sites[currentOrg]) {
        populateList(siteDatalist, allProjects.sites[currentOrg]);
      }
    }
  }

  // Sync state
  if (currentOrg) {
    updateStorage(currentOrg, currentSite);
    updateParams(currentOrg, currentSite);
  }
  updateButtonLabel(button);
  await buildRecentList(recentList, button, popover);
  await updateButtonStatus(button);

  // Dispatch initial config so tools that registered listeners during eager loading receive it
  if (currentOrg) {
    dispatchConfigUpdate(currentOrg, currentSite);
  }
}

export default async function decorate(block) {
  block.replaceChildren();

  const button = createSelectButton();
  const {
    popover, recentList, orgDatalist, siteDatalist,
  } = createPopover(button);

  initPopoverToggle(button, popover);
  block.append(button, popover);

  await populateInitialConfig(button, popover, recentList, orgDatalist, siteDatalist);

  // Refresh UI when tools trigger auth via ensureAuth
  window.addEventListener('auth-update', async () => {
    await buildRecentList(recentList, button, popover);
    await updateButtonStatus(button);
  });

  // Open add-site form when ensureAuth can't resolve a site for an org
  window.addEventListener('config-add-site', (e) => {
    const { org } = e.detail;
    button.setAttribute('aria-expanded', 'true');
    popover.setAttribute('aria-hidden', 'false');
    const addDetails = popover.querySelector('.config-add-details');
    addDetails.open = true;
    const orgInput = addDetails.querySelector('#config-select-org');
    orgInput.value = org;
    orgInput.dispatchEvent(new Event('change'));
    addDetails.querySelector('#config-select-site').focus();
  });
}
