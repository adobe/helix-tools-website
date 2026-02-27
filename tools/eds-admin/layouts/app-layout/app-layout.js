import { LitElement, html, nothing } from 'lit';
import { getRouteDetails, navigate } from '../../utils/router.js';
import getSheet from '../../utils/sheet.js';
import '../app-header/app-header.js';
import '../app-sidebar/app-sidebar.js';

const sheet = await getSheet(new URL('./app-layout.css', import.meta.url).pathname);

const PAGE_LABELS = {
  'api-keys': 'API Keys',
  cdn: 'CDN Config',
  config: 'Advanced Config Editor',
};

function segmentToLabel(segment) {
  if (PAGE_LABELS[segment]) return PAGE_LABELS[segment];
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const VIEW_MAP = {
  'org-dashboard': () => import('../../pages/org/org-dashboard/org-dashboard.js'),
  'org-users': () => import('../../pages/org/org-users/org-users.js'),
  'org-secrets': () => import('../../pages/org/org-secrets/org-secrets.js'),
  'org-api-keys': () => import('../../pages/org/org-api-keys/org-api-keys.js'),
  'org-versions': () => import('../../pages/org/org-versions/org-versions.js'),
  'site-overview': () => import('../../pages/site/site-overview/site-overview.js'),
  'site-config': () => import('../../pages/site/config-editor/config-editor.js'),
  'site-access': () => import('../../pages/site/site-access/site-access.js'),
  'site-api-keys': () => import('../../pages/site/site-api-keys/site-api-keys.js'),
  'site-bulk': () => import('../../pages/site/site-bulk/site-bulk.js'),
  'site-cdn': () => import('../../pages/site/site-cdn/site-cdn.js'),
  'site-headers': () => import('../../pages/site/site-headers/site-headers.js'),
  'site-index': () => import('../../pages/site/site-index/site-index.js'),
  'site-logs': () => import('../../pages/site/site-logs/site-logs.js'),
  'site-robots': () => import('../../pages/site/site-robots/site-robots.js'),
  'site-secrets': () => import('../../pages/site/site-secrets/site-secrets.js'),
  'site-sidekick': () => import('../../pages/site/site-sidekick/site-sidekick.js'),
  'site-sitemaps': () => import('../../pages/site/site-sitemaps/site-sitemaps.js'),
  'site-snapshots': () => import('../../pages/site/site-snapshots/site-snapshots.js'),
  'site-status': () => import('../../pages/site/site-status/site-status.js'),
  'site-users': () => import('../../pages/site/site-users/site-users.js'),
  'site-versions': () => import('../../pages/site/site-versions/site-versions.js'),
};

const TAG_MAP = {
  'site-config': 'config-editor',
};

export class AppLayout extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _currentView: { state: true },
    _sidebarOpen: { state: true },
  };

  constructor() {
    super();
    this._org = null;
    this._site = null;
    this._currentView = null;
    this._sidebarOpen = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];

    this.addEventListener('toggle-sidebar', () => {
      this._sidebarOpen = !this._sidebarOpen;
    });
    this.addEventListener('close-sidebar', () => {
      this._sidebarOpen = false;
    });
  }

  handleRouteChange() {
    this._loadRoute();
  }

  async _loadRoute() {
    if (this._routing) return;
    this._routing = true;
    try {
      const details = getRouteDetails();
      if (details.view === 'landing') return;

      this._org = details.org;
      this._site = details.site || null;
      this._sidebarOpen = false;

      const viewChanged = details.view !== this._currentView;
      const orgChanged = details.org !== this._prevOrg;
      const siteChanged = (details.site || null) !== this._prevSite;
      this._prevOrg = details.org;
      this._prevSite = details.site || null;

      if (!viewChanged && !orgChanged && !siteChanged) {
        const outlet = this.shadowRoot.querySelector('#content');
        const child = outlet?.firstElementChild;
        if (child?.handleRouteChange) child.handleRouteChange(details);
        return;
      }

      this._currentView = details.view;
      const loader = VIEW_MAP[details.view];
      if (!loader) return;

      await loader();
      await this.updateComplete;

      const outlet = this.shadowRoot.querySelector('#content');
      if (!outlet) return;
      outlet.innerHTML = '';

      const tag = TAG_MAP[details.view] || details.view;
      const el = document.createElement(tag);
      outlet.append(el);
    } finally {
      this._routing = false;
    }
  }

  _getBreadcrumbs() {
    if (!this._org) return [];
    const crumbs = [{ label: this._org, path: `#/${this._org}` }];
    if (this._site) {
      crumbs.push({ label: this._site, path: `#/${this._org}/${this._site}` });
    }
    const details = getRouteDetails();
    if (details.page) {
      crumbs.push({
        label: segmentToLabel(details.page),
        path: window.location.hash,
      });
    }
    return crumbs;
  }

  _handleBreadcrumbClick(e, path) {
    e.preventDefault();
    navigate(path.replace('#', ''));
  }

  render() {
    const crumbs = this._getBreadcrumbs();

    return html`
      <div class="shell">
        <app-header
          .currentOrg=${this._org}
          .currentSite=${this._site}
        ></app-header>
        <hr class="divider" />
        <div class="body">
          ${this._sidebarOpen ? html`
            <div class="sidebar-backdrop" @click=${() => { this._sidebarOpen = false; }}></div>
          ` : nothing}
          <app-sidebar
            .org=${this._org}
            .site=${this._site}
            ?open=${this._sidebarOpen}
          ></app-sidebar>
          <div class="main">
            ${crumbs.length ? html`
              <nav class="breadcrumbs" aria-label="Breadcrumbs">
                <ol>
                  ${crumbs.map((c) => html`
                    <li><a href=${c.path} @click=${(e) => this._handleBreadcrumbClick(e, c.path)}>${c.label}</a></li>
                  `)}
                </ol>
              </nav>
            ` : nothing}
            <div id="content"></div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('app-layout', AppLayout);
