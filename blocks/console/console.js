/**
 * Escapes HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(text) {
  if (typeof text !== 'string') {
    return String(text);
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// queue any messages that attempt to log before ready
const preInitQ = [];

/**
 * Appends a row to the console table
 * @param {HTMLElement} block - The console block element
 * @param {HTMLElement} row - The row to append
 */
function appendRow(block, row) {
  // show the console when the first row is added
  block.removeAttribute('aria-hidden');

  const tbody = block.querySelector('tbody');
  if (tbody) {
    while (preInitQ.length > 0) {
      const nextRow = preInitQ.shift();
      tbody.prepend(nextRow);
    }
    tbody.prepend(row);
  } else {
    preInitQ.push(row);
  }
}

/**
 * Logs an HTTP response to the console table.
 * @param {HTMLElement} block - The console block element.
 * @param {number} httpStatus - HTTP status code.
 * @param {Array} cols - Array containing [method, url, error].
 */
export function logResponse(block, httpStatus, cols) {
  const row = document.createElement('tr');
  // get the current time in hh:mm:ss.mmm format
  const now = new Date();
  const pad = (num) => num.toString().padStart(2, '0');
  const padMs = (num) => num.toString().padStart(3, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${padMs(now.getMilliseconds())}`;

  // Status code cell with status light
  const statusCell = document.createElement('td');
  statusCell.innerHTML = `<span class="status-light http${Math.floor(httpStatus / 100) % 10}">${httpStatus}</span>`;
  row.append(statusCell);

  // Add remaining columns (escaped for security)
  cols.forEach((col) => {
    const cell = document.createElement('td');
    cell.textContent = escapeHtml(col);
    row.append(cell);
  });

  // Time cell
  const timeCell = document.createElement('td');
  timeCell.textContent = time;
  row.append(timeCell);

  appendRow(block, row);
}

/**
 * Logs a message to the console table with a log level.
 * @param {HTMLElement} block - The console block element.
 * @param {string} level - Log level: 'info', 'success', 'warning', or 'error'.
 * @param {Array} cols - Array containing columns to display (e.g., [action, message]).
 */
export function logMessage(block, level, cols) {
  const row = document.createElement('tr');
  // get the current time in hh:mm:ss.mmm format
  const now = new Date();
  const pad = (num) => num.toString().padStart(2, '0');
  const padMs = (num) => num.toString().padStart(3, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${padMs(now.getMilliseconds())}`;

  // Level cell with status light (escape level to prevent XSS)
  const levelCell = document.createElement('td');
  levelCell.innerHTML = `<span class="status-light level-${escapeHtml(level)}">${escapeHtml(level.toUpperCase())}</span>`;
  row.append(levelCell);

  // Add remaining columns (escaped for security)
  cols.forEach((col) => {
    const cell = document.createElement('td');
    cell.textContent = escapeHtml(col);
    row.append(cell);
  });

  // Time cell
  const timeCell = document.createElement('td');
  timeCell.textContent = time;
  row.append(timeCell);

  appendRow(block, row);
}

export default function decorate(block) {
  // Create table structure
  const table = document.createElement('table');
  table.id = 'console';
  const tbody = document.createElement('tbody');
  table.append(tbody);
  block.append(table);

  // Hide console by default
  block.setAttribute('aria-hidden', 'true');

  return block;
}
