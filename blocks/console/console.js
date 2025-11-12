/**
 * Logs a response to the console table.
 * @param {HTMLElement} block - The console block element.
 * @param {Array} cols - Array containing response information [status, method, url, error].
 */
export function logResponse(block, cols) {
  const tbody = block.querySelector('tbody');

  // Show the console when first log entry is added
  block.removeAttribute('aria-hidden');

  const row = document.createElement('tr');
  // get the current time in hh:mm:ss format
  const now = new Date();
  const pad = (num) => num.toString().padStart(2, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // add each column (including time) to the row
  [...cols, time].forEach((col, i) => {
    const cell = document.createElement('td');
    if (!i) { // decorate status code
      const code = `<span class="status-light http${Math.floor(col / 100) % 10}">${col}</span>`;
      cell.innerHTML = code;
    } else cell.textContent = col;
    row.append(cell);
  });
  tbody.prepend(row);
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
