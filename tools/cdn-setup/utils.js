// Preview/live hostnames follow `{branch}--{site}--{org}.aem.page` and must fit
// within the 63-character DNS label limit, same rule as site-admin site names.
export const MAX_HOSTNAME_LENGTH = 63;
export const BRANCH_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateBranchName(branch, site, org) {
  if (!branch) return null;
  if (!BRANCH_NAME_PATTERN.test(branch)) {
    return 'Branch name may only contain lowercase letters, numbers, and single hyphens, and cannot start with a hyphen.';
  }
  const hostnameLength = `${branch}--${site}--${org}`.length;
  if (hostnameLength > MAX_HOSTNAME_LENGTH) {
    return `Branch name is too long: "${branch}--${site}--${org}" exceeds the ${MAX_HOSTNAME_LENGTH}-character domain label limit.`;
  }
  return null;
}

const ERROR_MESSAGES = {
  ENOTFOUND: 'Could not connect to CDN endpoint. Please verify the hostname is correct.',
  ECONNREFUSED: 'Connection refused by CDN server. Please check your endpoint configuration.',
  ETIMEDOUT: 'Request timed out. The CDN server may be unreachable.',
  ECONNRESET: 'Connection was reset. Please try again.',
  400: 'Bad request. Please check your configuration.',
  401: 'Authentication failed. Please verify your credentials.',
  403: 'Access denied. Your credentials may not have the required permissions.',
  404: 'Resource not found. Please verify your configuration.',
  500: 'CDN server error. Please try again later.',
};

export function parseBody(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return null;

  try {
    return JSON.parse(body);
  } catch {
    return { rawMessage: body };
  }
}

export function getErrorMessage(result) {
  if (result.status === 'ok' || result.status === 'succeeded') {
    return 'Validation successful';
  }

  if (result.status === 'unsupported') {
    return typeof result.body === 'string' ? result.body : 'This operation is not supported';
  }

  if (result.statusCode) {
    const statusKey = String(result.statusCode);
    if (ERROR_MESSAGES[statusKey]) {
      return ERROR_MESSAGES[statusKey];
    }
  }

  const body = parseBody(result.body);
  if (!body) {
    return 'Validation failed';
  }

  if (body.code) {
    const codeKey = String(body.code);
    if (ERROR_MESSAGES[codeKey]) {
      return ERROR_MESSAGES[codeKey];
    }
  }

  if (body.msg) {
    return `Validation failed: ${body.msg}`;
  }

  if (body.errors && Array.isArray(body.errors) && body.errors.length > 0) {
    const firstError = body.errors[0];
    if (firstError.message) {
      return `Validation failed: ${firstError.message}`;
    }
  }

  if (body.message) {
    return `Validation failed: ${body.message}`;
  }

  if (body.error) {
    return `Validation failed: ${body.error}`;
  }

  if (body.rawMessage && result.statusCode && ERROR_MESSAGES[String(result.statusCode)]) {
    return ERROR_MESSAGES[String(result.statusCode)];
  }

  return 'Validation failed. Check details for more information.';
}
