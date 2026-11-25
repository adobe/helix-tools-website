const IMS_URL = 'https://auth.services.adobe.com/imslib/imslib.min.js';
// TODO: switch to 'prod' once tools.aem.live is registered for darkalley in prod IMS
const IMS_ENV = 'stg1';
const IMS_CLIENT_ID = 'darkalley';
const IMS_SCOPE = 'AdobeID,openid,additional_info.ownerOrg,read_organizations,aem.frontend.all';
const IMS_TIMEOUT = 5000;
// a task started now should not outlive the token, so it needs this much validity left
const MIN_TOKEN_VALIDITY = 60 * 60 * 1000;
// the longest delay setTimeout supports
const MAX_DELAY = 2 ** 31 - 1;
// signs in without scripts/aem.js, whose RUM would report the token in the page's URL
const SIGN_IN_PAGE = '/utils/ims-sign-in.html';
// as often as the sidekick sign-in checks its tab (blocks/profile/profile.js)
const SIGN_IN_POLL_INTERVAL = 500;
// how far the sign-in tab got: 'silent' while IMS checks for an Adobe session, 'form' while
// the user signs in
const SIGN_IN_STAGE = 'ims-sign-in-stage';

let ims;
let signInTab;
let signingIn;

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
    // not loadScript from scripts/aem.js: importing that module starts RUM
    const script = document.createElement('script');
    script.src = IMS_URL;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('IMS failed to load'));
    };
    document.head.append(script);
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
 * Checks if the IMS access token stays valid for at least another hour, long enough for a
 * task started now. Tokens last 24 hours (IMS default), so only one about to expire fails.
 * @returns {boolean} false if signed out or if the token expires within the hour
 */
export function isImsTokenFresh() {
  const { token, expire } = window.adobeIMS?.getAccessToken() ?? {};
  return !!token && expire - Date.now() >= MIN_TOKEN_VALIDITY;
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

/**
 * Signs in with Adobe in a new tab, as the sidekick sign-in does (blocks/profile/profile.js).
 * The tab closes itself once signed in, and leaves the token in the localStorage it shares
 * with this page.
 * @returns {Promise<boolean>} true once signed in; false if the tab closed without it,
 *   or couldn't open
 */
export function signIn() {
  if (signingIn) {
    signInTab.focus();
    return signingIn;
  }
  // browsers only open a tab right after a click: otherwise leave it to the sign-in button
  if (window.navigator.userActivation?.isActive === false) return Promise.resolve(false);
  signInTab = window.open(SIGN_IN_PAGE, '_blank');
  if (!signInTab) {
    // eslint-disable-next-line no-alert
    window.alert('Your browser blocked the Adobe sign-in tab. Allow pop-ups for this site, then try again.');
    return Promise.resolve(false);
  }
  signingIn = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!signInTab.closed) return;
      clearInterval(timer);
      signingIn = undefined;
      const signedIn = isImsTokenFresh();
      if (signedIn) window.dispatchEvent(new Event('ims-signed-in'));
      resolve(signedIn);
    }, SIGN_IN_POLL_INTERVAL);
  });
  return signingIn;
}

/**
 * Runs the sign-in tab (utils/ims-sign-in.html), then closes it once back with a token. As
 * admin's sign-in does, it first asks IMS without showing a page, which returns a token at
 * once if the user is signed in to Adobe, and shows the sign-in form only if that fails.
 */
export async function runSignInPage() {
  const status = document.querySelector('.ims-sign-in-status');
  try {
    await loadIms();
  } catch {
    status.textContent = 'Adobe sign-in is unavailable. Close this tab and try again.';
    return;
  }
  // the tab loads this page again after each step at Adobe
  const stage = window.sessionStorage.getItem(SIGN_IN_STAGE);
  if (isImsTokenFresh()) {
    window.sessionStorage.removeItem(SIGN_IN_STAGE);
    // stays visible if the browser doesn't let the page close the tab
    status.textContent = 'You are signed in. You can close this tab.';
    window.close();
  } else if (!stage) {
    window.sessionStorage.setItem(SIGN_IN_STAGE, 'silent');
    // without an Adobe session, IMS returns login_required instead of a token
    window.adobeIMS.signIn({ prompt: 'none' });
  } else if (stage === 'silent') {
    window.sessionStorage.setItem(SIGN_IN_STAGE, 'form');
    window.adobeIMS.signIn();
  } else {
    // reloading the tab starts over
    window.sessionStorage.removeItem(SIGN_IN_STAGE);
    status.textContent = 'The Adobe sign-in did not complete. Close this tab and try again.';
  }
}

export function signOut() {
  window.adobeIMS.signOut();
}

function createButton(text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
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
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Adobe sign-in');
  container.textContent = 'Checking Adobe sign-in…';

  const render = async () => {
    if (!getImsToken()) {
      container.replaceChildren(createButton('Sign in with Adobe', signIn));
      return;
    }
    // imslib doesn't tell the page when the token expires: show the sign-in button again then
    const expiresIn = new Date(window.adobeIMS.getAccessToken()?.expire).getTime() - Date.now();
    if (!Number.isNaN(expiresIn)) setTimeout(render, Math.min(expiresIn + 1000, MAX_DELAY));
    const name = await getProfileName();
    const status = document.createElement('span');
    status.className = 'ims-account';
    const label = document.createElement('span');
    label.className = 'ims-label';
    label.textContent = name ? 'Signed in as ' : 'Signed in with Adobe';
    status.append(label);
    if (name) {
      const identity = document.createElement('span');
      identity.className = 'ims-identity';
      identity.textContent = name;
      identity.title = name;
      status.append(identity);
    }
    const button = createButton('Sign out', signOut);
    button.classList.add('outline');
    container.replaceChildren(status, button);
  };

  loadIms().then(render).catch(() => {
    container.textContent = 'Adobe sign-in is unavailable. Reload the page to try again.';
  });
  // signing in happens in another tab (signIn), so update when it completes
  window.addEventListener('ims-signed-in', render);

  return container;
}
