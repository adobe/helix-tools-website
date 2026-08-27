import { ensureLogin } from '../../blocks/profile/profile.js';
import { secretStorageKey } from './utils.js';

// Management API (list/upload/replace/delete) still lives behind the worker's
// org/site-prefixed path — only *delivery* (preview/content-overlay fetches)
// moved to the aem.network host. See deliveryUrl() in utils.js.
export const WAC_WORKER_ENDPOINT = 'https://wac.david8603.workers.dev';

// CORS proxy for cross-origin requests (fcors.org) — same pattern as
// tools/cdn-check/cdn-check.js. The key is sent as a query param on every
// proxied request and is visible in DevTools — it is not a server secret,
// just a public attribution token for fcors rate/account tracking.
const CORS_PROXY_URL = 'https://www.fcors.org';
const CORS_PROXY_KEY = 'iyIjewSFgBzbPVG3';

function corsProxy(url) {
  return `${CORS_PROXY_URL}?url=${encodeURIComponent(url)}&key=${CORS_PROXY_KEY}`;
}

/**
 * Mirrors the small event-wait helper in utils/admin-request.js so a
 * connect flow can block on a profile-modal sign-in the same way admin
 * requests do, without exporting that internal from admin-request.js.
 */
function waitForProfileLogin(org) {
  return new Promise((resolve) => {
    const handlers = {};
    const finish = (value) => {
      window.removeEventListener('profile-update', handlers.onUpdate);
      window.removeEventListener('profile-cancelled', handlers.onCancel);
      resolve(value);
    };
    handlers.onUpdate = ({ detail }) => finish(Array.isArray(detail) && detail.includes(org));
    handlers.onCancel = () => finish(false);
    window.addEventListener('profile-update', handlers.onUpdate);
    window.addEventListener('profile-cancelled', handlers.onCancel);
  });
}

/**
 * Look up the signed-in user's email for an org/site, the same way
 * blocks/profile/profile.js's fetchUserInfo does.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<string>}
 */
export async function fetchProfileEmail(org, site) {
  try {
    const res = await fetch(`https://admin.hlx.page/profile/${org}/${site}`);
    if (!res.ok) return '';
    const { profile } = await res.json();
    return profile?.email || '';
  } catch {
    return '';
  }
}

/**
 * Fetch a site's published configuration (the same config.json the site
 * itself loads at runtime), used to check whether its mixerConfig routes
 * `/wac/**` to the WAC worker — see isMixerConfigured() in utils.js.
 *
 * Goes through the fcors CORS proxy rather than a plain fetch(): the
 * site's own CDN host (`main--<site>--<org>.aem.live`) doesn't allow
 * cross-origin reads from tools.aem.live. This is deliberately *not*
 * routed through the admin API instead — reading a site's config there
 * requires the user to have a "config" role, which regular authors/
 * contributors often don't have, whereas the published config.json is
 * public. Doesn't require sidekick login; safe to call before it.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<object|null>} null if it couldn't be fetched/parsed
 */
