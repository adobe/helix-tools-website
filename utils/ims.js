const IMS_URL = 'https://auth.services.adobe.com/imslib/imslib.min.js';
// TODO: switch to 'prod' once tools.aem.live is registered for darkalley in prod IMS
const IMS_ENV = 'stg1';
const IMS_CLIENT_ID = 'darkalley';
const IMS_SCOPE = 'AdobeID,openid,additional_info.ownerOrg,read_organizations,aem.frontend.all';
const IO_ORIGIN = `https://cc-collab${IMS_ENV === 'prod' ? '' : '-stage'}.adobe.io`;
const IMS_TIMEOUT = 5000;
// a task started now must not outlive the token
const MIN_TOKEN_VALIDITY = 60 * 60 * 1000;
// setTimeout's maximum delay
const MAX_DELAY = 2 ** 31 - 1;
const SIGN_IN_PAGE = '/utils/ims-sign-in.html';
const SIGN_IN_POLL_INTERVAL = 500;
// 'silent' while IMS checks for an Adobe session, then 'form'
const SIGN_IN_STAGE = 'ims-sign-in-stage';
// registered for darkalley in IMS_ENV; IMS sends other hosts' tokens to da.live
const AUTO_SIGN_IN_HOSTS = ['tools.aem.live', 'localhost:3000'];
const SIGN_IN_RETURN = 'ims-sign-in-return';
const SIGN_IN_LEFT = 'ims-sign-in-left';
// no new redirect this soon after the last one, so a failing sign-in can't loop
const SIGN_IN_LOOP_GUARD = 60 * 1000;
// set by "Continue without signing in"
const SIGN_IN_SKIPPED = 'ims-sign-in-skipped';

let ims;
let signInChecked;
let signsInOnLoad = false;
let signedOutDialog;
let signInTab;
let signingIn;
let announcedToken;
let expiryTimer;

/**
 * @returns {string|undefined} the IMS access token, if signed in
 */
export function getImsToken() {
  return window.adobeIMS?.getAccessToken()?.token;
}

/** Adds the IMS token to a request's `init`, unless it already has an authorization header. */
export function addImsToken(init) {
  const token = getImsToken();
  if (!token) return;
  const headers = new Headers(init.headers);
  if (headers.has('authorization')) return;
  headers.set('authorization', `Bearer ${token}`);
  init.headers = headers;
}

/** Fires ims-signed-in or ims-signed-out when the token changes in any tab or expires. */
function announceTokenChange() {
  const token = getImsToken();
  clearTimeout(expiryTimer);
  // imslib doesn't announce expiry
  const expiresIn = new Date(window.adobeIMS?.getAccessToken()?.expire).getTime() - Date.now();
  if (expiresIn >= 0) {
    expiryTimer = setTimeout(announceTokenChange, Math.min(expiresIn + 1000, MAX_DELAY));
  }
  if (token === announcedToken) return;
  announcedToken = token;
  window.dispatchEvent(new Event(token ? 'ims-signed-in' : 'ims-signed-out'));
}

function createButton(text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function createButtonWrapper(...buttons) {
  const wrapper = document.createElement('p');
  wrapper.className = 'button-wrapper';
  wrapper.append(...buttons);
  return wrapper;
}

function createDialog(label) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ims-sign-in-dialog';
  dialog.setAttribute('aria-label', label);
  const message = document.createElement('p');
  const buttons = createButtonWrapper();
  dialog.append(message, buttons);
  return { dialog, message, buttons };
}

/**
 * Signs in in this tab, coming back to this page afterwards. Unlike signIn(), needs no click.
 */
export function leaveToSignIn() {
  const { sessionStorage } = window;
  // start over if an earlier sign-in stopped halfway
  sessionStorage.removeItem(SIGN_IN_STAGE);
  sessionStorage.setItem(SIGN_IN_RETURN, window.location.href);
  sessionStorage.setItem(SIGN_IN_LEFT, String(Date.now()));
  // replace, so Back doesn't return to a page that leaves again
  window.location.replace(SIGN_IN_PAGE);
}

