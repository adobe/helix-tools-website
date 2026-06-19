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
 * Calculates past date by subtracting specified days, hours, and minutes from reference date.
 * @param {number} days - Days to subtract.
 * @param {number} hours - Hours to subtract.
 * @param {number} mins - Minutes to subtract.
 * @param {Date} now - Reference date used to calculate past date (default is current date/time).
 * @returns {Date} Date object representing the calculated past date.
 */
export function calculatePastDate(days, hours, mins, now = new Date()) {
  const newDate = new Date(now);
  if (days > 0) newDate.setDate(newDate.getDate() - days);
  if (hours > 0) newDate.setHours(newDate.getHours() - hours);
  if (mins > 0) newDate.setMinutes(newDate.getMinutes() - mins);
  return newDate;
}
