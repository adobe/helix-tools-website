import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { toast } from '../../../controllers/toast-controller.js';
import {
  fetchIndexConfig,
  saveIndexConfig,
  bulkIndex,
  fetchJobDetails,
} from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/admin-card/admin-card.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-picker/eds-picker.js';
import { edsIcon } from '../../../utils/icons.js';
import { parse, stringify } from 'yaml';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-index.css', import.meta.url).pathname);

const PROPERTY_TYPES = [
  { id: 'value', label: 'Single' },
  { id: 'values', label: 'Multiple' },
];

function deriveReindexPaths(includes, targetPath = '/') {
  if (!includes || includes.length === 0) {
    const base = targetPath?.replace(/\.json$/, '') || '/query-index';
    return [base === '/' || base === '' ? '/*' : `${base}/*`];
  }
  const paths = includes.map((pattern) => {
    if (!pattern.includes('*')) return pattern;
    const segments = pattern.split('/');
    const pathSegments = [];
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].includes('*')) break;
      pathSegments.push(segments[i]);
    }
    const basePath = pathSegments.join('/') || '/';
    return basePath === '/' ? '/*' : `${basePath}/*`;
  });
  if (paths.includes('/*')) return ['/*'];
  return [...new Set(paths)];
}

export class SiteIndex extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _yamlRaw: { state: true },
    _indices: { state: true },
    _loading: { state: true },
    _saving: { state: true },
    _error: { state: true },
    _showDialog: { state: true },
    _editingIndex: { state: true },
    _dialogForm: { state: true },
    _reindexing: { state: true },
    _reindexStatus: { state: true },
    _excludeText: { state: true },
    _deleteConfirm: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._yamlRaw = '';
    this._indices = [];
    this._loading = true;
    this._saving = false;
    this._error = null;
    this._showDialog = false;
    this._editingIndex = null;
    this._dialogForm = this._emptyForm();
    this._reindexing = new Set();
    this._reindexStatus = {};
    this._excludeText = '';
    this._deleteConfirm = null;
  }

  _emptyForm() {
    return {
      name: '',
      target: '/query-index.json',
      include: [],
      exclude: [],
      properties: [],
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimeout) clearTimeout(this._pollTimeout);
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
    const { data, status, error } = await fetchIndexConfig(this._org, this._site);
    const err = getApiError(status, 'load index config', error);
    if (err) { this._error = err; this._loading = false; return; }
    this._yamlRaw = data || '';
    this._parseIndices();
    this._loading = false;
  }

  _parseIndices() {
    this._indices = [];
    if (!this._yamlRaw?.trim()) return;
    try {
      const parsed = parse(this._yamlRaw);
      const indicesObj = parsed?.indices || {};
      this._indices = Object.entries(indicesObj).map(([name, cfg]) => ({
        name,
        target: cfg.target || '',
        include: Array.isArray(cfg.include) ? cfg.include : (cfg.include ? [cfg.include] : []),
        exclude: Array.isArray(cfg.exclude) ? cfg.exclude : (cfg.exclude ? [cfg.exclude] : []),
        properties: Object.entries(cfg.properties || {}).map(([propName, p]) => {
          const hasSelectFirst = p.selectFirst != null && p.selectFirst !== '';
          return {
            name: propName,
            type: p.values != null ? 'values' : 'value',
            select: hasSelectFirst ? '' : (p.select || ''),
            selectFirst: hasSelectFirst ? (p.selectFirst || '') : '',
            value: (p.value ?? p.values ?? '').toString?.() ?? String(p.value ?? p.values ?? ''),
          };
        }),
      }));
    } catch {
      this._indices = [];
    }
  }

  _buildYamlFromIndices() {
    const obj = { version: 1, indices: {} };
    for (const idx of this._indices) {
      const props = {};
      for (const p of idx.properties) {
        if (!p.name?.trim()) continue;
        const hasSelectFirst = (p.selectFirst || '').trim();
        const base = hasSelectFirst
          ? { selectFirst: hasSelectFirst }
          : { select: (p.select || '').trim() || 'head > meta' };
        if (p.type === 'values') {
          props[p.name.trim()] = { ...base, values: p.value || '' };
        } else {
          props[p.name.trim()] = { ...base, value: p.value || '' };
        }
      }
      obj.indices[idx.name] = {
        target: idx.target,
        ...(idx.include?.length ? { include: idx.include } : {}),
        ...(idx.exclude?.length ? { exclude: idx.exclude } : {}),
        ...(Object.keys(props).length ? { properties: props } : {}),
      };
    }
    return stringify(obj);
  }

  _openAdd() {
    this._editingIndex = null;
    this._dialogForm = this._emptyForm();
    this._excludeText = '';
    this._showDialog = true;
  }

  _openEdit(idx) {
    this._editingIndex = idx.name;
    this._dialogForm = {
      name: idx.name,
      target: idx.target || '/query-index.json',
      include: [...(idx.include || [])],
      exclude: [...(idx.exclude || [])],
      properties: (idx.properties || []).map((p) => ({
        name: p.name,
        type: p.type || 'value',
        select: p.select || '',
        selectFirst: p.selectFirst || '',
        value: p.value || '',
      })),
    };
    this._excludeText = (idx.exclude || []).join('\n');
    this._showDialog = true;
  }

  _closeDialog() {
    this._showDialog = false;
    this._editingIndex = null;
  }

  _addInclude() {
    this._dialogForm = { ...this._dialogForm, include: [...this._dialogForm.include, ''] };
  }

  _removeInclude(i) {
    const arr = [...this._dialogForm.include];
    arr.splice(i, 1);
    this._dialogForm = { ...this._dialogForm, include: arr };
  }

  _addProperty() {
    this._dialogForm = {
      ...this._dialogForm,
      properties: [...this._dialogForm.properties, {
        name: '', type: 'value', select: '', selectFirst: '', value: '',
      }],
    };
  }

  _removeProperty(i) {
    const arr = [...this._dialogForm.properties];
    arr.splice(i, 1);
    this._dialogForm = { ...this._dialogForm, properties: arr };
  }

  async _saveDialog() {
    const form = this._dialogForm;
    if (!form.name?.trim()) { toast.negative('Index name is required.'); return; }
    const existing = this._indices.find((i) => i.name === form.name);
    if (existing && this._editingIndex !== form.name) { toast.negative('An index with that name already exists.'); return; }

    const excludePatterns = this._excludeText.split('\n').map((l) => l.trim()).filter(Boolean);

    const indices = [...this._indices];
    const idxData = {
      name: form.name.trim(),
      target: form.target?.trim() || '/query-index.json',
      include: form.include.filter(Boolean),
      exclude: excludePatterns,
      properties: form.properties
        .filter((p) => p.name?.trim())
        .map((p) => ({
          name: p.name.trim(),
          type: p.type,
          select: p.select?.trim() || '',
          selectFirst: p.selectFirst?.trim() || '',
          value: p.value?.trim() || '',
        })),
    };

    const idx = indices.find((i) => i.name === this._editingIndex);
    if (idx) { Object.assign(idx, idxData); } else { indices.push(idxData); }

    this._indices = indices;
    this._yamlRaw = this._buildYamlFromIndices();

    this._saving = true;
    const { status, error } = await saveIndexConfig(this._org, this._site, this._yamlRaw, { create: false });
    this._saving = false;
    const err = getApiError(status, 'save index config', error);
    if (err) { toast.negative(err); return; }

    toast.positive('Index configuration saved.');
    this._closeDialog();
  }

  async _handleReindex(idx) {
    if (!this._org || !this._site) return;
    const key = idx.name;
    this._reindexing = new Set([...this._reindexing, key]);
    this._reindexStatus = { ...this._reindexStatus, [key]: 'Starting...' };
    const paths = deriveReindexPaths(idx.include, idx.target);
    const { data, status, error } = await bulkIndex(this._org, this._site, paths);
    const err = getApiError(status, 'reindex', error);
    if (err) {
      this._reindexing = new Set([...this._reindexing].filter((k) => k !== key));
      this._reindexStatus = { ...this._reindexStatus, [key]: null };
      toast.negative(err);
      return;
    }
    if (status === 202 && data?.links?.self) {
      const selfUrl = data.links.self;
      const jobName = selfUrl.split('/').filter(Boolean).pop();
      const poll = async () => {
        const { data: details, status: ds } = await fetchJobDetails(this._org, this._site, 'index', jobName);
        if (ds !== 200 || !details) return true;
        const { state, progress = {} } = details;
        const { processed = 0, total = 0 } = progress;
        this._reindexStatus = { ...this._reindexStatus, [key]: total > 0 ? `${processed}/${total}` : 'Running...' };
        if (state === 'stopped' || state === 'completed') {
          this._reindexing = new Set([...this._reindexing].filter((k) => k !== key));
          this._reindexStatus = { ...this._reindexStatus, [key]: null };
          toast.positive(`Reindex completed for ${idx.name} (${processed}/${total}).`);
          return false;
        }
        if (state === 'failed') {
          this._reindexing = new Set([...this._reindexing].filter((k) => k !== key));
          this._reindexStatus = { ...this._reindexStatus, [key]: null };
          toast.negative(`Reindex failed for ${idx.name}.`);
          return false;
        }
        return true;
      };
      const doPoll = async () => {
        if (!this._reindexing.has(key)) return;
        const cont = await poll();
        if (cont) this._pollTimeout = setTimeout(doPoll, 3000);
      };
      this._pollTimeout = setTimeout(doPoll, 3000);
    } else {
      this._reindexing = new Set([...this._reindexing].filter((k) => k !== key));
      this._reindexStatus = { ...this._reindexStatus, [key]: null };
      toast.positive(`Reindex triggered for ${idx.name}.`);
    }
  }

  async _handleDeleteIndex() {
    const name = this._deleteConfirm;
    if (!name) return;
    this._deleteConfirm = null;
    this._indices = this._indices.filter((i) => i.name !== name);
    this._yamlRaw = this._buildYamlFromIndices();
    this._saving = true;
    const { status, error } = await saveIndexConfig(this._org, this._site, this._yamlRaw, { create: false });
    this._saving = false;
    const err = getApiError(status, 'save index config', error);
    if (err) { toast.negative(err); return; }
    toast.positive(`Index "${name}" deleted.`);
  }

  _renderCard(idx) {
    const isRunning = this._reindexing.has(idx.name);
    return html`
      <admin-card heading=${idx.name}>
        <dl class="idx-card-dl">
          <dt>Target</dt>
          <dd><code>${idx.target}</code></dd>
          ${idx.properties?.length ? html`
            <dt>Properties</dt>
            <dd>${idx.properties.map((p) => html`<code class="prop-tag">${p.name}</code> `)}</dd>
          ` : nothing}
          ${idx.include?.length ? html`
            <dt>Include</dt>
            <dd>${idx.include.map((p) => html`<code class="pattern-tag">${p}</code> `)}</dd>
          ` : nothing}
          ${idx.exclude?.length ? html`
            <dt>Exclude</dt>
            <dd>${idx.exclude.map((p) => html`<code class="pattern-tag">${p}</code> `)}</dd>
          ` : nothing}
        </dl>
        <div slot="footer" class="idx-card-footer">
          <eds-button size="m" variant="secondary" @click=${() => this._openEdit(idx)}>Edit</eds-button>
          <eds-button size="m" variant="secondary" ?disabled=${isRunning} @click=${() => this._handleReindex(idx)}>
            ${isRunning
              ? html`<div class="spinner s" slot="icon" aria-label="Reindexing"></div> ${this._reindexStatus[idx.name] || 'Reindexing...'}`
              : html`<span slot="icon">${edsIcon('data-refresh', { size: 16 })}</span> Reindex`}
          </eds-button>
          <eds-button quiet aria-label="Delete index" @click=${() => { this._deleteConfirm = idx.name; }}>
            <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
          </eds-button>
        </div>
      </admin-card>
    `;
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Index Configuration</h1>
            <p class="page-subtitle">Manage index configurations for your site.</p>
          </div>
          ${!this._loading && !this._error ? html`
            <eds-button variant="accent" @click=${this._openAdd}>
              <span slot="icon">${edsIcon('add', { size: 16 })}</span>
              Add Index
            </eds-button>
          ` : nothing}
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        ${this._loading
          ? html`<div class="card-grid">${[1, 2, 3].map(() => html`<admin-card loading></admin-card>`)}</div>`
          : this._indices.length === 0
            ? html`<p class="empty">No indices configured. Add one to get started.</p>`
            : html`
                <div class="card-grid">
                  ${this._indices.map((idx) => this._renderCard(idx))}
                </div>
              `}
      </div>

      ${this._showDialog ? this._renderDialog() : nothing}
      ${this._deleteConfirm ? html`
        <eds-dialog
          open
          headline="Delete Index"
          size="s"
          @close=${() => { this._deleteConfirm = null; }}
        >
          <p>Are you sure you want to delete the index <strong>${this._deleteConfirm}</strong>? This will remove it from the configuration.</p>
          <div class="dialog-buttons">
            <eds-button variant="secondary" treatment="outline" @click=${() => { this._deleteConfirm = null; }}>Cancel</eds-button>
            <eds-button variant="negative" ?disabled=${this._saving} @click=${this._handleDeleteIndex}>
              ${this._saving ? 'Deleting...' : 'Delete'}
            </eds-button>
          </div>
        </eds-dialog>
      ` : nothing}
    `;
  }

  _renderDialog() {
    const form = this._dialogForm;
    return html`
      <eds-dialog
        open
        headline=${this._editingIndex ? 'Edit Index' : 'Add Index'}
        size="l"
        @close=${this._closeDialog}
      >
            <div class="form-row">
              <label class="field-label" for="dlg-idx-name">Index name</label>
              <eds-textfield
                id="dlg-idx-name"
                placeholder="default"
                .value=${form.name}
                ?disabled=${!!this._editingIndex}
                @input=${(e) => { this._dialogForm = { ...this._dialogForm, name: e.target.value ?? '' }; }}
              ></eds-textfield>
            </div>

            <div class="form-row">
              <label class="field-label" for="dlg-idx-target">Target path</label>
              <eds-textfield
                id="dlg-idx-target"
                placeholder="/query-index.json"
                .value=${form.target}
                @input=${(e) => { this._dialogForm = { ...this._dialogForm, target: e.target.value ?? '' }; }}
              ></eds-textfield>
            </div>

            <div class="form-section-label">Include Patterns</div>
            <div class="patterns">
              ${(form.include || []).map((p, i) => html`
                <div class="pattern-row">
                  <eds-textfield
                    placeholder="e.g. /blog/**"
                    .value=${p}
                    @input=${(e) => {
                      const arr = [...this._dialogForm.include];
                      arr[i] = e.target.value ?? '';
                      this._dialogForm = { ...this._dialogForm, include: arr };
                    }}
                  ></eds-textfield>
                  <eds-button quiet aria-label="Remove" @click=${() => this._removeInclude(i)}>
                    <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
                  </eds-button>
                </div>
              `)}
              <eds-button variant="secondary" size="s" @click=${this._addInclude}>
                <span slot="icon">${edsIcon('add', { size: 16 })}</span> Add include
              </eds-button>
            </div>

            <div class="form-section-label">Exclude Patterns</div>
            <span class="help-text">One pattern per line</span>
            <eds-textfield
              multiline
              rows="3"
              placeholder="/drafts/**&#10;/internal/**"
              .value=${this._excludeText}
              @input=${(e) => { this._excludeText = e.target.value ?? ''; }}
            ></eds-textfield>

            <div class="form-section-label">Properties</div>
            <div class="properties">
              ${(form.properties || []).map((p, i) => html`
                <div class="prop-card">
                  <div class="prop-fields">
                    <div class="prop-field-row">
                      <eds-textfield placeholder="Property name" .value=${p.name}
                        @input=${(e) => { const arr = [...this._dialogForm.properties]; arr[i] = { ...arr[i], name: e.target.value ?? '' }; this._dialogForm = { ...this._dialogForm, properties: arr }; }}
                      ></eds-textfield>
                      <eds-picker label="Type" .value=${p.type}
                        .options=${PROPERTY_TYPES.map((t) => ({ value: t.id, label: t.label }))}
                        @change=${(e) => { const arr = [...this._dialogForm.properties]; arr[i] = { ...arr[i], type: (e.detail?.value ?? e.target?.value) ?? 'value' }; this._dialogForm = { ...this._dialogForm, properties: arr }; }}
                      ></eds-picker>
                    </div>
                    <div class="prop-field-row">
                      <eds-textfield placeholder="CSS selector" label="select" .value=${p.select || ''}
                        @input=${(e) => {
                          const arr = [...this._dialogForm.properties];
                          arr[i] = { ...arr[i], select: e.target.value ?? '' };
                          this._dialogForm = { ...this._dialogForm, properties: arr };
                        }}
                      ></eds-textfield>
                      <eds-textfield placeholder="selectFirst (optional)" label="selectFirst" .value=${p.selectFirst || ''}
                        @input=${(e) => {
                          const arr = [...this._dialogForm.properties];
                          arr[i] = { ...arr[i], selectFirst: e.target.value ?? '' };
                          this._dialogForm = { ...this._dialogForm, properties: arr };
                        }}
                      ></eds-textfield>
                    </div>
                    <eds-textfield placeholder="Value expression" label="${p.type === 'values' ? 'values' : 'value'}" .value=${p.value}
                      @input=${(e) => { const arr = [...this._dialogForm.properties]; arr[i] = { ...arr[i], value: e.target.value ?? '' }; this._dialogForm = { ...this._dialogForm, properties: arr }; }}
                    ></eds-textfield>
                  </div>
                  <div class="prop-actions">
                    <eds-button quiet aria-label="Remove property" @click=${() => this._removeProperty(i)}>
                      <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
                    </eds-button>
                  </div>
                </div>
              `)}
              <eds-button variant="secondary" size="s" @click=${this._addProperty}>
                <span slot="icon">${edsIcon('add', { size: 16 })}</span> Add property
              </eds-button>
            </div>

          <div class="dialog-buttons">
            <eds-button variant="secondary" treatment="outline" @click=${this._closeDialog}>Cancel</eds-button>
            <eds-button variant="accent" ?disabled=${this._saving} @click=${this._saveDialog}>
              ${this._saving ? 'Saving...' : 'Save'}
            </eds-button>
          </div>
      </eds-dialog>
    `;
  }

}

customElements.define('site-index', SiteIndex);
