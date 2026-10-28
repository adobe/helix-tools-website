import { registerToolReady } from '../../scripts/scripts.js';
import getAdminClient, { getAdminClientForSite, isHelix6 } from '../../scripts/admin-compat.js';
import { decorateIcons } from '../../scripts/aem.js';
import { initConfigField } from '../../utils/config/config.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import loadingMessages from './loading-messages.js';
import {
  validatePath,
  classifySequenceStatus,
  fetchHosts,
  fetchContentSourceType,
  hasSourceListing,
  needsSourceLookup,
} from './utils.js';
import { collectResources } from './browse.js';
import { lookupSource, lookupAll } from './source-lookup.js';

const FORM = document.getElementById('status-form');
const TABLE = document.querySelector('table');
const CAPTION = TABLE.querySelector('caption');
const RESULTS = TABLE.querySelector('.results');
const ERROR = TABLE.querySelector('.error');
const FILTER = document.getElementById('status-filter');
const DOWNLOADCSV = document.getElementById('download-csv');
const DIFFMODE = document.getElementById('diff-mode');
const CHECKSOURCES = document.getElementById('check-sources');
const ACTION_BUTTONS = [DOWNLOADCSV, DIFFMODE, CHECKSOURCES];
let sourceLookup = null;
let intervalId;
const randomLoadingMessage = () => loadingMessages[
  Math.floor(Math.random() * loadingMessages.length)
];

// utility functions
/**
 * Creates debounced version of provided function.
 * @param {Function} func - Function to debounce.
 * @param {number} wait - Time to delay function execution (in ms).
 * @returns {Function} New function that will debounce original function when invoked.
 */
function debounce(func, wait) {
  let timeout;
  // eslint-disable-next-line func-names
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// url params
/**
 * Updates URL query params with job name.
 * @param {string} job - Job name.
 */
function updateJobParam(job) {
  const url = new URL(window.location.href);
  url.searchParams.set('job', encodeURIComponent(job));
  window.history.replaceState({}, document.title, url.href);
}

/**
 * Removes the job param from URL.
 */
function removeJobParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('job');
  window.history.replaceState({}, '', url);
}

// date management
/**
 * Pads a number with a leading 0 if necessary, returning a two-character string.
 * @param {number} number - Number.
 * @returns {string} Padded number.
 */
function pad(number) {
  return number.toString().padStart(2, '0');
}

/**
 * Converts Date string to a formatted UTC date and time string.
 * @param {string} d - Date string.
 * @returns {string} UTC date and time in "MM/DD/YYYY HH:MM UTC" format.
 */
