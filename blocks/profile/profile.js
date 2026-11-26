import {
  getImsAvatar,
  getImsProfile,
  getImsToken,
  leaveToSignIn,
  loadIms,
  signOut,
} from '../../utils/ims.js';

const DEFAULT_AVATAR = '/blocks/profile/profile.svg';

export default async function decorate(block) {
  block.innerHTML = `
    <button id="profile" class="profile-trigger" type="button" hidden
      aria-label="Open profile menu" aria-expanded="false" popovertarget="profile-menu">
      <img src="${DEFAULT_AVATAR}" alt="" width="24" height="24">
    </button>
    <button class="profile-signin" type="button" hidden>Sign in with Adobe</button>
    <p class="profile-state" role="status">Checking Adobe sign-in...</p>
    <div id="profile-menu" class="profile-menu" popover aria-label="Adobe account" role="dialog"></div>
  `;
  const trigger = block.querySelector('.profile-trigger');
  const signin = block.querySelector('.profile-signin');
  const state = block.querySelector('.profile-state');
  const menu = block.querySelector('.profile-menu');
  let revision = 0;

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    menu.style.setProperty('--profile-menu-top', `${rect.bottom + 8}px`);
    const width = Math.min(340, window.innerWidth - 32);
    const right = Math.min(window.innerWidth - rect.right, window.innerWidth - width - 16);
    menu.style.right = `${Math.max(16, right)}px`;
  };
  menu.addEventListener('beforetoggle', ({ newState }) => {
    if (newState === 'open') positionMenu();
  });
  menu.addEventListener('toggle', ({ newState }) => {
    trigger.setAttribute('aria-expanded', String(newState === 'open'));
  });
  window.addEventListener('resize', positionMenu);
  signin.addEventListener('click', leaveToSignIn);

  const render = async () => {
    revision += 1;
    const current = revision;
    if (menu.matches(':popover-open')) menu.hidePopover();
    trigger.hidden = true;
    signin.hidden = true;
    trigger.querySelector('img').onerror = null;
    trigger.querySelector('img').src = DEFAULT_AVATAR;
    menu.replaceChildren();
    state.textContent = 'Checking Adobe sign-in...';
    try {
      await loadIms();
    } catch {
      if (current === revision) {
        state.textContent = 'Adobe sign-in is unavailable. Reload the page to try again.';
      }
      return;
    }
    if (current !== revision) return;
    state.textContent = '';
    const token = getImsToken();
    if (!token) {
      signin.hidden = false;
      return;
    }
    const isCurrent = () => current === revision && token === getImsToken();
    trigger.hidden = false;
    menu.innerHTML = `
      <div class="profile-details">
        <button class="profile-copy" type="button" aria-label="Copy user ID"
          aria-describedby="profile-name profile-email" disabled autofocus>
          <img src="${DEFAULT_AVATAR}" alt="" width="72" height="72">
          <span class="profile-identity">
            <span id="profile-name" class="profile-name">Adobe account</span>
            <span id="profile-email" class="profile-email"></span>
          </span>
          <svg class="profile-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="12" height="13" rx="2"/>
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <p class="profile-feedback" role="status"></p>
      </div>
      <div class="profile-links">
        <p class="profile-label">Links</p>
        <ul>
          <li><a href="https://account.adobe.com/" target="_blank" rel="noopener noreferrer">Account</a></li>
          <li><a href="https://experience.adobe.com/#/preferences" target="_blank" rel="noopener noreferrer">Preferences</a></li>
          <li><a href="https://adminconsole.adobe.com/" target="_blank" rel="noopener noreferrer">Admin Console</a></li>
        </ul>
      </div>
      <button class="profile-signout" type="button">Sign out</button>
    `;
    const feedback = menu.querySelector('.profile-feedback');
    const copy = menu.querySelector('.profile-copy');
    let profile;
    getImsProfile().then((details) => {
      if (!isCurrent()) return;
      profile = details;
      menu.querySelector('.profile-name').textContent = profile?.displayName || 'Adobe account';
      menu.querySelector('.profile-email').textContent = profile?.email || '';
      copy.disabled = !profile?.userId;
    }).catch(() => {
      if (isCurrent()) feedback.textContent = 'Could not load your Adobe profile.';
    });
    getImsAvatar().then((avatar) => {
      if (!isCurrent()) return;
      [trigger.querySelector('img'), copy.querySelector('img')].forEach((img) => {
        img.onerror = () => {
          img.onerror = null;
          // eslint-disable-next-line no-console
          console.warn('Could not display Adobe profile photo.');
          img.src = DEFAULT_AVATAR;
        };
        img.src = avatar;
      });
    }).catch((error) => {
      if (!isCurrent()) return;
      // eslint-disable-next-line no-console
      console.warn('Could not load Adobe profile photo.', error);
    });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(profile.userId);
        if (isCurrent()) feedback.textContent = 'User ID copied to clipboard.';
      } catch {
        if (isCurrent()) feedback.textContent = 'Could not copy user ID. Check clipboard permissions and try again.';
      }
    });
    const signout = menu.querySelector('.profile-signout');
    signout.addEventListener('click', async () => {
      signout.disabled = true;
      try {
        await signOut();
      } catch {
        if (isCurrent()) {
          feedback.textContent = 'Could not sign out. Please try again.';
          signout.disabled = false;
        }
      }
    });
  };
  window.addEventListener('ims-signed-in', render);
  window.addEventListener('ims-signed-out', render);
  await render();
}
