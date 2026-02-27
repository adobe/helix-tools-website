import { LitElement, html, nothing } from 'lit';
import { navigate } from '../../utils/router.js';
import { AuthStore } from '../../controllers/auth-controller.js';
import { getProjects, getLocalSites } from '../../services/storage.js';
import { fetchOrgSites } from '../../services/adminApi.js';
import { edsIcon } from '../../utils/icons.js';
import getSheet from '../../utils/sheet.js';
import '../../blocks/eds-picker/eds-picker.js';
import '../../blocks/eds-menu/eds-menu.js';

const sheet = await getSheet(new URL('./app-header.css', import.meta.url).pathname);

export class AppHeader extends LitElement {
  static properties = {
    currentOrg: { type: String },
    currentSite: { type: String },
    _orgs: { state: true },
    _siteOptions: { state: true },
    _sitesLoading: { state: true },
    _effectiveTheme: { state: true },
  };

  constructor() {
    super();
    this.currentOrg = null;
    this.currentSite = null;
    this._orgs = [];
    this._siteOptions = [];
    this._sitesLoading = false;
    this._effectiveTheme = 'light';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
    this._effectiveTheme = document.documentElement.style.colorScheme || 'light';
  }

  willUpdate(changed) {
    if (changed.has('currentOrg')) {
      this._loadOrgs();
      this._loadSites();
    }
  }

  _loadOrgs() {
    const { orgs } = getProjects();
    this._orgs = orgs;
  }

  async _loadSites() {
    if (!this.currentOrg) {
      this._siteOptions = [];
      return;
    }

    this._sitesLoading = true;
    const { data, status } = await fetchOrgSites(this.currentOrg);

    if (status === 200 && data) {
      const siteList = data.sites || data;
      const list = Array.isArray(siteList) ? siteList : [];
      this._siteOptions = list.map((s) => s.name);
    } else {
      this._siteOptions = getLocalSites(this.currentOrg);
    }
    this._sitesLoading = false;
  }

  _getAuth() {
    return AuthStore.instance;
  }

  _handleOrgChange(e) {
    const key = e.detail?.value ?? e.target?.value;
    if (!key || key === this.currentOrg) return;

    const auth = this._getAuth();
    if (auth?.isAuthenticated(key)) {
      navigate(`/${key}`);
      return;
    }

    const sites = getLocalSites(key);
    if (sites.length > 0) {
      auth?.login(key, sites[0]).then((success) => {
        if (success) navigate(`/${key}`);
      });
    }
  }

  _handleSiteChange(e) {
    const key = e.detail?.value ?? e.target?.value;
    if (!key || !this.currentOrg) return;

    if (this.currentSite) {
      const hash = window.location.hash.replace('#', '');
      const basePath = `/${this.currentOrg}/${this.currentSite}`;
      const subPath = hash.startsWith(basePath) ? hash.slice(basePath.length) : '';
      navigate(`/${this.currentOrg}/${key}${subPath}`);
    } else {
      navigate(`/${this.currentOrg}/${key}`);
    }
  }

  _toggleTheme() {
    const next = this._effectiveTheme === 'dark' ? 'light' : 'dark';
    this._effectiveTheme = next;
    this.dispatchEvent(new CustomEvent('theme-change', {
      detail: { scheme: next },
      bubbles: true,
      composed: true,
    }));
  }

  async _handleLogout() {
    if (!this.currentOrg) return;
    const auth = this._getAuth();
    const sites = getLocalSites(this.currentOrg);
    if (sites.length > 0) {
      await auth?.logout(this.currentOrg, sites[0]);
    }
    navigate('/');
  }

  render() {
    const auth = this._getAuth();
    const isAuth = this.currentOrg && auth?.isAuthenticated(this.currentOrg);

    const orgOptions = this._orgs.map((o) => ({ value: o, label: o }));
    const siteOptions = this._siteOptions.map((s) => ({ value: s, label: s }));

    return html`
      <div class="header">
        <button
          class="icon-btn menu-toggle"
          aria-label="Toggle menu"
          @click=${() => this.dispatchEvent(new CustomEvent('toggle-sidebar', { bubbles: true, composed: true }))}
        >${edsIcon('show-menu', { size: 20 })}</button>

        <div class="left">
          <img src="${new URL('../../assets/aem-logo.png', import.meta.url).pathname}" alt="AEM" width="24" height="24" />
          <span class="title">EDS Admin Console</span>
        </div>

        ${this._orgs.length > 0 ? html`
          <eds-picker
            .value=${this.currentOrg || ''}
            .options=${orgOptions}
            placeholder="Organization…"
            size="m"
            @change=${this._handleOrgChange}
          ></eds-picker>
        ` : nothing}

        ${this.currentOrg ? html`
          <eds-picker
            .value=${this.currentSite || ''}
            .options=${siteOptions}
            .placeholder=${this._sitesLoading ? 'Loading sites...' : 'Go to site…'}
            size="m"
            @change=${this._handleSiteChange}
          ></eds-picker>
        ` : nothing}

        <div class="spacer"></div>

        <button
          class="icon-btn"
          aria-label=${`Switch to ${this._effectiveTheme === 'dark' ? 'light' : 'dark'} mode`}
          @click=${this._toggleTheme}
        >${this._effectiveTheme === 'dark' ? edsIcon('light', { size: 20 }) : edsIcon('contrast', { size: 20 })}</button>

        ${isAuth ? html`
          <eds-menu label="Account">
            <span slot="trigger">${edsIcon('user', { size: 20 })}</span>
            <button role="menuitem" @click=${this._handleLogout}>Sign out of ${this.currentOrg}</button>
          </eds-menu>
        ` : html`
          <button class="icon-btn" aria-label="Account" @click=${() => navigate('/')}>
            ${edsIcon('user', { size: 20 })}
          </button>
        `}
      </div>
    `;
  }
}

customElements.define('app-header', AppHeader);