function toUTCDate(d) {
  const date = new Date(d);
  const dd = pad(date.getUTCDate());
  const mm = pad(date.getUTCMonth() + 1);
  const yyyy = date.getUTCFullYear();
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${mm}/${dd}/${yyyy} ${hours}:${minutes}`;
}

// loading button management
/**
 * Displays loading spinner in button.
 * @param {HTMLButtonElement} button - Button element.
 */
function showLoadingButton(button) {
  button.disabled = true;
  // preserves original size of the button
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  // stores original button text content
  button.dataset.label = button.textContent;
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

/**
 * Resets button from loading state back to original appearance and content.
 * @param {HTMLButtonElement} button - Button element.
 */
function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
  button.disabled = false;
}

// form management
/**
 * Extracts and formats form data from given form element.
 * @param {HTMLFormElement} form - Form element.
 * @returns {Object} Form data (field names as keys, field values as values).
 */
function getFormData(form) {
  const data = {};
  [...form.elements].forEach((field) => {
    const { name, type, value } = field;
    if (name && type && value) {
      switch (type) {
        // parse number and range as floats
        case 'number':
        case 'range':
          data[name] = parseFloat(value, 10);
          break;
        // convert date and datetime-local to date objects
        case 'date':
        case 'datetime-local':
          data[name] = new Date(value);
          break;
        // store checked checkbox values in array
        case 'checkbox':
          if (field.checked) {
            if (data[name]) data[name].push(value);
            else data[name] = [value];
          }
          break;
        // only store checked radio
        case 'radio':
          if (field.checked) data[name] = value;
          break;
        // convert url to url object
        case 'url':
          data[name] = new URL(value);
          break;
        // store file filelist objects
        case 'file':
          data[name] = field.files;
          break;
        default:
          data[name] = value;
      }
    }
  });
  return data;
}

/**
 * Enables the action buttons (Download CSV and Diff Mode).
 * Should only be called when results are successfully displayed.
 * @param {boolean} [diff=true] - Whether Diff Mode is available.
 */
function enableActionButtons(diff = true) {
  DOWNLOADCSV.disabled = false;
  DIFFMODE.disabled = !diff;
}

/**
 * Disables the action buttons (Download CSV and Diff Mode).
 */
function disableActionButtons() {
  DOWNLOADCSV.disabled = true;
  DIFFMODE.disabled = true;
  CHECKSOURCES.disabled = true;
  CHECKSOURCES.hidden = true;
  if (sourceLookup) sourceLookup.signal.aborted = true;
  sourceLookup = null;
}

/**
 * Disables all form elements within specified form.
 * @param {HTMLFormElement} form - Form element.
 * @param {HTMLFormElement} button - Form's submit button.
 */
function disableForm(form, button) {
  showLoadingButton(button);
  [...form.elements].forEach((el) => {
    el.disabled = true;
  });
  // Disable action buttons when starting a new query
  disableActionButtons();
}

/**
 * Enables all form elements within specified form.
 * @param {HTMLFormElement} form - Form element.
 * @param {HTMLFormElement} button - Form's submit button.
 */
function enableForm(form, button) {
  resetLoadingButton(button);
  [...form.elements].forEach((el) => {
    if (!ACTION_BUTTONS.includes(el)) el.disabled = false;
  });
  // Note: Action buttons (CSV, Diff Mode) are enabled separately
  // only when results are successfully displayed
}

// table management
/**
 * Updates table caption with provided timestamp.
 * @param {string} time - Timestamp.
 */
function updateTableCaption(time) {
  const asOf = CAPTION.querySelector('.as-of');
  asOf.textContent = toUTCDate(time);
  CAPTION.setAttribute('aria-hidden', false);
}

/**
 * Updates visibility of specific table sections based on display state.
 * @param {string} show - Class name of table section to display.
 */
function updateTableDisplay(show) {
  // loop through tbodies and hide based on the show param
  if (show === 'loading') {
    const div = TABLE.querySelector('.loading > tr > td > div');
    const p = document.createElement('p');
    div.appendChild(p);
    intervalId = setInterval(() => { p.textContent = randomLoadingMessage(); }, 5000);
  } else if (intervalId) {
    clearInterval(intervalId);
  }
  TABLE.querySelectorAll('tbody').forEach((tbody) => {
    tbody.setAttribute('aria-hidden', show !== tbody.className);
  });

  FILTER.value = '';
  // disable filter if not showing results
  FILTER.disabled = show !== 'results';
}

/**
 * Clears all content within a specified table body.
 * @param {HTMLElement} table - Table body element.
 */
function clearTable(table) {
  CAPTION.setAttribute('aria-hidden', true);
  CAPTION.querySelector('.caption-notice').textContent = '';
  table.innerHTML = '';
  updateTableDisplay('no-results');
}

/**
 * Updates table to display error message based on HTTP error code.
 * @param {number} status - HTTP error status code.
 * @param {string} preview - Hostname for preview environment.
 * @param {string} site - Site name within org.
 */
function updateTableError(status, preview, site) {
  const messages = {
    400: 'The request for page status could not be processed.',
    401: `<a href="https://${preview}" target="_blank">Sign in to the ${site} project sidekick</a> 
      to view the status.`,
    403: 'Insufficient permissions to view page status.',
    404: 'Page status could not be found.',
    Project: `${site} project not found.`,
    Job: 'Unable to create page status job.',
    Resource: `No page status information found for ${site}`,
  };

  const text = messages[status] || 'Unable to display page status.';
  const title = ERROR.querySelector('strong');
  const message = ERROR.querySelector('p:last-of-type');
  title.textContent = `${status} Error`;
  message.innerHTML = text;
  CAPTION.setAttribute('aria-hidden', true);
  updateTableDisplay('error');
}

/**
 * Creates anchor element with the specified text and url.
 * @param {string} text - Text to display inside anchor tag.
 * @param {string} url - Base URL for anchor's `href`.
 * @param {string} path - Path to append to base URL.
 * @returns {HTMLAnchorElement} Anchor element.
 */
function buildLink(text, url, path) {
  const a = document.createElement('a');
  a.href = `https://${url}${path}`;
  a.target = '_blank';
  a.textContent = toUTCDate(text);
  return a;
}