/** Covers the page after a sign-out in another tab, until a sign-in in any tab. */
function showSignedOutDialog() {
  if (signedOutDialog) return;
  const { dialog, message, buttons } = createDialog('Signed out');
  signedOutDialog = dialog;
  dialog.closedBy = 'none';
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  message.textContent = 'You signed out in another tab. Sign in again to continue.';
  buttons.append(createButton('Sign in with Adobe', leaveToSignIn));
  document.body.append(dialog);
  dialog.showModal();
  window.addEventListener('ims-signed-in', () => window.location.reload(), { once: true });
}

/**
 * Loads imslib, once per page.
 * @returns {Promise<void>} rejects if imslib fails to load in time
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
        announceTokenChange();
        // sign-ins in other tabs; not removals, as reading then restores imslib's token
        // (sign-outs arrive via onSignOutEventReceived)
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
      // another tab signed out; imslib already removed the token
      onSignOutEventReceived: () => {
        const wasSignedIn = !!announcedToken;
        announceTokenChange();
        if (wasSignedIn && signsInOnLoad) showSignedOutDialog();
      },
    };
    // not aem.js's loadScript: importing aem.js starts RUM
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
 * @returns {boolean} true if the IMS token stays valid for at least another hour
 */
function isImsTokenFresh() {
  const { token, expire } = window.adobeIMS?.getAccessToken() ?? {};
  return !!token && expire - Date.now() >= MIN_TOKEN_VALIDITY;
}

/**
 * Leaves to sign in on page load if the IMS token is missing or expires within the hour.
 * Skipped on unregistered hosts, in frames (IMS refuses them), without imslib, after
 * "Continue without signing in", and right after leaving to sign in (loop guard).
 * @returns {Promise<void>} never resolves while the page leaves to sign in
 */
export function requireSignIn() {
  signInChecked ??= (async () => {
    if (!AUTO_SIGN_IN_HOSTS.includes(window.location.host) || window.self !== window.top) return;
    try {
      await loadIms();
    } catch {
      return;
    }
    signsInOnLoad = true;
    const { sessionStorage } = window;
    if (isImsTokenFresh()) {
      sessionStorage.removeItem(SIGN_IN_LEFT);
      sessionStorage.removeItem(SIGN_IN_SKIPPED);
      return;
    }
    const left = Number(sessionStorage.getItem(SIGN_IN_LEFT));
    if (sessionStorage.getItem(SIGN_IN_SKIPPED) || Date.now() - left < SIGN_IN_LOOP_GUARD) return;
    leaveToSignIn();
    await new Promise(() => {});
  })();
  return signInChecked;
}

/**
 * Waits for the page-load sign-in and imslib.
 * @returns {Promise<boolean>} false if imslib is unavailable
 */
export async function waitForIms() {
  await requireSignIn();
  try {
    await loadIms();
    return true;
  } catch {
    return false;
  }
}

/**
 * Signs in in a new tab behind a modal dialog, keeping the page's state (for mid-task
 * sign-ins; see leaveToSignIn).
 * @returns {Promise<boolean>} false if cancelled or the tab closed without signing in
 */
