/* eslint-disable class-methods-use-this */
import { ensureLogin } from '../../blocks/profile/profile.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';

// form elements
const CONFIG_FORM = document.getElementById('config-form');
const UPDATE_FORM = document.getElementById('update-form');
const ORG_FIELD = CONFIG_FORM.querySelector('#org');
const SITE_FIELD = CONFIG_FORM.querySelector('#site');
const BRANCH_FIELD = CONFIG_FORM.querySelector('#branch');

// display elements
const CONFIG_DISPLAY = document.querySelector('.config-display');
const CONFIG_OUTPUT = document.getElementById('config-output');
const CONFIG_INPUT = document.getElementById('config-input');
const RESULT_DISPLAY = document.querySelector('.result-display');

// result state elements
const NO_RESULTS = RESULT_DISPLAY.querySelector('.no-results');
const ERROR = RESULT_DISPLAY.querySelector('.error');
const ERROR_MESSAGE = document.getElementById('error-message');
const LOGIN = RESULT_DISPLAY.querySelector('.login');
const LOADING = RESULT_DISPLAY.querySelector('.loading');
const SUCCESS = RESULT_DISPLAY.querySelector('.success');
const SUCCESS_MESSAGE = document.getElementById('success-message');

// current state
let currentOrg = '';
let currentSite = '';
let currentBranch = '';

/**
 * Shows loading spinner in button.
 * @param {HTMLButtonElement} button - Button element.
 */
function showLoadingButton(button) {
  button.disabled = true;
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  button.dataset.label = button.textContent || 'Submit';
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

/**
 * Resets button from loading state.
 * @param {HTMLButtonElement} button - Button element.
 */
function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
  button.disabled = false;
}

/**
 * Updates display state.
 * @param {string} show - State to show (no-results, error, login, loading, success, config).
 */
function updateDisplay(show) {
  // Hide all result states
  [NO_RESULTS, ERROR, LOGIN, LOADING, SUCCESS].forEach((el) => {
    el.setAttribute('aria-hidden', 'true');
  });

  // Show requested state
  if (show === 'config') {
    CONFIG_DISPLAY.setAttribute('aria-hidden', 'false');
    RESULT_DISPLAY.setAttribute('aria-hidden', 'true');
  } else {
    CONFIG_DISPLAY.setAttribute('aria-hidden', 'true');
    RESULT_DISPLAY.setAttribute('aria-hidden', 'false');

    const stateMap = {
      'no-results': NO_RESULTS,
      error: ERROR,
      login: LOGIN,
      loading: LOADING,
      success: SUCCESS,
    };

    const element = stateMap[show];
    if (element) {
      element.setAttribute('aria-hidden', 'false');
    }
  }
}

/**
 * Fetches the current JSON2HTML configuration.
 * @param {string} org - Organization name.
 * @param {string} site - Site name.
 * @param {string} branch - Branch name.
 * @returns {Promise<Object>} Configuration object or error.
 */
async function fetchConfiguration(org, site, branch) {
  try {
    const url = `https://json2html.adobeaem.workers.dev/config/${org}/${site}/${branch}`;
    const res = await fetch(url);
    if (!res.ok) throw res;
    const config = await res.json();
    return { config, error: null };
  } catch (error) {
    return { config: null, error };
  }
}

/**
 * Saves the JSON2HTML configuration.
 * @param {string} org - Organization name.
 * @param {string} site - Site name.
 * @param {string} branch - Branch name.
 * @param {Object} configData - Configuration data to save.
 * @returns {Promise<Object>} Result object or error.
 */
