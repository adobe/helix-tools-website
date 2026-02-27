import { CrudPage, html, nothing } from '../../crud-page.js';
import { fetchOrgApiKeys, createOrgApiKey, deleteOrgApiKey } from '../../../services/adminApi.js';
import { formatDate } from '../../../utils/formatDate.js';
import '../../../blocks/eds-alert/eds-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-picker/eds-picker.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { sharedSheet } from '../../../styles/page-sheets.js';
const crudSheet = await getSheet(new URL('../../../styles/crud.css', import.meta.url).pathname);

const API_KEY_ROLES = [
  { id: 'author', label: 'Author', description: 'Read/write content' },
  { id: 'publish', label: 'Publish', description: 'Preview, publish, and unpublish content' },
  { id: 'admin', label: 'Admin', description: 'Full access' },
];

export class OrgApiKeys extends CrudPage {
  static properties = {
    ...CrudPage.properties,
    _showCreateDialog: { state: true },
    _newKeyRole: { state: true },
    _newKeyDescription: { state: true },
  };

  constructor() {
    super();
    this._showCreateDialog = false;
    this._newKeyRole = 'admin';
    this._newKeyDescription = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, sharedSheet, crudSheet];
  }

  get _isSiteScoped() { return false; }
  get _resourceLabel() { return 'API keys'; }
  get _itemLabel() { return 'API key'; }
  get _pageTitle() { return 'Organization API Keys'; }
  get _emptyMessage() { return 'No API keys configured for this organization.'; }
  get _createButtonLabel() { return 'Create API Key'; }
  get _deleteHeadline() { return 'Delete Organization API Key'; }

  _renderPageSubtitle() {
    return html`API keys for programmatic access to the <strong>${this._resolvedOrg}</strong> organization. Keep these secure.`;
  }

  _renderDeleteMessage() {
    return html`<p>Are you sure you want to delete this API key? Any integrations using this key across all sites in the organization will stop working immediately.</p>`;
  }

  async _fetchItems() { return fetchOrgApiKeys(this._org); }
  async _createItem(body) { return createOrgApiKey(this._org, body); }
  async _deleteItem(id) { return deleteOrgApiKey(this._org, id); }

  _onCreateClick() {
    this._showCreateDialog = true;
  }

  async _handleCreate() {
    const body = { roles: [this._newKeyRole] };
    if (this._newKeyDescription.trim()) {
      body.description = this._newKeyDescription.trim();
    }
    await super._handleCreate(body);
    this._showCreateDialog = false;
    this._newKeyRole = 'admin';
    this._newKeyDescription = '';
  }

  get _newItemValue() {
    const k = this._newItem;
    if (!k) return '';
    return k.apiKey ?? k.value ?? k.key ?? JSON.stringify(k);
  }

  get _selectedRoleDesc() {
    return API_KEY_ROLES.find((r) => r.id === this._newKeyRole)?.description ?? '';
  }

  _renderNewItemBanner() {
    if (!this._newItem) return nothing;
    return html`
      <eds-alert variant="info" open>
        <span>New API key created. Copy it now — it won't be shown again.</span>
        <div class="new-item-row">
          <code class="item-value">${this._newItemValue}</code>
          <eds-button variant="secondary" size="s"
            @click=${() => this._copyToClipboard(this._newItemValue, 'new-item')}>
            <span slot="icon">${edsIcon('copy', { size: 16 })}</span>
            ${this._copiedId === 'new-item' ? 'Copied!' : 'Copy'}
          </eds-button>
        </div>
      </eds-alert>
    `;
  }

  _renderItem(key) {
    const keyId = key.id ?? key;
    const meta = [
      key.expires ? `Expires ${formatDate(key.expires)}` : 'No expiration',
      key.created ? `Created ${formatDate(key.created)}` : '',
    ].filter(Boolean).join(' · ');
    return html`
      <admin-card horizontal>
        <span slot="heading" class="tile-id">${keyId}</span>
        <span slot="subheading" class="tile-meta">${meta}</span>
        <eds-button quiet slot="actions" aria-label="Delete key"
          ?disabled=${this._deletingId === keyId}
          @click=${() => { this._confirmDelete = keyId; }}>
          <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
        </eds-button>
      </admin-card>
    `;
  }

  _renderExtraDialogs() {
    if (!this._showCreateDialog) return nothing;
    return html`
      <eds-dialog open headline="Create API Key" size="m"
        @close=${() => { this._showCreateDialog = false; }}>
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div>
            <label class="field-label" for="org-api-key-description">Description (optional)</label>
            <eds-textfield id="org-api-key-description"
              .value=${this._newKeyDescription}
              @input=${(e) => { this._newKeyDescription = (e.detail?.value ?? e.target?.value ?? ''); }}
            ></eds-textfield>
          </div>
          <div>
            <eds-picker id="org-api-key-role" .value=${this._newKeyRole} label="Role"
              .options=${API_KEY_ROLES.map((r) => ({ value: r.id, label: r.label }))}
              @change=${(e) => { this._newKeyRole = (e.detail?.value ?? e.target?.value ?? 'admin'); }}
            ></eds-picker>
            ${this._selectedRoleDesc ? html`<p class="role-desc">${this._selectedRoleDesc}</p>` : nothing}
          </div>
        </div>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline"
            @click=${() => { this._showCreateDialog = false; }}>Cancel</eds-button>
          <eds-button variant="accent" ?disabled=${this._creating}
            @click=${this._handleCreate}>
            ${this._creating ? 'Creating...' : 'Create'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

}

customElements.define('org-api-keys', OrgApiKeys);
