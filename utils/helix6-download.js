export const API_ORIGIN = 'https://api.aem.live';

class Helix6Error extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function isUnavailablePath(error) {
  return error instanceof Helix6Error && [400, 404].includes(error.status);
}

export function projectRoot(org, site, collection) {
  const values = [org, site].map((value) => value.trim());
  if (values.some((value) => !/^[a-z0-9][a-z0-9-]*$/i.test(value))) {
    throw new Error('Organization and site must contain only letters, numbers, and hyphens.');
  }
  return `${API_ORIGIN}/${values[0]}/${collection}/${values[1]}/`;
}

export function requestSignal(signal) {
  const timeout = AbortSignal.timeout(60000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function getHelix6(url, label, messages, signal) {
  const response = await fetch(url, {
    credentials: 'include',
    redirect: 'error',
    signal: requestSignal(signal),
  });
  if (!response.ok) {
    const reason = {
      401: 'Sign in to this organization with AEM Sidekick, then try again.',
      429: 'Too many requests. Wait a moment, then try again.',
      ...messages,
    }[response.status] || response.headers.get('x-error') || response.statusText;
    throw new Helix6Error(`${label} API ${response.status}: ${reason}`, response.status);
  }
  return response;
}
