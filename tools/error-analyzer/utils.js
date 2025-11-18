/**
 * Format a date as a relative time string (e.g., "Today", "Yesterday", "2 days ago")
 * @param {string|Date} dateInput - The date to format
 * @returns {string} Formatted relative date string
 */
export function formatRelativeDate(dateInput) {
  const date = new Date(dateInput);

  // Handle invalid dates
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  // Convert both dates to UTC midnight for consistent day comparison
  const now = new Date();
  const dateUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const diffMs = nowUTC - dateUTC;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Handle future dates (shouldn't happen, but just in case)
  if (diffDays < 0) {
    return 'Today';
  }

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  if (diffDays < 14) {
    return 'Last week';
  }
  if (diffDays < 30) {
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks} weeks ago`;
  }
  if (diffDays < 60) {
    return 'Last month';
  }
  if (diffDays < 365) {
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths} months ago`;
  }
  if (diffDays < 730) {
    return 'Last year';
  }
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} years ago`;
}

/**
 * Format a number with K/M/B suffixes for large numbers
 * @param {number} num - The number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(num) {
  if (num < 1000) {
    return num.toString();
  }
  if (num < 1000000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  if (num < 1000000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  return `${(num / 1000000000).toFixed(1)}B`;
}