/**
 * @param {string} edit
 * @param {string} preview
 * @param {string} publish
 * @param {{sourceExpected?: boolean}} [opts]
 * @returns {HTMLSpanElement}
 */
function buildSequenceStatus(edit, preview, publish, opts) {
  const { label, modifier } = classifySequenceStatus(edit, preview, publish, opts);
  const span = document.createElement('span');
  span.className = `status-light ${modifier}`;
  span.textContent = label;
  return span;
}

function buildRedirectIcon(redirectLocation) {
  if (!redirectLocation) return '';

  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'icon-wrapper';

  const icon = document.createElement('span');
  icon.className = 'icon icon-redirect';

  iconWrapper.append(icon);

  const location = document.createElement('span');
  location.className = 'redirect-location';
  location.textContent = redirectLocation;

  iconWrapper.append(location);

  decorateIcons(iconWrapper);

  iconWrapper.addEventListener('mouseenter', () => {
    location.classList.add('open');
  });
  iconWrapper.addEventListener('mouseleave', () => {
    location.classList.remove('open');
  });

  return iconWrapper;
}

/**
 * @param {{publishKnown?: boolean}} [opts]
 * @returns {string} Publish cell text when there is no publish date.
 */
function publishCellFallback(opts) {
  return opts?.publishKnown === false ? 'Unknown' : '-';
}

/**
 * Builds a button that triggers a source lookup for its row.
 * @param {string} label
 * @param {string} [title]
 * @returns {HTMLButtonElement}
 */
function buildCheckSourceButton(label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button quiet check-source';
  button.textContent = label;
  if (title) button.title = title;
  return button;
}

/**
 * @param {Object} resource
 * @param {Object} [opts] - Classification options.
 * @returns {string|HTMLElement} Source cell content.
 */
function buildSourceCell(resource, opts) {
  if (opts?.sourceKnown === false) return buildCheckSourceButton('Check');
  return resource.sourceLastModified ? toUTCDate(resource.sourceLastModified) : '-';
}

/**
 * Builds row (`<tr>`) element with resource path, status, and modification timestamps.
 * @param {Object} resource - Resource object containing metadata.
 * @param {string} live - Base URL for live links.
 * @param {string} preview - Base URL for preview links.
 * @param {string} resource.path - The resource's path.
 * @param {{sourceExpected?: boolean}} [opts] - Classification options.
 * @returns {HTMLTableRowElement|null} `<tr>` element for resource, or `null` if no `path`.
 */
