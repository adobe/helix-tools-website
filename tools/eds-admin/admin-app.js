import { LitElement, html } from 'lit';
import { AuthStore } from './controllers/auth-controller.js';
import { getRouteDetails } from './utils/router.js';
import { getThemePreference, setThemePreference } from './services/storage.js';
import getSheet from './utils/sheet.js';

const sheet = await getSheet(new URL('./styles/admin-app.css', import.meta.url).pathname);

export class AdminApp extends LitElement {
  static properties = {
    _colorScheme: { state: true },
    _currentView: { state: true },
  };

  constructor() {
    super();
    this._colorScheme = getThemePreference()
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this._currentView = null;

    this._authStore = new AuthStore();
    this._authStore.addEventListener('change', () => this.requestUpdate());

    this.addEventListener('theme-change', (e) => {
      this._colorScheme = e.detail.scheme;
      setThemePreference(e.detail.scheme);
      this._applyTheme();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sheet];
    this._applyTheme();
    this._authStore.refreshAuth();
    this._route();
    window.addEventListener('hashchange', () => this._route());
  }

  _applyTheme() {
    const isDark = this._colorScheme === 'dark';
    document.documentElement.style.colorScheme = this._colorScheme;
    document.documentElement.classList.toggle('spectrum-dark', isDark);
    if (isDark) {
      let link = document.getElementById('spectrum-dark-tokens');
      if (!link) {
        link = document.createElement('link');
        link.id = 'spectrum-dark-tokens';
        link.rel = 'stylesheet';
        link.href = new URL('./styles/spectrum-tokens-dark.css', import.meta.url).pathname;
        document.head.appendChild(link);
      }
    } else {
      document.getElementById('spectrum-dark-tokens')?.remove();
    }
  }

  async _route() {
    if (this._routing) return;
    this._routing = true;
    try {
      const details = getRouteDetails();
      const root = this.shadowRoot.querySelector('#app-root');
      if (!root) {
        await this.updateComplete;
        this._routing = false;
        return this._route();
      }

      if (details.view === 'landing') {
        root.innerHTML = '';
        await import('./pages/landing-page/landing-page.js');
        root.append(document.createElement('landing-page'));
        this._currentView = 'landing';
      } else {
        let layout = root.querySelector('app-layout');
        if (!layout) {
          root.innerHTML = '';
          await import('./layouts/app-layout/app-layout.js');
          layout = document.createElement('app-layout');
          root.append(layout);

          const tc = root.querySelector('toast-container');
          if (!tc) {
            await import('./blocks/toast-container/toast-container.js');
            const toast = document.createElement('toast-container');
            root.append(toast);
          }
        }
        layout.handleRouteChange();
        this._currentView = details.view;
      }
    } finally {
      this._routing = false;
    }
  }

  render() {
    return html`<div id="app-root"></div>`;
  }
}

customElements.define('admin-app', AdminApp);
