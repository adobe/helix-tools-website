import { CrudPage, html, nothing } from '../../crud-page.js';
import { fetchOrgSecrets, createOrgSecret, deleteOrgSecret } from '../../../services/adminApi.js';
import { formatDate } from '../../../utils/formatDate.js';
import { edsIcon } from '../../../utils/icons.js';
import '../../../blocks/eds-alert/eds-alert.js';

import getSheet from '../../../utils/sheet.js';
const crudSheet = await getSheet(new URL('../../../styles/crud.css', import.meta.url).pathname);

export class OrgSecrets extends CrudPage {
  get _isSiteScoped() { return false; }
  get _resourceLabel() { return 'secrets'; }
  get _itemLabel() { return 'Secret'; }
  get _pageTitle() { return 'Organization Secrets'; }
  get _emptyMessage() { return 'No secrets configured for this organization.'; }
  get _createButtonLabel() { return 'Create Secret'; }
  get _deleteHeadline() { return 'Delete Organization Secret'; }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, crudSheet];
  }

  _renderPageSubtitle() {
    return html`Shared secrets for the <strong>${this._resolvedOrg}</strong> organization. These are available to all sites in the org.`;
  }

  _renderDeleteMessage() {
    return html`<p>Are you sure you want to delete this secret? All sites in the organization that rely on it will be affected.</p>`;
  }

  async _fetchItems() { return fetchOrgSecrets(this._org); }
  async _createItem() { return createOrgSecret(this._org); }
  async _deleteItem(id) { return deleteOrgSecret(this._org, id); }

  get _newItemValue() {
    const s = this._newItem;
    if (!s) return '';
    return s.value ?? s.secret ?? JSON.stringify(s);
  }

  _renderNewItemBanner() {
    if (!this._newItem) return nothing;
    return html`
      <eds-alert variant="info" open>
        <span>New secret created. Copy it now — it won't be shown again.</span>
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

  _renderItem(secret) {
    const id = secret.id ?? secret;
    return html`
      <admin-card horizontal>
        <span slot="heading" class="tile-id">${id}</span>
        ${secret.created ? html`<span slot="subheading" class="tile-meta">Created ${formatDate(secret.created)}</span>` : nothing}
        <eds-button quiet slot="actions" aria-label="Delete secret"
          ?disabled=${this._deletingId === id}
          @click=${() => { this._confirmDelete = id; }}>
          <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
        </eds-button>
      </admin-card>
    `;
  }

}

customElements.define('org-secrets', OrgSecrets);
