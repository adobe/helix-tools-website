import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchSiteConfig,
  fetchAggregatedConfig,
  saveCdnConfig,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import '../../../blocks/cdn-health-check/cdn-health-check.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-cdn.css', import.meta.url).pathname);

const CDN_ICON_BASE = new URL('../../../assets/cdn-icons/', import.meta.url).pathname;

const CDN_PROVIDERS = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    description: 'Configure Cloudflare Workers to deliver content.',
    docsUrl: 'https://www.aem.live/docs/byo-cdn-cloudflare-worker-setup',
    color: '#f48120',
    icon: `${CDN_ICON_BASE}cloudflare.svg`,
  },
  {
    id: 'akamai',
    label: 'Akamai',
    description: 'Use Akamai Property Manager for content delivery.',
    docsUrl: 'https://www.aem.live/docs/byo-cdn-akamai-setup',
    color: '#009bdb',
    icon: `${CDN_ICON_BASE}akamai.svg`,
  },
  {
    id: 'fastly',
    label: 'Fastly',
    description: 'Configure Fastly to deliver your AEM content.',
    docsUrl: 'https://www.aem.live/docs/byo-cdn-fastly-setup',
    color: '#ff282d',
    icon: `${CDN_ICON_BASE}fastly.svg`,
  },
  {
    id: 'cloudfront',
    label: 'CloudFront',
    description: 'Set up Amazon CloudFront with push invalidation.',
    docsUrl: 'https://www.aem.live/docs/byo-cdn-cloudfront-setup',
    color: '#232f3e',
    icon: `${CDN_ICON_BASE}cloudfront.svg`,
  },
  {
    id: 'managed',
    label: 'Adobe-managed CDN',
    description: 'Use the CDN included in your AEM Sites license.',
    docsUrl: 'https://www.aem.live/docs/byo-cdn-adobe-managed',
    color: '#eb1000',
    icon: `${CDN_ICON_BASE}adobe.svg`,
  },
];

const CDN_FIELDS = {
  managed: [
    {
      name: 'environmentId', label: 'Environment ID (optional)', placeholder: 'e.g. p12345-e67890', type: 'text', required: false,
    },
  ],
  fastly: [
    {
      name: 'serviceId', label: 'Service ID', placeholder: 'e.g. SU1Z0isxPaozGVKXdv0eY', type: 'text', required: true,
    },
    {
      name: 'authToken', label: 'Auth Token', placeholder: 'Your Fastly API token', type: 'password', required: true,
    },
  ],
  cloudflare: [
    {
      name: 'plan', label: 'Plan', placeholder: 'e.g. free, pro, business, enterprise', type: 'text', required: true,
    },
    {
      name: 'zoneId', label: 'Zone ID', placeholder: 'e.g. 023e105f4ecef8ad9ca31a8372d0c353', type: 'text', required: true,
    },
    {
      name: 'apiToken', label: 'API Token', placeholder: 'Your Cloudflare API token', type: 'password', required: true,
    },
  ],
  akamai: [
    {
      name: 'endpoint', label: 'Endpoint', placeholder: 'e.g. akab-xxxxxxxx.purge.akamaiapis.net', type: 'text', required: true,
    },
    {
      name: 'clientSecret', label: 'Client Secret', placeholder: 'Akamai client secret', type: 'password', required: true,
    },
    {
      name: 'clientToken', label: 'Client Token', placeholder: 'Akamai client token', type: 'password', required: true,
    },
    {
      name: 'accessToken', label: 'Access Token', placeholder: 'Akamai access token', type: 'password', required: true,
    },
  ],
  cloudfront: [
    {
      name: 'distributionId', label: 'Distribution ID', placeholder: 'e.g. EDFDVBD6EXAMPLE', type: 'text', required: true,
    },
    {
      name: 'accessKeyId', label: 'Access Key ID', placeholder: 'AWS access key ID', type: 'text', required: true,
    },
    {
      name: 'secretAccessKey', label: 'Secret Access Key', placeholder: 'AWS secret access key', type: 'password', required: true,
    },
  ],
};

const PURGE_SERVICE_URL = 'https://helix-pages.anywhere.run/helix-services/byocdn-push-invalidation/v1';

