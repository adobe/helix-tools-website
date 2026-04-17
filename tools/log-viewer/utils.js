/**
 * Pads a number with a leading 0 if necessary, returning a two-character string.
 * @param {number} number - Number.
 * @returns {string} Padded number.
 */
export function pad(number) {
  return number.toString().padStart(2, '0');
}

/**
 * Converts Date object to a formatted datetime-local string.
 * @param {Date} date - Date object.
 * @returns {string} Date and time in "YYYY-MM-DDTHH:MM" format.
 */
export function toDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts Date object to a formatted UTC date and time string.
 * @param {Date} date - Date object.
 * @returns {string} UTC date and time in "MM/DD/YYYY HH:MM UTC" format.
 */
export function toUTCDate(date) {
  const dd = pad(date.getUTCDate());
  const mm = pad(date.getUTCMonth() + 1);
  const yyyy = date.getUTCFullYear();
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${mm}/${dd}/${yyyy} ${hours}:${minutes} UTC`;
}

/**
 * Converts date string to a formatted ISO string.
 * @param {string} str - Date string.
 * @returns {string} Date in ISO format ("YYYY-MM-DDTHH:MM:SS.sssZ").
 */
export function toISODate(str) {
  const date = new Date(str);
  return date.toISOString();
}

/**
 * Calculates past date by subtracting specified days, hours, and minutes from reference date.
 * @param {number} days - Days to subtract.
 * @param {number} hours - Hours to subtract.
 * @param {number} mins - Minutes to subtract.
 * @param {Date} now - Reference date used to calculate past date (default is current date/time).
 * @returns {Date} Date object representing the calculated past date.
 */
export function calculatePastDate(days, hours, mins, now = new Date()) {
  const newDate = now;
  if (days > 0) newDate.setDate(newDate.getDate() - days);
  if (hours > 0) newDate.setHours(newDate.getHours() - hours);
  if (mins > 0) newDate.setMinutes(newDate.getMinutes() - mins);
  return newDate;
}

/**
 * Constructs query params based on the provided timeframe string.
 * Timeframe can be "DD:HH:MM" (e.g. "1:00:00"), "custom", or "today".
 * For "custom" and "today", the caller is expected to pass from/to separately;
 * this function returns the since= variant for structured timeframe strings.
 * @param {string} timeframe - Timeframe for logs.
 * @param {string} [fromISO] - ISO string for the from date (used when timeframe is custom/today).
 * @param {string} [toISO] - ISO string for the to date (used when timeframe is custom/today).
 * @returns {string} Constructed query params.
 */
export function writeTimeParams(timeframe, fromISO, toISO) {
  if (timeframe === 'custom' || timeframe === 'today') {
    const from = encodeURIComponent(fromISO);
    const to = encodeURIComponent(toISO);
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
 * Formats timestamp value into UTC format.
 * @param {string|number|null} value - Timestamp.
 * @returns {string} Formatted UTC date (or '-' if no value provided).
 */
export function formatTimestamp(value) {
  if (!value) return '-';
  return toUTCDate(new Date(value));
}

/**
 * Formats user email address into a mailto link.
 * @param {string|null} value - User email address.
 * @returns {string} Mailto link formatted from email address (or '-' if no value provided).
 */
export function formatUser(value) {
  if (!value) return '-';
  return `<a href="mailto:${value}" title="${value}">${value.split('@')[0]}</a>`;
}

/**
 * Formats array of error objects for display.
 * @param {Array|null} value - Array of error objects.
 * @returns {string} Error messages (or '-' if no errors present).
 */
export function formatErrors(value) {
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
export function formatMethod(value) {
  if (!value) return '-';
  return `<code>${value}</code>`;
}

/**
 * Formats duration from milliseconds to a seconds string.
 * @param {number|null} value - Duration (in ms).
 * @returns {string} Duration in seconds (or '-' if no value provided).
 */
export function formatDuration(value) {
  if (!value) return '-';
  return `${(value / 1000).toFixed(1)} s`;
}

/**
 * Generates a link or button string based on log route/source type.
 * @param {string|null} value - Path or identifier for constructing the link/button.
 * @param {Object} data - Full log data object (provides route, source, owner, repo, etc.).
 * @param {string} live - Hostname for live environment.
 * @param {string} preview - Hostname for preview environment.
 * @returns {string} HTML string for a link or button (or '-' if unhandled).
 */
export function formatPath(value, data, live, preview) {
  const writeA = (href, text) => `<a href="https://${href}" target="_blank">${text}</a>`;
  const writeAdminDetails = (href, text) => `<button
      type='button'
      class='button outline'
      data-url='https://${href}'
      value='${text}'
      title='${text}'>
        ${text.length > 26 ? `${text.substring(0, 26)}…` : text}
    </button>`;

  const ADMIN = 'admin.hlx.page';
  const type = data.route || data.source;
  if (!type) return value || '-';
  if (type === 'code') {
    return writeA(`github.com/${data.owner}/${data.repo}/tree/${data.ref}`, value);
  }
  if (type === 'config') {
    return writeAdminDetails(`${ADMIN}/config/${data.org}/sites/${data.site}.json`, value);
  }
  if (type === 'index' || type === 'live') {
    return writeA(`${live}${value}`, value);
  }
  if (type === 'indexer') {
    if (!data.changes) return value || '-';
    const updateMs = !data.duration;
    if (updateMs) data.duration = 0;
    const changes = data.changes.map((change) => {
      const segments = change.split(' ');
      const segment = segments.find((s) => s.startsWith('/'));
      if (updateMs) {
        const ms = segments.find((s) => s.endsWith('ms'));
        if (ms && ms !== segment) {
          const number = Number.parseInt(ms.replace('ms', ''), 10);
          if (!Number.isNaN(number)) data.duration += number;
        }
      }
      return segment ? writeAdminDetails(`${ADMIN}/index/${data.owner}/${data.repo}/${data.ref}${segment}`, segment) : '/';
    });
    return changes.join('<br /><br />');
  }
  if (type === 'job' || type.includes('-job')) {
    return writeAdminDetails(`${ADMIN}/job/${data.org}/${data.site}/${data.ref}${value}/details`, value);
  }
  if (type === 'snapshot') {
    const jobId = data.job;
    if (jobId) {
      return writeAdminDetails(`${ADMIN}/job/${data.org}/${data.site}/${data.ref}/${jobId}/details`, jobId);
    }
    return value || '-';
  }
  if (type === 'preview') {
    return writeA(`${preview}${value}`, value);
  }
  if (type === 'sitemap') {
    if (data.updated) {
      const paths = data.updated[0].map(
        (update) => writeA(`${live}${update}`, update),
      );
      return paths.join('<br /><br />');
    }
    return writeA(`${live}${data.path}`, data.path);
  }
  if (type === 'status') {
    return writeAdminDetails(`${ADMIN}/status/${data.owner}/${data.repo}/${data.ref}${value}`, value);
  }
  // eslint-disable-next-line no-console
  console.warn('unhandled log type:', type, data);
  return value || '-';
}
