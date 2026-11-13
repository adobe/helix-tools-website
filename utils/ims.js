import { loadScript } from '../scripts/aem.js';

const IMS_URL = 'https://auth.services.adobe.com/imslib/imslib.min.js';
// TODO: switch to 'prod' once tools.aem.live is registered for darkalley in prod IMS
const IMS_ENV = 'stg1';
const IMS_CLIENT_ID = 'darkalley';
// the cache worker (helix-cache-debug src/auth.js) only accepts tokens within this scope
const IMS_SCOPE = 'AdobeID,openid,additional_info.ownerOrg';
const IMS_TIMEOUT = 5000;

let ims;

/**
 * Loads and initializes the Adobe IMS library (once per page).
 * @returns {Promise<void>} Resolves when IMS is ready, rejects if it fails to load in time
 */
export function loadIms() {
  ims ??= new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IMS timeout')), IMS_TIMEOUT);
    window.adobeid = {
      client_id: IMS_CLIENT_ID,
      scope: IMS_SCOPE,
      locale: 'en_US',
      environment: IMS_ENV,
      useLocalStorage: true,
      autoValidateToken: true,
      alwaysRemoveTokenFromUrl: true,
      onReady: () => {
        clearTimeout(timer);
        resolve();
      },
      // non-fatal: imslib still calls onReady afterwards
      onError: (type, message) => {
        // eslint-disable-next-line no-console
        console.warn('IMS error', type, message);
      },
    };
    loadScript(IMS_URL).catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return ims;
}

/**
 * Returns the current IMS access token.
 * @returns {string|undefined} The access token, if signed in
 */
export function getImsToken() {
  return window.adobeIMS?.getAccessToken()?.token;
}

/**
 * Checks if the user is signed in with IMS.
 * @returns {Promise<boolean>} true if signed in
 */
export async function isSignedIn() {
  try {
    await loadIms();
  } catch {
    return false;
  }
  return !!getImsToken();
}

export function signIn() {
  window.adobeIMS.signIn();
}

export function signOut() {
  window.adobeIMS.signOut();
}

function createButton(text, onClick) {
  const button = document.createElement('button');
  button.className = 'button';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

async function getProfileName() {
  try {
    const profile = await window.adobeIMS.getProfile();
    return profile?.email || profile?.displayName;
  } catch {
    return undefined;
  }
}

/**
 * Returns an element showing the IMS sign-in state with a sign-in or sign-out button.
 * @returns {HTMLElement} The IMS login element
 */
export function createImsLogin() {
  const container = document.createElement('div');
  container.className = 'ims-login';
  container.textContent = 'Checking Adobe sign-in…';

  loadIms().then(async () => {
    if (!getImsToken()) {
      container.replaceChildren(createButton('Sign in with Adobe', signIn));
      return;
    }
    const name = await getProfileName();
    const status = document.createElement('span');
    status.textContent = name ? `Signed in as ${name}` : 'Signed in with Adobe';
    container.replaceChildren(status, createButton('Sign out', signOut));
  }).catch(() => {
    container.textContent = 'Adobe sign-in is unavailable. Reload the page to try again.';
  });

  return container;
}
