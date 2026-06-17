import { registerToolReady } from '../../scripts/scripts.js';
import { initConfigField, updateConfig } from '../../utils/config/config.js';
import admin from '../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../utils/admin-request.js';
import { loadPrism, highlight } from '../../utils/prism/prism.js';
import {
  toDateTimeLocal, toISODate, calculatePastDate,
} from './utils.js';
import { RewrittenData } from './rewrite.js';

// field ids
const FIELDS = ['date-from', 'date-to'];

// tool elements
const FORM = document.getElementById('timeframe-form');
const PICKER = FORM.querySelector('#timeframe');
const PICKER_DROPDOWN = FORM.querySelector('#timeframe-menu');
const PICKER_OPTIONS = PICKER_DROPDOWN.querySelectorAll('[role="option"]');
const DATETIME_WRAPPER = FORM.querySelector('.datetime-wrapper');
const [FROM, TO] = DATETIME_WRAPPER.querySelectorAll('input');
const TABLE = document.querySelector('table');
const RESULTS = TABLE.querySelector('.results');
const ERROR = TABLE.querySelector('.error');
const LOGIN = TABLE.querySelector('.login');
const SOURCE_EXPANDER = TABLE.querySelector('#source-expander');
const PATH_EXPANDER = TABLE.querySelector('#path-expander');
const FILTER = document.getElementById('logs-filter');
const DOWNLOADCSV = document.getElementById('download-csv');

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
  button.dataset.label = button.textContent || 'Submit';
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
 * Disables all form elements within specified form.
 * @param {HTMLFormElement} form - Form element.
 * @param {HTMLFormElement} button - Form's submit button.
 */
function disableForm(form, button) {
  showLoadingButton(button);
  [...form.elements].forEach((el) => {
    el.disabled = true;
  });
}

/**
 * Enables all form elements within specified form.
 * @param {HTMLFormElement} form - Form element.
 * @param {HTMLFormElement} button - Form's submit button.
 */
function enableForm(form, button) {
  resetLoadingButton(button);
  [...form.elements].forEach((el) => {
    el.disabled = false;
  });
}

/**
 * Sets the max and current values for custom date inputs based on specified timeframe.
 * @param {string} timeframe - Timeframe for setting values, either "DD:HH:MM" or "today".
 * @param {HTMLInputElement} from - Input element for start date.
 * @param {HTMLInputElement} to - Input element for end date.
 */
function setTimeframeValues(timeframe, from, to) {
  const now = new Date();
  [from, to].forEach((d) => {
    d.max = toDateTimeLocal(now);
  });
  to.value = toDateTimeLocal(now);
  if (timeframe.includes(':')) {
    const [days, hours, mins] = timeframe.split(':').map((t) => parseInt(t, 10));
    const date = calculatePastDate(days, hours, mins, now);
    from.value = toDateTimeLocal(date);
  } else if (timeframe === 'today') {
    const midnight = now;
    midnight.setHours(0, 0, 0, 0);
    from.value = toDateTimeLocal(midnight);
  }
}

/**
 * Toggles visibility/editability of custom date inputs based on selected timeframe.
 * @param {string} timeframe - Selected timeframe, where "Custom" enables custom date inputs.
 */
function selectTimeframe(timeframe) {
  const custom = timeframe === 'Custom';
  // select picker option
  PICKER_OPTIONS.forEach((option) => {
    const { value } = option.dataset;
    const text = option.textContent.toLowerCase();
    option.setAttribute('aria-selected', value === timeframe.toLowerCase() || text === timeframe.toLowerCase());
  });
  PICKER.dataset.custom = custom;
  PICKER.value = timeframe;
  // update from and to fields
  [FROM, TO].forEach((input) => {
    input.setAttribute('aria-hidden', !custom);
    input.readOnly = !custom;
  });
}

// table management
/**
 * Updates visibility of specific table sections based on display state.
 * @param {string} show - Class name of table section to display.
 */
function updateTableDisplay(show) {
  // loop through tbodies and hide based on the show param
  TABLE.querySelectorAll('tbody').forEach((tbody) => {
    tbody.setAttribute('aria-hidden', show !== tbody.className);
  });
  FILTER.value = '';
  // disable filter if not showing results
  FILTER.disabled = show !== 'results';
}

/**
 * Updates table to display error message based on HTTP error code.
 * @param {number} status - HTTP error status code.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 */
