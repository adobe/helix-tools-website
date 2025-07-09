import { messageSidekick } from './sidekick.js';

/**
 * Returns a login button element for the given organization and site.
 * @param {string} org The organization name
 * @param {string} site The site name
 * @param {Function} [callback] The callback function to call after login
 * @returns {HTMLElement} The login button element
 */
export default async function createLoginButton(org, site, callback) {
  const authInfo = await new Promise((resolve) => {
    messageSidekick({ action: 'getAuthInfo' }, (res) => resolve(res));
    setTimeout(() => resolve(null), 200);
  });
  if (!authInfo) {
    const msg = document.createElement('span');
    msg.innerHTML = 'Install <a href="https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml" target="_blank" rel="noopener noreferrer">AEM Sidekick</a> to sign in.';
    return msg;
  }
  const loginContainer = document.createElement('div');
  loginContainer.classList.add('form-field', 'picker-field');
  loginContainer.innerHTML = `
    <input type="button" class="button login" id="login-button-${org}" title="Sign in"
      value="${authInfo?.includes(org) ? 'Signed in' : 'Sign in'}"
      ${authInfo?.includes(org) ? 'disabled' : ''}>
  `;

  // trigger login on button click (alt key for microsoft)
  const loginPicker = loginContainer.querySelector(`input#login-button-${org}`);
  loginPicker.addEventListener('click', async () => {
    const altKey = document.body.classList.contains('alt-key-pressed');
    const success = await messageSidekick({
      action: 'login',
      org,
      site,
      idp: altKey ? 'microsoft' : undefined,
    });
    if (typeof callback === 'function') {
      callback(success);
    }
  });

  return loginContainer;
}

// add body class if alt key is pressed
document.addEventListener('keydown', ({ altKey }) => {
  if (altKey) {
    document.body.classList.add('alt-key-pressed');
  }
});
document.addEventListener('keyup', ({ altKey }) => {
  if (!altKey) {
    document.body.classList.remove('alt-key-pressed');
  }
});
