import { messageSidekick } from './sidekick.js';

/**
 * Collapses login dropdowns when clicking anywhere outside of them.
 * @param {Event} e The event object
 */
function collapseDropdowns(e) {
  const { target } = e;
  const { nextElementSibling: next } = target;
  const hasMenu = next && next.tagName.toLowerCase() === 'ul' && next.classList.contains('menu');

  if (target.closest('ul') || hasMenu) {
    // ignore click on picker icon or inside dropdown
    return;
  }
  const dropdowns = document.querySelectorAll('ul.menu');
  dropdowns.forEach((dropdown) => {
    if (!dropdown.hidden) {
      dropdown.hidden = true;
      const button = dropdown.previousElementSibling;
      button.setAttribute('aria-expanded', false);
    }
  });
  document.removeEventListener('click', collapseDropdowns);
}

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
    <i id="login-button-icon-${org}" class="symbol symbol-chevron" title="Sign in options"
      ${authInfo?.includes(org) ? 'aria-hidden="true"' : ''}></i>
    <ul class="menu" id="login-options-${org}" role="listbox" aria-labelledby="login-button-${org}" hidden>
      <li role="option" aria-selected="false" data-value="default">Default IDP</li>
      <li role="option" aria-selected="false" data-value="microsoft">Microsoft</li>
      <li role="option" aria-selected="false" data-value="google">Google</li>
      <li role="option" aria-selected="false" data-value="adobe">Adobe</li>
    </ul>
  `;

  // enable login dropdown
  const loginPicker = loginContainer.querySelector(`input#login-button-${org}`);
  const loginPickerIcon = loginContainer.querySelector(`i#login-button-icon-${org}`);
  const loginDropdown = loginContainer.querySelector(`ul#login-options-${org}`);
  const loginIdps = loginDropdown.querySelectorAll('[role="option"]');

  // trigger default IDP login on b utton click
  loginPicker.addEventListener('click', () => {
    loginDropdown.querySelector('li').click();
  });

  loginPickerIcon.addEventListener('click', (e) => {
    const { target } = e;
    const expanded = target.getAttribute('aria-expanded') === 'true';
    target.setAttribute('aria-expanded', !expanded);
    loginDropdown.hidden = expanded;
    setTimeout(() => document.addEventListener('click', collapseDropdowns), 200);
  });

  // trigger login on dropdown click
  loginDropdown.addEventListener('click', async (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) {
      loginPicker.setAttribute('aria-expanded', false);
      loginDropdown.hidden = true;
      loginIdps.forEach((o) => o.setAttribute('aria-selected', o === option));
      const { value: idp } = option.dataset;
      loginPickerIcon.classList.replace('symbol-chevron', 'symbol-loading');
      const defaultIdp = idp === 'default';
      const success = await messageSidekick({
        action: 'login',
        org,
        site,
        idp: defaultIdp ? null : idp,
        selectAccount: !defaultIdp,
      });
      if (typeof callback === 'function') {
        callback(success);
      }
    }
  });

  return loginContainer;
}