async function updateTableError(status, org, site) {
  const messages = {
    400: 'The request for logs could not be processed.',
    403: 'Insufficient permissions to view the requested logs. Sign in with a different user to view the requested logs.',
    404: 'The requested logs could not be found.',
    Project: `${org}/${site} project not found.`,
  };

  const tbody = status === 401 ? LOGIN : ERROR;
  const text = messages[status] || 'Unable to display the requested logs.';
  const title = tbody.querySelector('strong');
  const message = tbody.querySelector('p:last-of-type');

  if (status !== 401) {
    title.textContent = `${status} Error`;
    message.textContent = text;
  }
  updateTableDisplay(status === 401 ? 'login' : 'error');
  DOWNLOADCSV.classList.remove('outline');
  DOWNLOADCSV.classList.add('disabled');
}

/**
 * Clears all content within a specified table body.
 * @param {HTMLElement} table - Table body element.
 */
function clearTable(table) {
  table.innerHTML = '';
  updateTableDisplay('no-results');
  DOWNLOADCSV.classList.remove('outline');
  DOWNLOADCSV.classList.add('disabled');
}

/**
 * Class representing transformed data set with methods to rewrite/format properties for display.
 */
/**
 * Builds a table row populated with log data.
 * @param {Object} data - Log data object.
 * @param {string} live - Hostname for live environment.
 * @param {string} preview - Hostname for preview environment.
 * @returns {HTMLTableRowElement} Table row element with populated cells.
 */
function buildLog(data, live, preview) {
  const row = document.createElement('tr');
  const cols = [
    'timestamp',
    'route',
    'user',
    'source',
    'org',
    'site',
    'owner',
    'repo',
    'ref',
    'path',
    // 'updated',
    // 'changes',
    'unmodified',
    'errors',
    'method',
    'status',
    'ip',
    'duration',
  ];
  const formattedData = new RewrittenData(data, live, preview);
  formattedData.rewrite(cols);

  cols.forEach((col) => {
    const cell = document.createElement('td');
    if (formattedData.data[col]) cell.innerHTML = formattedData.data[col];
    else cell.textContent = '-';
    if (col === 'path' && data.errors !== '-') {
      const errorSymbol = document.createElement('i');
      errorSymbol.classList.add('symbol-error');
      errorSymbol.textContent = '!';
      errorSymbol.title = 'Expand column to see error details';
      cell.appendChild(errorSymbol);
    }
    row.classList.add(data.route || data.source);
    if (col === 'unmodified' || col === 'duration') cell.dataset.type = 'numerical';
    row.append(cell);
  });
  return row;
}

/**
 * Displays array of log data in a table.
 * @param {Object[]} logs - Array of log data objects.
 * @param {string} live - Hostname for live environment.
 * @param {string} preview - Hostname for preview environment.
 */
function displayLogs(logs, live, preview) {
  logs.forEach((log) => {
    const row = buildLog(log, live, preview);
    RESULTS.prepend(row);
  });
  updateTableDisplay(logs.length ? 'results' : 'no-results');

  // Enable download button only if there are logs to export
  if (logs.length > 0) {
    DOWNLOADCSV.classList.add('outline');
    DOWNLOADCSV.classList.remove('disabled');
  } else {
    DOWNLOADCSV.classList.remove('outline');
    DOWNLOADCSV.classList.add('disabled');
  }
}

/**
 * Constructs query params based on the provided timeframe.
 * @param {string} timeframe - Timeframe for logs.
 * @returns {string} Constructed query params.
 */
function writeTimeParams(timeframe) {
  if (timeframe === 'custom' || timeframe === 'today') {
    const [from, to] = [FROM, TO].map((i) => encodeURIComponent(toISODate(i.value)));
    return `from=${from}&to=${to}`;
  }
  const [days, hours, mins] = timeframe.split(':').map((v) => parseInt(v, 10));
  // eslint-disable-next-line no-nested-ternary
  return (days > 0)
    ? `since=${days}d`
    : (hours > 0)
      ? `since=${hours}h`
      : `since=${mins}m`;
}

/**
 * Fetches all log entries with pagination.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 * @param {string} timeframe - Timeframe for fetching logs.
 * @returns {Promise<>} Object containing all log entries and/or an error.
 */
async function fetchAllLogs(org, site, timeframe) {
  const logs = [];
  const timeParams = Object.fromEntries(new URLSearchParams(writeTimeParams(timeframe)));
  let nextToken;
  let firstPage = true;

  do {
    const params = nextToken ? { ...timeParams, nextToken } : timeParams;
    const policy = firstPage ? AuthMode.PREFLIGHT_AND_RETRY : AuthMode.RETRY_ON_401;
    firstPage = false;
    // eslint-disable-next-line no-await-in-loop
    const res = await executeAdminRequest(
      () => admin.log({ org, site }).get('', { params }),
      { org, site, policy },
    );
    if (!res) return { logs, error: { status: 401 } };
    if (!res.ok) return { logs, error: { status: res.status } };
    // eslint-disable-next-line no-await-in-loop
    const json = await res.json();
    logs.push(...json.entries);
    nextToken = json.nextToken || null;
  } while (nextToken);

  return { logs, error: null };
}

