/* eslint-disable class-methods-use-this */
import { loadPrism, highlight } from '../../utils/prism/prism.js';

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
function showLoadingButton(button) {
  button.disabled = true;
  const { width, height } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.style.minHeight = `${height}px`;
  button.dataset.label = button.textContent;
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

function resetLoadingButton(button) {
  button.textContent = button.dataset.label;
  button.removeAttribute('style');
  button.disabled = false;
}

// form management
function toggleResetButton(button, state) {
  button.disabled = state;
}

function disableForm(form) {
  [...form.elements].forEach((el) => {
    el.disabled = true;
  });
}

function enableForm(form) {
  resetLoadingButton(form.querySelector('button[type="submit"]'));
  [...form.elements].forEach((el) => {
    el.disabled = false;
  });
}

function updateTableDisplay(show, table = document.querySelector('table')) {
  const results = table.querySelector('tbody.results');
  const noResults = table.querySelector('tbody.no-results');
  const error = table.querySelector('tbody.error');
  const loading = table.querySelector('tbody.loading');
  [results, noResults, error, loading].forEach((tbody) => {
    tbody.setAttribute('aria-hidden', show !== tbody.className);
  });
  const filter = document.getElementById('logs-filter');
  filter.value = '';
  filter.disabled = show !== 'results';
}

function writeLoginMessage(owner, repo) {
  const siteUrl = document.getElementById('site-url').value;
  const { origin } = new URL(siteUrl);
  if (owner && repo) {
    return `<a href="${origin}" target="_blank">Sign in to the ${repo} project sidekick</a> to view the requested logs.`;
  }
  if (repo) {
    return `Sign in to the ${repo} project sidekick to view the requested logs.`;
  }
  return 'Sign in to this project\'s sidekick view the requested logs.';
}

function registerAdminDetailsListener(buttons) {
  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      showLoadingButton(button);
      const url = new URL(button.dataset.url);
      const { createModal } = await import('../../blocks/modal/modal.js');
      if (url) {
        const res = await fetch(url);
        const jsonContent = await res.json();
        const modalContent = document.createElement('div');
        modalContent.innerHTML = `<pre><code class="language-js">${JSON.stringify(jsonContent, null, 2)}
          </code></pre>`;
        const { showModal } = await createModal(modalContent.childNodes);
        showModal();
        highlight(document.querySelector('.modal'));
      }
      resetLoadingButton(button);
    });
  });
}

function updateTableError(code, text, owner, repo) {
  const messages = {
    400: 'The request for logs could not be processed.',
    401: writeLoginMessage(owner, repo),
    403: 'You do not have permission to view the requested logs.',
    404: 'The requested logs could not be found.',
  };

  // eslint-disable-next-line no-param-reassign
  if (!text) text = messages[code] || 'Unable to display the requested logs.';
  const error = document.querySelector('table > tbody.error');
  const title = error.querySelector('strong');
  const message = error.querySelector('p:last-of-type');
  title.textContent = `${code} Error`;
  message.innerHTML = text;
  updateTableDisplay('error', error.closest('table'));
}

function clearTable(table) {
  table.innerHTML = '';
  updateTableDisplay('no-results', table.closest('table'));
}

class RewrittenData {
  constructor(data, host) {
    this.data = data;
    this.host = host;
  }

  timestamp(value) {
    if (!value) return '-';
    return toUTCDate(new Date(value));
  }

  user(value) {
    if (!value) return '-';
    return `<a href="mailto:${value}" title="${value}">${value.split('@')[0]}</a>`;
  }

  path(value) {
    const writeA = (href, text) => `<a href="https://${href}" target="_blank">${text}</a>`;
    const writeAdminDetails = (href, text) => `<button
        type='button'
        class='admin-details button outline'
        data-url='https://${href}'
        value='${text}'
        title='${text}'>
          ${text.length > 29 ? `${text.substring(0, 29)}…` : text}
      </button>`;
    // path is created based on route/source
    const type = this.data.route || this.data.source;
    if (!type) return value || '-';
    const ADMIN = 'admin.hlx.page';
    if (type === 'code') {
      return writeA(`github.com/${this.data.owner}/${this.data.repo}/tree/${this.data.ref}`, value);
    }
    if (type === 'config') {
      return writeAdminDetails(`${ADMIN}/config/${this.data.org}/sites/${this.data.site}.json`, value);
    }
    if (type === 'index' || type === 'live') {
      return writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.${this.host}.live${value}`, value);
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
      return writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.${this.host}.page${value}`, value);
    }
    if (type === 'sitemap') {
      // when source: sitemap, we get arrays of paths
      if (this.data.updated) {
        const paths = this.data.updated[0].map(
          (update) => writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.${this.host}.live${update}`, update),
        );
        return paths.join('<br /><br />');
      }
      // when route: sitemap, we only get a path
      return writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.${this.host}.live${this.data.path}`, this.data.path);
    }
    if (type === 'status') {
      return writeAdminDetails(`${ADMIN}/status/${this.data.owner}/${this.data.repo}/${this.data.ref}${value}`, value);
    }
    // eslint-disable-next-line no-console
    console.warn('unhandled log type:', type, this.data);
    return value || '-';
  }

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

  method(value) {
    if (!value) return '-';
    return `<code>${value}</code>`;
  }

  status(value) {
    if (!value) return '-';
    const badge = document.createElement('span');
    badge.textContent = value;
    badge.className = `status-light http${Math.floor(value / 100) % 10}`;
    return badge.outerHTML;
  }