function buildResource(resource, live, preview, opts) {
  const {
    path,
    sourceLastModified,
    previewLastModified,
    publishLastModified,
    publishConfigRedirectLocation,
    previewConfigRedirectLocation,
  } = resource;
  const ignore = ['/helix-env.json', '/sitemap.json'];
  if (path && !ignore.includes(path)) {
    const row = document.createElement('tr');
    const status = buildSequenceStatus(
      sourceLastModified,
      previewLastModified,
      publishLastModified,
      opts,
    );
    const cols = [
      path,
      buildRedirectIcon(publishConfigRedirectLocation || previewConfigRedirectLocation),
      status,
      buildSourceCell(resource, opts),
      previewLastModified ? buildLink(previewLastModified, preview, path) : '-',
      publishLastModified ? buildLink(publishLastModified, live, path) : publishCellFallback(opts),
    ];
    cols.forEach((col) => {
      const cell = document.createElement('td');
      if (typeof col === 'string') cell.textContent = col;
      else cell.append(col);
      row.append(cell);
    });
    if (opts?.sourceKnown === false) {
      row.dataset.source = 'pending';
      sourceLookup?.rows.set(row, resource);
    }

    return row;
  }
  return null;
}

/**
 * Displays list of resources by building and appending table rows.
 * @param {Object[]} resources - Array of resource objects.
 * @param {string} live - Base URL for live links.
 * @param {string} preview - Base URL for preview links.
 * @param {{sourceExpected?: boolean}} [opts] - Classification options.
 */
function displayResources(resources, live, preview, opts) {
  resources.forEach((resource) => {
    const row = buildResource(resource, live, preview, opts);
    if (row) RESULTS.append(row);
  });
}

// source lookups
const STATUS_CELL = 2;
const SOURCE_CELL = 3;

/**
 * Sets a row's source lookup state and updates its status and source cells.
 * @param {HTMLTableRowElement} row
 * @param {'pending'|'checking'|'done'|'error'} state
 * @param {Object} [result] - Lookup result.
 * @param {Error} [error] - Lookup error.
 */
function setRowSource(row, state, result, error) {
  const resource = sourceLookup?.rows.get(row);
  if (!resource) return;
  row.dataset.source = state;
  const sourceCell = row.children[SOURCE_CELL];
  sourceCell.textContent = '';
  if (state === 'pending') {
    sourceCell.append(buildCheckSourceButton('Check'));
  } else if (state === 'checking') {
    sourceCell.textContent = 'Checking…';
  } else if (state === 'error') {
    sourceCell.append(buildCheckSourceButton('Retry', `Source lookup failed (${error?.status || 'error'})`));
  } else {
    resource.sourceLastModified = result.lastModified;
    sourceCell.textContent = result.lastModified ? toUTCDate(result.lastModified) : '-';
    const status = buildSequenceStatus(
      resource.sourceLastModified,
      resource.previewLastModified,
      resource.publishLastModified,
      { ...sourceLookup.opts, sourceKnown: true },
    );
    row.children[STATUS_CELL].replaceChildren(status);
  }
}

/**
 * Looks up the source of a single row.
 * @param {HTMLTableRowElement} row
 */
async function checkRowSource(row) {
  const lookup = sourceLookup;
  const resource = lookup?.rows.get(row);
  if (!resource) return;
  setRowSource(row, 'checking');
  try {
    const result = await lookupSource(lookup.admin, lookup.org, lookup.site, resource.path);
    if (lookup === sourceLookup) setRowSource(row, 'done', result);
  } catch (error) {
    if (lookup === sourceLookup) setRowSource(row, 'error', undefined, error);
  }
}

/**
 * Updates the Check All Sources button for the current lookup state.
 */
function updateCheckSourcesButton() {
  if (!sourceLookup) return;
  const rows = [...sourceLookup.rows.keys()];
  const done = rows.filter((r) => r.dataset.source === 'done').length;
  if (sourceLookup.running) {
    CHECKSOURCES.textContent = `Stop Checking (${done}/${rows.length})`;
  } else {
    CHECKSOURCES.textContent = 'Check All Sources';
    CHECKSOURCES.disabled = done === rows.length;
  }
}

/**
 * Looks up the sources of all unchecked rows, or stops a running check.
 */
