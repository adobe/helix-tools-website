import { LitElement, html, nothing } from 'lit';
import {
  fetchSnapshots,
  fetchSnapshot,
  saveSnapshotManifest,
  deleteSnapshot,
  addSnapshotPaths,
  removeSnapshotPath,
  removeAllSnapshotPaths,
  reviewSnapshot,
  publishSnapshot,
  publishSnapshotResource,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/admin-card/admin-card.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import { edsIcon } from '../../../utils/icons.js';
import { getRouteDetails } from '../../../utils/router.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-snapshots.css', import.meta.url).pathname);

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(dateStr); }
}

export class SiteSnapshots extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _snapshotNames: { state: true },
    _manifests: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _showCreate: { state: true },
    _createName: { state: true },
    _creating: { state: true },
    _addPathsId: { state: true },
    _addPathsText: { state: true },
    _addingPaths: { state: true },
    _confirmDelete: { state: true },
    _deletingId: { state: true },
    _editTitle: { state: true },
    _editDescription: { state: true },
    _actionPending: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._snapshotNames = [];
    this._manifests = {};
    this._loading = true;
    this._error = '';
    this._showCreate = false;
    this._createName = '';
    this._creating = false;
    this._addPathsId = '';
    this._addPathsText = '';
    this._addingPaths = false;
    this._confirmDelete = null;
    this._deletingId = null;
    this._editTitle = {};
    this._editDescription = {};
    this._actionPending = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) this._load();
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
    this._error = '';
    const { data, status, error } = await fetchSnapshots(this._org, this._site);
    const err = getApiError(status, 'load snapshots', error);
    if (err) { this._error = err; this._loading = false; return; }
    this._snapshotNames = Array.isArray(data?.snapshots) ? data.snapshots : [];
    this._loading = false;
  }

  async _loadManifest(name) {
    const { data, status } = await fetchSnapshot(this._org, this._site, name);
    if (status === 200 && data?.manifest) {
      this._manifests = { ...this._manifests, [name]: data.manifest };
      this._editTitle = { ...this._editTitle, [name]: data.manifest.title || '' };
      this._editDescription = { ...this._editDescription, [name]: data.manifest.description || '' };
    }
  }

  _handleAccordionToggle(e) {
    const details = e.target;
    if (!details.open || details.tagName !== 'DETAILS') return;
    const name = details.dataset.snapshot;
    if (name && !this._manifests[name]) {
      this._loadManifest(name);
    }
  }

  _getResources(name) {
    const m = this._manifests[name];
    return Array.isArray(m?.resources) ? m.resources : [];
  }

  _isLocked(name) {
    return !!this._manifests[name]?.locked;
  }

  _setPending(key, val) {
    this._actionPending = { ...this._actionPending, [key]: val };
  }

  async _handleCreate() {
    const name = (this._createName || '').trim();
    if (!name) { toast.negative('Enter a snapshot name.'); return; }
    this._creating = true;
    this._error = '';
    const { status, error } = await saveSnapshotManifest(
      this._org, this._site, name, { title: name },
    );
    const err = getApiError(status, 'create snapshot', error);
    if (err) { this._error = err; } else {
      toast.positive('Snapshot created.');
      this._showCreate = false;
      this._createName = '';
      await this._load();
    }
    this._creating = false;
  }

  async _handleSaveManifest(name) {
    const m = this._manifests[name];
    if (!m) return;
    this._setPending(`save-${name}`, true);
    const body = {
      title: this._editTitle[name] ?? m.title ?? '',
      description: this._editDescription[name] ?? m.description ?? '',
      metadata: m.metadata || {},
    };
    const { status, error } = await saveSnapshotManifest(this._org, this._site, name, body);
    this._setPending(`save-${name}`, false);
    const err = getApiError(status, 'save manifest', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Snapshot saved.');
    await this._loadManifest(name);
  }

  async _handleLock(name) {
    const m = this._manifests[name];
    if (!m) return;
    this._setPending(`lock-${name}`, true);
    const body = {
      title: m.title, description: m.description,
      metadata: m.metadata, locked: true,
    };
    const { status, error } = await saveSnapshotManifest(this._org, this._site, name, body);
    this._setPending(`lock-${name}`, false);
    const err = getApiError(status, 'lock snapshot', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Snapshot locked.');
    await this._loadManifest(name);
  }

  async _handleUnlock(name) {
    const m = this._manifests[name];
    if (!m) return;
    this._setPending(`unlock-${name}`, true);
    const body = {
      title: m.title, description: m.description,
      metadata: m.metadata, locked: false,
    };
    const { status, error } = await saveSnapshotManifest(this._org, this._site, name, body);
    this._setPending(`unlock-${name}`, false);
    const err = getApiError(status, 'unlock snapshot', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Snapshot unlocked.');
    await this._loadManifest(name);
  }

  async _handleReview(name, state) {
    this._setPending(`review-${name}`, true);
    const { status, error } = await reviewSnapshot(this._org, this._site, name, state);
    this._setPending(`review-${name}`, false);
    const err = getApiError(status, `${state} review`, error);
    if (err) { toast.negative(err); return; }
    const labels = { request: 'Review requested (locked).', approve: 'Approved and published.', reject: 'Review rejected (unlocked).' };
    toast.positive(labels[state] || 'Done.');
    await this._loadManifest(name);
  }

  async _handleAddPaths(name) {
    const paths = (this._addPathsText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!paths.length) { toast.negative('Enter paths to add.'); return; }
    this._addingPaths = true;
    const { status, error } = await addSnapshotPaths(this._org, this._site, name, paths);
    const err = getApiError(status, 'add paths', error);
    if (err) { toast.negative(err); } else {
      toast.positive('Paths added.');
      this._addPathsId = '';
      this._addPathsText = '';
      await this._loadManifest(name);
    }
    this._addingPaths = false;
  }

  async _handleRemovePath(name, path) {
    this._setPending(`rm-${name}-${path}`, true);
    const { status, error } = await removeSnapshotPath(this._org, this._site, name, path);
    this._setPending(`rm-${name}-${path}`, false);
    const err = getApiError(status, 'remove path', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Path removed.');
    await this._loadManifest(name);
  }

  async _handlePublishAll(name) {
    this._setPending(`pub-${name}`, true);
    const { status, error } = await publishSnapshot(this._org, this._site, name);
    this._setPending(`pub-${name}`, false);
    const err = getApiError(status, 'publish snapshot', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Snapshot published.');
  }

  async _handlePublishResource(name, path) {
    this._setPending(`pub-${name}-${path}`, true);
    const { status, error } = await publishSnapshotResource(this._org, this._site, name, path);
    this._setPending(`pub-${name}-${path}`, false);
    const err = getApiError(status, 'publish resource', error);
    if (err) { toast.negative(err); return; }
    toast.positive(`Published: ${path}`);
  }

  async _handleDelete(name) {
    this._deletingId = name;
    this._error = '';
    const rmRes = await removeAllSnapshotPaths(this._org, this._site, name);
    if (rmRes.status >= 400 && rmRes.status !== 404) {
      const err = getApiError(rmRes.status, 'clear snapshot resources', rmRes.error);
      if (err) { this._error = err; this._confirmDelete = null; this._deletingId = null; return; }
    }
    const { status, error } = await deleteSnapshot(this._org, this._site, name);
    const err = getApiError(status, 'delete snapshot', error);
    if (err) { this._error = err; } else { toast.positive('Snapshot deleted.'); }
    this._confirmDelete = null;
    this._deletingId = null;
    await this._load();
  }

  _reviewUrl(name) {
    return `https://${name}--main--${this._site}--${this._org}.aem.reviews/`;
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Snapshots</h1>
            <p class="page-subtitle">${this._org} / ${this._site}</p>
          </div>
          ${!this._loading && !this._error ? html`
            <eds-button variant="accent" @click=${() => { this._showCreate = true; }}>
              <span slot="icon">${edsIcon('add', { size: 16 })}</span>
              Create Snapshot
            </eds-button>
          ` : nothing}
        </div>

        <error-alert .error=${this._error} @retry=${() => this._load()}></error-alert>

        ${this._loading
          ? html`<div class="snapshot-list">${[1, 2, 3].map(() => html`<admin-card loading></admin-card>`)}</div>`
          : nothing}

        ${!this._loading && !this._error && this._snapshotNames.length === 0
          ? html`<p class="empty">No snapshots. Create one to get started.</p>`
          : nothing}

        ${!this._loading && !this._error && this._snapshotNames.length > 0
          ? html`
            <div class="snapshots-accordion">
              ${this._snapshotNames.map((name) => this._renderSnapshotItem(name))}
            </div>
          ` : nothing}
      </div>

      ${this._showCreate ? this._renderCreateDialog() : nothing}
      ${this._confirmDelete ? this._renderDeleteDialog() : nothing}
    `;
  }

  _renderSnapshotItem(name) {
    const m = this._manifests[name];
    const isLocked = this._isLocked(name);
    const resources = this._getResources(name);
    const lockDate = m?.locked ? formatDate(m.locked) : '';
    const reviewPending = !!this._actionPending[`review-${name}`];

    return html`
      <details class="eds-accordion" data-snapshot=${name} @toggle=${this._handleAccordionToggle}>
        <summary>${name}</summary>
        <div class="accordion-content">
        ${m ? html`
          <div class="snapshot-meta">
            ${isLocked
              ? html`<span class="badge negative">
                  ${edsIcon('lock-closed', { size: 12 })}
                  Locked${lockDate ? ` — ${lockDate}` : ''}
                </span>`
              : html`<span class="badge positive">
                  ${edsIcon('lock-open', { size: 12 })}
                  Unlocked
                </span>`}
            ${m.title ? html`<span class="snapshot-title">${m.title}</span>` : nothing}
          </div>

          <div class="form-section">
            <label class="field-label" for="title-${name}">Title</label>
            <eds-textfield id="title-${name}"
              placeholder="Snapshot title"
              .value=${this._editTitle[name] ?? m.title ?? ''}
              @input=${(e) => { this._editTitle = { ...this._editTitle, [name]: e.detail?.value ?? '' }; }}
            ></eds-textfield>
            <label class="field-label" for="desc-${name}">Description</label>
            <eds-textfield id="desc-${name}" multiline
              placeholder="Snapshot description"
              .value=${this._editDescription[name] ?? m.description ?? ''}
              @input=${(e) => { this._editDescription = { ...this._editDescription, [name]: e.detail?.value ?? '' }; }}
            ></eds-textfield>
            <eds-button variant="accent" size="m"
              class="save-btn"
              ?disabled=${!!this._actionPending[`save-${name}`]}
              @click=${() => this._handleSaveManifest(name)}>
              ${this._actionPending[`save-${name}`] ? 'Saving…' : 'Save'}
            </eds-button>
          </div>

          <hr class="divider s" />

          <div class="actions-section">
            <h4>Actions</h4>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <eds-button variant="secondary" size="s"
                ?disabled=${isLocked || !!this._actionPending[`lock-${name}`]}
                @click=${() => this._handleLock(name)}>
                <span slot="icon">${edsIcon('lock-closed', { size: 16 })}</span>
                Lock
              </eds-button>
              <eds-button variant="secondary" size="s"
                ?disabled=${!isLocked || !!this._actionPending[`unlock-${name}`]}
                @click=${() => this._handleUnlock(name)}>
                <span slot="icon">${edsIcon('lock-open', { size: 16 })}</span>
                Unlock
              </eds-button>
              <eds-button variant="accent" size="s"
                ?disabled=${!!this._actionPending[`pub-${name}`]}
                @click=${() => this._handlePublishAll(name)}>
                ${this._actionPending[`pub-${name}`] ? 'Publishing…' : 'Publish All'}
              </eds-button>
            </div>
          </div>

          <div class="actions-section">
            <h4>Review</h4>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <eds-button variant="secondary" size="s"
                ?disabled=${isLocked || reviewPending}
                @click=${() => this._handleReview(name, 'request')}>
                Request Review
              </eds-button>
              <eds-button variant="primary" size="s"
                ?disabled=${!isLocked || reviewPending}
                @click=${() => this._handleReview(name, 'approve')}>
                <span slot="icon">${edsIcon('checkmark', { size: 16 })}</span>
                Approve
              </eds-button>
              <eds-button variant="secondary" size="s"
                ?disabled=${!isLocked || reviewPending}
                @click=${() => this._handleReview(name, 'reject')}>
                <span slot="icon">${edsIcon('close', { size: 16 })}</span>
                Reject
              </eds-button>
              <eds-button variant="secondary" size="s"
                href=${this._reviewUrl(name)} target="_blank" rel="noopener noreferrer">
                Open Review
              </eds-button>
            </div>
          </div>

          <hr class="divider s" />

          <div class="resources-section">
            <div class="resources-header">
              <h4>Resources (${resources.length})</h4>
              <eds-button variant="secondary" size="s"
                @click=${() => { this._addPathsId = this._addPathsId === name ? '' : name; this._addPathsText = ''; }}>
                <span slot="icon">${edsIcon('add', { size: 16 })}</span>
                Add Paths
              </eds-button>
            </div>

            ${this._addPathsId === name ? html`
              <div class="add-paths-form">
                <label class="field-label" for="add-paths-${name}">Paths to add (one per line)</label>
                <eds-textfield id="add-paths-${name}" multiline rows="4"
                  placeholder="/path/to/page1&#10;/path/to/page2"
                  .value=${this._addPathsText}
                  @input=${(e) => { this._addPathsText = e.detail?.value ?? ''; }}
                ></eds-textfield>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <eds-button variant="accent" size="s"
                    ?disabled=${this._addingPaths}
                    @click=${() => this._handleAddPaths(name)}>
                    ${this._addingPaths ? 'Adding…' : 'Add'}
                  </eds-button>
                  <eds-button variant="secondary" size="s"
                    @click=${() => { this._addPathsId = ''; this._addPathsText = ''; }}>
                    Cancel
                  </eds-button>
                </div>
              </div>
            ` : nothing}

            ${resources.length === 0
              ? html`<p class="text-muted">No resources yet. Add paths to snapshot content.</p>`
              : html`
                <table class="eds-table compact">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${resources.map((r) => {
                      const rPath = typeof r === 'string' ? r : r.path;
                      return html`
                        <tr>
                          <td><code>${rPath}</code></td>
                          <td>
                            <div style="display:flex;gap:4px;align-items:center">
                              <eds-button size="s" variant="secondary"
                                ?disabled=${!!this._actionPending[`pub-${name}-${rPath}`]}
                                @click=${() => this._handlePublishResource(name, rPath)}>
                                Publish
                              </eds-button>
                              <eds-button size="s" quiet
                                ?disabled=${!!this._actionPending[`rm-${name}-${rPath}`]}
                                @click=${() => this._handleRemovePath(name, rPath)}>
                                <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
                              </eds-button>
                            </div>
                          </td>
                        </tr>
                      `;
                    })}
                  </tbody>
                </table>
              `}
          </div>

          <hr class="divider s" />

          <div class="danger-section">
            <eds-button variant="negative" size="s"
              @click=${() => { this._confirmDelete = name; }}>
              <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
              Delete Snapshot
            </eds-button>
          </div>
        ` : html`
          <div class="loading-detail">
            <span class="spinner s"></span>
            Loading snapshot details…
          </div>
        `}
        </div>
      </details>
    `;
  }

  _renderCreateDialog() {
    return html`
      <eds-dialog open headline="Create Snapshot" size="m"
        @close=${() => { this._showCreate = false; }}>
        <label class="field-label" for="create-snapshot-name">Snapshot name</label>
        <eds-textfield id="create-snapshot-name"
          placeholder="my-snapshot"
          .value=${this._createName}
          @input=${(e) => { this._createName = e.detail?.value ?? ''; }}
          @keydown=${(e) => { if (e.key === 'Enter') this._handleCreate(); }}
        ></eds-textfield>
        <span class="help-text">Lowercase alphanumeric and hyphens only.</span>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline"
            @click=${() => { this._showCreate = false; }}>Cancel</eds-button>
          <eds-button variant="accent"
            ?disabled=${this._creating}
            @click=${this._handleCreate}>
            ${this._creating ? 'Creating…' : 'Create'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderDeleteDialog() {
    return html`
      <eds-dialog open headline="Delete Snapshot" size="s"
        @close=${() => { this._confirmDelete = null; }}>
        <p>Are you sure you want to delete <strong>${this._confirmDelete}</strong>?
        All resources will be removed first. This cannot be undone.</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline"
            @click=${() => { this._confirmDelete = null; }}>Cancel</eds-button>
          <eds-button variant="negative"
            ?disabled=${!!this._deletingId}
            @click=${() => this._handleDelete(this._confirmDelete)}>
            ${this._deletingId ? 'Deleting…' : 'Delete'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }
}

customElements.define('site-snapshots', SiteSnapshots);
