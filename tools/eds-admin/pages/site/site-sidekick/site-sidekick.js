import { LitElement, html, nothing } from 'lit';
import { getRouteDetails } from '../../../utils/router.js';
import { fetchSiteConfig, saveSidekickConfig } from '../../../services/adminApi.js';
import { getApiError } from '../../../utils/apiErrors.js';
import { toast } from '../../../controllers/toast-controller.js';
import '../../../blocks/error-alert/error-alert.js';
import '../../../blocks/eds-button/eds-button.js';
import '../../../blocks/eds-dialog/eds-dialog.js';
import '../../../blocks/eds-textfield/eds-textfield.js';
import '../../../blocks/eds-picker/eds-picker.js';
import { edsIcon } from '../../../utils/icons.js';

import getSheet from '../../../utils/sheet.js';
import { pageSheet, sharedSheet } from '../../../styles/page-sheets.js';
const sheet = await getSheet(new URL('./site-sidekick.css', import.meta.url).pathname);

const ENVIRONMENTS = ['any', 'dev', 'admin', 'edit', 'preview', 'review', 'live', 'prod'];
const BADGE_VARIANTS = [
  'gray', 'red', 'orange', 'yellow', 'chartreuse', 'celery',
  'green', 'seafoam', 'cyan', 'blue', 'indigo', 'purple', 'fuchsia', 'magenta',
];

function clonePlugin(p) {
  return {
    id: p.id ?? '',
    title: p.title ?? '',
    url: p.url ?? '',
    environments: Array.isArray(p.environments) ? [...p.environments] : [],
    includePaths: Array.isArray(p.includePaths) ? [...p.includePaths] : [],
    excludePaths: Array.isArray(p.excludePaths) ? [...p.excludePaths] : [],
    isPalette: !!p.isPalette,
    isPopover: !!p.isPopover,
    isBadge: !!p.isBadge,
    isContainer: !!p.isContainer,
    pinned: p.pinned !== false,
    containerId: p.containerId ?? '',
    event: p.event ?? '',
    passConfig: !!p.passConfig,
    passReferrer: !!p.passReferrer,
    paletteRect: p.paletteRect ?? '',
    popoverRect: p.popoverRect ?? '',
    badgeVariant: p.badgeVariant ?? '',
  };
}

function cloneView(v) {
  return {
    id: v.id ?? '',
    path: v.path ?? '',
    viewer: v.viewer ?? '',
    title: v.title ?? '',
  };
}

function stripEmptyStrings(obj) {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === '' || val === undefined || val === null) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    result[key] = val;
  }
  return result;
}

function buildPluginPayload(p) {
  const out = { id: p.id };
  if (p.title) out.title = p.title;
  if (p.url) out.url = p.url;
  if (p.environments?.length) out.environments = p.environments;
  if (p.includePaths?.length) out.includePaths = p.includePaths;
  if (p.excludePaths?.length) out.excludePaths = p.excludePaths;
  if (p.isPalette) out.isPalette = true;
  if (p.isPopover) out.isPopover = true;
  if (p.isBadge) out.isBadge = true;
  if (p.isContainer) out.isContainer = true;
  if (p.pinned === false) out.pinned = false;
  if (p.containerId) out.containerId = p.containerId;
  if (p.event) out.event = p.event;
  if (p.passConfig) out.passConfig = true;
  if (p.passReferrer) out.passReferrer = true;
  if (p.paletteRect) out.paletteRect = p.paletteRect;
  if (p.popoverRect) out.popoverRect = p.popoverRect;
  if (p.badgeVariant) out.badgeVariant = p.badgeVariant;
  return out;
}