export function signIn() {
  if (signingIn) {
    signInTab?.focus();
    return signingIn;
  }
  signingIn = new Promise((resolve) => {
    const { dialog, message, buttons } = createDialog('Adobe sign-in');
    const cancel = createButton('Cancel', () => dialog.close());
    cancel.classList.add('outline');
    let poll;
    const openTab = () => {
      // the new tab copies this sessionStorage: it must start over and close, not go back
      window.sessionStorage.removeItem(SIGN_IN_RETURN);
      window.sessionStorage.removeItem(SIGN_IN_STAGE);
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
    // the token arrives via localStorage even if the tab can't close itself or be watched
    const onSignedIn = () => {
      if (isImsTokenFresh()) dialog.close();
    };
    window.addEventListener('ims-signed-in', onSignedIn);
    // signed in, the tab closed, or Cancel or Esc
    dialog.addEventListener('close', () => {
      window.removeEventListener('ims-signed-in', onSignedIn);
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
 * Opens the Adobe sign-in unless the IMS token is fresh.
 * @returns {Promise<boolean>} true if signed in
 */
export async function ensureSignedIn() {
  const imsReady = await waitForIms();
  if (isImsTokenFresh()) return true;
  if (!imsReady) return false;
  // a token that expires soon still works if the user cancels
  return await signIn() || !!getImsToken();
}

/**
 * @returns {string|undefined} the same-origin page to return to after signing in, if any
 */
function getSignInReturn() {
  try {
    const url = new URL(window.sessionStorage.getItem(SIGN_IN_RETURN));
    if (url.origin === window.location.origin) return url.href;
  } catch {
    // none, or not a URL
  }
  return undefined;
}

/** Shows why the sign-in stopped, offering to try again or continue without signing in. */
function showSignInFailure(status, message, returnTo) {
  // a reload starts over
  window.sessionStorage.removeItem(SIGN_IN_STAGE);
  if (!returnTo) {
    status.textContent = `${message} Close this tab and try again.`;
    return;
  }
  status.textContent = message;
  // not a reload: the URL may still hold IMS's answer
  const retry = createButton('Try again', () => window.location.replace(SIGN_IN_PAGE));
  const skip = createButton('Continue without signing in', () => {
    window.sessionStorage.setItem(SIGN_IN_SKIPPED, 'true');
    window.sessionStorage.removeItem(SIGN_IN_RETURN);
    window.location.replace(returnTo);
  });
  skip.classList.add('outline');
  // runs again on Back: don't add the buttons twice
  status.parentElement.replaceChildren(status, createButtonWrapper(retry, skip));
}

/**
 * Runs utils/ims-sign-in.html: tries a silent sign-in first, then the IMS form. Once signed in,
 * returns to the page that left to sign in, or closes the tab signIn() opened.
 */
export async function runSignInPage() {
  const status = document.querySelector('.ims-sign-in-status');
  const returnTo = getSignInReturn();
  try {
    await loadIms();
  } catch {
    showSignInFailure(status, 'Adobe sign-in is unavailable.', returnTo);
    return;
  }
  // IMS reloads this page after each step
  const stage = window.sessionStorage.getItem(SIGN_IN_STAGE);
  if (isImsTokenFresh()) {
    window.sessionStorage.removeItem(SIGN_IN_STAGE);
    if (returnTo) {
      window.sessionStorage.removeItem(SIGN_IN_RETURN);
      window.location.replace(returnTo);
      return;
    }
    // nothing to return to and no opener, e.g. after Back from the returned-to page
    if (!window.opener) {
      window.location.replace('/');
      return;
    }
    // shown if the browser won't let the page close the tab
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
    showSignInFailure(status, 'The Adobe sign-in did not complete.', returnTo);
  }
}

export async function signOut() {
  await window.adobeIMS.signOut();
  announceTokenChange();
}

/**
 * Returns the current Adobe profile, or undefined if signed out or the account changed.
 */
export async function getImsProfile() {
  await loadIms();
  const token = getImsToken();
  if (!token) return undefined;
  const profile = await window.adobeIMS.getProfile();
  if (token !== getImsToken()) return undefined;
  if (!profile) throw new Error('Adobe profile is unavailable.');
  return profile;
}

export async function getImsAvatar() {
  await loadIms();
  const token = getImsToken();
  if (!token) throw new Error('Sign in with Adobe to load your profile photo.');
  const response = await fetch(`${IO_ORIGIN}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Adobe profile photo request failed (${response.status}).`);
  const { user } = await response.json();
  if (token !== getImsToken()) throw new Error('Adobe account changed while loading the profile photo.');
  const avatar = new URL(user?.avatar);
  if (avatar.protocol !== 'https:') throw new Error('Invalid Adobe profile photo URL.');
  return avatar.href;
}
