/**
 * User-facing messages for Media Library.
 */
const MESSAGES = {
  EDS_LOG_DENIED: 'You need Author access to run discovery. You can still browse existing media.',
  EDS_AUTH_EXPIRED: 'Session expired. Sign in again.',
  AUTH_REQUIRED: 'Sign in to run discovery.',
  BUILD_FAILED: "Discovery didn't complete. Try again.",
  VALIDATION_EMPTY: 'Enter organization and site to start.',
  VALIDATION_PATH_NOT_FOUND: 'Path not found: {path}. Check the path or remove it to scan the whole site.',

  NOTIFY_ERROR: 'Error',
  NOTIFY_WARNING: 'Warning',
  NOTIFY_SUCCESS: 'Success',
  NOTIFY_INFO: 'Info',
  UI_DISMISS: 'Dismiss',
  UI_DISCOVERING: 'Discovering',
};

export default function t(key, params = {}) {
  const str = MESSAGES[key];
  if (str == null) return key;
  return str.replace(/\{(\w+)\}/g, (_, name) => {
    const val = params[name];
    return val != null ? String(val) : `{${name}}`;
  });
}