export class SiteSidekick extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _loading: { state: true },
    _saving: { state: true },
    _error: { state: true },
    _project: { state: true },
    _host: { state: true },
    _liveHost: { state: true },
    _previewHost: { state: true },
    _reviewHost: { state: true },
    _editUrlLabel: { state: true },
    _editUrlPattern: { state: true },
    _wordSaveDelay: { state: true },
    _trustedHosts: { state: true },
    _plugins: { state: true },
    _specialViews: { state: true },
    _newTrustedHost: { state: true },
    _pluginDialog: { state: true },
    _pluginEditIndex: { state: true },
    _pluginForm: { state: true },
    _viewDialog: { state: true },
    _viewEditIndex: { state: true },
    _viewForm: { state: true },
    _dialogError: { state: true },
  };

  constructor() {
    super();
    this._org = '';
    this._site = '';
    this._loading = true;
    this._saving = false;
    this._error = null;
    this._project = '';
    this._host = '';
    this._liveHost = '';
    this._previewHost = '';
    this._reviewHost = '';
    this._editUrlLabel = '';
    this._editUrlPattern = '';
    this._wordSaveDelay = '';
    this._trustedHosts = [];
    this._plugins = [];
    this._specialViews = [];
    this._newTrustedHost = '';
    this._pluginDialog = false;
    this._pluginEditIndex = -1;
    this._pluginForm = clonePlugin({});
    this._viewDialog = false;
    this._viewEditIndex = -1;
    this._viewForm = cloneView({});
    this._dialogError = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [pageSheet, sharedSheet, sheet];
    const details = getRouteDetails();
    this._org = details.org || '';
    this._site = details.site || '';
    if (this._org && this._site) {
      this._load();
    }
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    if (changedProperties.has('_org') || changedProperties.has('_site')) {
      if (this._org && this._site) this._load();
    }
  }

  async _load() {
    if (!this._org || !this._site) return;
    this._loading = true;
    this._error = null;
    const { data, status, error } = await fetchSiteConfig(this._org, this._site);
    const err = getApiError(status, 'load config', error);
    if (err) { this._error = err; this._loading = false; return; }
    const sk = data?.sidekick ?? {};
    this._project = sk.project ?? '';
    this._host = sk.host ?? '';
    this._liveHost = sk.liveHost ?? '';
    this._previewHost = sk.previewHost ?? '';
    this._reviewHost = sk.reviewHost ?? '';
    this._editUrlLabel = sk.editUrlLabel ?? '';
    this._editUrlPattern = sk.editUrlPattern ?? '';
    this._wordSaveDelay = sk.wordSaveDelay != null ? String(sk.wordSaveDelay) : '';
    this._trustedHosts = Array.isArray(sk.trustedHosts) ? [...sk.trustedHosts] : [];
    this._plugins = Array.isArray(sk.plugins) ? sk.plugins.map(clonePlugin) : [];
    this._specialViews = Array.isArray(sk.specialViews) ? sk.specialViews.map(cloneView) : [];
    this._loading = false;
  }

  _buildConfig() {
    const config = stripEmptyStrings({
      project: this._project.trim(),
      host: this._host.trim(),
      liveHost: this._liveHost.trim(),
      previewHost: this._previewHost.trim(),
      reviewHost: this._reviewHost.trim(),
      editUrlLabel: this._editUrlLabel.trim(),
      editUrlPattern: this._editUrlPattern.trim(),
    });
    const delay = parseInt(this._wordSaveDelay, 10);
    if (!Number.isNaN(delay) && delay > 0) config.wordSaveDelay = delay;
    if (this._trustedHosts.length) config.trustedHosts = [...this._trustedHosts];
    if (this._plugins.length) config.plugins = this._plugins.map(buildPluginPayload);
    if (this._specialViews.length) {
      config.specialViews = this._specialViews
        .filter((v) => v.id && v.path && v.viewer)
        .map((v) => stripEmptyStrings({ id: v.id, path: v.path, viewer: v.viewer, title: v.title }));
    }
    return config;
  }

  async _handleSave() {
    this._saving = true;
    const config = this._buildConfig();
    const { status, error } = await saveSidekickConfig(this._org, this._site, config);
    this._saving = false;
    const err = getApiError(status, 'save sidekick config', error);
    if (err) { toast.negative(err); return; }
    toast.positive('Sidekick configuration saved.');
    await this._load();
  }

  _addTrustedHost() {
    const host = this._newTrustedHost.trim();
    if (!host || this._trustedHosts.includes(host)) return;
    this._trustedHosts = [...this._trustedHosts, host];
    this._newTrustedHost = '';
  }

  _removeTrustedHost(index) {
    this._trustedHosts = this._trustedHosts.filter((_, i) => i !== index);
  }

  _openAddPlugin() {
    this._pluginEditIndex = -1;
    this._pluginForm = clonePlugin({ pinned: true });
    this._dialogError = '';
    this._pluginDialog = true;
  }

  _openEditPlugin(index) {
    this._pluginEditIndex = index;
    this._pluginForm = clonePlugin(this._plugins[index]);
    this._dialogError = '';
    this._pluginDialog = true;
  }

  _closePluginDialog() { this._pluginDialog = false; }

  _savePlugin() {
    if (!this._pluginForm.id?.trim()) {
      this._dialogError = 'Plugin ID is required.';
      return;
    }
    const plugin = clonePlugin(this._pluginForm);
    plugin.id = plugin.id.trim();
    if (this._pluginEditIndex >= 0) {
      const next = [...this._plugins];
      next[this._pluginEditIndex] = plugin;
      this._plugins = next;
    } else {
      this._plugins = [...this._plugins, plugin];
    }
    this._pluginDialog = false;
  }

  _deletePlugin(index) {
    this._plugins = this._plugins.filter((_, i) => i !== index);
  }

  _togglePluginEnv(env) {
    const envs = [...(this._pluginForm.environments || [])];
    const idx = envs.indexOf(env);
    if (idx >= 0) envs.splice(idx, 1);
    else envs.push(env);
    this._pluginForm = { ...this._pluginForm, environments: envs };
  }

  _openAddView() {
    this._viewEditIndex = -1;
    this._viewForm = cloneView({});
    this._dialogError = '';
    this._viewDialog = true;
  }

  _openEditView(index) {
    this._viewEditIndex = index;
    this._viewForm = cloneView(this._specialViews[index]);
    this._dialogError = '';
    this._viewDialog = true;
  }

  _closeViewDialog() { this._viewDialog = false; }

  _saveView() {
    if (!this._viewForm.id?.trim() || !this._viewForm.path?.trim() || !this._viewForm.viewer?.trim()) {
      this._dialogError = 'ID, path, and viewer URL are required.';
      return;
    }
    const view = cloneView(this._viewForm);
    if (this._viewEditIndex >= 0) {
      const next = [...this._specialViews];
      next[this._viewEditIndex] = view;
      this._specialViews = next;
    } else {
      this._specialViews = [...this._specialViews, view];
    }
    this._viewDialog = false;
  }

  _deleteView(index) {
    this._specialViews = this._specialViews.filter((_, i) => i !== index);
  }

  render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Sidekick Configuration</h1>
            <p class="page-subtitle">Configure the AEM Sidekick extension for <strong>${this._org}/${this._site}</strong>.</p>
          </div>
          <eds-button variant="accent" ?disabled=${this._saving} @click=${this._handleSave}>
            ${this._saving ? 'Saving...' : 'Save'}
          </eds-button>
        </div>

        <error-alert .error=${this._error} @retry=${this._load}></error-alert>

        ${this._loading
          ? html`<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`
          : this._error ? nothing : html`
              ${this._renderGeneralSettings()}
              ${this._renderPlugins()}
              ${this._renderSpecialViews()}
              ${this._renderTrustedHosts()}
            `}
      </div>
      ${this._pluginDialog ? this._renderPluginDialog() : nothing}
      ${this._viewDialog ? this._renderViewDialog() : nothing}
    `;
  }

  _renderGeneralSettings() {
    return html`
      <div class="settings-section">
        <h3 class="section-heading">General Settings</h3>
        <div class="form-fields">
          <div class="form-field">
            <label class="field-label">Project Name</label>
            <eds-textfield
              placeholder="My Project"
              .value=${this._project}
              @input=${(e) => { this._project = e.target.value ?? ''; }}
            >
              <span slot="help-text" class="help-text">Display name in the Sidekick</span>
            </eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Word Save Delay (ms)</label>
            <eds-textfield
              placeholder="1500"
              .value=${this._wordSaveDelay}
              @input=${(e) => { this._wordSaveDelay = e.target.value ?? ''; }}
            >
              <span slot="help-text" class="help-text">Delay before preview after Word save</span>
            </eds-textfield>
          </div>
        </div>

        <h3 class="section-heading">Host Overrides</h3>
        <div class="form-fields">
          <div class="form-field">
            <label class="field-label">Production Host</label>
            <eds-textfield
              placeholder="www.example.com"
              .value=${this._host}
              @input=${(e) => { this._host = e.target.value ?? ''; }}
            >
              <span slot="help-text" class="help-text">Overrides cdn.prod.host</span>
            </eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Live Host</label>
            <eds-textfield
              placeholder="main--site--org.aem.live"
              .value=${this._liveHost}
              @input=${(e) => { this._liveHost = e.target.value ?? ''; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Preview Host</label>
            <eds-textfield
              placeholder="main--site--org.aem.page"
              .value=${this._previewHost}
              @input=${(e) => { this._previewHost = e.target.value ?? ''; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Review Host</label>
            <eds-textfield
              placeholder="main--site--org.aem.reviews"
              .value=${this._reviewHost}
              @input=${(e) => { this._reviewHost = e.target.value ?? ''; }}
            ></eds-textfield>
          </div>
        </div>

        <h3 class="section-heading">Custom Edit URL</h3>
        <div class="form-fields">
          <div class="form-field">
            <label class="field-label">Edit URL Label</label>
            <eds-textfield
              placeholder="Edit in DA"
              .value=${this._editUrlLabel}
              @input=${(e) => { this._editUrlLabel = e.target.value ?? ''; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Edit URL Pattern</label>
            <eds-textfield
              placeholder="https://da.live/edit#/org/site{{pathname}}"
              .value=${this._editUrlPattern}
              @input=${(e) => { this._editUrlPattern = e.target.value ?? ''; }}
            >
              <span slot="help-text" class="help-text">Supports {{contentSourceUrl}}, {{pathname}}</span>
            </eds-textfield>
          </div>
        </div>
      </div>
    `;
  }

  _renderPlugins() {
    return html`
      <div class="settings-section">
        <div class="section-row">
          <h3 class="section-heading">Plugins</h3>
          <eds-button variant="secondary" size="s" @click=${this._openAddPlugin}>
            <span slot="icon">${edsIcon('add', { size: 16 })}</span>
            Add Plugin
          </eds-button>
        </div>
        ${this._plugins.length === 0
          ? html`<p class="empty">No plugins configured.</p>`
          : html`
              <div class="item-cards">
                ${this._plugins.map((p, i) => html`
                  <div class="item-card">
                    <div class="item-card-body">
                      <p class="item-card-title">${p.title || p.id}</p>
                      ${p.url ? html`<p class="item-card-meta">${p.url}</p>` : nothing}
                      <div class="item-card-tags">
                        ${p.isPalette ? html`<span class="tag">palette</span>` : nothing}
                        ${p.isPopover ? html`<span class="tag">popover</span>` : nothing}
                        ${p.isBadge ? html`<span class="tag">badge</span>` : nothing}
                        ${p.isContainer ? html`<span class="tag">container</span>` : nothing}
                        ${p.pinned === false ? html`<span class="tag">menu</span>` : nothing}
                        ${(p.environments ?? []).map((env) => html`<span class="tag">${env}</span>`)}
                      </div>
                    </div>
                    <div class="item-card-actions">
                      <eds-button quiet aria-label="Edit plugin" @click=${() => this._openEditPlugin(i)}>
                        <span slot="icon">${edsIcon('settings', { size: 16 })}</span>
                      </eds-button>
                      <eds-button quiet aria-label="Delete plugin" @click=${() => this._deletePlugin(i)}>
                        <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
                      </eds-button>
                    </div>
                  </div>
                `)}
              </div>
            `}
      </div>
    `;
  }

  _renderSpecialViews() {
    return html`
      <div class="settings-section">
        <div class="section-row">
          <h3 class="section-heading">Special Views</h3>
          <eds-button variant="secondary" size="s" @click=${this._openAddView}>
            <span slot="icon">${edsIcon('add', { size: 16 })}</span>
            Add View
          </eds-button>
        </div>
        ${this._specialViews.length === 0
          ? html`<p class="empty">No special views configured.</p>`
          : html`
              <div class="item-cards">
                ${this._specialViews.map((v, i) => html`
                  <div class="item-card">
                    <div class="item-card-body">
                      <p class="item-card-title">${v.title || v.id}</p>
                      <p class="item-card-meta">${v.path} &rarr; ${v.viewer}</p>
                    </div>
                    <div class="item-card-actions">
                      <eds-button quiet aria-label="Edit view" @click=${() => this._openEditView(i)}>
                        <span slot="icon">${edsIcon('settings', { size: 16 })}</span>
                      </eds-button>
                      <eds-button quiet aria-label="Delete view" @click=${() => this._deleteView(i)}>
                        <span slot="icon">${edsIcon('delete', { size: 16 })}</span>
                      </eds-button>
                    </div>
                  </div>
                `)}
              </div>
            `}
      </div>
    `;
  }

  _renderTrustedHosts() {
    return html`
      <div class="settings-section">
        <h3 class="section-heading">Trusted Hosts</h3>
        <p class="page-subtitle" style="margin:0">Additional hosts trusted for Sidekick authentication.</p>
        ${this._trustedHosts.length > 0
          ? html`
              <div class="chips">
                ${this._trustedHosts.map((h, i) => html`
                  <span class="chip">
                    ${h}
                    <eds-button quiet size="xs" aria-label="Remove" @click=${() => this._removeTrustedHost(i)}>
                      <span slot="icon">${edsIcon('close', { size: 16 })}</span>
                    </eds-button>
                  </span>
                `)}
              </div>
            `
          : nothing}
        <div class="inline-add">
          <eds-textfield
            placeholder="trusted.example.com"
            .value=${this._newTrustedHost}
            @input=${(e) => { this._newTrustedHost = e.target.value ?? ''; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._addTrustedHost(); }}
          ></eds-textfield>
          <eds-button variant="secondary" size="s" @click=${this._addTrustedHost}>Add</eds-button>
        </div>
      </div>
    `;
  }

  _renderPluginDialog() {
    const f = this._pluginForm;
    return html`
      <eds-dialog
        open
        headline="${this._pluginEditIndex >= 0 ? 'Edit' : 'Add'} Plugin"
        size="l"
        @close=${this._closePluginDialog}
      >
        <div class="dialog-form-fields">
          <p class="dialog-section-label">Basic</p>
          <div class="dialog-row">
            <div class="form-field">
              <label class="field-label">Plugin ID *</label>
              <eds-textfield placeholder="my-plugin" .value=${f.id}
                @keydown=${(e) => e.stopPropagation()}
                @input=${(e) => { this._pluginForm = { ...f, id: e.target.value }; this._dialogError = ''; }}
              ></eds-textfield>
            </div>
            <div class="form-field">
              <label class="field-label">Title</label>
              <eds-textfield placeholder="My Plugin" .value=${f.title}
                @keydown=${(e) => e.stopPropagation()}
                @input=${(e) => { this._pluginForm = { ...f, title: e.target.value }; }}
              ></eds-textfield>
            </div>
          </div>
          <div class="form-field">
            <label class="field-label">URL</label>
            <eds-textfield placeholder="https://example.com/plugin" .value=${f.url}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._pluginForm = { ...f, url: e.target.value }; }}
            ></eds-textfield>
          </div>

          <p class="dialog-section-label">Environments</p>
          <div class="env-checkboxes">
            ${ENVIRONMENTS.map((env) => html`
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  ?checked=${f.environments?.includes(env)}
                  @change=${() => this._togglePluginEnv(env)}
                />
                ${env}
              </label>
            `)}
          </div>

          <p class="dialog-section-label">Display</p>
          <div class="dialog-checkboxes">
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.pinned !== false}
                @change=${(e) => { this._pluginForm = { ...f, pinned: e.target.checked }; }} />
              Pinned (bar)
            </label>
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.isPalette}
                @change=${(e) => { this._pluginForm = { ...f, isPalette: e.target.checked }; }} />
              Palette
            </label>
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.isPopover}
                @change=${(e) => { this._pluginForm = { ...f, isPopover: e.target.checked }; }} />
              Popover
            </label>
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.isBadge}
                @change=${(e) => { this._pluginForm = { ...f, isBadge: e.target.checked }; }} />
              Badge
            </label>
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.isContainer}
                @change=${(e) => { this._pluginForm = { ...f, isContainer: e.target.checked }; }} />
              Container
            </label>
          </div>
          ${f.isBadge ? html`
            <div class="form-field">
              <label class="field-label">Badge Variant</label>
              <eds-picker placeholder="Select variant" .value=${f.badgeVariant}
                .options=${BADGE_VARIANTS.map((v) => ({ value: v, label: v }))}
                @change=${(e) => { this._pluginForm = { ...f, badgeVariant: (e.detail?.value ?? e.target?.value) ?? '' }; }}>
              </eds-picker>
            </div>
          ` : nothing}
          ${f.isPalette ? html`
            <div class="form-field">
              <label class="field-label">Palette Rect</label>
              <eds-textfield placeholder="top: 100px; right: 20px; width: 200px; height: 50vh"
                .value=${f.paletteRect}
                @keydown=${(e) => e.stopPropagation()}
                @input=${(e) => { this._pluginForm = { ...f, paletteRect: e.target.value }; }}
              ></eds-textfield>
            </div>
          ` : nothing}
          ${f.isPopover ? html`
            <div class="form-field">
              <label class="field-label">Popover Rect</label>
              <eds-textfield placeholder="width: 400px; height: 300px"
                .value=${f.popoverRect}
                @keydown=${(e) => e.stopPropagation()}
                @input=${(e) => { this._pluginForm = { ...f, popoverRect: e.target.value }; }}
              ></eds-textfield>
            </div>
          ` : nothing}

          <p class="dialog-section-label">Advanced</p>
          <div class="dialog-row">
            <div class="form-field">
              <label class="field-label">Container ID</label>
              <eds-textfield placeholder="parent-container" .value=${f.containerId}
                @keydown=${(e) => e.stopPropagation()}
                @input=${(e) => { this._pluginForm = { ...f, containerId: e.target.value }; }}
              ></eds-textfield>
            </div>
            <div class="form-field">
              <label class="field-label">Custom Event</label>
              <eds-textfield placeholder="my-event" .value=${f.event}
                @keydown=${(e) => e.stopPropagation()}
                @input=${(e) => { this._pluginForm = { ...f, event: e.target.value }; }}
              ></eds-textfield>
            </div>
          </div>
          <div class="dialog-checkboxes">
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.passConfig}
                @change=${(e) => { this._pluginForm = { ...f, passConfig: e.target.checked }; }} />
              Pass config params to URL
            </label>
            <label class="checkbox-label">
              <input type="checkbox" ?checked=${f.passReferrer}
                @change=${(e) => { this._pluginForm = { ...f, passReferrer: e.target.checked }; }} />
              Pass referrer to URL
            </label>
          </div>

          <p class="dialog-section-label">Path Filters</p>
          <div class="form-field">
            <label class="field-label">Include Paths (one per line)</label>
            <eds-textfield multiline rows="3"
              placeholder="/docs/**&#10;/blog/**"
              .value=${(f.includePaths ?? []).join('\n')}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._pluginForm = { ...f, includePaths: e.target.value.split('\n').filter(Boolean) }; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Exclude Paths (one per line)</label>
            <eds-textfield multiline rows="3"
              placeholder="/admin/**"
              .value=${(f.excludePaths ?? []).join('\n')}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._pluginForm = { ...f, excludePaths: e.target.value.split('\n').filter(Boolean) }; }}
            ></eds-textfield>
          </div>
        </div>

        ${this._dialogError ? html`<p class="dialog-error">${this._dialogError}</p>` : nothing}

        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${this._closePluginDialog}>Cancel</eds-button>
          <eds-button variant="accent" @click=${this._savePlugin}>
            ${this._pluginEditIndex >= 0 ? 'Update' : 'Add'} Plugin
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }

  _renderViewDialog() {
    const f = this._viewForm;
    return html`
      <eds-dialog
        open
        headline="${this._viewEditIndex >= 0 ? 'Edit' : 'Add'} Special View"
        size="m"
        @close=${this._closeViewDialog}
      >
        <div class="dialog-form-fields">
          <div class="form-field">
            <label class="field-label">View ID *</label>
            <eds-textfield placeholder="json-viewer" .value=${f.id}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._viewForm = { ...f, id: e.target.value }; this._dialogError = ''; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Title</label>
            <eds-textfield placeholder="JSON Viewer" .value=${f.title}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._viewForm = { ...f, title: e.target.value }; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Path Pattern *</label>
            <eds-textfield placeholder="/foo/**.json" .value=${f.path}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._viewForm = { ...f, path: e.target.value }; this._dialogError = ''; }}
            ></eds-textfield>
          </div>
          <div class="form-field">
            <label class="field-label">Viewer URL *</label>
            <eds-textfield placeholder="/tools/sidekick/viewer/index.html" .value=${f.viewer}
              @keydown=${(e) => e.stopPropagation()}
              @input=${(e) => { this._viewForm = { ...f, viewer: e.target.value }; this._dialogError = ''; }}
            ></eds-textfield>
          </div>
        </div>

        ${this._dialogError ? html`<p class="dialog-error">${this._dialogError}</p>` : nothing}

        <div class="dialog-buttons">
          <eds-button variant="secondary" treatment="outline" @click=${this._closeViewDialog}>Cancel</eds-button>
          <eds-button variant="accent" @click=${this._saveView}>
            ${this._viewEditIndex >= 0 ? 'Update' : 'Add'} View
          </eds-button>
        </div>
      </eds-dialog>
    `;
  }
}

customElements.define('site-sidekick', SiteSidekick);
