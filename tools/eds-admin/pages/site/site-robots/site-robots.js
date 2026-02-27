import { LitElement, html } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { fetchRobots, saveRobots } from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-textfield/eds-textfield.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-robots.css', import.meta.url).pathname);

const DEFAULT_ROBOTS = `User-agent: *
Allow: /
`;

export class SiteRobots extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _content: { state: true },
    _loading: { state: true },
    _saving: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._content = '';
    this._loading = true;
    this._saving = false;
    this._error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) {
      this._loadData();
    }
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') || changedProperties.has('_site')) {
      if (this._org && this._site) this._loadData();
    }
  }

  async _loadData() {
    if (!this._org || !this._site) return;
    this._loading = true;
    this._error = '';
    const { data, status, error } = await fetchRobots(this._org, this._site);
    const err = getApiError(status, 'load robots.txt', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }
    this._content = (data ?? '').trim() || DEFAULT_ROBOTS;
    this._loading = false;
  }

  _handleRetry() {
    this._loadData();
  }

  async _handleSave() {
    if (!this._org || !this._site) return;
    this._saving = true;
    this._error = '';
    const content = (this._content ?? '').trim() || DEFAULT_ROBOTS;
    const { status, error } = await saveRobots(this._org, this._site, content);
    const err = getApiError(status, 'save robots.txt', error);
    if (err) {
      this._error = err;
    } else {
      toast.positive('robots.txt saved.');
      this._content = content;
    }
    this._saving = false;
  }

  render() {
    return html`
      <div class="page">
        <div>
          <h1 class="page-title">robots.txt</h1>
          <p class="page-subtitle">
            Edit robots.txt for <strong>${this._org}/${this._site}</strong>. Search engine crawlers use this file to determine what to index.
          </p>
        </div>

        <error-alert .error=${this._error} @retry=${this._handleRetry}></error-alert>

        ${this._loading
          ? html`<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`
          : html`
              <div class="editor-section">
                <label class="field-label" for="robots-content">robots.txt</label>
                <eds-textfield
                  id="robots-content"
                  multiline
                  rows="16"
                  .value=${this._content}
                  @input=${(e) => { this._content = e.target.value ?? ''; }}
                  placeholder="${DEFAULT_ROBOTS}"
                ></eds-textfield>
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

customElements.define('site-robots', SiteRobots);
