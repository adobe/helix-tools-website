import { LitElement, html, nothing } from 'lit';
import { AuthStore } from '../../controllers/auth-controller.js';
import { navigate } from '../../utils/router.js';
import { addProject, getLastOrg, getProjects, getLocalSites } from '../../services/storage.js';
import { edsIcon } from '../../utils/icons.js';
import getSheet from '../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../styles/page-sheets.js';
import '../../blocks/eds-button/eds-button.js';
import '../../blocks/eds-textfield/eds-textfield.js';
import '../../blocks/eds-alert/eds-alert.js';

const sheet = await getSheet(new URL('./landing-page.css', import.meta.url).pathname);

export class LandingPage extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _signingIn: { state: true },
    _error: { state: true },
    _theme: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._signingIn = false;
    this._error = null;
    this._theme = 'light';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sheet, sharedSheet];
    this._theme = document.documentElement.style.colorScheme || 'light';
  }

  _toggleTheme() {
    const next = this._theme === 'dark' ? 'light' : 'dark';
    this._theme = next;
    this.dispatchEvent(new CustomEvent('theme-change', {
      detail: { scheme: next },
      bubbles: true,
      composed: true,
    }));
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);

    if (!AuthStore.instance) return;

    const { loading, sidekickAvailable } = AuthStore.instance;
    const lastOrg = getLastOrg();

    if (
      !loading &&
      sidekickAvailable === true &&
      lastOrg &&
      AuthStore.instance.isAuthenticated(lastOrg)
    ) {
      navigate(`/${lastOrg}`);
    }
  }

  _handleOrgInput(e) {
    this._org = e.target.value ?? e.detail?.value ?? '';
    this._error = null;
  }

  _handleSiteInput(e) {
    this._site = e.target.value ?? e.detail?.value ?? '';
    this._error = null;
  }

  async _handleSubmit(e) {
    e.preventDefault();
    const org = this._org.trim();
    const site = this._site.trim();

    if (!org || !site) {
      this._error = 'Both organization and site are required.';
      return;
    }

    this._error = null;
    this._signingIn = true;
    addProject(org, site);

    const success = await AuthStore.instance.login(org, site);
    this._signingIn = false;

    if (success) {
      navigate(`/${org}/${site}`);
    } else {
      this._error =
        'Sign in could not be verified. Make sure the login popup completed and popups are not blocked.';
    }
  }

  async _handleSignInExisting(existingOrg) {
    const sites = getLocalSites(existingOrg);
    if (sites.length === 0) return;

    this._signingIn = true;
    this._error = null;

    const success = await AuthStore.instance.login(existingOrg, sites[0]);
    this._signingIn = false;

    if (success) {
      navigate(`/${existingOrg}`);
    } else {
      this._error = `Could not sign in to ${existingOrg}. Try again or re-add it.`;
    }
  }

  _handleReload = () => {
    window.location.reload();
  };

  render() {
    const store = AuthStore.instance;

    if (store?.loading) {
      return html`
        <div class="landing loading">
          <div class="spinner" aria-label="Loading"></div>
        </div>
      `;
    }

    const { orgs } = getProjects();
    const unauthenticatedOrgs = orgs.filter((o) => !store?.isAuthenticated(o));
    const authedOrgs = orgs.filter((o) => store?.isAuthenticated(o));

    return html`
      <div class="landing">
        <button class="icon-btn theme-toggle"
          aria-label=${`Switch to ${this._theme === 'dark' ? 'light' : 'dark'} mode`}
          @click=${this._toggleTheme}>
          ${this._theme === 'dark' ? edsIcon('light', { size: 20 }) : edsIcon('contrast', { size: 20 })}
        </button>
        <div class="landing-inner">
          <div class="landing-content">
            <img
              src="${new URL('../../assets/aem-logo.png', import.meta.url).pathname}"
              alt="Adobe"
              width="42"
              height="42"
            />
            <h1 class="landing-title">Edge Delivery Services Admin Console</h1>
            <p class="landing-subtitle">Manage your Edge Delivery Services sites</p>

            ${store?.sidekickAvailable === false
              ? this._renderSidekickNotInstalled()
              : store?.sidekickAvailable
                ? this._renderMainContent(orgs, authedOrgs, unauthenticatedOrgs)
                : nothing}
          </div>
        </div>
      </div>
    `;
  }

  _renderSidekickNotInstalled() {
    return html`
      <div class="sidekick-section">
        <eds-alert variant="negative" open>
          The AEM Sidekick Chrome extension is required. Please install it and
          reload this page.
        </eds-alert>
        <a
          href="https://chromewebstore.google.com/detail/aem-sidekick/igkmdomcgoebiipaifhmpfjhbjccggml"
          target="_blank"
          rel="noopener noreferrer"
          class="link-accent"
        >
          Install AEM Sidekick
        </a>
        <eds-button variant="secondary" @click=${this._handleReload}>
          Reload Page
        </eds-button>
      </div>
    `;
  }

  _renderMainContent(orgs, authedOrgs, unauthenticatedOrgs) {
    return html`
      ${authedOrgs.length > 0
        ? html`
            <div class="section">
              <h3 class="section-heading">Continue</h3>
              <div class="org-list">
                ${authedOrgs.map(
                  (o) =>
                    html`
                      <eds-button
                        variant="secondary"
                        @click=${() => navigate(`/${o}`)}
                      >
                        ${o}
                      </eds-button>
                    `,
                )}
              </div>
            </div>
          `
        : nothing}

      ${unauthenticatedOrgs.length > 0
        ? html`
            <div class="section">
              <h3 class="section-heading">Sign in</h3>
              <div class="org-list sign-in-list">
                ${unauthenticatedOrgs.map(
                  (o) =>
                    html`
                      <div class="sign-in-row">
                        <span>${o}</span>
                        <eds-button
                          variant="accent"
                          ?disabled=${this._signingIn}
                          @click=${() => this._handleSignInExisting(o)}
                        >
                          Sign in
                        </eds-button>
                      </div>
                    `,
                )}
              </div>
            </div>
          `
        : nothing}

      <div class="section form-section">
        <form @submit=${this._handleSubmit}>
          <h3 class="section-heading">
            ${orgs.length > 0 ? 'Add Another Organization' : 'Get Started'}
          </h3>
          <label class="field-label" for="landing-org">Organization</label>
          <eds-textfield
            id="landing-org"
            placeholder="e.g. adobe"
            .value=${this._org}
            @input=${this._handleOrgInput}
            required
            ?disabled=${this._signingIn}
          ></eds-textfield>
          <label class="field-label" for="landing-site">Site</label>
          <eds-textfield
            id="landing-site"
            placeholder="e.g. my-website"
            .value=${this._site}
            @input=${this._handleSiteInput}
            required
            ?disabled=${this._signingIn}
          >
            <span slot="help-text" class="help-text">Any site within the org (needed for authentication)</span>
          </eds-textfield>
          ${this._error
            ? html`
                <eds-alert variant="negative" open>
                  ${this._error}
                </eds-alert>
              `
            : nothing}
          <eds-button
            variant="accent"
            type="submit"
            ?disabled=${this._signingIn}
          >
            ${this._signingIn ? 'Signing in...' : 'Add & Sign In'}
          </eds-button>
        </form>
      </div>
    `;
  }
}

customElements.define('landing-page', LandingPage);