export class SiteCdn extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _siteConfig: { state: true },
    _aggConfig: { state: true },
    _loading: { state: true },
    _saving: { state: true },
    _validating: { state: true },
    _validationResult: { state: true },
    _error: { state: true },
    _activeTab: { state: true },
    _selectedType: { state: true },
    _fieldValues: { state: true },
    _inheritedFields: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._siteConfig = null;
    this._aggConfig = null;
    this._loading = true;
    this._saving = false;
    this._validating = false;
    this._validationResult = null;
    this._error = null;
    this._activeTab = 'setup';
    this._selectedType = '';
    this._fieldValues = {};
    this._inheritedFields = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) this._load();
  }

  _setTab(tab) {
    this._activeTab = tab;
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if ((changedProperties.has('_org') || changedProperties.has('_site')) && this._org && this._site) {
      this._load();
    }
  }

  async _load() {
    if (!this._org || !this._site) return;

    this._loading = true;
    this._error = null;

    const [siteResult, aggResult] = await Promise.all([
      fetchSiteConfig(this._org, this._site),
      fetchAggregatedConfig(this._org, this._site),
    ]);

    const siteErr = getApiError(siteResult.status, 'load site config', siteResult.error);
    if (siteErr) {
      this._error = siteErr;
      this._loading = false;
      return;
    }

    this._siteConfig = siteResult.data || {};
    this._aggConfig = aggResult.data || {};

    const siteCdn = this._siteConfig.cdn?.prod || {};
    const aggCdn = this._aggConfig.cdn?.prod || {};

    this._selectedType = siteCdn.type || aggCdn.type || '';
    this._fieldValues = {};
    this._inheritedFields = {};

    if (this._selectedType && CDN_FIELDS[this._selectedType]) {
      CDN_FIELDS[this._selectedType].forEach((f) => {
        const siteVal = siteCdn[f.name];
        const aggVal = aggCdn[f.name];
        this._fieldValues[f.name] = siteVal || aggVal || '';
        if (aggVal && !siteVal) {
          this._inheritedFields[f.name] = true;
        }
      });
    }

    this._fieldValues.host = siteCdn.host || aggCdn.host || '';

    if (aggCdn.type && !siteCdn.type) {
      this._inheritedFields._type = true;
    }

    this._loading = false;
  }

  _handleFieldInput(fieldName, value) {
    this._fieldValues = { ...this._fieldValues, [fieldName]: value };
  }

  _buildCdnConfig() {
    const cdnConfig = {};
    const type = this._selectedType;

    if (type) {
      cdnConfig.type = type;
      if (CDN_FIELDS[type]) {
        CDN_FIELDS[type].forEach((f) => {
          const val = this._fieldValues[f.name]?.trim();
          if (!val) return;
          cdnConfig[f.name] = val;
        });
      }
    }

    if (this._fieldValues.host?.trim()) {
      cdnConfig.host = this._fieldValues.host.trim();
    }

    return cdnConfig;
  }

  async _handleSave() {
    if (!this._org || !this._site) return;

    this._saving = true;
    this._validationResult = null;

    const cdnConfig = this._buildCdnConfig();
    const { status, error } = await saveCdnConfig(this._org, this._site, cdnConfig);
    this._saving = false;

    const err = getApiError(status, 'save CDN config', error);
    if (err) {
      toast.negative(err);
      return;
    }

    toast.positive('CDN configuration saved.');
    await this._load();
  }

  _parsePurgeResult(purgeResult) {
    if (!purgeResult) return { state: 'fail', message: 'No response', detail: null };

    const isSuccess = ['ok', 'succeeded', 200].includes(purgeResult.status);
    if (isSuccess) {
      return { state: 'pass', message: purgeResult.status || 'ok', detail: null };
    }

    const msg = typeof purgeResult.status === 'string'
      ? purgeResult.status
      : `HTTP ${purgeResult.status}`;

    // "not supported" is informational, not a failure
    const isInfo = typeof msg === 'string' && msg.toLowerCase().includes('not supported');

    let detail = null;
    if (purgeResult.body) {
      try {
        detail = typeof purgeResult.body === 'string'
          ? purgeResult.body
          : JSON.stringify(purgeResult.body, null, 2);
      } catch { /* ignore */ }
    }
    if (purgeResult.error) detail = purgeResult.error;

    return { state: isInfo ? 'info' : 'fail', message: msg, detail };
  }

  async _handleValidate() {
    if (!this._org || !this._site || !this._selectedType) return;

    this._validating = true;
    this._validationResult = null;

    try {
      const cdnConfig = this._buildCdnConfig();
      if (!cdnConfig.type || !cdnConfig.host) {
        this._validationResult = {
          error: 'CDN type and production host are required.',
        };
        this._validating = false;
        return;
      }

      const fd = new URLSearchParams();
      fd.append('type', cdnConfig.type);
      fd.append('host', cdnConfig.host);
      const creds = {
        fastly: ['serviceId', 'authToken'],
        cloudflare: ['zoneId', 'apiToken'],
        akamai: ['endpoint', 'clientSecret', 'clientToken', 'accessToken'],
        cloudfront: ['distributionId', 'accessKeyId', 'secretAccessKey'],
      };
      (creds[cdnConfig.type] || []).forEach((k) => {
        if (cdnConfig[k]) fd.append(k, cdnConfig[k]);
      });

      const resp = await fetch(PURGE_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd.toString(),
      });

      let result;
      try {
        result = await resp.json();
      } catch {
        this._validationResult = { error: `Purge service returned non-JSON response (HTTP ${resp.status}).` };
        this._validating = false;
        return;
      }
      this._validationResult = {
        urlPurge: result.urlPurge ? this._parsePurgeResult(result.urlPurge) : null,
        keyPurge: result.keyPurge ? this._parsePurgeResult(result.keyPurge) : null,
      };
    } catch (e) {
      this._validationResult = { error: `Validation error: ${e.message}` };
    }

    this._validating = false;
  }

  render() {
    const liveUrl = `https://main--${this._site}--${this._org}.aem.live/`;
    const fields = this._selectedType && CDN_FIELDS[this._selectedType]
      ? CDN_FIELDS[this._selectedType]
      : [];
    const isTypeInherited = !!this._inheritedFields._type;

    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">CDN Configuration</h1>
            <p class="page-subtitle">Configure, validate and monitor the CDN setup for your site.</p>
          </div>
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        <div class="eds-tabs">
          <button class="eds-tab ${this._activeTab === 'setup' ? 'selected' : ''}" @click=${() => this._setTab('setup')}>Setup</button>
          <button class="eds-tab ${this._activeTab === 'health' ? 'selected' : ''}" @click=${() => this._setTab('health')}>Health Check</button>
        </div>

        ${this._activeTab === 'setup' ? html`
          ${this._loading
            ? html`
                <div class="loading">
                  <div class="spinner" aria-label="Loading"></div>
                </div>
              `
            : html`
                <div class="setup-section">
                  <div class="setup-intro">
                    <p>Configure push invalidation for your production domain.
                      See the <a href="https://www.aem.live/docs/byo-cdn-setup" target="_blank" rel="noopener noreferrer">BYO CDN Setup guide</a> for general requirements.</p>
                  </div>

                  <div class="form-fields">
                    <div class="form-field">
                      <label class="field-label" for="cdn-host">Production Host</label>
                      <eds-textfield
                        id="cdn-host"
                        placeholder="www.example.com"
                        .value=${this._fieldValues.host || ''}
                        @input=${(e) => this._handleFieldInput('host', e.detail?.value ?? '')}
                      >
                        <span slot="help-text" class="help-text">Host name of production site, e.g. <code>www.yourdomain.com</code></span>
                      </eds-textfield>
                    </div>
                  </div>

                  <h3 class="section-heading">CDN Type</h3>
                  <div class="provider-cards">
                    ${CDN_PROVIDERS.map((p) => html`
                      <button
                        class="provider-card ${this._selectedType === p.id ? 'selected' : ''}"
                        ?disabled=${isTypeInherited && this._selectedType !== p.id}
                        @click=${() => {
                          if (isTypeInherited) return;
                          this._selectedType = p.id;
                          this._fieldValues = { host: this._fieldValues.host || '' };
                          this._inheritedFields = {};
                          this._validationResult = null;
                        }}
                      >
                        <img class="provider-logo" src="${p.icon}" alt="${p.label} logo" />
                        <span class="provider-name">${p.label}</span>
                      </button>
                    `)}
                  </div>

                  ${this._selectedType && CDN_PROVIDERS.find((p) => p.id === this._selectedType)?.docsUrl
                    ? html`
                        <p class="docs-link">
                          <a href="${CDN_PROVIDERS.find((p) => p.id === this._selectedType).docsUrl}" target="_blank" rel="noopener noreferrer">
                            Setup Docs
                          </a>
                        </p>
                      `
                    : nothing}

                  ${isTypeInherited
                    ? html`<span class="help-text">CDN type is inherited from the organization and cannot be changed here.</span>`
                    : nothing}

                  ${this._selectedType ? html`
                    ${fields.length > 0 ? html`
                      <div class="form-fields">
                        ${fields.map((f) => html`
                          <div class="form-field">
                            <label class="field-label" for="cdn-${f.name}">${f.label}</label>
                            <eds-textfield
                              id="cdn-${f.name}"
                              placeholder="${f.placeholder || ''}"
                              type="${f.type === 'password' ? 'password' : 'text'}"
                              .value=${this._fieldValues[f.name] || ''}
                              ?disabled=${!!this._inheritedFields[f.name]}
                              @input=${(e) => this._handleFieldInput(f.name, e.detail?.value ?? '')}
                            ></eds-textfield>
                            ${this._inheritedFields[f.name]
                              ? html`<span class="help-text">Inherited from organization config.</span>`
                              : nothing}
                          </div>
                        `)}
                      </div>
                    ` : nothing}

                    <div class="actions">
                      ${this._selectedType !== 'managed' ? html`
                        <eds-button
                          variant="secondary"
                          ?disabled=${this._validating || !this._selectedType}
                          @click=${this._handleValidate}
                        >
                          ${this._validating ? html`<span slot="icon"><span class="spinner s"></span></span> Validating...` : 'Validate'}
                        </eds-button>
                      ` : nothing}
                      <eds-button
                        variant="accent"
                        ?disabled=${this._saving}
                        @click=${this._handleSave}
                      >
                        ${this._saving ? 'Saving...' : 'Save'}
                      </eds-button>
                    </div>

                    ${this._validationResult ? html`
                      <div class="validation-results">
                        <h3 class="validation-heading">Validation Results</h3>

                        ${this._validationResult.error ? html`
                          <div class="validation-item">
                            <span class="validation-item-icon fail">${edsIcon('close', { size: 14 })}</span>
                            <div class="validation-item-body">
                              <span class="validation-item-message fail">${this._validationResult.error}</span>
                            </div>
                          </div>
                        ` : html`
                          ${this._validationResult.urlPurge ? html`
                            <div class="validation-item">
                              ${this._validationResult.urlPurge.state === 'fail'
                                ? html`<span class="validation-item-icon fail">${edsIcon('close', { size: 14 })}</span>`
                                : html`<span class="validation-item-icon pass">${edsIcon('checkmark', { size: 14 })}</span>`}
                              <div class="validation-item-body">
                                <strong class="validation-item-title">URL Purge</strong>
                                <span class="validation-item-message ${this._validationResult.urlPurge.state === 'fail' ? 'fail' : 'pass'}">
                                  ${this._validationResult.urlPurge.state === 'pass'
                                    ? 'Working'
                                    : this._validationResult.urlPurge.message}
                                </span>
                                ${this._validationResult.urlPurge.detail ? html`
                                  <details class="validation-item-details">
                                    <summary>Show details</summary>
                                    <pre>${this._validationResult.urlPurge.detail}</pre>
                                  </details>
                                ` : nothing}
                              </div>
                            </div>
                          ` : nothing}

                          ${this._validationResult.keyPurge ? html`
                            <div class="validation-item">
                              ${this._validationResult.keyPurge.state === 'fail'
                                ? html`<span class="validation-item-icon fail">${edsIcon('close', { size: 14 })}</span>`
                                : html`<span class="validation-item-icon pass">${edsIcon('checkmark', { size: 14 })}</span>`}
                              <div class="validation-item-body">
                                <strong class="validation-item-title">Key Purge</strong>
                                <span class="validation-item-message ${this._validationResult.keyPurge.state === 'fail' ? 'fail' : 'pass'}">
                                  ${this._validationResult.keyPurge.state === 'pass'
                                    ? 'Working'
                                    : this._validationResult.keyPurge.message}
                                </span>
                                ${this._validationResult.keyPurge.detail ? html`
                                  <details class="validation-item-details">
                                    <summary>Show details</summary>
                                    <pre>${this._validationResult.keyPurge.detail}</pre>
                                  </details>
                                ` : nothing}
                              </div>
                            </div>
                          ` : nothing}
                        `}
                      </div>
                    ` : nothing}
                  ` : nothing}
                </div>
              `}
        ` : html`
          <div class="health-tab">
            <cdn-health-check
              .org=${this._org}
              .site=${this._site}
            ></cdn-health-check>
          </div>
        `}
      </div>
    `;
  }

}

customElements.define('site-cdn', SiteCdn);