  duration(value) {
    if (!value) return '-';
    return `${(value / 1000).toFixed(1)} s`;
  }

  // rewrite data based on key
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

function displayLogs(logs, host) {
  const table = document.querySelector('table');
  const results = table.querySelector('tbody.results');
  logs.forEach((log) => {
    const row = buildLog(log, host);
    results.prepend(row);
  });
  updateTableDisplay(logs.length ? 'results' : 'no-results', table);
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

async function fetchAllLogs(owner, repo, fromValue, toValue) {
  const entries = [];
  let reqError;
  let nextToken;
  do {
    const url = `https://admin.hlx.page/log/${owner}/${repo}/main?from=${fromValue}&to=${toValue}${nextToken ? `&nextToken=${nextToken}` : ''}`;
    // eslint-disable-next-line no-await-in-loop
    const req = await fetch(url);
    if (req.ok) {
      // eslint-disable-next-line no-await-in-loop
      const res = await req.json();
      entries.push(...res.entries);
      nextToken = res.nextToken;
    } else {
      reqError = req;
      nextToken = null;
    }
  } while (nextToken);

  return { entries, reqError };
}

async function fetchLogs(owner, repo, host, form) {
  keepToFromCurrent(document);
  const from = document.getElementById('date-from');
  const fromValue = encodeURIComponent(toISODate(from.value));
  const to = document.getElementById('date-to');
  const toValue = encodeURIComponent(toISODate(to.value));
  const url = `https://admin.hlx.page/log/${owner}/${repo}/main?from=${fromValue}&to=${toValue}`;
  try {
    const { entries, reqError } = await fetchAllLogs(owner, repo, fromValue, toValue);
    if (!reqError) {
      displayLogs(entries, host);
      enableForm(form);
      registerAdminDetailsListener(document.querySelectorAll('button.admin-details'));
    } else {
      await updateTableError(reqError.status, reqError.statusText, owner, repo);
      enableForm(form);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`failed to fetch ${url}:`, error);
    await updateTableError(error.name, error.message);
    enableForm(form);
  }
}

function registerListeners(doc) {
  const TIMEFRAME_FORM = doc.getElementById('timeframe-form');
  const SITE_FIELD = doc.getElementById('site-url');
  const PICKER_FIELD = doc.getElementById('timeframe');
  const PICKER_DROPDOWN = doc.querySelector('.picker-field ul');
  const PICKER_OPTIONS = PICKER_DROPDOWN.querySelectorAll('li');
  const TABLE_FILTER = doc.getElementById('logs-filter');
  const TABLE = doc.querySelector('table');
  const RESULTS = TABLE.querySelector('tbody.results');
  const SOURCE_EXPANDER = doc.getElementById('source-expander');
  const PATH_EXPANDER = doc.getElementById('path-expander');
  const RESET_BUTTON = doc.getElementById('site-reset');

  TIMEFRAME_FORM.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = getFormData(e.srcElement);
    const [rro, host] = new URL(data['site-url']).hostname.split('.');
    const [, repo, owner] = rro.split('--');
    if (owner && repo) {
      disableForm(TIMEFRAME_FORM);
      showLoadingButton(e.submitter);
      toggleResetButton(RESET_BUTTON, false);
      clearTable(RESULTS);
      updateTableDisplay('loading', TABLE);
      fetchLogs(owner, repo, host, TIMEFRAME_FORM);
    } else updateTableError('Site URL', 'Enter a valid hlx/aem page or live URL to see logs.');
  });

  TIMEFRAME_FORM.addEventListener('submit', loadPrism, { once: true });

  TIMEFRAME_FORM.addEventListener('reset', (e) => {
    e.preventDefault();
    SITE_FIELD.value = '';
    PICKER_FIELD.value = 'Last 24 hours';
    updateTimeframe('1:00:00');
    updateTableDisplay('no-results', TABLE);
  });

  SITE_FIELD.addEventListener('input', () => {
    clearTable(RESULTS);
  });

  PICKER_FIELD.addEventListener('click', () => {
    const expanded = PICKER_FIELD.getAttribute('aria-expanded') === 'true';
    PICKER_FIELD.setAttribute('aria-expanded', !expanded);
    PICKER_DROPDOWN.hidden = expanded;
  });

  PICKER_OPTIONS.forEach((option) => {
    option.addEventListener('click', () => {
      PICKER_FIELD.value = option.textContent;
      PICKER_FIELD.setAttribute('aria-expanded', false);
      PICKER_DROPDOWN.hidden = true;
      PICKER_OPTIONS.forEach((o) => o.setAttribute('aria-selected', o === option));
      // update to and from
      updateTimeframe(option.dataset.value);
    });
  });

  const filterTable = (e) => {
    const filter = e.target.value.toLowerCase();
    [...RESULTS.children].forEach((row) => {
      const cells = [...row.children];
      const match = cells.find((c) => {
        const text = c.textContent.toLowerCase();
        return text.includes(filter);
      });
      row.setAttribute('aria-hidden', !match);
    });
  };
  const gentleFilterTable = debounce(filterTable, 300);
  TABLE_FILTER.addEventListener('input', gentleFilterTable);
  TABLE_FILTER.closest('form').addEventListener('submit', (e) => {
    e.preventDefault();
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

registerListeners(document);

function initDateTo(doc) {
  const to = doc.getElementById('date-to');
  to.value = toDateTimeLocal(new Date());

  setInterval(() => {
    keepToFromCurrent(doc);
  }, 60 * 100);
}

initDateTo(document);
updateTimeframe('1:00:00');