/**
 * Fetches all logs for a specified site within a given timeframe.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 * @param {string} timeframe - Timeframe for fetching logs.
 * @returns {Promise<>} Object containing log entries or an error.
 */
async function fetchLogs(org, site, timeframe) {
  try {
    const { logs, error } = await fetchAllLogs(org, site, timeframe);
    return { logs, error };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log('Failed to fetch logs:', error);
    return { logs: [], error };
  }
}

/**
 * Fetches the live and preview host URLs for org/site.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 * @returns {Promise<>} Object with `live` and `preview` hostnames.
 */
async function fetchHosts(org, site) {
  const res = await executeAdminRequest(
    () => admin.status({ org, site }).get(''),
    { org, site, policy: AuthMode.PREFLIGHT_AND_RETRY },
  );
  if (!res) return { error: { status: 401 } };
  if (!res.ok) return { error: { status: res.status } };
  const json = await res.json();
  return {
    live: new URL(json.live.url).host,
    preview: new URL(json.preview.url).host,
  };
}

/**
 * Updates current URL query params with form data.
 * @param {Object} data - Form data.
 */
function updateParams(data) {
  const url = new URL(window.location.href);
  FIELDS.forEach((field) => {
    if (data[field]) {
      url.searchParams.set(field, toDateTimeLocal(data[field]));
    }
  });
  window.history.replaceState({}, document.title, url.href);
}

/**
 * Downloads CSV file with the provided data.
 * @param {string} csvData - CSV formatted data string.
 */
function downloadCSVFile(csvData) {
  // Create a Blob from the CSV data
  const csvBlob = new Blob([csvData], { type: 'text/csv' });

  // Create a temporary link element
  const tempLink = document.createElement('a');
  tempLink.href = URL.createObjectURL(csvBlob);
  tempLink.download = 'log-viewer.csv';

  // Append the link to the document, trigger the download, and remove the link
  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
}

/**
 * Extracts text content from a cell, handling links and formatted content.
 * @param {HTMLTableCellElement} cell - Table cell element.
 * @returns {string} Text content of the cell.
 */
function getCellText(cell) {
  // If cell contains a link, get the link text
  if (cell.querySelector('a')) {
    return cell.querySelector('a').textContent;
  }
  // If cell contains a button, get the button value
  if (cell.querySelector('button')) {
    return cell.querySelector('button').getAttribute('value') || cell.querySelector('button').textContent;
  }
  // If cell contains a status light, extract just the text
  if (cell.querySelector('.status-light')) {
    return cell.querySelector('.status-light').textContent;
  }
  // If cell contains code, get the code text
  if (cell.querySelector('code')) {
    return cell.querySelector('code').textContent;
  }
  // Otherwise just get text content
  return cell.textContent;
}

/**
 * Registers event listeners to handle form interactions, table updates, and UI behavior.
 */