async function checkAllSources() {
  const lookup = sourceLookup;
  if (!lookup) return;
  if (lookup.running) {
    lookup.signal.aborted = true;
    return;
  }
  const rows = [...lookup.rows.keys()]
    .filter((r) => r.dataset.source === 'pending' || r.dataset.source === 'error');
  const byPath = new Map(rows.map((r) => [lookup.rows.get(r).path, r]));
  rows.forEach((r) => setRowSource(r, 'checking'));
  lookup.running = true;
  lookup.signal = { aborted: false };
  updateCheckSourcesButton();
  await lookupAll(lookup.admin, lookup.org, lookup.site, [...byPath.keys()], {
    signal: lookup.signal,
    onResult: (path, result, error) => {
      if (lookup !== sourceLookup) return;
      setRowSource(byPath.get(path), error ? 'error' : 'done', result, error);
      updateCheckSourcesButton();
    },
  });
  if (lookup !== sourceLookup) return;
  rows.filter((r) => r.dataset.source === 'checking').forEach((r) => setRowSource(r, 'pending'));
  lookup.running = false;
  updateCheckSourcesButton();
}

// data fetching
let jobAdmin;
let statusAdmin;

/**
 * Resolves the admin client, backend and status options for a site.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{admin: Object, h6: boolean, hosts: Object|null, sourceType: string}>}
 */
async function resolveSite(org, site) {
  const h6 = await isHelix6({ org, site });
  const admin = await getAdminClientForSite({ org, site });
  const hosts = await fetchHosts(org, site, admin);
  const sourceType = hosts ? await fetchContentSourceType(admin, org, site, h6) : undefined;
  return {
    admin, h6, hosts, sourceType,
  };
}

/**
 * Submits a status job for the given org/site/path.
 * @param {string} org
 * @param {string} site
 * @param {string} path - Raw user-entered path (will be validated/normalized).
 * @returns {Promise<string|null>} Job name, or `null` if the user cancels login.
 */
async function submitStatusJob(org, site, path) {
  const body = JSON.stringify({
    paths: [validatePath(path)],
    select: ['edit', 'preview', 'live'],
  });
  const res = await executeAdminRequest(
    () => statusAdmin.status({ org, site }).update('/*', body),
    { org, site, policy: AuthMode.PREFLIGHT_AND_RETRY },
  );
  if (!res) return null;
  if (!res.ok) {
    const error = new Error();
    error.status = res.status;
    throw error;
  }
  const json = await res.json();
  if (!json.job || json.job.state !== 'created') {
    const error = new Error();
    error.status = 'Job';
    throw error;
  }
  if (json.job.name) updateJobParam(json.job.name);
  return json.job.name || null;
}

/**
 * Polls a job until completion, then fetches details and returns resources.
 * @param {string} org
 * @param {string} site
 * @param {string} jobName
 * @param {number} [retry=10000] - Delay (in ms) between polling attempts.
 * @returns {Promise<Object[]>} Array of resources.
 */
async function runJob(org, site, jobName, retry = 10000) {
  try {
    const jobRes = await jobAdmin.job({ org, site }).get(`status/${jobName}`);
    if (!jobRes.ok) throw jobRes;
    const { state } = await jobRes.json();
    if (state !== 'completed' && state !== 'stopped') {
      await new Promise((resolve) => { setTimeout(resolve, retry); });
      return runJob(org, site, jobName, retry);
    }
    const detailsRes = await jobAdmin.job({ org, site }).get(`status/${jobName}/details`);
    if (!detailsRes.ok) throw detailsRes;
    const { data, createTime } = await detailsRes.json();
    if (createTime) updateTableCaption(createTime);
    return data ? data.resources : [];
  } catch (error) {
    updateTableError(error.status);
    return [];
  }
}

/**
 * Executes status job and displays results.
 * @param {string} org
 * @param {string} site
 * @param {string} jobName
 * @param {string} live - Base URL for live resources.
 * @param {string} preview - Base URL for preview resources.
 * @param {{sourceExpected?: boolean}} [opts] - Classification options.
 */
async function runAndDisplayJob(org, site, jobName, live, preview, opts) {
  const paths = await runJob(org, site, jobName);
  if (!paths || paths.length === 0) {
    throw new Error('No page status data found.');
  }
  displayResources(paths, live, preview, opts);
  updateTableDisplay('results');
  enableActionButtons();
}

