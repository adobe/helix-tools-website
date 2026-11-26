const IMS_URL = 'https://auth.services.adobe.com/imslib/imslib.min.js';
// TODO: switch to 'prod' once tools.aem.live is registered for darkalley in prod IMS
const IMS_ENV = 'stg1';
const IMS_CLIENT_ID = 'darkalley';
const IMS_SCOPE = 'AdobeID,openid,additional_info.ownerOrg,read_organizations,aem.frontend.all';
const IO_ORIGIN = `https://cc-collab${IMS_ENV === 'prod' ? '' : '-stage'}.adobe.io`;
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
// the hosts registered for darkalley in IMS_ENV, the only ones that sign in on page load. On any
// other host, IMS sends the token to da.live instead
const AUTO_SIGN_IN_HOSTS = ['tools.aem.live', 'localhost:3000'];
// the page that left this tab to sign in, and comes back once signed in (sessionStorage)
const SIGN_IN_RETURN = 'ims-sign-in-return';
// when this tab last left a page to sign in (sessionStorage)
const SIGN_IN_LEFT = 'ims-sign-in-left';
// a page still without a fresh token this soon after leaving to sign in stops, so it can't loop
const SIGN_IN_LOOP_GUARD = 60 * 1000;
// "Continue without signing in": this tab no longer signs in on page load (sessionStorage)
const SIGN_IN_SKIPPED = 'ims-sign-in-skipped';

let ims;
let signInChecked;
// set once requireSignIn() finds this page signs in on load
let signsInOnLoad = false;
let signedOutDialog;
let signInTab;
let signingIn;
// the token last announced with ims-signed-in or ims-signed-out
let announcedToken;
let expiryTimer;

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
  clearTimeout(expiryTimer);
  // imslib doesn't announce expiry; keep watching even when there is no profile UI.
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

/**
 * Leaves for the sign-in page in this tab, which comes back to this page once signed in.
 * Unlike opening a tab (signIn), leaving needs no click.
 */
export function leaveToSignIn() {
  const { sessionStorage } = window;
  // start over, even if an earlier sign-in in this tab stopped halfway
  sessionStorage.removeItem(SIGN_IN_STAGE);
  sessionStorage.setItem(SIGN_IN_RETURN, window.location.href);
  sessionStorage.setItem(SIGN_IN_LEFT, String(Date.now()));
  // replace: Back must not return to a page that leaves again at once
  window.location.replace(SIGN_IN_PAGE);
}

/**
 * Covers the page once another tab signed out, as da.live does. Only a sign-in ends it: in
 * this tab, or in another one, which reloads the page for that account.
 */