async function registerListeners() {
  // await initConfigField();

  // enable timeframe dropdown
  PICKER.addEventListener('click', (e) => {
    const { target } = e;
    const expanded = target.getAttribute('aria-expanded') === 'true';
    target.setAttribute('aria-expanded', !expanded);
    PICKER_DROPDOWN.hidden = expanded;
  });

  PICKER_DROPDOWN.addEventListener('click', (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) {
      PICKER.value = option.textContent;
      PICKER.setAttribute('aria-expanded', false);
      PICKER_DROPDOWN.hidden = true;
      PICKER_OPTIONS.forEach((o) => o.setAttribute('aria-selected', o === option));
      const { value } = option.dataset;
      setTimeframeValues(value, FROM, TO);
      // enable custom timeframe option
      const custom = value === 'custom';
      PICKER.dataset.custom = custom;
      DATETIME_WRAPPER.hidden = !custom;
      [FROM, TO].forEach((input) => {
        input.setAttribute('aria-hidden', !custom);
        input.readOnly = !custom;
      });
    }
  });

  // enable form clear
  FORM.addEventListener('reset', (e) => {
    e.preventDefault();
    [...e.target.elements].forEach((el) => {
      el.value = '';
    });
    clearTable(RESULTS);
    selectTimeframe('Last 24 hours');
    setTimeframeValues('1:00:00', FROM, TO);
    updateTableDisplay('no-results', TABLE);
  });

  // enable form submission
  FORM.addEventListener('submit', async (e) => {
    e.preventDefault();

    const { target, submitter } = e;
    disableForm(target, submitter);
    clearTable(RESULTS);
    updateTableDisplay('loading', TABLE);

    const data = getFormData(target);
    const { org, site } = data;
    if (org && site) {
      // validate org/site config
      const { live, preview, error: fetchHostError } = await fetchHosts(org, site);
      if (fetchHostError) {
        updateTableError(fetchHostError.status, org, site);
      } else if (live && preview) {
        // ensure log access
        const timeframe = [...PICKER_OPTIONS].find((o) => o.getAttribute('aria-selected') === 'true').dataset.value;
        const { logs, error } = await fetchLogs(org, site, timeframe);
        if (!error) {
          displayLogs(logs, live, preview);
          updateConfig();
          updateParams(data);
        } else {
          updateTableError(error.status, org, site);
        }
      } else {
        updateTableError('Project', org, site);
      }
    }

    enableForm(target, submitter);
  });

  // enable CSV download
  DOWNLOADCSV.addEventListener('click', () => {
    let csvData = [];
    // Get the header data
    const headers = [];
    const headerCols = TABLE.querySelector('thead').querySelectorAll('tr > th');
    for (let i = 0; i < headerCols.length; i += 1) {
      // Get header text, excluding any button text inside
      const header = headerCols[i].cloneNode(true);
      const buttons = header.querySelectorAll('button');
      buttons.forEach((btn) => btn.remove());
      headers.push(`"${header.textContent.trim()}"`);
    }
    csvData.push(headers.join(','));

    // Get each row data
    const rows = RESULTS.getElementsByTagName('tr');
    for (let i = 0; i < rows.length; i += 1) {
      // Skip hidden rows
      if (rows[i].getAttribute('aria-hidden') === 'true') {
        // eslint-disable-next-line no-continue
        continue;
      }

      // Get each column data
      const cols = rows[i].querySelectorAll('td');

      // Stores each csv row data
      const csvrow = [];
      for (let j = 0; j < cols.length; j += 1) {
        const text = getCellText(cols[j]).trim();
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          csvrow.push(`"${text.replace(/"/g, '""')}"`);
        } else {
          csvrow.push(text);
        }
      }

      // Combine each column value with comma
      csvData.push(csvrow.join(','));
    }
    // Combine each row data with new line character
    csvData = csvData.join('\n');
    downloadCSVFile(csvData);
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

  // enable admin details modal
  RESULTS.addEventListener('click', async (e) => {
    const { target } = e;
    if (target.dataset.url) {
      showLoadingButton(target);
      try {
        const url = new URL(target.dataset.url);
        const { createModal } = await import('../../blocks/modal/modal.js');
        const { org, site } = getFormData(FORM);
        const res = await executeAdminRequest(
          () => admin.raw('GET', url.href),
          { org, site },
        );
        if (!res || !res.ok) throw new Error(`Failed to fetch details: ${res?.status}`);
        const json = await res.json();
        const modal = document.createElement('div');
        modal.innerHTML = `<pre><code class="language-js">${JSON.stringify(json, null, 2)}
          </code></pre>`;
        const { showModal } = await createModal(modal.childNodes);
        highlight(document.querySelector('.modal'));
        showModal();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log('Could not create modal:', error);
      }
      resetLoadingButton(target);
    }
  });

  RESULTS.addEventListener('click', loadPrism, { once: true });

  // enable table column expand/collapse
  [SOURCE_EXPANDER, PATH_EXPANDER].forEach((expander) => {
    expander.addEventListener('click', () => {
      const type = expander.id.split('-')[0];
      const expanded = TABLE.dataset[`${type}Expand`] === 'true';
      TABLE.dataset[`${type}Expand`] = !expanded;
      expander.setAttribute('aria-expanded', !expanded);
    });
  });
}

registerListeners();

/**
 * Initializes the max date value for date input fields and updates it every minute.
 * @param {HTMLInputElement} from - "from" date input element.
 * @param {HTMLInputElement} to - "to" date input element.
 */
function initDateMax(from, to) {
  [from, to].forEach((d) => {
    d.max = toDateTimeLocal(new Date());
  });
  setInterval(() => {
    [from, to].forEach((d) => {
      d.max = toDateTimeLocal(new Date());
    });
  }, 60 * 1000);
}

initDateMax(FROM, TO);

/**
 * Populates fields with values from URL query params.
 * @param {string} search - Query string containing URL params.
 * @param {Document} doc - Document object.
 */
function populateFromParams(search, doc) {
  const params = new URLSearchParams(search);
  if (params && params.size > 0) {
    FIELDS.forEach((field) => {
      const param = params.get(field);
      const el = doc.getElementById(field);
      if (param && el) {
        el.value = toDateTimeLocal(new Date(param));
        selectTimeframe('Custom');
      }
    });
  }
}

async function populateForm(doc) {
  populateFromParams(window.location.search, doc);
  if (PICKER.value !== 'Custom') {
    // set default timeframe if not already set by params
    setTimeframeValues('1:00:00', FROM, TO);
  }
  await initConfigField();
}

registerToolReady(populateForm(document));