/**
 * Collects status via the Helix 6 browse API and displays results.
 * @param {Object} admin - H6 admin client.
 * @param {string} org
 * @param {string} site
 * @param {string} path - Raw user-entered path.
 * @param {Object} hosts - Live and preview hosts.
 * @param {string|undefined} sourceType - Content source type.
 */
async function runAndDisplayBrowse(admin, org, site, path, hosts, sourceType) {
  const folder = validatePath(path).slice(0, -1);
  const startTime = new Date().toISOString();
  const { resources, liveForbidden } = await collectResources(admin, {
    org, site, folder, source: sourceType === 'sourcebus',
  });
  if (resources.length === 0) {
    const error = new Error('No page status data found.');
    error.status = 'Resource';
    throw error;
  }
  updateTableCaption(startTime);
  const lookup = needsSourceLookup(sourceType, true);
  const notices = [];
  if (liveForbidden) {
    notices.push('Publish status unknown: insufficient permissions to list published content.');
  }
  if (lookup) {
    notices.push('Source status unknown: check pages individually or use Check All Sources.');
  }
  CAPTION.querySelector('.caption-notice').textContent = notices.join(' ');
  const opts = {
    sourceExpected: lookup || hasSourceListing(sourceType, true),
    publishKnown: !liveForbidden,
  };
  if (lookup) {
    sourceLookup = {
      admin, org, site, opts, rows: new Map(), signal: { aborted: false }, running: false,
    };
  }
  const displayOpts = lookup ? { ...opts, sourceKnown: false } : opts;
  displayResources(resources, hosts.live, hosts.preview, displayOpts);
  updateTableDisplay('results');
  enableActionButtons(false);
  if (lookup) {
    CHECKSOURCES.hidden = false;
    updateCheckSourcesButton();
  }
}

/**
 * Prepares form and table for status job.
 * @param {HTMLFormElement} form - Form element to be disabled.
 * @param {HTMLButtonElement} button - Submit button on form.
 */
function setupJob(form, button) {
  disableForm(form, button);
  clearTable(RESULTS);
  updateTableDisplay('loading');
}

function downloadCSVFile(csvData) {
  // Create a Blob from the CSV data
  const csvBlob = new Blob([csvData], { type: 'text/csv' });

  // Create a temporary link element
  const tempLink = document.createElement('a');
  tempLink.href = URL.createObjectURL(csvBlob);
  tempLink.download = 'page-status.csv';

  // Append the link to the document, trigger the download, and remove the link
  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
}

/**
 * Executes status job based on params from search query string.
 * @param {string} search - URL search string.
 * @returns {Promise<>} Promise that resolves when job execution is complete.
 */
async function runFromParams(search) {
  const params = new URLSearchParams(search);
  if (params && params.size > 0) {
    const org = params.get('org');
    const site = params.get('site');
    const job = params.get('job');
    if (org && site && job) {
      let preview;
      try {
        setupJob(FORM, FORM.querySelector('button'));
        const { h6, hosts, sourceType } = await resolveSite(org, site);
        if (!hosts) return;
        if (h6) {
          const error = new Error();
          error.status = 'Job';
          throw error;
        }
        ({ preview } = hosts);
        const { live } = hosts;
        await runAndDisplayJob(org, site, job, live, preview, {
          sourceExpected: hasSourceListing(sourceType, false),
        });
        updateJobParam(job);
      } catch (error) {
        updateTableError(error.status || 'Job', preview, site);
        removeJobParam();
      } finally {
        enableForm(FORM, FORM.querySelector('button'));
      }
    } else {
      removeJobParam();
    }
  }
}

