import {
  messageSidekick,
  getSidekickId,
  NO_SIDEKICK,
} from './sidekick.js';

/**
 * Returns a login button element for the given organization and site.
 * @param {Object} cfg The login button configuration
 * @param {string} cfg.org The organization name
 * @param {string} cfg.site The site name
 * @param {Function} [cfg.callback] The callback function to call after login
 * @param {number} [cfg.status] The HTTP status code
 * @returns {HTMLElement} The login button element
 */
export default async function createLoginButton({
  org, site, callback, status = 401,
}) {
  const authInfo = await new Promise((resolve) => {
    messageSidekick({ action: 'getAuthInfo' }, (res) => resolve(res));
    // if no response after 200ms, resolve with NO_SIDEKICK
    setTimeout(() => resolve(NO_SIDEKICK), 200);
  });
  if (authInfo === NO_SIDEKICK) {
    const msg = document.createElement('span');
    msg.innerHTML = 'Install <a href="https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml" target="_blank" rel="noopener noreferrer">AEM Sidekick</a> to sign in.';
    return msg;
  }

  const loggedIn = authInfo?.includes(org) || status === 200;
  const loginText = loggedIn ? 'Sign out' : 'Sign in';

  const loginButton = document.createElement('button');
  loginButton.id = 'login';
  loginButton.classList.add('button', 'login');
  if (status === 403) {
    loginButton.classList.add('quiet');
  }
  loginButton.title = loginText;
  loginButton.textContent = loginText;

  // trigger login on button click (alt key for microsoft IDP with common tenant)
  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    const api = loggedIn ? 'logout' : 'login';
    const loginUrl = new URL(`https://admin.hlx.page/${api}/${org}/${site}/main`);
    if (!loggedIn) {
      const altKey = loginButton.classList.contains('ops');
      loginUrl.searchParams.append('idp', altKey ? 'microsoft' : '');
      loginUrl.searchParams.append('tenant', altKey ? 'common' : '');
      loginUrl.searchParams.append('selectAccount', authInfo?.includes(org) || altKey);
    }
    loginUrl.searchParams.append('extensionId', getSidekickId());
    const loginWindow = window.open(loginUrl.toString(), '_blank');
    const checkInterval = setInterval(() => {
      if (loginWindow.closed) {
        clearInterval(checkInterval);
        if (typeof callback === 'function') {
          callback();
        }
      }
    }, 1000);
  });

  // add body class if alt key is pressed
  document.addEventListener('keydown', ({ altKey }) => {
    if (altKey) {
      loginButton.classList.add('ops');
    }
  });
  document.addEventListener('keyup', ({ altKey }) => {
    if (!altKey) {
      loginButton.classList.remove('ops');
    }
  });

  return loginButton;
}
