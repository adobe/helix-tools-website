import { CrudPage, html, nothing } from '../../crud-page.js';
import { fetchSecrets, createSecret, deleteSecret } from '../../../services/adminApi.js';
import { formatDate } from '../../../utils/formatDate.js';
import { edsIcon } from '../../../utils/icons.js';
import '../../../blocks/eds-alert/eds-alert.js';

import getSheet from '../../../utils/sheet.js';
const crudSheet = await getSheet(new URL('../../../styles/crud.css', import.meta.url).pathname);

export class SiteSecrets extends CrudPage {
  get _resourceLabel() { return 'secrets'; }
  get _itemLabel() { return 'Secret'; }
  get _pageTitle() { return 'Site Secrets'; }
  get _emptyMessage() { return 'No secrets configured for this site.'; }
  get _createButtonLabel() { return 'Create Secret'; }
  get _deleteHeadline() { return 'Delete Secret'; }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, crudSheet];
  }

  _renderPageSubtitle() {
    return html`Manage secrets for ${this._org} / ${this._site}. Used for authentication and integrations.`;
  }

  _renderDeleteMessage() {
    return html`<p>Are you sure you want to delete this secret? Integrations using it will stop working.</p>`;
  }

  async _fetchItems() { return fetchSecrets(this._org, this._site); }
  async _createItem() { return createSecret(this._org, this._site); }
  async _deleteItem(id) { return deleteSecret(this._org, this._site, id); }

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

customElements.define('site-secrets', SiteSecrets);
