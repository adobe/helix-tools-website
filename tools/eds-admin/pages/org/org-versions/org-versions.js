import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import {
  fetchOrgVersions,
  fetchOrgVersion,
  restoreOrgVersion,
  renameVersion,
  deleteVersion,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/formatDate.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/json-diff/json-diff.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-menu/eds-menu.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const versionsSheet = await getSheet(new URL('../../../styles/versions.css', import.meta.url).pathname);

export class OrgVersions extends LitElement {
  static properties = {
    _org: { state: true },
    _versions: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _selectedId: { state: true },
    _versionDetail: { state: true },
    _prevVersionDetail: { state: true },
    _detailLoading: { state: true },
    _showDiff: { state: true },
    _restoring: { state: true },
    _renameId: { state: true },
    _renameName: { state: true },
    _renaming: { state: true },
    _deleteConfirmId: { state: true },
    _deletingVersion: { state: true },
    _restoreConfirmId: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._versions = [];
    this._loading = true;
    this._error = '';
    this._selectedId = null;
    this._versionDetail = null;
    this._prevVersionDetail = null;
    this._detailLoading = false;
    this._showDiff = true;
    this._restoring = false;
    this._renameId = null;
    this._renameName = '';
    this._renaming = false;
    this._deleteConfirmId = null;
    this._deletingVersion = false;
    this._restoreConfirmId = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, versionsSheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    if (this._org) this._loadData();
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') && this._org) this._loadData();
  }

  async _loadData() {
    if (!this._org) return;
    this._loading = true;
    this._error = '';
    const { data, status, error } = await fetchOrgVersions(this._org);
    const err = getApiError(status, 'load config versions', error);
    if (err) {
      this._error = err;
      this._loading = false;
      return;
    }
    const list = Array.isArray(data) ? data : (data?.versions ?? []);
    this._versions = [...list].reverse();
    this._loading = false;
  }

  _handleRetry() {
    this._loadData();
  }

  async _openVersion(id) {
    if (!this._org || !id) return;
    this._selectedId = id;
    this._versionDetail = null;
    this._prevVersionDetail = null;
    this._detailLoading = true;
    const prevId = Number(id) > 1 ? String(Number(id) - 1) : null;
    const [currentRes, prevRes] = await Promise.all([
      fetchOrgVersion(this._org, id),
      prevId ? fetchOrgVersion(this._org, prevId) : Promise.resolve({ data: null, status: 200 }),
    ]);
    this._detailLoading = false;
    const err = getApiError(currentRes.status, 'load version details', currentRes.error);
    if (err) {
      this._error = err;
      return;
    }
    this._versionDetail = currentRes.data;
    if (prevRes.data) {
      this._prevVersionDetail = prevRes.data;
    }
  }

  _closeDetail() {
    this._selectedId = null;
    this._versionDetail = null;
    this._prevVersionDetail = null;
  }

  async _handleRestore() {
    const versionId = this._restoreConfirmId;
    if (!versionId) return;
    this._restoring = true;
    this._error = '';
    const { status, error } = await restoreOrgVersion(this._org, versionId);
    this._restoring = false;
    const err = getApiError(status, 'restore config version', error);
    if (err) {
      this._error = err;
      this._restoreConfirmId = null;
      return;
    }
    toast.positive('Version restored.');
    this._restoreConfirmId = null;
    this._closeDetail();
    this._loadData();
  }

  async _handleRename() {
    if (!this._renameName.trim() || !this._renameId) return;
    this._renaming = true;
    this._error = '';
    const { status, error } = await renameVersion(this._org, null, this._renameId, this._renameName.trim());
    this._renaming = false;
    const err = getApiError(status, 'rename version', error);
    if (err) {
      this._error = err;
      return;
    }
    toast.positive('Version renamed.');
    this._renameId = null;
    this._renameName = '';
    this._loadData();
  }

  async _handleDeleteVersion() {
    if (!this._deleteConfirmId) return;
    this._deletingVersion = true;
    this._error = '';
    const { status, error } = await deleteVersion(this._org, null, this._deleteConfirmId);
    this._deletingVersion = false;
    const err = getApiError(status, 'delete version', error);
    if (err) {
      this._error = err;
      return;
    }
    toast.positive('Version deleted.');
    this._deleteConfirmId = null;
    this._loadData();
  }

  _handleVersionAction(v, value) {
    if (value === 'rename') {
      this._renameId = v.id ?? v.version;
      this._renameName = v.name ?? '';
    }
    if (value === 'delete') {
      this._deleteConfirmId = v.id ?? v.version;
    }
  }

  get _currentVersionId() {
    const first = this._versions[0];
    return first ? (first.id ?? first.version) : null;
  }

  render() {
    return html`
      <div class="page">
        <div>
          <h1 class="page-title">Organization Config Versions</h1>
          <p class="page-subtitle">
            Version history for <strong>${this._org}</strong> organization configuration. You can view or restore any previous version.
          </p>
        </div>

        <error-alert .error=${this._error} @retry=${this._handleRetry}></error-alert>

        ${this._loading
          ? html`<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`
          : nothing}

        ${!this._loading && !this._error
          ? html`
              <div class="versions-section">
                ${this._versions.length === 0
                  ? html`<p class="empty">No versions found.</p>`
                  : html`
                      <table class="versions-table">
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>Date</th>
                            <th>Author</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          ${this._versions.map((v, idx) => {
                            const versionId = v.id ?? v.version;
                            const ts = v.timestamp ?? v.created ?? v.date;
                            const isCurrent = idx === 0;
                            return html`
                              <tr>
                                <td>
                                  v${versionId}
                                  ${v.name ? html`<span class="text-muted">(${v.name})</span>` : nothing}
                                  ${isCurrent && !v.name ? html`<span class="text-muted">(current)</span>` : nothing}
                                  ${isCurrent && v.name ? html`<span class="text-muted">· current</span>` : nothing}
                                </td>
                                <td class="nowrap">${formatDate(ts)}</td>
                                <td>${v.user ?? v.author ?? v.email ?? '-'}</td>
                                <td class="actions-cell">
                                  <div class="row-actions">
                                    <eds-button variant="secondary" size="s" @click=${() => this._openVersion(versionId)}>
                                      View
                                    </eds-button>
                                    ${!isCurrent ? html`
                                      <eds-button variant="secondary" size="s" @click=${() => { this._restoreConfirmId = versionId; }}>
                                        Restore
                                      </eds-button>
                                    ` : nothing}
                                    <eds-menu
                                      quiet
                                      label="Actions"
                                      placement="bottom-end"
                                      @change=${(e) => this._handleVersionAction(v, e.detail?.value)}
                                    >
                                      <span slot="trigger">${edsIcon('more', { size: 18 })}</span>
                                      <button role="menuitem" data-value="rename">Rename</button>
                                      ${!isCurrent ? html`<button role="menuitem" data-value="delete">Delete</button>` : nothing}
                                    </eds-menu>
                                  </div>
                                </td>
                              </tr>
                            `;
                          })}
                        </tbody>
                      </table>
                    `}
              </div>
            `
          : nothing}
      </div>

      ${this._selectedId ? this._renderViewDialog() : nothing}
      ${this._renameId ? this._renderRenameDialog() : nothing}
      ${this._deleteConfirmId ? this._renderDeleteDialog() : nothing}
      ${this._restoreConfirmId ? this._renderRestoreDialog() : nothing}
    `;
  }

  _renderViewDialog() {
    const prev = this._prevVersionDetail?.data ?? this._prevVersionDetail;
    const current = this._versionDetail?.data ?? this._versionDetail;
    const canRestore = String(this._selectedId) !== String(this._currentVersionId);

    return html`
      <eds-dialog
        open
        headline="Version: ${this._selectedId}"
        size="l"
        @close=${this._closeDetail}
      >
        ${!this._detailLoading && this._versionDetail && this._prevVersionDetail
          ? html`
              <eds-button
                variant="secondary"
                size="s"
                @click=${() => { this._showDiff = !this._showDiff; }}
              >
                ${this._showDiff ? 'Show Raw' : 'Show Diff'}
              </eds-button>
            `
          : nothing}
        ${this._detailLoading
          ? html`<div class="detail-loading"><div class="spinner" aria-label="Loading details"></div></div>`
          : this._versionDetail
            ? this._showDiff && prev
              ? html`<json-diff .oldObj=${prev} .newObj=${current}></json-diff>`
              : html`
                  <pre class="json-raw">${JSON.stringify(current, null, 2)}</pre>
                `
            : html`<p class="text-muted">No details available.</p>`}
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${this._closeDetail}>Close</eds-button>
          ${canRestore
            ? html`
                <eds-button
                  variant="accent"
                  @click=${() => {
                    const vObj = this._versions.find((ver) => String(ver.id ?? ver.version) === String(this._selectedId));
                    this._restoreConfirmId = vObj?.id ?? vObj?.version ?? this._selectedId;
                  }}
                >
                  Restore this version
                </eds-button>
              `
            : nothing}
        </div>
      </eds-dialog>
    `;
  }

  _renderRenameDialog() {
    return html`
      <eds-dialog
        open
        headline="Rename Version ${this._renameId}"
        size="s"
        @close=${() => { this._renameId = null; }}
      >
        <eds-textfield
          id="rename-version-name"
          label="Version name"
          .value=${this._renameName}
          @input=${(e) => { this._renameName = (e.detail?.value ?? e.target?.value ?? ''); }}
          placeholder="e.g. before-migration"
        ></eds-textfield>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._renameId = null; }}>Cancel</eds-button>
          <eds-button
            variant="accent"
            ?disabled=${!this._renameName.trim() || this._renaming}
            @click=${this._handleRename}
          >
            ${this._renaming ? 'Saving...' : 'Save'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderRestoreDialog() {
    return html`
      <eds-dialog
        open
        headline="Restore Version"
        size="s"
        @close=${() => { this._restoreConfirmId = null; }}
      >
        <p>Are you sure you want to restore version <strong>${this._restoreConfirmId}</strong>? This will make it the current version.</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._restoreConfirmId = null; }}>Cancel</eds-button>
          <eds-button variant="accent" ?disabled=${this._restoring} @click=${this._handleRestore}>
            ${this._restoring ? 'Restoring...' : 'Restore'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderDeleteDialog() {
    return html`
      <eds-dialog
        open
        headline="Delete Version"
        size="s"
        @close=${() => { this._deleteConfirmId = null; }}
      >
        <p>
          Are you sure you want to delete version <strong>${this._deleteConfirmId}</strong>? This cannot be undone.
        </p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._deleteConfirmId = null; }}>Cancel</eds-button>
          <eds-button
            variant="negative"
            ?disabled=${this._deletingVersion}
            @click=${this._handleDeleteVersion}
          >
            ${this._deletingVersion ? 'Deleting...' : 'Delete'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

}

customElements.define('org-versions', OrgVersions);
