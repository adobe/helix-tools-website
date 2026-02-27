import { LitElement, html } from 'lit';
import { navigate, getRouteDetails } from '../../utils/router.js';
import { edsIcon } from '../../utils/icons.js';
import getSheet from '../../utils/sheet.js';

const sheet = await getSheet(new URL('./app-sidebar.css', import.meta.url).pathname);

const ORG_NAV = [
  { id: 'sites', label: 'Sites', icon: 'home', path: '' },
  { id: 'users', label: 'Users', icon: 'user-group', path: '/users' },
  { id: 'secrets', label: 'Secrets', icon: 'lock-closed', path: '/secrets' },
  { id: 'api-keys', label: 'API Keys', icon: 'key', path: '/api-keys' },
  { id: 'versions', label: 'Versions', icon: 'clock', path: '/versions' },
];

const SITE_NAV = [
  { id: 'overview', label: 'Overview', icon: 'web-page', path: '' },
  { id: 'cdn', label: 'CDN Config', icon: 'globe-grid', path: '/cdn' },
  { id: 'users', label: 'Users & Roles', icon: 'user-group', path: '/users' },
  { id: 'access', label: 'Site Authentication', icon: 'lock-closed', path: '/access' },
  { id: 'index', label: 'Index Configs', icon: 'data', path: '/index' },
  { id: 'sitemaps', label: 'Sitemap Configs', icon: 'view-list', path: '/sitemaps' },
  { id: 'headers', label: 'HTTP Headers', icon: 'code', path: '/headers' },
  { id: 'robots', label: 'Robots', icon: 'document', path: '/robots' },
  { id: 'sidekick', label: 'Sidekick Config', icon: 'contrast', path: '/sidekick' },
  { id: 'status', label: 'Page Status', icon: 'data-refresh', path: '/status' },
  { id: 'snapshots', label: 'Snapshots', icon: 'star', path: '/snapshots' },
  { id: 'bulk', label: 'Bulk Operations', icon: 'collection', path: '/bulk' },
  { id: 'secrets', label: 'Secrets', icon: 'lock-closed', path: '/secrets' },
  { id: 'api-keys', label: 'API Keys', icon: 'key', path: '/api-keys' },
  { id: 'logs', label: 'Logs', icon: 'play', path: '/logs' },
  { id: 'config-editor', label: 'Advanced Config Editor', icon: 'settings', path: '/config' },
];

export class AppSidebar extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    open: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.org = null;
    this.site = null;
    this.open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
    this._onHashChange = () => this.requestUpdate();
    window.addEventListener('hashchange', this._onHashChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._onHashChange);
  }

  get _basePath() {
    if (this.site) return `/${this.org}/${this.site}`;
    if (this.org) return `/${this.org}`;
    return '/';
  }

  _getSelectedValue() {
    const details = getRouteDetails();
    const items = this.site ? SITE_NAV : ORG_NAV;

    if (!details.page) {
      return items[0]?.id || '';
    }

    const match = items.find((i) => i.path === `/${details.page}`);
    return match?.id || '';
  }

  _handleClick(item) {
    navigate(`${this._basePath}${item.path}`);
    this.dispatchEvent(new CustomEvent('close-sidebar', { bubbles: true, composed: true }));
  }

  render() {
    if (!this.org) return html``;

    const items = this.site ? SITE_NAV : ORG_NAV;
    const selectedValue = this._getSelectedValue();

    return html`
      <nav class="sidebar">
        ${this.site ? html`
          <button class="back-btn" @click=${() => navigate(`/${this.org}`)}>
            ${edsIcon('chevron-left', { size: 16 })}
          </button>
          <div class="site-label">${this.site}</div>
          <hr class="divider" />
        ` : ''}

        <ul class="nav-list">
          ${items.map((item) => html`
            <li>
              <a
                class="nav-item ${item.id === selectedValue ? 'selected' : ''}"
                href="#${this._basePath}${item.path}"
                @click=${(e) => { e.preventDefault(); this._handleClick(item); }}
              >
                <span class="nav-icon">${edsIcon(item.icon, { size: 18 })}</span>
                <span>${item.label}</span>
              </a>
            </li>
          `)}
        </ul>
      </nav>
    `;
  }
}

customElements.define('app-sidebar', AppSidebar);