async function init() {
  const admin = await getAdminClient();
  jobAdmin = admin.withRequestInit({ mode: 'cors' });
  statusAdmin = admin.withRequestInit({
    mode: 'cors',
    cache: 'no-cache',
    credentials: 'same-origin',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
  });
  await initConfigField();

  FORM.addEventListener('reset', () => {
    clearTable(RESULTS);
    disableActionButtons();
  });

  CHECKSOURCES.addEventListener('click', checkAllSources);
  RESULTS.addEventListener('click', (e) => {
    const button = e.target.closest('.check-source');
    if (button) checkRowSource(button.closest('tr'));
  });

  FORM.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { target, submitter } = e;
    const data = getFormData(target);
    const { org, site, path } = data;

    let preview;
    try {
      setupJob(target, submitter);
      const {
        admin: siteAdmin, h6, hosts, sourceType,
      } = await resolveSite(org, site);
      if (!hosts) return;
      ({ preview } = hosts);
      if (h6) {
        removeJobParam();
        await runAndDisplayBrowse(siteAdmin, org, site, path, hosts, sourceType);
        return;
      }
      const { live } = hosts;
      const jobName = await submitStatusJob(org, site, path);
      if (!jobName) return;
      await runAndDisplayJob(org, site, jobName, live, preview, {
        sourceExpected: hasSourceListing(sourceType, false),
      });
    } catch (error) {
      updateTableError(error.status || 'Job', preview, site);
      removeJobParam();
    } finally {
      enableForm(target, submitter);
    }
  });
  DOWNLOADCSV.addEventListener('click', () => {
    let csvData = [];
    // Get the header data
    const headers = [];
    const headerCols = TABLE.querySelector('thead').querySelectorAll('tr > th');
    for (let i = 0; i < headerCols.length; i += 1) {
      headers.push(headerCols[i].textContent);
    }
    csvData.push(headers.join(','));
    // Get each row data
    const rows = RESULTS.getElementsByTagName('tr');
    for (let i = 0; i < rows.length; i += 1) {
      // Get each column data
      const cols = rows[i].querySelectorAll('td,th');

      // Stores each csv row data
      const csvrow = [];
      for (let j = 0; j < cols.length; j += 1) {
        // Get the text data of each cell of
        // a row and push it to csvrow

        if (cols[j].querySelector('a')) {
          // eslint-disable-next-line prefer-destructuring
          const textContent = cols[j].querySelector('a').textContent;
          const date = new Date(textContent);
          csvrow.push(date.toString());
        } else {
          // eslint-disable-next-line prefer-destructuring
          const textContent = cols[j].textContent;
          if (textContent.includes(':')) {
            const date = new Date(textContent);
            csvrow.push(date.toString());
          } else csvrow.push(cols[j].textContent);
        }
      }

      // Combine each column value with comma
      csvData.push(csvrow.join(','));
    }
    // Combine each row data with new line character
    csvData = csvData.join('\n');
    downloadCSVFile(csvData);
  });

  // handle diff mode button click
  DIFFMODE.addEventListener('click', () => {
    if (DIFFMODE.disabled) return;

    const data = getFormData(FORM);
    const { org, site } = data;
    if (!org || !site) return;

    // Get the job ID from the current URL params
    const currentParams = new URLSearchParams(window.location.search);
    const job = currentParams.get('job');

    // Navigate to diff page with org/site/job params
    const diffUrl = new URL('./diff.html', window.location.href);
    diffUrl.searchParams.set('org', org);
    diffUrl.searchParams.set('site', site);
    if (job) {
      diffUrl.searchParams.set('job', job);
    }
    window.location.href = diffUrl.href;
  });

  // enable table results filtering
  const filterTable = debounce((e) => {
    const filter = e.target.value.toLowerCase();
    [...RESULTS.children].forEach((row) => {
      const cells = [...row.children];
      const match = cells.find((c) => {
        const text = c.textContent.toLowerCase();
        return text.includes(filter);
      });
      row.setAttribute('aria-hidden', !match);
    });
  }, 300);
  FILTER.addEventListener('input', filterTable);

  FILTER.closest('form').addEventListener('submit', (e) => e.preventDefault());

  runFromParams(window.location.search);
}

registerToolReady(init());
