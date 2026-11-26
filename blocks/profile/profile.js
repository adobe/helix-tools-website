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
    <button class="profile-trigger" type="button" hidden
      aria-label="Open profile menu" aria-expanded="false" popovertarget="profile-menu">
      <img src="${DEFAULT_AVATAR}" alt="" width="24" height="24">
    </button>
    <button class="profile-signin" type="button" hidden>Sign in with Adobe</button>
    <p class="profile-state" role="status">Checking Adobe sign-in...</p>
    <div id="profile-menu" class="profile-menu" popover aria-label="Adobe account" role="dialog"></div>
  `;
  const trigger = block.querySelector('.profile-trigger');
  const triggerAvatar = trigger.querySelector('img');
  const signin = block.querySelector('.profile-signin');
  const state = block.querySelector('.profile-state');
  const menu = block.querySelector('.profile-menu');
  let revision = 0;

  const positionMenu = () => {
    const { bottom, right } = trigger.getBoundingClientRect();
    menu.style.setProperty('--profile-menu-top', `${bottom + 8}px`);
    menu.style.setProperty('--profile-menu-right', `${window.innerWidth - right}px`);
  };
  menu.addEventListener('beforetoggle', ({ newState }) => {
    if (newState === 'open') positionMenu();
  });
  menu.addEventListener('toggle', ({ newState }) => {
    trigger.setAttribute('aria-expanded', String(newState === 'open'));
  });
  window.addEventListener('resize', () => {
    if (menu.matches(':popover-open')) positionMenu();
  });
  signin.addEventListener('click', leaveToSignIn);

  const render = async () => {
    revision += 1;
    const current = revision;
    if (menu.matches(':popover-open')) menu.hidePopover();
    trigger.hidden = true;
    signin.hidden = true;
    triggerAvatar.onerror = null;
    triggerAvatar.src = DEFAULT_AVATAR;
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
    if (!getImsToken()) {
      signin.hidden = false;
      return;
    }
    // getImsProfile() and getImsAvatar() already discard another account's results
    const isCurrent = () => current === revision;
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
        <span class="profile-copied" role="status"></span>
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
    const copied = menu.querySelector('.profile-copied');
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
      [triggerAvatar, copy.querySelector('img')].forEach((img) => {
        img.onerror = () => {
          img.onerror = null;
          img.src = DEFAULT_AVATAR;
        };
        img.src = avatar;
      });
    }).catch(() => {
      // keep the default avatar
    });
    copy.addEventListener('click', async () => {
      feedback.textContent = '';
      copied.textContent = '';
      try {
        await navigator.clipboard.writeText(profile.userId);
        if (isCurrent()) copied.textContent = 'User ID copied.';
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
