import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import { EditorView, basicSetup, json, EditorState, syntaxHighlighting, HighlightStyle, tags } from 'codemirror';
import {
  fetchSiteConfig, saveSiteConfig,
  fetchSiteVersions, fetchSiteVersion, restoreVersion,
  renameVersion, deleteVersion,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/formatDate.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/json-diff/json-diff.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-menu/eds-menu.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./config-editor.css', import.meta.url).pathname);

export class ConfigEditor extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _config: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _saving: { state: true },
    _rawJson: { state: true },
    _jsonValid: { state: true },
    _jsonError: { state: true },
    _versions: { state: true },
    _versionsLoading: { state: true },
    _selectedVersionId: { state: true },
    _versionDetail: { state: true },
    _prevVersionDetail: { state: true },
    _detailLoading: { state: true },
    _showDiff: { state: true },
    _restoring: { state: true },
    _renameId: { state: true },
    _renameName: { state: true },
    _renaming: { state: true },
    _deleteConfirmVersionId: { state: true },
    _deletingVersion: { state: true },
    _restoreConfirmVersionId: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._config = null;
    this._loading = true;
    this._error = null;
    this._saving = false;
    this._rawJson = '';
    this._jsonValid = true;
    this._jsonError = null;
    this._cmView = null;
    this._versions = [];
    this._versionsLoading = false;
    this._selectedVersionId = null;
    this._versionDetail = null;
    this._prevVersionDetail = null;
    this._detailLoading = false;
    this._showDiff = true;
    this._restoring = false;
    this._renameId = null;
    this._renameName = '';
    this._renaming = false;
    this._deleteConfirmVersionId = null;
    this._deletingVersion = false;
    this._restoreConfirmVersionId = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    this._loadData();
  }

  async _loadData() {
    if (this._cmView) {
      this._cmView.destroy();
      this._cmView = null;
    }
    this._loading = true;
    this._error = null;
    const { data, status, error } = await fetchSiteConfig(this._org, this._site);
    const err = getApiError(status, 'load config', error);
    if (err) { this._error = err; this._loading = false; return; }
    this._config = data || {};
    this._rawJson = JSON.stringify(this._config, null, 2);
    this._jsonValid = true;
    this._jsonError = null;
    this._loading = false;
    this._loadVersions();
    this.updateComplete.then(() => {
      if (this._cmView) {
        this._setEditorContent(this._rawJson);
      }
    });
  }

  static _jsonHighlight = HighlightStyle.define([
    { tag: tags.propertyName, color: 'var(--cm-color-property)' },
    { tag: tags.string, color: 'var(--cm-color-string)' },
    { tag: tags.number, color: 'var(--cm-color-number)' },
    { tag: tags.bool, color: 'var(--cm-color-keyword)' },
    { tag: tags.null, color: 'var(--cm-color-keyword)' },
    { tag: tags.punctuation, color: 'var(--cm-color-punctuation)' },
    { tag: tags.brace, color: 'var(--cm-color-punctuation)' },
    { tag: tags.squareBracket, color: 'var(--cm-color-punctuation)' },
  ]);

  static _editorTheme = EditorView.theme({
    '&': { fontSize: '13px', backgroundColor: 'var(--spectrum-global-color-gray-50)' },
    '.cm-content': { fontFamily: "'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace" },
    '.cm-gutters': {
      fontFamily: "'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace",
      backgroundColor: 'var(--spectrum-global-color-gray-100)',
      color: 'var(--spectrum-global-color-gray-500)',
      borderRight: '1px solid var(--spectrum-alias-border-color)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--spectrum-global-color-gray-200)' },
    '.cm-activeLine': { backgroundColor: 'rgba(0, 101, 220, 0.08)' },
    '.cm-scroller': { overflow: 'auto', maxHeight: '520px' },
    '.cm-matchingBracket': { backgroundColor: 'var(--spectrum-global-color-blue-200)', color: 'var(--spectrum-global-color-gray-900)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(0, 101, 220, 0.15)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--spectrum-global-color-blue-600)' },
  });

  _initCodeMirror() {
    const container = this.renderRoot?.querySelector('.cm-container');
    if (!container || this._cmView) return;

    const self = this;
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        self._rawJson = update.state.doc.toString();
        self._validateJson(self._rawJson);
      }
    });

    this._cmView = new EditorView({
      state: EditorState.create({
        doc: this._rawJson,
        extensions: [
          basicSetup,
          json(),
          updateListener,
          ConfigEditor._editorTheme,
          syntaxHighlighting(ConfigEditor._jsonHighlight),
        ],
      }),
      parent: container,
    });
  }

  _setEditorContent(text) {
    if (!this._cmView) return;
    this._cmView.dispatch({
      changes: { from: 0, to: this._cmView.state.doc.length, insert: text },
    });
  }

  updated(changed) {
    super.updated?.(changed);
    if (!this._loading && !this._cmView) {
      this._initCodeMirror();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._cmView) {
      this._cmView.destroy();
      this._cmView = null;
    }
  }

  _validateJson(text) {
    try {
      JSON.parse(text);
      this._jsonValid = true;
      this._jsonError = null;
    } catch (e) {
      this._jsonValid = false;
      this._jsonError = e.message.replace(/^JSON\.parse:\s*/, '');
    }
  }

  _handleFormatJson() {
    try {
      const parsed = JSON.parse(this._rawJson);
      const formatted = JSON.stringify(parsed, null, 2);
      this._rawJson = formatted;
      this._setEditorContent(formatted);
      this._jsonValid = true;
      this._jsonError = null;
    } catch {
      toast.negative('Cannot format — JSON has syntax errors.');
    }
  }

  async _handleSave() {
    let parsed;
    try { parsed = JSON.parse(this._rawJson); } catch {
      toast.negative('Invalid JSON. Please fix syntax errors.');
      return;
    }
    this._saving = true;
    this._error = null;
    const { status, error } = await saveSiteConfig(this._org, this._site, parsed);
    this._saving = false;
    const err = getApiError(status, 'save config', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Config saved.');
    await this._loadData();
  }

  async _loadVersions() {
    this._versionsLoading = true;
    const { data, status, error } = await fetchSiteVersions(this._org, this._site);
    this._versionsLoading = false;
    const err = getApiError(status, 'load versions', error);
    if (err) { toast.negative(err); return; }
    const list = Array.isArray(data) ? data : (data?.versions ?? []);
    this._versions = [...list].reverse();
  }

  async _openVersion(id) {
    this._selectedVersionId = id;
    this._versionDetail = null;
    this._prevVersionDetail = null;
    this._detailLoading = true;
    const prevId = Number(id) > 1 ? String(Number(id) - 1) : null;
    const [currentRes, prevRes] = await Promise.all([
      fetchSiteVersion(this._org, this._site, id),
      prevId ? fetchSiteVersion(this._org, this._site, prevId) : Promise.resolve({ data: null, status: 200 }),
    ]);
    this._detailLoading = false;
    const err = getApiError(currentRes.status, 'load version', currentRes.error);
    if (err) { toast.negative(err); return; }
    this._versionDetail = currentRes.data;
    if (prevRes.data) this._prevVersionDetail = prevRes.data;
  }

  _closeVersionDetail() {
    this._selectedVersionId = null;
    this._versionDetail = null;
    this._prevVersionDetail = null;
  }

  async _handleRestore() {
    const versionId = this._restoreConfirmVersionId;
    if (!versionId) return;
    this._restoring = true;
    const { status, error } = await restoreVersion(this._org, this._site, versionId);
    this._restoring = false;
    const err = getApiError(status, 'restore version', error);
    if (err) { toast.negative(err); this._restoreConfirmVersionId = null; return; }
    toast.positive('Version restored.');
    this._restoreConfirmVersionId = null;
    this._closeVersionDetail();
    await this._loadData();
  }

  async _handleRename() {
    if (!this._renameName.trim() || !this._renameId) return;
    this._renaming = true;
    const { status, error } = await renameVersion(this._org, this._site, this._renameId, this._renameName.trim());
    this._renaming = false;
    const err = getApiError(status, 'rename version', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Version renamed.');
    this._renameId = null;
    this._renameName = '';
    this._loadVersions();
  }

  async _handleDeleteVersion() {
    if (!this._deleteConfirmVersionId) return;
    this._deletingVersion = true;
    const { status, error } = await deleteVersion(this._org, this._site, this._deleteConfirmVersionId);
    this._deletingVersion = false;
    const err = getApiError(status, 'delete version', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Version deleted.');
    this._deleteConfirmVersionId = null;
    this._loadVersions();
  }

  get _currentVersionId() {
    const first = this._versions[0];
    return first ? (first.id ?? first.version) : null;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`;
    }

    return html`
      <div class="page">
        <div class="header-row">
          <div>
            <h1>Config Editor</h1>
            <p class="page-subtitle">Edit raw configuration for ${this._site}</p>
          </div>
        </div>

        <error-alert .error=${this._error} @retry=${this._loadData}></error-alert>

        <div class="two-col">
          <div class="col-main">
            <div class="raw-section">
              <div class="editor-toolbar">
                <eds-button size="s" variant="secondary" @click=${this._handleFormatJson}>Format</eds-button>
                <span class="editor-status ${this._jsonValid ? 'editor-status--valid' : 'editor-status--error'}">
                  ${this._jsonValid ? 'Valid JSON' : this._jsonError}
                </span>
              </div>
              <div class="cm-container"></div>
              <eds-button variant="accent" @click=${this._handleSave} ?disabled=${this._saving || !this._jsonValid}>
                ${this._saving ? 'Saving...' : 'Save'}
              </eds-button>
            </div>
          </div>
          <div class="col-side">
            ${this._renderVersions()}
          </div>
        </div>

        ${this._selectedVersionId ? this._renderVersionViewDialog() : nothing}
        ${this._renameId ? this._renderRenameDialog() : nothing}
        ${this._deleteConfirmVersionId ? this._renderDeleteVersionDialog() : nothing}
        ${this._restoreConfirmVersionId ? this._renderRestoreDialog() : nothing}
      </div>
    `;
  }

  _renderVersions() {
    if (this._versionsLoading) {
      return html`
        <h2>Version History</h2>
        <div class="loading"><div class="spinner" aria-label="Loading versions"></div></div>
      `;
    }

    if (this._versions.length === 0) {
      return html`
        <h2>Version History</h2>
        <p class="empty">No versions found.</p>
      `;
    }

    return html`
      <h2>Version History</h2>
      <div class="versions-list">
        ${this._versions.map((v, idx) => {
          const vid = v.id ?? v.version;
          const ts = v.timestamp ?? v.created ?? v.date;
          const isCurrent = idx === 0;
          const canRestore = !isCurrent;
          return html`
            <div class="version-row ${isCurrent ? 'current' : ''}">
              <div class="version-info">
                <span class="version-id">v${vid}</span>
                ${isCurrent ? html`<span class="version-badge">current</span>` : nothing}
                ${v.name ? html`<span class="version-label">${v.name}</span>` : nothing}
                <span class="version-date">${formatDate(ts)}</span>
                <span class="version-author">${v.user ?? v.author ?? v.email ?? ''}</span>
              </div>
              <div class="version-actions">
                <eds-button size="s" variant="secondary" aria-label="View diff" @click=${() => this._openVersion(vid)}>
                  View
                </eds-button>
                ${canRestore ? html`
                  <eds-button size="s" variant="secondary" aria-label="Restore" @click=${() => { this._restoreConfirmVersionId = v.version; }}>
                    Restore
                  </eds-button>
                ` : nothing}
                <eds-menu quiet label="Actions" placement="bottom-end"
                  @change=${(e) => {
                    const val = e.detail?.value;
                    if (val === 'rename') { this._renameId = vid; this._renameName = v.name ?? ''; }
                    if (val === 'delete') { this._deleteConfirmVersionId = vid; }
                  }}>
                  <span slot="trigger">${edsIcon('more', { size: 18 })}</span>
                  <button role="menuitem" data-value="rename">Rename</button>
                  ${canRestore ? html`<button role="menuitem" data-value="delete">Delete</button>` : nothing}
                </eds-menu>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  _renderVersionViewDialog() {
    const prev = this._prevVersionDetail?.data ?? this._prevVersionDetail;
    const current = this._versionDetail?.data ?? this._versionDetail;
    const canRestore = String(this._selectedVersionId) !== String(this._currentVersionId);

    return html`
      <eds-dialog
        open
        headline="Version ${this._selectedVersionId}"
        size="l"
        @close=${this._closeVersionDetail}
      >
        ${!this._detailLoading && this._versionDetail && this._prevVersionDetail ? html`
          <eds-button variant="secondary" size="s" @click=${() => { this._showDiff = !this._showDiff; }}>
            ${this._showDiff ? 'Show Raw' : 'Show Diff'}
          </eds-button>
        ` : nothing}
        ${this._detailLoading
          ? html`<div class="detail-loading"><div class="spinner" aria-label="Loading"></div></div>`
          : this._versionDetail
            ? this._showDiff && prev
              ? html`<json-diff .oldObj=${prev} .newObj=${current}></json-diff>`
              : html`<pre class="json-raw">${JSON.stringify(current, null, 2)}</pre>`
            : html`<p class="page-subtitle">No details available.</p>`}
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${this._closeVersionDetail}>Close</eds-button>
          ${canRestore ? html`
            <eds-button variant="accent" @click=${() => {
              const vObj = this._versions.find((ver) => String(ver.id ?? ver.version) === String(this._selectedVersionId));
              this._restoreConfirmVersionId = vObj?.version ?? this._selectedVersionId;
            }}>
              Restore this version
            </eds-button>
          ` : nothing}
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
        <label class="field-label" for="rename-input">Version name</label>
        <eds-textfield id="rename-input" .value=${this._renameName} placeholder="e.g. before-migration"
          @input=${(e) => { this._renameName = e.detail?.value ?? ''; }}></eds-textfield>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._renameId = null; }}>Cancel</eds-button>
          <eds-button variant="accent" ?disabled=${!this._renameName.trim() || this._renaming} @click=${this._handleRename}>
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
        @close=${() => { this._restoreConfirmVersionId = null; }}
      >
        <p>Are you sure you want to restore version <strong>${this._restoreConfirmVersionId}</strong>? This will make it the current version.</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._restoreConfirmVersionId = null; }}>Cancel</eds-button>
          <eds-button variant="accent" ?disabled=${this._restoring} @click=${this._handleRestore}>
            ${this._restoring ? 'Restoring...' : 'Restore'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderDeleteVersionDialog() {
    return html`
      <eds-dialog
        open
        headline="Delete Version"
        size="s"
        @close=${() => { this._deleteConfirmVersionId = null; }}
      >
        <p>Are you sure you want to delete version <strong>${this._deleteConfirmVersionId}</strong>? This cannot be undone.</p>
        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${() => { this._deleteConfirmVersionId = null; }}>Cancel</eds-button>
          <eds-button variant="negative" ?disabled=${this._deletingVersion} @click=${this._handleDeleteVersion}>
            ${this._deletingVersion ? 'Deleting...' : 'Delete'}
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }
}

customElements.define('config-editor', ConfigEditor);
