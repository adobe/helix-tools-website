import { messageSidekick, NO_SIDEKICK } from './sidekick.js';

/**
 * Returns a login button element for the given organization and site.
 * @param {Object} cfg The login button configuration
 * @param {string} cfg.org The organization name
 * @param {string} cfg.site The site name
 * @param {Function} [cfg.callback] The callback function to call after login
 * @param {boolean} [cfg.quiet] Whether to use a quiet login button
 * @param {string} [cfg.text] The override text to display on the login button
 * @returns {HTMLElement} The login button element
 */
export default async function createLoginButton({
  org, site, callback, quiet, text,
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
  const loginText = text || (authInfo?.includes(org) && !quiet ? 'Switch account' : 'Sign in');

  const loginButton = document.createElement('button');
  loginButton.classList.add('button', 'login');
  if (quiet) {
    loginButton.classList.add('quiet');
  }
  loginButton.title = loginText;
  loginButton.textContent = loginText;

  // trigger login on button click (alt key for microsoft IDP with common tenant)
  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    const altKey = loginButton.classList.contains('ops');
    const success = await messageSidekick({
      action: 'login',
      org,
      site,
      idp: altKey ? 'microsoft' : undefined,
      tenant: altKey ? 'common' : undefined,
      selectAccount: authInfo?.includes(org),
    });
    if (typeof callback === 'function') {
      callback(success);
    }
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