async function saveConfiguration(org, site, branch, configData) {
  try {
    const url = `https://json2html.adobeaem.workers.dev/config/${org}/${site}/${branch}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configData),
    });
    if (!res.ok) throw res;
    const result = await res.json();
    return { result, error: null };
  } catch (error) {
    return { result: null, error };
  }
}

/**
 * Displays error message.
 * @param {number} status - HTTP status code.
 * @param {string} org - Organization name.
 * @param {string} site - Site name.
 */
async function showError(status, org, site) {
  const messages = {
    400: 'The request could not be processed.',
    403: 'Insufficient permissions to access the configuration. Sign in with a different user to view the configuration.',
    404: 'No configuration found for this project.',
  };

  if (status === 401) {
    updateDisplay('login');
    ensureLogin(org, site);
  } else {
    const text = messages[status] || 'Unable to load the configuration.';
    ERROR_MESSAGE.textContent = text;
    updateDisplay('error');
  }
}

/**
 * Displays the configuration.
 * @param {Object} config - Configuration object.
 */
function displayConfiguration(config) {
  const formatted = JSON.stringify(config, null, 2);
  CONFIG_OUTPUT.textContent = formatted;
  CONFIG_INPUT.value = formatted;
  updateDisplay('config');
}

/**
 * Checks if the user is logged in.
 * @returns {Promise<boolean>} True if logged in, false otherwise.
 */
async function isLoggedIn() {
  const org = ORG_FIELD.value;
  const site = SITE_FIELD.value;
  if (org && site) {
    return ensureLogin(org, site);
  }
  return false;
}

/**
 * Updates URL parameters.
 * @param {string} org - Organization name.
 * @param {string} site - Site name.
 * @param {string} branch - Branch name.
 */
function updateParams(org, site, branch) {
  const url = new URL(window.location.href);
  url.search = '';
  if (org) url.searchParams.set('org', org);
  if (site) url.searchParams.set('site', site);
  if (branch) url.searchParams.set('branch', branch);
  window.history.replaceState({}, document.title, url.href);
}

/**
 * Populates form from URL parameters.
 */
function populateFromParams() {
  const params = new URLSearchParams(window.location.search);
  const org = params.get('org');
  const site = params.get('site');
  const branch = params.get('branch');

  if (org) ORG_FIELD.value = org;
  if (site) SITE_FIELD.value = site;
  if (branch) BRANCH_FIELD.value = branch;
}

/**
 * Registers event listeners.
 */
async function registerListeners() {
  // Handle config form submission
  CONFIG_FORM.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!await isLoggedIn()) {
      window.addEventListener('profile-update', ({ detail: loginInfo }) => {
        if (loginInfo.includes(ORG_FIELD.value)) {
          CONFIG_FORM.querySelector('button[type="submit"]').click();
        }
      }, { once: true });
      return;
    }

    const { target, submitter } = e;
    showLoadingButton(submitter);
    updateDisplay('loading');

    const org = ORG_FIELD.value;
    const site = SITE_FIELD.value;
    const branch = BRANCH_FIELD.value || 'main';

    currentOrg = org;
    currentSite = site;
    currentBranch = branch;

    const { config, error } = await fetchConfiguration(org, site, branch);

    if (!error) {
      displayConfiguration(config);
      updateConfig();
      updateParams(org, site, branch);
    } else {
      showError(error.status, org, site);
    }

    resetLoadingButton(submitter);
  });

  // Handle config form reset
  CONFIG_FORM.addEventListener('reset', (e) => {
    e.preventDefault();
    ORG_FIELD.value = '';
    SITE_FIELD.value = '';
    BRANCH_FIELD.value = 'main';
    CONFIG_OUTPUT.textContent = '';
    CONFIG_INPUT.value = '';
    updateDisplay('no-results');
    updateParams('', '', '');
  });

  // Handle update form submission
  UPDATE_FORM.addEventListener('submit', async (e) => {
    e.preventDefault();

    const { target, submitter } = e;
    showLoadingButton(submitter);
    updateDisplay('loading');

    try {
      const configData = JSON.parse(CONFIG_INPUT.value);
      const { result, error } = await saveConfiguration(
        currentOrg,
        currentSite,
        currentBranch,
        configData,
      );

      if (!error) {
        SUCCESS_MESSAGE.textContent = 'Configuration saved successfully.';
        updateDisplay('success');

        // Reload configuration after successful save
        setTimeout(async () => {
          const { config, error: fetchError } = await fetchConfiguration(
            currentOrg,
            currentSite,
            currentBranch,
          );
          if (!fetchError) {
            displayConfiguration(config);
          }
        }, 2000);
      } else {
        showError(error.status, currentOrg, currentSite);
      }
    } catch (err) {
      ERROR_MESSAGE.textContent = 'Invalid JSON format. Please check your input.';
      updateDisplay('error');
    }

    resetLoadingButton(submitter);
  });
}

/**
 * Initializes the tool.
 */
async function init() {
  await initConfigField();
  populateFromParams();
  registerListeners();
}

init();
