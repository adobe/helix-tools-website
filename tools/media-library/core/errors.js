/**
 * Error codes and logging for Media Library.
 * Structured console output for diagnostics (never tokens or PII).
 */
export const ErrorCodes = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  EDS_LOG_DENIED: 'EDS_LOG_DENIED',
  EDS_AUTH_EXPIRED: 'EDS_AUTH_EXPIRED',
  BUILD_FAILED: 'BUILD_FAILED',
  VALIDATION_PATH_NOT_FOUND: 'VALIDATION_PATH_NOT_FOUND',
});

export class MediaLibraryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MediaLibraryError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Log error to console with [MediaLibrary] prefix.
 * @param {string} code - Error code
 * @param {Object} details - Sanitized key/value pairs (no tokens, PII)
 */
export function logMediaLibraryError(code, details = {}) {
  const parts = ['[MediaLibrary]', code];
  const safe = Object.entries(details)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${String(v).slice(0, 200)}`)
    .join(' ');
  if (safe) parts.push(safe);
  // eslint-disable-next-line no-console
  console.error(parts.join(' '));
}