function showSignedOutDialog() {
  if (signedOutDialog) return;
  signedOutDialog = document.createElement('dialog');
  signedOutDialog.className = 'ims-sign-in-dialog';
  signedOutDialog.setAttribute('aria-label', 'Signed out');
  signedOutDialog.closedBy = 'none';
  signedOutDialog.addEventListener('cancel', (event) => event.preventDefault());
  const message = document.createElement('p');
  message.textContent = 'You signed out in another tab. Sign in again to continue.';
  const buttons = document.createElement('p');
  buttons.className = 'button-wrapper';
  buttons.append(createButton('Sign in with Adobe', leaveToSignIn));
  signedOutDialog.append(message, buttons);
  document.body.append(signedOutDialog);
  signedOutDialog.showModal();
  window.addEventListener('ims-signed-in', () => window.location.reload(), { once: true });
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
        announceTokenChange();
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
      onSignOutEventReceived: () => {
        const wasSignedIn = !!announcedToken;
        announceTokenChange();
        if (wasSignedIn && signsInOnLoad) showSignedOutDialog();
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
 * Checks if the IMS access token stays valid for at least another hour, long enough for a
 * task started now. Tokens last 24 hours (IMS default), so only one about to expire fails.
 * @returns {boolean} false if signed out or if the token expires within the hour
 */
export function isImsTokenFresh() {
  const { token, expire } = window.adobeIMS?.getAccessToken() ?? {};
  return !!token && expire - Date.now() >= MIN_TOKEN_VALIDITY;
}

/**
 * Signs in on page load if the IMS token is missing or expires within the hour. The page leaves
 * for the sign-in page in the same tab, which comes back to it once signed in: unlike opening a
 * tab (signIn), leaving needs no click. The token only ever appears in the sign-in page's URL,
 * which runs no RUM.
 *
 * Where it can't sign in this way, the page goes on and signs in on demand: on a host that isn't
 * registered for the client, in a frame (IMS refuses frames), without imslib, after "Continue
 * without signing in", or right after a sign-in that didn't leave a fresh token.
 * @returns {Promise<void>} Resolves once the page may go on; never while it leaves to sign in
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
 * Checks if the user is signed in with IMS, once the page may go on (requireSignIn).
 * @returns {Promise<boolean>} true if signed in
 */
export async function isSignedIn() {
  await requireSignIn();
  try {
    await loadIms();
  } catch {
    return false;
  }
  return !!getImsToken();
}

/**
 * Signs in with Adobe in a new tab, which closes itself once signed in and leaves the token in
 * the localStorage it shares with this page. Meanwhile a modal dialog keeps the page from
 * starting anything else, and offers a button when the tab can't open on its own. For sign-ins
 * in the middle of a task: unlike leaving (leaveToSignIn), it keeps what the page holds.
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
      // the tab starts with a copy of this tab's sessionStorage: it must close once signed in,
      // not go back to a page, and must start over
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
    // the token is in the shared localStorage, even if the browser keeps the tab from closing
    // itself or from being watched
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
 * Returns the page that left this tab to sign in (requireSignIn), if any.
 * @returns {string|undefined} Its URL, only on this origin: the sign-in page can't send the
 *   browser anywhere else
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

/**
 * Explains why the sign-in in this tab stopped, with buttons to try again or to go back to the
 * page without signing in.
 * @param {HTMLElement} status The sign-in page's status element
 * @param {string} message Why it stopped
 * @param {string} returnTo The page that left to sign in
 */
function showSignInFailure(status, message, returnTo) {
  status.textContent = message;
  const buttons = document.createElement('p');
  buttons.className = 'button-wrapper';
  // not a reload: the URL may still hold IMS's answer
  const retry = createButton('Try again', () => window.location.replace(SIGN_IN_PAGE));
  const skip = createButton('Continue without signing in', () => {
    window.sessionStorage.setItem(SIGN_IN_SKIPPED, 'true');
    window.sessionStorage.removeItem(SIGN_IN_RETURN);
    window.location.replace(returnTo);
  });
  skip.classList.add('outline');
  buttons.append(retry, skip);
  // the page may run again (Back), and must not add the buttons twice
  status.parentElement.replaceChildren(status, buttons);
}

/**
 * Runs the sign-in page (utils/ims-sign-in.html), in a tab of its own (signIn) or in the tab of
 * a page that left to sign in (requireSignIn). Once back with a token, it closes its tab or goes
 * back to that page. As admin's sign-in does, it first asks IMS without showing a page, which
 * returns a token at once if the user is signed in to Adobe, and shows the sign-in form only if
 * that fails.
 */
export async function runSignInPage() {
  const status = document.querySelector('.ims-sign-in-status');
  const returnTo = getSignInReturn();
  try {
    await loadIms();
  } catch {
    window.sessionStorage.removeItem(SIGN_IN_STAGE);
    if (returnTo) showSignInFailure(status, 'Adobe sign-in is unavailable.', returnTo);
    else status.textContent = 'Adobe sign-in is unavailable. Close this tab and try again.';
    return;
  }
  // the tab loads this page again after each step at Adobe
  const stage = window.sessionStorage.getItem(SIGN_IN_STAGE);
  if (isImsTokenFresh()) {
    window.sessionStorage.removeItem(SIGN_IN_STAGE);
    if (returnTo) {
      window.sessionStorage.removeItem(SIGN_IN_RETURN);
      window.location.replace(returnTo);
      return;
    }
    // no page to go back to, and no page that opened this tab (signIn) or still linked to it,
    // e.g. after Back from the page this tab went back to
    if (!window.opener) {
      window.location.replace('/');
      return;
    }
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
    if (returnTo) showSignInFailure(status, 'The Adobe sign-in did not complete.', returnTo);
    else status.textContent = 'The Adobe sign-in did not complete. Close this tab and try again.';
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
