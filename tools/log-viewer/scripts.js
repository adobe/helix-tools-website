/* eslint-disable class-methods-use-this */
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
  const { width } = button.getBoundingClientRect();
  button.style.minWidth = `${width}px`;
  button.dataset.label = button.textContent;
  button.innerHTML = '<i class="symbol symbol-loading"></i>';
}

function resetLoadingButton(button) {
  button.removeAttribute('style');
  button.textContent = button.dataset.label;
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

function enableLogin(owner, repo, form) {
  const url = new URL(`https://admin.hlx.page/login/${owner}/${repo}/main`);
  url.searchParams.set('extensionId', 'cookie');

  const loginWindow = window.open(url, 'Sign in', 'popup,top=233,left=233,width=700,height=467');
  loginWindow.focus();

  const pollTimer = setInterval(() => {
    if (loginWindow.closed) {
      clearInterval(pollTimer);
      enableForm(form);
      // eslint-disable-next-line no-use-before-define
      fetchLogs(owner, repo, form);
    }
  }, 1500);
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

function updateTableError(code, text) {
  const messages = {
    400: 'The request for logs could not be processed.',
    401: 'You need to sign in to view the requested logs.',
    403: 'You do not have permission to view the requested logs.',
    404: 'The requested logs could not be found.',
  };
  // eslint-disable-next-line no-param-reassign
  if (!text) text = messages[code] || 'Unable to display the requested logs.';
  const error = document.querySelector('table > tbody.error');
  const title = error.querySelector('strong');
  const message = error.querySelector('p:last-of-type');
  title.textContent = `${code} Error`;
  message.textContent = text;
  updateTableDisplay('error', error.closest('table'));
}

function clearTable(table) {
  table.innerHTML = '';
  updateTableDisplay('no-results', table.closest('table'));
}

class RewrittenData {
  constructor(data) {
    this.data = data;
  }

  timestamp(value) {
    if (!value) return '-';
    return toUTCDate(new Date(value));
  }

  user(value) {
    if (!value) return '-';
    return `<a href="mailto:${value}">${value}</a>`;
  }

  path(value) {
    const writeA = (href, text) => `<a href="https://${href}" target="_blank">${text}</a>`;
    // path is created based on route/source
    const type = this.data.route || this.data.source;
    if (!type) return value || '-';
    const ADMIN = 'admin.hlx.page';
    if (type === 'code') {
      return writeA(`github.com/${this.data.owner}/${this.data.repo}/tree/${this.data.ref}`, value);
    }
    if (type === 'config') {
      return writeA(`${ADMIN}/config/${this.data.org}/sites/${this.data.site}.json`, value);
    }
    if (type === 'index' || type === 'live') {
      return writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.hlx.live${value}`, value);
    }
    if (type === 'indexer') {
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
        return segment ? writeA(`${ADMIN}/index/${this.data.owner}/${this.data.repo}/${this.data.ref}${segment}`, segment) : '/';
      });
      return changes.join(', <br />');
    }
    if (type === 'job' || type.includes('-job')) {
      return writeA(`${ADMIN}/job/${this.data.owner}/${this.data.repo}/${this.data.ref}${value}/details`, value);
    }
    if (type === 'preview') {
      return writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.hlx.page${value}`, value);
    }
    if (type === 'sitemap') {
      const paths = this.data.updated.map(
        (update) => writeA(`${this.data.ref}--${this.data.repo}--${this.data.owner}.hlx.live${update}`, update),
      );
      return paths.join(', <br />');
    }
    if (type === 'status') {
      return writeA(`${ADMIN}/status/${this.data.owner}/${this.data.repo}/${this.data.ref}${value}`, value);
    }
    // eslint-disable-next-line no-console
    console.warn('unhandled log type:', type, this.data);
    return value || '-';
  }

  errors(value) {
    if (!value || value.length === 0) return '-';
    return value.join(', <br />');
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

function buildLog(data) {
  const row = document.createElement('tr');
  const cols = [
    'timestamp',
    'route',
    'source',
    'org',
    'site',
    'user',
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
  const formattedData = new RewrittenData(data);
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

function displayLogs(logs) {
  const table = document.querySelector('table');
  const results = table.querySelector('tbody.results');
  logs.forEach((log) => {
    const row = buildLog(log);
    results.prepend(row);
  });
  updateTableDisplay(logs.length ? 'results' : 'no-results', table);
}

async function fetchLogs(owner, repo, form) {
  const from = document.getElementById('date-from');
  const fromValue = encodeURIComponent(toISODate(from.value));
  const to = document.getElementById('date-to');
  const toValue = encodeURIComponent(toISODate(to.value));
  const url = `https://admin.hlx.page/log/${owner}/${repo}/main?from=${fromValue}&to=${toValue}`;
  try {
    const req = await fetch(url, { credentials: 'include' });
    if (req.ok) {
      const res = await req.json();
      displayLogs(res.entries);
      enableForm(form);
    } else {
      updateTableError(req.status, req.statusText);
      enableLogin(owner, repo, form);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`failed to fetch ${url}:`, error);
    updateTableError(error.name, error.message);
    enableLogin(owner, repo, form);
  }
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

function registerListeners(doc) {
  const TIMEFRAME_FORM = doc.getElementById('timeframe-form');
  const GITHUB_FIELD = doc.getElementById('github-url');
  const PICKER_FIELD = doc.getElementById('timeframe');
  const PICKER_DROPDOWN = doc.querySelector('.picker-field ul');
  const PICKER_OPTIONS = PICKER_DROPDOWN.querySelectorAll('li');
  const TABLE_FILTER = doc.getElementById('logs-filter');
  const TABLE = doc.querySelector('table');
  const RESULTS = TABLE.querySelector('tbody.results');
  const SOURCE_EXPANDER = doc.getElementById('source-expander');
  const PATH_EXPANDER = doc.getElementById('path-expander');
  const RESET_BUTTON = doc.getElementById('github-reset');

  TIMEFRAME_FORM.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = getFormData(e.srcElement);
    const [, owner, repo] = data['github-url'].pathname.split('/');
    if (owner && repo) {
      disableForm(TIMEFRAME_FORM);
      showLoadingButton(e.submitter);
      toggleResetButton(RESET_BUTTON, false);
      clearTable(RESULTS);
      updateTableDisplay('loading', TABLE);
      fetchLogs(owner, repo, TIMEFRAME_FORM);
    }
  });

  TIMEFRAME_FORM.addEventListener('reset', (e) => {
    e.preventDefault();
    GITHUB_FIELD.value = '';
    PICKER_FIELD.value = 'Last 24 hours';
    updateTimeframe('1:00:00');
    updateTableDisplay('no-results', TABLE);
  });

  GITHUB_FIELD.addEventListener('input', () => {
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
  to.setAttribute('max', toDateTimeLocal(new Date()));

  setInterval(() => {
    const now = new Date();
    to.setAttribute('max', toDateTimeLocal(now));
  }, 60 * 1000);
}

initDateTo(document);
updateTimeframe('1:00:00');
