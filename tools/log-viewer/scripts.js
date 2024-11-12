/* eslint-disable class-methods-use-this */
// field ids
const FIELDS = ['org', 'site', 'date-from', 'date-to'];

// tool elements
const FORM = document.getElementById('timeframe-form');
const ORG = FORM.querySelector('#org');
const ORG_LIST = FORM.querySelector('#org-list');
const SITE = FORM.querySelector('#site');
const SITE_LIST = FORM.querySelector('#site-list');
const PICKER = FORM.querySelector('#timeframe');
const PICKER_DROPDOWN = FORM.querySelector('#timeframe-menu');
const PICKER_OPTIONS = PICKER_DROPDOWN.querySelectorAll('[role="option"]');
const DATETIME_WRAPPER = FORM.querySelector('.datetime-wrapper');
const [FROM, TO] = DATETIME_WRAPPER.querySelectorAll('input');
const TABLE = document.querySelector('table');
const RESULTS = TABLE.querySelector('.results');
const ERROR = TABLE.querySelector('.error');
const SOURCE_EXPANDER = TABLE.querySelector('#source-expander');
const PATH_EXPANDER = TABLE.querySelector('#path-expander');
const FILTER = document.getElementById('logs-filter');

// utility functions
function getFormData(form) {
  const data = {};
  [...form.elements].forEach((field) => {
    const { name, type, value } = field;
    if (name && type && value) {
      switch (type) {
        case 'number':
        case 'range':
          data[name] = parseFloat(value, 10);
          break;
        case 'date':
        case 'datetime-local':
          data[name] = new Date(value);
          break;
        case 'checkbox':
          if (field.checked) {
            if (data[name]) data[name].push(value);
            else data[name] = [value];
          }
          break;
        case 'radio':
          if (field.checked) data[name] = value;
          break;
        case 'url':
          data[name] = new URL(value);
          break;
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

function debounce(func, wait) {
  let timeout;
  // eslint-disable-next-line func-names
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// date management
function pad(number) {
  return number.toString().padStart(2, '0');
}

function toDateTimeLocal(date) {
  // convert date
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  // convert time
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toUTCDate(date) {
  const dd = pad(date.getUTCDate());
  const mm = pad(date.getUTCMonth() + 1);
  const yyyy = date.getUTCFullYear();
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${mm}/${dd}/${yyyy} ${hours}:${minutes} UTC`;
}

function toISODate(str) {
  const date = new Date(str);
  return date.toISOString();
}

function calculatePastDate(days, hours, mins, now = new Date()) {
  const newDate = now;
  if (days > 0) newDate.setDate(newDate.getDate() - days);
  if (hours > 0) newDate.setHours(newDate.getHours() - hours);
  if (mins > 0) newDate.seMinutes(newDate.geMinutes() - mins);
  return newDate;
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
    option.setAttribute('aria-selected', option.dataset.value === timeframe.toLowerCase());
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
 * @param {string} preview - Hostname for preview environment.
 * @param {string} site - Site name within org.
 */
function updateTableError(status, preview, site) {
  const messages = {
    400: 'The request for logs could not be processed.',
    401: `<a href="https://${preview}" target="_blank">Sign in to the ${site} project sidekick</a> 
      to view the requested logs.`,
    403: 'Insufficient permissions to view the requested logs.',
    404: 'The requested logs could not be found.',
    Project: `${site} project not found.`,
  };

  const text = messages[status] || 'Unable to display the requested logs.';
  const title = ERROR.querySelector('strong');
  const message = ERROR.querySelector('p:last-of-type');
  title.textContent = `${status} Error`;
  message.innerHTML = text;
  updateTableDisplay('error', TABLE);
}

function clearTable(table) {
  table.innerHTML = '';
  updateTableDisplay('no-results', table.closest('table'));
}

class RewrittenData {
  /**
   * Creates instance of RewrittenData.
   * @param {Object} data - Original data object.
   * @param {string} live - Hostname for live environment.
   * @param {string} preview - Hostname for preview environment.
  */
  constructor(data, live, preview) {
    this.data = data;
    this.live = live;
    this.preview = preview;
  }

  /**
   * Formats timestamp value into UTC format.
   * @param {string|number|null} value - Timestamp.
   * @returns {string} Formatted UTC date (or '-' if no value provided).
   */
  timestamp(value) {
    if (!value) return '-';
    return toUTCDate(new Date(value));
  }

  /**
   * Formats user email address into a :mailto link.
   * @param {string|null} value - User email address.
   * @returns {string} Mailto link formatted from email address (or '-' if no value provided).
   */
  user(value) {
    if (!value) return '-';
    return `<a href="mailto:${value}" title="${value}">${value.split('@')[0]}</a>`;
  }

  /**
   * Generates link or button based on type of path.
   * @param {string|null} value - Path or identifier for constructing the link/button.
   * @returns {string} Link or button (or '-' if no value or unhandled type).
   */
  path(value) {
    const writeA = (href, text) => `<a href="https://${href}" target="_blank">${text}</a>`;
    const writeAdminDetails = (href, text) => `<button
        type='button'
        class='button outline'
        data-url='https://${href}'
        value='${text}'
        title='${text}'>
          ${text.length > 26 ? `${text.substring(0, 26)}…` : text}
      </button>`;
    // path is created based on route/source
    const ADMIN = 'admin.hlx.page';
    const type = this.data.route || this.data.source;
    if (!type) return value || '-';
    if (type === 'code') {
      return writeA(`github.com/${this.data.owner}/${this.data.repo}/tree/${this.data.ref}`, value);
    }
    if (type === 'config') {
      return writeAdminDetails(`${ADMIN}/config/${this.data.org}/sites/${this.data.site}.json`, value);
    }
    if (type === 'index' || type === 'live') {
      return writeA(`${this.live}${value}`, value);
    }
    if (type === 'indexer') {
      if (!this.data.changes) return value || '-';
      // sometimes ms appears in indexer path?
      const updateMs = !this.data.duration;
      if (updateMs) this.data.duration = 0;
      const changes = this.data.changes.map((change) => {
        const segments = change.split(' ');
        const segment = segments.find((s) => s.startsWith('/'));
        if (updateMs) {
          const ms = segments.find((s) => s.endsWith('ms'));
          if (ms && ms !== segment) {
            const number = Number.parseInt(ms.replace('ms', ''), 10);
            if (!Number.isNaN(number)) this.data.duration += number;
          }
        }
        return segment ? writeAdminDetails(`${ADMIN}/index/${this.data.owner}/${this.data.repo}/${this.data.ref}${segment}`, segment) : '/';
      });
      return changes.join('<br /><br />');
    }
    if (type === 'job' || type.includes('-job')) {
      return writeAdminDetails(`${ADMIN}/job/${this.data.owner}/${this.data.repo}/${this.data.ref}${value}/details`, value);
    }
    if (type === 'preview') {
      return writeA(`${this.preview}${value}`, value);
    }
    if (type === 'sitemap') {
      // when source: sitemap, we get arrays of paths
      if (this.data.updated) {
        const paths = this.data.updated[0].map(
          (update) => writeA(`${this.live}${update}`, update),
        );
        return paths.join('<br /><br />');
      }
      // when route: sitemap, we only get a path
      return writeA(`${this.live}${this.data.path}`, this.data.path);
    }
    if (type === 'status') {
      return writeAdminDetails(`${ADMIN}/status/${this.data.owner}/${this.data.repo}/${this.data.ref}${value}`, value);
    }
    // eslint-disable-next-line no-console
    console.warn('unhandled log type:', type, this.data);
    return value || '-';
  }

  /**
   * Formats array of error messages for display.
   * @param {Array|null} value - Array of error objects.
   * @returns {string} Error messages (or '-' if no errors present).
   */
  errors(value) {
    if (!value || value.length === 0) return '-';
    const errs = value.map((err) => {
      const { message, target } = err;
      if (message) {
        return `${message} (${target})`;
      }
      return err;
    });
    return errs.join(', <br />');
  }

  /**
   * Styles HTTP method in code tags.
   * @param {string|null} value - HTTP method.
   * @returns {string} HTTP method wrapped in <code> tags (or '-' if no value provided).
   */
  method(value) {
    if (!value) return '-';
    return `<code>${value}</code>`;
  }

  /**
   * Creates a status light for HTTP status code.
   * @param {number|null} value - HTTP status code.
   * @returns {string} Status light with HTTP status code (or '-' if no value provided).
   */
  status(value) {
    if (!value) return '-';
    const badge = document.createElement('span');
    badge.textContent = value;
    badge.className = `status-light http${Math.floor(value / 100) % 10}`;
    return badge.outerHTML;
  }

  /**
   * Formats the duration in seconds.
   * @param {number|null} value - Duration (in ms).
   * @returns {string} Duration in seconds (or '-' if no value provided).
   */
  duration(value) {
    if (!value) return '-';
    return `${(value / 1000).toFixed(1)} s`;
  }

  /**
   * Transforms data based on key.
   * @param {string[]} keys - Array of keys in data object.
   */
  rewrite(keys) {
    keys.forEach((key) => {
      if (this[key]) {
        this.data[key] = this[key](this.data[key]);
      }
    });
  }
}

function buildLog(data, host) {
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
    'duration',
  ];
  const formattedData = new RewrittenData(data, host);
  formattedData.rewrite(cols);

  cols.forEach((col) => {
    const cell = document.createElement('td');
    if (formattedData.data[col]) cell.innerHTML = formattedData.data[col];
    else cell.textContent = '-';
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
  updateTableDisplay(logs.length ? 'results' : 'no-results', TABLE);
}

function toggleCustomTimeframe(enabled) {
  const picker = document.getElementById('timeframe');
  const datetime = picker.parentElement.querySelector('.datetime-wrapper');
  picker.dataset.custom = enabled;
  datetime.hidden = !enabled;
  [...datetime.children].forEach((child) => {
    child.setAttribute('aria-hidden', !enabled);
  });
}

function updateTimeframe(value) {
  const now = new Date();
  const from = document.getElementById('date-from');
  const to = document.getElementById('date-to');
  [from, to].forEach((field) => {
    field.readOnly = true;
  });
  to.value = toDateTimeLocal(now);
  toggleCustomTimeframe(value === 'custom');
  if (value.includes(':')) {
    const [days, hours, mins] = value.split(':').map((v) => parseInt(v, 10));
    const date = calculatePastDate(days, hours, mins);
    from.value = toDateTimeLocal(date);
  } else if (value === 'today') {
    const midnight = now;
    midnight.setHours(0, 0, 0, 0);
    from.value = toDateTimeLocal(midnight);
  } else if (value === 'custom') {
    [from, to].forEach((field) => {
      field.removeAttribute('readonly');
    });
  }
}

function keepToFromCurrent(doc) {
  const to = doc.getElementById('date-to');
  to.setAttribute('max', toDateTimeLocal(new Date()));
  const timeframe = doc.getElementById('timeframe');
  if (timeframe.value !== 'Custom') {
    const options = [...timeframe.parentElement.querySelectorAll('ul > li')];
    const { value } = options.find((o) => o.textContent === timeframe.value).dataset;
    updateTimeframe(value);
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
  const timeParams = writeTimeParams(timeframe);
  let nextUrl = `https://admin.hlx.page/log/${org}/${site}/main?${timeParams}`;

  do {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(nextUrl);
      if (!res.ok) throw res;
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      logs.push(...json.entries);
      nextUrl = json.links ? json.links.next : null;
    } catch (error) {
      return { logs, error };
    }
  } while (nextUrl);

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
  try {
    const url = `https://admin.hlx.page/status/${org}/${site}/main`;
    const res = await fetch(url);
    if (!res.ok) throw res;
    const json = await res.json();
    return {
      live: new URL(json.live.url).host,
      preview: new URL(json.preview.url).host,
    };
  } catch (error) {
    return {
      live: null,
      preview: null,
    };
  }
}

// org/site management
/**
 * Sets field value and marks as autofilled (if it hasn't been autofilled already).
 * @param {HTMLElement} field - Input field.
 * @param {string} value - Value to set.
 */
function setFieldValue(field, value, type) {
  if (!field.dataset.autofill) {
    field.value = value;
    field.dataset.autofill = type;
    field.dispatchEvent(new Event('input'));
  }
}

/**
 * Populates datalist with options (if options aren't already in datalist).
 * @param {HTMLElement} list - Datalist element.
 * @param {string[]} values - Array of values to populate as options.
 */
function populateList(list, values) {
  values.forEach((value) => {
    if (![...list.options].some((o) => o.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      list.append(option);
    }
  });
}

/**
 * Updates org and site datalists with form data.
 * @param {string} org - Organization name.
 * @param {string} site - Site name within org.
 */
function updateLists(org, site) {
  populateList(ORG_LIST, [org]);
  populateList(SITE_LIST, [site]);
}

/**
 * Resets site datalist to display sites associated with specified org.
 * @param {string} org - Organization name.
 */
function resetSiteListForOrg(org) {
  // clear site list
  while (SITE_LIST.firstChild) SITE_LIST.removeChild(SITE_LIST.firstChild);
  // repopulate site and site list from storage
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (projects && projects.sites && projects.sites[org]) {
    SITE.value = projects.sites[org][0] || '';
    populateList(SITE_LIST, projects.sites[org]);
  }
}

/**
 * Updates current URL query params with form data.
 * @param {Object} data - Form data.
 */
function updateParams(data) {
  const url = new URL(window.location.href);
  url.search = ''; // clear existing params
  FIELDS.forEach((field) => {
    if (data[field]) {
      if (field.startsWith('date-')) {
        url.searchParams.set(field, toDateTimeLocal(data[field]));
      } else {
        url.searchParams.set(field, data[field]);
      }
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
 * Populates org and site fields from local storage.
 */
function populateFromStorage() {
  const projects = JSON.parse(localStorage.getItem('aem-projects'));
  if (projects) {
    if (projects.orgs && projects.orgs[0]) {
      // populate org list
      const { orgs } = projects;
      populateList(ORG_LIST, orgs);
      // populate org field
      const lastOrg = projects.orgs[0];
      setFieldValue(ORG, lastOrg, 'storage');
      if (projects.sites && projects.sites[lastOrg]) {
        // populate site list
        const sites = projects.sites[lastOrg];
        populateList(SITE_LIST, sites);
        // populate site field
        const lastSite = sites[0];
        if (lastSite) setFieldValue(SITE, lastSite, 'storage');
      }
    }
  }
}

/**
 * Populates org field from sidekick.
 */
function populateFromSidekick() {
  // eslint-disable-next-line no-undef
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    const id = 'igkmdomcgoebiipaifhmpfjhbjccggml';
    // eslint-disable-next-line no-undef
    chrome.runtime.sendMessage(id, { action: 'getAuthInfo' }, (orgs) => {
      if (orgs[0]) {
        // populate org list
        populateList(ORG_LIST, orgs);
        // populate org field
        const lastOrg = orgs[0];
        setFieldValue(ORG, lastOrg, 'sidekick');
      }
    });
  }
}

function registerListeners() {
  // enable site when org has value
  ORG.addEventListener('input', () => {
    SITE.disabled = !ORG.value;
  }, { once: true });

  // refresh site datalist to match org
  ORG.addEventListener('change', (e) => {
    resetSiteListForOrg(e.target.value);
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
      const { live, preview } = await fetchHosts(org, site);
      if (live && preview) {
        // ensure log access
        const timeframe = [...PICKER_OPTIONS].find((o) => o.getAttribute('aria-selected') === 'true').dataset.value;
        const { logs, error } = await fetchLogs(org, site, timeframe);
        if (!error) {
          displayLogs(logs, live, preview);
          updateStorage(org, site);
          updateParams(data);
          updateLists(org, site);
        } else {
          updateTableError(error.status, preview, site);
        }
      } else {
        updateTableError('Project', null, `${org}/${site}`);
      }
    }

    enableForm(target, submitter);
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
      try {
        showLoadingButton(target);
        const url = new URL(target.dataset.url);
        const { createModal } = await import('../../blocks/modal/modal.js');
        const res = await fetch(url);
        const json = await res.json();
        const modal = document.createElement('div');
        modal.innerHTML = `<pre>${JSON.stringify(json, null, 2)}
          </pre>`;
        const { showModal } = await createModal(modal.childNodes);
        resetLoadingButton(target);
        showModal();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log('Could not create modal:', error);
      }
    }
  });

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

function initDateTo(doc) {
  const to = doc.getElementById('date-to');
  to.value = toDateTimeLocal(new Date());

  setInterval(() => {
    keepToFromCurrent(doc);
  }, 60 * 100);
}

initDateTo(document);
updateTimeframe('1:00:00');

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
        setFieldValue(el, param, 'params');
        if (field.startsWith('date-')) {
          selectTimeframe('Custom');
        }
      }
    });
  }
}

function populateForm(doc) {
  populateFromParams(window.location.search, doc);
  if (PICKER.value !== 'Custom') {
    // set default timeframe if not already set by params
    setTimeframeValues('1:00:00', FROM, TO);
  }
  populateFromStorage();
  populateFromSidekick();
}

populateForm(document);
