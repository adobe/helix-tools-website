import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../utils/router.js';
import { getApiError } from '../utils/apiErrors.js';
import { toast } from '../controllers/toast-controller.js';
import { edsIcon } from '../utils/icons.js';
import '../blocks/error-alert/error-alert.js';
import '../blocks/admin-card/admin-card.js';
import '../blocks/eds-button/eds-button.js';
import '../blocks/eds-dialog/eds-dialog.js';

import getSheet from '../utils/sheet.js';
import { pageSheet } from '../styles/page-sheets.js';
const crudSheet = await getSheet(new URL('../styles/crud-shared.css', import.meta.url).pathname);
export { html, nothing };

/**
 * Base class for CRUD list pages (secrets, API keys, etc.).
 */
export class CrudPage extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _items: { state: true },
    _loading: { state: true },
    _creating: { state: true },
    _newItem: { state: true },
    _deletingId: { state: true },
    _confirmDelete: { state: true },
    _copiedId: { state: true },
    _error: { state: true },
  };

  get _isSiteScoped() { return true; }
  get _resourceLabel() { return 'items'; }
  get _itemLabel() { return 'Item'; }
  get _pageTitle() { return ''; }
  get _emptyMessage() { return 'No items found.'; }
  get _createButtonLabel() { return 'Create'; }
  get _deleteHeadline() { return 'Confirm Delete'; }

  _renderPageSubtitle() { return nothing; }
  _renderDeleteMessage() { return html`<p>Are you sure you want to delete this item?</p>`; }
  _renderItem(_item) { return nothing; }
  _renderNewItemBanner() { return nothing; }
  _renderExtraDialogs() { return nothing; }

  async _fetchItems() { throw new Error('Override _fetchItems'); }
  async _createItem(_body) { throw new Error('Override _createItem'); }
  async _deleteItem(_id) { throw new Error('Override _deleteItem'); }

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._items = [];
    this._loading = true;
    this._creating = false;
    this._newItem = null;
    this._deletingId = null;
    this._confirmDelete = null;
    this._copiedId = null;
    this._error = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, crudSheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    if (this._isSiteScoped) this._site = details.site || '';
    if (this._isReady) this._load();
  }

  updated(changed) {
    super.updated?.(changed);
    if (changed.has('_org') || changed.has('_site')) {
      if (this._isReady) this._load();
    }
  }

  get _isReady() {
    return this._isSiteScoped ? !!(this._org && this._site) : !!this._org;
  }

  async _load() {
    if (!this._isReady) return;
    this._loading = true;
    this._error = null;
    const { data, status, error } = await this._fetchItems();
    const err = getApiError(status, `load ${this._resourceLabel}`, error);
    if (err) {
      this._error = err;
    } else {
      this._items = data ?? [];
    }
    this._loading = false;
  }

  _onCreateClick() {
    this._handleCreate();
  }

  async _handleCreate(body) {
    if (!this._isReady) return;
    this._creating = true;
    const { data, status, error } = await this._createItem(body);
    const err = getApiError(status, `create ${this._itemLabel.toLowerCase()}`, error);
    if (err) {
      toast.negative(err);
    } else if (data) {
      this._newItem = data;
      toast.positive(`${this._itemLabel} created.`);
      await this._load();
    }
    this._creating = false;
  }

  async _handleDelete(id) {
    this._deletingId = id;
    const { status, error } = await this._deleteItem(id);
    const err = getApiError(status, `delete ${this._itemLabel.toLowerCase()}`, error);
    if (err) {
      toast.negative(err);
    } else {
      toast.positive(`${this._itemLabel} deleted.`);
    }
    this._confirmDelete = null;
    this._deletingId = null;
    await this._load();
  }

  _copyToClipboard(text, id) {
    navigator.clipboard.writeText(text);
    this._copiedId = id;
    setTimeout(() => { this._copiedId = null; }, 2000);
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">${this._pageTitle}</h1>
            <p class="page-subtitle">${this._renderPageSubtitle()}</p>
          </div>
          ${!this._loading && !this._error ? html`
            <eds-button variant="accent" ?disabled=${this._creating}
              @click=${this._onCreateClick}>
              <span slot="icon">${edsIcon('add', { size: 16 })}</span>
              ${this._createButtonLabel}
            </eds-button>
          ` : nothing}
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        ${this._renderNewItemBanner()}

        ${this._loading ? html`
          <div class="card-stack">
            ${[1, 2, 3].map(() => html`<admin-card loading horizontal></admin-card>`)}
          </div>
        ` : nothing}

        ${!this._loading && !this._error && this._items.length === 0
          ? html`<p class="empty">${this._emptyMessage}</p>`
          : nothing}

        ${!this._loading && !this._error && this._items.length > 0 ? html`
          <div class="card-stack">
            ${this._items.map((item) => this._renderItem(item))}
          </div>
        ` : nothing}
      </div>

      ${this._confirmDelete ? html`
        <eds-dialog open headline="${this._deleteHeadline}" size="s"
          @close=${() => { this._confirmDelete = null; }}>
          ${this._renderDeleteMessage()}
          <div class="dialog-buttons">
            <eds-button variant="secondary" treatment="outline"
              @click=${() => { this._confirmDelete = null; }}>Cancel</eds-button>
            <eds-button variant="negative" ?disabled=${!!this._deletingId}
              @click=${() => this._handleDelete(this._confirmDelete)}>
              ${this._deletingId ? 'Deleting...' : 'Delete'}
            </eds-button>
          </div>
        </eds-dialog>
      ` : nothing}

      ${this._renderExtraDialogs()}
    `;
  }
}
