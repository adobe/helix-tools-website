import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchSiteAccess,
  updateSiteAccess,
  fetchSecrets,
  createSecret,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-alert/eds-alert.js';
import '../../../blocks/eds-picker/eds-picker.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-access.css', import.meta.url).pathname);

const AUTH_SCOPES = [
  { id: 'public', label: 'Public', description: 'No authentication required' },
  {
    id: 'protected',
    label: 'Protected (Preview + Live)',
    description: 'Both preview and live require authentication',
  },
  {
    id: 'preview-only',
    label: 'Preview Only',
    description: 'Only preview requires authentication',
  },
  {
    id: 'live-only',
    label: 'Live Only',
    description: 'Only live requires authentication',
  },
];

export class SiteAccess extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _access: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _saving: { state: true },
    _scope: { state: true },
    _savedScope: { state: true },
    _allowedUsers: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._access = {};
    this._loading = true;
    this._error = null;
    this._saving = false;
    this._scope = 'public';
    this._savedScope = 'public';
    this._allowedUsers = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) {
      this._load();
    }
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') || changedProperties.has('_site')) {
      if (this._org && this._site) {
        this._load();
      }
    }
  }

  async _load() {
    if (!this._org || !this._site) return;

    this._loading = true;
    this._error = null;

    const { data, status, error } = await fetchSiteAccess(this._org, this._site);

    if (status === 404) {
      this._access = {};
      this._deriveScope();
      this._loading = false;
      return;
    }

    const err = getApiError(status, 'load access config', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }

    this._access = data || {};
    this._deriveScope();
    this._loading = false;
  }

  _deriveScope() {
    const access = this._access || {};
    const hasSite = access.site && typeof access.site === 'object';
    const hasPreview = hasSite || (access.preview && typeof access.preview === 'object');
    const hasLive = hasSite || (access.live && typeof access.live === 'object');

    let scope = 'public';
    if (hasPreview && hasLive) {
      scope = 'protected';
    } else if (hasPreview) {
      scope = 'preview-only';
    } else if (hasLive) {
      scope = 'live-only';
    }

    this._scope = scope;
    this._savedScope = scope;

    const allowList = access.site?.allow
      || access.preview?.allow
      || access.live?.allow
      || [];
    this._allowedUsers = Array.isArray(allowList) ? allowList.join(', ') : '';
  }

  async _handleSave() {
    if (!this._org || !this._site) return;

    const scope = this._scope;
    const needsAuth = scope !== 'public';

    if (needsAuth) {
      const { data: secrets } = await fetchSecrets(this._org, this._site);
      const hasSecrets = secrets && secrets.length > 0;

      if (!hasSecrets) {
        const { status: createStatus, error: createError } = await createSecret(
          this._org,
          this._site,
        );
        const createErr = getApiError(createStatus, 'create secret', createError);
        if (createErr) {
          toast.negative(createErr);
          return;
        }
        toast.positive('Secret created for authentication.');
      }
    }

    this._saving = true;

    const access = this._buildAccessFromScope(scope);
    const { status, error } = await updateSiteAccess(this._org, this._site, access);
    this._saving = false;

    const saveErr = getApiError(status, 'save access config', error);
    if (saveErr) {
      toast.negative(saveErr);
      return;
    }

    toast.positive('Access configuration saved.');
    this._access = access;
    this._deriveScope();
  }

  _buildAccessFromScope(scope) {
    const emails = this._allowedUsers
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (scope === 'public') {
      return {};
    }

    const accessObj = emails.length > 0 ? { allow: emails } : { allow: ['*'] };

    if (scope === 'protected') {
      return { site: accessObj };
    }
    if (scope === 'preview-only') {
      return { preview: accessObj };
    }
    if (scope === 'live-only') {
      return { live: accessObj };
    }
    return {};
  }

  _getAuthStatusLabel() {
    const labels = {
      public: 'Public — No authentication required',
      protected: 'Protected — Preview and Live require authentication',
      'preview-only': 'Preview Only — Preview requires authentication',
      'live-only': 'Live Only — Live requires authentication',
    };
    return labels[this._savedScope] || labels.public;
  }

  render() {
    const scopeOptions = AUTH_SCOPES.map((s) => ({ value: s.id, label: s.label }));
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Site Authentication</h1>
            <p class="page-subtitle">
              Configure preview and live authentication for your site.
            </p>
          </div>
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        ${this._loading
          ? html`
              <div class="loading">
                <div class="spinner" aria-label="Loading"></div>
              </div>
            `
          : html`
              <div class="form-section">
                <eds-alert variant="info" open>
                  ${this._getAuthStatusLabel()}
                </eds-alert>

                <label class="field-label" for="site-access-scope">Authentication scope</label>
                <eds-picker
                  id="site-access-scope"
                  label="Authentication scope"
                  class="scope-picker"
                  .value=${this._scope}
                  .options=${scopeOptions}
                  @change=${(e) => {
                    this._scope = e.target.value ?? e.detail?.value ?? 'public';
                  }}
                ></eds-picker>

                ${this._scope !== 'public'
                  ? html`
                      <label class="field-label" for="site-access-allowed-users">Allowed users (comma-separated emails)</label>
                      <eds-textfield
                        id="site-access-allowed-users"
                        label="Allowed users"
                        placeholder="user@example.com, admin@example.com"
                        .value=${this._allowedUsers}
                        @input=${(e) => {
                          this._allowedUsers = e.target.value ?? e.detail?.value ?? '';
                        }}
                      ></eds-textfield>
                    `
                  : nothing}

                <div class="actions">
                  <eds-button
                    variant="accent"
                    ?disabled=${this._saving}
                    @click=${this._handleSave}
                  >
                    ${this._saving ? 'Saving...' : 'Save'}
                  </eds-button>
                </div>
              </div>
            `}
      </div>
    `;
  }

}

customElements.define('site-access', SiteAccess);
