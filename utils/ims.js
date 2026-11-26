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
// how often signIn() checks whether the sign-in tab closed
const SIGN_IN_POLL_INTERVAL = 500;
// how far the sign-in tab got: 'silent' while IMS checks for an Adobe session, 'form' while
// the user signs in
const SIGN_IN_STAGE = 'ims-sign-in-stage';

let ims;
let signInTab;
let signingIn;
// the token last announced with ims-signed-in or ims-signed-out
let announcedToken;

/**
 * Returns the current IMS access token.
 * @returns {string|undefined} The access token, if signed in
 */
export function getImsToken() {
  return window.adobeIMS?.getAccessToken()?.token;
}

/**
 * Fires ims-signed-in or ims-signed-out once the token changed: a sign-in or sign-out in any
 * tab, or its expiry.
 */
function announceTokenChange() {
  const token = getImsToken();
  if (token === announcedToken) return;
  announcedToken = token;
  window.dispatchEvent(new Event(token ? 'ims-signed-in' : 'ims-signed-out'));
}

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
        announcedToken = getImsToken();
        // follow sign-ins in other tabs (tabs share localStorage). Not removals: reading then
        // restores imslib's in-memory token; sign-outs come through onSignOutEventReceived
        window.addEventListener('storage', ({ newValue }) => {
          if (newValue !== null) announceTokenChange();
        });
        resolve();
      },
      // non-fatal: imslib still calls onReady afterwards
      onError: (type, message) => {
        // eslint-disable-next-line no-console
        console.warn('IMS error', type, message);
      },
      // another tab signed out (imslib already removed the token)
      onSignOutEventReceived: announceTokenChange,
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

function createButton(text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Signs in with Adobe in a new tab, which closes itself once signed in and leaves the token in
 * the localStorage it shares with this page. Meanwhile a modal dialog keeps the page from
 * starting anything else, and offers a button when the tab can't open on its own.
 * @returns {Promise<boolean>} true once signed in; false if cancelled, or if the tab closed
 *   without signing in
 */
export function signIn() {
  if (signingIn) {
    signInTab?.focus();
    return signingIn;
  }
  signingIn = new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ims-sign-in-dialog';
    dialog.setAttribute('aria-label', 'Adobe sign-in');
    const message = document.createElement('p');
    const buttons = document.createElement('p');
    buttons.className = 'button-wrapper';
    const cancel = createButton('Cancel', () => dialog.close());
    cancel.classList.add('outline');
    dialog.append(message, buttons);
    let poll;
    const openTab = () => {
      signInTab = window.open(SIGN_IN_PAGE, '_blank');
      if (!signInTab) {
        message.textContent = 'Your browser blocked the Adobe sign-in tab. Allow pop-ups for this site, then try again.';
        buttons.replaceChildren(createButton('Sign in with Adobe', openTab), cancel);
        return;
      }
      message.textContent = 'Finish signing in with Adobe in the new tab.';
      buttons.replaceChildren(cancel);
      poll = setInterval(() => {
        if (signInTab.closed) dialog.close();
      }, SIGN_IN_POLL_INTERVAL);
    };
    // the tab closed, or Cancel or Esc
    dialog.addEventListener('close', () => {
      clearInterval(poll);
      signInTab?.close();
      signInTab = undefined;
      signingIn = undefined;
      dialog.remove();
      announceTokenChange();
      resolve(isImsTokenFresh());
    });
    // browsers only open a tab right after a click
    if (window.navigator.userActivation?.isActive === false) {
      message.textContent = 'Sign in with Adobe to continue.';
      buttons.replaceChildren(createButton('Sign in with Adobe', openTab), cancel);
    } else {
      openTab();
    }
    document.body.append(dialog);
    dialog.showModal();
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

  let renders = 0;
  let expiryTimer;
  const render = async () => {
    renders += 1;
    const current = renders;
    clearTimeout(expiryTimer);
    if (!getImsToken()) {
      container.replaceChildren(createButton('Sign in with Adobe', signIn));
      return;
    }
    // imslib doesn't tell the page when the token expires: announce it then
    const expiresIn = new Date(window.adobeIMS.getAccessToken()?.expire).getTime() - Date.now();
    if (!Number.isNaN(expiresIn)) {
      expiryTimer = setTimeout(announceTokenChange, Math.min(expiresIn + 1000, MAX_DELAY));
    }
    const name = await getProfileName();
    // a newer render ran meanwhile, e.g. after a sign-out
    if (current !== renders) return;
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
  // sign-ins, sign-outs and expiry, in any tab (announceTokenChange)
  window.addEventListener('ims-signed-in', render);
  window.addEventListener('ims-signed-out', render);

  return container;
}

/**
 * Shows a sign-in button in the element until signed in, in any tab, then calls back.
 * For pages that load on their own only when signed in.
 * @param {HTMLElement} element Where to show the button
 * @param {() => void} onSignedIn Called once signed in
 * @returns {() => void} Cancels: removes the button and stops waiting
 */
export function promptImsSignIn(element, onSignedIn) {
  const button = createButton('Sign in with Adobe', signIn);
  const resume = () => {
    button.remove();
    onSignedIn();
  };
  element.append(button);
  window.addEventListener('ims-signed-in', resume, { once: true });
  return () => {
    button.remove();
    window.removeEventListener('ims-signed-in', resume);
  };
}
