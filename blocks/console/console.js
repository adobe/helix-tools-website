const STORAGE_KEY = 'aem-console-log';

export const CONSOLE_LEVEL = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
};

/**
 * Escapes HTML to prevent XSS attacks.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return String(text);
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Returns a formatted timestamp string (HH:MM:SS.mmm).
 */
function getTimestamp() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const padMs = (n) => n.toString().padStart(3, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${padMs(now.getMilliseconds())}`;
}

/**
 * Reads the stored log entries from sessionStorage.
 * @returns {Array}
 */
function readStorage() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

/**
 * Persists a log entry to sessionStorage.
 * @param {object} entry
 */
function persistEntry(entry) {
  const entries = readStorage();
  entries.unshift(entry);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Builds a table row for a request log entry.
 */
function buildRequestRow({
  status, method, url, error, time,
}) {
  const row = document.createElement('tr');

  const statusCell = document.createElement('td');
  statusCell.innerHTML = `<span class="status-light http${Math.floor(status / 100) % 10}">${escapeHtml(status)}</span>`;
  row.append(statusCell);

  const methodCell = document.createElement('td');
  methodCell.textContent = method;
  row.append(methodCell);

  const urlCell = document.createElement('td');
  urlCell.textContent = url;
  if (!error) urlCell.colSpan = 2;
  row.append(urlCell);

  if (error) {
    const errorCell = document.createElement('td');
    errorCell.textContent = error;
    row.append(errorCell);
  }

  const timeCell = document.createElement('td');
  timeCell.textContent = time;
  row.append(timeCell);

  return row;
}

/**
 * Builds a table row for a message log entry.
 */
function buildMessageRow({
  level, action, message, time,
}) {
  const row = document.createElement('tr');

  const levelCell = document.createElement('td');
  levelCell.innerHTML = `<span class="status-light level-${escapeHtml(level)}">${escapeHtml(level.toUpperCase())}</span>`;
  row.append(levelCell);

  const actionCell = document.createElement('td');
  actionCell.textContent = action;
  row.append(actionCell);

  const msgCell = document.createElement('td');
  msgCell.colSpan = 2;
  msgCell.textContent = message;
  row.append(msgCell);

  const timeCell = document.createElement('td');
  timeCell.textContent = time;
  row.append(timeCell);

  return row;
}

/**
 * Builds a table row from a stored entry (either type).
 */
function buildRowFromEntry(entry) {
  return entry.type === 'request' ? buildRequestRow(entry) : buildMessageRow(entry);
}

/**
 * Shows the unread indicator if the panel is closed.
 * @param {HTMLElement} block
 */
function markUnread(block) {
  const toggle = block.querySelector('.console-toggle');
  const panel = block.querySelector('.console-panel');
  if (toggle && panel && panel.getAttribute('aria-hidden') !== 'false') {
    toggle.classList.add('has-unread');
  }
}

// Pre-init queue for messages arriving before decorate runs
const preInitQ = [];

/**
 * Appends a row to the console table and marks unread if needed.
 * @param {HTMLElement} block
 * @param {HTMLElement} row
 */
function appendRow(block, row) {
  const tbody = block.querySelector('tbody');
  if (tbody) {
    while (preInitQ.length > 0) {
      const queued = preInitQ.shift();
      tbody.prepend(queued);
    }
    tbody.prepend(row);
    const emptyMsg = block.querySelector('.console-empty');
    if (emptyMsg) emptyMsg.remove();
    const clearBtnEl = block.querySelector('.console-clear');
    if (clearBtnEl) clearBtnEl.hidden = false;
    markUnread(block);
  } else {
    preInitQ.push(row);
  }
}

/**
 * Fetches the terminal SVG icon.
 * @returns {Promise<SVGElement|null>}
 */
async function fetchTerminalIcon() {
  try {
    const resp = await fetch('/icons/terminal.svg');
    if (resp.ok) {
      const temp = document.createElement('div');
      temp.innerHTML = await resp.text();
      return temp.querySelector('svg');
    }
  } catch {
    // icon fetch failed
  }
  return null;
}

/**
 * Closes the console panel and resets aria state.
 */
function closePanel(toggle, panel) {
  toggle.setAttribute('aria-expanded', 'false');
  panel.setAttribute('aria-hidden', 'true');
}

/**
 * Sets up toggle, click-outside, and Escape key handling for the panel.
 */
function initPanelToggle(block, toggle, panel) {
  function removeListeners() {
    // eslint-disable-next-line no-use-before-define
    document.removeEventListener('click', clickOutsideListener);
    // eslint-disable-next-line no-use-before-define
    window.removeEventListener('keydown', escapeListener);
  }

  function clickOutsideListener(e) {
    if (!e.target.closest('.console')) {
      closePanel(toggle, panel);
      removeListeners();
    }
  }

  function escapeListener(e) {
    if (e.key === 'Escape') {
      closePanel(toggle, panel);
      toggle.focus();
      removeListeners();
    }
  }

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      closePanel(toggle, panel);
      removeListeners();
    } else {
      toggle.setAttribute('aria-expanded', 'true');
      panel.setAttribute('aria-hidden', 'false');
      // Clear unread indicator on open
      toggle.classList.remove('has-unread');
      document.addEventListener('click', clickOutsideListener);
      window.addEventListener('keydown', escapeListener);
    }
  });
}

/**
 * Backward-compatible export: logs an HTTP response.
 * @param {HTMLElement} block
 * @param {number} httpStatus
 * @param {Array} cols - [method, url, error]
 */
export function logResponse(block, httpStatus, cols) {
  if (block && typeof block.logRequest === 'function') {
    block.logRequest({
      status: httpStatus,
      method: cols[0],
      url: cols[1],
      error: cols[2] || '',
    });
  }
}

/**
 * Backward-compatible export: logs a message.
 * @param {HTMLElement} block
 * @param {string} level
 * @param {Array} cols - [action, message]
 */
export function logMessage(block, level, cols) {
  if (block && typeof block.logMessage === 'function') {
    block.logMessage({
      level,
      action: cols[0],
      message: cols[1],
    });
  }
}

export default async function decorate(block) {
  block.replaceChildren();

  // Build icon toggle button
  const toggle = document.createElement('button');
  toggle.className = 'console-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-label', 'Toggle activity log');
  toggle.title = 'Activity log';

  const icon = await fetchTerminalIcon();
  if (icon) toggle.append(icon);

  const indicator = document.createElement('span');
  indicator.className = 'console-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  toggle.append(indicator);

  // Build dropdown panel
  const panel = document.createElement('div');
  panel.className = 'console-panel';
  panel.setAttribute('aria-hidden', 'true');

  // Panel header with clear button
  const panelHeader = document.createElement('div');
  panelHeader.className = 'console-header';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'console-clear';
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear activity log');
  panelHeader.append(clearBtn);

  const table = document.createElement('table');
  table.id = 'console';
  const tbody = document.createElement('tbody');

  function showEmptyState() {
    const row = buildMessageRow({
      level: CONSOLE_LEVEL.INFO, action: '', message: 'No activity yet', time: '',
    });
    row.classList.add('console-empty');
    tbody.replaceChildren(row);
    clearBtn.hidden = true;
  }

  showEmptyState();
  table.append(tbody);
  panel.append(panelHeader, table);

  clearBtn.addEventListener('click', () => {
    sessionStorage.removeItem(STORAGE_KEY);
    showEmptyState();
  });

  block.append(toggle, panel);

  // Restore messages from sessionStorage
  const stored = readStorage();
  stored.forEach((entry) => {
    tbody.append(buildRowFromEntry(entry));
  });

  // Flush pre-init queue
  while (preInitQ.length > 0) {
    tbody.prepend(preInitQ.shift());
  }

  // If there are stored or queued messages, remove empty state and show unread
  if (stored.length > 0 || preInitQ.length > 0) {
    const empty = tbody.querySelector('.console-empty');
    if (empty) empty.remove();
    clearBtn.hidden = false;
  }
  if (stored.length > 0) {
    toggle.classList.add('has-unread');
  }

  // Bind DOM-bound API methods
  block.logRequest = ({
    status, method, url, error = '',
  }) => {
    const time = getTimestamp();
    const entry = {
      type: 'request', status, method, url, error, time,
    };
    const row = buildRequestRow(entry);
    appendRow(block, row);
    persistEntry(entry);
  };

  block.logMessage = ({ level, action, message }) => {
    const time = getTimestamp();
    const entry = {
      type: 'message', level, action, message, time,
    };
    const row = buildMessageRow(entry);
    appendRow(block, row);
    persistEntry(entry);
  };

  // Set up panel toggle interaction
  initPanelToggle(block, toggle, panel);

  return block;
}
