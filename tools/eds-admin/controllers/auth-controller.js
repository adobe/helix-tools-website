import { messageSidekick, getSidekickId, NO_SIDEKICK } from '../services/sidekick.js';
import { fetchProfile } from '../services/adminApi.js';
import { addProject } from '../services/storage.js';

const delay = (ms) => new Promise((r) => { setTimeout(r, ms); });

export class AuthStore extends EventTarget {
  static instance = null;

  constructor() {
    super();
    this.authenticatedOrgs = [];
    this.sidekickAvailable = null;
    this.userEmail = null;
    this.loading = true;
    AuthStore.instance = this;
  }

  _emit() {
    this.dispatchEvent(new Event('change'));
  }

  async refreshAuth() {
    const authInfo = await messageSidekick({ action: 'getAuthInfo' });

    if (authInfo === NO_SIDEKICK) {
      this.sidekickAvailable = false;
      this.loading = false;
      this._emit();
      return;
    }

    this.sidekickAvailable = true;
    this.authenticatedOrgs = Array.isArray(authInfo) ? authInfo : [];

    const sites = await messageSidekick({ action: 'getSites' });
    if (Array.isArray(sites)) {
      sites.forEach(({ org, owner, site, repo }) => {
        const o = org || owner;
        const s = site || repo;
        if (o && s) addProject(o, s);
      });
    }

    this.loading = false;
    this._emit();
  }

  isAuthenticated(org) {
    return this.authenticatedOrgs.includes(org);
  }

  async login(org, site) {
    const loginUrl = new URL(`https://admin.hlx.page/login/${org}/${site}/main`);
    loginUrl.searchParams.append('extensionId', getSidekickId());
    const popup = window.open(loginUrl.toString(), 'aem-login', 'width=500,height=700');

    if (!popup) return false;

    return new Promise((resolve) => {
      const poll = setInterval(async () => {
        try {
          if (popup.closed) {
            clearInterval(poll);
            await delay(800);
            await this.refreshAuth();
            const authInfo = await messageSidekick({ action: 'getAuthInfo' });
            resolve(Array.isArray(authInfo) && authInfo.includes(org));
          }
        } catch {
          // cross-origin — keep polling
        }
      }, 400);

      setTimeout(() => { clearInterval(poll); resolve(false); }, 180_000);
    });
  }

  async logout(org, site) {
    const logoutUrl = new URL(`https://admin.hlx.page/logout/${org}/${site}/main`);
    logoutUrl.searchParams.append('extensionId', getSidekickId());
    const popup = window.open(logoutUrl.toString(), 'aem-logout', 'width=500,height=500');

    return new Promise((resolve) => {
      const poll = setInterval(() => {
        try {
          if (!popup || popup.closed) {
            clearInterval(poll);
            this.authenticatedOrgs = this.authenticatedOrgs.filter((o) => o !== org);
            this.userEmail = null;
            this._emit();
            resolve(true);
          }
        } catch {
          // keep polling
        }
      }, 400);

      setTimeout(() => { clearInterval(poll); resolve(false); }, 60_000);
    });
  }

  async fetchUserEmail(org, site) {
    if (this.userEmail) return this.userEmail;
    const { data, status } = await fetchProfile(org, site);
    if (status === 200 && data?.profile?.email) {
      this.userEmail = data.profile.email;
      this._emit();
      return this.userEmail;
    }
    return null;
  }
}