export async function fetchSiteConfig(org, site) {
  try {
    const res = await fetch(corsProxy(`https://main--${site}--${org}.aem.live/config.json`));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Raw call to the WAC worker's management API with the stored secret, with
 * no re-authentication — used directly by ensureSecret() while validating a
 * candidate secret, and wrapped by wacApi() (below) for everything else.
 * @param {{ org: string, site: string, email: string, secret: string }} session
 */
export async function wacRequest(session, path, options = {}) {
  const res = await fetch(`${WAC_WORKER_ENDPOINT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.secret}`,
      'X-WAC-Author': session.email,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Ensure a validated shared secret is in place for the session, prompting
 * (and clearing any bad stored value) as needed.
 * @param {{ org: string, site: string, email: string, secret: string|null }} session
 * @param {(org: string, site: string, errorMessage?: string) => Promise<string|null>} promptFn
 * @returns {Promise<boolean>}
 */
export async function ensureSecret(session, promptFn) {
  const { org, site } = session;
  const key = secretStorageKey(org, site);
  let secret = localStorage.getItem(key);
  let errorMessage;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!secret) {
      // eslint-disable-next-line no-await-in-loop -- prompt, then validate; retry on a bad secret
      secret = await promptFn(org, site, errorMessage);
      if (!secret) return false;
    }
    session.secret = secret;
    try {
      // eslint-disable-next-line no-await-in-loop -- see above
      await wacRequest(session, `/${org}/${site}/index.json`);
      localStorage.setItem(key, secret);
      return true;
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        localStorage.removeItem(key);
        secret = null;
        errorMessage = 'That secret was rejected. Please try again.';
      } else {
        throw err;
      }
    }
  }
}

/**
 * Call the WAC worker's management API, re-prompting for the shared secret
 * and retrying once if it's been rejected — the WAC-secret equivalent of
 * AuthMode.RETRY_ON_401 in utils/admin-request.js (which does the same for
 * the sidekick cookie).
 * @param {{ org: string, site: string, email: string, secret: string }} session
 * @param {(org: string, site: string, errorMessage?: string) => Promise<string|null>} promptFn
 */
export async function wacApi(session, promptFn, path, options = {}) {
  try {
    return await wacRequest(session, path, options);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    localStorage.removeItem(secretStorageKey(session.org, session.site));
    session.secret = null;
    if (!(await ensureSecret(session, promptFn))) throw err;
    return wacRequest(session, path, options);
  }
}

/**
 * Like wacRequest(), but tracks upload progress via XMLHttpRequest instead
 * of fetch() (which has no upload progress event) — used for the direct
 * drag-and-drop upload flow, which shows a progress bar instead of the
 * review modal.
 * @param {{ org: string, site: string, email: string, secret: string }} session
 * @param {(fraction: number) => void} [onProgress] - 0..1, only called when
 *   the browser can compute it (lengthComputable)
 */
function wacRequestWithProgress(session, path, {
  method = 'GET', headers = {}, body, onProgress,
} = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${WAC_WORKER_ENDPOINT}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.secret}`);
    xhr.setRequestHeader('X-WAC-Author', session.email);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }
    xhr.onload = () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = { raw: xhr.responseText };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const err = new Error(data?.message || data?.error || `HTTP ${xhr.status}`);
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body);
  });
}

/**
 * Progress-tracking equivalent of wacApi() — same secret re-prompt/retry
 * behavior on a 401/403, just over XMLHttpRequest so `onProgress` works.
 * @param {{ org: string, site: string, email: string, secret: string }} session
 * @param {(org: string, site: string, errorMessage?: string) => Promise<string|null>} promptFn
 */
export async function wacApiWithProgress(session, promptFn, path, options = {}) {
  try {
    return await wacRequestWithProgress(session, path, options);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    localStorage.removeItem(secretStorageKey(session.org, session.site));
    session.secret = null;
    if (!(await ensureSecret(session, promptFn))) throw err;
    return wacRequestWithProgress(session, path, options);
  }
}

/**
 * Require the regular sidekick org/site sign-in, waiting on the
 * profile-modal outcome if it wasn't already logged in. Exported so
 * callers can run other checks (e.g. fetchSiteConfig()) between this and
 * ensureSecret(), instead of only via the all-in-one connectSession().
 * @param {string} org
 * @param {string} site
 * @returns {Promise<boolean>}
 */
export async function ensureSidekickLogin(org, site) {
  const signedIn = await ensureLogin(org, site) || await waitForProfileLogin(org);
  return signedIn;
}

/**
 * Full connect flow for an org/site: require the regular sidekick sign-in,
 * look up the user's email, then ensure a validated shared secret.
 * @param {string} org
 * @param {string} site
 * @param {(org: string, site: string, errorMessage?: string) => Promise<string|null>} promptFn
 * @returns {Promise<{ org: string, site: string, email: string, secret: string }|null>}
 */
export async function connectSession(org, site, promptFn) {
  const signedIn = await ensureSidekickLogin(org, site);
  if (!signedIn) return null;

  const email = await fetchProfileEmail(org, site);
  const session = {
    org, site, email, secret: null,
  };
  const ok = await ensureSecret(session, promptFn);
  return ok ? session : null;
}
