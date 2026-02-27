export function getApiError(status, context, apiError) {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return 'Session expired. Please sign in again.';
  if (status === 403) return `You don't have permission to ${context || 'perform this action'}. Contact your organization admin for access.`;
  if (status === 404) return null;
  return apiError || `Failed to ${context || 'complete request'} (HTTP ${status}).`;
}

export function isSessionExpired(error) {
  return error === 'Session expired. Please sign in again.';
}

export function isPermissionError(error) {
  return typeof error === 'string' && error.startsWith("You don't have permission");
}
