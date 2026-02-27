import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';

import { fetchHeaders, saveHeaders, deleteHeaders } from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/admin-card/admin-card.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-headers.css', import.meta.url).pathname);

/**
 * Normalize headers config.
 * API returns a flat object: { "/**": [{ key, value }], "/api/*": [{ key, value }] }
 */
function normalizeHeadersConfig(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([path, headers]) => ({
    path,
    headers: Array.isArray(headers)
      ? headers.map((h) => ({ key: h.key ?? '', value: h.value ?? '' }))
      : [],
  }));
}

function buildHeadersPayload(patterns) {
  const payload = {};
  patterns.forEach((p) => {
    const path = (p.path ?? '').trim();
    if (!path) return;
    const headers = (p.headers ?? [])
      .filter((h) => (h.key ?? '').trim())
      .map((h) => ({ key: (h.key ?? '').trim(), value: (h.value ?? '').trim() }));
    if (headers.length > 0) {
      payload[path] = headers;
    }
  });
  return payload;
}

export class SiteHeaders extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _patterns: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _showDialog: { state: true },
    _editingIndex: { state: true },
    _dialogPath: { state: true },
    _dialogHeaders: { state: true },
    _saving: { state: true },
    _dialogError: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._patterns = [];
    this._loading = true;
    this._error = '';
    this._showDialog = false;
    this._editingIndex = -1;
    this._dialogPath = '';
    this._dialogHeaders = [{ key: '', value: '' }];
    this._saving = false;
    this._dialogError = '';
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
    const { data, status, error } = await fetchHeaders(this._org, this._site);
    const err = getApiError(status, 'load headers', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }
    this._patterns = normalizeHeadersConfig(data);
    this._loading = false;
  }

  _handleRetry() {
    this._loadData();
  }

  _openAddDialog() {
    this._editingIndex = -1;
    this._dialogPath = '';
    this._dialogHeaders = [{ key: '', value: '' }];
    this._dialogError = '';
    this._showDialog = true;
  }

  _openEditDialog(index) {
    const p = this._patterns[index];
    if (!p) return;
    this._editingIndex = index;
    this._dialogPath = p.path ?? '';
    this._dialogHeaders = (p.headers ?? []).length
      ? p.headers.map((h) => ({ key: h.key ?? h.name ?? '', value: h.value ?? '' }))
      : [{ key: '', value: '' }];
    this._dialogError = '';
    this._showDialog = true;
  }

  _closeDialog() {
    this._showDialog = false;
    this._editingIndex = -1;
  }

  _addHeaderRow() {
    this._dialogHeaders = [...this._dialogHeaders, { key: '', value: '' }];
  }

  _removeHeaderRow(i) {
    const next = this._dialogHeaders.filter((_, idx) => idx !== i);
    this._dialogHeaders = next.length ? next : [{ key: '', value: '' }];
  }

  _updateHeaderRow(i, field, val) {
    const next = [...this._dialogHeaders];
    if (next[i]) next[i] = { ...next[i], [field]: val };
    this._dialogHeaders = next;
  }

  async _handleSavePattern() {
    const path = (this._dialogPath ?? '').trim();
    const headers = this._dialogHeaders
      .filter((h) => (h.key ?? '').trim())
      .map((h) => ({ key: (h.key ?? '').trim(), value: (h.value ?? '').trim() }));

    if (!path) {
      this._dialogError = 'Path pattern is required.';
      return;
    }
    if (headers.length === 0) {
      this._dialogError = 'At least one header is required.';
      return;
    }

    this._saving = true;
    this._dialogError = '';
    let patterns = [...this._patterns];
    if (this._editingIndex >= 0) {
      patterns[this._editingIndex] = { path, headers };
    } else {
      patterns = [...patterns, { path, headers }];
    }

    const payload = buildHeadersPayload(patterns);
    const { status, error } = await saveHeaders(this._org, this._site, payload);
    const err = getApiError(status, 'save headers', error);
    if (err) {
      this._dialogError = err;
      this._saving = false;
      return;
    }
    toast.positive('Headers saved.');
    this._closeDialog();
    this._loadData();
    this._saving = false;
  }

  async _handleDeletePattern(index) {
    const next = this._patterns.filter((_, i) => i !== index);
    this._saving = true;
    if (next.length === 0) {
      const { status, error } = await deleteHeaders(this._org, this._site);
      const err = getApiError(status, 'delete headers', error);
      if (err) {
        toast.negative(err);
      } else {
        toast.positive('Headers deleted.');
        this._patterns = [];
      }
    } else {
      const payload = buildHeadersPayload(next);
      const { status, error } = await saveHeaders(this._org, this._site, payload);
      const err = getApiError(status, 'save headers', error);
      if (err) {
        toast.negative(err);
      } else {
        toast.positive('Pattern removed.');
        this._patterns = next;
      }
    }
    this._saving = false;
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Custom HTTP Headers</h1>
            <p class="page-subtitle">
              Path-pattern based custom headers for <strong>${this._org}/${this._site}</strong>. Each pattern defines headers applied to matching paths.
            </p>
          </div>
          <eds-button variant="accent" @click=${this._openAddDialog}>
            <span slot="icon">${edsIcon('add', { size: 16 })}</span>
            Add Pattern
          </eds-button>
        </div>

        <error-alert .error=${this._error} @retry=${this._handleRetry}></error-alert>

        ${this._loading
          ? html`<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`
          : nothing}

        ${!this._loading && !this._error
          ? this._patterns.length === 0
            ? html`
                <p class="empty">No header patterns defined. Add a pattern to get started.</p>
              `
            : html`
                <div class="card-grid">
                  ${this._patterns.map((p, idx) => html`
                    <admin-card heading=${p.path || '/'}>
                      <div class="headers-list">
                        ${(p.headers ?? []).map((h) => html`
                          <code>${h.key ?? h.name}: ${h.value ?? ''}</code>
                        `)}
                      </div>
                      <div slot="actions" class="card-actions">
                        <eds-button variant="secondary" size="m" @click=${() => this._openEditDialog(idx)}>Edit</eds-button>
                        <eds-button
                          quiet
                          aria-label="Delete pattern"
                          @click=${() => this._handleDeletePattern(idx)}
                          ?disabled=${this._saving}
                        >
                          <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
                        </eds-button>
                      </div>
                    </admin-card>
                  `)}
                </div>
              `
          : nothing}
      </div>

      ${this._showDialog ? this._renderDialog() : nothing}
    `;
  }

  _renderDialog() {
    return html`
      <eds-dialog
        open
        headline="${this._editingIndex >= 0 ? 'Edit' : 'Add'} Header Pattern"
        size="l"
        @close=${this._closeDialog}
      >
        <label class="field-label" for="dialog-path-pattern">Path pattern</label>
        <eds-textfield
          id="dialog-path-pattern"
          placeholder="/api/* or /docs/**"
          .value=${this._dialogPath}
          @keydown=${(e) => e.stopPropagation()}
          @input=${(e) => { this._dialogPath = e.target.value ?? e.detail?.value ?? ''; this._dialogError = ''; }}
        ></eds-textfield>

        <p class="headers-label">Headers</p>
        ${this._dialogHeaders.map((h, i) => html`
          <div class="header-row">
            <eds-textfield
              placeholder="Header name"
              .value=${h.key}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => this._updateHeaderRow(i, 'key', e.target.value ?? e.detail?.value ?? '')}
            ></eds-textfield>
            <eds-textfield
              placeholder="Value"
              .value=${h.value}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => this._updateHeaderRow(i, 'value', e.target.value ?? e.detail?.value ?? '')}
            ></eds-textfield>
            <eds-button
              quiet
              aria-label="Remove header"
              @click=${() => this._removeHeaderRow(i)}
            >
              <span slot="icon">${edsIcon('close', { size: 16 })}</span>
            </eds-button>
          </div>
        `)}
        <eds-button variant="secondary" size="s" @click=${this._addHeaderRow}>
          <span slot="icon">${edsIcon('add', { size: 16 })}</span>
          Add header
        </eds-button>

        ${this._dialogError ? html`<p class="dialog-error">${this._dialogError}</p>` : nothing}

        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${this._closeDialog}>Cancel</eds-button>
          <eds-button
            variant="accent"
            ?disabled=${this._saving}
            @click=${this._handleSavePattern}
          >
            ${this._saving ? 'Saving...' : 'Save'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

}

customElements.define('site-headers', SiteHeaders);
